/// <reference types="bun" />
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clampTimeout,
  DEFAULT_TIMEOUT_MS,
  getTimeoutMs,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  setTimeoutMs,
} from './settings'

/**
 * `clampTimeout` is total on purpose: a bad stored value must not be able to
 * make a request hang forever or abort instantly, so every unusable input has a
 * defined, safe answer.
 */

describe('clampTimeout', () => {
  test('keeps a value that is already in range', () => {
    expect(clampTimeout(45_000)).toBe(45_000)
  })

  test('pulls values to the nearest bound', () => {
    expect(clampTimeout(1)).toBe(MIN_TIMEOUT_MS)
    expect(clampTimeout(99_999_999)).toBe(MAX_TIMEOUT_MS)
  })

  test('falls back to the default for anything unusable', () => {
    for (const bad of [undefined, null, '', 'soon', NaN, Infinity, -1, 0, {}, []]) {
      expect(clampTimeout(bad)).toBe(DEFAULT_TIMEOUT_MS)
    }
  })

  test('accepts a numeric string, since that is what an input gives', () => {
    expect(clampTimeout('45000')).toBe(45_000)
  })

  test('rounds fractions', () => {
    expect(clampTimeout(45_000.6)).toBe(45_001)
  })
})

describe('stored timeout', () => {
  let data: Record<string, unknown>
  beforeEach(() => {
    data = {}
    ;(globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (k: string) => (k in data ? { [k]: data[k] } : {}),
          set: async (items: Record<string, unknown>) => void Object.assign(data, items),
        },
      },
    }
  })

  test('defaults when nothing is stored', async () => {
    expect(await getTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS)
  })

  test('round-trips a saved value', async () => {
    expect(await setTimeoutMs(90_000)).toBe(90_000)
    expect(await getTimeoutMs()).toBe(90_000)
  })

  test('stores the clamped value, not the raw one', async () => {
    expect(await setTimeoutMs(1)).toBe(MIN_TIMEOUT_MS)
    expect(data['timeout_ms']).toBe(MIN_TIMEOUT_MS)
  })

  // A value written by an older build, or by hand, must not be trusted.
  test('sanitises a nonsense stored value on read', async () => {
    data['timeout_ms'] = 'whenever'
    expect(await getTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS)
  })
})
