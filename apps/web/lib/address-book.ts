/**
 * Address book — saved contacts.
 *
 * Hybrid storage model:
 *   - When the user is **authenticated**, the API at `/contacts` is the
 *     source of truth. The wallet writes through to the server on every
 *     CRUD; the local cache mirrors the server for fast synchronous
 *     reads (the Send-modal autocomplete + "you sent to: <name>" labels
 *     need zero-latency lookups).
 *   - When the user is **not authenticated**, the wallet falls back to
 *     localStorage-only. Same shape, same callers — sync just doesn't
 *     happen. Once they sign in, `syncContactsFromServer()` pulls the
 *     server set and pushes up any local-only entries.
 *
 * Storage key (cache): thanos.address_book   (JSON array of Contact)
 *
 * Address fields are stored canonically:
 *   - EVM:    EIP-55 checksum (getAddress)
 *   - bech32: lowercase litho1…
 * That keeps dedup + lookup simple. The server enforces uniqueness on
 * (user_id, lower(address)), so race-y double-adds return 409.
 */
import { getAddress } from 'ethers';
import { resolveToEvm, evmToLitho } from './address';
import { apiClient } from './auth-client';
import type { ContactDto } from '@thanos/api-client';

const STORAGE_KEY = 'thanos.address_book';

export interface Contact {
  /** Stable opaque id. Server contacts use the server-issued UUID; offline-
   *  only contacts use a client-generated 16-byte hex (gets replaced when
   *  the contact syncs up). */
  id:          string;
  /** Display name — user-visible. */
  name:        string;
  /** Canonical EVM address (checksummed). Authoritative for lookup/dedup. */
  evm:         string;
  /** litho1 form for display (derived from evm but cached for speed). */
  litho?:      string;
  /** Optional free-form note. */
  note?:       string;
  /** Timestamp of last edit, ms since epoch. */
  updatedAt:   number;
  /** When true, this contact only exists in the local cache and hasn't
   *  been pushed to the server yet — happens for entries created offline
   *  or before sign-in. Cleared once the server confirms the insert. */
  pendingSync?: boolean;
}

/* ─── Local cache primitives ────────────────────────────────────────── */

function newId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export function loadContacts(): Contact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Contact[];
  } catch {
    return [];
  }
}

function saveContacts(list: Contact[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  // Notify subscribers (Address-book UI, send-modal autocomplete).
  try { window.dispatchEvent(new CustomEvent('thanos:contacts-changed')); } catch { /* no-op */ }
}

/* ─── DTO ↔ Contact mapping ─────────────────────────────────────────── */

function contactFromDto(d: ContactDto): Contact {
  // The server stores the address verbatim — we re-canonicalise for
  // dedup so the local cache keys are consistent across devices.
  let evm = d.address;
  try { evm = getAddress(resolveToEvm(d.address) || d.address); } catch { /* leave as-is */ }
  return {
    id:        d.id,
    name:      d.name,
    evm,
    litho:     evmToLitho(evm) || undefined,
    note:      d.notes || undefined,
    updatedAt: new Date(d.updatedAt).getTime(),
  };
}

/* ─── Auth-aware helpers ───────────────────────────────────────────── */

/** True when the apiClient has a stored access token. Doesn't validate
 *  it — a stale token will still cause downstream 401s, which the CRUD
 *  helpers handle by reverting to local-only behaviour. */
async function isAuthed(): Promise<boolean> {
  try {
    return await apiClient.isAuthenticated();
  } catch {
    return false;
  }
}

/* ─── CRUD ─────────────────────────────────────────────────────────── */

/** Add a contact. Writes through to the API when authenticated; falls back
 *  to localStorage-only otherwise (with `pendingSync: true` so the next
 *  sync uploads it). */
export async function addContact(input: { name: string; address: string; note?: string }): Promise<Contact> {
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error('Name required');

  const evm = resolveToEvm(input.address.trim());
  if (!evm) throw new Error('Address must be a valid 0x or litho1');
  const checksummed = getAddress(evm);

  const all = loadContacts();
  if (all.some(c => c.evm === checksummed)) {
    throw new Error('Address already in your contacts');
  }

  if (await isAuthed()) {
    const { item } = await apiClient.createContact({
      name:        trimmedName,
      address:     checksummed,
      addressType: 'evm',
      notes:       input.note?.trim() || undefined,
    });
    const contact = contactFromDto(item);
    saveContacts([...all, contact]);
    return contact;
  }

  const contact: Contact = {
    id:          newId(),
    name:        trimmedName,
    evm:         checksummed,
    litho:       evmToLitho(checksummed) || undefined,
    note:        input.note?.trim() || undefined,
    updatedAt:   Date.now(),
    pendingSync: true,
  };
  saveContacts([...all, contact]);
  return contact;
}

export async function updateContact(
  id:    string,
  patch: Partial<Pick<Contact, 'name' | 'note'>>,
): Promise<Contact | null> {
  const all = loadContacts();
  const idx = all.findIndex(c => c.id === id);
  if (idx === -1) return null;

  const authed = await isAuthed();
  if (authed && !all[idx].pendingSync) {
    const { item } = await apiClient.updateContact(id, {
      name:  patch.name?.trim(),
      notes: patch.note === undefined ? undefined : (patch.note?.trim() || null),
    });
    const updated = contactFromDto(item);
    const next = [...all.slice(0, idx), updated, ...all.slice(idx + 1)];
    saveContacts(next);
    return updated;
  }

  const updated: Contact = {
    ...all[idx],
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.note !== undefined ? { note: patch.note.trim() || undefined } : {}),
    updatedAt: Date.now(),
    ...(authed ? {} : { pendingSync: true }),
  };
  const next = [...all.slice(0, idx), updated, ...all.slice(idx + 1)];
  saveContacts(next);
  return updated;
}

