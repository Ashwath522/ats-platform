import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const fromEmail = process.env.RESEND_FROM_EMAIL || 'CoreLink <notifications@yourdomain.test>'

const resend = apiKey ? new Resend(apiKey) : null

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}): Promise<void> {
  try {
    if (!apiKey) {
      console.warn('[Email] RESEND_API_KEY not set, skipping email send to:', to)
      return
    }

    if (!resend) {
      console.warn('[Email] Resend not initialized, skipping email send to:', to)
      return
    }

    await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html,
    })

    console.log(`[Email] Sent to ${to}: ${subject}`)
  } catch (error) {
    console.error(`[Email] Failed to send email to ${to}:`, error)
  }
}

/**
 * Email template: candidate shortlisted
 */
export function shortlistedEmail(
  candidateName: string,
  jobTitle: string,
  orgName: string,
): { subject: string; html: string } {
  return {
    subject: `Great news! You've been shortlisted for the ${jobTitle} position`,
    html: `
      <h1>Congratulations, ${candidateName}!</h1>
      <p>We're excited to let you know that you've been shortlisted for the <strong>${jobTitle}</strong> position at <strong>${orgName}</strong>.</p>
      <p>Our team was impressed with your application and qualifications. Next steps will be communicated to you shortly.</p>
      <p>Best regards,<br>CoreLink Team</p>
    `,
  }
}

/**
 * Email template: interview scheduled
 */
export function interviewScheduledEmail(
  candidateName: string,
  jobTitle: string,
  orgName: string,
  scheduledAt: Date,
): { subject: string; html: string } {
  const formattedDate = scheduledAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const formattedTime = scheduledAt.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  return {
    subject: `Your interview is scheduled for ${formattedDate}`,
    html: `
      <h1>Interview Scheduled!</h1>
      <p>Hi ${candidateName},</p>
      <p>Your interview for the <strong>${jobTitle}</strong> position at <strong>${orgName}</strong> has been scheduled.</p>
      <p><strong>Date & Time:</strong> ${formattedDate} at ${formattedTime}</p>
      <p>Please make sure you're in a quiet environment with a stable internet connection. You'll receive a link to join the interview 15 minutes before the scheduled time.</p>
      <p>Good luck!<br>CoreLink Team</p>
    `,
  }
}

/**
 * Email template: interview reminder (20 minutes before)
 */
export function interviewReminderEmail(
  candidateName: string,
  jobTitle: string,
  orgName: string,
  scheduledAt: Date,
): { subject: string; html: string } {
  const formattedTime = scheduledAt.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  return {
    subject: `Reminder: Your interview starts in 20 minutes`,
    html: `
      <h1>Interview Reminder</h1>
      <p>Hi ${candidateName},</p>
      <p>This is a reminder that your interview for the <strong>${jobTitle}</strong> position at <strong>${orgName}</strong> starts in 20 minutes at <strong>${formattedTime}</strong>.</p>
      <p>Please have your camera, microphone, and internet connection ready. Join the interview room now!</p>
      <p>Good luck!<br>CoreLink Team</p>
    `,
  }
}
