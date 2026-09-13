import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import { useColors } from "@/hooks/useColors";
import { useBlockedContributors } from "@/hooks/useBlockedContributors";
import { useAuth } from "@/lib/auth";
import { submitAbuseReport } from "@workspace/api-client-react";

type SafetyTargetType = "journey" | "comment" | "user";

const REPORT_REASONS = [
  { value: "sexual_content", label: "Sexual or explicit content" },
  { value: "violent_content", label: "Violence or dangerous content" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hateful or abusive speech" },
  { value: "spam", label: "Spam or repetitive content" },
  { value: "personal_information", label: "Personal information" },
  { value: "misleading", label: "Misleading or deceptive" },
  { value: "other", label: "Something else" },
] as const;

interface UgcSafetyActionsProps {
  journeyId: number;
  targetType: SafetyTargetType;
  targetId: string | number;
  targetUserId?: string | null;
  targetUserName?: string | null;
  compact?: boolean;
  onBlocked?: () => void;
}

export function UgcSafetyActions({
  journeyId,
  targetType,
  targetId,
  targetUserId,
  targetUserName,
  compact = false,
  onBlocked,
}: UgcSafetyActionsProps) {
  const colors = useColors();
  const { isAuthenticated, login, configurationError } = useAuth();
  const { blockContributor } = useBlockedContributors();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]["value"] | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetLabel =
    targetType === "user"
      ? "contributor"
      : targetType === "comment"
        ? "comment"
        : "route";

  const open = () => {
    setReason(null);
    setDetails("");
    setSuccess(null);
    setError(null);
    setVisible(true);
  };

  const close = () => {
    if (!submitting && !blocking) setVisible(false);
  };

  const submitReport = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitAbuseReport(journeyId, {
        targetType,
        targetId: String(targetId),
        reason,
        details: details.trim() || undefined,
      });
      setSuccess("Thanks. Your report was sent to our moderation team.");
      setReason(null);
      setDetails("");
    } catch {
      setError("We couldn't send this report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const block = async () => {
    if (!targetUserId || blocking) return;
    setBlocking(true);
    setError(null);
    try {
      await blockContributor(targetUserId, targetUserName || "Contributor");
      setSuccess(`${targetUserName || "Contributor"} is now blocked on this device.`);
      onBlocked?.();
    } catch {
      setError("We couldn't save this block. Please try again.");
    } finally {
      setBlocking(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        accessibilityLabel={`Report ${targetLabel}`}
        style={[
          compact ? styles.compactButton : styles.button,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
        onPress={open}
        activeOpacity={0.75}
      >
        <Feather name="flag" size={compact ? 12 : 14} color={colors.mutedForeground} />
        {!compact ? (
          <Text style={[styles.buttonText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            Report
          </Text>
        ) : null}
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={styles.backdrop}>
          <View style={[styles.dialog, { backgroundColor: colors.background }]}>
            <View style={styles.dialogHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  Safety options
                </Text>
                <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  Help keep Mabhazi welcoming by reporting objectionable {targetLabel} content.
                </Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Close safety options"
                style={[styles.close, { backgroundColor: colors.secondary }]}
                onPress={close}
              >
                <Feather name="x" size={18} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            {!isAuthenticated ? (
              <View style={styles.signInBlock}>
                <Feather name="lock" size={18} color={colors.mutedForeground} />
                <Text style={[styles.signInText, { color: configurationError ? colors.destructive : colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {configurationError || "Sign in to send a report or block a contributor."}
                </Text>
                {configurationError ? null : (
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                    onPress={() => {
                      void login()
                        .then(close)
                        .catch((loginError: unknown) => {
                          setError(
                            loginError instanceof Error
                              ? loginError.message
                              : "Unable to start sign-in.",
                          );
                        });
                    }}
                  >
                    <Text style={[styles.primaryButtonText, { color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }]}>
                      Sign in
                    </Text>
                  </TouchableOpacity>
                )}
                {error ? (
                  <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
                    {error}
                  </Text>
                ) : null}
              </View>
            ) : success ? (
              <View style={styles.successBlock}>
                <Feather name="check-circle" size={22} color="#16A34A" />
                <Text style={[styles.successText, { color: "#16A34A", fontFamily: "Inter_600SemiBold" }]}>
                  {success}
                </Text>
              </View>
            ) : (
              <>
                <Text style={[styles.fieldLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  What&apos;s wrong?
                </Text>
                <ScrollView
                  style={styles.reasons}
                  contentContainerStyle={{ gap: 7 }}
                  showsVerticalScrollIndicator={false}
                >
                  {REPORT_REASONS.map((option) => {
                    const selected = reason === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.reason,
                          {
                            backgroundColor: selected ? colors.secondary : colors.card,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                        ]}
                        onPress={() => setReason(option.value)}
                        activeOpacity={0.75}
                      >
                        <Feather
                          name={selected ? "check-circle" : "circle"}
                          size={15}
                          color={selected ? colors.primary : colors.mutedForeground}
                        />
                        <Text style={[styles.reasonText, { color: colors.foreground, fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <TextInput
                  style={[styles.details, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border, fontFamily: "Inter_400Regular" }]}
                  value={details}
                  onChangeText={setDetails}
                  placeholder="Add details (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={1000}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                {error ? (
                  <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
                    {error}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: reason && !submitting ? colors.primary : colors.border }]}
                  onPress={() => void submitReport()}
                  disabled={!reason || submitting}
                  activeOpacity={0.8}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <>
                      <Feather name="send" size={14} color={colors.primaryForeground} />
                      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }]}>
                        Send report
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                {targetType === "user" && targetUserId ? (
                  <TouchableOpacity
                    style={[styles.blockButton, { borderColor: colors.border }]}
                    onPress={() => void block()}
                    disabled={blocking}
                    activeOpacity={0.75}
                  >
                    {blocking ? (
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    ) : (
                      <>
                        <Feather name="user-x" size={14} color={colors.mutedForeground} />
                        <Text style={[styles.blockText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                          Block {targetUserName || "this contributor"} on this device
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}
              </>
            )}

            {!isAuthenticated || success ? (
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.border }]}
                onPress={close}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  Done
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  compactButton: {
    minWidth: 28,
    minHeight: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  button: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  buttonText: { fontSize: 12 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "center",
    padding: 20,
  },
  dialog: { maxHeight: "88%", borderRadius: 20, padding: 20, gap: 13 },
  dialogHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  title: { fontSize: 19, marginBottom: 6 },
  subtitle: { fontSize: 13, lineHeight: 19 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  fieldLabel: { fontSize: 13 },
  reasons: { maxHeight: 225 },
  reason: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  reasonText: { fontSize: 13, flex: 1 },
  details: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 74,
    padding: 10,
    fontSize: 13,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 12,
  },
  primaryButtonText: { fontSize: 14 },
  blockButton: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
  },
  blockText: { fontSize: 12 },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { fontSize: 14 },
  error: { fontSize: 12, textAlign: "center" },
  signInBlock: { alignItems: "center", gap: 10, paddingVertical: 14 },
  signInText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  successBlock: { alignItems: "center", gap: 10, paddingVertical: 20 },
  successText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
});