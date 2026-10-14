import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'

const HealthSchema = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('unavailable')]),
})

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health/live',
    {
      schema: {
        tags: ['health'],
        response: { 200: HealthSchema },
      },
    },
    async () => ({ status: 'ok' as const }),
  )

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        response: {
          200: HealthSchema,
          503: HealthSchema,
        },
      },
    },
    async (_request, reply) => {
      if (!app.hasDecorator('mongo')) {
        return reply.code(503).send({ status: 'unavailable' })
      }

      try {
        await app.mongo.db.command({ ping: 1 })
        return reply.send({ status: 'ok' })
      } catch {
        return reply.code(503).send({ status: 'unavailable' })
      }
    },
  )
}
