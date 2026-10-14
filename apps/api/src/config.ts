import { resolve } from 'node:path'

export interface AppConfig {
  host: string
  port: number
  logLevel: string
  mongoUri: string
  mongoDbName: string
  sessionSecret: string
  sessionTtlDays: number
  wechatAppId: string
  wechatAppSecret: string
  avatarUploadDir: string
  billingStartDate: string
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return port
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function parseDate(name: string, value: string | undefined, fallback: string): string {
  const date = value ?? fallback
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`${name} must use YYYY-MM-DD format`)
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (parsed.toISOString().slice(0, 10) !== date) throw new Error(`${name} must be a real date`)
  return date
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: parsePort(env.PORT),
    logLevel: env.LOG_LEVEL ?? 'info',
    mongoUri: required('MONGO_URI', env.MONGO_URI),
    mongoDbName: env.MONGO_DB_NAME ?? 'egg_booking',
    sessionSecret: required('SESSION_SECRET', env.SESSION_SECRET),
    sessionTtlDays: parsePositiveInteger('SESSION_TTL_DAYS', env.SESSION_TTL_DAYS, 30),
    wechatAppId: required('WECHAT_APP_ID', env.WECHAT_APP_ID),
    wechatAppSecret: required('WECHAT_APP_SECRET', env.WECHAT_APP_SECRET),
    avatarUploadDir: resolve(env.AVATAR_UPLOAD_DIR ?? './data/avatars'),
    billingStartDate: parseDate('BILLING_START_DATE', env.BILLING_START_DATE, '2026-10-09'),
  }
}
