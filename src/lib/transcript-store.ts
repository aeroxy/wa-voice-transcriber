/**
 * Transcripts, kept so they survive scrolling.
 *
 * WhatsApp virtualises the thread: scroll a voice message out of view and React
 * destroys the bubble, taking our injected transcript with it. Coming back
 * re-creates it from scratch. Without a cache every clip would have to be
 * transcribed — and re-uploaded — each time it scrolled past.
 *
 * The key is the message's own `data-id`, which WhatsApp puts on the row and
 * uses as the suffix of its database key. Unlike the Instagram sibling, where
 * identity had to be reconstructed from a CDN filename, nothing here is
 * inferred.
 *
 * `chrome.storage.local` rather than IndexedDB: the records are a few hundred
 * bytes each against a 10MB quota, and there is no schema to migrate. Content
 * scripts reach `chrome.storage` directly, so this runs in the page's world
 * alongside everything else that needs it.
 */

const PREFIX = 'transcript:'
/** Above this many stored transcripts, the oldest are dropped. */
const MAX_ENTRIES = 1000
const PRUNE_TO = 800
/**
 * Writes tolerated between sweeps. Finding the oldest entries means reading
 * every key, so doing it on each save would put an O(all-storage) read on the
 * path of every transcription. Amortised instead: storage can overshoot the cap
 * by at most this much before a sweep brings it back down.
 */
const WRITES_PER_SWEEP = 200
const COUNTER_KEY = 'transcript_writes_since_sweep'

interface Entry {
  text: string
  /** When we stored it, used only for pruning. */
  at: number
  /**
   * The `filehash` of the audio this text was transcribed from.
   *
   * Storing it is what makes the cache trustworthy rather than merely fast. The
   * message id says *which bubble* a transcript belongs to; the filehash says
   * *which audio* it was actually derived from, and only the second can be
   * checked. Without it a wrong entry — however it got written — is indistinguishable
   * from a right one and is shown with full confidence for as long as it exists.
   */
  filehash: string
}

const keyFor = (messageId: string) => `${PREFIX}${messageId}`

/**
 * The stored transcript for this message, but only if it was made from the audio
 * this message currently points at.
 *
 * A mismatch returns null, which sends the caller down the transcribe path and
 * overwrites the bad entry. That makes the cache self-healing: entries written
 * before the filehash was recorded, and any entry that ever ends up describing
 * the wrong clip, are re-derived once instead of being trusted forever.
 */
export async function get(messageId: string, filehash: string): Promise<string | null> {
  const key = keyFor(messageId)
  const stored = await chrome.storage.local.get(key)
  const entry = stored[key] as Entry | undefined
  if (!entry || entry.filehash !== filehash) return null
  return entry.text
}

export async function set(messageId: string, filehash: string, text: string): Promise<void> {
  await chrome.storage.local.set({
    [keyFor(messageId)]: { text, at: Date.now(), filehash } satisfies Entry,
  })

  const { [COUNTER_KEY]: written } = await chrome.storage.local.get(COUNTER_KEY)
  const count = (typeof written === 'number' ? written : 0) + 1
  if (count < WRITES_PER_SWEEP) {
    await chrome.storage.local.set({ [COUNTER_KEY]: count })
    return
  }
  await chrome.storage.local.set({ [COUNTER_KEY]: 0 })
  await sweep()
}

/** Keeps storage from growing without limit over years of use. */
async function sweep(): Promise<void> {
  const all = await chrome.storage.local.get(null)
  const entries = Object.entries(all).filter(([k]) => k.startsWith(PREFIX))
  if (entries.length <= MAX_ENTRIES) return

  const oldestFirst = entries.sort(
    ([, a], [, b]) => ((a as Entry).at ?? 0) - ((b as Entry).at ?? 0),
  )
  await chrome.storage.local.remove(
    oldestFirst.slice(0, entries.length - PRUNE_TO).map(([k]) => k),
  )
}

/** How many transcripts are cached right now. */
export async function count(): Promise<number> {
  const all = await chrome.storage.local.get(null)
  return Object.keys(all).filter((k) => k.startsWith(PREFIX)).length
}

/**
 * Forget every cached transcript, and report how many went.
 *
 * Only this extension's own keys. WhatsApp's IndexedDB and its media cache are
 * never touched: they are WhatsApp's copy of the user's messages, we only ever
 * read them, and clearing them would damage the account's local state to no
 * purpose. Everything removed here is re-derivable by pressing Transcribe again.
 */
export async function clearAll(): Promise<number> {
  const all = await chrome.storage.local.get(null)
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX))
  await chrome.storage.local.remove([...keys, COUNTER_KEY])
  return keys.length
}
