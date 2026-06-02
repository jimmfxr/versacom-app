# Nodal Control — User Flow

**Updated:** 2026-06-02

End-user navigation and action flows for the current app. Each role starts at a different landing and unlocks different paths.

---

## 1. Top-level flow (entry + landing by role)

```mermaid
flowchart TD
    START([App opens]) --> COOKIE{Has session cookie?}
    COOKIE -->|no| LOGIN[/login/]
    COOKIE -->|yes| LANDING{Role check}

    LOGIN -->|enters name + personal PIN| AUTH{PIN valid?}
    LOGIN -->|taps Join Project| JOIN_PAGE[/login/join/]
    LOGIN -->|taps Forgot PIN| FORGOT[/login/forgot-pin/]

    AUTH -->|yes| LANDING
    AUTH -->|wrong, attempts < 10| LOGIN
    AUTH -->|10 wrong attempts| LOCKED[Account locked 15 min]
    LOCKED --> LOGIN

    LANDING -->|admin or manager or crew| DASH[/ Dashboard]
    LANDING -->|user-only memberships| MYEQ[/my-equipment/ → Panel Studio]

    DASH -.->|profile icon in header| PROFILE[/profile/]
    MYEQ -.->|profile icon in header| PROFILE

    JOIN_PAGE -->|scans QR or enters PIN + name| JOIN_FLOW
    JOIN_FLOW -->|new user| SET_PIN[Create personal PIN]
    JOIN_FLOW -->|existing user| LOGIN
    SET_PIN --> LOGIN

    classDef landing fill:#0178a3,stroke:#0178a3,color:#fff
    class DASH,MYEQ landing
```

---

## 2. Admin / Manager / Crew nav

```mermaid
flowchart LR
    DASH[Dashboard<br/>+ project switcher] --> NAV{Navbar}

    NAV --> TASKS[/admin or /tasks<br/>with polled badge]
    NAV --> PROJECTS[/projects/]
    NAV --> RADIOS[/radios/]
    NAV --> MYEQ_OPT[/my-equipment/]

    PROJECTS --> PLIST[Projects list<br/>admin: all · others: own]
    PLIST -->|click card| PDETAIL[/projects/ID/ "Comms"]

    PDETAIL --> HDR1{Header icons}
    HDR1 --> QR_BTN[QR icon → join QR modal]
    HDR1 --> KIOSK_BTN[Kiosk icon → /projects/ID/kiosk/]

    PDETAIL --> TABS{Tabs}
    TABS --> EQ_TAB[Equipment]
    TABS --> TEAM_TAB[Team<br/>admin/manager]
    TABS --> PL_TAB[Pick List<br/>admin/manager]
    TABS --> PLOTS_TAB[Plots]
    TABS --> RACKS_TAB[Racks v2.4<br/>RackTemplate list]
    TABS --> MYEQ_TAB[My Equipment<br/>crew only]

    EQ_TAB -->|click panel card| PS[/projects/ID/panel/EQID/]
    PL_TAB -->|tap location chip| LOC_RENAME[Rename location modal<br/>updates all rows in that loc]
    RACKS_TAB -->|click Edit on a rack| RACK_INLINE[Inline RackStudio<br/>?expand=rackId in URL]
    RACK_INLINE -->|eye icon| RACK_PREVIEW[/projects/ID/racks/RID/preview/<br/>chrome-free, both faces]
    RACK_PREVIEW -->|X close| RACKS_TAB

    RADIOS --> RADHDR{Header icons}
    RADHDR --> RQR[QR icon → join QR modal]
    RADHDR --> RSCAN[Scanner icon → /radios/scan/]
    RADIOS --> RTABS{Tabs}
    RTABS --> R_EQ[Radio Equipment]
    RTABS --> R_CH[Radio Channels / Zones]
    R_EQ -->|status dropdown per radio| RSTATUS[na · out · returned<br/>damaged · lost]

    MYEQ_OPT --> BROWSE_REDIRECT[redirect to<br/>/projects/X/panel/Y?from=my-equipment]
    BROWSE_REDIRECT --> PS_BROWSE[Panel Studio<br/>browse mode]

    TASKS --> TASKS_LIST{Task cards}
    TASKS_LIST -->|admin| CR_CARD[Change request]
    TASKS_LIST -->|admin| LOCK_CARD[Lockout]
    TASKS_LIST -->|crew| DEPLOY_CARD[Deploy / Return]

    CR_CARD -->|click Review| PS_REVIEW[/projects/ID/panel/EQID/?review=MID/]
    LOCK_CARD -->|click Unlock| UNLOCK[Unlock user action]
```

