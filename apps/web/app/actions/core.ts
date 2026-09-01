'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import {
  userRole,
  job,
  recruiterProfile,
  interview,
  candidateProfile,
  evaluation,
  user,
  pipeline,
  auditLog,
  evidence,
} from '@/lib/db/schema'
import { eq, and, inArray, or } from 'drizzle-orm'
import {
  generateAiQuestions,
  parseCustomQuestions,
  type QuestionSet,
} from '@/lib/interview-questions'
import { canCandidateJoinInterview, joinBlockReason } from '@/lib/interview-access'
import { getEventsForInterview, proctoringStore } from '@/lib/proctoring-store'
import { decideNextInterviewStep, type InterviewStepResult } from '@/lib/llm/interviewer'
import { sendEmail, shortlistedEmail, interviewScheduledEmail } from '@/lib/email'

/**
 * Resolve the current user id from the Better Auth session.
 * Every server action that touches user data MUST go through this helper.
 */
async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function getCurrentRole(): Promise<'admin' | 'recruiter' | 'candidate' | null> {
  try {
    const userId = await getUserId()
    const rows = await db
      .select({ role: userRole.role })
      .from(userRole)
      .where(eq(userRole.userId, userId))
      .limit(1)

    const role = rows[0]?.role
    return role === 'admin' || role === 'recruiter' || role === 'candidate' ? role : null
  } catch {
    return null
  }
}

async function requireRole(role: 'admin' | 'recruiter' | 'candidate') {
  const userId = await getUserId()
  const rows = await db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, userId))
    .limit(1)

  if (rows[0]?.role !== role) throw new Error('Forbidden')
  return userId
}

async function requireRecruiterOrAdmin(): Promise<{ userId: string; isAdmin: boolean }> {
  const userId = await getUserId()
  const rows = await db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, userId))
    .limit(1)

  const role = rows[0]?.role
  if (role !== 'recruiter' && role !== 'admin') throw new Error('Forbidden')
  return { userId, isAdmin: role === 'admin' }
}

async function recruiterOwnsJob(recruiterId: string, jobId: number) {
  const rows = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.userId, recruiterId)))
    .limit(1)
  return rows.length > 0
}

async function recruiterOwnsInterview(recruiterId: string, interviewId: number) {
  const rows = await db
    .select({ id: interview.id })
    .from(interview)
    .where(and(eq(interview.id, interviewId), eq(interview.recruiterId, recruiterId)))
    .limit(1)
  return rows.length > 0
}

/**
 * Check if the current user is an admin
 */
export async function isAdmin(): Promise<boolean> {
  try {
    const userId = await getUserId()
    const result = await db
      .select({ role: userRole.role })
      .from(userRole)
      .where(eq(userRole.userId, userId))
      .limit(1)

    return result.length > 0 && result[0].role === 'admin'
  } catch (error) {
    console.error('Failed to check admin role:', error)
    return false
  }
}

/**
 * Get jobs for the current recruiter
 */
export async function getRecruiterJobs(): Promise<
  { id: number; title: string; organizationName: string; description: string | null }[]
> {
  try {
    const userId = await requireRole('recruiter')
    const jobsResult = await db
      .select({
        id: job.id,
        title: job.title,
        organizationName: recruiterProfile.organizationName,
        description: job.description,
      })
      .from(job)
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .where(eq(recruiterProfile.userId, userId))

    return jobsResult.map((row) => ({
      ...row,
      description: row.description ?? null,
    }))
  } catch (error) {
    console.error('Failed to get recruiter jobs:', error)
    return []
  }
}

/**
 * Get completed interviews for the current recruiter's jobs.
 * Returns serialisable plain objects (no Date instances).
 */
export async function getCompletedInterviews(): Promise<
  {
    id: number
    candidateName: string
    jobTitle: string
    company: string
    scheduledAt: string
    status: 'scheduled' | 'baseline' | 'active' | 'completed' | 'cancelled' | 'missed' | 'rescheduled'
    riskScore: number | null
    interviewScore: number | null
    humanReviewRequired: boolean
  }[]
