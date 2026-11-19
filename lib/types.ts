export const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;
export type Color = (typeof COLORS)[number];

/** Light-theme highlight swatches; marks on the page use these too. */
export const COLOR_HEX: Record<Color, string> = {
  yellow: '#ffe066',
  green: '#a9e5a0',
  blue: '#a5d8ff',
  pink: '#ffb3d1',
  purple: '#d0bfff',
};

/**
 * Locates a passage by its text plus surrounding context, with a character
 * offset hint (in whitespace-normalized page text) to break ties.
 */
export interface TextQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export type AnnotationType = 'highlight' | 'clip';

export interface Annotation {
  id: string;
  pageUrl: string;
  type: AnnotationType;
  color: Color;
  /** Present for text highlights and for clips taken from a text selection. */
  selector?: TextQuoteSelector;
  note: string;
  tags: string[];
  /** For clips: the screenshot in the `images` table. */
  imageId?: string;
  /** Document-space Y coordinate at creation, used for reading order. */
  docY: number;
  createdAt: number;
  updatedAt: number;
}

export interface Page {
  url: string;
  title: string;
  favicon?: string;
  /** Free-form note about the whole page. */
  note: string;
  firstSeen: number;
  lastSeen: number;
}

export interface StoredImage {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

export type NewAnnotation = Omit<Annotation, 'pageUrl' | 'createdAt' | 'updatedAt'>;
export type AnnotationPatch = Partial<Pick<Annotation, 'note' | 'tags' | 'color'>>;
export interface PageInfo {
  url: string;
  title: string;
  favicon?: string;
}

/** Random id that also works on plain-http pages (where crypto.randomUUID is unavailable). */
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
