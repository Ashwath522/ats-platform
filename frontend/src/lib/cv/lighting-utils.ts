/**
 * Analyzes lighting properties from a video frame or canvas
 * @param frame HTMLVideoElement or HTMLCanvasElement to analyze
 * Returns lighting metrics: brightness, contrast, uniformity, and boolean flags
 */
export function analyzeLighting(
  frame: HTMLVideoElement | HTMLCanvasElement
): {
  brightness: number;      // 0-1, where 0 is black, 1 is white
  contrast: number;        // 0-1, standard deviation of pixel intensities
  uniformity: number;      // 0-1, how uniform the lighting is (1 = uniform)
  darkLighting: boolean;   // true if too dark
  goodLighting: boolean;   // true if lighting is adequate
} {
  // Create an offscreen canvas to draw the frame and analyze pixels
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    // Return default values if we can't get context
    return {
      brightness: 0.5,
      contrast: 0.5,
      uniformity: 0.5,
      darkLighting: false,
      goodLighting: true
    };
  }

  // Set canvas size to match frame
  const width = frame.width || 640;
  const height = frame.height || 480;
  canvas.width = width;
  canvas.height = height;

  // Draw the frame onto the canvas
  ctx.drawImage(frame, 0, 0, width, height);

  // Get image data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Initialize accumulators
  let sumBrightness = 0;
  let sumBrightnessSq = 0;
  const pixelCount = width * height;

  // Process each pixel (assuming RGBA format)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Optional: a = data[i + 3] (alpha)

    // Calculate luminance using standard formula: 0.299*R + 0.587*G + 0.114*B
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    sumBrightness += luminance;
    sumBrightnessSq += luminance * luminance;
  }

  // Calculate average brightness (normalized to 0-1)
  const avgBrightness = sumBrightness / (pixelCount * 255);

  // Calculate contrast as standard deviation of luminance
  const avgLuminance = sumBrightness / pixelCount;
  const variance = (sumBrightnessSq / pixelCount) - (avgLuminance * avgLuminance);
  const stdDev = Math.sqrt(Math.max(0, variance)); // Ensure non-negative
  const contrast = Math.min(stdDev / 127.5, 1.0); // Normalize to 0-1 (max stdDev is ~127.5 for 0-255 range)

  // Calculate uniformity as inverse of normalized variance
  // Lower variance = higher uniformity
  const uniformity = Math.max(0, 1 - (stdDev / 127.5));

  // Determine if lighting is too dark (bottom 20% of brightness range)
  const darkLighting = avgBrightness < 0.2;

  // Determine if lighting is good (brightness between 0.3 and 0.8, reasonable contrast)
  const goodLighting = avgBrightness >= 0.3 && avgBrightness <= 0.8 && contrast >= 0.1 && contrast <= 0.7;

  return {
    brightness: Number(avgBrightness.toFixed(4)),
    contrast: Number(contrast.toFixed(4)),
    uniformity: Number(uniformity.toFixed(4)),
    darkLighting,
    goodLighting
  };
}