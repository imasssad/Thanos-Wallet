# Scaling policy

Where the wallet's backend stands today, what each tier of growth
demands, and what to swap when we cross each threshold.

This is intentionally honest about the current shape (single-VPS,
docker-compose, no autoscaler) — there's no point pretending the
production-readiness audit's "Autoscaling policy defined" item means
"we have a K8s HPA running" when we don't.

---

## Where we are now

**Architecture**: one VPS, Docker Compose, all stack components co-resident:

| Component | Container | Why on the same host today |
|---|---|---|
| nginx | `thanos-nginx` | TLS termination + static asset cache; ~50 MB RAM |
| Web (Next.js standalone) | `thanos-web` | Lives behind nginx, ~300 MB RAM |
| API (Express + Pino) | `thanos-api` | Same host = zero-latency DB hops |
| Indexer (LEP-100 sync loop) | `thanos-indexer` | Same DB; tight write path |
| Worker (BullMQ) | `thanos-worker` | Same Redis |
| Postgres 16 | `thanos-postgres` | Local UNIX socket beats a network hop for the wallet's load |
| Redis | `thanos-redis` | Same |
| Prometheus + Grafana + Loki | observability stack | Out-of-band; bind to 127.0.0.1, nginx-proxied for ops |

**Sized for**: up to ~5k daily active users, ~50 req/s sustained.
Past that the bottleneck order is documented below.

**Why this is the right design today**: a multi-host setup adds DNS,
TLS-between-services, sidecars, and a control plane to operate. Until
the wallet's load justifies that complexity, it's a tax on dev speed
and a larger blast radius for outages — every component fits on one
4-vCPU / 16 GB VPS comfortably with headroom.

---

## When to scale: the four signals

We don't scale on a schedule. We scale on these four indicators —
whichever fires first.

### Signal 1: API p99 latency > 500 ms sustained for 1h

```promql
histogram_quantile(0.99, sum by (job, le) (
  rate(http_request_duration_seconds_bucket{job="thanos-api"}[5m])
))
```

If this stays above 0.5s for an hour, the API is the bottleneck. First
verify it's not a downstream slowness (DB pool exhausted, RPC slow):

- `pg_stat_activity` shows ≤ 30 active queries → DB is fine, the API
  loop itself is hot. Path: **vertical-scale the API container** (more
  vCPU) OR **horizontal-scale** by adding a second API replica behind
  the same nginx upstream block.

### Signal 2: Worker queue depth > 1000 jobs/queue for 30 min

```promql
max by (queue) (thanos_worker_queue_depth{state="wait"}) > 1000
```

Workers are falling behind. Knobs:

- **Concurrency**: each queue's worker is started with a default
  concurrency of 4. Raise to 8 or 16 in `services/worker/src/worker.ts`.
- **Add a second worker container**: BullMQ handles distribution
  across workers automatically — point a second instance at the same
  Redis. Drop the queue concurrency back to 4 so they don't fight.
- **Sharding** (only at queue depth > 10k): split a high-volume queue
  by user-id hash into two queues with two dedicated workers.

### Signal 3: Indexer cursor lag > 200 blocks for 30 min

```promql
thanos_indexer_sync_lag_blocks > 200
```

The indexer is single-process by design today (one sync loop, one
cursor). Knobs in order:

1. **Increase `MAX_BLOCKS_PER_BATCH`** in `services/indexer/src/chain.ts`
   (default 2000). RPC providers cap this; rpc.litho.ai handles 5000.
2. **Drop unused token contracts** from `getMakaluLep100Tokens()` —
   each adds a per-block-range scan.
3. **Switch to a websocket subscription** — `eth_subscribe` cuts the
   sync from "poll every 5s" to push-based.
4. **Last resort**: split the indexer into a per-contract sharded
   layout with a shared Redis cursor table. Significant rewrite; only
   pursue at sustained > 50 LEP-100 contracts.

### Signal 4: Postgres connections > 80% of max for 30 min

```sql
SELECT count(*) AS active FROM pg_stat_activity WHERE state='active';
```

Currently sized at `max_connections=100` (Postgres default), pool
size 32 per API service. Knobs:

1. **Raise pool size** in `services/api/src/lib/db.ts` up to 64
   (matches the worker's pool).
2. **Tune Postgres** — `max_connections=200`, `shared_buffers=4GB`,
   `effective_cache_size=12GB` for a 16GB host.
3. **Add PgBouncer** in front of Postgres — connection pooling at the
   network layer; lets each service open hundreds of "connections"
   while PgBouncer multiplexes onto a small pool of real PG sessions.
4. **Read replica** for portfolio/contacts reads — they're 90% of the
   query volume and don't need write consistency.

---

## When to go multi-host

When at least two of the four signals are in the "horizontal-scale"
column simultaneously, this is the migration plan:

1. **DNS**: cut over `thanos.fi` to point at a load balancer (Caddy,
   HAProxy, or a managed L4 ALB). Existing nginx becomes one upstream
   among many.
2. **Postgres**: provision a managed PG instance (DigitalOcean,
   Crunchy, RDS). Switch the API + indexer + worker to its
   connection string. Keep WAL streaming back to a hot-standby per
   `ops/backups/replica/RUNBOOK.md`.
3. **Redis**: same — managed Redis with persistence + automatic
   failover. The Compose Redis becomes a dev-only thing.
4. **Services**: each becomes its own VPS or container in a small
   K8s/Nomad cluster. The Docker Compose YAML splits into per-host
   compose files OR Helm charts.
5. **Observability**: Prometheus federation OR push the metrics to
   Grafana Cloud's free tier (10k series). Loki gets an S3 backend.
6. **Backups**: pgBackRest's S3 sync is already configured in
   `ops/backups/pgbackrest/backup.sh` — set `PGBACKREST_S3_BUCKET`
   and the local-only backups mirror off-site.

Trigger: **two signals red for 24h, OR DAU > 25k.**

## What we are NOT doing

- **Kubernetes today.** The wallet's load doesn't justify the
  operational overhead. Re-evaluate at DAU > 25k.
- **Multi-region.** Cross-region Postgres replication + DNS-flip
  failover is documented in `ops/backups/replica/RUNBOOK.md` but not
  provisioned. Premature for a wallet at this user count.
- **Service mesh.** Same — no value at one-host scale.
- **Autoscaler.** Vertical-scale buttons on the cloud console handle
  capacity changes faster than an HPA can react to a single-VPS load
  spike. When we go multi-host this becomes worth setting up.

## Capacity per VPS tier

Reference values for the operator picking a VPS:

| Tier | vCPU / RAM | DAU comfortable | Cost-ish |
|---|---|---|---|
| 4 / 8 GB | minimum | < 1k | $20-40/mo |
| 4 / 16 GB | current recommended | ≤ 5k | $50-80/mo |
| 8 / 32 GB | ceiling before multi-host | ≤ 25k | $150-200/mo |

Above 25k DAU = multi-host per the plan above.
