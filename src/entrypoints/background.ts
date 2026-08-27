import { transcribe } from '@/lib/quillbot'
import { getTimeoutMs } from '@/lib/settings'
import type { Request, TranscribeResult } from '@/types/messages'

console.log(`[WAVT] service worker init — v${__VERSION__}, built ${__BUILD_TIME__}`)

/**
 * A relay for one cross-origin POST, and deliberately nothing more.
 *
 * The content script holds the audio, the message identity and the transcript
 * cache. All that is left here is the QuillBot call, which has to happen off the
 * page because WhatsApp's CSP will not let the page make it.
 */
export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
    if (message.type !== 'TRANSCRIBE') return false

    // The deadline is read per request rather than cached: the worker outlives
    // any one transcription, and a value changed in the popup should apply to
    // the next click without waiting for a restart.
    getTimeoutMs()
      .then((timeoutMs) => transcribe(message.audioBase64, navigator.language, timeoutMs))
      .then(
        (text) => sendResponse({ ok: true, text } satisfies TranscribeResult),
        (e: unknown) =>
          sendResponse({ ok: false, error: (e as Error).message } satisfies TranscribeResult),
      )
    return true
  })
})
