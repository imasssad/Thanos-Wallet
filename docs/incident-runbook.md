# Incident response runbook

Single source of truth for "something is on fire — what do I do."
Drives the on-call rotation; pairs with `ROLLBACK.md` (which covers
the *recovery* steps) and `ops/observability/alerts.yml` (which
fires the pages).

Audience: whoever is on-call right now. Optimised for a fast read at
3 a.m. on a phone.

---

## 0. Severity ladder

| Sev | Meaning | First response time |
|---|---|---|
| **SEV-1** | Wallet is unusable for >1% of active users (e.g. site fully down, signing broken, every send failing) — OR — security incident with confirmed data exposure | < 5 minutes; page primary + backup on-call |
| **SEV-2** | A significant flow is degraded (swap unavailable, one chain's RPC out, indexer 30+ min behind) | < 15 minutes; page primary on-call |
| **SEV-3** | Single non-critical feature broken (DNNS reverse-lookup wrong, push notif delay) | next business day |

Demote freely — calling a SEV-2 a SEV-3 to avoid a page when the
backup is also paged is a SEV-1-by-mistake. Calling a SEV-3 a SEV-2
costs an extra page, which is fine.

## 1. The first three minutes

1. **Acknowledge the page.** Reply in `#thanos-incidents` Slack with
   the alert name + your name. Stops the escalation timer.
2. **Read the alert.** Each `alerts.yml` rule has an `annotations.summary`
   + `description`. Most also have a one-line "check this" hint.
3. **Pull the dashboard.** Grafana at `http://VPS_IP:3001` →
   "Thanos — Service Health". Ten seconds, look for the obvious red.

If you can't tell from the dashboard what's broken in 60 seconds,
escalate (don't dig solo at 3 a.m.).

## 2. The five-minute triage matrix

| Symptom | Most likely cause | Where to look | Fix path |
|---|---|---|---|
| `ThanosServiceDown {job=…}` | Container crash-looped | `docker logs --tail=100 thanos-<job>` | If panic in logs → roll back via `ROLLBACK.md` §"Per-service rollback". If OOM → bump container limit, restart |
| `ThanosApi5xxRateHigh` | DB pool exhausted / RPC outage | `docker exec thanos-postgres psql -c 'select count(*) from pg_stat_activity'` + recent commits | DB tuning OR per-service rollback |
| `ThanosApiLatencyHigh` | DB slow query / cold cache | Grafana → "API p99 by route", + `pg_stat_statements` | Identify slow route, kill long-running queries (`pg_cancel_backend(pid)`), open follow-up issue |
| `ThanosWorkerQueueBacklog` | Job-handler bug or chain-RPC outage | `docker logs --tail=100 thanos-worker | grep failed` + indexer dashboard | If RPC out → wait for `ThanosRpcOutage` to resolve. If handler bug → roll back worker image |
| `ThanosBridgePollFailing` | bridge.litho.ai 5xx / rate-limit / down | `curl -sv https://bridge.litho.ai/health` | If 503 → it's their side. Acknowledge alert, watch. If our side → check `BRIDGE_API_URL` env |
| `ThanosIndexerStalled` / `ThanosRpcOutage` | rpc.litho.ai + rpc-2 unreachable | `curl -sv https://rpc.litho.ai` + https://status.litho.ai | Chain-wide event → comms in #thanos-incidents, wait. Our side → check container network |
| `ThanosAuthFailedLoginSpike` | Credential-stuffing attack | `auth_events` table → group by IP | Block top IPs at nginx; consider `auth_max=5` temporarily |

## 3. Communication template

Post to `#thanos-incidents` immediately, edit as you learn more:

```
🚨 [SEV-2] API 5xx rate elevated since 03:14 UTC
Reported by: ThanosApi5xxRateHigh alert
Impact: ~3% of /auth/login + /portfolio calls returning 502
Initial cause hypothesis: DB connection pool saturated
Status: investigating
On-call: @<your-name>
Next update: 03:30 UTC
```

Every 15 minutes after that, even if "still investigating." Silence
is worse than "no progress" for stakeholders.

When you're done:

```
✅ [SEV-2] Resolved at 03:42 UTC.
Root cause: 32-connection pg pool exhausted by a runaway loop in the
indexer's LEP-100 backfill (commit abc1234). Backfill killed,
indexer rolled back to the previous image, pool back to baseline.
Postmortem: <link to follow-up issue>
```

## 4. The postmortem

Within 5 business days of resolution. Template in
`docs/postmortem-template.md`. Five sections:

1. **Timeline** — UTC timestamps, what happened when.
2. **Impact** — who/what was affected, for how long.
3. **Root cause** — what actually broke, *why* it broke.
4. **Resolution** — what you did to fix it (paste from incident chat).
5. **Action items** — bullet list with owners. Each one becomes a
   GitHub issue tagged `incident-followup`.

Never blame a person — blame the system that let the mistake reach
production. If the postmortem reads "X deployed bad code", rewrite it
to "the deploy pipeline let unreviewed code reach prod without a smoke
check; we're adding a smoke check."

## 5. Escalation tree

| Layer | Who | Reach via |
|---|---|---|
| Primary on-call | (set in PagerDuty rotation) | PD page |
| Backup on-call | (set in PagerDuty rotation) | PD page after 5 min unack |
| Lithosphere infra | infra@litho.ai | escalate when RPC, bridge, or DNNS misbehaves |
| Apple / Google / Chrome store | (per-store contact in each listing) | escalate when a published listing gets pulled |
| Press / users | hello@thanos.fi | route via comms lead, never the engineer who's debugging |

If both primary + backup are unreachable, the wallet does **not** go
down without anyone noticing — Uptime Kuma's pubic status page (when
configured per `docs/status-page-setup.md`) shows users the outage
state and tells them not to bombard support.

## 6. Things that AREN'T incidents (don't page)

- Single dApp doesn't load (could be the dApp).
- One user reports "my balance is wrong" (likely indexer lag <5 min,
  or the user looking at a different account).
- A test transaction on staging shows up wrong (staging is not paged).
- A dependency-audit advisory landed (it's tracked, not paged).

If unsure, post in `#thanos-help` instead of paging.
