import assert from 'node:assert/strict'
import test from 'node:test'
import { createShareAppMessage, createTimelineShare } from '../../apps/miniprogram/services/share.ts'

test('friend shares always open the public home page', () => {
  assert.deepEqual(createShareAppMessage(), {
    title: '鸡蛋预约｜每天几颗，提前报好',
    path: '/pages/index/index',
    imageUrl: '/assets/share-cover.png',
  })
})

test('timeline shares contain no private business parameters', () => {
  assert.deepEqual(createTimelineShare(), {
    title: '鸡蛋预约｜每天几颗，提前报好',
    query: 'from=timeline',
    imageUrl: '/assets/share-cover.png',
  })
})
