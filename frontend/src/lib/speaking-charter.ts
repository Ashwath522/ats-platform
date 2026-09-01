/**
 * Formal Speaking Charter wrapper around Web Speech API / TTS path.
 *
 * Rules of the Charter:
 * 1. Tone: Professional, warm, concise — like an experienced hiring manager.
 * 2. Format: Natural spoken English, 1-2 sentences maximum.
 * 3. Sanitization: Strips markdown fences, bullet points, labels (e.g. "Question:", "Follow-up:"), and AI meta-commentary.
 * 4. Audio Delivery: Dispatches via browser SpeechSynthesis API (speakText).
 */

export interface SpeakingOptions {
  voice?: SpeechSynthesisVoice
  rate?: number
  pitch?: number
  onEnd?: () => void
  onError?: (err: any) => void
}

export function formatCharterUtterance(rawQuestion: string): string {
  if (!rawQuestion) return ''

  let text = rawQuestion.trim()
  // Strip markdown formatting
  text = text.replace(/[*_~`#]/g, '')
  // Strip labels like "Question 1:", "Follow-up:", "Interviewer:"
  text = text.replace(/^(Question\s*\d*:|Follow-?up:|Interviewer:|\bAI:)\s*/i, '')
  // Ensure max 2 sentences
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  if (sentences.length > 2) {
    text = sentences.slice(0, 2).join(' ')
  }

  return text
}

export function speakText(
  text: string,
  options: SpeakingOptions = {}
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('Speech synthesis not available in this environment')
      if (options.onEnd) options.onEnd()
      resolve()
      return
    }

    const cleanText = formatCharterUtterance(text)
    window.speechSynthesis.cancel() // Stop any current speech

    const utterance = new SpeechSynthesisUtterance(cleanText)
    utterance.rate = options.rate ?? 1.0
    utterance.pitch = options.pitch ?? 1.0

    if (options.voice) {
      utterance.voice = options.voice
    }

    utterance.onend = () => {
      if (options.onEnd) options.onEnd()
      resolve()
    }

    utterance.onerror = (e) => {
      console.error('Speech synthesis error:', e)
      if (options.onError) options.onError(e)
      if (options.onEnd) options.onEnd()
      resolve()
    }

    window.speechSynthesis.speak(utterance)
  })
}
