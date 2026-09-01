import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  // Fetch app data scoped to session.user.id and render your dashboard here.
  return (
    <main className="min-h-svh bg-background p-8">
      <p className="text-sm text-muted-foreground">
        Signed in as {session.user.email}
      </p>
    </main>
  )
}
