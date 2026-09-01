# LightNode temporary Fallback host

This is a manual 24–48 hour operation, not automatic Sentry/controller failover. Select **Korea VPS Agency**, Linux x86_64, shared 2 vCPU/4 GB/50 GB NVMe. Do not select Start; do not select dedicated VDS without separate approval. Confirm the console hourly/all-in quote before purchase.

Create fresh Ubuntu with SSH keys only, restrictive cloud firewall/security group, Docker/Compose, Node, systemd and Tailscale. Never place production secrets in images, cloud-init, CLI arguments, console logs, or shell history. Run `lightnode-preflight.sh`, install the protected bundle, and verify manifests. The operator alone hands off root-owned `backend.env`, DB hash, approval and scheduler evidence.

Deploy an immutable tag+digest passive first. Hash current VPS egress from two sources, complete Aligo allow-list and no-send proof, then use expiry-bound `temporary-active`. Funnel only the loopback API with `tailscale funnel --bg 3101`; capture its real URL. Never expose the controller. After separate action-time approval, coordinate both Production `NEXT_PUBLIC_API_BASE_URL` redeploys and perform readiness/authenticated document/message smoke. Roll back before expiry.

Turn Funnel off, stop API, verify both Vercel projects restored, scrub runtime secrets/logs, optionally create a secret-free image, then **Release** the LightNode instance (not Stop) and confirm billing ended. A recreated instance/public IP requires new Aligo registration and a new approval hash.
