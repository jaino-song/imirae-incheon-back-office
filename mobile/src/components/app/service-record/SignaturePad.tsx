"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SignaturePadProps {
    "data-component"?: string;
    value: string | null;
    signedAt: string | null;
    onChange: (dataUri: string | null) => void;
    locked: boolean;
}

interface CanvasPoint {
    x: number;
    y: number;
}

interface ConfiguredCanvas {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    height: number;
    width: number;
}

function formatSignedAt(value: string | null): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}

export function SignaturePad({
    "data-component": dataComponent,
    value,
    signedAt,
    onChange,
    locked,
}: SignaturePadProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const lastPointRef = useRef<CanvasPoint | null>(null);
    const [hasLocalInk, setHasLocalInk] = useState(false);
    const hasInk = Boolean(value) || hasLocalInk;

    const configureCanvas = useCallback((): ConfiguredCanvas | null => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return null;

        const rect = canvas.getBoundingClientRect();
        const width = rect.width || canvas.clientWidth;
        const height = rect.height || canvas.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.lineWidth = 2.4;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "#1c2430";
        return { canvas, context, height, width };
    }, []);

    useEffect(() => {
        const configured = configureCanvas();
        if (!configured) return;

        if (!value) return;

        const image = new Image();
        image.onload = () => {
            configured.context.drawImage(image, 0, 0, configured.width, configured.height);
        };
        image.src = value;
    }, [configureCanvas, value]);

    const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): CanvasPoint => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (locked) return;
        const context = event.currentTarget.getContext("2d");
        if (!context) return;

        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const point = pointFromEvent(event);
        drawingRef.current = true;
        lastPointRef.current = point;
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(point.x + 0.01, point.y + 0.01);
        context.stroke();
        setHasLocalInk(true);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (locked || !drawingRef.current || !lastPointRef.current) return;
        const context = event.currentTarget.getContext("2d");
        if (!context) return;

        event.preventDefault();
        const point = pointFromEvent(event);
        context.beginPath();
        context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        context.lineTo(point.x, point.y);
        context.stroke();
        lastPointRef.current = point;
    };

    const finishDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (locked || !drawingRef.current) return;
        drawingRef.current = false;
        lastPointRef.current = null;
        onChange(event.currentTarget.toDataURL("image/png"));
    };

    const clearSignature = () => {
        if (locked) return;
        configureCanvas();
        drawingRef.current = false;
        lastPointRef.current = null;
        setHasLocalInk(false);
        onChange(null);
    };

    return (
        <div data-component={dataComponent} className={`sign-fld ${locked ? "locked" : ""}`}>
            <div className="sign-head">
                <label className="lab">산모 서명</label>
                {!locked && (
                    <button type="button" className="sign-clear" aria-label="서명 지우기" onClick={clearSignature}>
                        지우기
                    </button>
                )}
            </div>
            <div className={`padwrap ${hasInk ? "inked" : ""} ${locked ? "locked" : ""}`}>
                <canvas
                    ref={canvasRef}
                    className="pad"
                    aria-label="산모 서명 입력"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={finishDrawing}
                    onPointerCancel={finishDrawing}
                    onPointerLeave={finishDrawing}
                />
                <div className="pad-hint">여기에 손가락으로 서명해 주세요</div>
            </div>
            <p className="sign-note">기록 내용을 확인하였음을 서명으로 확인합니다.</p>
            {locked && signedAt && (
                <span className="signed-chip show">서명 완료 · {formatSignedAt(signedAt)}</span>
            )}
        </div>
    );
}
