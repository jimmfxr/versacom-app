# Nodal Control — Product Requirements Document

**Version:** 2.5 (Switch Studio — per-switch chassis with port-level VLAN profile assignment)
**Updated:** 2026-06-08
**Author:** Jimmy Xiloj / Versacom (ATK / Clair Global)
**Status:** Living document — describes what is actually built and shipping, not future phases.

> Source of truth for "what is this app" when returning to the codebase after time away. Previous PRD (April 12, 2026) archived as `PRD-v1-april2026.md` for historical reference.

---

## TL;DR

Nodal Control is a web-based intercom management platform for live production shows (Grammys, Super Bowl, Oscars). It replaces the Google Sheets + Riedel hardware-programming + manual deployment tracking workflow with a single source of truth. Built with Next.js 16 App Router, Tailwind, Prisma, and Neon Postgres, deployed on Vercel.

**What's built today (v2):**

- PIN-based auth with project PIN + personal PIN flow + auto-login after first-time PIN setup
- Operational pages: **Projects list**, **Comms** (the project detail page — Equipment/Team/Pick List/Plots/My Equipment tabs), **Radios** (Radio Equipment + Channels/Zones tabs), **Panel Studio** (per-equipment key editor), **Profile** (PIN + notification prefs, accessible to every role including user-only)
- **Dashboard** with project switcher, kiosk-style header pin, swipe-carousel distribution cards on mobile
- **My Equipment** unified across roles (admin/manager browse mode redirects directly into Panel Studio)
- **Tasks** page — `/admin` for admins (CR review + lockouts), `/tasks` for crew (deploy + return tasks). Both surface a polled badge in the navbar.
- Four roles: `admin`, `manager`, `crew`, `user` — each with specific permissions; **`admin` on any project promotes the user to "global admin"** (sees every project)
- **Equipment-scoped key editing + change requests** — multi-device members (e.g. HWBP 1 + PNL 3 on the same crew member) keep separate key state per device, and admin reviews are split per device.
- Change-request approval workflow with green "submitted" border that survives navigation away and back (hydrated from unresolved `ChangeRequestItem` rows on the panel-page loader)
- **Panel-level Copy / Paste** clipboard (sessionStorage) for cloning a panel's keys onto another user
- **Per-key clipboard** (Cmd/Ctrl-C / V) for copying one key's assignment + trigger mode
- QR code generation for project join links + **crew kiosk page** with name + position field (`/projects/[id]/kiosk`)
- Mobile-first nav with drag-to-dismiss gesture, chip-style nav cards, and global haptic feedback (`navigator.vibrate` on `pointerdown` for buttons + `[data-haptic]` rows)
- iOS PWA polish: safe-area inset reservation on `AppShell`, `overscroll-behavior: contain` to block horizontal rubber-band, touch-action discipline on the Dashboard
- Device reachability probing with caching + cross-tab sync
- Admin-toggled **Return phase** — when active, crew see "done" gear as Return tasks alongside Deploy tasks
- **Flat-card visual language** across list surfaces (Projects, Tasks, My Equipment, Project Details tabs, Kiosk pending list, Admin tasks). See PD-014.
- **Radios feature** — `/radios` Equipment tab with the 5-state status enum (`na` / `out` / `returned` / `damaged` / `lost`), per-radio status dropdown, and a Channels/Zones tab for tuning groups
- **Barcode scanner** at `/radios/scan` — continuous `@zxing/browser` decode with three branches (unknown / silent auto-return / assignment-prompt). See PD-018.
- **Comms + Radios header chrome** — QR + Kiosk on Comms, QR + Scanner on Radios, all to the left of the project dropdown (PD-019)
- **Location rename** on the Pick List — tapping a location chip renames every row in that location at once
- **Mobile UI sweep** — bigger buttons, full-width stacks on small screens, project row chip on the left, half-row project dropdowns. See PD-022 + PD-023.
- **Rack designer (v2.4)** — Comms project gets a Racks tab. Each `RackTemplate` row expands inline into a full "RackStudio" (chassis + device library + slot editor). Drag/drop a preset onto an RU to place it; drag an existing slot to reposition; tap an empty RU to arm-then-pick. Slots can be linked to a real `Equipment` row (switches + audio) so deploy status, location, model, and IP flow through. A chrome-free `/preview` page renders both faces side-by-side on desktop or as a carousel on mobile — operator-facing view, with a labeled Close button matching the rest of the studios. See PD-024 through PD-030.
- **Switch Studio (NEW in v2.5)** — Tapping a NETGEAR M4250-family switch ID on the Equipment card opens a dedicated chassis visualization at `/projects/[id]/switch/[equipmentId]`. Renders all RJ45 + SFP ports laid out on a real chassis (2 rows for 26P+4F / 40P+4F / 24X8F8V; 1 row for 9P+1F + 16F), each port colored by its assigned VLAN profile and stamped with its VLAN ID. Tap a port → popover with the global VLAN profile pool (Comms Dante, AES67, Management, VPN Transfer, etc.) + Trunk toggle + Unassign. Admin + crew can edit; manager view-only; user blocked. VLAN profiles live in a global `VlanProfile` pool seeded from the company-wide hex chart; per-switch state lives in `SwitchPort` rows lazily seeded on first open from the model's default convention (1–12 CommsDante1, 13–24 AES67_1, top trunks Management). See PD-031, PD-032.

**What's not built:**

