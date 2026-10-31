import type { AdminBillRunListBody, AdminBillRunSummary } from '@egg-booking/contracts'
import { apiRequest } from '../../../../services/api'
import { formatChinaDate } from '../../../../utils/date-time'
import { createShareAppMessage } from '../../../../services/share'

interface BillRunRow extends AdminBillRunSummary {
  periodText: string
  amountText: string
  generatedText: string
  statusText: string
}

function formatShortDate(value: string): string {
  const [, month, day] = value.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function formatAmount(amountFen: number): string {
  return Number.isInteger(amountFen / 100) ? String(amountFen / 100) : (amountFen / 100).toFixed(2)
}

Page({
  onShareAppMessage: createShareAppMessage,

  data: {
    loading: true,
    generating: false,
    canGenerateCurrentWeek: false,
    currentPeriodText: '',
    items: [] as BillRunRow[],
  },

  onShow() {
    void this.loadBills()
  },

  onPullDownRefresh() {
    void this.loadBills().finally(() => wx.stopPullDownRefresh())
  },

  async loadBills() {
    this.setData({ loading: true })
    try {
      const result = await apiRequest<AdminBillRunListBody>({ path: '/api/v1/admin/bills?limit=100' })
      this.setData({
        canGenerateCurrentWeek: result.canGenerateCurrentWeek,
        currentPeriodText: `${formatShortDate(result.currentWeekStart)}起`,
        items: result.items.map((item) => ({
          ...item,
          periodText: `${formatShortDate(item.weekStart)} - ${formatShortDate(item.weekEnd)}`,
          amountText: formatAmount(item.totalAmountFen),
          generatedText: `${formatChinaDate(item.generatedAt)}生成`,
          statusText: item.status === 'draft' ? '待推送' : '已推送',
        })),
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '汇总加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async generateCurrentWeekBill() {
    if (!this.data.canGenerateCurrentWeek || this.data.generating) return
    this.setData({ generating: true })
    try {
      await apiRequest<AdminBillRunSummary>({
        path: '/api/v1/admin/bills/current/generate',
        method: 'POST',
      })
      await this.loadBills()
      wx.showToast({ title: '本周账单已生成', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '账单生成失败', icon: 'none' })
    } finally {
      this.setData({ generating: false })
    }
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const weekStart = event.currentTarget.dataset.weekStart as string
    if (weekStart) void wx.navigateTo({ url: `/pages/admin/bills/detail/detail?weekStart=${weekStart}` })
  },
})
