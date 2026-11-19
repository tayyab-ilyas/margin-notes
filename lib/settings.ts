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

const MCP_KEY = 'mcp';

/** Chat app (MCP) access. Off by default: turning it on lets a local MCP server read the library. */
export interface McpSettings {
  enabled: boolean;
  port: number;
  /** Pairing secret the MCP server must be started with (MARGIN_NOTES_TOKEN). */
  token: string;
}

export async function getMcpSettings(): Promise<McpSettings> {
  const v = (await browser.storage.local.get(MCP_KEY))[MCP_KEY] as Partial<McpSettings> | undefined;
  if (v?.token) return { enabled: !!v.enabled, port: v.port ?? 47321, token: v.token };
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const fresh = { enabled: false, port: 47321, token };
  await browser.storage.local.set({ [MCP_KEY]: fresh });
  return fresh;
}

export async function setMcpEnabled(enabled: boolean): Promise<McpSettings> {
  const s = { ...(await getMcpSettings()), enabled };
  await browser.storage.local.set({ [MCP_KEY]: s });
  return s;
}

export const MCP_SETTINGS_KEY = MCP_KEY;

export async function setAutoEnabled(hostname: string, on: boolean): Promise<void> {
  const sites = new Set(await getAutoSites());
  if (on) sites.add(hostname);
  else sites.delete(hostname);
  await browser.storage.local.set({ [AUTO_SITES_KEY]: [...sites] });
}
