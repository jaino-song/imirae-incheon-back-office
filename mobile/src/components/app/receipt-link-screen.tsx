"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = {
    ok: true;
    state: "pending" | "verified";
    branchName: string;
    expiresAt: string;
    remainingAttempts: number;
    lockedUntil: string | null;
};

type Screen =
    | { kind: "loading" }
    | { kind: "verify"; branchName: string; remainingAttempts: number; error: string | null }
    | { kind: "locked"; branchName: string; lockedUntil: string }
    | { kind: "expired" }
    | { kind: "invalid" }
    | { kind: "image"; branchName: string; clientName: string };

const BRANCH_FALLBACK = "인천 아이미래로";
const FOOTER = "이 링크는 발송일로부터 30일간 유효합니다.";
const MAX_ATTEMPTS = 5;

function formatLockedUntil(iso: string): string {
    const date = new Date(iso);
    return `${date.getHours()}시 ${String(date.getMinutes()).padStart(2, "0")}분`;
}

export interface ReceiptLinkScreenProps {
    token: string;
}

export function ReceiptLinkScreen({ token }: ReceiptLinkScreenProps) {
    const api = useCallback((path: string) => `/api/receipt/${encodeURIComponent(token)}${path}`, [token]);

    const [screen, setScreen] = useState<Screen>({ kind: "loading" });
    const [birthday, setBirthday] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Cache-busting suffix for the receipt <img> src, set once (and only once — see
    // handleImageError) after a transient image load failure to trigger a single retry.
    const [imageRetryParam, setImageRetryParam] = useState("");

    // True while this component instance is mounted. Every async transition below checks
    // this after each await before calling setState, so a fetch that resolves after
    // unmount (route change, fast test teardown) never touches state on a dead component.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Shared by the mount effect below and handleImageError's 401 branch: a stale/cleared
    // access cookie surfaces on /status too, so re-running the same check re-renders the
    // right screen (verify/expired/locked/invalid).
    const loadStatus = useCallback(async () => {
        try {
            const response = await fetch(api("/status"), { cache: "no-store" });
            if (!mountedRef.current) return;
            if (response.status === 410) return setScreen({ kind: "expired" });
            if (!response.ok) return setScreen({ kind: "invalid" });
            const status = (await response.json()) as Status;
            if (!mountedRef.current) return;
            const branchName = status.branchName || BRANCH_FALLBACK;
            if (status.lockedUntil) return setScreen({ kind: "locked", branchName, lockedUntil: status.lockedUntil });
            setScreen({ kind: "verify", branchName, remainingAttempts: status.remainingAttempts, error: null });
        } catch {
            if (!mountedRef.current) return;
            setScreen({ kind: "invalid" });
        }
    }, [api]);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    // The <img>'s error event carries no status code, and /status doesn't consult the
    // access cookie (it's public/unauthenticated) — so it can't tell a revoked link apart
    // from a transient 5xx on an otherwise-healthy session. Probe the image endpoint
    // itself instead: 401 means the access cookie is stale/absent (re-challenge, same as
    // any other 401 elsewhere on this page); 410 means the link expired; anything else
    // (5xx, a thrown network error) is treated as transient — stay on the image screen and
    // retry the <img> exactly once via a cache-busting query param. imageRetryParam being
    // already set doubles as the "already retried" guard, so a second error (e.g. the
    // retried load also failing) does not fetch or retry again — there is no copy for a
    // broken-image state yet, so the image is simply left alone after that.
    const handleImageError = useCallback(async () => {
        if (screen.kind !== "image" || imageRetryParam) return;
        try {
            // imageRetryParam is always "" here — the early return above already excludes the
            // one case where it's set — so the probe URL is plainly the bare image path (M2).
            const response = await fetch(api("/image"));
            if (!mountedRef.current) return;
            if (response.status === 401) {
                void loadStatus();
                return;
            }
            if (response.status === 410) {
                setScreen({ kind: "expired" });
                return;
            }
            setImageRetryParam("?r=1");
        } catch {
            if (!mountedRef.current) return;
            setImageRetryParam("?r=1");
        }
    }, [api, imageRetryParam, loadStatus, screen.kind]);

    const submit = async () => {
        if (screen.kind !== "verify" || isSubmitting) return;
        const digits = birthday.replace(/\D/g, "");
        if (digits.length !== 6 && digits.length !== 8) {
            setScreen({ ...screen, error: "생년월일 6자리(YYMMDD)를 입력해 주세요." });
            return;
        }
        setIsSubmitting(true);
        try {
            const response = await fetch(api("/verify"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ birthday: digits }),
            });
            if (!mountedRef.current) return;
            const body = (await response.json().catch(() => ({}))) as {
                clientName?: string;
                reason?: string;
                remainingAttempts?: number;
                lockedUntil?: string;
            };
            if (!mountedRef.current) return;
            if (response.ok) {
                setScreen({ kind: "image", branchName: screen.branchName, clientName: body.clientName || "산모" });
                return;
            }
            if (response.status === 423 && body.lockedUntil) {
                setScreen({ kind: "locked", branchName: screen.branchName, lockedUntil: body.lockedUntil });
                return;
            }
            if (response.status === 410) return setScreen({ kind: "expired" });
            if (response.status === 401) {
                const remaining = body.remainingAttempts ?? Math.max(0, screen.remainingAttempts - 1);
                setScreen({
                    kind: "verify",
                    branchName: screen.branchName,
                    remainingAttempts: remaining,
                    error: `생년월일이 일치하지 않습니다. 남은 횟수 ${remaining}회`,
                });
                return;
            }
            // A 400 always carries { reason: "invalid_format" } here — the BFF
            // normalizes a bare validation-pipe 400 to that shape too.
            if (response.status === 400) {
                setScreen({ ...screen, error: "생년월일 6자리(YYMMDD)를 입력해 주세요." });
                return;
            }
            setScreen({ ...screen, error: "확인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." });
        } catch {
            if (!mountedRef.current) return;
            setScreen({ ...screen, error: "네트워크 연결을 확인해 주세요." });
        } finally {
            if (mountedRef.current) setIsSubmitting(false);
        }
    };

    const stepLabel = screen.kind === "image" ? "2단계 · 영수증 저장" : "1단계 · 본인 확인";
    const progress = screen.kind === "image" ? 100 : 50;
    const branchName = "branchName" in screen ? screen.branchName : BRANCH_FALLBACK;

    return (
        <main className="rcpt" data-component="mobile_receipt_public-page">
            <header className="rcpt-head">
                <p className="rcpt-eyebrow">{branchName}</p>
                <h1>본인부담금 영수증</h1>
                {screen.kind !== "expired" && screen.kind !== "invalid" ? (
                    <>
                        <p className="rcpt-step">{stepLabel}</p>
                        <div className="rcpt-progress" aria-hidden="true">
                            <span style={{ width: `${progress}%` }} />
                        </div>
                    </>
                ) : null}
            </header>

            {screen.kind === "loading" ? <p className="rcpt-muted">확인 중입니다…</p> : null}

            {screen.kind === "verify" || screen.kind === "locked" ? (
                <section className="rcpt-card" data-component="mobile_receipt_public-page_verify">
                    <h2>산모님 본인 확인</h2>
                    <p className="rcpt-desc">
                        본인부담금 영수증은 산모님 본인만 열람하실 수 있습니다. 계약 시 등록하신 생년월일을 입력해 주세요.
                    </p>
                    <label className="rcpt-label" htmlFor="receipt-birthday">
                        산모 생년월일
                    </label>
                    <input
                        id="receipt-birthday"
                        className="rcpt-input"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="예) 940315"
                        maxLength={8}
                        value={birthday}
                        disabled={screen.kind === "locked" || isSubmitting}
                        onChange={(event) => setBirthday(event.target.value.replace(/\D/g, ""))}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") void submit();
                        }}
                    />
                    <p className="rcpt-helper">주민등록번호 앞 6자리</p>
                    {screen.kind === "verify" && screen.error ? (
                        <p className="rcpt-err" role="alert">
                            {screen.error}
                        </p>
                    ) : null}
                    {screen.kind === "locked" ? (
                        <p className="rcpt-err" role="alert">
                            5회 연속 틀려 {formatLockedUntil(screen.lockedUntil)}까지 확인이 잠겼습니다.
                        </p>
                    ) : null}
                    <button
                        type="button"
                        className="rcpt-btn"
                        data-component="mobile_receipt_public-page_verify_submit"
                        disabled={screen.kind === "locked" || isSubmitting}
                        onClick={() => void submit()}
                    >
                        {screen.kind === "verify" && screen.remainingAttempts < MAX_ATTEMPTS ? "다시 확인하기" : "확인하기"}
                    </button>
                    {screen.kind === "locked" || (screen.kind === "verify" && screen.remainingAttempts < MAX_ATTEMPTS) ? (
                        <p className="rcpt-warn">
                            5회 연속 틀리면 30분 동안 확인이 잠깁니다. 계약서에 적힌 산모님 생년월일과 같은지 확인해 주세요.
                        </p>
                    ) : (
                        <p className="rcpt-info">
                            입력하신 생년월일은 본인 확인에만 사용되며 저장되지 않습니다. 확인 후 영수증 이미지를 바로
                            내려받으실 수 있습니다.
                        </p>
                    )}
                </section>
            ) : null}

            {screen.kind === "image" ? (
                <section className="rcpt-card" data-component="mobile_receipt_public-page_image">
                    <div className="rcpt-titlerow">
                        <h2>{screen.clientName} 산모님 영수증</h2>
                        <span className="rcpt-chip">확인 완료</span>
                    </div>
                    <img
                        className="rcpt-img"
                        src={`${api("/image")}${imageRetryParam}`}
                        alt={`${screen.clientName} 산모님 본인부담금 영수증`}
                        onError={() => void handleImageError()}
                    />
                    <a
                        className="rcpt-btn rcpt-btn-icon"
                        href={api("/image?download=1")}
                        download
                        data-component="mobile_receipt_public-page_image_save"
                    >
                        <DownloadIcon />
                        이미지 저장
                    </a>
                </section>
            ) : null}

            {screen.kind === "expired" ? (
                <section className="rcpt-card" data-component="mobile_receipt_public-page_expired">
                    <ClockIcon />
                    <h2>링크 유효기간이 지났습니다</h2>
                    <p className="rcpt-desc">
                        영수증 링크는 문자 발송일로부터 30일간 열어보실 수 있습니다. 영수증이 다시 필요하시면 인천 아이미래로에
                        연락 주세요.
                    </p>
                </section>
            ) : null}

            {screen.kind === "invalid" ? (
                <section className="rcpt-card" data-component="mobile_receipt_public-page_invalid">
                    <h2>사용할 수 없는 링크입니다</h2>
                    <p className="rcpt-desc">문자에 있는 링크를 다시 눌러 주세요. 계속 열리지 않으면 인천 아이미래로에 연락 주세요.</p>
                </section>
            ) : null}

            <footer className="rcpt-foot">{FOOTER}</footer>

            <Styles />
        </main>
    );
}

