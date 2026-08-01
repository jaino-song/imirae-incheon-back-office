"use client";

import { useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Building2, Send } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { useToast } from "@/hooks/use-toast";
import { useInitialUser } from "@/providers/UserProvider";
import { settingsApi, type MessageSenderApprovalResponse } from "@/services/api";

import "@/components/app/mobile-redesign/redesign.css";
import styles from "./page.module.css";

const MESSAGE_SENDER_APPROVAL_QUERY_KEY = ["settings", "message-sender-approval"] as const;
const ALIGO_JOIN_URL = "https://smartsms.aligo.in/join.html";
const ALIGO_API_SPEC_URL = "https://smartsms.aligo.in/admin/api/spec.html";
const UNIFIED_SENDER_PHONE = "010-9641-1878";

interface AgreementItem {
  id: "aligoTerms" | "privacyThirdParty" | "senderNumber";
  beforeLink: string;
  linkText: string;
  afterLink: string;
  href: string;
}

interface AgreementState {
  aligoTerms: boolean;
  privacyThirdParty: boolean;
  senderNumber: boolean;
}

const SENDER_APPROVAL_FORM_BASE = "mobile_messages_sender-approval_page_screen_content_scroll_list-card_body_form";

interface SenderApprovalFormProps {
  approval?: MessageSenderApprovalResponse;
  branchName: string;
  errorMessage: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
}

const AGREEMENT_ITEMS: AgreementItem[] = [
  {
    id: "aligoTerms",
    beforeLink: "알리고 문자 서비스 이용약관에 ",
    linkText: "동의",
    afterLink: "합니다.",
    href: ALIGO_JOIN_URL,
  },
  {
    id: "privacyThirdParty",
    beforeLink: "메시지 발송 기능 제공을 위해 필요한 개인정보를 제3자에게 제공하는 데 ",
    linkText: "동의",
    afterLink: "합니다.",
    href: ALIGO_JOIN_URL,
  },
  {
    id: "senderNumber",
    beforeLink: "발신번호는 아가잼잼 어드민 서비스 내에 사전 등록된 번호만 사용할 수 있음을 ",
    linkText: "확인",
    afterLink: "했습니다.",
    href: ALIGO_API_SPEC_URL,
  },
];

