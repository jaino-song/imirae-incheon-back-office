"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Building2, Send } from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { useToast } from "@/hooks/use-toast";
import { useInitialUser } from "@/providers/UserProvider";
import { settingsApi, type MessageSenderApprovalResponse } from "@/services/api";

import styles from "./sender-approval-detail.module.css";

const MESSAGE_SENDER_APPROVAL_QUERY_KEY = ["settings", "message-sender-approval"] as const;
const ALIGO_JOIN_URL = "https://smartsms.aligo.in/join.html";
const ALIGO_API_SPEC_URL = "https://smartsms.aligo.in/admin/api/spec.html";
const UNIFIED_SENDER_PHONE = "010-9641-1878";
const SOURCE_COMPONENT = "SenderApprovalDetail";

interface AgreementItem {
  id: "aligoTerms" | "privacyThirdParty" | "senderNumber";
  dataComponentId: "aligo-terms" | "privacy-third-party" | "sender-number";
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

const AGREEMENT_ITEMS: AgreementItem[] = [
  {
    id: "aligoTerms",
    dataComponentId: "aligo-terms",
    beforeLink: "알리고 문자 서비스 이용약관에 ",
    linkText: "동의",
    afterLink: "합니다.",
    href: ALIGO_JOIN_URL,
  },
  {
    id: "privacyThirdParty",
    dataComponentId: "privacy-third-party",
    beforeLink: "메시지 발송 기능 제공을 위해 필요한 개인정보를 제3자에게 제공하는 데 ",
    linkText: "동의",
    afterLink: "합니다.",
    href: ALIGO_JOIN_URL,
  },
  {
    id: "senderNumber",
    dataComponentId: "sender-number",
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

  if (error instanceof Error && error.message) return error.message;
  return "승인 신청에 실패했습니다.";
}

function approvalStatusLabel(approval?: MessageSenderApprovalResponse): string {
  if (approval?.approvalStatus === "approved") return "승인 완료";
  if (approval?.approvalStatus === "pending") return "승인 대기중";
  return "승인 필요";
}

export function SenderApprovalDetail({
  "data-component": dataComponent,
}: {
  "data-component": string;
}) {
  const router = useRouter();
  const { isNavigationPending, startNavigation } = useNavigationPending();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const initialUser = useInitialUser();
  const { data: user } = useGetAuthUser({ initialData: initialUser });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [agreements, setAgreements] = useState<AgreementState>({
    aligoTerms: false,
    privacyThirdParty: false,
    senderNumber: false,
  });

  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
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

  const approval = approvalQuery.data;
  const canRequest = approval?.canRequest ?? true;
  const isApprovalPending = approval?.approvalStatus === "pending";
  const isSubmitting = requestApprovalMutation.isPending || isNavigationPending;
  const allAgreed = AGREEMENT_ITEMS.every((item) => agreements[item.id]);
  const canSubmit = allAgreed && canRequest && !approvalQuery.isLoading && !isSubmitting;
  const submitLabel = isApprovalPending ? "다시 신청하기" : "신청하기";

  return (
    <form
      data-component={dataComponent}
      data-slot="form-sections"
      data-source-component={SOURCE_COMPONENT}
      className={styles.formSections}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) requestApprovalMutation.mutate();
      }}
    >
      <section
        data-component={sub("branch")}
        data-slot="form-card-section"
        className={styles.formCardSection}
      >
        <div
          data-component={sub("branch_row")}
          data-slot="form-section"
          className={styles.formSection}
        >
          <div
            data-component={sub("branch_row_label")}
            data-slot="label-row"
            className={styles.labelRow}
          >
            <span data-slot="form-label" className={styles.formLabel}>지점</span>
            <span data-slot="status-pill" className={styles.statusPill}>
              {approvalStatusLabel(approval)}
            </span>
          </div>
          <div
            data-component={sub("branch_row_card")}
            data-slot="branch-inline"
            className={styles.branchInline}
          >
            <span
              data-component={sub("branch_row_card_icon")}
              data-slot="branch-icon"
              className={styles.branchIcon}
              aria-hidden="true"
            >
              <Building2 size={16} strokeWidth={2.5} />
            </span>
            <span
              data-component={sub("branch_row_card_name")}
              data-slot="branch-name"
              className={styles.branchName}
            >
              {branchName}
            </span>
          </div>
        </div>
      </section>

      <section
        data-component={sub("phone")}
        data-slot="form-card-section"
        className={styles.formCardSection}
      >
        <div
          data-component={sub("phone_info")}
          data-slot="form-section"
          className={styles.formSection}
        >
          <span data-slot="form-label" className={styles.formLabel}>발신번호</span>
          <span
            data-component={sub("phone_info_number")}
            data-slot="branch-name"
            className={styles.branchName}
          >
            {UNIFIED_SENDER_PHONE}
          </span>
          <p data-slot="helper-text" className={styles.helperText}>
            모든 메시지는 사전 등록된 대표 발신번호 {UNIFIED_SENDER_PHONE} 으로 발송됩니다. 별도의 발신번호 입력이 필요하지 않습니다.
          </p>
        </div>
      </section>

      <section
        data-component={sub("agreements")}
        data-slot="form-card-section"
        className={styles.formCardSection}
      >
        <div
          data-component={sub("agreements_row")}
          data-slot="form-section"
          className={styles.formSection}
        >
          <span data-slot="form-label" className={styles.formLabel}>
            동의 항목 <span data-slot="required" className={styles.required}>*</span>
          </span>
          <div
            data-component={sub("agreements_row_list")}
            data-slot="agreement-group"
            className={styles.agreementGroup}
          >
            {AGREEMENT_ITEMS.map((item) => {
              const agreementDataComponent = sub(`agreements_row_list_${item.dataComponentId}`);

              return (
                <label
                  key={item.id}
                  htmlFor={item.id}
                  data-component={agreementDataComponent}
                  data-slot="agreement-card"
                  className={styles.agreementCard}
                >
                  <Checkbox
                    id={item.id}
                    data-component={`${agreementDataComponent}_checkbox`}
                    data-slot="agreement-checkbox"
                    checked={agreements[item.id]}
                    disabled={approvalQuery.isLoading || isSubmitting || !canRequest}
                    onCheckedChange={(checked) => {
                      setAgreements((current) => ({
                        ...current,
                        [item.id]: checked === true,
                      }));
                    }}
                    className={styles.agreementCheckbox}
                  />
                  <span data-slot="agreement-copy" className={styles.agreementCopy}>
                    <span data-slot="agreement-text" className={styles.agreementText}>
                      {item.beforeLink}
                      <a
                        data-component={`${agreementDataComponent}_link`}
                        data-slot="agreement-inline-link"
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
              );
            })}
          </div>
        </div>
      </section>

      {!approvalQuery.isLoading && !canRequest ? (
        <Alert
          data-component={sub("permission-alert")}
          data-slot="feedback-alert"
          className={styles.feedbackAlert}
        >
          <AlertDescription>
            현재 계정은 메시지 발송 기능 신청 권한이 없습니다. 관리자 또는 매니저 계정으로 신청해 주세요.
          </AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert
          data-component={sub("error")}
          data-slot="feedback-alert"
          variant="destructive"
          className={styles.feedbackAlert}
        >
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div
        data-component={sub("actions")}
        data-slot="message-actions"
        className={styles.msgActions}
      >
        <Button
          type="submit"
          data-component={sub("actions_submit")}
          data-slot="submit-button"
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
