/**
 * WalletSource — the secret material a wallet is built from.
 *
 * Two shapes:
 *   - mnemonic   : a BIP39 phrase (HD wallet, can derive many accounts)
 *   - privateKey : a single 0x-prefixed 32-byte hex key (single account)
 *
 * Serialised to JSON before being handed to the vault encrypt path. The
 * deserializer is permissive: a legacy vault whose plaintext is just the
 * bare mnemonic string (the format we shipped first) is recognised and
 * treated as `{ kind: 'mnemonic' }`.
 */

export type WalletSource =
  | { kind: 'mnemonic';  mnemonic:   string }
  | { kind: 'privateKey'; privateKey: string };

/** Serialise for storage in the vault. */
export function serializeSource(s: WalletSource): string {
  return JSON.stringify(s);
}

/** Parse the plaintext we got back from the vault.
 *  Falls back to treating the input as a bare mnemonic for back-compat. */
export function deserializeSource(plaintext: string): WalletSource {
  try {
    const p = JSON.parse(plaintext) as Partial<WalletSource>;
    if (p && (p as { kind?: string }).kind === 'mnemonic'
        && typeof (p as { mnemonic?: string }).mnemonic === 'string') {
      return p as WalletSource;
    }
    if (p && (p as { kind?: string }).kind === 'privateKey'
        && typeof (p as { privateKey?: string }).privateKey === 'string') {
      return p as WalletSource;
    }
  } catch {
    /* fall through to legacy treatment */
  }
  return { kind: 'mnemonic', mnemonic: plaintext };
}