The Comms (`/projects/[id]`) and Radios (`/radios`) pages both expose two
small icon buttons in the page header, to the left of the project
dropdown. The dropdown itself always claims half the viewport on mobile
(`w-[calc(50vw-1rem)]`), so the icon buttons sit outside that half-row.

| Page | Header icons (left → right) |
|---|---|
| Comms | QR (join QR modal) · Kiosk (open kiosk view) |
| Radios | QR (join QR modal) · Scanner (open `/radios/scan`) |

---

## 3. User-only flow

User-only accounts (`isUserOnly` — every membership is role='user') are
proxied straight from `/my-equipment` into Panel Studio. They cannot
reach `/`, `/projects`, `/radios`, or the admin/tasks queue, but they
*can* open `/profile` via the header avatar to manage their personal
PIN, name, and notification preferences.

```mermaid
flowchart TD
    LOGIN[/login/] -->|signs in| MYEQ[/my-equipment/]
    MYEQ --> REDIR[server redirect to<br/>/projects/X/panel/Y?from=my-equipment]
    REDIR --> PS[Panel Studio in browse mode]

    PS --> EDIT{Edit keys?}
    EDIT -->|yes - request mode| SUBMIT[Submit changes]
    SUBMIT --> WAIT[Green 'submitted' highlight]
    WAIT -->|polling detects resolution| RESULT{Admin action?}
    RESULT -->|approved| TOAST_OK[Toast: Your panel changes are live]
    RESULT -->|denied| TOAST_DENY[Toast: Keys X, Y denied<br/>keys revert to previous]

    MYEQ -.->|profile icon in header| PROFILE[/profile/]
    PS -.->|profile icon in header| PROFILE

    NAV_BLOCKED[User tries /projects or / or /radios] -->|proxy redirects| MYEQ

    classDef blocked fill:#ef4444,stroke:#ef4444,color:#fff
    class NAV_BLOCKED blocked
```

---

## 4. Browse loop (My Equipment → Panel Studio)

The unified My Equipment surface for *every* role — admin, manager,
crew, and user-only. The cards-list page is skipped entirely:
`/my-equipment` always redirects directly into Panel Studio with
`?from=my-equipment`. Cookies `lastBrowseProject` and `lastBrowseMember`
remember the last viewed combination so the next visit picks up where
the user left off.

```mermaid
flowchart TD
    ENTER["/my-equipment"] --> RESOLVE{Resolve project + member}
    RESOLVE -->|URL ?project= ?member=| PICK
    RESOLVE -->|cookie lastBrowseProject<br/>+ lastBrowseMember| PICK
    RESOLVE -->|fall back| FIRST[First admin/mgr project<br/>+ first member with gear]
    FIRST --> PICK
    PICK[Selected project + member] --> REDIR[server redirect to<br/>/projects/X/panel/Y?from=my-equipment]

    REDIR --> PS[Panel Studio in browse mode]

    PS --> HEADER[Browse Header<br/>Show ▼ · User ▼ · ◄ ►]
    PS --> SIBROW[Sibling-gear row<br/>only when user has multiple pieces]
    PS --> EDIT[Admin: Save direct<br/>Manager: Submit for approval<br/>Copy / Paste next to Save]

    HEADER -->|pick different show| SHOW_NEW[set lastBrowseProject cookie]
    HEADER -->|pick different user| USER_NEW[set lastBrowseMember cookie]
    HEADER -->|type-to-filter then Enter| FIRST_MATCH[First match selected]
    HEADER -->|◄ ►| ADJ[Prev / next user]

    SIBROW -->|click sibling card| SAME_USER_DIFF_GEAR[Same user, next piece<br/>still ?from=my-equipment]

    SHOW_NEW --> REDIR
    USER_NEW --> REDIR
    ADJ --> REDIR
    FIRST_MATCH --> REDIR
    SAME_USER_DIFF_GEAR --> PS

    EDIT --> NEXT{Done with this user?}
    NEXT -->|yes| HEADER
    NEXT -->|leave app| LATER["/my-equipment later"]
    LATER -->|cookies hydrate| RESOLVE
```

