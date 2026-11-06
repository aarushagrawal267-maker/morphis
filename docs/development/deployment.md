# Hosting Morphis online

One container runs the whole town: the simulation, the REST API, the
WebSocket and the website. Add PostgreSQL to keep saves, and your AI key to
make agents decide and talk with a real model. The key stays on the server and
never reaches visitors' browsers.

## 1. Try the container on your own machine

```bash
docker compose --profile app up --build
```

Then open http://localhost:8787. This starts PostgreSQL and the town together.
To use your model, put the key in a `.env` file next to `docker-compose.yml`:

```
AI_API_KEY=nvapi-...
```

## 2. Put it on a host

Any host that runs a Dockerfile and offers PostgreSQL works (for example
Render, Railway or Fly.io). The steps are the same everywhere; the exact
buttons differ:

1. Create a PostgreSQL database and copy its connection URL.
2. Create a web service from this repository using the `Dockerfile`.
3. Set environment variables (keep `AI_API_KEY` and `ADMIN_TOKEN` as secrets):

| Variable | Value |
|---|---|
| `DATABASE_URL` | The PostgreSQL connection URL |
| `AI_API_KEY` | Your model key (NVIDIA NIM, OpenAI-compatible or Anthropic) |
| `AI_PROVIDER` / `AI_BASE_URL` / `AI_MODEL` | Defaults use NVIDIA NIM with Nemotron; see the README table for others |
| `ADMIN_TOKEN` | A long random password. **Set this for any public town** (see below) |
| `AI_DAILY_REQUEST_CAP` | Hard daily limit on model requests (default 400) |
| `AI_TALK_PER_MINUTE` | Visitor conversations voiced by the model per minute (default 12) |
| `AI_LIFE_DECISIONS_PER_HOUR` | Agents' evening decisions made by the model per hour (default 20) |
| `PORT` | Most hosts set this for you; the server listens on it |

4. Use `/api/health` as the health check path.
5. Open the service URL. The badge in the top bar shows `SERVER` and
   `AI · LIVE` when the model check succeeded.

Saves go to PostgreSQL when `DATABASE_URL` is set, otherwise to files in
`/data` (mount a volume there to keep them).

## Who can change the town

With `ADMIN_TOKEN` set, visitors can walk, wave, read cards and talk to people,
but changing the town (pause, speed, weather, saves, new city, JARVIS commands,
approving agent tools) needs the admin key. As the host, open **Settings →
Admin key** in your browser and enter it once; it is kept in that browser
only. API clients send it as the `x-admin-token` header.

Without `ADMIN_TOKEN`, anyone who can open the URL can change the town and
spend your AI quota, so only leave it unset for private use.

## Costs and limits

Every conversation and agent decision voiced by the model is one request. The
caps above keep usage bounded; when they are reached, the simulation answers
instead and says so. Check `/api/ai/status` for today's request count.
