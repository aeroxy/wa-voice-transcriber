/**
 * The one thing worth configuring: how long to wait for a transcription.
 *
 * It needs a setting rather than a constant because the right value depends on
 * the clip. A three-second voice note comes back in about a second; a fifteen
 * minute one is a megabyte of Opus to upload and a great deal more to recognise.
 * A default low enough to fail fast on a hung request is therefore too low for
 * somebody's long clips, and there is no value that is right for both.
 */

const KEY = 'timeout_ms'

/** Generous enough for long clips, short enough that a hung request still ends. */
export const DEFAULT_TIMEOUT_MS = 60_000
export const MIN_TIMEOUT_MS = 10_000
export const MAX_TIMEOUT_MS = 600_000

/**
 * A usable timeout from whatever was stored or typed.
 *
 * Pure, and deliberately total: anything unusable — absent, a string, `NaN`,
 * negative, absurd — becomes the default or the nearest bound rather than an
 * error. A bad value here would otherwise either hang forever or abort instantly,
 * and both are worse than ignoring it.
 */
export function clampTimeout(value: unknown): number {
  const ms = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_TIMEOUT_MS
  return Math.round(Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, ms)))
}

export async function getTimeoutMs(): Promise<number> {
  const stored = await chrome.storage.local.get(KEY)
  return clampTimeout(stored[KEY])
}

/** Stores the clamped value, and returns what was actually stored. */
export async function setTimeoutMs(ms: number): Promise<number> {
  const clamped = clampTimeout(ms)
  await chrome.storage.local.set({ [KEY]: clamped })
  return clamped
}
