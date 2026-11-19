# Demo video

Records the real extension in headless Edge, then edits it into an MP4 with [Remotion](https://www.remotion.dev/).

```sh
npm install
npm run record   # builds the extension, records into public/rec/ (about a minute)
npm run render   # writes out/margin-notes-demo.mp4
```

`npm run studio` opens a live preview. Captions, zooms and timing are in `src/Video.tsx`; the demo article is `record/site.mjs`.
