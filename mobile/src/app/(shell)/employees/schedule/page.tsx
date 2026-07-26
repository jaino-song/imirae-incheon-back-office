"use client";

import { useMemo } from "react";

import { useClients } from "@/hooks/useClients";
import type { Client } from "@/lib/client/types";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import "@/components/app/mobile-redesign/redesign.css";

type ScheduleKind = "start" | "end" | "replacement";

interface ScheduleEntry {
  id: string;
  kind: ScheduleKind;
  dateISO: string;
  dateLabel: string;
  title: string;
  meta: string;
}

function formatDate(date: Date): string {
  return formatDateForDisplay(date);
}

function clientEmployeeMeta(c: Client): string {
  return c.primaryEmployee?.name ? `${c.primaryEmployee.name} 담당` : "제공인력 미배정";
}

function buildEntries(clients: Client[]): ScheduleEntry[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(today.getDate() + 30);
  horizon.setHours(23, 59, 59, 999);

  const entries: ScheduleEntry[] = [];

  for (const client of clients) {
    if (client.serviceStatus === "replacement_requested") {
      const fallback = today.toISOString();
      const date = today;
      const label = formatDate(date);
      entries.push({
        id: `${client.id}-replacement`,
        kind: "replacement",
        dateISO: fallback,
        dateLabel: label,
        title: `${client.name} 교체 요청`,
        meta: clientEmployeeMeta(client),
      });
    }

    if (client.startDate && client.serviceStatus !== "terminated") {
      const date = new Date(client.startDate);
      if (!Number.isNaN(date.getTime())) {
        date.setHours(0, 0, 0, 0);
        if (date >= today && date <= horizon) {
          const label = formatDate(date);
          entries.push({
            id: `${client.id}-start`,
            kind: "start",
            dateISO: date.toISOString(),
            dateLabel: label,
            title: `${client.name} 서비스 시작`,
            meta: clientEmployeeMeta(client),
          });
        }
      }
    }

    if (client.endDate && client.serviceStatus === "active") {
      const date = new Date(client.endDate);
      if (!Number.isNaN(date.getTime())) {
        date.setHours(0, 0, 0, 0);
        if (date >= today && date <= horizon) {
          const label = formatDate(date);
          entries.push({
            id: `${client.id}-end`,
            kind: "end",
            dateISO: date.toISOString(),
            dateLabel: label,
            title: `${client.name} 서비스 종료`,
            meta: clientEmployeeMeta(client),
          });
        }
      }
    }
  }

  entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return entries;
}

const KIND_TONE: Record<ScheduleKind, string> = {
  start: "bg-v3-primary",
  end: "bg-v3-orange",
  replacement: "bg-v3-burgundy",
};

export default function EmployeeSchedulePage() {
  const { data, isLoading, isError } = useClients(1, 50);
  const entries = useMemo(() => buildEntries(data?.data ?? []), [data?.data]);

  return (
    <section className="shell-content flex flex-col" data-component="mobile_employees-schedule_screen_root">
      <div className="list-card">
        <div className="list-title">
          <span className="list-title-text">
            일정 캘린더
            <span className="list-count">앞으로 30일</span>
          </span>
        </div>
        <div className="list-card-scroll">
          {isLoading ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                fontSize: "0.82rem",
                color: "hsl(var(--v3-text-muted))",
              }}
              data-component="mobile_employees-schedule_screen_root_list-card_loading"
            >
              불러오는 중...
            </div>
          ) : isError ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                fontSize: "0.82rem",
                color: "hsl(var(--v3-burgundy))",
              }}
              data-component="mobile_employees-schedule_screen_root_list-card_error"
            >
              일정을 불러오지 못했습니다.
            </div>
          ) : entries.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                fontSize: "0.82rem",
                color: "hsl(var(--v3-text-muted))",
              }}
              data-component="mobile_employees-schedule_screen_root_list-card_empty"
            >
              앞으로 30일 일정이 없습니다.
            </div>
          ) : (
            entries.map((entry) => (
              <div
                className="list-item"
                data-component="mobile_employees-schedule_screen_root_list-card_row"
                data-kind={entry.kind}
                key={entry.id}
              >
                <div className={`list-avatar ${KIND_TONE[entry.kind]}`}>{entry.dateLabel}</div>
                <div className="list-info">
                  <div className="list-name">{entry.title}</div>
                  <div className="list-meta">
                    {entry.dateLabel}
                  </div>
                </div>
                <div className="list-right">
                  <span className="dday-sub">{entry.meta}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
