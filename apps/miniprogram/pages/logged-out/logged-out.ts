import { createShareAppMessage } from '../../services/share'

Page({
  onShareAppMessage: createShareAppMessage,

  loginAgain() {
    void wx.reLaunch({ url: '/pages/index/index?login=1' })
  },
})
