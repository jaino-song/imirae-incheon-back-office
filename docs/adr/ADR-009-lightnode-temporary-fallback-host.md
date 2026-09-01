# ADR-009: LightNode temporary fallback host

For the manual temporary fallback path, select LightNode Korea VPS Agency shared 2 vCPU/4 GB/50 GB NVMe on demand and Release it afterward. This supersedes only physical Covenant-host placement for this temporary path. ADR-007/ADR-008 automatic control-plane history remains unchanged.

The admission check is read-only and has two explicit modes: `fresh` proves a host has no Fallback Server or controller residue; `installed` proves the protected root-owned bundle and state are internally consistent. It does not provision, approve, copy secrets, alter routing, start Compose, or contact a provider.

Provisioning is a separately approved, root-only operation. The approved fallback IPv4 is handled only through the confidential Aligo channel; it is never committed, printed, or included in preflight output. After every transition boundary, rerun the applicable preflight before the next approved action.
