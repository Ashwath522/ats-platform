'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  assignRoleAfterSignUp,
  precheckSignIn,
  precheckSignUp,
} from '@/app/actions/auth'
import { authClient } from '@/lib/auth-client'
import type { AuthRole } from '@/lib/auth-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const roleOptions: { value: AuthRole; label: string; description: string }[] = [
  { value: 'candidate', label: 'Candidate', description: 'Join interviews' },
  { value: 'recruiter', label: 'Recruiter', description: 'Schedule and review' },
  { value: 'admin', label: 'Admin', description: 'System controls' },
]

export function AuthForm({
  mode,
  role: initialRole,
}: {
  mode: 'sign-in' | 'sign-up'
  role?: AuthRole
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AuthRole>(initialRole ?? 'candidate')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isSignUp = mode === 'sign-up'
  const signUpHref = `/sign-up?role=${role}`
  const signInHref = `/sign-in?role=${role}`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (isSignUp) {
        if (!name.trim()) {
          setError('Name is required.')
          return
        }

        const precheck = await precheckSignUp(email)
        if (!precheck.ok) {
          setError(precheck.error)
          return
        }

        const { data: signUpData, error: signUpError } = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: name.trim(),
        })

        if (signUpError) {
          setError(signUpError.message ?? 'Could not create account.')
          return
        }

        const userId = signUpData?.user?.id
        if (!userId) {
          setError('Account created but setup failed. Try signing in.')
          return
        }

        const assigned = await assignRoleAfterSignUp(userId, role, name)
        if (!assigned.ok) {
          setError(assigned.error)
          return
        }

        router.replace(assigned.redirectTo)
        router.refresh()
        return
      }

      const precheck = await precheckSignIn(email)
      if (!precheck.ok) {
        setError(precheck.error)
        return
      }

      const { error: signInError } = await authClient.signIn.email({
        email: email.trim(),
        password,
      })

      if (signInError) {
        setError('Invalid credentials')
        return
      }

      router.replace(precheck.redirectTo)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-svh bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {isSignUp ? 'Create an account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isSignUp
              ? 'Choose your role and create your CoreLink account'
              : 'Sign in to your account to continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isSignUp && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Role</legend>
                <div className="grid gap-2">
                  {roleOptions.map((option) => (
                    <label
                      key={option.value}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
                        role === option.value ? 'border-primary bg-primary/5' : 'border-input',
                      )}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={option.value}
                        checked={role === option.value}
                        onChange={() => setRole(option.value)}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium">{option.label}</span>
                        <span className="block text-muted-foreground">{option.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
              {error === 'Account not found. Sign up' && (
                <>
                  {' '}
                  <Link href={signUpHref} className="underline underline-offset-4">
                    Sign up
                  </Link>
                </>
              )}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading
              ? 'Please wait...'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-6">
          {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          <Link
            href={isSignUp ? signInHref : signUpHref}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </Link>
        </p>
      </Card>
    </main>
  )
}
