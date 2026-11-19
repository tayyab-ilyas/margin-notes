// @vitest-environment node
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { annotationsForPage, deletePage, NotesDB } from '../lib/db';
import { exportBackup, exportMarkdown, importBackup, pageToMarkdown, slugify } from '../lib/export';
import type { Annotation, Page } from '../lib/types';

const page: Page = {
  url: 'https://ex.com/post',
  title: 'On Reading Well',
  note: 'Great piece on attention.',
  firstSeen: Date.UTC(2026, 10, 1),
  lastSeen: Date.UTC(2026, 10, 2),
};

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: 'a1',
    pageUrl: page.url,
    type: 'highlight',
    color: 'yellow',
    selector: { exact: 'Read slowly.', prefix: '', suffix: '', start: 0, end: 12 },
    note: '',
    tags: [],
    docY: 100,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

let db: NotesDB;
let n = 0;
beforeEach(() => {
  db = new NotesDB(`test-${n++}`);
});

describe('pageToMarkdown', () => {
  it('renders title, source, page note, quotes, notes, tags and clips in reading order', () => {
    const md = pageToMarkdown(
      page,
      [
        ann({ id: 'b', docY: 500, type: 'clip', imageId: 'img1', selector: undefined, note: 'Diagram' }),
        ann({ id: 'a', docY: 100, note: 'Key idea', tags: ['focus', 'deep work'], selector: { exact: 'Line one\nLine two', prefix: '', suffix: '', start: 0, end: 1 } }),
      ],
      (id) => `images/${id}.png`,
    );
    expect(md).toBe(
      [
        '# On Reading Well',
        '',
        'Source: <https://ex.com/post>  ',
        'Saved: 2026-11-01',
        '',
        '## Page note',
        '',
        'Great piece on attention.',
        '',
        '## Highlights',
        '',
        '> Line one',
        '> Line two',
        '',
        'Key idea',
        '',
        'Tags: #focus #deep-work',
        '',
        '---',
        '',
        '![Clip](images/img1.png)',
        '',
        'Diagram',
        '',
      ].join('\n'),
    );
  });
});

describe('slugify', () => {
  it('makes safe filenames', () => {
    expect(slugify('Héllo, World! — A "Test"')).toBe('hello-world-a-test');
    expect(slugify('???')).toBe('page');
  });
});

describe('database', () => {
  it('stores and orders annotations per page; deletePage removes everything', async () => {
    await db.pages.put(page);
    await db.annotations.bulkPut([ann({ id: 'x', docY: 300 }), ann({ id: 'y', docY: 10, imageId: 'i' })]);
    await db.images.put({ id: 'i', blob: new Blob(['png']), width: 1, height: 1, createdAt: 1 });
    expect((await annotationsForPage(db, page.url)).map((a) => a.id)).toEqual(['y', 'x']);
    await deletePage(db, page.url);
    expect(await db.annotations.count()).toBe(0);
    expect(await db.images.count()).toBe(0);
    expect(await db.pages.count()).toBe(0);
  });

  it('exports a single text-only page as .md and a page with clips as .zip', async () => {
    await db.pages.put(page);
    await db.annotations.put(ann({}));
    const md = await exportMarkdown(db, [page.url]);
    expect(md!.filename).toBe('on-reading-well.md');
    expect(await md!.blob.text()).toContain('> Read slowly.');

    await db.annotations.put(ann({ id: 'c', type: 'clip', imageId: 'img' }));
    await db.images.put({ id: 'img', blob: new Blob(['PNGDATA'], { type: 'image/png' }), width: 1, height: 1, createdAt: 1 });
    const zipped = await exportMarkdown(db, [page.url]);
    expect(zipped!.filename).toBe('on-reading-well.zip');
    const zip = await JSZip.loadAsync(await zipped!.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['images/', 'images/img.png', 'on-reading-well.md']);
    expect(await zip.file('images/img.png')!.async('string')).toBe('PNGDATA');
  });

  it('backs up and restores including images', async () => {
    await db.pages.put(page);
    await db.annotations.put(ann({ id: 'c', type: 'clip', imageId: 'img' }));
    await db.images.put({ id: 'img', blob: new Blob(['PNGDATA'], { type: 'image/png' }), width: 3, height: 4, createdAt: 1 });
    const json = await (await exportBackup(db)).text();

    const fresh = new NotesDB(`test-${n++}`);
    const counts = await importBackup(fresh, json);
    expect(counts).toEqual({ pages: 1, annotations: 1, images: 1 });
    const img = await fresh.images.get('img');
    expect(await img!.blob.text()).toBe('PNGDATA');
    expect(img!.width).toBe(3);
  });

  it('rejects files that are not backups', async () => {
    await expect(importBackup(db, '{"hello":1}')).rejects.toThrow(/not a Margin Notes backup/);
  });
});
