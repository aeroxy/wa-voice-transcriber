<p align="center">
  <img src="public/assets/icon-128.png" width="96" height="96" alt="">
</p>

<h1 align="center">WA Voice Transcriber</h1>

<p align="center">
  Transcribes WhatsApp Web voice messages in place, reading the clip WhatsApp
  has already downloaded and decrypted.
</p>

<p align="center">
  <em>No account, no API key, nothing to sign into.</em>
</p>

## Why

Voice notes are tedious to sit through, and WhatsApp Web gives you no way out of
listening: every voice-note bubble inspected while building this carried a
player, a duration and a speed control, and nothing else. No transcript, and
nothing to press to get one.

So the extension adds one, and when it cannot transcribe a clip it says why.

WhatsApp does have voice-message transcripts, but they are a *phone* feature: per
[WhatsApp's FAQ](https://faq.whatsapp.com/), you turn them on in the mobile app
under Settings → Chats → Voice message transcripts, transcription runs on-device,
it is off by default, and which languages work depends on the phone's OS. There
is nothing to switch on in the browser.

On the phone this extension was built alongside, that feature is unavailable —
which is why the extension exists. Whether a transcript made on a phone that
*can* transcribe then propagates to Web is therefore untested here: there was
never one to propagate. If yours transcribes, check the Web client before
installing this; you may need it less than the rest of this README assumes.

It works on any voice note whose audio WhatsApp has already cached on this device
and whose player this extension recognises in the page. Both caveats are real and
are spelled out under [Limits](#limits): a clip WhatsApp never downloaded has no
local audio, and the player is located by DOM landmarks that a WhatsApp redesign
could move.

## How it works

The interesting part is where the audio comes from.

**Not from the network.** WhatsApp serves voice notes as `.enc` — AES-256-CBC
under a per-message `mediaKey` — so the bytes on the wire are useless on their
own. Worse, the signed URL that serves them expires about 30 days after the
message. Past that, every stored URL answers `403 URL signature expired`, and
not just to us: play a four-month-old note in real WhatsApp and it re-requests
the byte-identical expired URL and fails the same way.

**From WhatsApp's own cache instead.** WhatsApp auto-downloads incoming voice
notes, decrypts them in the page, and parks the plaintext Ogg/Opus in Cache
Storage:

```text
caches.match('https://_media_cache_v2_.whatsapp.com/lru-media-array-buffer-cache_<filehash>',
             { cacheName: 'lru-media-array-buffer-cache' })
```

`<filehash>` is the message's own `filehash` field, URL-encoded — the SHA-256 of
the decrypted file, which is what makes it a safe key: read the entry back, hash
it, and it must equal the field you looked it up with.

Because the content script runs on `web.whatsapp.com`, that cache and WhatsApp's
message database are both same-origin to it. So there is no `webRequest`, no
`tabs`, no host permission for WhatsApp's CDN, no HKDF, no AES — and no expiry.
A clip from last year transcribes as readily as one from this morning.

**Message identity is free.** WhatsApp puts it on the row:
`data-id="ACBA313E…"`. That is the join key into both the message database and
the transcript cache. Nothing is inferred from clip duration or DOM order.

**Keeping the transcript.** WhatsApp virtualises the thread, so scrolling a clip
out of view destroys the bubble and everything injected into it. Transcripts are
cached against the message id and restored when the bubble comes back.

Each cached transcript also records the `filehash` of the audio it was made from,
and is discarded if that no longer matches the message's current audio. A cache
keyed on identity alone cannot be audited, so one bad entry would be served with
full confidence forever; keying on content means it is re-derived instead. The
bytes pulled from Cache Storage are hash-checked against the same field before
being sent anywhere, so the wrong clip cannot reach the recognizer.

**Transcribing it.** `POST` the bytes to
`https://quillbot.com/api/raven/stt/process-recording` and read `data.raw`. No
key, no account, and it takes Ogg/Opus as-is, so there is no transcoding. It is
the one thing the content script cannot do — WhatsApp's `connect-src` CSP blocks
it — so the service worker exists to make that single call and nothing else.

Every transcript keeps a **Retranscribe** control beneath it, which ignores the
cache and asks again — useful when a short clip came back wrong. The toolbar icon
opens a popup with the **transcription timeout**, how many transcripts are
cached, and a two-press **Clear all transcripts**.

| File | Role |
| --- | --- |
| `src/entrypoints/whatsapp.content.ts` | Finds clips, injects the button, renders transcripts |
| `src/entrypoints/popup/` | Transcription timeout, cached count, Clear all |
| `src/lib/settings.ts` | The request deadline, clamped to something usable |
| `src/lib/voice-media.ts` | Message id → decrypted clip, out of WhatsApp's own cache |
| `src/lib/clips.ts` | Voice-clip discovery in WhatsApp's markup |
| `src/lib/transcript-store.ts` | Caches transcripts so scrolling doesn't lose them |
| `src/entrypoints/background.ts` | The one cross-origin POST the page may not make |
| `src/lib/quillbot.ts` | Bytes → text |

## Setup

```bash
bun install
bun run build
```

Load `.output/chrome-mv3` unpacked. There is nothing to configure and nothing to
sign into — Transcribe links appear under every voice message on
`web.whatsapp.com`.

For development, `bun run dev` launches a browser with the extension loaded.
That browser has its own profile, so it needs WhatsApp linked once by QR.

## The trade-off

Voice clips are uploaded to QuillBot. They are other people's private messages;
decide whether that's acceptable before using this.

## Limits

- **A clip WhatsApp never downloaded has no local audio**, and the extension says
  so rather than guessing. In practice this means your own recordings: they are
  uploaded, not downloaded, so they are never decrypted on this machine. On a
  real profile, 173 of 181 voice notes were available — and all eight misses
  were the user's own. Such a clip shows a download arrow instead of a play
  button in WhatsApp; downloading or playing it once makes it available here too,
  provided its media has not aged out of WhatsApp's servers.
- The media cache is an LRU. A clip old enough to have been evicted is gone, and
  since its CDN URL has long expired there is no way back to it.
- Language follows the browser's locale (`en-GB` → language `en`, dialect `GB`),
  falling back to `en`/`US`. A clip in another language will transcribe poorly.
- No known size limit for the endpoint. Long voice notes are untested — which is
  why the request deadline is a setting rather than a constant. It defaults to 60
  seconds and is adjustable from 10 to 600 in the popup: a long clip is a lot of
  audio to upload and recognise, and no single value suits both that and failing
  fast on a stalled request.
- **Clear all** removes only this extension's cached transcripts. WhatsApp's own
  IndexedDB and media cache are read-only to this extension and are never
  cleared — wiping them would damage the account's local state, and the
  transcripts are re-derivable anyway.
- The player is found by `data-icon="ptt-status"` and the `role="slider"`
  progress bar, neither of which depends on the interface language. WhatsApp's
  English `aria-label`s are kept only as a fallback for the case where
  `ptt-status` is renamed or dropped — so a rename degrades to English-only
  rather than to nothing.
