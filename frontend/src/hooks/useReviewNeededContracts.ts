"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReviewNeededContract } from "@babyjamjam/shared/types/eformsign";
import { api } from "@/lib/api/client";

async function fetchReviewNeededContracts(): Promise<ReviewNeededContract[]> {
  const { data } = await api.get<ReviewNeededContract[]>(
    "/eformsign-docs/review-needed-contracts",
  );
  return data;
}

/** Provider-review-stage (070) contracts for the dashboard 검토 필요 card. */
export function useReviewNeededContracts() {
  return useQuery<ReviewNeededContract[]>({
    queryKey: ["eformsign-documents", "review-needed-contracts"],
    queryFn: fetchReviewNeededContracts,
    staleTime: 60 * 1000,
  });
}
