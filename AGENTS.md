use bun for package management

use bun typecheck

be concise

### Threat model

This is a **personal tool**. It runs in the user's browser, with the user's own
session, against data the user can already read. There is no untrusted-model
boundary and no multi-tenant server.

Do not flag as security issues: reading WhatsApp's own IndexedDB and Cache
Storage from a content script on `web.whatsapp.com`, or the `storage`
permission. Those are the mechanism, not a lapse.

Do flag the one real trade-off: voice clips leave the machine. They go to
QuillBot. That is other people's private messages, and it should stay stated in
the README.

### How the audio is obtained

**From WhatsApp's own decrypted-media cache. Nothing is downloaded and nothing
is decrypted.** See `src/lib/voice-media.ts`.

WhatsApp auto-downloads incoming voice notes, decrypts them in the page, and
parks the plaintext Ogg/Opus in Cache Storage under
`lru-media-array-buffer-cache`, keyed by the message's `filehash` field
(URL-encoded). `filehash` is the SHA-256 of the decrypted file, so a read-back
verifies itself — checked against every cached clip in a real profile.

Measured on a real profile: 173 of 181 voice notes were present. All eight
misses were the user's own recordings, which are uploaded rather than
downloaded and so are never decrypted on this machine. Every incoming note was
there.

Two approaches were tried and rejected, so don't re-propose them:

- **Fetch `directPath` from `mmg.whatsapp.net` and decrypt it** (HKDF-SHA256
  over `mediaKey` with info `WhatsApp Audio Keys`, then AES-256-CBC). The
  scheme is right, but the signed URL expires roughly 30 days after the
  message — `oe=` in the query string — and every stored URL past that answers
  `403 URL signature expired`. This is not something we can work around: real
  WhatsApp fails identically. Playing a four-month-old note in the actual client
  re-requests the byte-identical expired URL and gets the same 403. Adding the
  crypto would buy only clips that are both recent *and* uncached, which is
  close to the empty set, at the cost of a decryption path we would have to get
  right.
- **`webRequest` observation of the media fetch**, the way the Instagram sibling
  learns its URLs. Pointless here twice over: the bytes on the wire are
  ciphertext, and WhatsApp only requests a clip it has not already cached — so
  anything `webRequest` could see is a clip we already have locally.

### Message identity

WhatsApp puts the message id straight on the row: `data-id="ACBA313E…"`. That is
the join key for both the local message database and the transcript cache.
Nothing is inferred from duration or DOM order — if you have read the Instagram
sibling's `audio-registry.ts`, none of that machinery is needed here, and it
should not be reintroduced.

The DOM carries the bare hash while the database keys on
`<fromMe>_<chatJid>_<hash>`, so lookups match on the last underscore-separated
field. Keep the separator in the match; a bare `includes` could match a hash
inside a chat's JID and hand back another conversation's audio.

### The transcript cache must be checkable

Transcripts are keyed by message id **and** stamped with the `filehash` of the
audio they were made from; `get` refuses an entry whose stamp does not match the
message's current audio. Do not "simplify" that away.

The reason is a real observed failure. A profile was found with one voice note
displaying the neighbouring message's transcript — persistently, surviving a full
reload, so it was in storage and not a DOM artefact. Everything else checked out:
the id join was exact, the cached bytes hash-verified against `filehash`, the
decoded audio length matched WhatsApp's own slider to 0.01s, QuillBot proved
deterministic on repeat calls, and four concurrent transcriptions came back
correctly paired. The write path could not be made to reproduce it.

That is the point. A cache keyed on identity alone cannot be audited, so a bad
entry — from a race, an earlier build, whatever — is indistinguishable from a
good one and is served with full confidence forever. Keying on content makes it
self-healing: the entry is re-derived once. Entries with no stamp are treated as
unverifiable and re-derived too.

For the same reason `loadClipBase64` hashes the bytes it pulls from Cache Storage
and refuses them if they do not match the `filehash` they were looked up under.
`filehash` is the SHA-256 of the decrypted file, so this is free to check and it
keeps the wrong clip from ever reaching the recognizer.

### Never create WhatsApp's storage either

`indexedDB.open(name)` with no version *creates* a database that is not there, so
`voice-media.ts` checks `indexedDB.databases()` before opening and aborts the
version-change transaction if `onupgradeneeded` fires anyway. Planting an empty
`model-storage` in front of WhatsApp's own is the same intrusion as clearing one.
Do not drop either guard on the grounds that the database "is always there".

### Locale-neutral selectors, English as fallback

Clip discovery keys on `data-icon="ptt-status"` and `role="slider"`, not on
aria-label text. The English labels remain as a *fallback* only, so a WhatsApp
rename of `ptt-status` degrades to English-only rather than to nothing. Don't
promote the labels back to primary, and don't delete the fallback — they cover
different failure modes. `src/lib/clips.test.ts` pins both paths, including a
German-interface case.

### Never clear WhatsApp's own storage

`clearAll` touches only this extension's `transcript:` keys in
`chrome.storage.local`. WhatsApp's IndexedDB (`model-storage`) and its media
cache (`lru-media-array-buffer-cache`) are read-only to this extension. They are
WhatsApp's copy of the user's messages; clearing them would damage the account's
local state and would destroy the very audio the extension depends on, to no
purpose — every transcript we hold is re-derivable by pressing Transcribe. A
request to "clear everything" means our cache, not theirs.

### DOM blocks are stamped with their message id

WhatsApp virtualises the thread and React owns the markup, so a row element can
be re-used for a different message. `scan` therefore compares the injected
block's `data-wavt-id` against the row's current `data-id` and remounts on a
mismatch. Asking only "is a block already here?" is what lets a recycled row keep
another message's transcript, with nothing able to detect it.

### Speech-to-text

`https://quillbot.com/api/raven/stt/process-recording`, posted from the service
worker. No API key, no account, no sign-in. It takes the clip as base64 bytes
and returns `data.raw`. It accepts WhatsApp's Ogg/Opus as-is — verified against
a real clip — so there is no transcoding and no `AudioContext`.

Found via the sibling `reap-agent`, which uses the same endpoint server-side
(`app/services/stt_correction.py`).

Only `content-type: application/json` is required. QuillBot's own frontend also
sends `origin` and `platform-type`, but both were verified unnecessary — the
endpoint answers a `chrome-extension://` origin identically — so there is no
`declarativeNetRequest` header rewriting here. Don't add any back without
evidence it is needed.

The worker exists **only** for this call. WhatsApp's `connect-src` CSP blocks a
page-context fetch to QuillBot (verified: it fails outright), so the POST has to
happen off the page under `host_permissions`. Everything else — the DOM, the
message database, the media cache, `chrome.storage` — the content script does
itself.
