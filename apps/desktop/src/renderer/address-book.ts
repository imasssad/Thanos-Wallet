/**
 * Desktop address book — hybrid local-cache + cloud-sync model.
 * Same surface as apps/web/lib/address-book.ts and the extension's;
 * a contact added here syncs to all of them via /contacts.
 */
import { getAddress } from 'ethers';
import { evmToLitho } from '@thanos/sdk-core';
import { apiClient } from './auth-client';
import type { ContactDto } from '@thanos/api-client';
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

function newId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export function loadContacts(): Contact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Contact[]) : [];
  } catch { return []; }
}

function saveContacts(list: Contact[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  try { window.dispatchEvent(new CustomEvent('thanos:contacts-changed')); } catch { /* no-op */ }
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

  const all = loadContacts();
  if (all.some(c => c.evm === evm)) throw new Error('Address already in your contacts');

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
    saveContacts([...all, contact]);
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
  saveContacts([...all, contact]);
  return contact;
}

export async function deleteContact(id: string): Promise<boolean> {
  const all = loadContacts();
  const existing = all.find(c => c.id === id);
  if (!existing) return false;
  if ((await isAuthed()) && !existing.pendingSync) {
    try { await apiClient.deleteContact(id); }
    catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status !== 404) throw e;
    }
  }
  saveContacts(all.filter(c => c.id !== id));
  return true;
}

export async function syncContactsFromServer(): Promise<{ synced: number; pushed: number } | null> {
  if (!(await isAuthed())) return null;
  const local = loadContacts();
  const { items } = await apiClient.listContacts();
  const server = await Promise.all(items.map(contactFromDto));
  const byAddr = new Map(server.map(c => [c.evm.toLowerCase(), c]));

  let pushed = 0;
  for (const l of local) {
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
  saveContacts([...byAddr.values()]);
  return { synced: server.length, pushed };
}

export function findContactByAddress(address: string): Contact | null {
  if (!address) return null;
  const target = address.toLowerCase();
  return loadContacts().find(c => c.evm.toLowerCase() === target) ?? null;
}

export function onContactsChanged(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  window.addEventListener('thanos:contacts-changed', handler);
  const storageHandler = (e: StorageEvent) => { if (e.key === STORAGE_KEY) cb(); };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('thanos:contacts-changed', handler);
    window.removeEventListener('storage', storageHandler);
  };
}
