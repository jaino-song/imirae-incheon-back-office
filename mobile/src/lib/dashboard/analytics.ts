export interface DashboardAnalytics {
  activeClients: number;
  contractsNotSent: number;
  contractsPendingSignature: number;
  upcomingThisMonth: number;
  upcomingNextMonth: number;
}

export interface DashboardAnalyticsClient {
  serviceStatus: string | null;
  startDate: string | null;
  endDate?: string | null;
  eDocId: string | null;
  documentStatus: string | null;
}

const CONTRACT_START_WINDOW_DAYS = 7;
const SERVICE_START_WINDOW_DAYS = 7;
const EXCLUDED_CONTRACT_START_SERVICE_STATUSES = new Set(["pre_booking", "completed", "terminated"]);
const EXCLUDED_UPCOMING_SERVICE_STATUSES = new Set(["pre_booking", "completed", "terminated"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function dateValue(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// Business time is KST regardless of server timezone (Vercel runs UTC, so
// local-TZ setHours() shifted every window by 9 hours in production). KST is
// a fixed UTC+9 offset with no DST, so day/month boundaries reduce to plain
// offset arithmetic.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfKstDay(date: Date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - KST_OFFSET_MS);
}

function endOfKstDay(date: Date) {
  return new Date(startOfKstDay(date).getTime() + DAY_MS - 1);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function kstMonthIndex(date: Date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return shifted.getUTCFullYear() * 12 + shifted.getUTCMonth();
}

export function isContractIncompleteNearServiceStart(
  client: DashboardAnalyticsClient,
  now = new Date(),
): boolean {
  const serviceStatus = client.serviceStatus ?? "";
  if (EXCLUDED_CONTRACT_START_SERVICE_STATUSES.has(serviceStatus)) return false;
  if (client.documentStatus === "completed") return false;

  const startDate = dateValue(client.startDate);
  if (!startDate) return false;

  const windowStart = addDays(startOfKstDay(now), -CONTRACT_START_WINDOW_DAYS);
  const windowEnd = addDays(endOfKstDay(now), CONTRACT_START_WINDOW_DAYS);

  return startDate >= windowStart && startDate <= windowEnd;
}

export function isServiceStartingWithinWeek(
  client: DashboardAnalyticsClient,
  now = new Date(),
): boolean {
  const serviceStatus = client.serviceStatus ?? "";
  if (EXCLUDED_UPCOMING_SERVICE_STATUSES.has(serviceStatus)) return false;

  const startDate = dateValue(client.startDate);
  if (!startDate) return false;

  const windowStart = startOfKstDay(now);
  const windowEnd = addDays(endOfKstDay(now), SERVICE_START_WINDOW_DAYS);

  return startDate >= windowStart && startDate <= windowEnd;
}

export function normalizeDashboardAnalyticsPayload(payload: unknown): DashboardAnalytics | null {
  if (!isRecord(payload)) return null;

  const clients = isRecord(payload.clients) ? payload.clients : {};
  const schedules = isRecord(payload.schedules) ? payload.schedules : {};
  const documents = isRecord(payload.documents) ? payload.documents : {};

  const activeClients =
    numberValue(payload.activeClients) ??
    numberValue(clients.active);
  const contractsNotSent =
    numberValue(payload.contractsNotSent) ??
    numberValue(documents.notSent) ??
    numberValue(documents.pendingSend);
  const contractsPendingSignature =
    numberValue(payload.contractsPendingSignature) ??
    numberValue(documents.pendingSignatures);
  const upcomingThisMonth =
    numberValue(payload.upcomingThisMonth) ??
    numberValue(schedules.startingThisMonth) ??
    numberValue(schedules.upcomingThisMonth);
  const upcomingNextMonth =
    numberValue(payload.upcomingNextMonth) ??
    numberValue(schedules.startingNextMonth) ??
    0;

  if (
    activeClients === undefined &&
    contractsNotSent === undefined &&
    contractsPendingSignature === undefined &&
    upcomingThisMonth === undefined
  ) {
    return null;
  }

  return {
    activeClients: activeClients ?? 0,
    contractsNotSent: contractsNotSent ?? 0,
    contractsPendingSignature: contractsPendingSignature ?? 0,
    upcomingThisMonth: upcomingThisMonth ?? 0,
    upcomingNextMonth,
  };
}

export function deriveDashboardAnalyticsFromClients(
  clients: DashboardAnalyticsClient[],
  now = new Date(),
): DashboardAnalytics {
  const today = startOfKstDay(now);
  const nextMonthIndex = kstMonthIndex(now) + 1;

  return clients.reduce<DashboardAnalytics>(
    (acc, client) => {
      if (client.serviceStatus === "active") {
        acc.activeClients += 1;
      }

      const startDate = dateValue(client.startDate);
      if (isServiceStartingWithinWeek(client, today)) {
        acc.upcomingThisMonth += 1;
      }

      if (startDate && client.serviceStatus !== "terminated") {
        if (kstMonthIndex(startDate) === nextMonthIndex) {
          acc.upcomingNextMonth += 1;
        }
      }

      // The client projection cannot distinguish provider-review workflow state
      // from other unfinished states. Only the dedicated server analytics payload
      // may populate contractsPendingSignature; the offline fallback stays at zero.

      if (isContractIncompleteNearServiceStart(client, today)) {
        acc.contractsNotSent += 1;
      }

      return acc;
    },
    {
      activeClients: 0,
      contractsNotSent: 0,
      contractsPendingSignature: 0,
      upcomingThisMonth: 0,
      upcomingNextMonth: 0,
    },
  );
}
