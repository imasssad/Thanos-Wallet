# TODAY Compliant — Custom Platform (Phase 1)

A marketplace connecting clients (who post projects) with contractors (who
browse and respond to them). Built on FastAPI (backend) + Next.js (frontend),
replacing the original WordPress/JetEngine build per the client's approved
platform migration.

This is Phase 1 — Foundation, from the agreed phase plan:
- Auth (register/login, two roles: client, contractor)
- Projects CPT-equivalent (title, description, budget, city/state, job type,
  union status)
- Lead board with exactly three filters: job type, city/state, union status
- Project posting form
- Project card, cars.com-style, styled with the client's brand palette
- Private project-owner dashboard with separate documentation and insurance
  policy forms, authenticated file viewing, and downloads
- Contractor compliance dashboard with editable company profiles, bid history,
  documents, insurance, onboarding tasks, equipment photos, and contractor types

Not yet built (later phases): union/non-union badges are in, but contractor
profiles, the COI request button, Stripe subscription gating, compliance
auto-hide, and real geo/radius search are Phases 3–5, not part of this
delivery.

## Stack

- **Backend:** FastAPI, SQLAlchemy, Postgres, JWT auth (`python-jose`),
  password hashing via `bcrypt` directly (not passlib — see note below)
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS

## Prerequisites

- Python 3.11+
- Node.js 18+
- A running Postgres instance (local, or a hosted one — Railway, Supabase,
  Neon, RDS, whatever you're already using)

## Backend setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env — set DATABASE_URL to your real Postgres connection string,
# and SECRET_KEY to a long random string (e.g. `openssl rand -hex 32`)

uvicorn app.main:app --reload --port 8000
```

The API will be live at `http://localhost:8000`. Interactive docs (Swagger UI)
are auto-generated at `http://localhost:8000/docs` — useful for testing
endpoints by hand before the frontend is wired up.

On first run, `Base.metadata.create_all()` creates all tables automatically.
That's fine for development. **Before this touches real production data,
switch to Alembic migrations** (already in requirements.txt) — `create_all`
has no concept of schema changes over time and will silently do nothing if a
table already exists in an outdated shape.

## Frontend setup

```bash
cd frontend
npm install

cp .env.local.example .env.local
# NEXT_PUBLIC_API_URL should point at your running backend
# (http://localhost:8000 for local dev)

npm run dev
```

The site will be live at `http://localhost:3000`.

## Trying it out

1. Go to `/register`, create a **client** account, post a project.
2. Register a second account as a **contractor** in a private/incognito
   window (or log out first).
3. Go to `/` — the lead board — and confirm the project shows up, and that
   the three filters (trade, city/state, union status) actually narrow the
   results.

## A few implementation notes worth knowing

- **City/state only, never an exact address** — this is enforced at the
  database level (`Project` has no address field at all, only `city`/`state`
  plus optional `lat`/`lng` for future geo search). This was an explicit
  client privacy requirement, not just a frontend choice — even a future API
consumer can't accidentally leak a full address, because it's never stored.
- **Owner documents are private.** PDF and image uploads are stored beneath
  `UPLOAD_DIRECTORY` and are never exposed as a public static directory. The
  list, upload, view, and download endpoints all verify the signed-in project
  owner. The default upload limit is 10 MB and can be changed with
`MAX_UPLOAD_SIZE_MB`.
- **Existing databases need the contractor profile migration.** Run
  `backend/migrations/20260902_contractor_compliance.sql` against an existing
  PostgreSQL database before deploying this version. New databases receive the
  complete schema automatically through `create_all()`.
- **The three-filter limit on the lead board is intentional**, not a
  placeholder to expand later without discussion — the client was specific
  that this stays to exactly job type, city/state, and union status. Any
  future filter addition should be a deliberate scope conversation, not an
  assumption.
- **Password hashing uses `bcrypt` directly, not `passlib`.** Passlib's
  bcrypt backend has a known compatibility break with recent `bcrypt`
  package releases (passlib is effectively unmaintained). Using `bcrypt`
  directly avoids an entire class of environment-dependent failures.
- **The subscription/compliance gate on the lead board (Phase 4) is stubbed
  in already** — see `require_active_contractor_subscription` in
  `app/auth.py`. It's not wired into the `/api/projects` endpoint yet
  (that endpoint currently just requires *any* logged-in user), but the
  dependency is ready to swap in once Stripe subscriptions exist.
- **Fonts:** headings use Barlow Condensed, body text uses Work Sans, loaded
  via `next/font/google`. These need real internet access at build time to
  fetch from Google Fonts — if your build environment is network-restricted
  (e.g. a sandboxed CI runner), you'll see a `NextFontError`. This is an
  environment issue, not a code bug.

## What's next (Phase 2 onward)

See the full phase plan for the complete build order — union/non-union
filtering is already done as part of Phase 1/2 crossover, so the next real
milestones are contractor profiles + the COI request feature (Phase 3), then
Stripe subscription gating and compliance auto-hide (Phase 4).
