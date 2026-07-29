"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { SignaturePad } from "@/components/app/service-record/SignaturePad";
import { DEFAULT_PROVIDER_NAME, ProviderInfo } from "@/components/service-record/provider-info";
import { isBusinessDayKr, isoDateInKorea, nextBusinessDayKr } from "@/lib/date/business-days";
import {
    isDayButtonDisabled,
    isServiceDateMismatch,
} from "@/lib/service-records/page-helpers";
import {
    captureServiceRecordError,
    captureServiceRecordResponseError,
    getServiceRecordOperation,
} from "@/lib/observability/capture-service-record-error";

/* ───────────────────────── form definition (mirrors the 제공기록지) ───────────────────────── */

type ItemType = "multi" | "radio" | "counts" | "stool" | "textarea" | "confirm";
interface DailyItem {
    key: string;
    label: string;
    type: ItemType;
    opts?: string[];
    counts?: { k: string; label: string; unit: string }[];
    maxLength?: number;
}

const SERVICE_RECORD_TEXT_LIMITS = {
    etcService: 40,
    notes: 80,
} as const;

const DAILY_ITEMS: DailyItem[] = [
    { key: "perineum", label: "① 회음절개부위 (또는 수술부위)", type: "multi", opts: ["이상없음", "열상", "혈종", "불편감"] },
    { key: "breast", label: "② 유방상태", type: "multi", opts: ["이상없음", "울혈", "통증"] },
    { key: "excretion", label: "③ 배뇨/배변", type: "multi", opts: ["이상없음", "불편감"] },
    { key: "sitzBath", label: "④ 좌욕", type: "radio", opts: ["실시", "미실시"] },
    { key: "meals", label: "⑤ 식사/간식", type: "counts", counts: [{ k: "meal", label: "식사", unit: "회" }, { k: "snack", label: "간식", unit: "회" }] },
    { key: "temperature", label: "⑥ 체온", type: "counts", counts: [{ k: "temp", label: "체온", unit: "℃" }] },
    { key: "sleep", label: "⑦ 수면 양상", type: "radio", opts: ["잘 잠", "잘 못 잠"] },
    { key: "breastFeeding", label: "⑧ 모유수유", type: "counts", counts: [{ k: "count", label: "횟수", unit: "회" }] },
    { key: "formulaFeeding", label: "⑨ 분유수유", type: "counts", counts: [{ k: "count", label: "횟수", unit: "회" }, { k: "ml", label: "회당", unit: "ml" }] },
    { key: "stool", label: "⑩ 배변양상", type: "stool", opts: ["정상변", "이상변"] },
    { key: "bath", label: "⑪ 목욕·제대관리", type: "radio", opts: ["실시", "미실시"] },
    {
        key: "etcService",
        label: "기타 서비스 (필요 시 기재)",
        type: "textarea",
        maxLength: SERVICE_RECORD_TEXT_LIMITS.etcService,
    },
    {
        key: "notes",
        label: "특이사항 (필요 시 기재)",
        type: "textarea",
        maxLength: SERVICE_RECORD_TEXT_LIMITS.notes,
    },
    { key: "paymentConfirmed", label: "결제 확인", type: "confirm" },
];
interface DayPage {
    title: string;
    items: number[];
    confirmation?: boolean;
}

const DAY_PAGES: DayPage[] = [
    { title: "산모 기록", items: [0, 1, 2, 3, 4] },
    { title: "신생아 기록", items: [5, 6, 7, 8, 9, 10] },
    { title: "서비스 기록", items: [11, 12, 13] },
    {
        title: "기록 내용 확인",
        items: [],
        confirmation: true,
    },
];

const MOM_APPROVAL_APPROVED = "approved";
const REVIEW_EMPTY_LABEL = "입력 없음";
const DRAFT_STORAGE_PREFIX = "daily-service-record-draft";
const FINALIZED_RECORD_STATUSES = new Set([
    "FINALIZING",
    "DOCUMENTS_CREATED",
    "COMPLETED",
    "FINALIZATION_FAILED",
]);
const DEFAULT_DAILY_ANSWERS: Record<string, unknown> = {
    perineum: ["이상없음"],
    breast: ["이상없음"],
    excretion: ["이상없음"],
    sitzBath: "실시",
    sleep: "잘 잠",
    stool: "정상변",
    bath: "실시",
};

/* ───────────────────────── types from the backend ───────────────────────── */

interface SessionRow {
    sessionIndex: number;
    serviceDate: string;
    locked: boolean;
    answers?: Record<string, unknown>;
    etcService?: string | null;
    notes?: string | null;
    paymentConfirmed?: boolean;
    momApproval?: string | null;
    clientSignature?: string | null;
    clientSignedAt?: string | null;
}
interface ServiceRecordContext {
    org?: { name: string };
    employee: { id: number; name: string };
    client: { id: number; name: string };
    totalSessions: number;
    startDate: string | null;
    header: Record<string, unknown> | null;
    sessions: SessionRow[];
    recordStatus?: string | null;
    canEditHeader?: boolean;
    pendingScheduleChange?: { id: string; sessionIndex: number; fromDate: string; toDate: string } | null;
}

interface ScheduleChangePreview {
    sessionIndex: number;
    fromDate: string;
    toDate: string;
}

const HEADER_FIELDS = [
    { k: "momName", label: "산모 성명", ph: "예) 홍길동" },
    { k: "momBirth", label: "산모 생년월일 (YYMMDD)", ph: "예) 900101" },
    { k: "babyName", label: "신생아 성명", ph: "예) 홍아기" },
    { k: "babyBirth", label: "신생아 출생일자 (YYMMDD)", ph: "예) 260615" },
    { k: "babyWeight", label: "신생아 몸무게 (kg)", ph: "예) 3.2" },
];

/* ───────────────────────── helpers ───────────────────────── */

const mmdd = (iso: string) => (iso ? iso.slice(0, 10).replaceAll("-", ".") : "");
const monthDayKo = (iso: string) => {
    const [, month = "", day = ""] = iso.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
    return iso ? `${iso.slice(0, 4)}.${month}.${day}` : "";
};
interface StoredFormState {
    header?: Record<string, string>;
    day?: number;
    pageIdx?: number;
    draft?: Record<string, unknown>;
}
const draftStorageKey = (token: string) => `${DRAFT_STORAGE_PREFIX}:${token}`;
const readStoredFormState = (token: string): StoredFormState | null => {
    if (typeof window === "undefined" || !token) return null;
    try {
        const raw = window.sessionStorage.getItem(draftStorageKey(token));
        return raw ? JSON.parse(raw) as StoredFormState : null;
    } catch {
        return null;
    }
};
const writeStoredFormState = (token: string, value: StoredFormState) => {
    if (typeof window === "undefined" || !token) return;
    try {
        window.sessionStorage.setItem(draftStorageKey(token), JSON.stringify(value));
    } catch {
        // The form remains usable when session storage is unavailable.
    }
};
const clearStoredFormState = (token: string) => {
    if (typeof window === "undefined" || !token) return;
    try {
        window.sessionStorage.removeItem(draftStorageKey(token));
    } catch {
        // Ignore storage cleanup failures after a successful server submission.
    }
};
const hasDisplayValue = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(hasDisplayValue);
    if (typeof value === "string") return value.trim().length > 0;
    return true;
};

