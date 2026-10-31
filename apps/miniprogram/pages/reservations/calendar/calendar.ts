import type {
  ReservationBatchResult,
  ReservationCalendarBody,
  ReservationCalendarItem,
  ReservationDayDetailsBody,
  ReservationDayMember,
  ReservationDaySubmission,
} from '@egg-booking/contracts'
import { ApiError, apiRequest, resolveApiUrl } from '../../../services/api'
import { createShareAppMessage } from '../../../services/share'
import { getCachedUser } from '../../../services/auth'

type DayState =
  | 'empty'
  | 'unfilled'
  | 'reserved'
  | 'zero'
  | 'closed'
  | 'locked'
  | 'cancelled'
  | 'unavailable'

interface ReservationDayView extends ReservationCalendarItem {
  weekday: string
  quantity: number | null
  stateText: string
  stateKind: DayState
  canEdit: boolean
}

interface CalendarCell {
  key: string
  date: string
  dayNumber: number
  relation: 'previous' | 'current' | 'next'
  inCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  canNavigate: boolean
  stateKind: DayState
  quantity: number | null
}

interface DaySubmissionView extends ReservationDaySubmission {
  avatarUrl: string
  avatarFallback: string
}

interface DayMemberView extends ReservationDayMember {
  avatarUrl: string
  avatarFallback: string
}

const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function rollingMonthEnd(date: Date): Date {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate()
  return new Date(date.getFullYear(), date.getMonth() + 1, Math.min(date.getDate(), lastDay))
}

function monthStart(year: number, month: number): Date {
  return new Date(year, month, 1)
}

function monthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 0)
}

function enumerateDates(from: Date, to: Date): string[] {
  const dates: string[] = []
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(formatDate(cursor))
  return dates
}

