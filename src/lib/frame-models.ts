/**
 * Riedel Artist frame model layouts + per-bay allowed-card tables for
 * Frame Studio.
 *
 * The chassis visualization on /projects/[id]/frame/[equipmentId] reads
 * `getFrameModel(hardwareType)` to know:
 *   1. Which bays this frame model has (e.g. Artist 32 = 6 bays;
 *      MFR 64 = 10; MFR 128 = 20; Artist 1024 = 10).
 *   2. Which card types each bay can accept (regular data bays vs the
 *      red-accent CPU / GPI / NIC bays).
 *   3. The lazy-seed default per bay used on first Frame Studio open
 *      (everything `<unused>` except Artist 1024 bays 3 + 8 which
 *      default to `NIC`).
 *
 * The chassis grid layout is per-model — Artist 32 + MRF 64 use a
 * left-column + right-column split (gray data bays on the left,
 * red CPU bays + numbered bays on the right), MFR 128 uses a wider
 * grid, Artist 1024 uses a 2×5 horizontal grid. The chassis renderer
 * uses `bay.column` + `bay.row` to place each cell — no per-bay style
 * needed in the client.
 *
 * Adding a new frame model means adding a string key here + a string
 * match in the Equipment hardware-type list. No schema change required.
 *
 * Mirrors the switch-models.ts shape on purpose — same `getX()` lookup
 * helper, same lazy-seed contract on the page loader.
 */

// ───────────────────────────────────────────────────────────────────
// Card type catalogue
//
// Every option the operator can pick on a bay. Tokens are stored
// directly in FrameSlot.cardType (no separate join table — the set is
// small + code-only). Labels come from the Director dropdown
// screenshot the operator shared. `Possible Card-Types` tables in the
// Riedel docs drive which bays accept which tokens (see FRAME_MODELS
// below).
// ───────────────────────────────────────────────────────────────────

export type CardType =
  | 'unused'
  | 'aio'
  | 'cat5'
  | 'aes'
  | 'coax'
  | 'voip'
  | 'gpi'
  | 'madi'
  | 'avb'
  | 'aes67'
  | 'dante'
  | 'cpu_s_g2'
  | 'cpu_f_g2'
  | 'nic'

/** Display metadata for a card type. `label` is the long form shown in
 *  the picker; `shortLabel` is what's stamped on the bay cell when the
 *  chassis is rendered. */
export type CardTypeMeta = {
  label: string
  shortLabel: string
  /** Brief description shown under the picker row when expanded.
   *  Optional — short cards skip this. */
  description?: string
}

/** Single source of truth for card type tokens + labels. Order here is
 *  the order the picker uses (popover groups). */
export const CARD_TYPES: Record<CardType, CardTypeMeta> = {
  unused: {
    label: '<unused>',
    shortLabel: 'Empty',
    description: 'No card installed',
  },
  aio: {
    label: 'AIO-108 G2',
    shortLabel: 'AIO',
    description: '8 analog 4-wires',
  },
  cat5: {
    label: 'CAT5-108 G2',
    shortLabel: 'CAT5',
    description: '8 channels via Cat5',
  },
  aes: {
    label: 'AES-108 G2',
    shortLabel: 'AES',
    description: '8 AES/EBU 4-wires',
  },
  coax: {
    label: 'COAX-108 G2',
    shortLabel: 'COAX',
    description: '8 channels via Coax',
  },
  voip: {
    label: 'VoIP-108 G2',
    shortLabel: 'VoIP',
    description: '8 channels via Voice over IP',
  },
  gpi: {
    label: 'GPI-116 G2',
    shortLabel: 'GPI',
    description: '16 relay outputs + 16 opto inputs',
  },
  madi: {
    label: 'MADI-108 G2',
    shortLabel: 'MADI',
    description: '8 channels via MADI',
  },
  avb: {
    label: 'AVB-108 G2',
    shortLabel: 'AVB',
    description: '8 channels via AVB',
  },
  aes67: {
    label: 'AES67-108 G2',
    shortLabel: 'AES67',
    description: '8 channels via AES67',
  },
  dante: {
    label: 'DANTE-108 G2',
    shortLabel: 'DANTE',
    description: '8 channels via Dante',
  },
  cpu_s_g2: {
    label: 'CPU (S G2)',
    shortLabel: 'CPU S',
    description: 'Stand-alone matrix engine, G2',
  },
  cpu_f_g2: {
    label: 'CPU (F G2)',
    shortLabel: 'CPU F',
    description: 'Failover matrix engine, G2',
  },
  nic: {
    label: 'NIC',
    shortLabel: 'NIC',
    description: 'Network interface card (1024 bays 3 + 8 only)',
  },
}

/** Card-type sets used across multiple bays. Defining them once keeps
 *  the FRAME_MODELS table below readable. */
