# Tenjo

A self-hosted AI chat interface with support for multiple providers (LM Studio, Ollama) and MCP (Model Context Protocol).

![Screenshot](https://github.com/user-attachments/assets/d9bcce30-b0e3-4098-83bd-054e2fd98550)

## Requirements

- Node.js (v24 recommended)
- PostgreSQL (v18 recommended)

## Setup

### 1. Install dependencies

```bash
npm run setup
```

### 2. Configure environment

Create `server/.env`. The following is an example — adjust the values for your environment:

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
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SCHEMA` | PostgreSQL schema name |
| `SESSION_SECRET` | Secret used for session encryption |
| `LISTEN_HOST` | Host address to bind to |
| `LISTEN_PORT` | Port number to listen on |
| `DATA_DIR` | Data directory path (default: `files/` under the server working directory) |
| `SINGLE_USER_MODE` | Set to `true` to run in single-user mode |
| `ENCRYPTION_KEY` | Encryption key for credentials (API keys, OAuth tokens, etc.) stored in the database |
| `BASE_URL` | Public base URL of the application (e.g. `https://chat.example.com`) |

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

## FAQ

**How do I add new users?**
The first user to register automatically becomes an admin. After that, registration requires an invitation code. Admins can generate and manage invitation codes from the settings page. Codes are single-use and determine the new user's role (admin or standard).

**Images in prompts are not working.**
The connected model must support vision. Use a vision-capable model if you want to include images in prompts.

**MCP tools are not working.**
The connected model must support function calling. MCP tool calling will not work with models that do not support it. Even with supported models, tool calls may not work well depending on the model's capability.

**What is the email address at registration used for?**
It is only used as an alternative to the username when logging in.

## License

[MIT](LICENSE) &copy; netalkGB
