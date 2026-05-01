import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import Image from 'next/image'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
import { ScrollToTop } from '@/components/scroll-to-top'
import { StepCarousel } from '@/components/step-carousel'
import { InstallButton } from '@/components/install-prompt'
import { PageLayout } from '@/components/page-layout'
import { EmptyState } from '@/components/empty-state'
import { ProjectDashboard, DashboardHeaderAction } from './project-dashboard'

export const dynamic = 'force-dynamic'

const FEATURES = [
  { title: 'Equipment Tracking', desc: 'Track every panel, beltpack, antenna, and switch. Know what\'s deployed, assigned, and still in the case.' },
  { title: 'Team Coordination', desc: 'Role-based access for admins, managers, and users. Everyone sees exactly what they need — nothing more.' },
  { title: 'Pick Lists', desc: 'Auto-generate pick lists from your roster. Confirm gear assignments before doors open.' },
  { title: 'Stage Plots', desc: 'Upload venue blueprints as PDFs. One place for the whole team to reference the layout.' },
  { title: 'Change Requests', desc: 'Users request changes, managers approve with notes. Full history on every reassignment.' },
  { title: 'Dashboard', desc: 'Deployment status at a glance — done, returned, and where every headset is.' },
]

const EVENT_TYPES = ['Corporate Events', 'Political Events', 'Special Events', 'Sports', 'Television']

const USER_STEPS = [
  {
    num: 1,
    title: 'Log in with your name & PIN',
    desc: 'Your manager gives you a 4-digit PIN. Enter your first name, last name, and PIN — no email or password needed.',
    img: '/screenshots/login.png',
    alt: 'Login screen',
  },
  {
    num: 2,
    title: 'View your assigned equipment',
    desc: 'My Equipment is your home screen. It shows every piece of gear assigned to you — panel, beltpack, headset, location, and deploy status.',
    img: '/screenshots/my-equipment-mobile.png',
    alt: 'My Equipment screen',
  },
  {
    num: 3,
    title: 'Open your panel in Panel Studio',
    desc: 'Tap any panel on My Equipment to open Panel Studio. See all your assigned keys and configure what each one does.',
    img: '/screenshots/panel-studio-v2.png',
    alt: 'Panel Studio screen',
  },
  {
    num: 4,
    title: 'Assign a destination to each key',
    desc: 'Tap a key then hit CHANGE to pick your destination from the pick list — conferences, IFBs, PTPs, audio, and more. Submit for manager approval when done.',
    img: '/screenshots/picklist-picker.png',
    alt: 'Pick list destination picker',
  },
]

const MANAGER_STEPS = [
  {
    num: 1,
    title: 'Select your show from the dashboard',
    desc: 'Switch between projects from the top-right switcher. The dashboard gives you a live view of deployment and assignment progress.',
    img: '/screenshots/mgr-dashboard.png',
    alt: 'Dashboard with project switcher',
  },
  {
    num: 2,
    title: 'Assign gear to your crew',
    desc: 'On the Equipment tab, assign panels, beltpacks, and headsets to individuals. Filter by category, hardware type, or location.',
    img: '/screenshots/mgr-equipment.png',
    alt: 'Equipment tab',
  },
  {
    num: 3,
    title: 'Review the Pick List before load-in',
    desc: 'The Pick List auto-generates from your roster. Use it to verify everyone\'s gear is accounted for before the show.',
    img: '/screenshots/mgr-picklist.png',
    alt: 'Pick List tab',
  },
  {
    num: 4,
    title: 'Upload stage plots for reference',
    desc: 'Upload the venue blueprint as a PDF. Crew and managers can open it from the Plots tab at any time during the show.',
    img: '/screenshots/mgr-plots.png',
    alt: 'Plots tab',
  },
]

function PhoneFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="mx-auto w-full max-w-[180px] sm:max-w-[200px]">
      <div className="rounded-[2.4rem] border-[5px] border-white/[0.12] bg-[#0d0d0d] p-1.5 shadow-2xl shadow-black/60">
        <div className="overflow-hidden rounded-[2rem] bg-[#111]">
          <div className="flex justify-center py-2">
            <div className="h-1.5 w-14 rounded-full bg-white/[0.08]" />
          </div>
          <div className="aspect-[9/19] w-full overflow-hidden bg-[#111]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="h-full w-full object-contain object-top" />
          </div>
          <div className="flex justify-center py-2">
            <div className="h-1 w-10 rounded-full bg-white/[0.08]" />
          </div>
        </div>
      </div>
    </div>
  )
}

