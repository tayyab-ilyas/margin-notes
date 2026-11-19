// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotesDB } from '../lib/db';
import { getClip, getPage, listPages, runMcpQuery, searchNotes } from '../lib/mcp';
import type { Annotation } from '../lib/types';

const url = 'https://slowreader.example/why-you-forget';
let database: NotesDB;

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: 'a1',
    pageUrl: url,
    type: 'highlight',
    color: 'yellow',
    selector: { exact: 'They are the ones who leave a trail', prefix: '', suffix: '', start: 0, end: 10 },
    note: 'This is the habit.',
    tags: ['memory'],
    docY: 200,
    createdAt: 2,
    updatedAt: 2,
    ...over,
  };
}

beforeEach(async () => {
  database = new NotesDB(`mcp-${Math.random()}`);
  await database.pages.bulkPut([
    { url, title: 'Why you forget what you read', note: 'Reread on Sunday', firstSeen: 1, lastSeen: 5 },
    { url: 'https://ex.com/other', title: 'Other', note: '', firstSeen: 1, lastSeen: 3 },
  ]);
  await database.annotations.bulkPut([
    ann({}),
    ann({ id: 'a2', color: 'green', selector: { exact: 'Most of what we read is gone', prefix: '', suffix: '', start: 0, end: 1 }, note: '', tags: [], docY: 100, createdAt: 1 }),
    ann({ id: 'c1', type: 'clip', selector: undefined, imageId: 'img1', note: 'the curve', tags: [], docY: 300, createdAt: 3 }),
    ann({ id: 'o1', pageUrl: 'https://ex.com/other', selector: { exact: 'unrelated', prefix: '', suffix: '', start: 0, end: 1 }, note: '', tags: [], createdAt: 4 }),
  ]);
  await database.images.put({ id: 'img1', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), width: 10, height: 5, createdAt: 3 });
});

describe('mcp queries', () => {
  it('searches text, notes and tags, newest first, plus page notes', async () => {
    expect((await searchNotes(database, { query: 'HABIT' })).map((h) => h.id)).toEqual(['a1']);
    expect((await searchNotes(database, { tag: 'memory' })).map((h) => h.id)).toEqual(['a1']);
    expect((await searchNotes(database, { color: 'green' })).map((h) => h.id)).toEqual(['a2']);
    expect((await searchNotes(database, { query: 'forget' })).map((h) => h.id)).toEqual(['c1', 'a1', 'a2']); // page title match
    const [pn] = await searchNotes(database, { query: 'sunday' });
    expect(pn).toMatchObject({ kind: 'page note', page: { url } });
    expect(await searchNotes(database, { limit: 2 })).toHaveLength(2);
  });

  it('lists pages with counts, most recent first', async () => {
    const pages = await listPages(database);
    expect(pages.map((p) => p.url)).toEqual([url, 'https://ex.com/other']);
    expect(pages[0]).toMatchObject({ highlights: 2, clips: 1, hasPageNote: true });
  });

  it('renders a page as Markdown with clip ids the clip tool accepts', async () => {
    const { markdown } = await getPage(database, url + '#section');
    expect(markdown).toContain('# Why you forget what you read');
    expect(markdown.indexOf('Most of what we read')).toBeLessThan(markdown.indexOf('They are the ones'));
    expect(markdown).toContain('![Clip](clip:c1)');
    await expect(getPage(database, 'https://nope.example')).rejects.toThrow(/No notes saved/);
  });

  it('returns clip images as base64', async () => {
    const clip = await getClip(database, 'clip:c1');
    expect(clip).toMatchObject({ mimeType: 'image/png', data: 'AQID', width: 10, note: 'the curve' });
    await expect(getClip(database, 'a1')).rejects.toThrow(/No clip/);
  });

  it('rejects unknown methods', async () => {
    await expect(runMcpQuery(database, 'deleteEverything', {})).rejects.toThrow(/Unknown method/);
  });
});
