import { describe, expect, it } from 'vitest';
import { blobToDataUrl, dataUrlToBlob, planSegments } from '../lib/capture';
import { isAnnotatable, normalizeUrl } from '../lib/url';

describe('normalizeUrl', () => {
  it('drops hash and tracking params, keeps real params', () => {
    expect(normalizeUrl('https://ex.com/a?utm_source=x&id=3&fbclid=y#sec')).toBe('https://ex.com/a?id=3');
  });
  it('sorts params so order does not matter', () => {
    expect(normalizeUrl('https://ex.com/a?b=2&a=1')).toBe(normalizeUrl('https://ex.com/a?a=1&b=2'));
  });
  it('leaves a bare URL alone', () => {
    expect(normalizeUrl('https://ex.com/post/')).toBe('https://ex.com/post/');
    expect(normalizeUrl('https://ex.com/post?utm_medium=a')).toBe('https://ex.com/post');
  });
  it('passes through garbage', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('isAnnotatable', () => {
  it('allows web pages and rejects browser pages', () => {
    expect(isAnnotatable('https://en.wikipedia.org/wiki/Ink')).toBe(true);
    expect(isAnnotatable('chrome://extensions')).toBe(false);
    expect(isAnnotatable('https://chromewebstore.google.com/detail/x')).toBe(false);
    expect(isAnnotatable(undefined)).toBe(false);
  });
});

describe('planSegments', () => {
  it('captures in place when the region is already visible', () => {
    expect(planSegments({ top: 1100, height: 200 }, 800, 1000, 5000)).toEqual([
      { scrollY: 1000, cropTop: 100, cropHeight: 200, destY: 0 },
    ]);
  });

  it('splits a tall region into contiguous viewport slices', () => {
    const segs = planSegments({ top: 500, height: 2000 }, 800, 0, 10_000);
    expect(segs.map((s) => s.destY)).toEqual([0, 800, 1600]);
    expect(segs.reduce((n, s) => n + s.cropHeight, 0)).toBe(2000);
    for (const s of segs) expect(s.cropTop + s.cropHeight).toBeLessThanOrEqual(800);
  });

  it('handles regions at the bottom of the page where scrolling is clamped', () => {
    // Page is 3000 tall, viewport 800 → max scroll 2200. Region 2500..2900.
    const segs = planSegments({ top: 2500, height: 400 }, 800, 0, 2200);
    expect(segs).toEqual([{ scrollY: 2200, cropTop: 300, cropHeight: 400, destY: 0 }]);
  });

  it('never loops forever when the region is unreachable', () => {
    const segs = planSegments({ top: 5000, height: 400 }, 800, 0, 1000);
    expect(segs).toEqual([]);
  });
});

describe('data URLs', () => {
  it('round-trips a blob', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: 'image/png' });
    const back = dataUrlToBlob(await blobToDataUrl(blob));
    expect(back.type).toBe('image/png');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 0, 255]));
  });
});
