# Lightsail Backend Deployment

This stack runs the NestJS API, a private Valkey instance, and Caddy on the
Seoul Lightsail host. Railway remains the production traffic and scheduler
owner until the cutover is explicitly approved.

## Host setup

- Clone this repository to `/opt/babyjamjam/repository`.
- Store production runtime values in `/opt/babyjamjam/backend.env` with mode
  `0600`. Do not commit this file.
- Keep `SCHEDULERS_ENABLED=false` while Railway is running scheduled work.
- Keep port `3001` private. Only Caddy publishes ports `80` and `443`.

## Deploy

Run from the repository checkout:

```bash
backend/deploy/lightsail/deploy.sh
```

The script builds an image tagged with the exact Git commit, validates the
Compose configuration without printing resolved secrets, waits for the API
health check, and records the current and previous healthy tags under
`/opt/babyjamjam`.

The default Caddy address is `:80`, which supports an IP-based shadow smoke
test. Set `CADDY_SITE_ADDRESS` to the approved hostname only after its DNS
record is ready.

## Roll back

Roll back to the previously healthy image:

```bash
backend/deploy/lightsail/rollback.sh
```

Or select a locally available commit tag:

```bash
backend/deploy/lightsail/rollback.sh <git-commit-sha>
```

Rollback changes only the Lightsail containers. It does not change DNS,
Railway, database state, or scheduler ownership.
