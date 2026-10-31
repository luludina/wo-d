import { apiRequest } from '../../../services/api'

type RequestItem = { _id: string; date: string; memberId: string; quantity: number; originalQuantity: number; applicantName: string; applicantAvatarUrl?: string; status: 'pending' | 'approved' | 'rejected' | 'superseded'; reviewedQuantity?: number; reason?: string }

Page({
  data: { loading: true, items: [] as RequestItem[] },
  onShow() { void this.load() },
  async load() {
    this.setData({ loading: true })
    try { const result = await apiRequest<{ items: RequestItem[] }>({ path: '/api/v1/admin/actual-quantities/requests' }); this.setData({ items: result.items.map((item) => ({ ...item, applicantAvatarUrl: item.applicantAvatarUrl ? `${getApp<{ globalData: { apiBaseUrl: string } }>().globalData.apiBaseUrl}${item.applicantAvatarUrl}` : '' })) }) }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '加载失败', icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  async review(index: number, decision: 'approve' | 'reject', quantity?: number) {
    const item = this.data.items[index]; if (!item) return
    try { await apiRequest({ path: `/api/v1/admin/actual-quantities/${item.date}/members/${item.memberId}/review`, method: 'POST', data: { decision, ...(quantity === undefined ? {} : { quantity }) } }); wx.showToast({ title: '已处理', icon: 'success' }); void this.load() }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '处理失败', icon: 'none' }) }
  },
  approve(event: WechatMiniprogram.TouchEvent) { void this.review(Number(event.currentTarget.dataset.index), 'approve') },
  adjust(event: WechatMiniprogram.TouchEvent) { const index = Number(event.currentTarget.dataset.index); const item = this.data.items[index]; if (!item) return; wx.showModal({ title: '修改数量后通过', editable: true, content: String(item.quantity), success: (r) => { if (r.confirm) { const q = Number(r.content); if (Number.isInteger(q) && q >= 0 && q <= 5) void this.review(index, 'approve', q); else wx.showToast({ title: '请输入 0～5', icon: 'none' }) } } }) },
  reject(event: WechatMiniprogram.TouchEvent) { void this.review(Number(event.currentTarget.dataset.index), 'reject') },
})
