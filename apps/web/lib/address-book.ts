/**
 * Address book — saved contacts.
 *
 * Local-only by design today: contacts are stored in localStorage. When
 * the cloud-sync slice lands the API will write through the same shape,
 * with `synced` flipping to true once the server confirms.
 *
 * Storage key: thanos.address_book (JSON array)
 *
 * Address fields are stored in canonical form:
 *   - EVM:  EIP-55 checksum  (getAddress)
 *   - bech32: lowercase litho1…
 * That keeps the dedup / lookup paths simple.
 */
import { getAddress } from 'ethers';
import { resolveToEvm, evmToLitho } from './address';

const STORAGE_KEY = 'thanos.address_book';

export interface Contact {
  /** Stable opaque id (uuid-ish, generated client-side for now). */
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
}

function newId(): string {
  // Crypto-strong random id; uuid would work but adds 4 KB. 16 bytes hex is plenty.
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
}

/** Add a new contact. Throws if the address is malformed or already saved. */
export function addContact(input: { name: string; address: string; note?: string }): Contact {
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error('Name required');

  const evm = resolveToEvm(input.address.trim());
  if (!evm) throw new Error('Address must be a valid 0x or litho1');
  const checksummed = getAddress(evm);

  const all = loadContacts();
  if (all.some(c => c.evm === checksummed)) {
    throw new Error('Address already in your contacts');
  }
  const contact: Contact = {
    id:        newId(),
    name:      trimmedName,
    evm:       checksummed,
    litho:     evmToLitho(checksummed) || undefined,
    note:      input.note?.trim() || undefined,
    updatedAt: Date.now(),
  };
  saveContacts([...all, contact]);
  return contact;
}

export function updateContact(id: string, patch: Partial<Pick<Contact, 'name' | 'note'>>): Contact | null {
  const all = loadContacts();
  const idx = all.findIndex(c => c.id === id);
  if (idx === -1) return null;
  const updated: Contact = {
    ...all[idx],
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.note !== undefined ? { note: patch.note.trim() || undefined } : {}),
    updatedAt: Date.now(),
  };
  const next = [...all.slice(0, idx), updated, ...all.slice(idx + 1)];
  saveContacts(next);
  return updated;
}

export function deleteContact(id: string): boolean {
  const all = loadContacts();
  const next = all.filter(c => c.id !== id);
  if (next.length === all.length) return false;
  saveContacts(next);
  return true;
}

/** Look up a contact by EVM address (case-insensitive). Useful for the
 *  "you sent to: <name>" label on the transaction confirmation screen. */
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
