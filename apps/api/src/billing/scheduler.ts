import type { FastifyBaseLogger } from 'fastify'
import type { Db, MongoClient } from 'mongodb'

const CHECK_INTERVAL_MS = 60_000

export async function runBillingSchedulerCycle(
  client: MongoClient,
  db: Db,
  billingStartDate: string,
  logger: FastifyBaseLogger,
  now = new Date(),
): Promise<void> {
  logger.debug({ billingStartDate, now }, 'automatic billing scheduler disabled; bills require manual generation and publishing')
}

export function startBillingScheduler(
  client: MongoClient,
  db: Db,
  billingStartDate: string,
  logger: FastifyBaseLogger,
): () => void {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await runBillingSchedulerCycle(client, db, billingStartDate, logger)
    } catch (error) {
      logger.error({ err: error }, 'weekly billing scheduler failed')
    } finally {
      running = false
    }
  }

  const timeout = setTimeout(() => {
    void run()
    const interval = setInterval(() => void run(), CHECK_INTERVAL_MS)
    interval.unref()
    stop = () => clearInterval(interval)
  }, millisecondsUntilNextMinute())
  timeout.unref()

  let stop = () => clearTimeout(timeout)
  return () => stop()
}

function millisecondsUntilNextMinute(now = Date.now()): number {
  return CHECK_INTERVAL_MS - (now % CHECK_INTERVAL_MS) + 100
}