function ClockIcon() {
    return (
        <svg className="rcpt-icon rcpt-icon-clock" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function DownloadIcon() {
    return (
        <svg className="rcpt-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5M5 18h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function Styles() {
    return (
        <style>{`
.rcpt{--primary:#004aad;--ink:#1c2430;--muted:#7c8798;--line:#e4e8ef;--soft:#f3f6fb;--err:#c2456e;max-width:480px;margin:0 auto;padding:24px 20px 40px;color:var(--ink);font-size:15px;line-height:1.55}
.rcpt *{box-sizing:border-box}
.rcpt-head h1{margin:4px 0 12px;font-size:22px;font-weight:800}
.rcpt-eyebrow{margin:0;color:var(--muted);font-size:13px}
.rcpt-step{margin:0 0 6px;font-size:13px;font-weight:700;color:var(--primary)}
.rcpt-progress{height:4px;border-radius:2px;background:var(--line);overflow:hidden;margin-bottom:20px}
.rcpt-progress span{display:block;height:100%;background:var(--primary)}
.rcpt-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px}
.rcpt-card h2{margin:0 0 8px;font-size:18px;font-weight:800}
.rcpt-desc{margin:0 0 16px;color:var(--muted)}
.rcpt-label{display:block;margin-bottom:6px;font-size:13px;font-weight:700}
.rcpt-input{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:13px 14px;font-size:18px;letter-spacing:.08em}
.rcpt-input:focus{outline:2px solid var(--primary);outline-offset:1px}
.rcpt-helper{margin:6px 0 0;color:var(--muted);font-size:13px}
.rcpt-err{margin:10px 0 0;color:var(--err);font-weight:700}
.rcpt-btn{display:block;width:100%;margin-top:16px;border:0;border-radius:12px;padding:14px 16px;background:var(--primary);color:#fff;font-size:15px;font-weight:700;text-align:center;text-decoration:none}
.rcpt-btn:disabled{opacity:.5}
.rcpt-btn-icon{display:flex;align-items:center;justify-content:center;gap:6px}
.rcpt-icon{width:18px;height:18px;flex-shrink:0}
.rcpt-icon-clock{width:28px;height:28px;color:var(--muted);margin-bottom:8px}
.rcpt-info,.rcpt-warn{margin:14px 0 0;padding:12px 14px;border-radius:12px;background:var(--soft);font-size:13px;color:var(--muted)}
.rcpt-warn{color:var(--err);background:#fdf1f5}
.rcpt-titlerow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.rcpt-chip{padding:4px 10px;border-radius:999px;background:#e6f4ea;color:#1f7a3f;font-size:12px;font-weight:700}
.rcpt-img{display:block;width:100%;margin-top:12px;border:1px solid var(--line);border-radius:12px}
.rcpt-foot{margin-top:24px;color:var(--muted);font-size:12px;text-align:center}
.rcpt-muted{color:var(--muted)}
`}</style>
    );
}
