import type { BillDetail } from '@egg-booking/contracts'
import { apiRequest } from '../../../services/api'
import { createShareAppMessage } from '../../../services/share'

function formatAmount(amountFen: number): string {
  return Number.isInteger(amountFen / 100) ? String(amountFen / 100) : (amountFen / 100).toFixed(2)
}

Page({
  onShareAppMessage: createShareAppMessage,

  data: {
    loading: true,
    errorMessage: '',
    periodText: '',
    amountText: '',
    isAdjusted: false,
    adjustmentReason: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    if (!options.id) {
      this.setData({ loading: false, errorMessage: '账单编号无效' })
      return
    }
    void this.loadBill(options.id)
  },

  async loadBill(id: string) {
    try {
      const bill = await apiRequest<BillDetail>({ path: `/api/v1/bills/${id}` })
      this.setData({
        periodText: `${bill.weekStart} 至 ${bill.weekEnd}`,
        amountText: formatAmount(bill.totalAmountFen),
        isAdjusted: bill.isAdjusted,
        adjustmentReason: bill.adjustmentReason ?? '',
      })
    } catch (error) {
      this.setData({ errorMessage: error instanceof Error ? error.message : '账单加载失败' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