Nav highlight: while `?from=my-equipment` is in the URL, the navbar marks **My Equipment** as current even though the path is `/projects/X/panel/Y`.

---

## 5. Change request — crew submits, admin resolves

The most important flow in the app. Diagram is from both sides.

```mermaid
flowchart TD
    subgraph CrewSide [Crew on their own Panel Studio]
        CS1[Panel Studio loaded] --> CS2[Tap empty or assigned key]
        CS2 --> PICKER[Picker opens]
        PICKER --> CS3{Pick an option}
        CS3 -->|Pick an item| CS4[Key state: 'changed' yellow]
        CS3 -->|Pick Unassigned| CS5[Key state: empty]
        CS3 -->|Cancel| CS1

        CS4 --> CS6[Click Submit changes]
        CS5 --> CS6
        CS6 --> CS7[Key state: 'submitted' green]
        CS7 --> CS8[Polling every 5s]

        CS8 -->|fingerprint unchanged| CS8
        CS8 -->|fingerprint changed| CS9{Any resolutions?}
        CS9 -->|approvals only| CS10[Toast: 'Your panel changes are live']
        CS9 -->|denials only| CS11[Toast: 'Keys X, Y denied']
        CS9 -->|mix| CS12[Both toasts fire]

        CS10 --> CS13[Reset to DB truth]
        CS11 --> CS13
        CS12 --> CS13
    end

    subgraph AdminSide [Admin in Tasks]
        AS1[/admin loaded] --> AS2[Tasks badge shows count]
        AS2 -->|click Tasks| AS3[Tasks list]
        AS3 --> AS4{Card type?}
        AS4 -->|change request| AS5[Click Review]
        AS4 -->|lockout| AS6[Click Unlock]

        AS5 --> AS7[/projects/ID/panel/EQID/?review=MID/]
        AS7 --> AS8[Per-key toggle: approve green or deny red]
        AS8 --> AS9[Click Resolve]
        AS9 --> AS10[resolveChangeRequests action]
        AS10 --> AS11[Applied items update PanelKey]
        AS10 --> AS12[CR.status = applied or rejected]
        AS10 --> AS13[router.replace /admin]
    end

    AS11 -.->|crew polling picks up| CS8
```

---

## 6. Panel Copy / Paste between users

Admin or manager (or any global admin) cloning a panel's keys onto another user.

```mermaid
flowchart LR
    SRC[Panel Studio<br/>source user PNL 3] --> COPY[Click Copy]
    COPY --> SS[(sessionStorage<br/>panel-clipboard)]
    COPY --> SYS[(System clipboard<br/>plain-text snapshot)]
    COPY --> TOAST1[Toast: Copied N keys]

    SS --> NEXT[Browse to next user<br/>via Browse Header dropdown]
    NEXT --> DEST[Panel Studio<br/>dest user PNL 4]

    DEST --> PASTE_BTN[Paste button visible<br/>since clipboard non-empty]
    PASTE_BTN --> PASTE[Click Paste]
    PASTE --> MATCH[Match each entry by<br/>keyIndex + page + expansion]
    MATCH --> OVERWRITE[Overwrite matching slots]
    OVERWRITE --> TOAST2[Toast: Pasted N keys<br/>from {sourceLabel}]
    OVERWRITE --> SAVE_OR_REQ{Edit mode}
    SAVE_OR_REQ -->|admin own/global| SAVE[Save direct]
    SAVE_OR_REQ -->|else| REQ[Submit as change request]
```

---

## 7. Pick List + Equipment add flows

Both follow the same pattern: an inline `<Card>` opens above the list with the input form, the user fills it, it posts to a server action, the list refreshes.

