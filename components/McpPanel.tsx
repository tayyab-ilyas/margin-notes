import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendToBackground, type Broadcast } from '../lib/messages';
import { getMcpSettings, setMcpEnabled, type McpSettings } from '../lib/settings';

/** Library section that turns chat app (MCP) access on and shows how to connect a chat app. */
export function McpPanel() {
  const [s, setS] = useState<McpSettings | null>(null);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void getMcpSettings().then(setS);
    void sendToBackground({ type: 'mcpStatus' }).then((r) => setConnected(r.connected)).catch(() => {});
    const onMsg = (msg: unknown) => {
      const b = msg as Broadcast;
      if (b?.type === 'mcpStatus') setConnected(b.connected);
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => browser.runtime.onMessage.removeListener(onMsg);
  }, []);

  if (!s) return null;

  const config = JSON.stringify(
    {
      mcpServers: {
        'margin-notes': {
          command: 'node',
          args: ['/path/to/margin-notes/mcp/server.mjs'],
          env: { MARGIN_NOTES_TOKEN: s.token },
        },
      },
    },
    null,
    2,
  );

  const copy = async () => {
    await navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <details className="mcp" open={s.enabled}>
      <summary>
        Chat apps (MCP)
        <span className={`mcp-dot ${s.enabled ? (connected ? 'on' : 'wait') : ''}`} />
        <span className="mcp-state">{!s.enabled ? 'Off' : connected ? 'Connected' : 'Waiting for a chat app'}</span>
      </summary>
      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => void setMcpEnabled(e.target.checked).then(setS)} />
        Let chat apps like Claude read my library (search, pages, clips). Read-only.
      </label>
      <p className="mcp-warn">
        When this is on, the notes a chat app asks for are sent to that app and its AI provider. Nothing is shared while it's off.
      </p>
      {s.enabled && (
        <>
          <p>
            Add this to your chat app's MCP config (for Claude Desktop: <code>claude_desktop_config.json</code>), with the
            real path to <code>mcp/server.mjs</code>. The browser needs to stay open.
          </p>
          <pre className="mcp-config">{config}</pre>
          <button className="btn" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy config'}
          </button>
        </>
      )}
    </details>
  );
}
