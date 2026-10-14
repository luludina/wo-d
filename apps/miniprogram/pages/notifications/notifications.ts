import type { NotificationListBody, NotificationView } from '@egg-booking/contracts'
import { apiRequest } from '../../services/api'
import { formatChinaMonthDayTime } from '../../utils/date-time'

interface NotificationRow extends NotificationView {
  icon: string
  timeText: string
}

const PAGE_SIZE = 20

function getIcon(type: string): string {
  if (type === 'bill_generated') return '单'
  if (type.startsWith('meal_day_')) return '日'
  if (type.startsWith('member_')) return '员'
  return '铃'
}

Page({
  data: {
    loading: true,
    loadingMore: false,
    items: [] as NotificationRow[],
    page: 0,
    hasMore: false,
  },

  onLoad() {
    void this.loadNotifications()
  },

  onPullDownRefresh() {
    void this.loadNotifications(true).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.hasMore) void this.loadNotifications(false)
  },

  async loadNotifications(reset = true) {
    if (this.data.loadingMore || (!reset && (this.data.loading || !this.data.hasMore))) return
    const page = reset ? 1 : this.data.page + 1
    this.setData(reset ? { loading: true } : { loadingMore: true })
    try {
      const result = await apiRequest<NotificationListBody>({
        path: `/api/v1/notifications?page=${page}&limit=${PAGE_SIZE}`,
      })
      const rows = result.items.map((item) => ({
        ...item,
        icon: getIcon(item.type),
        timeText: formatChinaMonthDayTime(item.createdAt),
      }))
      const items = reset ? rows : [...this.data.items, ...rows]
      const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()]
      this.setData({
        items: uniqueItems,
        page: result.page,
        hasMore: result.hasMore,
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '通知加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false, loadingMore: false })
    }
  },

  async openNotification(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string
    const item = this.data.items.find((candidate) => candidate.id === id)
    if (!item) return

    void wx.showModal({
      title: item.title,
      content: `${item.content}\n\n${item.timeText}`,
      showCancel: false,
      confirmText: '知道了',
    })

    if (item.isRead) return

    this.setData({
      items: this.data.items.map((candidate) => (
        candidate.id === id ? { ...candidate, isRead: true } : candidate
      )),
    })

    try {
      await apiRequest({ path: `/api/v1/notifications/${id}/read`, method: 'POST', data: {} })
    } catch {
      this.setData({
        items: this.data.items.map((candidate) => (
          candidate.id === id ? { ...candidate, isRead: false } : candidate
        )),
      })
      wx.showToast({ title: '已读状态同步失败', icon: 'none' })
    }
  },
})
