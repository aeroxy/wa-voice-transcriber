/**
 * Getting a voice note's audio, without downloading or decrypting anything.
 *
 * The obvious route is the one WhatsApp uses: fetch the clip from
 * `mmg.whatsapp.net` and decrypt it. It does not survive contact with reality.
 * Voice notes are served as `.enc` — AES-256-CBC under a per-message `mediaKey`
 * — so the bytes on the wire are useless on their own, and the signed URL that
 * serves them expires about 30 days after the message (`oe=` in the query
 * string). Every stored URL older than that answers `403 URL signature expired`,
 * to WhatsApp itself as much as to us: playing a four-month-old note in the real
 * client re-requests the identical expired URL and fails the same way.
 *
 * So we take the audio from the other end, after WhatsApp has already done the
 * work. WhatsApp auto-downloads incoming voice notes, decrypts them in the page,
 * and parks the **plaintext** in Cache Storage:
 *
 *   caches.match('https://_media_cache_v2_.whatsapp.com/lru-media-array-buffer-cache_<filehash>',
 *                 { cacheName: 'lru-media-array-buffer-cache' })
 *
 * `<filehash>` is the message's own `filehash` field, URL-encoded — the SHA-256
 * of the decrypted file, which is exactly what makes it a safe key: read the
 * entry back, hash it, and it must equal the field you looked it up with. That
 * was verified against every cached clip in a real profile.
 *
 * What this buys, against fetching and decrypting ourselves:
 *
 *   - no `webRequest`, no `tabs`, no host permission for WhatsApp's CDN
 *   - no HKDF and no AES, so no crypto of ours to get wrong
 *   - no network call at all, so no expiry — a clip from last year transcribes
 *     as readily as one from this morning, as long as it is still cached
 *
 * The cost is that a clip WhatsApp never downloaded has no entry. In a real
 * profile that was 8 of 181 voice notes, and all eight were the user's own
 * recordings — uploaded, never downloaded, so never decrypted on this machine.
 * Every incoming note, which is the entire point of the extension, was there.
 */

/** WhatsApp's own database of messages; `message` is keyed by full message id. */
const DB_NAME = 'model-storage'
const STORE = 'message'

const MEDIA_CACHE = 'lru-media-array-buffer-cache'
const MEDIA_KEY_PREFIX = `https://_media_cache_v2_.whatsapp.com/${MEDIA_CACHE}_`

/** Thrown for every expected failure, so the content script can show the text as-is. */
export class ClipUnavailable extends Error {}

/**
 * Does this database key belong to the message the DOM called `messageId`?
 *
 * The DOM gives a bare message hash (`data-id="ACBA313E…"`) while the database
 * keys on the full `<fromMe>_<chatJid>_<hash>` form. The hash is the unique part,
 * so matching the key's last underscore-separated field finds the record without
 * having to work out which chat is open or who sent the message.
 *
 * Anchored on the separator rather than a bare `includes`, so a hash can never
 * match by appearing inside a chat's JID.
 */
export function keyMatchesMessageId(key: IDBValidKey, messageId: string): boolean {
  return typeof key === 'string' && key.endsWith(`_${messageId}`)
}

/**
 * Where WhatsApp parked the decrypted bytes for a file with this `filehash`.
 *
 * The hash is base64, so it arrives containing `+`, `/` and `=` — all three of
 * which WhatsApp percent-encodes when it builds the cache key. Encoding is not
 * cosmetic here: skip it and every clip whose hash contains one of them misses.
 */
export function cacheKeyFor(filehash: string): string {
  return MEDIA_KEY_PREFIX + encodeURIComponent(filehash)
}

/**
 * Open WhatsApp's message database, and never create it.
 *
 * `indexedDB.open` with no version *creates* a database that is not there, which
 * on this origin would mean planting an empty `model-storage` in front of
 * WhatsApp's own. This extension is a read-only guest in WhatsApp's storage;
 * conjuring one of its databases is the same intrusion as clearing one, so the
 * name is checked against `indexedDB.databases()` first and a missing database is
 * reported rather than made.
 *
 * `onupgradeneeded` is still handled, because the check above is a race, not a
 * lock: WhatsApp could be mid-setup. It aborts the version-change transaction so
 * the empty database it was about to create is rolled back instead of left
 * behind.
 */
async function open(): Promise<IDBDatabase> {
  const present = await indexedDB.databases()
  if (!present.some((d) => d.name === DB_NAME)) {
    throw new ClipUnavailable('WhatsApp’s message store isn’t ready on this page yet.')
  }

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open WhatsApp’s message store.'))
    req.onupgradeneeded = () => {
      // Roll back rather than leave a half-made database of WhatsApp's behind.
      // Aborting also fires onerror, and the first rejection is the one that
      // counts, so the message below is what the caller sees.
      req.transaction?.abort()
      reject(new ClipUnavailable('WhatsApp’s message store isn’t ready on this page yet.'))
    }
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Message store read failed.'))
  })
}

/** Only the one field is read; WhatsApp's records carry a great deal more. */
interface MessageRecord {
  /** SHA-256 of the decrypted file, base64. The Cache Storage key. */
  filehash?: string
}

/**
 * The `filehash` of the audio this message points at.
 *
 * Separate from loading the bytes because callers need the identity before they
 * need the audio: the transcript cache is validated against it, so a stored
 * transcript can be checked without touching Cache Storage at all.
 */
export async function resolveFilehash(messageId: string): Promise<string> {
  const db = await open()
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    const keys = await request(store.getAllKeys())
    const key = keys.find((k) => keyMatchesMessageId(k, messageId))
    if (key === undefined) {
      throw new ClipUnavailable('WhatsApp has no local record of this message.')
    }
    const record = (await request(store.get(key))) as MessageRecord | undefined
    if (!record?.filehash) {
      throw new ClipUnavailable('This message has no audio attached.')
    }
    return record.filehash
  } finally {
    db.close()
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * The clip's decrypted bytes, base64, ready to hand to the worker.
 *
 * Throws `ClipUnavailable` with a sentence fit to show the user for the things
 * that legitimately go wrong: the audio was never cached, or the cache handed
 * back bytes that are not the ones asked for.
 *
 * The hash check is the point. `filehash` is the SHA-256 of the decrypted file,
 * so the lookup key and the payload can be compared against each other — and a
 * transcript is only worth anything if it was made from the right audio. Doing
 * it here means the wrong clip can never reach the recognizer, rather than being
 * discovered later by reading a transcript that does not match what you hear.
 */
export async function loadClipBase64(filehash: string): Promise<string> {
  // `caches.match(..., { cacheName })` rather than `caches.open(MEDIA_CACHE)`:
  // `open` *creates* a cache that is not there, exactly as `indexedDB.open` does,
  // so it would plant an empty `lru-media-array-buffer-cache` on
  // web.whatsapp.com whenever WhatsApp had not made one yet. Same intrusion as
  // creating its database, and this form reads without writing — a missing cache
  // simply misses.
  const hit = await caches.match(cacheKeyFor(filehash), { cacheName: MEDIA_CACHE })
  if (!hit) {
    throw new ClipUnavailable(
      'WhatsApp hasn’t downloaded this clip on this device yet. Download or play it ' +
        'in WhatsApp, then try again.',
    )
  }

  const bytes = new Uint8Array(await hit.arrayBuffer())
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  if (toBase64(digest) !== filehash) {
    throw new ClipUnavailable('This clip’s cached audio failed its checksum; skipping it.')
  }

  return toBase64(bytes)
}
