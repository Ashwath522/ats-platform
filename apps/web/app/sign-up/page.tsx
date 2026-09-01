import { auth } from '@/lib/auth'
import { getCurrentRole } from '@/app/actions/core'
import { defaultSignUpRole, parseAuthRole, roleRedirectPath } from '@/lib/auth-utils'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'

export const dynamic = 'force-dynamic'

export default async function SignUpPage({
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
  const role = parseAuthRole(roleParam) ?? defaultSignUpRole()

  return <AuthForm mode="sign-up" role={role} />
}
