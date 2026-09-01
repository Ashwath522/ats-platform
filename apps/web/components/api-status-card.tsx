'use client'

import { ActivityIcon, CheckCircle2Icon, RefreshCwIcon } from 'lucide-react'
import useSWR from 'swr'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { fetcher, type ServiceHealth } from '@/lib/system'

export function ApiStatusCard() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<ServiceHealth>(
    '/api/health',
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
    },
  )

  const state = isLoading ? 'Checking' : error ? 'Unavailable' : 'Operational'
  const checkedAt = data?.timestamp
    ? new Intl.DateTimeFormat('en', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(data.timestamp))
    : 'Waiting for first response'

  return (
    <Card aria-live="polite">
      <CardHeader>
        <div className="flex items-center gap-2 text-primary">
          <ActivityIcon aria-hidden="true" className="size-5" />
          <CardTitle>FastAPI service</CardTitle>
        </div>
        <CardDescription>
          Live check through the production service route.
        </CardDescription>
        <CardAction>
          <Badge variant={error ? 'destructive' : data ? 'default' : 'secondary'}>
            {data && <CheckCircle2Icon data-icon="inline-start" />}
            {state}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Version
            </dt>
            <dd className="font-mono text-sm">{data?.version ?? '—'}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Last check
            </dt>
            <dd className="text-sm">{checkedAt}</dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter className="justify-between gap-4">
        <span className="text-xs text-muted-foreground">
          Refreshes every 30 seconds
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={isValidating}
          onClick={() => void mutate()}
        >
          <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
          {isValidating ? 'Checking' : 'Check now'}
        </Button>
      </CardFooter>
    </Card>
  )
}
