'use client'

import Link from 'next/link'
import {
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  UserRoundIcon,
} from 'lucide-react'
import { useState } from 'react'

import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Role = 'recruiter' | 'candidate'

const roles = {
  recruiter: {
    title: 'I’m hiring',
    description: 'Manage interviews, review evidence, and make the final decision.',
    icon: BriefcaseBusinessIcon,
    action: 'Sign in as recruiter',
    signUpAction: 'Create recruiter account',
  },
  candidate: {
    title: 'I have an interview',
    description: 'Check your invitation, prepare your setup, and join on time.',
    icon: UserRoundIcon,
    action: 'Sign in as candidate',
    signUpAction: 'Create candidate account',
  },
} as const

export function ProductEntry() {
  const [selectedRole, setSelectedRole] = useState<Role>('candidate')
  const selected = roles[selectedRole]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.entries(roles) as [Role, (typeof roles)[Role]][]).map(
          ([role, details]) => {
            const Icon = details.icon
            const isSelected = selectedRole === role
            return (
              <button
                key={role}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedRole(role)}
                className={cn(
                  'flex min-h-32 flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  isSelected ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/40',
                )}
              >
                <span className={cn('flex size-9 items-center justify-center rounded-lg', isSelected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground')}>
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-semibold">{details.title}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{details.description}</span>
                </span>
              </button>
            )
          },
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{selected.title}</CardTitle>
          <CardDescription>Sign in with your CoreLink account or create one to continue.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Link
            href={`/sign-in?role=${selectedRole}`}
            className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
          >
            {selected.action}
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
          <Link
            href={`/sign-up?role=${selectedRole}`}
            className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'w-full')}
          >
            {selected.signUpAction}
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
