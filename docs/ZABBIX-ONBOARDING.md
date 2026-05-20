# Zabbix integration — onboarding for a fresh Claude session

You are starting from zero on the Zabbix part of Nodal Control. **None of it is built yet.** This doc is what you need to know before writing a single line.

Read these in order:

1. `AGENTS.md` (root) — warns that this is a modified Next.js, read `node_modules/next/dist/docs/` before you reach for any framework API from memory.
2. `docs/PRD.md` §1 (Product Overview) and the bullet "Monitoring page (planned Phase 3 — not started)" in the TL;DR.
3. `docs/PRD-v1-april2026.md` §11 (Monitoring, Phase 3) — original scope. The PRD mentions Grafana, not Zabbix; the user has since decided Zabbix is the upstream system. Treat Grafana wording as historical.
4. `prisma/schema.prisma` — `Equipment` (line ~301) and `ProjectMember` (line ~170). Both already have `ipAddress: String?`. This is the join key into Zabbix.
5. `src/lib/notifications.ts` — the `notify*` helpers and `safeSend()`. Zabbix alerts route into the existing in-app notification system, not a separate channel.
6. `src/app/api/notifications/count/route.ts` and `src/app/notifications/` — recently shipped, the pattern Zabbix alert ingestion should follow.

---

## What we're building

A bridge between Zabbix (the customer's existing monitoring system) and Nodal Control so that:

- Each `Equipment` row in Nodal that has an `ipAddress` corresponds to a Zabbix host. Devices in scope: panels, wireless beltpacks, hardwire beltpacks, switches, antennas, audio, mults — anything with an IP.
- The customer's Zabbix instance fires alerts (host down, SFP signal low, switch CPU high, RF battery low). Nodal receives them and surfaces them as in-app notifications (the bell + `/notifications`) plus, eventually, a Monitoring page that shows live device health per project.
- Direction is **read-mostly** from Nodal's side. We do not configure Zabbix from Nodal in v1. We pull state and accept webhooks/pushes.

What we are **not** building in v1:
- A replacement for Zabbix.
- Configuration of hosts/items/triggers from Nodal.
- Historical metric storage in Postgres (Zabbix already does this; if a chart is needed, we proxy).

---

## Open questions to ask the user before coding

Do not guess these. Ask up front:

1. **Zabbix instance access** — URL, API token, network reachability from Vercel (is it public, behind VPN, behind a proxy)?
2. **Push or pull?**
   - Pull: Nodal calls Zabbix API on a schedule for problem state.
   - Push: Zabbix sends webhooks to `/api/zabbix/webhook` on alert.
   - Most likely answer is both: webhooks for low-latency alerts, pull for the "current health" view.
3. **Host identity** — how does Nodal's `Equipment.ipAddress` map to a Zabbix host? By IP, by hostname pattern, by tag, by inventory field? There must be a deterministic mapping. If naming is inconsistent across shows, we need a per-project override.
4. **Multi-tenant / multi-project** — does each show have its own Zabbix host group, or is everything in one flat namespace? This decides whether we filter by host group or by tag.
5. **Auth** — Zabbix 6.0+ supports API tokens; older versions only have `user.login`. Confirm version.
6. **Severity routing** — which Zabbix severities become in-app notifications, which page someone, which are silent. Default proposed: Disaster/High → notification + bell, Average → notification only, Warning/Information → Monitoring page only.

Until those answers exist, stop and ask. Don't scaffold against guesses — the schema choices fall out of question 3.

---

## What's already in place that you should reuse, not rebuild

- **`Notification` model** (`prisma/schema.prisma`) — has `userId`, `projectId`, `title`, `body`, `url`, `tag`, `read`. Zabbix alerts become rows here. The `tag` field is intended for dedupe (same trigger firing twice should not create two rows — use the Zabbix event/trigger id as the tag).
- **`safeSend()` in `src/lib/notifications.ts`** — writes the DB row and tries web-push in one call. Use it. Do not write a parallel notification path.
- **Notification routing pattern** — every `notify*` helper resolves a recipient list (usually project admins) then calls `safeSend(userIds, payload, projectId)`. Match this for `notifyZabbixAlert()` etc.
- **Bell unread badge + `/notifications` page** — already shipped, polls `/api/notifications/count` every 5s. Nothing to add there; new alert rows just appear.
- **`Equipment.ipAddress`** — the join key. Don't add a separate `zabbixHostId` column without asking; an indirect lookup table (`ZabbixHostMapping`) might be cleaner because IPs can change mid-show.

---

## Likely file layout (proposal, confirm before creating)

```
src/lib/zabbix/
  client.ts              // thin Zabbix JSON-RPC client (token-based)
  map.ts                 // Equipment <-> Zabbix host resolution
  ingest.ts              // turn a Zabbix problem into a Notification + side effects
src/app/api/zabbix/
  webhook/route.ts       // POST endpoint Zabbix calls on trigger fire
  health/route.ts        // GET — current problem state for a project (proxied)
src/app/projects/[id]/monitoring/
  page.tsx               // Phase 3 UI, per-project device health board
```

Webhook auth: shared secret in `process.env.ZABBIX_WEBHOOK_SECRET`, sent as `X-Zabbix-Token` header. Reject without it. Do not accept unauthenticated POSTs.

---

## Stack and conventions you must follow

- **Next.js 16 App Router, RSC by default.** Server components fetch via Prisma directly. Client components only when there's state/interaction.
- **Server actions** use `'use server'` and `revalidatePath('/...')` to push fresh data back.
- **No new dependencies without asking.** A Zabbix JSON-RPC client is ~80 lines of `fetch`; do not pull in `node-zabbix-api` or similar.
- **Migrations**: edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <slug>`. The build does NOT run `prisma migrate deploy` on Vercel — flag any migration so the user can apply it to prod Neon manually.
- **Notifications writes are idempotent on `tag`.** Use `prisma.notification.upsert` keyed on `(userId, tag)` if you don't want duplicate rows when a trigger re-fires before being read.
- **Don't add `console.log`** in shipped code. The existing notification helpers use `console.warn` only on failure paths.
- **Tailwind chip-inactive convention**: `border border-white/10 px-3 py-1.5 text-xs text-gray-200`. Cyan accent is `#22a7d3`. Match these — see `src/app/notifications/notifications-list.tsx` for an example surface.

---

## What "done" looks like for v1 of this integration

1. Configured admin can paste a Zabbix URL + API token into project settings (or env, ask user which).
2. When a Zabbix trigger fires for a host that maps to an `Equipment` row, a `Notification` row is created for that project's admins, and the bell badge increments within ~5s.
3. Clicking the notification opens the affected equipment's edit panel (URL: `/projects/<id>?tab=equipment&equipmentId=<n>`).
4. A minimum `/projects/<id>/monitoring` page lists every equipment with current Zabbix status (OK / problem with severity). No charts yet.
5. Zabbix is the source of truth — Nodal never writes to Zabbix in v1.

Everything else (acks, suppression rules, charts, on-call routing) is v2+. Don't build it on spec.

---

## When you hand back to the user

Always ask before:
- Adding a migration (production DB is on Neon and migrations aren't auto-applied on Vercel).
- Adding an env var (user needs to set it on Vercel too).
- Adding a new top-level route (`/monitoring`, `/api/zabbix/*`).
- Hitting the real Zabbix instance from your dev environment (could trigger acks/clears the customer didn't want).

Stay terse in chat — the user prefers short status updates over essays. The codebase has thorough comments where it matters; mimic that, don't narrate.
