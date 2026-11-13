# ISP Manager — guide for AI assistants

Customer management system for an internet service provider (fiber / GPON). A Node REST API
serves the React web app now and a **React Native Android app later**, so the API must stay
client-agnostic (JSON, Bearer JWT, no cookies, no server-rendered HTML).

## Repo layout (npm workspaces)

```
shared/   @isp/shared — zod schemas, roles/permissions, constants, API response types.
          TS source consumed directly (no build). Single source of truth for validation:
          the server parses with these schemas and the web forms use them via zodResolver.
          The React Native app should import this package too.
server/   @isp/server — Express 5 + TypeScript + Prisma 6 (PostgreSQL). Runs with tsx in dev,
          bundled by tsup (bundles @isp/shared) for prod.
web/      @isp/web — React 19 + Vite 6 + Tailwind CSS v4 + TanStack Query 5 + react-hook-form
          + Recharts + react-leaflet (OpenStreetMap tiles).
design.md Visual design system. Follow it for ALL UI work (see "Design rules" below).
```

## Commands (run from repo root)

| Command | What it does |
|---|---|
| `npm install` | Install all workspaces (runs `prisma generate`) |
| `npm run dev` | API on :4000 + web on :5173 (Vite proxies `/api` → :4000) |
| `npm run typecheck` | `tsc --noEmit` for shared, server, web — run after every change |
| `npm run build` | tsup server bundle + Vite web build |
| `npm run db:migrate` | `prisma migrate dev` (create/apply migrations after editing schema) |
| `npm run db:seed` | Reset customers/payments and load demo data (upserts staff users) |
| `npm run db:studio` | Prisma Studio |

