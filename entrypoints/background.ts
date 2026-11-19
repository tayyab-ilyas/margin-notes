import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { dataUrlToBlob } from '../lib/capture';
import { db, deletePage } from '../lib/db';
import { runMcpQuery } from '../lib/mcp';
import { getMcpSettings, MCP_SETTINGS_KEY } from '../lib/settings';
import { isBgRequest, sendToTab, type BgRequest, type Broadcast, type Envelope, type TabMessage, type TabStatus } from '../lib/messages';
import type { Annotation, Page, PageInfo } from '../lib/types';
import { newId } from '../lib/types';
import { isAnnotatable, normalizeUrl } from '../lib/url';

type Sender = Browser.runtime.MessageSender;

const CONTENT_SCRIPT = '/content-scripts/content.js';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  browser.runtime.onInstalled.addListener(() => {
    createContextMenus();
    void injectIntoOpenTabs();
  });

  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (isBgRequest(msg)) {
      handle(msg, sender).then(
        (data) => sendResponse({ ok: true, data } satisfies Envelope<unknown>),
        (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
      return true; // keep the channel open for the async response
    }
    const b = msg as Broadcast;
    if (b?.type === 'status' && sender.tab?.id !== undefined) void setBadge(sender.tab.id, b.status);
    return false;
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const tabId = tab.id;
    switch (info.menuItemId) {
      case 'nm-highlight':
        void tellTab(tabId, { type: 'command', command: 'highlight' });
        break;
      case 'nm-highlight-note':
        void tellTab(tabId, { type: 'command', command: 'highlightNote' });
        break;
      case 'nm-clip':
        void tellTab(tabId, { type: 'command', command: 'clip' });
        break;
      case 'nm-snip':
        void tellTab(tabId, { type: 'command', command: 'snip' });
        break;
      case 'nm-panel':
        // Must be called synchronously inside the user gesture.
        browser.sidePanel.open({ tabId }).catch(console.error);
        break;
    }
  });

  browser.commands.onCommand.addListener((command, tab) => {
    const tabId = tab?.id;
    if (tabId === undefined) return;
    if (command === 'toggle-notes') void tellTab(tabId, { type: 'toggle' });
    else if (command === 'highlight-selection') void tellTab(tabId, { type: 'command', command: 'highlight' });
    else if (command === 'snip-region') void tellTab(tabId, { type: 'command', command: 'snip' });
  });

  // Chat app (MCP) bridge: retry every 30 s, since the MCP server only runs while a chat app is open.
  browser.alarms.create('mcp', { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === 'mcp') void connectMcp();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MCP_SETTINGS_KEY]) {
      mcpSocket?.close();
      void connectMcp();
    }
  });
  void connectMcp();
});

let mcpSocket: WebSocket | null = null;
let mcpWelcomed = false; // true once the server accepted our token

/**
 * Connects to the local MCP server (mcp/server.mjs) when the user has turned chat app access on.
 * The extension is the client, so the server never needs access to the browser; it can only ask
 * the read-only queries in lib/mcp.ts, and only after presenting the pairing token.
 */
async function connectMcp() {
  const s = await getMcpSettings();
  if (!s.enabled) {
    mcpSocket?.close();
    return;
  }
  if (mcpSocket && mcpSocket.readyState <= WebSocket.OPEN) return;
  const sock = new WebSocket(`ws://127.0.0.1:${s.port}`);
  mcpSocket = sock;
  mcpWelcomed = false;
  sock.onopen = () => sock.send(JSON.stringify({ type: 'hello', token: s.token, version: browser.runtime.getManifest().version }));
  sock.onmessage = async (e) => {
    let msg: { type?: string; id?: number; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (msg.type === 'welcome') {
      mcpWelcomed = true;
      broadcast({ type: 'mcpStatus', connected: true });
    }
    // Answering the server's pings keeps this service worker awake while a chat app is connected.
    else if (msg.type === 'ping') sock.send('{"type":"pong"}');
    else if (msg.type === 'call') {
      try {
        const result = await runMcpQuery(db, msg.method ?? '', msg.params ?? {});
        sock.send(JSON.stringify({ type: 'result', id: msg.id, result }));
      } catch (err) {
        sock.send(JSON.stringify({ type: 'result', id: msg.id, error: err instanceof Error ? err.message : String(err) }));
      }
    }
  };
  sock.onclose = () => {
    if (mcpSocket === sock) {
      mcpSocket = null;
      mcpWelcomed = false;
    }
    broadcast({ type: 'mcpStatus', connected: false });
  };
}

function createContextMenus() {
  browser.contextMenus.removeAll(() => {
    const sel: ['selection'] = ['selection'];
    browser.contextMenus.create({ id: 'nm-highlight', title: 'Highlight', contexts: sel });
    browser.contextMenus.create({ id: 'nm-highlight-note', title: 'Highlight with note', contexts: sel });
    browser.contextMenus.create({ id: 'nm-clip', title: 'Clip selection as screenshot', contexts: sel });
    browser.contextMenus.create({ id: 'nm-snip', title: 'Snip a region of this page', contexts: ['page', 'image'] });
    browser.contextMenus.create({ id: 'nm-panel', title: 'Open notes side panel', contexts: ['page', 'selection'] });
  });
}

/** Tabs that were open before install don't have the content script yet. */
async function injectIntoOpenTabs() {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.filter((t) => t.id !== undefined && isAnnotatable(t.url)).map((t) => ensureContentScript(t.id!)));
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await sendToTab(tabId, { type: 'ping' })) return true;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    return true;
  } catch {
    return false; // restricted page (chrome://, Web Store, PDF viewer...)
  }
}

