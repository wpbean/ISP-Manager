# ISP Manager

Customer, fiber/ONU, and billing management for an internet service provider.
Express + Prisma (PostgreSQL) REST API, React web app, shared zod schemas (ready for a React Native app).

## Quick start

```bash
npm install
cp server/.env.example server/.env   # set DATABASE_URL and JWT_SECRET
createdb isp_manager
npm run db:migrate
npm run db:seed                      # demo data
npm run dev                          # web: http://localhost:5173  api: http://localhost:4000
```

Login: `admin@isp.local` / `admin12345` (change it in Settings).

See [CLAUDE.md](CLAUDE.md) for architecture, API reference, and conventions.
