## Backend on DigitalOcean

### Initial server setup

- Create a Droplet (Ubuntu LTS recommended) with at least 2GB RAM.
- Point your domain DNS A record to the droplet public IP (e.g., `api.example.com`).
- Optional but recommended firewall (UFW):

```bash
sudo apt update && sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

- **Provision Postgres**

  - Create a managed DB or install Postgres on the droplet.
  - Note the `DATABASE_URL` (include SSL params if managed).

Example managed DB URL:

```
postgresql://<user>:<password>@<host>:25060/<db>?sslmode=require
```

- **Set environment variables**

  - `OPENAI_API_KEY`
  - `DATABASE_URL`
  - `FIREBASE_PROJECT_ID` (backend token verification)
  - `GOOGLE_CLIENT_ID` (optional fallback for Google ID tokens)
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
Environment=FIREBASE_PROJECT_ID=your-firebase-project-id
Environment=GOOGLE_CLIENT_ID=****
ExecStart=/opt/axon/.venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always

[Install]
WantedBy=multi-user.target
```

## Containerized deployment (recommended)

- Prereqs: a DNS A record for your domain (e.g., `api.example.com`) pointing to your droplet’s public IP.
- The `deploy/do` directory includes a ready-to-use compose setup with Caddy for automatic TLS.

Steps:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker

git clone https://github.com/<your-org>/Axon.git /opt/axon
cd /opt/axon/deploy/do
cp env.example .env  # or .env.example depending on your choice

# Edit .env and set DOMAIN, OPENAI_API_KEY, DATABASE_URL, FIREBASE_PROJECT_ID, GOOGLE_CLIENT_ID

docker compose up -d --build
```

- Caddy will request/renew Let’s Encrypt certs automatically.
- API will be available at `https://$DOMAIN`.
- Prisma migrations run on container start when `DATABASE_URL` is set.

To update:

```bash
cd /opt/axon
git pull
cd deploy/do
docker compose pull --ignore-pull-failures
docker compose up -d --build
```

To view logs:

```bash
docker compose logs -f | cat
```

To rollback:

```bash
docker compose ps # identify previous image id for api
docker compose up -d api@sha256:<old>  # or use an image tag
```

Security notes:

- Set CORS allow origins in `backend/api.py` to your domain(s) in production.
- Keep `.env` outside version control; use a secret manager if possible.

## Frontend (Electron) → DO Backend

- Set the backend URL before running the app:

```bash
export BACKEND_URL="https://your-domain"
# Firebase config for renderer (DefinePlugin injects at build time)
export FIREBASE_API_KEY="..."
export FIREBASE_AUTH_DOMAIN="your-app.firebaseapp.com"
export FIREBASE_PROJECT_ID="your-project-id"
export FIREBASE_APP_ID="1:1234567890:web:abcdef"
npm run dev
```

- The app now uses `BACKEND_URL` via `get-biorag-url`.

## Firebase Authentication

- Enable Google provider in Firebase Console → Authentication.
- Configure renderer env vars above so Firebase initializes.
- The app signs in with Firebase Google popup; the Firebase ID token is sent to the backend.
- You can manually test by calling:

```bash
# exchange Firebase ID token with backend (verification + user upsert)
curl -X POST https://your-backend/auth/google \
  -H "Content-Type: application/json" \
  -d '{"id_token":"<FIREBASE_ID_TOKEN>"}'
```

- Backend returns `{ access_token, email, name }` (echoes the provided Firebase token).
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
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
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

## DigitalOcean App Platform (alternative)

- Use `deploy/do/app.yaml` as a starting spec.
- Point it at your repo, set env vars (OPENAI_API_KEY, DATABASE_URL, FIREBASE_PROJECT_ID, GOOGLE_CLIENT_ID).
- App Platform builds the Dockerfile and deploys with managed TLS.

## Next Steps (optional)

- Add Sign-In button in UI using `AuthService.loginWithFirebaseGooglePopup()`.
- Add a “Usage” panel (per-user token totals from `UsageLog`).
- Configure automated backups for Postgres and monitoring/logging.

## PM2 + venv (bare VM)

Use PM2 to supervise the API while running inside a Python virtual environment.

1) Create a virtualenv and install dependencies

```bash
cd /opt/axon
python3 -m venv /opt/axon/.venv  # or your preferred path, e.g., /root/axon-venv
source /opt/axon/.venv/bin/activate
pip install -r backend/requirements.txt prisma
```

2) Install Node.js and pm2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm i -g pm2
```

3) Prepare env and start with PM2

```bash
cd /opt/axon
# Create .env with OPENAI_API_KEY (and DATABASE_URL, FIREBASE_PROJECT_ID, GOOGLE_CLIENT_ID if needed)
echo "OPENAI_API_KEY=..." >> .env

# Start using the default .venv in repo root
PORT=8002 WORKERS=2 pm2 start backend/pm2-ecosystem.config.js

# If your venv is elsewhere, set VENV_DIR
# VENV_DIR=/root/axon-venv PORT=8002 WORKERS=2 pm2 start backend/pm2-ecosystem.config.js

# Persist across reboots
pm2 startup systemd -u $USER --hp $HOME
pm2 save
```

4) Operations

- Update code: `cd /opt/axon && git pull && pm2 reload axon-api`
- Logs: `pm2 logs axon-api --lines 200`
- Health: `curl http://127.0.0.1:8002/health`

Notes
- The start script (`backend/pm2-start.sh`) activates `VENV_DIR` when provided, else `.venv`, else system Python.
- Prisma migrations run only when `DATABASE_URL` is set; otherwise they are skipped.
