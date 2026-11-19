import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

// End-to-end check: loads the built extension into a real Chromium browser and drives it.
// Usage: npm run e2e   (set BROWSER_PATH to use a browser other than Edge)
const BROWSER = process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = join(import.meta.dirname, '..');
const EXT = join(ROOT, '.output', 'chrome-mv3');
const OUT = join(ROOT, '.output', 'e2e');
mkdirSync(OUT, { recursive: true });

const filler = (i) =>
  `<p>Paragraph ${i}. Deep reading asks for patience; the mind wanders, returns, and slowly builds a model of the argument. ` +
  `Skimming trades that model for coverage, which is sometimes the right trade and often not.</p>`;
const ARTICLE = `<!doctype html><html><head><meta charset="utf-8"><title>Reading Well: a test article</title></head>
<body style="max-width:680px;margin:0 auto;padding:0 20px;font:18px/1.6 Georgia,serif;color:#222">
<header style="position:sticky;top:0;background:#fffbe6;border-bottom:1px solid #ddd;padding:8px;font:14px sans-serif">STICKY SITE HEADER</header>
<h1>Reading Well</h1>
<p id="p1">The quick <em>brown</em> fox jumps over the lazy dog, and then reads a book about attention.</p>
<p id="p2">Good notes are not transcripts. They are compressed arguments you can re-expand later.</p>
${Array.from({ length: 30 }, (_, i) => filler(i + 3)).join('\n')}
</body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(ARTICLE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/article?utm_source=test`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  pipe: true,
  enableExtensions: [EXT],
  defaultViewport: { width: 1200, height: 800 },
  args: ['--window-size=1200,900', '--no-first-run'],
});

