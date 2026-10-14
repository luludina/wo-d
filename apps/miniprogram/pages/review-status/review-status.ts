import { getCurrentUser } from '../../services/auth'

Page({
  data: { checking: false },

  async checkStatus() {
    this.setData({ checking: true })
    try {
      const user = await getCurrentUser()
      if (user.memberStatus !== 'pending') {
        void wx.reLaunch({ url: '/pages/index/index' })
        return
      }
      wx.showToast({ title: '仍在审核中', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '查询失败', icon: 'none' })
    } finally {
      this.setData({ checking: false })
    }
  },
})
