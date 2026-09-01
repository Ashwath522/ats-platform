export async function requestMediaPermissions(): Promise<{
  camera: boolean
  microphone: boolean
  errors: string[]
}> {
  const errors: string[] = []

  let camera = false
  let microphone = false

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: true,
    })
    camera = stream.getVideoTracks().length > 0
    microphone = stream.getAudioTracks().length > 0

    stream.getTracks().forEach((t) => t.stop())
  } catch (err) {
    const error = err as Error
    if (error.name === 'NotAllowedError') {
      errors.push(
        'Camera or microphone permissions were denied. Please allow access in your browser settings.'
      )
    } else if (error.name === 'NotFoundError') {
      errors.push('No camera or microphone device found.')
    } else {
      errors.push(`Media permission error: ${error.message}`)
    }
  }

  return { camera, microphone, errors }
}

export async function enumerateDevices(): Promise<{
  videoInput: MediaDeviceInfo[]
  audioInput: MediaDeviceInfo[]
}> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return {
      videoInput: devices.filter((d) => d.kind === 'videoinput'),
      audioInput: devices.filter((d) => d.kind === 'audioinput'),
    }
  } catch {
    return { videoInput: [], audioInput: [] }
  }
}
