import type { Client } from "@/lib/client/types";
import {
  diffBusinessDaysKr,
  isBusinessDayKr,
  isoDateInKorea,
} from "@/lib/date/business-days";

export interface DashboardClientDue {
  label: string;
}

function normalizeIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return isoDateInKorea(date);
}

function businessDayDiff(targetDate: string | null | undefined, today = new Date()) {
  const targetIso = normalizeIsoDate(targetDate);
  if (!targetIso) return null;
  return diffBusinessDaysKr(targetIso, isoDateInKorea(today));
}

export function isServiceEndingNextBusinessDay(
  client: Pick<Client, "serviceStatus" | "endDate">,
  today = new Date(),
): boolean {
  if (client.serviceStatus !== "active") {
    return false;
  }

  const todayIso = isoDateInKorea(today);
  return isBusinessDayKr(todayIso) && businessDayDiff(client.endDate, today) === 1;
}

function formatBusinessDue(prefix: string, diff: number) {
  if (diff < 0) return `${prefix} ${Math.abs(diff)} 영업일 경과`;
  if (diff === 0) return `${prefix} 오늘`;
  return `${prefix} ${diff} 영업일 남음`;
}

export function getServiceStartDueLabel(
  startDate: string | null | undefined,
  today = new Date(),
): string | null {
  const diff = businessDayDiff(startDate, today);
  return diff === null ? null : formatBusinessDue("서비스 시작", diff);
}

export function getServiceEndDueLabel(
  endDate: string | null | undefined,
  today = new Date(),
): string | null {
  const diff = businessDayDiff(endDate, today);
  return diff === null ? null : formatBusinessDue("서비스 종료", diff);
}

function getReplacementRequestDueLabel(
  requestedAt: string | null | undefined,
  today = new Date(),
): string | null {
  const diff = businessDayDiff(requestedAt, today);
  return diff === null ? null : formatBusinessDue("교체 요청", diff);
}

export function getDashboardClientDueLabel(
  client: Pick<Client, "serviceStatus" | "startDate" | "endDate" | "createdAt">,
  options: { contractRequired?: boolean; upcoming?: boolean; today?: Date } = {},
): string | null {
  const today = options.today ?? new Date();

  if (options.contractRequired || options.upcoming || client.serviceStatus === "waiting") {
    return getServiceStartDueLabel(client.startDate, today);
  }

  switch (client.serviceStatus) {
    case "active":
      return getServiceEndDueLabel(client.endDate, today);
    case "replacement_requested":
      return getReplacementRequestDueLabel(client.createdAt, today);
    case "completed":
    case "terminated":
      return null;
    default:
      return null;
  }
}
