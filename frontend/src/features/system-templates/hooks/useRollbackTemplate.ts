'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import { systemTemplateKeys } from './useSystemTemplates';

export function useRollbackTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ key, versionNumber }: { key: string; versionNumber: number }) =>
            systemTemplateService.rollback(key, versionNumber).then((r) => r.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: systemTemplateKeys.all });
        },
    });
}
