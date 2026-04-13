import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
const mockFindMany = vi.fn()
const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}))

describe('GET /api/admin/users', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all users with memberships', async () => {
    const { GET } = await import('@/app/api/admin/users/route')

    const mockUsers = [
      {
        id: 1,
        firstName: 'Jimmy',
        lastName: 'Xiloj',
        failedAttempts: 0,
        lockedUntil: null,
        lastFailedAt: null,
        createdAt: new Date(),
        memberships: [{ role: 'admin', project: { name: 'Grammy Awards 2026' } }],
      },
      {
        id: 2,
        firstName: 'Alex',
        lastName: 'Rivera',
        failedAttempts: 10,
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
        lastFailedAt: new Date(),
        createdAt: new Date(),
        memberships: [{ role: 'crew', project: { name: 'Grammy Awards 2026' } }],
      },
    ]
    mockFindMany.mockResolvedValue(mockUsers)

    const res = await GET()
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toHaveLength(2)
    expect(data[0].firstName).toBe('Jimmy')
    expect(data[1].failedAttempts).toBe(10)
    expect(data[1].memberships[0].role).toBe('crew')
  })

  it('does not return PIN hashes', async () => {
    const { GET } = await import('@/app/api/admin/users/route')

    mockFindMany.mockResolvedValue([
      {
        id: 1,
        firstName: 'Jimmy',
        lastName: 'Xiloj',
        failedAttempts: 0,
        lockedUntil: null,
        lastFailedAt: null,
        createdAt: new Date(),
        memberships: [],
      },
    ])

    const res = await GET()
    const data = await res.json()
    expect(data[0]).not.toHaveProperty('pin')
  })
})

describe('PATCH /api/admin/users/[id]/unlock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('unlocks a locked user', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/unlock/route')

    mockFindUnique.mockResolvedValue({
      id: 2,
      firstName: 'Alex',
      lastName: 'Rivera',
      failedAttempts: 10,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    })
    mockUpdate.mockResolvedValue({})

    const req = new Request('http://localhost/api/admin/users/2/unlock', { method: 'PATCH' })
    const res = await PATCH(req as any, { params: Promise.resolve({ id: '2' }) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.message).toContain('Alex Rivera has been unlocked')

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { failedAttempts: 0, lockedUntil: null, lastFailedAt: null },
    })
  })

  it('returns 400 for invalid user ID', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/unlock/route')

    const req = new Request('http://localhost/api/admin/users/abc/unlock', { method: 'PATCH' })
    const res = await PATCH(req as any, { params: Promise.resolve({ id: 'abc' }) })
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent user', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/unlock/route')

    mockFindUnique.mockResolvedValue(null)

    const req = new Request('http://localhost/api/admin/users/999/unlock', { method: 'PATCH' })
    const res = await PATCH(req as any, { params: Promise.resolve({ id: '999' }) })
    expect(res.status).toBe(404)
  })
})
