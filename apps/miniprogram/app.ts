import { resolveApiBaseUrl } from './services/api-base-url'

const accountInfo = wx.getAccountInfoSync()
const deviceInfo = wx.getDeviceInfo()

App({
  globalData: {
    apiBaseUrl: resolveApiBaseUrl(accountInfo.miniProgram.envVersion, deviceInfo.platform),
  },
})
