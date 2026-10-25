import { ui } from '@/constants/ui';
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
  TextInput,
  Animated,
  ScrollView,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import {
  customFetch,
  useGetPendingAssociations,
  useGetResolvedAssociations,
  useConfirmAssociation,
  useRejectAssociation,
  useReverseAssociation,
  getGetPendingAssociationsQueryKey,
  getGetResolvedAssociationsQueryKey,
} from "@workspace/api-client-react";
import type { ProposedAssociation } from "@workspace/api-client-react";
import { BlockedContributorsManager } from "@/components/BlockedContributorsManager";
import { clearLocalUserRatings } from "@/hooks/useLocalUserRatings";
import { TermsAcceptanceCard, useTermsAcceptance } from "@/components/TermsAcceptance";

type Colors = ReturnType<typeof import("@/hooks/useColors").useColors>;

function fmt12(t: string) {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr || "0", 10);
  const m = (mStr || "0").padStart(2, "0");
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m}${suffix}`;
}

function ProposalInbox({ colors }: { colors: Colors }) {
  const queryClient = useQueryClient();
  const terms = useTermsAcceptance();
  const { data, isLoading } = useGetPendingAssociations<{ proposals: ProposedAssociation[] }>({
    query: { queryKey: getGetPendingAssociationsQueryKey() },
  });
  const { data: resolvedData } = useGetResolvedAssociations<{ proposals: ProposedAssociation[] }>({
    query: { queryKey: getGetResolvedAssociationsQueryKey() },
  });
  const [actioned, setActioned] = useState<Set<number>>(new Set());

  const { mutateAsync: confirm } = useConfirmAssociation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPendingAssociationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      },
    },
  });
  const { mutateAsync: reject } = useRejectAssociation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPendingAssociationsQueryKey() });
      },
    },
  });
  const { mutateAsync: reverse } = useReverseAssociation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetResolvedAssociationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      },
    },
  });

  const proposals = (data?.proposals ?? []).filter(p => !actioned.has(p.id));
  const resolved = resolvedData?.proposals ?? [];

  if (isLoading) return null;
  if (!proposals.length && !resolved.length) return null;

  return (
    <View style={[styles.proposalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.proposalHeader}>
        <View style={[styles.proposalBadge, { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" }]}>
          <Feather name="link" size={12} color="#B45309" />
          <Text style={[styles.proposalBadgeText, { color: "#B45309", fontFamily: ui.type.semibold }]}>
            {proposals.length > 0
              ? `${proposals.length} route ${proposals.length === 1 ? "suggestion" : "suggestions"}`
              : `${resolved.length} confirmed ${resolved.length === 1 ? "association" : "associations"}`}
          </Text>
        </View>
        <Text style={[styles.proposalSubtitle, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
          {proposals.length > 0
            ? "Another contributor submitted a route that may share your bus. Confirm to connect them."
            : "Review or reverse route associations connected to your routes."}
        </Text>
      </View>

      {proposals.map(p => (
        <ProposalItem
          key={p.id}
          proposal={p}
          colors={colors}
          onConfirm={async () => {
             if (!(await terms.requireAcceptance())) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
             try {
               await confirm({ id: p.id });
               setActioned(prev => new Set([...prev, p.id]));
             } catch (error) {
               if ((error as { status?: number })?.status === 428) {
                 await terms.refetch();
               }
               throw error;
             }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }}
          onReject={async () => {
             if (!(await terms.requireAcceptance())) return;
            Haptics.selectionAsync();
             try {
               await reject({ id: p.id });
               setActioned(prev => new Set([...prev, p.id]));
             } catch (error) {
               if ((error as { status?: number })?.status === 428) {
                 await terms.refetch();
               }
               throw error;
             }
          }}
        />
      ))}
      {resolved.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.proposalSubtitle, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
            Confirmed associations
          </Text>
          {resolved.map((p) => (
            <ResolvedAssociationItem
              key={p.id}
              proposal={p}
              colors={colors}
              onReverse={async () => {
                if (!(await terms.requireAcceptance())) return;
                try {
                  await reverse({ id: p.id });
                } catch (error) {
                  if ((error as { status?: number })?.status === 428) {
                    await terms.refetch();
                  }
                  throw error;
                }
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ResolvedAssociationItem({
  proposal: p,
  colors,
  onReverse,
}: {
  proposal: ProposedAssociation;
  colors: Colors;
  onReverse: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={[styles.proposalItem, { borderColor: colors.border }]}>
      <View style={styles.proposalRoute}>
        <Text style={[styles.proposalRouteText, { color: colors.foreground, fontFamily: ui.type.semibold }]}>
          {p.parentFromCity} → {p.parentToCity}
        </Text>
        <Text style={[styles.proposalOperator, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
          Stop added: {p.proposedStopCity}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.rejectBtn, { borderColor: colors.border }]}
        onPress={async () => {
          setBusy(true);
          try {
            await onReverse();
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <>
            <Feather name="rotate-ccw" size={14} color={colors.mutedForeground} />
            <Text style={[styles.rejectBtnText, { color: colors.mutedForeground, fontFamily: ui.type.medium }]}>
              Reverse
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}


function ProposalItem({
  proposal: p,
  colors,
  onConfirm,
  onReject,
}: {
  proposal: ProposedAssociation;
  colors: Colors;
  onConfirm: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);

  const handle = (action: "confirm" | "reject", fn: () => Promise<void>) => async () => {
    setBusy(action);
    try { await fn(); } finally { setBusy(null); }
  };

  return (
    <View style={[styles.proposalItem, { borderColor: colors.border }]}>
      <View style={styles.proposalRoute}>
        <Text style={[styles.proposalRouteText, { color: colors.foreground, fontFamily: ui.type.semibold }]}>
          {p.parentFromCity} → {p.parentToCity}
        </Text>
        <Text style={[styles.proposalOperator, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
          {p.parentBusCompany} · {fmt12(p.parentDepartureTime)}
        </Text>
      </View>

      <View style={[styles.proposalQuestion, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
        <Feather name="map-pin" size={12} color={colors.accent} />
        <Text style={[styles.proposalQuestionText, { color: colors.foreground, fontFamily: ui.type.regular }]}>
          Does this bus stop in{" "}
          <Text style={{ fontFamily: ui.type.semibold }}>{p.proposedStopCity}</Text>
          {p.proposedStopTime ? ` at ${fmt12(p.proposedStopTime)}` : ""}
          {" "}on its way to {p.parentToCity}?
        </Text>
      </View>

      <View style={styles.proposalActions}>
        <TouchableOpacity
          style={[styles.rejectBtn, { borderColor: colors.border }]}
          onPress={handle("reject", onReject)}
          disabled={busy !== null}
          activeOpacity={0.75}
        >
          {busy === "reject"
            ? <ActivityIndicator size="small" color={colors.mutedForeground} />
            : <><Feather name="x" size={14} color={colors.mutedForeground} /><Text style={[styles.rejectBtnText, { color: colors.mutedForeground, fontFamily: ui.type.medium }]}>No</Text></>
          }
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
          onPress={handle("confirm", onConfirm)}
          disabled={busy !== null}
          activeOpacity={0.85}
        >
          {busy === "confirm"
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Feather name="check" size={14} color={colors.accentForeground} /><Text style={[styles.confirmBtnText, { fontFamily: ui.type.semibold }]}>Yes, add stop</Text></>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function LegalLinks({ colors }: { colors: Colors }) {
  const router = useRouter();
  const links = [
    { title: "Privacy", icon: "shield" as const, path: "/privacy" as const },
    { title: "Terms", icon: "file-text" as const, path: "/terms" as const },
    { title: "Support", icon: "help-circle" as const, path: "/support" as const },
  ];

  return (
    <View style={[styles.legalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.legalTitle, { color: colors.primary, fontFamily: ui.type.semibold }]}>
        Mabhazi information
      </Text>
      <View style={styles.legalLinks}>
        {links.map((link) => (
          <TouchableOpacity
            key={link.title}
            style={[styles.legalLink, { backgroundColor: colors.secondary }]}
            onPress={() => router.push(link.path)}
            activeOpacity={0.75}
          >
            <Feather name={link.icon} size={14} color={colors.primary} />
            <Text style={[styles.legalLinkText, { color: colors.primary, fontFamily: ui.type.semibold }]}>
              {link.title}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    configurationError,
  } = useAuth();
  const terms = useTermsAcceptance();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.select({
    ios: insets.bottom + 90,
    web: insets.bottom + 100,
    default: insets.bottom + 20,
  });

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nextAvailable, setNextAvailable] = useState<string | null>(
    user?.lastNameChange
      ? new Date(new Date(user.lastNameChange as string).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null
  );
  const [savedName, setSavedName] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<"idle" | "deleting" | "success">("idle");
  const [blockedManagerVisible, setBlockedManagerVisible] = useState(false);

  const successOpacity = useRef(new Animated.Value(0)).current;

  const currentDisplayName = savedName ??
    user?.displayName ??
    ([user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      user?.email?.split("@")[0] ||
      "Traveler");

  const canChange = !nextAvailable || new Date(nextAvailable).getTime() <= Date.now();

  const { mutateAsync: saveDisplayName, isPending: saving } = useMutation({
    mutationFn: (displayName: string) =>
      customFetch("/api/users/display-name", {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      }) as Promise<{ displayName: string; lastNameChange: string; nextChangeAvailable: string }>,
  });

  const handleStartEdit = () => {
    if (!canChange) return;
    Haptics.selectionAsync();
    setNameInput(currentDisplayName);
    setSaveError(null);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    const trimmed = nameInput.trim();
    if (trimmed.length < 2 || trimmed.length > 30) {
      setSaveError("Name must be 2–30 characters");
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await saveDisplayName(trimmed);
      setSavedName(result.displayName);
      setNextAvailable(result.nextChangeAvailable);
      setEditing(false);
      setSaveError(null);
      // Animate success badge
      successOpacity.setValue(1);
      Animated.timing(successOpacity, {
        toValue: 0,
        duration: 2000,
        delay: 1200,
        useNativeDriver: false,
      }).start();
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const msg =
        (err as { nextChangeAvailable?: string })?.nextChangeAvailable
          ? `Next change available ${formatDate((err as { nextChangeAvailable: string }).nextChangeAvailable)}`
          : "Could not save name. Try again.";
      setSaveError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Association proposals, ratings, and other query data are account
    // scoped. Do not leave one user's private cache available to the next
    // account on this device.
    queryClient.clear();
    clearLocalUserRatings();
    await logout();
  };

  const openDeleteModal = () => {
    Haptics.selectionAsync();
    setDeleteConfirmation("");
    setDeleteError(null);
    setDeleteState("idle");
    setDeleteModalVisible(true);
  };

  const closeDeleteModal = () => {
    if (deleteState === "deleting") return;
    setDeleteModalVisible(false);
    setDeleteConfirmation("");
    setDeleteError(null);
    setDeleteState("idle");
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation.trim() !== "DELETE MY ACCOUNT" || deleteState === "deleting") return;
    setDeleteError(null);
    setDeleteState("deleting");
    try {
      await customFetch("/api/delete-account", {
        method: "POST",
        body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }),
      });
      // Drop all server-backed route/profile/search caches before invalidating
      // the auth context. logout() then clears the existing token/session.
      queryClient.clear();
      clearLocalUserRatings();
      setDeleteState("success");
      await logout();
    } catch {
      setDeleteState("idle");
      setDeleteError("We couldn't delete your account. No data was changed; please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleLogin = async () => {
    if (configurationError) {
      setLoginMessage(configurationError);
      return;
    }
    setLoginMessage("Complete sign in in the window that opens.");
    setIsLoggingIn(true);
    try {
      await login();
      setLoginMessage("Sign-in window closed. Your profile will update when sign in completes.");
    } catch {
      setLoginMessage("Could not start sign in. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.primary, paddingTop: topPad + 8 }]}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isAuthenticated && user ? (
          <>
            {/* ── Profile card ── */}
            <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {user.profileImageUrl ? (
                <Image source={{ uri: user.profileImageUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.avatarInitial, { color: colors.primary, fontFamily: ui.type.bold }]}>
                    {currentDisplayName.charAt(0).toUpperCase() || "U"}
                  </Text>
                </View>
              )}

              {/* Display name + edit */}
              {editing ? (
                <View style={styles.editBlock}>
                  <TextInput
                    accessibilityLabel="Display name"
                    style={[
                      styles.nameInput,
                      {
                        color: colors.foreground,
                        borderColor: saveError ? colors.destructive : colors.primary,
                        backgroundColor: colors.background,
                        fontFamily: ui.type.semibold,
                      },
                    ]}
                    value={nameInput}
                    onChangeText={(t) => { setNameInput(t); setSaveError(null); }}
                    autoFocus
                    maxLength={30}
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                    placeholder="Your display name"
                    placeholderTextColor={colors.mutedForeground}
                    selectTextOnFocus
                  />
                  {saveError ? (
                    <Text style={[styles.errorText, { color: colors.destructive, fontFamily: ui.type.regular }]}>
                      {saveError}
                    </Text>
                  ) : null}
                  <View style={styles.editActions}>
                    <TouchableOpacity
                      style={[styles.cancelBtn, { borderColor: colors.border }]}
                      onPress={handleCancelEdit}
                    >
                      <Text style={[styles.cancelBtnText, { color: colors.mutedForeground, fontFamily: ui.type.medium }]}>
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.saveBtn, { backgroundColor: colors.accent }]}
                      onPress={handleSave}
                      disabled={saving}
                    >
                      {saving
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={[styles.saveBtnText, { fontFamily: ui.type.semibold }]}>Save</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.nameRow}>
                  <Text style={[styles.displayName, { color: colors.foreground, fontFamily: ui.type.bold }]}>
                    {currentDisplayName}
                  </Text>
                  {canChange ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Edit display name"
                      style={[styles.editBtn, { backgroundColor: colors.secondary }]}
                      onPress={handleStartEdit}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="edit-2" size={14} color={colors.primary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}

              {/* Success flash */}
              <Animated.View style={[styles.successBanner, { opacity: successOpacity, backgroundColor: "#DCFCE7", borderColor: "#86EFAC" }]}>
                <Feather name="check-circle" size={13} color="#16A34A" />
                <Text style={[styles.successText, { color: "#16A34A", fontFamily: ui.type.semibold }]}>
                  Name updated.
                </Text>
              </Animated.View>

              {user.email ? (
                <Text style={[styles.email, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
                  {user.email}
                </Text>
              ) : null}

              {/* Rate limit notice */}
              {nextAvailable && !canChange ? (
                <View style={[styles.rateLimitBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Feather name="clock" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.rateLimitText, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
                    Next name change in {daysUntil(nextAvailable)} day{daysUntil(nextAvailable) !== 1 ? "s" : ""}
                    {" "}· {formatDate(nextAvailable)}
                  </Text>
                </View>
              ) : editing ? (
                <Text style={[styles.changeHint, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
                  You can change your name once every 30 days.
                </Text>
              ) : null}
            </View>

            {!terms.isAccepted ? <TermsAcceptanceCard terms={terms} /> : null}

            {/* ── Pending route association proposals ── */}
            <ProposalInbox colors={colors} />

            <TouchableOpacity
              style={[styles.logoutBtn, { borderColor: colors.destructive }]}
              onPress={handleLogout}
              activeOpacity={0.8}
            >
              <Feather name="log-out" size={18} color={colors.destructive} />
              <Text style={[styles.logoutText, { color: colors.destructive, fontFamily: ui.type.semibold }]}>
                Log out
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.deleteBtn, { borderColor: colors.destructive }]}
              onPress={openDeleteModal}
              activeOpacity={0.8}
            >
              <Feather name="trash-2" size={17} color={colors.destructive} />
              <Text style={[styles.deleteText, { color: colors.destructive, fontFamily: ui.type.semibold }]}>
                Delete my account
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.guestContainer}>
            <View style={[styles.guestIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="user" size={36} color={colors.primary} />
            </View>
            <Text style={[styles.guestTitle, { color: colors.foreground, fontFamily: ui.type.bold }]}>
              Join Mabhazi
            </Text>
            <Text style={[styles.guestSubtitle, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
              Sign in to contribute.
            </Text>
            <TouchableOpacity
              style={[styles.loginBtn, { backgroundColor: isLoggingIn ? colors.mutedForeground : colors.primary }]}
              onPress={handleLogin}
              activeOpacity={0.85}
              disabled={isLoggingIn || !!configurationError}
            >
              {isLoggingIn ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather name="log-in" size={18} color={colors.accentForeground} />
              )}
              <Text style={styles.loginBtnText}>{isLoggingIn ? "Opening sign in…" : "Log in"}</Text>
            </TouchableOpacity>
            {loginMessage || configurationError ? (
              <View style={[styles.loginStatus, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Feather name={(loginMessage ?? configurationError ?? "").startsWith("Could not") || (loginMessage ?? configurationError ?? "").startsWith("Sign-in unavailable") ? "alert-circle" : "external-link"} size={14} color={colors.primary} />
                <Text style={[styles.loginStatusText, { color: colors.primary, fontFamily: ui.type.medium }]}>
                  {loginMessage ?? configurationError}
                </Text>
              </View>
            ) : null}

          </View>
        )}
        <View style={[styles.safetyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.infoTitle, { color: colors.primary, fontFamily: ui.type.semibold }]}>
            Safety controls
          </Text>
          <TouchableOpacity
            testID="manage-blocked-contributors"
            style={[styles.manageBlocksButton, { borderColor: colors.border, backgroundColor: colors.secondary }]}
            onPress={() => setBlockedManagerVisible(true)}
            activeOpacity={0.8}
          >
            <Feather name="users" size={15} color={colors.primary} />
            <Text style={[styles.manageBlocksText, { color: colors.primary, fontFamily: ui.type.semibold }]}>
              Manage blocked contributors
            </Text>
          </TouchableOpacity>
        </View>
        <LegalLinks colors={colors} />
      </ScrollView>

      <BlockedContributorsManager
        visible={blockedManagerVisible}
        onClose={() => setBlockedManagerVisible(false)}
      />

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.deleteBackdrop}>
          <View style={[styles.deleteModal, { backgroundColor: colors.card }]}>
            {deleteState === "success" ? (
              <>
                <View style={[styles.deleteIcon, { backgroundColor: "#DCFCE7" }]}>
                  <Feather name="check-circle" size={30} color="#16A34A" />
                </View>
                <Text style={[styles.deleteTitle, { color: colors.foreground, fontFamily: ui.type.bold }]}>
                  Account deleted
                </Text>
                <Text style={[styles.deleteBody, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
                  Your Mabhazi account-linked data and sessions were permanently deleted. Shared routes may remain only anonymized. Your separate Google account is unaffected.
                </Text>
                <TouchableOpacity
                  style={[styles.deleteCancelBtn, { backgroundColor: colors.primary }]}
                  onPress={closeDeleteModal}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.deleteCancelText, { color: "#FFFFFF", fontFamily: ui.type.semibold }]}>
                    Done
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={[styles.deleteIcon, { backgroundColor: "#FEE2E2" }]}>
                  <Feather name="alert-triangle" size={30} color={colors.destructive} />
                </View>
                <Text style={[styles.deleteTitle, { color: colors.foreground, fontFamily: ui.type.bold }]}>
                  Delete your Mabhazi account?
                </Text>
                <Text style={[styles.deleteBody, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
                  This permanently deletes your Mabhazi account, all sessions, signed-in searches, ratings, reports, corrections, and contributions. Shared route information can remain only without your attribution. This does not delete your separate Google account.
                </Text>
                <Text style={[styles.deleteLabel, { color: colors.foreground, fontFamily: ui.type.semibold }]}>
                  Type DELETE MY ACCOUNT to confirm
                </Text>
                <TextInput
                  style={[
                    styles.deleteInput,
                    {
                      color: colors.foreground,
                      borderColor: deleteError ? colors.destructive : colors.border,
                      backgroundColor: colors.background,
                      fontFamily: ui.type.medium,
                    },
                  ]}
                  value={deleteConfirmation}
                  onChangeText={(value) => {
                    setDeleteConfirmation(value);
                    setDeleteError(null);
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={deleteState !== "deleting"}
                  placeholder="DELETE MY ACCOUNT"
                  placeholderTextColor={colors.mutedForeground}
                />
                {deleteError ? (
                  <Text style={[styles.deleteError, { color: colors.destructive, fontFamily: ui.type.regular }]}>
                    {deleteError}
                  </Text>
                ) : null}
                <View style={styles.deleteActions}>
                  <TouchableOpacity
                    style={[styles.deleteCancelBtn, { borderColor: colors.border }]}
                    onPress={closeDeleteModal}
                    disabled={deleteState === "deleting"}
                  >
                    <Text style={[styles.deleteCancelText, { color: colors.mutedForeground, fontFamily: ui.type.semibold }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.deleteConfirmBtn,
                      {
                        backgroundColor:
                          deleteConfirmation.trim() === "DELETE MY ACCOUNT" && deleteState !== "deleting"
                            ? colors.destructive
                            : colors.muted,
                      },
                    ]}
                    onPress={handleDeleteAccount}
                    disabled={deleteConfirmation.trim() !== "DELETE MY ACCOUNT" || deleteState === "deleting"}
                  >
                    {deleteState === "deleting" ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={[styles.deleteConfirmText, { fontFamily: ui.type.semibold }]}>
                        Delete permanently
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle: { fontSize: 26, fontFamily: ui.type.bold, color: "#FFFFFF" },
  content: { padding: 16, gap: 20 },
  profileCard: {
    borderRadius: 16,
    borderWidth: 0,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  avatar: { width: 64, height: 64, borderRadius: 32, marginBottom: 4 },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarInitial: { fontSize: 32 },
  nameRow: {justifyContent: 'center', flexWrap: 'wrap',  flexDirection: "row", alignItems: "center", gap: 10 },
  displayName: { fontSize: 26 },
  editBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  editBlock: { width: "100%", gap: 8 },
  nameInput: {minHeight: 50, 
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 18,
    textAlign: "center",
  },
  errorText: {lineHeight: 21,  fontSize: 14, textAlign: "center" },
  editActions: { flexDirection: "row", gap: 10 },
  cancelBtn: {minHeight: 48, 
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelBtnText: { fontSize: 14 },
  saveBtn: {minHeight: 48, 
    flex: 2,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
  },
  saveBtnText: { color: ui.color.ink, fontSize: 16 },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  successText: { fontSize: 14 },
  email: { fontSize: 14 },
  rateLimitBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  rateLimitText: { fontSize: 14 },
  changeHint: { fontSize: 14, textAlign: "center" },
  infoCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  infoTitle: { fontSize: 19, textTransform: 'none', letterSpacing: 0 },
  infoText: { fontSize: 16, lineHeight: 24 },
  safetyCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 9 },
  manageBlocksButton: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
  },
  manageBlocksText: { fontSize: 16 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginTop: 4,
  },
  logoutText: { fontSize: 16 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: -4,
  },
  deleteText: { fontSize: 14 },
  legalCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  legalTitle: { fontSize: 19, textTransform: 'none', letterSpacing: 0 },
  legalIntro: { fontSize: 14, lineHeight: 21 },
  legalLinks: { flexDirection: 'column', gap: 0, marginTop: 4 },
  legalLink: {flexDirection: 'row', 
    flex: 0,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: 'flex-start',
    gap: 12,
  },
  legalLinkText: { fontSize: 16 },
  deleteBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,22,41,0.58)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  deleteModal: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 26,
    padding: 24,
    gap: 12,
  },
  deleteIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 2,
  },
  deleteTitle: { fontSize: 23, textAlign: "center" },
  deleteBody: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  deleteLabel: { fontSize: 14, marginTop: 4 },
  deleteInput: {minHeight: 50, 
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  deleteError: { fontSize: 14, lineHeight: 21 },
  deleteActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  deleteCancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteCancelText: { fontSize: 14 },
  deleteConfirmBtn: {
    flex: 1.5,
    minHeight: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteConfirmText: { color: "#FFFFFF", fontSize: 14 },
  guestContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 16 },
  guestIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  guestTitle: { fontSize: 28, textAlign: "center" },
  guestSubtitle: { fontSize: 16, textAlign: "center", lineHeight: 24, paddingHorizontal: 16 },
  loginBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    marginTop: 4,
  },
  loginBtnText: { color: ui.color.ink, fontSize: 16, fontFamily: ui.type.semibold },
  loginStatus: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  loginStatusText: { fontSize: 13, lineHeight: 18, textAlign: "center", flexShrink: 1 },
  featuresList: { width: "100%", borderTopWidth: 1, paddingTop: 20, marginTop: 8, gap: 14 },
  featureItem: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureText: { fontSize: 15 },
  proposalCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  proposalHeader: { gap: 8 },
  proposalBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  proposalBadgeText: { fontSize: 12 },
  proposalSubtitle: { fontSize: 14, lineHeight: 21 },
  proposalItem: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  proposalRoute: { gap: 2 },
  proposalRouteText: { fontSize: 17 },
  proposalOperator: { fontSize: 14 },
  proposalQuestion: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  proposalQuestionText: { fontSize: 14, lineHeight: 21, flex: 1 },
  proposalActions: { flexDirection: "row", gap: 8 },
  rejectBtn: {minHeight: 44, 
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  rejectBtnText: { fontSize: 14 },
  confirmBtn: {minHeight: 44, 
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  confirmBtnText: { color: ui.color.ink, fontSize: 14 },
});
