# Margin Notes MCP server

This server lets a chat app that supports [MCP](https://modelcontextprotocol.io) (Claude Desktop, Claude Code, Cursor and others) read your Margin Notes library. For example, you can ask "what did I save about memory?" or "summarize my notes on that article about reading".

It is **read-only** and **off by default**.

## How it works

```
chat app ──stdio──► mcp/server.mjs ◄──WebSocket 127.0.0.1:47321── extension (service worker) ──► IndexedDB
```

The chat app starts `server.mjs`. The extension connects to it, so your library stays in the browser and the server only receives answers to the queries it asks. The browser has to be open. The extension retries the connection every 30 seconds, so a chat app opened later gets connected within half a minute.

The server only accepts a connection that:
- comes from a browser extension origin, so web pages are refused, and
- sends the pairing token from your Library. Any other extension or program is refused.

## Set it up

1. Install the dependencies (needs Node 20 or later):
   ```sh
   cd mcp
   npm install
   ```
2. In Margin Notes, open **Library > Chat apps (MCP)**. Tick **Let chat apps read my library**, then click **Copy config**.
3. Paste the copied config into your chat app's MCP config and replace `/path/to/margin-notes` with the path to this repo.
   - **Claude Desktop:** go to *Settings > Developer > Edit Config*, then restart Claude Desktop.
   - **Claude Code:** run
     ```sh
     claude mcp add margin-notes -e MARGIN_NOTES_TOKEN=<token> -- node /path/to/margin-notes/mcp/server.mjs
     ```

When the status in the Library turns green (**Connected**), the chat app can use these tools:

| Tool | What it returns |
| --- | --- |
| `search_notes` | Highlights, notes and page notes matching a query, color or tag, newest first |
| `list_pages` | Saved pages with highlight and clip counts |
| `get_page` | One page's notes as Markdown, the same format as Export |
| `get_clip` | A clip's screenshot as an image, plus its note |

## Privacy

Notes the chat app asks for are sent to that app, and through it to its AI provider. Turn access off in the Library to stop this at once.

## Limits

- One chat app at a time, because the port (47321) is fixed. If a second app starts its own server, that server reports that the port is in use.
- No write tools yet: chat apps can't add or change notes.

## Development

`npm test` runs the bridge tests: origin check, token check and the call round trip.
