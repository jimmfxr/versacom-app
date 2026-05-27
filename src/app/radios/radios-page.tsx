'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'
import { ComboboxInput } from '@/components/combobox-input'
import { IconButton } from '@/components/icon-button'
import { ProjectSwitcher } from '@/app/project-dashboard'
import { RadioStatusSelect } from '@/components/radio-status-select'
import type { RadioStatus } from '@/lib/radio-status'
import {
  bulkCreateRadios,
  updateRadio,
  deleteRadio,
  setRadioZones,
  createZone,
  updateZone,
  deleteZone,
  setRadioStatus,
} from './actions'

// Phase-1 surface is admin/manager only. User/crew get the zone
// channel cards on /my-equipment once phase 4 lands; they never hit
// this page (the server redirects them).

type Radio = {
  id: number
  name: string
  firstName: string | null
  lastName: string | null
  department: string | null
  position: string | null
  barcode: string | null
  status: string
  assignedToProjectMemberId: number | null
  fistMic: boolean
  surveillance: boolean
  doubleMuff: boolean
  lightweight: boolean
  zoneIds: number[]
}

type TeamMember = {
  id: number
  firstName: string
  lastName: string
  department: string | null
  position: string | null
}

type Zone = {
  id: number
  name: string
  order: number
  channels: Array<{ id: number; channelIndex: number; name: string | null }>
}

type UserProject = { id: number; name: string; pin: string | null }

type RadiosTab = 'equipment' | 'channels'

/**
 * Phase-1 Radios surface — admin / manager editor only.
 *
 * Layout: list + bulk-add card + in-place edit card per radio.
 * Keyboard parity with Equipment: Enter on a list row opens it; Enter
 * inside the edit card saves + hops to the next row; first-name field
 * auto-focuses on open.
 *
 * Autocomplete on first/last name pulls from the project's team
 * members. Typing a full match stamps the linked member's id +
 * pre-fills blank department / position fields. Typing a fresh name
 * (not on the team) leaves the FK null and the row stands on its own.
 */
