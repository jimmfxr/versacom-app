# Nodal Control — Product Requirements Document

**Version:** 2.0 (current-state rewrite)
**Updated:** 2026-04-17
**Author:** Jimmy Xiloj / Versacom (ATK / Clair Global)
**Status:** Living document — describes what is actually built and shipping, not future phases.

> Source of truth for "what is this app" when returning to the codebase after time away. Previous PRD (April 12, 2026) archived as `PRD-v1-april2026.md` for historical reference.

---

## TL;DR

Nodal Control is a web-based intercom management platform for live production shows (Grammys, Super Bowl, Oscars). It replaces the Google Sheets + Riedel hardware-programming + manual deployment tracking workflow with a single source of truth. Built with Next.js 16 App Router, Tailwind, Prisma, and Neon Postgres, deployed on Vercel.

**What's built today (v2):**

- PIN-based auth with project PIN + personal PIN flow
- Three operational pages: **Projects list**, **Project detail** (Equipment/Team/Pick List tabs), **Panel Studio** (per-equipment key editor)
- **Dashboard** and **My Equipment** (role-specific landings)
- **Admin Tasks** page with lockout + change-request review inbox
- Four roles: `admin`, `manager`, `crew`, `user` — each with specific permissions
- Change-request approval workflow for panel key edits (submitted → applied/rejected)
- QR code generation for project join links
- Mobile-first nav with drag-to-dismiss gesture
- Device reachability probing with caching + cross-tab sync

**What's not built:**

- Monitoring page (planned Phase 3 — not started)
- NFG / asset tracking (Phase 4 — schema exists, no UI)
- Rack designer (Phase 2 — schema exists, no UI)
- Distribution page (the old "master sheet" idea — replaced in practice by the Equipment tab on Project detail)

---

## 1. Product Overview

### 1.1 What Nodal Control does

Clair Global / ATK / Versacom operate a comms crew at major live broadcast events. For each show, a designer creates a "pick list" (named communication channels — Cameras, FOH, Stage Manager, etc.), assigns keys on physical intercom panels to those channels for each crew member, and tracks equipment deployment across dozens of stations. Today that work lives across Google Sheets, manual Riedel frame programming, and ad-hoc spreadsheets.

Nodal Control consolidates all of it:

| Real-world task | Nodal Control feature |
|---|---|
| Maintain the master show sheet | **Projects** list + **Project detail** tabs |
| Assign keys to a person's panel | **Panel Studio** |
| Request mid-show key changes | **Change request** flow (crew submits → admin resolves) |
| Track who has what gear and its deploy status | **Equipment tab** + **My Equipment** |
| Add crew to the show quickly | **Project PIN** + **Join QR code** |
| Lock out someone who forgot their PIN | **Admin Tasks → Lockouts** |

### 1.2 Target users

- **Primary:** Clair Global / ATK / Versacom staff running comms at high-end live events
- **Secondary:** Contract crew working one-off shows — they're added to a single project, never see others

### 1.3 Proven scope (what actually works in production)

As of this writing, the app supports the full show-prep and show-run workflow for a single concurrent production:

- Admin creates a project, shares a 4-digit PIN + QR code with crew
- Crew members scan QR, type their name, set a personal PIN, and are in
- Admin assigns gear via the Equipment tab, assigns crew to gear
- Designers define pick list (CONF / IFB / Audio_IO / GRP items)
- Crew open their assigned Panel Studio, assign pick-list items to keys, submit for approval
- Admin sees change requests in Tasks inbox, approves or denies per-key
- Crew see live updates to their panel when admin resolves

Untested at scale: multiple concurrent shows, hundreds of crew, live event stress conditions.

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack dev server) |
| Styling | Tailwind CSS 4 |
| Language | TypeScript |
| ORM | Prisma 7 |
| Database | Neon Postgres (serverless driver) |
| Hosting | Vercel |
| Auth | PIN-based (bcrypt-hashed, session cookie) |
| Real-time | **No WebSockets** — polling every 5s for Tasks badge + Panel Studio fingerprint sync |
| UI components | Headless UI + Heroicons |
| Forms | Custom components (`FormInput`, `SearchableSelect`, `ComboboxInput`) |
| QR | `qrcode.react` |
| Gestures | `@use-gesture/react` (for mobile nav drag-to-dismiss) |

**Why no WebSockets:** Vercel serverless doesn't host persistent connections cleanly, and the use case tolerates 5-second latency on task notifications. Polling is cheap and simple.

