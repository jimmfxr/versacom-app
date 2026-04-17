import { neon } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '../generated/prisma/client'

/**
 * The Neon serverless driver talks to the database over WebSockets. When
 * an idle pooled connection has been dropped server-side (PgBouncer's
 * idle timeout, network blip, etc.), the driver throws an `ErrorEvent`
 * (a DOM-style event, not a normal `Error`) — visible in logs as
 * `Error: [object ErrorEvent]`. The connection re-establishes for the
 * next request, so retrying once or twice transparently recovers without
 * the user ever seeing a 500.
 *
 * This guard tries hard to identify *only* those transient connection
 * errors so we never accidentally retry a real query failure.
 */
function isTransientNeonError(e: unknown): boolean {
  if (!e) return false

  // Real Errors with known connection codes / messages
  if (e instanceof Error) {
    if (e.name === 'ErrorEvent') return true
    const code = (e as Error & { code?: string }).code
    if (code === 'P1001' || code === 'P1002' || code === 'P1017') return true
    const msg = e.message ?? ''
    if (msg.includes('WebSocket')) return true
    if (msg.includes('ECONNRESET')) return true
    if (msg.includes('terminating connection')) return true
    if (msg.includes('Connection terminated')) return true
  }

  // ErrorEvent doesn't extend Error in the runtime the Neon driver uses,
  // so check its toString tag too.
  if (Object.prototype.toString.call(e) === '[object ErrorEvent]') return true

  return false
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (!isTransientNeonError(e) || i === attempts - 1) throw e
      const delay = 100 * 2 ** i // 100ms, 200ms
      console.warn(
        `[db] transient Neon error, retrying in ${delay}ms (attempt ${i + 1}/${attempts})`,
      )
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}

function createPrismaClient() {
  const sql = neon(process.env.DATABASE_URL!)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaNeon(sql as any)
  return new PrismaClient({ adapter }).$extends({
    name: 'retryOnTransientErrors',
    query: {
      $allOperations: ({ args, query }) => withRetry(() => query(args)),
    },
  })
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient }

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
