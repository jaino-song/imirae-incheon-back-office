"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { callIngestTokenApi, type CreatedCallIngestToken } from "@/services/api";

const SOURCE_COMPONENT = "IssueCallIngestTokenDialog";
const DATA_COMPONENT = "desktop_settings_sections_call-ingest-tokens_issue-dialog";

interface IssueCallIngestTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  /** Fired after a successful issue, so the caller can refresh its list. */
  onIssued: () => void;
}

export function IssueCallIngestTokenDialog({
  open,
  onOpenChange,
  branchId,
  onIssued,
}: IssueCallIngestTokenDialogProps) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  // Plaintext lives only in this local state, and only for the lifetime of
  // this open dialog — reset (never written to storage) the moment it closes.
  const [issued, setIssued] = useState<CreatedCallIngestToken | null>(null);
  const [copied, setCopied] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => callIngestTokenApi.create(branchId, label.trim()),
    onSuccess: (data) => {
      setIssued(data);
      onIssued();
    },
    onError: () => {
      toast({ variant: "destructive", description: "토큰 발급에 실패했어요" });
    },
  });

  const resetAndClose = () => {
    setLabel("");
    setIssued(null);
    setCopied(false);
    onOpenChange(false);
  };

  const handleCopy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          resetAndClose();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent data-component={DATA_COMPONENT} data-source-component={SOURCE_COMPONENT}>
        {issued ? (
          <>
            <DialogHeader data-component={`${DATA_COMPONENT}_issued-header`}>
              <DialogTitle>토큰이 발급되었습니다</DialogTitle>
              <DialogDescription>
                이 토큰은 지금만 표시됩니다. 다시 표시되지 않습니다 — 안전한 곳에 복사해 두세요.
              </DialogDescription>
            </DialogHeader>
            <div data-component={`${DATA_COMPONENT}_issued-body`} className="space-y-3">
              <div className="flex items-center gap-2 rounded-xl border border-v3-border bg-v3-dim-white px-3 py-2">
                <code
                  data-component={`${DATA_COMPONENT}_issued-body_token-value`}
                  className="flex-1 break-all font-mono text-sm"
                >
                  {issued.token}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  data-component={`${DATA_COMPONENT}_issued-body_copy-trigger`}
                  aria-label="토큰 복사"
                  onClick={() => void handleCopy()}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p data-component={`${DATA_COMPONENT}_issued-body_warning`} className="text-xs font-medium text-red-700">
                다시 표시되지 않습니다.
              </p>
            </div>
            <DialogFooter data-component={`${DATA_COMPONENT}_issued-footer`}>
              <Button
                type="button"
                variant="positive"
                data-component={`${DATA_COMPONENT}_issued-footer_close-trigger`}
                onClick={resetAndClose}
              >
                확인
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader data-component={`${DATA_COMPONENT}_form-header`}>
              <DialogTitle>토큰 발급</DialogTitle>
              <DialogDescription>
                토큰을 사용할 워크플로우나 지점을 식별할 이름을 입력하세요.
              </DialogDescription>
            </DialogHeader>
            <div data-component={`${DATA_COMPONENT}_form-body`} className="space-y-2">
              <Label htmlFor="call-ingest-token-label">이름</Label>
              <Input
                id="call-ingest-token-label"
                data-component={`${DATA_COMPONENT}_form-body_label-input`}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="예: 인천본점 n8n"
                maxLength={100}
                disabled={createMutation.isPending}
              />
            </div>
            <DialogFooter data-component={`${DATA_COMPONENT}_form-footer`}>
              <Button
                type="button"
                variant="neutral"
                data-component={`${DATA_COMPONENT}_form-footer_cancel-trigger`}
                onClick={resetAndClose}
                disabled={createMutation.isPending}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="positive"
                data-component={`${DATA_COMPONENT}_form-footer_submit-trigger`}
                disabled={createMutation.isPending || label.trim().length === 0}
                aria-busy={createMutation.isPending || undefined}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "발급 중..." : "발급"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
