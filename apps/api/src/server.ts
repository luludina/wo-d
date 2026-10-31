import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createWechatCodeExchanger } from './auth/wechat.js'

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
