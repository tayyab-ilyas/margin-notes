import { browser } from 'wxt/browser';
import { buildIndex, rangeToSpan, spanToSelector } from '../../lib/anchoring';
import type { DocRect } from '../../lib/capture';
import { sendToBackground, type Broadcast, type TabMessage, type TabStatus } from '../../lib/messages';
import { isAutoEnabled } from '../../lib/settings';
import { newId, type Annotation, type Color, type PageInfo, type TextQuoteSelector } from '../../lib/types';
import { normalizeUrl } from '../../lib/url';
import { captureRegion } from './capture';
import {
  anchorAnnotation,
  flashMarks,
  markSpan,
  marksFor,
  marksRect,
  removeAllMarks,
  removeMarks,
  updateMarks,
} from './highlighter';

export interface Anchor {
  x: number;
  y: number;
  /** Shown below the anchor point instead of above it. */
  below: boolean;
}

export interface UiState {
  enabled: boolean;
  toolbar: Anchor | null;
  popover: (Anchor & { id: string; focus: boolean }) | null;
  snipping: boolean;
  busy: boolean;
  toast: { text: string; kind: 'info' | 'error'; key: number } | null;
  lastColor: Color;
  /** Bumped whenever `annotations` changes so React re-reads it. */
  version: number;
}

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ORPHAN_RETRY_MS = 20_000;
const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function clampX(x: number, margin = 130) {
  return Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - margin));
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export class Controller {
  state: UiState = {
    enabled: false,
    toolbar: null,
    popover: null,
    snipping: false,
    busy: false,
    toast: null,
    lastColor: 'yellow',
    version: 0,
  };
  annotations = new Map<string, Annotation>();
  orphanIds = new Set<string>();
  /** Set by the UI mount: hides our overlay and returns a restore function. */
  hideUi: () => () => void = () => () => {};

  private listeners = new Set<() => void>();
  private savedRange: Range | null = null;
  private observer: MutationObserver | null = null;
  private repositionQueued = false;
  private pageUrl = normalizeUrl(location.href);

  // ---- store plumbing (for useSyncExternalStore) ----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<UiState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private bump() {
    this.set({ version: this.state.version + 1 });
  }

  toast(text: string, kind: 'info' | 'error' = 'info') {
    const key = Date.now() + Math.random();
    this.set({ toast: { text, kind, key } });
    setTimeout(() => {
      if (this.state.toast?.key === key) this.set({ toast: null });
    }, kind === 'error' ? 4500 : 2400);
  }

  private pageInfo(): PageInfo {
    return { url: location.href, title: document.title };
  }

  status(): TabStatus {
    return { enabled: this.state.enabled, url: this.pageUrl, orphanIds: [...this.orphanIds] };
  }

  private reportStatus() {
    const msg: Broadcast = { type: 'status', status: this.status() };
    browser.runtime.sendMessage(msg).catch(() => {});
  }

  // ---- lifecycle ----
  async init() {
    const auto = await isAutoEnabled(location.hostname).catch(() => false);
    if (auto) this.set({ enabled: true });
    await this.load();
  }

  async load() {
    this.pageUrl = normalizeUrl(location.href);
    this.observer?.disconnect();
    this.orphanIds.clear();
    let anns: Annotation[] = [];
    try {
      anns = await sendToBackground({ type: 'getAnnotations', url: location.href });
    } catch (e) {
      console.warn('[Margin Notes] could not load annotations', e);
    }
    this.annotations = new Map(anns.map((a) => [a.id, a]));
    for (const a of anns) {
      if (a.selector && !anchorAnnotation(a)) this.orphanIds.add(a.id);
    }
    this.bump();
    this.watchForOrphans();
    this.reportStatus();
  }

  /** SPA navigation: drop the old page's marks and load the new page's. */
  async onNavigate() {
    if (normalizeUrl(location.href) === this.pageUrl) return;
    removeAllMarks();
    this.set({ toolbar: null, popover: null });
    await this.load();
  }

  /** Content that loads late (lazy articles, SPAs): keep retrying orphans for a while. */
  private watchForOrphans() {
    if (!this.orphanIds.size || !document.body) return;
    const deadline = Date.now() + ORPHAN_RETRY_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        let changed = false;
        for (const id of [...this.orphanIds]) {
          const a = this.annotations.get(id);
          if (!a || anchorAnnotation(a)) {
            this.orphanIds.delete(id);
            changed = true;
          }
        }
        if (changed) this.reportStatus();
        if (!this.orphanIds.size || Date.now() > deadline) observer.disconnect();
      }, 600);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.observer = observer;
    setTimeout(() => observer.disconnect(), ORPHAN_RETRY_MS);
  }

  setEnabled(enabled: boolean, announce = false) {
    if (enabled === this.state.enabled) return;
    this.set({ enabled, toolbar: enabled ? this.state.toolbar : null });
    this.reportStatus();
    if (announce) this.toast(enabled ? 'Margin Notes on: select text to highlight' : 'Margin Notes off');
  }

  // ---- selection toolbar ----
  private currentSelectionRange(): Range | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!range.toString().trim()) return null;
    const anc = range.commonAncestorContainer;
    const el = anc.nodeType === 1 ? (anc as Element) : anc.parentElement;
    if (!el || !document.body?.contains(el)) return null;
    if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return null;
    return range;
  }

  /** The selection to act on: the live one, or the one the toolbar was opened for. */
  private takeRange(): Range | null {
    return this.currentSelectionRange() ?? this.savedRange;
  }

  private toolbarAnchor(range: Range): Anchor | null {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    const below = rect.top < 60;
    return { x: clampX(rect.left + rect.width / 2), y: below ? rect.bottom + 10 : rect.top - 10, below };
  }

  onSelectionEnd() {
    if (!this.state.enabled || this.state.snipping) return;
    const range = this.currentSelectionRange();
    if (!range) {
      if (this.state.toolbar) this.set({ toolbar: null });
      this.savedRange = null;
      return;
    }
    this.savedRange = range.cloneRange();
    this.set({ toolbar: this.toolbarAnchor(range), popover: null });
  }

  dismiss() {
    if (this.state.toolbar || this.state.popover) this.set({ toolbar: null, popover: null });
    this.savedRange = null;
  }

  reposition() {
    if (this.repositionQueued) return;
    this.repositionQueued = true;
    requestAnimationFrame(() => {
      this.repositionQueued = false;
      const patch: Partial<UiState> = {};
      if (this.state.toolbar && this.savedRange) patch.toolbar = this.toolbarAnchor(this.savedRange);
      if (this.state.popover) {
        const a = this.popoverAnchor(this.state.popover.id);
        patch.popover = a ? { ...this.state.popover, ...a } : null;
      }
      if (Object.keys(patch).length) this.set(patch);
    });
  }

  copySelection() {
    const range = this.takeRange();
    if (!range) return;
    const text = range.toString();
    navigator.clipboard.writeText(text).then(
      () => this.toast('Copied'),
      () => {
        document.execCommand('copy');
        this.toast('Copied');
      },
    );
  }

  // ---- highlights ----
  async highlight(color: Color = this.state.lastColor, withNote = false) {
    const range = this.takeRange();
    if (!range) return this.toast('Select some text first');
    const index = buildIndex(document.body);
    const span = rangeToSpan(index, range);
    if (!span) return this.toast("Couldn't highlight that selection", 'error');

    const now = Date.now();
    const ann: Annotation = {
      id: newId(),
      pageUrl: this.pageUrl,
      type: 'highlight',
      color,
      selector: spanToSelector(index, span),
      note: '',
      tags: [],
      docY: range.getBoundingClientRect().top + window.scrollY,
      createdAt: now,
      updatedAt: now,
    };
    markSpan(index, span, ann);
    window.getSelection()?.removeAllRanges();
    this.savedRange = null;
    this.annotations.set(ann.id, ann);
    this.set({ toolbar: null, lastColor: color });
    this.bump();
    if (withNote) this.openPopover(ann.id, true);

    try {
      const { id, type, selector, note, tags, docY } = ann;
      const saved = await sendToBackground({
        type: 'createAnnotation',
        annotation: { id, type, color, selector, note, tags, docY },
        page: this.pageInfo(),
      });
      // Keep any note typed while the save was in flight.
      const local = this.annotations.get(id);
      this.annotations.set(id, { ...saved, note: local?.note ?? saved.note });
      if (local?.note) void this.updateNote(id, local.note, true);
    } catch (e) {
      removeMarks(ann.id);
      this.annotations.delete(ann.id);
      if (this.state.popover?.id === ann.id) this.set({ popover: null });
      this.toast(`Couldn't save highlight: ${errorText(e)}`, 'error');
    }
    this.bump();
  }

  // ---- popover ----
  private popoverAnchor(id: string): Anchor | null {
    const rect = marksRect(id);
    if (!rect) return null;
    const below = rect.bottom + 230 < window.innerHeight || rect.top < 230;
    return { x: clampX(rect.left + rect.width / 2, 170), y: below ? rect.bottom + 10 : rect.top - 10, below };
  }

  openPopover(id: string, focus = false) {
    const anchor = this.popoverAnchor(id);
    if (!anchor) return;
    this.set({ popover: { ...anchor, id, focus }, toolbar: null });
  }

  closePopover() {
    if (this.state.popover) this.set({ popover: null });
  }

  async updateNote(id: string, note: string, force = false) {
    const ann = this.annotations.get(id);
    if (!ann || (!force && ann.note === note)) return;
    const next = { ...ann, note };
    this.annotations.set(id, next);
    updateMarks(next);
    this.bump();
    try {
      await sendToBackground({ type: 'updateAnnotation', id, patch: { note } });
    } catch {
      /* the save in highlight() will retry once it completes */
    }
  }

  async setColor(id: string, color: Color) {
    const ann = this.annotations.get(id);
    if (!ann) return;
    const next = { ...ann, color };
    this.annotations.set(id, next);
    updateMarks(next);
    this.set({ lastColor: color });
    this.bump();
    await sendToBackground({ type: 'updateAnnotation', id, patch: { color } }).catch((e) =>
      this.toast(`Couldn't save: ${errorText(e)}`, 'error'),
    );
  }

  async deleteAnnotation(id: string) {
    removeMarks(id);
    this.annotations.delete(id);
    this.orphanIds.delete(id);
    this.set({ popover: null });
    this.bump();
    await sendToBackground({ type: 'deleteAnnotation', id }).catch((e) => this.toast(`Couldn't delete: ${errorText(e)}`, 'error'));
  }

  // ---- screenshots ----
  async clipSelection() {
    const range = this.takeRange();
    if (!range) return this.startSnip();
    const index = buildIndex(document.body);
    const span = rangeToSpan(index, range);
    const selector = span ? spanToSelector(index, span) : undefined;
    const r = range.getBoundingClientRect();
    const pad = 8;
    const rect: DocRect = {
      left: r.left + window.scrollX - pad,
      top: r.top + window.scrollY - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    };
    this.savedRange = null;
    this.set({ toolbar: null });
    // A text clip is about the text, so don't let a sticky header cover it.
    await this.saveClip(rect, selector, true);
    window.getSelection()?.removeAllRanges();
  }

  startSnip() {
    this.set({ snipping: true, toolbar: null, popover: null });
  }

  async finishSnip(rect: ViewportRect | null) {
    this.set({ snipping: false });
    if (!rect) return;
    await nextFrames(); // let the overlay disappear before capturing
    await this.saveClip({ left: rect.x + window.scrollX, top: rect.y + window.scrollY, width: rect.width, height: rect.height });
  }

  private async saveClip(rect: DocRect, selector?: TextQuoteSelector, hideOverlays = false) {
    if (this.state.busy) return;
    this.set({ busy: true });
    try {
      const shot = await captureRegion(rect, this.hideUi, { hideOverlays });
      const saved = await sendToBackground({
        type: 'saveClip',
        dataUrl: shot.dataUrl,
        width: shot.width,
        height: shot.height,
        annotation: { id: newId(), type: 'clip', color: this.state.lastColor, selector, note: '', tags: [], docY: rect.top },
        page: this.pageInfo(),
      });
      this.annotations.set(saved.id, saved);
      if (saved.selector) anchorAnnotation(saved);
      this.bump();
      this.toast(shot.truncated ? 'Clip saved (trimmed: it was very tall)' : 'Clip saved to your notes');
    } catch (e) {
      this.toast(`Couldn't capture: ${errorText(e)}`, 'error');
    } finally {
      this.set({ busy: false });
    }
  }

  // ---- messages from the extension ----
  scrollTo(id: string): boolean {
    const marks = marksFor(id);
    if (marks.length) {
      marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
      flashMarks(id);
      return true;
    }
    const ann = this.annotations.get(id);
    if (ann && !ann.selector) {
      window.scrollTo({ top: Math.max(0, ann.docY - window.innerHeight / 4), behavior: 'smooth' });
      return true;
    }
    return false;
  }

  handleMessage(msg: TabMessage): unknown {
    switch (msg.type) {
      case 'ping':
        return true;
      case 'getStatus':
        return this.status();
      case 'toggle':
        this.setEnabled(!this.state.enabled, true);
        return this.status();
      case 'setEnabled':
        this.setEnabled(msg.enabled);
        return this.status();
      case 'command':
        if (msg.command === 'highlight') void this.highlight();
        else if (msg.command === 'highlightNote') void this.highlight(this.state.lastColor, true);
        else if (msg.command === 'clip') void this.clipSelection();
        else if (msg.command === 'snip') this.startSnip();
        return true;
      case 'scrollTo':
        return this.scrollTo(msg.id);
      case 'annotationUpdated': {
        if (normalizeUrl(location.href) !== msg.annotation.pageUrl) return true;
        this.annotations.set(msg.annotation.id, msg.annotation);
        updateMarks(msg.annotation);
        this.bump();
        return true;
      }
      case 'annotationDeleted':
        removeMarks(msg.id);
        this.annotations.delete(msg.id);
        if (this.orphanIds.delete(msg.id)) this.reportStatus();
        if (this.state.popover?.id === msg.id) this.set({ popover: null });
        this.bump();
        return true;
      case 'reload':
        removeAllMarks();
        this.set({ popover: null, toolbar: null });
        void this.load();
        return true;
    }
  }
}