Env: `server/.env` (copy `server/.env.example`): `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
`CORS_ORIGIN` (comma list), `APP_TIMEZONE` (default `Asia/Dhaka`), `PORT`.
Web: `web/.env` → `VITE_API_URL` (empty in dev).

Demo logins (after seed): `admin@isp.local / admin12345`; `manager@`, `tech@`, `billing@isp.local / staff12345`.

## Domain model (server/prisma/schema.prisma)

- **User** (staff): role `ADMIN | MANAGER | TECHNICIAN | BILLING`, `isActive`.
- **Customer**: `customerCode` (`C-000123`, generated from autoincrement `seq` inside a transaction),
  basic info (name, phone, altPhone, email, nid, address, area), `status`
  (`PENDING | ACTIVE | SUSPENDED | DISCONNECTED`), package as **free text** (`packageSpeed` required, `monthlyFee` Decimal), dates (`connectionDate`, `billingDate` = next bill due,
  `expireDate` = service valid until), `radiusId` (unique **Int**, e.g. 24545), `pppoeUsername` (unique)
  — both **stored only**, no RADIUS/MikroTik sync yet; `onuSerial` (unique), `onuModel`, `ponId`/`onuId` (Int), fiber core details (OLT `oltName`/`ponPort`/`onuId`; splitter
  `splitterName`/`splitterRatio`/`splitterPort`/`boxName`; cable `cableId`/`coreNumber`/`coreColor`/
  `tubeColor`; signal `rxPower`/`txPower` dBm, `cableLength` m), GPS `latitude`/`longitude`, `notes`.
- **Payment**: `receiptNo` (`R2026-000123`), amount, method (`CASH | BKASH | NAGAD | ROCKET | BANK | OTHER`),
  `transactionId`, `months` renewed, `periodFrom`/`periodTo`, `paidAt`, `collectedBy`.
- **FiberNode** (`OLT | TJ_BOX | SPLITTER`, unique per type+name): GPS, schematic `posX/posY`; OLT `ponPorts`/`ponPrefix`
  (port 4 → `0/1/4`), `ipAddress`, `model`; TJ box `cablePorts` (numbered **splice positions**, default 4: In N on the left, Out N on the right;
  which incoming core feeds an outgoing core is the out core's `FiberLink.spliceIn` — any position, any color); splitter `splitterRatio` (1:N = N output ports) and `boxId` (TJ box it sits in —
  splitters have **no GPS of their own** — the server nulls it, and the map draws them at their box's pin).
- **FiberLink**: one fiber core from `fromNodeId`+`fromPort` (OLT PON / TJ box out port / splitter output — always set) to `toNodeId`
  (+ `toPort` = splice position when the target is a TJ box, unique per box; `spliceIn` = the In position a core
  leaving a TJ box is fused to, unique per box, null = not spliced, defaults to `fromPort` when free), with
  `cableCode`, `coreCount`, `tubeColor`, `coreNumber`, `coreColor`, `length` (m), `startMark`/`endMark` (sheath meter marks at
  each end — one cable ID can leave a TJ box on several ports, the marks tell the runs apart; if `length` is empty it becomes
  `|end − start|`), `path` (map waypoints JSON). **Multi-core cables**: cores with the same `cableCode` between the same two
  nodes are one physical cable (`cableKey()` in shared); `CABLE_SHARED_FIELDS` (coreCount, length, marks, path) are synced to
  all its cores on create/PATCH, and a core number is used once per cable. Rules in `server/src/services/network.ts`: one
  cable per port, one core per TJ splice position, one input per splitter, one **uplink** core into an
  OLT and only from a TJ box out port (`toPort` null; customer tracing stops at the OLT), no loops.
- Customer ↔ splitter port: `Customer.fiberNodeId` + `splitterPort` (unique together). After every network change
  `resyncCustomers()` traces upstream (through TJ boxes by splice: out core ← In `spliceIn`) and overwrites the customer's `oltName`, `ponPort`, `splitterName`, `splitterRatio`,
  `boxName`, `coreColor` (port N → TIA-598 color `fiberColorFor(N)`) — never clears them with nulls.
- "Expired" is **derived** (`expireDate < today`), not a status value.

Currency is BDT (৳); business timezone `Asia/Dhaka` decides "today" and month boundaries.

### Billing rules (server/src/services/billing.ts)

- One billing month = `BILLING_CYCLE_DAYS` (30 days, `shared/src/constants.ts`), not a calendar month.
- Recording a payment with `months > 0` renews service: new expiry = current expiry + 30 × months
  if still valid, else today + 30 × months (period starts the day after the current expiry, or today);
  `expireDate` and `billingDate` both become `periodTo`. SUSPENDED/PENDING customers are re-activated (not DISCONNECTED).
- The web form shows one "Expire date" field (connection date is labelled "Join date"); on save
  `billingDate` is set equal to `expireDate`. New customers default it to join date + 30 days (until edited by hand).
- `months = 0` records a payment without renewal (dues / partial).
- Deleting the latest renewal payment rolls `expireDate`/`billingDate` back to `periodFrom − 1`;
  deleting an older renewal is rejected.
- The web PaymentModal mirrors `computeRenewal` for a preview — keep the two in sync.

## API (all under `/api/v1`, JSON, `Authorization: Bearer <jwt>`)

| Method & path | Permission |
|---|---|
| `POST /auth/login` → `{ token, user }`; `GET /auth/me`; `POST /auth/change-password` | public / any |
| `GET /dashboard/stats` | `dashboard:read` |
| `GET /customers?q&status&expiry=expired\|expiring\|valid&area&page&pageSize&sort&order` → `{ data, meta }` | `customers:read` |
| `GET /customers/map`, `GET /customers/areas`, `GET /customers/:id` | `customers:read` |
| `POST /customers` | `customers:create` |
| `PATCH /customers/:id` (partial) | `customers:update`, or `customers:update_network` for `NETWORK_FIELDS` only |
| `PATCH /customers/:id/status`, `DELETE /customers/:id` | `customers:update` / `customers:delete` |
| `GET /customers/export` (CSV, same filters) / `POST /customers/import` (multipart `file`) | `customers:export` / `customers:import` |
| `GET /customers/:id/payments`, `GET /payments?q&method&from&to&page`, `GET /payments/:id` | `payments:read` |
| `POST /payments` (optional `collectedById`, defaults to caller) → `{ data: payment, customer }`; `DELETE /payments/:id` | `payments:create` / `payments:delete` |
| `GET /payments/collectors` → active staff `{ id, name, role }` for the "Collected by" picker | `payments:create` |
| `GET /network` → `{ nodes, links, customers }` (whole graph) | `network:read` |
| `POST/PATCH/DELETE /network/nodes[/:id]`, `PATCH /network/positions`, `POST/PATCH/DELETE /network/links[/:id]`, `POST /network/links/:id/insert-box` `{boxId \| newBox, wholeCable, mark, lengthToBox}` (cut a cable and splice a TJ box in: A→B becomes A→box In N + box Out N→B per core), `POST /network/assignments` `{customerId,nodeId,port}`, `DELETE /network/assignments/:customerId` | `network:manage` |
| `GET/POST/PATCH/DELETE /users` | `users:manage` |

Errors are always `{ error: { message, code, details? } }` with proper HTTP status
(400 `VALIDATION_ERROR`, 401, 403 `FORBIDDEN`, 404, 409 `DUPLICATE`). Date-only fields travel as
`"YYYY-MM-DD"`; timestamps as ISO strings; money as numbers. Health check: `GET /api/health`.

## Conventions

- **Validation lives in `shared/src/schemas.ts`.** Add fields there first, then Prisma schema +
  migration, then `server/src/lib/serialize.ts`, `shared/src/types.ts`, CSV columns in
  `server/src/routes/customers.ts`, and the web form/detail page.
- zod 4 gotcha: `.default()` still fires inside `.partial()`. Update schemas are built from a
  default-free base (`customerBase`, `userBase`) — never derive PATCH schemas from create schemas
  that have defaults, or PATCH will silently reset fields.
- Permissions: `shared/src/constants.ts` (`ROLE_PERMISSIONS`, `can()`). Enforce on the server with
  `requirePermission(...)`; the web hides UI via `useAuth().can()`. Never rely on UI checks alone.
- Express 5: async handlers may throw (no wrapper needed); throw `HttpError` helpers from `lib/http.ts`.
  Route params: use `String(req.params.id)` (Express 5 types).
- Forms send `""` for empty inputs; shared schemas normalise `""` → `null`.
- Dates: use helpers in `server/src/lib/dates.ts` (`todayDate`, `zonedDayStart`, `addMonths`) —
  never `new Date()` arithmetic for business days.
- Web data fetching only through hooks in `web/src/lib/queries.ts` (TanStack Query); invalidate
  `customers`, `customer`, `payments`, `dashboard` keys after mutations.
- Path alias `@/` → `web/src`. UI primitives in `web/src/components/ui`.

## Design rules (from design.md — follow strictly)

- Dark canvas by default (`#0b0e11`, cards `#1e2329`, elevated `#2b3139`), light theme toggle.
  Tokens are CSS variables in `web/src/index.css` exposed as Tailwind colors
  (`bg-canvas`, `bg-surface`, `bg-surface-2`, `border-hairline`, `text-strong`, `text-muted`, …).
