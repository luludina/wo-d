import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { collections } from '../db/collections.js'
import { createSession } from '../auth/session.js'
import type { ExchangeWechatCode } from '../auth/wechat.js'
import { presentUser } from '../presenters/user.js'

const LoginRequestSchema = Type.Object(
  { code: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
)

type LoginRequest = Static<typeof LoginRequestSchema>

export interface AuthRoutesOptions {
  exchangeWechatCode: ExchangeWechatCode
  sessionSecret: string
  sessionTtlDays: number
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  app.post<{ Body: LoginRequest }>(
    '/api/v1/auth/wechat-login',
    {
      schema: {
        tags: ['auth'],
        body: LoginRequestSchema,
      },
    },
    async (request) => {
      const { openid } = await options.exchangeWechatCode(request.body.code)
      const now = new Date()
      const user = await collections(app.mongo.db).users.findOneAndUpdate(
        { openid },
        {
          $set: { updatedAt: now },
          $setOnInsert: {
            memberStatus: 'draft',
            isAdmin: false,
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: 'after' },
      )

      if (!user) throw new Error('Failed to create or load user')
      const session = await createSession(
        app.mongo.db,
        user._id,
        options.sessionSecret,
        options.sessionTtlDays,
      )

      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: presentUser(user),
      }
    },
  )

  app.post(
    '/api/v1/auth/logout',
    {
      schema: { tags: ['auth'] },
      preHandler: app.authenticate,
    },
    async (request) => {
      await collections(app.mongo.db).sessions.deleteOne({ _id: request.currentSession!._id })
      return { ok: true }
    },
  )
}
