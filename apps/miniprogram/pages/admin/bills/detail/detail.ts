import type {
  AdminBillMemberItem,
  AdminBillRunDetail,
  AdminBillRunSummary,
  BillSummary,
} from '@egg-booking/contracts'
import { apiRequest, resolveApiUrl } from '../../../../services/api'
import { createShareAppMessage } from '../../../../services/share'

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
  onShareAppMessage: createShareAppMessage,

  data: {
    loading: true,
    copying: false,
    pushing: false,
    errorMessage: '',
    periodText: '',
    memberCount: 0,
    totalQuantity: 0,
    amountText: '',
    isDraft: false,
    statusText: '',
    items: [] as MemberRow[],
    rawBill: null as AdminBillRunDetail | null,
    adjustmentOpen: false,
    adjustmentSaving: false,
    adjustmentBillId: '',
    adjustmentMemberName: '',
    adjustmentCurrentQuantity: 0,
    adjustmentQuantity: 0,
    adjustmentReason: '',
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
        isDraft: bill.status === 'draft',
        statusText: bill.status === 'draft' ? '待推送' : '已推送',
        items: bill.items.map((item) => ({
          ...item,
          avatarDisplayUrl: resolveApiUrl(item.avatarUrl),
          avatarText: item.realName.slice(0, 1),
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
      (item) => `${item.realName}：${formatAmount(item.totalAmountFen)}元`,
    )
    const total = `合计：${formatAmount(bill.totalAmountFen)}元`
    const content = [title, '', ...memberLines, '', total].join('\n')
    this.setData({ copying: true })
    wx.setClipboardData({
      data: content,
      success: () => wx.showToast({ title: '清单已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
      complete: () => this.setData({ copying: false }),
    })
  },

  openAdjustment(event: WechatMiniprogram.TouchEvent) {
    const billId = event.currentTarget.dataset.billId as string
    const item = this.data.items.find((candidate) => candidate.billId === billId)
    if (!item) return
    this.setData({
      adjustmentOpen: true,
      adjustmentBillId: item.billId,
      adjustmentMemberName: item.realName,
      adjustmentCurrentQuantity: item.totalQuantity,
      adjustmentQuantity: item.totalQuantity,
      adjustmentReason: '',
    })
  },

  async publishBill() {
    const bill = this.data.rawBill
    if (!bill || !this.data.isDraft || this.data.pushing) return
    const confirmation = await wx.showModal({
      title: '确认推送本周账单？',
      content: '将按当前调整结果生成个人账单并通知成员，推送后本周不会再次定时推送。',
      confirmText: '确认推送',
      confirmColor: '#2f6b49',
    })
    if (!confirmation.confirm) return

    this.setData({ pushing: true })
    try {
      await apiRequest<AdminBillRunSummary>({
        path: `/api/v1/admin/bills/${bill.weekStart}/publish`,
        method: 'POST',
      })
      await this.loadBill(bill.weekStart)
      wx.showToast({ title: '账单已推送', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '账单推送失败', icon: 'none' })
    } finally {
      this.setData({ pushing: false })
    }
  },

  closeAdjustment() {
    if (this.data.adjustmentSaving) return
    this.setData({ adjustmentOpen: false })
  },

  adjustQuantity(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta)
    this.setData({
      adjustmentQuantity: Math.max(0, Math.min(100, this.data.adjustmentQuantity + delta)),
    })
  },

  inputAdjustmentQuantity(event: WechatMiniprogram.Input) {
    const value = Number(event.detail.value)
    if (!Number.isInteger(value)) return
    this.setData({ adjustmentQuantity: Math.max(0, Math.min(100, value)) })
  },

  inputAdjustmentReason(event: WechatMiniprogram.Input) {
    this.setData({ adjustmentReason: event.detail.value })
  },

  async submitAdjustment() {
    const reason = this.data.adjustmentReason.trim()
    if (!reason) {
      wx.showToast({ title: '请填写调整原因', icon: 'none' })
      return
    }
    if (this.data.adjustmentQuantity === this.data.adjustmentCurrentQuantity) {
      wx.showToast({ title: '请先修改鸡蛋数量', icon: 'none' })
      return
    }
    if (!this.data.adjustmentBillId || this.data.adjustmentSaving) return

    this.setData({ adjustmentSaving: true })
    try {
      await apiRequest<BillSummary>({
        path: `/api/v1/admin/bills/${this.data.adjustmentBillId}/adjustment`,
        method: 'PUT',
        data: { totalQuantity: this.data.adjustmentQuantity, reason },
      })
      this.setData({ adjustmentOpen: false })
      const weekStart = this.data.rawBill?.weekStart
      if (weekStart) await this.loadBill(weekStart)
      wx.showToast({ title: '账单已调整', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '账单调整失败', icon: 'none' })
    } finally {
      this.setData({ adjustmentSaving: false })
    }
  },

  noop() {},
})
