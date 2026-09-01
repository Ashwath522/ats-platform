import { auth } from '../lib/auth'
import { db } from '../lib/db'
import {
  user,
  userRole,
  recruiterProfile,
  candidateProfile,
  job,
  pipeline,
  interview,
} from '../lib/db/schema'
import { and, eq } from 'drizzle-orm'

const PASSWORD = 'password123'

async function ensureUser(params: {
  email: string
  name: string
  role: 'admin' | 'recruiter' | 'candidate'
}) {
  const normalizedEmail = params.email.toLowerCase()
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, normalizedEmail)).limit(1)

  let userId = existing[0]?.id
  if (!userId) {
    const response = await auth.api.signUpEmail({
      body: {
        email: normalizedEmail,
        password: PASSWORD,
        name: params.name,
      },
    })
    userId = response.user.id
  }

  const roleRows = await db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, userId))
    .limit(1)

  if (!roleRows.length) {
    await db.insert(userRole).values({ userId, role: params.role })
  }

  if (params.role === 'recruiter') {
    const profileRows = await db
      .select({ id: recruiterProfile.id })
      .from(recruiterProfile)
      .where(eq(recruiterProfile.userId, userId))
      .limit(1)

    if (!profileRows.length) {
      await db.insert(recruiterProfile).values({
        userId,
        organizationName: 'CoreLink Demo Co.',
      })
    }
  }

  if (params.role === 'candidate') {
    const profileRows = await db
      .select({ id: candidateProfile.id })
      .from(candidateProfile)
      .where(eq(candidateProfile.userId, userId))
      .limit(1)

    if (!profileRows.length) {
      await db.insert(candidateProfile).values({
        userId,
        fullName: params.name,
      })
    }
  }

  return userId
}