function isRecordFinalizedStatus(recordStatus?: string | null): boolean {
    return Boolean(recordStatus && FINALIZED_RECORD_STATUSES.has(recordStatus));
}
const REVIEW_SECTIONS = [
    { id: "mom", title: "산모", tone: "mom", fields: DAILY_ITEMS.slice(0, 5) },
    { id: "baby", title: "신생아", tone: "baby", fields: DAILY_ITEMS.slice(5, 11) },
    { id: "finish", title: "서비스 기록", tone: "finish", fields: DAILY_ITEMS.slice(11, 14) },
] as const;

function sectionToneClass(tone: "mom" | "baby" | "finish") {
    if (tone === "mom") return "mom";
    if (tone === "baby") return "baby";
    return "etc";
}

function formatReviewFieldValue(
    field: DailyItem,
    draft: Record<string, unknown>,
): { value: string; ok?: boolean } {
    if (field.type === "confirm") {
        return Boolean(draft[field.key]) ? { value: "✓ 확인 완료", ok: true } : { value: "" };
    }

    if (field.type === "multi") {
        const value = draft[field.key];
        const values = Array.isArray(value) ? value.filter(hasDisplayValue).map((item) => String(item).trim()) : [];
        return { value: values.join(", ") };
    }

    if (field.type === "radio" || field.type === "stool") {
        const value = hasDisplayValue(draft[field.key]) ? String(draft[field.key]).trim() : "";
        const colorValue = field.key === "stool" && hasDisplayValue(draft.stool_color)
            ? String(draft.stool_color).trim()
            : "";
        if (value && colorValue) return { value: `${value} (${colorValue})` };
        return { value };
    }

    if (field.type === "counts") {
        const parts = (field.counts ?? [])
            .map((count) => {
                const value = draft[`${field.key}_${count.k}`];
                if (!hasDisplayValue(value)) return null;
                const prefix = count.label === "횟수" || count.label === "체온" ? "" : `${count.label} `;
                return `${prefix}${String(value).trim()}${count.unit}`;
            })
            .filter((part): part is string => Boolean(part));
        return { value: parts.join(" · ") };
    }

    const value = draft[field.key];
    return { value: hasDisplayValue(value) ? String(value).trim() : "" };
}

type Screen = "loading" | "invalid" | "phone" | "service" | "overview" | "day" | "done" | "header-edit-done";
type HistoryMode = "none" | "push" | "replace";

interface WizardHistoryTarget {
    screen: "phone" | "service" | "overview" | "day" | "done" | "header-edit-done";
    day?: number;
    pageIdx?: number;
}

const HISTORY_SCREENS = new Set<WizardHistoryTarget["screen"]>([
    "phone",
    "service",
    "overview",
    "day",
    "done",
    "header-edit-done",
]);

