import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { ObjectId, type ClientSession, type WithId } from 'mongodb'
import type { MemberStatus } from '@egg-booking/contracts'
import { collections } from '../db/collections.js'
import type { UserDocument } from '../db/models.js'
import { AppError } from '../lib/errors.js'
import { presentUser } from '../presenters/user.js'
import { getShanghaiToday, isReservationLocked } from '../domain/business-date.js'

type PersistedUser = WithId<UserDocument>

const MemberParamsSchema = Type.Object({
  id: Type.String({ pattern: '^[a-fA-F0-9]{24}$' }),
})

const MemberListQuerySchema = Type.Object(
  {
    status: Type.Optional(
      Type.Union([
        Type.Literal('draft'),
        Type.Literal('pending'),
        Type.Literal('approved'),
        Type.Literal('rejected'),
        Type.Literal('disabled'),
      ]),
    ),
  },
  { additionalProperties: false },
)

const ReasonSchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 300 }) },
  { additionalProperties: false },
)

const OptionalReasonSchema = Type.Object(
  { reason: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })) },
  { additionalProperties: false },
)

type MemberParams = Static<typeof MemberParamsSchema>
type MemberListQuery = Static<typeof MemberListQuerySchema>
type ReasonBody = Static<typeof ReasonSchema>
type OptionalReasonBody = Static<typeof OptionalReasonSchema>

function stateOf(user: PersistedUser) {
  return {
    memberStatus: user.memberStatus,
    isAdmin: user.isAdmin,
    ...(user.rejectionReason ? { rejectionReason: user.rejectionReason } : {}),
  }
}

async function addAuditLog(
  app: Parameters<FastifyPluginAsync>[0],
  session: ClientSession,
  actor: PersistedUser,
  action: string,
  target: PersistedUser,
  before: ReturnType<typeof stateOf>,
  reason?: string,
) {
  const document = {
    actorUserId: actor._id,
    action,
    targetType: 'user',
    targetId: target._id.toHexString(),
    before,
    after: stateOf(target),
    createdAt: new Date(),
    ...(reason ? { reason } : {}),
  }
  await collections(app.mongo.db).auditLogs.insertOne(document, { session })
}