const errors = [];
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const sw = await swTarget.worker();
  const extId = new URL(swTarget.url()).host;
  check('service worker started', !!sw, extId);

  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[page] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForSelector('notes-ext-ui', { timeout: 10000 });
  check('content script mounted UI host', true);

  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, URL_);
  const tell = (msg) => sw.evaluate((id, m) => chrome.tabs.sendMessage(id, m), tabId, msg);
  const dbAll = (store) =>
    sw.evaluate(
      (s) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('margin-notes');
          req.onsuccess = () => {
            const tx = req.result.transaction(s, 'readonly');
            const g = tx.objectStore(s).getAll();
            g.onsuccess = () => resolve(g.result.map((x) => ({ ...x, blob: x.blob ? x.blob.size : undefined })));
            g.onerror = () => reject(g.error);
          };
          req.onerror = () => reject(req.error);
        }),
      store,
    );
  const imageDataUrl = (id) =>
    sw.evaluate(
      (iid) =>
        new Promise((resolve) => {
          const req = indexedDB.open('margin-notes');
          req.onsuccess = () => {
            const g = req.result.transaction('images').objectStore('images').get(iid);
            g.onsuccess = async () => {
              const buf = new Uint8Array(await g.result.blob.arrayBuffer());
              let s = '';
              for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
              resolve(btoa(s));
            };
          };
        }),
      id,
    );

  // Starts dormant.
  let status = await tell({ type: 'getStatus' });
  check('starts dormant', status.enabled === false);
  status = await tell({ type: 'setEnabled', enabled: true });
  check('can be enabled', status.enabled === true);
  check('status url is normalized', status.url.endsWith('/article'), status.url);

  // ---- helpers ----
  const cdp = await page.createCDPSession();
  async function shadowButton(attr, value) {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (n.nodeName === 'BUTTON' && n.attributes) {
        for (let i = 0; i < n.attributes.length; i += 2) {
          if (n.attributes[i] === attr && n.attributes[i + 1] === value) {
            const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: n.backendNodeId });
            const q = model.content;
            return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
          }
        }
      }
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) stack.push(c);
    }
    return null;
  }
  async function textRect(selector, text) {
    return page.evaluate(
      (sel, t) => {
        const el = document.querySelector(sel);
        el.scrollIntoView({ block: 'center' });
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let full = '';
        const nodes = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          nodes.push([n, full.length]);
          full += n.data;
        }
        const at = full.indexOf(t);
        const point = (off) => {
          for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i][1] <= off) return [nodes[i][0], off - nodes[i][1]];
        };
        const r = document.createRange();
        r.setStart(...point(at));
        r.setEnd(...point(at + t.length));
        const rects = r.getClientRects();
        const first = rects[0];
        const last = rects[rects.length - 1];
        return { x1: first.left + 1, y1: first.top + first.height / 2, x2: last.right - 1, y2: last.top + last.height / 2 };
      },
      selector,
      text,
    );
  }
  async function dragSelect(selector, text) {
    const r = await textRect(selector, text);
    await page.mouse.move(r.x1, r.y1);
    await page.mouse.down();
    await page.mouse.move((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2, { steps: 5 });
    await page.mouse.move(r.x2, r.y2, { steps: 5 });
    await page.mouse.up();
    await sleep(250);
    return page.evaluate(() => getSelection().toString());
  }
  const markCount = () => page.evaluate(() => document.querySelectorAll('notes-mark').length);

  // ---- 1. real mouse selection shows toolbar; clicking a swatch highlights ----
  const selected = await dragSelect('#p1', 'quick brown fox jumps');
  check('mouse drag selects text', selected.includes('quick brown fox'), JSON.stringify(selected));
  await page.screenshot({ path: join(OUT, '1-toolbar.png') });
  const green = await shadowButton('title', 'Highlight green');
  check('selection toolbar appears', !!green);
  await page.mouse.click(green.x, green.y);
  await sleep(500);
  const marks1 = await page.evaluate(() => [...document.querySelectorAll('notes-mark')].map((m) => [m.textContent, m.dataset.color]));
  check('green highlight wrapped', marks1.map((m) => m[0]).join('') === 'quick brown fox jumps' && marks1.every((m) => m[1] === 'green'), JSON.stringify(marks1));
  let anns = await dbAll('annotations');
  check('highlight saved to DB', anns.length === 1 && anns[0].selector.exact === 'quick brown fox jumps' && anns[0].pageUrl.endsWith('/article'));
  const pages = await dbAll('pages');
  check('page saved with title', pages[0]?.title === 'Reading Well: a test article');

  // ---- 2. highlight + note via the Note button and popover ----
  await dragSelect('#p2', 'compressed arguments');
  const noteBtn = await shadowButton('title', 'Highlight and add a note');
  await page.mouse.click(noteBtn.x, noteBtn.y);
  await sleep(300);
  await page.screenshot({ path: join(OUT, '2-popover.png') });
  await page.keyboard.type('Key idea: notes compress.');
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await sleep(600);
  anns = await dbAll('annotations');
  const noted = anns.find((a) => a.selector?.exact === 'compressed arguments');
  check('note typed in popover is saved', noted?.note === 'Key idea: notes compress.', noted?.note);
  check('mark shows has-note dot', await page.evaluate(() => !!document.querySelector('notes-mark[data-has-note][data-tail]')));

  // ---- 3. reload restores highlights ----
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('notes-mark', { timeout: 5000 }).catch(() => {});
  const restored = await page.evaluate(() => [...new Set([...document.querySelectorAll('notes-mark')].map((m) => m.dataset.id))].length);
  check('highlights restored after reload', restored === 2, `${restored} restored`);
  status = await tell({ type: 'getStatus' });
  check('no orphans after reload', status.orphanIds.length === 0);
  check('dormant again after reload (not auto-enabled)', status.enabled === false);
  await tell({ type: 'setEnabled', enabled: true });

  // ---- 4. clicking a highlight opens the popover; change colour ----
  const markPos = await page.evaluate(() => {
    const m = document.querySelector('notes-mark[data-color="green"]');
    m.scrollIntoView({ block: 'center' });
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(markPos.x, markPos.y);
  await sleep(300);
  const pink = await shadowButton('title', 'Highlight pink');
  check('clicking a highlight opens popover', !!pink);
  await page.mouse.click(pink.x, pink.y);
  await sleep(500);
  anns = await dbAll('annotations');
  check('colour change saved', anns.some((a) => a.selector.exact === 'quick brown fox jumps' && a.color === 'pink'));
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Escape closes popover with a button focused', !(await shadowButton('title', 'Highlight pink')));

  // ---- 5. clip a selection (fits in viewport) ----
  await dragSelect('#p2', 'Good notes are not transcripts');
  const clipBtn = await shadowButton('title', 'Save this passage as a screenshot');
  await page.mouse.click(clipBtn.x, clipBtn.y);
  await sleep(2500);
  let images = await dbAll('images');
  anns = await dbAll('annotations');
  const clip1 = anns.find((a) => a.type === 'clip');
  check('selection clip saved', images.length === 1 && !!clip1?.imageId && clip1.selector?.exact === 'Good notes are not transcripts', `${images[0]?.width}x${images[0]?.height}`);
  if (images[0]) writeFileSync(join(OUT, '5-clip-selection.png'), Buffer.from(await imageDataUrl(images[0].id), 'base64'));

  // ---- 6. tall clip (scroll + stitch) via context-menu command path ----
  await page.evaluate(() => {
    const ps = document.querySelectorAll('p');
    const r = document.createRange();
    r.setStart(ps[3].firstChild, 0);
    r.setEnd(ps[18].firstChild, 20);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    ps[3].scrollIntoView();
  });
  const before = await page.evaluate(() => scrollY);
  await tell({ type: 'command', command: 'clip' });
  await sleep(7000);
  images = await dbAll('images');
  const tall = images.find((i) => i.height > 900);
  check('tall clip stitched from several captures', !!tall, images.map((i) => `${i.width}x${i.height}`).join(', '));
  check('scroll position restored after tall clip', Math.abs((await page.evaluate(() => scrollY)) - before) < 2);
  check('sticky header visible again after capture', await page.evaluate(() => getComputedStyle(document.querySelector('header')).visibility === 'visible'));
  if (tall) writeFileSync(join(OUT, '6-clip-tall.png'), Buffer.from(await imageDataUrl(tall.id), 'base64'));

  // ---- 7. region snip with the overlay ----
  await page.evaluate(() => scrollTo(0, 0));
  await tell({ type: 'command', command: 'snip' });
  await sleep(300);
  await page.screenshot({ path: join(OUT, '7-snip-overlay.png') });
  await page.mouse.move(300, 60);
  await page.mouse.down();
  await page.mouse.move(600, 160, { steps: 8 });
  await page.mouse.move(800, 260, { steps: 8 });
  await page.screenshot({ path: join(OUT, '7b-snip-dragging.png') });
  await page.mouse.up();
  await sleep(2500);
  images = await dbAll('images');
  const snip = images.find((i) => i.width === 500 && i.height === 200);
  check('region snip saved at the dragged size', !!snip, images.map((i) => `${i.width}x${i.height}`).join(', '));
  if (snip) writeFileSync(join(OUT, '7c-snip-result.png'), Buffer.from(await imageDataUrl(snip.id), 'base64'));
  await page.screenshot({ path: join(OUT, '8-page-with-highlights.png') });

  // ---- 8. scrollTo from the panel ----
  const target = anns.find((a) => a.selector?.exact === 'compressed arguments');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const found = await tell({ type: 'scrollTo', id: target.id });
  await sleep(900);
  const visible = await page.evaluate((id) => {
    const r = document.querySelector(`notes-mark[data-id="${id}"]`).getBoundingClientRect();
    return r.top > 0 && r.bottom < innerHeight;
  }, target.id);
  check('scrollTo brings highlight into view', found === true && visible);

  // ---- 9. library page ----
  const lib = await browser.newPage();
  lib.on('console', (m) => m.type() === 'error' && errors.push(`[library] ${m.text()}`));
  lib.on('pageerror', (e) => errors.push(`[library pageerror] ${e.message}`));
  lib.on('dialog', (d) => d.accept());
  await lib.setViewport({ width: 1200, height: 900 });
  await lib.goto(`chrome-extension://${extId}/library.html`);
  await lib.waitForSelector('.card', { timeout: 5000 });
  await sleep(500);
  const cardCount = await lib.$$eval('.card', (c) => c.length);
  check('library lists all items', cardCount === 5, `${cardCount} cards`);
  await lib.screenshot({ path: join(OUT, '9-library.png'), fullPage: true });
  await lib.type('.search', 'compress');
  await sleep(300);
  check('library search filters', (await lib.$$eval('.card', (c) => c.length)) === 1);
  await lib.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await lib.screenshot({ path: join(OUT, '9b-library-dark-search.png') });
  await lib.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // Edit a note in the library → reflected on the page.
  await lib.click('.note-input');
  await lib.keyboard.down('Control');
  await lib.keyboard.press('a');
  await lib.keyboard.up('Control');
  await lib.keyboard.type('Edited from library');
  await lib.click('h1');
  await sleep(600);
  anns = await dbAll('annotations');
  check('note edited in library saved', anns.some((a) => a.note === 'Edited from library'));

  // Delete a highlight from the library → removed from open article tab.
  await lib.click('.search');
  await lib.keyboard.down('Control');
  await lib.keyboard.press('a');
  await lib.keyboard.up('Control');
  await lib.keyboard.press('Backspace');
  await sleep(300);
  const marksBefore = await page.evaluate(() => new Set([...document.querySelectorAll('notes-mark')].map((m) => m.dataset.id)).size);
  const delButtons = await lib.$$('.card .link.danger');
  // Find the card containing "quick brown fox".
  for (const b of delButtons) {
    const isTarget = await b.evaluate((el) => el.closest('.card').textContent.includes('quick brown fox'));
    if (isTarget) {
      await b.click();
      break;
    }
  }
  await sleep(800);
  const marksAfter = await page.evaluate(() => new Set([...document.querySelectorAll('notes-mark')].map((m) => m.dataset.id)).size);
  check('deleting in library removes marks from open tab', marksAfter === marksBefore - 1, `${marksBefore} -> ${marksAfter}`);
  anns = await dbAll('annotations');
  check('deleted highlight gone from DB', !anns.some((a) => a.selector?.exact === 'quick brown fox jumps') && anns.length === 4);

  // ---- 10. side panel page renders (opened as a tab it sees itself as the active tab) ----
  const sp = await browser.newPage();
  sp.on('pageerror', (e) => errors.push(`[sidepanel pageerror] ${e.message}`));
  await sp.setViewport({ width: 380, height: 700 });
  await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
  await sleep(800);
  check('side panel renders unsupported-page state for extension pages', (await sp.content()).includes("Notes aren't available here"));
  await sp.close();
} catch (e) {
  console.error('E2E crashed:', e);
  results.push({ name: 'crash', ok: false, detail: String(e) });
} finally {
  console.log('\nconsole errors:', errors.length ? errors : 'none');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(failed.length ? 1 : 0);
}
