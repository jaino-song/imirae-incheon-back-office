'use client';

import { useState } from 'react';
import { History, Eye, RotateCcw, RefreshCcw, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Card } from '@/components/ui/card';
import { TwoButtonModal } from '@/components/app/ui/TwoButtonModal';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { systemTemplateService } from '@/services/system-template.service';
import {
  systemTemplateKeys,
  useTemplateVersions,
  useRollbackTemplate,
  useResetTemplate,
} from '../hooks';
import type { VersionDetail, VersionHistoryItem } from '../types';

interface Props {
  templateKey: string;
  onRollback?: () => void;
}

export function VersionHistory({ templateKey, onRollback }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<
    { type: 'rollback' | 'reset'; version?: number } | null
  >(null);
  const [previewVersion, setPreviewVersion] = useState<VersionHistoryItem | null>(null);

  const { data: versions, isLoading } = useTemplateVersions(templateKey);
  const rollbackMutation = useRollbackTemplate();
  const resetMutation = useResetTemplate();

  const { data: previewDetail, isLoading: isPreviewLoading } = useQuery<VersionDetail>({
    queryKey:
      previewVersion && templateKey
        ? systemTemplateKeys.versionDetail(templateKey, previewVersion.versionNumber)
        : ['system-templates', 'version-detail', templateKey, 'disabled'],
    queryFn: async () => {
      if (!previewVersion) {
        throw new Error('previewVersion is required');
      }

      const response = await systemTemplateService.getVersionContent(
        templateKey,
        previewVersion.versionNumber,
      );
      return response.data;
    },
    enabled: !!previewVersion && !!templateKey,
  });

  const handleRollback = async (versionNumber: number) => {
    await rollbackMutation.mutateAsync({ key: templateKey, versionNumber });
    setConfirmDialog(null);
    setOpen(false);
    onRollback?.();
  };

  const handleReset = async () => {
    await resetMutation.mutateAsync(templateKey);
    setConfirmDialog(null);
    setOpen(false);
    onRollback?.();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline">
            <History className="h-4 w-4 mr-2" />
            버전 기록
          </Button>
        </SheetTrigger>
        <SheetContent className="w-[350px]">
          <SheetHeader>
            <SheetTitle>버전 기록</SheetTitle>
            <SheetDescription className="sr-only">
              시스템 메시지 템플릿 변경 이력을 확인하고 복원합니다.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <ul className="space-y-0">
                {versions?.map((version) => (
                  <li
                    key={version.versionNumber}
                    className="flex items-start gap-2 py-3 border-b border-border last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{`버전 ${version.versionNumber}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(version.createdAt).toLocaleString('ko-KR')}
                        {version.createdBy && ` · ${version.createdBy}`}
                      </p>
                    </div>

                    <div className="flex-shrink-0 flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setPreviewVersion(version)}
                        title="미리보기"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setConfirmDialog({ type: 'rollback', version: version.versionNumber })
                        }
                        title="이 버전으로 복원"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <Separator className="my-4" />

            <Button
              variant="outline"
              className="w-full text-warning border-warning hover:bg-warning/10"
              onClick={() => setConfirmDialog({ type: 'reset' })}
            >
              <RefreshCcw className="h-4 w-4 mr-2" />
              기본값으로 초기화
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Preview Dialog */}
      <Dialog open={!!previewVersion} onOpenChange={() => setPreviewVersion(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {previewVersion ? `버전 ${previewVersion.versionNumber} 미리보기` : '버전 미리보기'}
            </DialogTitle>
          </DialogHeader>
          {isPreviewLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {previewVersion && (
                <p className="text-sm text-muted-foreground mb-2">
                  {new Date(previewVersion.createdAt).toLocaleString('ko-KR')}
                  {previewVersion.createdBy && ` · ${previewVersion.createdBy}`}
                </p>
              )}
              <Card className="p-4 bg-muted/50 max-h-[420px] overflow-auto">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {previewDetail?.content ?? ''}
                </p>
              </Card>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewVersion(null)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TwoButtonModal
        open={confirmDialog !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmDialog(null);
        }}
        dataComponent="desktop_system-templates_version-approval"
        title={confirmDialog?.type === 'rollback' ? '버전 복원' : '기본값 초기화'}
        description={
          confirmDialog?.type === 'rollback'
            ? `버전 ${confirmDialog.version}으로 복원하시겠습니까? 현재 내용은 새 버전으로 저장됩니다.`
            : '기본값으로 초기화하시겠습니까? 현재 내용은 새 버전으로 저장됩니다.'
        }
        approvalLabel={confirmDialog?.type === 'rollback' ? '복원' : '초기화'}
        pendingLabel={confirmDialog?.type === 'rollback' ? '복원 중...' : '초기화 중...'}
        approvalVariant={confirmDialog?.type === 'reset' ? 'destructive' : 'positive'}
        isPending={rollbackMutation.isPending || resetMutation.isPending}
        onApprove={() => {
          if (confirmDialog?.type === 'rollback' && confirmDialog.version !== undefined) {
            void handleRollback(confirmDialog.version);
            return;
          }

          if (confirmDialog?.type === 'reset') {
            void handleReset();
          }
        }}
      />
    </>
  );
}
