/**
 * LAX / Zypto readiness check, run where the API's env lives:
 *
 *   docker compose -f docker-compose.prod.yml exec api node dist/scripts/lax-check.js
 *   … lax-check.js --base https://dashboard.lax.money   # try another API host
 *   … lax-check.js --order you@example.com [--amount 25] [--iframe 13294]
 *
 * By default read-only: calls get-products and available_currencies with the
 * merchant key from the environment. --order additionally places ONE
 * create-card-order-api order exactly as the apps do (iframe, product,
 * product currency — USD — and the given email) and prints Zypto's full reply
 * to share with them. That order is an unpaid checkout link: nothing is
 * charged unless someone opens it and pays. Never prints the key.
 * Exit code 0 only when card ordering can work as configured.
 */
/* eslint-disable no-console */

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] ?? '' : undefined;
};
const base = (arg('--base') ?? process.env.LAX_API_BASE ?? '').replace(/\/+$/, '');
const key = process.env.LAX_API_KEY ?? '';
const iframeId = arg('--iframe') ?? process.env.LAX_IFRAME_ID ?? '';
const productId = process.env.LAX_PRODUCT_ID ?? '';
// The product's own currency — what create-card-order-api takes (Zypto, 2026-10-08).
const productCurrency = ((process.env.LAX_PRODUCT_CURRENCY ?? '').trim().toUpperCase().match(/^[A-Z]{3}$/)?.[0]) ?? 'USD';
const orderEmail = arg('--order');
const orderAmount = Number(arg('--amount') ?? '25');

const mark = (ok: boolean | null) => (ok === null ? '·' : ok ? '✓' : '✗');
const say = (ok: boolean | null, label: string, note = '') => console.log(`${mark(ok)} ${label}${note ? ` — ${note}` : ''}`);

async function get(path: string, body?: unknown): Promise<{ status: number; json: unknown; text: string } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  say(null, 'LAX_PRODUCT_CURRENCY', `${productCurrency} (sent as the order currency)`);
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
      const cur = field(o, ['currency', 'product_currency', 'currency_code']);
      const here = id !== undefined && id === productId;
      if (here) productOk = true;
      console.log(`  ${here ? '→' : ' '} product_id=${id ?? '?'}${name ? `  ${name}` : ''}${net ? `  (${net})` : ''}${cur ? `  ${cur}` : ''}`);
      if (here && cur && cur.toUpperCase() !== productCurrency) {
        console.log(`    ✗ this product is in ${cur.toUpperCase()} — set LAX_PRODUCT_CURRENCY=${cur.toUpperCase()}`);
      }
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

  if (orderEmail !== undefined) return placeOrder();

  console.log(productOk && /^\d+$/.test(iframeId)
    ? '\n✓ Card ordering is configured. If orders still fail, the reason is in the api logs ("[lax] upstream call failed").'
    : '\n✗ Card ordering will not work yet — see the ✗ lines above.');
  return productOk && /^\d+$/.test(iframeId) ? 0 : 1;
}

/** --order: one create-card-order-api call, the same body the API sends. */
async function placeOrder(): Promise<number> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(orderEmail ?? '')) { console.log('\n--order needs an email address.'); return 1; }
  if (!Number.isFinite(orderAmount) || orderAmount < 20) { console.log('\n--amount must be at least 20.'); return 1; }
  if (!/^\d+$/.test(iframeId) || !productId) { console.log('\nSet LAX_IFRAME_ID and LAX_PRODUCT_ID first.'); return 1; }
  const body = {
    iframe_id: Number(iframeId),
    product_id: /^\d+$/.test(productId) ? Number(productId) : productId,
    amount: orderAmount,
    currency: productCurrency,
    email: orderEmail,
  };
  console.log(`\nPOST ${new URL(base).host}/api/cards/create-card-order-api`);
  console.log(`  request:  ${JSON.stringify(body)}`);
  const r = await get('/api/cards/create-card-order-api', body);
  if ('error' in r) { say(false, 'unreachable', r.error); return 1; }
  console.log(`  HTTP ${r.status}`);
  console.log(`  response: ${typeof r.json === 'string' ? r.json : JSON.stringify(r.json, null, 2)}`);
  const o = (r.json && typeof r.json === 'object') ? r.json as Record<string, unknown> : {};
  const ok = r.status >= 200 && r.status < 300 && o.success !== false;
  console.log(ok
    ? '\n✓ Zypto accepted the order — the reply above holds the checkout link (unpaid until someone pays it).'
    : `\n✗ Zypto refused the order${r.status >= 400 ? ` (${explainHttp(r.status)})` : ''}. Share the request and response above with Zypto.`);
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
