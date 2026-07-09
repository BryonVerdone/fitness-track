# fitness-track

Self-hosted fitness tracker: macros, workouts, cardio, and body weight, with
invite-only multi-user accounts. Single Node.js/Express app, SQLite storage,
server-rendered pages that work well on mobile.

## Stack

- Node.js + Express, EJS templates (server-rendered, no build step)
- SQLite via `better-sqlite3`, single file at `/data/fitness.db`
- Session auth (`express-session`, bcrypt password hashes), sessions stored in
  the same SQLite file
- Chart.js (served locally, no CDN dependency) for weight/pace/progression charts

## First-run setup

```bash
cp .env.example .env
# edit .env and set SESSION_SECRET to a long random string:
openssl rand -hex 32

docker compose up --build
```

Visit `http://<host>:8085`. Since no users exist yet, you'll land on a setup
screen — the account you create here becomes the **admin** and is seeded with
the example targets/templates from the project brief (training/rest macro
targets, goal weight, and the four workout templates). You can edit or delete
any of that afterward.

## Inviting friends

As admin, go to **Admin** in the nav:

1. Click **Generate invite link** — this creates a one-time-use link at
   `/register/<code>`.
2. Send that full URL to a friend (e.g. `https://fitness.example.com/register/abc123...`).
3. Once they register, the invite is marked used and can't be reused. Revoke
   unused invites any time from the same page.
4. The **Users** table lets you deactivate (and reactivate) accounts. Deactivated
   users can't log in but their data is kept.

Each user's data (macros, workouts, cardio, weight) is completely private to
them. The exercise database is shared — any user can add new exercises, and
admins can edit, merge duplicates into a canonical entry, or deactivate stale
ones.

## Pointing a Cloudflare Tunnel at the container

The app expects to sit behind a reverse proxy that terminates TLS (Cloudflare
in this setup) and forwards the real client IP. It trusts one proxy hop
(`app.set('trust proxy', 1)`), so `CF-Connecting-IP` / `X-Forwarded-*` headers
are used correctly for secure cookies, session handling, and login rate
limiting.

1. Create a tunnel in the Cloudflare dashboard (or `cloudflared tunnel create`).
2. Point its public hostname at `http://localhost:8085` (or, if running
   `cloudflared` as a compose service on the same network, at
   `http://fitness-track:3000` — see the commented-out `cloudflared` service in
   `docker-compose.yml` for an example).
3. `cloudflared` runs over plain HTTP to the app; Cloudflare terminates TLS at
   the edge. Nothing in the app itself needs to know about TLS.
4. Put **Cloudflare Access** in front of the tunnel's hostname and restrict it
   to your friends' email addresses. Access controls *who can reach the app at
   all*; the app's own login controls identity and data once inside — the two
   are independent, and v1 does not auto-log-in users from Access headers (no
   `Cf-Access-Jwt-Assertion` validation yet — a reasonable future enhancement).

### `/health` and uptime monitoring

`GET /health` returns `{"status":"ok"}` and is unauthenticated by design, for
use with uptime monitors. If you put the whole app behind Cloudflare Access,
external monitors won't be able to reach `/health` either — add an Access
**bypass policy** scoped to that path (or monitor from inside your network,
which skips Access/the tunnel entirely).

## Backups

All persistent state is the single SQLite file at `./data/fitness.db` (bind
mounted from the host). There's no other database or external service to back
up. WAL mode is enabled, so you may also see `-wal`/`-shm` files next to it —
include those in backups too, or stop the container briefly before copying to
get a fully checkpointed file.

## Updating

```bash
git pull
docker compose up --build -d
```

The schema is created/migrated additively on startup (`CREATE TABLE IF NOT
EXISTS`), so existing data in `./data/fitness.db` is preserved across updates.

## Development

```bash
npm install
SESSION_SECRET=dev DB_PATH=./data/fitness.db npm start
```

Runs on `http://localhost:3000`.
