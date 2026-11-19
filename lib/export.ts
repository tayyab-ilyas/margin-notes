import JSZip from 'jszip';
import { blobToDataUrl, dataUrlToBlob } from './capture';
import type { NotesDB } from './db';
import type { Annotation, Page, StoredImage } from './types';

export function slugify(s: string, fallback = 'page'): string {
  const slug = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || fallback;
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Renders one page's notes as Markdown. `imagePath` maps an image id to the
 * path used in the image link (e.g. "images/<id>.png").
 */
export function pageToMarkdown(page: Page, annotations: Annotation[], imagePath: (id: string) => string): string {
  const out: string[] = [];
  out.push(`# ${page.title || page.url}`, '');
  out.push(`Source: <${page.url}>  `, `Saved: ${formatDate(page.firstSeen)}`, '');
  if (page.note.trim()) {
    out.push('## Page note', '', page.note.trim(), '');
  }
  const sorted = [...annotations].sort((a, b) => a.docY - b.docY || a.createdAt - b.createdAt);
  if (sorted.length) {
    out.push('## Highlights', '');
    for (const a of sorted) {
      if (a.type === 'clip' && a.imageId) out.push(`![Clip](${imagePath(a.imageId)})`, '');
      if (a.selector?.exact) out.push(quote(a.selector.exact), '');
      if (a.note.trim()) out.push(a.note.trim(), '');
      if (a.tags.length) out.push(`Tags: ${a.tags.map((t) => `#${t.replace(/\s+/g, '-')}`).join(' ')}`, '');
      out.push('---', '');
    }
    // Drop the trailing "---" separator (and its blank line).
    out.pop();
    out.pop();
  }
  return out.join('\n');
}

export interface MarkdownExport {
  blob: Blob;
  filename: string;
}

/**
 * Exports the given pages (or all pages). A single page without screenshots
 * becomes a plain .md file; anything else becomes a .zip with an images folder.
 */
export async function exportMarkdown(db: NotesDB, pageUrls?: string[]): Promise<MarkdownExport | null> {
  const pages = pageUrls
    ? ((await db.pages.bulkGet(pageUrls)).filter(Boolean) as Page[])
    : await db.pages.orderBy('lastSeen').reverse().toArray();
  if (!pages.length) return null;

  const entries: { page: Page; anns: Annotation[] }[] = [];
  for (const page of pages) {
    entries.push({ page, anns: await db.annotations.where('pageUrl').equals(page.url).toArray() });
  }
  const imageIds = entries.flatMap((e) => e.anns.map((a) => a.imageId).filter((x): x is string => !!x));

  if (entries.length === 1 && imageIds.length === 0) {
    const { page, anns } = entries[0];
    const md = pageToMarkdown(page, anns, (id) => `images/${id}.png`);
    return { blob: new Blob([md], { type: 'text/markdown' }), filename: `${slugify(page.title)}.md` };
  }

  const zip = new JSZip();
  const used = new Set<string>();
  for (const { page, anns } of entries) {
    let name = slugify(page.title);
    for (let n = 2; used.has(name); n++) name = `${slugify(page.title)}-${n}`;
    used.add(name);
    zip.file(`${name}.md`, pageToMarkdown(page, anns, (id) => `images/${id}.png`));
  }
  const images = (await db.images.bulkGet(imageIds)).filter(Boolean) as StoredImage[];
  for (const img of images) zip.file(`images/${img.id}.png`, img.blob);

  const filename = entries.length === 1 ? `${slugify(entries[0].page.title)}.zip` : `margin-notes-${formatDate(Date.now())}.zip`;
  return { blob: await zip.generateAsync({ type: 'blob' }), filename };
}

interface BackupImage {
  id: string;
  width: number;
  height: number;
  createdAt: number;
  dataUrl: string;
}

export interface Backup {
  format: 'margin-notes-backup';
  version: 1;
  exportedAt: number;
  pages: Page[];
  annotations: Annotation[];
  images: BackupImage[];
}

export async function exportBackup(db: NotesDB): Promise<Blob> {
  const images: BackupImage[] = [];
  for (const img of await db.images.toArray()) {
    images.push({ id: img.id, width: img.width, height: img.height, createdAt: img.createdAt, dataUrl: await blobToDataUrl(img.blob) });
  }
  const backup: Backup = {
    format: 'margin-notes-backup',
    version: 1,
    exportedAt: Date.now(),
    pages: await db.pages.toArray(),
    annotations: await db.annotations.toArray(),
    images,
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Merges a backup into the database; records with the same id are overwritten. */
export async function importBackup(db: NotesDB, json: string): Promise<{ pages: number; annotations: number; images: number }> {
  const data = JSON.parse(json) as Partial<Backup>;
  if (data.format !== 'margin-notes-backup' || !Array.isArray(data.pages) || !Array.isArray(data.annotations)) {
    throw new Error('This file is not a Margin Notes backup.');
  }
  const images: StoredImage[] = (data.images ?? []).map((i) => ({
    id: i.id,
    width: i.width,
    height: i.height,
    createdAt: i.createdAt,
    blob: dataUrlToBlob(i.dataUrl),
  }));
  await db.transaction('rw', db.pages, db.annotations, db.images, async () => {
    await db.pages.bulkPut(data.pages!);
    await db.annotations.bulkPut(data.annotations!);
    await db.images.bulkPut(images);
  });
  return { pages: data.pages.length, annotations: data.annotations.length, images: images.length };
}
