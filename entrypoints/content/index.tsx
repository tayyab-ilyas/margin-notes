import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { TabMessage } from '../../lib/messages';
import { Controller } from './controller';
import { injectMarkStyles, MARK_TAG } from './highlighter';
import { App } from './ui';
import css from './ui.css?inline';

declare global {
  interface Window {
    __marginNotesCtx?: ContentScriptContext;
  }
}

function mountUi(c: Controller): HTMLElement {
  const host = document.createElement('notes-ext-ui');
  host.style.cssText =
    'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; display: block;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  shadow.append(style, root);
  // Keep typing in our note box from triggering the page's keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, (e) => e.stopPropagation());
  document.documentElement.appendChild(host);
  createRoot(root).render(<App c={c} />);

  c.hideUi = () => {
    host.style.setProperty('display', 'none', 'important');
    return () => host.style.setProperty('display', 'block');
  };
  return host;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main(ctx) {
    // Programmatic injection (for tabs open before install) must not double up.
    if (window.__marginNotesCtx?.isValid) return;
    window.__marginNotesCtx = ctx;

    injectMarkStyles();
    const c = new Controller();
    const host = mountUi(c);
    const inUi = (e: Event) => e.composedPath().includes(host);

    const onMessage = (msg: TabMessage, _sender: unknown, sendResponse: (r: unknown) => void) => {
      sendResponse(c.handleMessage(msg));
      return false;
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onMessage);
      host.remove();
    });

    ctx.addEventListener(document, 'mousedown', (e) => {
      if (inUi(e)) return;
      c.dismiss();
    });
    ctx.addEventListener(document, 'mouseup', (e) => {
      if (inUi(e) || e.button !== 0) return;
      setTimeout(() => c.onSelectionEnd(), 0); // selection settles after mouseup
    });
    ctx.addEventListener(document, 'keyup', (e) => {
      if (e.shiftKey || e.key === 'Shift') c.onSelectionEnd();
      if (e.key === 'Escape') c.dismiss();
    });
    ctx.addEventListener(
      document,
      'click',
      (e) => {
        if (inUi(e)) return;
        const mark = (e.target as Element | null)?.closest?.(MARK_TAG) as HTMLElement | null;
        if (!mark?.dataset.id) return;
        if (!window.getSelection()?.isCollapsed) return; // user is selecting, not clicking
        if (mark.closest('a[href]')) return; // let links work
        e.preventDefault();
        c.openPopover(mark.dataset.id);
      },
      { capture: true },
    );
    ctx.addEventListener(window, 'scroll', () => c.reposition(), { capture: true, passive: true });
    ctx.addEventListener(window, 'resize', () => c.reposition());
    ctx.addEventListener(window, 'wxt:locationchange', () => void c.onNavigate());

    void c.init();
  },
});
