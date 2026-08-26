/**
 * Message protocol.
 *
 *   whatsapp content script  →  background   TRANSCRIBE
 *
 * One message, because the content script does almost everything itself. It can:
 * it runs on web.whatsapp.com, so the page's IndexedDB and Cache Storage — where
 * the decrypted clip already sits — are same-origin to it, and `chrome.storage`
 * is available to content scripts directly.
 *
 * The single thing it cannot do is POST to QuillBot: WhatsApp's
 * `connect-src` CSP blocks it (verified — a page-context fetch fails outright).
 * So the worker exists to make that one cross-origin call under
 * `host_permissions`, and nothing else.
 */

export type Request = {
  type: 'TRANSCRIBE'
  /** The clip's bytes, base64. Already base64 because that is what QuillBot takes. */
  audioBase64: string
}

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string }
