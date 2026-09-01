import { analyzeLiveness } from './liveness-utils';

export class LivenessAnalyzer {
  private initialized: boolean = false;
  private blinkHistory: number[] = []; // timestamps of blinks
  private headMovementHistory: number[] = []; // timestamps of significant head movement
  private wasClosed: boolean = false;
  private lastNosePos: { x: number; y: number } | null = null;

  async initialize(): Promise<void> {
    this.initialized = true;
    console.log('LivenessAnalyzer initialized');
  }

  async analyze(frame: HTMLVideoElement | HTMLCanvasElement, faceLandmarks?: Array<{ x: number; y: number; z?: number; visibility?: number }> | null): Promise<{
    eyeAspectRatio: number;       // average eye aspect ratio (0-1, where lower indicates closed eyes)
    blinkRate: number;            // blinks per minute
    headMovementScore: number;    // 0-1, amount of head movement
    textureAnalysisScore: number; // 0-1, texture consistency (real vs spoof)
    spoofSuspected: boolean;      // true if spoofing is suspected
    livenessScore: number;        // 0-1, overall liveness confidence (higher = more likely real)
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 1. Process blink detection based on faceLandmarks
    if (faceLandmarks && faceLandmarks.length > 159) {
      // Calculate a local EAR
      const leftTop = faceLandmarks[159];
      const leftBottom = faceLandmarks[145];
      const leftOuter = faceLandmarks[33];
      const leftInner = faceLandmarks[133];

      const rightTop = faceLandmarks[386];
      const rightBottom = faceLandmarks[374];
      const rightOuter = faceLandmarks[263];
      const rightInner = faceLandmarks[362];

      const getDist = (p1: { x: number; y: number } | null | undefined, p2: { x: number; y: number } | null | undefined) => p1 && p2 ? Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2) : 0.3;

      const leftEAR = getDist(leftTop, leftBottom) / (getDist(leftOuter, leftInner) || 1);
      const rightEAR = getDist(rightTop, rightBottom) / (getDist(rightOuter, rightInner) || 1);
      const ear = (leftEAR + rightEAR) / 2;

      // Closed threshold ~0.22
      if (ear < 0.22) {
        this.wasClosed = true;
      } else {
        if (this.wasClosed) {
          // Transitioned from closed to open: record a blink!
          this.recordBlink();
          this.wasClosed = false;
        }
      }

      // 2. Process head movement detection
      const nose = faceLandmarks[4];
      if (nose) {
        if (this.lastNosePos) {
          const moveDist = Math.sqrt((nose.x - this.lastNosePos.x) ** 2 + (nose.y - this.lastNosePos.y) ** 2);
          // 0.008 is a reasonable threshold for significant movement between frames
          if (moveDist > 0.008) {
            this.recordHeadMovement();
          }
        }
        this.lastNosePos = { x: nose.x, y: nose.y };
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      // show debug when liveness running; indicate whether landmarks are present
      console.debug('LivenessAnalyzer running; landmarks available:', !!faceLandmarks)
    }

    return analyzeLiveness(frame, faceLandmarks, this.blinkHistory, this.headMovementHistory);
  }

  // Call this when a blink is detected
  recordBlink(timestamp: number = Date.now()): void {
    this.blinkHistory.push(timestamp);
    const cutoff = timestamp - 30000;
    this.blinkHistory = this.blinkHistory.filter(t => t > cutoff);
  }

  // Call this when significant head movement is detected
  recordHeadMovement(timestamp: number = Date.now()): void {
    this.headMovementHistory.push(timestamp);
    const cutoff = timestamp - 30000;
    this.headMovementHistory = this.headMovementHistory.filter(t => t > cutoff);
  }

  release(): void {
    this.initialized = false;
    this.blinkHistory = [];
    this.headMovementHistory = [];
    this.wasClosed = false;
    this.lastNosePos = null;
    console.log('LivenessAnalyzer released');
  }
}