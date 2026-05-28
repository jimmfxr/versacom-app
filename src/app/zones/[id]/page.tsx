import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { ZonesCarousel } from './zones-carousel'

/**
 * Public read-only zones page. Kiosk operators print / display the
 * QR that points here so crew can scan with their phone and see
 * the project's radio zone + channel layout without signing in.
 *
 * Intentionally PUBLIC — listed in src/proxy.ts under the public
 * routes allowlist. The data shown (zone names + channel names) is
 * non-sensitive show config; revealing it doesn't grant access to
 * any project state. Project ID is in the URL but isn't actionable
 * without a session.
 */
export const dynamic = 'force-dynamic'

export default async function ZonesPublicPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const projectId = Number.parseInt(id, 10)
  if (!Number.isFinite(projectId)) notFound()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      zones: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          channels: {
            orderBy: { channelIndex: 'asc' },
            select: { channelIndex: true, name: true },
          },
        },
      },
    },
  })

  if (!project) notFound()

  return (
    <main className="min-h-screen bg-[#202020] text-white">
      {/* Mobile: single phone-friendly column (max-w-md). Desktop
          widens out so the zone cards can sit side-by-side without
          getting cramped. py-8 gives breathing room at the very top
          below the iOS status bar. */}
      <div className="mx-auto max-w-md px-5 py-8 sm:max-w-4xl sm:px-8">
        {/* Header: Clair logo centered up top, then a left-aligned
            block with "Radios" label and the project name as the main
            heading in cyan — bigger so crew can clock the show at a
            glance from across the room. */}
        <div className="flex flex-col items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/clair_logo_white.png"
            alt="Clair"
            className="h-10 w-auto"
          />
          {/* Mobile: Radios left / project name right (flex). Desktop:
              3-col grid so the project name sits dead center while
              Radios stays anchored to the left. The empty third
              column reserves the right side for symmetry. */}
          <div className="flex w-full items-baseline justify-between gap-4 sm:grid sm:grid-cols-3">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Radios
            </h1>
            <div className="min-w-0 truncate text-2xl font-bold text-[#22a7d3] sm:text-center sm:text-3xl">
              {project.name}
            </div>
          </div>
        </div>

        {project.zones.length === 0 ? (
          <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-gray-400">
            No zones configured for this show yet.
          </div>
        ) : (
          <ZonesCarousel zones={project.zones} />
        )}

        <p className="mt-10 text-center text-[11px] text-gray-600">
          Tap your phone&rsquo;s share button → &ldquo;Add to Home
          Screen&rdquo; to keep this list handy.
        </p>
      </div>
    </main>
  )
}
