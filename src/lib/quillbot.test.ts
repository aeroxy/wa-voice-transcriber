/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test'
import { splitLocale, transcribe } from './quillbot'

/**
 * The deadline, and that it does not fire on requests that finish.
 *
 * Nothing else in the chain has a timeout, so before this the button could sit
 * on "Transcribing…" until the page was reloaded.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A fetch that resolves with `body`, optionally after a delay. */
function fakeFetch(body: unknown, { status = 200, delayMs = 0 } = {}) {
  return ((_url: string, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      const signal = init?.signal
      const timer = setTimeout(
        () => resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response),
        delayMs,
      )
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    })) as typeof fetch
}

describe('transcribe', () => {
  test('returns the recognised text', async () => {
    globalThis.fetch = fakeFetch({ success: true, data: { raw: '  Hey, how’s it going?  ' } })
    expect(await transcribe('AAA=', 'en-GB', 5_000)).toBe('Hey, how’s it going?')
  })

  test('reports a timeout when the deadline passes', async () => {
    globalThis.fetch = fakeFetch({ data: { raw: 'too late' } }, { delayMs: 10_000 })
    await expect(transcribe('AAA=', 'en-US', 40)).rejects.toThrow(/timed out after 0s/i)
  })

  test('the timeout message points at where the setting lives', async () => {
    globalThis.fetch = fakeFetch({}, { delayMs: 10_000 })
    await expect(transcribe('AAA=', 'en-US', 40)).rejects.toThrow(/toolbar icon/i)
  })

  // Guards the finally: a completed request must not leave a timer that later
  // aborts nothing and keeps the worker awake.
  test('a request that finishes is not reported as a timeout', async () => {
    globalThis.fetch = fakeFetch({ data: { raw: 'done' } }, { delayMs: 5 })
    expect(await transcribe('AAA=', 'en-US', 1_000)).toBe('done')
    await new Promise((r) => setTimeout(r, 30))
  })

  test('passes other failures through untouched', async () => {
    globalThis.fetch = fakeFetch({}, { status: 503 })
    await expect(transcribe('AAA=', 'en-US', 5_000)).rejects.toThrow(/HTTP 503/)
  })

  test('an abort that is not ours is not relabelled a timeout', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new DOMException('aborted elsewhere', 'AbortError'))) as unknown as typeof fetch
    await expect(transcribe('AAA=', 'en-US', 5_000)).rejects.toThrow(/aborted elsewhere/)
  })

  test('reports an empty recognition rather than returning nothing', async () => {
    globalThis.fetch = fakeFetch({ success: true, data: { raw: '   ' } })
    await expect(transcribe('AAA=', 'en-US', 5_000)).rejects.toThrow(/No speech was recognised/)
  })

  test('surfaces the service’s own failure message', async () => {
    globalThis.fetch = fakeFetch({ success: false, message: 'bad audio' })
    await expect(transcribe('AAA=', 'en-US', 5_000)).rejects.toThrow(/bad audio/)
  })
})

describe('splitLocale', () => {
  test('splits a language tag', () => {
    expect(splitLocale('en-GB')).toEqual({ language: 'en', dialect: 'GB' })
  })

  test('defaults the dialect when the tag carries no region', () => {
    expect(splitLocale('de')).toEqual({ language: 'de', dialect: 'US' })
  })

  test('falls back entirely on something unusable', () => {
    expect(splitLocale(undefined)).toEqual({ language: 'en', dialect: 'US' })
    expect(splitLocale('')).toEqual({ language: 'en', dialect: 'US' })
  })
})
