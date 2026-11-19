import { browser } from 'wxt/browser';
import type { Annotation, AnnotationPatch, NewAnnotation, Page, PageInfo } from './types';

/** Requests handled by the background service worker. */
export type BgRequest =
  | { type: 'getAnnotations'; url: string }
  | { type: 'createAnnotation'; annotation: NewAnnotation; page: PageInfo }
  | { type: 'updateAnnotation'; id: string; patch: AnnotationPatch }
  | { type: 'deleteAnnotation'; id: string }
  | { type: 'deletePage'; url: string }
  | { type: 'updatePageNote'; page: PageInfo; note: string }
  | { type: 'captureVisible' }
  | {
      type: 'saveClip';
      dataUrl: string;
      width: number;
      height: number;
      annotation: NewAnnotation;
      page: PageInfo;
    }
  | { type: 'activateTab'; tabId: number };

export interface BgResponses {
  getAnnotations: Annotation[];
  createAnnotation: Annotation;
  updateAnnotation: Annotation | null;
  deleteAnnotation: null;
  deletePage: null;
  updatePageNote: Page;
  captureVisible: string;
  saveClip: Annotation;
  activateTab: null;
}

const BG_TYPES = new Set<string>([
  'getAnnotations',
  'createAnnotation',
  'updateAnnotation',
  'deleteAnnotation',
  'deletePage',
  'updatePageNote',
  'captureVisible',
  'saveClip',
  'activateTab',
]);

export function isBgRequest(msg: unknown): msg is BgRequest {
  return !!msg && typeof msg === 'object' && BG_TYPES.has((msg as { type?: string }).type ?? '');
}

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export async function sendToBackground<R extends BgRequest>(req: R): Promise<BgResponses[R['type']]> {
  const res = (await browser.runtime.sendMessage(req)) as Envelope<BgResponses[R['type']]> | undefined;
  if (!res) throw new Error(`No response for ${req.type}`);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Messages sent to the content script running in a tab. */
export type TabMessage =
  | { type: 'ping' }
  | { type: 'toggle' }
  | { type: 'setEnabled'; enabled: boolean }
  | { type: 'command'; command: 'highlight' | 'highlightNote' | 'clip' | 'snip' }
  | { type: 'scrollTo'; id: string }
  | { type: 'annotationUpdated'; annotation: Annotation }
  | { type: 'annotationDeleted'; id: string }
  | { type: 'reload' }
  | { type: 'getStatus' };

export interface TabStatus {
  enabled: boolean;
  url: string;
  orphanIds: string[];
}

/** Broadcasts that extension pages (side panel, library) listen for. */
export type Broadcast = { type: 'status'; status: TabStatus } | { type: 'dbChanged'; pageUrl: string };

export async function sendToTab<T = unknown>(tabId: number, msg: TabMessage): Promise<T | undefined> {
  try {
    return (await browser.tabs.sendMessage(tabId, msg)) as T;
  } catch {
    return undefined;
  }
}
