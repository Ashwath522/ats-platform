import { db } from '../lib/db'
import { interview, pipeline, candidateProfile, user } from '../lib/db/schema'
import { eq, and } from 'drizzle-orm'

async function main() {
  const email = process.argv[2] ?? 'candidate6@corelink.test'

  const rows = await db
    .select({
      pipelineId: pipeline.id,
      candidateUserId: candidateProfile.userId,
      recruiterId: pipeline.userId,
    })
    .from(pipeline)
    .innerJoin(candidateProfile, eq(pipeline.candidateId, candidateProfile.id))
    .innerJoin(user, eq(candidateProfile.userId, user.id))
    .where(eq(user.email, email))
    .limit(1)

  if (!rows.length) {
    console.error(`No pipeline found for ${email}`)
    process.exit(1)
  }

  const { pipelineId, candidateUserId, recruiterId } = rows[0]

  const existing = await db
    .select({ id: interview.id })
    .from(interview)
    .where(and(eq(interview.pipelineId, pipelineId), eq(interview.status, 'scheduled')))
    .limit(1)

  const now = new Date()

  if (existing.length) {
    await db
      .update(interview)
      .set({ scheduledAt: now, status: 'scheduled', durationMinutes: 60, recruiterId })
      .where(eq(interview.id, existing[0].id))
    console.log(`Updated existing interview #${existing[0].id} for ${email} to start NOW.`)
  } else {
    const created = await db
      .insert(interview)
      .values({
        pipelineId,
        userId: candidateUserId,
        recruiterId,
        scheduledAt: now,
        durationMinutes: 60,
        status: 'scheduled',
      })
      .returning({ id: interview.id })
    console.log(`Created new interview #${created[0].id} for ${email} starting NOW.`)
  }

  console.log(`Log in as ${email} / password123, go to /candidate, and it should now show "Join" available.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
