type FaceDetectorRuntime = {
  detect: (frame: HTMLVideoElement | HTMLCanvasElement) => {
    detections?: Array<{ categories?: Array<{ categoryName?: string; score?: number }> }>
  }
  close: () => void
}

export class FaceDetector {
  public usingFallback: boolean = false;
  private initialized: boolean = false;
  private faceDetector: FaceDetectorRuntime | null = null;

  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      // @ts-expect-error - MediaPipe is loaded dynamically from a CDN and the package exposes no local TS declarations.
      const vision = await import(/* turbopackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/+esm");
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
      );
      this.faceDetector = await vision.FaceDetector.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
          delegate: "GPU"
        },
        runningMode: "IMAGE"
      });
      this.initialized = true;
      console.log('FaceDetector (MediaPipe BlazeFace) initialized successfully');
    } catch (error) {
      console.error('Failed to initialize MediaPipe FaceDetector:', error);
      // Fallback enabled so it does not block interview room
      this.usingFallback = true
      this.initialized = true;
    }
  }

  async detect(frame: HTMLVideoElement | HTMLCanvasElement): Promise<{
    faceCount: number;
    faceDetected: boolean;
  }> {
    if (!this.initialized) {
      return { faceCount: 0, faceDetected: false };
    }
    if (!this.faceDetector) {
      // Fallback stub behavior if loading/initialization failed
      if (process.env.NODE_ENV !== 'production') {
        console.debug('FaceDetector using fallback stub (model not loaded)')
      }
      return { faceCount: 1, faceDetected: true };
    }
    try {
      const result = this.faceDetector.detect(frame);
      const faceCount = result.detections ? result.detections.length : 0;
      return {
        faceCount,
        faceDetected: faceCount > 0
      };
    } catch (err) {
      console.error('Error during face detection:', err);
      // Return safe fallback values
      return { faceCount: 1, faceDetected: true };
    }
  }

  release(): void {
    try {
      if (this.faceDetector) {
        this.faceDetector.close();
        this.faceDetector = null;
      }
    } catch (err) {
      console.error('Error closing face detector:', err);
    }
    this.initialized = false;
    console.log('FaceDetector released');
  }
}
