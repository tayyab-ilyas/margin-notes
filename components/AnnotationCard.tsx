import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { sendToBackground } from '../lib/messages';
import { COLORS, COLOR_HEX, type Annotation, type AnnotationPatch } from '../lib/types';
import { ClipImage } from './ClipImage';

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

function AutoTextarea({ value, onSave, placeholder }: { value: string; onSave: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);

  // Take outside updates (e.g. edited on the page) unless the user is typing here.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  return (
    <textarea
      ref={ref}
      className="note-input"
      rows={1}
      value={draft}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onSave(draft);
      }}
    />
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const next = input
      .split(',')
      .map((t) => t.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean);
    setInput('');
    if (next.length) onChange([...new Set([...tags, ...next])]);
  };
  return (
    <div className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          #{t}
          <button aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        value={input}
        placeholder={tags.length ? '+ tag' : '+ add tag'}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !input && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function AnnotationCard({ ann, orphan, onGoTo }: { ann: Annotation; orphan?: boolean; onGoTo?: () => void }) {
  const update = (patch: AnnotationPatch) =>
    void sendToBackground({ type: 'updateAnnotation', id: ann.id, patch }).catch(console.error);

  return (
    <article className="card" style={{ '--hl': COLOR_HEX[ann.color] } as CSSProperties}>
      {ann.type === 'clip' && ann.imageId && <ClipImage id={ann.imageId} />}
      {ann.selector?.exact && (
        <blockquote className={`quote${ann.type === 'clip' ? ' small' : ''}`} onClick={onGoTo} title={onGoTo ? 'Show on page' : undefined}>
          {ann.selector.exact}
        </blockquote>
      )}
      {orphan && <p className="orphan">Couldn't find this passage on the page. It may have changed.</p>}
      <AutoTextarea value={ann.note} placeholder="Add a note…" onSave={(note) => update({ note })} />
      <TagEditor tags={ann.tags} onChange={(tags) => update({ tags })} />
      <footer className="card-foot">
        <span className="meta">
          {ann.type === 'clip' ? 'Clip' : 'Highlight'} · {timeAgo(ann.createdAt)}
        </span>
        <span className="mini-swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              className={c === ann.color ? 'active' : ''}
              style={{ background: COLOR_HEX[c] }}
              aria-label={`Color ${c}`}
              title={c}
              onClick={() => update({ color: c })}
            />
          ))}
        </span>
        {onGoTo && (
          <button className="link" onClick={onGoTo}>
            Show
          </button>
        )}
        <button
          className="link danger"
          onClick={() => {
            if (confirm(ann.type === 'clip' ? 'Delete this clip?' : 'Delete this highlight?')) {
              void sendToBackground({ type: 'deleteAnnotation', id: ann.id });
            }
          }}
        >
          Delete
        </button>
      </footer>
    </article>
  );
}
