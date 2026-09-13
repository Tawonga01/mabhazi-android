export function filterBlockedContributors<
  T extends { contributorId?: string | null },
>(items: T[], blockedIds: ReadonlySet<string>): T[] {
  return items.filter(
    (item) => !item.contributorId || !blockedIds.has(item.contributorId),
  );
}

export function filterBlockedUserContent<
  T extends { userId?: string | null },
>(items: T[], blockedIds: ReadonlySet<string>): T[] {
  return items.filter(
    (item) => !item.userId || !blockedIds.has(item.userId),
  );
}