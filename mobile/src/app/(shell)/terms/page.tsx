import "@/components/app/mobile-redesign/redesign.css";

import Link from "next/link";

export default function TermsPage() {
  return (
    <section
      className="shell-content flex flex-col"
      data-component="mobile_terms_page"
    >
      <div className="list-card">
        <div className="list-title">
          <span className="list-title-text">
            이용약관
            <span className="list-count">아가잼잼 어드민</span>
          </span>
        </div>
        <div className="list-card-scroll space-y-3 px-4 py-4 text-[0.85rem] leading-relaxed text-v3-dark">
          <p>
            아가잼잼 어드민은 산모·신생아 건강관리 서비스의 운영과 고객 응대를
            위한 도구입니다. 지점 운영, 고객 관리, 계약서 발송 기능은 승인된
            관리자 계정으로만 사용할 수 있습니다.
          </p>
          <p className="text-[0.78rem] text-v3-text-muted">
            전체 이용약관은 데스크톱 환경에서 확인하실 수 있으며, 계약서 발송 시
            제공인력 및 고객에게 별도로 안내됩니다.
          </p>
        </div>
      </div>
      <div className="px-4 pt-4 text-center text-[0.78rem] text-v3-primary">
        <Link className="-mx-3 inline-flex min-h-[44px] items-center px-3" href="/login">
          로그인으로 돌아가기
        </Link>
      </div>
    </section>
  );
}
