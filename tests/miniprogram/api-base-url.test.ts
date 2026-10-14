import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LOCAL_API_BASE_URL,
  PRODUCTION_API_BASE_URL,
  resolveApiBaseUrl,
} from '../../apps/miniprogram/services/api-base-url.ts'

test('uses the local API only inside WeChat DevTools', () => {
  assert.equal(resolveApiBaseUrl('develop', 'devtools'), LOCAL_API_BASE_URL)
})

test('uses the production API for physical-device previews', () => {
  assert.equal(resolveApiBaseUrl('develop', 'ios'), PRODUCTION_API_BASE_URL)
  assert.equal(resolveApiBaseUrl('develop', 'android'), PRODUCTION_API_BASE_URL)
})

test('uses the production API for trial and release builds', () => {
  assert.equal(resolveApiBaseUrl('trial', 'devtools'), PRODUCTION_API_BASE_URL)
  assert.equal(resolveApiBaseUrl('release', 'devtools'), PRODUCTION_API_BASE_URL)
})
