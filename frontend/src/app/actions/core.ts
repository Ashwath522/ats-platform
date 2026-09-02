import { generateAiQuestions } from '@/lib/interview-questions'
import { decideNextInterviewStep, DecideNextStepParams } from '@/lib/llm/interviewer'

export async function getInterviewQuestions(jobTitle: string, jobDescription: string = '') {
  const questions = generateAiQuestions(jobTitle, jobDescription)
  return questions.map((q) => q.question)
}

export async function getNextInterviewStep(params: DecideNextStepParams) {
  return decideNextInterviewStep(params)
}

export async function completeInterview(
  interviewId: string,
  data: {
    riskScore: number
    riskLevel: string
    evalScore: number
    recommendation: string
    transcript: { question: string; answer: string }[]
    evidenceUrl?: string
  }
) {
  try {
    const res = await fetch(`/api/candidate/applications/${interviewId}/submit_interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        risk_score: data.riskScore,
        risk_level: data.riskLevel,
        eval_score: data.evalScore,
        recommendation: data.recommendation,
        transcript: data.transcript,
        evidence_url: data.evidenceUrl || `/api/proctoring/media/${interviewId}/clip.webm`,
      }),
    })
    return { success: res.ok }
  } catch (err: any) {
    console.error('Failed to complete interview via API:', err)
    return { success: false, error: err.message }
  }
}
