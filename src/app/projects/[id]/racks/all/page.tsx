import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * View-all racks page. Reached via the eye icon on an expanded rack
 * row. Renders every comms rack on the project side-by-side as a
 * read-only chassis grid so the operator can see the whole show at
 * once. X button at the top right returns to /projects/[id]?tab=racks.
 *
 * Server-fetches racks + slots in one query (no equipment metadata
 * needed for the read-only view — slot.label is enough). Membership
 * check matches the rest of the project pages.
 */
const RU_PX = 48

export default async function ViewAllRacksPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const projectId = parseInt(id, 10)
  if (Number.isNaN(projectId)) notFound()

  const membership = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, projectId },
    select: { role: true },
  })
  if (!membership) notFound()

  const [project, racks] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    prisma.rackTemplate.findMany({
      where: { projectId, dept: 'comms' },
      select: {
        id: true,
        name: true,
        location: true,
        totalRU: true,
        slots: {
          select: {
            id: true,
            ruPosition: true,
            ruSize: true,
            side: true,
            label: true,
          },
          where: { side: 'front' },
          orderBy: { ruPosition: 'asc' },
        },
      },
      orderBy: [{ name: 'asc' }],
    }),
  ])
  if (!project) notFound()

  return (
    <div className="min-h-screen w-full bg-[#202020] px-4 sm:px-6 lg:px-8 py-5">
      {/* Header: title on the left, X close on the right.
          Returns to the Comms Racks tab. */}
      <header className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            All Racks
          </h1>
          <p className="mt-1 text-xs text-gray-500">{project.name} · {racks.length} {racks.length === 1 ? 'rack' : 'racks'}</p>
        </div>
        <Link
          href={`/projects/${project.id}?tab=racks`}
          aria-label="Close all racks view"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-gray-200 transition-colors hover:border-white/20 hover:bg-[#313131] hover:text-white"
        >
          <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {racks.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">
          No racks on this project yet.
        </div>
      ) : (
        // Horizontal scroll on narrow viewports; grid spreads racks
        // out on desktop. Each rack column is fixed-width so the
        // chassis cards keep a consistent RU label column.
        <div className="flex gap-6 overflow-x-auto pb-6 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(280px,1fr))] lg:gap-6 lg:overflow-x-visible">
          {racks.map((rack) => {
            // Build occupied lookup so empty rows render as bottom-
            // dividered placeholders, matching the editable studio's
            // visual rhythm.
            const occupied = new Set<number>()
            for (const s of rack.slots) {
              for (let i = 0; i < s.ruSize; i++) occupied.add(s.ruPosition + i)
            }
            const containerHeight = rack.totalRU * RU_PX + 8
            return (
              <div key={rack.id} className="min-w-[280px] flex-shrink-0">
                {/* Rack header — same name · location · RU pattern as
                    the editable studio. */}
                <div className="mb-3 flex items-baseline gap-2">
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
                {/* Chassis: same RU_PX math as the editable studio
                    so visual layout is identical. */}
                <div className="relative" style={{ height: `${containerHeight}px` }}>
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
            )
          })}
        </div>
      )}
    </div>
  )
}
