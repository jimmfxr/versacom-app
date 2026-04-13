import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
const mockFindFirst = vi.fn()
const mockUpdate = vi.fn()
const mockFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    projectMember: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}))

// Mock bcryptjs
const mockCompare = vi.fn()
vi.mock('bcryptjs', () => ({
  default: { compare: (...args: unknown[]) => mockCompare(...args) },
}))

// Import after mocks
const { POST } = await import('@/app/api/auth/login/route')

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 if firstName or lastName missing', async () => {
    const res = await POST(makeRequest({ pin: '1234' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('First name and last name are required')
  })

  it('returns 400 if PIN is not 4 digits', async () => {
    const res = await POST(makeRequest({ firstName: 'Jim', lastName: 'X', pin: '12' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('PIN must be 4 digits')
  })

  it('returns 400 if PIN contains non-digits', async () => {
    const res = await POST(makeRequest({ firstName: 'Jim', lastName: 'X', pin: 'abcd' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 if user not found', async () => {
    mockFindFirst.mockResolvedValue(null)

    const res = await POST(makeRequest({ firstName: 'Fake', lastName: 'User', pin: '1234' }))
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toContain('No account found')
  })

  it('returns 423 if user is locked out', async () => {
    mockFindFirst.mockResolvedValue({
      id: 1,
      firstName: 'Alex',
      lastName: 'Rivera',
      pin: '$2a$10$hash',
      failedAttempts: 10,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
      lastFailedAt: new Date(),
    })

    const res = await POST(makeRequest({ firstName: 'Alex', lastName: 'Rivera', pin: '5678' }))
    expect(res.status).toBe(423)
    const data = await res.json()
    expect(data.error).toBe('locked')
    expect(data.minutesRemaining).toBeGreaterThan(0)
  })

  it('returns 401 with attempts remaining on wrong PIN', async () => {
    mockFindFirst.mockResolvedValue({
      id: 1,
      firstName: 'Alex',
      lastName: 'Rivera',
      pin: '$2a$10$hash',
      failedAttempts: 3,
      lockedUntil: null,
      lastFailedAt: null,
    })
    mockCompare.mockResolvedValue(false)
    mockUpdate.mockResolvedValue({})

    const res = await POST(makeRequest({ firstName: 'Alex', lastName: 'Rivera', pin: '0000' }))
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toContain('6 attempts remaining')
  })

  it('locks account after 10 failed attempts', async () => {
    mockFindFirst.mockResolvedValue({
      id: 1,
      firstName: 'Alex',
      lastName: 'Rivera',
      pin: '$2a$10$hash',
      failedAttempts: 9,
      lockedUntil: null,
      lastFailedAt: null,
    })
    mockCompare.mockResolvedValue(false)
    mockUpdate.mockResolvedValue({})

    const res = await POST(makeRequest({ firstName: 'Alex', lastName: 'Rivera', pin: '0000' }))
    expect(res.status).toBe(423)
    const data = await res.json()
    expect(data.error).toBe('locked')

    // Should have updated with lockedUntil
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedAttempts: 10,
          lockedUntil: expect.any(Date),
        }),
      })
    )
  })

  it('returns user data and sets cookie on successful login', async () => {
    mockFindFirst.mockResolvedValue({
      id: 1,
      firstName: 'Jimmy',
      lastName: 'Xiloj',
      pin: '$2a$10$hash',
      failedAttempts: 0,
      lockedUntil: null,
      lastFailedAt: null,
    })
    mockCompare.mockResolvedValue(true)
    mockUpdate.mockResolvedValue({})
    mockFindMany.mockResolvedValue([
      {
        id: 1,
        role: 'admin',
        position: 'PLHQ',
        project: { id: 1, name: 'Grammy Awards 2026' },
      },
    ])

    const res = await POST(makeRequest({ firstName: 'Jimmy', lastName: 'Xiloj', pin: '1234' }))
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.user.firstName).toBe('Jimmy')
    expect(data.user.lastName).toBe('Xiloj')
    expect(data.memberships).toHaveLength(1)

    // Check session cookie was set
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('session=')
  })

  it('clears expired lockout and allows login', async () => {
    const user = {
      id: 1,
      firstName: 'Alex',
      lastName: 'Rivera',
      pin: '$2a$10$hash',
      failedAttempts: 10,
      lockedUntil: new Date(Date.now() - 1000), // expired
      lastFailedAt: new Date(),
    }
    mockFindFirst.mockResolvedValue(user)
    mockCompare.mockResolvedValue(true)
    mockUpdate.mockResolvedValue({})
    mockFindMany.mockResolvedValue([])

    const res = await POST(makeRequest({ firstName: 'Alex', lastName: 'Rivera', pin: '5678' }))
    expect(res.status).toBe(200)

    // Should have cleared lockout fields
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { failedAttempts: 0, lockedUntil: null, lastFailedAt: null },
      })
    )
  })

  it('is case-insensitive for name lookup', async () => {
    mockFindFirst.mockResolvedValue(null)

    await POST(makeRequest({ firstName: 'jimmy', lastName: 'xiloj', pin: '1234' }))

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          firstName: { equals: 'jimmy', mode: 'insensitive' },
          lastName: { equals: 'xiloj', mode: 'insensitive' },
        },
      })
    )
  })
})
