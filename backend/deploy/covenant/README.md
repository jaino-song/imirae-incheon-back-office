# Covenant backend standby

The Covenant server is an API-only warm standby for BabyJamJam production. It
runs the same immutable backend image as Lightsail but does not own public
routing, schedulers, auto-finalizers, eFormsign job intake, or document workers
while AWS is healthy.

## Safety boundary

- The API binds to `127.0.0.1:3101`; a separately approved tunnel or reverse
  proxy is required for inbound traffic.
- The Compose model hard-disables all singleton and provider-mutating workers.
  Values in `backend.env` cannot override those passive settings.
- Aligo credentials are blanked at the Compose layer until the Covenant fixed
  egress address has been registered and verified separately.
- Deployments pull an image by digest, verify its embedded Git revision, and
  tag it locally only after verification.
- The operator never changes AWS, DNS, Cloudflare, Vercel, Aligo, database
  migrations, or firewall rules.
- The production database and external-provider credentials are required for
  parity. Provision them before an incident; never copy or print them from an
  outage transcript.

## Host layout

```text
/usr/local/sbin/babyjamjam-covenant-standby
/usr/local/libexec/babyjamjam-covenant-standby/
├── bundle.manifest
└── compose.yml
/opt/babyjamjam-covenant/
├── backend.env
└── state/
    ├── current-image-digest
    ├── current-image-tag
    ├── previous-image-digest
    └── previous-image-tag
```

The operator and artifact bundle are root-owned. `backend.env` must be a
regular, non-symlink file owned by `root:root` with mode `0600`.

## Install and stage

Installation and deployment are live host changes and require separate
approval. From a reviewed checkout on the Covenant server:

```bash
sudo backend/deploy/covenant/install.sh
sudo install -o root -g root -m 0600 /approved/path/backend.env \
  /opt/babyjamjam-covenant/backend.env
sudo /usr/local/sbin/babyjamjam-covenant-standby deploy \
  <40-character-main-commit-sha> <sha256-image-digest>
```

The operator emits only non-secret status fields. A healthy staged runtime must
report `public_routing=not_managed`, `schedulers_enabled=false`, and both document
job gates as `false`.

## Incident cutover

1. Confirm the AWS production origin is unavailable or fenced.
2. Run `babyjamjam-covenant-standby status`; require healthy container, zero
   restarts, database readiness, and every passive gate disabled.
3. Reconcile ambiguous eformsign submissions before retrying a document.
4. Cut `api.babyjamjam.com` to the preconfigured Covenant origin through the
   separately approved DNS or load-balancer control plane.
5. Keep the standby API-only. Enabling schedulers or document workers requires
   a separate ownership design and is outside this operator.
6. Verify the public readiness route, authenticated login, and one authorized
   document-confirmation smoke test.

## Recovery and rollback

Switch public traffic away before stopping or rolling back the standby.

```bash
sudo /usr/local/sbin/babyjamjam-covenant-standby rollback
sudo /usr/local/sbin/babyjamjam-covenant-standby stop
```

Returning to AWS requires AWS readiness proof, public health, current release
identity, and eformsign/job reconciliation. Because the Covenant runtime never
owns schedulers, no scheduler transfer is needed for this API-only profile.

## Static outbound IP

The tunnel or reverse proxy solves inbound routing only. Aligo observes the
Covenant server's real outbound IPv4. Before allowing any SMS-producing path,
verify that this egress address is fixed, register it alongside the AWS address,
and run a no-send authentication check. Enabling Aligo then requires a reviewed
Compose change; do not rely on values in `backend.env`, because the passive
profile deliberately overrides them with empty values.