- **Single accent: yellow `#FCD535`** (`bg-primary` + `text-on-primary` black). Primary CTAs are
  black-on-yellow; never white text on yellow. Yellow *text* uses `text-accent` (theme-aware:
  yellow on dark, `#8a6400` on light for contrast). No second brand color, no gradients/glow.
- Up/down green `#0ecb81` / red `#f6465d` signal direction (valid vs expired, paid amounts) as
  text color or small badge tint — never as card backgrounds.
- **Every number uses the `num` class** (IBM Plex Sans, tabular-nums) — prices, phone numbers,
  codes, dates, IDs. Text uses Inter.
- Radius: buttons/inputs 6px (`rounded-md`), cards 12px (`rounded-xl`), sub-cards 8px.
  Flat surfaces separated by color steps and 1px hairlines; no heavy shadows.
- Display weight 700, titles 600. Inputs 40px high; tables use hairline row dividers and muted headers.
- Charts (`web/src/components/BarTrend.tsx`): single-series bars use `--chart-bar`
  (validated `#b88c00` dark / `#946c00` light), hovered bar brand yellow, 4px rounded tops,
  recessive grid, tooltip on hover, a table view alternative. No dual axes.
- Status colors: Active=green, Pending=blue(info), Suspended=yellow, Disconnected=red — always
  with a text label, never color alone.

## Network map (web/src/pages/network)

`/network` page (nav label "Network Map"; old `/map` redirects here): **Schematic** (React Flow `@xyflow/react`: custom OLT / TJ box / splitter nodes with one source handle
per port, customers as child leaf nodes; drag port → node opens `NewLinkModal`) and **Map** (Leaflet: draggable pins,
cable polylines colored by core color, "Pick on map" and "Draw route" modes). Shared `Inspector.tsx` edits the selection.
Node geometry constants (`HEADER_H`, `ROW_H`) in `Schematic.tsx` keep customer leaves aligned with port rows.
TJ boxes are wider (`BOX_W`) and draw a **splice tray** (`SpliceTray`) between the in/out columns: each join is a curve
from the In core's color to the out core's color; splices are edited in the box Inspector ("Splices") or the cable Inspector.
Splitters with a `boxId` are drawn **inside their TJ box** (React Flow child nodes, not draggable, saved `posX/posY` ignored):
the box footer toggles expand/collapse (set kept in localStorage `isp.network.expandedBoxes`, collapsed by default; selecting a
hidden splitter/customer auto-expands). Collapsed: cables to/from hidden splitters reroute to the box's `spl-in`/`spl-out`
handles; a box→own-splitter feed is never drawn (shown as "← Out N" on the splitter).
Fiber color hex / port colors live in `@isp/shared` (`FIBER_HEX`, `fiberColorFor`).

## Planned / not yet built

- React Native Android app consuming this API (reuse `@isp/shared` types & schemas).
- RADIUS (FreeRADIUS `radcheck`/`radusergroup`) or MikroTik PPPoE sync and auto-suspend on expiry.
- Packages table (currently free text per customer), SMS reminders, refresh tokens, audit log.
