import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** My Profile — implementation pending (see docs/ui-reference/assets/images/05-my-profile.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="My Profile" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
