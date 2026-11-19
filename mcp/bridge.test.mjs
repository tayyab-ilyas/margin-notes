import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { createBridge } from './bridge.mjs';

const TOKEN = 'secret-token';
let bridge, url;

before(async () => {
  bridge = createBridge({ port: 0, token: TOKEN, callTimeoutMs: 1000 });
  url = `ws://127.0.0.1:${await bridge.ready}`;
});
after(() => bridge.close());

const open = (origin) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
const closed = (ws) => new Promise((r) => ws.on('close', (code) => r(code)));
const next = (ws) => new Promise((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));

test('a web page origin is refused at the handshake', async () => {
  await assert.rejects(open('https://evil.example'), /Unexpected server response: 401/);
});

test('a wrong token is refused', async () => {
  const ws = await open('chrome-extension://abc');
  ws.send(JSON.stringify({ type: 'hello', token: 'nope' }));
  assert.equal(await closed(ws), 4003);
});

test('calls fail clearly when no extension is connected', async () => {
  await assert.rejects(bridge.call('list_pages'), /isn't connected/);
});

test('a paired extension answers calls, including errors', async () => {
  const ws = await open('chrome-extension://abc');
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN, version: '0.1.0' }));
  assert.deepEqual(await next(ws), { type: 'welcome' });
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.type !== 'call') return;
    if (m.method === 'boom') ws.send(JSON.stringify({ type: 'result', id: m.id, error: 'no such page' }));
    else ws.send(JSON.stringify({ type: 'result', id: m.id, result: { echo: m.method, params: m.params } }));
  });
  assert.deepEqual(await bridge.call('search_notes', { query: 'habit' }), { echo: 'search_notes', params: { query: 'habit' } });
  await assert.rejects(bridge.call('boom'), /no such page/);
  ws.close();
  await closed(ws);
});
