import * as store from '@/lib/transcript-store'

/**
 * The extension's only settings surface: how many transcripts are cached, and a
 * way to drop them.
 *
 * Clearing is worth exposing because a transcript is a cache of a guess. If the
 * recognizer improves, or an entry is wrong, the cache is the thing standing
 * between the user and a fresh answer — and per-clip Retranscribe handles one
 * bubble, not a whole history.
 */

const els = {
  count: document.getElementById('count') as HTMLParagraphElement,
  clear: document.getElementById('clear') as HTMLButtonElement,
  status: document.getElementById('status') as HTMLParagraphElement,
  version: document.getElementById('version') as HTMLParagraphElement,
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

async function refresh(): Promise<void> {
  const n = await store.count()
  els.count.innerHTML = n
    ? `<strong>${plural(n, 'transcript')}</strong> cached.`
    : 'No transcripts cached yet.'
  els.clear.disabled = n === 0
  return
}

/**
 * Two presses rather than a `confirm()` dialog: this is destructive but cheap to
 * undo by re-transcribing, so it wants a speed bump, not a modal. A popup also
 * closes the moment focus leaves it, which makes a native dialog awkward here.
 */
let armed = false

els.clear.addEventListener('click', async () => {
  if (!armed) {
    armed = true
    els.clear.textContent = 'Really clear? Click again'
    els.clear.classList.add('confirming')
    return
  }

  els.clear.disabled = true
  els.clear.classList.remove('confirming')
  els.clear.textContent = 'Clearing…'
  try {
    const removed = await store.clearAll()
    els.status.textContent = `Cleared ${plural(removed, 'transcript')}.`
  } catch (e) {
    els.status.textContent = `Could not clear: ${(e as Error).message}`
  }
  armed = false
  els.clear.textContent = 'Clear all transcripts'
  await refresh()
})

els.version.textContent = `v${__VERSION__} · built ${__BUILD_TIME__.slice(0, 10)}`
refresh().catch((e: unknown) => {
  els.count.textContent = `Could not read storage: ${(e as Error).message}`
})
