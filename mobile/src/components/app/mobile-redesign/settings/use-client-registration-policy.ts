"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import {
  settingsApi,
  type ClientRegistrationPolicy,
  type ClientRegistrationPolicyPatch,
} from "@/services/api";

const QUERY_KEY = ["settings", "client-registration-policy"] as const;

interface ClientRegistrationPolicyMutationContext {
  previous: ClientRegistrationPolicy | undefined;
}

interface UseClientRegistrationPolicyResult {
  policy: ClientRegistrationPolicy | undefined;
  isLoading: boolean;
  updatePolicy: UseMutationResult<
    ClientRegistrationPolicy,
    Error,
    ClientRegistrationPolicyPatch,
    ClientRegistrationPolicyMutationContext
  >;
}

export function useClientRegistrationPolicy(): UseClientRegistrationPolicyResult {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: policy, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: settingsApi.getClientRegistrationPolicy,
  });
  const updatePolicy = useMutation({
    mutationFn: settingsApi.updateClientRegistrationPolicy,
    onMutate: async (patch: ClientRegistrationPolicyPatch) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<ClientRegistrationPolicy>(QUERY_KEY);
      queryClient.setQueryData<ClientRegistrationPolicy>(QUERY_KEY, (current) =>
        current ? { ...current, ...patch } : current,
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      toast({ variant: "destructive", description: "고객 자동 등록 설정을 저장하지 못했어요" });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved);
      toast({ variant: "success", description: "고객 자동 등록 설정을 저장했어요" });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return { policy, isLoading, updatePolicy };
}
