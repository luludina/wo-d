import type { AdminBillMemberItem, AdminBillRunDetail } from '@egg-booking/contracts'
import { apiRequest, resolveApiUrl } from '../../../../services/api'

interface MemberRow extends AdminBillMemberItem {
  avatarDisplayUrl: string
  avatarText: string
  amountText: string
}

function formatAmount(amountFen: number): string {
  return Number.isInteger(amountFen / 100) ? String(amountFen / 100) : (amountFen / 100).toFixed(2)
}

function formatShortDate(value: string): string {
  const [, month, day] = value.split('-')
  return `${Number(month)}月${Number(day)}日`
}

Page({
  data: {
    loading: true,
    copying: false,
    errorMessage: '',
    periodText: '',
    memberCount: 0,
    totalQuantity: 0,
    amountText: '',
    items: [] as MemberRow[],
    rawBill: null as AdminBillRunDetail | null,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (!options.weekStart) {
      this.setData({ loading: false, errorMessage: '账单周期无效' })
      return
    }
    void this.loadBill(options.weekStart)
  },

  async loadBill(weekStart: string) {
    try {
      const bill = await apiRequest<AdminBillRunDetail>({ path: `/api/v1/admin/bills/${weekStart}` })
      this.setData({
        periodText: `${formatShortDate(bill.weekStart)} - ${formatShortDate(bill.weekEnd)}`,
        memberCount: bill.memberCount,
        totalQuantity: bill.totalQuantity,
        amountText: formatAmount(bill.totalAmountFen),
        items: bill.items.map((item) => ({
          ...item,
          avatarDisplayUrl: resolveApiUrl(item.avatarUrl),
          avatarText: item.nickname.slice(0, 1),
          amountText: formatAmount(item.totalAmountFen),
        })),
        rawBill: bill,
      })
    } catch (error) {
      this.setData({ errorMessage: error instanceof Error ? error.message : '账单汇总加载失败' })
    } finally {
      this.setData({ loading: false })
    }
  },

  copyCollectionList() {
    const bill = this.data.rawBill
    if (!bill || this.data.copying) return
    const title = `${formatShortDate(bill.weekStart)}-${formatShortDate(bill.weekEnd)}鸡蛋账单`
    const memberLines = bill.items.map(
      (item) => `${item.nickname}：${item.totalQuantity}个，${formatAmount(item.totalAmountFen)}元`,
    )
    const total = `合计：${bill.totalQuantity}个，${formatAmount(bill.totalAmountFen)}元`
    const content = [title, '', ...memberLines, '', total].join('\n')
    this.setData({ copying: true })
    wx.setClipboardData({
      data: content,
      success: () => wx.showToast({ title: '清单已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
      complete: () => this.setData({ copying: false }),
    })
  },
})
