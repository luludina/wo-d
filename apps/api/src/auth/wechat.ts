import { AppError } from '../lib/errors.js'

interface WechatCodeResponse {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

export type ExchangeWechatCode = (code: string) => Promise<{ openid: string }>

export function createWechatCodeExchanger(appId: string, appSecret: string): ExchangeWechatCode {
  return async (code) => {
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
    url.searchParams.set('appid', appId)
    url.searchParams.set('secret', appSecret)
    url.searchParams.set('js_code', code)
    url.searchParams.set('grant_type', 'authorization_code')

    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    } catch {
      throw new AppError(502, 'WECHAT_UNAVAILABLE', '微信登录服务暂时不可用')
    }

    if (!response.ok) {
      throw new AppError(502, 'WECHAT_UNAVAILABLE', '微信登录服务暂时不可用')
    }

    const body = (await response.json()) as WechatCodeResponse
    if (!body.openid || body.errcode) {
      throw new AppError(401, 'WECHAT_LOGIN_FAILED', '微信登录凭证无效')
    }

    return { openid: body.openid }
  }
}
