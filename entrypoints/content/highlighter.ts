import { buildIndex, matchSelector, normSpanToRaw, unwrap, wrapRaw, type NormSpan, type TextIndex } from '../../lib/anchoring';
import type { Annotation, Color } from '../../lib/types';

export const MARK_TAG = 'notes-mark';

const MARK_CSS = `
${MARK_TAG} {
  all: unset;
  display: inline;
  color: inherit;
  background-color: var(--nm-bg);
  border-radius: 2px;
  cursor: pointer;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition: background-color .3s, box-shadow .3s;
}
${MARK_TAG}[data-color="yellow"] { --nm-bg: rgba(255, 212, 0, .42); --nm-line: #e0a800; }
${MARK_TAG}[data-color="green"]  { --nm-bg: rgba(64, 192, 87, .32); --nm-line: #2f9e44; }
${MARK_TAG}[data-color="blue"]   { --nm-bg: rgba(51, 154, 240, .30); --nm-line: #1c7ed6; }
${MARK_TAG}[data-color="pink"]   { --nm-bg: rgba(240, 101, 149, .32); --nm-line: #d6336c; }
${MARK_TAG}[data-color="purple"] { --nm-bg: rgba(132, 94, 247, .30); --nm-line: #7048e8; }
${MARK_TAG}[data-type="clip"] {
  background-color: transparent;
  border-bottom: 2px dashed var(--nm-line);
}
${MARK_TAG}[data-tail][data-has-note]::after {
  content: "";
  display: inline-block;
  width: .42em;
  height: .42em;
  margin-left: .15em;
  vertical-align: super;
  border-radius: 50%;
  background: var(--nm-line);
}
${MARK_TAG}.nm-flash { box-shadow: 0 0 0 3px var(--nm-line); }
`;

export function injectMarkStyles(): void {
  if (document.getElementById('notes-ext-mark-style')) return;
  const style = document.createElement('style');
  style.id = 'notes-ext-mark-style';
  style.textContent = MARK_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

function makeMark(ann: Pick<Annotation, 'id' | 'color' | 'type' | 'note'>): () => HTMLElement {
  return () => {
    const el = document.createElement(MARK_TAG);
    el.dataset.id = ann.id;
    el.dataset.color = ann.color;
    el.dataset.type = ann.type;
    return el;
  };
}

function finishMarks(marks: HTMLElement[], ann: Pick<Annotation, 'note'>): void {
  if (!marks.length) return;
  marks[marks.length - 1].dataset.tail = '';
  setHasNote(marks, !!ann.note.trim());
}

function setHasNote(marks: Iterable<HTMLElement>, has: boolean) {
  for (const m of marks) {
    if (has) m.dataset.hasNote = '';
    else delete m.dataset.hasNote;
  }
}

/** Wraps an already-known span (from a fresh selection) using the given index. */
export function markSpan(index: TextIndex, span: NormSpan, ann: Annotation): HTMLElement[] {
  const { rs, re } = normSpanToRaw(index, span.start, span.end);
  const marks = wrapRaw(index, rs, re, makeMark(ann));
  finishMarks(marks, ann);
  return marks;
}

/** Finds a saved annotation's text on the page and marks it. Returns false if not found. */
export function anchorAnnotation(ann: Annotation): boolean {
  if (!ann.selector || !document.body) return false;
  if (marksFor(ann.id).length) return true;
  const index = buildIndex(document.body);
  const span = matchSelector(index, ann.selector);
  if (!span) return false;
  return markSpan(index, span, ann).length > 0;
}

export function marksFor(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`${MARK_TAG}[data-id="${CSS.escape(id)}"]`));
}

export function removeMarks(id: string): void {
  for (const m of marksFor(id)) unwrap(m);
}

export function removeAllMarks(): void {
  for (const m of Array.from(document.querySelectorAll(MARK_TAG))) unwrap(m);
}

export function updateMarks(ann: Annotation): void {
  const marks = marksFor(ann.id);
  for (const m of marks) m.dataset.color = ann.color satisfies Color;
  setHasNote(marks, !!ann.note.trim());
}

export function flashMarks(id: string): void {
  const marks = marksFor(id);
  for (const m of marks) m.classList.add('nm-flash');
  setTimeout(() => marks.forEach((m) => m.classList.remove('nm-flash')), 1400);
}

/** Bounding box (viewport coords) of all marks for an annotation. */
export function marksRect(id: string): DOMRect | null {
  const marks = marksFor(id);
  if (!marks.length) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const m of marks) {
    for (const rect of Array.from(m.getClientRects())) {
      l = Math.min(l, rect.left);
      t = Math.min(t, rect.top);
      r = Math.max(r, rect.right);
      b = Math.max(b, rect.bottom);
    }
  }
  return Number.isFinite(l) ? new DOMRect(l, t, r - l, b - t) : null;
}
