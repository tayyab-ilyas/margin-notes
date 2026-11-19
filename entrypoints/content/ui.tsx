import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { COLORS, COLOR_HEX, type Color } from '../../lib/types';
import type { Anchor, Controller, ViewportRect } from './controller';

const icons = {
  note: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4zM13.5 6.5l4 4',
  clip: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2',
  snip: 'M6 3v13a2 2 0 0 0 2 2h13M3 6h13a2 2 0 0 1 2 2v13',
  copy: 'M9 9h10v10H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
};

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d={icons[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function anchorStyle(a: Anchor): CSSProperties {
  return { left: a.x, top: a.y, transform: `translate(-50%, ${a.below ? '0' : '-100%'})` };
}

function Swatches({ active, onPick }: { active?: Color; onPick: (c: Color) => void }) {
  return (
    <div className="swatches">
      {COLORS.map((c) => (
        <button
          key={c}
          className={`swatch${c === active ? ' active' : ''}`}
          style={{ background: COLOR_HEX[c] }}
          title={`Highlight ${c}`}
          aria-label={`Highlight ${c}`}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

function Toolbar({ c, anchor, busy }: { c: Controller; anchor: Anchor; busy: boolean }) {
  return (
    // preventDefault on mousedown keeps the page selection alive while clicking.
    <div className="toolbar" style={anchorStyle(anchor)} onMouseDown={(e) => e.preventDefault()}>
      <Swatches onPick={(color) => void c.highlight(color)} />
      <span className="sep" />
      <button className="tool" title="Highlight and add a note" onClick={() => void c.highlight(c.state.lastColor, true)}>
        <Icon name="note" /> Note
      </button>
      <button className="tool" title="Save this passage as a screenshot" disabled={busy} onClick={() => void c.clipSelection()}>
        <Icon name="clip" /> Clip
      </button>
      <button className="tool icon-only" title="Copy text" aria-label="Copy text" onClick={() => c.copySelection()}>
        <Icon name="copy" />
      </button>
    </div>
  );
}

function Popover({ c, id, anchor, focus }: { c: Controller; id: string; anchor: Anchor; focus: boolean }) {
  const ann = c.annotations.get(id);
  const [draft, setDraft] = useState(ann?.note ?? '');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focus) taRef.current?.focus();
    // Save whatever was typed when the popover goes away for any reason.
    return () => void c.updateNote(id, draftRef.current);
  }, [c, id, focus]);

  if (!ann) return null;
  return (
    <div
      className="popover"
      style={anchorStyle(anchor)}
      onKeyDown={(e) => {
        // Key events don't leave our shadow root, so handle Escape here for any focused control.
        if (e.key === 'Escape') {
          e.preventDefault();
          c.closePopover();
        }
      }}
    >
      <textarea
        ref={taRef}
        value={draft}
        placeholder="Add a note…"
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void c.updateNote(id, draftRef.current)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            c.closePopover();
          }
        }}
      />
      <div className="row">
        <Swatches active={ann.color} onPick={(color) => void c.setColor(id, color)} />
        <span className="spacer" />
        <button className="tool icon-only danger" title="Delete highlight" aria-label="Delete highlight" onClick={() => void c.deleteAnnotation(id)}>
          <Icon name="trash" />
        </button>
        <button className="primary" onClick={() => c.closePopover()}>
          Done
        </button>
      </div>
    </div>
  );
}

function SnipOverlay({ onDone }: { onDone: (r: ViewportRect | null) => void }) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDone(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDone]);

  const rect =
    start && cur
      ? {
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          width: Math.abs(cur.x - start.x),
          height: Math.abs(cur.y - start.y),
        }
      : null;

  return (
    <div
      className={`snip${rect ? ' dragging' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        setStart({ x: e.clientX, y: e.clientY });
        setCur({ x: e.clientX, y: e.clientY });
      }}
      onMouseMove={(e) => start && setCur({ x: e.clientX, y: e.clientY })}
      onMouseUp={() => onDone(rect && rect.width > 8 && rect.height > 8 ? rect : null)}
    >
      {rect ? (
        <div className="snip-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <span className="snip-size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      ) : (
        <div className="snip-hint">
          <Icon name="snip" /> Drag to snip a region · Esc to cancel
        </div>
      )}
    </div>
  );
}

export function App({ c }: { c: Controller }) {
  const s = useSyncExternalStore(c.subscribe, c.getState);
  return (
    <div className="layer">
      {s.toolbar && <Toolbar c={c} anchor={s.toolbar} busy={s.busy} />}
      {s.popover && <Popover key={s.popover.id} c={c} id={s.popover.id} anchor={s.popover} focus={s.popover.focus} />}
      {s.snipping && <SnipOverlay onDone={(r) => void c.finishSnip(r)} />}
      {s.toast && (
        <div key={s.toast.key} className={`toast ${s.toast.kind}`} role="status">
          {s.toast.text}
        </div>
      )}
    </div>
  );
}
