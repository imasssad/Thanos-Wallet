/**
 * Address-book (contacts) CRUD.
 *
 * Backs the cloud-sync layer behind apps/web/lib/address-book.ts. Today
 * the address book is local-only via localStorage; once a session is
 * authenticated, the wallet writes through these endpoints so the same
 * contacts appear on every device the user signs into.
 *
 * All routes are auth-gated by requireAuth. Scope is per-user: a
 * contact created by user A is never visible to user B. The SQL table
 * lives in services/db/schema.sql (table `contacts`).
 *
 * Endpoints
 *   GET    /contacts                   → list (newest first)
 *   POST   /contacts                   → create
 *   PUT    /contacts/:id               → update (name / notes / favourite)
 *   DELETE /contacts/:id               → delete
 *
 * Conflict policy: (user_id, address) is unique. POST returns 409 when
 * the contact already exists.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

/* ─── Schemas ─────────────────────────────────────────────────────── */

const ADDR_TYPES = ['evm', 'litho', 'bitcoin', 'solana', 'cosmos'] as const;

const CreateSchema = z.object({
  name:        z.string().min(1).max(120),
  address:     z.string().min(8).max(128),
  addressType: z.enum(ADDR_TYPES).optional(),
  chainId:     z.number().int().positive().optional(),
  notes:       z.string().max(2000).optional(),
  isFavourite: z.boolean().optional(),
});

const UpdateSchema = z.object({
  name:        z.string().min(1).max(120).optional(),
  notes:       z.string().max(2000).nullable().optional(),
  isFavourite: z.boolean().optional(),
});

interface ContactRow {
  id:            string;
  user_id:       string;
  name:          string;
  address:       string;
  address_type:  string | null;
  chain_id:      string | null;
  notes:         string | null;
  is_favourite:  boolean;
  created_at:    string;
  updated_at:    string;
}

interface ContactDto {
  id:           string;
  name:         string;
  address:      string;
  addressType:  string | null;
  chainId:      number | null;
  notes:        string | null;
  isFavourite:  boolean;
  createdAt:    string;
  updatedAt:    string;
}

function projectContact(r: ContactRow): ContactDto {
  return {
    id:           r.id,
    name:         r.name,
    address:      r.address,
    addressType:  r.address_type,
    chainId:      r.chain_id ? Number(r.chain_id) : null,
    notes:        r.notes,
    isFavourite:  r.is_favourite,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  };
}

/* ─── GET /contacts ──────────────────────────────────────────────── */

contactsRouter.get('/', async (req, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const rows = await query<ContactRow>(
    `select * from contacts where user_id = $1 order by is_favourite desc, updated_at desc`,
    [userId],
  );
  res.json({ items: rows.map(projectContact) });
});

/* ─── POST /contacts ─────────────────────────────────────────────── */

contactsRouter.post('/', async (req, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const parse = CreateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    return;
  }
  const { name, address, addressType, chainId, notes, isFavourite } = parse.data;

  // Address dedup: 0x is case-insensitive, bech32 is lowercase by spec —
  // store as-given but check via lower().
  const existing = await queryOne<ContactRow>(
    `select * from contacts where user_id = $1 and lower(address) = lower($2)`,
    [userId, address],
  );
  if (existing) {
    res.status(409).json({ error: 'Contact with this address already exists', item: projectContact(existing) });
    return;
  }

  const inserted = await queryOne<ContactRow>(
    `insert into contacts (user_id, name, address, address_type, chain_id, notes, is_favourite)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      userId, name.trim(), address.trim(),
      addressType ?? null,
      chainId ?? null,
      notes?.trim() || null,
      !!isFavourite,
    ],
  );
  if (!inserted) {
    res.status(500).json({ error: 'Insert returned no row' });
    return;
  }
  res.status(201).json({ item: projectContact(inserted) });
});

/* ─── PUT /contacts/:id ─────────────────────────────────────────── */

contactsRouter.put('/:id', async (req, res: Response) => {
  // Cast through unknown — Express types `req` with the parsed-params
  // generic on routes with placeholders, which doesn't overlap directly
  // with AuthRequest (the requireAuth middleware widens the runtime
  // shape but the type system doesn't see it).
  const userId = (req as unknown as AuthRequest).userId;
  const id = req.params.id;
  const parse = UpdateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    return;
  }
  const patch = parse.data;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }
  /* Build the SET clause from only the keys the caller sent so the
     UPDATE leaves untouched columns alone. */
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined)        { values.push(patch.name.trim()); sets.push(`name = $${values.length}`); }
  if (patch.notes !== undefined)       { values.push(patch.notes?.trim() || null); sets.push(`notes = $${values.length}`); }
  if (patch.isFavourite !== undefined) { values.push(patch.isFavourite); sets.push(`is_favourite = $${values.length}`); }
  sets.push(`updated_at = now()`);
  values.push(userId, id);

  const updated = await queryOne<ContactRow>(
    `update contacts set ${sets.join(', ')}
       where user_id = $${values.length - 1} and id = $${values.length}
     returning *`,
    values,
  );
  if (!updated) { res.status(404).json({ error: 'Contact not found' }); return; }
  res.json({ item: projectContact(updated) });
});

/* ─── DELETE /contacts/:id ──────────────────────────────────────── */

contactsRouter.delete('/:id', async (req, res: Response) => {
  const userId = (req as unknown as AuthRequest).userId;
  const id = req.params.id;
  const rows = await query<{ id: string }>(
    `delete from contacts where user_id = $1 and id = $2 returning id`,
    [userId, id],
  );
  if (rows.length === 0) { res.status(404).json({ error: 'Contact not found' }); return; }
  res.status(204).end();
});
