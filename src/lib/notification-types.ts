// Catalog of every notification kind safeSend() can emit. The settings
// card on /notifications iterates this list to render per-type toggles,
// and the safeSend helper looks up the `type` field on each row to
// filter recipients by their saved preferences.
//
// `scope` controls which users see the toggle:
//   - 'admin'  → only users who are admin on at least one project
//   - 'all'    → every user
//
// Adding a new notify* helper means adding an entry here and passing the
// type string through safeSend(). Default behavior for any user without
// a row in NotificationPreference is enabled, so existing users keep
// receiving everything until they explicitly opt out.

export const NOTIFICATION_TYPES = {
  'member-joined': {
    label: 'New members',
    description: 'When someone joins a show you admin.',
    scope: 'admin',
  },
  'user-locked': {
    label: 'Account lockouts',
    description: 'When a crew member locks themselves out of their PIN.',
    scope: 'admin',
  },
  'deploy-status': {
    label: 'Deploy status updates',
    description: 'When gear moves through deployed / faxed / returned.',
    scope: 'all',
  },
  'manager-endorsed': {
    label: 'Manager endorsements',
    description: 'When a manager endorses a change request for review.',
    scope: 'admin',
  },
  'equipment-edited': {
    label: 'Equipment edits',
    description: 'When crew change a piece of gear (assignee, location, IP…).',
    scope: 'admin',
  },
  'equipment-assigned': {
    label: 'Gear assigned to you',
    description: 'When you become responsible for a new piece of gear.',
    scope: 'all',
  },
  'review-started': {
    label: 'Your change requests',
    description: 'When an admin starts reviewing one of your requests.',
    scope: 'all',
  },
  'return-phase': {
    label: 'Return phase',
    description: 'When a show enters the return phase.',
    scope: 'all',
  },
  'project-archived': {
    label: 'Project archived',
    description: 'When a show you were on is closed.',
    scope: 'all',
  },
} as const satisfies Record<string, { label: string; description: string; scope: 'admin' | 'all' }>

export type NotificationType = keyof typeof NOTIFICATION_TYPES
