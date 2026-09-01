'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertTriangle, CheckCircle2, BarChart3, Activity, Users, Shield } from 'lucide-react'
import { isAdmin as checkIsAdmin, getAdminScheduledInterviews } from '@/app/actions/core'

type AdminStats = {
  active_interviews?: number
  total_storage_mb?: number
  average_risk_score?: number | null
  recent_errors?: number
  high_risk_count?: number
  review_recommended_count?: number
  human_review_flags?: number
}

type RetentionSettings = {
  retention_days?: number
  last_run?: string
  last_run_deleted_count?: number
} | null

type ScheduledInterview = {
  id: number
  candidateName: string
  jobTitle: string
  recruiterEmail: string
  company: string
  scheduledAt: string
  status: string
  durationMinutes: number
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [retentionSettings, setRetentionSettings] = useState<RetentionSettings>(null)
  const [scheduledInterviews, setScheduledInterviews] = useState<ScheduledInterview[]>([])
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<
    { id: string; title: string; description: string; type: 'default' | 'destructive' | 'success' }[]
  >([])

  const addToast = (
    title: string,
    description: string,
    type: 'default' | 'destructive' | 'success',
  ) => {
    const id = Math.random().toString(36).substr(2, 9)
    setToasts((prev) => [...prev, { id, title, description, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }

  useEffect(() => {
    let isCancelled = false

    const loadAdminData = async () => {
      try {
        const adminOk = await checkIsAdmin()
        if (!adminOk) {
          if (!isCancelled) setLoading(false)
          return
        }

        const statsResponse = await fetch('/api/admin/stats')
        if (statsResponse.ok) {
          const statsData = await statsResponse.json()
          if (!isCancelled) setStats(statsData)
        }

        // Load retention settings
        const retentionResponse = await fetch('/api/admin/retention')
        if (retentionResponse.ok) {
          const retentionData = await retentionResponse.json()
          if (!isCancelled) setRetentionSettings(retentionData)
        }

        // Load scheduled interviews for pipeline overview
        const scheduled = await getAdminScheduledInterviews()
        if (!isCancelled) setScheduledInterviews(scheduled)
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to load admin data:', error)
          addToast('Error', 'Failed to load admin data', 'destructive')
        }
      } finally {
        if (!isCancelled) setLoading(false)
      }
    }

    loadAdminData()
    return () => {
      isCancelled = true
    }
  }, [])

  const handleUpdateRetention = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!retentionSettings) return

    try {
      const formData = new FormData(e.target as HTMLFormElement)
      const retentionDays = parseInt(formData.get('retentionDays') as string)

      const response = await fetch('/api/admin/retention', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ retention_days: retentionDays }),
      })

      if (response.ok) {
        const data = await response.json()
        setRetentionSettings(data)
        addToast('Success', 'Retention settings updated successfully', 'success')
      } else {
        addToast('Error', 'Failed to update retention settings', 'destructive')
      }
    } catch (error) {
      console.error('Error updating retention:', error)
      addToast('Error', 'Failed to update retention settings', 'destructive')
    }
  }

  const handleRunRetention = async () => {
    try {
      const response = await fetch('/api/admin/retention/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (response.ok) {
        const data = await response.json()
        addToast(
          'Success',
          `Retention job completed: ${data.deleted_count} files deleted, ${data.retained_count} retained`,
          'success',
        )
        const retentionResponse = await fetch('/api/admin/retention')
        if (retentionResponse.ok) {
          setRetentionSettings(await retentionResponse.json())
        }
      } else {
        addToast('Error', 'Failed to run retention job', 'destructive')
      }
    } catch (error) {
      console.error('Error running retention:', error)
      addToast('Error', 'Failed to run retention job', 'destructive')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        <p className="mt-4 text-muted-foreground">Loading admin dashboard…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Toast area */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-lg px-4 py-3 shadow-md text-sm ${
              toast.type === 'destructive'
                ? 'bg-red-600 text-white'
                : toast.type === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-background border'
            }`}
          >
            <p className="font-medium">{toast.title}</p>
            <p className="text-xs opacity-90">{toast.description}</p>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">System overview and controls</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-medium text-muted-foreground">Active Interviews</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">{stats?.active_interviews ?? 0}</p>
            <p className="text-sm text-muted-foreground">Currently in progress</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-medium text-muted-foreground">Storage Usage</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">{stats?.total_storage_mb?.toFixed(1) ?? 0} MB</p>
            <p className="text-sm text-muted-foreground">Estimated proctoring media</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-medium text-muted-foreground">Avg Risk Score</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">
              {stats?.average_risk_score != null ? stats.average_risk_score.toFixed(1) : 'N/A'}
            </p>
            <p className="text-sm text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-medium text-muted-foreground">Recent Errors</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">{stats?.recent_errors ?? 0}</p>
            <p className="text-sm text-muted-foreground">Failed jobs / cancelled interviews</p>
          </CardContent>
        </Card>
      </div>

      {/* Proctoring Overview */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-medium text-muted-foreground">High Risk Interviews</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.high_risk_count ?? 0}</p>
            <p className="text-xs text-muted-foreground">Risk score ≥ 80</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <h3 className="text-sm font-medium text-muted-foreground">Review Recommended</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.review_recommended_count ?? 0}</p>
            <p className="text-xs text-muted-foreground">Score variance &gt; 30</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-medium text-muted-foreground">Human Review Flags</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.human_review_flags ?? 0}</p>
            <p className="text-xs text-muted-foreground">Based on risk, variance, or feedback</p>
          </CardContent>
        </Card>
      </div>

      {/* Retention Controls */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">Retention Controls</h3>
            <Button variant="outline" size="sm" onClick={handleRunRetention} disabled={loading}>
              {loading ? 'Running…' : 'Run Retention Job'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">Current Retention Period</span>
            <span className="text-sm text-muted-foreground">
              {retentionSettings?.retention_days ?? 30} days
            </span>
          </div>

          <form onSubmit={handleUpdateRetention} className="space-y-4">
            <label className="flex items-center space-x-2 text-sm font-medium">
              <span>New Retention Period (days)</span>
              <Input
                type="number"
                name="retentionDays"
                min="1"
                max="365"
                defaultValue={retentionSettings?.retention_days || 30}
                className="w-24"
              />
            </label>
            <Button type="submit" variant="default" className="w-full">
              Update Retention Settings
            </Button>
          </form>

          {retentionSettings?.last_run && (
            <div className="border-t pt-4 flex items-center justify-between space-x-4">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Last Run</span>
                <p className="text-sm font-medium">
                  {new Date(retentionSettings.last_run).toLocaleString()}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {retentionSettings.last_run_deleted_count ?? 0} files deleted
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model / Config */}
      <Card>
        <CardHeader className="pb-4">
          <h3 className="text-lg font-bold">Model Configuration</h3>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <h4 className="font-medium mb-2">Risk Score Weights</h4>
            <div className="grid gap-4">
              {[
                ['Behavioral', '40%'],
                ['Engagement', '30%'],
                ['Concerns', '20%'],
                ['Consistency', '10%'],
              ].map(([label, pct]) => (
                <div key={label} className="border p-3 rounded flex items-center justify-between">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="font-mono text-sm">{pct}</span>
                </div>
              ))}
            </div>

            <h4 className="font-medium mt-4 mb-2">Feature Flags</h4>
            <div className="space-y-2 text-sm">
              {[
                ['DEBUG_CV', false],
                ['ENABLE_AUDIT_LOG', true],
                ['RETENTION_ENABLED', true],
              ].map(([name, val]) => (
                <div key={String(name)} className="flex items-center justify-between">
                  <span>{String(name)}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-mono ${
                      val ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {val ? 'ON' : 'OFF'}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Configuration values are defaults. In production, these would be configurable via
              environment variables or admin settings.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Scheduled Interviews Pipeline */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">Scheduled Interviews</h3>
            <span className="text-sm text-muted-foreground">{scheduledInterviews.length} upcoming</span>
          </div>
        </CardHeader>
        <CardContent>
          {scheduledInterviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No interviews currently scheduled or active.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Candidate</th>
                    <th className="pb-2 pr-4">Job</th>
                    <th className="pb-2 pr-4">Company</th>
                    <th className="pb-2 pr-4">Recruiter</th>
                    <th className="pb-2 pr-4">Scheduled</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {scheduledInterviews.map((iv) => (
                    <tr key={iv.id} className="hover:bg-muted/40">
                      <td className="py-2 pr-4 font-medium">{iv.candidateName}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{iv.jobTitle}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{iv.company}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{iv.recruiterEmail}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(iv.scheduledAt).toLocaleString()}
                      </td>
                      <td className="py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            iv.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : iv.status === 'baseline'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {iv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}