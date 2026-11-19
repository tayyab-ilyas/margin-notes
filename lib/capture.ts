export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(chunks.join(''))}`;
}

/** A rectangle in document coordinates (CSS px, relative to the page's top-left). */
export interface DocRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Segment {
  /** Where to scroll before capturing this segment. */
  scrollY: number;
  /** Top of the slice within the captured viewport (CSS px). */
  cropTop: number;
  cropHeight: number;
  /** Where the slice goes in the stitched output (CSS px). */
  destY: number;
}

/**
 * Splits a tall region into viewport-sized captures. If the region already
 * fits in the current viewport, it's captured without scrolling.
 */
export function planSegments(
  rect: Pick<DocRect, 'top' | 'height'>,
  viewportHeight: number,
  currentScrollY: number,
  maxScrollY: number,
): Segment[] {
  const top = rect.top;
  const bottom = rect.top + rect.height;
  if (top >= currentScrollY && bottom <= currentScrollY + viewportHeight) {
    return [{ scrollY: currentScrollY, cropTop: top - currentScrollY, cropHeight: rect.height, destY: 0 }];
  }
  const segments: Segment[] = [];
  let y = top;
  while (y < bottom - 0.5) {
    const scrollY = Math.max(0, Math.min(y, maxScrollY));
    const visBottom = Math.min(bottom, scrollY + viewportHeight);
    if (visBottom <= y) break; // can't scroll far enough to make progress
    segments.push({ scrollY, cropTop: y - scrollY, cropHeight: visBottom - y, destY: y - top });
    y = visBottom;
  }
  return segments;
}
