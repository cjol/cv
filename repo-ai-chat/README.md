# Repo AI Chat

Chat with an AI that has shell-level access to any public GitHub repository. Built on Cloudflare's agent stack.

## Stack

- **[Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/)** (private beta) — forks the GitHub repo for persistent, edge-cached git storage
- **[@cloudflare/think](https://developers.cloudflare.com/agents/api-reference/think/)** — opinionated AI agent base class with built-in workspace file tools (read, write, find, grep)
- **[@cloudflare/shell](https://www.npmjs.com/package/@cloudflare/shell)** — git operations (isomorphic-git) backed by the Durable Object's SQLite storage
- **Anthropic Claude** — code reasoning model via `@ai-sdk/anthropic`
- **React 19** + `useAgentChat` hook for streaming chat UI

## How it works

1. User pastes a GitHub URL → `POST /api/import`
2. Worker forks repo into Cloudflare Artifacts (falls back to direct GitHub URL if not configured)
3. Client connects to `RepoChatAgent` Durable Object via WebSocket
4. Agent's `@callable setup()` clones the repo into the DO's workspace (shallow, depth 1)
5. Think's auto-wired workspace tools (grep, find, read) give the AI access to the code
6. User chats; AI uses tools to explore files and answer questions

## Setup

### 1. Install

```bash
npm install
```

### 2. Configure API key

```bash
# For production:
wrangler secret put ANTHROPIC_API_KEY

# For local dev, create .dev.vars:
echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars
```

### 3. Artifacts (optional, private beta)

When you have Cloudflare Artifacts access, uncomment the `artifacts` binding in `wrangler.jsonc`:

```jsonc
"artifacts": { "binding": "ARTIFACTS" }
```

Without it, the agent clones directly from GitHub (works fine, just no edge caching).

### 4. Develop

```bash
# Build client assets first (required for wrangler dev to serve them)
npm run build
npm run dev
```

Or run Vite + Wrangler separately for faster iteration:
```bash
npx vite          # frontend on :5173 (proxies /api and /agents to :8787)
npx wrangler dev  # worker on :8787
```

### 5. Deploy

```bash
npm run deploy
```

## Project structure

```
src/
  server.ts   Worker entry point + /api/import handler
  agent.ts    RepoChatAgent — Think-based DO with @callable setup()
  app.tsx     React UI — import screen + chat screen
  client.tsx  Vite entry point
  styles.css  Dark theme CSS
wrangler.jsonc
```

## Adding voice (future)

The plan is to add Cloudflare Voice AI for spoken Q&A. The agent architecture is already in place — just wire a voice input/output layer to `sendMessage` / `messages`.
