import React, { useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface DaysPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function DaysPicker({ value, onChange }: DaysPickerProps) {
  const colors = useColors();

  const selectedDays = value
    ? value.split(",").map((d) => d.trim()).filter(Boolean)
    : [];

  const toggleDay = useCallback(
    (day: string) => {
      Haptics.selectionAsync();
      const updated = selectedDays.includes(day)
        ? selectedDays.filter((d) => d !== day)
        : [...selectedDays, day];
      const ordered = ALL_DAYS.filter((d) => updated.includes(d));
      onChange(ordered.join(", "));
    },
    [selectedDays, onChange],
  );

  return (
    <View style={styles.row}>
      {ALL_DAYS.map((day) => {
        const isSelected = selectedDays.includes(day);
        return (
          <TouchableOpacity
            key={day}
            style={[
              styles.chip,
              {
                backgroundColor: isSelected ? colors.primary : colors.background,
                borderColor: isSelected ? colors.primary : colors.border,
              },
            ]}
            onPress={() => toggleDay(day)}
            activeOpacity={0.75}
          >
            <Text
              style={[
                styles.chipText,
                {
                  color: isSelected ? "#FFFFFF" : colors.foreground,
                  fontFamily: isSelected ? "Inter_600SemiBold" : "Inter_400Regular",
                },
              ]}
            >
              {day}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    paddingHorizontal: 8,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontSize: 13,
  },
});