export async function deleteContact(id: string): Promise<boolean> {
  const all = loadContacts();
  const existing = all.find(c => c.id === id);
  if (!existing) return false;

  if ((await isAuthed()) && !existing.pendingSync) {
    try { await apiClient.deleteContact(id); }
    catch (e) {
      // 404 means it was already gone server-side — fine, drop locally.
      const status = (e as { status?: number } | null)?.status;
      if (status !== 404) throw e;
    }
  }
  const next = all.filter(c => c.id !== id);
  saveContacts(next);
  return true;
}

/* ─── Background sync ──────────────────────────────────────────────── */

/**
 * Pulls the server's contact set and merges into the local cache.
 * Conflict policy:
 *   - Items present on both: server wins (server's `updatedAt` is
 *     newer-or-equal because writes go through the server).
 *   - Server-only: added to local cache.
 *   - Local-only with `pendingSync: true`: POSTed to the server and
 *     replaced with the server-issued row.
 *   - Local-only without `pendingSync`: stale, dropped.
 *
 * Idempotent; safe to call any number of times. No-op when not authed.
 */
export async function syncContactsFromServer(): Promise<{ synced: number; pushed: number } | null> {
  if (!(await isAuthed())) return null;

  const local = loadContacts();
  const { items } = await apiClient.listContacts();
  const serverContacts = items.map(contactFromDto);
  const serverByAddr = new Map(serverContacts.map(c => [c.evm.toLowerCase(), c]));

  // Push pending-sync local items.
  let pushed = 0;
  for (const l of local) {
    if (!l.pendingSync) continue;
    if (serverByAddr.has(l.evm.toLowerCase())) continue; // server already has it
    try {
      const { item } = await apiClient.createContact({
        name:        l.name,
        address:     l.evm,
        addressType: 'evm',
        notes:       l.note,
      });
      serverByAddr.set(l.evm.toLowerCase(), contactFromDto(item));
      pushed++;
    } catch {
      // Leave the pending-sync flag; next call will retry.
    }
  }

  // Server set is now authoritative. Drop locals that weren't synced.
  const merged = [...serverByAddr.values()];
  saveContacts(merged);
  return { synced: serverContacts.length, pushed };
}

/* ─── Read-only queries (sync; read from local cache) ──────────────── */

/** Look up a contact by EVM address (case-insensitive). */
export function findContactByAddress(address: string): Contact | null {
  if (!address) return null;
  const target = address.toLowerCase();
  return loadContacts().find(c => c.evm.toLowerCase() === target) ?? null;
}

/** Substring search over name + addresses — for the Send-recipient autocomplete. */
export function searchContacts(q: string): Contact[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return loadContacts().filter(c =>
    c.name.toLowerCase().includes(query)
    || c.evm.toLowerCase().includes(query)
    || c.litho?.toLowerCase().includes(query),
  );
}

/** Subscribe to cache changes (storage-event + custom dispatchEvent).
 *  Returns an unsubscribe function. The address-book UI uses this to
 *  re-render after a background sync, the send-modal autocomplete uses
 *  it to refresh suggestions. */
export function onContactsChanged(cb: () => void): () => void {
  const handler = () => cb();
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('thanos:contacts-changed', handler);
  // Also catch updates from other tabs.
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('thanos:contacts-changed', handler);
    window.removeEventListener('storage', storageHandler);
  };
}
