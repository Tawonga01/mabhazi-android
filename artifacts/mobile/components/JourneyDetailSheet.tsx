import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  Animated,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  TextInput,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  getJourneyDetails,
  submitJourneyReport,
  useConfirmJourney,
  useSubmitJourneyClaim,
} from "@workspace/api-client-react";
import type { SubmitJourneyReportBody } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import type { Journey } from "./JourneyCard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UgcSafetyActions } from "@/components/UgcSafetyActions";
import { BlockedContributorsManager } from "@/components/BlockedContributorsManager";
import { TermsAcceptanceCard, useTermsAcceptance } from "@/components/TermsAcceptance";
import {
  filterBlockedUserContent,
  useBlockedContributors,
} from "@/hooks/useBlockedContributors";

// ─── Types ────────────────────────────────────────────────────────────────────

type CorrectionType = "pickup_point" | "operator" | "price" | "route_inactive";

const CORRECTION_OPTIONS: Array<{
  type: CorrectionType;
  label: string;
  icon: string;
}> = [
  { type: "pickup_point", label: "Pickup point", icon: "map-pin" },
  { type: "operator", label: "Operator", icon: "truck" },
  { type: "price", label: "Price", icon: "dollar-sign" },
  { type: "route_inactive", label: "Route status", icon: "pause-circle" },
];

interface JourneyComment {
  id: number;
  userId?: string | null;
  authorName?: string | null;
  content: string;
  createdAt: string;
}

