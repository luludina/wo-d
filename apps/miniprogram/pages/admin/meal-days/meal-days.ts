import type {
  MealDayBatchPreview,
  MealDayItem,
  MealDayListBody,
  MealDayStatus,
} from '@egg-booking/contracts'
import { apiRequest } from '../../../services/api'
import { createShareAppMessage } from '../../../services/share'

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
  isSelected: boolean
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

function formatShortDate(value: string): string {
  if (!value) return '请选择'
  const date = parseLocalDate(value)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function createIdempotencyKey(): string {
  return `meal-day-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

Page({
  onShareAppMessage: createShareAppMessage,

  data: {
    initialized: false,
    today: '',
    selectedDate: '',
    selectedDateLabel: '',
    reason: '',

    currentYear: 0,
    currentMonth: 0,
    currentMonthLabel: '',
    items: [] as MealDayView[],
    calendarCells: [] as CalendarCell[],
    loading: true,

    selectedDateLoading: false,
    selectedDateLoaded: false,
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
    const initialMonth = monthStart(now.getFullYear(), now.getMonth())
    const initialDate = formatDate(now)
    this.setData({
      initialized: true,
      today: initialDate,
      selectedDate: initialDate,
      selectedDateLabel: formatShortDate(initialDate),
      currentYear: initialMonth.getFullYear(),
      currentMonth: initialMonth.getMonth(),
      currentMonthLabel: `${initialMonth.getFullYear()}年${initialMonth.getMonth() + 1}月`,
    })
    this.updateActionAvailability()
  },

  onShow() {
    this.syncTabBarSelection()
    this.setTabBarHidden(false)
    this.updateActionAvailability()
    if (this.data.initialized) void this.refreshPage()
  },

  onPullDownRefresh() {
    void this.refreshPage().finally(() => wx.stopPullDownRefresh())
  },

  async refreshPage() {
    await Promise.all([this.loadCalendar(), this.loadSelectedDate()])
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

  async loadSelectedDate() {
    if (!this.data.selectedDate) {
      this.setData({
        selectedDateLoading: false,
        selectedDateLoaded: false,
        singleStatusText: '',
        singleSourceText: '',
        singleReasonText: '',
      })
      this.updateActionAvailability()
      return
    }

    const requestedDate = this.data.selectedDate
    this.setData({ selectedDateLoading: true, selectedDateLoaded: false })
    try {
      const result = await apiRequest<MealDayListBody>({
        path: `/api/v1/admin/meal-days?from=${requestedDate}&to=${requestedDate}`,
      })
      if (requestedDate !== this.data.selectedDate) return
      const selected = result.items[0] ? this.toView(result.items[0]) : null
      this.setData({
        selectedDateLoaded: Boolean(selected),
        singleStatusText: selected?.statusLabel ?? '',
        singleSourceText: selected?.sourceLabel ?? '',
        singleReasonText: selected?.reason ?? '',
      })
    } catch (error) {
      if (requestedDate !== this.data.selectedDate) return
      this.setData({
        selectedDateLoaded: false,
        singleStatusText: '',
        singleSourceText: '',
        singleReasonText: '',
      })
      wx.showToast({ title: error instanceof Error ? error.message : '日期状态加载失败', icon: 'none' })
    } finally {
      if (requestedDate === this.data.selectedDate) {
        this.setData({ selectedDateLoading: false })
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
        canSelect: true,
        status: item?.status ?? '',
        source: item?.source ?? '',
      }
    })
  },

  updateActionAvailability() {
    const canApply = Boolean(this.data.selectedDateLoaded && this.data.selectedDate)
    this.setData({
      canOpen: canApply,
      canClose: canApply,
      calendarCells: this.buildCalendarCells(this.data.items),
    })
  },

  async changeSelectedDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const date = event.detail.value
    this.setData({
      selectedDate: date,
      selectedDateLabel: formatShortDate(date),
      selectedDateLoaded: false,
      singleStatusText: '',
      singleSourceText: '',
      singleReasonText: '',
    })
    this.updateActionAvailability()
    await this.showMonthContaining(date)
    await this.loadSelectedDate()
  },

  changeReason(event: WechatMiniprogram.Input) {
    this.setData({ reason: event.detail.value })
  },

  previousMonth() {
    void this.changeMonth(-1)
  },

  nextMonth() {
    void this.changeMonth(1)
  },

  async changeMonth(offset: number) {
    const target = addMonths(monthStart(this.data.currentYear, this.data.currentMonth), offset)
    this.setMonth(target)
    await this.loadCalendar()
  },

  setMonth(target: Date) {
    this.setData({
      currentYear: target.getFullYear(),
      currentMonth: target.getMonth(),
      currentMonthLabel: `${target.getFullYear()}年${target.getMonth() + 1}月`,
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
    this.setData({
      selectedDate: date,
      selectedDateLabel: formatShortDate(date),
      selectedDateLoaded: false,
      singleStatusText: '',
      singleSourceText: '',
      singleReasonText: '',
    })
    this.updateActionAvailability()
    await this.showMonthContaining(date)
    await this.loadSelectedDate()
  },

  applyStatus(event: WechatMiniprogram.TouchEvent) {
    const status = event.currentTarget.dataset.status as MealDayStatus
    const allowed = status === 'open' ? this.data.canOpen : this.data.canClose
    if (!allowed || this.data.applying) {
      wx.showToast({ title: '请选择可操作日期', icon: 'none' })
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
          from: this.data.selectedDate,
          to: this.data.selectedDate,
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
        from: this.data.selectedDate,
        to: this.data.selectedDate,
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
