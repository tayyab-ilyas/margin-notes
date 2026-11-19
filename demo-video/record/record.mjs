import http from 'node:http';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { MAIN, EXTRA } from './site.mjs';
import { shadowButton, textRect } from '../../scripts/page-helpers.mjs';

// Records the real extension driving a demo article, as screencast frames for the Remotion video.
// Usage: npm run record (in demo-video/), which builds the extension first.
const BROWSER = process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = join(import.meta.dirname, '..', '..');
const EXT = join(ROOT, '.output', 'chrome-mv3');
// Record into rec-new/ and swap it in only on success, so a failed run keeps the last good recording.
const DONE = join(import.meta.dirname, '..', 'public', 'rec');
const OUT = `${DONE}-new`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const PAGE = { width: 1380, height: 912 };
const PANEL = { width: 420, height: 912 };
const LIB = { width: 1800, height: 912 };

const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(EXTRA[path] ?? MAIN);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// Fictional domain (reserved .example TLD) mapped to the local server, so the UI shows a realistic site name.
const HOST = 'slowreader.example';
const ORIGIN = `http://${HOST}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Fake cursor drawn into the page, since headless screencasts have no pointer.
const CURSOR = () => {
  const mk = () => {
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.style.cssText =
      'all:initial;position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))';
    c.innerHTML =
      '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13 17 L21 17 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const top = () => c.nextSibling && document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { top(); c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = `all:initial;position:fixed;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,.35);z-index:2147483646;pointer-events:none`;
      document.documentElement.appendChild(r);
      r.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.4)', opacity: 0 }], { duration: 450 }).onfinish = () => r.remove();
    }, true);
  };
  if (document.documentElement) mk();
  else addEventListener('DOMContentLoaded', mk);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  pipe: true,
  enableExtensions: [EXT],
  args: [`--host-resolver-rules=MAP ${HOST}:80 127.0.0.1:${server.address().port}`, '--window-size=1900,1100', '--no-first-run', '--hide-scrollbars'],
});

let T0 = 0;
const marks = [];
const mark = (name, extra = {}) => {
  marks.push({ name, t: Date.now() - T0, ...extra });
  console.log(`${String(Date.now() - T0).padStart(6)}ms  ${name}`);
};

async function record(page, name) {
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const s = await page.createCDPSession();
  const frames = [];
  let n = 0;
  s.on('Page.screencastFrame', ({ data, sessionId }) => {
    const f = `${n++}.jpg`;
    writeFileSync(join(dir, f), Buffer.from(data, 'base64'));
    frames.push([Date.now() - T0, f]);
    s.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const opts = { format: 'jpeg', quality: 88, everyNthFrame: 1 };
  await s.send('Page.startScreencast', opts);
  const stop = async () => {
    await s.send('Page.stopScreencast').catch(() => {});
    return frames;
  };
  // Screencast goes silent after a reload, so take screenshots directly for a while instead.
  stop.poll = async (ms) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      const f = `${n++}.jpg`;
      writeFileSync(join(dir, f), await page.screenshot({ type: 'jpeg', quality: 88 }));
      frames.push([Date.now() - T0, f]);
    }
  };
  return stop;
}

function pointer(page, start = { x: 700, y: 500 }) {
  let cur = { ...start };
  const glide = async (x, y, ms = 650) => {
    const from = cur;
    const steps = Math.max(10, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      await sleep(ms / steps);
    }
    cur = { x, y };
  };
  return {
    glide,
    async click(x, y, ms) {
      await glide(x, y, ms);
      await sleep(120);
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
    },
    async drag(a, b, ms = 900) {
      await glide(a.x, a.y);
      await sleep(150);
      await page.mouse.down();
      await glide(b.x, b.y, ms);
      await page.mouse.up();
    },
    show: () => page.mouse.move(cur.x, cur.y),
  };
}

const button = async (page, title) => (await shadowButton(page, 'title', title)) ?? Promise.reject(new Error(`no button "${title}"`));
const ends = (r) => [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 }];

const smoothScroll = (page, y) =>
  page.evaluate((top) => new Promise((r) => { scrollTo({ top, behavior: 'smooth' }); setTimeout(r, 900); }), y);

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const sw = await swTarget.worker();
  const extId = new URL(swTarget.url()).host;

  const [page] = await browser.pages();
  await page.setViewport({ ...PAGE});
  page.on('dialog', (d) => d.accept());
  const tabOf = (u) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url.startsWith(u))?.id, u);
  const tell = async (msg) => sw.evaluate((id, m) => chrome.tabs.sendMessage(id, m), await tabOf(ORIGIN), msg);

  // ---- Seed two other articles so the library has history ----
  for (const [path, note] of [['/slow-reading', 'Try this on the next long essay.'], ['/reusable-notes', 'Use project tags, not topic tags.']]) {
    await page.goto(ORIGIN + path, { waitUntil: 'load' });
    await page.waitForSelector('notes-ext-ui');
    await tell({ type: 'setEnabled', enabled: true });
    for (const [id, cmd] of [['#a', 'highlight'], ['#b', 'highlightNote']]) {
      await page.evaluate((s) => {
        const r = document.createRange();
        r.selectNodeContents(document.querySelector(s));
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }, id);
      await tell({ type: 'command', command: cmd });
      await sleep(400);
      if (cmd === 'highlightNote') {
        await page.keyboard.type(note);
        await page.keyboard.down('Control');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Control');
        await sleep(400);
      }
    }
  }

  // ---- Main article + side panel (as a page in its own window, pointed at the article tab) ----
  await page.evaluateOnNewDocument(CURSOR);
  await page.goto(`${ORIGIN}/why-you-forget?utm_source=newsletter`, { waitUntil: 'load' });
  await page.waitForSelector('notes-ext-ui');
  const articleTab = await tabOf(ORIGIN);

  await sw.evaluate((u) => chrome.windows.create({ url: u, width: 420, height: 912 }), `chrome-extension://${extId}/sidepanel.html`);
  const panelTarget = await browser.waitForTarget((t) => t.url().endsWith('/sidepanel.html'));
  const panel = await panelTarget.page();
  await panel.evaluateOnNewDocument((id) => {
    const q = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async () => (await q({})).filter((t) => t.id === id);
  }, articleTab);
  await panel.evaluateOnNewDocument(CURSOR);
  await panel.setViewport({ ...PANEL});
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await panel.reload({ waitUntil: 'load' });
  await page.bringToFront();
  await tell({ type: 'setEnabled', enabled: true });
  await panel.waitForFunction(() => document.body.innerText.includes('Highlighting on'), { timeout: 5000 });

  const me = pointer(page, { x: 1000, y: 700 });
  const pp = pointer(panel, { x: 300, y: 600 });
  await me.show();
  await sleep(400);

  T0 = Date.now();
  const stopPage = await record(page, 'page');
  const stopPanel = await record(panel, 'panel');
  await sleep(1500);

  // 1. Highlight
  mark('highlight');
  let r = await textRect(page, '#p-forget', 'Most of what we read is gone within a week');
  await me.drag(...ends(r));
  mark('toolbar', { at: ends(r)[1] });
  await sleep(900);
  let b = await button(page, 'Highlight yellow');
  await me.click(b.x, b.y, 500);
  mark('highlighted');
  await sleep(2000);

  // 2. Note
  await smoothScroll(page, 260);
  mark('note');
  r = await textRect(page, '#p-notes', 'They are the ones who leave a trail');
  await me.drag(...ends(r));
  await sleep(700);
  b = await button(page, 'Highlight and add a note');
  await me.click(b.x, b.y, 500);
  await sleep(500);
  mark('typing', { at: b });
  await page.keyboard.type('This is the habit. Write it in my own words.', { delay: 55 });
  await sleep(600);
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  mark('noted');
  await sleep(1800);

  // 3. Snip the figure
  await smoothScroll(page, 720);
  const fig = await page.evaluate(() => {
    const f = document.querySelector('#fig svg').getBoundingClientRect();
    return { x1: f.left - 6, y1: f.top - 6, x2: f.right + 6, y2: f.bottom + 6 };
  });
  mark('snip');
  await me.glide(fig.x1, fig.y1, 700);
  await tell({ type: 'command', command: 'snip' });
  await sleep(700);
  await me.drag({ x: fig.x1, y: fig.y1 }, { x: fig.x2, y: fig.y2 }, 1300);
  mark('snipped');
  await sleep(2600);

  // 4. Side panel: everything for this page; Show jumps back
  mark('panel');
  await page.evaluate(() => document.getElementById('__demo_cursor')?.remove()); // one cursor on screen at a time
  await pp.show();
  await sleep(1400);
  const show = await panel.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Show');
    const q = btn.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  });
  await pp.click(show.x, show.y, 900);
  mark('shown');
  await sleep(2600);

  // 5. Persistence: reload and highlights come back
  mark('reload');
  await page.reload({ waitUntil: 'load' });
  await stopPage.poll(2800);

  // 6. Library
  const libBtn = await panel.evaluate(() => {
    const q = document.querySelector('button[title="All your notes"]').getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  });
  await pp.click(libBtn.x, libBtn.y, 700);
  const libPage = await (await browser.waitForTarget((t) => t.url().endsWith('/library.html'))).page();
  await libPage.setViewport({ ...LIB});
  await libPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await libPage.evaluateOnNewDocument(CURSOR);
  await libPage.reload({ waitUntil: 'load' });
  await libPage.waitForSelector('.card');
  await sleep(300);
  const stopLib = await record(libPage, 'library');
  mark('library');
  const lp = pointer(libPage, { x: 1200, y: 600 });
  await lp.show();
  await sleep(1600);
  const search = await libPage.evaluate(() => {
    const q = document.querySelector('.search').getBoundingClientRect();
    return { x: q.left + 60, y: q.top + q.height / 2 };
  });
  await lp.click(search.x, search.y, 700);
  mark('search');
  await libPage.keyboard.type('habit', { delay: 120 });
  await sleep(2200);
  const exp = await libPage.evaluate(() => {
    const q = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Export Markdown')).getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  });
  await lp.glide(exp.x, exp.y, 800);
  mark('export');
  await sleep(1800);
  mark('end');

  const timeline = {
    sizes: { page: PAGE, panel: PANEL, library: LIB },
    marks,
    streams: { page: await stopPage(), panel: await stopPanel(), library: await stopLib() },
  };
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(timeline));
  rmSync(DONE, { recursive: true, force: true });
  renameSync(OUT, DONE);
  console.log('frames:', Object.fromEntries(Object.entries(timeline.streams).map(([k, v]) => [k, v.length])));
} finally {
  await browser.close();
  server.close();
}
