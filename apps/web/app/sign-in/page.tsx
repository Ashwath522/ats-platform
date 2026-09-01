import { auth } from '@/lib/auth'
import { getCurrentRole } from '@/app/actions/core'
import { parseAuthRole, roleRedirectPath } from '@/lib/auth-utils'
import { AuthForm } from '@/components/auth-form'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) {
    const role = await getCurrentRole()
    if (role) redirect(roleRedirectPath(role))
  }

  const { role: roleParam } = await searchParams
  const role = parseAuthRole(roleParam) ?? undefined

  return <AuthForm mode="sign-in" role={role} />
}
