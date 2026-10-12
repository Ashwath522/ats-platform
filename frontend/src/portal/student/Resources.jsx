import React from 'react'
import { PageHeader, Card, EmptyState } from '../../ui/index.jsx'

/** Learning Resources — implementation pending (see docs/ui-reference/assets/images/11-learning-resources.png). */
export default function Page() {
  return (
    <>
      <PageHeader title="Learning Resources" />
      <Card><EmptyState title="Coming up" text="This page is being built." /></Card>
    </>
  )
}
