import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { collections } from '../db/collections.js'
import { AppError } from '../lib/errors.js'
import { presentUser } from '../presenters/user.js'
import { decodeAvatarBase64, detectAvatarImageType } from '../avatar/image.js'

const AvatarBodySchema = Type.Object(
  { dataBase64: Type.String({ minLength: 4, maxLength: 2_800_000 }) },
  { additionalProperties: false },
)

const AvatarParamsSchema = Type.Object({
  filename: Type.String({ pattern: '^[0-9a-f-]{36}\\.(jpg|png|webp)$' }),
})

type AvatarBody = Static<typeof AvatarBodySchema>
type AvatarParams = Static<typeof AvatarParamsSchema>

export interface AvatarRoutesOptions {
  uploadDir: string
}

const contentTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export const avatarRoutes: FastifyPluginAsync<AvatarRoutesOptions> = async (app, options) => {
  await mkdir(options.uploadDir, { recursive: true })

  app.get<{ Params: AvatarParams }>(
    '/uploads/avatars/:filename',
    { schema: { tags: ['uploads'], params: AvatarParamsSchema } },
    async (request, reply) => {
      const filename = basename(request.params.filename)
      try {
        const buffer = await readFile(join(options.uploadDir, filename))
        return reply
          .header('content-type', contentTypes[extname(filename)] ?? 'application/octet-stream')
          .header('cache-control', 'public, max-age=86400')
          .send(buffer)
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
          throw new AppError(404, 'AVATAR_NOT_FOUND', '头像不存在')
        }
        throw error
      }
    },
  )

  app.post<{ Body: AvatarBody }>(
    '/api/v1/me/avatar',
    {
      bodyLimit: 3_000_000,
      schema: { tags: ['me'], body: AvatarBodySchema },
      preHandler: app.authenticate,
    },
    async (request) => {
      let buffer: Buffer
      try {
        buffer = decodeAvatarBase64(request.body.dataBase64)
      } catch {
        throw new AppError(400, 'AVATAR_INVALID', '头像文件无效或超过 2MB')
      }

      const imageType = detectAvatarImageType(buffer)
      if (!imageType) {
        throw new AppError(400, 'AVATAR_TYPE_UNSUPPORTED', '头像仅支持 JPG、PNG 或 WebP')
      }

      const filename = `${randomUUID()}.${imageType.extension}`
      const filePath = join(options.uploadDir, filename)
      await writeFile(filePath, buffer, { flag: 'wx' })

      const avatarUrl = `/uploads/avatars/${filename}`
      const previousAvatarUrl = request.currentUser?.avatarUrl
      const user = await collections(app.mongo.db).users.findOneAndUpdate(
        { _id: request.currentUser!._id },
        { $set: { avatarUrl, updatedAt: new Date() } },
        { returnDocument: 'after' },
      )

      if (!user) {
        await unlink(filePath).catch(() => undefined)
        throw new AppError(404, 'USER_NOT_FOUND', '用户不存在')
      }

      if (previousAvatarUrl?.startsWith('/uploads/avatars/')) {
        const previousFilename = basename(previousAvatarUrl)
        if (previousFilename !== filename) {
          void unlink(join(options.uploadDir, previousFilename)).catch(() => undefined)
        }
      }

      return presentUser(user)
    },
  )
}
