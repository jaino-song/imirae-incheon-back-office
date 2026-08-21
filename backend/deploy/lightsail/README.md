# Lightsail Backend Environments

The Seoul Lightsail host runs production and preview as separate logical
environments on one VM. This mirrors Railway's environment model without
creating a second billable Lightsail instance.

The environments have separate API containers, Valkey containers, persistent
Valkey volumes, Compose project names, runtime environment files, deployment
state, and scheduler settings. A third Compose project runs the shared Caddy
edge and maps each public hostname to the matching API.

| Environment | Public hostname | Compose project | Edge alias | Scheduler |
|---|---|---|---|---|
| Production | `api.babyjamjam.com` | `babyjamjam-backend-production` | `api-production` | enabled after ownership transfer |
| Preview | `preview.api.babyjamjam.com` | `babyjamjam-backend-preview` | `api-preview` | always disabled |
| Shared edge | both hostnames | `babyjamjam-edge` | n/a | n/a |

This is logical isolation, not host-level fault isolation. Both environments
share the same CPU, memory, disk, Docker daemon, network interface, and VM
reboot boundary.

The image definition is intentionally named `backend/Dockerfile.lightsail`.
Keeping it separate from the conventional `backend/Dockerfile` path prevents
Railway's `/backend` build context from auto-selecting a repository-root image.

## Host layout

Keep the repository and environment state in these locations:

```text
/opt/babyjamjam/
├── repository/
└── environments/
    ├── production/
    │   ├── backend.env
    │   ├── current-image-tag
    │   └── previous-image-tag
    └── preview/
        ├── backend.env
        ├── current-image-tag
        └── previous-image-tag
```

Create the environment directories for the dedicated deployment account and
keep each `backend.env` file at mode `0600`. The account that runs the deploy
scripts must be able to read them. Never commit either file or print its full
contents into a terminal transcript.

Production and preview must use their corresponding Railway environment values,
including the correct database, authentication, storage, webhook, and frontend
URLs. Do not create preview by blindly copying production secrets. The preview
file must explicitly include:

```env
SCHEDULERS_ENABLED=false
SERVICE_RECORD_AUTO_FINALIZE_ENABLED=false
```

The deploy and rollback scripts fail closed if preview does not set
`SCHEDULERS_ENABLED=false`. Production scheduler ownership is an operational
handoff: exactly one production runtime may have it enabled at a time.

Port `3001` remains private. Only the shared edge publishes ports `80` and
`443`. The host needs Docker Compose and `curl`.

## Compose isolation

The application Compose file is started once per environment. Compose project
names isolate containers and private networks. Explicit volume names isolate
Valkey without mounting one data directory into two running processes:

- Production: `babyjamjam-backend-production_valkey_data`
- Preview: `babyjamjam-backend-preview_valkey_data`
- Shared TLS data: the existing `babyjamjam-backend_caddy_data` and
  `babyjamjam-backend_caddy_config` volumes

Caddy joins two external route networks: `babyjamjam-edge-production` and
`babyjamjam-edge-preview`. Each API joins only its matching route network, and
each Valkey stays on its environment's private network. Production and preview
APIs therefore do not share a Docker network with each other.

## Routine deployment

### Restricted agent operator

Install the preview-only operator once from an administrative shell on the
Lightsail host:

```bash
sudo gpasswd --delete agent-lightsail-operator docker
sudo backend/deploy/lightsail/install-operator.sh install
sudo backend/deploy/lightsail/install-operator.sh check
```

The installer copies a root-owned command to
`/usr/local/sbin/babyjamjam-preview-operator` and adds one sudoers rule. The
`agent-lightsail-operator` Linux user may run only that command as `ubuntu`; it
does not receive general sudo, Docker group membership, or direct access to
`backend.env`. Removing the Docker group membership is mandatory because direct
Docker access is equivalent to host administrative access.

Agents use the fixed SSH alias and the restricted command:

```bash
ssh agent-lightsail-operator \
  'sudo -n -u ubuntu /usr/local/sbin/babyjamjam-preview-operator status'

ssh agent-lightsail-operator \
  'sudo -n -u ubuntu /usr/local/sbin/babyjamjam-preview-operator deploy <full-preview-commit-sha>'

ssh agent-lightsail-operator \
  'sudo -n -u ubuntu /usr/local/sbin/babyjamjam-preview-operator rollback'
```

