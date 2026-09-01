import { sendEmail, shortlistedEmail, interviewScheduledEmail, interviewReminderEmail } from '../lib/email'

const to = process.argv[2]

if (!to) {
  console.error('Usage: pnpm test:email your@email.com')
  process.exit(1)
}

async function main() {
  const scheduledAt = new Date(Date.now() + 20 * 60 * 1000) // 20 minutes from now

  console.log('--- 1. Shortlisted email ---')
  const shortlisted = shortlistedEmail('Test Candidate', 'Backend Engineer', 'Nova Systems')
  await sendEmail({ to, subject: shortlisted.subject, html: shortlisted.html })

  console.log('--- 2. Interview scheduled email ---')
  const scheduled = interviewScheduledEmail('Test Candidate', 'Backend Engineer', 'Nova Systems', scheduledAt)
  await sendEmail({ to, subject: scheduled.subject, html: scheduled.html })

  console.log('--- 3. Interview reminder email (20-min-before) ---')
  const reminder = interviewReminderEmail('Test Candidate', 'Backend Engineer', 'Nova Systems', scheduledAt)
  await sendEmail({ to, subject: reminder.subject, html: reminder.html })

  console.log('Done. Check your inbox for 3 separate emails (and check spam).')
}

main()
