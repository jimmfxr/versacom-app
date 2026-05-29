#!/usr/bin/env node
// Stamp public/sw.js with a build-time version identifier so every
// deploy serves byte-different SW content — which is what triggers
// the browser's "update available" flow and lets the SwUpdateBanner
// surface to PWA users.
//
// Runs as `prebuild` in package.json, so it fires on every Vercel
// build automatically and on `npm run build` locally. Falls back to
// a timestamp when the commit SHA isn't available (e.g. local builds
// outside CI).

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SW_PATH = join(process.cwd(), 'public', 'sw.js')

const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ||
  process.env.GIT_COMMIT_SHA?.slice(0, 8) ||
  new Date().toISOString().replace(/[:.]/g, '-')

const src = readFileSync(SW_PATH, 'utf8')
const next = src.replace(
  /const SW_VERSION = ['"][^'"]+['"]/,
  `const SW_VERSION = '${buildId}'`,
)

if (src === next) {
  console.warn(
    '[stamp-sw] WARNING: no SW_VERSION line found in public/sw.js — banner flow may not trigger.',
  )
} else {
  writeFileSync(SW_PATH, next)
  console.log(`[stamp-sw] stamped SW_VERSION = ${buildId}`)
}
