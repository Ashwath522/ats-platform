import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  interview,
  pipeline,
  job,
  recruiterProfile,
  candidateProfile,
  user,
} from '@/lib/db/schema'
import { and, eq, isNull, gte, lte } from 'drizzle-orm'
import { sendEmail, interviewReminderEmail } from '@/lib/email'

/**
 * GET /api/cron/interview-reminders
 *
 * Sends 20-minute reminder emails for upcoming interviews.
 * Queries all scheduled interviews where reminderSentAt is null and scheduledAt is within the next 20 minutes.
 * Sends reminder email and marks reminderSentAt to prevent duplicate sends.
 *
 * For production, wire this to Vercel Cron (vercel.json) or an external scheduler.
 * For demo/local testing, trigger manually: curl http://localhost:3000/api/cron/interview-reminders
 */
export async function GET() {
  try {
    const now = new Date()
    const twentyMinutesLater = new Date(now.getTime() + 20 * 60 * 1000)

    // Query interviews scheduled within the next 20 minutes, not yet reminded
    const reminderInterviews = await db
      .select({
        interviewId: interview.id,
        scheduledAt: interview.scheduledAt,
        candidateEmail: user.email,
        candidateName: candidateProfile.fullName,
        jobTitle: job.title,
        orgName: recruiterProfile.organizationName,
      })
      .from(interview)
      .innerJoin(candidateProfile, eq(interview.userId, candidateProfile.userId))
      .innerJoin(user, eq(candidateProfile.userId, user.id))
      .innerJoin(pipeline, eq(interview.pipelineId, pipeline.id))
      .innerJoin(job, eq(pipeline.jobId, job.id))
      .innerJoin(recruiterProfile, eq(job.userId, recruiterProfile.userId))
      .where(
        and(
          eq(interview.status, 'scheduled'),
          isNull(interview.reminderSentAt),
          gte(interview.scheduledAt, now),
          lte(interview.scheduledAt, twentyMinutesLater),
        ),
      )

    let sentCount = 0

    // Send reminder email for each interview and mark reminderSentAt
    for (const item of reminderInterviews) {
      try {
        const emailTemplate = interviewReminderEmail(
          item.candidateName ?? '',
          item.jobTitle ?? '',
          item.orgName ?? '',
          item.scheduledAt,
        )

        await sendEmail({
          to: item.candidateEmail ?? '',
          subject: emailTemplate.subject,
          html: emailTemplate.html,
        })

        // Mark reminder as sent
        await db
          .update(interview)
          .set({ reminderSentAt: now, updatedAt: now })
          .where(eq(interview.id, item.interviewId))

        sentCount++
      } catch (emailError) {
        console.error(
          `Failed to send reminder for interview ${item.interviewId}:`,
          emailError,
        )
      }
    }

    return NextResponse.json({ sent: sentCount, checked: reminderInterviews.length })
  } catch (error) {
    console.error('Interview reminders cron failed:', error)
    return NextResponse.json(
      { error: String(error), sent: 0 },
      { status: 500 },
    )
  }
}