**Why Neon serverless driver:** Talks to Postgres over HTTP-tunneled WebSockets, works inside Vercel functions. Added a retry wrapper (`src/lib/db.ts`) to silently recover from transient connection errors.

---

## 3. User Roles & Permissions

Role is **per-project** (`ProjectMember.role`). A person can be an `admin` on one project and a `user` on another.

### 3.1 Role definitions

| Role | Shorthand | Typical person |
|---|---|---|
| `admin` | Final approver | Show design lead / Versacom staff |
| `manager` | Design + planning | Production manager — sees but can't change deploy status or approve keys |
| `crew` | On-site operator | A1, A2, stage manager — edits own panel, deploys gear |
| `user` | Read-mostly | Talent, producers — view their gear, submit key requests |

### 3.2 Permission matrix

Legend: ✅ can do, ❌ cannot, 👁 view only

| Action | admin | manager | crew | user |
|---|---|---|---|---|
| View Projects list | ✅ | ✅ (only own) | ✅ (only own) | ❌ |
| View Project detail page | ✅ | ✅ | ✅ | ❌ (proxy redirects to `/my-equipment`) |
| Create / rename / archive a project | ✅ | ❌ | ❌ | ❌ |
| Edit Team tab (add / remove / role) | ✅ | ✅ | ❌ | ❌ |
| Edit Pick List tab | ✅ | ✅ | ❌ | ❌ |
| Edit Equipment tab (add, rename, assign) | ✅ | ❌ | ✅ | ❌ |
| Change equipment deploy status | ✅ | 👁 | ✅ | ❌ |
| Edit own Panel Studio keys | ✅ | ✅ | ✅ | ✅ |
| Edit someone else's Panel Studio keys | ✅ | ✅ | ❌ | ❌ |
| Submit key changes directly (no approval) | ✅ | ❌ | ❌ | ❌ |
| Submit key changes via approval flow | N/A | ✅ | ✅ | ✅ |
| Review & approve/deny change requests | ✅ | ❌ (only endorse) | ❌ | ❌ |
| See Admin Tasks page | ✅ | ❌ | ❌ | ❌ |
| Unlock a locked-out account | ✅ | ❌ | ❌ | ❌ |
| See "Show QR" button | ✅ | ✅ | ✅ | ❌ |
| See "Add Member" button | ✅ | ✅ | ❌ | ❌ |

### 3.3 Proxy-level gating

`src/proxy.ts` computes `isUserOnly = every membership's role === 'user'`. If true, the proxy allows access only to:

- `/my-equipment` and sub-paths
- `/projects/{id}/panel/{equipmentId}` (their own panel, accessed from My Equipment cards)

Every other route redirects them back to `/my-equipment`. A person with mixed roles across projects (e.g., `user` on one, `crew` on another) is *not* user-only — they get normal navigation, and the per-page role checks take over.

---

## 4. Page Inventory

Every authenticated page is wrapped by `AppShell` (navbar + toast container). Non-admins don't see the Tasks nav item.

| Path | Purpose | Roles |
|---|---|---|
| `/login` | Sign in with name + personal PIN | Everyone |
| `/login/join` | Join a project with the project PIN | Everyone (accepts `?pin=` for QR pre-fill) |
| `/login/forgot-pin` | Recovery flow (limited — contact admin) | Everyone |
| `/` (Dashboard) | Summary of a selected project | admin / manager / crew (not user-only) |
| `/projects` | List of projects accessible to the viewer | admin (all) / manager / crew (own) |
| `/projects/[id]` | Project detail with tabs (Equipment / Team / Pick List / My Equipment) | Any member of the project |
| `/projects/[id]/panel/[equipmentId]` | Panel Studio — key editor for a specific panel | Members per role rules |
| `/my-equipment` | Equipment assigned to the current user | Everyone |
| `/admin` | Tasks inbox (lockouts + change requests) | admin only — non-admins redirected to `/` |
| `/admin/lockouts` | Drill-down view of all locked users | admin |

### 4.1 Project detail tabs

| Tab | Shows | Who sees it |
|---|---|---|
| **Equipment** | Auto-named gear (`PNL 1`, `WLBP 3`, `SW 2`, …) with hardware type, assignee, IP, deploy status | admin / manager / crew |
| **Team** | Members with role, position, assigned equipment, expansion count, first-login status (Active/Pending) | admin / manager / crew |
| **Pick List** | CONF / IFB / Audio_IO / GRP communication functions. Usage display shows who has each item on their panel. | admin / manager / crew |
| **My Equipment** (nested) | Shows ONLY when the current user is `crew` on this project — surfaces just the gear assigned to them | crew |

### 4.2 Panel Studio modes

