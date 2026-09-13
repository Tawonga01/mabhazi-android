import { useCallback, useEffect, useState } from "react";
import {
  BLOCKED_CONTRIBUTORS_STORAGE_KEY,
  parseBlockedContributors,
  readBlockedContributors,
  resetBlockedContributors,
  writeBlockedContributors,
  type BlockedContributor,
} from "./blockedContributorStorage";
import {
  filterBlockedContributors,
  filterBlockedUserContent,
} from "./blockedContent";

export { filterBlockedContributors, filterBlockedUserContent };
export type { BlockedContributor };
export { BLOCKED_CONTRIBUTORS_STORAGE_KEY, parseBlockedContributors };

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface BlockedContributorsState {
  items: BlockedContributor[];
  status: LoadStatus;
  error: string | null;
}

const initialState: BlockedContributorsState = {
  // An empty list is only the pre-load state. Consumers must wait for
  // isLoading/isReady before rendering user-generated content.
  items: [],
  status: "idle",
  error: null,
};

let state: BlockedContributorsState = initialState;
let loadPromise: Promise<BlockedContributor[]> | null = null;
let loadGeneration = 0;
const listeners = new Set<(nextState: BlockedContributorsState) => void>();
let mutationQueue: Promise<void> = Promise.resolve();

function publish(nextState: BlockedContributorsState): void {
  state = nextState;
  listeners.forEach((listener) => listener(state));
}

function storageError(error: unknown): Error {
  if (error instanceof Error && error.message) return error;
  return new Error("Unable to read blocked contributor settings.");
}

async function loadBlockedContributors(): Promise<BlockedContributor[]> {
  if (state.status === "loaded") return state.items;
  if (state.status === "error") {
    throw storageError(state.error);
  }
  if (loadPromise) return loadPromise;

  const generation = loadGeneration;
  publish({ ...state, status: "loading", error: null });
  loadPromise = readBlockedContributors()
    .then((items) => {
      if (generation !== loadGeneration) return state.items;
      publish({ items, status: "loaded", error: null });
      return items;
    })
    .catch((error: unknown) => {
      if (generation !== loadGeneration) return state.items;
      const nextError = storageError(error);
      publish({ items: state.items, status: "error", error: nextError.message });
      throw nextError;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

function enqueueMutation(operation: () => Promise<void>): Promise<void> {
  const next = mutationQueue.then(operation);
  mutationQueue = next.catch(() => undefined);
  return next;
}

async function persist(items: BlockedContributor[]): Promise<void> {
  await writeBlockedContributors(items);
  publish({ items, status: "loaded", error: null });
}

export function useBlockedContributors() {
  const [snapshot, setSnapshot] =
    useState<BlockedContributorsState>(state);

  useEffect(() => {
    let active = true;
    const listener = (nextState: BlockedContributorsState) => {
      if (active) setSnapshot(nextState);
    };
    listeners.add(listener);

    // The first render intentionally exposes [] + isLoading. A failed load
    // transitions to an error state instead of pretending the list is empty.
    void loadBlockedContributors().catch(() => {
      // The error is already published for the hook and its manager to show.
    });

    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);

  const blockContributor = useCallback(async (id: string, name: string) => {
    const operation = enqueueMutation(async () => {
      const current = await loadBlockedContributors();
      if (current.some((item) => item.id === id)) return;

      await persist([
        ...current,
        {
          id,
          name: name.trim() || "Contributor",
          blockedAt: new Date().toISOString(),
        },
      ]);
    });
    await operation;
  }, []);

  const unblockContributor = useCallback(async (id: string) => {
    const operation = enqueueMutation(async () => {
      const current = await loadBlockedContributors();
      await persist(current.filter((item) => item.id !== id));
    });
    await operation;
  }, []);

  const reset = useCallback(async () => {
    const operation = enqueueMutation(async () => {
      // Invalidate an in-flight read before removing the record so a stale
      // result can never repopulate a list the user explicitly reset.
      loadGeneration += 1;
      await resetBlockedContributors();
      publish({ items: [], status: "loaded", error: null });
    });
    await operation;
  }, []);

  const retry = useCallback(async () => {
    if (state.status === "error") {
      publish({ items: state.items, status: "idle", error: null });
    }
    await loadBlockedContributors();
  }, []);

  const isBlocked = useCallback(
    (id: string | null | undefined) =>
      !!id && snapshot.items.some((item) => item.id === id),
    [snapshot.items],
  );

  return {
    blockedContributors: snapshot.items,
    blockedContributorIds: new Set(snapshot.items.map((item) => item.id)),
    isBlocked,
    blockContributor,
    unblockContributor,
    resetBlockedContributors: reset,
    retryBlockedContributors: retry,
    isLoading: snapshot.status === "idle" || snapshot.status === "loading",
    isReady: snapshot.status === "loaded",
    error: snapshot.error,
  };
}