/**
 * Finding voice messages in a WhatsApp thread.
 *
 * WhatsApp is kinder here than it looks. Every message row carries its own id:
 *
 *   <div data-id="ACBA313EAF8FB4BFDE52D27B7CF949A2"> … </div>
 *
 * That is the message's real identity — stable, unique, and the join key into
 * both the local message database and the transcript cache. Nothing has to be
 * inferred from clip duration or DOM ordering.
 *
 * Two shapes turn up and both are opaque: a 32-hex form for messages received
 * (`ACBA313E…`) and a shorter form for ones this account originated
 * (`3EB0F04336EAA70631BFDF`). Nothing here parses either — they are matched whole
 * against the tail of the database key — so a third shape would cost nothing.
 *
 * The clip itself is found by the progress bar's aria-label. That is an English
 * string, which would normally be a bad landmark, but WhatsApp's class names are
 * generated and the player carries no other stable marker. It is checked against
 * `role="slider"` so a stray label alone cannot match.
 */

const SLIDER = '[role="slider"][aria-label="Voice note progress slider"]'
const SPEED_BUTTON_LABEL = /playback speed/i

export interface FoundClip {
  /** The `data-id` of the message row — its id in WhatsApp's own database. */
  messageId: string
  /**
   * The player row. The transcript is inserted directly *after* it, which lands
   * it between the player and the timestamp rather than below both.
   */
  playerRow: HTMLElement
}

/**
 * The row holding the whole player: the transport button, waveform, duration and
 * the playback-speed control.
 *
 * The playback-speed button is the landmark, and it is the *only* one, because it
 * is the thing that forces this high enough. The nearest ancestor holding the
 * waveform and the transport button sits three levels lower, and anything
 * appended there is laid out beside the waveform instead of under the player.
 * The speed control lives in a sibling subtree, so the first ancestor containing
 * it is exactly the full player row.
 *
 * It deliberately does **not** look for a play button. A voice note whose audio
 * has not been fetched yet shows `Download voice message` instead of
 * `Play voice message`, so requiring a play button silently skipped every
 * undownloaded clip — no control, no explanation. The speed button is present in
 * both states.
 *
 * Verified against the live DOM in both states: this returns an element that is
 * the first of exactly two children, the second being the message's timestamp
 * and delivery ticks.
 */
function playerRowFor(slider: Element, row: Element): HTMLElement | null {
  const speed = [...row.querySelectorAll('button')].find((b) =>
    SPEED_BUTTON_LABEL.test(b.getAttribute('aria-label') ?? ''),
  )
  if (!speed) return null

  let node = slider.parentElement
  for (let hop = 0; hop < 12 && node && node !== row; hop++) {
    if (node.contains(speed)) return node
    node = node.parentElement
  }
  return null
}

/** Every voice clip currently rendered in the thread, in DOM order. */
export function findClips(root: ParentNode = document): FoundClip[] {
  const found: FoundClip[] = []

  for (const slider of root.querySelectorAll(SLIDER)) {
    const row = slider.closest('[data-id]')
    const messageId = row?.getAttribute('data-id')
    if (!row || !messageId) continue

    const playerRow = playerRowFor(slider, row)
    if (!playerRow) continue

    found.push({ messageId, playerRow })
  }

  return found
}
