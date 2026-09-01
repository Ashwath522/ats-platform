'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Eye, Smile, AlertTriangle } from 'lucide-react'
import { FrameSampler } from '@/lib/frame-sampler'
import { FaceDetector } from '@/lib/cv/face-detector'
import { ObjectDetector } from '@/lib/cv/object-detector'
import { GazeHeadPoseEstimator, GazeEstimate, HeadPose, GazeHeadPoseResult } from '@/lib/cv/gaze-headpose'
import { PoseDetector, PoseResult } from '@/lib/cv/pose-detector'
import { LightingAnalyzer } from '@/lib/cv/lighting-analyzer'
import { LivenessAnalyzer } from '@/lib/cv/liveness-analyzer'
import { calculateRiskScore, ProctoringEvent, RiskOutput, HIGH_SEVERITY_EVENT_TYPES } from '@/lib/cv/risk-engine'
import { useRollingVideoBuffer } from '@/lib/rolling-buffer'
import { completeInterview, getInterviewQuestions, getNextInterviewStep } from '@/app/actions/core'
import { useSpeechRecognition, speakText } from '@/lib/use-speech-recognition'

// Debug flag to show detailed computer vision status (set to false for production candidate view)
const DEBUG_CV = false

type BehavioralSignal = {
  type: 'attention' | 'engagement' | 'confidence' | 'concern'
  label: string
  value: number
  timestamp: number
}

type CVStatus = {
  faceDetected: boolean
  faceCount: number
  objects: string[] // labels of detected objects
}

type GazeHeadPoseStatus = {
  gaze: GazeEstimate | null
  headPose: HeadPose | null
}

type PoseStatus = {
  poseScore: number | null
  personPresent: boolean | null
  shouldersVisible: boolean | null
}

type BaselineData = {
  gazeCenter: { x: number; y: number } | null
  gazeRange: { xMin: number; xMax: number; yMin: number; yMax: number } | null
  headPoseRange: { pitchMin: number; pitchMax: number; yawMin: number; yawMax: number; rollMin: number; rollMax: number } | null
  poseScoreRange: { min: number; max: number } | null
  gazeSamplesCollected: number
  poseSamplesCollected: number
  gazeBaselineReady: boolean
  poseBaselineReady: boolean
}