function StepCard({ step }: { step: { num: number; title: string; desc: string; img: string; alt: string } }) {
  return (
    <div className="flex flex-col rounded-2xl bg-[#242424] p-5 pt-6">
      <PhoneFrame src={step.img} alt={step.alt} />
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-full bg-[#22a7d3]/20 text-[11px] font-bold text-[#22a7d3]">
            {step.num}
          </span>
          <span className="text-sm font-semibold text-white">{step.title}</span>
        </div>
        <p className="text-sm leading-relaxed text-gray-400">{step.desc}</p>
      </div>
    </div>
  )
}

function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#1a1a1a] text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 sm:px-10">
        <div className="flex items-center gap-3">
          <Image src="/clair_logo_white.png" alt="Clair" width={64} height={24} className="h-6 w-auto" />
          <span className="text-sm font-semibold tracking-wide text-gray-300">Nodal Control</span>
        </div>
        <div className="flex items-center gap-2">
          <InstallButton />
          <Link href="/login" className="rounded-lg bg-[#22a7d3] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1e96be]">
            Log In
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-6 py-24 text-center sm:py-32">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#22a7d3]/30 bg-[#22a7d3]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#22a7d3]">
          Live Production · Intercom Management
        </div>
        <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Every panel, every key, every assignment{' '}
          <span className="text-[#22a7d3]">in your pocket.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-gray-400 sm:text-lg">
          Built for our clients. Nodal Control comes with the rack — every manager sees the whole show, every user picks the channels they need, every crew member deploys with confidence.
        </p>
        <div className="mt-10">
          <Link href="/login" className="rounded-xl bg-[#22a7d3] px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1e96be]">
            Log In to your project
          </Link>
        </div>
      </section>

      {/* Section nav */}
      <div className="px-6 py-5">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <a href="#for-users" className="text-xs font-bold uppercase tracking-widest text-gray-400 transition-colors hover:text-[#22a7d3]">
            For Users →
          </a>
          <a href="#for-managers" className="text-xs font-bold uppercase tracking-widest text-gray-400 transition-colors hover:text-[#22a7d3]">
            For Managers →
          </a>
          <a href="#whats-inside" className="text-xs font-bold uppercase tracking-widest text-gray-400 transition-colors hover:text-[#22a7d3]">
            What&apos;s inside →
          </a>
        </div>
      </div>

      {/* How it works — User role */}
      <section id="for-users" className="scroll-mt-8 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <p className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-gray-500">How it works</p>
          <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl">For Users</h2>
          {/* Mobile: swipeable carousel */}
          <div className="sm:hidden">
            <StepCarousel steps={USER_STEPS} />
          </div>
          {/* Desktop: grid */}
          <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">
            {USER_STEPS.map((step) => (
              <StepCard key={step.num} step={step} />
            ))}
          </div>
        </div>
      </section>

      {/* How it works — Manager role */}
      <section id="for-managers" className="scroll-mt-8 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <p className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-gray-500">How it works</p>
          <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl">For Managers</h2>
          {/* Mobile: swipeable carousel */}
          <div className="sm:hidden">
            <StepCarousel steps={MANAGER_STEPS} />
          </div>
          {/* Desktop: grid */}
          <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">
            {MANAGER_STEPS.map((step) => (
              <StepCard key={step.num} step={step} />
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section id="whats-inside" className="scroll-mt-8 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <p className="mb-10 text-center text-xs font-bold uppercase tracking-widest text-gray-500">What&apos;s inside</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl bg-[#242424] p-6">
                <div className="mb-1 text-sm font-semibold text-white">{f.title}</div>
                <div className="text-sm leading-relaxed text-gray-400">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">Ready to run your show?</h2>
        <p className="mt-3 text-sm text-gray-400">Log in with your name and PIN to get started.</p>
        <div className="mt-8">
          <Link href="/login" className="rounded-xl bg-[#22a7d3] px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#1e96be]">
            Log In to Nodal Control
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-2">
          <Image src="/clair_logo_white.png" alt="Clair" width={48} height={18} className="h-4 w-auto opacity-40" />
          <span className="text-xs text-gray-600">© {new Date().getFullYear()} Clair Global / ATK Versacom. All rights reserved.</span>
        </div>
      </footer>

      <ScrollToTop />
    </div>
  )
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const session = await getSession()
  if (!session) return <LandingPage />

  const userName = `${session.user.firstName} ${session.user.lastName}`
  const isAdmin = session.memberships.some((m) => m.role === 'admin')
  const isUserOnly = session.memberships.every((m) => m.role === 'user')
  const showMyEquipment = session.memberships.some((m) => m.role === 'crew')

  // Users (no admin/manager/crew) don't get a dashboard — bounce them to My Equipment.
  if (isUserOnly) redirect('/my-equipment')

  // Fetch the list fresh from the DB instead of trusting the session cookie,
  // which is set at login and never refreshes. A project the user had at
  // login time but has since been archived / deleted would still show up
  // in the dropdown otherwise. Only return active projects they still
  // actively belong to.
  const activeMemberships = await prisma.projectMember.findMany({
    where: {
      userId: session.user.id,
      project: { status: 'active' },
    },
    select: {
      project: { select: { id: true, name: true } },
    },
    orderBy: { id: 'asc' },
  })
  const userProjects = (() => {
    const seen = new Map<number, { id: number; name: string }>()
    for (const m of activeMemberships) {
      if (!seen.has(m.project.id)) seen.set(m.project.id, { id: m.project.id, name: m.project.name })
    }
    return Array.from(seen.values())
  })()

  // No projects to show — empty state.
  if (userProjects.length === 0) {
    return (
      <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={showMyEquipment}>
        <PageLayout title="Dashboard" titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          <EmptyState
            icon={null}
            title="No projects yet"
            message="You're not a member of any projects. Join one with a PIN to get started."
          />
        </PageLayout>
      </AppShell>
    )
  }

  // Resolve which project to show:
  // 1. ?project=<id> if it's one the user belongs to
  // 2. cookie from last selection
  // 3. otherwise the first one in their membership list
  const { project: projectParam } = await searchParams
  const requestedId = projectParam ? parseInt(projectParam, 10) : NaN
  const matchingProject = userProjects.find((p) => p.id === requestedId)

  let selectedProjectId: number
  if (matchingProject) {
    selectedProjectId = matchingProject.id
  } else {
    const cookieStore = await cookies()
    const cookieVal = cookieStore.get('selectedProject')?.value
    const cookieId = cookieVal ? parseInt(cookieVal, 10) : NaN
    const cookieProject = userProjects.find((p) => p.id === cookieId)
    selectedProjectId = cookieProject ? cookieProject.id : userProjects[0].id
  }

  // Fetch just the slice of data the dashboard needs.
  const [project, equipment, memberCount, headsetInventory, selectedMembership] = await Promise.all([
    prisma.project.findUnique({
      where: { id: selectedProjectId },
      select: { id: true, name: true },
    }),
    prisma.equipment.findMany({
      where: { projectId: selectedProjectId },
      select: {
        category: true,
        hardwareType: true,
        headsetType: true,
        location: true,
        deployStatus: true,
        assignedToId: true,
      },
    }),
    prisma.projectMember.count({ where: { projectId: selectedProjectId } }),
    prisma.projectHeadsetInventory.findMany({
      where: { projectId: selectedProjectId },
      select: { headsetType: true, brought: true },
    }),
    prisma.projectMember.findFirst({
      where: { projectId: selectedProjectId, userId: session.user.id },
      select: { role: true },
    }),
  ])

  // Headset inventory editing is restricted to admins only.
  const canEditInventory = isAdmin || selectedMembership?.role === 'admin'

  if (!project) {
    // Shouldn't happen since selectedProjectId came from session, but bail safely.
    return (
      <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={showMyEquipment}>
        <PageLayout title="Dashboard" titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          <EmptyState icon={null} title="Project not found" message="That project may have been deleted." />
        </PageLayout>
      </AppShell>
    )
  }

  return (
    <AppShell userName={userName} isAdmin={isAdmin} isUserOnly={isUserOnly} showMyEquipment={showMyEquipment}>
      <PageLayout
        title="Dashboard"
        titleClassName="text-2xl font-bold tracking-tight text-white sm:text-3xl"
        action={
          <DashboardHeaderAction
            projectId={project.id}
            projectName={project.name}
            memberCount={memberCount}
            equipmentCount={equipment.length}
            userProjects={userProjects}
          />
        }
      >
        <ProjectDashboard
          projectId={project.id}
          equipment={equipment}
          headsetInventory={headsetInventory}
          canEditInventory={canEditInventory}
        />
      </PageLayout>
    </AppShell>
  )
}
