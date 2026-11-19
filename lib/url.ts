const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|_hsenc|_hsmi)$/i;

/**
 * Canonical key for a page: drops the fragment and tracking parameters so the
 * same article reached via different links shares one set of notes.
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  let out = url.toString();
  // "https://x.com/a/?" -> "https://x.com/a/"
  if (out.endsWith('?')) out = out.slice(0, -1);
  return out;
}

/** Whether an extension content script can run on this URL at all. */
export function isAnnotatable(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const { protocol, hostname } = new URL(raw);
    if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:') return false;
    if (hostname === 'chromewebstore.google.com' || hostname === 'chrome.google.com') return false;
    if (hostname === 'microsoftedge.microsoft.com') return false;
    return true;
  } catch {
    return false;
  }
}
