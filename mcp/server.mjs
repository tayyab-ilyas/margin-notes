#!/usr/bin/env node
// Margin Notes MCP server: lets a chat app (Claude Desktop, Claude Code, ...) read your Margin Notes
// library while the browser is open. Started by the chat app over stdio; see mcp/README.md.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createBridge } from './bridge.mjs';

// stdout carries the MCP protocol, so all logging goes to stderr.
const log = (m) => console.error(`[margin-notes] ${m}`);
// shortcut: the port is fixed to match the extension's default; make it a setting on both sides if it ever collides.
const bridge = createBridge({ port: 47321, token: process.env.MARGIN_NOTES_TOKEN ?? '', log });

const server = new McpServer({ name: 'margin-notes', version: '0.1.0' });
const readOnly = { readOnlyHint: true, openWorldHint: false };
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const json = (v) => text(JSON.stringify(v, null, 2));
const fail = (err) => ({ content: [{ type: 'text', text: err.message }], isError: true });
const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];

server.registerTool(
  'search_notes',
  {
    title: 'Search notes',
    description:
      'Search the highlights, notes, tags and page notes saved with Margin Notes while reading the web. ' +
      'Matches the highlighted text, the note, tags and the page title. Leave query empty to get the most recent items. Newest first.',
    inputSchema: {
      query: z.string().optional().describe('Words to look for (case-insensitive substring)'),
      color: z.enum(COLORS).optional().describe('Only highlights of this color'),
      tag: z.string().optional().describe('Only items with this exact tag'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results, default 20'),
    },
    annotations: readOnly,
  },
  async (args) => bridge.call('search_notes', args).then(json, fail),
);

server.registerTool(
  'list_pages',
  {
    title: 'List saved pages',
    description: 'List the web pages that have Margin Notes highlights, clips or page notes, most recently visited first, with counts.',
    inputSchema: { limit: z.number().int().min(1).max(500).optional().describe('Max pages, default 50') },
    annotations: readOnly,
  },
  async (args) => bridge.call('list_pages', args).then(json, fail),
);

server.registerTool(
  'get_page',
  {
    title: 'Get page notes',
    description:
      "One page's page note, highlights, notes and tags in reading order, as Markdown. " +
      'Clips appear as ![Clip](clip:<id>); pass that id to get_clip to see the image.',
    inputSchema: { url: z.string().describe('Page URL, as returned by list_pages or search_notes') },
    annotations: readOnly,
  },
  async ({ url }) => bridge.call('get_page', { url }).then((r) => text(r.markdown), fail),
);

server.registerTool(
  'get_clip',
  {
    title: 'Get clip image',
    description: 'The screenshot saved for a clip (a snipped region or a passage clipped as an image), plus its note.',
    inputSchema: { id: z.string().describe('Clip id, from get_page (clip:<id>) or search_notes') },
    annotations: readOnly,
  },
  async ({ id }) =>
    bridge.call('get_clip', { id }).then(
      (c) => ({
        content: [
          { type: 'image', data: c.data, mimeType: c.mimeType },
          { type: 'text', text: JSON.stringify({ page: c.pageUrl, text: c.text, note: c.note, width: c.width, height: c.height }) },
        ],
      }),
      fail,
    ),
);

await server.connect(new StdioServerTransport());
const port = await bridge.ready;
if (port) log(`Waiting for the browser extension on 127.0.0.1:${port}`);