const DATA_BAY_CARDS: readonly CardType[] = [
  'unused',
  'aio',
  'cat5',
  'aes',
  'coax',
  'voip',
  'gpi',
  'madi',
  'avb',
] as const

/** Bay A on every Artist frame — CPU only (Riedel "S or F G2"). */
const BAY_A_CARDS: readonly CardType[] = ['unused', 'cpu_s_g2', 'cpu_f_g2'] as const

/** Bay B on every Artist frame — CPU + GPI. */
const BAY_B_CARDS: readonly CardType[] = [
  'unused',
  'cpu_s_g2',
  'cpu_f_g2',
  'gpi',
] as const

/** Bay X + Bay Y on MFR 128 — GPI only. */
const BAY_XY_CARDS: readonly CardType[] = ['unused', 'gpi'] as const

/** Artist 1024 bays 3 + 8 — operator confirmed only `unused` and
 *  `nic` are valid for these slots; CPU cards don't fit this bay
 *  position on the 1024 chassis (CPU is mounted elsewhere). Lazy-
 *  seed defaults to NIC since that's the typical population. */
const ARTIST_1024_CPU_BAY_CARDS: readonly CardType[] = ['unused', 'nic'] as const

// ───────────────────────────────────────────────────────────────────
// Frame model definitions
// ───────────────────────────────────────────────────────────────────

/** One bay's layout + allowed cards. Position is column + row in a
 *  per-model grid (each FrameModel decides how many columns + rows it
 *  uses; the chassis renderer reads `cols` + `rows` from the model
 *  and the `column` + `row` from each bay). */
export type FrameBay = {
  /** Bay label as printed on the chassis face — "1", "2", ..., "A",
   *  "B", "X", "Y". Stored as the FrameSlot.bayKey so re-renders
   *  don't need positional math. */
  key: string
  /** 1-based column index inside the chassis grid. */
  column: number
  /** 1-based row index inside the chassis grid. */
  row: number
  /** Operator-facing accent. 'red' bays are CPU / GPI / specialty
   *  bays in the Riedel docs (matches the red shading in the
   *  product diagrams). 'gray' is regular data bays. */
  accent: 'gray' | 'red'
  /** Whitelist of card types this bay accepts. Validated server-side
   *  in the updateFrameSlot action. */
  allowedCards: readonly CardType[]
  /** Lazy-seed default used on first Frame Studio open. Must be in
   *  `allowedCards`. */
  defaultCard: CardType
}

export type FrameModel = {
  /** Display label used in the Frame Studio identity strip + the
   *  Equipment card. Matches the Riedel-printed model name. */
  label: string
  /** Grid dimensions for the chassis layout. Bays place via
   *  (column, row). */
  cols: number
  rows: number
  /** Physical chassis height in rack units. Used by Rack Studio when
   *  surfacing a frame as a library tile so the slot is sized
   *  correctly on drop. Matches the Riedel-published spec sheets:
   *  Artist 32 = 2U, MRF 64 = 3U, MFR 128 = 6U, Artist 1024 = 2U. */
  ruSize: number
  /** When true, the bay-edit popover uses CardTypeMeta.shortLabel
   *  ('AIO', 'DANTE', 'MADI', etc.) instead of CardTypeMeta.label
   *  ('AIO-108 G2', 'DANTE-108 G2', ...). The '-108 G2' / '-116 G2'
   *  Riedel naming convention is specific to the older 32 / MRF 64 /
   *  MFR 128 frames; the 1024 uses unsuffixed card names in Director,
   *  so the picker labels follow suit. */
  useShortCardLabels?: boolean
  /** All editable bays in this model. Iterated by the page loader for
   *  lazy-seed; iterated by the client for rendering. */
  bays: readonly FrameBay[]
}

// Builder helpers — keep the per-model declarations tight. The bay
// numbering on each Artist model follows the Riedel-printed pattern;
// see the operator-provided diagrams + tables for source.

/** Build a sequence of numbered data bays at the given column /
 *  starting row. Used by Artist 32 / MRF 64 / MFR 128 / Artist 1024. */
function dataBays(
  fromKey: number,
  toKey: number,
  layout: { column: number; startingRow: number; stride: 1 | -1 },
): FrameBay[] {
  const out: FrameBay[] = []
  let row = layout.startingRow
  for (let k = fromKey; k <= toKey; k++) {
    out.push({
      key: String(k),
      column: layout.column,
      row,
      accent: 'gray',
      allowedCards: DATA_BAY_CARDS,
      defaultCard: 'unused',
    })
    row += layout.stride
  }
  return out
}

/** All five Riedel Artist frames the operator wants modelled. Keyed by
 *  Equipment.hardwareType so getFrameModel(equipment.hardwareType)
 *  resolves directly. */
