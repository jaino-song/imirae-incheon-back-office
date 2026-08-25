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

Create the environment directories as a root-owned, non-writable boundary and
keep each `backend.env` file exactly `root:root` mode `0600`. The root-only CI
operator reads the files for fixed Docker/Compose operations; Git and worktree
maintenance remains under `ubuntu`. Never commit either file or print its full
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

Environment-branch automation is documented in
[`CI_AUTOMATION.md`](./CI_AUTOMATION.md). It builds immutable images on GitHub,
uses short-lived GitHub OIDC credentials to invoke fixed AWS Systems Manager
documents, and keeps production behind a GitHub environment approval gate.

The former ubuntu/Docker-group preview operator is retired. Do not install or
use `install-operator.sh`; its install and check commands fail closed, and its
uninstall command only removes stale legacy files. There is no alternate SSH
deploy, rollback, or status path.

Install the root-only operator once from an administrative shell on the
Lightsail host:

```bash
sudo backend/deploy/lightsail/install-ci-operator.sh install
sudo backend/deploy/lightsail/install-ci-operator.sh check
```

The CI operator refuses to run while `ubuntu` belongs to the Docker group.
Git fetch/worktree operations run with a sanitized `ubuntu` environment, while
fixed Docker, Compose, and environment-file operations use only the atomically
installed `root:root` artifact bundle under
`/usr/local/libexec/babyjamjam-ci-operator`; the operator never executes or
parses a deployment helper or Compose definition from the `ubuntu`-owned
repository/worktree. Installation, replacement, validation, rollback, and
uninstall cover the complete bundle. Status and deployment output contains
only secret-free release, route, readiness, and health fields. A successful
status includes matching `db_route` and `runtime_route` values plus
`db_readiness=ok`; it also verifies one API container, scheduler ownership,
image tag/digest identity, internal and public `/health/ready`, and public
liveness.

The repository copies of `deploy.sh` and `rollback.sh` are source material for
installation only. They fail closed when invoked from the checkout. Root
Docker/Compose execution must use the installed operator or, for an explicitly
approved bootstrap, the matching protected helper under
`/usr/local/libexec/babyjamjam-ci-operator`.

Removing stale legacy files, if present, requires the same administrative
access:

```bash
sudo backend/deploy/lightsail/install-operator.sh uninstall
sudo backend/deploy/lightsail/install-ci-operator.sh uninstall
```

Each application deployment:

1. selects only the requested environment file and Compose project;
2. tags the image with the exact Git commit;
3. validates the resolved Compose model without printing secrets;
4. activates the preloaded API image and starts only that environment's API and Valkey;
5. waits for the container health check and matching public `/health` route;
6. records current and previous healthy tags only after both checks pass.

The repository `deploy-edge.sh`, edge Compose file, and Caddyfile are not root
runtime inputs. That legacy helper is retired and fails closed. Database route
failover does not redeploy the edge: both public routes keep their existing API
upstreams. Any future Caddy or edge-network change requires its own reviewed,
root-owned protected bundle and rollback procedure before execution.

Use `BACKEND_PUBLIC_HEALTH_REQUIRED=false` only for the one-time bootstrap
before Caddy can route to a new environment. That mode verifies internal API
health but deliberately does not record a healthy deployment.

The protected helper always requires `BACKEND_BUILD_IMAGE=false` and an exact
commit-tagged image that is already present locally. It never builds from the
repository or from the installed Compose file's relative build context. Normal
releases pull and verify the immutable image through the CI operator first.
Every protected Compose call also uses `/dev/null` as its explicit interpolation
env file and pins the protected artifact directory as the Compose project
directory, so an inherited working-directory `.env` cannot alter the runtime.

## Legacy single-stack migration

The old repository-driven edge migration procedure is retired and must not be
replayed. The current failover work assumes the production and preview edge
routes already exist. Rebuilding or migrating that edge is a separate,
externally approved infrastructure task because it changes public routing and
requires a protected Caddy artifact plus an independently rehearsed rollback.

## Rollback

Roll back one environment to its previously recorded healthy image:

```bash
sudo /usr/local/libexec/babyjamjam-ci-operator/rollback.sh production
sudo /usr/local/libexec/babyjamjam-ci-operator/rollback.sh preview
```

Or choose a locally available image tag:

```bash
sudo /usr/local/libexec/babyjamjam-ci-operator/rollback.sh production <git-commit-sha>
sudo /usr/local/libexec/babyjamjam-ci-operator/rollback.sh preview <git-commit-sha>
```

Rollback changes only the selected API container and verifies its matching
public route. It does not change Caddy, DNS, database state, the other
environment, or scheduler ownership. Preview rollback retains the same
fail-closed scheduler check.

During the one-time migration, the immediate pre-handoff rollback is to stop
the shared edge and restart the legacy Caddy container. After scheduler
ownership has transferred, disable schedulers on the new production runtime
before re-enabling any old production scheduler owner.
