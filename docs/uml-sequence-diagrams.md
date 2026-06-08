# Nodal Control — Sequence Diagrams

**Updated:** 2026-06-08

## Change Request Flow (current implementation)

The crew submits, the admin reviews directly. There is no separate manager approval step in code today — manager endorsement is a CR status (`mgr_endorsed`) but the admin is still the final and only resolver. Communication is server actions + 5-second polling, not a REST PATCH endpoint.

```mermaid
sequenceDiagram
    actor Crew
    participant UI as Panel Studio (crew)
    participant SA as Server actions
    participant DB as Database
    actor Admin
    participant AdminUI as Tasks / Panel Studio (review)

    Note over Crew,UI: Phase 1 — Key Editing
    Crew->>UI: Tap key → pick item from picker
    UI->>UI: Key turns YELLOW (changed)
    Crew->>UI: Edit more keys

    Note over Crew,DB: Submission
    Crew->>UI: Tap Submit changes
    UI->>SA: submitChangeRequest(panelId, edits)
    SA->>DB: INSERT ChangeRequest (status: submitted)
    SA->>DB: INSERT ChangeRequestItem rows (per key)
    SA->>DB: INSERT KeyDraft rows (status: submitted)
    SA-->>UI: { ok: true }
    UI->>UI: Keys turn GREEN (submitted)

    Note over UI,SA: Polling — both sides
    loop every 5s while submitted
        UI->>SA: router.refresh()
        SA->>DB: SELECT PanelKey, recentResolutions
        SA-->>UI: page data
        UI->>UI: compute fingerprint; no change → skip
    end

    Note over Admin,AdminUI: Resolution
    AdminUI->>SA: GET /api/admin/task-count (5s poll)
    SA-->>AdminUI: { count: N }
    AdminUI->>AdminUI: Tasks badge = N
    Admin->>AdminUI: Click Tasks → Review
    AdminUI->>AdminUI: Navigate /projects/X/panel/Y?review=MID
    Admin->>AdminUI: Per-key toggle Approve / Deny
    Admin->>SA: resolveChangeRequests(crIds, approvedKeys)
    SA->>DB: UPDATE PanelKey for approved items
    SA->>DB: UPDATE ChangeRequest.status = applied or rejected
    SA->>DB: DELETE KeyDraft(submitted) rows
    SA-->>AdminUI: { ok: true }
    AdminUI->>AdminUI: router.replace /admin

    Note over UI: Crew picks up next poll
    UI->>SA: router.refresh()
    SA-->>UI: PanelKey + recentResolutions
    UI->>UI: fingerprint changed → setKeys(initializeKeys(...))
    UI->>UI: For each resolution item:<br/>currentPanelKey == newValue ⇒ approved<br/>else ⇒ denied
    UI->>UI: Toast: "Your panel changes are live" (approved)
    UI->>UI: Toast: "Keys X, Y denied" (denied)
```

---

## Panel Copy / Paste between users

```mermaid
sequenceDiagram
    actor Admin
    participant Src as Panel Studio (source user)
    participant SS as sessionStorage
    participant Sys as System clipboard
    participant Dst as Panel Studio (dest user)
    participant SA as Server actions
    participant DB as Database

    Admin->>Src: Click Copy (next to Save)
    Src->>SS: setItem('panel-clipboard', { sourceLabel, entries[] })
    Src->>Sys: writeText(plain-text snapshot)
    Src-->>Admin: Toast "Copied N keys"

    Admin->>Src: Use Browse Header to switch user
    Src->>Dst: Navigate to /projects/X/panel/Y2?from=my-equipment
    Dst->>SS: getItem('panel-clipboard')
    SS-->>Dst: clipboard payload
    Dst->>Dst: Render Paste button (clipboard non-empty)

    Admin->>Dst: Click Paste
    loop each entry in clipboard
        Dst->>Dst: find key by (keyIndex, page, expansion)
        Dst->>Dst: updateKey(target, entry)
    end
    Dst-->>Admin: Toast "Pasted N keys from {sourceLabel}"

    alt admin / global admin (own or any panel)
        Admin->>Dst: Click Save
        Dst->>SA: savePanel(memberId, keys)
        SA->>DB: UPSERT PanelKey rows
        SA-->>Dst: { ok: true }
    else manager / crew on someone else's panel
        Admin->>Dst: Click Submit changes
        Dst->>SA: submitChangeRequest(memberId, edits)
        SA->>DB: INSERT ChangeRequest + items + drafts
    end
```

