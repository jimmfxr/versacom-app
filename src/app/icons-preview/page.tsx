/**
 * Heroicons + custom nav-icon gallery. Renders every plausible
 * candidate icon for the nav at the same size and color the navbar
 * uses (size-5, text-gray-400, no animation) on the dark page bg.
 *
 * Throwaway page — built so the design owner can browse and pick.
 * Delete the file once the nav icons are locked in.
 */
import {
  // Dashboard candidates
  HomeIcon,
  Squares2X2Icon,
  RectangleGroupIcon,
  ChartBarIcon,
  ChartPieIcon,
  PresentationChartBarIcon,
  ChartBarSquareIcon,
  Bars3Icon,
  ListBulletIcon,
  ViewfinderCircleIcon,
  QueueListIcon,
  // Tasks candidates
  InboxIcon,
  InboxArrowDownIcon,
  InboxStackIcon,
  ClipboardIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  CheckCircleIcon,
  CheckBadgeIcon,
  BellAlertIcon,
  FlagIcon,
  // Projects candidates
  FolderIcon,
  FolderOpenIcon,
  ArchiveBoxIcon,
  BriefcaseIcon,
  BuildingOfficeIcon,
  RectangleStackIcon,
  Square3Stack3DIcon,
  // Comms candidates
  MicrophoneIcon,
  SpeakerWaveIcon,
  SignalIcon,
  WifiIcon,
  ChatBubbleLeftRightIcon,
  PhoneIcon,
  BoltIcon,
  // Radios candidates
  RadioIcon,
  ServerIcon,
  // My Equipment candidates
  DevicePhoneMobileIcon,
  DeviceTabletIcon,
  ComputerDesktopIcon,
  UserIcon,
  UserCircleIcon,
  IdentificationIcon,
  Cog6ToothIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline'
import {
  ProgressSpinnerIcon,
  IntercomHeadsetIcon,
  WalkieTalkieIcon,
} from '@/components/nav-icons'

type IconEntry = {
  name: string
  Cmp: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  note?: string
}

type Section = {
  title: string
  icons: IconEntry[]
}

const sections: Section[] = [
  {
    title: 'Dashboard',
    icons: [
      { name: 'ProgressSpinner (custom)', Cmp: ProgressSpinnerIcon, note: 'your "progress spinner" pick' },
      { name: 'HomeIcon', Cmp: HomeIcon },
      { name: 'Squares2X2Icon', Cmp: Squares2X2Icon },
      { name: 'RectangleGroupIcon', Cmp: RectangleGroupIcon },
      { name: 'ChartBarIcon', Cmp: ChartBarIcon },
      { name: 'ChartPieIcon', Cmp: ChartPieIcon },
      { name: 'PresentationChartBarIcon', Cmp: PresentationChartBarIcon },
      { name: 'ChartBarSquareIcon', Cmp: ChartBarSquareIcon },
      { name: 'Bars3Icon', Cmp: Bars3Icon },
      { name: 'ListBulletIcon', Cmp: ListBulletIcon },
      { name: 'ViewfinderCircleIcon', Cmp: ViewfinderCircleIcon },
      { name: 'QueueListIcon', Cmp: QueueListIcon },
    ],
  },
  {
    title: 'Tasks',
    icons: [
      { name: 'InboxIcon', Cmp: InboxIcon, note: 'your "inbox" pick' },
      { name: 'InboxArrowDownIcon', Cmp: InboxArrowDownIcon },
      { name: 'InboxStackIcon', Cmp: InboxStackIcon },
      { name: 'ClipboardIcon', Cmp: ClipboardIcon },
      { name: 'ClipboardDocumentIcon', Cmp: ClipboardDocumentIcon },
      { name: 'ClipboardDocumentCheckIcon', Cmp: ClipboardDocumentCheckIcon },
      { name: 'ClipboardDocumentListIcon', Cmp: ClipboardDocumentListIcon },
      { name: 'CheckCircleIcon', Cmp: CheckCircleIcon },
      { name: 'CheckBadgeIcon', Cmp: CheckBadgeIcon },
      { name: 'BellAlertIcon', Cmp: BellAlertIcon },
      { name: 'FlagIcon', Cmp: FlagIcon },
    ],
  },
  {
    title: 'Projects',
    icons: [
      { name: 'FolderIcon', Cmp: FolderIcon, note: 'your current pick' },
      { name: 'FolderOpenIcon', Cmp: FolderOpenIcon },
      { name: 'ArchiveBoxIcon', Cmp: ArchiveBoxIcon },
      { name: 'BriefcaseIcon', Cmp: BriefcaseIcon },
      { name: 'BuildingOfficeIcon', Cmp: BuildingOfficeIcon },
      { name: 'RectangleStackIcon', Cmp: RectangleStackIcon },
      { name: 'Square3Stack3DIcon', Cmp: Square3Stack3DIcon },
    ],
  },
  {
    title: 'Comms',
    icons: [
      { name: 'IntercomHeadset (custom)', Cmp: IntercomHeadsetIcon, note: 'your "intercom headset" pick' },
      { name: 'MicrophoneIcon', Cmp: MicrophoneIcon },
      { name: 'SpeakerWaveIcon', Cmp: SpeakerWaveIcon },
      { name: 'SignalIcon', Cmp: SignalIcon },
      { name: 'WifiIcon', Cmp: WifiIcon },
      { name: 'ChatBubbleLeftRightIcon', Cmp: ChatBubbleLeftRightIcon },
      { name: 'PhoneIcon', Cmp: PhoneIcon },
      { name: 'BoltIcon', Cmp: BoltIcon },
    ],
  },
  {
    title: 'Radios',
    icons: [
      { name: 'WalkieTalkie (custom)', Cmp: WalkieTalkieIcon, note: 'your "walkie talkie" pick' },
      { name: 'RadioIcon', Cmp: RadioIcon },
      { name: 'SignalIcon', Cmp: SignalIcon },
      { name: 'ServerIcon', Cmp: ServerIcon },
    ],
  },
  {
    title: 'My Equipment',
    icons: [
      { name: 'DeviceTabletIcon', Cmp: DeviceTabletIcon, note: 'your "iPad" pick' },
      { name: 'DevicePhoneMobileIcon', Cmp: DevicePhoneMobileIcon },
      { name: 'ComputerDesktopIcon', Cmp: ComputerDesktopIcon },
      { name: 'UserIcon', Cmp: UserIcon },
      { name: 'UserCircleIcon', Cmp: UserCircleIcon },
      { name: 'IdentificationIcon', Cmp: IdentificationIcon },
      { name: 'Cog6ToothIcon', Cmp: Cog6ToothIcon },
      { name: 'WrenchScrewdriverIcon', Cmp: WrenchScrewdriverIcon },
      { name: 'BriefcaseIcon', Cmp: BriefcaseIcon },
    ],
  },
]

export default function IconsPreview() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold text-white">Nav icon gallery</h1>
      <p className="mt-2 text-sm text-gray-400">
        All candidates rendered at the same size and color the navbar uses
        (<code className="font-mono text-gray-300">size-5</code>,{' '}
        <code className="font-mono text-gray-300">text-gray-400</code>). Pick
        one per section.
      </p>

      {sections.map((section) => (
        <section key={section.title} className="mt-10">
          <h2 className="mb-4 text-base font-semibold text-white">
            {section.title}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {section.icons.map((icon) => (
              <div
                key={icon.name}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#202020] px-4 py-3"
              >
                <icon.Cmp aria-hidden className="size-5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-mono text-gray-200">
                    {icon.name}
                  </div>
                  {icon.note && (
                    <div className="truncate text-[10px] text-[#22a7d3]">
                      {icon.note}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
