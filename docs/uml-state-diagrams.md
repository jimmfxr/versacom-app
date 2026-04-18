# Nodal Control — State Diagrams

**Updated:** 2026-04-17

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
