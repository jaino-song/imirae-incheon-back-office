'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import { systemTemplateKeys } from './useSystemTemplates';

export function useResetTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (key: string) => systemTemplateService.reset(key).then((r) => r.data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: systemTemplateKeys.all });
        },
    });
}
