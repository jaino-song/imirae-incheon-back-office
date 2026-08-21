# GitHub-to-Lightsail backend deployment

Pushes to `preview` and `main` build the backend image on GitHub-hosted runners.
The workflow publishes an immutable commit image to the public GHCR package and
asks AWS Systems Manager to activate that exact image on the existing Lightsail
host. The host does not build application images.

| Branch | Deployment credential | Runtime | Approval |
|---|---|---|---|
| `preview` | branch-scoped preview role | preview backend | automatic after CI |
| `main` | branch-scoped production role | production backend | `production` environment required reviewer |

The deploy job receives temporary AWS credentials through GitHub OIDC. Its
trust policy pins preview access to `refs/heads/preview` and production access
to `refs/heads/main`; a feature branch cannot gain deployment authority by
referencing an environment. Production approval runs in a separate
`production` environment job that has no AWS token, and the branch-scoped
deployment job starts only after that approval succeeds. The workflow does not
use an AWS access key, SSH key, or a remotely supplied shell command. The
preview and production roles can each invoke only their fixed SSM document on a
managed node with the configured `DeploymentTarget` tag. The workflow refuses
to send a command unless that tag resolves to exactly one online managed node.

## One-time activation checklist

Every step below changes external state and requires the Lightsail operational
approval gate before execution.

1. Confirm or create the AWS IAM OIDC provider for
   `https://token.actions.githubusercontent.com` with audience
   `sts.amazonaws.com`. Reuse an existing provider rather than creating a
   duplicate.
2. Deploy `github-oidc-ssm.yaml`, passing the existing provider ARN and one
   unique `ManagedNodeTagValue`. Keep the CloudFormation stack as the source of
   truth for roles and SSM documents.
3. Create a short-lived Systems Manager hybrid activation using the stack's
   `ManagedNodeServiceRoleName`. Attach the same `DeploymentTarget` tag, install
   the SSM agent on the Lightsail host, verify exactly one online managed node,
   then expire or delete the activation. Never record the activation code or ID
   in this repository or CI logs.
4. On the host, install the root-only command and verify its metadata:

   ```bash
   sudo backend/deploy/lightsail/install-ci-operator.sh install
   sudo backend/deploy/lightsail/install-ci-operator.sh check
   ```

   Installation also creates or repairs the shared per-environment lock files
   as `ubuntu:ubuntu` mode `0640`; both the restricted preview operator and the
   root CI operator refuse to deploy when that lock contract is invalid.

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
   - `AWS_PRODUCTION_DEPLOY_ROLE_ARN`
   - `AWS_PRODUCTION_DEPLOY_DOCUMENT_NAME`
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
activation fails. It records digest state only after deployment, container
checks, scheduler checks, and the public health check succeed.

If deployment or verification fails, the operator immediately invokes the
existing rollback script with the recorded known-good commit image, preserves
the prior rollback-tag history, restores the prior digest state, and verifies
the recovered runtime. CI deployment and the existing preview operator share
one per-environment lock so they cannot change the same runtime concurrently.
Detailed output is kept in a root-only host log; GitHub receives only a failure
status and safe release fields.

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