Same route (`/projects/[id]/panel/[equipmentId]`) renders different modes:

| Mode | Trigger | Capabilities |
|---|---|---|
| **Own panel, crew/user/manager** | Default when viewing a panel assigned to you | Edit keys → submit for approval |
| **Own panel, admin** | Admin viewing a panel assigned to them | Edit keys → applied immediately (no approval) |
| **Others' panel, admin/manager** | Navigating to a panel not assigned to you | Edit keys → changes require admin approval (manager = endorsement) |
| **Review mode** | URL has `?review={memberId}` (admin clicks Review on a Tasks card) | Shows the submitted changes, allows per-key approve/deny |

---

## 5. Core Workflows

### 5.1 Join a project (new crew member)

```
Admin            Crew
  │                │
  │ share QR ─────►│ scans
  │                │
  │                ▼
  │            /login/join?pin=1234
  │            (PIN pre-filled)
  │                │
  │                │ types first + last name
  │                │ taps Join
  │                ▼
  │            Server: creates User (no pin), ProjectMember
  │                │
  │                ▼
  │            Prompted to create personal PIN
  │                │
  │                │ types PIN twice
  │                ▼
  │            Server: hashes pin → stores on User
  │                │
  │                ▼
  │            Redirected to /login → signs in
  │                │
  │                ▼
  │            Landing: / (dashboard) or /my-equipment (user-only)
```

If the user already exists in the system (returning crew member), `joinProject` detects by name and either adds them to the project or signs them in.

### 5.2 Change request (non-admin edits keys)

```
Crew                    Admin
  │                       │
  │ opens Panel Studio    │
  │ edits key 5 "Cameras" │
  │ clicks Submit         │
  │                       │
  ▼                       │
ChangeRequest created     │
status = submitted        │
KeyDraft created          │
status = submitted        │
                          │
  polls every 5s          │ polls /admin
  waits for fingerprint   │ every 5s
  change                  │
                          │ badge count updates
                          │ → "Tasks: 1"
                          │
                          ▼
                        Clicks Tasks → Review
                          │
                          │ sees submitted keys
                          │ can toggle each between
                          │ Approve / Deny
                          │
                          │ clicks Approve all (or Deny,
                          │ or mix)
                          ▼
                        resolveChangeRequests()
                        Applied items → PanelKey.pickListItemId updated
                        Denied items → PanelKey untouched
                        CR.status = applied or rejected
                        KeyDraft(submitted) deleted
                          │
  polling picks up ◄──────┤
  new server fingerprint
  │
  ▼
initializeKeys resets local state to server truth.
recentResolutions has the id of the just-resolved CR.
For each item: if currentPanelKey.pickListItemId == newValue → approved;
               otherwise → denied.
  │
  ▼
Toasts:
  - "Your panel changes are live" for approved keys
  - "Keys 3, 5 denied" for denied keys
  (both fire if mixed outcome)
```

See `src/app/projects/[id]/panel/[equipmentId]/page.tsx` for the server side and `panel-studio.tsx` for the client sync.

### 5.3 Equipment bulk add with custom IDs

Equipment add form: `ID | Category | Hardware | Quantity`.

- ID blank → system uses category prefix (`PNL`, `WLBP`, `HWBP`, `SW`, `ANT`, `AUD`) + continue-past-highest
- ID filled → literal sequence from user's value, preserving pad width and separator
  - `P001` + Qty 10 → `P001, P002, … P010`
  - `PNL 15` + Qty 5 → `PNL 15, PNL 16, … PNL 19`
  - `P1` + Qty 5 → `P1, P2, P3, P4, P5`
- Collisions in range → skipped; generator continues until N new items exist or `10 × quantity` iterations (safety cap)

Same model applied to **Pick List**: ID field + Quantity field, with Name field as an additional switch:

- Name filled → Quantity locks to 1 (single named item)
- Name blank + ID blank → auto-gen with type prefix (`C1, C2, …` for CONF, `IF1, IF2, …` for IFB, etc.)
- Name blank + ID filled → sequence from user's start; each item's name defaults to its code (rename later)

### 5.4 HWBP exclusion from PTP picker

Panel Studio picker's PTP section lists members as callable targets. Members whose only equipment is `hardwire_bp` are **excluded** because PTP'ing to a hardwire beltpack requires more studio resources than typically available. Members with HWBP + any other gear (panel / wireless BP) stay in the list — the PTP rings their non-HWBP device. Logic in `panel/[equipmentId]/page.tsx`:

```ts
const onlyHwbp = m.equipment.every((e) => e.category === 'hardwire_bp')
```

