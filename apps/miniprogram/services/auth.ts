import type { CurrentUser, LoginBody } from '@egg-booking/contracts'
import { ApiError, apiRequest, clearSessionToken, getSessionToken, setSessionToken } from './api'

const CURRENT_USER_KEY = 'egg-booking-current-user'
const MANUAL_LOGOUT_KEY = 'egg-booking-manual-logout'

export function getCachedUser(): CurrentUser | undefined {
  const value = wx.getStorageSync<CurrentUser>(CURRENT_USER_KEY)
  return value && typeof value === 'object' ? value : undefined
}

export function setCachedUser(user: CurrentUser): void {
  wx.setStorageSync(CURRENT_USER_KEY, user)
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1] as {
    route?: string
    getTabBar?: () => { refreshTabs?: (route?: string) => void }
  } | undefined
  currentPage?.getTabBar?.()?.refreshTabs?.(currentPage.route)
}

export function isManuallyLoggedOut(): boolean {
  return wx.getStorageSync<boolean>(MANUAL_LOGOUT_KEY) === true
}

export function clearManualLogout(): void {
  wx.removeStorageSync(MANUAL_LOGOUT_KEY)
}

export async function logoutCurrentSession(): Promise<void> {
  try {
    await apiRequest<{ ok: true }>({ path: '/api/v1/auth/logout', method: 'POST', data: {} })
  } catch {
    // Local logout must still succeed when the server is temporarily unreachable.
  } finally {
    clearSessionToken()
    wx.removeStorageSync(CURRENT_USER_KEY)
    wx.setStorageSync(MANUAL_LOGOUT_KEY, true)
  }
}

function wechatLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) resolve(result.code)
        else reject(new Error('微信登录未返回有效凭证'))
      },
      fail: reject,
    })
  })
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const user = await apiRequest<CurrentUser>({ path: '/api/v1/me' })
  setCachedUser(user)
  return user
}

export async function bootstrapSession(): Promise<CurrentUser> {
  if (getSessionToken()) {
    try {
      return await getCurrentUser()
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 401) throw error
    }
  }

  const code = await wechatLogin()
  const result = await apiRequest<LoginBody>({
    path: '/api/v1/auth/wechat-login',
    method: 'POST',
    data: { code },
    authenticated: false,
  })
  setSessionToken(result.token)
  setCachedUser(result.user)
  clearManualLogout()
  return result.user
}