async function main() {
  // Create admin
  await ensureUser({
    email: 'admin@corelink.test',
    name: 'Demo Admin',
    role: 'admin',
  })

  // Create 4 recruiters with distinct organizations
  const recruiters = [
    { email: 'recruiter1@corelink.test', name: 'Recruiter One', org: 'Nova Systems' },
    { email: 'recruiter2@corelink.test', name: 'Recruiter Two', org: 'Blue Ridge Tech' },
    { email: 'recruiter3@corelink.test', name: 'Recruiter Three', org: 'Solstice Labs' },
    { email: 'recruiter4@corelink.test', name: 'Recruiter Four', org: 'Ironclad Analytics' },
  ]

  const recruiterIds: string[] = []
  const recruiterOrgs: Record<string, string> = {}

  for (const recruiter of recruiters) {
    const recruiterId = await ensureUser({
      email: recruiter.email,
      name: recruiter.name,
      role: 'recruiter',
    })
    recruiterIds.push(recruiterId)
    recruiterOrgs[recruiterId] = recruiter.org

    // Update the recruiter profile with custom org name
    await db
      .update(recruiterProfile)
      .set({ organizationName: recruiter.org })
      .where(eq(recruiterProfile.userId, recruiterId))
  }

  // Create 8 jobs (2 per recruiter) with distinct titles
  const jobTitles = [
    'Backend Engineer',
    'Frontend Engineer',
    'Data Analyst',
    'Product Designer',
    'QA Engineer',
    'DevOps Engineer',
    'Full Stack Developer',
    'Solutions Architect',
  ]

  const jobIds: number[] = []
  let jobIndex = 0

  for (let i = 0; i < recruiterIds.length; i++) {
    for (let j = 0; j < 2; j++) {
      const title = jobTitles[jobIndex % jobTitles.length]
      const description = `Exciting opportunity for a talented ${title.toLowerCase()} to join our team.`

      const existingJob = await db
        .select({ id: job.id })
        .from(job)
        .where(and(eq(job.userId, recruiterIds[i]), eq(job.title, title)))
        .limit(1)

      let jobId = existingJob[0]?.id
      if (!jobId) {
        const result = await db
          .insert(job)
          .values({
            userId: recruiterIds[i],
            title,
            description,
            status: 'active',
          })
          .returning({ id: job.id })
        jobId = result[0].id
      }

      jobIds.push(jobId)
      jobIndex++
    }
  }

  // Create 20 candidates with realistic names
  const candidateNames = [
    'Alexandra Chen',
    'Benjamin Martinez',
    'Charlotte Patel',
    'Daniel Rodriguez',
    'Emma Thompson',
    'Faisal Ahmed',
    'Grace Lee',
    'Henry Wang',
    'Isabella Garcia',
    'James O\'Brien',
    'Keisha Williams',
    'Liam Kowalski',
    'Mia Rossi',
    'Noah Schmidt',
    'Olivia Anderson',
    'Priya Kumar',
    'Quinn Mitchell',
    'Rachel Dubois',
    'Samuel Jackson',
    'Tanya Petrov',
  ]

  const candidateIds: { userId: string; profileId: number }[] = []

  for (let i = 0; i < 20; i++) {
    const candidateUserId = await ensureUser({
      email: `candidate${i + 1}@corelink.test`,
      name: candidateNames[i],
      role: 'candidate',
    })

    const profileRows = await db
      .select({ id: candidateProfile.id })
      .from(candidateProfile)
      .where(eq(candidateProfile.userId, candidateUserId))
      .limit(1)

    if (profileRows[0]) {
      candidateIds.push({
        userId: candidateUserId,
        profileId: profileRows[0].id,
      })
    }
  }

  // Distribute candidates across jobs with varied stages
  // Target distribution: 5 screening, 5 interview, 5 shortlist, 3 hired, 2 rejected
  const stages = [
    'screening',
    'screening',
    'screening',
    'screening',
    'screening',
    'interview',
    'interview',
    'interview',
    'interview',
    'interview',
    'shortlist',
    'shortlist',
    'shortlist',
    'shortlist',
    'shortlist',
    'hired',
    'hired',
    'hired',
    'rejected',
    'rejected',
  ]

  const pipelineData: { candidateId: number; jobId: number; recruiterId: string; stage: string }[] = []

  for (let i = 0; i < candidateIds.length; i++) {
    const candidate = candidateIds[i]
    const jobId = jobIds[i % jobIds.length]
    const recruiterIdIndex = Math.floor(i / 5) % recruiterIds.length
    const recruiterId = recruiterIds[recruiterIdIndex]
    const stage = stages[i]

    // Check if pipeline already exists
    const existing = await db
      .select({ id: pipeline.id })
      .from(pipeline)
      .where(and(eq(pipeline.jobId, jobId), eq(pipeline.candidateId, candidate.profileId)))
      .limit(1)

    if (!existing.length) {
      await db
        .insert(pipeline)
        .values({
          userId: recruiterId,
          jobId,
          candidateId: candidate.profileId,
          stage,
        })
        .returning({ id: pipeline.id })

      pipelineData.push({
        candidateId: candidate.profileId,
        jobId,
        recruiterId,
        stage,
      })
    } else {
      pipelineData.push({
        candidateId: candidate.profileId,
        jobId,
        recruiterId,
        stage,
      })
    }
  }

  // Create interview records for pipeline stages 'interview' and later
  for (let i = 0; i < pipelineData.length; i++) {
    const item = pipelineData[i]

    if (['interview', 'shortlist', 'hired', 'rejected'].includes(item.stage)) {
      const pipelineRow = await db
        .select({ id: pipeline.id })
        .from(pipeline)
        .where(and(eq(pipeline.jobId, item.jobId), eq(pipeline.candidateId, item.candidateId)))
        .limit(1)

      if (pipelineRow.length === 0) continue

      const pipelineId = pipelineRow[0].id
      const candidate = candidateIds.find((c) => c.profileId === item.candidateId)
      if (!candidate) continue

      // Check if interview already exists for this pipeline
      const existingInterview = await db
        .select({ id: interview.id })
        .from(interview)
        .where(eq(interview.pipelineId, pipelineId))
        .limit(1)

      if (existingInterview.length > 0) continue

      // Calculate scheduledAt: future for 'interview', past for 'shortlist'/'hired'/'rejected'
      let scheduledAt: Date
      if (item.stage === 'interview') {
        // Schedule within next 5 days
        const daysAhead = Math.floor(Math.random() * 5) + 1
        scheduledAt = new Date()
        scheduledAt.setDate(scheduledAt.getDate() + daysAhead)
        scheduledAt.setHours(Math.floor(Math.random() * 8) + 9, Math.floor(Math.random() * 60), 0, 0)
      } else {
        // Schedule within past 5 days
        const daysBefore = Math.floor(Math.random() * 5) + 1
        scheduledAt = new Date()
        scheduledAt.setDate(scheduledAt.getDate() - daysBefore)
        scheduledAt.setHours(Math.floor(Math.random() * 8) + 9, Math.floor(Math.random() * 60), 0, 0)
      }

      const status = item.stage === 'interview' ? 'scheduled' : 'completed'

      const interviewResult = await db
        .insert(interview)
        .values({
          userId: candidate.userId,
          recruiterId: item.recruiterId,
          pipelineId,
          scheduledAt,
          status,
          durationMinutes: 30,
          roomUrl: `/candidate?interview=${pipelineId}`,
        })
        .returning({ id: interview.id })

      if (interviewResult.length > 0) {
        await db
          .update(pipeline)
          .set({ interviewId: interviewResult[0].id })
          .where(eq(pipeline.id, pipelineId))
      }
    }
  }

  // Generate summary table
  console.log('\n╔════════════════════════════════════════════════════════════════╗')
  console.log('║                        SEED COMPLETE                            ║')
  console.log('╚════════════════════════════════════════════════════════════════╝\n')

  console.log('RECRUITERS & ORGANIZATIONS:')
  console.log('─────────────────────────────────────────────────────────────────')
  for (const recruiter of recruiters) {
    console.log(`  ${recruiter.email.padEnd(28)} | ${recruiter.org}`)
  }

  console.log('\nCANDIDATES BY PIPELINE STAGE:')
  console.log('─────────────────────────────────────────────────────────────────')

  const stageCounts = {
    screening: 0,
    interview: 0,
    shortlist: 0,
    hired: 0,
    rejected: 0,
  }

  for (const item of pipelineData) {
    if (item.stage in stageCounts) {
      stageCounts[item.stage as keyof typeof stageCounts]++
    }
  }

  for (const [stage, count] of Object.entries(stageCounts)) {
    console.log(`  ${stage.padEnd(12)} : ${count.toString().padStart(2)} candidates`)
  }

  console.log('\nLOGIN CREDENTIALS (password: password123):')
  console.log('─────────────────────────────────────────────────────────────────')
  console.log(`  Admin        : admin@corelink.test`)
  for (const recruiter of recruiters) {
    console.log(`  ${recruiter.name.padEnd(12)} : ${recruiter.email}`)
  }
  console.log(`  Candidates   : candidate1@corelink.test ... candidate20@corelink.test`)
  console.log('\n')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    process.exit(0)
  })