function writeWizardHistory(
    screen: Screen,
    mode: Exclude<HistoryMode, "none">,
    day?: number,
    pageIdx?: number,
): void {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    if (HISTORY_SCREENS.has(screen as WizardHistoryTarget["screen"])) {
        url.searchParams.set("step", screen);
    } else {
        url.searchParams.delete("step");
    }
    if (screen === "day" && day !== undefined && pageIdx !== undefined) {
        url.searchParams.set("day", String(day));
        url.searchParams.set("page", String(pageIdx));
    } else {
        url.searchParams.delete("day");
        url.searchParams.delete("page");
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (mode === "push") window.history.pushState(null, "", nextUrl);
    else window.history.replaceState(null, "", nextUrl);
}

function readWizardHistory(): WizardHistoryTarget | null {
    if (typeof window === "undefined") return null;

    const params = new URLSearchParams(window.location.search);
    const screen = params.get("step");
    if (!screen || !HISTORY_SCREENS.has(screen as WizardHistoryTarget["screen"])) return null;
    if (screen !== "day") return { screen: screen as WizardHistoryTarget["screen"] };

    const rawDay = params.get("day");
    const rawPageIdx = params.get("page");
    if (rawDay === null || rawPageIdx === null) return null;

    const day = Number(rawDay);
    const pageIdx = Number(rawPageIdx);
    if (!Number.isInteger(day) || !Number.isInteger(pageIdx)) return null;
    return { screen: "day", day, pageIdx };
}

export default function ServiceRecordPage() {
    const params = useParams<{ token: string }>();
    const token = params?.token ?? "";

    const [screen, setScreen] = useState<Screen>("loading");
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState<string | null>(null);
    const [ctx, setCtx] = useState<ServiceRecordContext | null>(null);
    const [header, setHeader] = useState<Record<string, string>>({ deliveryType: "자연분만" });
    const [day, setDay] = useState(1);
    const [pageIdx, setPageIdx] = useState(0);
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const [editing, setEditing] = useState(false);
    const [clientSignature, setMomSignature] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [submitModalOpen, setSubmitModalOpen] = useState(false);
    const [scheduleChangePreview, setScheduleChangePreview] = useState<ScheduleChangePreview | null>(null);
    const [scheduleChangeModalOpen, setScheduleChangeModalOpen] = useState(false);
    const [scheduleChangeBusy, setScheduleChangeBusy] = useState(false);
    const [errorNotificationMessage, setErrorNotificationMessage] = useState<string | null>(null);

    const navigateTo = useCallback((
        nextScreen: Screen,
        options: { mode?: HistoryMode; day?: number; pageIdx?: number } = {},
    ) => {
        setScreen(nextScreen);
        if (options.day !== undefined) setDay(options.day);
        if (options.pageIdx !== undefined) setPageIdx(options.pageIdx);
        if (options.mode && options.mode !== "none") {
            writeWizardHistory(nextScreen, options.mode, options.day, options.pageIdx);
        }
    }, []);

    const api = useCallback(
        async (
            path: string,
            init: RequestInit = {},
            includeJsonHeaders = true,
        ) => {
            const method = init.method ?? "GET";
            const monitoredPath = `/api/service-record/[Filtered]${path}`;
            const operation = getServiceRecordOperation(path);

            try {
                const url = `/api/service-record/${token}${path}`;
                const response = includeJsonHeaders
                    ? await fetch(url, {
                        ...init,
                        headers: {
                            "Content-Type": "application/json",
                            ...(init.headers ?? {}),
                        },
                    })
                    : await fetch(url);

                captureServiceRecordResponseError(response, {
                    operation,
                    method,
                    path: monitoredPath,
                });
                return response;
            } catch (error) {
                captureServiceRecordError(error, {
                    operation,
                    method,
                    path: monitoredPath,
                });
                throw error;
            }
        },
        [token],
    );

    const loadContext = useCallback(async (historyMode: HistoryMode = "replace") => {
        const res = await api("/context");
        if (!res.ok) {
            navigateTo(res.status === 401 || res.status === 403 ? "phone" : "invalid", { mode: historyMode });
            return;
        }
        const data: ServiceRecordContext = await res.json();
        const stored = readStoredFormState(token);
        const serverHeader = (data.header as Record<string, string>) ?? {};
        const nextHeader = data.header
            ? { deliveryType: "자연분만", ...serverHeader }
            : { deliveryType: "자연분만", ...(stored?.header ?? {}) };
        setCtx(data);
        setHeader(nextHeader);

        if (data.canEditHeader) {
            setEditing(false);
            setMomSignature(null);
            navigateTo("service", { mode: historyMode });
            return;
        }

        const submittedCount = data.sessions.filter((session) => session.locked).length;
        if (data.totalSessions > 0 && submittedCount === data.totalSessions) {
            clearStoredFormState(token);
            setEditing(false);
            setMomSignature(null);
            navigateTo("done", { mode: historyMode });
            return;
        }

        setEditing(false);
        setMomSignature(null);
        navigateTo(data.header ? "overview" : "service", { mode: historyMode });
    }, [api, navigateTo, token]);

    // Exchange the admin capability before loading context. The URL fragment is
    // removed immediately so the short-lived token is not retained in history.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const fragment = new URLSearchParams(window.location.hash.slice(1));
                const headerEditCapability = fragment.get("header-edit");
                if (headerEditCapability) {
                    const url = new URL(window.location.href);
                    url.hash = "";
                    window.history.replaceState(null, "", `${url.pathname}${url.search}`);

                    const authorization = await api("/header-edit/authorize", {
                        method: "POST",
                        headers: { Authorization: `Bearer ${headerEditCapability}` },
                    });
                    if (!alive) return;
                    if (!authorization.ok) {
                        navigateTo("invalid", { mode: "replace" });
                        return;
                    }
                    await loadContext("replace");
                    return;
                }

                const res = await api("/link", {}, false);
                const data = await res.json();
                if (!alive) return;
                if (!data?.valid) {
                    navigateTo("invalid", { mode: "replace" });
                    return;
                }
                await loadContext("replace");
            } catch {
                if (alive) navigateTo("invalid", { mode: "replace" });
            }
        })();
        return () => { alive = false; };
    }, [api, loadContext, navigateTo, token]);

    useEffect(() => {
        const handlePopState = () => {
            const target = readWizardHistory();
            if (!target) return;

            if (target.screen === "phone") {
                if (ctx?.header) navigateTo("overview", { mode: "replace" });
                else navigateTo("phone", { mode: "none" });
                return;
            }
            if (target.screen === "service") {
                if (ctx?.canEditHeader) {
                    navigateTo("service", { mode: "none" });
                    return;
                }
                if (ctx?.header) navigateTo("overview", { mode: "replace" });
                else navigateTo("service", { mode: "none" });
                return;
            }
            if (target.screen === "overview") {
                navigateTo(ctx?.header ? "overview" : "service", { mode: ctx?.header ? "none" : "replace" });
                return;
            }
            if (target.screen === "done") {
                navigateTo("done", { mode: "none" });
                return;
            }
            if (target.screen === "header-edit-done") {
                navigateTo("header-edit-done", { mode: "none" });
                return;
            }
            if (!ctx?.header || target.day === undefined || target.pageIdx === undefined) {
                navigateTo(ctx?.header ? "overview" : "service", { mode: "replace" });
                return;
            }

            const targetDay = Math.min(Math.max(target.day, 1), Math.max(ctx.totalSessions, 1));
            const targetPageIdx = Math.min(Math.max(target.pageIdx, 0), DAY_PAGES.length - 1);
            const session = ctx.sessions.find((row) => row.sessionIndex === targetDay);
            const isLockedSession = Boolean(session?.locked);
            setEditing(isLockedSession);
            setMomSignature(null);
            if (isLockedSession && session) {
                setDraft({
                    _date: session.serviceDate.slice(0, 10),
                    ...(session.answers ?? {}),
                    etcService: session.etcService ?? "",
                    notes: session.notes ?? "",
                    paymentConfirmed: Boolean(session.paymentConfirmed),
                });
            } else {
                const stored = readStoredFormState(token);
                if (stored?.day === targetDay && stored.draft) setDraft(stored.draft);
            }
            navigateTo("day", {
                mode: "none",
                day: targetDay,
                pageIdx: targetPageIdx,
            });
        };

        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [ctx, navigateTo, token]);

    const lockedDays = useMemo(() => new Set((ctx?.sessions ?? []).filter((s) => s.locked).map((s) => s.sessionIndex)), [ctx]);
    const nextOpenDay = useCallback(() => {
        let d = 1;
        while (lockedDays.has(d)) d++;
        return d;
    }, [lockedDays]);
    const defaultDate = useCallback(
        (d: number) => {
            const sessions = ctx?.sessions ?? [];
            const rawStart = ctx?.startDate ? ctx.startDate.slice(0, 10) : isoDateInKorea();
            const start = isBusinessDayKr(rawStart) ? rawStart : nextBusinessDayKr(rawStart);
            // Row-first recursive chain: an existing row's date (e.g. an approved
            // postpone) shifts every later default, not just the next session.
            const chain = (k: number): string => {
                const row = sessions.find((s) => s.sessionIndex === k);
                if (row) return row.serviceDate.slice(0, 10);
                if (k <= 1) return start;
                return nextBusinessDayKr(chain(k - 1));
            };
            return chain(d);
        },
        [ctx?.sessions, ctx?.startDate],
    );

    async function submitPhone() {
        if (phone.replace(/\D/g, "").length < 10) { setPhoneError("휴대폰 번호를 입력해 주세요."); return; }
        setBusy(true); setPhoneError(null);
        try {
            const res = await api("/verify", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }),
            });
            const data = await res.json();
            if (data?.ok) {
                await loadContext("push");
            } else {
                setPhoneError("휴대폰 번호가 일치하지 않습니다.");
            }
        } catch {
            setPhoneError("확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        } finally { setBusy(false); }
    }
    function handlePhoneChange(value: string) {
        const digits = value.replace(/\D/g, "").slice(0, 11);
        if (digits.length <= 3) setPhone(digits);
        else if (digits.length <= 7) setPhone(`${digits.slice(0, 3)}-${digits.slice(3)}`);
        else {
            const middleEnd = digits.length === 10 ? 6 : 7;
            setPhone(`${digits.slice(0, 3)}-${digits.slice(3, middleEnd)}-${digits.slice(middleEnd)}`);
        }
    }
    useEffect(() => {
        if (screen === "service") {
            writeStoredFormState(token, { ...(readStoredFormState(token) ?? {}), header });
            return;
        }
        if (screen === "day" && !editing) {
            writeStoredFormState(token, { header, day, pageIdx, draft });
        }
    }, [day, draft, editing, header, pageIdx, screen, token]);

    async function saveHeader() {
        setBusy(true);
        try {
            const response = await api("/header", { method: "PUT", body: JSON.stringify(header) });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                setErrorNotificationMessage(error?.message ?? "기본정보 저장에 실패했습니다.");
                return;
            }
            clearStoredFormState(token);
            if (ctx?.canEditHeader) {
                navigateTo("header-edit-done", { mode: "replace" });
                return;
            }
            await loadContext("replace");
        } finally { setBusy(false); }
    }

    function openDay(d: number, editExisting = false) {
        const session = ctx?.sessions.find((row) => row.sessionIndex === d);
        const shouldEdit = editExisting || Boolean(session?.locked);
        if (shouldEdit && !session?.locked) return;
        if (!shouldEdit && d !== nextOpenDay()) return;

        setEditing(shouldEdit);
        setMomSignature(null);
        let initialPageIdx: number;
        if (shouldEdit && session) {
            initialPageIdx = DAY_PAGES.length - 1;
            setDraft({
                _date: session.serviceDate.slice(0, 10),
                ...(session.answers ?? {}),
                etcService: session.etcService ?? "",
                notes: session.notes ?? "",
                paymentConfirmed: Boolean(session.paymentConfirmed),
            });
        } else {
            const stored = readStoredFormState(token);
            const canRestoreDraft = stored?.day === d && Boolean(stored.draft);
            initialPageIdx = canRestoreDraft
                ? Math.min(Math.max(stored?.pageIdx ?? 0, 0), DAY_PAGES.length - 1)
                : 0;
            setDraft(canRestoreDraft && stored?.draft
                ? stored.draft
                : { _date: defaultDate(d), ...DEFAULT_DAILY_ANSWERS });
        }
        navigateTo("day", { mode: "push", day: d, pageIdx: initialPageIdx });
    }

    async function submitDay() {
        const serviceDate = (draft["_date"] as string) ?? defaultDate(day);
        setBusy(true);
        try {
            const currentSession = ctx?.sessions.find((session) => session.sessionIndex === day);
            const body = {
                serviceDate: editing ? currentSession?.serviceDate.slice(0, 10) ?? serviceDate : serviceDate,
                answers: Object.fromEntries(Object.entries(draft).filter(([k]) => !k.startsWith("_"))),
                etcService: (draft["etcService"] as string) ?? undefined,
                notes: (draft["notes"] as string) ?? undefined,
                paymentConfirmed: Boolean(draft["paymentConfirmed"]),
                momApproval: MOM_APPROVAL_APPROVED,
                ...(!currentSession?.clientSignature && clientSignature ? { clientSignature } : {}),
            };
            const res = await api(`/sessions/${day}/submit`, { method: "POST", body: JSON.stringify(body) });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                if (e?.code === "CLIENT_SIGNATURE_REQUIRED") {
                    setErrorNotificationMessage("산모 서명이 필요합니다.");
                } else if (e?.code === "SERVICE_DATE_IMMUTABLE") {
                    setErrorNotificationMessage(e?.message ?? "제공일자는 변경할 수 없습니다.");
                } else {
                    setErrorNotificationMessage(e?.message ?? "제출에 실패했습니다.");
                }
                return;
            }
            if (!editing) clearStoredFormState(token);
            setSubmitModalOpen(false);
            setEditing(false);
            setMomSignature(null);
            await loadContext("push");
        } finally { setBusy(false); }
    }

    async function openScheduleChangePreview() {
        setScheduleChangePreview(null);
        setScheduleChangeModalOpen(true);
        setScheduleChangeBusy(true);
        try {
            const res = await api("/schedule-change/preview");
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setScheduleChangeModalOpen(false);
                setErrorNotificationMessage(data?.error ?? data?.message ?? "일정 변경 정보를 불러오지 못했습니다.");
                return;
            }
            setScheduleChangePreview(data as ScheduleChangePreview);
        } catch {
            setScheduleChangeModalOpen(false);
            setErrorNotificationMessage("일정 변경 정보를 불러오지 못했습니다.");
        } finally {
            setScheduleChangeBusy(false);
        }
    }

    function closeScheduleChangeModal() {
        if (scheduleChangeBusy) return;
        setScheduleChangeModalOpen(false);
        setScheduleChangePreview(null);
    }

    async function submitScheduleChangeRequest() {
        setScheduleChangeBusy(true);
        try {
            const res = await api("/schedule-change", { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (res.ok || (res.status === 409 && data?.code === "REQUEST_ALREADY_PENDING")) {
                setScheduleChangeModalOpen(false);
                setScheduleChangePreview(null);
                await loadContext();
                return;
            }
            setErrorNotificationMessage(data?.error ?? data?.message ?? "일정 변경 요청에 실패했습니다.");
        } finally {
            setScheduleChangeBusy(false);
        }
    }

    /* ───────────────────────── rendering ───────────────────────── */

    const setField = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
    const toggleMulti = (k: string, o: string) =>
        setDraft((d) => {
            const arr = Array.isArray(d[k]) ? [...(d[k] as string[])] : [];
            const i = arr.indexOf(o);
            if (i >= 0) arr.splice(i, 1); else arr.push(o);
            return { ...d, [k]: arr };
        });

    function renderField(it: DailyItem) {
        const v = draft[it.key];
        if (it.type === "multi") {
            return (
                <div data-component="mobile_service-record_wizard_body_day-field_options" className="opts">
                    {it.opts!.map((o) => (
                        <button type="button" key={o} aria-pressed={Array.isArray(v) && (v as string[]).includes(o)} className={`opt ${Array.isArray(v) && (v as string[]).includes(o) ? "sel" : ""}`} onClick={() => toggleMulti(it.key, o)}>
                            <span className="box">✓</span>{o}
                        </button>
                    ))}
                </div>
            );
        }
        if (it.type === "radio" || it.type === "stool") {
            return (
                <>
                    <div data-component="mobile_service-record_wizard_body_day-field_radio-options" className="opts">
                        {it.opts!.map((o) => (
                            <button type="button" key={o} aria-pressed={v === o} className={`opt radio ${v === o ? "sel" : ""}`} onClick={() => setField(it.key, o)}>
                                <span className="box">●</span>{o}
                            </button>
                        ))}
                    </div>
                    {it.type === "stool" && v === "이상변" && (
                        <input className="in" style={{ marginTop: 8 }} placeholder="색깔 등 (이상변 시)"
                            value={(draft[`${it.key}_color`] as string) ?? ""} onChange={(e) => setField(`${it.key}_color`, e.target.value)} />
                    )}
                </>
            );
        }
        if (it.type === "counts") {
            return (
                <div data-component="mobile_service-record_wizard_body_day-field_count-options" className="segrow">
                    {it.counts!.map((c) => (
                        <div data-component="mobile_service-record_wizard_body_day-field_count-options_row" className="segnum" key={c.k}>
                            <span>{c.label}</span>
                            <input type="number" aria-label={c.label} inputMode={c.k === "temp" ? "decimal" : "numeric"} min="0" step={c.k === "temp" ? "0.1" : "1"} value={((draft[`${it.key}_${c.k}`] as string) ?? "")} onChange={(e) => setField(`${it.key}_${c.k}`, e.target.value)} />
                            <span>{c.unit}</span>
                        </div>
                    ))}
                </div>
            );
        }
        if (it.type === "textarea") {
            const placeholder = it.key === "etcService"
                ? "추가사항에 대한 기록 필요 시 기재"
                : "서비스 제공 관련 특이사항 기록 필요 시 기재";
            const dataComponent = it.key === "etcService"
                ? "mobile_service-record_wizard_body_day-field_etc-service"
                : "mobile_service-record_wizard_body_day-field_notes";
            return (
                <textarea
                    data-component={dataComponent}
                    className="ta"
                    value={(v as string) ?? ""}
                    onChange={(e) => setField(it.key, e.target.value)}
                    placeholder={placeholder}
                    maxLength={it.maxLength}
                />
            );
        }
        if (it.type === "confirm") {
            return (
                <div data-component="mobile_service-record_wizard_body_day-field_confirm-options" className="opts">
                    <button type="button" aria-pressed={Boolean(v)} className={`opt ${v ? "sel" : ""}`} onClick={() => setField(it.key, !v)}>
                        <span className="box">✓</span>결제 확인 완료
                    </button>
                </div>
            );
        }
        return null;
    }

    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const isMomConfirmationPage = Boolean(currentDayPage.confirmation);
    const currentServiceDate = ((draft["_date"] as string | undefined) || defaultDate(day));
    const hasServiceDateMismatch = isServiceDateMismatch(currentServiceDate);
    const currentSession = ctx?.sessions.find((session) => session.sessionIndex === day);
    const existingMomSignature = currentSession?.clientSignature ?? null;
    const signatureValue = existingMomSignature ?? clientSignature;
    const isSignatureLocked = Boolean(existingMomSignature);
    const isRecordFinalized = isRecordFinalizedStatus(ctx?.recordStatus);
    const isDailyItemComplete = (item: DailyItem) => {
        const value = draft[item.key];
        if (item.type === "textarea") return true;
        if (item.type === "multi") return Array.isArray(value) && value.length > 0;
        if (item.type === "radio") return hasDisplayValue(value);
        if (item.type === "counts") {
            return item.counts?.every((count) => hasDisplayValue(draft[`${item.key}_${count.k}`])) ?? false;
        }
        if (item.type === "stool") {
            return hasDisplayValue(value) && (value !== "이상변" || hasDisplayValue(draft[`${item.key}_color`]));
        }
        if (item.type === "confirm") return value === true;
        return false;
    };
    const isCurrentPageComplete = currentDayPage.items.every((index) => {
        const item = DAILY_ITEMS[index];
        return item ? isDailyItemComplete(item) : false;
    });
    const isHeaderComplete = HEADER_FIELDS.every((field) => hasDisplayValue(header[field.k]))
        && hasDisplayValue(header.deliveryType);
    const progress = screen === "done" || screen === "header-edit-done"
        ? 100
        : screen === "day"
            ? 20 + Math.round(((pageIdx + 1) / DAY_PAGES.length) * 70)
            : screen === "overview"
                ? 20
                : screen === "service"
                    ? 12
                    : 5;

    return (
        <div data-component="mobile_service-record_wizard" className="srec">
            <Styles />
            <div data-component="mobile_service-record_wizard_top-bar" className="top">
                <h1>산모·신생아 건강관리 서비스 제공기록지</h1>
                <div data-component="mobile_service-record_wizard_top-bar_meta" className="top-meta">
                    <ProviderInfo
                        data-component="mobile_service-record_wizard_top-bar_meta_provider-name"
                        providerName={ctx?.org?.name}
                    />
                    <div data-component="mobile_service-record_wizard_top-bar_meta_crumbs" className="crumbs">
                        {screen === "phone" && <>1단계 · <b>본인 확인</b></>}
                        {screen === "service" && (
                            ctx?.canEditHeader
                                ? <b>서비스 기본정보 수정</b>
                                : <>2단계 · <b>서비스 기본정보</b></>
                        )}
                        {screen === "overview" && <>3단계 · <b>일자별 기록</b></>}
                        {screen === "day" && <><b>{day}회차</b> · {currentDayPage.title} ({pageIdx + 1}/{DAY_PAGES.length})</>}
                        {screen === "done" && <b>최종 제출 완료</b>}
                        {screen === "header-edit-done" && <b>수정 완료</b>}
                    </div>
                </div>
                <div data-component="mobile_service-record_wizard_top-bar_progress" className="bar"><i style={{ width: `${progress}%` }} /></div>
            </div>
            <div
                data-component="mobile_service-record_wizard_body"
                className={`body ${screen === "done" || screen === "header-edit-done" ? "completion-body" : ""}`}
            >
                {screen === "loading" && <p className="muted">불러오는 중…</p>}

                {screen === "invalid" && (
                    <div data-component="mobile_service-record_wizard_body_invalid-center" className="center">
                        <div data-component="mobile_service-record_wizard_body_invalid-center_title" className="step-title">링크를 사용할 수 없습니다</div>
                        <p className="muted">만료되었거나 더 이상 유효하지 않은 링크입니다. 지점에 문의해 주세요.</p>
                    </div>
                )}

                {screen === "phone" && (
                    <>
                        <div data-component="mobile_service-record_wizard_body_phone-title" className="step-title">제공인력 본인 확인</div>
                        <p className="muted">본인 휴대폰 번호를 입력하면 서비스 기간 동안 유효한 접근 권한이 발급됩니다.</p>
                        <label data-component="mobile_service-record_wizard_body_phone-label" className="lab" htmlFor="service-record-phone">휴대폰 번호</label>
                        <input id="service-record-phone" data-component="mobile_service-record_wizard_body_phone-input" className="in" type="tel" inputMode="numeric" autoComplete="tel" maxLength={13} placeholder="예) 01012345678" value={phone} onChange={(e) => handlePhoneChange(e.target.value)} />
                        {phoneError && <p className="err">{phoneError}</p>}
                        <button data-component="mobile_service-record_wizard_body_phone-submit" className="btn primary" disabled={busy} onClick={submitPhone}>{busy ? "확인 중…" : "확인하기"}</button>
                    </>
                )}

                {screen === "service" && (
                    <>
                        {!ctx?.canEditHeader && (
                            <button data-component="mobile_service-record_wizard_body_service-back" className="text-back" type="button" onClick={() => window.history.back()}>이전</button>
                        )}
                        <div data-component="mobile_service-record_wizard_body_service-title" className="step-title">
                            {ctx?.canEditHeader ? "서비스 기본정보 수정" : "서비스 기본정보"}
                        </div>
                        <div data-component="mobile_service-record_wizard_body_readonly-row" className="ro"><span>제공인력</span><b>{ctx?.employee.name}</b></div>
                        <div data-component="mobile_service-record_wizard_body_readonly-row-2" className="ro"><span>제공기관</span><b>{ctx?.org?.name ?? DEFAULT_PROVIDER_NAME}</b></div>
                        {HEADER_FIELDS.slice(0, 4).map((f) => (
                            <div data-component="mobile_service-record_wizard_body_field" className="fld" key={f.k}>
                                <label className="lab">{f.label}</label>
                                <input className="in" placeholder={f.ph} value={header[f.k] ?? ""} onChange={(e) => setHeader((h) => ({ ...h, [f.k]: e.target.value }))} />
                            </div>
                        ))}
                        <div data-component="mobile_service-record_wizard_body_delivery-field" className="fld">
                            <label className="lab">분만형태</label>
                            <div data-component="mobile_service-record_wizard_body_delivery-field_options" className="opts">
                                {["자연분만", "제왕절개"].map((o) => (
                                    <button type="button" key={o} aria-pressed={header["deliveryType"] === o} className={`opt radio ${header["deliveryType"] === o ? "sel" : ""}`} onClick={() => setHeader((h) => ({ ...h, deliveryType: o }))}>
                                        <span className="box">●</span>{o}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div data-component="mobile_service-record_wizard_body_field-2" className="fld">
                            <label className="lab">{HEADER_FIELDS[4]?.label}</label>
                            <input className="in" placeholder={HEADER_FIELDS[4]?.ph} value={header.babyWeight ?? ""} onChange={(e) => setHeader((h) => ({ ...h, babyWeight: e.target.value }))} />
                        </div>
                        <button
                            data-component="mobile_service-record_wizard_body_service-submit"
                            className="btn primary"
                            disabled={busy || !isHeaderComplete}
                            onClick={saveHeader}
                        >
                            {busy ? "저장 중…" : ctx?.canEditHeader ? "수정 완료" : "다음"}
                        </button>
                    </>
                )}

                {screen === "overview" && ctx && (
                    <>
                        <div data-component="mobile_service-record_wizard_body_overview-title" className="step-title">제공기록표</div>
                        <p data-component="mobile_service-record_wizard_body_overview-help" className="muted">제출된 기록은 눌러서 수정할 수 있습니다.</p>
                        <div data-component="mobile_service-record_wizard_body_day-grid" className="days">
                            {Array.from({ length: ctx.totalSessions }, (_, i) => i + 1).map((d) => {
                                const done = lockedDays.has(d);
                                const open = d === nextOpenDay();
                                const cls = done ? "day done" : open ? "day current" : "day locked";
                                return (
                                    <button
                                        type="button"
                                        key={d}
                                        className={cls}
                                        disabled={isDayButtonDisabled({ done, open, isRecordFinalized })}
                                        onClick={() => openDay(d, done)}
                                    >
                                        <div data-component="mobile_service-record_wizard_body_day-grid_day_date" className="d">{mmdd(done ? (ctx.sessions.find((s) => s.sessionIndex === d)?.serviceDate.slice(0, 10) ?? "") : defaultDate(d))}</div>
                                        <div data-component="mobile_service-record_wizard_body_day-grid_day_number" className="n">{d}</div>
                                        <div data-component="mobile_service-record_wizard_body_day-grid_day_status" className="st">{done ? "제출완료" : open ? "입력 가능" : "대기"}</div>
                                    </button>
                                );
                            })}
                        </div>
                        {lockedDays.size < ctx.totalSessions && (
                            <div data-component="mobile_service-record_wizard_body_overview-actions" className="overview-actions">
                                <button className="btn primary" disabled={isRecordFinalized} onClick={() => openDay(nextOpenDay())}>{lockedDays.size ? "다음 회차 입력" : "기록 시작"}</button>
                                <button
                                    className="btn ghost schedule-change"
                                    disabled={isRecordFinalized || scheduleChangeBusy || Boolean(ctx.pendingScheduleChange)}
                                    onClick={openScheduleChangePreview}
                                >
                                    {ctx.pendingScheduleChange ? "일정 변경 요청 대기 중" : "서비스 일정 변경"}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {screen === "day" && (
                    <>
                        <button
                            data-component="mobile_service-record_wizard_body_day-back"
                            className="text-back"
                            type="button"
                            onClick={() => window.history.back()}
                        >
                            이전
                        </button>
                        <div data-component="mobile_service-record_wizard_body_date-chip" className="datechip">
                            {day}회차{editing ? ` · ${monthDayKo(currentServiceDate)}` : ""}
                        </div>
                        {!editing && pageIdx === 0 && (
                            <div data-component="mobile_service-record_wizard_body_service-date-field" className="fld">
                                <label className="lab">제공일자</label>
                                <input type="date" className="in dateinput" value={currentServiceDate} min={day <= 1 ? (ctx?.startDate?.slice(0, 10) ?? undefined) : defaultDate(day)} onChange={(e) => setField("_date", e.target.value)} />
                            </div>
                        )}
                        {!editing && hasServiceDateMismatch && (
                            <div data-component="mobile_service-record_wizard_body_date-mismatch-notice" className="notice">
                                <span>서비스 제공일자({monthDayKo(currentServiceDate)})가 오늘과 달라요. 한번 더 확인해 주세요.</span>
                            </div>
                        )}
                        <div data-component="mobile_service-record_wizard_body_day-title" className="step-title">{currentDayPage.title}</div>
                        {isMomConfirmationPage ? (
                            <>
                                {editing && (
                                    <div data-component="mobile_service-record_wizard_body_resign-notice" className="notice">
                                        <span>이미 제출된 회차입니다.</span>
                                    </div>
                                )}
                                <div data-component="mobile_service-record_wizard_body_handover-banner" className="handover">
                                    <b>최종 기록을 확인해 주세요.</b>
                                </div>
                                <MomConfirmationReview
                                    draft={draft}
                                    editing={editing}
                                    onEdit={(sectionIndex) => navigateTo("day", {
                                        mode: "push",
                                        day,
                                        pageIdx: sectionIndex,
                                    })}
                                />
                                <SignaturePad
                                    data-component="mobile_service-record_wizard_body_mom-sign"
                                    value={signatureValue}
                                    signedAt={currentSession?.clientSignedAt ?? null}
                                    onChange={setMomSignature}
                                    locked={isSignatureLocked}
                                />
                            </>
                        ) : (
                            <>
                                {currentDayPage.items.map((idx) => {
                                    const item = DAILY_ITEMS[idx];
                                    if (!item) return null;
                                    return (
                                        <div data-component="mobile_service-record_wizard_body_day-field" className="fld" key={item.key}>
                                            <label className="lab">{item.label}</label>
                                            {renderField(item)}
                                        </div>
                                    );
                                })}
                            </>
                        )}
                        {isMomConfirmationPage ? (
                            <div data-component="mobile_service-record_wizard_body_confirmation-action" className="nav confirmation-nav">
                                <button className="btn submit" disabled={busy || !signatureValue} onClick={() => setSubmitModalOpen(true)}>확인</button>
                            </div>
                        ) : (
                            <div data-component="mobile_service-record_wizard_body_nav" className="nav">
                                <button
                                    className="btn primary"
                                    disabled={!isCurrentPageComplete}
                                    onClick={() => navigateTo("day", {
                                        mode: "push",
                                        day,
                                        pageIdx: editing ? DAY_PAGES.length - 1 : pageIdx + 1,
                                    })}
                                >
                                    {editing ? "저장" : "다음"}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {screen === "done" && (
                    <div data-component="mobile_service-record_wizard_body_done-center" className="center">
                        <span data-component="mobile_service-record_wizard_body_done-center_icon" className="completion-icon" aria-hidden="true">✅</span>
                        <h2 data-component="mobile_service-record_wizard_body_done-center_title" className="completion-title">제공기록지 제출이 완료되었습니다.</h2>
                    </div>
                )}

                {screen === "header-edit-done" && (
                    <div data-component="mobile_service-record_wizard_body_header-edit-done-center" className="center">
                        <span data-component="mobile_service-record_wizard_body_header-edit-done-center_icon" className="completion-icon" aria-hidden="true">✅</span>
                        <h2 data-component="mobile_service-record_wizard_body_header-edit-done-center_title" className="completion-title">서비스 기본정보 수정이 완료되었습니다.</h2>
                        <p data-component="mobile_service-record_wizard_body_header-edit-done-center_help" className="muted">이 창을 닫아도 됩니다.</p>
                    </div>
                )}
            </div>
            <ApprovalTwoButtonModal
                open={submitModalOpen}
                onOpenChange={setSubmitModalOpen}
                data-component="mobile_service-record_submit-modal"
                title="제출하시겠어요?"
                description={editing
                    ? `확인하면 ${day}회차 기록이 수정 제출됩니다.`
                    : `확인하면 ${day}회차 기록이 제출됩니다.`}
                cancelLabel="취소"
                approvalLabel="확인"
                pendingLabel="제출 중…"
                isPending={busy}
                onApprove={submitDay}
            />
            <MobileTwoButtonModal
                data-component="mobile_service-record_schedule-change-modal"
                open={scheduleChangeModalOpen}
                title={scheduleChangePreview ? `${scheduleChangePreview.sessionIndex}회차 서비스 일정을 조정할까요?` : "서비스 일정 변경"}
                description={scheduleChangePreview
                    ? `${scheduleChangePreview.sessionIndex}회차 서비스를 ${monthDayKo(scheduleChangePreview.fromDate)}에서 ${monthDayKo(scheduleChangePreview.toDate)}로 변경을 요청할까요? 관리자 승인 후 일정이 조정됩니다.`
                    : "변경 가능한 일정을 확인하고 있어요."}
                cancelLabel="취소"
                confirmLabel={scheduleChangeBusy
                    ? scheduleChangePreview ? "요청 중…" : "불러오는 중…"
                    : "승인 요청"}
                loading={scheduleChangeBusy}
                confirmDisabled={!scheduleChangePreview}
                onOpenChange={(open) => {
                    if (!open) closeScheduleChangeModal();
                }}
                onCancel={closeScheduleChangeModal}
                onConfirm={submitScheduleChangeRequest}
            />
            <NotificationOneButtonModal
                open={errorNotificationMessage !== null}
                onOpenChange={(open) => {
                    if (!open) setErrorNotificationMessage(null);
                }}
                data-component="mobile_service-record_error-notification"
                title="요청을 완료하지 못했습니다."
                description={errorNotificationMessage ?? ""}
                isDescriptionVisuallyHidden={false}
                onAcknowledge={() => setErrorNotificationMessage(null)}
            />
        </div>
    );
}

interface MomConfirmationReviewProps {
    draft: Record<string, unknown>;
    editing: boolean;
    onEdit: (sectionIndex: number) => void;
}

function MomConfirmationReview({ draft, editing, onEdit }: MomConfirmationReviewProps) {
    return (
        <div data-component="mobile_service-record_wizard_body_review" className="review">
            {REVIEW_SECTIONS.map((section, sectionIndex) => (
                <section data-component="mobile_service-record_wizard_body_review_section" className="review-section" key={section.id}>
                    <div data-component="mobile_service-record_wizard_body_review_section_header" className="sec-head">
                        <span className={`tag ${sectionToneClass(section.tone)}`}>{section.title}</span>
                        {editing && (
                            <button
                                type="button"
                                className="sec-edit"
                                data-component="mobile_service-record_wizard_body_review_section_header_edit"
                                onClick={() => onEdit(sectionIndex)}
                            >
                                수정
                            </button>
                        )}
                    </div>
                    {section.fields.map((field) => (
                        <ReviewFieldRow key={field.key} field={field} draft={draft} />
                    ))}
                </section>
            ))}
        </div>
    );
}

function ReviewFieldRow({
    field,
    draft,
}: {
    field: DailyItem;
    draft: Record<string, unknown>;
}) {
    const display = formatReviewFieldValue(field, draft);
    const isText = field.type === "textarea";
    const valueClassName = display.value ? (display.ok ? "ok" : "") : "empty";
    const value = display.value || REVIEW_EMPTY_LABEL;

    if (isText) {
        return (
            <div data-component="mobile_service-record_wizard_body_review_section_note" className="review-note">
                <span>{field.label}</span>
                <b className={valueClassName}>{value}</b>
            </div>
        );
    }

    return (
        <div data-component="mobile_service-record_wizard_body_review_section_row" className="review-row">
            <span>{field.label}</span>
            <b className={valueClassName}>{value}</b>
        </div>
    );
}

function Styles() {
    return (
        <style>{`
.srec{--ink:#1c2430;--muted:#7c8798;--line:#e4e8ef;--primary:#004aad;--soft:#f3f6fb;--ok:#004aad;--warn:#c9803a;box-sizing:border-box;max-width:480px;margin:0 auto;min-height:100dvh;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard",Roboto,"Segoe UI",sans-serif;color:var(--ink);display:flex;flex-direction:column}
.srec *{box-sizing:border-box}
.srec .top{background:var(--primary);color:#fff;padding:16px 18px 14px}
.srec .top h1{font-size:15px;margin:0;font-weight:700;letter-spacing:-.2px}
.srec .top-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:3px}
.srec .top .org{font-size:12px;opacity:.9}
.srec .top .crumbs{display:flex;gap:6px;align-items:center;margin-left:auto;padding:0;color:rgba(255,255,255,.78);font-size:11px}
.srec .top .crumbs b{color:#fff}
.srec .bar{height:5px;background:rgba(255,255,255,.28);border-radius:99px;margin-top:12px;overflow:hidden}
.srec .bar>i{display:block;height:100%;background:#fff;border-radius:99px;transition:width .35s}
.srec .body{flex:1;padding:14px 18px 18px;overflow:auto}
.srec .body.completion-body{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.srec .muted{font-size:12.5px;line-height:1.55;color:var(--muted);margin:0 0 16px}
.srec .center{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.srec .step-title{font-size:18px;font-weight:750;margin:6px 0;letter-spacing:-.3px}
.srec .lab{display:block;font-size:13.5px;font-weight:700;margin-bottom:8px}
.srec .fld{margin-bottom:16px;padding-bottom:14px;border-bottom:1px dashed var(--line)}
.srec .fld:last-of-type{border-bottom:0}
.srec .in,.srec .ta{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:13px 14px;font-size:15px;outline:none;background:#fff;color:var(--ink)}
.srec .in:focus,.srec .ta:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(0,74,173,.08)}
.srec .ta{min-height:84px;resize:vertical}
.srec .err{color:#c2456e;font-size:13px;margin:8px 0 0}
.srec .ro{display:flex;justify-content:space-between;font-size:13px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#f9fbfe}
.srec .opts{display:flex;flex-wrap:wrap;gap:8px}
.srec .opt{display:flex;align-items:center;gap:9px;border:1.5px solid var(--line);border-radius:11px;padding:11px 13px;font-size:14.5px;background:#fff;cursor:pointer;color:var(--ink)}
.srec .opt .box{width:20px;height:20px;border-radius:6px;border:2px solid #c4cdda;flex:0 0 auto;display:grid;place-items:center;font-size:12px;color:#fff}
.srec .opt.radio .box{border-radius:50%}
.srec .opt.sel{border-color:var(--primary);background:#f1f6ff}
.srec .opt.sel .box{background:var(--primary);border-color:var(--primary)}
.srec .opt:disabled{opacity:.45;cursor:not-allowed}
.srec .in:disabled,.srec .ta:disabled,.srec .segnum input:disabled{background:#f6f8fb;color:#9aa6b6;cursor:not-allowed}
.srec .segrow{display:flex;gap:8px}
.srec .segnum{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:44px;border:1.5px solid var(--line);border-radius:12px;padding:0 10px}
.srec .segnum span{font-size:14px;color:var(--muted);white-space:nowrap;flex:0 0 auto}
.srec .segnum input{width:auto;min-width:0;height:100%;flex:1;border:none;text-align:right;padding:0 2px;font-size:15px;outline:none;appearance:textfield}
.srec .segnum input::-webkit-inner-spin-button,.srec .segnum input::-webkit-outer-spin-button{margin:0;appearance:none}
.srec .text-back{display:block;border:0;border-radius:0;background:transparent;color:var(--primary);font:inherit;font-size:13px;font-weight:700;margin:0 0 10px;padding:4px 0;text-align:left;cursor:pointer}
.srec .text-back:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
.srec .datechip{display:inline-block;font-size:12px;font-weight:700;background:#eaf1ff;color:var(--primary);border-radius:99px;padding:4px 12px;margin-bottom:10px}
.srec .dateinput{height:44px;padding-block:0;font-size:15px}
.srec .notice{display:flex;align-items:flex-start;background:#fff7ec;border:1px solid #f0dcc0;color:var(--warn);font-size:12.5px;border-radius:10px;padding:10px 12px;margin-bottom:12px}
.srec .handover{display:flex;align-items:flex-start;background:#eef5ff;border:1px solid #c7dafa;border-radius:12px;padding:12px 14px;margin-bottom:10px;font-size:13px;color:var(--primary)}
.srec .review-section{margin-top:14px}
.srec .tag{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.4px;border-radius:6px;padding:3px 8px;margin-bottom:8px}
.srec .tag.mom{background:#fde9ef;color:#c2456e}.srec .tag.baby{background:#e7f1ff;color:#3b6fe0}.srec .tag.etc{background:#eef0f4;color:#6b7686}
.srec .review-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#f9fbfe}
.srec .review-row>span{color:var(--muted);flex:0 0 auto}.srec .review-row b{color:var(--ink);text-align:right;font-weight:700;word-break:keep-all}
.srec .review-note{font-size:13px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#f9fbfe}
.srec .review-note>span{display:block;color:var(--muted);margin-bottom:4px}.srec .review-note b{font-weight:600;line-height:1.5}
.srec .review-row b.empty,.srec .review-note b.empty{color:#b6bfcc;font-weight:600}
.srec .review-row b.ok,.srec .review-note b.ok{color:var(--primary)}
.srec .days{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:6px}
.srec .day{border:1.5px solid var(--line);border-radius:14px;padding:14px 8px;text-align:center;cursor:pointer;background:#fff;color:var(--ink)}
.srec .day .d{font-size:12px;color:var(--muted)}.srec .day .n{font-size:20px;font-weight:800;margin-top:2px}.srec .day .st{font-size:11px;margin-top:6px;color:var(--muted)}
.srec .day.done{background:#eef5ff;border-color:#c7dafa}.srec .day.done .st{color:var(--primary);font-weight:700}
.srec .day.locked{opacity:.5;cursor:not-allowed}.srec .day.current{border-color:var(--primary);box-shadow:0 0 0 3px #e8f0ff}
.srec .overview-actions{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.srec .nav{display:flex;gap:10px;margin-top:18px}
.srec .btn{font-family:inherit;font-size:15px;font-weight:700;border-radius:12px;border:none;padding:14px 16px;cursor:pointer;width:100%;margin-top:16px}
.srec .nav .btn,.srec .overview-actions .btn{margin-top:0}
.srec .btn.primary,.srec .btn.submit{background:var(--primary);color:#fff;flex:1}
.srec .btn.ghost,.srec .btn.ghost.schedule-change{width:100%;background:var(--soft);color:var(--ink);flex:1}
.srec .btn:disabled{background:#c5cad3;color:#fff;opacity:1;cursor:not-allowed}
.srec .completion-icon{font-size:28px;line-height:1;margin-bottom:18px}
.srec .completion-title{margin:0;color:var(--primary);font-size:20px;font-weight:700;letter-spacing:-.2px}

/* 신규 추가분 */
.srec .sec-head{display:flex;justify-content:space-between;align-items:baseline}
.srec .sec-edit{border:0;background:transparent;color:var(--primary);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;padding:0}
.srec .sign-fld{margin-top:16px;padding-top:14px;border-top:1px dashed var(--line)}
.srec .sign-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
.srec .sign-head .lab{margin:0}
.srec .sign-clear{border:0;background:transparent;color:var(--primary);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;padding:0}
.srec .padwrap{position:relative}
.srec canvas.pad{width:100%;height:150px;display:block;background:#fff;border:1.5px dashed #c4cdda;border-radius:12px;touch-action:none}
.srec .padwrap.inked canvas.pad{border-style:solid;border-color:var(--primary)}
.srec .pad-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#b6bfcc;font-size:13.5px;pointer-events:none;transition:opacity .2s}
.srec .padwrap.inked .pad-hint,.srec .padwrap.locked .pad-hint{opacity:0}
.srec .padwrap.locked canvas.pad{background:#f6f8fb;border:1.5px solid var(--line);pointer-events:none}
.srec .sign-fld.locked .sign-clear{display:none}
.srec .sign-note{font-size:12px;color:var(--muted);line-height:1.55;margin:8px 0 0}
.srec .signed-chip{display:none;font-size:12px;font-weight:700;color:var(--primary);background:#eaf1ff;border-radius:99px;padding:4px 12px;margin-top:10px}
.srec .signed-chip.show{display:inline-block}
@media (max-width:360px){.srec .segrow{flex-direction:column}}
`}</style>
    );
}
