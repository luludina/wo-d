import type { BillListBody, BillSummary } from '@egg-booking/contracts'
import { apiRequest } from '../../../services/api'
import { formatChinaDate } from '../../../utils/date-time'
import { createShareAppMessage } from '../../../services/share'

interface BillRow extends BillSummary {
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
  onShareAppMessage: createShareAppMessage,

  data: {
    loading: true,
    items: [] as BillRow[],
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
      const result = await apiRequest<BillListBody>({ path: '/api/v1/bills?limit=100' })
      this.setData({
        items: result.items.map((item) => ({
          ...item,
          periodText: `${formatShortDate(item.weekStart)} - ${formatShortDate(item.weekEnd)}`,
          amountText: formatAmount(item.totalAmountFen),
          generatedText: `${formatChinaDate(item.generatedAt)}生成`,
        })),
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '账单加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  openBill(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string
    if (id) void wx.navigateTo({ url: `/pages/bills/detail/detail?id=${id}` })
  },
})