export const adminMemberRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: MemberListQuery }>(
    '/api/v1/admin/members',
    {
      schema: { tags: ['admin'], querystring: MemberListQuerySchema },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const filter = request.query.status ? { memberStatus: request.query.status } : {}
      const users = await collections(app.mongo.db).users
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(500)
        .toArray()
      return { items: users.map(presentUser) }
    },
  )

  app.post<{ Params: MemberParams }>(
    '/api/v1/admin/members/:id/approve',
    {
      schema: { tags: ['admin'], params: MemberParamsSchema },
      preHandler: app.requireAdmin,
    },
    async (request) => updateMember(request.params.id, 'approve', request.currentUser!),
  )

  app.post<{ Params: MemberParams; Body: ReasonBody }>(
    '/api/v1/admin/members/:id/reject',
    {
      schema: { tags: ['admin'], params: MemberParamsSchema, body: ReasonSchema },
      preHandler: app.requireAdmin,
    },
    async (request) =>
      updateMember(request.params.id, 'reject', request.currentUser!, request.body.reason.trim()),
  )

  app.post<{ Params: MemberParams; Body: OptionalReasonBody }>(
    '/api/v1/admin/members/:id/disable',
    {
      schema: { tags: ['admin'], params: MemberParamsSchema, body: OptionalReasonSchema },
      preHandler: app.requireAdmin,
    },
    async (request) =>
      updateMember(request.params.id, 'disable', request.currentUser!, request.body.reason?.trim()),
  )

  for (const action of ['enable', 'grant-admin', 'revoke-admin'] as const) {
    app.post<{ Params: MemberParams }>(
      `/api/v1/admin/members/:id/${action}`,
      {
        schema: { tags: ['admin'], params: MemberParamsSchema },
        preHandler: app.requireAdmin,
      },
      async (request) => updateMember(request.params.id, action, request.currentUser!),
    )
  }

  async function updateMember(
    id: string,
    action: 'approve' | 'reject' | 'disable' | 'enable' | 'grant-admin' | 'revoke-admin',
    actor: PersistedUser,
    reason?: string,
  ) {
    const targetId = new ObjectId(id)
    const mongoSession = app.mongo.client.startSession()
    let updated: PersistedUser | null = null

    try {
      await mongoSession.withTransaction(async () => {
        const { users, sessions, reservations, notifications } = collections(app.mongo.db)
        const target = await users.findOne({ _id: targetId }, { session: mongoSession })
        if (!target) throw new AppError(404, 'MEMBER_NOT_FOUND', '成员不存在')
        const before = stateOf(target)
        const now = new Date()
        const set: Partial<UserDocument> = { updatedAt: now }
        const unset: Record<string, ''> = {}

        if (action === 'approve') {
          if (target.memberStatus !== 'pending') {
            throw new AppError(409, 'MEMBER_STATE_INVALID', '只有审核中的申请可以通过')
          }
          set.memberStatus = 'approved'
          unset.rejectionReason = ''
        } else if (action === 'reject') {
          if (target.memberStatus !== 'pending') {
            throw new AppError(409, 'MEMBER_STATE_INVALID', '只有审核中的申请可以拒绝')
          }
          if (!reason) throw new AppError(400, 'REJECTION_REASON_REQUIRED', '请填写拒绝原因')
          set.memberStatus = 'rejected'
          set.rejectionReason = reason
        } else if (action === 'disable') {
          if (target.memberStatus !== 'approved') {
            throw new AppError(409, 'MEMBER_STATE_INVALID', '只有已通过成员可以停用')
          }
          if (target.isAdmin) {
            const adminCount = await users.countDocuments(
              { isAdmin: true, memberStatus: 'approved' },
              { session: mongoSession },
            )
            if (adminCount <= 1) {
              throw new AppError(409, 'LAST_ADMIN_PROTECTED', '不能停用最后一名管理员')
            }
          }
          set.memberStatus = 'disabled'
        } else if (action === 'enable') {
          if (target.memberStatus !== 'disabled') {
            throw new AppError(409, 'MEMBER_STATE_INVALID', '只有已停用成员可以重新启用')
          }
          set.memberStatus = 'approved'
        } else if (action === 'grant-admin') {
          if (target.memberStatus !== 'approved' || target.isAdmin) {
            throw new AppError(409, 'MEMBER_STATE_INVALID', '只能将普通的已通过成员任命为管理员')
          }
          set.isAdmin = true
        } else {
          if (target.memberStatus !== 'approved' || !target.isAdmin) {
            throw new AppError(409, 'MEMBER_STATE_INVALID', '该成员不是可撤销的管理员')
          }
          const adminCount = await users.countDocuments(
            { isAdmin: true, memberStatus: 'approved' },
            { session: mongoSession },
          )
          if (adminCount <= 1) {
            throw new AppError(409, 'LAST_ADMIN_PROTECTED', '不能撤销最后一名管理员')
          }
          set.isAdmin = false
        }

        const update = Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set }
        updated = await users.findOneAndUpdate(
          { _id: targetId, updatedAt: target.updatedAt },
          update,
          { returnDocument: 'after', session: mongoSession },
        )
        if (!updated) {
          throw new AppError(409, 'MEMBER_STATE_CHANGED', '成员状态已变化，请刷新后重试')
        }

        if (action === 'disable') {
          const futureReservations = await reservations
            .find(
              { memberId: targetId, date: { $gte: getShanghaiToday(now) }, status: 'active' },
              { session: mongoSession },
            )
            .toArray()
          const cancellableIds = futureReservations
            .filter((reservation) => !isReservationLocked(reservation.date, now))
            .map((reservation) => reservation._id)
          if (cancellableIds.length > 0) {
            await reservations.updateMany(
              { _id: { $in: cancellableIds } },
              {
                $set: {
                  status: 'cancelled',
                  cancelledReason: 'member_disabled',
                  updatedAt: now,
                },
              },
              { session: mongoSession },
            )
          }
          await sessions.deleteMany({ userId: targetId }, { session: mongoSession })
        }
        const notificationText = {
          approve: ['成员申请已通过', '你的成员申请已通过，现在可以预约鸡蛋了'],
          reject: ['成员申请未通过', `你的成员申请未通过${reason ? `：${reason}` : ''}`],
          disable: ['账号已被停用', `你的账号已被管理员停用${reason ? `：${reason}` : ''}`],
          enable: ['账号已重新启用', '你的账号已重新启用，可以继续预约鸡蛋'],
          'grant-admin': ['管理员权限已开通', '你已被设置为管理员'],
          'revoke-admin': ['管理员权限已撤销', '你的管理员权限已被撤销'],
        }[action]
        await notifications.insertOne(
          {
            receiverId: targetId,
            type: `member_${action}`,
            title: notificationText[0]!,
            content: notificationText[1]!,
            isRead: false,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
          },
          { session: mongoSession },
        )
        await addAuditLog(app, mongoSession, actor, action, updated, before, reason)
      })
    } finally {
      await mongoSession.endSession()
    }

    if (!updated) throw new Error('Member update transaction produced no result')
    return presentUser(updated)
  }
}
