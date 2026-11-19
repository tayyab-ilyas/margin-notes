import type { TextQuoteSelector } from './types';

/**
 * Text anchoring: turn a DOM Range into a TextQuoteSelector, and find that
 * selector again later (after a reload, or after the page re-rendered).
 *
 * All matching happens on a whitespace-collapsed copy of the page text, so
 * reflowed markup and different indentation don't break anchors.
 */

export const CONTEXT_LEN = 32;
const MAX_CANDIDATES = 1000;

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'TEMPLATE',
  'IFRAME',
  'OBJECT',
  'SELECT',
  'NOTES-EXT-UI',
]);

/** Elements where wrapping a whitespace-only text node would break layout. */
const STRUCTURAL_PARENTS = new Set([
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'COLGROUP',
  'UL',
  'OL',
  'DL',
  'SELECT',
  'DATALIST',
  'OPTGROUP',
]);

export interface TextIndex {
  root: Node;
  nodes: Text[];
  /** Raw-text start offset of each node in `nodes`. */
  starts: number[];
  nodePos: Map<Text, number>;
  raw: string;
  /** `raw` with every whitespace run collapsed to one space. */
  norm: string;
  /** norm index -> raw index; has one extra trailing entry equal to raw.length. */
  normToRaw: number[];
}

export function buildIndex(root: Node): TextIndex {
  const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument!;
  const walker = doc.createTreeWalker(root, 0x1 | 0x4 /* SHOW_ELEMENT | SHOW_TEXT */, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        // REJECT skips the whole subtree; SKIP just doesn't yield the element itself.
        return SKIP_TAGS.has((node as Element).tagName.toUpperCase()) ? 2 : 3;
      }
      return 1;
    },
  });
  const nodes: Text[] = [];
  const starts: number[] = [];
  const nodePos = new Map<Text, number>();
  const chunks: string[] = [];
  let len = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType !== 3) continue;
    const t = n as Text;
    nodePos.set(t, nodes.length);
    nodes.push(t);
    starts.push(len);
    chunks.push(t.data);
    len += t.data.length;
  }
  const raw = chunks.join('');

  const normChars: string[] = [];
  const normToRaw: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === ' ') {
      if (!prevSpace) {
        normChars.push(' ');
        normToRaw.push(i);
      }
      prevSpace = true;
    } else {
      normChars.push(c);
      normToRaw.push(i);
      prevSpace = false;
    }
  }
  normToRaw.push(raw.length);
  return { root, nodes, starts, nodePos, raw, norm: normChars.join(''), normToRaw };
}