> {
  try {
    const userId = await requireRole('recruiter')

    const jobsResult = await db
      .select({ id: job.id })
      .from(job)
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .where(eq(recruiterProfile.userId, userId))

    const jobIds = jobsResult.map((j) => j.id)

    if (jobIds.length === 0) return []

    const completedResult = await db
      .select({
        interviewId: interview.id,
        candidateName: candidateProfile.fullName,
        jobTitle: job.title,
        company: recruiterProfile.organizationName,
        scheduledAt: interview.scheduledAt,
        status: interview.status,
        riskScore: interview.riskScore,
        evaluationScore: evaluation.score,
        evaluationFeedback: evaluation.feedback,
      })
      .from(interview)
      .innerJoin(candidateProfile, eq(interview.userId, candidateProfile.userId))
      .innerJoin(user, eq(candidateProfile.userId, user.id))
      .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .leftJoin(evaluation, eq(evaluation.interviewId, interview.id))
      .where(
        and(
          inArray(pipeline.jobId, jobIds),
          or(
            eq(interview.status, 'completed'),
            eq(interview.status, 'missed'),
            eq(interview.status, 'rescheduled'),
          ),
        ),
      )
      .orderBy(interview.scheduledAt)

    return completedResult.map((row) => {
      const humanReviewRequired =
        (row.riskScore !== null && row.riskScore >= 80) ||
        (row.evaluationScore !== null &&
          row.riskScore !== null &&
          Math.abs(row.riskScore - row.evaluationScore) > 30) ||
        (typeof row.evaluationFeedback === 'string' &&
          row.evaluationFeedback.toLowerCase().includes('needs human review'))

      return {
        id: row.interviewId,
        candidateName: row.candidateName ?? '',
        jobTitle: row.jobTitle ?? '',
        company: row.company ?? '',
        // Serialize Date → ISO string so the value is safe across the server/client boundary
        scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : new Date().toISOString(),
        status: (row.status ?? 'completed') as
          | 'scheduled'
          | 'baseline'
          | 'active'
          | 'completed'
          | 'cancelled'
          | 'missed'
          | 'rescheduled',
        riskScore: row.riskScore ?? null,
        interviewScore: row.evaluationScore ?? null,
        humanReviewRequired,
      }
    })
  } catch (error) {
    console.error('Failed to get completed interviews:', error)
    return []
  }
}

/**
 * Get shortlist candidates for the current recruiter's jobs.
 * Returns serialisable plain objects.
 */
export async function getShortlistCandidates(): Promise<
  {
    candidateId: number
    candidateName: string
    jobTitle: string
    company: string
    jobId: number
    interviewId: number | null
    scheduledAt: string | null
    riskScore: number | null
    interviewScore: number | null
    humanReviewRequired: boolean
  }[]
