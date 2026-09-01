import { pgTable, text, timestamp, boolean, serial, integer, jsonb } from 'drizzle-orm/pg-core'

// --- Better Auth required tables -------------------------------------------
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

// --- CoreLink role and entity tables ----------------------------------------

export const userRole = pgTable('userRole', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  role: text('role').notNull(), // 'recruiter' | 'candidate' | 'admin'
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const recruiterProfile = pgTable('recruiterProfile', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  organizationName: text('organizationName').notNull(),
  jobsCreated: integer('jobsCreated').notNull().default(0),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const candidateProfile = pgTable('candidateProfile', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  fullName: text('fullName').notNull(),
  phone: text('phone'),
  linkedinUrl: text('linkedinUrl'),
  consentGiven: boolean('consentGiven').notNull().default(false),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const job = pgTable('job', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(), // recruiter userId
  title: text('title').notNull(),
  description: text('description'),
  questionMode: text('questionMode'), // 'ai' | 'custom'
  questionSet: jsonb('questionSet'), // { mode, questions: [{ question, expectedPoints? }] }
  status: text('status').notNull().default('active'), // 'active' | 'closed'
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const pipeline = pgTable('pipeline', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(), // recruiter userId
  jobId: integer('jobId').notNull(),
  candidateId: integer('candidateId').notNull(),
  stage: text('stage').notNull().default('applied'), // 'applied' | 'screening' | 'interview' | 'evaluation' | 'shortlist' | 'offer' | 'hired' | 'rejected'
  interviewId: integer('interviewId'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const interview = pgTable('interview', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(), // candidate userId
  recruiterId: text('recruiterId').notNull(), // recruiter userId
  pipelineId: integer('pipelineId').notNull(),
  status: text('status').notNull().default('scheduled'), // 'scheduled' | 'baseline' | 'active' | 'completed' | 'cancelled' | 'missed' | 'rescheduled'
  scheduledAt: timestamp('scheduledAt').notNull(),
  startedAt: timestamp('startedAt'),
  completedAt: timestamp('completedAt'),
  reminderSentAt: timestamp('reminderSentAt'),
  durationMinutes: integer('durationMinutes'),
  roomUrl: text('roomUrl'),
  questionSet: jsonb('questionSet'), // copied from job batch at schedule time
  riskScore: integer('riskScore'), // 0-100, null until available
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const evidence = pgTable('evidence', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(), // candidate userId
  interviewId: integer('interviewId').notNull(),
  evidenceType: text('evidenceType').notNull(), // 'video' | 'audio' | 'transcript' | 'screen'
  pathname: text('pathname').notNull(), // Blob pathname
  metadata: jsonb('metadata'), // { duration, format, etc }
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const evaluation = pgTable('evaluation', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(), // recruiter userId
  interviewId: integer('interviewId').notNull(),
  score: integer('score'), // 0-100, null until submitted
  decision: text('decision'), // 'pass' | 'fail' | 'maybe' | null
  feedback: text('feedback'),
  submittedAt: timestamp('submittedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userId: text('userId'), // nullable for system actions
  action: text('action').notNull(),
  entityType: text('entityType').notNull(), // e.g., 'interview', 'candidate', 'job', 'pipeline', 'evaluation'
  entityId: integer('entityId'),
  details: jsonb('details'), // { oldStatus, newStatus, note, modelVersion, ip, userAgent, etc }
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})