"use client";

const TRIGGER_RULE_APPROVAL_MESSAGE =
  "메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요.";

export function MessageApprovalRequiredNotice({
  dataComponent,
}: {
  dataComponent: string;
}) {
  return (
    <div
      data-component={dataComponent}
      className="max-w-[240px] rounded-[18px] border border-v3-burgundy/15 bg-white/90 px-4 py-3 text-center text-[0.78rem] font-semibold leading-5 text-v3-burgundy shadow-sm"
    >
      {TRIGGER_RULE_APPROVAL_MESSAGE}
    </div>
  );
}