> {
  try {
    const userId = await requireRole('recruiter')

    const jobsResult = await db
      .select({ id: job.id })
      .from(job)
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .where(eq(recruiterProfile.userId, userId))

    const jobIds = jobsResult.map((j) => j.id)

    if (jobIds.length === 0) return []

    const shortlistResult = await db
      .select({
        candidateId: candidateProfile.id,
        candidateName: candidateProfile.fullName,
        jobTitle: job.title,
        company: recruiterProfile.organizationName,
        jobId: job.id,
        interviewId: pipeline.interviewId,
        scheduledAt: interview.scheduledAt,
        riskScore: interview.riskScore,
        interviewScore: evaluation.score,
        evaluationFeedback: evaluation.feedback,
      })
      .from(pipeline)
      .innerJoin(candidateProfile, eq(pipeline.candidateId, candidateProfile.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .leftJoin(interview, eq(pipeline.interviewId, interview.id))
      .leftJoin(evaluation, eq(evaluation.interviewId, interview.id))
      .where(and(inArray(pipeline.jobId, jobIds), eq(pipeline.stage, 'shortlist')))
      .orderBy(pipeline.updatedAt)

    return shortlistResult.map((row) => {
      const humanReviewRequired =
        (row.riskScore !== null && row.riskScore >= 80) ||
        (typeof row.evaluationFeedback === 'string' &&
          row.evaluationFeedback.toLowerCase().includes('needs human review'))

      return {
        candidateId: row.candidateId,
        candidateName: row.candidateName ?? '',
        jobTitle: row.jobTitle ?? '',
        company: row.company ?? '',
        jobId: row.jobId,
        interviewId: row.interviewId ?? null,
        scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
        riskScore: row.riskScore ?? null,
        interviewScore: row.interviewScore ?? null,
        humanReviewRequired,
      }
    })
  } catch (error) {
    console.error('Failed to get shortlist candidates:', error)
    return []
  }
}

/**
 * Move an interview's candidate to the shortlist stage
 */
export async function moveToShortlist(interviewId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await requireRole('recruiter')
    if (!(await recruiterOwnsInterview(userId, interviewId))) return { ok: false, error: 'Forbidden' }

    // Look up candidateId + jobId from the interview → pipeline chain
    const rows = await db
      .select({ candidateId: pipeline.candidateId, jobId: pipeline.jobId })
      .from(interview)
      .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
      .where(eq(interview.id, interviewId))
      .limit(1)

    if (rows.length === 0) return { ok: false, error: 'Interview not found' }

    const { candidateId, jobId } = rows[0]

    // Update pipeline stage
    await db
      .update(pipeline)
      .set({ stage: 'shortlist', updatedAt: new Date() })
      .where(and(eq(pipeline.candidateId, candidateId), eq(pipeline.jobId, jobId)))

    // Fetch candidate email, name, job title, and recruiter org name for email
    try {
      const emailData = await db
        .select({
          candidateEmail: user.email,
          candidateName: candidateProfile.fullName,
          jobTitle: job.title,
          orgName: recruiterProfile.organizationName,
        })
        .from(pipeline)
        .innerJoin(candidateProfile, eq(pipeline.candidateId, candidateProfile.id))
        .innerJoin(user, eq(candidateProfile.userId, user.id))
        .innerJoin(job, eq(pipeline.jobId, job.id))
        .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
        .where(and(eq(pipeline.candidateId, candidateId), eq(pipeline.jobId, jobId)))
        .limit(1)

      if (emailData[0]) {
        const { candidateEmail, candidateName, jobTitle, orgName } = emailData[0]
        const emailTemplate = shortlistedEmail(candidateName ?? '', jobTitle ?? '', orgName ?? '')
        await sendEmail({
          to: candidateEmail ?? '',
          subject: emailTemplate.subject,
          html: emailTemplate.html,
        })
      }
    } catch (emailError) {
      console.error('Failed to send shortlist email:', emailError)
    }

    await db.insert(auditLog).values({
      userId,
      action: 'candidate_shortlisted',
      entityType: 'interview',
      entityId: interviewId,
      details: { candidateId, jobId },
    })

    return { ok: true }
  } catch (error) {
    console.error('moveToShortlist failed:', error)
    return { ok: false, error: String(error) }
  }
}

/**
 * Hire a candidate (set pipeline stage → 'hired')
 */
export async function hireCandidate(
  candidateId: number,
  jobId: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await requireRole('recruiter')
    if (!(await recruiterOwnsJob(userId, jobId))) return { ok: false, error: 'Forbidden' }
    await db
      .update(pipeline)
      .set({ stage: 'hired', updatedAt: new Date() })
      .where(and(eq(pipeline.candidateId, candidateId), eq(pipeline.jobId, jobId)))
    await db.insert(auditLog).values({
      userId,
      action: 'candidate_hired',
      entityType: 'pipeline',
      entityId: candidateId,
      details: { candidateId, jobId, humanDecision: true },
    })
    return { ok: true }
  } catch (error) {
    console.error('hireCandidate failed:', error)
    return { ok: false, error: String(error) }
  }
}

/**
 * Reject a candidate (set pipeline stage → 'rejected')
 */
export async function rejectCandidate(
  candidateId: number,
  jobId: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await requireRole('recruiter')
    if (!(await recruiterOwnsJob(userId, jobId))) return { ok: false, error: 'Forbidden' }
    await db
      .update(pipeline)
      .set({ stage: 'rejected', updatedAt: new Date() })
      .where(and(eq(pipeline.candidateId, candidateId), eq(pipeline.jobId, jobId)))
    await db.insert(auditLog).values({
      userId,
      action: 'candidate_rejected',
      entityType: 'pipeline',
      entityId: candidateId,
      details: { candidateId, jobId, humanDecision: true },
    })
    return { ok: true }
  } catch (error) {
    console.error('rejectCandidate failed:', error)
    return { ok: false, error: String(error) }
  }
}

export async function getCandidateInterviews(): Promise<
  {
    id: number
    jobTitle: string
    company: string
    scheduledAt: string
    status: string
    durationMinutes: number
    canAttend: boolean
    blockReason: string | null
  }[]
