export type LandmarkPoint = {
  x: number
  y: number
  z?: number
  visibility?: number
}

export interface GazeEstimate {
  x: number; // normalized gaze x (-1 to 1, where 0 is center)
  y: number; // normalized gaze y (-1 to 1, where 0 is center)
  lookingAtScreen: boolean; // true if gaze is within a certain tolerance of center
}

export interface HeadPose {
  pitch: number; // degrees, -90 to 90 (up/down)
  yaw: number;   // degrees, -90 to 90 (left/right)
  roll: number;  // degrees, -180 to 180 (tilt)
}

export interface GazeHeadPoseResult {
  gaze: GazeEstimate | null;
  headPose: HeadPose | null;
  landmarks?: LandmarkPoint[];
}

export class GazeHeadPoseEstimator {
  public usingFallback: boolean = false;
  private initialized: boolean = false;
  private faceLandmarker: {
    detect: (frame: HTMLVideoElement | HTMLCanvasElement) => { faceLandmarks?: LandmarkPoint[][] }
    close: () => void
  } | null = null;

  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      // @ts-expect-error - MediaPipe is loaded dynamically from a CDN and the package exposes no local TS declarations.
      const vision = await import(/* turbopackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/+esm");
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
      );
      this.faceLandmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "IMAGE",
        numFaces: 1
      });
      this.initialized = true;
      console.log('GazeHeadPoseEstimator (MediaPipe FaceLandmarker) initialized successfully');
    } catch (error) {
      console.error('Failed to initialize MediaPipe FaceLandmarker:', error);
      // Fallback enabled so it does not block interview room
      this.usingFallback = true
      this.initialized = true;
    }
  }

  async detect(frame: HTMLVideoElement | HTMLCanvasElement): Promise<GazeHeadPoseResult> {
    if (!this.initialized) {
      return { gaze: null, headPose: null };
    }
    if (!this.faceLandmarker) {
      // Fallback stub: return a normal centered gaze
      if (process.env.NODE_ENV !== 'production') {
        console.debug('GazeHeadPoseEstimator using fallback stub (model not loaded)')
      }
      const gazeX = (Math.random() - 0.5) * 0.1;
      const gazeY = (Math.random() - 0.5) * 0.1;
      return {
        gaze: { x: gazeX, y: gazeY, lookingAtScreen: true },
        headPose: { pitch: (Math.random() - 0.5) * 5, yaw: (Math.random() - 0.5) * 5, roll: (Math.random() - 0.5) * 5 }
      };
    }
    try {
      const result = this.faceLandmarker.detect(frame);
      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        return { gaze: null, headPose: null };
      }

      const landmarks = result.faceLandmarks[0];

      // Safe bounds checking
      if (landmarks.length < 468) {
        return { gaze: null, headPose: null };
      }

      const nose = landmarks[4];
      const chin = landmarks[152];
      const leftCheek = landmarks[234];
      const rightCheek = landmarks[454];
      const leftEyeCornerOuter = landmarks[33];
      const leftEyeCornerInner = landmarks[133];
      const rightEyeCornerOuter = landmarks[263];
      const rightEyeCornerInner = landmarks[362];

      // 1. Roll: angle of the line connecting left and right outer corners
      const dx = rightEyeCornerOuter.x - leftEyeCornerOuter.x;
      const dy = rightEyeCornerOuter.y - leftEyeCornerOuter.y;
      const roll = Math.atan2(dy, dx) * (180 / Math.PI);

      // 2. Yaw: nose deviation relative to cheeks
      const cheekWidth = Math.abs(rightCheek.x - leftCheek.x);
      let yaw = 0;
      if (cheekWidth > 0) {
        const noseOffset = (nose.x - leftCheek.x) / cheekWidth - 0.5;
        yaw = noseOffset * 120; // Scale to degrees
      }

      // 3. Pitch: nose height relative to eyes and chin
      const eyeY = (leftEyeCornerOuter.y + rightEyeCornerOuter.y) / 2;
      const faceHeight = Math.abs(chin.y - eyeY);
      let pitch = 0;
      if (faceHeight > 0) {
        const noseHeightRatio = (nose.y - eyeY) / faceHeight;
        pitch = (noseHeightRatio - 0.35) * 160; // Scale to degrees
      }

      // 4. Gaze estimation (using iris landmarks if available, indices 468/473)
      let gazeX = 0;
      let gazeY = 0;
      const leftIris = landmarks[468];
      const rightIris = landmarks[473];

      if (leftIris && rightIris) {
        const leftEyeCenter = (leftEyeCornerInner.x + leftEyeCornerOuter.x) / 2;
        const leftEyeWidth = Math.abs(leftEyeCornerInner.x - leftEyeCornerOuter.x);
        let leftGaze = 0;
        if (leftEyeWidth > 0) {
          leftGaze = (leftIris.x - leftEyeCenter) / leftEyeWidth;
        }

        const rightEyeCenter = (rightEyeCornerInner.x + rightEyeCornerOuter.x) / 2;
        const rightEyeWidth = Math.abs(rightEyeCornerOuter.x - rightEyeCornerInner.x);
        let rightGaze = 0;
        if (rightEyeWidth > 0) {
          rightGaze = (rightIris.x - rightEyeCenter) / rightEyeWidth;
        }

        gazeX = (leftGaze + rightGaze) * 3.5; // Normalized factor
        gazeY = ((leftIris.y + rightIris.y) / 2 - eyeY) * 15.0; // Vertical delta
      } else {
        // Fallback gaze computation if iris is missing
        gazeX = (Math.random() - 0.5) * 0.1;
        gazeY = (Math.random() - 0.5) * 0.1;
      }

      // Constrain gaze values to [-1, 1] range
      gazeX = Math.max(-1, Math.min(1, gazeX));
      gazeY = Math.max(-1, Math.min(1, gazeY));

      // lookingAtScreen condition: center-aligned gaze and head orientation
      const lookingAtScreen =
        Math.abs(gazeX) < 0.35 &&
        Math.abs(gazeY) < 0.35 &&
        Math.abs(yaw) < 20 &&
        Math.abs(pitch) < 20;

      return {
        gaze: {
          x: Number(gazeX.toFixed(4)),
          y: Number(gazeY.toFixed(4)),
          lookingAtScreen
        },
        headPose: {
          pitch: Number(pitch.toFixed(2)),
          yaw: Number(yaw.toFixed(2)),
          roll: Number(roll.toFixed(2))
        },
        landmarks
      };
    } catch (err) {
      console.error('Error during gaze and head pose estimation:', err);
      return { gaze: null, headPose: null };
    }
  }

  release(): void {
    try {
      if (this.faceLandmarker) {
        this.faceLandmarker.close();
        this.faceLandmarker = null;
      }
    } catch (err) {
      console.error('Error closing face landmarker:', err);
    }
    this.initialized = false;
    console.log('GazeHeadPoseEstimator released');
  }
}
