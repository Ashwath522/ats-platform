export type AuthRole = 'admin' | 'recruiter' | 'candidate'

export function roleRedirectPath(role: AuthRole | null | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'recruiter':
      return '/recruiter'
    case 'candidate':
      return '/candidate'
    default:
      return '/sign-in'
  }
}

export function parseAuthRole(
  value: string | undefined,
): AuthRole | null {
  if (value === 'recruiter' || value === 'candidate' || value === 'admin') {
    return value
  }
  return null
}

/** Default sign-up role when query param is missing. */
export function defaultSignUpRole(): AuthRole {
  return 'candidate'
}
