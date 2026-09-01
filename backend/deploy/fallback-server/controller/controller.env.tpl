# Fallback controller environment manifest.
#
# This file is a safe template only. The installer does not create or copy the
# live controller.env. Provision the root-owned 0600 file at
# /opt/babyjamjam-fallback-server/controller.env separately.

# Fail closed until the operator explicitly arms the controller.
FAILOVER_CONTROLLER_ENABLED=false
FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED=false

# Sentry Internal Integration allowlist (values supplied out of band).
FAILOVER_SENTRY_CLIENT_SECRET=
FAILOVER_SENTRY_INSTALLATION_ID=
FAILOVER_SENTRY_ORGANIZATION_ID=
FAILOVER_SENTRY_PROJECT_ID=
FAILOVER_SENTRY_ALERT_ID=
FAILOVER_SENTRY_MONITOR_ID=

# Fixed, allowlisted readiness URLs. Leave blank until the live contract is verified.
FAILOVER_PRIMARY_HEALTH_URL=
FAILOVER_FALLBACK_HEALTH_URL=

# Vercel DNS write credentials and immutable record scope.
FAILOVER_VERCEL_API_TOKEN=
FAILOVER_VERCEL_TEAM_ID=
FAILOVER_VERCEL_DNS_RECORD_ID=

# Public origin values are supplied only after network preflight and rehearsal.
FAILOVER_PRIMARY_IPV4=
FAILOVER_FALLBACK_IPV4=

# Immutable production release identity (required when enabled; supplied out of band).
FAILOVER_EXPECTED_IMAGE_TAG=
FAILOVER_EXPECTED_IMAGE_DIGEST=
