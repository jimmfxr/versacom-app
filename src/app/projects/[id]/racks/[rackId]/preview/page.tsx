import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * Chrome-free single-rack preview. Reached via the eye icon on an
 * expanded rack row in the Comms Racks tab. AppShell hides the
 * navbar + bottom-nav on this route (matched against
 * /projects/<id>/racks/<rackId>/preview) so the page is JUST the
 * rack — same treatment kiosk / public-zone pages get.
 *
 * X button at the top right returns to /projects/[id]?tab=racks.
 *
 * Read-only: no edit, no drag, no toolbar. Membership-gated like
 * the rest of the project pages.
 */
const RU_PX = 48

export default async function RackPreviewPage({
  params,
}: {
  params: Promise<{ id: string; rackId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, rackId } = await params
  const projectId = parseInt(id, 10)
  const rackTemplateId = parseInt(rackId, 10)
  if (Number.isNaN(projectId) || Number.isNaN(rackTemplateId)) notFound()

  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { role: true },
  })
  if (!membership) notFound()

  const rack = await prisma.rackTemplate.findFirst({
    where: { id: rackTemplateId, projectId },
    select: {
      id: true,
      name: true,
      location: true,
      totalRU: true,
      slots: {
        where: { side: 'front' },
        select: {
          id: true,
          ruPosition: true,
          ruSize: true,
          label: true,
        },
        orderBy: { ruPosition: 'asc' },
      },
    },
  })
  if (!rack) notFound()

  // Occupied lookup so empty rows render placeholder + RU label.
  const occupied = new Set<number>()
  for (const s of rack.slots) {
    for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
  }
  const containerHeight = rack.totalRU * RU_PX + 8

  return (
    <div className="min-h-screen w-full bg-[#202020] py-5">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      {/* Header: rack name + location + RU on the left, X close on
          the right. X returns to the Racks tab. No bottom border /
          margin / padding — sits flush with the chassis below. */}
      <header className="flex items-center justify-between">
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white truncate">{rack.name}</span>
          {rack.location && (
            <>
              <span className="text-sm text-gray-600">·</span>
              <span className="text-sm text-[#22a7d3] truncate">{rack.location}</span>
            </>
          )}
          <span className="text-sm text-gray-600">·</span>
          <span className="text-sm text-gray-500 font-mono tabular-nums">{rack.totalRU}RU</span>
        </div>
        <Link
          href={`/projects/${projectId}?tab=racks&expand=${rackTemplateId}`}
          aria-label="Close rack preview"
          className="flex h-9 shrink-0 items-center text-gray-400 transition-colors hover:text-white"
        >
          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {/* Chassis: same RU_PX math + slot card chrome as the
          editable studio, just read-only (no Edit button, no
          drag handlers). */}
      <div className="relative mx-auto max-w-md" style={{ height: `${containerHeight}px` }}>
        {Array.from({ length: rack.totalRU }, (_, i) => {
          const ru = i + 1
          const isEmpty = !occupied.has(ru)
          return (
            <div
              key={`ru-${ru}`}
              className="flex items-center"
              style={{
                position: 'absolute',
                top: `${i * RU_PX + 4}px`,
                left: 0,
                right: 0,
                height: `${RU_PX}px`,
              }}
            >
              {isEmpty && (
                <div className="flex h-[46px] w-full items-center text-xs text-gray-600">
                  <span className="w-9 shrink-0 text-center text-sm font-mono tabular-nums text-gray-400">{ru}</span>
                </div>
              )}
            </div>
          )
        })}
        {rack.slots.map((s) => (
          <div
            key={s.id}
            style={{
              position: 'absolute',
              top: `${(s.ruPosition - 1) * RU_PX + 4}px`,
              left: 0,
              right: 0,
              height: `${s.ruSize * RU_PX - 2}px`,
            }}
            className="flex w-full items-center gap-2 rounded-lg bg-[#2a2a2a] pr-4 text-sm font-medium text-white"
          >
            <span className="w-9 shrink-0 self-stretch flex flex-col items-center justify-around py-1 font-mono tabular-nums text-sm text-[#22a7d3]">
              {Array.from({ length: s.ruSize }, (_, i) => (
                <span key={i}>{s.ruPosition + i}</span>
              ))}
            </span>
            <span className="min-w-0 flex-1 truncate text-center">{s.label}</span>
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}
