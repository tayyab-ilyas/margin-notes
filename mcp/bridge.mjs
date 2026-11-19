import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

/**
 * Local WebSocket the Margin Notes extension connects to. The extension is the client, so the
 * library never leaves the browser except as answers to the read-only calls made here.
 *
 * Only accepted: connections from a browser extension origin, on 127.0.0.1, that send the pairing
 * token first. A normal web page can't open it (wrong Origin), and another extension can't
 * answer for Margin Notes without the token.
 */
export function createBridge({ port, token, host = '127.0.0.1', callTimeoutMs = 15000, pingMs = 20000, log = () => {} }) {
  let ext = null; // the paired extension socket
  let startError = null;
  let nextId = 1;
  const pending = new Map();

  const wss = new WebSocketServer({
    host,
    port,
    maxPayload: 64 * 1024 * 1024, // clips are base64 screenshots
    verifyClient: ({ origin }) => /^(chrome|moz)-extension:\/\//.test(origin ?? ''),
  });
  const ready = new Promise((resolve) => {
    wss.on('listening', () => resolve(wss.address().port));
    wss.on('error', (err) => {
      // shortcut: one chat app at a time; a second server can't take the port. Upgrade to a shared broker if people ask.
      startError =
        err.code === 'EADDRINUSE'
          ? `Port ${port} is in use, probably by another chat app's Margin Notes server. Close that chat app and try again.`
          : `Could not listen on ${host}:${port}: ${err.message}`;
      log(startError);
      resolve(null);
    });
  });

  const sameToken = (t) => {
    const a = Buffer.from(String(t ?? '')), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  wss.on('connection', (sock) => {
    let paired = false;
    const hello = setTimeout(() => sock.close(4001, 'no hello'), 5000);
    sock.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!paired) {
        clearTimeout(hello);
        if (msg.type !== 'hello' || !token || !sameToken(msg.token)) {
          log('Rejected an extension connection: wrong pairing token.');
          sock.close(4003, 'bad token');
          return;
        }
        paired = true;
        if (ext && ext !== sock) ext.close(4000, 'replaced');
        ext = sock;
        sock.send(JSON.stringify({ type: 'welcome' }));
        log(`Extension connected (v${msg.version ?? '?'}).`);
        return;
      }
      if (msg.type === 'result' && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      }
    });
    sock.on('close', () => {
      clearTimeout(hello);
      if (ext === sock) {
        ext = null;
        for (const [id, p] of pending) {
          clearTimeout(p.timer);
          p.reject(new Error('The browser disconnected while answering.'));
          pending.delete(id);
        }
      }
    });
  });

  // Regular traffic keeps the extension's service worker from being suspended.
  const pinger = setInterval(() => ext?.send('{"type":"ping"}'), pingMs);
  pinger.unref();

  function call(method, params = {}) {
    if (startError) return Promise.reject(new Error(startError));
    if (!token) return Promise.reject(new Error('MARGIN_NOTES_TOKEN is not set. Copy the config from Margin Notes > Library > Chat apps (MCP).'));
    if (!ext) {
      return Promise.reject(
        new Error(
          "Margin Notes isn't connected. Open Chrome or Edge with the extension, and turn on Library > Chat apps (MCP). It reconnects within 30 seconds.",
        ),
      );
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The browser took too long to answer.'));
      }, callTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      ext.send(JSON.stringify({ type: 'call', id, method, params }));
    });
  }

  return {
    ready,
    call,
    get connected() {
      return !!ext;
    },
    close: () =>
      new Promise((r) => {
        clearInterval(pinger);
        for (const c of wss.clients) c.terminate();
        wss.close(() => r());
      }),
  };
}
