import { browser } from 'wxt/browser';

const AUTO_SITES_KEY = 'autoEnableSites';

export async function getAutoSites(): Promise<string[]> {
  const res = await browser.storage.local.get(AUTO_SITES_KEY);
  const v = res[AUTO_SITES_KEY];
  return Array.isArray(v) ? (v as string[]) : [];
}

export async function isAutoEnabled(hostname: string): Promise<boolean> {
  return (await getAutoSites()).includes(hostname);
}

export async function setAutoEnabled(hostname: string, on: boolean): Promise<void> {
  const sites = new Set(await getAutoSites());
  if (on) sites.add(hostname);
  else sites.delete(hostname);
  await browser.storage.local.set({ [AUTO_SITES_KEY]: [...sites] });
}
