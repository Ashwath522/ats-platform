# CoreLink AI Platform

CoreLink is an AI-powered interview platform with real-time proctoring and adaptive voice interviews.

## Features

- **Auth & Role Redirects**: Secure login with specialized dashboards for Admin, Recruiter, and Candidate roles.
- **Flexible Job Setup**: Create jobs with AI-generated questions or custom question sets.
- **Voice-First Interviews**: High-quality voice-only candidate answers with adaptive follow-ups powered by Nemotron/OpenRouter.
- **Real-time Proctoring**: Multi-signal cheat detection (Face, Eyes, Body, Objects) with live risk scoring.
- **Live Recruiter View**: Real-time monitor for active interviews with signal visualization and RED alerts for high-severity events.
- **Evidence Management**: Detailed session history with high-severity snapshots and event timelines.
- **Session Integrity**: Automated blocking of re-attendance after interview completion.

## Getting Started

### Prerequisites

- [pnpm](https://pnpm.io/) (v10 recommended)
- PostgreSQL
- Redis
- OpenRouter API Key

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Set up environment variables:
   ```bash
   cp apps/web/.env.example apps/web/.env.local
   # Edit apps/web/.env.local with your credentials
   ```
4. Initialize the database:
   ```bash
   cd apps/web
   pnpm db:push
   pnpm db:seed
   ```

### Running the App

```bash
pnpm dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

## Test Accounts

All accounts use the password: `password123`

- **Recruiter**: `recruiter@corelink.test`
- **Admin**: `admin@corelink.test`
- **Candidates**: `candidate1@corelink.test`, `candidate2@corelink.test`

## Project Structure

- `apps/web`: Next.js frontend and API.
- `infra`: Docker Compose for local infrastructure (PostgreSQL, Redis, MinIO).
- `models`: Proctoring/AI model definitions.