export function RadiosPage({
  projectId,
  userProjects,
  radios,
  teamMembers,
  departmentSuggestions,
  zones,
}: {
  projectId: number
  userProjects: UserProject[]
  radios: Radio[]
  teamMembers: TeamMember[]
  departmentSuggestions: string[]
  zones: Zone[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddZone, setShowAddZone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<RadiosTab>('equipment')
  // Search toggle + active query — same pattern as the Comms page.
  // Icon by default, expands inline into an input with an X close.
  // The query filters whichever tab is active (radios on Equipment,
  // zones on Radio channels).
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const visibleRadios = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return radios
    return radios.filter((r) => {
      const haystack = [
        r.name,
        r.firstName ?? '',
        r.lastName ?? '',
        r.department ?? '',
        r.position ?? '',
        r.barcode ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [radios, searchQuery])

  const visibleZones = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return zones
    return zones.filter((z) => z.name.toLowerCase().includes(q))
  }, [zones, searchQuery])

  // Switcher for the project dropdown — admins/managers see every
  // project they're on, like Notifications and Tasks.
  const selectedProject = userProjects.find((p) => p.id === projectId) ?? null

  function startEdit(radio: Radio) {
    setEditingId(radio.id)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
  }

  // Radio assignment stat — driven by both the FK link and the
  // typed firstName+lastName so radios with manually-entered names
  // (no team member) still count as assigned.
  const totalRadios = radios.length
  const assignedRadios = radios.filter(
    (r) =>
      r.assignedToProjectMemberId != null ||
      (r.firstName && r.firstName.trim()) ||
      (r.lastName && r.lastName.trim()),
  ).length

  // The toolbar (project switcher + stats + tab dropdown + Add) all
  // pin above the scrolling list — same kiosk-style behavior as
  // Project Details. `stickyHeader` on PageLayout flips the layout
  // into viewport-locked mode; the toolbar block below is
  // flex-shrink-0 so it never moves while the cards scroll.
  // `+` button on the toolbar opens the right add-card depending on
  // which tab is active. Hidden when that tab's add-card is already
  // open (the X on the card itself closes it).
  const addOpen = tab === 'equipment' ? showAdd : showAddZone
  const addButton = !addOpen ? (
    <button
      type="button"
      onClick={() => {
        if (tab === 'equipment') setShowAdd(true)
        else setShowAddZone(true)
        setEditingId(null)
        setError(null)
      }}
      aria-label={tab === 'equipment' ? 'Add radios' : 'Add zone'}
      className="rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7]"
    >
      +
    </button>
  ) : null

  // Search toggle — same UX as the Comms page. Icon by default;
  // tapping reveals an input (autofocused) + an X to collapse back to
  // the icon. Used in both mobile + desktop toolbars below.
  const searchBlock = searchOpen ? (
    <>
      <input
        type="text"
        autoFocus
        placeholder={tab === 'equipment' ? 'Search radios…' : 'Search zones…'}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-[280px] rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
      />
      <button
        type="button"
        onClick={() => { setSearchOpen(false); setSearchQuery('') }}
        aria-label="Close search"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
      >
        <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={() => setSearchOpen(true)}
      aria-label="Search"
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
    >
      <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.343-4.343m0 0A8 8 0 1 0 5.343 5.343a8 8 0 0 0 11.314 11.314Z" />
      </svg>
    </button>
  )

  return (
    <>
    <PageLayout
      title="Radios"
      titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
      bottomBorder
      inlineAction
      stickyHeader
      action={
        // Mobile: scanner (size-9) sits to the LEFT of the project
        // switcher; the switcher itself is exactly half the viewport
        // content area (50vw - 1rem accounts for the px-4 page padding).
        // Desktop: switcher's min-w-[280px] kicks in so its width
        // doesn't depend on viewport math.
        <div className="flex items-center justify-end gap-2">
          {/* QR + Scanner icon buttons moved into the global Navbar
              (left of the bell on desktop, in the 3-up grid on
              mobile). The header just owns the project switcher
              now. */}
          {userProjects.length > 0 && (
            <div className="w-[calc(50vw-1rem)] sm:w-auto">
              <ProjectSwitcher
                projectId={selectedProject?.id ?? null}
                projectName={selectedProject?.name ?? '—'}
                userProjects={userProjects}
                basePath="/radios"
              />
            </div>
          )}
        </div>
      }
    >
      {/* Toolbar — pins above the scrolling list.
          Project switcher + scanner moved into the PageLayout header
          (top right) on every viewport. This toolbar carries the tab
          dropdown + search + Add only. */}
      <div className="flex-shrink-0 space-y-3 pb-3">
        {/* Mobile-only: tab dropdown + search + Add directly under
            project. When search is open the dropdown shrinks and the
            input takes the space between it and the X close button. */}
        <div className="flex items-center gap-2 sm:hidden">
          {!searchOpen && (
            <div className="flex-1">
              <TabDropdown value={tab} onChange={setTab} />
            </div>
          )}
          {searchOpen ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                autoFocus
                placeholder={tab === 'equipment' ? 'Search radios…' : 'Search zones…'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 rounded-lg border-2 border-white/10 bg-[#202020] px-3.5 py-2 text-sm text-gray-200 placeholder-gray-200 outline-none transition-colors hover:border-white/20 hover:bg-white/[0.04] focus:border-[#0178a3]"
              />
              <button
                type="button"
                onClick={() => { setSearchOpen(false); setSearchQuery('') }}
                aria-label="Close search"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
              >
                <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.343-4.343m0 0A8 8 0 1 0 5.343 5.343a8 8 0 0 0 11.314 11.314Z" />
              </svg>
            </button>
          )}
          {addButton}
        </div>

        {/* Stats row.
            Mobile: stat sits alone (tab dropdown + Add already lived
            on the row above).
            Desktop: stat on the left + tab dropdown + Add on the
            right. The right group reserves enough width (sm:min-w-
            [328px]: 280 + gap + ~40 button) so the dropdown's `flex-1`
            expands to fill when Add is hidden. */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-gray-500">
            {assignedRadios} of {totalRadios} assigned
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            {!searchOpen && (
              <div className="w-[280px] min-w-0">
                <TabDropdown value={tab} onChange={setTab} />
              </div>
            )}
            {searchBlock}
            {addButton}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex-shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Scrollable content region — flex-1 + overflow-y-auto so it
          fills the rest of the viewport-locked page and the toolbar
          above stays pinned. Pads the bottom so the last card clears
          iOS PWA home-indicator territory. `data-scroll-container`
          opts this region into the global ScrollToTop button. */}
      <div data-scroll-container className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none pb-20">
      {/* ─── Equipment tab ─────────────────────────────────────── */}
      {tab === 'equipment' && (<>
      {/* Bulk-add card */}
      {showAdd && (
        <BulkAddCard
          projectId={projectId}
          isPending={isPending}
          onCancel={() => setShowAdd(false)}
          onSubmit={(qty, startingId) => {
            setError(null)
            startTransition(async () => {
              const res = await bulkCreateRadios(projectId, qty, startingId)
              if ('error' in res && res.error) {
                setError(res.error)
                return
              }
              setShowAdd(false)
              router.refresh()
            })
          }}
        />
      )}

      {visibleRadios.length === 0 ? (
        <EmptyState
          icon={
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9h6v6H9V9zm-2 0v6m10-6v6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
            </svg>
          }
          title="No radios yet"
          message="Tap + to bulk-create radios for this show."
        />
      ) : (
        <div className="pb-20">
          {visibleRadios.map((radio, idx) => (
            <RadioCard
              key={radio.id}
              radio={radio}
              editing={editingId === radio.id}
              isPending={isPending}
              teamMembers={teamMembers}
              departmentSuggestions={departmentSuggestions}
              zones={zones}
              onOpen={() => startEdit(radio)}
              onCancel={cancelEdit}
              onSave={(data, nextZoneIds) => {
                setError(null)
                startTransition(async () => {
                  const res = await updateRadio(radio.id, data)
                  if ('error' in res && res.error) {
                    setError(res.error)
                    return
                  }
                  // Persist zone selection alongside the field update.
                  // Compares against the snapshot loaded on edit-open so
                  // we don't write when nothing changed.
                  const before = [...radio.zoneIds].sort().join(',')
                  const after = [...nextZoneIds].sort().join(',')
                  if (before !== after) {
                    const zRes = await setRadioZones(radio.id, nextZoneIds)
                    if ('error' in zRes && zRes.error) {
                      setError(zRes.error)
                      return
                    }
                  }
                  // Hop to next card so Enter-Enter rapid-edits crew lists.
                  const next = visibleRadios[idx + 1]
                  setEditingId(next ? next.id : null)
                  router.refresh()
                })
              }}
              onDelete={() => {
                if (!window.confirm(`Delete radio "${radio.name}"?`)) return
                setError(null)
                startTransition(async () => {
                  const res = await deleteRadio(radio.id)
                  if ('error' in res && res.error) {
                    setError(res.error)
                    return
                  }
                  setEditingId(null)
                  router.refresh()
                })
              }}
              onStatusChange={(next) => {
                setError(null)
                startTransition(async () => {
                  const res = await setRadioStatus(radio.id, next)
                  if ('error' in res && res.error) {
                    setError(res.error)
                    return
                  }
                  router.refresh()
                })
              }}
            />
          ))}
        </div>
      )}
      </>)}

      {/* ─── Radio channels tab ────────────────────────────────── */}
      {tab === 'channels' && (
        <ZonesEditor
          projectId={projectId}
          zones={visibleZones}
          isPending={isPending}
          showAdd={showAddZone}
          onCloseAdd={() => setShowAddZone(false)}
          onCreate={(name) => {
            setError(null)
            startTransition(async () => {
              const res = await createZone(projectId, name)
              if ('error' in res && res.error) {
                setError(res.error)
                return
              }
              setShowAddZone(false)
              router.refresh()
            })
          }}
          onUpdate={(zoneId, data) => {
            setError(null)
            startTransition(async () => {
              const res = await updateZone(zoneId, data)
              if ('error' in res && res.error) {
                setError(res.error)
                return
              }
              router.refresh()
            })
          }}
          onDelete={(zoneId, name) => {
            if (!window.confirm(`Delete zone "${name}"? This removes its 16 channels for every radio assigned to it.`)) return
            setError(null)
            startTransition(async () => {
              const res = await deleteZone(zoneId)
              if ('error' in res && res.error) {
                setError(res.error)
                return
              }
              router.refresh()
            })
          }}
        />
      )}
      </div>
    </PageLayout>

    {/* The page-local join-QR modal moved to the global Navbar so
        the QR icon now lives in the nav alongside Scanner + Kiosk
        (left of the bell on desktop, in the 3-up grid on mobile). */}
    </>
  )
}

// ─── Tab dropdown (Equipment / Radio channels) ────────────────────
//
// Cloned from TabsMobileDropdown in src/app/projects/[id]/project-page.tsx
// so the chrome matches the Project Details tab dropdown exactly
// (px-3.5 py-2 text-sm border-2, dark popover, cyan active row).
// Goes full-width on mobile so it pairs cleanly with the + button on
// the dropdown+add row; collapses to inline+min-w-[200px] on desktop.

const RADIO_TABS: Array<{ key: RadiosTab; label: string }> = [
  { key: 'equipment', label: 'Equipment' },
  { key: 'channels', label: 'Radio channels' },
]

function TabDropdown({
  value,
  onChange,
}: {
  value: RadiosTab
  onChange: (v: RadiosTab) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const active = RADIO_TABS.find((t) => t.key === value) ?? RADIO_TABS[0]

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2.5 rounded-lg border-2 bg-[#202020] px-3.5 py-2 text-sm font-medium text-white transition-colors ${
          open ? 'border-[#0178a3]' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <span>{active.label}</span>
        <svg
          className={`size-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="5 8 10 13 15 8" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-white/10 bg-[#2a2a2a] p-1 shadow-2xl">
          {RADIO_TABS.map((t) => {
            const isActive = t.key === value
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onChange(t.key)
                }}
                className={`flex w-full items-center rounded-md px-3 py-2 text-left transition-colors ${
                  isActive ? 'bg-[#0178a3]' : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-200'}`}>
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Bulk add ──────────────────────────────────────────────────────

function BulkAddCard({
  projectId: _projectId,
  isPending,
  onSubmit,
  onCancel,
}: {
  projectId: number
  isPending: boolean
  onSubmit: (qty: number, startingId: string) => void
  onCancel: () => void
}) {
  const [quantity, setQuantity] = useState('1')
  const [startingId, setStartingId] = useState('')

  function submit() {
    const qty = parseInt(quantity, 10)
    if (!Number.isFinite(qty) || qty < 1) return
    onSubmit(qty, startingId)
  }

  return (
    <div className="mb-3 border-b border-white/[0.06] px-2 py-4">
      <div className="mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Add radios
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field
            label="Quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(v) => setQuantity(v.replace(/\D/g, ''))}
            disabled={isPending}
          />
          <Field
            label="Starting ID"
            placeholder="RAD 1 (auto)"
            value={startingId}
            onChange={setStartingId}
            disabled={isPending}
          />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || !quantity}
            className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Card (display + edit) ─────────────────────────────────────────

function RadioCard({
  radio,
  editing,
  isPending,
  teamMembers,
  departmentSuggestions,
  zones,
  onOpen,
  onCancel,
  onSave,
  onDelete,
  onStatusChange,
}: {
  radio: Radio
  editing: boolean
  isPending: boolean
  teamMembers: TeamMember[]
  departmentSuggestions: string[]
  zones: Zone[]
  onOpen: () => void
  onCancel: () => void
  onSave: (
    data: {
      name: string
      firstName: string | null
      lastName: string | null
      department: string | null
      position: string | null
      barcode: string | null
      assignedToProjectMemberId: number | null
      fistMic: boolean
      surveillance: boolean
      doubleMuff: boolean
      lightweight: boolean
    },
    nextZoneIds: number[],
  ) => void
  onDelete: () => void
  onStatusChange: (next: RadioStatus) => void
}) {
  const [name, setName] = useState(radio.name)
  const [firstName, setFirstName] = useState(radio.firstName ?? '')
  const [lastName, setLastName] = useState(radio.lastName ?? '')
  const [department, setDepartment] = useState(radio.department ?? '')
  const [position, setPosition] = useState(radio.position ?? '')
  const [barcode, setBarcode] = useState(radio.barcode ?? '')
  const [memberId, setMemberId] = useState<number | null>(radio.assignedToProjectMemberId)
  const [fistMic, setFistMic] = useState(radio.fistMic)
  const [surveillance, setSurveillance] = useState(radio.surveillance)
  const [doubleMuff, setDoubleMuff] = useState(radio.doubleMuff)
  const [lightweight, setLightweight] = useState(radio.lightweight)
  const [selectedZoneIds, setSelectedZoneIds] = useState<number[]>(radio.zoneIds)

  // Reset local state on each open so cancelling and re-opening the
  // SAME row starts from the persisted values, not the last unsaved
  // edits.
  useEffect(() => {
    if (editing) {
      setName(radio.name)
      setFirstName(radio.firstName ?? '')
      setLastName(radio.lastName ?? '')
      setDepartment(radio.department ?? '')
      setPosition(radio.position ?? '')
      setBarcode(radio.barcode ?? '')
      setMemberId(radio.assignedToProjectMemberId)
      setFistMic(radio.fistMic)
      setSurveillance(radio.surveillance)
      setDoubleMuff(radio.doubleMuff)
      setLightweight(radio.lightweight)
      setSelectedZoneIds(radio.zoneIds)
    }
  }, [editing, radio])

  // Autosuggest team members by typed first name. Match is
  // case-insensitive prefix. When the typed value exactly matches one,
  // we offer to apply that member's full record.
  const firstNameSuggestions = useMemo(
    () => Array.from(new Set(teamMembers.map((m) => m.firstName))).sort(),
    [teamMembers],
  )
  const lastNameSuggestions = useMemo(
    () => Array.from(new Set(teamMembers.map((m) => m.lastName))).sort(),
    [teamMembers],
  )
  const positionSuggestions = useMemo(
    () => Array.from(
      new Set(teamMembers.map((m) => m.position?.trim()).filter((p): p is string => !!p)),
    ).sort(),
    [teamMembers],
  )

  /**
   * When the operator types a full name that matches a team member,
   * auto-fill department / position and stamp the FK. Re-runs on every
   * first/last change.
   */
  useEffect(() => {
    const fn = firstName.trim().toLowerCase()
    const ln = lastName.trim().toLowerCase()
    if (!fn || !ln) return
    const match = teamMembers.find(
      (m) =>
        m.firstName.toLowerCase() === fn && m.lastName.toLowerCase() === ln,
    )
    if (match) {
      setMemberId(match.id)
      // Only pre-fill blank fields so we don't clobber the operator's
      // manual overrides if they typed something different.
      setDepartment((d) => (d.trim() === '' ? match.department ?? '' : d))
      setPosition((p) => (p.trim() === '' ? match.position ?? '' : p))
    } else {
      setMemberId(null)
    }
    // We deliberately exclude department/position from deps — those
    // change as side effects of THIS effect and would cause loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, lastName, teamMembers])

  function save() {
    if (!name.trim()) return
    onSave(
      {
        name: name.trim(),
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        department: department.trim() || null,
        position: position.trim() || null,
        barcode: barcode.trim() || null,
        assignedToProjectMemberId: memberId,
        fistMic,
        surveillance,
        doubleMuff,
        lightweight,
      },
      selectedZoneIds,
    )
  }

  if (!editing) {
    return (
      // Mobile: stacked rows — (1) identity strip, (2) chips + barcode
      // wrap together to fill the remaining width, (3) full-width Edit
      // button.
      // Desktop (sm:): everything flattens back into one wrapping flex
      // row via `sm:contents` on the inner groups, matching the prior
      // inline-everything look.
      <div className="flex flex-col gap-4 border-b border-white/[0.06] px-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
        {/* Identity strip — ID, first/last, department, position, and
            the accessory flags as plain dot-separated text all sit on
            one mobile row. `sm:contents` lets the inner spans
            participate in the outer flex on desktop so they flow with
            the rest of the row. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0 sm:contents">
          {/* ID in white, assignee name in cyan, dept + position in
              the same 70%-cyan tone the Comms Equipment card uses for
              assignee suffixes — keeps the two surfaces visually
              consistent. */}
          <span className="text-sm font-semibold text-white">{radio.name}</span>
          {(radio.firstName || radio.lastName) && (
            <span className="text-sm font-medium text-[#22a7d3]">
              {radio.firstName} {radio.lastName}
            </span>
          )}
          {radio.department && (
            <span className="text-xs text-[#22a7d3]/70">· {radio.department}</span>
          )}
          {radio.position && (
            <span className="text-xs text-[#22a7d3]/70">· {radio.position}</span>
          )}
          {radio.fistMic && <span className="text-xs text-gray-400">· Fist mic</span>}
          {radio.surveillance && <span className="text-xs text-gray-400">· Surveillance</span>}
          {radio.doubleMuff && <span className="text-xs text-gray-400">· Double muff</span>}
          {radio.lightweight && <span className="text-xs text-gray-400">· Lightweight</span>}
        </div>
        {radio.barcode && (
          <span className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-gray-300 sm:ml-auto">
            {radio.barcode}
          </span>
        )}
        {/* Status dropdown — five-state radio inventory enum (N/A,
            Out, Returned, Damaged, Lost). Same chip chrome as the
            Comms Equipment DeployStatusSelect. Click to change. */}
        <RadioStatusSelect
          value={radio.status}
          onChange={onStatusChange}
          disabled={isPending}
          className={radio.barcode ? '' : 'sm:ml-auto'}
        />
        {/* Edit button — own full-width row on mobile, content-sized
            and right-aligned on desktop. */}
        <button
          type="button"
          onClick={onOpen}
          className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white sm:w-auto"
        >
          Edit
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="border-b border-white/[0.06] px-2 py-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field
          label="ID"
          value={name}
          onChange={setName}
          disabled={isPending}
        />
        <ComboboxInput
          compact
          label="First name"
          value={firstName}
          options={firstNameSuggestions}
          onChange={setFirstName}
          autoFocus
        />
        <ComboboxInput
          compact
          label="Last name"
          value={lastName}
          options={lastNameSuggestions}
          onChange={setLastName}
        />
        <ComboboxInput
          compact
          label="Department"
          value={department}
          options={departmentSuggestions}
          onChange={setDepartment}
          placeholder="Audio, RF"
        />
        <ComboboxInput
          compact
          label="Position"
          value={position}
          options={positionSuggestions}
          onChange={setPosition}
          placeholder="A1, PLHQ"
        />
        <Field
          label="Barcode"
          placeholder="C8098764"
          value={barcode}
          onChange={setBarcode}
          disabled={isPending}
          font="mono"
        />
      </div>

      {/* Zone assignment removed from the inline radio editor — the
          radio's zones are now managed exclusively from the Radio
          channels tab. selectedZoneIds still flows through onSave
          so the parent can persist the current value (effectively a
          pass-through until we wire a new editing surface). */}

      {/* Accessory yes/no toggles. Each chip flips a boolean on the
          radio — when ON the same chip appears on the collapsed row. */}
      <div className="mt-3">
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Accessories
        </span>
        <div className="flex flex-wrap gap-2">
          <AccessoryToggle label="Fist mic" value={fistMic} onChange={setFistMic} disabled={isPending} />
          <AccessoryToggle label="Surveillance" value={surveillance} onChange={setSurveillance} disabled={isPending} />
          <AccessoryToggle label="Double muff" value={doubleMuff} onChange={setDoubleMuff} disabled={isPending} />
          <AccessoryToggle label="Lightweight" value={lightweight} onChange={setLightweight} disabled={isPending} />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={onDelete}
          disabled={isPending}
          className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !name.trim()}
          className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

// ─── Tiny field helper (matches the look of ComboboxInput) ─────────

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  inputMode,
  font,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  inputMode?: 'numeric'
  font?: 'mono'
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        className={`block w-full rounded-lg border border-white/10 bg-[#202020] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50 ${
          font === 'mono' ? 'font-mono' : ''
        }`}
      />
    </label>
  )
}

// ─── Accessory chip + toggle ──────────────────────────────────────

function AccessoryChip({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-[#0178a3]/40 bg-[#0178a3]/10 px-2 py-0.5 text-[11px] font-medium text-[#22a7d3]">
      {label}
    </span>
  )
}

function AccessoryToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      aria-pressed={value}
      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        value
          ? 'border-[#0178a3] bg-[#0178a3]/20 text-[#22a7d3]'
          : 'border-white/10 bg-[#202020] text-gray-300 hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      {label}
    </button>
  )
}

// ─── Radio channels tab: zone editor ─────────────────────────────

/**
 * Lists every zone for the project as a stand-alone card. Each card
 * has an editable name + 16 numbered channel-name rows + a Delete
 * button. Channel rows debounce-save 400ms after the last keystroke
 * so rapid typing doesn't fire a write per character.
 *
 * "Add zone" is an inline form at the top — type a name, hit Enter or
 * the button, the new zone (with 16 blank rows) drops in at the bottom.
 */
function ZonesEditor({
  projectId: _projectId,
  zones,
  isPending,
  showAdd,
  onCloseAdd,
  onCreate,
  onUpdate,
  onDelete,
}: {
  projectId: number
  zones: Zone[]
  isPending: boolean
  /** Toggled by the toolbar `+` button. The add form only renders
   *  while this is true; the form's own X icon flips it back off. */
  showAdd: boolean
  onCloseAdd: () => void
  onCreate: (name: string) => void
  onUpdate: (
    zoneId: number,
    data: { name?: string; channels?: Array<{ channelIndex: number; name: string | null }> },
  ) => void
  onDelete: (zoneId: number, name: string) => void
}) {
  const [newName, setNewName] = useState('')

  // Reset the typed name whenever the add form is closed so reopening
  // it starts blank.
  useEffect(() => {
    if (!showAdd) setNewName('')
  }, [showAdd])

  return (
    <div className="pb-20">
      {/* Inline add-zone form — toggled by the toolbar `+`. The form's
          own X (far right of the "Add zone" header) closes it. */}
      {showAdd && (
        <div className="border-b border-white/[0.06] px-2 py-4">
          <div className="mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Add zone
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!newName.trim()) return
              onCreate(newName.trim())
              setNewName('')
            }}
          >
            <Field
              label="Name"
              placeholder="Stage, FOH…"
              value={newName}
              onChange={setNewName}
              disabled={isPending}
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={onCloseAdd}
                disabled={isPending}
                className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending || !newName.trim()}
                className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {isPending ? 'Adding…' : 'Add zone'}
              </button>
            </div>
          </form>
        </div>
      )}

      {zones.length === 0 ? (
        <EmptyState
          icon={
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          }
          title="No zones yet"
          message="Add a zone above. Each zone has 16 numbered channel slots you can name."
        />
      ) : (
        zones.map((zone) => (
          <ZoneCard
            key={zone.id}
            zone={zone}
            isPending={isPending}
            onSave={(data) => onUpdate(zone.id, data)}
            onDelete={() => onDelete(zone.id, zone.name)}
          />
        ))
      )}
    </div>
  )
}

/**
 * One zone's card: name on top, 2-column grid of 16 channel inputs
 * underneath, Delete / Cancel / Save buttons bottom-right.
 *
 * Edits stay LOCAL until the operator hits Save — typing in any field
 * marks the card dirty and lights up the Save button. Cancel reverts
 * every field back to the persisted zone snapshot. Save dispatches one
 * updateZone() call carrying the name change + every dirty channel in
 * a single payload.
 */
function ZoneCard({
  zone,
  isPending,
  onSave,
  onDelete,
}: {
  zone: Zone
  isPending: boolean
  onSave: (data: {
    name?: string
    channels?: Array<{ channelIndex: number; name: string | null }>
  }) => void
  onDelete: () => void
}) {
  // Snapshot of the server values — used as the comparison target for
  // dirty-tracking + the destination of Cancel's revert.
  const persistedName = zone.name
  const persistedChannels = useMemo(() => {
    const out: Record<number, string> = {}
    for (const ch of zone.channels) out[ch.channelIndex] = ch.name ?? ''
    for (let i = 1; i <= 16; i++) if (!(i in out)) out[i] = ''
    return out
  }, [zone.channels])

  const [name, setName] = useState(persistedName)
  const [channels, setChannels] = useState<Record<number, string>>(persistedChannels)

  // When the server snapshot changes after a Save (router.refresh()
  // reloads the zone) re-sync local state so the dirty-check resets
  // and the inputs reflect what the server actually stored.
  useEffect(() => {
    setName(persistedName)
    setChannels(persistedChannels)
  }, [persistedName, persistedChannels])

  // Dirty = any field differs from the persisted snapshot.
  const dirty = useMemo(() => {
    if (name.trim() !== persistedName) return true
    for (let i = 1; i <= 16; i++) {
      if ((channels[i] ?? '') !== (persistedChannels[i] ?? '')) return true
    }
    return false
  }, [name, channels, persistedName, persistedChannels])

  function handleSave() {
    if (!dirty) return
    if (!name.trim()) return
    const data: {
      name?: string
      channels?: Array<{ channelIndex: number; name: string | null }>
    } = {}
    if (name.trim() !== persistedName) data.name = name.trim()
    const dirtyChannels: Array<{ channelIndex: number; name: string | null }> = []
    for (let i = 1; i <= 16; i++) {
      const local = (channels[i] ?? '').trim()
      const server = (persistedChannels[i] ?? '').trim()
      if (local !== server) {
        dirtyChannels.push({ channelIndex: i, name: local === '' ? null : local })
      }
    }
    if (dirtyChannels.length > 0) data.channels = dirtyChannels
    onSave(data)
  }

  // Each card defaults to collapsed — show the zone name + a chevron;
  // tap anywhere on the header to expand the 16-channel grid +
  // Delete / Save buttons. Local edits persist while collapsed so
  // re-expanding doesn't blow away in-progress work.
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className="border-b border-white/[0.06]">
      {/* Header row — zone name on the left, Edit/X chip on the right.
          Header itself is no longer a button; only the chip toggles
          the expansion so the rest of the row stays inert. Matches
          the Edit-chip pattern used on the radio cards. */}
      <div className="flex flex-col gap-4 px-2 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white">{persistedName}</span>
          {dirty && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-[#22a7d3]">
              unsaved
            </span>
          )}
        </div>
        {/* Edit chip — only visible while collapsed. Once expanded the
            Cancel button in the action row at the bottom handles close. */}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Edit zone"
            className="flex w-full items-center justify-center rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] active:border-[#0178a3] active:bg-[#0178a3] active:text-white"
          >
            Edit
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-2 pb-4">
          <div className="mb-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
                className="block w-full border-0 border-b border-white/10 bg-transparent px-3 py-2 text-sm font-semibold text-white outline-none transition-colors focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 16 }, (_, i) => i + 1).map((idx) => (
              <ChannelRow
                key={idx}
                channelIndex={idx}
                value={channels[idx] ?? ''}
                disabled={isPending}
                onChange={(v) => setChannels((prev) => ({ ...prev, [idx]: v }))}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onDelete}
              disabled={isPending}
              className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/15 active:bg-red-500 active:border-red-500 active:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              disabled={isPending}
              className="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !dirty || !name.trim()}
              className="w-full rounded-lg bg-[#0178a3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#019bc7] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Local close-X glyph used by the zone card header. Matches the
 *  CloseIcon defined in src/app/projects/[id]/project-page.tsx so the
 *  two surfaces look identical. */
function CloseIcon() {
  return (
    <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

/** One numbered channel row. Updates the parent on every keystroke
 *  (no debounce / blur commit) since persistence happens via the
 *  card-level Save button. */
function ChannelRow({
  channelIndex,
  value,
  disabled,
  onChange,
}: {
  channelIndex: number
  value: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-6 shrink-0 text-right font-mono text-xs text-gray-500">
        {String(channelIndex).padStart(2, '0')}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Channel name"
        className="block w-full border-0 border-b border-white/10 bg-transparent px-2.5 py-1.5 text-sm text-white outline-none transition-colors focus:border-[#0178a3] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  )
}
