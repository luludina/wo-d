import fp from 'fastify-plugin'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { WithId } from 'mongodb'
import { collections } from '../db/collections.js'
import type { SessionDocument, UserDocument } from '../db/models.js'
import { hashSessionToken } from '../auth/session.js'
import { AppError } from '../lib/errors.js'

declare module 'fastify' {
  interface FastifyRequest {
    currentSession: WithId<SessionDocument> | null
    currentUser: WithId<UserDocument> | null
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireMember: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export interface AuthPluginOptions {
  sessionSecret: string
}

export const authPlugin = fp<AuthPluginOptions>(async (app, options) => {
  app.decorateRequest('currentSession', null)
  app.decorateRequest('currentUser', null)

  const authenticate = async (request: FastifyRequest): Promise<void> => {
    const authorization = request.headers.authorization
    if (!authorization?.startsWith('Bearer ')) {
      throw new AppError(401, 'AUTH_REQUIRED', '请先登录')
    }

    const token = authorization.slice('Bearer '.length).trim()
    if (!token) throw new AppError(401, 'AUTH_REQUIRED', '请先登录')

    const now = new Date()
    const { sessions, users } = collections(app.mongo.db)
    const session = await sessions.findOne({
      tokenHash: hashSessionToken(token, options.sessionSecret),
      expiresAt: { $gt: now },
    })
    if (!session) throw new AppError(401, 'SESSION_INVALID', '登录状态已失效')

    const user = await users.findOne({ _id: session.userId })
    if (!user) throw new AppError(401, 'SESSION_INVALID', '登录状态已失效')

    request.currentSession = session
    request.currentUser = user

    if (now.getTime() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
      void sessions.updateOne({ _id: session._id }, { $set: { lastUsedAt: now } }).catch((error) => {
        request.log.warn({ err: error }, 'failed to update session last-used time')
      })
    }
  }

  app.decorate('authenticate', async (request, _reply) => authenticate(request))
  app.decorate('requireMember', async (request, _reply) => {
    await authenticate(request)
    if (request.currentUser?.memberStatus === 'disabled') {
      throw new AppError(403, 'MEMBER_DISABLED', '账号已被停用')
    }
    if (request.currentUser?.memberStatus !== 'approved') {
      throw new AppError(403, 'MEMBER_NOT_APPROVED', '成员申请尚未通过')
    }
  })
  app.decorate('requireAdmin', async (request, reply) => {
    await app.requireMember(request, reply)
    if (!request.currentUser?.isAdmin) {
      throw new AppError(403, 'ADMIN_REQUIRED', '需要管理员权限')
    }
  })
})