> {
  try {
    const userId = await requireRole('candidate')
    const rows = await db
      .select({
        id: interview.id,
        jobTitle: job.title,
        company: recruiterProfile.organizationName,
        scheduledAt: interview.scheduledAt,
        status: interview.status,
        durationMinutes: interview.durationMinutes,
      })
      .from(interview)
      .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .where(eq(interview.userId, userId))
      .orderBy(interview.scheduledAt)

    return rows.map((row) => {
      const scheduledAt = new Date(row.scheduledAt).toISOString()
      const durationMinutes = row.durationMinutes ?? 30
      const join = canCandidateJoinInterview({
        status: row.status ?? 'scheduled',
        scheduledAt,
        durationMinutes,
      })
      return {
        id: row.id,
        jobTitle: row.jobTitle,
        company: row.company,
        scheduledAt,
        status: row.status ?? 'scheduled',
        durationMinutes,
        canAttend: join.allowed,
        blockReason: join.reason,
      }
    })
  } catch (error) {
    console.error('Failed to get candidate interviews:', error)
    return []
  }
}

export async function getInterviewQuestions(
  interviewId: number,
): Promise<{ questions: string[] } | { error: string }> {
  try {
    const userId = await requireRole('candidate')
    const rows = await db
      .select({
        questionSet: interview.questionSet,
        status: interview.status,
      })
      .from(interview)
      .where(and(eq(interview.id, interviewId), eq(interview.userId, userId)))
      .limit(1)

    if (!rows.length) return { error: 'Interview not found' }

    const blocked = joinBlockReason(rows[0].status ?? 'scheduled')
    if (blocked) return { error: blocked }

    const set = rows[0].questionSet as QuestionSet | null
    const questions = set?.questions?.map((item) => item.question).filter(Boolean) ?? []
    if (!questions.length) {
      return {
        questions: [
          'Tell me about your most relevant experience for this role.',
          'Describe a challenging decision you made recently and the outcome.',
          'What would you focus on in your first 30 days?',
        ],
      }
    }
    return { questions }
  } catch (error) {
    console.error('Failed to get interview questions:', error)
    return { error: 'Unable to load interview questions' }
  }
}

export async function getNextInterviewStep(params: {
  interviewId: number
  baseQuestionIndex: number
  isFollowUpQuestion: boolean
  currentQuestion: string
  candidateAnswer: string
  priorQA: { question: string; answer: string }[]
}): Promise<InterviewStepResult | { error: string }> {
  try {
    const userId = await requireRole('candidate')
    const rows = await db
      .select({
        questionSet: interview.questionSet,
        status: interview.status,
        jobTitle: job.title,
        jobDescription: job.description,
      })
      .from(interview)
      .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .where(and(eq(interview.id, params.interviewId), eq(interview.userId, userId)))
      .limit(1)

    if (!rows.length) return { error: 'Interview not found' }

    const blocked = joinBlockReason(rows[0].status ?? 'scheduled')
    if (blocked) return { error: blocked }

    const set = rows[0].questionSet as QuestionSet | null
    const baseQuestions =
      set?.questions?.map((item) => item.question).filter(Boolean) ?? [
        'Tell me about your most relevant experience for this role.',
        'Describe a challenging decision you made recently and the outcome.',
        'What would you focus on in your first 30 days?',
      ]

    if (params.baseQuestionIndex < 0 || params.baseQuestionIndex >= baseQuestions.length) {
      return { error: 'Invalid question index' }
    }

    return decideNextInterviewStep({
      jobTitle: rows[0].jobTitle,
      jobDescription: rows[0].jobDescription ?? '',
      baseQuestions,
      baseQuestionIndex: params.baseQuestionIndex,
      isFollowUpQuestion: params.isFollowUpQuestion,
      currentQuestion: params.currentQuestion,
      candidateAnswer: params.candidateAnswer,
      priorQA: params.priorQA,
    })
  } catch (error) {
    console.error('getNextInterviewStep failed:', error)
    return { error: 'Unable to determine next question' }
  }
}

