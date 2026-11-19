import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { AnnotationCard } from '../../components/AnnotationCard';
import { downloadBlob } from '../../components/download';
import { useDbChanges } from '../../components/useDbChanges';
import { db } from '../../lib/db';
import { exportBackup, exportMarkdown, importBackup } from '../../lib/export';
import { sendToBackground } from '../../lib/messages';
import { COLORS, COLOR_HEX, type Annotation, type Color, type Page } from '../../lib/types';

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function includes(haystack: string | undefined, q: string) {
  return !!haystack && haystack.toLowerCase().includes(q);
}

export function App() {
  const bump = useDbChanges();
  const data = useLiveQuery(
    async () => ({
      pages: await db.pages.orderBy('lastSeen').reverse().toArray(),
      annotations: await db.annotations.toArray(),
    }),
    [bump],
  );
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<Color | null>(null);
  const [tag, setTag] = useState('');
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const byPage = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    for (const a of data?.annotations ?? []) {
      const list = m.get(a.pageUrl) ?? [];
      list.push(a);
      m.set(a.pageUrl, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.docY - b.docY);
    return m;
  }, [data]);

  const allTags = useMemo(
    () => [...new Set((data?.annotations ?? []).flatMap((a) => a.tags))].sort(),
    [data],
  );

  const q = query.trim().toLowerCase();
  const filtering = !!(q || color || tag);
  const sections: { page: Page; anns: Annotation[] }[] = [];
  for (const page of data?.pages ?? []) {
    const anns = byPage.get(page.url) ?? [];
    const pageMatches = !q || includes(page.title, q) || includes(page.url, q) || includes(page.note, q);
    const shown = anns.filter(
      (a) =>
        (!color || a.color === color) &&
        (!tag || a.tags.includes(tag)) &&
        (pageMatches || includes(a.selector?.exact, q) || includes(a.note, q) || a.tags.some((t) => includes(t, q))),
    );
    const showPageNoteOnly = !color && !tag && pageMatches && !!page.note.trim();
    if (shown.length || showPageNoteOnly) sections.push({ page, anns: shown });
  }

  const totals = {
    pages: data?.pages.length ?? 0,
    highlights: data?.annotations.filter((a) => a.type === 'highlight').length ?? 0,
    clips: data?.annotations.filter((a) => a.type === 'clip').length ?? 0,
  };

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(''), 4000);
  };

  const exportAll = async () => {
    const out = await exportMarkdown(db);
    if (out) downloadBlob(out.blob, out.filename);
  };

  const backup = async () => {
    downloadBlob(await exportBackup(db), `margin-notes-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const restore = async (file: File) => {
    try {
      const r = await importBackup(db, await file.text());
      flash(`Imported ${r.pages} pages, ${r.annotations} highlights and clips.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="library">
      <header className="lib-head">
        <div className="brand">
          <img src="/icon/48.png" alt="" width={28} height={28} />
          <div>
            <h1>Margin Notes</h1>
            <p className="totals">
              {plural(totals.pages, 'page')} · {plural(totals.highlights, 'highlight')} · {plural(totals.clips, 'clip')}
            </p>
          </div>
        </div>
        <div className="lib-actions">
          <button className="btn" onClick={() => void exportAll()} disabled={!totals.pages}>
            Export Markdown
          </button>
          <button className="btn" onClick={() => void backup()} disabled={!totals.pages}>
            Back up (JSON)
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Import backup
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restore(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <div className="toolbar-row">
        <input
          className="search"
          type="search"
          placeholder="Search highlights, notes, tags, titles…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="color-filter" role="group" aria-label="Filter by color">
          {COLORS.map((c) => (
            <button
              key={c}
              className={color === c ? 'on' : ''}
              style={{ background: COLOR_HEX[c] }}
              aria-label={`Only ${c}`}
              aria-pressed={color === c}
              title={c}
              onClick={() => setColor(color === c ? null : c)}
            />
          ))}
        </div>
        {allTags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        )}
      </div>

      {message && <p className="flash">{message}</p>}

      {data && sections.length === 0 && (
        <div className="empty">
          {filtering ? (
            <h2>Nothing matches</h2>
          ) : (
            <>
              <h2>Your library is empty</h2>
              <p>Open an article, click the Margin Notes icon, and select text to start highlighting.</p>
            </>
          )}
        </div>
      )}

      {sections.map(({ page, anns }) => (
        <section key={page.url} className="page-section">
          <header className="page-head">
            {page.favicon && <img src={page.favicon} alt="" width={16} height={16} />}
            <div className="page-info">
              <a href={page.url} target="_blank" rel="noreferrer">
                {page.title || page.url}
              </a>
              <span className="meta">
                {host(page.url)} · {new Date(page.lastSeen).toLocaleDateString()} · {plural(byPage.get(page.url)?.length ?? 0, 'item')}
              </span>
            </div>
            <button
              className="link"
              onClick={async () => {
                const out = await exportMarkdown(db, [page.url]);
                if (out) downloadBlob(out.blob, out.filename);
              }}
            >
              Export
            </button>
            <button
              className="link danger"
              onClick={() => {
                if (confirm(`Delete all notes for "${page.title}"?`)) void sendToBackground({ type: 'deletePage', url: page.url });
              }}
            >
              Delete
            </button>
          </header>
          {page.note.trim() && <p className="page-note-view">{page.note}</p>}
          <div className="grid">
            {anns.map((a) => (
              <AnnotationCard key={a.id} ann={a} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
