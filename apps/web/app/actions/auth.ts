'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import {
  user,
  userRole,
  recruiterProfile,
  candidateProfile,
  job,
  pipeline,
} from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { AuthRole, roleRedirectPath } from '@/lib/auth-utils'

async function getRoleForUser(userId: string): Promise<AuthRole | null> {
  const rows = await db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, userId))
    .limit(1)

  const role = rows[0]?.role
  return role === 'admin' || role === 'recruiter' || role === 'candidate' ? role : null
}

async function ensureRecruiterFixtures(userId: string) {
  const existingJobs = await db
    .select({ id: job.id })
    .from(job)
    .where(eq(job.userId, userId))
    .limit(1)

  if (existingJobs.length > 0) return existingJobs[0].id

  const [createdJob] = await db
    .insert(job)
    .values({
      userId,
      title: 'Senior Frontend Engineer',
      description: 'Default opening for scheduling interviews.',
      status: 'active',
    })
    .returning({ id: job.id })

  return createdJob.id
}

async function assignRole(userId: string, name: string, role: AuthRole) {
  const existingRole = await db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, userId))
    .limit(1)

  if (!existingRole.length) {
    await db.insert(userRole).values({ userId, role })
  }

  if (role === 'admin') return

  if (role === 'recruiter') {
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
    await ensureRecruiterFixtures(userId)
    return
  }

  const profileRows = await db
    .select({ id: candidateProfile.id })
    .from(candidateProfile)
    .where(eq(candidateProfile.userId, userId))
    .limit(1)

  if (!profileRows.length) {
    await db.insert(candidateProfile).values({
      userId,
      fullName: name,
    })
  }

  const recruiterRows = await db
    .select({ userId: userRole.userId })
    .from(userRole)
    .where(eq(userRole.role, 'recruiter'))
    .limit(1)

  if (!recruiterRows.length) return

  const recruiterId = recruiterRows[0].userId
  const jobId = await ensureRecruiterFixtures(recruiterId)
  const candidateProfileRows = await db
    .select({ id: candidateProfile.id })
    .from(candidateProfile)
    .where(eq(candidateProfile.userId, userId))
    .limit(1)

  if (!candidateProfileRows.length) return

  const existingPipeline = await db
    .select({ id: pipeline.id })
    .from(pipeline)
    .where(
      and(
        eq(pipeline.jobId, jobId),
        eq(pipeline.candidateId, candidateProfileRows[0].id),
      ),
    )
    .limit(1)

  if (existingPipeline.length > 0) return

  await db.insert(pipeline).values({
    userId: recruiterId,
    jobId,
    candidateId: candidateProfileRows[0].id,
    stage: 'screening',
  })
}

export async function precheckSignIn(
  email: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    return { ok: false, error: 'Email is required.' }
  }

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalizedEmail))
    .limit(1)

  if (!existing.length) {
    return { ok: false, error: 'Account not found. Sign up' }
  }

  const role = await getRoleForUser(existing[0].id)
  if (!role) {
    return {
      ok: false,
      error: 'Account is missing a role. Please sign up again or contact support.',
    }
  }

  return { ok: true, redirectTo: roleRedirectPath(role) }
}

export async function precheckSignUp(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    return { ok: false, error: 'Email is required.' }
  }

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalizedEmail))
    .limit(1)

  if (existing.length) {
    return { ok: false, error: 'An account with this email already exists. Sign in instead.' }
  }

  return { ok: true }
}

export async function assignRoleAfterSignUp(
  userId: string,
  role: AuthRole,
  name: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  if (!userId) {
    return { ok: false, error: 'Sign-up succeeded but user id was missing. Try signing in.' }
  }

  try {
    await assignRole(userId, name.trim(), role)
    return { ok: true, redirectTo: roleRedirectPath(role) }
  } catch (error) {
    console.error('assignRoleAfterSignUp failed:', error)
    return { ok: false, error: 'Account created but role setup failed. Try signing in.' }
  }
}

export async function getPostAuthRedirect(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return '/sign-in'

  const role = await getRoleForUser(session.user.id)
  return roleRedirectPath(role)
}
