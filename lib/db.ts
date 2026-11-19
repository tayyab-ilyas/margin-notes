import Dexie, { type EntityTable } from 'dexie';
import type { Annotation, Page, StoredImage } from './types';

export class NotesDB extends Dexie {
  pages!: EntityTable<Page, 'url'>;
  annotations!: EntityTable<Annotation, 'id'>;
  images!: EntityTable<StoredImage, 'id'>;

  constructor(name = 'margin-notes') {
    super(name);
    this.version(1).stores({
      pages: 'url, lastSeen',
      annotations: 'id, pageUrl, createdAt, *tags',
      images: 'id',
    });
  }
}

export const db = new NotesDB();

export function annotationsForPage(database: NotesDB, pageUrl: string): Promise<Annotation[]> {
  return database.annotations.where('pageUrl').equals(pageUrl).sortBy('docY');
}

/** Deletes a page's annotations and their images, then the page itself. */
export async function deletePage(database: NotesDB, pageUrl: string): Promise<void> {
  await database.transaction('rw', database.pages, database.annotations, database.images, async () => {
    const anns = await database.annotations.where('pageUrl').equals(pageUrl).toArray();
    const imageIds = anns.map((a) => a.imageId).filter((x): x is string => !!x);
    await database.images.bulkDelete(imageIds);
    await database.annotations.bulkDelete(anns.map((a) => a.id));
    await database.pages.delete(pageUrl);
  });
}
