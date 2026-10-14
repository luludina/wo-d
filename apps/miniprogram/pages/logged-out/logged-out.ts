Page({
  loginAgain() {
    void wx.reLaunch({ url: '/pages/index/index?login=1' })
  },
})
