import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { collections } from '../db/collections.js'
import { AppError } from '../lib/errors.js'
import { presentUser } from '../presenters/user.js'

const ProfilePatchSchema = Type.Partial(
  Type.Object({
    nickname: Type.String({ minLength: 1, maxLength: 64 }),
    realName: Type.String({ minLength: 1, maxLength: 64 }),
    department: Type.String({ minLength: 1, maxLength: 100 }),
    phone: Type.Union([
      Type.String({ pattern: '^1[3-9]\\d{9}$' }),
      Type.Null(),
    ]),
  }),
  { additionalProperties: false, minProperties: 1 },
)

type ProfilePatch = Static<typeof ProfilePatchSchema>

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/me',
    { schema: { tags: ['me'] }, preHandler: app.authenticate },
    async (request) => presentUser(request.currentUser!),
  )

  app.put<{ Body: ProfilePatch }>(
    '/api/v1/me/profile',
    {
      schema: { tags: ['me'], body: ProfilePatchSchema },
      preHandler: app.authenticate,
    },
    async (request) => {
      const set: Record<string, string | Date> = { updatedAt: new Date() }
      const unset: Record<string, ''> = {}

      for (const field of ['nickname', 'realName', 'department'] as const) {
        const value = request.body[field]
        if (value !== undefined) set[field] = value.trim()
      }
      if (request.body.phone === null) unset.phone = ''
      else if (request.body.phone !== undefined) set.phone = request.body.phone

      const update = Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set }
      const user = await collections(app.mongo.db).users.findOneAndUpdate(
        { _id: request.currentUser!._id },
        update,
        { returnDocument: 'after' },
      )
      if (!user) throw new AppError(404, 'USER_NOT_FOUND', '用户不存在')
      return presentUser(user)
    },
  )

  app.post(
    '/api/v1/me/application',
    { schema: { tags: ['me'] }, preHandler: app.authenticate },
    async (request) => {
      const current = request.currentUser!
      if (!current.realName?.trim() || !current.department?.trim()) {
        throw new AppError(400, 'PROFILE_INCOMPLETE', '请先填写真实姓名和部门')
      }
      if (!['draft', 'rejected'].includes(current.memberStatus)) {
        throw new AppError(409, 'APPLICATION_STATE_INVALID', '当前状态不能提交成员申请')
      }

      const now = new Date()
      const user = await collections(app.mongo.db).users.findOneAndUpdate(
        { _id: current._id, memberStatus: { $in: ['draft', 'rejected'] } },
        {
          $set: { memberStatus: 'pending', updatedAt: now },
          $unset: { rejectionReason: '' },
        },
        { returnDocument: 'after' },
      )
      if (!user) {
        throw new AppError(409, 'APPLICATION_STATE_CHANGED', '成员申请状态已变化，请刷新后重试')
      }
      return presentUser(user)
    },
  )
}
