import { auth } from '@/lib/auth'
import { getCurrentRole } from '@/app/actions/core'
import { roleRedirectPath } from '@/lib/auth-utils'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function RecruiterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in?role=recruiter')

  const role = await getCurrentRole()
  if (role === 'recruiter') return children
  if (role) redirect(roleRedirectPath(role))

  redirect('/sign-in?role=recruiter')
}
