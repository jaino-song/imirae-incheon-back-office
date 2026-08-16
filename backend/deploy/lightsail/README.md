# Lightsail Backend Deployment

This stack runs the NestJS API, a private Valkey instance, and Caddy on the
Seoul Lightsail host. Railway remains the production traffic and scheduler
owner until the cutover is explicitly approved.

## Host setup

- Clone this repository to `/opt/babyjamjam/repository`.
- Store production runtime values in `/opt/babyjamjam/backend.env` with mode
  `0600`. Do not commit this file.
- Keep `SCHEDULERS_ENABLED=false` in `backend.env` while Railway is running
  scheduled work. Compose passes this value through from that runtime file and
  does not override scheduler ownership from the deployment shell.
- Keep port `3001` private. Only Caddy publishes ports `80` and `443`.
- Install `curl` on the host so deploy and rollback can verify the public
  reverse-proxy path before recording a healthy image.

## Deploy

Run from the repository checkout:

```bash
backend/deploy/lightsail/deploy.sh
```

The script refuses a dirty checkout, builds an image tagged with the exact Git
commit, validates the Compose configuration without printing resolved secrets,
and waits for both the API container and the public Caddy `/health` route. It
records the current and previous healthy tags under `/opt/babyjamjam` only
after both checks pass.

The default Caddy address is `:80`, which supports an IP-based shadow smoke
test. Set `CADDY_SITE_ADDRESS` to the approved hostname only after its DNS
record is ready.

The public health check defaults to `http://127.0.0.1/health` for the `:80`
shadow configuration. When Caddy serves an HTTPS hostname, pass the externally
reachable URL to both deploy and rollback:

```bash
CADDY_SITE_ADDRESS=preview.api.babyjamjam.com \
BACKEND_PUBLIC_HEALTH_URL=https://preview.api.babyjamjam.com/health \
backend/deploy/lightsail/deploy.sh
```

## Roll back

Roll back to the previously healthy image:

```bash
backend/deploy/lightsail/rollback.sh
```

Or select a locally available commit tag:

```bash
backend/deploy/lightsail/rollback.sh <git-commit-sha>
```

Rollback applies the same API and public proxy health checks before updating
the recorded image tags. It changes only the Lightsail containers; it does not
change DNS, Railway, database state, or scheduler ownership.