async function tellTab(tabId: number, msg: TabMessage) {
  if (await ensureContentScript(tabId)) await sendToTab(tabId, msg);
}

async function setBadge(tabId: number, status: TabStatus) {
  await browser.action.setBadgeText({ tabId, text: status.enabled ? 'ON' : '' });
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#2f9e44' });
}

function broadcast(msg: Broadcast) {
  browser.runtime.sendMessage(msg).catch(() => {
    /* no extension page is listening */
  });
}

/** Sends a message to every open tab showing the given (normalized) page. */
async function notifyPageTabs(pageUrl: string, msg: TabMessage) {
  const tabs = await browser.tabs.query({});
  for (const t of tabs) {
    if (t.id !== undefined && t.url && isAnnotatable(t.url) && normalizeUrl(t.url) === pageUrl) {
      void sendToTab(t.id, msg);
    }
  }
}

async function upsertPage(info: PageInfo, sender: Sender | null, now: number, note?: string): Promise<Page> {
  const url = normalizeUrl(info.url);
  const existing = await db.pages.get(url);
  const page: Page = {
    url,
    title: info.title || existing?.title || url,
    favicon: info.favicon ?? sender?.tab?.favIconUrl ?? existing?.favicon,
    note: note ?? existing?.note ?? '',
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  };
  await db.pages.put(page);
  return page;
}

/** Drops a page record once it has no annotations and no page note. */
async function pruneEmptyPage(pageUrl: string) {
  const page = await db.pages.get(pageUrl);
  if (!page || page.note.trim()) return;
  if ((await db.annotations.where('pageUrl').equals(pageUrl).count()) === 0) await db.pages.delete(pageUrl);
}

async function handle(req: BgRequest, sender: Sender): Promise<unknown> {
  const now = Date.now();
  switch (req.type) {
    case 'getAnnotations':
      return db.annotations.where('pageUrl').equals(normalizeUrl(req.url)).sortBy('docY');

    case 'createAnnotation': {
      const ann: Annotation = { ...req.annotation, pageUrl: normalizeUrl(req.page.url), createdAt: now, updatedAt: now };
      await db.transaction('rw', db.pages, db.annotations, async () => {
        await upsertPage(req.page, sender, now);
        await db.annotations.put(ann);
      });
      broadcast({ type: 'dbChanged', pageUrl: ann.pageUrl });
      return ann;
    }

    case 'updateAnnotation': {
      const changed = await db.annotations.update(req.id, { ...req.patch, updatedAt: now });
      if (!changed) return null;
      const ann = (await db.annotations.get(req.id))!;
      await notifyPageTabs(ann.pageUrl, { type: 'annotationUpdated', annotation: ann });
      broadcast({ type: 'dbChanged', pageUrl: ann.pageUrl });
      return ann;
    }

    case 'deleteAnnotation': {
      const ann = await db.annotations.get(req.id);
      if (!ann) return null;
      await db.transaction('rw', db.annotations, db.images, async () => {
        if (ann.imageId) await db.images.delete(ann.imageId);
        await db.annotations.delete(ann.id);
      });
      await pruneEmptyPage(ann.pageUrl);
      await notifyPageTabs(ann.pageUrl, { type: 'annotationDeleted', id: ann.id });
      broadcast({ type: 'dbChanged', pageUrl: ann.pageUrl });
      return null;
    }

    case 'deletePage': {
      const url = normalizeUrl(req.url);
      await deletePage(db, url);
      await notifyPageTabs(url, { type: 'reload' });
      broadcast({ type: 'dbChanged', pageUrl: url });
      return null;
    }

    case 'updatePageNote': {
      const page = await upsertPage(req.page, null, now, req.note);
      await pruneEmptyPage(page.url);
      broadcast({ type: 'dbChanged', pageUrl: page.url });
      return page;
    }

    case 'captureVisible': {
      const windowId = sender.tab?.windowId;
      if (windowId === undefined) throw new Error('Capture must come from a tab');
      // Chrome allows ~2 captures/second; retry once if we hit the quota.
      try {
        return await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
      } catch (e) {
        if (!String(e).includes('MAX_CAPTURE')) throw e;
        await new Promise((r) => setTimeout(r, 700));
        return await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
      }
    }

    case 'saveClip': {
      const imageId = newId();
      const ann: Annotation = { ...req.annotation, imageId, pageUrl: normalizeUrl(req.page.url), createdAt: now, updatedAt: now };
      await db.transaction('rw', db.pages, db.annotations, db.images, async () => {
        await db.images.put({ id: imageId, blob: dataUrlToBlob(req.dataUrl), width: req.width, height: req.height, createdAt: now });
        await upsertPage(req.page, sender, now);
        await db.annotations.put(ann);
      });
      broadcast({ type: 'dbChanged', pageUrl: ann.pageUrl });
      return ann;
    }

    case 'activateTab': {
      if (await ensureContentScript(req.tabId)) await sendToTab(req.tabId, { type: 'setEnabled', enabled: true });
      return null;
    }

    case 'mcpStatus':
      return { connected: mcpSocket?.readyState === WebSocket.OPEN && mcpWelcomed };
  }
}
