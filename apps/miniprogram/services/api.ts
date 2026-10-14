import type { ApiErrorBody } from '@egg-booking/contracts'

const SESSION_TOKEN_KEY = 'egg-booking-session-token'

interface RequestOptions {
  path: string
  method?: 'GET' | 'POST' | 'PUT'
  data?: WechatMiniprogram.IAnyObject
  authenticated?: boolean
  headers?: Record<string, string>
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function getSessionToken(): string | undefined {
  const value = wx.getStorageSync<string>(SESSION_TOKEN_KEY)
  return typeof value === 'string' && value ? value : undefined
}

export function setSessionToken(token: string): void {
  wx.setStorageSync(SESSION_TOKEN_KEY, token)
}

export function clearSessionToken(): void {
  wx.removeStorageSync(SESSION_TOKEN_KEY)
}

export function resolveApiUrl(path: string | undefined): string {
  if (!path) return ''
  if (/^https?:\/\//.test(path)) return path
  const app = getApp<{ globalData: { apiBaseUrl: string } }>()
  return `${app.globalData.apiBaseUrl}${path}`
}

export function apiRequest<T>(options: RequestOptions): Promise<T> {
  const app = getApp<{ globalData: { apiBaseUrl: string } }>()
  const token = options.authenticated === false ? undefined : getSessionToken()
  const method = options.method ?? 'GET'

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBaseUrl}${options.path}`,
      method,
      ...(options.data !== undefined || method !== 'GET' ? { data: options.data ?? {} } : {}),
      header: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T)
          return
        }

        const body = response.data as ApiErrorBody
        if (response.statusCode === 401) clearSessionToken()
        reject(
          new ApiError(
            response.statusCode,
            body?.code ?? 'REQUEST_FAILED',
            body?.message ?? '请求失败，请稍后重试',
          ),
        )
      },
      fail() {
        reject(new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请稍后重试'))
      },
    })
  })
}
