'use client';

import { useState } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useUpdateSystemTemplate } from '../hooks';
import type { SystemTemplate, CustomVariable } from '../types';

interface Props {
  template: SystemTemplate;
}

export function SystemTemplateEditor({ template }: Props) {
  const [content, setContent] = useState(template.content);
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>(
    template.customVariables || []
  );
  const [newVariable, setNewVariable] = useState({ key: '', label: '' });
  const { toast } = useToast();

  const updateMutation = useUpdateSystemTemplate();

  const handleAddCustomVariable = () => {
    if (!newVariable.key.trim() || !newVariable.label.trim()) {
      toast({
        variant: 'destructive',
        description: '변수 키와 레이블을 입력해 주세요',
      });
      return;
    }

    // Check for duplicate keys
    if (customVariables.some((v) => v.key === newVariable.key)) {
      toast({
        variant: 'destructive',
        description: '이미 있는 변수 키예요',
      });
      return;
    }

    setCustomVariables([
      ...customVariables,
      {
        key: newVariable.key,
        label: newVariable.label,
        required: true,
      },
    ]);
    setNewVariable({ key: '', label: '' });
  };

  const handleRemoveCustomVariable = (key: string) => {
    setCustomVariables(customVariables.filter((v) => v.key !== key));
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        key: template.templateKey,
        content,
        customVariables,
      });
      toast({
        variant: "success",
        description: '템플릿을 저장했어요',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '템플릿을 저장하지 못했어요';
      toast({
        variant: 'destructive',
        description: errorMessage,
      });
    }
  };

  const hasChanges =
    content !== template.content ||
    JSON.stringify(customVariables) !== JSON.stringify(template.customVariables);

  return (
    <div className="flex flex-col gap-6">
      {/* Required Variables Section */}
      {template.requiredVariables && template.requiredVariables.length > 0 && (
        <div>
          <Label className="text-sm font-semibold mb-3 block">
            필수 변수
          </Label>
          <div className="flex flex-wrap gap-2">
            {template.requiredVariables.map((variable) => (
              <Badge
                key={variable.key}
                variant="outline"
                className="text-sm"
              >
                <span className="text-destructive mr-1">*</span>
                {`${variable.label} (${variable.key})`}
              </Badge>
            ))}
          </div>
          {template.requiredVariables.some((v) => v.description) && (
            <Card className="mt-3 p-3 bg-info/10 border-info/30">
              {template.requiredVariables
                .filter((v) => v.description)
                .map((variable) => (
                  <p key={variable.key} className="text-xs mb-1 last:mb-0">
                    <strong>{variable.label}:</strong> {variable.description}
                  </p>
                ))}
            </Card>
          )}
        </div>
      )}

      {/* Content Editor */}
      <div>
        <Label className="text-sm font-semibold mb-3 block">
          템플릿 내용
        </Label>
        <Textarea
          rows={12}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="템플릿 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다."
          className="font-mono text-sm"
        />
      </div>

      {/* Custom Variables Section */}
      <div>
        <Label className="text-sm font-semibold mb-3 block">
          커스텀 변수
        </Label>

        {customVariables.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {customVariables.map((variable) => (
              <Badge
                key={variable.key}
                variant="secondary"
                className="text-sm gap-1"
              >
                {`${variable.label} (${variable.key})`}
                <button
                  type="button"
                  onClick={() => handleRemoveCustomVariable(variable.key)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <Card className="p-4">
          <div className="flex flex-row gap-2 mb-3">
            <Input
              placeholder="변수 키 (예: user_name)"
              value={newVariable.key}
              onChange={(e) =>
                setNewVariable({ ...newVariable, key: e.target.value })
              }
              className="flex-1"
            />
            <Input
              placeholder="변수 레이블 (예: 사용자 이름)"
              value={newVariable.label}
              onChange={(e) =>
                setNewVariable({ ...newVariable, label: e.target.value })
              }
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleAddCustomVariable}
            >
              <Plus className="h-4 w-4 mr-1" />
              추가
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            커스텀 변수를 추가하여 템플릿을 더 유연하게 만들 수 있습니다.
          </p>
        </Card>
      </div>

      {/* Save Button */}
      <div className="flex gap-2 justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
        >
          {updateMutation.isPending && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          )}
          {updateMutation.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  );
}
