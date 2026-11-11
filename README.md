# ISP Manager

Customer, fiber/ONU, network-map and billing management for an internet service provider (fiber / GPON).

- **server/**: REST API built with Express 5, TypeScript, Prisma 6 and PostgreSQL
- **web/**: React 19, Vite, Tailwind CSS v4 and TanStack Query
- **shared/**: zod schemas, roles/permissions and types used by the server and web (and by the planned React Native app)

## Requirements

- **Node.js 20.6+** (the scripts use `--env-file`; Node 22 LTS or newer is recommended)
- **npm 9+** (npm workspaces)
- **PostgreSQL 14+**

## Setup

### 1. Clone and install

```bash
git clone https://github.com/wpbean/ISP-Manager.git
cd ISP-Manager
npm install          # installs every workspace and runs `prisma generate`
```

### 2. Create the database

```bash
createdb isp_manager
# or: psql -c 'CREATE DATABASE isp_manager;'
```

### 3. Configure the API

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://postgres:secret@localhost:5432/isp_manager?schema=public` |
| `JWT_SECRET` | Long random string. Generate one with `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `CORS_ORIGIN` | Comma-separated list of allowed web origins (default `http://localhost:5173`) |
| `APP_TIMEZONE` | Business timezone for "today" and billing days (default `Asia/Dhaka`) |
| `PORT` | API port (default `4000`) |

### 4. Configure the web app (optional in dev)

```bash
cp web/.env.example web/.env
```

| Variable | Description |
|---|---|
| `VITE_API_URL` | API base URL. Leave it empty in dev, because Vite proxies `/api` to `localhost:4000` |
| `VITE_OLT_OPTICAL_URL` | OLT panel link for ONU optical info; `{ponId}` and `{onuId}` are filled in |
| `VITE_RADIUS_CLIENT_URL` | RADIUS panel link for a customer; `{radiusId}` is filled in |

### 5. Migrate and seed

```bash
npm run db:migrate   # applies Prisma migrations
npm run db:seed      # optional: demo customers/payments and staff users
```

> `db:seed` **deletes existing customers and payments** before loading demo data. Don't run it on a real database.

### 6. Run

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000 (health check: `GET /api/health`)

### Demo logins (after seeding)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@isp.local` | `admin12345` |
| Manager | `manager@isp.local` | `staff12345` |
| Technician | `tech@isp.local` | `staff12345` |
| Billing | `billing@isp.local` | `staff12345` |

Change these passwords before you use the app for real.

## Scripts (from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | API + web in watch mode |
| `npm run typecheck` | Type-check shared, server and web |
| `npm run build` | Bundle the server (`server/dist`) and build the web app (`web/dist`) |
| `npm run db:migrate` | Create/apply migrations (`prisma migrate dev`) |
| `npm run db:seed` | Load demo data |
| `npm run db:studio` | Open Prisma Studio |

## Production

```bash
npm ci
npm run build
npm run db:deploy -w server     # prisma migrate deploy (no prompts, no dev resets)
NODE_ENV=production npm start -w server
```

- The API does not serve the web app. Host `web/dist/` as static files (nginx, Caddy, a CDN, …) with SPA fallback to `index.html`.
- Either reverse-proxy `/api` to the API on the same domain, or set `VITE_API_URL` to the API's URL **before** `npm run build` and add the web origin to `CORS_ORIGIN`.
- Use a strong `JWT_SECRET` and serve everything over HTTPS.

## More

See [CLAUDE.md](CLAUDE.md) for the architecture, domain model, billing rules, API reference and coding conventions, and [design.md](design.md) for the UI design system.
