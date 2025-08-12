## Backend on DigitalOcean

- **Provision Postgres**

  - Create a managed DB or install Postgres on the droplet.
  - Note the `DATABASE_URL` (include SSL params if managed).

- **Set environment variables**

  - `OPENAI_API_KEY`
  - `DATABASE_URL`
  - `GOOGLE_CLIENT_ID`
  - `BACKEND_JWT_SECRET`
  - Persist via systemd `Environment` or an `.env`/secret manager.

- **Install and migrate**

```bash
# On the server
cd /path/to/Axon
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
pip install prisma
prisma generate
prisma migrate deploy
```

- **Run the API**

```bash
# Dev / test
uvicorn backend.api:app --host 0.0.0.0 --port 8000
```

- **Systemd (optional)**

```ini
[Unit]
Description=Axon API
After=network.target

[Service]
WorkingDirectory=/opt/axon
Environment=OPENAI_API_KEY=****
Environment=DATABASE_URL=****
Environment=GOOGLE_CLIENT_ID=****
ExecStart=/opt/axon/.venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always

[Install]
WantedBy=multi-user.target
```

## TLS and Reverse Proxy

- Use Nginx or Caddy to terminate TLS and proxy to `127.0.0.1:8000`.
- For SSE/streaming, disable buffering.

```nginx
location / {
  proxy_pass http://127.0.0.1:8000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_read_timeout 3600s;
}
```

- **CORS (prod)**: replace `allow_origins=["*"]` with your trusted origins.

## Frontend (Electron) → DO Backend

- Set the backend URL before running the app:

```bash
export BACKEND_URL="https://your-domain"
npm run dev
```

- The app now uses `BACKEND_URL` via `get-biorag-url`.

## Google Sign-in

- **Create OAuth client** in Google Cloud Console (Web app).
- **Get ID token**, then call:

```bash
# exchange ID token with backend (verification + user upsert)
curl -X POST https://your-backend/auth/google \
  -H "Content-Type: application/json" \
  -d '{"id_token":"<GOOGLE_ID_TOKEN>"}'
```

- Backend returns `{ access_token, email, name }` (currently echoes Google ID token).
- Renderer stores it; all requests include:

```
Authorization: Bearer <token>
```

## Verify

- Health:

```bash
curl https://your-backend/health
```

- Auth + LLM search:

```bash
curl -X POST https://your-backend/search/llm \
  -H "Authorization: Bearer <GOOGLE_ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query":"breast cancer", "limit": 10}'
```

- DB (after usage):
  - `User`: your email appears
  - `Message`: new entries from `/search`
  - `UsageLog`: entries from `/search/llm`, `/llm/code`, `/llm/code/stream`

## Usage Accounting

- Non-streaming calls record token usage when available.
- Streaming doesn’t expose exact usage via SDK; options:
  - Approximate with `tiktoken` on prompt + accumulated output.
  - Use non-streaming for endpoints where precise billing matters.

## Security Hardening

- Restrict Postgres to server IP and require SSL.
- Don’t run uvicorn with `--reload` in production.
- Keep secrets in env/secret manager, not in repo.
- Tighten CORS to known origins.

## Next Steps (optional)

- Add Google Sign-In button in `Sidebar` using `AuthService`.
- Add a “Usage” panel (per-user token totals from `UsageLog`).
- Configure automated backups for Postgres and monitoring/logging.
