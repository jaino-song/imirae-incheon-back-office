import { GROUPS, type ClientGroup } from "@/components/app/clients/client-detail";
import type { Client } from "@/lib/client/types";

// "최근 활동순" 정렬 키 — clients는 활동 timestamp가 없어 서비스 시작일(startDate) 기준, 동률은 최신 id.
function clientRecency(c: Client): number {
  const t = c.startDate ? new Date(c.startDate).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function buildAllClientRowsForList(clients: Client[]): Client[] {
  return [...clients].sort((a, b) => clientRecency(b) - clientRecency(a) || b.id - a.id);
}

const UNKNOWN_CLIENT_GROUP: ClientGroup = {
  key: "unknown",
  title: "상태 미정",
  badge: "상태 미정",
  badgeTone: "muted",
  badgeMini: "muted",
  match: () => false,
  counter: "명",
};

export function groupForClient(c: Client): ClientGroup {
  return GROUPS.find((g) => g.match(c)) ?? UNKNOWN_CLIENT_GROUP;
}
