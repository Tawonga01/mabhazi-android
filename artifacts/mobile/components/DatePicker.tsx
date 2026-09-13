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
import { useColors } from "@/hooks/useColors";

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
}

const DAYS_OF_WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const monthName = MONTHS[parseInt(m, 10) - 1];
  return `${d} ${monthName} ${y}`;
}

export function DatePicker({ value, onChange, placeholder = "Select date" }: DatePickerProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const today = new Date();
  const initialDate = value ? new Date(value + "T00:00:00") : today;

  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [selected, setSelected] = useState<string>(value || "");

  const openPicker = useCallback(() => {
    const base = value ? new Date(value + "T00:00:00") : today;
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setSelected(value || "");
    setOpen(true);
  }, [value]);

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) { setViewYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) { setViewYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const selectDay = useCallback((day: number) => {
    const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
    setSelected(iso);
  }, [viewYear, viewMonth]);

  const confirm = useCallback(() => {
    if (selected) onChange(selected);
    setOpen(false);
  }, [selected, onChange]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return (
    <>
      <TouchableOpacity
        onPress={openPicker}
        style={[
          styles.trigger,
          {
            backgroundColor: colors.card,
            borderColor: value ? colors.primary : colors.border,
          },
        ]}
        activeOpacity={0.7}
      >
        <Feather name="calendar" size={16} color={value ? colors.primary : colors.mutedForeground} />
        <Text
          style={[
            styles.triggerText,
            {
              color: value ? colors.foreground : colors.mutedForeground,
              fontFamily: value ? "Inter_500Medium" : "Inter_400Regular",
            },
          ]}
        >
          {value ? formatDisplay(value) : placeholder}
        </Text>
        {value ? (
          <TouchableOpacity
            onPress={() => { onChange(""); setSelected(""); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : (
          <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />

        <View style={styles.sheet}>
          <View style={[styles.calendar, { backgroundColor: colors.card }]}>
            <View style={styles.monthHeader}>
              <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
                <Feather name="chevron-left" size={20} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[styles.monthTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {MONTHS[viewMonth]} {viewYear}
              </Text>
              <TouchableOpacity onPress={nextMonth} style={styles.navBtn}>
                <Feather name="chevron-right" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {DAYS_OF_WEEK.map((d) => (
                <Text key={d} style={[styles.weekLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                  {d}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((day, idx) => {
                if (!day) return <View key={`e-${idx}`} style={styles.cell} />;
                const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
                const isSelected = iso === selected;
                const isToday = iso === todayIso;
                return (
                  <TouchableOpacity
                    key={iso}
                    style={[
                      styles.cell,
                      isSelected && { backgroundColor: colors.primary, borderRadius: 10 },
                      !isSelected && isToday && { borderWidth: 1.5, borderColor: colors.accent, borderRadius: 10 },
                    ]}
                    onPress={() => selectDay(day)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        {
                          color: isSelected ? colors.primaryForeground : isToday ? colors.accent : colors.foreground,
                          fontFamily: isSelected || isToday ? "Inter_600SemiBold" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {day}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => setOpen(false)}
              >
                <Text style={[styles.cancelText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  { backgroundColor: selected ? colors.primary : colors.muted },
                ]}
                onPress={confirm}
                disabled={!selected}
              >
                <Text style={[styles.confirmText, { color: selected ? colors.primaryForeground : colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                  Confirm
                </Text>
              </TouchableOpacity>
            </View>
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
    paddingVertical: 11,
  },
  triggerText: {
    flex: 1,
    fontSize: 15,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: Platform.OS === "web" ? 34 : 40,
  },
  calendar: {
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitle: {
    fontSize: 17,
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%` as any,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: {
    fontSize: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
  },
  confirmBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  confirmText: {
    fontSize: 15,
  },
});
