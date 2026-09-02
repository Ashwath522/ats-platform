export async function requestMediaPermissions(): Promise<{
  camera: boolean
  microphone: boolean
  errors: string[]
}> {
  const errors: string[] = []
  let camera = false
  let microphone = false

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      camera: false,
      microphone: false,
      errors: ['Media devices API is not supported in this browser.'],
    }
  }

  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true })
    videoStream.getTracks().forEach((track) => track.stop())
    camera = true
  } catch (err: any) {
    errors.push(`Camera permission denied or unavailable: ${err.message || err}`)
  }

  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioStream.getTracks().forEach((track) => track.stop())
    microphone = true
  } catch (err: any) {
    errors.push(`Microphone permission denied or unavailable: ${err.message || err}`)
  }

  return { camera, microphone, errors }
}