```mermaid
flowchart TD
    START[User on tab] --> BUTTON{Click '+' or 'Add X'}
    BUTTON --> FORM[Card opens with inputs]

    FORM --> INPUTS[ID or Name or Category<br/>+ Quantity]
    INPUTS --> DECIDE{What did they fill?}

    DECIDE -->|Name filled<br/>Pick List only| SINGLE[Creates 1 named item<br/>ID auto if blank]
    DECIDE -->|Name blank + ID blank| AUTO[Auto-gen N codes from type or category prefix<br/>continue past highest]
    DECIDE -->|Name blank + ID filled| LITERAL[Start sequence at user's ID<br/>preserve pad width<br/>skip collisions]

    SINGLE --> POST[POST to server action]
    AUTO --> POST
    LITERAL --> POST

    POST --> RESULT{Success?}
    RESULT -->|yes| TOAST_OK[Toast: 'Added N items']
    RESULT -->|too many collisions| TOAST_ERR[Toast: 'Too many collisions'<br/>pick different starting ID]

    TOAST_OK --> REFRESH[router.refresh]
    TOAST_ERR --> FORM
    REFRESH --> CLOSED[Form closes]
```

---

## 8. Mobile nav flow

```mermaid
flowchart LR
    CLOSED[Navbar closed] -->|tap hamburger| OPENING[Slide-down animation]
    OPENING --> OPEN[Fullscreen nav overlay]

    OPEN --> ACTIONS{User interaction}
    ACTIONS -->|tap a nav card| NAV[Navigate to route<br/>press feedback: scale + cyan flash]
    ACTIONS -->|tap X| CLOSING
    ACTIONS -->|drag up > 30% screen| CLOSING
    ACTIONS -->|flick up > 0.5 px/ms| CLOSING
    ACTIONS -->|drag up < 30%, release| SNAP_BACK[Snap back to fully open]

    SNAP_BACK --> OPEN
    CLOSING --> CLOSED
    NAV --> NEWPAGE[New page loaded]
    NEWPAGE --> CLOSED
```

---

## 9. Device reachability indicators

On pages showing equipment with IPs (Equipment tab, Panel Studio header), IP addresses are colored to show if the device is reachable on the current network.

```mermaid
flowchart TD
    LOAD[Page loads with IPs] --> CACHE{sessionStorage cache}
    CACHE -->|fresh < 10s| INSTANT[Render last-known state instantly]
    CACHE -->|stale or missing| START[Render all white]

    INSTANT --> PROBE[Start probe round]
    START --> PROBE

    PROBE --> PAR[Probe every device in parallel]
    PAR --> FETCH[fetch HTTPS or HTTP with no-cors]
    PAR --> IMG[img fallback favicon.ico]

    FETCH --> TIMING{Response time}
    IMG --> TIMING
    TIMING -->|>= 25ms & responded| REACHABLE[Mark as reachable - green]
    TIMING -->|< 25ms| FALSE[Discard: likely network reject]
    TIMING -->|timed out 3500ms| UNREACHABLE[Mark as unreachable - white]

    REACHABLE --> SAVE[Save to sessionStorage + broadcast]
    UNREACHABLE --> SAVE
    SAVE --> PAINT[Update UI]
    SAVE --> REPEAT[Wait 30s]
    REPEAT --> PROBE

    BC[Other tab broadcasts results] -.->|skip own probe| SAVE
```

---

## 10. Radio barcode scan (admin / manager)

The Radios page header includes a scanner icon that opens
`/radios/scan`. The page asks for camera permission, runs a continuous
`@zxing/browser` decode loop, and branches based on whether the
scanned barcode matches a radio in the active project.

```mermaid
flowchart TD
    OPEN[Open /radios/scan] --> CAM{Camera permission?}
    CAM -->|denied| ERR[Show 'Camera blocked' message]
    CAM -->|granted| LOOP[ZXing continuous decode loop]

    LOOP --> SCAN[Barcode captured]
    SCAN --> LOOKUP{Match radio in project?}

    LOOKUP -->|no match| UNKNOWN[Open assignment modal<br/>pre-filled blank<br/>user enters ID, name, model]
    LOOKUP -->|status = out| AUTO[Silently call<br/>returnRadioByBarcode<br/>toast: 'Returned {id} from {member}']
    LOOKUP -->|status = na/returned<br/>damaged/lost| PROMPT[Open assignment modal<br/>pre-filled with radio fields<br/>assign to member + status]

    UNKNOWN --> SAVE_NEW[Create + assign Radio]
    PROMPT --> SAVE_EX[Update Radio assignment + status]
    AUTO --> COOLDOWN
    SAVE_NEW --> COOLDOWN[2s cooldown<br/>then resume LOOP]
    SAVE_EX --> COOLDOWN
    COOLDOWN --> LOOP
```

