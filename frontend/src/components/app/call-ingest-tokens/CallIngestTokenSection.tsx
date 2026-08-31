"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";

import { ContentPaper } from "@/components/app/root/content-paper";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { callIngestTokenApi, type CallIngestToken } from "@/services/api";

import { IssueCallIngestTokenDialog } from "./IssueCallIngestTokenDialog";

const SOURCE_COMPONENT = "CallIngestTokenSection";
const DATA_COMPONENT = "desktop_settings_sections_call-ingest-tokens";

interface CallIngestTokenSectionProps {
  branchId: string;
}

function tokensQueryKey(branchId: string) {
  return ["settings", "call-ingest-tokens", branchId] as const;
}

export function CallIngestTokenSection({ branchId }: CallIngestTokenSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<CallIngestToken | null>(null);

  const tokensQuery = useQuery({
    queryKey: tokensQueryKey(branchId),
    queryFn: () => callIngestTokenApi.list(branchId),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => callIngestTokenApi.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tokensQueryKey(branchId) });
      toast({ variant: "success", description: "토큰을 취소했어요" });
      setRevokeTarget(null);
    },
    onError: () => {
      toast({ variant: "destructive", description: "토큰을 취소하지 못했어요" });
    },
  });

  const tokens = tokensQuery.data ?? [];

  return (
    <section data-component={DATA_COMPONENT} data-source-component={SOURCE_COMPONENT}>
      <ContentPaper variant="v3">
        <div data-component={`${DATA_COMPONENT}_header`} className="mb-4 flex items-center gap-3">
          <div data-component={`${DATA_COMPONENT}_header_icon`} className="flex items-center justify-center w-10 h-10 rounded-xl bg-[hsl(var(--v3-primary))]/10">
            <KeyRound size={20} className="text-[hsl(var(--v3-primary))]" />
          </div>
          <div data-component={`${DATA_COMPONENT}_header_title-group`} className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground">통화 수집 토큰</h2>
            <p className="text-sm text-muted-foreground">
              n8n 등 외부 워크플로우가 통화 녹취를 업로드할 때 사용하는 인증 토큰을 관리합니다.
            </p>
          </div>
          <Button
            type="button"
            variant="positive"
            size="sm"
            data-component={`${DATA_COMPONENT}_header_issue-trigger`}
            onClick={() => setIsIssueDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            토큰 발급
          </Button>
        </div>
        <Separator className="mb-6" />

        <div data-component={`${DATA_COMPONENT}_content`}>
          {tokensQuery.isLoading ? (
            <div data-component={`${DATA_COMPONENT}_content_skeleton`} className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : tokens.length === 0 ? (
            <div data-component={`${DATA_COMPONENT}_content_empty`} className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <KeyRound size={40} className="mb-3 opacity-30" />
              <p className="text-sm">발급된 토큰이 없습니다.</p>
            </div>
          ) : (
            <Table data-component={`${DATA_COMPONENT}_content_table`}>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>발급일</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((tokenItem) => (
                  <TableRow
                    key={tokenItem.id}
                    data-component={`${DATA_COMPONENT}_content_table_row`}
                  >
                    <TableCell className="font-medium">{tokenItem.label}</TableCell>
                    <TableCell>{formatDateForDisplay(tokenItem.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={tokenItem.active ? "success" : "secondary"}>
                        {tokenItem.active ? "사용 중" : "취소됨"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {tokenItem.active ? (
                        <Button
                          type="button"
                          variant="negative-outline"
                          size="sm"
                          data-component={`${DATA_COMPONENT}_content_table_row_revoke-trigger`}
                          onClick={() => setRevokeTarget(tokenItem)}
                        >
                          취소
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {tokensQuery.isError ? (
            <p
              role="alert"
              data-component={`${DATA_COMPONENT}_content_error`}
              className="mt-4 text-sm font-medium text-red-700"
            >
              토큰 목록을 불러오지 못했습니다.
            </p>
          ) : null}
        </div>
      </ContentPaper>

      <IssueCallIngestTokenDialog
        open={isIssueDialogOpen}
        onOpenChange={setIsIssueDialogOpen}
        branchId={branchId}
        onIssued={() => {
          queryClient.invalidateQueries({ queryKey: tokensQueryKey(branchId) });
        }}
      />

      <TwoButtonModal
        open={revokeTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRevokeTarget(null);
        }}
        dataComponent={`${DATA_COMPONENT}_revoke-confirm`}
        title="토큰을 취소하시겠습니까?"
        description={
          revokeTarget
            ? `"${revokeTarget.label}" 토큰이 더 이상 통화 녹취를 수집할 수 없게 됩니다.`
            : ""
        }
        cancelLabel="닫기"
        approvalLabel="토큰 취소"
        pendingLabel="취소 중..."
        approvalVariant="destructive"
        isPending={revokeMutation.isPending}
        onApprove={() => {
          if (revokeTarget) revokeMutation.mutate(revokeTarget.id);
        }}
      />
    </section>
  );
}
