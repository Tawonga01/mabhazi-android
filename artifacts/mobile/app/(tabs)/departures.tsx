import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useSearchJourneys, useListCities } from "@workspace/api-client-react";
import { filterBlockedContributors, useBlockedContributors } from "@/hooks/useBlockedContributors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDepMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmt12(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr || "0", 10);
  const m = (mStr || "0").padStart(2, "0");
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${ampm}`;
}

interface DepStatus {
  label: string;
  minsUntil: number;
  isDeparted: boolean;
  isBoarding: boolean;
  isNext: boolean;
}

function getStatus(depTime: string): Omit<DepStatus, "isNext"> {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const depMins = parseDepMins(depTime);
  const diff = depMins - nowMins;

  if (diff < 0) {
    return { label: "tmrw", minsUntil: diff + 1440, isDeparted: true, isBoarding: false };
  }
  if (diff <= 10) {
    return { label: diff === 0 ? "Now" : `${diff}m`, minsUntil: diff, isDeparted: false, isBoarding: true };
  }
  if (diff < 60) {
    return { label: `${diff}m`, minsUntil: diff, isDeparted: false, isBoarding: false };
  }
  const hrs = Math.floor(diff / 60);
  const mins = diff % 60;
  return {
    label: mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`,
    minsUntil: diff,
    isDeparted: false,
    isBoarding: false,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COL_TIME = 80;