/** Smallest i such that pred(i) is true, assuming pred is monotonic over [0, n). Returns n if none. */
function lowerBound(n: number, pred: (i: number) => boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Converts a DOM boundary point to an offset into `index.raw`. */
export function boundaryToRaw(index: TextIndex, container: Node, offset: number): number {
  if (container.nodeType === 3) {
    const pos = index.nodePos.get(container as Text);
    if (pos !== undefined) return index.starts[pos] + Math.min(offset, (container as Text).length);
  }
  const doc = container.ownerDocument ?? (container as Document);
  const point = doc.createRange();
  point.setStart(container, offset);
  // First indexed text node that starts at or after the boundary point.
  const i = lowerBound(index.nodes.length, (k) => point.comparePoint(index.nodes[k], 0) >= 0);
  return i < index.nodes.length ? index.starts[i] : index.raw.length;
}

function rawToNorm(index: TextIndex, raw: number): number {
  return lowerBound(index.normToRaw.length, (j) => index.normToRaw[j] >= raw);
}

/** Converts a normalized [start, end) span back to raw offsets. */
export function normSpanToRaw(index: TextIndex, start: number, end: number): { rs: number; re: number } {
  return { rs: index.normToRaw[start], re: index.normToRaw[end - 1] + 1 };
}

export interface NormSpan {
  start: number;
  end: number;
}

/** Normalized span covered by a DOM range, with surrounding whitespace trimmed. */
export function rangeToSpan(index: TextIndex, range: Range): NormSpan | null {
  const rs = boundaryToRaw(index, range.startContainer, range.startOffset);
  const re = boundaryToRaw(index, range.endContainer, range.endOffset);
  let start = rawToNorm(index, rs);
  let end = rawToNorm(index, re);
  while (start < end && index.norm[start] === ' ') start++;
  while (end > start && index.norm[end - 1] === ' ') end--;
  return start < end ? { start, end } : null;
}

export function spanToSelector(index: TextIndex, span: NormSpan): TextQuoteSelector {
  const { norm } = index;
  return {
    exact: norm.slice(span.start, span.end),
    prefix: norm.slice(Math.max(0, span.start - CONTEXT_LEN), span.start),
    suffix: norm.slice(span.end, span.end + CONTEXT_LEN),
    start: span.start,
    end: span.end,
  };
}

export function describeRange(index: TextIndex, range: Range): TextQuoteSelector | null {
  const span = rangeToSpan(index, range);
  return span ? spanToSelector(index, span) : null;
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Finds the best occurrence of `selector.exact` in the page: the one whose
 * surrounding text best matches the saved prefix/suffix, with the saved
 * position as a tie-breaker.
 */
export function matchSelector(index: TextIndex, selector: TextQuoteSelector): NormSpan | null {
  const { norm } = index;
  const exact = selector.exact;
  if (!exact) return null;
  let best: NormSpan | null = null;
  let bestScore = -Infinity;
  let count = 0;
  for (let i = norm.indexOf(exact); i !== -1 && count < MAX_CANDIDATES; i = norm.indexOf(exact, i + 1), count++) {
    const before = norm.slice(Math.max(0, i - selector.prefix.length), i);
    const after = norm.slice(i + exact.length, i + exact.length + selector.suffix.length);
    const contextScore = commonSuffixLen(before, selector.prefix) + commonPrefixLen(after, selector.suffix);
    // Up to 4 points for being near where it used to be.
    const proximity = 4 * (1 - Math.min(1, Math.abs(i - selector.start) / Math.max(1, norm.length)));
    const score = contextScore + proximity;
    if (score > bestScore) {
      bestScore = score;
      best = { start: i, end: i + exact.length };
    }
  }
  return best;
}

/** Builds a DOM Range for a normalized span (used for scrolling and measuring). */
export function spanToRange(index: TextIndex, span: NormSpan): Range | null {
  const { rs, re } = normSpanToRaw(index, span.start, span.end);
  if (!index.nodes.length) return null;
  const si = lowerBound(index.nodes.length, (k) => index.starts[k] + index.nodes[k].length > rs);
  const ei = lowerBound(index.nodes.length, (k) => index.starts[k] + index.nodes[k].length >= re);
  if (si >= index.nodes.length || ei >= index.nodes.length) return null;
  const doc = index.nodes[0].ownerDocument;
  const range = doc.createRange();
  range.setStart(index.nodes[si], rs - index.starts[si]);
  range.setEnd(index.nodes[ei], re - index.starts[ei]);
  return range;
}

/**
 * Wraps the text in raw [rs, re) with elements from `make`, splitting text
 * nodes at the boundaries. The index is stale afterwards; rebuild it.
 */
export function wrapRaw(index: TextIndex, rs: number, re: number, make: () => HTMLElement): HTMLElement[] {
  const targets: { node: Text; a: number; b: number }[] = [];
  const first = lowerBound(index.nodes.length, (k) => index.starts[k] + index.nodes[k].length > rs);
  for (let k = first; k < index.nodes.length && index.starts[k] < re; k++) {
    const node = index.nodes[k];
    const s = index.starts[k];
    const a = Math.max(rs, s) - s;
    const b = Math.min(re, s + node.length) - s;
    if (a < b) targets.push({ node, a, b });
  }
  const out: HTMLElement[] = [];
  for (const { node, a, b } of targets) {
    let target = node;
    if (b < target.length) target.splitText(b);
    if (a > 0) target = target.splitText(a);
    const parent = target.parentNode;
    if (!parent) continue;
    if (!target.data.trim() && STRUCTURAL_PARENTS.has((parent as Element).tagName?.toUpperCase())) continue;
    const el = make();
    parent.insertBefore(el, target);
    el.appendChild(target);
    out.push(el);
  }
  return out;
}

/** Removes a wrapper element, keeping its children in place. */
export function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}
