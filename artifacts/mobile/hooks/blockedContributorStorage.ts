import AsyncStorage from "@react-native-async-storage/async-storage";

export interface BlockedContributor {
  id: string;
  name: string;
  blockedAt: string;
}

export const BLOCKED_CONTRIBUTORS_STORAGE_KEY =
  "mabhazi.blocked-contributors.v1";

export interface BlockedContributorStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const storage: BlockedContributorStorage = AsyncStorage;

function malformedStorageError(): Error {
  return new Error(
    "Stored blocked contributor settings are malformed. Reset the settings to continue.",
  );
}

function isBlockedContributor(value: unknown): value is BlockedContributor {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<BlockedContributor>;
  return (
    typeof item.id === "string" &&
    item.id.trim().length > 0 &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    typeof item.blockedAt === "string" &&
    !Number.isNaN(Date.parse(item.blockedAt))
  );
}

/**
 * Parse the complete on-device block list without discarding malformed rows.
 *
 * Filtering invalid rows would silently remove a person's safety choices. A
 * caller must surface this error and offer the explicit reset action instead.
 */
export function parseBlockedContributors(
  raw: string | null,
): BlockedContributor[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw malformedStorageError();
  }

  if (!Array.isArray(parsed)) {
    throw malformedStorageError();
  }

  const ids = new Set<string>();
  const items: BlockedContributor[] = [];
  for (const item of parsed) {
    if (!isBlockedContributor(item)) {
      throw malformedStorageError();
    }

    if (ids.has(item.id)) {
      throw malformedStorageError();
    }
    ids.add(item.id);
    items.push({
      id: item.id,
      name: item.name,
      blockedAt: item.blockedAt,
    });
  }

  return items;
}

export async function readBlockedContributors(): Promise<BlockedContributor[]> {
  let raw: string | null;
  try {
    raw = await storage.getItem(BLOCKED_CONTRIBUTORS_STORAGE_KEY);
  } catch {
    throw new Error("Unable to read blocked contributor settings.");
  }

  return parseBlockedContributors(raw);
}

export async function writeBlockedContributors(
  items: BlockedContributor[],
): Promise<void> {
  try {
    await storage.setItem(
      BLOCKED_CONTRIBUTORS_STORAGE_KEY,
      JSON.stringify(items),
    );
  } catch {
    throw new Error("Unable to save blocked contributor settings.");
  }
}

/**
 * Explicitly clear the local setting. This is deliberately separate from
 * reading so malformed data is never replaced as an implicit fallback.
 */
export async function resetBlockedContributors(): Promise<void> {
  try {
    await storage.removeItem(BLOCKED_CONTRIBUTORS_STORAGE_KEY);
  } catch {
    throw new Error("Unable to reset blocked contributor settings.");
  }
}