/**
 * Multi-device WalletConnect session sync.
 *
 * Per-user cache of "which dApps am I paired with right now". Lets the
 * mobile app's Permissions panel show the dApp the user paired on the
 * desktop, and the desktop reflect the mobile's connections — without
 * any cross-device WC relay handshake.
 *
 * The actual encrypted WC session material lives on Reown's relay; we
 * never store keys. Only the topic + dApp metadata + chain coverage are
 * cached here.
 *
 * Routes (all auth-gated):
 *   GET    /wc/sessions          → list { items: WcSessionDto[] }
 *   POST   /wc/sessions          → upsert one session
 *   POST   /wc/sessions/touch    → bulk last_seen_at refresh
 *   DELETE /wc/sessions/:topic   → drop one session
 *
 * Storage: services/db/schema.sql already declares wc_sessions with
 *   topic UNIQUE, peer_{name,url,icon}, chain_ids BIGINT[], methods
 *   TEXT[], accounts TEXT[], is_active, expires_at, created_at,
 *   updated_at. We map the route's flatter DTO onto those columns.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const wcSessionsRouter = Router();
wcSessionsRouter.use(requireAuth);

const UpsertSchema = z.object({
  topic:         z.string().min(8).max(128),
  name:          z.string().min(1).max(160),
  url:           z.string().url().optional(),
  icon:          z.string().max(512).optional(),
  /** CSV of CAIP chain ids ("eip155:700777,eip155:1"). Stored as
   *  numeric chain ids in the DB's BIGINT[] column. */
  chains:        z.string().max(512).optional(),
  methods:       z.array(z.string()).optional(),
  accounts:      z.array(z.string()).optional(),
  expiresAt:     z.number().int().nonnegative().optional(),   // unix seconds
});

interface WcSessionRow {
  topic:        string;
  peer_name:    string | null;
  peer_url:     string | null;
  peer_icon:    string | null;
  chain_ids:    string[] | number[];      // pg returns text[] for BIGINT[]
  methods:      string[];
  accounts:     string[];
  is_active:    boolean;
  expires_at:   string | null;
  created_at:   string;
  updated_at:   string;
}

function projectRow(r: WcSessionRow) {
  return {
    topic:        r.topic,
    name:         r.peer_name ?? '',
    url:          r.peer_url,
    icon:         r.peer_icon,
    chains:       (r.chain_ids ?? []).map(String).map(id => `eip155:${id}`).join(','),
    methods:      r.methods ?? [],
    accounts:     r.accounts ?? [],
    isActive:     r.is_active,
    expiresAt:    r.expires_at ? new Date(r.expires_at).getTime() : null,
    pairedAt:     r.created_at,
    lastSeenAt:   r.updated_at,
  };
}

/** Decode a CSV of CAIP chain ids ("eip155:700777,eip155:1") into the
 *  numeric BIGINT[] the DB column expects. Non-CAIP entries are
 *  silently dropped. */
function chainsToIds(csv?: string): string[] {
  if (!csv) return [];
  const out: string[] = [];
  for (const part of csv.split(',')) {
    const m = part.trim().match(/^eip155:(\d+)$/);
    if (m) out.push(m[1]);
  }
  return out;
}

wcSessionsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const rows = await query<WcSessionRow>(
    `SELECT topic, peer_name, peer_url, peer_icon, chain_ids, methods, accounts,
            is_active, expires_at, created_at, updated_at
       FROM wc_sessions
      WHERE user_id = $1 AND is_active = true
      ORDER BY created_at DESC`,
    [req.userId],
  );
  res.json({ items: rows.map(projectRow) });
});

wcSessionsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = UpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
    return;
  }
  const v = parsed.data;
  const expiresAt = v.expiresAt ? new Date(v.expiresAt * 1000).toISOString() : null;
  await query(
    `INSERT INTO wc_sessions
        (user_id, topic, peer_name, peer_url, peer_icon, chain_ids, methods, accounts,
         is_active, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::bigint[], $7::text[], $8::text[], true, $9)
     ON CONFLICT (topic) DO UPDATE
        SET peer_name  = EXCLUDED.peer_name,
            peer_url   = EXCLUDED.peer_url,
            peer_icon  = EXCLUDED.peer_icon,
            chain_ids  = EXCLUDED.chain_ids,
            methods    = EXCLUDED.methods,
            accounts   = EXCLUDED.accounts,
            is_active  = true,
            expires_at = EXCLUDED.expires_at,
            updated_at = now()
        WHERE wc_sessions.user_id = $1`,
    [
      req.userId, v.topic, v.name, v.url ?? null, v.icon ?? null,
      chainsToIds(v.chains), v.methods ?? [], v.accounts ?? [],
      expiresAt,
    ],
  );
  res.json({ ok: true });
});

const TouchSchema = z.object({ topics: z.array(z.string().min(1)).min(1).max(64) });
wcSessionsRouter.post('/touch', async (req: AuthRequest, res: Response) => {
  const parsed = TouchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  await query(
    `UPDATE wc_sessions SET updated_at = now()
      WHERE user_id = $1 AND topic = ANY($2::text[])`,
    [req.userId, parsed.data.topics],
  );
  res.json({ ok: true });
});

wcSessionsRouter.delete('/:topic', async (req: AuthRequest, res: Response) => {
  const topic = req.params.topic;
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > 128) {
    res.status(400).json({ error: 'bad_topic' });
    return;
  }
  // Mark inactive rather than hard-delete — preserves audit trail.
  await query(
    `UPDATE wc_sessions SET is_active = false, updated_at = now()
      WHERE user_id = $1 AND topic = $2`,
    [req.userId, topic],
  );
  res.json({ ok: true });
});
