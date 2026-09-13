// Ratings are scoped to the signed-in account. The server intentionally
// cannot identify the mobile session from a public search request, so this
// short-lived cache keeps the current user's rating visible between searches.
const localUserRatings = new Map<number, number>();

export function getLocalUserRating(journeyId: number): number | undefined {
  return localUserRatings.get(journeyId);
}

export function setLocalUserRating(journeyId: number, score: number): void {
  localUserRatings.set(journeyId, score);
}

export function deleteLocalUserRating(journeyId: number): void {
  localUserRatings.delete(journeyId);
}

export function clearLocalUserRatings(): void {
  localUserRatings.clear();
}