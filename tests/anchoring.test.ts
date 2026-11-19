import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildIndex,
  describeRange,
  matchSelector,
  normSpanToRaw,
  rangeToSpan,
  spanToRange,
  unwrap,
  wrapRaw,
} from '../lib/anchoring';

function rangeFor(text: string, occurrence = 0): Range {
  const index = buildIndex(document.body);
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = index.norm.indexOf(text, at + 1);
  if (at < 0) throw new Error(`"${text}" not in page`);
  return spanToRange(index, { start: at, end: at + text.length })!;
}

function wrap(text: string, occurrence = 0): HTMLElement[] {
  const index = buildIndex(document.body);
  const span = rangeToSpan(index, rangeFor(text, occurrence))!;
  const { rs, re } = normSpanToRaw(index, span.start, span.end);
  return wrapRaw(index, rs, re, () => document.createElement('notes-mark'));
}

beforeEach(() => {
  document.body.innerHTML = `
    <article>
      <h1>The   Title</h1>
      <p>The quick <em>brown</em> fox jumps over the lazy dog.</p>
      <p>Repeat me. Some filler text here. Repeat me. More text after.</p>
      <script>var ignored = "quick brown";</script>
      <table><tbody><tr><td>cell one</td><td>cell two</td></tr></tbody></table>
    </article>`;
});

describe('describe + match', () => {
  it('builds a selector with context and finds it again', () => {
    const index = buildIndex(document.body);
    const sel = describeRange(index, rangeFor('quick brown fox'))!;
    expect(sel.exact).toBe('quick brown fox');
    expect(sel.prefix.endsWith('The ')).toBe(true);
    expect(sel.suffix.startsWith(' jumps')).toBe(true);
    expect(matchSelector(buildIndex(document.body), sel)).toEqual({ start: sel.start, end: sel.end });
  });

  it('collapses whitespace and ignores script text', () => {
    const index = buildIndex(document.body);
    expect(index.norm).toContain('The Title');
    expect(index.norm).not.toContain('ignored');
  });

  it('trims whitespace at the edges of a selection', () => {
    const index = buildIndex(document.body);
    const span = { start: index.norm.indexOf(' brown'), end: index.norm.indexOf('brown ') + 'brown '.length };
    const sel = describeRange(index, spanToRange(index, span)!)!;
    expect(sel.exact).toBe('brown');
  });

  it('picks the right one of several identical passages using context', () => {
    const index = buildIndex(document.body);
    const second = describeRange(index, rangeFor('Repeat me.', 1))!;
    const first = describeRange(index, rangeFor('Repeat me.', 0))!;
    expect(second.start).toBeGreaterThan(first.start);
    const fresh = buildIndex(document.body);
    expect(matchSelector(fresh, second)!.start).toBe(second.start);
    expect(matchSelector(fresh, first)!.start).toBe(first.start);
  });

  it('re-anchors after content is inserted above the passage', () => {
    const sel = describeRange(buildIndex(document.body), rangeFor('lazy dog'))!;
    const banner = document.createElement('div');
    banner.textContent = 'Subscribe to our newsletter! '.repeat(5);
    document.body.prepend(banner);
    const index = buildIndex(document.body);
    const span = matchSelector(index, sel)!;
    expect(index.norm.slice(span.start, span.end)).toBe('lazy dog');
    expect(span.start).toBeGreaterThan(sel.start);
  });

  it('re-anchors when markup changes but text does not', () => {
    const sel = describeRange(buildIndex(document.body), rangeFor('quick brown fox'))!;
    document.querySelector('p')!.innerHTML = 'The   quick brown\n   fox jumps over the lazy dog.';
    const span = matchSelector(buildIndex(document.body), sel);
    expect(span).not.toBeNull();
  });

  it('returns null when the text is gone', () => {
    const sel = describeRange(buildIndex(document.body), rangeFor('lazy dog'))!;
    document.querySelector('p')!.textContent = 'Completely different.';
    expect(matchSelector(buildIndex(document.body), sel)).toBeNull();
  });

  it('handles element-level range boundaries', () => {
    const p = document.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = describeRange(buildIndex(document.body), range)!;
    expect(sel.exact).toBe('The quick brown fox jumps over the lazy dog.');
  });
});

describe('wrap + unwrap', () => {
  it('wraps across element boundaries without changing the text', () => {
    const before = document.body.textContent;
    const marks = wrap('quick brown fox');
    expect(marks.map((m) => m.textContent)).toEqual(['quick ', 'brown', ' fox']);
    expect(document.body.textContent).toBe(before);
    expect(document.querySelector('em notes-mark')?.textContent).toBe('brown');
  });

  it('unwrap restores the original DOM text and merges text nodes', () => {
    const p = document.querySelector('p')!;
    const html = p.innerHTML;
    for (const m of wrap('quick brown fox')) unwrap(m);
    expect(p.innerHTML).toBe(html);
    expect(p.childNodes.length).toBe(3);
  });

  it('does not wrap whitespace text nodes inside table structure', () => {
    document.body.innerHTML = '<table><tbody>\n<tr><td>alpha</td>\n<td>beta</td></tr>\n</tbody></table>';
    const marks = wrap('alpha beta');
    expect(marks.map((m) => m.parentElement!.tagName)).toEqual(['TD', 'TD']);
    expect(document.querySelector('tr')!.children.length).toBe(2);
  });

  it('a wrapped passage can still be matched afterwards', () => {
    const sel = describeRange(buildIndex(document.body), rangeFor('fox jumps'))!;
    wrap('quick brown');
    const index = buildIndex(document.body);
    const span = matchSelector(index, sel)!;
    expect(index.norm.slice(span.start, span.end)).toBe('fox jumps');
  });
});
