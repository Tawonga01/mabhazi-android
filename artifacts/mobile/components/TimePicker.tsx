import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Platform,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function parse24h(value: string): { hour12: number; minute: number; ampm: "AM" | "PM" } {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour12: 7, minute: 0, ampm: "AM" };
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm: "AM" | "PM" = h < 12 ? "AM" : "PM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { hour12, minute: m, ampm };
}

function to24h(hour12: number, minute: number, ampm: "AM" | "PM"): string {
  let h24: number;
  if (ampm === "AM") {
    h24 = hour12 === 12 ? 0 : hour12;
  } else {
    h24 = hour12 === 12 ? 12 : hour12 + 12;
  }
  return `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatDisplay(value: string): string {
  if (!value) return "";
  const { hour12, minute, ampm } = parse24h(value);
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TimePicker({ value, onChange, placeholder = "Select time" }: TimePickerProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const initial = parse24h(value || "07:00");
  const [hour12, setHour12] = useState(initial.hour12);
  const [minute, setMinute] = useState(initial.minute);
  const [ampm, setAmpm] = useState<"AM" | "PM">(initial.ampm);

  const handleOpen = useCallback(() => {
    const parsed = parse24h(value || "07:00");
    setHour12(parsed.hour12);
    setMinute(parsed.minute);
    setAmpm(parsed.ampm);
    setOpen(true);
  }, [value]);

  const handleConfirm = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onChange(to24h(hour12, minute, ampm));
    setOpen(false);
  }, [hour12, minute, ampm, onChange]);

  const selectHour = (h: number) => {
    Haptics.selectionAsync();
    setHour12(h);
  };

  const selectMinute = (m: number) => {
    Haptics.selectionAsync();
    setMinute(m);
  };

  const toggleAmpm = (v: "AM" | "PM") => {
    Haptics.selectionAsync();
    setAmpm(v);
  };

  const display = formatDisplay(value);

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={handleOpen}
        activeOpacity={0.8}
      >
        <Feather name="clock" size={16} color={value ? colors.primary : colors.mutedForeground} />
        <Text
          style={[
            styles.triggerText,
            {
              color: value ? colors.foreground : colors.mutedForeground,
              fontFamily: value ? "Inter_500Medium" : "Inter_400Regular",
            },
          ]}
        >
          {display || placeholder}
        </Text>
        {value ? (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : (
          <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
        )}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        />

        <View style={styles.sheetWrapper} pointerEvents="box-none">
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                Set Time
              </Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <View style={[styles.timeDisplay, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.timeDisplayText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                {String(hour12).padStart(2, "0")} : {String(minute).padStart(2, "0")}
              </Text>
              <View style={[styles.ampmBadge, { backgroundColor: colors.primary }]}>
                <Text style={[styles.ampmBadgeText, { fontFamily: "Inter_600SemiBold" }]}>{ampm}</Text>
              </View>
            </View>

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              Hour
            </Text>
            <View style={styles.grid}>
              {HOURS.map((h) => {
                const sel = h === hour12;
                return (
                  <TouchableOpacity
                    key={h}
                    style={[
                      styles.gridCell,
                      {
                        backgroundColor: sel ? colors.primary : colors.background,
                        borderColor: sel ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => selectHour(h)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.gridCellText,
                        {
                          color: sel ? "#FFFFFF" : colors.foreground,
                          fontFamily: sel ? "Inter_600SemiBold" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {String(h).padStart(2, "0")}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              Minute
            </Text>
            <View style={styles.grid}>
              {MINUTES.map((m) => {
                const sel = m === minute;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.gridCell,
                      {
                        backgroundColor: sel ? colors.accent : colors.background,
                        borderColor: sel ? colors.accent : colors.border,
                      },
                    ]}
                    onPress={() => selectMinute(m)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.gridCellText,
                        {
                          color: sel ? "#FFFFFF" : colors.foreground,
                          fontFamily: sel ? "Inter_600SemiBold" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {String(m).padStart(2, "0")}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.ampmRow}>
              {(["AM", "PM"] as const).map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[
                    styles.ampmBtn,
                    {
                      backgroundColor: ampm === v ? colors.primary : colors.background,
                      borderColor: ampm === v ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => toggleAmpm(v)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.ampmBtnText,
                      {
                        color: ampm === v ? "#FFFFFF" : colors.foreground,
                        fontFamily: ampm === v ? "Inter_700Bold" : "Inter_400Regular",
                      },
                    ]}
                  >
                    {v}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: colors.accent }]}
              onPress={handleConfirm}
              activeOpacity={0.85}
            >
              <Feather name="check" size={18} color="#FFFFFF" />
              <Text style={[styles.confirmBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                Confirm {String(hour12).padStart(2, "0")}:{String(minute).padStart(2, "0")} {ampm}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  triggerText: {
    flex: 1,
    fontSize: 15,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheetWrapper: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    padding: 20,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 17,
  },
  timeDisplay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 4,
  },
  timeDisplayText: {
    fontSize: 36,
    letterSpacing: 2,
  },
  ampmBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  ampmBadgeText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: -4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  gridCell: {
    width: "22%",
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
  },
  gridCellText: {
    fontSize: 15,
  },
  ampmRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  ampmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
  },
  ampmBtnText: {
    fontSize: 16,
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  confirmBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
  },
});
