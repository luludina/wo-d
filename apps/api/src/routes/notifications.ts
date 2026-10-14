import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { collections } from '../db/collections.js'
import { AppError } from '../lib/errors.js'

const NotificationParamsSchema = Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const NotificationQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
  },
  { additionalProperties: false },
)

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { page?: number; limit?: number } }>(
    '/api/v1/notifications',
    {
      schema: { tags: ['notifications'], querystring: NotificationQuerySchema },
      preHandler: app.requireMember,
    },
    async (request) => {
      const page = request.query.page ?? 1
      const limit = request.query.limit ?? 20
      const { notifications } = collections(app.mongo.db)
      const filter = { receiverId: request.currentUser!._id }
      const [items, unreadCount, totalCount] = await Promise.all([
        notifications
          .find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
        notifications.countDocuments({ ...filter, isRead: false }),
        notifications.countDocuments(filter),
      ])
      const totalPages = Math.ceil(totalCount / limit)
      return {
        items: items.map((item) => ({
          id: item._id.toHexString(),
          type: item.type,
          title: item.title,
          content: item.content,
          ...(item.relatedDate ? { relatedDate: item.relatedDate } : {}),
          ...(item.relatedBillId ? { relatedBillId: item.relatedBillId.toHexString() } : {}),
          isRead: item.isRead,
          createdAt: item.createdAt.toISOString(),
        })),
        unreadCount,
        page,
        limit,
        totalCount,
        totalPages,
        hasMore: page < totalPages,
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/v1/notifications/:id/read',
    {
      schema: { tags: ['notifications'], params: NotificationParamsSchema },
      preHandler: app.requireMember,
    },
    async (request) => {
      if (!ObjectId.isValid(request.params.id)) throw new AppError(400, 'NOTIFICATION_ID_INVALID', '通知编号无效')
      const { notifications } = collections(app.mongo.db)
      await notifications.updateOne(
        { _id: new ObjectId(request.params.id), receiverId: request.currentUser!._id },
        { $set: { isRead: true, readAt: new Date() } },
      )
      return { ok: true }
    },
  )
}
