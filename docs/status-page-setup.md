# Status-page setup

User-visible status page at `https://status.thanos.fi`. Two paths —
self-hosted (Uptime Kuma, already in the compose) or hosted
(Statuspage.io). Pick one; the rest of the doc covers both.

The choice affects nothing in the wallet code — both paths are
operational decisions.

---

## Path A — Self-hosted (Uptime Kuma)

Uptime Kuma is already in the observability stack at
`ops/observability/docker-compose.uptime.yml`. It supports public
status pages out of the box.

### Bring up

```bash
cd /var/www/thanos-wallet
docker compose -f ops/observability/docker-compose.uptime.yml up -d
```

### First-time configuration (10 minutes, one-off)

1. SSH-tunnel to the dashboard (Kuma binds to `127.0.0.1:3002` only):
   ```bash
   ssh -L 3002:127.0.0.1:3002 root@VPS_IP
   ```
   Then `http://localhost:3002` in your browser.

2. **Create admin account** — first time you load the UI it asks for
   email + password. Save the credentials in 1Password or similar.

3. **Add monitors** — Kuma calls them "Monitors", one per check:

   | Name | Type | URL / Host | Interval | Expect |
   |---|---|---|---|---|
   | `thanos.fi (web)` | HTTP(s) | `https://thanos.fi/` | 60s | 200, body contains "Thanos" |
   | `api health` | HTTP(s) - JSON Query | `https://thanos.fi/api/health` | 60s | JSON path `ok` equals `true` |
   | `indexer health` | HTTP(s) | `https://thanos.fi/indexer/health` | 60s | 200 |
   | `Makalu RPC` | HTTP(s) | `https://rpc.litho.ai/` | 5m | 200 |
   | `MultX bridge` | HTTP(s) | `https://bridge.litho.ai/health` | 5m | 200 |

4. **Connect a notification channel** — Settings → Notifications.
   Recommend Slack incoming webhook (one channel for outage / recovery
   events) and email to `oncall@thanos.fi`.

5. **Create a public status page** — Status Pages → Add New:
   - Slug: `public`
   - Title: "Thanos Wallet status"
   - Pinned monitors: pick the five from the table above.
   - Add a "support@thanos.fi" footer line.
   - Save → it's now live at `http://VPS_IP:3002/status/public`.

6. **Point DNS** — create a CNAME `status.thanos.fi → VPS_IP`, then
   add a nginx vhost terminating SSL and proxying to `127.0.0.1:3002`.
   Example block lives in `scripts/HTTPS_RUNBOOK.md` adjacent to the
   `thanos.fi` one — copy it, swap the server_name + upstream port.

7. **Test** — power-off the api container for 2 minutes (`docker stop
   thanos-api`); the status page should flip "api health" to red, fire
   the Slack notif, and recover when you bring it back up.

### Maintenance windows

When you intentionally take a service down (DB migration, etc.):

1. Kuma → Maintenance → Add New
2. Pick affected monitors + start/end timestamps + reason
3. Users see "scheduled maintenance" on the public page instead of
   "incident in progress"

---

## Path B — Hosted (Statuspage.io)

Pay-as-you-go, no infra to run. Worth it if the team prefers Atlassian
tooling for postmortems too. Free tier: 1 status page, ≤ 100 subscribers.

1. Create the page at https://statuspage.io → "Add component" for
   each service in the table above.
2. Configure metric ingest:
   - Page Settings → API → grab the API key
   - On the VPS, run a tiny cron that hits each `/health` and posts
     to Statuspage's metric API every minute. Sample script:
     ```bash
     #!/usr/bin/env bash
     set -euo pipefail
     for s in api indexer; do
       up=$(curl -sf "https://thanos.fi/$s/health" >/dev/null && echo 1 || echo 0)
       curl -sf -X POST \
         "https://api.statuspage.io/v1/pages/$STATUSPAGE_PAGE_ID/metrics/${s}_health/data.json" \
         -H "Authorization: OAuth $STATUSPAGE_API_KEY" \
         -d "data[timestamp]=$(date +%s)&data[value]=$up" >/dev/null
     done
     ```
3. Set up the public URL — Statuspage exposes
   `https://thanos.statuspage.io` by default; CNAME `status.thanos.fi`
   to map your subdomain.
4. Configure notification rules — Statuspage UI → Subscribers (email)
   + Settings → Integrations (Slack/Twitter).

---

## What goes on the status page (regardless of path)

Five components, mirrored in Uptime Kuma's monitor list above:

- **Web wallet** (thanos.fi)
- **API** (auth, contacts, DNNS resolve, portfolio)
- **Indexer** (LEP-100 balance + activity sync)
- **MultX bridge** — third-party, useful to mirror their outages
- **Makalu RPC** — third-party

Don't surface Postgres or Redis — they're implementation details. If
they break the public-facing components break with them.

## Posting incidents to the status page

Every SEV-1 / SEV-2 from the [`incident-runbook`](./incident-runbook.md)
gets a corresponding status-page incident. Template:

```
**Identified — <component> degraded — <UTC time>**

We're seeing elevated 5xx responses on the API. Investigating.

— next update in 15 min.
```

→ flip to "Monitoring" once the fix is deployed, then "Resolved" once
metrics return to baseline.

## Subscribers

- Send the `status.thanos.fi` URL in every user-facing comms (web
  footer, store-listing support URLs).
- Stakeholders can subscribe to email / SMS / RSS / Slack.
