/**
 * Mobile address book — same hybrid local-cache + cloud-sync model
 * as apps/web/lib/address-book.ts. Backed by AsyncStorage; an in-memory
 * cache hydrated on app start lets `loadContacts()` / `findContactByAddress()`
 * stay synchronous for screens that render at first paint.
 *
 * Contact `name` + `notes` are encrypted client-side via contact-crypto.ts
 * before they ever leave the device. The address stays plaintext (server
 * dedup on lower(address); addresses are public on-chain anyway).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAddress } from 'ethers';
import { evmToLitho } from './address';
import { apiClient } from './auth-client';
import type { ContactDto } from './api-client';
import { encryptField, decryptField } from './contact-crypto';

const STORAGE_KEY = 'thanos.address_book';

export interface Contact {
  id:          string;
  name:        string;
  evm:         string;
  litho?:      string;
  note?:       string;
  updatedAt:   number;
  pendingSync?: boolean;
}

/* In-memory cache hydrated from AsyncStorage on app start. */
let _cache: Contact[] = [];
let _hydrated = false;
type Listener = () => void;
const _listeners: Set<Listener> = new Set();

function notify() { for (const l of _listeners) { try { l(); } catch { /* no-op */ } } }

function newId(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/** Hydrate the in-memory cache from AsyncStorage. Call once at app start. */
export async function loadContactsFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    _cache = raw ? (JSON.parse(raw) as Contact[]) : [];
  } catch { _cache = []; }
  _hydrated = true;
  notify();
}

export function loadContacts(): Contact[] { return _cache.slice(); }
export function isContactsHydrated(): boolean { return _hydrated; }

function persist(list: Contact[]) {
  _cache = list;
  // Fire-and-forget write back to disk; reads stay sync against the cache.
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)).catch(() => { /* retry next change */ });
  notify();
}

async function contactFromDto(d: ContactDto): Promise<Contact> {
  let evm = d.address;
  try { evm = getAddress(d.address); } catch { /* non-EVM — keep raw */ }
  const [name, note] = await Promise.all([decryptField(d.name), decryptField(d.notes)]);
  return {
    id:        d.id,
    name:      name ?? d.name,
    evm,
    litho:     evmToLitho(evm) || undefined,
    note:      note ?? undefined,
    updatedAt: new Date(d.updatedAt).getTime(),
  };
}

async function isAuthed(): Promise<boolean> {
  try { return await apiClient.isAuthenticated(); }
  catch { return false; }
}

export async function addContact(input: { name: string; address: string; note?: string }): Promise<Contact> {
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error('Name required');

  let evm = input.address.trim();
  try { evm = getAddress(evm); } catch { /* not EVM — accept raw */ }

  if (_cache.some(c => c.evm === evm)) throw new Error('Address already in your contacts');

  if (await isAuthed()) {
    const [encName, encNote] = await Promise.all([
      encryptField(trimmedName),
      encryptField(input.note?.trim() || undefined),
    ]);
    const { item } = await apiClient.createContact({
      name:        encName ?? trimmedName,
      address:     evm,
      addressType: 'evm',
      notes:       encNote ?? (input.note?.trim() || undefined),
    });
    const contact = await contactFromDto(item);
    persist([..._cache, contact]);
    return contact;
  }

  const contact: Contact = {
    id:          newId(),
    name:        trimmedName,
    evm,
    litho:       evmToLitho(evm) || undefined,
    note:        input.note?.trim() || undefined,
    updatedAt:   Date.now(),
    pendingSync: true,
  };
  persist([..._cache, contact]);
  return contact;
}

export async function deleteContact(id: string): Promise<boolean> {
  const existing = _cache.find(c => c.id === id);
  if (!existing) return false;
  if ((await isAuthed()) && !existing.pendingSync) {
    try { await apiClient.deleteContact(id); }
    catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status !== 404) throw e;
    }
  }
  persist(_cache.filter(c => c.id !== id));
  return true;
}

export async function syncContactsFromServer(): Promise<{ synced: number; pushed: number } | null> {
  if (!(await isAuthed())) return null;
  const { items } = await apiClient.listContacts();
  const server = await Promise.all(items.map(contactFromDto));
  const byAddr = new Map(server.map(c => [c.evm.toLowerCase(), c]));

  let pushed = 0;
  for (const l of _cache) {
    if (!l.pendingSync) continue;
    if (byAddr.has(l.evm.toLowerCase())) continue;
    try {
      const [encName, encNote] = await Promise.all([encryptField(l.name), encryptField(l.note)]);
      const { item } = await apiClient.createContact({
        name:        encName ?? l.name,
        address:     l.evm,
        addressType: 'evm',
        notes:       encNote ?? l.note,
      });
      byAddr.set(l.evm.toLowerCase(), await contactFromDto(item));
      pushed++;
    } catch { /* retry next time */ }
  }
  persist([...byAddr.values()]);
  return { synced: server.length, pushed };
}

export function findContactByAddress(address: string): Contact | null {
  if (!address) return null;
  const target = address.toLowerCase();
  return _cache.find(c => c.evm.toLowerCase() === target) ?? null;
}

export function onContactsChanged(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}
