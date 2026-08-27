/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { cacheKeyFor, keyMatchesMessageId } from './voice-media'

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