export const FRAME_MODELS: Record<string, FrameModel> = {
  /**
   * Artist 32 (2U). Five editable bays + the (non-rendered) Fan + 2
   * PSUs. Layout per Riedel Figure 15 (front view):
   *
   *   Left column (data):       Right column (CPU + data):
   *     Row 1: Bay 4              Row 1: Bay 1
   *     Row 2: Bay 3              Row 2: Bay B (red)
   *     Row 3: Bay 2              Row 3: Bay A (red)
   *
   * Operator-stated card sets:
   *   Bay 1..4 — full data list (AIO/CAT5/AES/COAX/VoIP/GPI/MADI/AVB)
   *   Bay A    — CPU S G2 or CPU F G2
   *   Bay B    — CPU S G2 / CPU F G2 / GPI
   */
  ARTIST_32: {
    label: 'Artist 32',
    cols: 2,
    rows: 3,
    ruSize: 2,
    bays: [
      // Left column (Bay 4 top → Bay 2 bottom; reads top-down on the
      // chassis).
      ...dataBays(2, 4, { column: 1, startingRow: 3, stride: -1 }),
      // Right column.
      { key: '1', column: 2, row: 1, accent: 'gray', allowedCards: DATA_BAY_CARDS, defaultCard: 'unused' },
      { key: 'B', column: 2, row: 2, accent: 'red', allowedCards: BAY_B_CARDS, defaultCard: 'unused' },
      { key: 'A', column: 2, row: 3, accent: 'red', allowedCards: BAY_A_CARDS, defaultCard: 'unused' },
    ],
  },

  /**
   * Artist MRF 64 (3U). Ten editable bays. Layout per Riedel Figure 9:
   *
   *   Left column (data):       Right column (CPU + data):
   *     Row 1: Bay 8              Row 1: Bay 3
   *     Row 2: Bay 7              Row 2: Bay 2
   *     Row 3: Bay 6              Row 3: Bay 1
   *     Row 4: Bay 5              Row 4: Bay B (red)
   *     Row 5: Bay 4              Row 5: Bay A (red)
   */
  ARTIST_MRF_64: {
    label: 'Artist MRF 64',
    cols: 2,
    rows: 5,
    ruSize: 3,
    bays: [
      // Left column — bays 4..8 stacked bottom→top so 8 sits at the top
      // matching the chassis face.
      ...dataBays(4, 8, { column: 1, startingRow: 5, stride: -1 }),
      // Right column.
      ...dataBays(1, 3, { column: 2, startingRow: 3, stride: -1 }),
      { key: 'B', column: 2, row: 4, accent: 'red', allowedCards: BAY_B_CARDS, defaultCard: 'unused' },
      { key: 'A', column: 2, row: 5, accent: 'red', allowedCards: BAY_A_CARDS, defaultCard: 'unused' },
    ],
  },

  /**
   * Artist MFR 128 (rear-view layout per Riedel Figure 4). 20 editable
   * bays in ONE horizontal row, left to right:
   *
   *   [A] [B] [1] [2] [3] [4] [5] [6] [7] [8] [9] [10] [11] [12] [13] [14] [15] [16] [X] [Y]
   *
   * Operator-stated card sets:
   *   Bay 1..16 — full data list (AIO/CAT5/AES/COAX/VoIP/GPI/MADI/AVB)
   *   Bay A     — CPU S G2 or CPU F G2
   *   Bay B     — CPU S G2 / CPU F G2 / GPI
   *   Bay X     — GPI only
   *   Bay Y     — GPI only
   *
   * The Riedel-shipped diagram is the rear view (where the bays live
   * physically); the operator confirmed we render this orientation
   * without a separate front-view toggle.
   */
  ARTIST_MRF_128: {
    label: 'Artist MFR 128',
    cols: 20,
    rows: 1,
    ruSize: 6,
    bays: (() => {
      // 20 bays left→right: A, B, 1..16, X, Y. Numbered bays share
      // allowed cards + default, build once for brevity.
      const dataBay = (key: string, column: number): FrameBay => ({
        key,
        column,
        row: 1,
        accent: 'gray',
        allowedCards: DATA_BAY_CARDS,
        defaultCard: 'unused',
      })
      return [
        // Columns 1 and 2: A, B (CPU + GPI).
        { key: 'A', column: 1, row: 1, accent: 'red' as const, allowedCards: BAY_A_CARDS, defaultCard: 'unused' as CardType },
        { key: 'B', column: 2, row: 1, accent: 'red' as const, allowedCards: BAY_B_CARDS, defaultCard: 'unused' as CardType },
        // Columns 3..18: numbered bays 1..16.
        ...Array.from({ length: 16 }, (_, i) => dataBay(String(i + 1), i + 3)),
        // Columns 19 and 20: X, Y (GPI).
        { key: 'X', column: 19, row: 1, accent: 'red' as const, allowedCards: BAY_XY_CARDS, defaultCard: 'unused' as CardType },
        { key: 'Y', column: 20, row: 1, accent: 'red' as const, allowedCards: BAY_XY_CARDS, defaultCard: 'unused' as CardType },
      ]
    })(),
  },

  /**
   * Artist 1024 — 10 bays in a 2-row × 5-column horizontal layout per
   * the operator-provided chassis photo:
   *
   *   Row 1:  [1] [2] [3] [4] [5]
   *   Row 2:  [6] [7] [8] [9] [10]
   *
   * Operator-stated card sets:
   *   Bay 1, 2, 4, 5, 6, 7, 9, 10 — operator's typical subset (unused,
   *     AES-67, DANTE, MADI). Modelled here as ['unused', 'aes67',
   *     'dante', 'madi'] per the original spec.
   *   Bay 3, 8 — NIC-only bays. Allowed: unused / NIC. CPU cards
   *     don't fit this position on the 1024 chassis. Lazy-seed
   *     default is NIC because that's the typical population.
   *
   * No Bay A / Bay B on the 1024 — the operator confirmed the photo
   * shows positions 1..10 only.
   */
  ARTIST_1024: {
    label: 'Artist 1024',
    cols: 5,
    rows: 2,
    ruSize: 2,
    // 1024 cards use the short Riedel-Director names (AES67, DANTE,
    // MADI, NIC) — the -108 G2 / -116 G2 suffix is older-frame
    // terminology (32 / MRF 64 / MFR 128).
    useShortCardLabels: true,
    bays: [
      // Row 1: bays 1, 2, 3, 4, 5.
      { key: '1', column: 1, row: 1, accent: 'gray', allowedCards: ['unused', 'aes67', 'dante', 'madi'], defaultCard: 'unused' },
      { key: '2', column: 2, row: 1, accent: 'gray', allowedCards: ['unused', 'aes67', 'dante', 'madi'], defaultCard: 'unused' },
      { key: '3', column: 3, row: 1, accent: 'red', allowedCards: ARTIST_1024_CPU_BAY_CARDS, defaultCard: 'nic' },
      { key: '4', column: 4, row: 1, accent: 'gray', allowedCards: ['unused', 'aes67', 'dante', 'madi'], defaultCard: 'unused' },
      { key: '5', column: 5, row: 1, accent: 'gray', allowedCards: ['unused', 'aes67', 'dante', 'madi'], defaultCard: 'unused' },
      // Row 2: bays 6, 7, 8, 9, 10.
      { key: '6', column: 1, row: 2, accent: 'gray', allowedCards: ['unused', 'aes67', 'dante', 'madi'], defaultCard: 'unused' },
      { key: '7', column: 2, row: 2, accent: 'gray', allowedCards: ['unused', 'aes67', 'dante', 'madi'], defaultCard: 'unused' },
      { key: '8', column: 3, row: 2, accent: 'red', allowedCards: ARTIST_1024_CPU_BAY_CARDS, defaultCard: 'nic' },
      { key: '9', column: 4, row: 2, accent: 'gray', allowedCards: ['unused', 'aes67', 'dante', 'madi'], defaultCard: 'unused' },
      { key: '10', column: 5, row: 2, accent: 'gray', allowedCards: ['unused', 'aes67', 'dante', 'madi'], defaultCard: 'unused' },
    ],
  },
}

/** Helper — null when the hardwareType isn't a registered Artist
 *  frame. Used by the Equipment card to decide whether the ID text
 *  should be a Link to Frame Studio (matches the Switch-Studio
 *  link-only-when-model-exists policy). */
export function getFrameModel(hardwareType: string | null | undefined): FrameModel | null {
  if (!hardwareType) return null
  return FRAME_MODELS[hardwareType] ?? null
}

/** Display label for a card-type token. Falls back to the token
 *  itself for unknown values (defensive — should never happen in
 *  practice since updateFrameSlot validates against allowedCards).
 *
 *  When a FrameModel is provided AND that model has
 *  `useShortCardLabels: true` (the 1024 case), returns the short
 *  label instead. Lets the bay-edit popover pick the right
 *  Riedel naming convention per frame model. */
export function getCardLabel(cardType: string, model?: FrameModel | null): string {
  const meta = CARD_TYPES[cardType as CardType]
  if (!meta) return cardType
  if (model?.useShortCardLabels) return meta.shortLabel
  return meta.label
}

/** Short label stamped on the bay cell in the chassis grid. */
export function getCardShortLabel(cardType: string): string {
  return CARD_TYPES[cardType as CardType]?.shortLabel ?? cardType
}
