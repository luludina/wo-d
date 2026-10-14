import { getCachedUser } from '../services/auth'

interface TabItem {
  pagePath: string
  text: string
  icon: string
  activeIcon: string
}

const memberTabs: TabItem[] = [
  {
    pagePath: 'pages/index/index',
    text: '首页',
    icon: '/assets/icons/tabbar/home.svg',
    activeIcon: '/assets/icons/tabbar/home-active.svg',
  },
  {
    pagePath: 'pages/reservations/calendar/calendar',
    text: '预约',
    icon: '/assets/icons/tabbar/calendar.svg',
    activeIcon: '/assets/icons/tabbar/calendar-active.svg',
  },
  {
    pagePath: 'pages/leaderboard/leaderboard',
    text: '排行',
    icon: '/assets/icons/tabbar/trophy.svg',
    activeIcon: '/assets/icons/tabbar/trophy-active.svg',
  },
  {
    pagePath: 'pages/profile/profile',
    text: '我的',
    icon: '/assets/icons/tabbar/user.svg',
    activeIcon: '/assets/icons/tabbar/user-active.svg',
  },
]

const adminTabs: TabItem[] = [
  memberTabs[0]!,
  memberTabs[1]!,
  memberTabs[2]!,
  {
    pagePath: 'pages/admin/meal-days/meal-days',
    text: '管理',
    icon: '/assets/icons/tabbar/manage.svg',
    activeIcon: '/assets/icons/tabbar/manage-active.svg',
  },
  memberTabs[3]!,
]

Component({
  data: {
    selected: 0,
    list: memberTabs,
    hidden: false,
  },

  attached() {
    this.refreshTabs()
  },

  pageLifetimes: {
    show() {
      this.refreshTabs()
    },
  },

  methods: {
    refreshTabs(routeOverride?: string) {
      const list = getCachedUser()?.isAdmin ? adminTabs : memberTabs
      const pages = getCurrentPages()
      const route = routeOverride ?? pages[pages.length - 1]?.route
      const selected = list.findIndex((item) => item.pagePath === route)
      this.setData({ list, selected: selected >= 0 ? selected : 0 })
    },

    setHidden(hidden: boolean) {
      this.setData({ hidden })
    },

    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.list[index] as TabItem | undefined
      if (!item) return
      void wx.switchTab({
        url: `/${item.pagePath}`,
        fail: () => this.refreshTabs(),
      })
    },
  },
})
