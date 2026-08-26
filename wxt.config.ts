import { mkdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'wxt'

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  srcDir: 'src',
  webExt: {
    chromiumProfile: chromeProfile,
    keepProfileChanges: true,
    chromiumArgs: ['--hide-crash-restore-bubble'],
  },
  vite: () => ({
    define: {
      __VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      // Loaded unpacked, never from the Web Store, so bundle size buys nothing
      // — and readable output means the voice-message handling is auditable.
      minify: false,
    },
  }),
  manifest: {
    name: 'WA Voice Transcriber',
    description: 'Transcribe WhatsApp Web voice messages in place',
    // `storage` holds the transcript cache, without which scrolling loses every
    // transcript. That is the whole list.
    //
    // Note what is absent. There is no `webRequest`, no `tabs`, and no host
    // permission for WhatsApp's media CDN — because the clip is never fetched
    // from the network. WhatsApp has already downloaded and decrypted it into
    // the page's own Cache Storage, and the content script reads it from there.
    // See src/lib/voice-media.ts.
    permissions: ['storage'],
    // The transcription endpoint, and the only host this extension talks to.
    host_permissions: ['https://quillbot.com/*'],
    icons: {
      16: 'assets/icon-16.png',
      32: 'assets/icon-32.png',
      48: 'assets/icon-48.png',
      128: 'assets/icon-128.png',
    },
  },
})
