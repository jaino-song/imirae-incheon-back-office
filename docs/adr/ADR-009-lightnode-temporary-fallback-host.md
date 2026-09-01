# ADR-009: LightNode temporary fallback host

For the manual temporary fallback path, select LightNode Korea VPS Agency shared 2 vCPU/4 GB/50 GB NVMe on demand and Release it afterward. This supersedes only physical Covenant-host placement for this temporary path. ADR-007/ADR-008 automatic control-plane history remains unchanged.

The admission check is read-only and has two explicit modes: run `fresh` before provisioning, then run `installed` once immediately after the protected bundle is staged and before secrets or runtime. After deploy or activation, use operator status and action-specific proof only. It does not provision, approve, copy secrets, alter routing, start Compose, or contact a provider.

Provisioning is a separately approved, root-only operation. The approved fallback IPv4 is handled only through the confidential Aligo channel; it is never committed, printed, or included in preflight output. Run `fresh` only before provisioning and `installed` only immediately after bundle staging, before secrets or runtime. After deployment, activation, routing, or recovery, use the installed operator `status` and the action-specific evidence in the LightNode runbook.
