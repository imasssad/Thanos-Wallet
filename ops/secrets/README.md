# Secrets management

Production secrets live in this folder, encrypted at rest via
[SOPS](https://github.com/getsops/sops) with [age](https://age-encryption.org)
recipients. The encrypted files are safe to commit + diff; only
someone with a listed age private key can decrypt.

This is the replacement for the previous `.env on the VPS` setup —
new operators get their public key added to `.sops.yaml`, they run
`sops -d` locally, and the deploy pipeline does the same on the VPS
via the `SOPS_AGE_KEY` GitHub Action secret.

## Files

```
ops/secrets/
├── README.md            ← this file
├── prod.enc.env         ← production env (encrypted)
├── staging.enc.env      ← staging env (encrypted)
└── .gitignore           ← never commit a decrypted .env here
```

## Quickest path: the bootstrap script

```bash
bash ops/secrets/bootstrap-age-keys.sh
# → installs age + sops if missing
# → generates ~/.config/sops/age/keys.txt if absent
# → prints your PUBLIC key + the exact .sops.yaml line to update
# → tells you what to commit + how to wire CI
```

Run it once on your laptop (so you can edit secrets) and once on the
VPS (so deploy can decrypt). Paste each public key into `.sops.yaml`,
then `sops updatekeys ops/secrets/*.enc.env` and commit.

## Adding yourself as a recipient (manual path)

1. Generate an age keypair (one-off):
   ```bash
   mkdir -p ~/.config/sops/age
   age-keygen -o ~/.config/sops/age/keys.txt
   # → writes Public key: age1abc...
   # → writes private key to the file (DON'T share)
   ```
2. Send your **public** key to a current operator.
3. Operator adds it to `.sops.yaml`:
   ```yaml
   creation_rules:
     - path_regex: ops/secrets/prod\.enc\.env$
       age: >-
         age1existing...,
         age1yourkey...
   ```
4. Operator rotates the existing files to include you:
   ```bash
   sops updatekeys ops/secrets/prod.enc.env
   sops updatekeys ops/secrets/staging.enc.env
   git commit -am "ops/secrets: add <your-name> as a recipient"
   git push
   ```

## Editing a secret

```bash
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops ops/secrets/prod.enc.env
# Opens $EDITOR with the decrypted plaintext.
# On save, SOPS re-encrypts in-place — only the keys with the
# `_unencrypted_suffix: _plain` marker stay readable in git diffs.
```

## Decrypting for local use

```bash
sops -d ops/secrets/prod.enc.env > .env
# Or directly into a process:
sops exec-env ops/secrets/prod.enc.env 'pnpm --filter @thanos/api start'
```

## Decrypting on the VPS (CI does this automatically)

The deploy workflow injects `SOPS_AGE_KEY` (the SAME private key
material, base64) as an env var. The runner writes it to a tmpfile,
decrypts the env to `.env`, then `docker compose up -d`. Sample shell:

```bash
echo "$SOPS_AGE_KEY" > /tmp/age-key
SOPS_AGE_KEY_FILE=/tmp/age-key sops -d ops/secrets/prod.enc.env > /var/www/thanos-wallet/.env
shred -u /tmp/age-key
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Migrating from the legacy plain `.env` on the VPS

One-off, takes ~10 minutes:

1. On a trusted laptop, generate your age key (above).
2. Add yourself to `.sops.yaml` (above).
3. Pull the current plaintext `.env` from the VPS:
   ```bash
   scp root@thanos.fi:/var/www/thanos-wallet/.env ./prod.env.plain
   ```
4. Encrypt it into the repo:
   ```bash
   sops --encrypt --output ops/secrets/prod.enc.env ./prod.env.plain
   shred -u prod.env.plain
   git commit -am "ops/secrets: encrypt production env"
   git push
   ```
5. Add `SOPS_AGE_KEY` to GitHub repo secrets (the *private* key file
   contents — paste of `~/.config/sops/age/keys.txt`).
6. Wire the deploy workflow to use it. `.github/workflows/deploy.yml`
   already has the placeholder block at the top — flip the
   `USE_SOPS=true` env var.

## What goes in here (and what doesn't)

**In**: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `REFRESH_SECRET`,
`SENTRY_DSN`, `SLACK_WEBHOOK_URL`, `PAGERDUTY_INTEGRATION_KEY`,
`S3_BUCKET` for backups, `STAGING_*` mirrors.

**Not in**: code-signing certs (`CSC_LINK`, `WIN_CSC_LINK`) — those
stay as GitHub Actions repo secrets so they're only available to the
release workflow, not to anyone who can decrypt the runtime env.
