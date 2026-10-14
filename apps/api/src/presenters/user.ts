import type { CurrentUser } from '@egg-booking/contracts'
import type { WithId } from 'mongodb'
import type { UserDocument } from '../db/models.js'

export function presentUser(user: WithId<UserDocument>): CurrentUser {
  const result: CurrentUser = {
    id: user._id.toHexString(),
    memberStatus: user.memberStatus,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }

  if (user.avatarUrl !== undefined) result.avatarUrl = user.avatarUrl
  if (user.nickname !== undefined) result.nickname = user.nickname
  if (user.realName !== undefined) result.realName = user.realName
  if (user.department !== undefined) result.department = user.department
  if (user.phone !== undefined) result.phone = user.phone
  if (user.rejectionReason !== undefined) result.rejectionReason = user.rejectionReason

  return result
}
