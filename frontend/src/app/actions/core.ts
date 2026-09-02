import { generateAiQuestions } from '@/lib/interview-questions'
import { decideNextInterviewStep, DecideNextStepParams } from '@/lib/llm/interviewer'

export async function getInterviewQuestions(jobTitleOrId: string | number, jobDescription: string = '') {
  const role = typeof jobTitleOrId === 'number' ? `Role ${jobTitleOrId}` : jobTitleOrId
  const questions = generateAiQuestions(role, jobDescription)
  const list = questions.map((q) => q.question)
  return { questions: list }
}

export async function getNextInterviewStep(params: DecideNextStepParams) {
  return decideNextInterviewStep(params)
}

export async function completeInterview(
  interviewId: string | number,
  data?: any,
  _extra?: any
) {
  try {
    const id = String(interviewId)
    const payload = Array.isArray(data)
      ? {
          risk_score: 0,
          risk_level: 'low',
          eval_score: 85,
          recommendation: 'proceed',
          transcript: data,
          evidence_url: `/api/proctoring/media/${id}/clip.webm`,
        }
      : {
          risk_score: data?.riskScore ?? 0,
          risk_level: data?.riskLevel ?? 'low',
          eval_score: data?.evalScore ?? 85,
          recommendation: data?.recommendation ?? 'proceed',
          transcript: data?.transcript ?? [],
          evidence_url: data?.evidenceUrl ?? `/api/proctoring/media/${id}/clip.webm`,
        }

    const res = await fetch(`/api/candidate/applications/${id}/submit_interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { success: res.ok }
  } catch (err: any) {
    console.error('Failed to complete interview via API:', err)
    return { success: false, error: err.message }
  }
}
