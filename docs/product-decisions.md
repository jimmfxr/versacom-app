# Nodal Control — Product Decisions

A living record of key product decisions and the reasoning behind them.

---

## PD-001: PIN-based authentication (no email/password)

**Decision:** Users authenticate with a PIN only. No email addresses or passwords.

**Why:** Production environments are fast-paced — crew share workstations, rotate between shows, and need instant access. Email/password adds friction with no benefit on-site. A PIN is quick to enter and easy to remember.

**PIN delivery:** Admin creates or resets a PIN, then communicates it to the user verbally or in person (manager-to-crew). There is no automated email or SMS delivery.

---

## PD-002: No email field on User model

**Decision:** The User model has no email field.

**Why:** Keeping the model simple. Email would imply password reset flows, notification systems, and off-site access patterns that don't match how this tool is used. Users are on-site crew who get their PIN from their manager directly. Less fields = less to manage.

---

## PD-003: REST API only (no WebSocket)

**Decision:** All client-server communication uses REST API. No WebSocket connections.

**Why:** Simplifies the architecture. The app doesn't need real-time push — users can refresh or poll to see updated state. REST is easier to debug, cache, and scale.

---

## PD-004: Next.js 16 + Tailwind CSS

**Decision:** The app is built with Next.js 16 (App Router) and Tailwind CSS.

**Why:** Replaces the previous React 17 + Vanilla CSS + Express stack. Next.js provides both frontend and API routes in one framework, eliminating the need for a separate Express backend. Tailwind speeds up UI development.

---

## PD-005: Offline resilience is not a priority

**Decision:** No offline-first or local caching strategy.

**Why:** Nodal Control is a web app used on-site where internet access is available. It doesn't connect to hardware directly — it's a management and planning tool. If the network is down, the show comms still work (Riedel hardware operates independently). The app can wait for connectivity to resume.

---

## PD-006: No audit log for Admin actions

**Decision:** No separate audit log table for tracking Admin changes.

**Why:** Only Admins can make direct edits (equipment, users, pick list, etc.), so we already know who made changes. This is a tool built for Admins to make their own jobs easier — it doesn't connect to external systems or have external stakeholders who need an audit trail. The change request flow already tracks Crew/User changes with full history.

---

## PD-007: CR rejection displays inline via polling

**Decision:** When a change request is rejected, the rejection note displays directly in the user's Panel Studio UI. Keys revert to Yellow (draft) so the user can edit and resubmit.

**How it works:** The UI polls the API for CR status. When the status comes back as `rejected`, the rejection note from the Admin renders inline on the page alongside the affected keys. No separate notification system — the user sees it next time they view their panel.

---

## PD-008: 4-digit numeric PIN

**Decision:** PINs are 4-digit numeric only (0-9).

**Why:** Letters and longer PINs add confusion for crew working live shows — typing on phones one-handed, wearing headsets, moving fast. 4 digits is easy to remember and quick to enter. The app doesn't protect sensitive data (no financials, no PII), so the security bar is low. Rate limiting handles brute force risk.

---

## PD-010: Unified My Equipment — admin/manager redirect into Panel Studio

**Decision:** `/my-equipment` no longer renders a cards-list page for admins or managers. The server immediately `redirect()`s them to `/projects/{id}/panel/{equipmentId}?from=my-equipment`. Crew and user-only roles still see the cards list.

**Why:** Admins and managers spend their time auditing other people's panels, not their own. Forcing them through a cards page added a click before any real work. Putting them straight into Panel Studio in browse mode (with a project + user dropdown at the top) lets them flip through users in seconds. Cookies (`lastBrowseProject`, `lastBrowseMember`) remember where they were so coming back to `/my-equipment` lands on the same panel they were last looking at.

**Consequence:** The nav highlight has to know about `?from=my-equipment` so it can flip "Projects" off and "My Equipment" on even though the URL is `/projects/X/panel/Y`. See `getNavigation` in `src/components/app-shell.tsx`.

---

## PD-011: Two clipboards on Panel Studio (per-key + panel-level)

**Decision:** Panel Studio holds two independent clipboards — Cmd/Ctrl-C copies a single key into React state; the **Copy** button next to Save snapshots the entire panel into `sessionStorage` keyed `panel-clipboard`.

**Why:** Two distinct workflows. Per-key clipboard is for tweaks while editing a single panel ("make key 7 the same as key 5"). The panel-level clipboard is for cloning configurations between users — copy from PNL 3 / Jane Doe, navigate to PNL 4 / John Smith, paste. Putting the panel clipboard in `sessionStorage` lets it survive the navigation. Per-key in component state is enough because it lives inside one panel.

**Side effect:** Copy also writes a plain-text snapshot to the system clipboard so the admin can paste it into Slack or a sheet for a paper trail.

---

## PD-012: Global admin = admin on any project

