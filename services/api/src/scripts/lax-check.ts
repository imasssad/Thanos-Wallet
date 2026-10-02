/**
 * LAX / Zypto readiness check, run where the API's env lives:
 *
 *   docker compose -f docker-compose.prod.yml exec api node dist/scripts/lax-check.js
 *   … lax-check.js --base https://merchant.fcfpay.com   # try another API host
 *
 * Read-only: calls get-products and available_currencies with the merchant
 * key from the environment. Never creates orders and never prints the key.
 * Exit code 0 only when card ordering can work as configured.
 */
/* eslint-disable no-console */

const argAt = process.argv.indexOf('--base');
const base = (argAt > -1 ? process.argv[argAt + 1] ?? '' : process.env.LAX_API_BASE ?? '').replace(/\/+$/, '');
const key = process.env.LAX_API_KEY ?? '';
const iframeId = process.env.LAX_IFRAME_ID ?? '';
const productId = process.env.LAX_PRODUCT_ID ?? '';

const mark = (ok: boolean | null) => (ok === null ? '·' : ok ? '✓' : '✗');
const say = (ok: boolean | null, label: string, note = '') => console.log(`${mark(ok)} ${label}${note ? ` — ${note}` : ''}`);

async function get(path: string): Promise<{ status: number; json: unknown; text: string } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(base + path, {
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
      if (typeof json === 'string') { try { json = JSON.parse(json); } catch { /* plain string */ } }
    } catch { /* not JSON */ }
    return { status: res.status, json, text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function rows(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const k of ['data', 'products', 'items', 'result', 'message', 'currencies']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
      const inner = o[k];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        const nested = rows(inner);
        if (nested) return nested;
      }
    }
  }
  return null;
}

const field = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return String(o[k]);
  return undefined;
};

function explainHttp(status: number): string {
  if (status === 401 || status === 403) return 'Zypto rejected the request: wrong/expired LAX_API_KEY for this host, or the merchant account is not enabled for this endpoint';
  if (status === 404) return 'this host does not serve the endpoint; check LAX_API_BASE or retry with --base';
  if (status >= 500) return 'Zypto server error; retry later and report it to Zypto';
  return `HTTP ${status}`;
}

async function main(): Promise<number> {
  console.log('LAX / Zypto readiness check\n');
  let host = '';
  try { host = new URL(base).host; } catch { /* reported below */ }
  say(Boolean(key), 'LAX_API_KEY', key ? 'set' : 'missing');
  say(Boolean(host) && base.startsWith('https://'), 'LAX_API_BASE', host ? `${host}${base.startsWith('https://') ? '' : ' (must be https)'}` : 'missing or invalid');
  say(/^\d+$/.test(iframeId), 'LAX_IFRAME_ID', iframeId || 'missing');
  say(Boolean(productId), 'LAX_PRODUCT_ID', productId || 'missing — card ordering stays off in the apps');
  say(Boolean(process.env.LAX_WEBHOOK_SECRET), 'LAX_WEBHOOK_SECRET', process.env.LAX_WEBHOOK_SECRET ? 'set' : 'missing — paid cards will not link to users automatically');
  if (!key || !host) { console.log('\nSet LAX_API_KEY and LAX_API_BASE in the .env first.'); return 1; }

  console.log(`\nGET ${host}/api/cards/get-products`);
  const products = await get('/api/cards/get-products');
  let productOk = false;
  if ('error' in products) {
    say(false, 'unreachable', products.error);
  } else if (products.status < 200 || products.status >= 300 || (products.json as { success?: unknown })?.success === false) {
    say(false, `HTTP ${products.status}`, explainHttp(products.status));
    console.log(`  body: ${products.text.slice(0, 500)}`);
  } else {
    const list = rows(products.json) ?? [];
    say(list.length > 0, `${list.length} product(s)`);
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Record<string, unknown>;
      const id = field(o, ['product_id', 'productId', 'id']);
      const name = field(o, ['name', 'title', 'product_name']);
      const net = field(o, ['network', 'card_network', 'brand', 'card_type', 'type']);
      const here = id !== undefined && id === productId;
      if (here) productOk = true;
      console.log(`  ${here ? '→' : ' '} product_id=${id ?? '?'}${name ? `  ${name}` : ''}${net ? `  (${net})` : ''}`);
    }
    if (list.length === 0) {
      console.log(`  body: ${products.text.slice(0, 500)}`);
      console.log('\n✗ Zypto returned no products for this merchant. The LAX card product has to be attached on Zypto\'s side');
      console.log(`  (widget ${iframeId || '?'}); nothing in Thanos can work around it.`);
    } else if (!productOk) {
      console.log(`\n✗ LAX_PRODUCT_ID${productId ? ` (${productId})` : ''} is not in this list. Set it to the LAX card's product_id`);
      console.log('  in the .env, then restart the api container.');
    }
  }

  console.log(`\nGET ${host}/api/general/available_currencies`);
  const cur = await get('/api/general/available_currencies');
  if ('error' in cur) say(false, 'unreachable', cur.error);
  else if (cur.status < 200 || cur.status >= 300) say(false, `HTTP ${cur.status}`, explainHttp(cur.status));
  else say(true, `${(rows(cur.json) ?? []).length} currency entr${(rows(cur.json) ?? []).length === 1 ? 'y' : 'ies'}`);

  console.log(productOk && /^\d+$/.test(iframeId)
    ? '\n✓ Card ordering is configured. If orders still fail, the reason is in the api logs ("[lax] upstream call failed").'
    : '\n✗ Card ordering will not work yet — see the ✗ lines above.');
  return productOk && /^\d+$/.test(iframeId) ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
