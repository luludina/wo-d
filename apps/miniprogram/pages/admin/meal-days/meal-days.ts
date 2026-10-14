import type {
  MealDayBatchPreview,
  MealDayItem,
  MealDayListBody,
  MealDayStatus,
} from '@egg-booking/contracts'
import { apiRequest } from '../../../services/api'

interface MealDayView extends MealDayItem {
  weekday: string
  statusLabel: string
  sourceLabel: string
}

interface CalendarCell {
  key: string
  date: string
  dayNumber: number
  relation: 'previous' | 'current' | 'next'
  inCurrentMonth: boolean
  isToday: boolean
  isRangeStart: boolean
  isRangeEnd: boolean
  isInRange: boolean
  canSelect: boolean
  status: MealDayStatus | ''
  source: MealDayItem['source'] | ''
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

function monthStart(year: number, month: number): Date {
  return new Date(year, month, 1)
}

function monthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 0)
}

function rollingMonthEnd(date: Date): Date {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate()
  return new Date(date.getFullYear(), date.getMonth() + 1, Math.min(date.getDate(), lastDay))
}

function formatShortDate(value: string): string {
  if (!value) return '请选择'
  const date = parseLocalDate(value)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function createIdempotencyKey(): string {
  return `meal-day-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

Page({
  data: {
    initialized: false,
    today: '',
    bookingEnd: '',
    from: '',
    to: '',
    fromLabel: '',
    toLabel: '',
    reason: '',

    currentYear: 0,
    currentMonth: 0,
    currentMonthLabel: '',
    maxYear: 0,
    maxMonth: 0,
    canNavigateNext: true,
    items: [] as MealDayView[],
    calendarCells: [] as CalendarCell[],
    loading: true,

    rangeLoading: false,
    rangeComplete: true,
    rangeDayCount: 1,
    rangeOpenCount: 0,
    rangeClosedCount: 0,
    rangeSummaryText: '正在读取日期状态...',
    singleStatusText: '',
    singleSourceText: '',
    singleReasonText: '',
    canOpen: true,
    canClose: true,

    applying: false,
    pendingAction: '' as MealDayStatus | '',
    confirmOpen: false,
    confirming: false,
    pendingPreview: null as MealDayBatchPreview | null,
  },

  onLoad() {
    const now = new Date()
    const tomorrow = addDays(now, 1)
    const end = rollingMonthEnd(now)
    const initialMonth = monthStart(tomorrow.getFullYear(), tomorrow.getMonth())
    const initialDate = formatDate(tomorrow)
    this.setData({
      initialized: true,
      today: formatDate(now),
      bookingEnd: formatDate(end),
      from: initialDate,
      to: initialDate,
      fromLabel: formatShortDate(initialDate),
      toLabel: formatShortDate(initialDate),
      currentYear: initialMonth.getFullYear(),
      currentMonth: initialMonth.getMonth(),
      currentMonthLabel: `${initialMonth.getFullYear()}年${initialMonth.getMonth() + 1}月`,
      maxYear: end.getFullYear(),
      maxMonth: end.getMonth(),
      canNavigateNext: initialMonth.getFullYear() * 12 + initialMonth.getMonth() < end.getFullYear() * 12 + end.getMonth(),
    })
    this.updateActionAvailability()
  },

  onShow() {
    this.syncTabBarSelection()
    this.setTabBarHidden(false)
    if (this.data.initialized) void this.refreshPage()
  },

  onPullDownRefresh() {
    void this.refreshPage().finally(() => wx.stopPullDownRefresh())
  },

  async refreshPage() {
    await Promise.all([this.loadCalendar(), this.loadRangeSummary()])
  },

  async loadCalendar() {
    const requestedYear = this.data.currentYear
    const requestedMonth = this.data.currentMonth
    const from = formatDate(monthStart(requestedYear, requestedMonth))
    const to = formatDate(monthEnd(requestedYear, requestedMonth))
    this.setData({ loading: true })
    try {
      const result = await apiRequest<MealDayListBody>({
        path: `/api/v1/admin/meal-days?from=${from}&to=${to}`,
      })
      if (requestedYear !== this.data.currentYear || requestedMonth !== this.data.currentMonth) return
      const items = result.items.map((item) => this.toView(item))
      this.setData({ items, calendarCells: this.buildCalendarCells(items) })
    } catch (error) {
      if (requestedYear !== this.data.currentYear || requestedMonth !== this.data.currentMonth) return
      wx.showToast({ title: error instanceof Error ? error.message : '供餐日加载失败', icon: 'none' })
      this.setData({ items: [], calendarCells: this.buildCalendarCells([]) })
    } finally {
      if (requestedYear === this.data.currentYear && requestedMonth === this.data.currentMonth) {
        this.setData({ loading: false })
      }
    }
  },

  async loadRangeSummary() {
    if (!this.data.from || !this.data.to) {
      this.setData({
        rangeLoading: false,
        rangeComplete: false,
        rangeDayCount: 0,
        rangeOpenCount: 0,
        rangeClosedCount: 0,
        rangeSummaryText: '请选择结束日期',
        singleStatusText: '',
        singleSourceText: '',
        singleReasonText: '',
      })
      this.updateActionAvailability()
      return
    }

    const requestedFrom = this.data.from
    const requestedTo = this.data.to
    this.setData({ rangeLoading: true, rangeSummaryText: '正在读取日期状态...' })
    try {
      const result = await apiRequest<MealDayListBody>({
        path: `/api/v1/admin/meal-days?from=${requestedFrom}&to=${requestedTo}`,
      })
      if (requestedFrom !== this.data.from || requestedTo !== this.data.to) return
      const views = result.items.map((item) => this.toView(item))
      const openCount = views.filter((item) => item.status === 'open').length
      const closedCount = views.length - openCount
      const single = views.length === 1 ? views[0]! : null
      this.setData({
        rangeComplete: true,
        rangeDayCount: views.length,
        rangeOpenCount: openCount,
        rangeClosedCount: closedCount,
        rangeSummaryText: `已选 ${views.length} 天 · 当前开放 ${openCount} 天 · 当前关闭 ${closedCount} 天`,
        singleStatusText: single?.statusLabel ?? '',
        singleSourceText: single?.sourceLabel ?? '',
        singleReasonText: single?.reason ?? '',
      })
    } catch (error) {
      if (requestedFrom !== this.data.from || requestedTo !== this.data.to) return
      this.setData({
        rangeComplete: false,
        rangeSummaryText: error instanceof Error ? error.message : '日期状态加载失败',
        singleStatusText: '',
        singleSourceText: '',
        singleReasonText: '',
      })
    } finally {
      if (requestedFrom === this.data.from && requestedTo === this.data.to) {
        this.setData({ rangeLoading: false })
        this.updateActionAvailability()
      }
    }
  },

  toView(item: MealDayItem): MealDayView {
    return {
      ...item,
      weekday: weekdayLabels[parseLocalDate(item.date).getDay()] ?? '',
      statusLabel: item.status === 'open' ? '开放' : '关闭',
      sourceLabel: item.source === 'override' ? '管理员设置' : '默认规则',
    }
  },

  buildCalendarCells(items: MealDayView[]): CalendarCell[] {
    const first = monthStart(this.data.currentYear, this.data.currentMonth)
    const mondayOffset = (first.getDay() + 6) % 7
    const gridStart = addDays(first, -mondayOffset)
    const itemMap = new Map(items.map((item) => [item.date, item]))
    const currentMonthKey = this.data.currentYear * 12 + this.data.currentMonth
    const maxMonthKey = this.data.maxYear * 12 + this.data.maxMonth

    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(gridStart, index)
      const dateValue = formatDate(date)
      const dateMonthKey = date.getFullYear() * 12 + date.getMonth()
      const relation = dateMonthKey < currentMonthKey ? 'previous' : dateMonthKey > currentMonthKey ? 'next' : 'current'
      const item = itemMap.get(dateValue)
      const waitingForEnd = Boolean(this.data.from && !this.data.to)
      const beforeRangeStart = waitingForEnd && dateValue < this.data.from
      const beyondWindow = dateValue > this.data.bookingEnd
      return {
        key: `${dateValue}-${index}`,
        date: dateValue,
        dayNumber: date.getDate(),
        relation,
        inCurrentMonth: relation === 'current',
        isToday: dateValue === this.data.today,
        isRangeStart: dateValue === this.data.from,
        isRangeEnd: Boolean(this.data.to) && dateValue === this.data.to,
        isInRange: Boolean(this.data.from && this.data.to && dateValue >= this.data.from && dateValue <= this.data.to),
        canSelect: dateMonthKey <= maxMonthKey && !beyondWindow && !beforeRangeStart,
        status: item?.status ?? '',
        source: item?.source ?? '',
      }
    })
  },

  updateActionAvailability() {
    const complete = Boolean(this.data.from && this.data.to && this.data.rangeComplete)
    const inWindow = complete && this.data.from >= this.data.today && this.data.to <= this.data.bookingEnd
    this.setData({
      canOpen: inWindow,
      canClose: inWindow && this.data.from > this.data.today,
      calendarCells: this.buildCalendarCells(this.data.items),
    })
  },

  async changeStartDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const date = event.detail.value
    this.setData({
      from: date,
      to: '',
      fromLabel: formatShortDate(date),
      toLabel: '请选择',
      rangeComplete: false,
    })
    this.updateActionAvailability()
    await this.showMonthContaining(date)
    await this.loadRangeSummary()
  },

  async changeEndDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const date = event.detail.value
    if (!this.data.from || date < this.data.from) return
    this.setData({ to: date, toLabel: formatShortDate(date) })
    await this.showMonthContaining(date)
    await this.loadRangeSummary()
  },

  changeReason(event: WechatMiniprogram.Input) {
    this.setData({ reason: event.detail.value })
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
    this.setMonth(target)
    await this.loadCalendar()
  },

  setMonth(target: Date) {
    const targetKey = target.getFullYear() * 12 + target.getMonth()
    const maxKey = this.data.maxYear * 12 + this.data.maxMonth
    this.setData({
      currentYear: target.getFullYear(),
      currentMonth: target.getMonth(),
      currentMonthLabel: `${target.getFullYear()}年${target.getMonth() + 1}月`,
      canNavigateNext: targetKey < maxKey,
    })
  },

  async showMonthContaining(dateValue: string) {
    const date = parseLocalDate(dateValue)
    if (date.getFullYear() === this.data.currentYear && date.getMonth() === this.data.currentMonth) {
      this.setData({ calendarCells: this.buildCalendarCells(this.data.items) })
      return
    }
    this.setMonth(monthStart(date.getFullYear(), date.getMonth()))
    await this.loadCalendar()
  },

  selectCalendarDay(event: WechatMiniprogram.TouchEvent) {
    const date = event.currentTarget.dataset.date as string
    const rawCanSelect = event.currentTarget.dataset.canSelect
    const canSelect = rawCanSelect !== false && rawCanSelect !== 'false'
    if (!canSelect) return
    void this.applyCalendarSelection(date)
  },

  async applyCalendarSelection(date: string) {
    if (date < this.data.today) {
      this.setData({
        from: date,
        to: date,
        fromLabel: formatShortDate(date),
        toLabel: formatShortDate(date),
      })
    } else if (this.data.to || !this.data.from) {
      this.setData({
        from: date,
        to: '',
        fromLabel: formatShortDate(date),
        toLabel: '请选择',
        rangeComplete: false,
      })
    } else {
      if (date < this.data.from) return
      this.setData({ to: date, toLabel: formatShortDate(date) })
    }

    this.updateActionAvailability()
    await this.showMonthContaining(date)
    await this.loadRangeSummary()
  },

  applyStatus(event: WechatMiniprogram.TouchEvent) {
    const status = event.currentTarget.dataset.status as MealDayStatus
    const allowed = status === 'open' ? this.data.canOpen : this.data.canClose
    if (!allowed || this.data.applying) {
      const title = !this.data.to
        ? '请先选择结束日期'
        : status === 'closed' && this.data.from <= this.data.today
          ? '关闭供餐最早只能从明天开始'
          : '所选日期不可操作'
      wx.showToast({ title, icon: 'none' })
      return
    }
    void this.previewAction(status)
  },

  async previewAction(status: MealDayStatus) {
    this.setData({ applying: true, pendingAction: status })
    try {
      const preview = await apiRequest<MealDayBatchPreview>({
        path: '/api/v1/admin/meal-days/batch/preview',
        method: 'POST',
        data: {
          from: this.data.from,
          to: this.data.to,
          status,
          ...(this.data.reason.trim() ? { reason: this.data.reason.trim() } : {}),
        },
      })
      if (status === 'closed' && preview.cancelledReservationCount > 0) {
        this.setData({
          applying: false,
          pendingAction: '',
          confirmOpen: true,
          pendingPreview: preview,
        })
        this.setTabBarHidden(true)
        return
      }
      await this.commitAction(preview, status)
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '供餐日更新失败', icon: 'none' })
    } finally {
      if (!this.data.confirmOpen) this.setData({ applying: false, pendingAction: '' })
    }
  },

  cancelConfirmation() {
    if (this.data.confirming) return
    this.setData({ confirmOpen: false, pendingPreview: null })
    this.setTabBarHidden(false)
  },

  confirmClose() {
    const preview = this.data.pendingPreview
    if (!preview || this.data.confirming) return
    void this.commitConfirmedClose(preview)
  },

  async commitConfirmedClose(preview: MealDayBatchPreview) {
    this.setData({ confirming: true })
    try {
      await this.commitAction(preview, 'closed')
    } catch (error) {
      this.setData({ confirmOpen: false, pendingPreview: null })
      this.setTabBarHidden(false)
      wx.showToast({ title: error instanceof Error ? error.message : '供餐日更新失败', icon: 'none' })
      await this.refreshPage()
    } finally {
      this.setData({ confirming: false })
    }
  },

  async commitAction(preview: MealDayBatchPreview, status: MealDayStatus) {
    await apiRequest<MealDayBatchPreview>({
      path: '/api/v1/admin/meal-days/batch/apply',
      method: 'POST',
      headers: { 'Idempotency-Key': createIdempotencyKey() },
      data: {
        from: this.data.from,
        to: this.data.to,
        status,
        ...(this.data.reason.trim() ? { reason: this.data.reason.trim() } : {}),
        previewToken: preview.previewToken,
      },
    })
    this.setData({
      reason: '',
      confirmOpen: false,
      pendingPreview: null,
      applying: false,
      pendingAction: '',
    })
    this.setTabBarHidden(false)
    await this.refreshPage()
    wx.showToast({ title: status === 'open' ? '已开放供餐' : '已关闭供餐', icon: 'success' })
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
    tabBar?.refreshTabs?.('pages/admin/meal-days/meal-days')
  },

  noop() {},
})
