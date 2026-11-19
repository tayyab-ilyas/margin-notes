# Demo video

Two ways to make the demo. Both use the same article, `record/site.mjs`.

## The README demo (`motion/`)

`docs/demo.mp4` comes from [motion/index.html](motion/index.html). It is a single HTML page animated with GSAP. The extension's UI (selection toolbar, note popover, snip, side panel, library) is rebuilt in HTML using the real styles. A generic chat app then asks the library a question through the MCP server's `search_notes` tool. The music and sound effects are synthesized in the page with Web Audio, so there are no audio files and nothing to license.

- **Watch it:** open `motion/index.html` in a browser. It autoplays with sound and loops. Space pauses, R restarts, and `?debug=1` adds a scrub bar.
- **Export it:** `node motion/render.mjs mp4` renders every frame in headless Edge and writes `out/margin-notes-yc.mp4` with the audio (about 2 minutes). It uses the ffmpeg that ships with Remotion, so run `npm install` first.
- **Check frames:** `node motion/render.mjs snap 5 13 30` saves stills at those seconds and a contact sheet at `out/sheet.png`.

Timing, camera moves and on-screen lines are in the `build()` function, one block per beat. The score and sound effects are in `buildAudio()`.

## Screen recording edit (Remotion)

Records the real extension in headless Edge, then edits the recording into an MP4 with [Remotion](https://www.remotion.dev/).

```sh
npm install
npm run record   # builds the extension, records into public/rec/ (about a minute)
npm run render   # writes out/margin-notes-demo.mp4
```

`npm run studio` opens a live preview. Captions, zooms and timing are in `src/Video.tsx`.
