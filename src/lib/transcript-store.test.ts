/// <reference types="bun" />
import { beforeEach, describe, expect, test } from 'bun:test'
import * as store from './transcript-store'

/**
 * The cache has to be *checkable*, not merely fast.
 *
 * A transcript keyed only by message id is trusted forever once written, so a
 * single bad entry — observed in a real profile, showing one voice note's text
 * under the neighbouring bubble — is indistinguishable from a good one and
 * survives every reload. Binding the entry to the `filehash` of the audio it was
 * made from is what lets a wrong entry be detected and re-derived.
 */

const MESSAGE = 'AC6B622229B5DEB7D08EA31138FCEBC7'
const AUDIO = 'j60pavpmJRtwH6+8UFKdV2gk/HJwGgAJ3EGt0S3YMBc='
const OTHER_AUDIO = '2PLNyG8fuMUQ5QXrlGG84953/bNnVf8pm5DL/lOONI0='

/** Minimal stand-in for `chrome.storage.local`; only what the store touches. */
function fakeStorage(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...seed }
  return {
    data,
    local: {
      get: async (key: string | null) =>
        key === null ? { ...data } : key in data ? { [key]: data[key] } : {},
      set: async (items: Record<string, unknown>) => void Object.assign(data, items),
      remove: async (keys: string[]) => void keys.forEach((k) => delete data[k]),
    },
  }
}

let fake: ReturnType<typeof fakeStorage>
beforeEach(() => {
  fake = fakeStorage()
  ;(globalThis as { chrome?: unknown }).chrome = { storage: { local: fake.local } }
})

describe('transcript cache', () => {
  test('returns a transcript made from the same audio', async () => {
    await store.set(MESSAGE, AUDIO, 'By the way, did you take any photos?')
    expect(await store.get(MESSAGE, AUDIO)).toBe('By the way, did you take any photos?')
  })

  // The observed failure: the entry exists under the right message id, but the
  // text came from different audio. It must not be served.
  test('refuses a transcript whose audio no longer matches', async () => {
    await store.set(MESSAGE, OTHER_AUDIO, 'No, I didn’t. I was too busy listening…')
    expect(await store.get(MESSAGE, AUDIO)).toBeNull()
  })

  // Entries written before the filehash was recorded have no way to prove
  // themselves, so they are re-derived once rather than trusted.
  test('refuses a legacy entry with no filehash', async () => {
    fake.data[`transcript:${MESSAGE}`] = { text: 'stale', at: Date.now() }
    expect(await store.get(MESSAGE, AUDIO)).toBeNull()
  })

  test('a rejected entry is replaced by the next write', async () => {
    await store.set(MESSAGE, OTHER_AUDIO, 'wrong')
    expect(await store.get(MESSAGE, AUDIO)).toBeNull()
    await store.set(MESSAGE, AUDIO, 'right')
    expect(await store.get(MESSAGE, AUDIO)).toBe('right')
  })

  test('returns null for a message never transcribed', async () => {
    expect(await store.get('ACNOPESUCHMESSAGE', AUDIO)).toBeNull()
  })
})

describe('count and clearAll', () => {
  test('counts only transcript entries', async () => {
    await store.set('A1', AUDIO, 'one')
    await store.set('A2', AUDIO, 'two')
    // The write counter shares the same storage area and must not be counted.
    expect(await store.count()).toBe(2)
  })

  test('clearAll removes every transcript and reports the number', async () => {
    await store.set('A1', AUDIO, 'one')
    await store.set('A2', AUDIO, 'two')
    expect(await store.clearAll()).toBe(2)
    expect(await store.count()).toBe(0)
    expect(await store.get('A1', AUDIO)).toBeNull()
  })

  test('clearAll also drops the sweep counter, leaving nothing behind', async () => {
    await store.set('A1', AUDIO, 'one')
    await store.clearAll()
    expect(Object.keys(fake.data)).toEqual([])
  })

  // Unrelated keys are not ours to delete.
  test('clearAll leaves foreign keys alone', async () => {
    fake.data['some_other_setting'] = 42
    await store.set('A1', AUDIO, 'one')
    await store.clearAll()
    expect(fake.data['some_other_setting']).toBe(42)
  })

  test('clearAll on an empty store is a no-op returning zero', async () => {
    expect(await store.clearAll()).toBe(0)
  })
})
