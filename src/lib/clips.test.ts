/// <reference types="bun" />
import { GlobalRegistrator } from '@happy-dom/global-registrator'
GlobalRegistrator.register()

import { afterEach, describe, expect, test } from 'bun:test'
import { findClips } from './clips'

/**
 * Clip discovery, against the markup shape read off the live DOM.
 *
 * The structure below is the one that matters and the reason `playerRowFor`
 * cannot simply take the slider's parent: the transport button and waveform sit
 * three levels below the row that also holds the speed control, and the speed
 * control is in a *sibling* subtree. Anything mounted at the lower level lands
 * beside the waveform instead of under the player.
 */
function bubble({
  id,
  transportLabel,
  sliderLabel = 'Voice note progress slider',
  speedLabel = 'Change playback speed, currently 1×',
  pttIcon = true,
}: {
  id: string
  transportLabel: string
  sliderLabel?: string
  speedLabel?: string
  pttIcon?: boolean
}): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-id', id)
  row.innerHTML = `
    <div class="content">
      <div class="player">
        <div class="transport-and-wave">
          <button aria-label="${transportLabel}"></button>
          <div><div role="slider" aria-label="${sliderLabel}" aria-valuemax="3.7"></div></div>
        </div>
        <button aria-label="${speedLabel}">
          <div>1×${pttIcon ? '<span data-icon="ptt-status"></span>' : ''}</div>
        </button>
      </div>
      <div class="meta">2:36 PM</div>
    </div>`
  document.body.appendChild(row)
  return row
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('findClips', () => {
  test('finds a downloaded voice note', () => {
    bubble({ id: 'ACBA313E', transportLabel: 'Play voice message' })
    const clips = findClips()
    expect(clips).toHaveLength(1)
    expect(clips[0]!.messageId).toBe('ACBA313E')
  })

  // The bug that started this: an undownloaded clip shows Download, not Play,
  // and requiring a play button skipped it silently.
  test('finds a voice note that has not been downloaded yet', () => {
    bubble({ id: '3EB0F04336EAA70631BFDF', transportLabel: 'Download voice message' })
    expect(findClips().map((c) => c.messageId)).toEqual(['3EB0F04336EAA70631BFDF'])
  })

  // The whole point of keying on `ptt-status`: a translated interface must work.
  test('finds a voice note in a non-English interface', () => {
    bubble({
      id: 'ACGERMAN',
      transportLabel: 'Sprachnachricht abspielen',
      sliderLabel: 'Fortschritt der Sprachnachricht',
      speedLabel: 'Wiedergabegeschwindigkeit ändern, aktuell 1×',
    })
    expect(findClips().map((c) => c.messageId)).toEqual(['ACGERMAN'])
  })

  // Fallback path: if WhatsApp drops `ptt-status`, English still resolves.
  test('falls back to the English labels when ptt-status is gone', () => {
    bubble({ id: 'ACNOICON', transportLabel: 'Play voice message', pttIcon: false })
    expect(findClips().map((c) => c.messageId)).toEqual(['ACNOICON'])
  })

  // With neither landmark there is nothing to prove it is a voice note, and a
  // bare role=slider could be some other media control.
  test('ignores a slider that is neither marked nor labelled as a voice note', () => {
    bubble({
      id: 'ACUNKNOWN',
      transportLabel: 'Abspielen',
      sliderLabel: 'Fortschritt',
      pttIcon: false,
    })
    expect(findClips()).toEqual([])
  })

  test('mounts between the player and the timestamp', () => {
    bubble({ id: 'ACPLACE', transportLabel: 'Play voice message' })
    const { playerRow } = findClips()[0]!
    const siblings = [...playerRow.parentElement!.children]
    expect(siblings[0]).toBe(playerRow)
    expect(siblings).toHaveLength(2)
    expect(siblings[1]!.textContent).toContain('2:36 PM')
  })

  test('finds several clips in DOM order', () => {
    bubble({ id: 'AC1', transportLabel: 'Play voice message' })
    bubble({ id: 'AC2', transportLabel: 'Download voice message' })
    bubble({ id: 'AC3', transportLabel: 'Play voice message' })
    expect(findClips().map((c) => c.messageId)).toEqual(['AC1', 'AC2', 'AC3'])
  })

  test('ignores a message row with no slider at all', () => {
    const row = document.createElement('div')
    row.setAttribute('data-id', 'ACTEXT')
    row.innerHTML = '<div>just text</div>'
    document.body.appendChild(row)
    expect(findClips()).toEqual([])
  })
})