export default function LiveInterviewRoom({
  interviewId,
  jobTitle,
  candidateName,
  onComplete,
}: {
  interviewId: string
  jobTitle: string
  candidateName: string
  onComplete: () => void
}) {
  const [isRecording, setIsRecording] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [signals, setSignals] = useState<BehavioralSignal[]>([])
  const [cvStatus, setCVStatus] = useState<CVStatus>({
    faceDetected: false,
    faceCount: 0,
    objects: []
  })
  const [gazeHeadPoseStatus, setGazeHeadPoseStatus] = useState<GazeHeadPoseStatus>({
    gaze: null,
    headPose: null
  })
  const [poseStatus, setPoseStatus] = useState<PoseStatus>({
    poseScore: null,
    personPresent: null,
    shouldersVisible: null
  })
  const [baselineData, setBaselineData] = useState<BaselineData>({
    gazeCenter: null,
    gazeRange: null,
    headPoseRange: null,
    poseScoreRange: null,
    gazeSamplesCollected: 0,
    poseSamplesCollected: 0,
    gazeBaselineReady: false,
    poseBaselineReady: false
  })
  const [isBaselineComplete, setIsBaselineComplete] = useState(false)
  const [proctoringDegraded, setProctoringDegraded] = useState(false)
  const [tabSwitchWarning, setTabSwitchWarning] = useState(false)
  const isBaselineCompleteRef = useRef(false)
  const tabSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabSwitchActiveRef = useRef(false)
  const [baseIndex, setBaseIndex] = useState(0)
  const [isFollowUp, setIsFollowUp] = useState(false)
  const [displayQuestion, setDisplayQuestion] = useState('')
  const [baseQuestions, setBaseQuestions] = useState<string[]>([])
  const [answers, setAnswers] = useState<{ question: string; answer: string; score: number; feedback: string }[]>([])
  const [qaHistory, setQaHistory] = useState<{ question: string; answer: string }[]>([])
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const {
    transcript,
    displayTranscript,
    isListening,
    micDenied,
    supported: speechSupported,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition()
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const recordingStartRef = useRef<number>(0)
  const frameSamplerRef = useRef<FrameSampler | null>(null)
  const faceDetectorRef = useRef<FaceDetector | null>(null)
  const objectDetectorRef = useRef<ObjectDetector | null>(null)
  const gazeHeadPoseEstimatorRef = useRef<GazeHeadPoseEstimator | null>(null)
  const poseDetectorRef = useRef<PoseDetector | null>(null)
  const lightingAnalyzerRef = useRef<LightingAnalyzer | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const lastEmitRef = useRef<Map<string, number>>(new Map())
  const lastLivePublishRef = useRef<number>(0)
  const livePublishInFlightRef = useRef(false)
  // Sliding window for gaze and head pose samples (last 15 seconds)
  const gazeSamplesRef = useRef<Array<{gaze: GazeEstimate; headPose: HeadPose; timestamp: number}>>([])
  const headPoseSamplesRef = useRef<Array<{gaze: GazeEstimate; headPose: HeadPose; timestamp: number}>>([])
  const poseSamplesRef = useRef<Array<{poseScore: number; personPresent: boolean; shouldersVisible: boolean; timestamp: number}>>([])
  // Ref for recent events (last 5 minutes) for risk engine
  const recentEventsRef = useRef<ProctoringEvent[]>([])
  // Ref for risk score history (last 20 scores)
  const riskScoresRef = useRef<RiskOutput[]>([])
  // Ref for media stream
  const streamRef = useRef<MediaStream | null>(null)
  // Ref for previous lighting values to detect sudden changes
  const prevLightingRef = useRef<{
    brightness: number;
    contrast: number;
    timestamp: number;
  } | null>(null)
  // Ref for liveness analyzer
  const livenessAnalyzerRef = useRef<LivenessAnalyzer | null>(null)

  // Hook for rolling video buffer
  const { getClip, takeSnapshot } = useRollingVideoBuffer(videoElement, { secondsToBuffer: 25 })

  useEffect(() => {
    isBaselineCompleteRef.current = isBaselineComplete
  }, [isBaselineComplete])

  useEffect(() => {
    getInterviewQuestions(Number(interviewId)).then((result) => {
      if ('questions' in result && result.questions.length) {
        setBaseQuestions(result.questions)
        setDisplayQuestion(result.questions[0])
      }
    })
  }, [interviewId])

  useEffect(() => {
    if (isRecording && displayQuestion) {
      speakText(displayQuestion)
    }
  }, [displayQuestion, isRecording])

  const activeQuestions =
    baseQuestions.length > 0
      ? baseQuestions
      : [
          `Tell me about your experience relevant to this ${jobTitle} role.`,
          'Describe a challenging decision you made recently.',
          'What would you focus on in your first 30 days?',
        ]

  useEffect(() => {
    if (!displayQuestion && activeQuestions.length > 0) {
      setDisplayQuestion(activeQuestions[0])
    }
  }, [activeQuestions, displayQuestion])

  const evaluateAnswer = (question: string, answer: string) => {
    const normalized = answer.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    const words = normalized.split(/\s+/).filter(Boolean)
    const uniqueWords = new Set(words)
    const roleTerms = jobTitle.toLowerCase().split(/\s+/).filter((word) => word.length > 3)
    const questionTerms = question.toLowerCase().split(/\s+/).filter((word) => word.length > 5)
    const coverageTerms = [...new Set([...roleTerms, ...questionTerms])]
    const coverage = coverageTerms.filter((term) => normalized.includes(term)).length
    const depth = Math.min(45, words.length * 1.4)
    const specificity = Math.min(25, uniqueWords.size * 0.8)
    const relevance = Math.min(30, coverage * 8)
    const score = Math.max(20, Math.min(100, Math.round(depth + specificity + relevance)))
    const shallow = words.length < 22

    return {
      score,
      feedback: shallow
        ? 'Answer was brief; human reviewer should check depth and context.'
        : score >= 70
          ? 'Answer addressed the prompt with relevant detail and role context.'
          : 'Answer was understandable but could use more concrete examples.',
      shallow,
    }
  }

  const submitVoiceAnswer = async () => {
    const answerText = transcript.trim()
    if (!answerText || !displayQuestion || isSubmittingAnswer || isThinking) return

    setIsSubmittingAnswer(true)
    setIsThinking(true)
    stopListening()

    const question = displayQuestion
    const result = evaluateAnswer(question, answerText)
    const newAnswer = { question, answer: answerText, score: result.score, feedback: result.feedback }
    const newHistory = [...qaHistory, { question, answer: answerText }]
    const updatedAnswers = [...answers, newAnswer]

    setAnswers(updatedAnswers)
    setQaHistory(newHistory)
    resetTranscript()

    const step = await getNextInterviewStep({
      interviewId: Number(interviewId),
      baseQuestionIndex: baseIndex,
      isFollowUpQuestion: isFollowUp,
      currentQuestion: question,
      candidateAnswer: answerText,
      priorQA: newHistory,
    })

    setIsThinking(false)

    if ('error' in step) {
      setIsSubmittingAnswer(false)
      return
    }

    if (step.action === 'complete') {
      await completeInterview(Number(interviewId), updatedAnswers)
      endInterview()
      setIsSubmittingAnswer(false)
      return
    }

    if (step.action === 'ended_by_candidate') {
      // Inform candidate, log event, then finalize interview
      const endMessage = "Thanks for your time today — we've ended the interview early at your request."
      setDisplayQuestion(endMessage)
      try {
        // Speak the message for the candidate
        speakText(endMessage)
      } catch {
        // ignore TTS errors
      }

      // Log informational proctoring event so recruiters see candidate-initiated end
      try {
        await fetchEvent({ type: 'interview_ended_by_candidate', severity: 'low', metadata: { answer: answerText } })
      } catch {
        // non-blocking
      }

      // Give a short moment for the message to be presented
      await new Promise((res) => setTimeout(res, 1200))

      await completeInterview(Number(interviewId), updatedAnswers)
      endInterview()
      setIsSubmittingAnswer(false)
      return
    }

    if (step.action === 'follow_up' && step.question) {
      setIsFollowUp(true)
      setDisplayQuestion(step.question)
    } else if (step.action === 'next_base') {
      setIsFollowUp(false)
      const nextIndex = step.nextBaseIndex ?? baseIndex + 1
      // If the engine flagged a weak answer, emit a low-severity weak_answer event for reviewers
      if (step.weakAnswerFlag) {
        try {
          await fetchEvent({ type: 'weak_answer', severity: 'low', metadata: { question, answer: answerText } })
        } catch {
          // non-blocking
        }
      }
      setBaseIndex(nextIndex)
      setDisplayQuestion(step.question ?? activeQuestions[nextIndex] ?? '')
    }

    setIsSubmittingAnswer(false)
  }

  // Determine if we should clip for a given event
  const shouldClipEvent = (eventType: string, severity: 'low' | 'medium' | 'high'): boolean => {
    if (severity === 'high') return true
    return HIGH_SEVERITY_EVENT_TYPES.has(eventType)
  }

  // Upload media (clip and snapshot) for a given event
  const uploadMediaForEvent = async (eventId: number, clipBlob: Blob, snapshotBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('event_id', eventId.toString())
      formData.append('session_id', sessionIdRef.current ?? `interview:${interviewId}`)
      formData.append('clip', clipBlob, 'clip.webm')
      formData.append('snapshot', snapshotBlob, 'snapshot.jpg')

      await fetch('/api/proctoring/media/upload', {
        method: 'POST',
        body: formData,
      })
    } catch (err) {
      console.error('Failed to upload media for event', err)
    }
  }

  // Handle event emission with optional media upload
  const handleEventEmission = async (event: {
    type: string;
    severity: 'low' | 'medium' | 'high';
    metadata: Record<string, unknown>;
  }) => {
    const eventId = await fetchEvent(event)
    if (eventId === null) return

    const needsMedia = event.severity === 'high' || shouldClipEvent(event.type, event.severity)
    if (!needsMedia) return

    let snapshotBlob = await takeSnapshot()
    if (!snapshotBlob && event.severity === 'high') {
      await new Promise((resolve) => setTimeout(resolve, 200))
      snapshotBlob = await takeSnapshot()
    }
    if (!snapshotBlob) return

    const clipBlob = event.severity === 'high' ? getClip(15) : new Blob()
    await uploadMediaForEvent(
      eventId,
      clipBlob.size > 0 ? clipBlob : new Blob(),
      snapshotBlob,
    )
  }

  const buildRedFlags = (
    cv: CVStatus,
    gazeHeadPoseResult: GazeHeadPoseResult | undefined,
    poseResult: PoseResult | undefined,
    lightingResult?: {
      brightness: number;
      contrast: number;
      uniformity: number;
      darkLighting: boolean;
      goodLighting: boolean;
    },
    livenessResult?: {
      eyeAspectRatio: number;
      blinkRate: number;
      headMovementScore: number;
      textureAnalysisScore: number;
      spoofSuspected: boolean;
      livenessScore: number;
    },
  ): string[] => {
    const flags: string[] = []

    if (cv.faceCount === 0) flags.push('face_left_frame')
    if (cv.faceCount > 1) flags.push('multiple_faces')
    if (cv.objects.some((obj) => ['cell phone', 'phone', 'mobile phone'].includes(obj.toLowerCase()))) {
      flags.push('phone_detected')
    }
    if (gazeHeadPoseResult?.gaze && !gazeHeadPoseResult.gaze.lookingAtScreen) {
      flags.push('looking_away')
    }
    if (gazeHeadPoseResult?.headPose && Math.abs(gazeHeadPoseResult.headPose.yaw) > 35) {
      flags.push('looking_behind')
    }
    if (poseResult?.personPresent === false) flags.push('person_absent')
    if (poseResult?.shouldersVisible === false) flags.push('slouching_or_turned')
    if (lightingResult?.darkLighting) flags.push('dark_lighting')
    if (livenessResult?.spoofSuspected) flags.push('spoof_suspected')

    return [...new Set(flags)]
  }

  const publishLiveSessionSnapshot = async (params: {
    cvStatus: CVStatus
    gazeHeadPoseResult: GazeHeadPoseResult | undefined
    poseResult: PoseResult | undefined
    lightingResult?: {
      brightness: number;
      contrast: number;
      uniformity: number;
      darkLighting: boolean;
      goodLighting: boolean;
    }
    livenessResult?: {
      eyeAspectRatio: number;
      blinkRate: number;
      headMovementScore: number;
      textureAnalysisScore: number;
      spoofSuspected: boolean;
      livenessScore: number;
    }
    risk?: RiskOutput | null
  }) => {
    if (!sessionIdRef.current || livePublishInFlightRef.current) return

    const now = Date.now()
    if (now - lastLivePublishRef.current < 1500) return

    livePublishInFlightRef.current = true
    lastLivePublishRef.current = now

    try {
      const snapshotBlob = await takeSnapshot()
      if (!snapshotBlob) return

      const attentionScore = Math.max(
        0,
        Math.min(1, (
          (params.gazeHeadPoseResult?.gaze?.lookingAtScreen ? 0.45 : 0.15) +
          (params.poseResult?.personPresent ? 0.2 : 0) +
          (params.poseResult?.shouldersVisible ? 0.15 : 0) +
          (params.livenessResult?.livenessScore ?? 0.3) * 0.2
        )),
      )

      const redFlags = buildRedFlags(
        params.cvStatus,
        params.gazeHeadPoseResult,
        params.poseResult,
        params.lightingResult,
        params.livenessResult,
      )

      const payload = {
        session_id: sessionIdRef.current,
        interview_id: Number(interviewId),
        candidate_name: candidateName,
        job_title: jobTitle,
        status: isBaselineCompleteRef.current
          ? (redFlags.length > 0 || (params.risk?.level ?? 'low') === 'high' ? 'warning' : 'attending')
          : 'baseline',
        last_seen_at: new Date().toISOString(),
        risk_score: params.risk?.score ?? null,
        risk_level: params.risk?.level ?? 'low',
        warning:
          redFlags.length > 0 || (params.risk?.level ?? 'low') === 'high'
            ? `Live warning: ${redFlags.slice(0, 3).join(', ')}`
            : null,
        signal_summary: {
          faceDetected: params.cvStatus.faceDetected,
          faceCount: params.cvStatus.faceCount,
          eyeLookingAtScreen: params.gazeHeadPoseResult?.gaze?.lookingAtScreen ?? false,
          gazeX: params.gazeHeadPoseResult?.gaze?.x ?? null,
          gazeY: params.gazeHeadPoseResult?.gaze?.y ?? null,
          headPitch: params.gazeHeadPoseResult?.headPose?.pitch ?? null,
          headYaw: params.gazeHeadPoseResult?.headPose?.yaw ?? null,
          headRoll: params.gazeHeadPoseResult?.headPose?.roll ?? null,
          personPresent: params.poseResult?.personPresent ?? false,
          shouldersVisible: params.poseResult?.shouldersVisible ?? false,
          poseScore: params.poseResult?.poseScore ?? null,
          attentionScore,
          engagementScore: Math.max(
            0,
            Math.min(1, attentionScore * 0.85 + (params.livenessResult?.livenessScore ?? 0) * 0.15),
          ),
          darkLighting: params.lightingResult?.darkLighting ?? false,
          goodLighting: params.lightingResult?.goodLighting ?? false,
          brightness: params.lightingResult?.brightness ?? null,
          contrast: params.lightingResult?.contrast ?? null,
          uniformity: params.lightingResult?.uniformity ?? null,
          livenessScore: params.livenessResult?.livenessScore ?? null,
          spoofSuspected: params.livenessResult?.spoofSuspected ?? false,
          landmarkDataAvailable: Boolean(params.gazeHeadPoseResult?.landmarks?.length),
          objects: params.cvStatus.objects,
          redFlags,
          activeEventTypes: recentEventsRef.current.slice(-5).map((event) => event.type),
        },
      }

      const formData = new FormData()
      formData.append('payload', JSON.stringify(payload))
      formData.append('snapshot', snapshotBlob, 'snapshot.jpg')

      await fetch(`/api/proctoring/live/${encodeURIComponent(sessionIdRef.current)}`, {
        method: 'POST',
        body: formData,
      })
    } catch (err) {
      console.error('Failed to publish live session snapshot', err)
    } finally {
      livePublishInFlightRef.current = false
    }
  }

  const BASELINE_DURATION_MS = 50000 // 50 seconds for baseline (can be 45-60s, we'll use 50s for simplicity)
  const BASELINE_SAMPLES_REQUIRED = 40 // we'll collect samples at 1fps, so 50 seconds -> 50 samples, but we'll require at least 40
  const PATTERN_WINDOW_SIZE = 15 // 15 seconds for pattern detection
  const DEBOUNCE_MS = 5000 // 5 seconds debounce for same event type

  useEffect(() => {
    if (!isRecording) return

    recordingStartRef.current = Date.now() - elapsedSeconds * 1000
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [isRecording, elapsedSeconds])

  useEffect(() => {
    if (isRecording) {
      // Request video stream
      (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
          });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setVideoElement(videoRef.current);
          }
        } catch (err) {
          console.error('Failed to get video stream', err);
          alert('Failed to access camera. Please check your camera permissions.');
          setVideoElement(null);
        }
      })();
    } else {
      // Stop stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setVideoElement(null);
    }
  }, [isRecording])

  // Watch for baseline completion - set isBaselineComplete when both gaze and pose baselines are ready
  useEffect(() => {
    if (!isRecording) return

    const baselineDataCopy = baselineData
    if (baselineDataCopy.gazeBaselineReady && baselineDataCopy.poseBaselineReady && !isBaselineComplete) {
      isBaselineCompleteRef.current = true
      setIsBaselineComplete(true)

      // Send baseline to backend with available data
      // Note: We send whatever baseline data we have available at this point
      // One modality might have more recent data than the other, but that's okay
      const baselineSendData = {
        gazeCenter: baselineDataCopy.gazeCenter,
        gazeRange: baselineDataCopy.gazeRange,
        headPoseRange: baselineDataCopy.headPoseRange,
        poseScoreRange: baselineDataCopy.poseScoreRange,
        samplesCollected: Math.max(baselineDataCopy.gazeSamplesCollected, baselineDataCopy.poseSamplesCollected)
      }

      // Only send if we have at least some data
      if (baselineSendData.gazeCenter || baselineSendData.headPoseRange || baselineSendData.poseScoreRange) {
        handleEventEmission({
          type: 'baseline_learned',
          severity: 'low', // baseline is not a concern
          metadata: baselineSendData
        }).catch(err => {
          console.error('Failed to send baseline event:', err)
        })
      }
    }
  }, [baselineData, isBaselineComplete, isRecording])

  // Tab-switch / window-blur detection
  useEffect(() => {
    if (!isRecording) return

    const TAB_SWITCH_DEBOUNCE_MS = 2000

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab became hidden — start debounce timer
        if (tabSwitchTimerRef.current) clearTimeout(tabSwitchTimerRef.current)
        tabSwitchTimerRef.current = setTimeout(() => {
          if (document.hidden) {
            tabSwitchActiveRef.current = true
            setTabSwitchWarning(true)
            handleEventEmission({
              type: 'tab_switched',
              severity: 'medium',
              metadata: { trigger: 'visibilitychange', hidden: true },
            }).catch(() => {})
          }
        }, TAB_SWITCH_DEBOUNCE_MS)
      } else {
        // Tab came back — cancel timer and clear warning after a short delay
        if (tabSwitchTimerRef.current) {
          clearTimeout(tabSwitchTimerRef.current)
          tabSwitchTimerRef.current = null
        }
        // Keep warning visible for 5 seconds after return so candidate sees it
        setTimeout(() => {
          tabSwitchActiveRef.current = false
          setTabSwitchWarning(false)
        }, 5000)
      }
    }

    const handleWindowBlur = () => {
      if (tabSwitchTimerRef.current) clearTimeout(tabSwitchTimerRef.current)
      tabSwitchTimerRef.current = setTimeout(() => {
        // Only fire if the tab is still visible (blur but not hidden = alt-tab to another app)
        if (!document.hidden) {
          tabSwitchActiveRef.current = true
          setTabSwitchWarning(true)
          handleEventEmission({
            type: 'tab_switched',
            severity: 'medium',
            metadata: { trigger: 'window_blur' },
          }).catch(() => {})
          // Auto-clear after 5 seconds
          setTimeout(() => {
            tabSwitchActiveRef.current = false
            setTabSwitchWarning(false)
          }, 5000)
        }
      }, TAB_SWITCH_DEBOUNCE_MS)
    }

    const handleWindowFocus = () => {
      if (tabSwitchTimerRef.current) {
        clearTimeout(tabSwitchTimerRef.current)
        tabSwitchTimerRef.current = null
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('focus', handleWindowFocus)
      if (tabSwitchTimerRef.current) {
        clearTimeout(tabSwitchTimerRef.current)
        tabSwitchTimerRef.current = null
      }
    }
  }, [isRecording]) // eslint-disable-line react-hooks/exhaustive-deps

  const startInterview = async () => {
    try {
      // Initialize detectors
      const faceDetector = new FaceDetector()
      await faceDetector.initialize()
      faceDetectorRef.current = faceDetector

      const objectDetector = new ObjectDetector()
      await objectDetector.initialize()
      objectDetectorRef.current = objectDetector

      const gazeHeadPoseEstimator = new GazeHeadPoseEstimator()
      await gazeHeadPoseEstimator.initialize()
      gazeHeadPoseEstimatorRef.current = gazeHeadPoseEstimator

      const poseDetector = new PoseDetector()
      await poseDetector.initialize()
      poseDetectorRef.current = poseDetector

      const lightingAnalyzer = new LightingAnalyzer()
      await lightingAnalyzer.initialize()
      lightingAnalyzerRef.current = lightingAnalyzer

      const livenessAnalyzer = new LivenessAnalyzer()
      await livenessAnalyzer.initialize()
      livenessAnalyzerRef.current = livenessAnalyzer

      // set session id early so event logging can occur immediately
      sessionIdRef.current = `interview:${interviewId}`

      // If any detector fell back to a lightweight stub, surface degraded mode
      try {
        const degradedDetectors: string[] = []
        if (faceDetectorRef.current?.usingFallback) degradedDetectors.push('faceDetector')
        if (objectDetectorRef.current?.usingFallback) degradedDetectors.push('objectDetector')
        if (gazeHeadPoseEstimatorRef.current?.usingFallback) degradedDetectors.push('gazeHeadPoseEstimator')
        if (poseDetectorRef.current?.usingFallback) degradedDetectors.push('poseDetector')
        if (degradedDetectors.length > 0) {
          setProctoringDegraded(true)
          // Log a proctoring_degraded_mode event so the backend and audit log capture this
          // Use fetchEvent to post a minimal event immediately
          try {
            fetch('/api/proctoring/events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionIdRef.current, event_type: 'proctoring_degraded_mode', severity: 'low', timestamp: new Date().toISOString(), metadata: { detectors: degradedDetectors } }),
            }).catch(() => {})
          } catch {
            // best-effort
          }
        }
      } catch (err) {
        console.error('Failed to evaluate degraded detectors', err)
      }

      // Set up frame sampler
      const frameSampler = new FrameSampler(async (canvas) => {
        if (videoRef.current && videoRef.current.srcObject) {
          // Run face detection
          const faceResult = await faceDetectorRef.current?.detect(canvas)
          // Run object detection
          const objects = await objectDetectorRef.current?.detect(canvas)
          // Run gaze and head pose estimation
          const gazeHeadPoseResult = await gazeHeadPoseEstimatorRef.current?.detect(canvas)
          // Run pose detection
          const poseResult = await poseDetectorRef.current?.detect(canvas)
          // Run lighting analysis
          const lightingResult = await lightingAnalyzerRef.current?.analyze(videoRef.current!)
          // Run liveness analysis
          const livenessResult = await livenessAnalyzerRef.current?.analyze(videoRef.current!, gazeHeadPoseResult?.landmarks)

          // Update CV status
          const newCVStatus = {
            faceDetected: (faceResult?.faceCount ?? 0) > 0,
            faceCount: faceResult?.faceCount ?? 0,
            objects: objects?.map((obj) => obj.label) ?? []
          }
          setCVStatus(newCVStatus)
          setGazeHeadPoseStatus({
            gaze: gazeHeadPoseResult?.gaze ?? null,
            headPose: gazeHeadPoseResult?.headPose ?? null
          })
          setPoseStatus({
            poseScore: poseResult?.poseScore ?? null,
            personPresent: poseResult?.personPresent ?? null,
            shouldersVisible: poseResult?.shouldersVisible ?? null
          })

          // Process gaze and head pose for baseline learning and pattern detection
          await processGazeHeadPose(gazeHeadPoseResult, Date.now())
          // Process pose for baseline learning and pattern detection
          await processPose(poseResult, Date.now())

          let latestRisk: RiskOutput | null = null

          // Proctoring events only after personal baseline is learned
          if (isBaselineCompleteRef.current) {
            await emitCVEvents(newCVStatus)
            await emitLightingEvents(lightingResult)
            await emitLivenessEvents(livenessResult)
            latestRisk = await calculateAndSendRiskScore(
              newCVStatus,
              gazeHeadPoseResult,
              poseResult,
              lightingResult,
              livenessResult
            )
          }

          await publishLiveSessionSnapshot({
            cvStatus: newCVStatus,
            gazeHeadPoseResult,
            poseResult,
            lightingResult,
            livenessResult,
            risk: latestRisk,
          })
        }
      })
      frameSamplerRef.current = frameSampler
      if (videoRef.current) {
        frameSampler.start(videoRef.current);
      }

      setIsRecording(true)
      setElapsedSeconds(0)
      setSignals([])
      // Reset baseline and samples
      setBaselineData({
        gazeCenter: null,
        gazeRange: null,
        headPoseRange: null,
        poseScoreRange: null,
        gazeSamplesCollected: 0,
        poseSamplesCollected: 0,
        gazeBaselineReady: false,
        poseBaselineReady: false
      })
      setIsBaselineComplete(false)
      gazeSamplesRef.current = []
      headPoseSamplesRef.current = []
      poseSamplesRef.current = []
      poseSamplesRef.current = []
    } catch (err) {
      console.error('Failed to initialize detectors', err)
      alert('Failed to initialize computer vision models. Please check console.')
    }
  }

  const processGazeHeadPose = async (result: GazeHeadPoseResult | undefined, timestamp: number) => {
    if (!result) return

    const { gaze, headPose } = result
    if (!gaze || !headPose) return

    // Add to sliding window
    gazeSamplesRef.current.push({ gaze, headPose, timestamp })
    headPoseSamplesRef.current.push({ gaze, headPose, timestamp })

    // Remove samples older than PATTERN_WINDOW_SIZE seconds
    const cutoff = timestamp - PATTERN_WINDOW_SIZE * 1000
    gazeSamplesRef.current = gazeSamplesRef.current.filter(sample => sample.timestamp >= cutoff)
    headPoseSamplesRef.current = headPoseSamplesRef.current.filter(sample => sample.timestamp >= cutoff)

    // If we are still in baseline period, collect samples
    if (elapsedSeconds * 1000 < BASELINE_DURATION_MS) {
      // Just collect samples, we'll compute baseline after the period
      return
    }

    // If baseline is not yet computed, compute it now
    if (!isBaselineComplete && gazeSamplesRef.current.length >= BASELINE_SAMPLES_REQUIRED) {
      // Compute baseline from the collected samples (we'll use all samples collected so far)
      const gazeSamples = gazeSamplesRef.current.map(s => s.gaze)
      const headPoseSamples = headPoseSamplesRef.current.map(s => s.headPose)

      // Compute average gaze
      const avgGazeX = gazeSamples.reduce((sum, s) => sum + s.x, 0) / gazeSamples.length
      const avgGazeY = gazeSamples.reduce((sum, s) => sum + s.y, 0) / gazeSamples.length

      // Compute gaze range (min/max)
      const gazeXValues = gazeSamples.map(s => s.x)
      const gazeYValues = gazeSamples.map(s => s.y)
      const gazeRange = {
        xMin: Math.min(...gazeXValues),
        xMax: Math.max(...gazeXValues),
        yMin: Math.min(...gazeYValues),
        yMax: Math.max(...gazeYValues)
      }

      // Compute head pose range
      const pitchValues = headPoseSamples.map(s => s.pitch)
      const yawValues = headPoseSamples.map(s => s.yaw)
      const rollValues = headPoseSamples.map(s => s.roll)
      const headPoseRange = {
        pitchMin: Math.min(...pitchValues),
        pitchMax: Math.max(...pitchValues),
        yawMin: Math.min(...yawValues),
        yawMax: Math.max(...yawValues),
        rollMin: Math.min(...rollValues),
        rollMax: Math.max(...rollValues)
      }

      setBaselineData(prev => ({
        ...prev,
        gazeCenter: { x: avgGazeX, y: avgGazeY },
        gazeRange,
        headPoseRange,
        gazeSamplesCollected: gazeSamples.length,
        gazeBaselineReady: true
      }))

      // Send baseline to backend
      await handleEventEmission({
        type: 'baseline_learned',
        severity: 'low', // baseline is not a concern
        metadata: {
          gazeCenter: { x: avgGazeX, y: avgGazeY },
          gazeRange,
          headPoseRange,
          samplesCollected: gazeSamples.length
        }
      })
    }

    // If baseline is complete, check for patterns
    if (isBaselineCompleteRef.current && baselineData.gazeCenter && baselineData.gazeRange && baselineData.headPoseRange) {
      await checkForPattern(gaze, headPose)
    }
  }

  const checkForPattern = async (currentGaze: GazeEstimate, currentHeadPose: HeadPose) => {
    const now = Date.now()
    const canEmit = (eventType: string): boolean => {
      const lastEmit = lastEmitRef.current.get(eventType) ?? 0
      if (now - lastEmit > DEBOUNCE_MS) {
        lastEmitRef.current.set(eventType, now)
        return true
      }
      return false
    }

    const activePatterns = getActiveGazeHeadPosePatterns(currentGaze, currentHeadPose)
    const patternSeverity: Record<string, 'medium' | 'high'> = {
      repeated_off_screen_gaze: 'medium',
      long_downward_gaze: 'medium',
      frequent_side_turns: 'medium',
      looking_behind: 'high',
      gaze_deviation_from_baseline: 'medium',
    }
    for (const pattern of activePatterns) {
      if (canEmit(pattern)) {
        await handleEventEmission({
          type: pattern,
          severity: patternSeverity[pattern] ?? 'medium',
          metadata: {},
        })
      }
    }
  }

  const emitCVEvents = async (status: CVStatus) => {
    if (!sessionIdRef.current || !isBaselineCompleteRef.current) return

    const now = Date.now()
    const canEmit = (eventType: string): boolean => {
      const lastEmit = lastEmitRef.current.get(eventType) ?? 0
      if (now - lastEmit > DEBOUNCE_MS) {
        lastEmitRef.current.set(eventType, now)
        return true
      }
      return false
    }

    // Phone detected
    const phoneCount = status.objects.filter((obj: string) =>
      ['cell phone', 'phone', 'mobile phone'].includes(obj.toLowerCase())
    ).length
    if (phoneCount > 0 && canEmit('phone_detected')) {
      await handleEventEmission({
        type: 'phone_detected',
        severity: 'high',
        metadata: { count: phoneCount }
      })
    }

    // Face left frame
    if (status.faceCount === 0 && canEmit('face_left_frame')) {
      await handleEventEmission({
        type: 'face_left_frame',
        severity: 'high',
        metadata: { count: 0 }
      })
    }

    // Multiple faces
    if (status.faceCount > 1 && canEmit('multiple_faces')) {
      await handleEventEmission({
        type: 'multiple_faces',
        severity: 'high',
        metadata: { count: status.faceCount }
      })
    }

    // Extra person (more than one person)
    const personCount = status.objects.filter((obj: string) =>
      ['person'].includes(obj.toLowerCase())
    ).length
    if (personCount > 1 && canEmit('extra_person')) {
      await handleEventEmission({
        type: 'extra_person',
        severity: 'high',
        metadata: { count: personCount }
      })
    }
  }

  const fetchEvent = async (event: {
    type: string;
    severity: 'low' | 'medium' | 'high';
    metadata: Record<string, unknown>;
  }): Promise<number | null> => {
    if (!sessionIdRef.current) return null
    try {
      const response = await fetch('/api/proctoring/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          event_type: event.type,
          severity: event.severity,
          timestamp: new Date().toISOString(),
          metadata: event.metadata,
        }),
      })
      const data = await response.json()
      const eventId = data.event_id
      // Store event locally for risk engine (keep last 5 minutes)
      const eventWithTimestamp: ProctoringEvent = {
        type: event.type,
        severity: event.severity,
        metadata: event.metadata,
        timestamp: new Date().toISOString()
      }
      recentEventsRef.current = [
        ...recentEventsRef.current,
        eventWithTimestamp
      ].filter(ev => {
        const eventTime = new Date(ev.timestamp).getTime()
        const now = Date.now()
        return now - eventTime < 5 * 60 * 1000 // 5 minutes
      })
      return eventId
    } catch (err) {
      console.error('Failed to emit event', err)
      return null
    }
  }

  // Returns an array of pattern types that are currently active for gaze and head pose
  const getActiveGazeHeadPosePatterns = (currentGaze: GazeEstimate, currentHeadPose: HeadPose): string[] => {
    void currentGaze
    void currentHeadPose
    const activePatterns: string[] = []

    // Pattern 1: repeated off-screen gaze (looking away many times in the window)
    if (gazeSamplesRef.current.length >= 10) {
      const offScreenCount = gazeSamplesRef.current.filter(sample =>
        !sample.gaze.lookingAtScreen
      ).length
      const offScreenRatio = offScreenCount / gazeSamplesRef.current.length
      if (offScreenRatio > 0.6) { // more than 60% off-screen
        activePatterns.push('repeated_off_screen_gaze')
      }
    }

    // Pattern 2: long downward gaze (> 3 seconds looking down)
    // We'll check if in the last 3 seconds (3 samples) the gaze has been consistently downward
    const threeSecAgo = Date.now() - 3000
    const recentSamples = gazeSamplesRef.current.filter(sample => sample.timestamp >= threeSecAgo)
    if (recentSamples.length >= 3) {
      const downwardSamples = recentSamples.filter(sample =>
        sample.gaze.y > 0.5 // looking down (positive y is down in our coordinate system?)
      )
      if (downwardSamples.length === recentSamples.length) {
        activePatterns.push('long_downward_gaze')
      }
    }

    // Pattern 3: frequent side turns (high yaw variation)
    if (headPoseSamplesRef.current.length >= 10) {
      const yawValues = headPoseSamplesRef.current.map(sample => sample.headPose.yaw)
      const yawRange = Math.max(...yawValues) - Math.min(...yawValues)
      if (yawRange > 30) { // yaw variation more than 30 degrees
        activePatterns.push('frequent_side_turns')
      }
    }

    // Pattern 4: looking behind (extreme yaw)
    if (headPoseSamplesRef.current.length >= 5) {
      const recentYaw = headPoseSamplesRef.current.slice(-5).map(sample => sample.headPose.yaw)
      const avgYaw = recentYaw.reduce((sum, val) => sum + val, 0) / recentYaw.length
      if (Math.abs(avgYaw) > 40) { // looking more than 40 degrees to side
        activePatterns.push('looking_behind')
      }
    }

    // Pattern 5: gaze deviation from baseline (if gaze is consistently outside baseline range)
    if (gazeSamplesRef.current.length >= 10 && isBaselineCompleteRef.current && baselineData.gazeCenter && baselineData.gazeRange) {
      const gazeOutsideCount = gazeSamplesRef.current.filter(sample =>
        sample.gaze.x < baselineData.gazeRange!.xMin ||
        sample.gaze.x > baselineData.gazeRange!.xMax ||
        sample.gaze.y < baselineData.gazeRange!.yMin ||
        sample.gaze.y > baselineData.gazeRange!.yMax
      ).length
      const outsideRatio = gazeOutsideCount / gazeSamplesRef.current.length
      if (outsideRatio > 0.5) {
        activePatterns.push('gaze_deviation_from_baseline')
      }
    }

    return activePatterns
  }

  // Returns an array of pattern types that are currently active for pose
  const getActivePosePatterns = (currentPoseScore: number, currentPersonPresent: boolean, currentShouldersVisible: boolean): string[] => {
    void currentPoseScore
    void currentPersonPresent
    void currentShouldersVisible
    const activePatterns: string[] = []

    // Pattern 1: person absent from frame (no person detected for extended period)
    // Check if in the last 3 seconds (3 samples) no person has been detected
    const threeSecAgo = Date.now() - 3000
    const recentPoseSamples = poseSamplesRef.current.filter(sample => sample.timestamp >= threeSecAgo)
    if (recentPoseSamples.length >= 3) {
      const personAbsentCount = recentPoseSamples.filter(sample => !sample.personPresent).length
      const personAbsentRatio = personAbsentCount / recentPoseSamples.length
      if (personAbsentRatio > 0.8) { // more than 80% of samples show no person
        activePatterns.push('person_absent_from_frame')
      }
    }

    // Pattern 2: slouching posture (consistently low pose score indicating poor posture)
    if (poseSamplesRef.current.length >= 10) {
      const recentPoseScores = poseSamplesRef.current.slice(-10).map(sample => sample.poseScore)
      const avgRecentPoseScore = recentPoseScores.reduce((sum, s) => sum + s, 0) / recentPoseScores.length
      // If recent pose score is significantly below baseline minimum, it's slouching
      if (baselineData.poseScoreRange && avgRecentPoseScore < baselineData.poseScoreRange.min - 20) {
        activePatterns.push('slouching_posture')
      }
    }

    // Pattern 3: leaning to one side (asymmetric shoulder visibility or pose)
    // We'll detect this by checking if shoulders are inconsistent in visibility over time
    if (poseSamplesRef.current.length >= 10) {
      const recentShouldersVisible = poseSamplesRef.current.slice(-10).map(sample => sample.shouldersVisible)
      const shouldersVisibleCount = recentShouldersVisible.filter(visible => visible).length
      const shouldersVisibleRatio = shouldersVisibleCount / recentShouldersVisible.length
      // If shoulders are inconsistently visible (some visible, some not), it might indicate leaning
      if (shouldersVisibleRatio > 0.2 && shouldersVisibleRatio < 0.8) { // 20-80% visibility suggests inconsistency
        activePatterns.push('leaning_posture')
      }
    }

    // Pattern 4: shoulders not visible (person turned away or left frame)
    if (poseSamplesRef.current.length >= 5) {
      const recentShouldersVisible = poseSamplesRef.current.slice(-5).map(sample => sample.shouldersVisible)
      const allShouldersNotVisible = recentShouldersVisible.every(visible => !visible)
      if (allShouldersNotVisible) {
        activePatterns.push('shoulders_not_visible')
      }
    }

    return activePatterns
  }

  const processPose = async (result: PoseResult | undefined, timestamp: number) => {
    if (!result) return

    const { poseScore, personPresent, shouldersVisible } = result
    if (poseScore === null || personPresent === null || shouldersVisible === null) return

    // Add to sliding window
    poseSamplesRef.current.push({ poseScore, personPresent, shouldersVisible, timestamp })

    // Remove samples older than PATTERN_WINDOW_SIZE seconds
    const cutoff = timestamp - PATTERN_WINDOW_SIZE * 1000
    poseSamplesRef.current = poseSamplesRef.current.filter(sample => sample.timestamp >= cutoff)

    // If we are still in baseline period, collect samples
    if (elapsedSeconds * 1000 < BASELINE_DURATION_MS) {
      // Just collect samples, we'll compute baseline after the period
      return
    }

    // If baseline is not yet computed, compute it now
    if (!isBaselineComplete && poseSamplesRef.current.length >= BASELINE_SAMPLES_REQUIRED) {
      // Compute baseline from the collected samples (we'll use all samples collected so far)
      const poseScores = poseSamplesRef.current.map(s => s.poseScore)

      // Compute pose score range (min/max)
      const poseScoreRange = {
        min: Math.min(...poseScores),
        max: Math.max(...poseScores)
      }

      setBaselineData(prev => ({
        ...prev,
        poseScoreRange,
        poseSamplesCollected: poseScores.length,
        poseBaselineReady: true
      }))

      // Send baseline to backend
      await handleEventEmission({
        type: 'baseline_learned',
        severity: 'low', // baseline is not a concern
        metadata: {
          poseScoreRange,
          samplesCollected: poseScores.length
        }
      })
    }

    // If baseline is complete, check for patterns
    if (isBaselineCompleteRef.current && baselineData.poseScoreRange) {
      await checkForPosePattern(poseScore, personPresent, shouldersVisible)
    }
  }

  const checkForPosePattern = async (currentPoseScore: number, currentPersonPresent: boolean, currentShouldersVisible: boolean) => {
    const now = Date.now()
    const canEmit = (eventType: string): boolean => {
      const lastEmit = lastEmitRef.current.get(eventType) ?? 0
      if (now - lastEmit > DEBOUNCE_MS) {
        lastEmitRef.current.set(eventType, now)
        return true
      }
      return false
    }

    const activePatterns = getActivePosePatterns(currentPoseScore, currentPersonPresent, currentShouldersVisible)
    for (const pattern of activePatterns) {
      if (canEmit(pattern)) {
        const highSeverityPatterns = new Set([
          'person_absent_from_frame',
          'shoulders_not_visible',
        ])
        await handleEventEmission({
          type: pattern,
          severity: highSeverityPatterns.has(pattern) ? 'high' : 'medium',
          metadata: {},
        })
      }
    }
  }

  // Calculate risk score from current detections and recent events, then send to backend
  const calculateAndSendRiskScore = async (
    cvStatus: CVStatus,
    gazeHeadPoseResult: GazeHeadPoseResult | undefined,
    poseResult: PoseResult | undefined,
    lightingResult?: {
      brightness: number;
      contrast: number;
      uniformity: number;
      darkLighting: boolean;
      goodLighting: boolean;
    },
    livenessResult?: {
      eyeAspectRatio: number;
      blinkRate: number;
      headMovementScore: number;
      textureAnalysisScore: number;
      spoofSuspected: boolean;
      livenessScore: number;
    }
  ): Promise<RiskOutput | null> => {
    if (!sessionIdRef.current) return null

    // Build current signals from latest detections
    const currentSignals = {
      // From object detection
      phoneDetected: !!cvStatus.objects.find(obj =>
        ['cell phone', 'phone', 'mobile phone'].includes(obj.toLowerCase())
      ),
      multipleFaces: cvStatus.faceCount > 1,
      faceLeftFrame: cvStatus.faceCount === 0,
      // From gaze and head pose patterns (we'll use the active patterns helpers)
      repeatedOffScreenGaze: getActiveGazeHeadPosePatterns(
        gazeHeadPoseResult?.gaze ?? { x: 0, y: 0, lookingAtScreen: false },
        gazeHeadPoseResult?.headPose ?? { pitch: 0, yaw: 0, roll: 0 }
      ).includes('repeated_off_screen_gaze'),
      longDownwardGaze: getActiveGazeHeadPosePatterns(
        gazeHeadPoseResult?.gaze ?? { x: 0, y: 0, lookingAtScreen: false },
        gazeHeadPoseResult?.headPose ?? { pitch: 0, yaw: 0, roll: 0 }
      ).includes('long_downward_gaze'),
      // Person absent and pose patterns from pose detection
      personAbsent: getActivePosePatterns(
        poseResult?.poseScore ?? 0,
        poseResult?.personPresent ?? false,
        poseResult?.shouldersVisible ?? false
      ).includes('person_absent_from_frame'),
      slouching: getActivePosePatterns(
        poseResult?.poseScore ?? 0,
        poseResult?.personPresent ?? false,
        poseResult?.shouldersVisible ?? false
      ).includes('slouching_posture'),
      leaning: getActivePosePatterns(
        poseResult?.poseScore ?? 0,
        poseResult?.personPresent ?? false,
        poseResult?.shouldersVisible ?? false
      ).includes('leaning_posture'),
      // Lighting: now integrated with real analysis from lighting analyzer
      darkLighting: lightingResult?.darkLighting ?? false,
      // Tab switch: set from the ref so the risk engine sees it immediately
      tabSwitched: tabSwitchActiveRef.current,
      // Negative signals (reduce risk when good)
      continuousFaceVisible: cvStatus.faceCount > 0,
      goodLighting: lightingResult?.goodLighting ?? false,
      spoofSuspected: livenessResult?.spoofSuspected ?? false
    };

    // Calculate risk score
    const risk = calculateRiskScore({
      events: recentEventsRef.current,
      currentSignals
    });

    // Keep history of risk scores (last 20)
    riskScoresRef.current = [
      ...riskScoresRef.current,
      risk
    ].slice(-20);

    // Send risk score to backend
    try {
      await fetch('/api/proctoring/risk-score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          score: risk.score,
          level: risk.level,
          breakdown: risk.breakdown,
          evidenceCount: risk.evidenceCount,
          timestamp: risk.timestamp
        }),
      })
    } catch (err) {
      console.error('Failed to send risk score', err)
    }

    return risk
  }

  const endInterview = () => {
    stopListening()
    if (typeof window !== 'undefined') {
      window.speechSynthesis?.cancel()
    }
    setIsRecording(false)
    // Cleanup
    if (frameSamplerRef.current) {
      frameSamplerRef.current.stop()
      frameSamplerRef.current = null
    }
    if (faceDetectorRef.current) {
      faceDetectorRef.current.release()
      faceDetectorRef.current = null
    }
    if (objectDetectorRef.current) {
      objectDetectorRef.current.release()
      objectDetectorRef.current = null
    }
    if (gazeHeadPoseEstimatorRef.current) {
      gazeHeadPoseEstimatorRef.current.release()
      gazeHeadPoseEstimatorRef.current = null
    }
    if (poseDetectorRef.current) {
      poseDetectorRef.current.release()
      poseDetectorRef.current = null
    }
    if (lightingAnalyzerRef.current) {
      lightingAnalyzerRef.current.release()
      lightingAnalyzerRef.current = null
    }
    if (livenessAnalyzerRef.current) {
      livenessAnalyzerRef.current.release()
      livenessAnalyzerRef.current = null
    }
    // Stop video stream
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach(track => track.stop())
    }
    onComplete()
  }

  const finishInterviewEarly = async () => {
    await completeInterview(Number(interviewId), answers)
    endInterview()
  }

  const emitLightingEvents = async (lightingResult: {
    brightness: number
    contrast: number
    uniformity: number
    darkLighting: boolean
    goodLighting: boolean
  } | undefined) => {
    if (!sessionIdRef.current || !lightingResult || !isBaselineCompleteRef.current) return

    const now = Date.now()
    const canEmit = (eventType: string): boolean => {
      const lastEmit = lastEmitRef.current.get(eventType) ?? 0
      if (now - lastEmit > DEBOUNCE_MS) {
        lastEmitRef.current.set(eventType, now)
        return true
      }
      return false
    }

    if (lightingResult.darkLighting && canEmit('dark_lighting_detected')) {
      await handleEventEmission({
        type: 'dark_lighting_detected',
        severity: 'high',
        metadata: {
          brightness: lightingResult.brightness,
          contrast: lightingResult.contrast,
          uniformity: lightingResult.uniformity
        }
      })
    }

    const prevLighting = prevLightingRef.current
    if (prevLighting) {
      const brightnessChange = Math.abs(lightingResult.brightness - prevLighting.brightness) / (prevLighting.brightness + 0.001)
      const contrastChange = Math.abs(lightingResult.contrast - prevLighting.contrast) / (prevLighting.contrast + 0.001)
      if ((brightnessChange > 0.3 || contrastChange > 0.5) && canEmit('lighting_change_detected')) {
        await handleEventEmission({
          type: 'lighting_change_detected',
          severity: 'medium',
          metadata: {
            brightness: lightingResult.brightness,
            brightnessChange,
            contrast: lightingResult.contrast,
            contrastChange,
            previousBrightness: prevLighting.brightness,
            previousContrast: prevLighting.contrast
          }
        })
      }
    }

    prevLightingRef.current = {
      brightness: lightingResult.brightness,
      contrast: lightingResult.contrast,
      timestamp: now
    }
  }

  // Emit liveness events when spoofing is detected or liveness fails
  const emitLivenessEvents = async (livenessResult: {
    eyeAspectRatio: number
    blinkRate: number
    headMovementScore: number
    textureAnalysisScore: number
    spoofSuspected: boolean
    livenessScore: number
  } | undefined) => {
    if (!sessionIdRef.current || !livenessResult || !isBaselineCompleteRef.current) return

    const now = Date.now()
    const canEmit = (eventType: string): boolean => {
      const lastEmit = lastEmitRef.current.get(eventType) ?? 0
      if (now - lastEmit > DEBOUNCE_MS) {
        lastEmitRef.current.set(eventType, now)
        return true
      }
      return false
    }

    if (livenessResult.spoofSuspected && canEmit('spoof_suspected')) {
      await handleEventEmission({
        type: 'spoof_suspected',
        severity: 'high',
        metadata: {
          eyeAspectRatio: livenessResult.eyeAspectRatio,
          blinkRate: livenessResult.blinkRate,
          headMovementScore: livenessResult.headMovementScore,
          textureAnalysisScore: livenessResult.textureAnalysisScore,
          livenessScore: livenessResult.livenessScore
        }
      })
    }

    if (livenessResult.livenessScore < 0.3 && canEmit('liveness_failed')) {
      await handleEventEmission({
        type: 'liveness_failed',
        severity: 'high',
        metadata: {
          eyeAspectRatio: livenessResult.eyeAspectRatio,
          blinkRate: livenessResult.blinkRate,
          headMovementScore: livenessResult.headMovementScore,
          textureAnalysisScore: livenessResult.textureAnalysisScore,
          livenessScore: livenessResult.livenessScore
        }
      })
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const avgSignalValue = signals.length > 0 ? signals.reduce((sum, s) => sum + s.value, 0) / signals.length : 0

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{candidateName} - {jobTitle}</CardTitle>
          <CardDescription>Live interview room</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Video Area */}
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-border bg-black">
            {isVideoOff ? (
              <div className="flex h-full items-center justify-center bg-neutral-900">
                <div className="text-center">
                  <VideoOff className="mx-auto mb-2 size-12 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Video is off</p>
                </div>
              </div>
            ) : videoElement ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
                <p className="text-white">Video stream ready</p>
              </div>
            )}

            {/* Connection Status */}
            <div className="absolute right-2 top-2 flex items-center gap-2 rounded-full bg-black/80 px-3 py-1 text-xs text-green-400">
              <div className="size-2 animate-pulse rounded-full bg-green-400" />
              Connected
            </div>

            {proctoringDegraded && (
              <div className="absolute left-2 top-12 flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                <AlertTriangle className="size-4 text-yellow-800" />
                <div>
                  <div className="font-medium">Proctoring is running in reduced mode due to a network issue — some checks may be limited.</div>
                </div>
              </div>
            )}

            {tabSwitchWarning && (
              <div className="absolute inset-x-2 top-20 flex items-center gap-2 rounded-lg border-2 border-orange-400 bg-orange-50 px-3 py-3 text-sm text-orange-900 shadow-lg">
                <AlertTriangle className="size-5 flex-shrink-0 text-orange-600" />
                <div>
                  <div className="font-semibold">Please stay on this tab during your interview.</div>
                  <div className="text-xs mt-0.5">Switching tabs or windows has been detected and logged.</div>
                </div>
              </div>
            )}

            {/* Recording Indicator */}
            {isRecording && (
              <div className="absolute left-2 top-2 flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white">
                <div className="size-2 animate-pulse rounded-full bg-white" />
                Recording
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4">
            {!isRecording ? (
              <Button size="lg" onClick={startInterview} className="w-full">
                Start Interview
              </Button>
            ) : (
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg border border-border bg-muted p-4">
                  <p className="text-sm font-medium">Elapsed Time</p>
                  <p className="mt-2 font-mono text-2xl font-bold">{formatTime(elapsedSeconds)}</p>
                </div>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setIsMuted(!isMuted)}
                  className="flex-1"
                >
                  {isMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setIsVideoOff(!isVideoOff)}
                  className="flex-1"
                >
                  {isVideoOff ? <VideoOff className="size-4" /> : <Video className="size-4" />}
                </Button>
                <Button size="lg" variant="destructive" onClick={finishInterviewEarly} className="flex-1">
                  <PhoneOff className="size-4" />
                  End
                </Button>
              </div>
            )}
          </div>

          {isRecording && (
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {isFollowUp
                    ? 'Follow-up question'
                    : `Question ${Math.min(baseIndex + 1, activeQuestions.length)} of ${activeQuestions.length}`}
                </p>
                <p className="mt-1 text-base font-medium">{displayQuestion || activeQuestions[baseIndex]}</p>
                {isThinking && (
                  <p className="mt-2 text-sm text-muted-foreground animate-pulse">Thinking…</p>
                )}
              </div>

              {!speechSupported ? (
                <p className="text-sm text-destructive">
                  Voice input is not supported in this browser. Please use Chrome or Edge.
                </p>
              ) : micDenied ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm text-destructive">
                    Microphone access is required. Enable your mic in browser settings and refresh — text answers are not accepted.
                  </p>
                </div>
              ) : (
                <>
                  <div className="min-h-28 w-full rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
                    {displayTranscript || (
                      <span className="text-muted-foreground">
                        {isListening ? 'Listening… speak your answer.' : 'Tap the mic to start speaking.'}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant={isListening ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => (isListening ? stopListening() : startListening())}
                        disabled={isSubmittingAnswer || isThinking}
                      >
                        {isListening ? <Mic className="size-4" /> : <MicOff className="size-4" />}
                        {isListening ? 'Stop' : 'Speak'}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {answers.length} answer{answers.length === 1 ? '' : 's'} saved
                      </p>
                    </div>
                    <Button
                      onClick={submitVoiceAnswer}
                      disabled={isSubmittingAnswer || isThinking || !transcript.trim()}
                    >
                      {isThinking ? 'Thinking…' : 'Submit Answer'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Computer Vision Status */}
          {isRecording && DEBUG_CV && (
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Eye className="size-4" />
                <p className="text-sm font-medium">Computer Vision Status</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-border bg-background p-2">
                  <p className="text-xs font-medium text-muted-foreground">Face Detected</p>
                  <p className="mt-1 text-foreground font-bold">
                    {cvStatus.faceDetected ? `Yes (${cvStatus.faceCount})` : 'No'}
                  </p>
                </div>
                <div className="rounded border border-border bg-background p-2">
                  <p className="text-xs font-medium text-muted-foreground">Objects Detected</p>
                  <p className="mt-1 text-foreground text-xs">
                    {cvStatus.objects.length > 0 ? cvStatus.objects.join(', ') : 'None'}
                  </p>
                </div>
              </div>
              {cvStatus.objects.some((obj: string) =>
                ['cell phone', 'phone', 'mobile phone'].includes(obj.toLowerCase())
              ) && (
                <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                  <AlertTriangle className="size-4 flex-shrink-0 text-red-700" />
                  <p className="text-xs text-red-700">
                    Potential phone detected! Please ensure no unauthorized devices are present.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Gaze and Head Pose Status */}
          {isRecording && DEBUG_CV && (
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Eye className="size-4" />
                <p className="text-sm font-medium">Gaze & Head Pose</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-border bg-background p-2">
                  <p className="text-xs font-medium text-muted-foreground">Gaze</p>
                  {gazeHeadPoseStatus.gaze ? (
                    <>
                      <p className="mt-1 text-foreground text-xs">
                        X: {gazeHeadPoseStatus.gaze.x.toFixed(2)}, Y: {gazeHeadPoseStatus.gaze.y.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {gazeHeadPoseStatus.gaze.lookingAtScreen ? 'Looking at screen' : 'Looking away'}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No gaze data</p>
                  )}
                </div>
                <div className="rounded border border-border bg-background p-2">
                  <p className="text-xs font-medium text-muted-foreground">Head Pose</p>
                  {gazeHeadPoseStatus.headPose ? (
                    <>
                      <p className="mt-1 text-foreground text-xs">
                        Pitch: {gazeHeadPoseStatus.headPose.pitch.toFixed(1)}°,
                        Yaw: {gazeHeadPoseStatus.headPose.yaw.toFixed(1)}°,
                        Roll: {gazeHeadPoseStatus.headPose.roll.toFixed(1)}°
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No head pose data</p>
                  )}
                </div>
              </div>
              {isBaselineComplete && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Baseline learned ({baselineData.gazeSamplesCollected} samples)
                </div>
              )}
              {!isBaselineComplete && elapsedSeconds * 1000 >= BASELINE_DURATION_MS && (
                <div className="mt-2 text-xs text-warning">
                  Collecting baseline... ({gazeSamplesRef.current.length} samples)
                </div>
              )}
            </div>
          )}

          {/* Pose Status */}
          {isRecording && DEBUG_CV && (
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Smile className="size-4" />
                <p className="text-sm font-medium">Posture & Presence</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-border bg-background p-2">
                  <p className="text-xs font-medium text-muted-foreground">Pose Score</p>
                  {poseStatus.poseScore !== null ? (
                    <>
                      <p className="mt-1 text-foreground text-xs">
                        {poseStatus.poseScore}/100
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {poseStatus.poseScore >= 80 ? 'Good' : poseStatus.poseScore >= 60 ? 'Fair' : 'Needs Improvement'}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No pose data</p>
                  )}
                </div>
                <div className="rounded border border-border bg-background p-2">
                  <p className="text-xs font-medium text-muted-foreground">Person Present</p>
                  {poseStatus.personPresent !== null ? (
                    <p className="mt-1 text-foreground text-xs">
                      {poseStatus.personPresent ? 'Yes' : 'No'}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No presence data</p>
                  )}
                </div>
                <div className="rounded border border-border bg-background p-2">
                  <p className="text-xs font-medium text-muted-foreground">Shoulders Visible</p>
                  {poseStatus.shouldersVisible !== null ? (
                    <p className="mt-1 text-foreground text-xs">
                      {poseStatus.shouldersVisible ? 'Yes' : 'No'}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No shoulder data</p>
                  )}
                </div>
              </div>
              {isBaselineComplete && baselineData.poseScoreRange && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Baseline learned ({baselineData.poseSamplesCollected} samples)
                </div>
              )}
              {!isBaselineComplete && elapsedSeconds * 1000 >= BASELINE_DURATION_MS && (
                <div className="mt-2 text-xs text-warning">
                  Collecting baseline... ({poseSamplesRef.current.length} samples)
                </div>
              )}
            </div>
          )}

          {/* Behavioral Signals */}
          {isRecording && DEBUG_CV && signals.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Eye className="size-4" />
                <p className="text-sm font-medium">Behavioral Signals</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {signals.slice(-4).map((signal, idx) => (
                  <div key={idx} className="rounded border border-border bg-background p-2">
                    <p className="text-xs font-medium text-muted-foreground">{signal.label}</p>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${signal.value}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-foreground">{signal.value.toFixed(0)}%</p>
                  </div>
                ))}
              </div>
              {avgSignalValue < 40 && (
                <div className="mt-3 flex gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                  <AlertTriangle className="size-4 flex-shrink-0 text-yellow-700" />
                  <p className="text-xs text-yellow-700">
                    Low engagement signals detected. Consider redirecting conversation.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
