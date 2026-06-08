# Frame Studio — Implementation Plan (v2.6 draft)

**Status:** Operator answers locked 2026-06-08. Build in progress.
**Started:** 2026-06-08
**Author:** Jimmy + Claude

## Operator answers (locked)

1. **Allowed cards on 32 / 64 / 128 regular bays:** full list — `AIO`, `CAT5`, `AES`, `COAX`, `VoIP`, `GPI`, `MADI`, `AVB`.
2. **Red bays (per attached Riedel tables):**
   - Bay **A** on every frame → `CPU (S G2)` OR `CPU (F G2)` only
   - Bay **B** on every frame → `CPU (S G2)` OR `CPU (F G2)` OR `GPI`
   - Bay **X** + Bay **Y** on MFR 128 → `GPI` only
3. **Artist 1024 bays 3 + 8 = CPU bays** (operator override — original "NIC only" superseded). Same allowed set as Bay A on the older frames PLUS the legacy `NIC` option as the lazy-seed default per answer #9.
4. **Node ID:** operator-typed string — whatever the frame is programmed with. `FRM 1` stays the friendly auto-name for ordering; the Node ID is the actual hardware identifier.
5. **No colors per card type.** Cells just show the card-type label as text. Selected state via an outline + filled neutral background; chassis is plain.
6. **CAT5 vs AES are TWO separate cards** in the picker (not one card with a mode toggle).
7. **Render only the editable bays.** Skip Fan / PSU / SyncModule / PSU Alarm visuals. Cell label = bay key (`Bay 1`, `Bay A`, …) at the top.
8. **MFR 128 = front view only**, but keep per-model orientation (1024 = horizontal 2×5, 32 = vertical 3×2, etc.).
9. **Lazy-seed defaults:** all bays `<unused>`, except Artist 1024 bays 3 + 8 default to `NIC`.
10. **Node ID field shows on the Equipment Add/Edit form only when `category === 'frames'`** (same conditional pattern as the other categories).

> Sibling feature to Switch Studio (v2.5). Same chrome, same role gating, same lazy-seed pattern, different domain — Riedel Artist frames instead of NETGEAR switches.

---

## TL;DR

