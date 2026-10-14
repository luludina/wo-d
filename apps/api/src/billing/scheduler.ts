import type { FastifyBaseLogger } from 'fastify'
import type { Db, MongoClient } from 'mongodb'
import { generateDueBills } from '../domain/billing.js'

const CHECK_INTERVAL_MS = 60_000

export async function runBillingSchedulerCycle(
  client: MongoClient,
  db: Db,
  billingStartDate: string,
  logger: FastifyBaseLogger,
  now = new Date(),
): Promise<void> {
  const results = await generateDueBills(client, db, billingStartDate, now)
  for (const result of results) {
    if (!result.generated) continue
    logger.info(
      {
        weekStart: result.weekStart,
        weekEnd: result.weekEnd,
        billCount: result.billCount,
        totalQuantity: result.totalQuantity,
        totalAmountFen: result.totalAmountFen,
      },
      'weekly bills generated',
    )
  }
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