- Monitoring page (planned Phase 3 — not started)
- NFG / asset tracking (Phase 4 — schema exists, no UI)
- Distribution page (the old "master sheet" idea — replaced in practice by the Equipment tab on Project detail)
- Label / sticker printing (Brother P-touch integration — see §11 Future Work)
- Web push notifications (planned for Tasks badge so it doesn't depend on a foregrounded tab)
- Half-RU device slots — RTS PS21 is the real-world half-RU device tracked as 1U for now (see PD-024)

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
| Plan rack layouts before truck-pack | **Racks tab → RackStudio** (drag/drop on chassis) |
| Show ops the rack at a glance | **Rack Preview** (operator-facing, both faces) |
| Plan switch VLAN port assignments | **Switch Studio** (per-switch chassis + port-level VLAN picker) |

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

### 3.0 Global admin promotion

Holding `role === 'admin'` on **any** membership makes the user a "global admin" for the whole app. Global admins:

- See every project in `/projects` (the list query skips the `memberId in [...]` filter when `isAdmin` is true — see `src/app/projects/page.tsx`)
- Can open any project detail page even on shows where they have no membership row
- Get the Tasks nav item (badge fed by `/api/admin/task-count`)
- Can act as admin on any project's Panel Studio (`isAdminGlobal` is plumbed into `panel-studio.tsx` and unlocks Copy / Paste + direct-save behavior)

`manager` / `crew` / `user` roles are scoped to their memberships only — they only see projects they're a member of, and per-page role checks gate everything else. A user with **only** `user` memberships is "user-only" and gets the locked-down experience described in §3.3.

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
| `/` (Dashboard) | Summary of a selected project; project switcher in the header | admin / manager / crew (not user-only) |
| `/projects` | List of projects accessible to the viewer | admin (global, sees all) / manager / crew (own only) |
| `/projects/[id]` | **Comms** — project detail with tabs (Equipment / Team / Pick List / Plots / Racks / My Equipment). Header exposes QR + Kiosk icon buttons to the left of the project dropdown. The Racks tab can deep-link to a specific rack via `?tab=racks&expand=<rackId>` — the URL stays in sync as the operator opens / closes inline rack expansions (PD-028). | Any member of the project; global admins also allowed |
| `/projects/[id]/panel/[equipmentId]` | Panel Studio — key editor for a specific panel; `?from=my-equipment` puts it in browse mode | Members per role rules |
| `/projects/[id]/racks/[rackId]` | Standalone Rack Studio page (deep link). Same component as the inline expansion under `?tab=racks` but with its own page chrome (back button + project switcher in the header). | Members per role rules |
| `/projects/[id]/racks/[rackId]/preview` | Operator-facing Rack Preview. Renders both Front + Rear chassis side-by-side on desktop or as a horizontal scroll-snap carousel with cyan dot indicators on mobile. AppShell suppresses navbar + bottom-nav on this route (same treatment as `/kiosk` and `/zones`). Labeled **Close** button (matches Rack Studio / Panel Studio / Switch Studio chrome) returns to `?tab=racks&expand=<rackId>`. | Members per role rules |
| `/projects/[id]/switch/[equipmentId]` | **Switch Studio (v2.5)** — per-switch chassis with port-level VLAN profile assignment. Standard `Comms` page header + ProjectSwitcher up top (auto-hides on scroll-down on mobile via `AutoHideHeader`), then the switch identity strip (`name · model · IP (cyan link) · port count` + Close). The chassis below renders all RJ45 + SFP ports in a 1- or 2-row grid based on the model, each colored by its assigned VLAN profile and stamped with its VLAN ID; tapping a port opens a portaled popover with the profile picker + Trunk toggle. | Members per role rules; admin + crew edit, manager view-only, user **blocked at the proxy** (404) |
| `/projects/[id]/kiosk` | Self-serve "join the show" page for a roving tablet (admins/managers print the QR) | Open per project PIN |
| `/radios` | Radio fleet for the active project — two tabs: **Radio Equipment** (per-radio rows with status dropdown) and **Radio Channels** (zones + tunings). Header exposes QR + Scanner icon buttons. | admin / manager / crew |
| `/radios/scan` | Continuous barcode-scan loop powered by `@zxing/browser`; branches on radio status (unknown / auto-return / prompt). See §5.7. | admin / manager |
| `/my-equipment` | Server redirects every role straight into Panel Studio (`/projects/X/panel/Y?from=my-equipment`). Cookies remember the last project + member. | Everyone (including user-only) |
| `/profile` | Personal PIN reset, display name, and notification preferences. Header avatar opens this. | Everyone (including user-only) |
| `/admin` | Tasks inbox (lockouts + change requests) | admin only — non-admins redirected to `/tasks` or `/` |
| `/admin/lockouts` | Drill-down view of all locked users | admin |
| `/tasks` | Crew task list (deploy + optional return queue) | crew |

### 4.1 Project detail tabs

| Tab | Shows | Who sees it |
|---|---|---|
| **Equipment** | Auto-named gear (`PNL 1`, `WLBP 3`, `SW 2`, …) with hardware type, assignee, IP, deploy status, panel misc accessories (gooseneck, footswitches, speakers) | admin / manager / crew |
| **Team** | Members with role, position, assigned equipment, expansion count, first-login status (Active/Pending) | admin / manager (crew see Equipment + My Equipment + Plots only) |
| **Pick List** | CONF / IFB / Audio_IO / GRP communication functions. Usage display shows who has each item on their panel. | admin / manager |
| **Plots** | Stage-plot PDFs uploaded for the show (currently mock state) | All members |
| **Racks** (v2.4) | One row per `RackTemplate` on this project (name · location · RU · slot count). Edit expands the row inline into the full RackStudio (chassis + device library + slot editor + loose-gear tray). Eye icon → chrome-free `/preview`. See §5.9. | admin / manager / crew |
| **My Equipment** (nested) | Shows ONLY when the current user is `crew` on this project — surfaces just the gear assigned to them | crew |

### 4.2 Panel Studio modes

Same route (`/projects/[id]/panel/[equipmentId]`) renders different modes:

| Mode | Trigger | Capabilities |
|---|---|---|
| **Own panel, crew/user/manager** | Default when viewing a panel assigned to you | Edit keys → submit for approval |
| **Own panel, admin** | Admin viewing a panel assigned to them | Edit keys → applied immediately (no approval) |
| **Others' panel, admin/manager (or global admin)** | Navigating to a panel not assigned to you | Edit keys → changes require admin approval (manager = endorsement); admin/global admin saves directly. Copy / Paste buttons show next to Save. |
| **Browse mode** | URL has `?from=my-equipment` (admin/manager landed here from `/my-equipment`) | Adds the **Browse Header** at the top — show + user dropdowns with type-to-filter, prev/next chevrons, and a sibling-gear row when the user has multiple pieces. The "My Equipment" page-title is rendered above the header. Nav highlight flips to "My Equipment". |
| **Review mode** | URL has `?review={memberId}` (admin clicks Review on a Tasks card) | Shows the submitted changes, allows per-key approve/deny |

### 4.3 My Equipment surfaces

`/my-equipment` is unified entry but the rendered surface depends on role:

- **Crew / user-only**: cards-list view of every piece of gear assigned to them, grouped by project. Each card links into Panel Studio.
- **Admin / manager (on any project)**: server immediately `redirect()`s to `/projects/{id}/panel/{equipmentId}?from=my-equipment`. There is no intermediate cards page for them. The first project + first member with gear is picked unless `?project=` / `?member=` (or the `lastBrowseProject` / `lastBrowseMember` cookies) say otherwise. Returning to `/my-equipment` lands on the same user they were last looking at.

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

### 5.4 Admin/manager browse loop (My Equipment → Panel Studio)

Designed so an admin can audit a whole crew without losing their place:

```
/my-equipment
   │  redirect (server) →
   ▼
/projects/A/panel/EQ?from=my-equipment
   │
   │ Browse Header (top of page):
   │   [Show ▼]    [User ▼]   ◄ ►
   │   type-to-filter on each dropdown,
   │   Enter picks first match, Esc closes
   │
   │ Sibling gear row (only when current user has >1 piece):
   │   [PNL 1] [WLBP 3]  ← clickable cards switch piece without leaving browse mode
   │
   │ Edits on someone else's panel: admin saves directly (Save) or
   │ uses Copy / Paste to clone keys from another panel.
   │
   ▼  user picks next person from dropdown / chevron
/projects/A/panel/EQ2?from=my-equipment   (nav stays "My Equipment")
   │
   ▼  navigates away & comes back → cookies remember last project + member
/my-equipment → redirect → same panel
```

### 5.5 Panel-level Copy / Paste between users

Two clipboards live on Panel Studio simultaneously:

| Scope | Holds | Storage | Trigger | Visible to |
|---|---|---|---|---|
| **Per-key clipboard** | One key's `pickListItemId` + trigger mode | React state (`clipboard`) | Cmd/Ctrl-C on a selected key, paste with Cmd/Ctrl-V | Anyone editing |
| **Panel-level clipboard** | Every key on the panel (main + shift + every expansion) tagged with a source label like `"PNL 3 · Jane Doe"` | `sessionStorage` key `panel-clipboard` (survives navigation) | **Copy** button next to Save snapshots; **Paste** button appears when clipboard has content | admin / manager / global admin |

**Paste** matches each entry by `(keyIndex, page, expansion)` and overwrites the matching slot on the current panel. A toast reports `Pasted N keys from {sourceLabel}`. The plain-text panel snapshot is also pushed to the system clipboard so it can be dropped into Slack / a sheet for a paper trail.

Selection clears whenever the inspector closes (X / scrim tap / Esc) so the next click on a key opens it cleanly. Picker-list drag-and-drop **keeps the picker open** after a drop so admins can drag item-after-item onto multiple keys without reopening it.

### 5.6 HWBP exclusion from PTP picker

Panel Studio picker's PTP section lists members as callable targets. Members whose only equipment is `hardwire_bp` are **excluded** because PTP'ing to a hardwire beltpack requires more studio resources than typically available. Members with HWBP + any other gear (panel / wireless BP) stay in the list — the PTP rings their non-HWBP device. Logic in `panel/[equipmentId]/page.tsx`:

```ts
const onlyHwbp = m.equipment.every((e) => e.category === 'hardwire_bp')
```

### 5.7 Radio barcode scan (admin / manager)

The scanner page (`/radios/scan`) lets ops check radios in/out with the
device camera. `@zxing/browser` runs a continuous decode loop; the
server action `scanRadioBarcode({ projectId, barcode })` returns a
branch tag that drives the UI:

| Branch | Trigger | Scanner UI |
|---|---|---|
| `unknown` | No radio in the project has that barcode | Opens the assignment modal pre-filled blank — admin enters `radioId`, model, target member, and final status. Creates a new Radio row at submission. |
| `auto-return` | Barcode matches a radio currently `out` | Silently calls `returnRadioByBarcode`. Toast: `Returned {radioId} from {member}`. No modal. |
| `prompt` | Barcode matches a radio with status `na` / `returned` / `damaged` / `lost` | Opens the assignment modal pre-filled with the radio's current fields. Admin picks the new target member + status. |

A 2-second cooldown prevents the same barcode from re-firing while the
modal animates closed. The modal uses the shared `Modal` component with
the optional `onClose` (X) + `actions` (Cancel · Save) props.

### 5.8 Location rename from the Pick List

Pick-list rows carry a free-form `location` string. Tapping the
location chip on a row opens a small rename modal; the `renameLocation`
server action updates **every row in the project that shares the old
location**, not just the one tapped. This keeps zones / cases / road
boxes consistent without per-row edits.

### 5.9 Rack Studio (v2.4)

The Racks tab under Comms is the on-show rack-design surface. Each
`RackTemplate` is one row in the list — name · location · RU · slot
count. Tapping **Edit** expands the row in place into the full
RackStudio (chassis + device library + slot editor + loose-gear
tray). All other rows are hidden while one is expanded — single-rack
focus mode mirroring PanelStudio.

#### Components

| Surface | Purpose |
|---|---|
| **Chassis** | Vertical stack of `totalRU` rows. Each filled RU renders a card with the slot label + a stacked column of every RU it occupies (a 4U Artist frame shows `6 / 7 / 8 / 9` in cyan). Empty rows render the RU number on the left and the word "Empty" centered. |
| **Device library** | Right column (desktop) or bottom sheet (mobile). Sectioned tiles: Frames · 2-Wire · PTP Clock · Switches · Audio · Patchbay · Panels · Drawers · Power · Loose gear. Filter dropdown collapses to one section + a search field. See PD-027. |
| **Slot edit form** | Replaces a slot card in place when its Edit button is tapped. ResizeObserver reports the form's scrollHeight back so the chassis math grows JUST enough to fit. Mode-switches: a linked-equipment slot shows a single FilterDropdown for swap-to-equivalent; an unlinked slot shows Device type + Label fields. |
| **Loose-gear tray** | Wrap-flow row above the chassis. Loose devices (Antaira, Intellanet, Bolero Antenna Master, …) sit here as chips that match the Close button's chrome (rounded-lg · border-white/10 · px-4 py-2). × removes instantly — no confirm modal (PD-029). |

#### Three ways to place a slot

1. **Drag from library → drop on RU.** PointerEvents-based; `pendingDragRef` records a pointerdown on the tile, promotes to an active drag after the pointer moves past a 6px threshold (so a quick tap is still a tap). During drag, the device-library bottom sheet (mobile) auto-closes so the operator can see the chassis, then reopens after drop.
2. **Tap empty RU → arm-then-pick.** Tapping a free RU on the chassis arms a "pending RU"; the library tiles then light up cyan as droppable. Tapping any tile creates the slot at the armed RU.
3. **Tap library tile → arm-then-place.** Reverse of (2). Tap a tile first to arm a device, then the chassis empty rows highlight green and a tap places.

Existing slot cards can also be drag-repositioned — the same drag pipeline reuses the slot's `(label, ruSize)` as a synthesized preset. Collisions and out-of-bounds drops are rejected and the card snaps back.

#### Equipment-backed slots (PD-026)

Slots can optionally link to a real `Equipment` row via `RackSlot.equipmentId`. The rack page server-fetches equipment in the `switches` and `audio` categories (panels excluded — they sit on desks, not in racks) and renders one library tile per UNRACKED equipment row at the top of its category section. Each tile shows `name (white) · location (cyan) · hardwareType (gray)`. Dropping a tile onto an RU creates a slot that's bound to that equipment — the slot card mirrors the same three-piece layout, and the Rack Preview page also renders the location and model in cyan/gray next to the name. Slot edit on a linked slot becomes a single "swap-to-equivalent" dropdown (filtered to the same category, same-rack-only).

#### Library structure (PD-027)

The device library is grouped into 10 categories with a fixed display order:

| Category | Examples |
|---|---|
| **Frames** | Artist-128 (6U) / Artist-64 (3U) / Artist-32 (2U) / Artist-1024 (2U) / RTS-ODIN (1U) / RTS-OMS (1U) |
| **2-Wire** | IMF 102 / ST Model 46 / ST Model 47 / RTS PS31 (2U) / RTS PS21 (1U placeholder; real device is half-RU) |
| **PTP Clock** | Brainstorm / Meinberg PTP |
| **Switches** | 26P+4F / 40P+4F / 24X8F8V / 16F / 9P+1F / Pliant Copper Hub / Pliant Fiber Hub / Media Switch |
| **Audio** | Dark88 / A16R |
| **Patchbay** | AIO / Fiber / Fiber+Ethercon / Ethercon |
| **Panels** | Blank panel (1U / 2U / 3U / 4U) / Passthrough (1U) |
| **Drawers** | Drawer 1U / 2U / 3U / 4U |
| **Power** | UPS (1U + 2U separate tiles) / Power Conditioner |
| **Loose gear** | Antaira / Intellanet Old / Intellanet New / TP Link / Netgate / Bolero Antenna Master |

Custom devices added via the **+ Custom device** form live in the `RackDevice` table, scoped per project. `coerceCategory()` migrates pre-restructure rows (category='devices') onto a current category at load.

Same-name presets coexist via the cyan size badge on the right of each tile — UPS 1U and UPS 2U are two tiles both named "UPS"; React keys include the ruSize (`preset-UPS-1` / `preset-UPS-2`) to keep identities distinct.

#### Rack Preview

The eye icon next to the Close button on an expanded rack opens `/projects/[id]/racks/[rackId]/preview` — a chrome-free single-rack view (no navbar, no bottom-nav, same treatment as `/kiosk` and `/zones`). Server-fetches **both sides** of slots in one query so the side-toggle costs zero round-trips.

- **Desktop (md+):** Front and Rear chassis render side-by-side, each labeled above. No toggle.
- **Mobile (<md):** Horizontal scroll-snap carousel — slide 0 is Front, slide 1 is Rear. Two cyan dot indicators below the chassis track + control the active slide.

Slots in the preview show `label (white) · linkedLocation (cyan) · linkedHardwareType (gray)` for equipment-backed slots. Empty rows show `RU number · "Empty"`. Layout uses an explicit `CHASSIS_W = 320px` width with inner `PAD_X = PAD_Y = 20` so cards inset from the rounded chassis border on all four sides (preserves the "rails inside the cabinet" visual metaphor). Caster wheels render under the chassis as two dark circles connected via thin mounting brackets.

The Close button (labeled, matching Rack Studio / Panel Studio / Switch Studio chrome — `rounded-lg border border-white/10 px-4 py-2 text-sm font-medium`) returns to `?tab=racks&expand=<rackId>` so the operator lands back on the same rack they were previewing. The URL→state restore is one-shot-on-mount (guarded by `restoredFromUrlRef`) and the `changeExpandedRack()` helper mirrors state into the URL on every toggle — so closing the expansion doesn't leave a stale `?expand=` that would re-open later (PD-028).

### 5.10 Switch Studio (v2.5)

Per-switch chassis visualization with port-level VLAN profile assignment. Lives at `/projects/[id]/switch/[equipmentId]`. Reached by tapping the switch ID text (`SW 1`, `SW 2`, …) on a switch's Equipment card — only switches whose `hardwareType` resolves to a registered NETGEAR M4250 model get a clickable link.

#### Chassis layout

| Model | Port mix | Rows | Notes |
|---|---|---|---|
| `9P+1F` | 9 RJ45 + 1 SFP | **1** | Small breakout switch — operator wants the 10 ports in a single strip |
| `26P+4F` | 26 RJ45 + 4 SFP | 2 | Bread-and-butter house switch (M4250-26G4F-PoE+) |
| `40P+4F` | 40 RJ45 + 4 SFP | 2 | Bigger version; defaults to 20 Dante / 20 AES67 / 4 SFP trunk uplinks |
| `24X8F8V` | 24 RJ45 + 16 SFP | 2 | Breakout-heavy variant |
| `16F` | 16 SFP (all fiber) | **1** | Fiber backbone — single horizontal strip |

The grid uses `gridTemplateRows: repeat(N, auto)` + `gridAutoFlow: column` so iterating ports 1..N in order automatically lays out as NETGEAR's odd-top / even-bottom convention (2-row) or a single strip (1-row). Each cell is a fixed `48x48` (RJ45 + SFP same size — operator preference; the size mismatch read as "broken" rather than "two port banks"). Cells stamp the port number (small, top) + VLAN ID (centered, dominant). Trunk ports render gray (Management profile color) with a small white "T" badge bottom-right matching NETGEAR ProAV Engage. Unassigned ports show `—`.

#### Mobile scroll behavior

The chassis is wrapped in `overflow-x-auto pb-2` so a wide switch (15-column 26P+4F = ~832px) scrolls horizontally. The chassis bezel uses `mx-auto w-fit` so it centers when it fits and anchors to the left edge when it doesn't — operator can scroll right to reach the end and the scroll origin is always at port 1 (PD-031).

The page header (`Comms` + ProjectSwitcher + bottom border) is wrapped in `AutoHideHeader` so it slides up on scroll-down on mobile, same behavior as Project Detail, Panel Studio, My Equipment, Tasks. The switch identity strip + Close button stay put so the operator can always dismiss.

#### Port-edit flow

1. Tap a port → portaled popover anchors to the cell via `getBoundingClientRect` (the popover lives at `document.body` z-100, escaping the `overflow-x-auto` scroll region that would otherwise clip it). Clamped 8px from the viewport edges.
2. Popover groups VLAN profiles by `profileType` (Data, Audio Dante, Audio AES67, Management, Transfer, …). A Trunk toggle + Unassign row sit at the bottom.
3. Picking a profile or toggling Trunk fires the `updateSwitchPort` server action; the client optimistically updates the cell fill color + VLAN ID. `router.refresh()` pulls fresh state on success; rollback on server error.
4. Trunk ports always render with the **Management** color regardless of the underlying profile — matches NETGEAR ProAV Engage. The underlying `profileId` is preserved for round-tripping (toggling Trunk off restores the profile color).

#### Lazy seeding

On first open of a switch in Switch Studio, the page server-checks `equipment.switchPorts.length`. If 0, it reads the model's `defaultFor(portIndex, portKind)` table:

| Model | Default RJ45 1..rj45Count | Default SFP |
|---|---|---|
| `9P+1F` | 1–4 CommsDante1, 5–8 AES67_1, 9 Management trunk | 1 SFP Management trunk |
| `26P+4F` | 1–12 CommsDante1, 13–24 AES67_1, 25–26 Management trunk | 4 SFP Management trunk |
| `40P+4F` | 1–20 CommsDante1, 21–40 AES67_1 | 4 SFP Management trunk |
| `24X8F8V` | 1–12 CommsDante1, 13–24 AES67_1 | 16 SFP Management trunk |
| `16F` | (no RJ45) | 16 SFP Management trunk |

VLAN profile IDs are resolved at runtime by `vlanId` so renames of the global VLAN list don't break the seed math. Bulk-inserts via `prisma.switchPort.createMany()`, then re-fetches and renders. Subsequent opens skip the seed and just read.

#### Role gating

| Role | Switch Studio access |
|---|---|
| admin / global admin | Full edit |
| crew | Full edit |
| manager | View-only (cells render but don't open the popover; server action rejects with "Read-only role") |
| user | **Hard blocked** — proxy + server page both 404 |

Belt-and-suspenders: the proxy blocks user role at the URL level, and the server action `updateSwitchPort` re-checks role before any write.

---

## 6. Data Model Summary

22 models total (VlanProfile + SwitchPort added in v2.5 for Switch Studio; RackLooseItem and RackDevice added in v2.4 alongside RackTemplate / RackSlot being promoted from "no UI" to in-use). See `uml-erd.md` for the diagram.

### Phase 1 models (built + in use)

| Model | Purpose | Notable fields |
|---|---|---|
| `User` | Person with a login | `firstName`, `lastName`, `pin` (nullable until first-login setup), `failedAttempts`, `lockedUntil` |
| `Project` | A show | `name`, `pin` (4-digit join code), `status`, `createdById`; manager-set "brought to show" totals: `goosenecksBrought`, `footswitchesBrought`, `speakersBrought`, `quarterXlrmBrought`, `db9XlrfBrought`, `rj45XlrmfBrought`; `returnPhaseActive` toggle |
| `ProjectHeadsetInventory` | Per-project headset-type "brought" totals | `(projectId, headsetType)` unique, `brought` count |
| `ProjectMember` | User's membership in a project | `role`, `position`, `location`, `hardwareType` (legacy — equipment carries this now), `deployStatus` (per-member, less-used now) |
| `PickListItem` | A named comm function | `code`, `name`, `type` (PTP/CONF/IFB/Audio_IO/GRP) |
| `PanelKey` | One physical key on a specific piece of gear | `equipmentId` (since 2026-05-08), `projectMemberId`, `keyIndex`, `page` (main/shift), `expansion` (0-N), `pickListItemId`, `triggerMode`, `talkMode`. Unique on `(equipmentId, keyIndex, page, expansion)`. |
| `KeyDraft` | Unsaved edit to a PanelKey | `editedById`, `pickListItemId`, `triggerMode`, `talkMode`, `status` (draft/submitted) |
| `ChangeRequest` | Bundle of key edits awaiting approval, **scoped to one device** | `equipmentId` (since 2026-05-08), `status` (draft/submitted/mgr_endorsed/applied/rejected/discarded), `submittedById`, `targetMemberId`, `resolvedAt` |
| `ChangeRequestItem` | Per-key diff within a change request | `panelKeyId`, `fieldChanged`, `previousValue`, `newValue` |
| `AccessRequest` | Not currently used in UI | (kept in schema for future project-access flow) |

### Phase 2-4 models (mixed — some now in use, some still schema-only)

| Model | Status |
|---|---|
| `Equipment` | **Used heavily** — Equipment tab, auto-generated names, deploy status tracking (v2). Also referenced by `RackSlot.equipmentId` / `RackLooseItem.equipmentId` for the rack designer's equipment-linked slots (v2.4). |
| `Radio` | **Used heavily** (v2.3 first-class radios) |
| `Zone` / `ZoneChannel` / `RadioZone` | **Used** on the Radio Channels tab |
| `Plot` | Stage-plot PDF associations (Plots tab in Comms) — schema present |
| `Notification` / `NotificationPreference` / `PushSubscription` | Backing tables for the planned web-push system (PRD §11.2) |
| `PanelPresence` | Tracks who is actively viewing a panel for soft-locking — schema present, no UI yet |
| `Asset` | Warehouse asset with QR code, serial number, owner |
| `RackTemplate` | **Used (v2.4)** — Racks tab + RackStudio + Preview. `dept`, `location`, `projectId` fields all live now. |
| `RackSlot` | **Used (v2.4)** — single slot at an RU position on one face of the rack. `equipmentId` (optional) links to a real Equipment row; `deviceType` + `label` carry display info either way. |
| `RackLooseItem` | **Used (v2.4)** — non-RU devices tagged to a rack (velcro/drawer gear). Renders as chips above the chassis. |
| `RackDevice` | **Used (v2.4)** — user-authored custom devices added via "+ Custom device". Project-scoped, reusable across racks. Built-in presets stay in code (`src/lib/rack-presets.ts`). |
| `VlanProfile` | **Used (v2.5)** — global pool of VLAN profiles (Comms Dante 1/2, AES67 1/2, Management, VPN Transfer, Production, OOB, …). Seeded from the company-wide hex chart. Fields: `name`, `vlanId` (unique), `color` (hex), `profileType` (Data/AudioDante/AudioAES67/Management/Transfer), `description`, `sortOrder`. Shared by every project. |
| `SwitchPort` | **Used (v2.5)** — per-`Equipment` port state for switches. One row per physical port. `(equipmentId, portIndex)` unique. Fields: `portIndex`, `portKind` ('rj45'\|'sfp'), `profileId` (FK to VlanProfile, nullable for unassigned), `isTrunk` (independent of profile). Lazy-seeded on first Switch Studio open from `SwitchModel.defaultFor()`. |
| `NfgReport` | "Not Functioning" reports for damaged gear |
| `MultStrand` | Wiring-strand tracking (Phase 4) |

`Equipment` was originally slated for Phase 2 but ended up being central to v2 — the Equipment tab, auto-generated names, deploy status tracking all live on this model. `Radio` followed the same path in v2.3. `RackTemplate` / `RackSlot` were schema-only until v2.4 — the Racks tab + drag/drop RackStudio promoted them into active surfaces. `VlanProfile` + `SwitchPort` were added fresh in v2.5 to back Switch Studio (migration `20260608000000_switch_studio` seeds the global VLAN pool from the operator's hex chart in one shot).

### Radio status enum

| Value | Meaning | Color |
|---|---|---|
| `na` | New radio, never issued (default) | Gray |
| `out` | Currently assigned to a `ProjectMember` | Yellow |
| `returned` | Back in the pool, not yet redeployed | Blue |
| `damaged` | Needs service | Purple |
| `lost` | Not accounted for | Red |

Canonical source: `src/lib/radio-status.ts`. Migration `20260526025524_radio_status_enum` drops the legacy `Radio.checkedOut` boolean and adds `status TEXT NOT NULL DEFAULT 'na'`.

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

`src/components/app-shell.tsx` polls every 5s — admins hit `/api/admin/task-count` (CR + lockout queue), crew hit `/api/tasks/count` (deploy + return queue when `returnPhaseActive`). The count is cached in `sessionStorage` (`task-count-cache` for admin, `crew-task-count-cache` for crew) so navigating between pages doesn't flash the badge back to 0 while the next fetch is in flight. Cache is hydrated inside a `useEffect` (not `useState` initializer) to avoid SSR hydration mismatch.

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

### 7.10 PointerEvents drag pipeline (Rack Studio)

The rack drag/drop pipeline uses raw `PointerEvent` listeners attached to `document` rather than HTML5 drag-and-drop — works identically across mouse, touch, and pen, doesn't fight `overflow-hidden` parents, and lets us decide the threshold between tap and drag in code.

- **`pendingDragRef`** records a pointerdown on a library tile (preset + startX/Y + pointerId). It does NOT start a drag.
- A document-level `pointermove` listener watches for that pointer to travel past 6px from start, then **promotes** to an active drag (`setDragPreset(...)`). Pointerup before crossing the threshold is treated as a tap — the button's native onClick fires and arms the device for "pick" mode.
- During active drag, `document.elementsFromPoint(x, y)` walks every element under the cursor (covers nested overflow scrollers + portals) looking for a `data-rack-ru` attribute to determine the hovered RU.
- The drag overlay (cyan ghost of the slot it would create) is rendered via `createPortal` to `document.body` so it can escape the chassis's `overflow-hidden`.
- On pointerup, the same handler resolves: if the source was an existing slot card, PATCH its ruPosition; if from the library, POST a new slot. If outside any RU, the drag silently cancels and the slot card snaps back.

On mobile the bottom-sheet device library auto-closes on drag-promote (`sheetWasOpenBeforeDragRef` records the original state) and reopens after drop, so the operator can see the chassis during the gesture.

### 7.11 URL / state sync for inline expansions

The Comms Racks tab keeps a single `expandedRackId` in component state AND mirrors it into a `?expand=<id>` URL param via the `changeExpandedRack(next)` helper (mirrors the `changeTab` pattern already used for `?tab=`). Two pieces work together:

1. **One-shot URL restore.** A `restoredFromUrlRef` guards the URL→state effect to fire ONCE on first mount. Without this, background data refreshes (which change the `commsRacks` array reference) re-fire the effect, find `?expand=` still in the URL, and re-set state — yanking the operator back into a closed expansion.
2. **State→URL sync on every change.** Every set-site uses the helper, so closing the expansion strips `?expand=` from the URL. The next URL→state run sees nothing to restore. The two stay locked in sync.

This pattern is what makes the Rack Preview's X close button work: clicking X navigates back to `?tab=racks&expand=<rackId>`, the inline view sees the URL on mount, restores once, then the user's interactions take over.

---

## 8. Known Shortcomings / Parking Lot

- **AppShell remounts on every navigation** → Tasks badge briefly flashes 0 despite sessionStorage cache. Deeper fix is moving AppShell to a Next.js route-group layout. Tracked but not yet tackled.
- **Bulk paste importer** (paste PDF text → parse → preview → bulk add) was started then parked; waiting on sample data from managers to know the real paste format.
- **Playwright E2E test suite** scaffolded in `tests/e2e/` but requires a `TEST_DATABASE_URL` that's never been set up. Single spec (`change-request.spec.ts`) exists as the first candidate.
- **Monitoring page / NFG UI** — schema present, no UI. Explicitly deferred from v2 scope.
- **Half-RU rack slots.** Real-world RTS PS21 is a half-RU device that mounts on either the left or right of an RU. Currently tracked as 1U in the library so it occupies a full RU when placed. Proper half-RU support needs: a `slotPosition` column on `RackSlot` ('left' | 'right' | 'full'), drag-pipeline updates to detect which half of an RU the pointer is over, collision detection per-half, and chassis render to split rows into two half-width cards. Medium-effort follow-up. See PD-024.
- **Rack designer doesn't surface deploy status yet.** Equipment-backed slots show name · location · model in the rack views but not the deploy-status pill. Easy add when the design calls for it.
- **ChangeRequestItem has no per-item status field.** Current resolution sets the CR to `applied` or `rejected` at the bundle level; per-item approve/deny is inferred by comparing `newValue` to the current `PanelKey` — works for the 95% case but breaks if another edit happens in the ~60s window between resolution and crew polling.
- **`riedelId` on ProjectMember** is legacy from the original Riedel-integration plan. No current code reads or writes it. Leave alone until the monitoring phase starts.
- **No web push for Tasks** — admins/crew need to keep a tab open for the badge to refresh. Push would let the device wake on a new CR. Service worker already registered for PWA install; missing piece is the VAPID server.

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
| Rack device library presets | `src/lib/rack-presets.ts` (COMMS_PRESETS, PRESET_CATEGORY_ORDER, coerceCategory) |
| Rack drag pipeline | `src/app/projects/[id]/racks/[rackId]/rack-studio.tsx` (search for `pendingDragRef`, `startLibraryDrag`, `startSlotDrag`) |
| Rack inline expansion / URL sync | `src/app/projects/[id]/project-page.tsx` (search for `expandedRackId`, `changeExpandedRack`) |
| Rack preview rendering | `src/app/projects/[id]/racks/[rackId]/preview/preview-view.tsx` (Chassis component, RU_PX, PAD_X/Y) |
| Rack APIs | `src/app/api/racks/...` (rack CRUD, slots CRUD, loose CRUD) and `src/app/api/rack-devices/...` (custom device library) |

---

## 11. Future Work

Loosely-prioritized roadmap. Not commitments — just "if/when we touch these next."

### 11.1 Label / sticker printing (Brother P-touch)

Equipment in the warehouse + on the show floor needs human-readable + machine-readable stickers (gear name, project, QR). Path depends on which printer model:

- **WiFi printer** (PT-P900W / P950NW family): Next.js server action opens a TCP socket to printer IP:9100 and pushes Brother's raster command stream. Works from any device including iPad. Requires a per-project printer-IP setting.
- **Bluetooth printer** (PT-P710BT / P300BT): Web Bluetooth from the browser — works on desktop Chrome/Edge and Android. Doesn't work on iOS Safari (Apple has refused Web Bluetooth for years).

Templates already exist in P-touch Editor (`.lbx` files) but that format isn't web-portable; we'd re-create the layouts as code (SVG → raster) — typically 1-day work for ~3 layouts. Schema additions: a `qrCode` field on `Equipment` (mirror of `Asset.qrCode`) so stickers stay valid across project reassignments, and a printer-config row per project (IP, model, default tape width).

Status: scoped, not started. Waiting on hardware decision.

### 11.2 Web push notifications

Replace polling-only Tasks badge with a push delivery so admins / crew get notified without keeping a tab open. Service worker is already registered for the PWA install; the missing pieces are a VAPID key, a `subscribe` endpoint, and a server-side `web-push` send when a ChangeRequest is created or a deployment status flips into a watched state.

### 11.3 Riedel hardware integration (the original Phase 3 plan)

`riedelId` lives on `ProjectMember` for this. The plan is to push approved key configs straight into a Riedel frame via RRCS XML-RPC so the show comms reflect the approved state without a programmer manually re-entering keys. Significant effort — requires a stateful relay that holds the RRCS connection, plus a mapping layer between our `PickListItem` model and Riedel's port/conference graph.

### 11.4 Rack designer extensions (built v2.4; follow-ups)

The Rack designer shipped in v2.4 (see §5.9, PD-024 through PD-029). Remaining follow-ups:

- **Half-RU slots** — RTS PS21 is the canonical case. Needs a `slotPosition` column ('left' | 'right' | 'full'), drag pipeline updates to detect half-RU hover, per-half collision, and chassis render to split rows into two half-width cards. Medium-effort.
- **Deploy-status pill on rack slots** — equipment-backed slots could show the same colored pill the Equipment tab uses, so the rack view doubles as a "what's broken / what's not deployed yet" surface.
- **Rack templates** — `RackTemplate.type` already differentiates "standard" vs "custom" in the schema; we don't yet use the global-library type. A future "starter racks" picker (preloaded with common layouts: comms FOH, comms MON, etc.) would speed up project setup.
- **Cable-routing overlay** — out of scope for now; the chassis just renders the unit list. Future overlay could draw inter-slot patches.

### 11.5 NFG / Asset tracking (Phase 4 schema, no UI)

`NfgReport` + `Asset` are wired in the schema. Reports of damaged or non-functioning gear would let managers see across-project failure patterns and tag specific assets out of rotation.

---

## 12. Related Documents

- `uml-erd.md` — Entity relationship diagram (Mermaid)
- `uml-sequence-diagrams.md` — Sequence flows for key operations
- `uml-state-diagrams.md` — ChangeRequest lifecycle, deploy status transitions
- `uml-use-case.md` — Use cases per role
- `user-flow.md` — End-user narrative flows
- `product-decisions.md` — Why we chose specific designs (with history)
- `PRD-v1-april2026.md` — Original PRD (archived April 12, 2026 plan)
