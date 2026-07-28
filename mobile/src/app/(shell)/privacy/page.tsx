import "@/components/app/mobile-redesign/redesign.css";

import Link from "next/link";

export default function PrivacyPage() {
  return (
    <section
      className="shell-content flex flex-col"
      data-component="mobile_privacy_page"
    >
      <div className="list-card">
        <div className="list-title">
          <span className="list-title-text">
            개인정보처리방침
            <span className="list-count">아가잼잼 어드민</span>
          </span>
        </div>
        <div className="list-card-scroll space-y-3 px-4 py-4 text-[0.85rem] leading-relaxed text-v3-dark">
          <p>
            아가잼잼 어드민은 산모·신생아 건강관리 서비스 운영에 필요한 최소한의
            개인정보만 처리합니다. 수집된 정보는 권한이 있는 지점 담당자에게만
            노출되며, 외부에 공유되지 않습니다.
          </p>
          <p className="text-[0.78rem] text-v3-text-muted">
            보다 자세한 처리 방침은 데스크톱 환경의 설정 메뉴에서 확인하실 수
            있습니다.
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
