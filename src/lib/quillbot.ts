/**
 * Speech-to-text via QuillBot's own web-app endpoint.
 *
 * No API key, no account, no sign-in, and it takes the clip as bytes — which is
 * what makes the rest of this extension small. WhatsApp voice notes are
 * Ogg/Opus; QuillBot accepts them as-is, so there is no transcoding, no
 * `AudioContext`, and no offscreen document. Verified end to end against a real
 * WhatsApp clip before any of this was written.
 *
 * Only `content-type` is actually required. `origin` and `platform-type` are
 * sent by QuillBot's own frontend and were verified to be unnecessary — the
 * endpoint answers a `chrome-extension://` origin the same way — so no
 * `declarativeNetRequest` header rewriting is involved.
 *
 * Found in this repo's sibling `reap-agent`, which uses the same endpoint
 * server-side (`app/services/stt_correction.py`).
 */

const ENDPOINT = 'https://quillbot.com/api/raven/stt/process-recording'

/** Mirrors reap-agent's fallback when the browser gives something unusable. */
const DEFAULT_LANGUAGE = 'en'
const DEFAULT_DIALECT = 'US'

interface QuillBotResponse {
  success?: boolean
  message?: string
  data?: { raw?: string; timestamps?: unknown[] }
}

/** `en-GB` → `{ language: 'en', dialect: 'GB' }`, falling back to en/US. */
export function splitLocale(locale: string | undefined): { language: string; dialect: string } {
  const [language, region] = (locale ?? '').split('-')
  if (!language || language.length !== 2) {
    return { language: DEFAULT_LANGUAGE, dialect: DEFAULT_DIALECT }
  }
  return {
    language: language.toLowerCase(),
    dialect: region && region.length === 2 ? region.toUpperCase() : DEFAULT_DIALECT,
  }
}

/**
 * `audioBase64` arrives already encoded: the content script reads the clip and
 * has to base64 it anyway to send it across `chrome.runtime.sendMessage`, which
 * serialises as JSON and would mangle an ArrayBuffer.
 */
export async function transcribe(
  audioBase64: string,
  locale: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const { language, dialect } = splitLocale(locale)

  // Without a deadline a stalled request never ends: nothing else in the chain
  // has a timeout either, so the button sits on "Transcribing…" until the page
  // is reloaded. `timedOut` rather than sniffing for `AbortError`, so only *our*
  // abort is reported as a timeout.
  const controller = new AbortController()
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let body: QuillBotResponse
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        audioData: audioBase64,
        // Kept at 'timestamp' to match what the endpoint's own callers send; the
        // timestamps themselves are ignored, only `data.raw` is used.
        mode: 'timestamp',
        language,
        dialect,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`Transcription service returned HTTP ${res.status}.`)
    }

    // Inside the deadline as well: a response whose body never finishes arriving
    // hangs exactly as thoroughly as one that never starts.
    body = (await res.json()) as QuillBotResponse
  } catch (e) {
    if (timedOut) {
      throw new Error(
        `Transcription timed out after ${Math.round(timeoutMs / 1000)}s. Try again, ` +
          'or raise the timeout from the extension’s toolbar icon.',
      )
    }
    throw e
  } finally {
    // Cleared on every path, so a completed request leaves no timer behind to
    // fire later and keep the worker alive for nothing.
    clearTimeout(deadline)
  }

  const raw = body.data?.raw
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(
      body.success === false && body.message
        ? `Transcription failed: ${body.message}`
        : 'No speech was recognised in this clip.',
    )
  }
  return raw.trim()
}
