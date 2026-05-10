# HTTPS via Let's Encrypt — Runbook

Domain: `devapp.thanos.fi` → VPS `76.13.250.159`
DNS provider: Cloudflare (currently orange-clouded / proxied).

Let's Encrypt's HTTP-01 challenge needs **direct port-80 access** to the VPS.
Cloudflare's proxy intercepts that, so you have two choices:

- **Path A (simpler) — gray-cloud the DNS record temporarily**, run certbot,
  then optionally re-orange-cloud (Cloudflare strict / full-strict mode).
- **Path B — use the DNS-01 challenge** with the Cloudflare API token (works
  while orange-clouded). Requires the `python3-certbot-dns-cloudflare` plugin
  and a Cloudflare API token with `Zone:DNS:Edit` permissions.

Path A is faster if you can tolerate ~2 minutes of "no proxy" on the record.

---

## Path A — gray-cloud + HTTP-01 (recommended first)

### 1. Cloudflare dashboard

`devapp.thanos.fi` A record → click the orange cloud → it turns gray.
Wait ~30 seconds for DNS to propagate (gray cloud = DNS-only, not proxied).

Verify from any machine:

```bash
dig +short devapp.thanos.fi
# expect: 76.13.250.159 (your VPS), NOT a Cloudflare IP (104.x / 172.x)
```

### 2. SSH to the VPS (Termius)

```bash
ssh root@76.13.250.159     # or whatever user
```

### 3. Install certbot + nginx plugin

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo mkdir -p /var/www/certbot
```

### 4. Replace the nginx site config with the HTTPS-ready one

The repo's `scripts/nginx-thanos-wallet.conf` already has both the HTTP
(redirect-to-HTTPS) server block and the HTTPS server block referencing
`/etc/letsencrypt/live/devapp.thanos.fi/...`.

**But before the cert is issued, those `ssl_certificate` paths don't exist**,
so nginx will fail to reload. Workflow:

#### Step 4a — issue the cert in standalone mode first

Stop nginx briefly, let certbot bind port 80, then start nginx again:

```bash
sudo systemctl stop nginx
sudo certbot certonly --standalone \
    -d devapp.thanos.fi \
    --email YOUR_EMAIL_HERE \
    --agree-tos --non-interactive
sudo systemctl start nginx
```

You should see:

```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/devapp.thanos.fi/fullchain.pem
```

#### Step 4b — install the new nginx config

From your local machine:

```bash
scp /var/www/thanos-wallet/scripts/nginx-thanos-wallet.conf \
    root@76.13.250.159:/etc/nginx/sites-available/thanos-wallet
```

Or on the VPS, just `git pull` first and then copy:

```bash
cd /var/www/thanos-wallet
git pull origin main
sudo cp scripts/nginx-thanos-wallet.conf /etc/nginx/sites-available/thanos-wallet
sudo ln -sf /etc/nginx/sites-available/thanos-wallet /etc/nginx/sites-enabled/
sudo nginx -t              # must say 'syntax is ok' / 'test is successful'
sudo systemctl reload nginx
```

### 5. Verify

```bash
curl -I https://devapp.thanos.fi
# expect: HTTP/2 200 (or 301 if hitting /api etc.)
```

Open `https://devapp.thanos.fi` in a browser — should show the padlock.

### 6. Re-orange-cloud in Cloudflare (optional)

Click the gray cloud back to orange. Set Cloudflare SSL/TLS mode to
**Full (strict)** so CF→origin uses the real cert too. Done.

### 7. Auto-renewal

Certbot installs a systemd timer automatically. Verify:

```bash
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

Renewal runs twice daily; only renews when within 30 days of expiry.
The HTTP-01 challenge needs port 80 open and gray-clouded again at
renewal time, OR switch to DNS-01 (Path B) which renews behind the
orange cloud.

---

## Path B — DNS-01 with Cloudflare API (renewal-safe behind orange cloud)

### 1. Create a Cloudflare API token

Cloudflare dashboard → **My Profile** → **API Tokens** → **Create Token** →
template: **Edit zone DNS** → Zone Resources: `Include / Specific zone /
thanos.fi` → Continue → Create.

Copy the token. Save it on the VPS:

```bash
sudo mkdir -p /etc/letsencrypt/secrets
sudo tee /etc/letsencrypt/secrets/cloudflare.ini > /dev/null <<'INI'
dns_cloudflare_api_token = PASTE_TOKEN_HERE
INI
sudo chmod 600 /etc/letsencrypt/secrets/cloudflare.ini
```

### 2. Install plugin + issue

```bash
sudo apt install -y python3-certbot-dns-cloudflare
sudo certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials /etc/letsencrypt/secrets/cloudflare.ini \
    -d devapp.thanos.fi \
    --email YOUR_EMAIL_HERE \
    --agree-tos --non-interactive
```

Certbot creates a `_acme-challenge.devapp.thanos.fi` TXT record via the API,
proves ownership, then deletes the record. Works whether or not the A record
is proxied.

### 3. Then continue from Path A step 4b (install nginx config + reload).

Renewal works automatically — no DNS toggling needed.

---

## Rollback

If anything breaks:

```bash
# Revert nginx
sudo rm /etc/nginx/sites-enabled/thanos-wallet
sudo systemctl reload nginx

# Or pin to the previous config from git
cd /var/www/thanos-wallet
git log -- scripts/nginx-thanos-wallet.conf
git show <PREV_COMMIT>:scripts/nginx-thanos-wallet.conf | sudo tee /etc/nginx/sites-available/thanos-wallet
sudo systemctl reload nginx
```

The certs themselves are non-destructive — they sit in `/etc/letsencrypt/`
and don't affect anything until nginx is told to use them.
