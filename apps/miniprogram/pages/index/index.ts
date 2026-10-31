import type {
  AdminTodaySummaryBody,
  CurrentUser,
  MyEggStatsBody,
  NotificationListBody,
  NotificationView,
  ReservationCalendarBody,
  ReservationCalendarItem,
} from '@egg-booking/contracts'
import { bootstrapSession, isManuallyLoggedOut } from '../../services/auth'
import { apiRequest } from '../../services/api'
import { formatChinaMonthDayTime } from '../../utils/date-time'
import { createShareAppMessage, createTimelineShare } from '../../services/share'

type TodayState = 'loading' | 'open' | 'closed' | 'unreserved' | 'reserved' | 'zero' | 'locked' | 'cancelled' | 'error'

interface NotificationRow extends NotificationView {
  icon: string
  timeText: string
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatTodayLabel(date: Date): string {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`
}

function formatMonthDay(value: string): string {
  const [, month, day] = value.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function notificationIcon(type: string): string {
  if (type === 'bill_generated' || type === 'bill_adjusted') return '单'
  if (type.startsWith('meal_day_')) return '日'
  if (type.startsWith('member_')) return '员'
  return '铃'
}

Page({
  onShareAppMessage: createShareAppMessage,
  onShareTimeline: createTimelineShare,

  data: {
    state: 'loading' as 'loading' | 'loggedOut' | 'ready' | 'error',
    errorMessage: '',
    displayName: '',
    roleLabel: '',
    isAdmin: false,
    todayDate: '',
    todayLabel: '',
    todayLoading: false,
    todayState: 'loading' as TodayState,
    todayTitle: '',
    todayDetail: '',
    todayQuantity: null as number | null,
    todayCanEdit: false,
    todaySaving: false,
    adminTodayLoading: false,
    adminTodayDate: '',
    adminTodayStatus: '',
    adminTodayDetail: '',
    adminTodayTotal: 0,
    adminFilledCount: 0,
    adminUnfilledCount: 0,
    adminTomorrowDate: '',
    adminTomorrowStatus: '',
    adminTomorrowTotal: 0,
    notifications: [] as NotificationRow[],
    notificationsLoading: false,
    unreadNotificationCount: 0,
    eggStatsLoading: false,
    weekEggQuantity: 0,
    totalEggQuantity: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (options.login !== '1' && isManuallyLoggedOut()) {
      this.setData({ state: 'loggedOut' })
      return
    }
    void this.loadSession()
  },

  onShow() {
    this.syncTabBarSelection()
    if (this.data.state !== 'ready') {
      this.setTabBarHidden(true)
      return
    }
    this.setTabBarHidden(false)
    void this.loadNotifications()
    if (this.data.isAdmin) void this.loadAdminToday()
    else {
      void this.loadTodayReservation()
      void this.loadMyEggStats()
    }
  },

  onPullDownRefresh() {
    const requests = [this.loadNotifications()]
    if (this.data.isAdmin) requests.push(this.loadAdminToday())
    else requests.push(Promise.all([this.loadTodayReservation(), this.loadMyEggStats()]).then(() => undefined))
    void Promise.all(requests).finally(() => wx.stopPullDownRefresh())
  },

  async loadSession() {
    this.setData({ state: 'loading', errorMessage: '' })
    try {
      const user = await bootstrapSession()
      this.routeForUser(user)
    } catch (error) {
      if (isManuallyLoggedOut()) {
        this.setData({ state: 'loggedOut' })
        wx.showToast({
          title: error instanceof Error ? error.message : '登录失败，请稍后重试',
          icon: 'none',
        })
        return
      }
      this.setData({
        state: 'error',
        errorMessage: error instanceof Error ? error.message : '登录失败，请稍后重试',
      })
    }
  },

  loginAgain() {
    void this.loadSession()
  },

  routeForUser(user: CurrentUser) {
    if (user.memberStatus === 'draft' || user.memberStatus === 'rejected') {
      void wx.reLaunch({ url: '/pages/profile/profile' })
      return
    }
    if (user.memberStatus === 'pending') {
      void wx.reLaunch({ url: '/pages/review-status/review-status' })
      return
    }
    if (user.memberStatus === 'disabled') {
      void wx.reLaunch({ url: '/pages/disabled/disabled' })
      return
    }

    const now = new Date()
    this.setData({
      state: 'ready',
      displayName: user.realName ?? user.nickname ?? '成员',
      roleLabel: user.isAdmin ? '管理员' : '成员',
      isAdmin: user.isAdmin,
      todayDate: formatDate(now),
      todayLabel: formatTodayLabel(now),
    })
    this.setTabBarHidden(false)

    if (!user.isAdmin) {
      void this.loadTodayReservation()
      void this.loadMyEggStats()
    } else {
      void this.loadAdminToday()
    }
    void this.loadNotifications()
  },

  async loadAdminToday() {
    this.setData({ adminTodayLoading: true })
    try {
      const result = await apiRequest<AdminTodaySummaryBody>({ path: '/api/v1/admin/dashboard/today' })
      const statusLabel = result.status === 'closed' ? '今日不供餐' : result.isLocked ? '今日已截止' : '今日可继续填报'
      const detail = result.status === 'closed'
        ? '今日不会产生有效预约。'
        : result.isLocked
          ? '预约数量已锁定，以下为最终准备数量。'
          : '成员可在 09:00 前继续修改今日预约。'
      this.setData({
        adminTodayLoading: false,
        adminTodayDate: result.date,
        adminTodayStatus: statusLabel,
        adminTodayDetail: detail,
        adminTodayTotal: result.totalEggs,
        adminFilledCount: result.filledMemberCount,
        adminUnfilledCount: result.unfilledMemberCount,
        adminTomorrowDate: formatMonthDay(result.tomorrowDate),
        adminTomorrowStatus: result.tomorrowStatus === 'closed' ? '明日不供餐' : '明日需蒸',
        adminTomorrowTotal: result.tomorrowTotalEggs,
      })
    } catch (error) {
      this.setData({
        adminTodayLoading: false,
        adminTodayStatus: '今日数据暂不可用',
        adminTodayDetail: error instanceof Error ? error.message : '请下拉刷新重试',
      })
    }
  },

  async loadNotifications() {
    this.setData({ notificationsLoading: true })
    try {
      const result = await apiRequest<NotificationListBody>({ path: '/api/v1/notifications?limit=20' })
      this.setData({
        notifications: result.items.slice(0, 3).map((item) => this.toNotificationRow(item)),
        unreadNotificationCount: result.unreadCount,
      })
    } catch {
      this.setData({ notifications: [], unreadNotificationCount: 0 })
    } finally {
      this.setData({ notificationsLoading: false })
    }
  },

  toNotificationRow(item: NotificationView): NotificationRow {
    return {
      ...item,
      icon: notificationIcon(item.type),
      timeText: formatChinaMonthDayTime(item.createdAt),
    }
  },

  async loadTodayReservation() {
    const now = new Date()
    const todayDate = formatDate(now)
    this.setData({
      todayDate,
      todayLabel: formatTodayLabel(now),
      todayLoading: true,
      todayState: 'loading',
    })

    try {
      const result = await apiRequest<ReservationCalendarBody>({
        path: `/api/v1/reservations/calendar?from=${todayDate}&to=${todayDate}`,
      })
      const item = result.items[0]
      if (!item) throw new Error('今日预约信息暂不可用')
      this.applyTodayReservation(item)
    } catch (error) {
      this.setData({
        todayLoading: false,
        todayState: 'error',
        todayTitle: '今日状态读取失败',
        todayDetail: error instanceof Error ? error.message : '请稍后重试',
        todayCanEdit: false,
      })
    }
  },

  async loadMyEggStats() {
    this.setData({ eggStatsLoading: true })
    try {
      const result = await apiRequest<MyEggStatsBody>({ path: '/api/v1/dashboard/my-egg-stats' })
      this.setData({
        weekEggQuantity: result.weekQuantity,
        totalEggQuantity: result.totalQuantity,
      })
    } catch {
      this.setData({ weekEggQuantity: 0, totalEggQuantity: 0 })
    } finally {
      this.setData({ eggStatsLoading: false })
    }
  },

  applyTodayReservation(item: ReservationCalendarItem) {
    let todayState: TodayState = 'unreserved'
    let todayTitle = '今天还没有预约'
    let todayDetail = item.isLocked ? '预约已截止，可在日历中查看后续日期。' : '现在可以填写今天需要的鸡蛋数量。'

    if (item.status === 'closed') {
      todayState = 'closed'
      todayTitle = '当日不供餐'
      todayDetail = '管理员已关闭今天的供餐安排。'
    } else if (item.reservation?.status === 'cancelled') {
      todayState = 'cancelled'
      todayTitle = '预约已取消'
      todayDetail = '今天的预约已被取消，不计入有效总数。'
    } else if (item.reservation?.status === 'active' && item.reservation.quantity === 0) {
      todayState = 'zero'
      todayTitle = '明确不吃'
      todayDetail = '你今天已明确填写 0 个鸡蛋。'
    } else if (item.reservation?.status === 'active') {
      todayState = 'reserved'
      todayTitle = `已预约 ${item.reservation.quantity} 个鸡蛋`
      todayDetail = item.isLocked ? '今日预约已截止，数量不能再修改。' : '如需调整，可在今天 09:00 前修改。'
    } else if (item.isLocked) {
      todayState = 'locked'
      todayTitle = '预约已截止'
      todayDetail = '今天未填写预约，后续日期仍可继续安排。'
    } else {
      todayState = 'open'
    }

    this.setData({
      todayLoading: false,
      todayState,
      todayTitle,
      todayDetail,
      todayQuantity: item.reservation?.status === 'active' ? item.reservation.quantity : null,
      todayCanEdit: item.status === 'open' && !item.isLocked,
    })
  },

  adjustToday(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta)
    const base = this.data.todayQuantity ?? (delta > 0 ? 0 : 1)
    const quantity = Math.max(0, Math.min(5, base + delta))
    void this.saveToday(quantity)
  },

  setTodayZero() {
    void this.saveToday(0)
  },

  async saveToday(quantity: number) {
    if (!this.data.todayCanEdit || !this.data.todayDate || this.data.todaySaving) return
    this.setData({ todaySaving: true })
    try {
      const result = await apiRequest<ReservationCalendarItem>({
        path: `/api/v1/reservations/${this.data.todayDate}`,
        method: 'PUT',
        data: { quantity },
      })
      this.applyTodayReservation(result)
      void this.loadMyEggStats()
      wx.showToast({ title: '今日预约已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    } finally {
      this.setData({ todaySaving: false })
    }
  },

  openReservations() {
    void wx.switchTab({ url: '/pages/reservations/calendar/calendar' })
  },

  openActualQuantities() {
    void wx.navigateTo({ url: '/pages/admin/actual-quantities/actual-quantities' })
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar?.() as (WechatMiniprogram.Component.TrivialInstance & {
      refreshTabs?: (route?: string) => void
    }) | undefined
    tabBar?.refreshTabs?.('pages/index/index')
  },

  setTabBarHidden(hidden: boolean) {
    const tabBar = this.getTabBar?.() as (WechatMiniprogram.Component.TrivialInstance & {
      setHidden?: (value: boolean) => void
    }) | undefined
    tabBar?.setHidden?.(hidden)
  },

  openNotifications() {
    void wx.navigateTo({ url: '/pages/notifications/notifications' })
  },

  async openNotification(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string
    const item = this.data.notifications.find((candidate) => candidate.id === id)
    if (!item) return

    void wx.showModal({
      title: item.title,
      content: `${item.content}\n\n${item.timeText}`,
      showCancel: false,
      confirmText: '知道了',
    })

    if (item.isRead) return

    this.setData({
      notifications: this.data.notifications.map((candidate) => (
        candidate.id === id ? { ...candidate, isRead: true } : candidate
      )),
      unreadNotificationCount: Math.max(0, this.data.unreadNotificationCount - 1),
    })

    try {
      await apiRequest({ path: `/api/v1/notifications/${id}/read`, method: 'POST', data: {} })
    } catch {
      this.setData({
        notifications: this.data.notifications.map((candidate) => (
          candidate.id === id ? { ...candidate, isRead: false } : candidate
        )),
        unreadNotificationCount: this.data.unreadNotificationCount + 1,
      })
      wx.showToast({ title: '已读状态同步失败', icon: 'none' })
    }
  },
})
