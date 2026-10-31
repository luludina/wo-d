import type { LeaderboardBody, LeaderboardMember, LeaderboardPeriod } from '@egg-booking/contracts'
import { apiRequest, resolveApiUrl } from '../../services/api'
import { createShareAppMessage } from '../../services/share'

interface LeaderboardRow extends LeaderboardMember {
  avatarSrc: string
  initial: string
  rankText: string
}

interface PodiumRow extends LeaderboardRow {
  position: number
  medalIcon: string
}

interface PeriodOption {
  value: LeaderboardPeriod
  label: string
}

const periodOptions: PeriodOption[] = [
  { value: 'week', label: '本周榜' },
  { value: 'month', label: '本月榜' },
  { value: 'year', label: '年度榜' },
]

let requestSerial = 0

function formatMonthDay(value: string): string {
  const [, month, day] = value.split('-').map(Number)
  return `${month}月${day}日`
}

function formatRange(result: LeaderboardBody): string {
  if (result.period === 'year') {
    return `${result.periodStart.slice(0, 4)}年1月1日 - ${formatMonthDay(result.throughDate)}`
  }
  return `${formatMonthDay(result.periodStart)} - ${formatMonthDay(result.periodEnd)} · 截至今日`
}

function medalIcon(rank: number | null): string {
  if (rank === 1) return '/assets/icons/leaderboard/gold.svg'
  if (rank === 2) return '/assets/icons/leaderboard/silver.svg'
  return '/assets/icons/leaderboard/bronze.svg'
}

function presentMember(item: LeaderboardMember): LeaderboardRow {
  return {
    ...item,
    avatarSrc: resolveApiUrl(item.avatarUrl),
    initial: item.nickname.slice(0, 1) || '员',
    rankText: item.rank === null ? '—' : String(item.rank),
  }
}

Page({
  onShareAppMessage: createShareAppMessage,

  data: {
    periodOptions,
    activePeriod: 'week' as LeaderboardPeriod,
    loading: true,
    errorMessage: '',
    hasLoaded: false,
    rangeText: '',
    myRankText: '—',
    myQuantity: 0,
    totalQuantity: 0,
    items: [] as LeaderboardRow[],
    podium: [] as PodiumRow[],
  },

  onShow() {
    this.syncTabBarSelection()
    void this.loadLeaderboard()
  },

  onUnload() {
    requestSerial += 1
  },

  onPullDownRefresh() {
    void this.loadLeaderboard().finally(() => wx.stopPullDownRefresh())
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar?.() as (WechatMiniprogram.Component.TrivialInstance & {
      refreshTabs?: (route?: string) => void
    }) | undefined
    tabBar?.refreshTabs?.('pages/leaderboard/leaderboard')
  },

  selectPeriod(event: WechatMiniprogram.TouchEvent) {
    const period = event.currentTarget.dataset.period as LeaderboardPeriod
    if (!period || period === this.data.activePeriod) return
    this.setData({ activePeriod: period })
    void this.loadLeaderboard()
  },

  retry() {
    void this.loadLeaderboard()
  },

  async loadLeaderboard() {
    const serial = ++requestSerial
    this.setData({ loading: true, errorMessage: '' })
    try {
      const result = await apiRequest<LeaderboardBody>({
        path: `/api/v1/dashboard/leaderboard?period=${this.data.activePeriod}`,
      })
      if (serial !== requestSerial) return
      const items = result.items.map(presentMember)
      const podium = items
        .filter((item) => item.quantity > 0)
        .slice(0, 3)
        .map((item, index) => ({
          ...item,
          position: index + 1,
          medalIcon: medalIcon(item.rank),
        }))
      this.setData({
        hasLoaded: true,
        rangeText: formatRange(result),
        myRankText: result.myRank === null ? '—' : String(result.myRank),
        myQuantity: result.myQuantity,
        totalQuantity: result.totalQuantity,
        items,
        podium,
      })
    } catch (error) {
      if (serial !== requestSerial) return
      this.setData({
        hasLoaded: true,
        errorMessage: error instanceof Error ? error.message : '排行榜加载失败',
      })
    } finally {
      if (serial === requestSerial) this.setData({ loading: false })
    }
  },
})
