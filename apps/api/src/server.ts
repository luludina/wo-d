import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createWechatCodeExchanger } from './auth/wechat.js'
import { runBillingSchedulerCycle, startBillingScheduler } from './billing/scheduler.js'

if (existsSync('.env')) loadEnvFile('.env')

const config = loadConfig()
const app = buildApp({
  logger: {
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'phone', 'token', 'sessionToken'],
      censor: '[REDACTED]',
    },
  },
  mongo: {
    uri: config.mongoUri,
    dbName: config.mongoDbName,
  },
  auth: {
    exchangeWechatCode: createWechatCodeExchanger(config.wechatAppId, config.wechatAppSecret),
    sessionSecret: config.sessionSecret,
    sessionTtlDays: config.sessionTtlDays,
  },
  avatars: { uploadDir: config.avatarUploadDir },
  billingStartDate: config.billingStartDate,
})

let stopBillingScheduler: (() => void) | undefined
app.addHook('onReady', async () => {
  try {
    await runBillingSchedulerCycle(
      app.mongo.client,
      app.mongo.db,
      config.billingStartDate,
      app.log,
    )
  } catch (error) {
    app.log.error({ err: error }, 'initial weekly billing cycle failed')
  }
  stopBillingScheduler = startBillingScheduler(
    app.mongo.client,
    app.mongo.db,
    config.billingStartDate,
    app.log,
  )
})

app.addHook('onClose', async () => {
  stopBillingScheduler?.()
})

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
