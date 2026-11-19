import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { AnnotationCard } from '../../components/AnnotationCard';
import { downloadBlob } from '../../components/download';
import { useDbChanges } from '../../components/useDbChanges';
import { annotationsForPage, db } from '../../lib/db';
import { exportMarkdown } from '../../lib/export';
import { sendToBackground, sendToTab, type Broadcast, type TabStatus } from '../../lib/messages';
import { getAutoSites, setAutoEnabled } from '../../lib/settings';
import { isAnnotatable, normalizeUrl } from '../../lib/url';

interface ActiveTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  favicon?: string;
}

function toActive(t: Browser.tabs.Tab | undefined): ActiveTab | null {
  if (!t || t.id === undefined) return null;
  return { id: t.id, windowId: t.windowId, url: t.url ?? '', title: t.title ?? '', favicon: t.favIconUrl };
}

/** The active tab in this side panel's window, kept up to date. */
function useActiveTab(): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  useEffect(() => {
    let windowId: number | undefined;
    const refresh = async () => {
      const [t] = await browser.tabs.query({ active: true, currentWindow: true });
      windowId = t?.windowId;
      setTab(toActive(t));
    };
    const onActivated = (info: { windowId: number }) => {
      if (windowId === undefined || info.windowId === windowId) void refresh();
    };
    const onUpdated = (_id: number, change: Browser.tabs.OnUpdatedInfo, t: Browser.tabs.Tab) => {
      if (!t.active || (windowId !== undefined && t.windowId !== windowId)) return;
      if (change.url || change.title || change.favIconUrl || change.status === 'complete') setTab(toActive(t));
    };
    void refresh();
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
}

/** Enabled/orphan status reported by the content script in the given tab. */
function useTabStatus(tab: ActiveTab | null, supported: boolean) {
  const [status, setStatus] = useState<TabStatus | null>(null);
  const tabId = tab?.id;
  const url = tab?.url;

  useEffect(() => {
    setStatus(null);
    if (tabId === undefined || !supported) return;
    let cancelled = false;
    // Opening the panel (or switching tabs with it open) turns note-taking on.
    void sendToBackground({ type: 'activateTab', tabId })
      .then(() => sendToTab<TabStatus>(tabId, { type: 'getStatus' }))
      .then((s) => !cancelled && s && setStatus(s))
      .catch(() => {});
    const onMsg = (msg: unknown, sender: Browser.runtime.MessageSender) => {
      const b = msg as Broadcast;
      if (b?.type === 'status' && sender.tab?.id === tabId) setStatus(b.status);
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => {
      cancelled = true;
      browser.runtime.onMessage.removeListener(onMsg);
    };
  }, [tabId, url, supported]);

  return [status, setStatus] as const;
}

function PageNote({ pageUrl, tab, note }: { pageUrl: string; tab: ActiveTab; note: string }) {
  const [draft, setDraft] = useState(note);
  const saved = useRef(note);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Reset when switching pages; otherwise keep the local draft while typing.
  useEffect(() => {
    setDraft(note);
    saved.current = note;
  }, [pageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (value: string) => {
    clearTimeout(timer.current);
    if (value === saved.current) return;
    saved.current = value;
    void sendToBackground({
      type: 'updatePageNote',
      page: { url: tab.url, title: tab.title, favicon: tab.favicon },
      note: value,
    });
  };

  return (
    <textarea
      className="page-note"
      placeholder="Notes about this article…"
      value={draft}
      rows={3}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => save(v), 800);
      }}
      onBlur={() => save(draft)}
    />
  );
}

type Filter = 'all' | 'highlight' | 'clip';

export function App() {
  const tab = useActiveTab();
  const supported = isAnnotatable(tab?.url);
  const pageUrl = tab && supported ? normalizeUrl(tab.url) : '';
  const hostname = supported && tab ? new URL(tab.url).hostname : '';
  const [status, setStatus] = useTabStatus(tab, supported);
  const bump = useDbChanges();
  const [filter, setFilter] = useState<Filter>('all');
  const [autoSites, setAutoSites] = useState<string[]>([]);

  useEffect(() => {
    void getAutoSites().then(setAutoSites);
  }, []);

  const annotations = useLiveQuery(() => (pageUrl ? annotationsForPage(db, pageUrl) : []), [pageUrl, bump]);
  const page = useLiveQuery(() => (pageUrl ? db.pages.get(pageUrl) : undefined), [pageUrl, bump]);
  const orphanIds = useMemo(() => new Set(status?.orphanIds ?? []), [status]);

  const shown = (annotations ?? []).filter((a) => filter === 'all' || a.type === filter);
  const counts = {
    highlight: annotations?.filter((a) => a.type === 'highlight').length ?? 0,
    clip: annotations?.filter((a) => a.type === 'clip').length ?? 0,
  };

  const toggleEnabled = async () => {
    if (!tab) return;
    const s = await sendToTab<TabStatus>(tab.id, { type: 'setEnabled', enabled: !status?.enabled });
    if (s) setStatus(s);
  };

  const toggleAuto = async (on: boolean) => {
    await setAutoEnabled(hostname, on);
    setAutoSites(await getAutoSites());
  };

  const exportPage = async () => {
    const out = await exportMarkdown(db, [pageUrl]);
    if (out) downloadBlob(out.blob, out.filename);
  };

  const openLibrary = () => void browser.tabs.create({ url: browser.runtime.getURL('/library.html') });

  if (!tab) return null;

  return (
    <div className="panel">
      <header className="panel-head">
        <div className="page-title">
          {tab.favicon && <img src={tab.favicon} alt="" width={16} height={16} />}
          <span title={tab.title}>{tab.title || tab.url}</span>
        </div>
        <button className="btn" onClick={openLibrary} title="All your notes">
          Library
        </button>
      </header>

      {!supported ? (
        <div className="empty">
          <h2>Notes aren't available here</h2>
          Browsers don't let extensions run on built-in pages, the extension store or the PDF viewer. Open an article to
          start taking notes.
        </div>
      ) : (
        <>
          <section className="controls">
            <label className="switch">
              <input type="checkbox" checked={!!status?.enabled} onChange={() => void toggleEnabled()} disabled={!status} />
              <span>{status ? (status.enabled ? 'Highlighting on' : 'Highlighting off') : 'Connecting to page…'}</span>
            </label>
            <label className="check" title="Turn highlighting on automatically whenever you visit this site">
              <input type="checkbox" checked={autoSites.includes(hostname)} onChange={(e) => void toggleAuto(e.target.checked)} />
              Always on for {hostname}
            </label>
            <div className="actions">
              <button className="btn" onClick={() => void sendToTab(tab.id, { type: 'command', command: 'snip' })}>
                Snip region
              </button>
              <button className="btn" onClick={() => void exportPage()} disabled={!annotations?.length && !page?.note}>
                Export
              </button>
            </div>
          </section>

          <PageNote pageUrl={pageUrl} tab={tab} note={page?.note ?? ''} />

          {annotations && annotations.length > 0 && (
            <nav className="filters" aria-label="Filter">
              {(
                [
                  ['all', `All ${annotations.length}`],
                  ['highlight', `Highlights ${counts.highlight}`],
                  ['clip', `Clips ${counts.clip}`],
                ] as const
              ).map(([key, label]) => (
                <button key={key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </nav>
          )}

          <div className="list">
            {shown.map((a) => (
              <AnnotationCard
                key={a.id}
                ann={a}
                orphan={orphanIds.has(a.id)}
                onGoTo={() => void sendToTab(tab.id, { type: 'scrollTo', id: a.id })}
              />
            ))}
          </div>

          {annotations && annotations.length === 0 && (
            <div className="empty">
              <h2>No notes on this page yet</h2>
              <p>Select text on the page to highlight it, add a note, or clip it as a screenshot.</p>
              <p>
                <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> highlight · <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> snip
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