- New Equipment category: `frames`
- New hardware types under that category: `ARTIST_32`, `ARTIST_MRF_64`, `ARTIST_MRF_128`, `ARTIST_1024` (all Riedel)
- Equipment card for a frame shows ID (`FRM 1`, `FRM 2`, …) + IP + **Node ID** (the Riedel-side identifier that decides which config file the frame loads)
- Tapping the ID opens **Frame Studio** at `/projects/[id]/frame/[equipmentId]/` — bay-by-bay chassis editor with a card-type picker per bay (same UX as Switch Studio's port-by-port VLAN picker)

---

## 1. Frame models — physical layouts

### Artist 32 (2U)

```
+-----+--------------------------------+----------+
|     |                                |          |
|     |  [Bay 4]      [Bay 1]          |  PSU 1   |
| Fan |  [Bay 3]      [Bay B (red)]    +----------+
|     |  [Bay 2]      [Bay A (red)]    |          |
|     |                                |  PSU 2   |
+-----+--------------------------------+----------+
```

5 configurable bays — **Bay 1, Bay 2, Bay 3, Bay 4** (gray, data card slots) + **Bay A, Bay B** (red, special-purpose).

### Artist MRF 64 (3U)

```
+-----+--------------------------------+----------+
|     |  [Bay 8]      [Bay 3]          |          |
|     |  [Bay 7]      [Bay 2]          |  PSU 1   |
| Fan |  [Bay 6]      [Bay 1]          +----------+
|     |  [Bay 5]      [Bay B (red)]    |          |
|     |  [Bay 4]      [Bay A (red)]    |  PSU 2   |
+-----+--------------------------------+----------+
```

10 configurable bays — **Bay 1..8** (gray) + **Bay A, Bay B** (red).

### Artist MRF 128 (rear-view layout shown)

```
+-----------------------------------------------------------+
| [BayA][BayB][Bay1][Bay2][Bay3][Bay4][Bay5][Bay6][Bay7]    |
| [Bay8][Bay9][Bay10][Bay11][Bay12][Bay13][Bay14][Bay15]    |
| [Bay16][BayX][BayY]                                       |
|                                                           |
|     [SyncModule] [Port 1] [Port 2] [PSU Alarm]            |
|                                                           |
|                                          [PSU 1] [PSU 2]  |
+-----------------------------------------------------------+
```

20 configurable bays — **Bay 1..16** (gray) + **Bay A, B, X, Y** (red/special). Plus a fixed SyncModule.

### Artist 1024 (front-view shown)

10 configurable bays in a 2-row × 5-column layout (positions 1–5 top row, 6–10 bottom row):

```
+----+----+----+----+----+
| 1  | 2  | 3  | 4  | 5  |
+----+----+----+----+----+
| 6  | 7  | 8  | 9  | 10 |
+----+----+----+----+----+
```

- Bays **1, 2, 4, 5, 6, 7, 9, 10** — accept data cards
- Bays **3, 8** — NIC bays only (network interface card or unused)

---

## 2. Card types

From the Director dropdown screenshot. Each option goes into a bay:

| Card | Channels | Notes |
|---|---|---|
| `<unused>` | — | Empty bay |
| COAX-108 G2 | 8 | 8 Channels via Coax |
| CAT5-108 G2 / AES-108 G2 | 8 | Cat5 or AES/EBU 4-Wires (same physical card, different mode?) |
| AIO-108 G2 | 8 | 8 Analogue 4-Wires |
| MADI-108 G2 | 8 | 8 Channels via MADI |
| AES67-108 G2 | 8 | 8 Channels via AES67 |
| DANTE-108 G2 | 8 | 8 Channels via Dante |
| VoIP-108 G2 | 8 | 8 Channels via Voice over IP |
| GPI-116 G2 | 16 in + 16 out | Relay-Outputs + Opto-Inputs |
| NIC | — | Network interface card (only on Bay 3, 8 of 1024) |

**Operator-stated allowed sets** (so far):
- **Artist 1024 — Bays 1,2,4,5,6,7,9,10:** unused, AES-67, DANTE, MADI (subset of the full list)
- **Artist 1024 — Bays 3, 8:** unused, NIC

The other frames (32, 64, 128) — TBD. See open questions §7.

---

## 3. Schema additions

### 3.1 Equipment changes

Add to existing `Equipment` model:

```prisma
model Equipment {
  // ... existing fields ...
  frameNodeId  String?   // Riedel node ID, only set when category='frames'
  // ipAddress already exists - reuse for the frame's IP
}
```

`Equipment.category` enum gets a new value: **`frames`**.

Auto-name rule mirrors switches/panels: `FRM 1`, `FRM 2`, … per project.

### 3.2 New `FrameSlot` model

Same pattern as `SwitchPort`:

```prisma
model FrameSlot {
  id          Int     @id @default(autoincrement())
  equipmentId Int
  bayKey      String  // "1", "2", ..., "A", "B", "X", "Y"
  cardType    String  // "unused" | "coax_108" | "cat5_108" | ... | "nic"
  notes       String?

  equipment   Equipment @relation(fields: [equipmentId], references: [id], onDelete: Cascade)

  @@unique([equipmentId, bayKey])
  @@index([equipmentId])
}
```

Unlike SwitchPort there's no separate Trunk flag — card type is the only state per bay.

### 3.3 Migration

One new migration: `20260609000000_frame_studio` — adds `frameNodeId` column on `Equipment`, creates `FrameSlot` table, adds `frames` to the category enum if Postgres enforces it (today it's a string in code, so just code change).

---

## 4. New library: `src/lib/frame-models.ts`

Mirrors `switch-models.ts`:

```ts
export const CARD_TYPES = {
  unused: { label: '<unused>', shortLabel: 'Empty', color: '#1a1a1a' },
  coax_108: { label: 'COAX-108 G2', shortLabel: 'COAX', color: '...', channels: 8 },
  cat5_108: { label: 'CAT5/AES-108 G2', shortLabel: 'CAT5/AES', color: '...', channels: 8 },
  aio_108: { label: 'AIO-108 G2', shortLabel: 'AIO', color: '...', channels: 8 },
  madi_108: { label: 'MADI-108 G2', shortLabel: 'MADI', color: '...', channels: 8 },
  aes67_108: { label: 'AES67-108 G2', shortLabel: 'AES67', color: '...', channels: 8 },
  dante_108: { label: 'DANTE-108 G2', shortLabel: 'DANTE', color: '...', channels: 8 },
  voip_108: { label: 'VoIP-108 G2', shortLabel: 'VoIP', color: '...', channels: 8 },
  gpi_116: { label: 'GPI-116 G2', shortLabel: 'GPI', color: '...', channels: 32 },
  nic: { label: 'NIC', shortLabel: 'NIC', color: '...', channels: 0 },
} as const

export type FrameModel = {
  label: string                                  // 'Artist 1024', 'Artist 32', etc.
  layoutRows: number                             // 2 for 1024 + 32, 5 for 64, etc.
  bays: Array<{
    key: string                                  // '1', '2', 'A', 'B', ...
    column: 'left' | 'right'                     // optional layout hint
    row: number
    accent: 'gray' | 'red'                       // gray = data, red = special
    allowedCards: ReadonlyArray<keyof typeof CARD_TYPES>
    defaultCard: keyof typeof CARD_TYPES
  }>
  hasFan: boolean                                // 32, 64 show Fan column
  hasSyncModule: boolean                         // 128 has it
  psuCount: 1 | 2                                // all have 2 today
}

export const FRAME_MODELS: Record<string, FrameModel> = {
  ARTIST_32: { /* per the diagrams */ },
  ARTIST_MRF_64: { /* ... */ },
  ARTIST_MRF_128: { /* ... */ },
  ARTIST_1024: { /* 10 bays, bay 3 + 8 are NIC-only */ },
}

export function getFrameModel(hardwareType: string | null | undefined): FrameModel | null { ... }
```

---

## 5. UI surfaces

### 5.1 Equipment card (Comms tab)

New card variant for `category='frames'`:

```
┌──────────────────────────────────────────┐
│  FRM 1            [Status: deployed]     │   ← FRM 1 is a Link
│  Artist 1024                             │
│  IP: 10.249.96.40                        │   ← cyan link to http://IP
│  Node ID: 17                             │
│  [...other rack/equipment chrome...]     │
└──────────────────────────────────────────┘
```

Only frames with a registered hardwareType get a clickable `FRM N` (matches Switch Studio's policy).

### 5.2 Frame Studio page — `/projects/[id]/frame/[equipmentId]/`

Same chrome as Switch Studio:

- Page header: `Comms` + ProjectSwitcher + bottom border, wrapped in `AutoHideHeader`
- Identity strip: `FRM 1 · Artist 1024 · 10.249.96.40 · Node 17` + Close button
  - Wraps to 2 rows on mobile
  - IP renders cyan; clickable
- Chassis renders the model's bay layout
  - Each bay = a tappable cell
  - Color/label by current `cardType`
  - Tap → portaled popover with allowed card types (filtered per bay)
  - Optimistic update + `updateFrameSlot` server action + `router.refresh()` on success

### 5.3 Bay cell rendering

```
┌────────┐
│  Bay 1 │     ← bay key small, top
│        │
│ DANTE  │     ← shortLabel centered
└────────┘
```

Color tokens to pick (TBD — see question §7.5):

| Card | Suggested color |
|---|---|
| unused | dark gray / transparent |
| COAX | brown |
| CAT5/AES | orange |
| AIO | yellow |
| MADI | purple |
| AES67 | blue |
| DANTE | green |
| VoIP | cyan |
| GPI | red |
| NIC | gray with chrome border |

---

## 6. Lazy seeding

Same pattern as Switch Studio. On first open of Frame Studio for an Equipment row, the server checks `equipment.frameSlots.length === 0`. If so, iterate `FrameModel.bays` and INSERT one `FrameSlot` per bay with the bay's `defaultCard`. Subsequent opens skip.

**Default-per-bay policy** (proposal — see question §7.6):
- Artist 32, 64: all gray bays default to `<unused>`; Bay A and Bay B default to `<unused>` too
- Artist 128: all bays default to `<unused>`
- Artist 1024: bays 3 + 8 default to `NIC`; everything else `<unused>`

---

## 7. Open questions (need operator answers)

1. **What card types are allowed on Artist 32 / MRF 64 / MRF 128 bays?** You confirmed 1024 has the unused/AES-67/DANTE/MADI subset on regular bays + unused/NIC on bays 3,8. The other frames' allowed sets are TBD. Is it the FULL list (COAX, CAT5/AES, AIO, MADI, AES67, DANTE, VoIP, GPI) on the gray bays?

2. **What goes in Bay A / Bay B / Bay X / Bay Y (the red bays)?** Are these for special card types (matrix engine, sync, control)? Different allowed set than regular bays?

3. **Artist 1024 — does it have Bay A / Bay B?** The picture only shows numbered 1–10 + Riedel logo + power. So 10 configurable bays total. Want to confirm.

4. **Node ID format** — Is it a number, a string, or both formats valid (e.g. "17" vs "FRM-17")?

5. **Card colors** — Should I use specific Riedel-defined colors per card type, or pick a reasonable palette? Do you have a hex chart like the VLAN one you sent for Switch Studio?

6. **Lazy-seed defaults** — Is the proposal in §6 right (everything `<unused>` except 1024 bays 3+8 = `NIC`)? Or should we pre-populate something like "the most common card mix per frame model"?

7. **CAT5-108 / AES-108** — These appear together in the dropdown ("CAT5-108 G2 (8 Channels via Cat5) or AES-108 G2 (8 AES/EBU 4-Wires)"). Is this **one card** that operator switches modes on, or **two separate cards** to choose between? Should the picker show one entry or two?

8. **Are PSUs / Fan / SyncModule visually represented in Frame Studio**, or only the configurable bays? In Switch Studio we don't show non-configurable parts of the switch.

9. **MFR 128 layout** — The picture is the rear view. Should the chassis layout in Frame Studio render the rear (where the bays are), or the front? Single view or both like Rack Preview?

10. **`frames` category placement on Equipment Add form** — Should it be a dedicated category that exposes the Node ID field (and hides hardware fields that don't apply), same conditional-field approach we did for the other categories?

---

## 8. Build order (once questions answered)

1. **Schema + migration** — add `frameNodeId` to Equipment, create `FrameSlot` table, generate Prisma client
2. **`src/lib/frame-models.ts`** — encode all 4 frame layouts + card type registry
3. **Equipment form** — add `frames` to category dropdown, conditional-show the Node ID field
4. **Equipment card** — frame variant: surface ID + IP + Node ID, make ID a Link to Frame Studio
5. **Frame Studio page (server)** — `/projects/[id]/frame/[equipmentId]/page.tsx` with role gate + lazy seed
6. **Frame Studio client** — `frame-studio.tsx` matching the Switch Studio chrome + chassis grid + popover + server action
7. **Server action** — `updateFrameSlot` with role gating
8. **Docs sweep** — PRD v2.6, PD-034 (Frame Studio), ERD subset diagram, state diagram, sequence diagram, user-flow section, use-case rows

---

## 9. Implementation notes / patterns to reuse

- **Same chrome as Switch Studio**: `Comms` header + ProjectSwitcher + `AutoHideHeader`, identity strip wraps to 2 rows on mobile, labeled Close button.
- **Same popover technique**: `createPortal` to `document.body`, anchored via `getBoundingClientRect`, clamped 8px from viewport edges, z-100/110.
- **Same role gating**: admin + crew edit, manager view-only, user 404 at proxy + server-action re-check.
- **Same scroll-fix pattern**: chassis wrapped in `overflow-x-auto` with `mx-auto w-fit` block bezel — centers when fits, anchors left when wider than viewport.
- **Same Card chrome on the Equipment card**: re-use the existing card component, just swap the body content for the frame variant.
- **Same library file shape as `switch-models.ts`**: typed `FrameModel` with `bays` array; `getFrameModel(hardwareType)` returns the layout.

---

## 10. What this is NOT (out of scope for v2.6)

- Frame channel routing / per-card port mapping (that's Director's domain, would be a Phase 4 feature)
- Live readback from the frame over the network (no API/SNMP integration in v2.6)
- Sync configuration on MFR 128 (the SyncModule + PSU Alarm — display only)
- Front-vs-rear toggle (unless answered yes on question §7.9)
- Multi-frame routing / domain config (each frame is independent at this layer)
