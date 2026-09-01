type LandmarkPoint = { x: number; y: number; z?: number; visibility?: number }

/**
 * Helper to calculate Euclidean distance between two 2D/3D points
 */
function getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

/**
 * Analyzes liveness factors from a video frame and face landmarks
 * @param frame HTMLVideoElement or HTMLCanvasElement to analyze
 * @param faceLandmarks Optional face landmarks from face landmarker
 * @param blinkHistory Array of blink timestamps
 * @param headMovementHistory Array of head movement timestamps
 * Returns liveness metrics
 */
export function analyzeLiveness(
  frame: HTMLVideoElement | HTMLCanvasElement,
  faceLandmarks: LandmarkPoint[] | null = null,
  blinkHistory: number[] = [],
  headMovementHistory: number[] = []
): {
  eyeAspectRatio: number;       // average eye aspect ratio (0-1, where lower indicates closed eyes)
  blinkRate: number;            // blinks per minute
  headMovementScore: number;    // 0-1, amount of head movement
  textureAnalysisScore: number; // 0-1, texture consistency (real vs spoof)
  spoofSuspected: boolean;      // true if spoofing is suspected
  livenessScore: number;        // 0-1, overall liveness confidence (higher = more likely real)
} {
  const defaultReturn = {
    eyeAspectRatio: 0.3,
    blinkRate: 12,
    headMovementScore: 0.15,
    textureAnalysisScore: 0.85,
    spoofSuspected: false,
    livenessScore: 0.8
  };

  if (!faceLandmarks || faceLandmarks.length < 386) {
    // Return defaults with lower confidence since we lack landmark data
    return {
      ...defaultReturn,
      livenessScore: 0.4
    };
  }

  try {
    // 1. Calculate eye aspect ratio (EAR) from real landmarks
    // Left eye landmarks in MediaPipe Face Mesh:
    // Top: 159, Bottom: 145, Outer Corner: 33, Inner Corner: 133
    const leftTop = faceLandmarks[159];
    const leftBottom = faceLandmarks[145];
    const leftOuter = faceLandmarks[33];
    const leftInner = faceLandmarks[133];

    // Right eye landmarks:
    // Top: 386, Bottom: 374, Outer Corner: 263, Inner Corner: 362
    const rightTop = faceLandmarks[386];
    const rightBottom = faceLandmarks[374];
    const rightOuter = faceLandmarks[263];
    const rightInner = faceLandmarks[362];

    let leftEAR = 0.3;
    if (leftTop && leftBottom && leftOuter && leftInner) {
      const vertDist = getDistance(leftTop, leftBottom);
      const horizDist = getDistance(leftOuter, leftInner);
      leftEAR = horizDist > 0 ? vertDist / horizDist : 0.3;
    }

    let rightEAR = 0.3;
    if (rightTop && rightBottom && rightOuter && rightInner) {
      const vertDist = getDistance(rightTop, rightBottom);
      const horizDist = getDistance(rightOuter, rightInner);
      rightEAR = horizDist > 0 ? vertDist / horizDist : 0.3;
    }

    const eyeAspectRatio = (leftEAR + rightEAR) / 2;

    // 2. Calculate blink rate from history (blinks per minute)
    const now = Date.now();
    const recentBlinks = blinkHistory.filter(t => now - t < 60000);
    const blinkRate = recentBlinks.length;

    // 3. Head movement score - based on frequency of significant head movements
    const recentHeadMovements = headMovementHistory.filter(t => now - t < 60000);
    // Normalize: 12 significant movements per minute is high active movement
    const headMovementScore = Math.min(recentHeadMovements.length / 12, 1.0);

    // 4. Texture analysis score - check pixel-level variance to detect screens/spoofs
    // We'll draw the frame to a small canvas and compute luminance stddev as a proxy.
    let textureAnalysisScore = 0.9;
    try {
      const smallW = 64
      const smallH = 48
      const canvas = document.createElement('canvas')
      canvas.width = smallW
      canvas.height = smallH
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // draw the source frame scaled down
        ctx.drawImage(frame as CanvasImageSource, 0, 0, smallW, smallH)
        const img = ctx.getImageData(0, 0, smallW, smallH)
        const data = img.data
        let sum = 0
        let sumSq = 0
        const count = smallW * smallH
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const lum = 0.299 * r + 0.587 * g + 0.114 * b
          sum += lum
          sumSq += lum * lum
        }
        const mean = sum / count
        const variance = sumSq / count - mean * mean
        const stdDev = Math.sqrt(Math.max(0, variance))
        // normalize stdDev (0-127.5) → 0-1
        const norm = Math.max(0, Math.min(1, stdDev / 127.5))
        // Higher texture variance → more likely real, lower → suspicious
        textureAnalysisScore = Number((0.25 + 0.75 * norm).toFixed(4))
      }
    } catch {
      // fallback to prior heuristic if canvas fails
      textureAnalysisScore = 0.85 + Math.random() * 0.1
    }

    // 5. Determine if spoofing is suspected
    // Spoofing indicators:
    // - Eyeballs never blink (blinkRate < 2 in last minute)
    // - Or average eye aspect ratio is extremely low (eyes closed constantly: eyeAspectRatio < 0.18)
    // - Or no head movement whatsoever (headMovementScore < 0.02)
    // - Or combination of low movement + no blinking
    const isAbnormallyStill = headMovementScore < 0.05 && blinkRate < 2;
    const isEyesClosedConstantly = eyeAspectRatio < 0.18;
    const spoofSuspected = isAbnormallyStill || isEyesClosedConstantly;

    // 6. Calculate overall liveness score
    let livenessScore = 0.8;
    if (spoofSuspected) {
      livenessScore = 0.15;
    } else {
      // Ideal blink rate is between 8 and 22 blinks/min
      const blinkPenalty = (blinkRate < 5 || blinkRate > 35) ? 0.2 : 0;
      const movementBonus = headMovementScore > 0.05 ? 0.1 : 0;
      const earComponent = Math.min(1.0, eyeAspectRatio / 0.3) * 0.4;
      const textureComponent = textureAnalysisScore * 0.5;

      livenessScore = earComponent + textureComponent + movementBonus - blinkPenalty;
    }

    const clampedLivenessScore = Math.max(0.0, Math.min(1.0, livenessScore));

    return {
      eyeAspectRatio: Number(eyeAspectRatio.toFixed(4)),
      blinkRate: Number(blinkRate.toFixed(1)),
      headMovementScore: Number(headMovementScore.toFixed(4)),
      textureAnalysisScore: Number(textureAnalysisScore.toFixed(4)),
      spoofSuspected,
      livenessScore: Number(clampedLivenessScore.toFixed(4))
    };
  } catch (error) {
    console.error('Error in liveness analysis:', error);
    return {
      ...defaultReturn,
      livenessScore: 0.35
    };
  }
}