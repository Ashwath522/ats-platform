export interface PoseResult {
  poseScore: number; // 0-100, higher is better
  personPresent: boolean;
  shouldersVisible: boolean;
}

type PoseLandmarkerRuntime = {
  detect: (frame: HTMLVideoElement | HTMLCanvasElement) => { landmarks?: Array<Array<{ visibility?: number }>> }
  close: () => void
}

export class PoseDetector {
  public usingFallback: boolean = false;
  private initialized: boolean = false;
  private poseLandmarker: PoseLandmarkerRuntime | null = null;

  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      // @ts-expect-error - MediaPipe is loaded dynamically from a CDN and the package exposes no local TS declarations.
      const vision = await import(/* turbopackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/+esm");
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
      );
      this.poseLandmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU"
        },
        runningMode: "IMAGE",
        numPoses: 1
      });
      this.initialized = true;
      console.log('PoseDetector (MediaPipe PoseLandmarker) initialized successfully');
    } catch (error) {
      console.error('Failed to initialize MediaPipe PoseLandmarker:', error);
      // Fallback enabled so it does not block interview room
      this.usingFallback = true
      this.initialized = true;
    }
  }

  async detect(frame: HTMLVideoElement | HTMLCanvasElement): Promise<PoseResult> {
    if (!this.initialized) {
      return { poseScore: 0, personPresent: false, shouldersVisible: false };
    }
    if (!this.poseLandmarker) {
      // Fallback stub: return simulated values
      if (process.env.NODE_ENV !== 'production') {
        console.debug('PoseDetector using fallback stub (model not loaded)')
      }
      const personPresent = Math.random() > 0.02;
      const shouldersVisible = personPresent && (Math.random() > 0.1);
      const poseScore = personPresent ? (shouldersVisible ? 85 : 55) : 0;
      return { poseScore, personPresent, shouldersVisible };
    }
    try {
      const result = this.poseLandmarker.detect(frame);
      if (!result.landmarks || result.landmarks.length === 0) {
        return { poseScore: 0, personPresent: false, shouldersVisible: false };
      }

      const landmarks = result.landmarks[0];
      // Left shoulder is index 11, Right shoulder is index 12
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];

      const personPresent = true;
      const threshold = 0.5;

      const leftShoulderVisible = leftShoulder && (leftShoulder.visibility === undefined || leftShoulder.visibility > threshold);
      const rightShoulderVisible = rightShoulder && (rightShoulder.visibility === undefined || rightShoulder.visibility > threshold);
      const shouldersVisible = !!(leftShoulderVisible && rightShoulderVisible);

      // Score base calculation
      let poseScore = 50; // Base score for presence
      if (shouldersVisible) {
        poseScore += 30;
      }

      // Nose is index 0
      const nose = landmarks[0];
      const noseVisible = nose && (nose.visibility === undefined || nose.visibility > threshold);
      if (noseVisible) {
        poseScore += 20;
      } else {
        poseScore += 10;
      }

      return {
        poseScore: Math.min(100, poseScore),
        personPresent,
        shouldersVisible
      };
    } catch (err) {
      console.error('Error during pose detection:', err);
      // Safe fallback values
      return { poseScore: 80, personPresent: true, shouldersVisible: true };
    }
  }

  release(): void {
    try {
      if (this.poseLandmarker) {
        this.poseLandmarker.close();
        this.poseLandmarker = null;
      }
    } catch (err) {
      console.error('Error closing pose landmarker:', err);
    }
    this.initialized = false;
    console.log('PoseDetector released');
  }
}