**Decision:** A user with `role === 'admin'` on **any** membership is treated as a global admin: sees every project, can open any project page, and gets the Tasks nav item.

**Why:** Designers and Versacom staff carry the admin bit across all shows in practice. Forcing them to be added explicitly to every project (including read-only past shows) added busywork without changing what they could do. Manager / crew / user remain scoped to their memberships only — only `admin` triggers the global-promote.

---

## PD-009: Login lockout — 10 attempts, 15-min auto-unlock + Admin notify

**Decision:** 10 wrong PIN attempts locks the account for 15 minutes. Auto-unlocks after 15 minutes OR Admin can manually unlock immediately. Admin gets notified in Inbox.

**Why:** Dual unlock (timed + manual) solves two scenarios. During a live show, if a crew member gets locked out and can't find Admin, they wait 15 minutes and try again — they're never fully stuck. But Admin still sees every lockout in their Inbox and can unlock early or reset the PIN if they're nearby. 10 attempts is generous enough for honest mistakes, and the 15-minute window limits brute force to ~650 attempts/day (would take 15 days to exhaust all 10,000 PINs).

---

## PD-013: PanelKey + ChangeRequest are equipment-scoped, not member-scoped

**Decision:** As of 2026-05-08, the unique constraint on `PanelKey` is `(equipmentId, keyIndex, page, expansion)` (was `(projectMemberId, …)`). `ChangeRequest` carries an `equipmentId` denormalized off its first item.

**Why:** Multi-device members (e.g. one crew member assigned both HWBP 1 and PNL 3 on the same show) used to share PanelKey rows across all their devices because keys were keyed off `projectMemberId` only. Editing key 1 on HWBP 1 mutated the same row PNL 3 read from. The admin review surface compounded the problem by grouping change requests on `(submitter, target member)`, collapsing two devices' edits into one card.

**Migration cost:** A one-time data migration cloned each member's existing PanelKey rows once per device so each device started at the canonical state and could diverge from there. ChangeRequests with no items were dropped as orphans. See `prisma/migrations/20260508000000_panel_key_equipment_scope/`.

**Consequence:**
- Admin grouping at `/admin` keys reviews on `(submitter, target member, equipment)` — HWBP 1 and PNL 3 produce separate review cards.
- Task badge count distinct on the same triple, so two devices = two tasks.
- Panel page loader queries pending `ChangeRequestItem`s for the current equipment + user and hydrates the green-bordered "submitted" state on revisit; without this, navigating away and back lost the visual indication of what was awaiting review.

---

## PD-014: Flat-card visual language across list surfaces

**Decision:** List rows across the app have no card chrome — no `rounded-2xl`, no `bg-[#2a2a2a]`. Just transparent rows separated by a 6%-white border. Empty states are also transparent.

**Why:** Design feedback was "the cards float; there are too many container boundaries." A live-show interface needs lists to read as lists, not as grids of boxes. Flat rows with thin separators read faster, hide better behind a small phone screen at 3am, and let the page-header `bottomBorder` pattern unify with the content below.

**Pattern:** Each list wrapper uses either `divide-y divide-white/[0.06]` (line on top of every row except the first) or `[&>*]:border-b [&>*]:border-white/[0.06]` (line on bottom of every row including the last) — the latter when a closing line under the list is desirable. Rows themselves: `py-3` only, no horizontal padding (cards sit flush with the page gutter).

**Surfaces touched:** Dashboard distribution cards still keep their bordered look (3-up grid on desktop, swipe carousel on mobile) — the rest (Projects list, Tasks, Admin tasks, My Equipment, Project Details Equipment / Team / Pick List / Plots, Kiosk pending list) all dropped to flat rows.

---

## PD-015: Tasks badge collapses on (submitter, member, equipment)

**Decision:** `/api/admin/task-count` distincts ChangeRequests on `(submittedById, targetMemberId, equipmentId)` rather than `(submittedById, targetMemberId)`.

**Why:** Companion to PD-013. Without `equipmentId` in the distinct, a crew member submitting on two devices would only count as one badge unit — but the `/admin` page would still render two cards (since we group on the same triple). The mismatch between badge count and visible cards was confusing.

---

## PD-016: Touch-action discipline on the Dashboard

**Decision:** The dashboard root and the deployment-status section's outer wrapper have `touch-action: pan-y` set inline. The SwipeCarousel's track re-enables `pan-x` on its own subtree.

**Why:** A horizontal/diagonal gesture starting on the deployment-status card or its section header used to leak through to the SwipeCarousel below — iOS Safari interprets the touch as belonging to the closest horizontal scroller. Locking the surrounding tree to vertical-only pans constrains the leak. The carousel keeps swipe behavior because its own `touch-action: pan-x` overrides for that subtree.

**Side benefit:** Pre-empts the same class of bug on any future card on the dashboard — the parent rule wins by default.
