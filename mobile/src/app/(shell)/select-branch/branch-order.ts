interface BranchIdentifier {
  id: string;
}

export function prioritizeRecentBranch<TBranch extends BranchIdentifier>(
  branches: TBranch[],
  recentBranchId?: string,
): TBranch[] {
  if (!recentBranchId) {
    return branches;
  }

  const recentBranchIndex = branches.findIndex(
    (branch) => branch.id === recentBranchId,
  );

  if (recentBranchIndex <= 0) {
    return branches;
  }

  return [
    branches[recentBranchIndex],
    ...branches.slice(0, recentBranchIndex),
    ...branches.slice(recentBranchIndex + 1),
  ];
}
