import { Metadata } from "next";

// Overrides the (public) group layout's title/description ("서비스 제공기록지"),
// which would otherwise leak onto this route's browser tab / share previews.
export const metadata: Metadata = {
    title: "본인부담금 영수증",
    description: "아가잼잼 본인부담금 영수증 확인",
};

export default function ReceiptLinkLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
