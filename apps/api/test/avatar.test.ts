import { describe, expect, it } from 'vitest'
import { decodeAvatarBase64, detectAvatarImageType, MAX_AVATAR_BYTES } from '../src/avatar/image.js'

describe('avatar image validation', () => {
  it('detects supported image signatures', () => {
    expect(detectAvatarImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))?.extension).toBe('jpg')
    expect(
      detectAvatarImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        ?.extension,
    ).toBe('png')
    expect(detectAvatarImageType(Buffer.from('RIFF0000WEBP'))?.extension).toBe('webp')
  })

  it('rejects unsupported content and invalid base64', () => {
    expect(detectAvatarImageType(Buffer.from('not-an-image'))).toBeNull()
    expect(() => decodeAvatarBase64('%%%')).toThrow('INVALID_BASE64')
  })

  it('rejects images larger than the configured limit', () => {
    const oversized = Buffer.alloc(MAX_AVATAR_BYTES + 1).toString('base64')
    expect(() => decodeAvatarBase64(oversized)).toThrow('INVALID_SIZE')
  })
})
