/**
 * Built-in device library for the rack designer.
 *
 * Devices are grouped into sections (Frames / 2-Wire / PTP Clock /
 * Switches / Audio / Patchbay / Panels / Drawers / Power / Loose)
 * and shown in the Rack page's device-library column (desktop aside,
 * mobile bottom-sheet). The user can drag a device onto the rack to
 * create a `RackSlot`, or onto the loose tray to create a
 * `RackLooseItem`.
 *
 * Each entry has:
 *   - `name`: displayed in the library list and stored as
 *     `RackSlot.deviceType` / `RackLooseItem.deviceType` on drop.
 *   - `ruSize`: number of RUs the device occupies. `0` means "loose"
 *     — the device gets velcro'd to free space in the rack or tossed
 *     in a drawer, no RU slot, tracked via `RackLooseItem`.
 *   - `category`: matches the filter dropdown sections in the UI.
 *
 * User-authored extras (added via "+ Custom device") live in the
 * `RackDevice` Prisma model — the UI merges this list with that
 * table so customs appear alongside presets.
 */

export type PresetCategory =
  | 'frames'
  | 'twoWire'
  | 'ptp'
  | 'switches'
  | 'audio'
  | 'patchbay'
  | 'panels'
  | 'drawers'
  | 'power'
  | 'loose'

export type PresetDept = 'comms' | 'radios'

export type RackDevicePreset = {
  name: string
  /** 0 for loose gear (no RU). */
  ruSize: number
  category: PresetCategory
}

/**
 * Devices that appear on the COMMS side of the rack designer.
 * Radios racks default to "custom only" for now — they don't surface
 * presets. Crews on the radios side will use "+ Custom device" to
 * build up their own library per show.
 */
export const COMMS_PRESETS: readonly RackDevicePreset[] = [
  // ── Frames (Artist + TRS) ──
  { name: 'Artist-128 Frame',       ruSize: 6, category: 'frames' },
  { name: 'Artist-64 Frame',        ruSize: 3, category: 'frames' },
  { name: 'Artist-32 Frame',        ruSize: 2, category: 'frames' },
  { name: 'Artist-1024 Frame',      ruSize: 2, category: 'frames' },
  { name: 'RTS-ODIN',               ruSize: 1, category: 'frames' },
  { name: 'RTS-OMS',                ruSize: 1, category: 'frames' },

  // ── 2-Wire (party-line / 4-wire interface) ──
  { name: 'IMF 102',                ruSize: 1, category: 'twoWire' },
  { name: 'ST Model 46',            ruSize: 1, category: 'twoWire' },
  { name: 'ST Model 47',            ruSize: 1, category: 'twoWire' },
  { name: 'RTS PS31',               ruSize: 2, category: 'twoWire' },
  // PS21 is a half-RU unit in reality (mounts left or right) but
  // tracked as 1U for now — half-RU support is a follow-up.
  { name: 'RTS PS21',               ruSize: 1, category: 'twoWire' },

  // ── PTP Clock / sync ──
  { name: 'Brainstorm',             ruSize: 1, category: 'ptp' },
  { name: 'Meinberg PTP',           ruSize: 1, category: 'ptp' },

  // ── Managed switches (1RU each) ──
  // Mirrors the hardware types in the Equipment 'switches' category.
  { name: 'Switch · 26P+4F',        ruSize: 1, category: 'switches' },
  { name: 'Switch · 40P+4F',        ruSize: 1, category: 'switches' },
  { name: 'Switch · 24X8F8V',       ruSize: 1, category: 'switches' },
  { name: 'Switch · 16F',           ruSize: 1, category: 'switches' },
  { name: 'Switch · 9P+1F',         ruSize: 1, category: 'switches' },
  { name: 'Pliant Copper Hub',      ruSize: 1, category: 'switches' },
  { name: 'Pliant Fiber Hub',       ruSize: 1, category: 'switches' },
  { name: 'Media Switch',           ruSize: 1, category: 'switches' },

  // ── Audio ──
  { name: 'Dark88',                 ruSize: 1, category: 'audio' },
  { name: 'A16R',                   ruSize: 1, category: 'audio' },

  // ── Patchbay ──
  { name: 'AIO',                    ruSize: 1, category: 'patchbay' },
  { name: 'Fiber',                  ruSize: 1, category: 'patchbay' },
  { name: 'Fiber/Ethercon',         ruSize: 1, category: 'patchbay' },
  { name: 'Ethercon',               ruSize: 1, category: 'patchbay' },

  // ── Panels (filler + passthrough) ──
  // Blank panels in 1/2/3/4 RU — same name, different sizes (the
  // cyan size badge in the library tile distinguishes them, same
  // pattern as the UPS pair).
  { name: 'Blank panel',            ruSize: 1, category: 'panels' },
  { name: 'Blank panel',            ruSize: 2, category: 'panels' },
  { name: 'Blank panel',            ruSize: 3, category: 'panels' },
  { name: 'Blank panel',            ruSize: 4, category: 'panels' },
  { name: 'Passthrough',            ruSize: 1, category: 'panels' },

  // ── Drawers ──
  { name: 'Drawer · 1U',            ruSize: 1, category: 'drawers' },
  { name: 'Drawer · 2U',            ruSize: 2, category: 'drawers' },
  { name: 'Drawer · 3U',            ruSize: 3, category: 'drawers' },
  { name: 'Drawer · 4U',            ruSize: 4, category: 'drawers' },

  // ── Power ──
  { name: 'UPS',                    ruSize: 1, category: 'power' },
  { name: 'UPS',                    ruSize: 2, category: 'power' },
  { name: 'Power Conditioner',      ruSize: 1, category: 'power' },

  // ── Loose gear (no RU — velcro / drawer) ──
  // Unmanaged switches that don't get a rack slot — they get
  // velcro'd to free space in the rack or thrown in a drawer.
  { name: 'Antaira',                ruSize: 0, category: 'loose' },
  { name: 'Intellanet (Old)',       ruSize: 0, category: 'loose' },
  { name: 'Intellanet (New)',       ruSize: 0, category: 'loose' },
  { name: 'TP Link',                ruSize: 0, category: 'loose' },
  { name: 'Netgate',                ruSize: 0, category: 'loose' },
  { name: 'Bolero Antenna Master',  ruSize: 0, category: 'loose' },
] as const

