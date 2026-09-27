/**
 * Quantt challenge guard — mobile twin of
 * packages/sdk-core/src/quantt/challenge.ts (see that file for the full
 * rationale). Detached copy for the same reason as lib/quantt.ts: EAS builds
 * can't resolve the workspace @thanos/sdk-core dep. Keep the two identical
 * below this header — packages/sdk-core/src/__tests__/quantt-challenge.test.ts
 * runs its whole suite against both.
 *
 * Before the wallet signs a Quantt sign-in or withdrawal-binding challenge:
 * domain.name must be "Quantts.ai", no struct may be an approval / order type,
 * the login primary type must be SignIn, and every address in the message
 * must be this wallet's own. Otherwise QuanttChallengeError, before signing.
 */
import type { Eip712TypedData } from './quantt';

export type QuanttChallengeKind = 'sign-in' | 'withdrawal-address';

export class QuanttChallengeError extends Error {
  constructor(message: string) {
    super(`Refusing to sign the Quantt challenge: ${message}`);
    this.name = 'QuanttChallengeError';
  }
}

/** EIP-712 domain name Quantt signs its challenges under. */
export const QUANTT_TYPED_DOMAIN_NAME = 'Quantts.ai';

/* Struct names used by token approvals, marketplace orders and meta-tx
   relays (EIP-2612, DAI, Permit2, Seaport, EIP-3009, ERC-2771, Safe, 4337).
   Compared case-insensitively against EVERY type in the payload, not just the
   primary one, so a nested PermitDetails is caught too. */
const DENIED_TYPES = new Set([
  'permit', 'permitsingle', 'permitbatch', 'permitdetails', 'tokenpermissions',
  'permittransferfrom', 'permitbatchtransferfrom', 'permitwitnesstransferfrom',
  'permitbatchwitnesstransferfrom', 'ordercomponents', 'order', 'bulkorder',
  'offeritem', 'considerationitem', 'transferwithauthorization',
  'receivewithauthorization', 'cancelauthorization', 'forwardrequest',
  'metatransaction', 'safetx', 'useroperation', 'packeduseroperation',
  'delegation', 'approval',
]);

const MAX_TYPES = 16;
const MAX_FIELDS = 32;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

type Field = { name: string; type: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Throws QuanttChallengeError unless `typed` is a plausible Quantt challenge
 *  of `kind` for `address`. Returns the same object for chaining. */
export function assertQuanttChallenge(
  typed: unknown,
  expect: { kind: QuanttChallengeKind; address: string },
): Eip712TypedData {
  if (!ADDRESS_RE.test(expect.address)) throw new QuanttChallengeError('invalid wallet address');
  const me = expect.address.toLowerCase();

  if (!isRecord(typed)) throw new QuanttChallengeError('not an object');
  const { domain, types, primaryType, message } = typed;
  if (!isRecord(domain) || !isRecord(types) || typeof primaryType !== 'string' || !isRecord(message)) {
    throw new QuanttChallengeError('missing domain / types / primaryType / message');
  }

  const name = typeof domain.name === 'string' ? domain.name.trim() : '';
  if (name.toLowerCase() !== QUANTT_TYPED_DOMAIN_NAME.toLowerCase()) {
    throw new QuanttChallengeError(`domain name is "${name}", expected "${QUANTT_TYPED_DOMAIN_NAME}"`);
  }
  if (domain.chainId != null && !Number.isSafeInteger(Number(domain.chainId))) {
    throw new QuanttChallengeError('domain chainId is not an integer');
  }
  if (domain.verifyingContract != null
      && (typeof domain.verifyingContract !== 'string' || !ADDRESS_RE.test(domain.verifyingContract))) {
    throw new QuanttChallengeError('domain verifyingContract is not an address');
  }

  const typeNames = Object.keys(types);
  if (typeNames.length === 0 || typeNames.length > MAX_TYPES) throw new QuanttChallengeError('unexpected number of types');
  for (const t of typeNames) {
    const fields = types[t];
    if (!Array.isArray(fields) || fields.length > MAX_FIELDS
        || !fields.every((f) => isRecord(f) && typeof f.name === 'string' && typeof f.type === 'string')) {
      throw new QuanttChallengeError(`malformed type "${t}"`);
    }
    if (DENIED_TYPES.has(t.toLowerCase())) throw new QuanttChallengeError(`contains a "${t}" struct (approval / order type)`);
  }
  if (!Array.isArray(types[primaryType]) || primaryType === 'EIP712Domain') {
    throw new QuanttChallengeError(`primary type "${primaryType}" is not defined`);
  }
  if (expect.kind === 'sign-in' && primaryType !== 'SignIn') {
    throw new QuanttChallengeError(`primary type is "${primaryType}", expected "SignIn"`);
  }

  // Every address in the signed message must be this wallet's own.
  const structs = types as Record<string, Field[]>;
  const visit = (type: string, value: unknown, path: string, depth: number): void => {
    if (depth > 8) throw new QuanttChallengeError('nesting too deep');
    const arr = /^(.+)\[\d*\]$/.exec(type);
    if (arr) {
      if (!Array.isArray(value)) throw new QuanttChallengeError(`${path} should be an array`);
      value.forEach((v, i) => visit(arr[1], v, `${path}[${i}]`, depth + 1));
      return;
    }
    if (type === 'address') {
      if (typeof value !== 'string' || value.toLowerCase() !== me) {
        throw new QuanttChallengeError(`${path} is an address other than this wallet's`);
      }
      return;
    }
    const struct = structs[type];
    if (struct) {
      if (!isRecord(value)) throw new QuanttChallengeError(`${path} should be a struct`);
      for (const f of struct) visit(f.type, value[f.name], `${path}.${f.name}`, depth + 1);
    }
  };
  visit(primaryType, message, primaryType, 0);

  return typed as unknown as Eip712TypedData;
}
