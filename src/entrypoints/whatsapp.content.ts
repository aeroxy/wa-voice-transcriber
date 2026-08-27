import { findClips } from '@/lib/clips'
import { ClipUnavailable, loadClipBase64, resolveFilehash } from '@/lib/voice-media'
import * as store from '@/lib/transcript-store'
import type { Request, TranscribeResult } from '@/types/messages'

/**
 * Puts a working Transcribe control on every voice message in a thread.
 *
 * Every voice-note bubble inspected while building this carried a player, a
 * duration and a speed control, and nothing else — no transcript and no control
 * to produce one. This reads the clip WhatsApp has already downloaded and
 * decrypted, and transcribes it independently.
 */

const STYLE_ID = 'wavt-styles'
const BLOCK_CLASS = 'wavt-block'
/**
 * The message id a mounted block was built for.
 *
 * WhatsApp virtualises the thread and React owns this markup, so a row element
 * can be re-used for a different message. Without this stamp the only question
 * `scan` could ask was "is a block already here?", which a recycled row answers
 * yes to while now showing someone else's message — leaving one bubble
 * displaying another's transcript, with nothing to detect it.
 */
const ID_ATTR = 'data-wavt-id'

/**
 * Everything inherits the bubble's own colour instead of picking one. WhatsApp
 * has four bubble backgrounds — outgoing and incoming, light and dark — and any
 * fixed colour is illegible against at least one of them. `inherit` is right for
 * all four.
 */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .wavt-block { display:block; width:100%; color:inherit; margin-top:2px; }
    .wavt-row { display:block; font-size:12px; line-height:1.4; color:inherit; }
    .wavt-btn {
      border:0; background:none; padding:0; font:inherit; color:inherit;
      cursor:pointer; opacity:.75; text-decoration:underline;
    }
    .wavt-btn:hover { opacity:1; }
    .wavt-btn[disabled] { cursor:default; text-decoration:none; opacity:.6; }
    .wavt-text { margin-top:2px; font-size:13.5px; line-height:1.45; color:inherit; white-space:pre-wrap; }
    .wavt-err { margin-top:2px; font-size:12px; line-height:1.4; color:inherit; opacity:.75; }
  `
  document.head.appendChild(style)
}

function showTranscript(output: HTMLElement, text: string): void {
  output.className = 'wavt-text'
  output.textContent = text
  // A note left by an earlier failed attempt no longer describes anything.
  const note = output.nextElementSibling
  if (note?.classList.contains('wavt-err')) note.remove()
}

/**
 * An error shown *beside* whatever is already there, not over it — a re-run that
 * fails must not cost the user the transcript they could already read.
 */
function showError(output: HTMLElement, message: string): void {
  if (output.classList.contains('wavt-text')) {
    let note = output.nextElementSibling
    if (!note?.classList.contains('wavt-err')) {
      note = document.createElement('div')
      output.after(note)
    }
    note.className = 'wavt-err'
    note.textContent = message
    return
  }
  output.className = 'wavt-err'
  output.textContent = message
}

/** The clip's bytes, then the worker's transcription of them. */
async function runTranscription(filehash: string): Promise<TranscribeResult> {
  let audioBase64: string
  try {
    audioBase64 = await loadClipBase64(filehash)
  } catch (e) {
    if (e instanceof ClipUnavailable) return { ok: false, error: e.message }
    throw e
  }

  try {
    const message: Request = { type: 'TRANSCRIBE', audioBase64 }
    return (await chrome.runtime.sendMessage(message)) as TranscribeResult
  } catch (e) {
    // Almost always the worker being replaced mid-call, or the extension having
    // been reloaded under a page that still holds the old context.
    return { ok: false, error: `Extension not reachable: ${(e as Error).message}` }
  }
}

async function mount(playerRow: HTMLElement, messageId: string): Promise<void> {
  const row = document.createElement('div')
  row.className = 'wavt-row'
  const output = document.createElement('div')

  const block = document.createElement('div')
  block.className = BLOCK_CLASS
  // Stamped before the first await, so a concurrent scan sees a claimed row.
  block.setAttribute(ID_ATTR, messageId)
  // Output first: the control reads as a footnote under the transcript, and when
  // there is no transcript yet the empty output leaves it directly under the
  // player, exactly where a bare "Transcribe" belongs.
  block.append(output, row)
  // After the player row, not inside it: the player row's only sibling is the
  // timestamp, so this lands between the two.
  playerRow.after(block)

  // Resolve which audio this message points at before consulting the cache: a
  // stored transcript is only trusted if it was made from that same audio.
  // Failure here is not reported yet — the user has not asked for anything, so
  // it surfaces on the button instead.
  let filehash: string | null = null
  try {
    filehash = await resolveFilehash(messageId)
  } catch {
    // Not in WhatsApp's local database, or the store is not ready. Offer the
    // button; clicking it produces the real message.
  }

  // Look for an existing transcript before offering to fetch one. Scrolling a
  // clip out of view and back destroys these nodes and runs mount() again, so
  // without this every clip would show "Transcribe" afresh however many times it
  // had already been transcribed.
  let cached: string | null = null
  if (filehash) {
    try {
      cached = await store.get(messageId, filehash)
    } catch {
      // Extension reloaded under a live page. Fall through and offer the button.
    }
  }
  const button = document.createElement('button')
  button.className = 'wavt-btn'
  row.appendChild(button)

  /**
   * What the control should say when it is not busy: an invitation while there
   * is nothing to show, an offer to redo it once there is, and a retry when the
   * last attempt failed with nothing to fall back on.
   */
  const idleLabel = () => {
    if (output.classList.contains('wavt-text')) return 'Retranscribe'
    return output.classList.contains('wavt-err') ? 'Retry' : 'Transcribe'
  }

  if (cached) showTranscript(output, cached)
  button.textContent = idleLabel()

  button.addEventListener('click', async (event) => {
    // Only a real click. This button is injected into WhatsApp's own DOM, so any
    // script in the page can call `.click()` on it — and the worker behind it is
    // an egress path the page does not otherwise have, since WhatsApp's
    // `connect-src` CSP blocks a page-context fetch to QuillBot. Reading the
    // cached audio is no privilege (the page is same-origin with Cache Storage
    // and can read it directly), but shipping it to a third party is, so the
    // lever wants a hand on it.
    if (!event.isTrusted) return

    button.disabled = true
    button.textContent = 'Transcribing…'

    let result: TranscribeResult
    try {
      // Re-resolve when mount could not: the message may have arrived in the
      // local database since, and this is where an error can be shown.
      const hash = filehash ?? (await resolveFilehash(messageId))
      filehash = hash
      result = await runTranscription(hash)
    } catch (e) {
      result = { ok: false, error: (e as Error).message }
    }

    if (result.ok) {
      showTranscript(output, result.text)
      // Always set by now — runTranscription cannot have succeeded without it —
      // but caching is a convenience, so a missing hash skips the write rather
      // than storing a transcript nothing can later validate.
      if (filehash) {
        await store.set(messageId, filehash, result.text).catch((e: unknown) =>
          console.error('[WAVT] failed to cache a transcript:', e),
        )
      }
    } else {
      // The previous transcript, if any, stays on screen: replacing a readable
      // line with an error would lose it to no purpose, since a failed re-run
      // tells you nothing new about the text you already had.
      showError(output, result.error)
    }

    button.disabled = false
    button.textContent = idleLabel()
  })
}

function scan(): void {
  for (const { messageId, playerRow } of findClips()) {
    const existing = playerRow.nextElementSibling
    if (existing?.classList.contains(BLOCK_CLASS)) {
      // Right block, right message: leave it alone.
      if (existing.getAttribute(ID_ATTR) === messageId) continue
      // Same row element, different message — React re-used the node. The block
      // describes a message that is no longer here, so drop it and mount afresh
      // rather than leaving one bubble wearing another's transcript.
      existing.remove()
    }
    mount(playerRow, messageId).catch((e: unknown) =>
      console.error('[WAVT] failed to mount a clip:', e),
    )
  }
}

export default defineContentScript({
  matches: ['*://web.whatsapp.com/*'],
  runAt: 'document_idle',
  main() {
    injectStyles()
    scan()

    // The thread is virtualised and messages arrive over the socket, so clips
    // appear long after load. Debounced because WhatsApp mutates constantly.
    let queued = 0
    const observer = new MutationObserver(() => {
      clearTimeout(queued)
      queued = window.setTimeout(scan, 250)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  },
})
