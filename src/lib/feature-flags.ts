/**
 * Feature flags — single source of truth for any in-flight UI swap
 * that needs a quick rollback path. Flip the constant + redeploy to
 * revert to the prior behavior; no env vars required.
 *
 * Once a flagged change has shipped without regressions for ~a week,
 * delete the flag AND the gated-off legacy branch in a small cleanup
 * commit.
 */

/**
 * Mobile shell: replace the disclosure-menu navbar with a 4-icon
 * bottom tab bar (Home / Toolbox / Bell / Profile) plus a slide-up
 * Tools sheet. Desktop is unaffected.
 *
 * On  → AppShell renders BottomNav + slim mobile top bar.
 * Off → AppShell falls back to the legacy Navbar disclosure menu.
 */
export const NEW_BOTTOM_NAV = true
