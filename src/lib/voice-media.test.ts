/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { cacheKeyFor, ClipUnavailable, keyMatchesMessageId, loadClipBase64 } from './voice-media'

/**
 * The two joins that connect a bubble in the DOM to bytes on disk. Both are
 * string handling over data whose real shapes were read out of a live profile,
 * so the cases below are the real shapes, not invented ones.
 */

describe('keyMatchesMessageId', () => {
  const messageId = 'ACBA313EAF8FB4BFDE52D27B7CF949A2'

  test('matches the database key for an incoming message', () => {
    expect(keyMatchesMessageId(`false_101112170471529@lid_${messageId}`, messageId)).toBe(true)
  })

  test('matches the database key for a message you sent', () => {
    expect(keyMatchesMessageId(`true_101112170471529@lid_${messageId}`, messageId)).toBe(true)
  })

  test('matches regardless of chat address form', () => {
    expect(keyMatchesMessageId(`false_16467190387@c.us_${messageId}`, messageId)).toBe(true)
    expect(keyMatchesMessageId(`false_120363041@g.us_${messageId}`, messageId)).toBe(true)
  })

  test('rejects a different message', () => {
    expect(keyMatchesMessageId('false_1@c.us_AC017095FD1B9BD0D92D9423AA01D4D8', messageId)).toBe(false)
  })

  // The separator is what makes the match safe: without it a hash that happened
  // to end some other key's chat id would claim that key's record — and hand
  // back a different conversation's audio to be uploaded.
  test('will not match a hash that merely ends the key without a separator', () => {
    expect(keyMatchesMessageId(`false_1@c.us_XX${messageId}`, messageId)).toBe(false)
  })

  test('ignores non-string keys', () => {
    expect(keyMatchesMessageId(42, messageId)).toBe(false)
  })
})

describe('cacheKeyFor', () => {
  // Real filehash from a live profile — base64, and it contains both `/` and `=`.
  const filehash = '2PLNyG8fuMUQ5QXrlGG84953/bNnVf8pm5DL/lOONI0='

  test('builds the URL WhatsApp cached the clip under', () => {
    expect(cacheKeyFor(filehash)).toBe(
      'https://_media_cache_v2_.whatsapp.com/lru-media-array-buffer-cache_' +
        '2PLNyG8fuMUQ5QXrlGG84953%2FbNnVf8pm5DL%2FlOONI0%3D',
    )
  })

  test('escapes every base64 character that needs it', () => {
    expect(cacheKeyFor('a+b/c=')).toEndWith('a%2Bb%2Fc%3D')
  })
})

/**
 * Reading the clip out of WhatsApp's cache.
 *
 * The `caches.open` trap is worth a test of its own: `open` *creates* a cache
 * that is not there — verified in a browser — so using it here would plant an
 * empty `lru-media-array-buffer-cache` on web.whatsapp.com whenever WhatsApp had
 * not made one yet. `caches.match(..., { cacheName })` reads without writing.
 */
describe('loadClipBase64', () => {
  const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4, 5])

  async function hashOf(b: Uint8Array<ArrayBuffer>): Promise<string> {
    return Buffer.from(await crypto.subtle.digest('SHA-256', b)).toString('base64')
  }

  /** Records how the cache was reached, so the wrong API is a test failure. */
  function stubCaches(body: Uint8Array | null) {
    const calls: { match: unknown[]; opened: string[] } = { match: [], opened: [] }
    ;(globalThis as { caches?: unknown }).caches = {
      match: async (request: unknown, options?: { cacheName?: string }) => {
        calls.match.push({ request, cacheName: options?.cacheName })
        if (!body) return undefined
        return {
          arrayBuffer: async () => {
            // A fresh ArrayBuffer rather than `body.buffer`, whose type is
            // ArrayBufferLike and may be shared.
            const copy = new ArrayBuffer(body.length)
            new Uint8Array(copy).set(body)
            return copy
          },
        } as Response
      },
      open: async (name: string) => {
        calls.opened.push(name)
        throw new Error('caches.open must not be used: it creates a missing cache')
      },
    }
    return calls
  }

  test('returns the clip as base64 when the checksum matches', async () => {
    const filehash = await hashOf(bytes)
    stubCaches(bytes)
    expect(await loadClipBase64(filehash)).toBe(Buffer.from(bytes).toString('base64'))
  })

  // The regression this guards: reading must never create WhatsApp's cache.
  test('reads by cacheName and never opens the cache', async () => {
    const filehash = await hashOf(bytes)
    const calls = stubCaches(bytes)
    await loadClipBase64(filehash)
    expect(calls.opened).toEqual([])
    expect(calls.match).toEqual([
      { request: cacheKeyFor(filehash), cacheName: 'lru-media-array-buffer-cache' },
    ])
  })

  test('a missing entry is reported as unavailable, not thrown raw', async () => {
    stubCaches(null)
    await expect(loadClipBase64(await hashOf(bytes))).rejects.toBeInstanceOf(ClipUnavailable)
  })

  test('a missing entry says how to make the clip available', async () => {
    stubCaches(null)
    await expect(loadClipBase64(await hashOf(bytes))).rejects.toThrow(/Download or play it/i)
  })

  // filehash is the SHA-256 of the file, so bytes that do not hash to it are the
  // wrong clip and must never reach the recognizer.
  test('refuses bytes that do not hash to the filehash they were found under', async () => {
    stubCaches(bytes)
    const wrong = await hashOf(new Uint8Array([9, 9, 9]))
    await expect(loadClipBase64(wrong)).rejects.toThrow(/checksum/i)
  })
})
