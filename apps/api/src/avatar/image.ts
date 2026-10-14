export const MAX_AVATAR_BYTES = 2 * 1024 * 1024

export interface AvatarImageType {
  extension: 'jpg' | 'png' | 'webp'
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export function detectAvatarImageType(buffer: Buffer): AvatarImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' }
  }

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length >= pngSignature.length && buffer.subarray(0, 8).equals(pngSignature)) {
    return { extension: 'png', contentType: 'image/png' }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' }
  }

  return null
}

export function decodeAvatarBase64(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('INVALID_BASE64')
  }

  const buffer = Buffer.from(value, 'base64')
  if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) {
    throw new Error('INVALID_SIZE')
  }
  return buffer
}