---

## 6. Data Model Summary

13 models total. See `uml-erd.md` for the diagram.

### Phase 1 models (built + in use)

| Model | Purpose | Notable fields |
|---|---|---|
| `User` | Person with a login | `firstName`, `lastName`, `pin` (nullable until first-login setup), `failedAttempts`, `lockedUntil` |
| `Project` | A show | `name`, `pin` (4-digit join code), `status`, `createdById` |
| `ProjectMember` | User's membership in a project | `role`, `position`, `location`, `hardwareType` (legacy — equipment carries this now), `deployStatus` (per-member, less-used now) |
| `PickListItem` | A named comm function | `code`, `name`, `type` (PTP/CONF/IFB/Audio_IO/GRP) |
| `PanelKey` | One physical key on someone's panel | `keyIndex`, `page` (main/shift), `expansion` (0-N), `pickListItemId`, `triggerMode` |
| `KeyDraft` | Unsaved edit to a PanelKey | `editedById`, `pickListItemId`, `triggerMode`, `status` (draft/submitted) |
| `ChangeRequest` | Bundle of key edits awaiting approval | `status` (draft/submitted/mgr_endorsed/applied/rejected/discarded), `submittedById`, `targetMemberId`, `resolvedAt` |
| `ChangeRequestItem` | Per-key diff within a change request | `panelKeyId`, `fieldChanged`, `previousValue`, `newValue` |
| `AccessRequest` | Not currently used in UI | (kept in schema for future project-access flow) |

### Phase 2-4 models (schema present, no UI yet)

| Model | Future purpose |
|---|---|
| `Equipment` | The actual piece of gear — **used heavily now** (v2 promoted this out of future-only) |
| `Asset` | Warehouse asset with QR code, serial number, owner |
| `RackTemplate` / `RackSlot` | Rack designer (Phase 2) |
| `NfgReport` | "Not Functioning" reports for damaged gear |

`Equipment` was originally slated for Phase 2 but ended up being central to v2 — the Equipment tab, auto-generated names, deploy status tracking all live on this model. Schema is identical to the Phase-2 plan; UI matured faster than expected.

---

## 7. Key Technical Patterns

### 7.1 Session cookie

Login sets an HTTP-only cookie named `session` containing a JSON blob:

```json
{
  "user": { "id": 1, "firstName": "Jimmy", "lastName": "Xiloj" },
  "memberships": [
    { "id": 5, "role": "admin", "position": null, "project": { "id": 3, "name": "Grammys 2026" } }
  ]
}
```

`getSession()` in `src/lib/session.ts` reads + parses this. **Everything authentication-related flows from the cookie** — no JWT, no refresh, no external auth.

### 7.2 Proxy (middleware)

`src/proxy.ts` runs on every request. Redirects unauthenticated users to `/login` and enforces the user-only route lockdown described in §3.3.

### 7.3 Prisma client with retry

`src/lib/db.ts` wraps `PrismaClient` with a `$extends` query middleware that retries up to 2 times on transient Neon WebSocket errors. Narrow allowlist (ErrorEvent name, Prisma codes `P1001/P1002/P1017`, WebSocket / ECONNRESET / "terminating connection" in message). Real query errors bubble up unchanged.

### 7.4 Polling + fingerprint sync (Panel Studio)

Panel Studio never refreshes from the server directly. Instead:

1. Every 5s (while the crew has submitted keys), the client calls `router.refresh()`.
2. Server re-runs the page's data fetch.
3. Client computes a **fingerprint** from the returned PanelKey data + any recentResolutions.
4. If the fingerprint differs from the previous one, the client `setKeys(initializeKeys(...))` — resetting local state to match server truth.
5. If the sync included new resolutions, the client fires approve/deny toasts accordingly.

This means the crew doesn't need to manually reload to see admin's approval (or denial) — it happens within one polling cycle.

### 7.5 Polling + cache (Tasks badge)

`src/components/app-shell.tsx` fetches `/api/admin/task-count` every 5s (only if current user is admin) and displays the count next to the Tasks nav item. Count is cached in `sessionStorage` keyed `task-count-cache` so navigating between pages doesn't flash the badge back to 0 while the next fetch is in flight. The cache is hydrated inside a `useEffect` (not `useState` initializer) to avoid SSR hydration mismatch.

### 7.6 Device reachability caching (`src/hooks/use-device-reachability.ts`)