---

## Equipment Deployment Flow

```mermaid
sequenceDiagram
    actor Admin
    participant Eq as Equipment tab
    participant SA as Server actions
    participant DB as Database
    actor Crew
    participant Tasks as Crew /tasks

    Note over Admin,DB: Show planning
    Admin->>Eq: Add equipment (bulk form)
    Eq->>SA: bulkCreateEquipment(rows)
    SA->>DB: INSERT Equipment (deployStatus: na)
    SA-->>Eq: { count }

    Admin->>Eq: Assign to member + location
    Eq->>SA: updateEquipment(id, { assignedToId, location })
    SA->>DB: UPDATE Equipment

    Note over Crew,Tasks: On site
    Crew->>Tasks: Open /tasks
    Tasks->>SA: list tasks
    SA->>DB: SELECT Equipment WHERE deployStatus IN (deploy queue)
    SA-->>Tasks: deploy-task list

    Crew->>Tasks: Mark deployed
    Tasks->>SA: updateDeployStatus(id, deployed)
    SA->>DB: UPDATE Equipment.deployStatus = deployed

    alt Show wraps and admin activates Return phase
        Admin->>Eq: Toggle Project.returnPhaseActive = true
        Eq->>SA: setReturnPhase(projectId, true)
        SA->>DB: UPDATE Project
        Note over Tasks: Crew /tasks now also includes Return queue (status = done)
        Crew->>Tasks: Mark returned
        Tasks->>SA: updateDeployStatus(id, returned)
        SA->>DB: UPDATE Equipment.deployStatus = returned
    else Device fails
        Crew->>Eq: Mark damaged
        Eq->>SA: updateDeployStatus(id, damaged)
        SA->>DB: UPDATE Equipment
    end
```

---

## Join Project (current behavior)

The original AccessRequest gating step is not used. The project PIN is the gate — anyone with it joins immediately, then sets a personal PIN.

```mermaid
sequenceDiagram
    actor NewUser as New crew member
    participant Login as /login/join
    participant SA as joinProject server action
    participant DB as Database

    NewUser->>Login: Open with QR (or type PIN)
    Login->>Login: Pre-fill PIN from ?pin=
    NewUser->>Login: Type first + last name → Join

    Login->>SA: joinProject({ projectPin, firstName, lastName })
    SA->>DB: SELECT Project WHERE pin = ?
    alt Existing user with same name
        SA->>DB: UPSERT ProjectMember (role: user)
        SA-->>Login: { existingUser: true }
        Login->>NewUser: Redirect to /login (sign in with personal PIN)
    else New user
        SA->>DB: INSERT User (pin: null)
        SA->>DB: INSERT ProjectMember (role: user)
        SA-->>Login: { needsPin: true, userId }
        Login->>NewUser: Prompt "Create personal PIN"
        NewUser->>Login: Type PIN twice → Confirm
        Login->>SA: setInitialPin(userId, pin)
        SA->>DB: UPDATE User.pin = bcrypt(pin)
        SA-->>Login: { ok: true }
        Login->>NewUser: Redirect to /login → signed in
    end
```

---

## Radio Barcode Scan

Admins and managers use `/radios/scan` to triage radios with the device
camera. The scanner runs a continuous `@zxing/browser` decode loop and
branches on the current `Radio.status` for the scanned barcode within
the active project.

```mermaid
sequenceDiagram
    actor Admin
    participant UI as /radios/scan
    participant ZX as @zxing/browser
    participant SA as Server actions
    participant DB as Database

    Admin->>UI: Open /radios/scan
    UI->>UI: Request camera permission
    UI->>ZX: Start continuous decode

    loop scanning
        ZX-->>UI: Decoded barcode
        UI->>SA: scanRadioBarcode({ projectId, barcode })
        SA->>DB: SELECT Radio WHERE projectId AND barcode

        alt No match
            SA-->>UI: { branch: "unknown" }
            UI->>Admin: Open assignment modal (blank, pre-filled barcode)
            Admin->>UI: Enter radioId, model, target member, status
            UI->>SA: createRadio({...})
            SA->>DB: INSERT Radio
            SA-->>UI: { ok: true }
        else Radio currently out
            SA-->>UI: { branch: "auto-return", radio }
            UI->>SA: returnRadioByBarcode(barcode)
            SA->>DB: UPDATE Radio SET status='returned', assignedToId=null
            SA-->>UI: { ok: true, previousMember }
            UI->>Admin: Toast "Returned {radioId} from {member}"
        else Radio in na/returned/damaged/lost
            SA-->>UI: { branch: "prompt", radio }
            UI->>Admin: Open assignment modal pre-filled
            Admin->>UI: Pick target member + new status
            UI->>SA: assignRadio({ radioId, memberId, status })
            SA->>DB: UPDATE Radio
            SA-->>UI: { ok: true }
        end

        UI->>UI: 2s cooldown (suppress same-barcode re-trigger)
    end
```

