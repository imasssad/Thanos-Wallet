# Postgres 16 + pgBackRest — bakes the binary into the official image so
# the postgres process can call `pgbackrest archive-push` via
# archive_command without needing a separate container.
#
# Build:
#   docker build -t thanos-postgres-pitr -f ops/backups/pgbackrest/Dockerfile ops/backups/pgbackrest
#
# Image is referenced by docker-compose.pitr.yml. Kept here rather than at
# the repo root because it's a backups-stack artifact, not part of the
# main wallet image set.

FROM postgres:16-alpine

# pgBackRest is in the community/edge repo on Alpine. Pulling from edge
# is fine for an ops-only image — we're not chasing reproducibility past
# the Postgres major version pin.
RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
      pgbackrest

# pgBackRest reads /etc/pgbackrest/pgbackrest.conf by default. We mount
# the real config from the host at runtime (see docker-compose.pitr.yml)
# but COPY a stub so the image is self-sufficient if someone runs it bare.
COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
RUN  chown -R postgres:postgres /etc/pgbackrest \
  && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest \
  && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest

# The init script registers the stanza + takes the initial full backup
# on first boot. Idempotent — re-running on an already-initialised cluster
# is a no-op.
COPY init-stanza.sh /docker-entrypoint-initdb.d/99-pgbackrest-init.sh
RUN  chmod +x /docker-entrypoint-initdb.d/99-pgbackrest-init.sh

# Postgres archive_command + replication-friendly knobs are passed via
# the `command:` override in docker-compose.pitr.yml rather than baked in
# here, so they stay visible in `docker compose config`.
