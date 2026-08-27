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
 * The clip is found by two locale-neutral landmarks: `data-icon="ptt-status"`,
 * which WhatsApp puts on voice notes and nothing else, and the `role="slider"`
 * progress bar inside that row. Neither depends on the interface language.
 *
 * The English aria-labels are kept only as a fallback, for the case where
 * WhatsApp renames or drops `ptt-status`. That keeps a rename from silently
 * finding nothing, at the cost of a path that works in English alone — which is
 * strictly better than the labels being the only route, and is why the fallback
 * is not the primary.
 */

/** Voice notes carry this and other messages do not. Language-independent. */
const PTT_MARKER = '[data-icon="ptt-status"]'
const SLIDER = '[role="slider"]'
/** Fallbacks, used only when `ptt-status` is absent. English-only by nature. */
const SLIDER_LABEL = 'Voice note progress slider'
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
 * The landmark is the playback-speed control, because it is the thing that forces
 * this high enough. The nearest ancestor holding the waveform and the transport
 * button sits three levels lower, and anything appended there is laid out beside
 * the waveform instead of under the player. The speed control lives in a sibling
 * subtree, so the first ancestor containing it is exactly the full player row.
 *
 * `ptt-status` is that control's own icon, so it locates the same element without
 * reading a label.
 *
 * It deliberately does **not** look for a play button. A voice note whose audio
 * has not been fetched yet shows `Download voice message` instead of
 * `Play voice message`, so requiring a play button silently skipped every
 * undownloaded clip — no control, no explanation. The speed control is present in
 * both states.
 *
 * Verified against the live DOM in both states: this returns an element that is
 * the first of exactly two children, the second being the message's timestamp
 * and delivery ticks.
 */
function playerRowFor(slider: Element, row: Element): HTMLElement | null {
  const anchor =
    row.querySelector(PTT_MARKER) ??
    [...row.querySelectorAll('button')].find((b) =>
      SPEED_BUTTON_LABEL.test(b.getAttribute('aria-label') ?? ''),
    ) ??
    null
  if (!anchor) return null

  let node = slider.parentElement
  for (let hop = 0; hop < 12 && node && node !== row; hop++) {
    if (node.contains(anchor)) return node
    node = node.parentElement
  }
  return null
}

/**
 * Is this row a voice note?
 *
 * `ptt-status` decides it when present; otherwise the slider's English label is
 * the only thing left to go on. Without one of the two a bare `role="slider"`
 * could be some other media control, and mounting a Transcribe button on it
 * would be wrong.
 */
function isVoiceNote(row: Element, slider: Element): boolean {
  if (row.querySelector(PTT_MARKER)) return true
  return slider.getAttribute('aria-label') === SLIDER_LABEL
}

/** Every voice clip currently rendered in the thread, in DOM order. */
export function findClips(root: ParentNode = document): FoundClip[] {
  const found: FoundClip[] = []

  for (const slider of root.querySelectorAll(SLIDER)) {
    const row = slider.closest('[data-id]')
    const messageId = row?.getAttribute('data-id')
    if (!row || !messageId) continue
    if (!isVoiceNote(row, slider)) continue

    const playerRow = playerRowFor(slider, row)
    if (!playerRow) continue

    found.push({ messageId, playerRow })
  }

  return found
}
