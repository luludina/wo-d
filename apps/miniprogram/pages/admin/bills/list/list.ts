import type { AdminBillRunListBody, AdminBillRunSummary } from '@egg-booking/contracts'
import { apiRequest } from '../../../../services/api'
import { formatChinaDate } from '../../../../utils/date-time'

interface BillRunRow extends AdminBillRunSummary {
  periodText: string
  amountText: string
  generatedText: string
}

function formatShortDate(value: string): string {
  const [, month, day] = value.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function formatAmount(amountFen: number): string {
  return Number.isInteger(amountFen / 100) ? String(amountFen / 100) : (amountFen / 100).toFixed(2)
}

Page({
  data: {
    loading: true,
    items: [] as BillRunRow[],
  },

  onLoad() {
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
        items: result.items.map((item) => ({
          ...item,
          periodText: `${formatShortDate(item.weekStart)} - ${formatShortDate(item.weekEnd)}`,
          amountText: formatAmount(item.totalAmountFen),
          generatedText: `${formatChinaDate(item.generatedAt)}生成`,
        })),
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '汇总加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const weekStart = event.currentTarget.dataset.weekStart as string
    if (weekStart) void wx.navigateTo({ url: `/pages/admin/bills/detail/detail?weekStart=${weekStart}` })
  },
})
