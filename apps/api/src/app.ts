import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { mongodbPlugin, type MongoPluginOptions } from './plugins/mongodb.js'
import { authPlugin } from './plugins/auth.js'
import { authRoutes, type AuthRoutesOptions } from './routes/auth.js'
import { meRoutes } from './routes/me.js'
import { adminMemberRoutes } from './routes/admin-members.js'
import { healthRoutes } from './routes/health.js'
import { AppError } from './lib/errors.js'
import { avatarRoutes, type AvatarRoutesOptions } from './routes/avatar.js'
import { adminMealDayRoutes } from './routes/admin-meal-days.js'
import { reservationRoutes } from './routes/reservations.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { notificationRoutes } from './routes/notifications.js'
import { billRoutes } from './routes/bills.js'
import { actualQuantityRoutes } from './routes/actual-quantities.js'

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger']
  mongo?: MongoPluginOptions
  auth?: AuthRoutesOptions
  avatars?: AvatarRoutesOptions
  billingStartDate?: string
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: 'x-request-id',
  })

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Egg Booking API',
        version: '0.1.0',
      },
    },
  })
  app.register(swaggerUi, { routePrefix: '/docs' })

  if (options.mongo) {
    app.register(mongodbPlugin, options.mongo)
  }

  app.register(healthRoutes)

  if (options.mongo && options.auth) {
    app.register(authPlugin, { sessionSecret: options.auth.sessionSecret })
    app.register(authRoutes, options.auth)
    app.register(meRoutes)
    app.register(adminMemberRoutes)
    app.register(adminMealDayRoutes)
    app.register(reservationRoutes)
    app.register(dashboardRoutes, { billingStartDate: options.billingStartDate ?? '2026-10-09' })
    app.register(notificationRoutes)
    app.register(billRoutes, { billingStartDate: options.billingStartDate ?? '2026-10-09' })
    app.register(actualQuantityRoutes, { billingStartDate: options.billingStartDate ?? '2026-10-09' })
    if (options.avatars) app.register(avatarRoutes, options.avatars)
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        requestId: request.id,
      })
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      ('validation' in error || ('code' in error && error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'))
    ) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数不正确',
        requestId: request.id,
      })
    }

    request.log.error({ err: error }, 'unhandled request error')
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用',
      requestId: request.id,
    })
  })

  return app
}
