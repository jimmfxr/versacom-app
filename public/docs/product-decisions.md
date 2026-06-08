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

---

## PD-017: Radios are first-class — 5-state status enum, `na` default

**Decision:** Radios live on their own top-level page (`/radios`) with two tabs (Equipment, Channels/Zones). Status is a 5-value enum: `na`, `out`, `returned`, `damaged`, `lost`. Every new radio is created with `status='na'`, including the data backfill from the legacy `Radio.checkedOut` boolean.

**Why:** Radios behave operationally like Equipment but have their own out/return/repair lifecycle separate from the deploy phase of comms panels. Treating them as Equipment with deploy statuses was awkward — a radio is rarely "deployed" in the way a panel is, and "out / returned" is the actual unit of work. The five-state enum mirrors how ops actually talks about radios on-site.

**`na` as default everywhere:** The migration (`20260526025524_radio_status_enum`) drops `checkedOut` and adds `status TEXT NOT NULL DEFAULT 'na'`. New radios — whether created by hand on the Radio Equipment tab or by the scanner's `unknown` branch — start at `na`. They move to `out` the first time they're assigned.

**Color encoding** (from `src/lib/radio-status.ts`): gray (na) → yellow (out) → blue (returned) → purple (damaged) → red (lost). Same hue family as the deploy-status enum so the two read consistently next to each other.

---

## PD-018: Barcode scanner with auto-return + assignment-modal branches

**Decision:** `/radios/scan` runs a continuous `@zxing/browser` decode loop and dispatches on `Radio.status` for the scanned barcode within the active project:

- **`unknown`** (no match in project) → assignment modal opens pre-filled blank; admin enters radio ID, model, member, and confirms status.
- **`out`** (currently issued) → silent `returnRadioByBarcode` call; toast confirms `"Returned {radioId} from {member}"`. No modal.
- **everything else** (`na` / `returned` / `damaged` / `lost`) → assignment modal opens pre-filled with the radio's current fields so the admin can re-issue or change status.

A 2-second cooldown after each handled scan prevents the same barcode from re-triggering while the modal animates out.

