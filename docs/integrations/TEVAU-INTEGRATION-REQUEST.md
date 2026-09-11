# Tevau — second card processor for LAX (backup/failover)

**Status: blocked on access, same shape as LAX's early state.** Investigated
2026-09-11 from the two URLs given (`https://api-en.tevau.io/` and
`https://openapi.tevau.io/merchant/#/login`). Neither is a public API
reference — both are gated apps. No endpoint, auth, or pricing details are
confirmed yet.

## What the two URLs actually are

- **`api-en.tevau.io`** — a **consumer-facing landing/application page**
  (English locale) for Tevau's own prepaid/virtual card product: "Experience
  effortless global spending with Tevau." It mentions a virtual-card
  application flow, a choice of "Partner Shipping" vs "Tevau Shipping," and
  two KYC submission versions (V1/V2) — but it's marketing copy + an
  application form, not a developer API root. `robots.txt`/`sitemap.xml`
  resolve; the sitemap lists hundreds of opaque numeric-slug pages (SEO
  content), nothing API-shaped.
- **`openapi.tevau.io/merchant/#/login`** — despite the `openapi.` subdomain
  and the docs-portal-sounding URL, this is **Tevau's merchant/partner admin
  console** (a Vue SPA — "Tevau Global Partner Hub"), gated behind a login
  form. The bundle's internal routes are admin-panel routes (`/partner/login`,
  `/sys/userLogin`, `/monitor/login-logs`, `/admin/dictionary/query`, an
  embedded low-code page-builder), not a Swagger/Redoc API explorer. It's the
  self-serve dashboard you'd log into to manage a merchant account, get API
  keys, and (presumably) find the real API reference — same pattern as LAX's
  `dash.zypto.com`.

**Bottom line: no real OpenAPI spec is reachable without a Tevau merchant
account.** Whoever is talking to Tevau needs to either get dashboard access
(mirroring how the LAX relationship started) or ask their contact directly
for the API reference / Postman collection / OpenAPI file — the same request
that got LAX's real spec (`dash.zypto.com/docs/openapi.yaml`) handed over by
Robert on 2026-09-09.

## What "backup / 2 card processors" implies, architecturally

Once Tevau credentials + a real spec exist, the natural shape (mirrors how
`services/api/src/routes/lax.ts` is already built):

- A small `CardProcessorId = 'lax' | 'tevau'` type and a thin
  `services/api/src/lib/card-processors.ts` status/selector module — each
  processor reports `configured` / `configuredForIssuance` independently
  (same pattern as `laxStatus()`), so the app can show real state rather than
  guessing.
- Record which processor issued a given card in the `lax_cards` table (add a
  `provider` column, default `'lax'`) — card ownership/lookup logic barely
  changes, it just also scopes by provider.
- "Backup" could mean either (a) automatic failover — try LAX, fall back to
  Tevau on a configured-but-down primary, or (b) a manual secondary a user
  picks at issuance time. Worth confirming which one the client means before
  building the selection UI — failover and user-choice are different UX and
  different failure-handling code, even though the backend plumbing
  (a processor interface + a `provider` column) is shared either way.

**Not started, deliberately** — designing the actual `CardProcessor`
interface now, before Tevau's real request/response shapes are known, would
be pure guesswork (LAX's own spec turned out to have a very specific shape:
`iframe_id`/`product_id` dashboard-config requirements, Bearer auth, no
sandbox — nothing about that generalizes safely in advance). The status
module above is safe to build blind; the actual issuance/topup/KYC call
shapes aren't.

## Open questions (need Tevau's side, or dashboard access)

- Auth scheme (API key header? Bearer? OAuth?) — unknown.
- Card issuance flow — instant virtual card vs KYC-gated, timeline, required
  fields.
- Whether a sandbox/test environment exists (LAX's answer was "no, real data
  only" — worth asking explicitly since it changes how a first integration
  gets tested).
- Pricing / fee structure.
- Which of "physical," "virtual," or both card types Tevau offers.
- Failover vs manual-choice — see above.
