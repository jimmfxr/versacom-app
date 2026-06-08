# Nodal Control — State Diagrams

**Updated:** 2026-06-08

Describes the state machines driving the app's key workflows: panel-key editing, change-request resolution, and equipment deploy status. The **Panel key** states below are the client-side visual states used in Panel Studio; the actual DB model is `PanelKey` + `KeyDraft`.

---

## 1. Panel Key (client-side visual state)

Each key on a panel has a single visual state in the UI. The state transitions are driven by user action + server fingerprint sync.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> empty : no pickListItem assigned
    [*] --> assigned : has a saved pickListItem

    empty --> changed : user picks an item
    assigned --> changed : user picks a different item
    assigned --> empty : user clicks Unassigned

    changed --> submitted : Submit changes
    changed --> assigned : Discard / navigate away

    submitted --> assigned : admin approved
    submitted --> changed : admin denied (crew's local state reverts)

    note right of empty
        No pickListItem in DB.
        Visual: gray key, no label.
    end note

    note right of assigned
        Saved in PanelKey.pickListItemId.
        Visual: key labeled with item name.
    end note

    note right of changed
        Local-only edit + KeyDraft(draft) on server.
        Visual: yellow highlight.
    end note

    note right of submitted
        KeyDraft(submitted) + ChangeRequestItem on server.
        Visual: green highlight.
    end note
```

Note on denial: on the **crew's** client, when polling detects the denial (via `recentResolutions`), `initializeKeys` resets state to server truth (which is the pre-change value). The crew sees their previous assigned value come back + an error toast naming the denied keys.

---

## 2. ChangeRequest Lifecycle (server-side)

```mermaid
stateDiagram-v2
    direction TB

    [*] --> draft : created while user is editing

    draft --> submitted : user clicks Submit
    draft --> discarded : user cancels

    submitted --> mgr_endorsed : manager endorses (soft pass)
    submitted --> applied : admin approves any item
    submitted --> rejected : admin denies all items

    mgr_endorsed --> applied : admin approves any item
    mgr_endorsed --> rejected : admin denies all items

    applied --> [*]
    rejected --> [*]
    discarded --> [*]

    note right of submitted
        New CR appears in admin's Tasks inbox.
        Badge count increments across all admin tabs.
    end note

    note right of applied
        resolvedAt set.
        At least one item's newValue applied to PanelKey.
        KeyDraft(submitted) records for these items deleted.
    end note

    note right of rejected
        resolvedAt set.
        No PanelKey changes made.
        KeyDraft(submitted) records still deleted.
    end note
```

Status column values in `ChangeRequest.status`: `draft`, `submitted`, `mgr_endorsed`, `applied`, `rejected`, `discarded`. Schema also defines `approved` but the current `resolveChangeRequests` action skips straight to `applied` (no intermediate approved-waiting-to-apply state).

---

## 3. Equipment Deploy Status

Status values live in `src/lib/deploy-status.ts`. Transitions are not enforced by the server — any allowed role (admin, crew) can change to any value directly via the Listbox dropdown. This diagram is the **expected** operational flow.

```mermaid
stateDiagram-v2
    direction TB

    [*] --> na : Equipment created

    na --> deployed : Crew installs on site
    na --> not_needed : Cut before deploy

    deployed --> done : Show wraps
    deployed --> returned : Pulled early
    deployed --> damaged : Gear fails on site

    damaged --> returned : Back to shop after teardown

    done --> returned : Gear checked back in

    returned --> [*]
    not_needed --> [*]

    note right of na
        Default when equipment is added.
        Gray badge.
    end note

    note right of deployed
        Installed and functional.
        Yellow badge.
    end note

    note right of done
        Show complete, still at venue.
        Green badge.
    end note

    note right of returned
        Back at warehouse / owner.
        Blue badge.
    end note

    note right of not_needed
        Cut from show design.
        Red badge.
    end note

    note right of damaged
        Needs repair.
        Purple badge.
    end note
```

When `Project.returnPhaseActive` is true, crew see `done` gear surfaced as Return tasks in `/tasks` alongside the existing Deploy tasks (anything still `na`). The status field itself is unchanged — the toggle just decides which states the task list pulls.

---

## 4. User First-Login Status

Drives the Team-tab "Active / Pending" indicator. Not a stored enum — derived from `User.pin` being null or not.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> Pending : admin adds user (User.pin = null)

    Pending --> Active : user completes first-login
    Pending --> Active : user sets personal PIN after project-PIN entry

    Active --> Pending : (never — no downgrade path)

    Active --> [*]

    note right of Pending
        Displayed as "Pending" in amber text
        next to role in Team tab.
    end note

    note right of Active
        Displayed as "Active" in green text.
    end note
```

---

## 5. Account Lockout

```mermaid
stateDiagram-v2
    direction LR

    [*] --> active

    active --> failing : wrong PIN entered
    failing --> failing : still wrong, count < 10
    failing --> active : correct PIN (counter resets)

    failing --> locked : 10 failed attempts
    locked --> active : 15 minutes pass (lockedUntil expires)
    locked --> active : admin clicks Unlock in Tasks

    note right of failing
        failedAttempts++
        lastFailedAt set
    end note

    note right of locked
        lockedUntil = now + 15min
        Appears on admin Tasks page with countdown.
    end note
```

---

## 6. Radio Status

Status values live in `src/lib/radio-status.ts`. Every radio is created
with status `na` and moves through the dropdown on the Radios → Radio
Equipment tab, the scanner-page modal, or `returnRadioByBarcode` (the
auto-return branch). Transitions are not enforced server-side — admins
can override directly. This diagram is the expected operational flow.

```mermaid
stateDiagram-v2
    direction TB

    [*] --> na : Radio created (always starts here)

    na --> out : Assigned to a member (manual or scan-prompt)
    out --> returned : Scan auto-return OR manual change
    out --> damaged : Field failure
    out --> lost : Reported missing

    returned --> out : Re-issued to a member
    returned --> na : Reset to pool
    returned --> damaged : Found broken on intake
    returned --> lost : Misplaced after return

    damaged --> returned : Repaired
    damaged --> lost : Written off

    lost --> returned : Found
    lost --> [*]
    returned --> [*]

    note right of na
        Default for new radios.
        Gray dot.
    end note

    note right of out
        Currently assigned to a ProjectMember.
        Yellow dot.
    end note

    note right of returned
        Back in the inventory pool, not yet redeployed.
        Blue dot.
    end note

    note right of damaged
        Needs service.
        Purple dot.
    end note

    note right of lost
        Not accounted for.
        Red dot.
    end note
```

The scanner page branches based on the current status when a barcode is
recognized: a radio in `out` status triggers a silent
`returnRadioByBarcode` call; any other status (including `na`,
`returned`, `damaged`, `lost`) opens the assignment modal pre-filled,
letting the admin pick a target member + status manually.

---

## 5a. Panel Studio session mode

Same route (`/projects/[id]/panel/[equipmentId]`) renders in different modes depending on who is viewing, who the panel belongs to, and how the operator arrived. Mode determines whether save is direct (admin) vs change-request (everyone else), whether Copy/Paste appears, whether the Browse Header sits above the chassis, and whether per-key Approve/Deny toggles render.

```mermaid
stateDiagram-v2
    direction TB

    [*] --> own_panel : Viewer is assigned member
    [*] --> others_panel : Viewer is admin manager or global admin

    own_panel --> own_admin_direct : Viewer is admin
    own_panel --> own_request : Viewer is manager crew user

    others_panel --> others_admin_direct : Viewer is admin
    others_panel --> others_request : Viewer is manager

    own_admin_direct --> browse_layer : URL has from my-equipment
    others_admin_direct --> browse_layer : URL has from my-equipment
    others_request --> browse_layer : URL has from my-equipment

    browse_layer --> review_mode : URL has review memberId

    review_mode --> applied : Admin Resolves with one or more approvals
    review_mode --> rejected : Admin Resolves with all denied
    applied --> [*] : router replace admin
    rejected --> [*] : router replace admin

    note right of own_admin_direct
        Edit saved immediately.
        No change-request.
        Copy and Paste hidden.
    end note

    note right of others_admin_direct
        Edit saved immediately (global admin override).
        Copy and Paste shown.
        Browse Header above if from my-equipment.
    end note

    note right of own_request
        Edit becomes ChangeRequest submitted.
        Green highlight on key.
        No Copy or Paste.
    end note

    note right of others_request
        Edit becomes ChangeRequest submitted, mgr_endorsed if manager.
        Copy and Paste shown.
    end note

    note right of browse_layer
        Adds Browse Header: show, user, chevrons.
        Nav highlight flips to My Equipment.
        Cookies remember last project and last member.
    end note

    note right of review_mode
        Per-key Approve and Deny toggles replace picker.
        Resolve button replaces Save.
        Submitted-green keys read-only until per-key choice made.
    end note
```

**Mode-determining inputs:**

| Input | Source |
|---|---|
| Is panel mine? | `equipment.assignedToId === session.member.id` |
| Am I admin? | `session.memberships.some(m => m.role === 'admin')` (global) OR `currentMembership.role === 'admin'` |
| Am I manager on this project? | `currentMembership.role === 'manager'` |
| Browse mode? | URL `?from=my-equipment` is present |
| Review mode? | URL `?review={memberId}` is present (only admin gets the route here from Tasks) |

---

## 6a. RackSlot lifecycle (Rack Studio, v2.4)

The slot moves through a small state machine driven by drag-and-tap operator actions. Library tiles + chassis rows act together as the placement target. A slot can be linked to an `Equipment` row (`equipmentId IS NOT NULL`) or stand-alone — the link is set at creation and can be swapped via the slot's edit form but the slot itself stays the same row.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> picked : Operator drags a library tile or taps a free RU then a tile

    picked --> placed : Drop on free RU range and server collision check passes
    picked --> [*] : Drop outside chassis or on occupied range so snap-back

    placed --> placed_repositioned : Operator drags slot card to a new RU
    placed --> placed : Operator edits label deviceType or ruSize
    placed --> placed : Operator swaps equipmentId on a linked slot
    placed --> [*] : Operator deletes slot via confirm modal

    placed_repositioned --> placed : alias - same DB state

    note right of picked
        Client-only ghost state. No DB row yet.
        pendingDragRef OR armedRu set in client.
    end note

    note right of placed
        RackSlot row exists in DB.
        Visual: card on the chassis with label,
        RU numbers stacked in cyan,
        deploy badge if linked to Equipment.
    end note
```

**Linked vs unlinked variants:**

```mermaid
stateDiagram-v2
    direction LR

    [*] --> unlinked : Slot created from a generic preset

    unlinked --> linked : Slot edit form picks an Equipment row
    linked --> unlinked : Slot edit form picks no equipment
    linked --> linked : Swap to another Equipment same category same rack

    note right of unlinked
        equipmentId is null.
        Slot label is hand-typed.
        Renders as plain card.
    end note

    note right of linked
        equipmentId points at Equipment row.
        Label uses equipment.name.
        Card surfaces equipment.location in cyan,
        hardwareType in gray, deploy status badge,
        IP as cyan link on screen.
    end note
```

---

## 6b. RackTemplate department (Rack Studio, v2.4)

`RackTemplate.dept` decides which side of the company the rack belongs to — affects library default category filter, which presets show up, and where the rack is grouped on the Racks tab.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> comms : Created from the Comms project Racks tab\n(default)
    [*] --> radios : Created from a radio-focused workflow\n(field set explicitly)

    comms --> comms : (no transitions in current build)
    radios --> radios : (no transitions in current build)
```

Today the Racks tab is only Comms-scoped — `radios` dept is reserved for the future Radio rack designer. No UI to flip dept after creation; if you need to move a rack, delete + recreate.

---

## 7. SwitchPort visual state (Switch Studio, v2.5)

Each port on a switch's chassis has one of three visual states. Plus
an orthogonal **Trunk** flag that overrides the cell color (gray +
T badge) while preserving the underlying profile assignment.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> unseeded : Equipment created
    unseeded --> assigned : First Switch Studio open seeds defaults
    unseeded --> unassigned : Rare branch when defaultFor returns null vlanId

    assigned --> unassigned : User picks Unassign
    unassigned --> assigned : User picks any profile

    assigned --> assigned : User picks a different profile

    note right of unseeded
        No SwitchPort row exists yet.
        Page loader detects zero rows and seeds.
        Never reached by an end user.
    end note

    note right of unassigned
        profileId is null and isTrunk is false.
        Visual: empty outlined cell with em-dash centered.
    end note

    note right of assigned
        profileId points at a VlanProfile row.
        Cell filled with profile color.
        Port number small at top, VLAN ID centered.
    end note
```

### Trunk flag (orthogonal)

```mermaid
stateDiagram-v2
    direction LR

    [*] --> not_trunk

    not_trunk --> trunk : User toggles Trunk on
    trunk --> not_trunk : User toggles Trunk off

    note right of not_trunk
        isTrunk is false.
        Cell renders using profile color
        or empty if profileId is null.
    end note

    note right of trunk
        isTrunk is true.
        Cell renders gray with Management color
        regardless of underlying profile.
        White T badge bottom-right.
        profileId preserved so toggling off restores the color.
    end note
```

**Why orthogonal:** A trunk port still has a "primary" VLAN at the
hardware layer — the operator wants to see what that is when planning,
but the chassis at-a-glance reads better when every trunk is uniformly
gray (matches NETGEAR ProAV Engage's UI). Toggling Trunk off restores
the colored fill without re-picking the profile.

**Default seed conventions** (see PD-031 and `src/lib/switch-models.ts`):

| Model | RJ45 1..rj45Count default | SFP default |
|---|---|---|
| 9P+1F | 1–4 CommsDante1, 5–8 AES67_1, 9 Mgmt trunk | 1 SFP Mgmt trunk |
| 26P+4F | 1–12 CommsDante1, 13–24 AES67_1, 25–26 Mgmt trunk | 4 SFP Mgmt trunk |
| 40P+4F | 1–20 CommsDante1, 21–40 AES67_1 | 4 SFP Mgmt trunk |
| 24X8F8V | 1–12 CommsDante1, 13–24 AES67_1 | 16 SFP Mgmt trunk |
| 16F | (no RJ45) | 16 SFP Mgmt trunk |
