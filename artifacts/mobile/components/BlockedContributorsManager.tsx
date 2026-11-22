import { ui } from '@/constants/ui';
import React from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import { useCaptureEntry } from '@/lib/capture-context';
import { useColors } from "@/hooks/useColors";
import { useBlockedContributors } from "@/hooks/useBlockedContributors";

interface BlockedContributorsManagerProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The block list is intentionally local to this device. The copy makes that
 * clear and keeps the control reversible without coupling it to profile data.
 */
export function BlockedContributorsManager({
  visible,
  onClose,
}: BlockedContributorsManagerProps) {
  const colors = useColors();
  const capture=useCaptureEntry();
  const {
    blockedContributors,
    unblockContributor,
    resetBlockedContributors,
    retryBlockedContributors,
    isLoading,
    error,
  } = useBlockedContributors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.background }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground, fontFamily: ui.type.bold }]}>
                Blocked contributors
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
                Routes and comments are hidden on this device. Unblock anytime.
              </Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Close blocked contributors"
              style={[styles.close, { backgroundColor: colors.secondary }]}
              onPress={onClose}
            >
              <Feather name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 28 }} />
          ) : error ? (
            <View style={styles.errorBlock}>
              <Text style={[styles.empty, { color: colors.destructive, fontFamily: ui.type.regular }]}>
                {error}
              </Text>
              <View style={styles.errorActions}>
                <TouchableOpacity
                  style={[styles.errorAction, { borderColor: colors.border }]}
                  onPress={() => void retryBlockedContributors()}
                >
                  <Text style={[styles.unblockText, { color: colors.primary, fontFamily: ui.type.semibold }]}>
                    Try again
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.errorAction, { backgroundColor: colors.destructive }]}
                  onPress={() => void resetBlockedContributors()}
                >
                  <Text style={[styles.unblockText, { color: colors.primaryForeground, fontFamily: ui.type.semibold }]}>
                    Reset blocked settings
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : blockedContributors.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: ui.type.regular }]}>
              You have not blocked any contributors.
            </Text>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={{ gap: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {blockedContributors.map((contributor) => (
                <View
                  key={contributor.id}
                  style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
                >
                  <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
                    <Feather name="user-x" size={15} color={colors.mutedForeground} />
                  </View>
                  <Text
                    style={[styles.name, { color: colors.foreground, fontFamily: ui.type.medium }]}
                    numberOfLines={1}
                  >
                    {contributor.name}
                  </Text>
                  <TouchableOpacity
                    accessibilityLabel={`Unblock ${contributor.name}`}
                    style={[styles.unblock, { borderColor: colors.border }]}
                    onPress={() => {
                      void unblockContributor(contributor.id);
                    }}
                  >
                    <Text style={[styles.unblockText, { color: colors.primary, fontFamily: ui.type.semibold }]}>
                      Unblock
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Account contributor blocks" style={[styles.unblock,{borderColor:colors.border}]} onPress={()=>{onClose();requestAnimationFrame(()=>capture.open({kind:'public_blocks'}));}}><Text style={[styles.unblockText,{color:colors.primary}]}>Hidden contributors on your account</Text></TouchableOpacity>
          <TouchableOpacity
            style={[styles.done, { backgroundColor: colors.primary }]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={[styles.doneText, { color: colors.primaryForeground, fontFamily: ui.type.semibold }]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "center",
    padding: 20,
  },
  dialog: {alignSelf: 'center', width: "100%", maxWidth: 450, 
    maxHeight: "82%",
    borderRadius: 26,
    padding: 20,
    gap: 16,
  },
  header: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  title: { fontSize: 23, marginBottom: 7 },
  subtitle: { fontSize: 14, lineHeight: 21 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  list: { maxHeight: 260 },
  row: {paddingVertical: 12, borderBottomWidth: 1, 
    minHeight: 52,
    borderRadius: 0,
    borderWidth: 0,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, fontSize: 16 },
  unblock: {justifyContent: 'center', minHeight: 44,  borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  unblockText: { fontSize: 14 },
  empty: { textAlign: "center", paddingVertical: 28, lineHeight: 20 },
  errorBlock: { alignItems: "stretch", gap: 4 },
  errorActions: { flexDirection: "row", gap: 8, justifyContent: "center" },
  errorAction: {justifyContent: 'center', minHeight: 44,  borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  done: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: 16 },
});