/**
 * Radios racks have no presets in v1 — the operator builds up the
 * library via "+ Custom device" per show. Kept as an empty constant
 * so the UI can reference `PRESETS_BY_DEPT[dept]` symmetrically.
 */
export const RADIOS_PRESETS: readonly RackDevicePreset[] = [] as const

export const PRESETS_BY_DEPT: Readonly<Record<PresetDept, readonly RackDevicePreset[]>> = {
  comms: COMMS_PRESETS,
  radios: RADIOS_PRESETS,
}

/** Display order + labels for the filter dropdown in the library UI. */
export const PRESET_CATEGORY_LABELS: Readonly<Record<PresetCategory, string>> = {
  frames: 'Frames',
  twoWire: '2-Wire',
  ptp: 'PTP Clock',
  switches: 'Switches',
  audio: 'Audio',
  patchbay: 'Patchbay',
  panels: 'Panels',
  drawers: 'Drawers',
  power: 'Power',
  loose: 'Loose gear',
}

export const PRESET_CATEGORY_ORDER: readonly PresetCategory[] = [
  'frames',
  'twoWire',
  'ptp',
  'switches',
  'audio',
  'patchbay',
  'panels',
  'drawers',
  'power',
  'loose',
] as const

/** All valid PresetCategory values, used for runtime validation when
 *  loading user-authored custom devices (where the column is just a
 *  string and could carry an old or invalid value). */
const VALID_CATEGORIES: readonly PresetCategory[] = PRESET_CATEGORY_ORDER

/** Coerce an arbitrary string into a valid PresetCategory. Used to
 *  migrate old custom-device rows (e.g. category='devices' from the
 *  pre-restructure library) onto the new category set — anything
 *  not in the current list falls back to 'frames'. */
export function coerceCategory(s: string | null | undefined): PresetCategory {
  if (s && (VALID_CATEGORIES as readonly string[]).includes(s)) {
    return s as PresetCategory
  }
  return 'frames'
}

/** Find a preset by exact name (used when restoring a slot from the DB). */
export function findPreset(dept: PresetDept, name: string): RackDevicePreset | undefined {
  return PRESETS_BY_DEPT[dept].find((p) => p.name === name)
}
