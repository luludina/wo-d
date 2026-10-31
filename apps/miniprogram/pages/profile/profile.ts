import type { CurrentUser } from '@egg-booking/contracts'
import { apiRequest, resolveApiUrl } from '../../services/api'
import { getCurrentUser, logoutCurrentSession } from '../../services/auth'
import { createShareAppMessage } from '../../services/share'

Page({
  onShareAppMessage: createShareAppMessage,

  data: {
    loading: true,
    saving: false,
    isApplication: true,
    editing: false,
    isAdmin: false,
    rejectionReason: '',
    nickname: '',
    realName: '',
    department: '',
    phone: '',
    avatarUrl: '',
    avatarUploading: false,
    loggingOut: false,
  },

  onLoad() {
    void this.loadProfile()
  },

  onShow() {
    this.syncTabBarSelection()
    if (!this.data.loading && !this.data.editing) void this.loadProfile()
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar?.() as (WechatMiniprogram.Component.TrivialInstance & {
      refreshTabs?: (route?: string) => void
    }) | undefined
    tabBar?.refreshTabs?.('pages/profile/profile')
  },

  async loadProfile() {
    try {
      const user = await getCurrentUser()
      this.applyUser(user)
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  applyUser(user: CurrentUser) {
    const isApplication = user.memberStatus === 'draft' || user.memberStatus === 'rejected'
    this.setData({
      isApplication,
      editing: isApplication,
      isAdmin: user.isAdmin,
      rejectionReason: user.rejectionReason ?? '',
      nickname: user.nickname ?? '',
      realName: user.realName ?? '',
      department: user.department ?? '',
      phone: user.phone ?? '',
      avatarUrl: resolveApiUrl(user.avatarUrl),
    })
    void wx.setNavigationBarTitle({ title: isApplication ? '完善资料' : '我的' })
  },

  chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    const temporaryPath = event.detail.avatarUrl
    if (!temporaryPath) return
    void this.uploadAvatar(temporaryPath)
  },

  async uploadAvatar(filePath: string) {
    this.setData({ avatarUploading: true })
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath,
          encoding: 'base64',
          success: (result) => resolve(result.data as string),
          fail: reject,
        })
      })
      const user = await apiRequest<CurrentUser>({
        path: '/api/v1/me/avatar',
        method: 'POST',
        data: { dataBase64 },
      })
      this.setData({ avatarUrl: resolveApiUrl(user.avatarUrl) })
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '头像上传失败', icon: 'none' })
    } finally {
      this.setData({ avatarUploading: false })
    }
  },

  updateField(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as
      | 'nickname'
      | 'realName'
      | 'department'
      | 'phone'
    this.setData({ [field]: event.detail.value })
  },

  startEditing() {
    this.setData({ editing: true })
    void wx.setNavigationBarTitle({ title: '修改资料' })
  },

  cancelEditing() {
    this.setData({ editing: false })
    void wx.setNavigationBarTitle({ title: '我的' })
    void this.loadProfile()
  },

  openMembers() {
    void wx.navigateTo({ url: '/pages/admin/members/members' })
  },

  openBills() {
    void wx.navigateTo({ url: '/pages/bills/list/list' })
  },

  openAdminBills() {
    void wx.navigateTo({ url: '/pages/admin/bills/list/list' })
  },

  confirmLogout() {
    if (this.data.loggingOut) return
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能继续使用。',
      confirmText: '退出',
      confirmColor: '#b34b42',
      success: (result) => {
        if (result.confirm) void this.logout()
      },
    })
  },

  async logout() {
    this.setData({ loggingOut: true })
    await logoutCurrentSession()
    void wx.reLaunch({ url: '/pages/logged-out/logged-out' })
  },

  async submit() {
    if (!this.data.realName.trim() || !this.data.department.trim()) {
      wx.showToast({ title: '请填写真实姓名和部门', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      await apiRequest<CurrentUser>({
        path: '/api/v1/me/profile',
        method: 'PUT',
        data: {
          ...(this.data.nickname.trim() ? { nickname: this.data.nickname.trim() } : {}),
          realName: this.data.realName.trim(),
          department: this.data.department.trim(),
          phone: this.data.phone.trim() || null,
        },
      })

      if (this.data.isApplication) {
        await apiRequest<CurrentUser>({ path: '/api/v1/me/application', method: 'POST', data: {} })
        void wx.reLaunch({ url: '/pages/review-status/review-status' })
      } else {
        wx.showToast({ title: '资料已保存', icon: 'success' })
        this.setData({ editing: false })
        void wx.setNavigationBarTitle({ title: '我的' })
      }
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
