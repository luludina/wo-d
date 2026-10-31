import type { CurrentUser, MemberListBody, MemberStatus } from '@egg-booking/contracts'
import { apiRequest, resolveApiUrl } from '../../../services/api'
import { createShareAppMessage } from '../../../services/share'

type MemberAction = 'approve' | 'reject' | 'disable' | 'enable' | 'grant-admin' | 'revoke-admin'

interface MemberView extends CurrentUser {
  displayName: string
  initial: string
  avatarSrc: string
  statusLabel: string
}

const statusLabels: Record<MemberStatus, string> = {
  draft: '未申请',
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  disabled: '已停用',
}

Page({
  onShareAppMessage: createShareAppMessage,

  data: {
    tabs: [
      { value: 'pending', label: '待审核' },
      { value: 'approved', label: '已通过' },
      { value: 'rejected', label: '已拒绝' },
      { value: 'disabled', label: '已停用' },
    ],
    status: 'pending' as MemberStatus,
    members: [] as MemberView[],
    loading: true,
    actingId: '',
  },

  onLoad() {
    void this.loadMembers()
  },

  onPullDownRefresh() {
    void this.loadMembers().finally(() => wx.stopPullDownRefresh())
  },

  selectTab(event: WechatMiniprogram.TouchEvent) {
    const status = event.currentTarget.dataset.status as MemberStatus
    if (status === this.data.status) return
    this.setData({ status })
    void this.loadMembers()
  },

  async loadMembers() {
    this.setData({ loading: true })
    try {
      const result = await apiRequest<MemberListBody>({
        path: `/api/v1/admin/members?status=${this.data.status}`,
      })
      this.setData({
        members: result.items.map((member) => ({
          ...member,
          displayName: member.realName ?? member.nickname ?? '未填写姓名',
          initial: (member.realName ?? member.nickname ?? '未').slice(0, 1),
          avatarSrc: resolveApiUrl(member.avatarUrl),
          statusLabel: statusLabels[member.memberStatus],
        })),
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '成员列表加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  runAction(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string
    const action = event.currentTarget.dataset.action as MemberAction
    void this.confirmAction(id, action)
  },

  async confirmAction(id: string, action: MemberAction) {
    const labels: Record<MemberAction, string> = {
      approve: '通过申请',
      reject: '拒绝申请',
      disable: '停用成员',
      enable: '重新启用',
      'grant-admin': '设为管理员',
      'revoke-admin': '撤销管理员',
    }
    const needsReason = action === 'reject' || action === 'disable'
    const modal = await wx.showModal({
      title: labels[action],
      content: needsReason ? '请填写原因' : `确定要${labels[action]}吗？`,
      editable: needsReason,
      ...(needsReason ? { placeholderText: '原因' } : {}),
      confirmColor: action === 'reject' || action === 'disable' ? '#b33a32' : '#287a52',
    })
    if (!modal.confirm) return
    const reason = modal.content?.trim()
    if (action === 'reject' && !reason) {
      wx.showToast({ title: '拒绝时必须填写原因', icon: 'none' })
      return
    }

    this.setData({ actingId: id })
    try {
      await apiRequest<CurrentUser>({
        path: `/api/v1/admin/members/${id}/${action}`,
        method: 'POST',
        data: needsReason && reason ? { reason } : {},
      })
      wx.showToast({ title: '操作成功', icon: 'success' })
      await this.loadMembers()
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    } finally {
      this.setData({ actingId: '' })
    }
  },
})
