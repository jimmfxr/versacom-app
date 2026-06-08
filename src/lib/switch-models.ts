/**
 * NETGEAR M4250 family switch model layouts + default VLAN port
 * assignments for Switch Studio.
 *
 * The chassis visualization on /projects/[id]/switch/[equipmentId]
 * reads `getSwitchModel(hardwareType)` to know:
 *   1. How many RJ45 + SFP ports the switch has, in what order.
 *   2. Which VLAN profile each port lands on by default — used the
 *      first time a switch is opened in Switch Studio, when there
 *      are no SwitchPort rows yet for that Equipment row. The
 *      operator can change any port after that.
 *
 * Adding a new switch model means adding an entry to
 * `SWITCH_MODELS` below + a string match in the Equipment hardware-
 * type list. No DB changes needed — port counts + default layouts
 * are pure code.
 *
 * Default assignments are anchored to VLAN IDs (the `vlanId` field
 * on the VlanProfile table) rather than profile names, so renames
 * of the global VLAN list don't break the seed math. Profile IDs
 * are resolved at runtime by the page loader.
 */

/** VLAN IDs the default-assignment tables reference. Keep in sync
 *  with the seed in prisma/migrations/20260608000000_switch_studio/
 *  migration.sql. */
export const VLAN_IDS = {
  CommsDante1: 1331,
  AES67_1: 1341,
  Management: 4000,
} as const

/** One port's seeded default. `vlanId: null + isTrunk: false` means
 *  "leave the port unassigned" — the cell renders as an empty
 *  outlined box. */
export type PortDefault = {
  vlanId: number | null
  isTrunk: boolean
}

/** Layout + defaults for a single switch model. `portIndex` 1..rj45Count
 *  are RJ45; rj45Count+1..rj45Count+sfpCount are SFP. */
export type SwitchModel = {
  /** Display label — what shows in the Switch Studio header next to
   *  the SW N name. Matches what NETGEAR prints on the chassis. */
  label: string
  rj45Count: number
  sfpCount: number
  /** Chassis row count for the Switch Studio grid. Defaults to 2
   *  (odd-top / even-bottom NETGEAR convention). Small / single-row
   *  models (9P+1F, 16F) set this to 1 so all ports render in a
   *  single horizontal strip. */
  chassisRows: 1 | 2
  /** Returns the default VLAN assignment for a given 1-based port
   *  index. Implemented as a function so larger models can describe
   *  the pattern in code instead of listing every port individually. */
  defaultFor: (portIndex: number, portKind: 'rj45' | 'sfp') => PortDefault
}

/**
 * Maps Equipment.hardwareType → SwitchModel. Keys match the strings
 * in src/app/projects/[id]/project-page.tsx HARDWARE_TYPES.switches.
 * Models not in this map don't get a Switch Studio entry point —
 * e.g. unmanaged switches (Antaira, TP Link, Intellanet) have no
 * VLAN configuration to display.
 */