**Why:** The most common scanner action by far is returning a radio that someone forgot to log out — the auto-return path means a single scan with no taps closes the loop. Everything else needs a human decision (who's getting it next? was it damaged?) so the modal opens with whatever context we already have. New radios still get assigned with one barcode scan (`unknown` branch), not a separate "register" workflow.

---

## PD-019: Comms + Radios header chrome — QR + Kiosk + Scanner icons

**Decision:** The Comms page (`/projects/[id]`) and the Radios page (`/radios`) both expose icon buttons in the page header to the left of the project dropdown.

- Comms: **QR** (opens join-QR modal) · **Kiosk** (opens `/projects/[id]/kiosk/`).
- Radios: **QR** (same join-QR modal) · **Scanner** (opens `/radios/scan`).

The matching QR and Kiosk buttons that used to sit inside the Team-tab add card have been removed.

**Why:** The QR and Kiosk launchers were buried inside the Team tab; admins on-site needed them visible immediately on every project page, not three taps deep. Putting them on the page header makes "show the QR for someone to join" and "open the kiosk view for check-in" one-tap actions. The Radios page borrows the same pattern — QR for joining the radio fleet (same join code), Scanner for the most common in/out action.

**Layout rule:** The project dropdown always claims `w-[calc(50vw-1rem)]` on mobile (exactly half the viewport minus the page gutter). The icon buttons sit outside that half-row so the dropdown size is never sacrificed for chrome.

---

## PD-020: Modal X-close pattern + optional bottom actions

**Decision:** The shared `Modal` component takes two optional props: `onClose` (renders an X in the top-right and wires the backdrop click) and `actions` (renders a bottom action row). Both are optional — a read-only modal like the join QR uses `onClose` only (no action row); an edit modal uses both.

**Why:** Action-row close buttons ("Close" / "Done") double the chrome on read-only modals where the user just needs to dismiss. The X is recognized everywhere and pairs naturally with backdrop tap-to-close. Keeping `actions` separate means modals that *do* need a destructive button (Delete) plus a confirmer (Save) still have a dedicated row instead of being squeezed into the title bar.

**Convention:** Edit/delete modals across the app drop the X in favor of an explicit `Cancel` chip in the action row, sitting between `Delete` and `Save`. This keeps three-action modals predictable and prevents accidental backdrop-tap dismissal mid-edit.

---

## PD-021: Cascade ProjectMember deletion through PanelKey / ChangeRequest

**Decision:** `deleteMember` runs a single Prisma transaction that scrubs dependent rows before deleting the `ProjectMember`:

1. Delete `KeyDraft` rows for any `PanelKey` owned by this member.
2. Delete `ChangeRequestItem` rows where the panel key is owned by this member **or** the change request targets this member.
3. Delete `ChangeRequest` rows targeting this member.
4. Delete `PanelKey` rows owned by this member.
5. Null out `Equipment.assignedToId` where it points at this member (do **not** delete the equipment).
6. Delete the `ProjectMember`.

**Why:** Prisma does not cascade by default across these relations, so deleting an admin/manager/crew member that owned panel keys or had change requests against them used to throw `Foreign key constraint violated on PanelKey_projectMemberId_fkey` and leave the member stuck. The transaction makes the operation atomic — either every dependent is cleaned up and the member is gone, or none of it happens.

**Equipment stays.** A PNL or HWBP outlives its operator; we null the assignment so the next admin can reassign without re-creating the device.

---

## PD-022: Global UI sweep — bigger buttons, full-width on mobile, flat dividers

**Decision:** A multi-pass polish across Comms / Radios / Projects:

- All in-card action buttons (Cancel · Save · Delete · Edit · `+ Add X`) bumped to `px-4 py-2 text-sm` so they're touch-friendly with one hand.
- Action rows on edit cards collapse to `flex-col gap-2 sm:flex-row` — every button takes the full row on mobile, returns to inline on `sm:` and up.
- Project list rows render the `Active` / `Archived` chip to the **left** of the project name (matches reading order).
- PIN chips and Edit buttons on the project row both span both rows of the row's grid for a single tall tap target.
- Search input borders bumped to `border-2 bg-[#202020]` so the search bars match the surrounding card borders rather than disappearing into them.

**Why:** Iterative on-site feedback: the previous chips were too small to hit with gloves; the right-side status chip was the last thing read on a long row; PIN/Edit buttons were undersized relative to the rest. The flat-row visual language (see PD-014) survives — what changed is the touch targets *inside* each row.

---

## PD-023: Search-takes-over-tab-dropdown on mobile

**Decision:** On mobile, the search input on Pick List, Equipment, Tasks, and the Radios tabs takes over the full row when active — replacing the type/category dropdown that normally sits next to it. Tapping the search icon expands the input full-width; tapping Cancel returns the dropdown.

The Tasks search and the Project list search both stay inline (no toggle) — they're already half-width or full-width depending on screen size.

**Why:** Mobile horizontal space is the constraint. The type-filter dropdown next to the search input forced both to be narrow enough to be useless. Search-takes-over lets the user type a long enough query to actually filter, then collapse back to the dropdown when done. The pattern is consistent across the four list surfaces that have it; the two pages without it (Tasks search, Projects search) explicitly opted out per user feedback to stay simple.

---

## PD-024: Rack designer ships inline-first, with a dedicated Preview (v2.4)

**Decision:** Build the Rack designer as an **inline expansion** under the Comms Racks tab — tapping Edit on a `RackTemplate` row uncollapses the row in place into the full RackStudio (chassis + library + slot editor). Every other rack row is hidden during expansion. A separate `/projects/[id]/racks/[rackId]/preview` route renders a chrome-free read-only view used by ops on the show floor.

**Why:** Two distinct mental modes. **Editing** a rack is a focused task done by the designer ahead of the show — they want the chassis filling their viewport and zero noise. **Viewing** the rack at load-in is a glance ("does the FOH rack match the plan?") and benefits from no app chrome at all — just the rack on a black screen, the way a PDF or printed sheet would look. Two surfaces, one component (`rack-studio.tsx` has an `embedded` prop that drops the toolbar / project switcher when inline), one set of APIs.

**Why inline, not a separate page:** A modal felt too small for the chassis (17 RU is already 800px tall); a dedicated page would force the operator out of the Racks list every time they wanted to edit. Inline expansion keeps the list visible in the URL (the operator can hit Close and resume scanning rows) while giving the chassis the full viewport.

**Standalone deep-link still exists.** `/projects/[id]/racks/[rackId]` renders the same RackStudio with its own page chrome (back button + project switcher). It's there for shareable URLs and as a fallback when ops needs to skip past the project page entirely.

**Half-RU deferred.** RTS PS21 is a real-world half-RU device but the chassis math models RU sizes as integers in v2.4. PS21 is in the 2-Wire category at `ruSize: 1` as a placeholder. Proper half-RU is a follow-up commit — needs a `slotPosition` column ('left'|'right'|'full'), drag-pipeline updates to detect which half of an RU the pointer is over, and chassis render to split rows into two half-width cards.

---

## PD-025: PointerEvents-based drag pipeline (no HTML5 DnD)

**Decision:** The RackStudio's drag/drop uses raw `PointerEvent` listeners attached to `document` rather than HTML5 drag-and-drop. Library tiles capture `onPointerDown` into a `pendingDragRef`; a document-level `pointermove` watcher promotes to an active drag once the pointer crosses a 6px threshold from start. The cyan drag ghost renders via `createPortal` to `document.body` so it can escape the chassis's `overflow-hidden`. RU hover detection uses `document.elementsFromPoint(x, y)` scanning for a `data-rack-ru` attribute on row wrappers.

**Why:** Three reasons HTML5 DnD wouldn't work:
1. **Touch + mouse parity.** HTML5 DnD on iOS is broken in well-known ways (no support for `dragstart`, requires nonstandard touch shims). PointerEvents work identically across mouse, touch, and pen with no shims.
2. **Tap vs drag distinction.** Library tiles double as tappable buttons ("arm device for pick" mode). HTML5 DnD captures every pointerdown as a drag-start candidate, fighting the click event. The 6px threshold lets us decide late.
3. **Overflow-hidden parents.** HTML5 DnD's ghost is rendered by the browser at the OS level and ignores CSS — but our chassis sits inside `overflow-hidden` containers. Our portal-rendered ghost can hover anywhere on screen.

**Mobile bottom-sheet behavior:** Library on mobile is a slide-up sheet. When a drag promotes, the sheet auto-closes (`sheetWasOpenBeforeDragRef` records original state) so the operator can see the chassis during the gesture; it reopens after drop.

---

## PD-026: Equipment-backed slots — switches + audio only

**Decision:** `RackSlot.equipmentId` can optionally link to a real `Equipment` row. The rack page server-fetches equipment in the `switches` and `audio` categories only. **Panels are deliberately excluded** even though `Equipment.category === 'panels'` exists.

**Why exclude panels:** Intercom keypanels live on desks (or beltpacks live on people), not in racks. Including them in the library would muddle the workflow — operators dragging "PNL 3" into a rack slot when PNL 3 actually belongs at FOH would create a confusing physical/logical mismatch. Switches and audio frames live in racks every show; that's the right set to surface.

**Linked-slot UX consequences:**
- Library tile shows three pieces in one row: `name (white) · location (cyan) · hardwareType (gray)`. Equipment tiles sort to the TOP of their category section above generic presets.
- Dropping the tile creates a slot with `equipmentId` set; `rackedEquipmentIds` (computed across all racks in the project) filters that tile out of subsequent library renders so a unit can't be racked twice.
- Slot edit form on a linked slot becomes a single "swap-to-equivalent" FilterDropdown filtered to the same `Equipment.category` AND not racked elsewhere (the current slot's own equipment stays in the list so the dropdown can render its current value).
- Unlinked slots use the old two-field form (Device type picker + Label input).

**Future:** A deploy-status pill on linked slot cards would let the rack double as a "what's broken / what's not deployed" surface. Easy add when the design calls for it.

---

## PD-027: Library category restructure — frames / 2-wire / ptp / patchbay / panels

**Decision:** Reorganized the device library from the original catch-all `devices / switches / audio / drawers / power / loose` set into a more granular `frames / twoWire / ptp / switches / audio / patchbay / panels / drawers / power / loose`. Existing custom devices stored with `category='devices'` are migrated at load time via `coerceCategory()` (anything unrecognized → `frames`).

**New categories:**
- **Frames** — Artist-128/64/32/1024 + RTS-ODIN + RTS-OMS (everything that used to be lumped into "devices" except the 2-wire and clock bits)
- **2-Wire** — IMF 102, ST Model 46/47, RTS PS31 (2U), RTS PS21 (1U placeholder, real device is half-RU)
- **PTP Clock** — Brainstorm, Meinberg PTP
- **Patchbay** — AIO, Fiber, Fiber+Ethercon, Ethercon (each 1U)
- **Panels** — Blank panel (1U / 2U / 3U / 4U), Passthrough (1U) — replaces the "filler" half of the old Power+filler bucket

**Why:** Operators don't think about "devices" — they think about "frames" (the Artist mainframe is a frame), "the 2-wire stack" (the boxes that interface party-line), "the PTP clock", "the patchbay panel", "the blank rack-filler". Lumping these into a generic "Devices" filter made the library a hunt-and-find. Purpose-built categories surface them by function.

**Same-name presets coexist.** Two UPS sizes both named "UPS" (1U and 2U) sit in the Power section — the cyan size badge on the right of each tile distinguishes them. React keys include `ruSize` to keep identities distinct (`preset-UPS-1`, `preset-UPS-2`). Same pattern is used for Blank panel 1U/2U/3U/4U.

**Backward compat:** The API POST/PATCH validators still accept `category: 'devices'` so a pre-restructure custom device that round-trips through Save doesn't reject. The load-time mapper transforms it to `frames` for display.

---

## PD-028: URL `?expand=<rackId>` in sync with inline expansion state

**Decision:** The Comms Racks tab keeps a single `expandedRackId` in component state AND mirrors it into a `?expand=<id>` URL param via a `changeExpandedRack(next)` helper (mirrors the existing `changeTab` pattern). Two pieces work together: (1) a `restoredFromUrlRef` guards the URL→state effect to fire ONCE on first mount; (2) every set-site uses the helper, so closing the expansion strips `?expand=` from the URL.

**Why:** Initial implementation had a bug — closing an expansion only cleared local state; the URL still carried `?expand=<id>`. Background data refreshes (which change the `commsRacks` array reference) re-fired the URL→state effect with the stale URL and re-opened the expansion 1-2 seconds after close. Operators saw "press Close, expansion closes, then comes back on its own".

The fix had to address both directions:

1. **One-shot URL restore** prevents the re-fire bug even if URL drift happens — the effect doesn't run after first mount.
2. **State→URL sync** keeps the URL accurate so deep-link sharing works AND so the next page-load actually finds the right rack to restore.

**Round-trip used by Rack Preview.** The eye icon on an expanded rack navigates to `/preview`. The X close button on the Preview page links back to `?tab=racks&expand=<rackId>`. The inline view sees the URL on mount, restores once, and the operator lands on the same rack they were previewing.

---

## PD-029: Loose-gear chip × removes instantly, no confirm modal

**Decision:** Tapping the × on a loose-gear chip immediately fires `DELETE /api/racks/[rackId]/loose/[looseId]` — no confirmation modal. The × hovers white (not red) to signal the action is benign.

**Why:** Loose items are quick-add / quick-remove by design — a chip with an × is the universal affordance for "tap to dismiss". A confirm modal between intent and action would slow ops down when they're sweeping the tray clean during teardown. Re-adding from the library is one tap if the operator changes their mind — the cost of an accidental removal is ~1 second.

**Slot delete, custom-device delete, and rack delete still confirm** — those carry actual cost (lose layout, lose label, lose the entire rack and its slots). The dividing line is "what's the recovery cost if this was a mistake": single-tap re-add → no confirm; lose state that took minutes to build → confirm.

---

## PD-030: Rack print on iPad PWA — deferred to post-DB-migration

**Decision (parked):** Rack Preview's Print button works on regular Safari + desktop browsers (calls `window.print()` synchronously inside the click handler). On iPad in **PWA standalone mode** (page installed to home screen) it's broken — operator gets the iOS share sheet without an AirPrint option. **Park the proper fix until after the upcoming database migration.**

**Why broken:** Two iOS platform constraints stack:
1. `window.print()` silently no-ops in PWA standalone display-mode. iOS doesn't expose the print API to installed web apps.
2. `window.open(url, '_blank')` from a PWA can't detour to Safari either — the PWA's manifest scope covers the URL, so the new "tab" routes right back into the PWA (operator sees a white flash and bounces home).
3. `navigator.share({url})` opens the iOS share sheet but AirPrint only appears when sharing a **file** (PDF / image), not a URL. Current button uses navigator.share — share sheet pops but has no Print row.

**Proper fix when we come back to it:** Server-side PDF generation. Add a Next.js API route that returns a vector PDF of the rack (server-rendered, no Puppeteer — pdfkit or similar to avoid Vercel cold-start cost). Print button on every platform downloads the PDF. From there:
- Desktop / Safari: PDF opens, native browser print.
- iPad PWA: PDF saves to Files, operator AirPrints from there.
- iPhone Safari: same as desktop.

**Drops the platform-detection branch** in `preview-view.tsx` entirely — one happy path on every surface. Real vector output also prints sharper than rasterized PNG.

**Why deferred:** Database migration takes priority. The print API change might be easier to slot in alongside other server-side work that comes with the migration (new ORM, new endpoints, etc.). No production users are blocked — PWA operators can long-press the URL, copy it, and paste into Safari as a manual workaround in the meantime.

**Tracked in:** TODO comment at `preview-view.tsx` print-button onClick. References this entry by ID (PD-030).

---

## PD-031: Switch Studio — global VLAN pool, per-switch port state, lazy seeding

**Decision (v2.5):** Switch Studio (`/projects/[id]/switch/[equipmentId]`) backs port state with two new models:

- `VlanProfile` — **global** pool (no `projectId`). One row per VLAN the operator uses across the company (Comms Dante 1/2, AES67 1/2, Management, VPN Transfer, Production, OOB, Cameras, …). Seeded in one migration from the company-wide hex chart. Renames + color changes propagate to every project's switches automatically.
- `SwitchPort` — **per-Equipment**, per-port row. `(equipmentId, portIndex)` unique. Stores `profileId` (FK or null) + `isTrunk` (independent flag).

**Why global VLANs:** Every show uses the same VLAN scheme. CommsDante1 is `#3174c2 / vlan 1331` on every switch in the company. Scoping VLANs per-project would force the operator to re-enter the same 25 profiles on every new show — wasted work, plus drift (two projects' "Management" diverging in hex). One global pool, one seed file, every project reads from it.

**Why per-Equipment SwitchPorts:** The state that *does* vary per show is which VLAN each port carries. Crew 1 wires switch SW 1 with ports 1–12 on Dante1; crew 2 might re-assign port 9 to AES67 for this specific gig. That's per-physical-switch state — belongs on `Equipment` (via FK).

**Lazy seeding:** Inserting `rj45Count + sfpCount` rows for every switch the moment the Equipment record is created would waste DB writes on switches that never get opened in Switch Studio. Instead, the page loader checks `equipment.switchPorts.length === 0` and seeds on demand using `SwitchModel.defaultFor(portIndex, portKind)` — the operator's conventional defaults (1–12 CommsDante1, 13–24 AES67_1, last RJ45 + SFP Management trunk). One round-trip to fetch VLAN profile IDs, one `createMany`, done. Subsequent opens skip the seed.

**Trunk + profile coexist:** `isTrunk` is independent of `profileId`. A trunk port renders gray (Management color) with a T badge regardless of which underlying profile sits on it — matches NETGEAR ProAV Engage's UI. Toggling Trunk off restores the profile color without losing the assignment.

**Mobile chassis scroll fix:** The chassis is wider than the viewport on small screens. Previous attempts to center it with `flex justify-center overflow-x-auto` failed on iOS because half the centered chassis sat in negative-x scroll space — `overflow-x: auto` only scrolls positive-x, so ports 1–8 were unreachable. Final pattern: `mx-auto w-fit` on a block-level chassis bezel inside an `overflow-x-auto` parent. When the chassis fits, auto-margins center it; when it doesn't, the margins collapse to 0 and the chassis anchors to the left edge — scroll reaches both ends naturally.

**Role gating:** admin + crew edit; manager view-only; user role hard-blocked at the proxy + server page (404). Belt-and-suspenders matches Equipment-tab gating. The `updateSwitchPort` server action re-checks role server-side independent of the proxy.

**Equipment-card link policy:** Only switches whose `hardwareType` resolves to a registered NETGEAR M4250 model get a clickable `SW N` text on their Equipment card. Unmanaged switches (Antaira, TP Link, Pliant Hub) return null from `getSwitchModel()` → no link rendered → tap on the ID does nothing. No UI to configure them; they're plug-and-play.

---

## PD-032: Switch Studio per-model chassis row count

**Decision (v2.5):** `SwitchModel.chassisRows: 1 | 2` controls how the chassis grid lays out. Two of the five M4250 models render as a single horizontal strip:

| Model | Rows | Why 1 row |
|---|---|---|
| `9P+1F` | 1 | Small breakout — 10 ports fit a single line comfortably; operator finds it easier to read than 5×2 |
| `16F` | 1 | Fiber backbone — all SFP, single port bank, no top/bottom split needed |
| `26P+4F` | 2 | Standard NETGEAR odd-top / even-bottom |
| `40P+4F` | 2 | Same |
| `24X8F8V` | 2 | Same |

**Why per-model rather than auto:** Tried "always 2 rows" first → operator pushed back on 9P+1F and 16F specifically, wanted those flat. Auto-detect ("1 row when total ≤ 10") would be fragile — `24X8F8V` is 40 ports but breaks into RJ45 (24) + SFP (16) which arguably could be split. Per-model declaration is explicit and one-line-to-change.

**Implementation:** `gridTemplateRows: repeat(${chassisRows}, auto)` + `gridAutoFlow: column`. The grid does the placement — iterate ports 1..N in order, no per-cell positioning needed. Robust across both 1-row and 2-row variants.

**Why inline CSS instead of Tailwind classes:** Tried `grid-rows-2 grid-flow-col` first → the classes weren't applying in this Tailwind v4 build (the cells rendered in one long row regardless of the class). Inline `style={{ gridTemplateRows: ..., gridAutoFlow: 'column' }}` guarantees the layout. Cost of a few extra characters; benefit of "always works."

---

## PD-033: Studio chrome convention — labeled "Close" button everywhere

**Decision (v2.5):** Every studio surface (Rack Studio, Rack Preview, Panel Studio, Switch Studio) uses the same labeled Close button:

```
shrink-0 inline-flex rounded-lg border border-white/10 px-4 py-2
text-sm font-medium text-gray-200
hover: border-white/20 + bg-white/[0.04]
active: border-[#0178a3] + bg-[#0178a3] + text-white
```

**Why labeled, not icon:** Originally Rack Preview used a circular X icon-button. Operator wanted consistent chrome — having one studio with an X icon and three with "Close" text read as inconsistent. Labeled buttons also win on operator readability ("what does this do?" vs guessing at glyphs) and on tappable area in a glove-on-the-job-site scenario.

**Why this exact style:** Matches the existing Back / Cancel / Save buttons throughout the app. Already shipped on Panel Studio + Rack Studio; v2.5 extended it to Switch Studio (which started life with this style) and Rack Preview (which got migrated from the X icon).

**Touch behavior:** `style={{ touchAction: 'manipulation' }}` on every Close button — kills the iOS 300ms double-tap delay so the button feels instantaneous. Same pattern used on the navbar Link migrations earlier in v2.4.

**Tracked in:** Used consistently across `rack-studio.tsx`, `preview-view.tsx`, `panel-studio.tsx`, `switch-studio.tsx`.
