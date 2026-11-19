import { blobToDataUrl, dataUrlToBlob, planSegments, type DocRect } from '../../lib/capture';
import { sendToBackground } from '../../lib/messages';

/** Chrome rejects more than 2 captureVisibleTab calls per second. */
const MIN_CAPTURE_GAP_MS = 550;
/** Stay well under Chrome's canvas size limits. */
const MAX_OUTPUT_PX = 16000;

let lastCaptureAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function captureViewport(): Promise<ImageBitmap> {
  const wait = lastCaptureAt + MIN_CAPTURE_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCaptureAt = Date.now();
  const dataUrl = await sendToBackground({ type: 'captureVisible' });
  return createImageBitmap(dataUrlToBlob(dataUrl));
}

/** Hides fixed/sticky elements (headers, cookie bars) so they don't repeat in stitched captures. */
function hideFixedElements(): () => void {
  const hidden: { el: HTMLElement; value: string; priority: string }[] = [];
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      hidden.push({ el, value: el.style.getPropertyValue('visibility'), priority: el.style.getPropertyPriority('visibility') });
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  return () => {
    for (const { el, value, priority } of hidden) {
      if (value) el.style.setProperty('visibility', value, priority);
      else el.style.removeProperty('visibility');
    }
  };
}

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
  truncated: boolean;
}

/**
 * Captures a region of the page given in document coordinates, scrolling and
 * stitching if it's taller than the viewport. `hideUi` hides our own overlay
 * for the duration and returns a function that restores it.
 *
 * Fixed/sticky overlays (site headers, cookie bars) are hidden when
 * `hideOverlays` is set, and always for multi-screen captures, where they
 * would otherwise cover the top of the region and repeat in every slice.
 */
export async function captureRegion(
  rect: DocRect,
  hideUi: () => () => void,
  { hideOverlays = false }: { hideOverlays?: boolean } = {},
): Promise<CaptureResult> {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const startX = window.scrollX;
  const startY = window.scrollY;
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - vh);

  // Clamp horizontally to what's visible.
  const left = Math.max(rect.left, startX);
  const right = Math.min(rect.left + rect.width, startX + vw);
  const width = Math.max(1, right - left);

  const restoreUi = hideUi();
  const selection = window.getSelection();
  const savedRanges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : [];
  selection?.removeAllRanges();

  let restoreFixed: (() => void) | null = null;
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let truncated = false;

  try {
    const segments = planSegments(rect, vh, startY, maxScrollY);
    if (hideOverlays || segments.length > 1) restoreFixed = hideFixedElements();
    await nextFrames();
    let scale = 1;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.scrollY !== window.scrollY) {
        window.scrollTo({ left: startX, top: seg.scrollY, behavior: 'instant' });
        await nextFrames();
        await sleep(120); // let lazy-loaded images settle
      }
      const bitmap = await captureViewport();
      if (!canvas) {
        scale = bitmap.width / window.innerWidth;
        let outH = Math.round(rect.height * scale);
        if (outH > MAX_OUTPUT_PX) {
          outH = MAX_OUTPUT_PX;
          truncated = true;
        }
        canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, outH));
        ctx = canvas.getContext('2d')!;
      }
      const sx = (left - startX) * scale;
      const sy = seg.cropTop * scale;
      const sw = width * scale;
      const sh = seg.cropHeight * scale;
      ctx!.drawImage(bitmap, sx, sy, sw, sh, 0, seg.destY * scale, sw, sh);
      bitmap.close();
      if ((seg.destY + seg.cropHeight) * scale >= canvas.height) {
        if (i < segments.length - 1) truncated = true;
        break;
      }
    }
  } finally {
    restoreFixed?.();
    if (window.scrollY !== startY || window.scrollX !== startX) {
      window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
    }
    restoreUi();
    if (selection) for (const r of savedRanges) selection.addRange(r);
  }

  if (!canvas) throw new Error('Nothing to capture');
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { dataUrl: await blobToDataUrl(blob), width: canvas.width, height: canvas.height, truncated };
}