The deploy command accepts exactly one 40-character commit and requires it to
equal the freshly fetched `origin/preview` commit. It builds from a clean,
detached preview deployment worktree, clears caller-controlled Git, Docker,
Compose, and Lightsail environment variables, runs the existing health-gated
deployment script, and reports only non-secret status fields. Rollback is
limited to the previously recorded healthy preview image. Production is not a
valid operator command.

Removing this capability requires the same administrative access used for
installation:

```bash
sudo backend/deploy/lightsail/install-operator.sh uninstall
```

Installing, replacing, uninstalling, deploying, or rolling back is a
state-changing operation and still requires the approval gate in the shared
Lightsail agent-operator runbook.

Run from a clean repository checkout at the exact commit to deploy:

```bash
backend/deploy/lightsail/deploy.sh preview
backend/deploy/lightsail/deploy.sh production
```

Each application deployment:

1. selects only the requested environment file and Compose project;
2. tags the image with the exact Git commit;
3. validates the resolved Compose model without printing secrets;
4. builds and starts only that environment's API and Valkey;
5. waits for the container health check and matching public `/health` route;
6. records current and previous healthy tags only after both checks pass.

Deploy the shared edge only when the routing configuration changes:

```bash
backend/deploy/lightsail/deploy-edge.sh
```

The edge script validates the Caddyfile before replacement and requires both
production and preview public health routes to pass afterward.

Use `BACKEND_PUBLIC_HEALTH_REQUIRED=false` only for the one-time bootstrap
before Caddy can route to a new environment. That mode verifies internal API
health but deliberately does not record a healthy deployment.

Use `BACKEND_BUILD_IMAGE=false` only when the exact commit-tagged image has
already been built locally. The script refuses the request if that image is
missing.

## One-time migration from the single stack

Perform this in a low-traffic window. Keep the legacy production stack and its
environment file intact until the new production and preview routes are proven.

1. Create both environment directories and populate their `backend.env` files.
   Start with schedulers disabled in both new files while the legacy production
   API remains the scheduler owner.
2. Start both isolated app stacks without changing public routing:

   ```bash
   BACKEND_PUBLIC_HEALTH_REQUIRED=false backend/deploy/lightsail/deploy.sh production
   BACKEND_PUBLIC_HEALTH_REQUIRED=false backend/deploy/lightsail/deploy.sh preview
   ```

3. Identify the legacy Caddy container by its Compose project and service
   labels. Require exactly one match, stop only that container, then run
   `deploy-edge.sh`. If the shared edge does not pass both health checks, stop
   it and restart the identified legacy Caddy container immediately.
4. Once both new public routes are healthy, identify and stop only the legacy
   production API container. This ends its scheduler ownership without deleting
   the legacy production Valkey or TLS volumes.
5. Set `SCHEDULERS_ENABLED=true` in the new production file, then activate the
   already-built image and record both environments:

   ```bash
   BACKEND_BUILD_IMAGE=false backend/deploy/lightsail/deploy.sh production
   BACKEND_BUILD_IMAGE=false backend/deploy/lightsail/deploy.sh preview
   ```

6. Verify scheduler activity only on production, confirm both public routes,
   and observe CPU, memory, restarts, and application errors before removing any
   stopped legacy containers. The new production Valkey starts with a cold
   cache; durable jobs remain in PostgreSQL. Never delete the legacy production
   Valkey or Caddy volumes during this migration.

The production API is briefly recreated when scheduler ownership is enabled.
The production CPU limit is `1.5` cores and `2 GB`; preview is capped at
`0.5` core and `1 GB`. Each Valkey and Caddy is capped separately. These are
guardrails against preview starving production, not separate capacity. Avoid
simultaneous environment builds during peak traffic.

## Rollback

Roll back one environment to its previously recorded healthy image:

```bash
backend/deploy/lightsail/rollback.sh production
backend/deploy/lightsail/rollback.sh preview
```

Or choose a locally available image tag:

```bash
backend/deploy/lightsail/rollback.sh production <git-commit-sha>
backend/deploy/lightsail/rollback.sh preview <git-commit-sha>
```

Rollback changes only the selected API container and verifies its matching
public route. It does not change Caddy, DNS, database state, the other
environment, or scheduler ownership. Preview rollback retains the same
fail-closed scheduler check.

During the one-time migration, the immediate pre-handoff rollback is to stop
the shared edge and restart the legacy Caddy container. After scheduler
ownership has transferred, disable schedulers on the new production runtime
before re-enabling any old production scheduler owner.