function getApprovalErrorMessage(error: unknown): string {
  if (isAxiosError<{ error?: string; message?: string | string[] }>(error)) {
    const data = error.response?.data;
    const message = Array.isArray(data?.message) ? data.message.join(", ") : data?.message;
    return message ?? data?.error ?? "승인 신청에 실패했습니다.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "승인 신청에 실패했습니다.";
}

function approvalStatusLabel(approval?: MessageSenderApprovalResponse): string {
  if (approval?.approvalStatus === "approved") return "승인 완료";
  if (approval?.approvalStatus === "pending") return "승인 대기중";
  return "승인 필요";
}

function SenderApprovalForm({
  approval,
  branchName,
  errorMessage,
  isLoading,
  isSubmitting,
  onSubmit,
}: SenderApprovalFormProps) {
  const [agreements, setAgreements] = useState<AgreementState>({
    aligoTerms: false,
    privacyThirdParty: false,
    senderNumber: false,
  });

  const canRequest = approval?.canRequest ?? true;
  const isApprovalPending = approval?.approvalStatus === "pending";
  const allAgreed = AGREEMENT_ITEMS.every((item) => agreements[item.id]);
  const canSubmit = allAgreed && canRequest && !isApprovalPending && !isLoading && !isSubmitting;
  const submitLabel = isApprovalPending ? "승인 대기중" : "신청하기";

  return (
    <form
      data-component={SENDER_APPROVAL_FORM_BASE}
      className={styles.formSections}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <section data-component={`${SENDER_APPROVAL_FORM_BASE}_branch`} className={styles.formCardSection}>
          <div data-component={`${SENDER_APPROVAL_FORM_BASE}_branch_row`} className={styles.formSection}>
            <div data-component={`${SENDER_APPROVAL_FORM_BASE}_branch_row_label`} className={styles.labelRow}>
              <span className={styles.formLabel}>지점</span>
              <span className={styles.statusPill}>{approvalStatusLabel(approval)}</span>
            </div>
            <div data-component={`${SENDER_APPROVAL_FORM_BASE}_branch_row_card`} className={styles.branchInline}>
              <span data-component={`${SENDER_APPROVAL_FORM_BASE}_branch_row_card_icon`} className={styles.branchIcon} aria-hidden="true">
                <Building2 size={16} strokeWidth={2.5} />
              </span>
              <span data-component={`${SENDER_APPROVAL_FORM_BASE}_branch_row_card_name`} className={styles.branchName}>
                {branchName}
              </span>
            </div>
          </div>
      </section>

      <section data-component={`${SENDER_APPROVAL_FORM_BASE}_phone`} className={styles.formCardSection}>
          <div data-component={`${SENDER_APPROVAL_FORM_BASE}_phone_info`} className={styles.formSection}>
            <span className={styles.formLabel}>발신번호</span>
            <span data-component={`${SENDER_APPROVAL_FORM_BASE}_phone_info_number`} className={styles.branchName}>
              {UNIFIED_SENDER_PHONE}
            </span>
            <p className={styles.helperText}>
              모든 메시지는 사전 등록된 대표 발신번호 {UNIFIED_SENDER_PHONE} 으로 발송됩니다. 별도의 발신번호 입력이 필요하지 않습니다.
            </p>
          </div>
      </section>

      <section data-component={`${SENDER_APPROVAL_FORM_BASE}_agreements`} className={styles.formCardSection}>
          <div data-component={`${SENDER_APPROVAL_FORM_BASE}_agreements_row`} className={styles.formSection}>
            <span className={styles.formLabel}>
              동의 항목 <span className={styles.required}>*</span>
            </span>
            <div data-component={`${SENDER_APPROVAL_FORM_BASE}_agreements_row_list`} className={styles.agreementGroup}>
              {AGREEMENT_ITEMS.map((item) => (
                <label key={item.id} htmlFor={item.id} className={styles.agreementCard}>
                  <Checkbox
                    id={item.id}
                    checked={agreements[item.id]}
                    disabled={isLoading || isSubmitting || !canRequest || isApprovalPending}
                    onCheckedChange={(checked) => {
                      setAgreements((current) => ({
                        ...current,
                        [item.id]: checked === true,
                      }));
                    }}
                    className={styles.agreementCheckbox}
                  />
                  <span className={styles.agreementCopy}>
                    <span className={styles.agreementText}>
                      {item.beforeLink}
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.agreementInlineLink}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {item.linkText}
                      </a>
                      {item.afterLink}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
      </section>

      {!isLoading && !canRequest ? (
        <Alert data-component={`${SENDER_APPROVAL_FORM_BASE}_permission-alert`} className={styles.feedbackAlert}>
          <AlertDescription>
            현재 계정은 메시지 발송 기능 신청 권한이 없습니다. 관리자 또는 매니저 계정으로 신청해 주세요.
          </AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert
          data-component={`${SENDER_APPROVAL_FORM_BASE}_error`}
          variant="destructive"
          className={styles.feedbackAlert}
        >
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div data-component={`${SENDER_APPROVAL_FORM_BASE}_actions`} className={styles.msgActions}>
        <Button
          type="submit"
          data-component={`${SENDER_APPROVAL_FORM_BASE}_actions_submit`}
          variant="v3"
          disabled={!canSubmit}
          className={styles.submitButton}
        >
          <Send aria-hidden="true" size={16} strokeWidth={2.5} />
          {isSubmitting ? "신청 중" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export default function MessageSenderApprovalPage() {
  const router = useRouter();
  const { isNavigationPending, startNavigation } = useNavigationPending();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const initialUser = useInitialUser();
  const { data: user } = useGetAuthUser({ initialData: initialUser });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const branchName = user?.branchName ?? "현재 지점";

  const approvalQuery = useQuery({
    queryKey: MESSAGE_SENDER_APPROVAL_QUERY_KEY,
    queryFn: settingsApi.getMessageSenderApproval,
  });

  const requestApprovalMutation = useMutation({
    mutationFn: settingsApi.requestMessageSenderApproval,
    onSuccess: (approval: MessageSenderApprovalResponse) => {
      queryClient.setQueryData(MESSAGE_SENDER_APPROVAL_QUERY_KEY, approval);
      setErrorMessage(null);
      toast({ description: "신청이 완료되었습니다." });
      startNavigation();
      router.replace("/all");
    },
    onError: (error) => {
      setErrorMessage(getApprovalErrorMessage(error));
    },
  });

  return (
    <section
      data-component="mobile_messages_sender-approval_page"
      data-slot="messages-page"
      data-page="messages-sender-approval"
      className={`messages-page ${styles.pageRoot}`}
    >
      <div data-component="mobile_messages_sender-approval_page_screen" className={styles.phoneScreen}>
        <div
          data-component="mobile_messages_sender-approval_page_screen_content"
          data-slot="messages-content"
          data-form="messages-sender-approval-form"
          className={`shell-content gap-[calc(8px*var(--glint-ui-scale,1))] ${styles.navPage}`}
        >
          <div data-component="mobile_messages_sender-approval_page_screen_content_section-nav" className="shrink-0">
            <MessageSectionNav
              data-component="mobile_messages_sender-approval_page_screen_content_section-nav_nav"
              activeId="settings"
            />
          </div>

          <div data-component="mobile_messages_sender-approval_page_screen_content_scroll" className={styles.formScroll}>
            <ListCard
              data-component="mobile_messages_sender-approval_page_screen_content_scroll_list-card"
              title="메시지 설정"
              filters={[]}
            >
              <SenderApprovalForm
                approval={approvalQuery.data}
                branchName={branchName}
                isLoading={approvalQuery.isLoading}
                isSubmitting={requestApprovalMutation.isPending || isNavigationPending}
                errorMessage={errorMessage}
                onSubmit={() => requestApprovalMutation.mutate()}
              />
            </ListCard>
          </div>
        </div>
      </div>
    </section>
  );
}
