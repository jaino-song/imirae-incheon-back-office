'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { systemTemplateService } from '@/services/system-template.service';
import { systemTemplateKeys } from './useSystemTemplates';
import type { CustomVariable, UpdateSystemTemplateResponse } from '../types';

export interface ApiErrorResponse {
  message: string;
  statusCode?: number;
}

interface UpdateParams {
  key: string;
  content: string;
  customVariables?: CustomVariable[];
}

export function useUpdateSystemTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation<UpdateSystemTemplateResponse, ApiErrorResponse, UpdateParams>({
    mutationFn: ({ key, content, customVariables }) =>
      systemTemplateService.update(key, content, customVariables).then(r => r.data),
    onSuccess: async (_, { key }) => {
      await queryClient.invalidateQueries({ queryKey: systemTemplateKeys.detail(key) });
      await queryClient.invalidateQueries({ queryKey: systemTemplateKeys.all });
    },
  });
}