Page({
  onShareAppMessage: createShareAppMessage,

  data: {
    initialized: false,
    isAdmin: false,
    currentUserId: '',
    loading: true,
    today: '',
    bookingEnd: '',
    bookingEndLabel: '',
    currentYear: 0,
    currentMonth: 0,
    currentMonthLabel: '',
    maxYear: 0,
    maxMonth: 0,
    canNavigateNext: true,
    selectedDate: '',
    selectedDateLabel: '',
    items: [] as ReservationDayView[],
    calendarCells: [] as CalendarCell[],

    dayDetailsLoading: false,
    dayDetailsError: '',
    dayDetailsTotalEggs: 0,
    dayDetailsFilledCount: 0,
    dayDetailsUnsubmittedCount: 0,
    canAdjustActual: false,
    dayDetailItems: [] as DaySubmissionView[],
    dayUnsubmittedItems: [] as DayMemberView[],

    dayPanelOpen: false,
    selectedDay: null as ReservationDayView | null,
    selectedDayLabel: '',
    selectedDayReadonlyText: '',
    originalQuantity: null as number | null,
    draftQuantity: null as number | null,
    dayCanSubmit: false,
    daySaving: false,

    settingsOpen: false,
    batchMode: 'week' as 'week' | 'month',
    batchQuantity: 1,
    batchSaving: false,
  },

  onLoad() {
    const now = new Date()
    const end = rollingMonthEnd(now)
    const maxMonthDate = addMonths(monthStart(now.getFullYear(), now.getMonth()), 1)
    this.setData({
      initialized: true,
      isAdmin: getCachedUser()?.isAdmin === true,
      currentUserId: getCachedUser()?.id ?? '',
      today: formatDate(now),
      bookingEnd: formatDate(end),
      bookingEndLabel: `${end.getMonth() + 1}月${end.getDate()}日`,
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth(),
      currentMonthLabel: `${now.getFullYear()}年${now.getMonth() + 1}月`,
      maxYear: maxMonthDate.getFullYear(),
      maxMonth: maxMonthDate.getMonth(),
      selectedDate: formatDate(now),
      selectedDateLabel: `${now.getMonth() + 1}月${now.getDate()}日`,
    })
  },

  onShow() {
    this.syncTabBarSelection()
    this.setTabBarHidden(false)
    if (this.data.initialized) void this.loadCalendar()
  },

  onPullDownRefresh() {
    void this.loadCalendar().finally(() => wx.stopPullDownRefresh())
  },

  async loadCalendar() {
    const from = formatDate(monthStart(this.data.currentYear, this.data.currentMonth))
    const to = formatDate(monthEnd(this.data.currentYear, this.data.currentMonth))
    this.setData({ loading: true })
    try {
      const result = await apiRequest<ReservationCalendarBody>({
        path: `/api/v1/reservations/calendar?from=${from}&to=${to}`,
      })
      const items = result.items.map((item) => this.toView(item))
      const selectedDay = items.find((item) => item.date === this.data.selectedDate) ?? null
      this.setData({
        items,
        calendarCells: this.buildCalendarCells(items),
        selectedDay,
        selectedDayLabel: selectedDay
          ? `${selectedDay.date.slice(5).replace('-', '月')}日 · ${selectedDay.weekday}`
          : '',
      })
      void this.loadDayDetails(this.data.selectedDate)
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '预约日历加载失败', icon: 'none' })
      this.setData({ items: [], calendarCells: this.buildCalendarCells([]) })
    } finally {
      this.setData({ loading: false })
    }
  },

  toView(item: ReservationCalendarItem): ReservationDayView {
    const active = item.reservation?.status === 'active'
    const quantity = active ? item.reservation!.quantity : null
    const historicalEmpty = item.date < this.data.today && !item.reservation && item.source === 'default'
    const canEdit = item.status === 'open' && !item.isLocked && item.date <= this.data.bookingEnd
    let stateKind: DayState = 'unfilled'
    let stateText = '未填写'

    if (historicalEmpty) {
      stateKind = 'empty'
      stateText = '无记录'
    } else if (item.status === 'closed') {
      stateKind = 'closed'
      stateText = '当日供餐已关闭'
    } else if (item.reservation?.status === 'cancelled') {
      stateKind = 'cancelled'
      stateText = '预约已取消'
    } else if (active && quantity === 0) {
      stateKind = 'zero'
      stateText = '已填写 0 个'
    } else if (active) {
      stateKind = 'reserved'
      stateText = `已预约 ${quantity} 个鸡蛋`
    } else if (item.isLocked) {
      stateKind = 'locked'
      stateText = item.date === this.data.today ? '今日预约已截止' : '历史日期不可修改'
    } else if (item.date > this.data.bookingEnd) {
      stateKind = 'unavailable'
      stateText = `暂未开放预约，可预约至 ${this.data.bookingEndLabel}`
    }

    return {
      ...item,
      weekday: weekdayLabels[parseLocalDate(item.date).getDay()] ?? '',
      quantity,
      stateText,
      stateKind,
      canEdit,
    }
  },

  buildCalendarCells(items: ReservationDayView[]): CalendarCell[] {
    const first = monthStart(this.data.currentYear, this.data.currentMonth)
    const mondayOffset = (first.getDay() + 6) % 7
    const gridStart = addDays(first, -mondayOffset)
    const itemMap = new Map(items.map((item) => [item.date, item]))
    const maxMonthKey = this.data.maxYear * 12 + this.data.maxMonth
    const currentMonthKey = this.data.currentYear * 12 + this.data.currentMonth

    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(gridStart, index)
      const dateValue = formatDate(date)
      const dateMonthKey = date.getFullYear() * 12 + date.getMonth()
      const relation = dateMonthKey < currentMonthKey ? 'previous' : dateMonthKey > currentMonthKey ? 'next' : 'current'
      const item = itemMap.get(dateValue)
      return {
        key: `${dateValue}-${index}`,
        date: dateValue,
        dayNumber: date.getDate(),
        relation,
        inCurrentMonth: relation === 'current',
        isToday: dateValue === this.data.today,
        isSelected: dateValue === this.data.selectedDate,
        canNavigate: relation !== 'next' || dateMonthKey <= maxMonthKey,
        stateKind: item?.stateKind ?? 'empty',
        quantity: item?.quantity ?? null,
      }
    })
  },

  previousMonth() {
    void this.changeMonth(-1)
  },

  nextMonth() {
    if (!this.data.canNavigateNext) return
    void this.changeMonth(1)
  },

  async changeMonth(offset: number) {
    const target = addMonths(monthStart(this.data.currentYear, this.data.currentMonth), offset)
    const targetKey = target.getFullYear() * 12 + target.getMonth()
    const maxKey = this.data.maxYear * 12 + this.data.maxMonth
    if (targetKey > maxKey) return
    this.setData({
      currentYear: target.getFullYear(),
      currentMonth: target.getMonth(),
      currentMonthLabel: `${target.getFullYear()}年${target.getMonth() + 1}月`,
      canNavigateNext: targetKey < maxKey,
      selectedDate: formatDate(target),
      selectedDateLabel: `${target.getMonth() + 1}月${target.getDate()}日`,
      dayPanelOpen: false,
      selectedDay: null,
    })
    await this.loadCalendar()
  },

  selectCalendarDay(event: WechatMiniprogram.TouchEvent) {
    const date = event.currentTarget.dataset.date as string
    const relation = event.currentTarget.dataset.relation as CalendarCell['relation']
    const rawCanNavigate = event.currentTarget.dataset.canNavigate
    const canNavigate = rawCanNavigate !== false && rawCanNavigate !== 'false'
    if (relation === 'previous') {
      void this.changeMonth(-1)
      return
    }
    if (relation === 'next') {
      if (canNavigate) void this.changeMonth(1)
      return
    }

    const item = this.data.items.find((candidate) => candidate.date === date)
    if (!item) return
    this.setData({
      selectedDate: date,
      selectedDateLabel: `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`,
      calendarCells: this.buildCalendarCells(this.data.items).map((cell) => ({
        ...cell,
        isSelected: cell.date === date,
      })),
      selectedDay: item,
      selectedDayLabel: `${date.slice(5).replace('-', '月')}日 · ${item.weekday}`,
    })
    void this.loadDayDetails(date)
  },

  openDayPanel() {
    const item = this.data.selectedDay
    if (!item?.canEdit) return
    const originalQuantity = item.reservation?.status === 'active' ? item.reservation.quantity : null
    const draftQuantity = originalQuantity ?? 1
    this.setTabBarHidden(true)
    this.setData({
      dayPanelOpen: true,
      originalQuantity,
      draftQuantity,
        dayCanSubmit: draftQuantity !== originalQuantity,
    })
  },

  async loadDayDetails(date: string) {
    this.setData({ dayDetailsLoading: true, dayDetailsError: '' })
    try {
      const result = await apiRequest<ReservationDayDetailsBody>({
        path: `/api/v1/reservations/${date}/details`,
      })
      if (this.data.selectedDate !== date) return
      this.setData({
        dayDetailsLoading: false,
        canAdjustActual: date <= this.data.today && (result as ReservationDayDetailsBody & { billingGenerated?: boolean }).billingGenerated !== true,
        dayDetailsTotalEggs: result.totalEggs,
        dayDetailsFilledCount: result.filledMemberCount,
        dayDetailsUnsubmittedCount: result.unsubmittedMemberCount,
        dayDetailItems: result.items.map((item) => ({
          ...item,
          avatarUrl: resolveApiUrl(item.avatarUrl),
          avatarFallback: item.nickname.slice(0, 1) || '成',
        })),
        dayUnsubmittedItems: result.unsubmittedItems.map((item) => ({
          ...item,
          avatarUrl: resolveApiUrl(item.avatarUrl),
          avatarFallback: item.nickname.slice(0, 1) || '成',
        })),
      })
    } catch (error) {
      if (this.data.selectedDate !== date) return
      this.setData({
        dayDetailsLoading: false,
        dayDetailsError: error instanceof Error ? error.message : '当日上报加载失败',
        dayDetailsTotalEggs: 0,
        dayDetailsFilledCount: 0,
        dayDetailsUnsubmittedCount: 0,
        dayDetailItems: [],
        dayUnsubmittedItems: [],
      })
    }
  },

  closeDayPanel() {
    if (this.data.daySaving) return
    this.setTabBarHidden(false)
    this.setData({ dayPanelOpen: false })
  },

  setTabBarHidden(hidden: boolean) {
    const tabBar = this.getTabBar?.() as (WechatMiniprogram.Component.TrivialInstance & {
      setHidden?: (value: boolean) => void
    }) | undefined
    tabBar?.setHidden?.(hidden)
  },

  syncTabBarSelection() {
    const tabBar = this.getTabBar?.() as (WechatMiniprogram.Component.TrivialInstance & {
      refreshTabs?: (route?: string) => void
    }) | undefined
    tabBar?.refreshTabs?.('pages/reservations/calendar/calendar')
  },

  noop() {},

  adjustDraftQuantity(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta)
    const base = this.data.draftQuantity ?? (delta > 0 ? 0 : 1)
    this.updateDraftQuantity(Math.max(0, Math.min(5, base + delta)))
  },

  updateDraftQuantity(quantity: number) {
    this.setData({
      draftQuantity: quantity,
      dayCanSubmit: quantity !== this.data.originalQuantity,
    })
  },

  requestActualQuantity() {
    const date = this.data.selectedDay?.date
    if (!date) return
    wx.showModal({
      title: '申请实际数量',
      editable: true,
      placeholderText: '请输入 0～5',
      success: async (result) => {
        if (!result.confirm) return
        const quantity = Number(result.content)
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 5) {
          wx.showToast({ title: '请输入 0～5 的整数', icon: 'none' })
          return
        }
        try {
          await apiRequest({ path: `/api/v1/actual-quantities/${date}/request`, method: 'POST', data: { quantity } })
          wx.showToast({ title: '申请已提交', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : '提交失败', icon: 'none' })
        }
      },
    })
  },

  adminAdjustActualQuantity(event: WechatMiniprogram.TouchEvent) {
    const date = this.data.selectedDate
    const memberId = String(event.currentTarget.dataset.memberId ?? '')
    if (!date || !memberId) return
    wx.showModal({
      title: '调整实际数量',
      editable: true,
      placeholderText: '请输入 0～5',
      success: async (result) => {
        if (!result.confirm) return
        const quantity = Number(result.content)
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 5) {
          wx.showToast({ title: '请输入 0～5 的整数', icon: 'none' })
          return
        }
        try {
          await apiRequest({ path: `/api/v1/admin/actual-quantities/${date}/members/${memberId}`, method: 'POST', data: { quantity } })
          wx.showToast({ title: '已调整', icon: 'success' })
          void this.loadDayDetails(date)
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : '调整失败', icon: 'none' })
        }
      },
    })
  },

  async submitDay() {
    const selectedDay = this.data.selectedDay
    const quantity = this.data.draftQuantity
    if (!selectedDay?.canEdit || quantity === null || !this.data.dayCanSubmit || this.data.daySaving) return
    this.setData({ daySaving: true })
    try {
      const result = await apiRequest<ReservationCalendarItem>({
        path: `/api/v1/reservations/${selectedDay.date}`,
        method: 'PUT',
        data: { quantity },
      })
      const updated = this.toView(result)
      const items = this.data.items.map((item) => item.date === updated.date ? updated : item)
      this.setData({
        items,
        calendarCells: this.buildCalendarCells(items),
        selectedDay: updated,
        selectedDayLabel: `${updated.date.slice(5).replace('-', '月')}日 · ${updated.weekday}`,
        dayPanelOpen: false,
      })
      this.setTabBarHidden(false)
      void this.loadDayDetails(updated.date)
      wx.showToast({ title: '预约已更新', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '预约保存失败', icon: 'none' })
      if (error instanceof ApiError && ['RESERVATION_LOCKED', 'MEAL_DAY_CLOSED', 'RESERVATION_WINDOW_INVALID'].includes(error.code)) {
        this.setTabBarHidden(false)
        this.setData({ dayPanelOpen: false })
        void this.loadCalendar()
      }
    } finally {
      this.setData({ daySaving: false })
    }
  },

  openSettings() {
    this.setTabBarHidden(true)
    this.setData({ settingsOpen: true, batchMode: 'week', batchQuantity: 1 })
  },

  closeSettings() {
    if (this.data.batchSaving) return
    this.setTabBarHidden(false)
    this.setData({ settingsOpen: false })
  },

  selectBatchMode(event: WechatMiniprogram.TouchEvent) {
    this.setData({ batchMode: event.currentTarget.dataset.mode as 'week' | 'month' })
  },

  adjustBatchQuantity(event: WechatMiniprogram.TouchEvent) {
    const delta = Number(event.currentTarget.dataset.delta)
    this.setData({ batchQuantity: Math.max(0, Math.min(5, this.data.batchQuantity + delta)) })
  },

  async submitBatch() {
    if (this.data.batchSaving) return
    const start = parseLocalDate(this.data.today)
    const end = this.data.batchMode === 'week' ? addDays(start, 6) : parseLocalDate(this.data.bookingEnd)
    const items = enumerateDates(start, end).map((date) => ({ date, quantity: this.data.batchQuantity }))
    this.setData({ batchSaving: true })
    try {
      const result = await apiRequest<ReservationBatchResult>({
        path: '/api/v1/reservations/batch',
        method: 'POST',
        data: { items },
      })
      const skipped = new Set([...result.skippedClosedDates, ...result.skippedLockedDates]).size
      this.setData({ settingsOpen: false })
      this.setTabBarHidden(false)
      await this.loadCalendar()
      wx.showToast({ title: `已填充${result.applied.length}天，跳过${skipped}天`, icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '批量填充失败', icon: 'none' })
    } finally {
      this.setData({ batchSaving: false })
    }
  },
})
