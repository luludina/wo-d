import type { BillDetail, BillLineItem } from '@egg-booking/contracts'
import { apiRequest } from '../../../services/api'

interface DetailLine extends BillLineItem {
  dateText: string
  weekdayText: string
}

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatAmount(amountFen: number): string {
  return Number.isInteger(amountFen / 100) ? String(amountFen / 100) : (amountFen / 100).toFixed(2)
}

function toLine(item: BillLineItem): DetailLine {
  const [year, month, day] = item.date.split('-').map(Number)
  return {
    ...item,
    dateText: `${month}月${day}日`,
    weekdayText: weekdays[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]!,
  }
}

Page({
  data: {
    loading: true,
    errorMessage: '',
    periodText: '',
    totalQuantity: 0,
    amountText: '',
    unitPriceText: '',
    items: [] as DetailLine[],
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
        totalQuantity: bill.totalQuantity,
        amountText: formatAmount(bill.totalAmountFen),
        unitPriceText: formatAmount(bill.unitPriceFen),
        items: bill.items.map(toLine),
      })
    } catch (error) {
      this.setData({ errorMessage: error instanceof Error ? error.message : '账单加载失败' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