The cooldown prevents the same barcode from re-triggering immediately
while the modal closes. The modal itself uses the shared `Modal`
component with the optional `onClose` (top-right X) and the standard
Cancel · Save action row.

---

## 11. Pick List location rename

Each Pick-list row carries a free-form `location` string. Tapping the
location chip on the row opens a small rename modal; the new value is
applied to **every row in the project that shares the old location**,
not just the one tapped. This keeps zones / cases / road boxes
consistent without per-row edits.

```mermaid
flowchart LR
    ROW[Pick list row] -->|tap location chip| MODAL[Rename Location modal]
    MODAL --> INPUT[Text input pre-filled<br/>with current location]
    INPUT --> ACTION{Action}
    ACTION -->|Cancel| ROW
    ACTION -->|Save| CALL[renameLocation server action]
    CALL --> UPDATE[UPDATE PickListItem<br/>SET location = newLoc<br/>WHERE projectId = X<br/>AND location = oldLoc]
    UPDATE --> REFRESH[router.refresh]
    REFRESH --> ROW
```

---

## 12. Rack Studio — design + edit a rack (v2.4)

The Racks tab under Comms lets ops design rack layouts before the
truck-pack. Each `RackTemplate` row in the list (name · location · RU ·
slot count) is collapsed by default. Tapping **Edit** expands the row
in place into the full RackStudio — all other rows are hidden so the
operator has a single-rack focus mode.

```mermaid
flowchart TD
    RACKS[Racks tab list] -->|+ Create rack| CREATE[Inline create form<br/>name + location + totalRU]
    RACKS -->|tap Edit on a row| EXPAND[Inline expansion<br/>sets ?expand=rackId in URL<br/>other rows hidden]

    EXPAND --> RS[RackStudio surface]
    RS --> RS_LEFT[Chassis<br/>vertical RU stack]
    RS --> RS_RIGHT[Device library<br/>right column desktop<br/>bottom sheet mobile]
    RS --> RS_TOP[Loose-gear tray<br/>chips above chassis]
    RS --> RS_HEADER[Header row<br/>name · location · RU<br/>+ eye icon + Close]

    RS_HEADER -->|tap name| META_FORM[Metadata edit form<br/>rename / relocate / resize]
    META_FORM -->|Save| RS
    META_FORM -->|Delete| CONFIRM[Modal: Delete rack?]
    CONFIRM -->|Confirm| GONE[Server delete<br/>collapse expansion<br/>refresh]

    RS_HEADER -->|eye icon| PREVIEW[/preview/ chrome-free]
    PREVIEW -->|X| EXPAND

    RS_HEADER -->|Close button| RACKS

    classDef url fill:#0178a3,stroke:#0178a3,color:#fff
    class EXPAND,PREVIEW url
```

### Three ways to place a slot

The RackStudio supports three flows for adding a device to a rack —
operators on different inputs (desktop trackpad, iPad touch, gloves on
a cart) gravitate toward different ones. All three end with the same
server POST to `/api/racks/[rackId]/slots`.

```mermaid
flowchart TD
    OPEN[RackStudio expanded] --> CHOICE{User intent}

    CHOICE -->|drag a library tile| DRAG1[Pointerdown on tile<br/>pendingDragRef records start]
    DRAG1 -->|pointer moves past 6px| PROMOTE[Promote to active drag<br/>cyan ghost via portal<br/>mobile sheet auto-closes]
    PROMOTE -->|hovers over RU| HOVER1[data-rack-ru attribute<br/>cyan overlay on target rows<br/>collision-aware]
    HOVER1 -->|pointerup on valid RU| POST_DRAG[POST new slot<br/>refresh]

    CHOICE -->|tap empty RU| ARM_RU[Arm pending RU<br/>library tiles light up cyan]
    ARM_RU -->|tap any library tile| POST_PICK_RU[POST new slot at armed RU]

    CHOICE -->|tap library tile| ARM_DEV[Arm device<br/>empty chassis rows light up green]
    ARM_DEV -->|tap any empty RU| POST_PICK_DEV[POST new slot with armed device]

    POST_DRAG --> REFRESH[router.refresh]
    POST_PICK_RU --> REFRESH
    POST_PICK_DEV --> REFRESH

    REFRESH --> OPEN
```

