import {
  CalendarCheckIcon,
  CheckIcon,
  HeartHandshakeIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from 'lucide-react'

import { ProductEntry } from '@/components/product-entry'
import { Badge } from '@/components/ui/badge'

const trustPoints = [
  'Hiring decisions always stay human',
  'Evidence, never automatic accusations',
  'Candidate media is never recorded continuously',
] as const

export default function Page() {
  return (
    <main className="min-h-screen overflow-hidden">
      <header className="border-b bg-card/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <HeartHandshakeIcon aria-hidden="true" className="size-5" />
            </span>
            <div className="flex flex-col">
              <span className="font-semibold leading-none">CoreLink</span>
              <span className="mt-1 text-xs text-muted-foreground">
                Human-first interviews
              </span>
            </div>
          </div>
          <Badge variant="secondary">
            <ShieldCheckIcon data-icon="inline-start" aria-hidden="true" />
            Private & fair
          </Badge>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:px-6 md:py-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14">
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <Badge className="w-fit" variant="outline">
              <SparklesIcon data-icon="inline-start" aria-hidden="true" />
              AI-assisted. Human-decided.
            </Badge>
            <div className="flex flex-col gap-3">
              <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight md:text-6xl">
                Better interviews, with people at the center.
              </h1>
              <p className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
                CoreLink helps teams run structured interviews while giving every
                candidate a clear, respectful experience from invitation to final
                decision.
              </p>
            </div>
          </div>

          <div className="hidden grid-cols-2 gap-3 sm:grid">
            <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <CalendarCheckIcon aria-hidden="true" className="size-5" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-medium">Simple scheduling</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Clear times, reminders, and guided preparation.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <ShieldCheckIcon aria-hidden="true" className="size-5" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-medium">Responsible review</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Context and evidence support—not replace—people.
                </p>
              </div>
            </div>
          </div>

          <ul className="flex flex-col gap-2.5">
            {trustPoints.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ok text-ok-foreground">
                  <CheckIcon aria-hidden="true" className="size-3" />
                </span>
                <span className="leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="access-title" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="access-title" className="text-xl font-semibold">
              How are you using CoreLink?
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Choose an option to enter the right workspace.
            </p>
          </div>
          <ProductEntry />
        </section>
      </div>

      <footer className="mx-auto flex max-w-6xl items-center justify-center border-t px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground md:px-6">
        Built for fair interviews, informed decisions, and candidate dignity.
      </footer>
    </main>
  )
}