const COL_OP = 82;
const COL_IN = 62;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DeparturesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    blockedContributorIds,
    isLoading: isBlockedContributorsLoading,
    error: blockedContributorsError,
  } = useBlockedContributors();

  const [fromCity, setFromCity] = useState("Harare");
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: journeyData, isLoading } = useSearchJourneys(
    { fromCity },
    { query: { enabled: !!fromCity } as any },
  );

  const { data: citiesData } = useListCities({} as any);

  const cities = citiesData?.cities ?? [];
  const rawJourneys = (journeyData?.journeys ?? []) as Array<{
    id: number;
    toCity: string;
    departureTime: string;
    busCompany: string;
    pickupPoint: string;
    contributorId?: string | null;
  }>;
  const visibleJourneys =
    !isBlockedContributorsLoading && !blockedContributorsError
      ? filterBlockedContributors(rawJourneys, blockedContributorIds)
      : [];

  // Sort: upcoming first, then tomorrow's (already departed)
  const sorted = useMemo(() => {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    return [...visibleJourneys].sort((a, b) => {
      const aM = parseDepMins(a.departureTime);
      const bM = parseDepMins(b.departureTime);
      const aGone = aM < nowMins;
      const bGone = bM < nowMins;
      if (aGone !== bGone) return aGone ? 1 : -1;
      return aM - bM;
    });
  }, [visibleJourneys]);

  // Attach status and mark the first upcoming as "next"
  const rows = useMemo(() => {
    let nextMarked = false;
    return sorted.map((j) => {
      const s = getStatus(j.departureTime);
      const isNext = !nextMarked && !s.isDeparted;
      if (isNext) nextMarked = true;
      return { ...j, status: { ...s, isNext } as DepStatus };
    });
  }, [sorted]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.select({
    ios: insets.bottom + 90,
    web: insets.bottom + 100,
    default: insets.bottom + 20,
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { backgroundColor: colors.primary, paddingTop: topPad + 8 }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerLabel}>Departures from</Text>
            <TouchableOpacity
              style={styles.cityBtn}
              onPress={() => { Haptics.selectionAsync(); setPickerOpen(true); }}
              activeOpacity={0.8}
            >
              <Text style={styles.cityBtnText} numberOfLines={1}>{fromCity}</Text>
              <Feather name="chevron-down" size={20} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
          </View>
          <View style={[styles.livePill, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Schedule</Text>
          </View>
        </View>
      </View>

      {/* ── Column headers ── */}
      <View style={[styles.colHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.colLabel, { width: COL_TIME, color: colors.mutedForeground }]}>TIME</Text>
        <Text style={[styles.colLabel, styles.colDestLabel, { color: colors.mutedForeground }]}>DESTINATION</Text>
        <Text style={[styles.colLabel, { width: COL_OP, color: colors.mutedForeground }]}>OPERATOR</Text>
        <Text style={[styles.colLabel, { width: COL_IN, color: colors.mutedForeground, textAlign: "right" }]}>IN</Text>
      </View>

      {/* ── Body ── */}
      {isBlockedContributorsLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Loading safety settings…
          </Text>
        </View>
      ) : blockedContributorsError ? (
        <View style={styles.centered}>
          <Feather name="alert-triangle" size={48} color={colors.destructive} />
          <Text style={[styles.emptyTitle, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            Block settings unavailable
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {blockedContributorsError}
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Loading departures…
          </Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="inbox" size={48} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            No departures from {fromCity}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Select another city using the dropdown above
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            const { status } = item;
            const rowBg = status.isNext
              ? `${colors.primary}10`
              : index % 2 === 0
              ? colors.background
              : colors.card;

            return (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({
                    pathname: "/(tabs)",
                    params: { fromCity, toCity: item.toCity },
                  });
                }}
                style={[
                  styles.row,
                  {
                    backgroundColor: rowBg,
                    borderBottomColor: colors.border,
                    borderLeftColor: status.isNext ? colors.accent : "transparent",
                  },
                ]}
              >
                {/* Time */}
                <View style={{ width: COL_TIME }}>
                  <Text
                    style={[
                      styles.timeText,
                      {
                        color: status.isDeparted ? colors.mutedForeground : colors.foreground,
                        fontFamily: "Inter_700Bold",
                      },
                    ]}
                  >
                    {fmt12(item.departureTime)}
                  </Text>
                </View>

                {/* Destination */}
                <View style={styles.colDest}>
                  <Text
                    style={[
                      styles.destText,
                      {
                        color: status.isDeparted ? colors.mutedForeground : colors.foreground,
                        fontFamily: "Inter_700Bold",
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {item.toCity}
                  </Text>
                </View>

                {/* Operator + pickup */}
                <View style={{ width: COL_OP }}>
                  <Text
                    style={[
                      styles.opText,
                      {
                        color: status.isDeparted ? colors.mutedForeground : colors.foreground,
                        fontFamily: "Inter_500Medium",
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {item.busCompany}
                  </Text>
                  <View style={styles.pickupRow}>
                    <Feather name="map-pin" size={9} color={colors.mutedForeground} />
                    <Text
                      style={[styles.pickupText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
                      numberOfLines={1}
                    >
                      {item.pickupPoint}
                    </Text>
                  </View>
                </View>

                {/* Countdown badge + tap hint */}
                <View style={{ width: COL_IN, alignItems: "flex-end", gap: 4 }}>
                  {status.isBoarding ? (
                    <View style={[styles.badge, { backgroundColor: "#22C55E" }]}>
                      <Text style={[styles.badgeText, { color: "#fff", fontFamily: "Inter_700Bold" }]}>
                        {status.label}
                      </Text>
                    </View>
                  ) : status.isDeparted ? (
                    <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
                      <Text style={[styles.badgeText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                        tmrw
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: status.isNext ? colors.accent : colors.secondary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          {
                            color: status.isNext ? "#fff" : colors.foreground,
                            fontFamily: "Inter_600SemiBold",
                          },
                        ]}
                      >
                        {status.label}
                      </Text>
                    </View>
                  )}
                  <Feather name="chevron-right" size={11} color={colors.mutedForeground} style={{ opacity: 0.5 }} />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* ── City picker modal ── */}
      {pickerOpen ? <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}
        >
          <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: Platform.OS === "ios" ? insets.bottom : 24 }]}>
            <View style={styles.grabberWrap}>
              <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            </View>
            <View style={[styles.pickerHead, { borderBottomColor: colors.border }]}>
              <Text style={[styles.pickerTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Select departure city
              </Text>
              <TouchableOpacity
                style={[styles.pickerClose, { backgroundColor: colors.secondary }]}
                onPress={() => setPickerOpen(false)}
              >
                <Feather name="x" size={16} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              {cities.length === 0 ? (
                <View style={styles.pickerEmpty}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                cities.map((city) => {
                  const active = city === fromCity;
                  return (
                    <TouchableOpacity
                      key={city}
                      style={[
                        styles.cityRow,
                        {
                          borderBottomColor: colors.border,
                          backgroundColor: active ? `${colors.primary}0D` : "transparent",
                        },
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setPickerOpen(false);
                        requestAnimationFrame(() => setFromCity(city));
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.cityDot, { backgroundColor: active ? colors.primary : colors.border }]} />
                      <Text
                        style={[
                          styles.cityRowText,
                          {
                            color: active ? colors.primary : colors.foreground,
                            fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                          },
                        ]}
                      >
                        {city}
                      </Text>
                      {active && <Feather name="check" size={16} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal> : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  headerLeft: { flex: 1, marginRight: 12 },
  headerLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.65)",
    marginBottom: 4,
  },
  cityBtn: { flexDirection: "row", alignItems: "center", gap: 8 },
  cityBtnText: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff", flexShrink: 1 },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
    alignSelf: "flex-end",
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#4ADE80" },
  liveText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  colHeader: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  colLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  colDestLabel: { flex: 1, paddingHorizontal: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderLeftWidth: 3,
  },
  timeText: { fontSize: 14 },
  colDest: { flex: 1, paddingHorizontal: 8 },
  destText: { fontSize: 14 },
  pickupRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  pickupText: { fontSize: 11, flex: 1 },
  opText: { fontSize: 12, lineHeight: 17 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: "center",
  },
  badgeText: { fontSize: 11 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 18, textAlign: "center", marginTop: 12 },
  emptyText: { fontSize: 14, textAlign: "center" },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "70%",
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16 },
      android: { elevation: 16 },
    }),
  },
  grabberWrap: { alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  grabber: { width: 40, height: 4, borderRadius: 2 },
  pickerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
  },
  pickerTitle: { fontSize: 17 },
  pickerClose: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  pickerEmpty: { padding: 40, alignItems: "center" },
  cityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  cityDot: { width: 8, height: 8, borderRadius: 4 },
  cityRowText: { flex: 1, fontSize: 16 },
});