interface JourneyDetailData {
  comments: JourneyComment[];
  priceToday: number | null;
  priceYesterday: number | null;
  badTreatmentCount: number;
  breakdownCount: number;
  delays: { count: number; avgMinutes: number | null };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

type Level = "green" | "yellow" | "red" | "gray";
const LEVEL_BG: Record<Level, string> = {
  green: "#DCFCE7", yellow: "#FEF9C3", red: "#FEE2E2", gray: "#F1F5F9",
};
const LEVEL_COLOR: Record<Level, string> = {
  green: "#16A34A", yellow: "#CA8A04", red: "#DC2626", gray: "#64748B",
};

function getConfidenceLevel(
  score: number,
  status: Journey["dataStatus"],
  hasData: boolean,
): Level {
  if (!hasData) return "gray";
  if (status === "inactive" || score < 45) return "red";
  if (status === "uncertain" || score < 75) return "yellow";
  return "green";
}

function getConfidenceText(
  score: number,
  status: Journey["dataStatus"],
  hasData: boolean,
): string {
  if (!hasData) return "Confidence not available yet";
  if (status === "inactive") return "Marked inactive by the community";
  if (status === "uncertain" || score < 75) {
    return `${score}% confidence · needs more confirmations`;
  }
  return `${score}% confidence · community supported`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[ss.section, { borderColor: colors.border }]}>
      <View style={ss.sectionHead}>
        <View style={[ss.sectionIconWrap, { backgroundColor: colors.secondary }]}>
          <Feather name={icon as any} size={13} color={colors.primary} />
        </View>
        <Text style={[ss.sectionTitle, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function Indicator({ level, text }: { level: Level; text: string }) {
  return (
    <View style={[ss.indicatorPill, { backgroundColor: LEVEL_BG[level] }]}>
      <View style={[ss.indicatorDot, { backgroundColor: LEVEL_COLOR[level] }]} />
      <Text style={[ss.indicatorText, { color: LEVEL_COLOR[level], fontFamily: "Inter_500Medium" }]}>
        {text}
      </Text>
    </View>
  );
}

function YesNoCard({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View style={[ss.yesNoCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <Text style={[ss.yesNoLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
        {label}
      </Text>
      <View style={ss.yesNoButtons}>
        <TouchableOpacity
          style={[
            ss.yesNoBtn,
            {
              backgroundColor: value === true ? "#DCFCE7" : colors.secondary,
              borderColor: value === true ? "#86EFAC" : colors.border,
            },
          ]}
          onPress={() => { Haptics.selectionAsync(); onChange(true); }}
          activeOpacity={0.75}
        >
          <Feather name="check" size={14} color={value === true ? "#16A34A" : colors.mutedForeground} />
          <Text style={[
            ss.yesNoBtnText,
            { color: value === true ? "#16A34A" : colors.mutedForeground, fontFamily: value === true ? "Inter_600SemiBold" : "Inter_400Regular" },
          ]}>
            Yes
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            ss.yesNoBtn,
            {
              backgroundColor: value === false ? "#FEE2E2" : colors.secondary,
              borderColor: value === false ? "#FCA5A5" : colors.border,
            },
          ]}
          onPress={() => { Haptics.selectionAsync(); onChange(false); }}
          activeOpacity={0.75}
        >
          <Feather name="x" size={14} color={value === false ? "#DC2626" : colors.mutedForeground} />
          <Text style={[
            ss.yesNoBtnText,
            { color: value === false ? "#DC2626" : colors.mutedForeground, fontFamily: value === false ? "Inter_600SemiBold" : "Inter_400Regular" },
          ]}>
            No
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface JourneyDetailSheetProps {
  journey: Journey | null;
  visible: boolean;
  onClose: () => void;
}

const { height: SCREEN_H } = Dimensions.get("window");

export function JourneyDetailSheet({ journey, visible, onClose }: JourneyDetailSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, login } = useAuth();
  const {
    isBlocked,
    blockedContributorIds,
    isLoading: isBlockedContributorsLoading,
    error: blockedContributorsError,
  } = useBlockedContributors();
  const queryClient = useQueryClient();
  const terms = useTermsAcceptance();
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;

  const [comment, setComment] = useState("");
  const [reportedPrice, setReportedPrice] = useState("");
  const [speeding, setSpeeding] = useState<boolean | null>(null);
  const [breakdown, setBreakdown] = useState<boolean | null>(null);
  const [punctual, setPunctual] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [confirmedLocally, setConfirmedLocally] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<{
    confidenceScore: number;
    confirmationCount: number;
    lastConfirmedAt: string;
  } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [correctionType, setCorrectionType] = useState<CorrectionType>("pickup_point");
  const [correctionText, setCorrectionText] = useState("");
  const [correctionSubmitted, setCorrectionSubmitted] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [blockedManagerVisible, setBlockedManagerVisible] = useState(false);

  const resetForm = () => {
    setComment("");
    setReportedPrice("");
    setSpeeding(null);
    setBreakdown(null);
    setPunctual(null);
    setSubmitted(false);
    setConfirmedLocally(false);
    setConfirmationResult(null);
    setConfirmError(null);
    setCorrectionType("pickup_point");
    setCorrectionText("");
    setCorrectionSubmitted(false);
    setCorrectionError(null);
    setBlockedManagerVisible(false);
  };

  useEffect(() => {
    if (visible) {
      resetForm();
      Animated.spring(translateY, {
        toValue: 0, useNativeDriver: true, tension: 65, friction: 11,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_H, duration: 260, useNativeDriver: true,
      }).start();
    }
  }, [visible, journey?.id]);

  useEffect(() => {
    if (visible && journey?.contributorId && isBlocked(journey.contributorId)) {
      onClose();
    }
  }, [isBlocked, journey?.contributorId, onClose, visible]);

  const { data, isLoading } = useQuery<JourneyDetailData>({
    queryKey: ["/api/journeys", journey?.id, "details"],
    queryFn: () => getJourneyDetails(journey!.id),
    enabled:
      visible &&
      !!journey &&
      !isBlockedContributorsLoading &&
      !blockedContributorsError,
    staleTime: 30_000,
  });

  const { mutateAsync: submitReport, isPending: submitting } = useMutation({
    mutationFn: (body: SubmitJourneyReportBody) =>
      submitJourneyReport(journey!.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journeys", journey?.id, "details"] });
    },
  });

  const { mutateAsync: confirmJourney, isPending: confirming } = useConfirmJourney();
  const { mutateAsync: submitClaim, isPending: submittingClaim } = useSubmitJourneyClaim();

  const handleConfirm = async () => {
    if (!journey || confirming) return;
    if (!(await terms.requireAcceptance())) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfirmError(null);

    try {
      const result = await confirmJourney({ id: journey.id });
      setConfirmationResult(result);
      setConfirmedLocally(true);
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if ((error as { status?: number })?.status === 428) {
        await terms.refetch();
      }
      setConfirmError("We couldn't save your confirmation. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleSubmitCorrection = async () => {
    if (!journey || submittingClaim || correctionText.trim().length === 0) return;
    if (!(await terms.requireAcceptance())) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCorrectionError(null);

    const text = correctionText.trim();
    const value: { text: string; reportedPrice?: number } = { text };

    if (correctionType === "price") {
      const reportedPrice = Number.parseFloat(text);
      if (!Number.isFinite(reportedPrice) || reportedPrice < 0) {
        setCorrectionError("Enter a valid price, such as 12.50.");
        return;
      }
      value.reportedPrice = reportedPrice;
    }

    try {
      await submitClaim({
        id: journey.id,
        data: {
          type: correctionType,
          value,
        },
      });
      setCorrectionText("");
      setCorrectionSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journeys", journey.id, "details"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if ((error as { status?: number })?.status === 428) {
        await terms.refetch();
      }
      setCorrectionError("We couldn't save that correction. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const hasAnything =
    comment.trim().length > 0 ||
    reportedPrice.trim().length > 0 ||
    speeding !== null ||
    breakdown !== null ||
    punctual !== null;

  const handleSubmit = async () => {
    if (!hasAnything || submitting) return;
    if (!(await terms.requireAcceptance())) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const tasks: Promise<unknown>[] = [];

    if (comment.trim()) {
      tasks.push(submitReport({ type: "comment", content: comment.trim() }));
    }
    if (reportedPrice.trim()) {
      const p = parseFloat(reportedPrice);
      if (!isNaN(p) && p > 0) {
        tasks.push(submitReport({ type: "price", reportedPrice: p }));
      }
    }
    if (speeding === true) {
      tasks.push(submitReport({ type: "bad_treatment", content: "Speeding reported" }));
    }
    if (breakdown === true) {
      tasks.push(submitReport({ type: "breakdown", content: "Breakdown reported" }));
    }
    if (punctual === false) {
      tasks.push(submitReport({ type: "departure_delay", minutesLate: 0, content: "Not punctual" }));
    }

    try {
      await Promise.all(tasks);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
      setComment("");
      setReportedPrice("");
      setSpeeding(null);
      setBreakdown(null);
      setPunctual(null);
    } catch (error) {
      if ((error as { status?: number })?.status === 428) {
        await terms.refetch();
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  if (!journey) return null;

  if (visible && (isBlockedContributorsLoading || blockedContributorsError)) {
    return (
      <Modal
        visible
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <View style={ss.backdrop}>
          <View style={[ss.sheet, { backgroundColor: colors.background, justifyContent: "center", padding: 24 }]}>
            <Feather
              name={blockedContributorsError ? "alert-triangle" : "shield"}
              size={34}
              color={blockedContributorsError ? colors.destructive : colors.primary}
            />
            <Text style={[ss.emptyText, { color: blockedContributorsError ? colors.destructive : colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {blockedContributorsError || "Loading safety settings…"}
            </Text>
            <TouchableOpacity
              style={[ss.confirmBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={onClose}
            >
              <Text style={[ss.confirmBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  const visibleComments =
    !isBlockedContributorsLoading && !blockedContributorsError && data
    ? filterBlockedUserContent(data.comments, blockedContributorIds)
    : [];

  const safetyLevel: Level = !data ? "gray"
    : data.badTreatmentCount === 0 ? "green"
    : data.badTreatmentCount <= 2 ? "yellow" : "red";
  const safetyText = !data ? "Loading…"
    : data.badTreatmentCount === 0 ? "No complaints reported"
    : `${data.badTreatmentCount} complaint${data.badTreatmentCount === 1 ? "" : "s"} reported`;

  const reliabilityLevel: Level = !data ? "gray"
    : data.breakdownCount === 0 ? "green"
    : data.breakdownCount <= 2 ? "yellow" : "red";
  const reliabilityText = !data ? "Loading…"
    : data.breakdownCount === 0 ? "No breakdowns reported (90 days)"
    : `${data.breakdownCount} breakdown${data.breakdownCount === 1 ? "" : "s"} in 90 days`;

  const punctualityLevel: Level = !data ? "gray"
    : data.delays.count === 0 ? "green"
    : (data.delays.avgMinutes ?? 0) > 30 ? "red" : "yellow";
  const punctualityText = !data ? "Loading…"
    : data.delays.count === 0 ? "No delays reported this month"
    : `${data.delays.count} delay${data.delays.count === 1 ? "" : "s"} · avg ${Math.round(data.delays.avgMinutes ?? 0)} min late`;

  const confidenceScore = confirmationResult?.confidenceScore ?? journey.confidenceScore ?? 0;
  const confirmationCount =
    confirmationResult?.confirmationCount ?? journey.confirmationCount ?? 0;
  const lastConfirmedAt =
    confirmationResult?.lastConfirmedAt ?? journey.lastConfirmedAt ?? null;
  const hasConfidenceData =
    confirmationResult !== null ||
    journey.confidenceScore !== undefined ||
    journey.confirmationCount !== undefined;
  const confidenceLevel = getConfidenceLevel(
    confidenceScore,
    journey.dataStatus,
    hasConfidenceData,
  );
  const confidenceText = getConfidenceText(
    confidenceScore,
    journey.dataStatus,
    hasConfidenceData,
  );

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <View style={ss.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />

          <Animated.View
            style={[ss.sheet, { backgroundColor: colors.background, transform: [{ translateY }] }]}
          >
          {/* Drag handle */}
          <View style={ss.handleWrap}>
            <View style={[ss.handle, { backgroundColor: colors.border }]} />
          </View>

          {/* Header */}
          <View style={[ss.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
            <View style={[ss.companyBadge, { backgroundColor: colors.primary }]}>
              <Feather name="truck" size={12} color="#fff" />
              <Text style={ss.companyBadgeText} numberOfLines={1}>{journey.busCompany}</Text>
            </View>
            <View style={ss.headerRoute}>
              <Text style={[ss.headerCity, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                numberOfLines={1}>{journey.fromCity}</Text>
              <Feather name="arrow-right" size={14} color={colors.mutedForeground} />
              <Text style={[ss.headerCity, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                numberOfLines={1}>{journey.toCity}</Text>
            </View>
            <TouchableOpacity
              style={[ss.closeBtn, { backgroundColor: colors.secondary }]}
              onPress={onClose}
            >
              <Feather name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              contentContainerStyle={[ss.scrollContent, { paddingBottom: Platform.OS === "ios" ? insets.bottom + 20 : 40 }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {isLoading ? (
                <View style={ss.centered}>
                  <ActivityIndicator color={colors.primary} size="large" />
                  <Text style={[ss.mutedText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    Loading community data…
                  </Text>
                </View>
              ) : (
                <>
                  <TermsAcceptanceCard terms={terms} />
                  {/* ── UGC safety controls ── */}
                  <Section title="Safety" icon="shield">
                    <Text style={[ss.correctionIntro, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                      Report objectionable route content or a contributor. Blocking is local to this device, reversible, and hides that contributor&apos;s public routes and comments.
                    </Text>
                    <View style={ss.safetyActionRow}>
                      <UgcSafetyActions
                        journeyId={journey.id}
                        targetType="journey"
                        targetId={journey.id}
                      />
                      {journey.contributorId ? (
                        <UgcSafetyActions
                          journeyId={journey.id}
                          targetType="user"
                          targetId={journey.contributorId}
                          targetUserId={journey.contributorId}
                          targetUserName={journey.contributorName}
                        />
                      ) : null}
                    </View>
                    <TouchableOpacity
                      style={[ss.manageBlocksButton, { borderColor: colors.border, backgroundColor: colors.card }]}
                      onPress={() => setBlockedManagerVisible(true)}
                      activeOpacity={0.75}
                    >
                      <Feather name="users" size={14} color={colors.primary} />
                      <Text style={[ss.manageBlocksText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                        Manage blocked contributors
                      </Text>
                    </TouchableOpacity>
                  </Section>

                  {/* ── Route confidence ── */}
                  <Section title="Route confidence" icon="shield">
                    <View style={ss.confidenceTopRow}>
                      <Indicator level={confidenceLevel} text={confidenceText} />
                      <Text style={[ss.confidenceScore, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                        {hasConfidenceData ? `${confidenceScore}%` : "—"}
                      </Text>
                    </View>

                    <View style={[ss.confidenceTrack, { backgroundColor: colors.muted }]}>
                      <View
                        style={[
                          ss.confidenceFill,
                          {
                            width: `${Math.max(0, Math.min(100, confidenceScore))}%`,
                            backgroundColor: LEVEL_COLOR[confidenceLevel],
                          },
                        ]}
                      />
                    </View>

                    <View style={ss.confidenceMeta}>
                      <Text style={[ss.confidenceMetaText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        {confirmationCount > 0
                          ? `${confirmationCount} community confirmation${confirmationCount === 1 ? "" : "s"}`
                          : "No community confirmations yet"}
                      </Text>
                      <Text style={[ss.confidenceMetaText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        {lastConfirmedAt ? `Last confirmed ${timeAgo(lastConfirmedAt)}` : "Awaiting first confirmation"}
                      </Text>
                    </View>

                    {confirmedLocally ? (
                      <View style={[ss.successBanner, { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" }]}>
                        <Feather name="check-circle" size={15} color="#16A34A" />
                        <Text style={[ss.successText, { color: "#16A34A", fontFamily: "Inter_600SemiBold" }]}>
                          Thanks — your confirmation strengthens this route.
                        </Text>
                      </View>
                    ) : isAuthenticated ? (
                      <TouchableOpacity
                        testID="confirm-journey-button"
                        style={[ss.confirmBtn, { backgroundColor: colors.primary }]}
                        onPress={handleConfirm}
                        disabled={confirming}
                        activeOpacity={0.8}
                      >
                        {confirming ? (
                          <ActivityIndicator size="small" color={colors.primaryForeground} />
                        ) : (
                          <>
                            <Feather name="check-circle" size={16} color={colors.primaryForeground} />
                            <Text style={[ss.confirmBtnText, { color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }]}>
                              Confirm this route is operating
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        testID="sign-in-to-confirm-button"
                        style={[ss.confirmBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                        onPress={login}
                        activeOpacity={0.8}
                      >
                        <Feather name="log-in" size={16} color={colors.primary} />
                        <Text style={[ss.confirmBtnText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                          Sign in to confirm this route
                        </Text>
                      </TouchableOpacity>
                    )}

                    {confirmError ? (
                      <Text style={[ss.confirmError, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
                        {confirmError}
                      </Text>
                    ) : null}
                  </Section>

                  {/* ── Structured corrections ── */}
                  <Section title="Correct route details" icon="edit-3">
                    <Text style={[ss.correctionIntro, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                      Spotted something different? Small corrections help keep this route useful for everyone.
                    </Text>

                    {isAuthenticated ? (
                      <>
                        <View style={ss.correctionOptions}>
                          {CORRECTION_OPTIONS.map((option) => {
                            const selected = correctionType === option.type;
                            return (
                              <TouchableOpacity
                                key={option.type}
                                testID={`correction-option-${option.type}`}
                                style={[
                                  ss.correctionOption,
                                  {
                                    backgroundColor: selected ? colors.secondary : colors.card,
                                    borderColor: selected ? colors.primary : colors.border,
                                  },
                                ]}
                                onPress={() => {
                                  Haptics.selectionAsync();
                                  setCorrectionType(option.type);
                                  setCorrectionError(null);
                                }}
                                activeOpacity={0.75}
                              >
                                <Feather
                                  name={option.icon as any}
                                  size={13}
                                  color={selected ? colors.primary : colors.mutedForeground}
                                />
                                <Text
                                  style={[
                                    ss.correctionOptionLabel,
                                    {
                                      color: selected ? colors.primary : colors.foreground,
                                      fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular",
                                    },
                                  ]}
                                >
                                  {option.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        <TextInput
                          testID="correction-input"
                          style={[ss.correctionInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card, fontFamily: "Inter_400Regular" }]}
                          placeholder={
                            correctionType === "pickup_point"
                              ? "What is the correct pickup point?"
                              : correctionType === "operator"
                              ? "What is the correct operator name?"
                              : correctionType === "price"
                              ? "What did you pay? e.g. 12.50"
                              : "What changed about this route?"
                          }
                          placeholderTextColor={colors.mutedForeground}
                          value={correctionText}
                          onChangeText={(text) => {
                            setCorrectionText(text);
                            setCorrectionSubmitted(false);
                            setCorrectionError(null);
                          }}
                          keyboardType={correctionType === "price" ? "decimal-pad" : "default"}
                          maxLength={240}
                          multiline={correctionType !== "price"}
                          numberOfLines={correctionType !== "price" ? 2 : 1}
                          textAlignVertical={correctionType !== "price" ? "top" : "center"}
                        />

                        <TouchableOpacity
                          testID="submit-correction-button"
                          style={[
                            ss.correctionSubmitBtn,
                            {
                              backgroundColor: correctionText.trim() && !submittingClaim
                                ? colors.accent
                                : colors.border,
                            },
                          ]}
                          onPress={handleSubmitCorrection}
                          disabled={!correctionText.trim() || submittingClaim}
                          activeOpacity={0.8}
                        >
                          {submittingClaim ? (
                            <ActivityIndicator size="small" color={colors.accentForeground} />
                          ) : (
                            <>
                              <Feather name="send" size={15} color={colors.accentForeground} />
                              <Text style={[ss.correctionSubmitText, { color: colors.accentForeground, fontFamily: "Inter_600SemiBold" }]}>
                                Submit correction
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>

                        {correctionSubmitted ? (
                          <View style={[ss.successBanner, { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" }]}>
                            <Feather name="check-circle" size={15} color="#16A34A" />
                            <Text style={[ss.successText, { color: "#16A34A", fontFamily: "Inter_600SemiBold" }]}>
                              Correction recorded — thank you for improving this route.
                            </Text>
                          </View>
                        ) : null}
                        {correctionError ? (
                          <Text style={[ss.confirmError, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
                            {correctionError}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <TouchableOpacity
                        testID="sign-in-to-correct-button"
                        style={[ss.confirmBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                        onPress={login}
                        activeOpacity={0.8}
                      >
                        <Feather name="log-in" size={16} color={colors.primary} />
                        <Text style={[ss.confirmBtnText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                          Sign in to suggest a correction
                        </Text>
                      </TouchableOpacity>
                    )}
                  </Section>

                  {/* ── Community Comments ── */}
                  <Section title="Community" icon="message-circle">
                    {isBlockedContributorsLoading ? (
                      <Text style={[ss.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        Loading safety settings…
                      </Text>
                    ) : blockedContributorsError ? (
                      <Text style={[ss.emptyText, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
                        {blockedContributorsError}
                      </Text>
                    ) : visibleComments.length > 0 ? (
                      visibleComments.map((c) => (
                        <View key={c.id} style={ss.commentRow}>
                          <View style={[ss.avatar, { backgroundColor: colors.secondary }]}>
                            <Feather name="user" size={12} color={colors.mutedForeground} />
                          </View>
                          <View style={ss.commentBody}>
                            {c.authorName ? (
                              <Text style={[ss.commentAuthor, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                                {c.authorName}
                              </Text>
                            ) : null}
                            <Text style={[ss.commentText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                              {c.content}
                            </Text>
                            <Text style={[ss.commentTime, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                              {timeAgo(c.createdAt)}
                            </Text>
                          </View>
                          <UgcSafetyActions
                            journeyId={journey.id}
                            targetType="comment"
                            targetId={c.id}
                            targetUserId={c.userId}
                            targetUserName={c.authorName}
                            compact
                          />
                        </View>
                      ))
                    ) : (
                      <Text style={[ss.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        No community comments yet
                      </Text>
                    )}

                    {isAuthenticated ? (
                      <View style={[ss.inlineInputWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
                        <TextInput
                          style={[ss.inlineTextArea, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
                          placeholder="Share your experience with this route…"
                          placeholderTextColor={colors.mutedForeground}
                          value={comment}
                          onChangeText={setComment}
                          multiline
                          numberOfLines={3}
                          maxLength={400}
                          textAlignVertical="top"
                        />
                      </View>
                    ) : (
                      <View style={ss.signInRow}>
                        <Feather name="lock" size={13} color={colors.mutedForeground} />
                        <Text style={[ss.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                          Sign in to comment
                        </Text>
                      </View>
                    )}
                  </Section>

                  {/* ── Fare Tracker ── */}
                  <Section title="Fare Tracker" icon="dollar-sign">
                    <View style={ss.fareRow}>
                      <View style={[ss.fareBlock, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                        <Text style={[ss.fareLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                          Listed price
                        </Text>
                        <Text style={[ss.fareValue, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                          ${journey.price.toFixed(2)}
                        </Text>
                      </View>

                      {data?.priceToday != null ? (
                        <View style={[ss.fareBlock, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                          <Text style={[ss.fareLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                            Community today
                          </Text>
                          <Text style={[ss.fareValue, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                            ${data.priceToday.toFixed(2)}
                          </Text>
                          {data.priceYesterday != null && data.priceToday !== data.priceYesterday && (
                            <View style={[
                              ss.fareChangePill,
                              { backgroundColor: data.priceToday > data.priceYesterday ? "#FEE2E2" : "#DCFCE7" },
                            ]}>
                              <Feather
                                name={data.priceToday > data.priceYesterday ? "trending-up" : "trending-down"}
                                size={11}
                                color={data.priceToday > data.priceYesterday ? "#DC2626" : "#16A34A"}
                              />
                              <Text style={[ss.fareChangeText, {
                                color: data.priceToday > data.priceYesterday ? "#DC2626" : "#16A34A",
                                fontFamily: "Inter_500Medium",
                              }]}>
                                was ${data.priceYesterday.toFixed(2)} yesterday
                              </Text>
                            </View>
                          )}
                          {data.priceYesterday != null && data.priceToday === data.priceYesterday && (
                            <Text style={[ss.fareStable, { color: "#16A34A", fontFamily: "Inter_400Regular" }]}>
                              Same as yesterday
                            </Text>
                          )}
                        </View>
                      ) : isAuthenticated ? (
                        <View style={[ss.fareBlock, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                          <Text style={[ss.fareLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                            What I paid
                          </Text>
                          <View style={ss.fareInputRow}>
                            <Text style={[ss.fareInputPrefix, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                              $
                            </Text>
                            <TextInput
                              style={[ss.fareInput, { color: colors.foreground, fontFamily: "Inter_700Bold", borderBottomColor: colors.border }]}
                              placeholder="0.00"
                              placeholderTextColor={colors.mutedForeground}
                              value={reportedPrice}
                              onChangeText={setReportedPrice}
                              keyboardType="decimal-pad"
                              maxLength={8}
                            />
                          </View>
                        </View>
                      ) : (
                        <View style={[ss.fareBlock, ss.fareBlockEmpty, { backgroundColor: colors.secondary, borderColor: colors.border, borderStyle: "dashed" }]}>
                          <Feather name="lock" size={14} color={colors.mutedForeground} />
                          <Text style={[ss.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 4 }]}>
                            Sign in to report
                          </Text>
                        </View>
                      )}
                    </View>
                    {/* If already has community price, also show input for authenticated users */}
                    {isAuthenticated && data?.priceToday != null && (
                      <View style={ss.fareUpdateRow}>
                        <Text style={[ss.fareLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                          What I paid today ($)
                        </Text>
                        <View style={ss.fareInputRow}>
                          <Text style={[ss.fareInputPrefix, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>$</Text>
                          <TextInput
                            style={[ss.fareInput, { color: colors.foreground, fontFamily: "Inter_700Bold", borderBottomColor: colors.border }]}
                            placeholder="0.00"
                            placeholderTextColor={colors.mutedForeground}
                            value={reportedPrice}
                            onChangeText={setReportedPrice}
                            keyboardType="decimal-pad"
                            maxLength={8}
                          />
                        </View>
                      </View>
                    )}
                  </Section>

                  {/* ── Community Insights ── */}
                  <Section title="Community Insights" icon="bar-chart-2">
                    <Indicator level={safetyLevel} text={safetyText} />
                    <Indicator level={reliabilityLevel} text={reliabilityText} />
                    <Indicator level={punctualityLevel} text={punctualityText} />
                  </Section>

                  {/* ── Yes/No Report Cards ── */}
                  {isAuthenticated ? (
                    <Section title="Trip Report" icon="clipboard">
                      <YesNoCard label="(Speeding)" value={speeding} onChange={setSpeeding} />
                      <YesNoCard label="(Breakdowns)" value={breakdown} onChange={setBreakdown} />
                      <YesNoCard label="(Punctual Departure)" value={punctual} onChange={setPunctual} />

                      {submitted && (
                        <View style={[ss.successBanner, { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" }]}>
                          <Feather name="check-circle" size={15} color="#16A34A" />
                          <Text style={[ss.successText, { color: "#16A34A", fontFamily: "Inter_600SemiBold" }]}>
                            Report submitted — thank you!
                          </Text>
                        </View>
                      )}

                      <TouchableOpacity
                        style={[
                          ss.submitBtn,
                          { backgroundColor: hasAnything ? colors.accent : colors.border },
                        ]}
                        onPress={handleSubmit}
                        disabled={!hasAnything || submitting}
                        activeOpacity={0.8}
                      >
                        {submitting
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={[ss.submitBtnText, { fontFamily: "Inter_600SemiBold" }]}>Submit Report</Text>
                        }
                      </TouchableOpacity>
                    </Section>
                  ) : (
                    <Section title="Trip Report" icon="clipboard">
                      <View style={ss.signInRow}>
                        <Feather name="lock" size={15} color={colors.mutedForeground} />
                        <Text style={[ss.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                          Sign in to submit a trip report
                        </Text>
                      </View>
                    </Section>
                  )}
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
          </Animated.View>
        </View>
      </Modal>
      <BlockedContributorsManager
        visible={blockedManagerVisible}
        onClose={() => setBlockedManagerVisible(false)}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.52)",
    justifyContent: "flex-end",
  },
  sheet: {
    height: SCREEN_H * 0.9,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.15, shadowRadius: 24 },
      android: { elevation: 24 },
    }),
  },
  handleWrap: { alignItems: "center", paddingVertical: 10 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  companyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
    maxWidth: "34%",
  },
  companyBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff", flexShrink: 1 },
  headerRoute: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
  },
  headerCity: { fontSize: 14, flexShrink: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },
  termsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  termsCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  termsText: { flex: 1, fontSize: 12, lineHeight: 18 },
  termsError: { fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  centered: { paddingVertical: 48, alignItems: "center", gap: 14 },
  mutedText: { fontSize: 14 },
  section: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionIconWrap: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8 },
  emptyText: { fontSize: 13, fontStyle: "italic" },
  confidenceTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  confidenceScore: { fontSize: 18 },
  confidenceTrack: {
    height: 7,
    borderRadius: 4,
    overflow: "hidden",
  },
  confidenceFill: { height: "100%", borderRadius: 4 },
  confidenceMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  confidenceMetaText: { fontSize: 11, flexShrink: 1 },
  confirmBtn: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  confirmBtnText: { fontSize: 13 },
  confirmError: { fontSize: 12, textAlign: "center" },
  correctionIntro: { fontSize: 13, lineHeight: 19 },
  correctionOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  correctionOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  correctionOptionLabel: { fontSize: 12 },
  correctionInput: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  correctionSubmitBtn: {
    minHeight: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  correctionSubmitText: { fontSize: 13 },
  commentRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  commentBody: { flex: 1, gap: 3 },
  commentAuthor: { fontSize: 11 },
  commentText: { fontSize: 13, lineHeight: 19 },
  commentTime: { fontSize: 11 },
  inlineInputWrap: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  inlineTextArea: {
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: "top",
  },
  signInRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 4 },
  safetyActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  manageBlocksButton: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
  },
  manageBlocksText: { fontSize: 12 },
  fareRow: { flexDirection: "row", gap: 10 },
  fareBlock: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, gap: 6 },
  fareBlockEmpty: { alignItems: "center", justifyContent: "center", paddingVertical: 18 },
  fareLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  fareValue: { fontSize: 22 },
  fareChangePill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: "flex-start",
  },
  fareChangeText: { fontSize: 11 },
  fareStable: { fontSize: 11 },
  fareInputRow: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  fareInputPrefix: { fontSize: 18, paddingBottom: 2 },
  fareInput: {
    fontSize: 22,
    flex: 1,
    borderBottomWidth: 1.5,
    paddingBottom: 2,
  },
  fareUpdateRow: {
    gap: 6,
    paddingTop: 4,
  },
  indicatorPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20, alignSelf: "flex-start",
  },
  indicatorDot: { width: 8, height: 8, borderRadius: 4 },
  indicatorText: { fontSize: 13 },
  yesNoCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  yesNoLabel: { fontSize: 14, flex: 1 },
  yesNoButtons: { flexDirection: "row", gap: 8 },
  yesNoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  yesNoBtnText: { fontSize: 13 },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  successText: { fontSize: 13 },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  submitBtnText: { color: "#fff", fontSize: 15 },
});
