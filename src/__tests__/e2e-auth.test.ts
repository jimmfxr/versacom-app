import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const BASE = 'http://localhost:3000'

// These tests run against the live dev server + real database.
// Ensure the dev server is running on port 3000 before executing.

async function api(path: string, options?: RequestInit) {
  return fetch(`${BASE}${path}`, options)
}

async function login(firstName: string, lastName: string, pin: string) {
  return api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName, lastName, pin }),
  })
}

async function unlockUser(userId: number) {
  return api(`/api/admin/users/${userId}/unlock`, { method: 'PATCH' })
}

async function getUsers() {
  const res = await api('/api/admin/users')
  return res.json()
}

describe('E2E: Authentication flow', () => {
  // Reset all lockouts before tests
  beforeAll(async () => {
    const users = await getUsers()
    for (const u of users) {
      if (u.failedAttempts > 0 || u.lockedUntil) {
        await unlockUser(u.id)
      }
    }
  })

  // Clean up after tests
  afterAll(async () => {
    const users = await getUsers()
    for (const u of users) {
      if (u.failedAttempts > 0 || u.lockedUntil) {
        await unlockUser(u.id)
      }
    }
  })

  it('successfully logs in with correct credentials', async () => {
    const res = await login('Jimmy', 'Xiloj', '1234')
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.user.firstName).toBe('Jimmy')
    expect(data.user.lastName).toBe('Xiloj')
    expect(data.memberships.length).toBeGreaterThan(0)

    // Session cookie should be set
    const cookies = res.headers.get('set-cookie')
    expect(cookies).toContain('session=')
  })

  it('rejects login with wrong name', async () => {
    const res = await login('Fake', 'Person', '1234')
    expect(res.status).toBe(401)

    const data = await res.json()
    expect(data.error).toContain('No account found')
  })

  it('rejects login with wrong PIN and tracks attempts', async () => {
    const res = await login('Alex', 'Rivera', '0000')
    expect(res.status).toBe(401)

    const data = await res.json()
    expect(data.error).toContain('Incorrect PIN')
    expect(data.error).toContain('attempts remaining')

    // Verify attempts tracked in DB
    const users = await getUsers()
    const alex = users.find((u: any) => u.firstName === 'Alex')
    expect(alex.failedAttempts).toBe(1)
  })

  it('is case-insensitive for names', async () => {
    const res = await login('jimmy', 'xiloj', '1234')
    expect(res.status).toBe(200)
  })

  it('locks account after 10 failed attempts', async () => {
    // Alex already has 1 failed attempt from previous test
    // Send 9 more to reach 10
    for (let i = 0; i < 8; i++) {
      await login('Alex', 'Rivera', '0000')
    }

    // 10th attempt should trigger lockout
    const lockRes = await login('Alex', 'Rivera', '0000')
    expect(lockRes.status).toBe(423)

    const lockData = await lockRes.json()
    expect(lockData.error).toBe('locked')
    expect(lockData.minutesRemaining).toBeGreaterThan(0)

    // Further attempts should also return 423
    const blockedRes = await login('Alex', 'Rivera', '5678')
    expect(blockedRes.status).toBe(423)
  })

  it('admin can list users with lockout status', async () => {
    const users = await getUsers()
    expect(users.length).toBeGreaterThan(0)

    const alex = users.find((u: any) => u.firstName === 'Alex')
    expect(alex.failedAttempts).toBe(10)
    expect(alex.lockedUntil).not.toBeNull()
  })

  it('admin can unlock a locked user', async () => {
    const users = await getUsers()
    const alex = users.find((u: any) => u.firstName === 'Alex')

    const res = await unlockUser(alex.id)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.message).toContain('Alex Rivera has been unlocked')

    // User should be able to log in again
    const loginRes = await login('Alex', 'Rivera', '5678')
    expect(loginRes.status).toBe(200)
  })

  it('logout clears session cookie', async () => {
    const res = await api('/api/auth/logout', { method: 'POST' })
    expect(res.status).toBe(200)

    const cookies = res.headers.get('set-cookie')
    expect(cookies).toContain('session=')
    expect(cookies).toContain('Max-Age=0')
  })
})
