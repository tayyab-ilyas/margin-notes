// Renders motion/index.html frame by frame (deterministic seek, so no dropped frames).
//   node motion/render.mjs snap 1 5 12        -> out/snaps/t1_00.png ... (quick visual check)
//   node motion/render.mjs mp4 [fps]          -> out/margin-notes-yc.mp4 with the page's own audio
// Uses Edge (BROWSER_PATH to override) and the ffmpeg that ships with @remotion/compositor.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const DIR = import.meta.dirname;
const OUT = join(DIR, '..', 'out');
const BROWSER = process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FFMPEG = join(DIR, '..', 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
const [mode = 'snap', ...rest] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--hide-scrollbars', '--force-device-scale-factor=1'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(DIR, 'index.html')).href + '?clean=1', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.OPENER && window.OPENER.ready && window.OPENER.audioReady', { timeout: 60000 });
const seek = (t) => page.evaluate(async (t) => {
  window.OPENER.seek(t);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.OPENER.seek(t);
}, t);

if (mode === 'snap') {
  const dir = join(OUT, 'snaps');
  mkdirSync(dir, { recursive: true });
  for (const ts of rest) {
    await seek(Number(ts));
    await page.screenshot({ path: join(dir, `t${Number(ts).toFixed(2).replace('.', '_')}.png`) });
    process.stdout.write(ts + ' ');
  }
  // contact sheet: 3 per row, labelled with the time
  const cells = rest.map((ts) => `<figure><img src="${pathToFileURL(join(dir, `t${Number(ts).toFixed(2).replace('.', '_')}.png`)).href}"><figcaption>${ts}s</figcaption></figure>`).join('');
  const rows = Math.ceil(rest.length / 3);
  await page.setViewport({ width: 1920, height: rows * 362 });
  await page.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(3,640px);background:#222}figure{margin:0;position:relative}img{width:640px;height:360px;display:block;border:1px solid #444}figcaption{position:absolute;left:6px;top:4px;color:#fff;background:#000a;font:16px sans-serif;padding:2px 6px}</style>${cells}`, { waitUntil: 'load' });
  await page.screenshot({ path: join(OUT, 'sheet.png'), fullPage: true });
} else {
  if (!existsSync(FFMPEG)) throw new Error(`ffmpeg not found at ${FFMPEG}; run npm install in demo-video/`);
  const fps = Number(rest[0] ?? 30);
  const dur = await page.evaluate(() => window.OPENER.DURATION);
  const wav = join(OUT, 'margin-notes-yc.wav');
  writeFileSync(wav, Buffer.from(await page.evaluate(() => window.OPENER.audioWav()), 'base64'));
  const mp4 = join(OUT, 'margin-notes-yc.mp4');
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-', '-i', wav,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4],
  { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c ? rej(new Error('ffmpeg exited ' + c)) : res())));
  const n = Number(process.env.FRAMES ?? Math.round(dur * fps));
  for (let f = 0; f < n; f++) {
    await seek(f / fps);
    const img = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % fps === 0) process.stdout.write(`\r${(f / fps).toFixed(0)}/${dur}s`);
  }
  ff.stdin.end();
  await done;
  console.log(`\nwrote ${mp4}`);
}
await browser.close();