Probes each equipment IP via `fetch({ mode: 'no-cors' })` + `<img>` fallback. Sessions cache results in `sessionStorage` (TTL 10s) and broadcast via `BroadcastChannel('device-reachability')` so multiple tabs don't duplicate probe traffic. Probes with response time < 25ms are rejected as false positives — mobile networks reject requests to private IPs instantly, which the browser misreads as success.

### 7.7 Mobile nav

`src/components/navbar.tsx`:

- Desktop: horizontal tabs with cyan underline on current route
- Mobile: fullscreen overlay with nav cards, press-feedback (scale + cyan flash), **drag-to-dismiss** gesture via `@use-gesture/react`
- Closes on swipe up > 30% of viewport OR a flick (velocity > 0.5 px/ms). Uses inline translateY during drag to follow finger, pins inline translate after close so there's no "ghost" flash between dismiss animation ending and Headless UI's leave animation starting

### 7.8 Deploy status dropdown

`src/components/deploy-status-select.tsx`: Headless UI `Listbox` rendering a colored pill button. Options show a colored dot matching the badge tint + checkmark on current. Colors centralized in `src/lib/deploy-status.ts`:

- `na` → gray
- `deployed` → yellow
- `done` → green
- `returned` → blue
- `not-needed` → red
- `damaged` → purple

### 7.9 Naturally-sorted IDs

Auto-generated pick list codes and equipment names are **not zero-padded** (`C1, C2, … C10` instead of `C001, C002, … C010`). A `naturalCompare` helper in `src/app/projects/[id]/project-page.tsx` and within Panel Studio's picker grouping sorts codes numerically ("C2" before "C10") rather than lexicographically.

---

## 8. Known Shortcomings / Parking Lot

- **AppShell remounts on every navigation** → Tasks badge briefly flashes 0 despite sessionStorage cache. Deeper fix is moving AppShell to a Next.js route-group layout. Tracked but not yet tackled.
- **Bulk paste importer** (paste PDF text → parse → preview → bulk add) was started then parked; waiting on sample data from managers to know the real paste format.
- **Playwright E2E test suite** scaffolded in `tests/e2e/` but requires a `TEST_DATABASE_URL` that's never been set up. Single spec (`change-request.spec.ts`) exists as the first candidate.
- **Monitoring page / NFG UI / Rack designer** — schema present, no UI. Explicitly deferred from v2 scope.
- **ChangeRequestItem has no per-item status field.** Current resolution sets the CR to `applied` or `rejected` at the bundle level; per-item approve/deny is inferred by comparing `newValue` to the current `PanelKey` — works for the 95% case but breaks if another edit happens in the ~60s window between resolution and crew polling.
- **`riedelId` on ProjectMember** is legacy from the original Riedel-integration plan. No current code reads or writes it. Leave alone until the monitoring phase starts.

---

## 9. Source of Truth for Each Concern

When returning to the codebase, these are the files to re-read first:

| Concern | File |
|---|---|
| Database models | `prisma/schema.prisma` |
| Session / auth | `src/lib/session.ts`, `src/app/api/auth/login/route.ts` |
| Route protection | `src/proxy.ts` |
| DB client + retry | `src/lib/db.ts` |
| Role derivation | Each page's `page.tsx` (server component) |
| Tasks badge logic | `src/components/app-shell.tsx` + `src/app/api/admin/task-count/route.ts` |
| Panel Studio sync + fingerprint | `src/app/projects/[id]/panel/[equipmentId]/panel-studio.tsx` (find `serverFingerprint` + the effect that reads it) |
| Change request resolve action | `src/app/projects/[id]/panel/[equipmentId]/actions.ts` — `resolveChangeRequests` |
| Equipment bulk add | `src/app/projects/[id]/distribution/actions.ts` — `bulkCreateEquipment` |
| Pick list bulk add | `src/app/projects/[id]/picklist-actions.ts` — `createPickListItem` |
| Deploy status colors | `src/lib/deploy-status.ts` |
| Mobile nav gesture | `src/components/navbar.tsx` (`MobileNavPanel`) |
| Reachability hook | `src/hooks/use-device-reachability.ts` |
| QR code display | `src/app/projects/[id]/project-page.tsx` (`QRCodeSVG` import) |

---

## 10. Related Documents

- `uml-erd.md` — Entity relationship diagram (Mermaid)
- `uml-sequence-diagrams.md` — Sequence flows for key operations
- `uml-state-diagrams.md` — ChangeRequest lifecycle, deploy status transitions
- `uml-use-case.md` — Use cases per role
- `user-flow.md` — End-user narrative flows
- `product-decisions.md` — Why we chose specific designs (with history)
- `PRD-v1-april2026.md` — Original PRD (archived April 12, 2026 plan)