---

## Switch Studio — open + lazy-seed + port edit (v2.5)

The page loader handles three things in one server request: role gate
(404 for user), lazy-seed of SwitchPort rows on first open, and fetch
of everything the client needs. The client then becomes interactive
without further round-trips until an edit.

```mermaid
sequenceDiagram
    actor Operator as Operator (admin/crew/manager)
    participant Card as Equipment card (Comms)
    participant Proxy as src/proxy.ts
    participant Page as switch-studio page.tsx
    participant Model as src/lib/switch-models.ts
    participant DB as Database
    participant Studio as switch-studio.tsx (client)
    participant Action as updateSwitchPort server action

    Operator->>Card: Tap "SW 1"
    Card->>Card: getSwitchModel(hardwareType) returns model?
    Note over Card: Only NETGEAR M4250 models<br/>get a clickable Link

    Card->>Proxy: Navigate /projects/X/switch/Y
    Proxy->>Proxy: session role check
    alt user-only
        Proxy-->>Operator: 404
    else admin / crew / manager
        Proxy->>Page: forward
    end

    Page->>DB: SELECT Equipment + switchPorts
    Page->>Model: getSwitchModel(hardwareType)
    Model-->>Page: { rj45Count, sfpCount, chassisRows, defaultFor }

    alt switchPorts.length == 0  (first open)
        Page->>DB: SELECT VlanProfile (id, vlanId)
        DB-->>Page: profile list
        loop for each port 1..rj45Count+sfpCount
            Page->>Model: defaultFor(portIndex, portKind)
            Model-->>Page: { vlanId, isTrunk }
        end
        Page->>DB: INSERT switchPort.createMany (10..44 rows)
        Page->>DB: SELECT switchPort (re-fetch with IDs)
    end

    Page->>DB: SELECT VlanProfile (full row for picker)
    Page->>DB: SELECT Project + userProjects (for header switcher)

    Page-->>Studio: render with ports, profiles, project, canEdit

    Note over Studio: Cells render with VLAN colors + IDs<br/>Trunk ports gray + T badge<br/>Tap opens portaled popover

    alt canEdit && Operator taps a port
        Operator->>Studio: tap PortCell
        Studio->>Studio: setOpenPortId(port.id)
        Studio->>Studio: portal popover via createPortal,<br/>anchored by getBoundingClientRect

        Operator->>Studio: pick a profile / toggle Trunk / Unassign
        Studio->>Studio: optimistic update (setPorts)
        Studio->>Action: updateSwitchPort({projectId, equipmentId, portId, profileId, isTrunk})
        Action->>DB: role re-check via session + membership
        alt role in [admin, crew]
            Action->>DB: UPDATE SwitchPort SET profileId, isTrunk
            Action->>Action: revalidatePath()
            Action-->>Studio: { ok: true }
            Studio->>Studio: router.refresh()
        else manager (or unauthorized retry)
            Action-->>Studio: { error: "Read-only role" }
            Studio->>Studio: rollback optimistic update
        end
    else !canEdit (manager view-only)
        Operator->>Studio: tap a cell
        Studio->>Studio: no-op (cursor stays default)
    end
```

Notes:
- The lazy-seed branch only fires on the FIRST open of a specific
  switch. The data is durable from then on — every subsequent visit
  skips the seed entirely.
- `VlanProfile` IDs are resolved by `vlanId` during the seed pass, so
  renames or color tweaks to the global VLAN pool don't break the
  seed math (the numeric ID is the stable handle).
- Trunk ports preserve their underlying `profileId` so the operator
  can flip Trunk on/off without losing the VLAN assignment.
- Manager role is rejected by the server action even if they manage
  to call it (e.g. via dev tools) — proxy gate + server gate.
