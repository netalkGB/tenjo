# Tenjo

A self-hosted AI chat and agent workspace for local LLM servers such as LM Studio and Ollama, with MCP (Model Context Protocol), web search, knowledge, code execution, and browser/GUI preview support.

<table align="center">
  <tr>
    <td colspan="2" align="center"><img width="520" alt="Screenshot" src="https://github.com/user-attachments/assets/699ff1a9-e691-4319-a7a1-7554e9656c12" /></td>
  </tr>
  <tr>
    <td><img width="240" alt="Screenshot" src="https://github.com/user-attachments/assets/0b1f2045-7e77-43dc-9e76-c1c85697d7b5" /></td>
    <td><img width="240" alt="Screenshot" src="https://github.com/user-attachments/assets/699b0fc8-5b85-473c-9e11-d3793b578625" /></td>
  </tr>
  <tr>
    <td><img width="240" alt="Screenshot" src="https://github.com/user-attachments/assets/1a3eeb45-b930-4f7c-b730-e50139422ea6" /></td>
    <td><img width="240" alt="Screenshot" src="https://github.com/user-attachments/assets/6bff6897-adbe-4f71-a739-589aeaca8353" /></td>
  </tr>
</table>

## Requirements

- Node.js (v24 recommended)
- PostgreSQL (v18 recommended)
- Docker

## Setup

### 1. Install dependencies

Recommended first-time setup:

```bash
npm run setup
```

This runs `npm ci` for the workspaces and then installs the OS packages required by Playwright Chromium through `npm -w chat-engine run setup:browser-deps`. Use this if you plan to use web search or browser-driven agent features.

If you only need the core chat UI and already have the Chromium runtime dependencies you need:

```bash
npm ci
```

### 2. Configure environment

Create `server/.env` from the sample and adjust it for your environment:

```bash
cp server/.env.sample server/.env
```

Example:

```
NODE_ENV=production
DATABASE_URL=postgresql://user:password@localhost:5432/tenjo
DATABASE_SCHEMA=tenjo
SESSION_SECRET=your-secret-key-here
LISTEN_HOST=127.0.0.1
LISTEN_PORT=3000
ENCRYPTION_KEY=your-encryption-key-here
BASE_URL=https://chat.example.com
```

| Variable | Description |
|---|---|
| `NODE_ENV` | `development`, `production`, or `test` |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SCHEMA` | PostgreSQL schema name (defaults to `public` if omitted) |
| `SESSION_SECRET` | Secret used for session encryption |
| `LISTEN_HOST` | Host address to bind to |
| `LISTEN_PORT` | Port number to listen on |
| `DATA_DIR` | Data directory path (default: `files/` under the server working directory) |
| `SINGLE_USER_MODE` | Set to `true` to run in single-user mode |
| `ENCRYPTION_KEY` | Encryption key for credentials (API keys, OAuth tokens, etc.) stored in the database |
| `BASE_URL` | Public base URL of the application |

### 3. Build and start

```bash
npm run build
npm start
```

## Development

```bash
npm run dev
```

> **Note:** The environment variable `LISTEN_PORT` must be `3000` during development. The Vite dev server proxies API requests to `localhost:3000`, so changing the port will break the proxy.

## Sandbox (agent)

Docker is required because the agent runs in a sandbox container.

On Linux, the user running the Tenjo server process must have permission to operate Docker. For example, you may need to add that user to the `docker` group.

Tenjo creates and manages the following Docker resources:

- Container: `tenjo-sandbox`
- Image: `tenjo-agent-sandbox:*`
- Volume: `tenjo-sandbox-data`

## FAQ

**How do I add new users?**
The first user to register automatically becomes an admin. After that, registration requires an invitation code. Admins can generate and manage invitation codes from the settings page. Codes are single-use and determine the new user's role (admin or standard).

**Images in prompts are not working.**
The connected model must support vision. Use a vision-capable model if you want to include images in prompts.

**MCP tools are not working.**
The connected model must support function calling. MCP tool calling will not work with models that do not support it. Even with supported models, tool calls may not work well depending on the model's capability.

## License

[MIT](LICENSE) &copy; netalkGB
