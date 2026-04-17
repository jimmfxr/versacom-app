# E2E tests

Playwright tests that drive the real app end-to-end against a **separate** database.

## Setup (one-time)

1. Create a separate database for tests. On Neon, the simplest path is creating a
   branch from your dev branch — it shares the schema with copy-on-write semantics
   so it's free and fast. Locally, you can use Docker Postgres, etc. The only
   requirement is that it has the same schema as your dev DB.

2. Run migrations against it:
   ```sh
   DATABASE_URL="<your test url>" npx prisma db push
   ```

3. Create `.env.test.local` at the repo root:
   ```
   TEST_DATABASE_URL="<your test url>"
   TEST_DATABASE_URL_UNPOOLED="<your test url unpooled>"  # optional
   ```

   The harness refuses to run if `TEST_DATABASE_URL` is missing OR equals
   `DATABASE_URL` — this is a guard against accidentally polluting your dev data.

## Running

```sh
npm run test:e2e          # headless, full run
npm run test:e2e:ui       # Playwright UI mode for debugging
npm run test:e2e:headed   # watch the browser drive itself
```

The test runner spins up its own `next dev` server on port 3000. If you already
have one running, it'll reuse it.

## What's tested

`change-request.spec.ts` — the full crew → admin round-trip. A crew member edits
a panel key and submits it for approval; an admin sees the task appear via
polling, approves it, and the crew's screen auto-clears the green
"submitted" highlight + shows a success toast — no manual refresh required.

Each test seeds a fresh project + users with a unique `runId`, then deletes
exactly those rows on teardown.
