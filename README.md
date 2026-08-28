# BetterMe

Track what you did, what you spent and where your time went — then let a team of
AI agents tell you why you're broke and exactly what to do about it.

## What it does

**Daily** — log every expense, every block of time, and your work hours. A sticky
task bar reminds you what's due.

**Monday** — you enter your budget for lunch and dinner, your goals and your tasks
for the week. A *Budget Architect* checks those numbers against your actual
history, a *Meal Strategist* builds seven days of lunches and dinners that save at
least 2,000 calories versus takeout, and a *Game Plan Coach* lays out the week day
by day with a spend cap on each one.

**Friday** — five agents run over the week that just happened:

| Agent | Job |
|---|---|
| Spending Forensics | Where the money actually went; leaks, annualised |
| Cash Flow Analyst | The structural reason you're short, ranked |
| Time & Productivity Auditor | How your hours drove your spending |
| Meal & Calorie Strategist | What to cook instead, with the dollar and calorie maths |
| Chief Strategist | Reads all four, writes the post-mortem, grades the week, builds next week's plan |

The first four run in parallel over one shared data snapshot, then the strategist
synthesises. You get a breakdown, what you did wrong, what you should have done,
and a day-by-day game plan for next week.

**Any time** — a streaming chat coach with tools that query your real data
(spending by category, merchant frequency, budget status, time breakdown, savings
projections) before it answers.

**Bank** — optional Plaid connection pulls transactions in automatically.

## Stack

| Layer | Tech |
|---|---|
| Web | React 18, TypeScript, Vite, React Router, Recharts |
| API | Node 20+, TypeScript, Express, Prisma, PostgreSQL, JWT, node-cron |
| Agents | Python 3.11, FastAPI, Anthropic SDK (Claude Opus 5) |
| Bank | Plaid (`transactions/sync`) |
| Deploy | Render Blueprint (`render.yaml`) |

```
apps/web        React app
apps/api        REST API, auth, Prisma schema, scheduler, Plaid
services/agents Multi-agent service (specialists + orchestrator + chat)
```

## Running locally

You need Node 20+, Python 3.11+, and a PostgreSQL database.

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — your local Postgres
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `ENCRYPTION_KEY` — `openssl rand -hex 32`
- `JWT_SECRET` — any long random string
- `PLAID_CLIENT_ID` / `PLAID_SECRET` — optional, from dashboard.plaid.com

Create the schema and start the three processes:

```bash
npm run prisma:push
```

```bash
pip install -r services/agents/requirements.txt
```

```bash
npm run dev
```

```bash
npm run dev:agents
```

The app is at http://localhost:5173, the API at :4000, the agent service at :8000.

## Deploying to Render

1. Push this repo to GitHub.
2. In Render, **New → Blueprint**, point it at the repo. `render.yaml` provisions a
   Postgres database, the Python agent service, and the Node API + web service.
3. Set the two values Render can't generate:
   - `ANTHROPIC_API_KEY` on **betterme-agents**
   - `ENCRYPTION_KEY` on **betterme-api** (`openssl rand -hex 32`)
   - optionally `PLAID_CLIENT_ID` / `PLAID_SECRET` on **betterme-api**
4. Deploy. Everything else — database URL, JWT secret, the shared secret between
   the two services — is wired automatically by the blueprint.

On Render's free tier services sleep when idle, which stops the in-process
scheduler. If you need the Friday review to fire reliably, set
`ENABLE_SCHEDULER=false` and add three Render Cron Jobs that POST to the API with
the `X-Cron-Secret` header:

```bash
curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://YOUR-API.onrender.com/api/cron/friday-review
```

`/api/cron/monday-prompt` and `/api/cron/bank-sync` work the same way.

## Notes

- Bank access tokens are encrypted with AES-256-GCM before being stored.
- Agent output is rendered through an escaping markdown renderer, so model text
  can't inject markup.
- The agents give budgeting and habit guidance. They are not a licensed financial
  advisor and don't give investment, tax or credit-product advice.