A tap (no movement past 6px) on a library tile is treated as the
"arm device" path — the same listener that promotes drags also clears
the pending ref on a fast pointerup. On mobile, the bottom-sheet
library auto-closes during the drag so the operator can see the
chassis, then reopens after drop (`sheetWasOpenBeforeDragRef`).

### Equipment-linked slots (switches + audio)

Slots can optionally link to a real `Equipment` row so deploy status,
location, model, and IP flow through. The page server-fetches
equipment in the `switches` and `audio` categories (panels are
excluded — they sit on desks, not in racks) and renders one tile per
unracked equipment row at the **top** of its category section in the
library.

```mermaid
flowchart LR
    EQ_TAB[Equipment tab<br/>switches + audio rows] -->|server fetch| LIB[Device library tiles<br/>name white · location cyan · model gray]
    LIB -->|drag onto RU| LINK[Create slot<br/>equipmentId = eq.id<br/>label = eq.name]

    LINK --> EQUIP_TILE_GONE[Tile disappears from library<br/>rackedEquipmentIds tracks claimed]
    LINK --> RACK_CARD[Slot card shows<br/>label · location · model]

    RACK_CARD -->|tap Edit| LINKED_FORM[Linked-slot form<br/>single swap-to-equivalent dropdown]
    LINKED_FORM --> SAME_CAT[Options: same category<br/>+ not racked elsewhere]
```

Unlinked slots (preset / custom-device-backed) show a different edit
form: a Device-type picker (filtered to non-equipment library items)
plus a freeform Label input. RU position and RU size are not editable
in either form — both are fixed at create time and resize happens via
drag.

### Loose gear tray

Devices with `ruSize === 0` (Antaira, Intellanet, TP Link, Netgate,
Bolero Antenna Master) get velcro'd inside the chassis or thrown in a
drawer — no RU slot. They render as chips in a wrap-flow row above
the chassis. Adding is tap-to-add (no drag). The × on a chip removes
**instantly** — no confirmation modal (PD-029). Re-adding from the
library is one tap if the operator changes their mind.

```mermaid
flowchart LR
    LIB[Library: loose category] -->|tap a tile| ADD_LOOSE[POST /api/racks/RID/loose]
    ADD_LOOSE --> CHIP[Loose chip rendered<br/>above chassis]
    CHIP -->|tap ×| DELETE[DELETE instantly<br/>no confirm]
    DELETE --> GONE[Chip vanishes]
```

### Rack Preview (chrome-free)

The eye icon on an expanded rack row opens
`/projects/[id]/racks/[rackId]/preview` — a read-only single-rack
view with no navbar and no bottom-nav (same treatment as `/kiosk` and
`/zones`). Server pre-fetches both sides of slots so the side-toggle
costs zero round trips.

```mermaid
flowchart TD
    EYE[Eye icon on expanded rack] -->|click| LOAD[/projects/ID/racks/RID/preview/]
    LOAD --> FETCH[Server fetch<br/>both sides + linked equipment<br/>location + model]

    FETCH --> RENDER{Viewport}
    RENDER -->|md and up| DESKTOP[Front + Rear side-by-side<br/>each labeled above]
    RENDER -->|less than md| MOBILE[Horizontal scroll-snap carousel<br/>slide 0 Front · slide 1 Rear]

    MOBILE --> DOTS[2 cyan dot indicators<br/>tap to scroll · swipe-aware]

    DESKTOP --> SLOTS[Slot cards<br/>label white · linkedLocation cyan · model gray]
    MOBILE --> SLOTS

    SLOTS --> CLOSE{User done?}
    CLOSE -->|tap X| RETURN[router push to<br/>?tab=racks&expand=rackId]
    RETURN --> RESTORE[Inline expansion auto-restores<br/>via one-shot URL effect]
    RESTORE --> EXPAND2[Back on same rack]
```

The URL → state restore is **one-shot on mount** (guarded by
`restoredFromUrlRef`); the `changeExpandedRack()` helper mirrors state
to the URL on every toggle. Together these prevent the "press Close
→ expansion re-opens 1-2 seconds later" bug that would otherwise
happen when a background data refresh re-fired the URL effect with a
stale `?expand=` still in the URL (PD-028).