export async function markInterviewStarted(interviewId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await requireRole('candidate')
    const rows = await db
      .select({
        status: interview.status,
        scheduledAt: interview.scheduledAt,
        durationMinutes: interview.durationMinutes,
      })
      .from(interview)
      .where(and(eq(interview.id, interviewId), eq(interview.userId, userId)))
      .limit(1)

    if (!rows.length) return { ok: false, error: 'Interview not found' }

    const blocked = joinBlockReason(rows[0].status ?? 'scheduled')
    if (blocked) return { ok: false, error: blocked }

    const join = canCandidateJoinInterview({
      status: rows[0].status ?? 'scheduled',
      scheduledAt: rows[0].scheduledAt,
      durationMinutes: rows[0].durationMinutes ?? 30,
    })
    if (!join.allowed) return { ok: false, error: join.reason ?? 'Interview is not available' }

    await db
      .update(interview)
      .set({ status: 'active', startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(interview.id, interviewId), eq(interview.userId, userId)))
    await db.insert(auditLog).values({
      userId,
      action: 'interview_started',
      entityType: 'interview',
      entityId: interviewId,
      details: {},
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

export async function completeInterview(
  interviewId: number,
  answers: { question: string; answer: string; score: number; feedback: string }[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await requireRole('candidate')
    const owned = await db
      .select({ recruiterId: interview.recruiterId, status: interview.status })
      .from(interview)
      .where(and(eq(interview.id, interviewId), eq(interview.userId, userId)))
      .limit(1)
    if (!owned.length) return { ok: false, error: 'Interview not found' }
    if (owned[0].status === 'completed') return { ok: false, error: 'This interview is already completed' }

    const avgScore =
      answers.length > 0
        ? Math.round(answers.reduce((sum, item) => sum + item.score, 0) / answers.length)
        : 0
    const needsReview = answers.some((item) => item.score < 45)
    const sessionKey = `interview:${interviewId}`
    const riskEntry = proctoringStore.risks.get(sessionKey) as { score?: number } | undefined
    const riskScore =
      riskEntry?.score !== undefined && riskEntry.score !== null
        ? Math.round(Number(riskEntry.score))
        : null

    await db
      .update(interview)
      .set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
        ...(riskScore !== null ? { riskScore } : {}),
      })
      .where(eq(interview.id, interviewId))
    await db
      .update(pipeline)
      .set({ stage: 'evaluation', updatedAt: new Date() })
      .where(eq(pipeline.interviewId, interviewId))
    await db.insert(evaluation).values({
      userId: owned[0].recruiterId,
      interviewId,
      score: avgScore,
      decision: needsReview ? 'maybe' : 'pass',
      feedback: `${needsReview ? 'Needs human review. ' : ''}${answers.map((a, i) => `Q${i + 1}: ${a.feedback}`).join(' ')}`,
      submittedAt: new Date(),
    })
    await db.insert(evidence).values({
      userId,
      interviewId,
      evidenceType: 'transcript',
      pathname: `interviews/${interviewId}/transcript.json`,
      metadata: { answers },
    })
    await db.insert(auditLog).values({
      userId,
      action: 'interview_completed',
      entityType: 'interview',
      entityId: interviewId,
      details: { answerCount: answers.length, score: avgScore },
    })
    return { ok: true }
  } catch (error) {
    console.error('completeInterview failed:', error)
    return { ok: false, error: String(error) }
  }
}

export async function scheduleInterviewBatch(params: {
  jobId: number
  candidateIds: number[]
  scheduledAt: string
  durationMinutes: number
  questionMode: 'ai' | 'custom'
  jobDescription?: string
  customQuestionsRaw?: string
}): Promise<{ ok: boolean; interviewIds?: number[]; error?: string }> {
  try {
    const userId = await requireRole('recruiter')
    const candidateIds = [...new Set(params.candidateIds)].slice(0, 5)
    if (candidateIds.length === 0) return { ok: false, error: 'Select at least one candidate' }
    if (!(await recruiterOwnsJob(userId, params.jobId))) return { ok: false, error: 'Forbidden' }

    const jobRows = await db
      .select({ id: job.id, title: job.title, description: job.description })
      .from(job)
      .where(and(eq(job.id, params.jobId), eq(job.userId, userId)))
      .limit(1)
    if (!jobRows.length) return { ok: false, error: 'Job not found' }

    const jobTitle = jobRows[0].title
    const description = (params.jobDescription ?? jobRows[0].description ?? '').trim()

    let questionSet: QuestionSet
    if (params.questionMode === 'custom') {
      const questions = parseCustomQuestions(params.customQuestionsRaw ?? '')
      if (questions.length === 0) {
        return { ok: false, error: 'Add at least one custom question' }
      }
      questionSet = { mode: 'custom', questions }
    } else {
      if (!description) {
        return { ok: false, error: 'Job description is required for AI-generated questions' }
      }
      questionSet = { mode: 'ai', questions: generateAiQuestions(jobTitle, description) }
    }

    await db
      .update(job)
      .set({
        description,
        questionMode: params.questionMode,
        questionSet,
        updatedAt: new Date(),
      })
      .where(eq(job.id, params.jobId))

    const created: number[] = []
    for (const candidateId of candidateIds) {
      const pipelineRows = await db
        .insert(pipeline)
        .values({
          userId,
          jobId: params.jobId,
          candidateId,
          stage: 'interview',
        })
        .returning({ id: pipeline.id })

      const candidateRows = await db
        .select({ userId: candidateProfile.userId })
        .from(candidateProfile)
        .where(eq(candidateProfile.id, candidateId))
        .limit(1)
      if (!candidateRows.length) continue

      const interviewRows = await db
        .insert(interview)
        .values({
          userId: candidateRows[0].userId,
          recruiterId: userId,
          pipelineId: pipelineRows[0].id,
          scheduledAt: new Date(params.scheduledAt),
          durationMinutes: params.durationMinutes,
          status: 'scheduled',
          questionSet,
        })
        .returning({ id: interview.id })

      await db
        .update(interview)
        .set({ roomUrl: `/candidate?interview=${interviewRows[0].id}`, updatedAt: new Date() })
        .where(eq(interview.id, interviewRows[0].id))

      await db
        .update(pipeline)
        .set({ interviewId: interviewRows[0].id, updatedAt: new Date() })
        .where(eq(pipeline.id, pipelineRows[0].id))
      created.push(interviewRows[0].id)

      // Send interview scheduled email
      try {
        const emailData = await db
          .select({
            candidateEmail: user.email,
            candidateName: candidateProfile.fullName,
            orgName: recruiterProfile.organizationName,
          })
          .from(candidateProfile)
          .innerJoin(user, eq(candidateProfile.userId, user.id))
          .innerJoin(job, eq(job.id, params.jobId))
          .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
          .where(eq(candidateProfile.id, candidateId))
          .limit(1)

        if (emailData[0]) {
          const { candidateEmail, candidateName, orgName } = emailData[0]
          const emailTemplate = interviewScheduledEmail(
            candidateName ?? '',
            jobTitle,
            orgName ?? '',
            new Date(params.scheduledAt),
          )
          await sendEmail({
            to: candidateEmail ?? '',
            subject: emailTemplate.subject,
            html: emailTemplate.html,
          })
        }
      } catch (emailError) {
        console.error('Failed to send interview scheduled email:', emailError)
      }
    }

    await db.insert(auditLog).values({
      userId,
      action: 'interview_batch_scheduled',
      entityType: 'job',
      entityId: params.jobId,
      details: {
        interviewIds: created,
        candidateCount: created.length,
        scheduledAt: params.scheduledAt,
        questionMode: params.questionMode,
      },
    })
    return { ok: true, interviewIds: created }
  } catch (error) {
    console.error('scheduleInterviewBatch failed:', error)
    return { ok: false, error: String(error) }
  }
}

export async function getScheduledInterviews(): Promise<
  {
    id: number
    candidateName: string
    jobTitle: string
    company: string
    scheduledAt: string
    status: 'scheduled' | 'baseline' | 'active' | 'completed' | 'cancelled' | 'missed' | 'rescheduled'
    durationMinutes: number
  }[]
> {
  try {
    const userId = await requireRole('recruiter')

    const jobsResult = await db
      .select({ id: job.id })
      .from(job)
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .where(eq(recruiterProfile.userId, userId))

    const jobIds = jobsResult.map((j) => j.id)
    if (jobIds.length === 0) return []

    const rows = await db
      .select({
        interviewId: interview.id,
        candidateName: candidateProfile.fullName,
        jobTitle: job.title,
        company: recruiterProfile.organizationName,
        scheduledAt: interview.scheduledAt,
        status: interview.status,
        durationMinutes: interview.durationMinutes,
      })
      .from(interview)
      .innerJoin(candidateProfile, eq(interview.userId, candidateProfile.userId))
      .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .where(
        and(
          inArray(pipeline.jobId, jobIds),
          or(
            eq(interview.status, 'scheduled'),
            eq(interview.status, 'baseline'),
            eq(interview.status, 'active'),
          ),
        ),
      )
      .orderBy(interview.scheduledAt)

    return rows.map((row) => ({
      id: row.interviewId,
      candidateName: row.candidateName ?? '',
      jobTitle: row.jobTitle ?? '',
      company: row.company ?? '',
      scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : new Date().toISOString(),
      status: (row.status ?? 'scheduled') as
        | 'scheduled'
        | 'baseline'
        | 'active'
        | 'completed'
        | 'cancelled'
        | 'missed'
        | 'rescheduled',
      durationMinutes: row.durationMinutes ?? 30,
    }))
  } catch (error) {
    console.error('Failed to get scheduled interviews:', error)
    return []
  }
}

export async function getInterviewEvidenceSummary(interviewId: number): Promise<{
  interviewId: number
  candidateName: string
  jobTitle: string
  company: string
  status: string
  scheduledAt: string | null
  riskScore: number | null
  interviewScore: number | null
  transcriptSnippet: string | null
  events: {
    event_type: string
    severity: string
    timestamp: string
    snapshot_url?: string
    clip_url?: string
  }[]
} | null> {
  try {
    const { userId, isAdmin } = await requireRecruiterOrAdmin()

    // Check interview access:
    // - Admins can access any interview
    // - Recruiters must be the interview's recruiterId OR the job's owning recruiter
    if (!isAdmin) {
      // Primary: interview.recruiterId matches current user
      const directOwner = await recruiterOwnsInterview(userId, interviewId)
      if (!directOwner) {
        // Fallback: the current user owns the job this interview belongs to
        const jobOwnerRows = await db
          .select({ id: interview.id })
          .from(interview)
          .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
          .innerJoin(job, eq(pipeline.jobId, job.id))
          .where(and(eq(interview.id, interviewId), eq(job.userId, userId)))
          .limit(1)
        if (jobOwnerRows.length === 0) {
          console.warn(
            `[getInterviewEvidenceSummary] Access denied: userId=${userId} has no ownership over interviewId=${interviewId}`,
          )
          return null
        }
      }
    }

    const rows = await db
      .select({
        candidateName: candidateProfile.fullName,
        jobTitle: job.title,
        company: recruiterProfile.organizationName,
        status: interview.status,
        scheduledAt: interview.scheduledAt,
        riskScore: interview.riskScore,
        interviewScore: evaluation.score,
        feedback: evaluation.feedback,
        metadata: evidence.metadata,
      })
      .from(interview)
      .innerJoin(candidateProfile, eq(interview.userId, candidateProfile.userId))
      .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .leftJoin(evaluation, eq(evaluation.interviewId, interview.id))
      .leftJoin(evidence, and(eq(evidence.interviewId, interview.id), eq(evidence.evidenceType, 'transcript')))
      .where(eq(interview.id, interviewId))
      .limit(1)

    if (!rows.length) {
      console.warn(
        `[getInterviewEvidenceSummary] No DB row for interviewId=${interviewId} (join may have failed)`,
      )
      return null
    }

    const row = rows[0]
    const metadata = row.metadata as { answers?: { answer?: string }[] } | null
    const firstAnswer = metadata?.answers?.[0]?.answer

    return {
      interviewId,
      candidateName: row.candidateName ?? '',
      jobTitle: row.jobTitle ?? '',
      company: row.company ?? '',
      status: row.status ?? 'scheduled',
      scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
      riskScore: row.riskScore ?? null,
      interviewScore: row.interviewScore ?? null,
      transcriptSnippet: firstAnswer ?? row.feedback ?? null,
      events: getEventsForInterview(interviewId)
        .map((event) => ({
          event_type: event.event_type,
          severity: event.severity,
          timestamp: event.timestamp,
          snapshot_url: event.snapshot_url,
          clip_url: event.clip_url,
        })),
    }
  } catch (error) {
    console.error('Failed to get interview evidence summary:', error)
    return null
  }
}

export async function getRecruiterPipelineCandidates(): Promise<
  { candidateId: number; candidateName: string; jobId: number; jobTitle: string; stage: string }[]
> {
  try {
    const userId = await requireRole('recruiter')
    const rows = await db
      .select({
        candidateId: candidateProfile.id,
        candidateName: candidateProfile.fullName,
        jobId: job.id,
        jobTitle: job.title,
        stage: pipeline.stage,
      })
      .from(pipeline)
      .innerJoin(candidateProfile, eq(pipeline.candidateId, candidateProfile.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .where(and(eq(pipeline.userId, userId), or(eq(pipeline.stage, 'applied'), eq(pipeline.stage, 'screening'))))
      .orderBy(pipeline.updatedAt)

    return rows
  } catch (error) {
    console.error('Failed to get pipeline candidates:', error)
    return []
  }
}

/**
 * Get currently-active live sessions visible to the current user.
 * Recruiters see only sessions for their own interviews (by recruiterId OR job ownership).
 * Admins see all sessions.
 * "Active" means last_seen_at within the last 60 seconds.
 */
export async function getActiveLiveSessions(): Promise<
  {
    sessionId: string
    interviewId: number
    candidateName: string
    jobTitle: string
    riskLevel: 'low' | 'medium' | 'high'
    riskScore: number | null
    startedAt: string
    status: string
  }[]
> {
  try {
    const { userId, isAdmin } = await requireRecruiterOrAdmin()
    const { listLiveSessions } = await import('@/lib/proctoring-store')
    const cutoffMs = 60 * 1000 // 60 seconds
    const now = Date.now()

    const allSessions = listLiveSessions().filter((s) => {
      const lastSeen = new Date(s.last_seen_at).getTime()
      return now - lastSeen <= cutoffMs
    })

    let visibleSessions = allSessions

    if (!isAdmin) {
      // Fetch interview IDs that the recruiter is allowed to see
      const jobsResult = await db
        .select({ id: job.id })
        .from(job)
        .where(eq(job.userId, userId))

      const jobIds = jobsResult.map((j) => j.id)

      // Interviews where recruiterId matches OR job belongs to recruiter
      const ownedInterviews = await db
        .select({ id: interview.id })
        .from(interview)
        .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
        .where(
          or(
            eq(interview.recruiterId, userId),
            jobIds.length > 0 ? inArray(pipeline.jobId, jobIds) : eq(interview.id, -1),
          ),
        )

      const ownedIds = new Set(ownedInterviews.map((r) => r.id))
      visibleSessions = allSessions.filter((s) => ownedIds.has(s.interview_id))
    }

    return visibleSessions.map((s) => ({
      sessionId: s.session_id,
      interviewId: s.interview_id,
      candidateName: s.candidate_name,
      jobTitle: s.job_title,
      riskLevel: s.risk_level,
      riskScore: s.risk_score,
      startedAt: s.last_seen_at,
      status: s.status,
    }))
  } catch (error) {
    console.error('Failed to get active live sessions:', error)
    return []
  }
}

/**
 * Admin-only: get all scheduled/active interviews across all recruiters for the pipeline overview.
 */
export async function getAdminScheduledInterviews(): Promise<
  {
    id: number
    candidateName: string
    jobTitle: string
    recruiterEmail: string
    company: string
    scheduledAt: string
    status: string
    durationMinutes: number
  }[]
> {
  try {
    const userId = await getUserId()
    const roleRows = await db
      .select({ role: userRole.role })
      .from(userRole)
      .where(eq(userRole.userId, userId))
      .limit(1)
    if (roleRows[0]?.role !== 'admin') throw new Error('Forbidden')

    const rows = await db
      .select({
        interviewId: interview.id,
        candidateName: candidateProfile.fullName,
        jobTitle: job.title,
        recruiterEmail: user.email,
        company: recruiterProfile.organizationName,
        scheduledAt: interview.scheduledAt,
        status: interview.status,
        durationMinutes: interview.durationMinutes,
      })
      .from(interview)
      .innerJoin(candidateProfile, eq(interview.userId, candidateProfile.userId))
      .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .innerJoin(user, eq(interview.recruiterId, user.id))
      .where(
        or(
          eq(interview.status, 'scheduled'),
          eq(interview.status, 'baseline'),
          eq(interview.status, 'active'),
        ),
      )
      .orderBy(interview.scheduledAt)

    return rows.map((row) => ({
      id: row.interviewId,
      candidateName: row.candidateName ?? '',
      jobTitle: row.jobTitle ?? '',
      recruiterEmail: row.recruiterEmail ?? '',
      company: row.company ?? '',
      scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : new Date().toISOString(),
      status: row.status ?? 'scheduled',
      durationMinutes: row.durationMinutes ?? 30,
    }))
  } catch (error) {
    console.error('Failed to get admin scheduled interviews:', error)
    return []
  }
}
