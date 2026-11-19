import { blobToDataUrl } from './capture';
import { annotationsForPage, type NotesDB } from './db';
import { pageToMarkdown } from './export';
import { normalizeUrl } from './url';
import type { Annotation, Color } from './types';

/** Queries the MCP server (mcp/server.mjs) can ask the extension. Read-only on purpose. */
export type McpMethod = 'search_notes' | 'list_pages' | 'get_page' | 'get_clip';

export interface SearchParams {
  query?: string;
  color?: Color;
  tag?: string;
  limit?: number;
}

export interface SearchHit {
  id: string;
  kind: 'highlight' | 'clip' | 'page note';
  color?: Color;
  text: string;
  note: string;
  tags: string[];
  page: { title: string; url: string };
  savedAt: string;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const has = (s: string | undefined, q: string) => !!s && s.toLowerCase().includes(q);

export async function searchNotes(database: NotesDB, p: SearchParams): Promise<SearchHit[]> {
  const q = (p.query ?? '').trim().toLowerCase();
  const tag = (p.tag ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(p.limit ?? 20, 1), 100);
  const pages = new Map((await database.pages.toArray()).map((pg) => [pg.url, pg]));
  const anns = await database.annotations.orderBy('createdAt').reverse().toArray();
  const hits: SearchHit[] = [];

  for (const a of anns) {
    const pg = pages.get(a.pageUrl);
    if (p.color && a.color !== p.color) continue;
    if (tag && !a.tags.some((t) => t.toLowerCase() === tag)) continue;
    if (q && !(has(a.selector?.exact, q) || has(a.note, q) || a.tags.some((t) => has(t, q)) || has(pg?.title, q))) continue;
    hits.push({
      id: a.id,
      kind: a.type,
      color: a.color,
      text: a.selector?.exact ?? '',
      note: a.note,
      tags: a.tags,
      page: { title: pg?.title ?? a.pageUrl, url: a.pageUrl },
      savedAt: day(a.createdAt),
    });
  }
  // Page notes have no color or tags, so they only match a plain text query.
  if (q && !p.color && !tag) {
    for (const pg of pages.values()) {
      if (has(pg.note, q)) {
        hits.push({ id: pg.url, kind: 'page note', text: '', note: pg.note, tags: [], page: { title: pg.title, url: pg.url }, savedAt: day(pg.lastSeen) });
      }
    }
  }
  return hits.slice(0, limit);
}

export async function listPages(database: NotesDB, limit = 50) {
  const pages = await database.pages.orderBy('lastSeen').reverse().limit(Math.min(Math.max(limit, 1), 500)).toArray();
  const anns = await database.annotations.toArray();
  return pages.map((pg) => {
    const mine = anns.filter((a) => a.pageUrl === pg.url);
    return {
      title: pg.title,
      url: pg.url,
      highlights: mine.filter((a) => a.type === 'highlight').length,
      clips: mine.filter((a) => a.type === 'clip').length,
      hasPageNote: !!pg.note.trim(),
      lastVisited: day(pg.lastSeen),
    };
  });
}

/** One page as Markdown, the same format as Export. Clip images are referenced as clip:<annotation id>. */
export async function getPage(database: NotesDB, url: string) {
  const page = await database.pages.get(normalizeUrl(url));
  if (!page) throw new Error(`No notes saved for ${url}. Use list_pages to see saved pages.`);
  const anns = await annotationsForPage(database, page.url);
  const clipOf = new Map(anns.filter((a) => a.imageId).map((a) => [a.imageId!, a.id]));
  return { markdown: pageToMarkdown(page, anns, (imageId) => `clip:${clipOf.get(imageId)}`) };
}

export async function getClip(database: NotesDB, id: string) {
  const ann: Annotation | undefined = await database.annotations.get(id.replace(/^clip:/, ''));
  if (!ann?.imageId) throw new Error(`No clip with id ${id}`);
  const img = await database.images.get(ann.imageId);
  if (!img) throw new Error(`The image for clip ${id} is missing`);
  const dataUrl = await blobToDataUrl(img.blob);
  return {
    mimeType: img.blob.type || 'image/png',
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    width: img.width,
    height: img.height,
    pageUrl: ann.pageUrl,
    text: ann.selector?.exact ?? '',
    note: ann.note,
  };
}

export function runMcpQuery(database: NotesDB, method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method as McpMethod) {
    case 'search_notes':
      return searchNotes(database, params as SearchParams);
    case 'list_pages':
      return listPages(database, typeof params.limit === 'number' ? params.limit : undefined);
    case 'get_page':
      return getPage(database, String(params.url ?? ''));
    case 'get_clip':
      return getClip(database, String(params.id ?? ''));
    default:
      return Promise.reject(new Error(`Unknown method ${method}`));
  }
}
