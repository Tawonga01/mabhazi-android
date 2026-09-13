import React, { useCallback, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import {
  getGetTermsAcceptanceStatusQueryKey,
  useAcceptTerms,
  useGetTermsAcceptanceStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@/components/VectorIcon";

/**
 * Shared terms state and gate for every community-content mutation. The
 * server remains authoritative; this hook is only a UI convenience and never
 * treats a missing status response as acceptance.
 */
export function useTermsAcceptance() {
  const { isAuthenticated, login } = useAuth();
  const queryClient = useQueryClient();
  const statusQuery = useGetTermsAcceptanceStatus({
    query: {
      queryKey: getGetTermsAcceptanceStatusQueryKey(),
      enabled: isAuthenticated,
      // This response is account-specific. Always refresh after auth changes
      // so one account's acceptance is never reused for another.
      staleTime: 0,
      refetchOnMount: "always",
      retry: false,
    },
  });
  const acceptanceMutation = useAcceptTerms();
  const [error, setError] = useState<string | null>(null);

  const status = statusQuery.data;
  const isAccepted =
    isAuthenticated && status?.requiresAcceptance === false;

  const acceptCurrentTerms = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!isAuthenticated) {
      try {
        await login();
      } catch (loginError) {
        setError(loginError instanceof Error ? loginError.message : "Sign-in is required.");
      }
      return false;
    }
    if (!status?.currentVersion) {
      setError("The current Terms could not be loaded. Please try again.");
      await statusQuery.refetch();
      return false;
    }
    try {
      const accepted = await acceptanceMutation.mutateAsync({
        data: { version: status.currentVersion },
      });
      queryClient.setQueryData(
        getGetTermsAcceptanceStatusQueryKey(),
        accepted,
      );
      return true;
    } catch (acceptError) {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : "The Terms could not be accepted. Please try again.",
      );
      return false;
    }
  }, [
    acceptanceMutation,
    isAuthenticated,
    login,
    queryClient,
    status?.currentVersion,
    statusQuery,
  ]);

  /**
   * Use this immediately before invoking a UGC mutation. Returning false is
   * intentional when acceptance is missing; callers must not proceed.
   */
  const requireAcceptance = useCallback(async (): Promise<boolean> => {
    if (isAccepted) return true;
    setError(
      isAuthenticated
        ? "Accept the current Terms before submitting community content."
        : "Sign in and accept the current Terms before submitting community content.",
    );
    return false;
  }, [isAccepted, isAuthenticated]);

  return {
    ...statusQuery,
    status,
    isAuthenticated,
    isAccepted,
    isAccepting: acceptanceMutation.isPending,
    error,
    acceptCurrentTerms,
    requireAcceptance,
  };
}

export function TermsAcceptanceCard({
  terms,
  title = "Community contributions",
}: {
  terms: ReturnType<typeof useTermsAcceptance>;
  title?: string;
}) {
  const colors = useColors();

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: terms.isAccepted ? `${colors.primary}55` : colors.border,
        borderRadius: 12,
        padding: 14,
        gap: 9,
        backgroundColor: terms.isAccepted ? `${colors.primary}08` : colors.card,
      }}
    >
      <TouchableOpacity
        accessibilityRole="checkbox"
        accessibilityState={{ checked: terms.isAccepted }}
        testID="terms-acceptance-toggle"
        onPress={() => {
          if (!terms.isAccepted) void terms.acceptCurrentTerms();
        }}
        disabled={terms.isAccepting}
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: terms.isAccepted ? colors.primary : colors.mutedForeground,
            backgroundColor: terms.isAccepted ? colors.primary : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {terms.isAccepting ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : terms.isAccepted ? (
            <Feather name="check" size={15} color={colors.primaryForeground} />
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
            }}
          >
            {terms.isAccepted ? "Terms accepted" : `Accept ${title}`}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              marginTop: 2,
            }}
          >
            {terms.isAccepted
              ? `Version ${terms.status?.currentVersion ?? ""}`
              : "Required before submitting community content"}
          </Text>
        </View>
      </TouchableOpacity>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: "Inter_400Regular",
          fontSize: 12,
          lineHeight: 17,
        }}
      >
        Routes, ratings, confirmations, corrections, reports, and comments
        should be accurate and must not contain unnecessary personal
        information.{" "}
        <Text
          onPress={() => router.push("/terms")}
          style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}
        >
          Read the Terms
        </Text>
      </Text>
      {terms.error ? (
        <Text style={{ color: colors.destructive, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          {terms.error}
        </Text>
      ) : null}
      {!terms.isAccepted && !terms.isAccepting ? (
        <TouchableOpacity onPress={() => void terms.acceptCurrentTerms()}>
          <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
            {terms.isAuthenticated ? "Tap the checkbox to accept" : "Sign in to accept"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
