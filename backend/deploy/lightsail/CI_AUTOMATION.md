# GitHub-to-Lightsail backend deployment

Pushes to `preview` and `main` build the backend image on GitHub-hosted runners.
The workflow publishes an immutable commit image to the public GHCR package and
asks AWS Systems Manager to activate that exact image on the existing Lightsail
host. The host does not build application images.

| Branch | Deployment credential | Runtime | Approval |
|---|---|---|---|
| `preview` | branch-scoped preview role | preview backend | automatic after CI |
| `main` | branch-scoped production role | production backend | `production` environment required reviewer |

The deploy and fixed-purpose operations jobs receive temporary AWS credentials through GitHub OIDC. Their
trust policy pins preview access to `refs/heads/preview` and production access
to `refs/heads/main`; a feature branch cannot gain deployment authority by
referencing an environment. Production approval runs in a separate
`production` environment job that has no AWS token, and the branch-scoped
deployment job starts only after that approval succeeds. The workflow does not
use an AWS access key, SSH key, or a remotely supplied shell command. The
preview and production roles can each invoke only their fixed SSM document on a
managed node with the configured `DeploymentTarget` tag. The workflow refuses
to send a command unless that tag resolves to exactly one online managed node.

## Local operations CLI

The local CLI deliberately uses the authenticated GitHub CLI instead of local
AWS credentials. GitHub Actions obtains short-lived, branch-scoped credentials
through OIDC and invokes only the fixed SSM documents declared in
`github-oidc-ssm.yaml`.

```bash
backend/deploy/lightsail/lightsail-cli.sh status preview
backend/deploy/lightsail/lightsail-cli.sh deploy preview
backend/deploy/lightsail/lightsail-cli.sh status production
backend/deploy/lightsail/lightsail-cli.sh deploy production
backend/deploy/lightsail/lightsail-cli.sh operator-upgrade
```

The command watches the workflow run and returns its exit status. Add
`--no-watch` to open the run without waiting. Production operations enter the
`production` GitHub environment approval gate. The root operator bundle is
shared by Preview and Production, so `operator-upgrade` is always pinned to the
current `main` commit and uses the same Production approval gate; no
Preview-only upgrade exists. The workflow does not accept arbitrary shell text,
document names, commit SHAs, image digests, roles, regions, or node targets from
the local caller.

## One-time activation checklist

Every step below changes external state and requires the Lightsail operational
approval gate before execution.

1. Confirm or create the AWS IAM OIDC provider for
   `https://token.actions.githubusercontent.com` with audience
   `sts.amazonaws.com`. Reuse an existing provider rather than creating a
   duplicate.
2. Deploy `github-oidc-ssm.yaml`, passing the existing provider ARN and the
   fixed `ManagedNodeTagValue=babyjamjam-admin-server`. Keep the CloudFormation
   stack as the source of truth for roles, the shared managed-node tag, and SSM
   documents.
3. Create a short-lived Systems Manager hybrid activation using the stack's
   `ManagedNodeServiceRoleName`. Attach the same `DeploymentTarget` tag, install
   the SSM agent on the Lightsail host, verify exactly one online managed node,
   then expire or delete the activation. Never record the activation code or ID
   in this repository or CI logs.
4. Before installation, migrate `/opt/babyjamjam` and each
   `environments/<environment>` directory to a non-symlink, root-owned,
   group/world-non-writable boundary. Keep each `backend.env` exactly
   `root:root` mode `0600`; the installer and operator fail closed rather than
   silently repairing an unsafe secret boundary. Then install the root-only
   command and its protected artifact bundle and verify their metadata:

   ```bash
   sudo backend/deploy/lightsail/install-ci-operator.sh install
   sudo backend/deploy/lightsail/install-ci-operator.sh check
   ```

   Installation also creates or repairs the shared per-environment lock files
   as `root:root` mode `0600` and transactionally installs the operator,
   deploy helper, rollback helper, and Compose definition under
   `/usr/local/libexec/babyjamjam-ci-operator`. The root CI operator refuses to
   deploy when that bundle, the lock contract, or the root-owned
   environment-file boundary is invalid. `ubuntu` must not belong to the
   Docker group.

5. Publish the first image, connect the GHCR package to this repository, and
   set the package visibility to public. Public visibility is required because
   the host deliberately has no registry credential. Confirm anonymous pull of
   the exact digest before enabling deployment.
6. Create a GitHub environment named exactly `production`, then add a required
   reviewer. This environment is only the approval gate and contains no AWS
   deployment credentials.
7. Add these GitHub repository variables from the matching CloudFormation
   outputs:

   - `AWS_PREVIEW_DEPLOY_ROLE_ARN`
   - `AWS_PREVIEW_DEPLOY_DOCUMENT_NAME`
   - `AWS_PREVIEW_STATUS_DOCUMENT_NAME`
   - `AWS_PRODUCTION_DEPLOY_ROLE_ARN`
   - `AWS_PRODUCTION_DEPLOY_DOCUMENT_NAME`
   - `AWS_PRODUCTION_STATUS_DOCUMENT_NAME`
   - `AWS_OPERATOR_UPGRADE_DOCUMENT_NAME`
   - `LIGHTSAIL_SSM_TARGET_TAG`

8. Run the workflow manually on a non-deploying branch to validate CI, then
   merge through `dev` to `preview`. Verify image provenance, container health,
   restart count, scheduler ownership, and the public health route. Rehearse a
   rollback in preview before enabling the production environment.

## Release and recovery contract

The workflow waits for type checking, lint, unit tests, migration drift checks,
and auth/agent E2E tests. It then builds `backend/Dockerfile.lightsail`, labels
the image with the source commit, pushes the commit tag, and passes the returned
digest to SSM. Superseded image builds are cancelled; a deployment that has
started is never cancelled by concurrency handling.

The root-only host operator accepts only an environment, a lowercase 40-byte
commit SHA, and a lowercase SHA-256 image digest. It verifies that the commit is
the current tip of the corresponding environment branch and that the pulled
image label matches that commit. Before changing the running container, it runs
`prisma migrate deploy` from that exact image using the target environment's
database configuration. A migration failure leaves the current application
image running. Release migrations must remain backward-compatible because a
successful database migration cannot be automatically undone if later runtime
activation fails. It records digest state only after the full runtime invariant
succeeds: one API container, the authoritative route and exact
`DATABASE_CONNECTION_MODE`, scheduler ownership, health/restart, image
tag/digest identity, internal and public `/health/ready`, and public liveness.

If deployment or verification fails, the operator immediately invokes the
existing rollback script with the recorded known-good commit image, preserves
the prior rollback-tag history, restores the prior digest state, and verifies
the recovered runtime. The root CI operator holds one per-environment lock so
concurrent commands cannot change the same runtime. Detailed output is kept in
a root-only host log; GitHub receives only a failure status and safe release
fields. The status contract includes `db_route`, `runtime_route`, and
`db_readiness=ok`; the workflow requires the two routes to match and rejects
any missing or non-`ok` readiness value.

## Disable and roll back the automation

To stop new deployments without changing the running service, disable the
GitHub workflow or remove the branch's OIDC role repository variable. To remove
host execution capability, run:

```bash
sudo backend/deploy/lightsail/install-ci-operator.sh uninstall
```

After confirming there are no active SSM commands, deregister the managed node
and delete the CloudFormation stack. These steps do not remove the running
containers, environment files, deployment state, GHCR images, or root-only
diagnostic logs.