export const SWITCH_MODELS: Record<string, SwitchModel> = {
  /**
   * 9 RJ45 + 1 SFP. Defaults: 1–4 CommsDante1, 5–8 AES67_1, port 9
   * (last RJ45) + SFP → Management trunk. Used as the "small
   * downstage breakout" switch in most show configs.
   */
  '9P+1F': {
    label: 'M4250-9G1F',
    rj45Count: 9,
    sfpCount: 1,
    // Small switch — operator wants all 10 ports in a single row
    // instead of the standard odd-top / even-bottom split.
    chassisRows: 1,
    defaultFor: (portIndex, portKind) => {
      if (portKind === 'sfp') return { vlanId: VLAN_IDS.Management, isTrunk: true }
      if (portIndex === 9) return { vlanId: VLAN_IDS.Management, isTrunk: true }
      if (portIndex <= 4) return { vlanId: VLAN_IDS.CommsDante1, isTrunk: false }
      return { vlanId: VLAN_IDS.AES67_1, isTrunk: false }
    },
  },

  /**
   * 26 RJ45 + 4 SFP. The bread-and-butter house switch. Defaults:
   * 1–12 CommsDante1, 13–24 AES67_1, 25–26 + 4 SFP → Management
   * trunk. Mirrors the operator's standard config straight out of
   * NETGEAR ProAV Engage.
   */
  '26P+4F': {
    label: 'M4250-26G4F-PoE+',
    rj45Count: 26,
    sfpCount: 4,
    chassisRows: 2,
    defaultFor: (portIndex, portKind) => {
      if (portKind === 'sfp') return { vlanId: VLAN_IDS.Management, isTrunk: true }
      if (portIndex >= 25) return { vlanId: VLAN_IDS.Management, isTrunk: true }
      if (portIndex <= 12) return { vlanId: VLAN_IDS.CommsDante1, isTrunk: false }
      return { vlanId: VLAN_IDS.AES67_1, isTrunk: false }
    },
  },

  /**
   * 40 RJ45 + 4 SFP. Bigger version of the 26P+4F — operator wanted
   * a 20/20 split for this one so all 40 RJ45 are used for breakout
   * (1–20 CommsDante1, 21–40 AES67_1), no Management on the RJ45
   * side. Only the 4 SFPs are Management trunk uplinks.
   */
  '40P+4F': {
    label: 'M4250-40G4F-PoE+',
    rj45Count: 40,
    sfpCount: 4,
    chassisRows: 2,
    defaultFor: (portIndex, portKind) => {
      if (portKind === 'sfp') return { vlanId: VLAN_IDS.Management, isTrunk: true }
      if (portIndex <= 20) return { vlanId: VLAN_IDS.CommsDante1, isTrunk: false }
      return { vlanId: VLAN_IDS.AES67_1, isTrunk: false }
    },
  },

  /**
   * 24 RJ45 + 16 SFP — the breakout-heavy variant. Defaults: 1–12
   * CommsDante1, 13–24 AES67_1, all 16 SFP → Management trunk.
   */
  '24X8F8V': {
    label: 'M4250-24X8F8V',
    rj45Count: 24,
    sfpCount: 16,
    chassisRows: 2,
    defaultFor: (portIndex, portKind) => {
      if (portKind === 'sfp') return { vlanId: VLAN_IDS.Management, isTrunk: true }
      if (portIndex <= 12) return { vlanId: VLAN_IDS.CommsDante1, isTrunk: false }
      return { vlanId: VLAN_IDS.AES67_1, isTrunk: false }
    },
  },

  /**
   * 16 SFP-only switch — fiber backbone. All 16 ports are
   * Management trunks by default; operator overrides as needed.
   */
  '16F': {
    label: 'M4250-16F',
    rj45Count: 0,
    sfpCount: 16,
    // Fiber backbone — operator wants all 16 SFPs in a single row
    // (single port bank, no top/bottom split needed).
    chassisRows: 1,
    defaultFor: (_portIndex, _portKind) => ({
      vlanId: VLAN_IDS.Management,
      isTrunk: true,
    }),
  },
}

/** Helper — null when the hardwareType isn't a Switch-Studio-eligible
 *  model. Equipment.category='switches' + non-NETGEAR hardware types
 *  (Antaira, TP Link, Intellanet, Pliant hubs, etc.) intentionally
 *  return null so the Equipment card doesn't render a Switch Studio
 *  link for them. */
export function getSwitchModel(hardwareType: string | null | undefined): SwitchModel | null {
  if (!hardwareType) return null
  return SWITCH_MODELS[hardwareType] ?? null
}

/** Total port count = rj45 + sfp. Equipment.hardwareType drives this
 *  via getSwitchModel. */
export function getSwitchPortCount(hardwareType: string | null | undefined): number {
  const m = getSwitchModel(hardwareType)
  return m ? m.rj45Count + m.sfpCount : 0
}
