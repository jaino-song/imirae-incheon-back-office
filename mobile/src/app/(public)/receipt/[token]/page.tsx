"use client";

import { useParams } from "next/navigation";

import { ReceiptLinkScreen } from "@/components/app/receipt-link-screen";

export default function ReceiptLinkPage() {
    const { token } = useParams<{ token: string }>();

    return <ReceiptLinkScreen token={token} />;
}
