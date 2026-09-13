import React, { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated } from "react-native";
import { AntDesign, Feather, Ionicons } from "@/components/VectorIcon";
import { useColors } from "@/hooks/useColors";
import { useBlockedContributors } from "@/hooks/useBlockedContributors";
import { UgcSafetyActions } from "@/components/UgcSafetyActions";

export interface JourneyStopInfo {
  id: number;
  city: string;
  arrivalTime: string | null;
  departureTime: string | null;
  sequence: number;
}

export interface Journey {
  id: number;
  fromCity: string;
  toCity: string;
  departureTime: string;
  arrivalTime: string;
  scheduledDays: string;
  busCompany: string;
  pickupPoint: string;
  dropoffPoint: string;
  price: number;
  contributorId?: string | null;
  contributorName: string;
  createdAt: string;
  dataStatus?: "active" | "uncertain" | "inactive";
  confidenceScore?: number;
  confirmationCount?: number;
  lastConfirmedAt?: string | null;
  averageRating: number | null;
  ratingCount: number;
  userRating: number | null;
  stops: JourneyStopInfo[];
}

interface JourneyCardProps {
  journey: Journey;
  onRate?: (score: number) => void;
  onPress?: () => void;
}

function formatTime(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{1,2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = m[2].padStart(2, "0");
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${min} ${ampm}`;
}

function Stars({
  value,
  onSelect,
  size = 18,
}: {
  value: number;
  onSelect?: (score: number) => void;
  size?: number;
}) {
  const colors = useColors();
  const [hover, setHover] = useState(0);
  const display = hover > 0 ? hover : value;

  return (
    <View style={starStyles.row}>
      {[1, 2, 3, 4, 5].map((score) => {
        const filled = display >= score;
        if (onSelect) {
          return (
            <TouchableOpacity
              key={score}
              onPress={() => { setHover(0); onSelect(score); }}
              onPressIn={() => setHover(score)}
              onPressOut={() => setHover(0)}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={filled ? "star" : "star-outline"}
                size={size}
                color={filled ? "#F59E0B" : colors.border}
              />
            </TouchableOpacity>
          );
        }
        return (
          <Ionicons
            key={score}
            name={filled ? "star" : "star-outline"}
            size={size}
            color={filled ? "#F59E0B" : colors.border}
          />
        );
      })}
    </View>
  );
}

const starStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 4 },
});

function RatingSection({
  journey,
  onRate,
  onPress,
}: {
  journey: Journey;
  onRate?: (score: number) => void;
  onPress?: () => void;
}) {
  const colors = useColors();
  const hasRated = !!journey.userRating;
  const prevRated = useRef(hasRated);

  const badgeOpacity = useRef(new Animated.Value(hasRated ? 1 : 0)).current;
  const badgeScale = useRef(new Animated.Value(hasRated ? 1 : 0.8)).current;

  useEffect(() => {
    if (!prevRated.current && hasRated) {
      prevRated.current = true;
      Animated.parallel([
        Animated.spring(badgeScale, {
          toValue: 1,
          useNativeDriver: false,
          tension: 200,
          friction: 10,
        }),
        Animated.timing(badgeOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [hasRated, badgeOpacity, badgeScale]);

  const displayStars = hasRated
    ? (journey.userRating ?? 0)
    : journey.averageRating != null
    ? Math.round(journey.averageRating)
    : 0;

  return (
    <View style={styles.ratingSection}>
      <View
        style={styles.communityRow}
        onStartShouldSetResponder={() => !!onRate}
        onTouchEnd={(e) => { if (onRate) e.stopPropagation(); }}
      >
        <View style={styles.communityLeft}>
          <Text style={[styles.ratingLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Community accuracy
          </Text>
          <View style={styles.communityScoreRow}>
            <Stars
              value={displayStars}
              onSelect={!hasRated && onRate ? onRate : undefined}
              size={hasRated ? 16 : onRate ? 22 : 16}
            />
            {journey.ratingCount > 0 ? (
              <Text style={[styles.ratingCountText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {journey.ratingCount} {journey.ratingCount === 1 ? "rating" : "ratings"}
              </Text>
            ) : (
              <Text style={[styles.noRatingText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {onRate ? "Tap to rate" : "No ratings yet"}
              </Text>
            )}
          </View>
        </View>

        {/* Confirmed badge animates in after rating */}
        <Animated.View
          style={[
            styles.confirmedBadge,
            {
              opacity: badgeOpacity,
              transform: [{ scale: badgeScale }],
              backgroundColor: "#F0FDF4",
              borderColor: "#86EFAC",
            },
          ]}
        >
          <Feather name="check-circle" size={12} color="#16A34A" />
          <Text style={[styles.confirmedBadgeText, { color: "#16A34A", fontFamily: "Inter_600SemiBold" }]}>
            Rated
          </Text>
        </Animated.View>
      </View>

      {!onRate && (
        <Text style={[styles.signInHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          Sign in to rate this route
        </Text>
      )}

      {onPress && (
        <View style={[styles.tapHint, { borderTopColor: colors.border }]}>
          <Feather name="info" size={11} color={colors.mutedForeground} />
          <Text style={[styles.tapHintText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Tap card for community insights
          </Text>
        </View>
      )}
    </View>
  );
}

export function JourneyCard({ journey, onRate, onPress }: JourneyCardProps) {
  const colors = useColors();
  const { isBlocked } = useBlockedContributors();
  const hasStops = journey.stops && journey.stops.length > 0;

  // Blocking is a local, reversible safety choice. Keep the route out of the
  // public card list as soon as the shared block-list hook updates.
  if (journey.contributorId && isBlocked(journey.contributorId)) return null;

  const inner = (
    <View style={[styles.inner]}>
      <View style={styles.header}>
        <View style={[styles.companyBadge, { backgroundColor: colors.primary }]}>
          <Feather name="truck" size={12} color={colors.primaryForeground} />
          <Text style={[styles.companyText, { color: colors.primaryForeground }]} numberOfLines={1}>
            {journey.busCompany}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {journey.ratingCount > 0 ? (
            <View style={[styles.scoreBadge, { backgroundColor: "#FEF3C7" }]}>
              <AntDesign name="star" size={11} color="#F59E0B" />
              <Text style={styles.scoreBadgeText}>
                {journey.averageRating?.toFixed(1)}
              </Text>
            </View>
          ) : null}
          <View style={[styles.priceBadge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.priceText, { color: colors.accentForeground }]}>
              ${journey.price.toFixed(2)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.routeRow}>
        <View style={styles.cityBlock}>
          <Text style={[styles.timeText, { color: colors.foreground }]}>{formatTime(journey.departureTime)}</Text>
          <Text style={[styles.cityText, { color: colors.foreground }]} numberOfLines={1}>{journey.fromCity}</Text>
        </View>
        <View style={styles.routeMiddle}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          {hasStops ? (
            <>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <View style={[styles.stopDotsRow]}>
                {journey.stops.map((s) => (
                  <View key={s.id} style={[styles.stopDot, { backgroundColor: colors.primary + "55" }]} />
                ))}
              </View>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
            </>
          ) : (
            <>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <Feather name="arrow-right" size={16} color={colors.mutedForeground} />
              <View style={[styles.line, { backgroundColor: colors.border }]} />
            </>
          )}
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
        </View>
        <View style={[styles.cityBlock, styles.cityBlockRight]}>
          <Text style={[styles.timeText, { color: colors.foreground }]}>{formatTime(journey.arrivalTime)}</Text>
          <Text style={[styles.cityText, { color: colors.foreground }]} numberOfLines={1}>{journey.toCity}</Text>
        </View>
      </View>

      {/* Via-stops label */}
      {hasStops ? (
        <View style={[styles.viaRow, { backgroundColor: colors.primary + "0D" }]}>
          <Feather name="map-pin" size={11} color={colors.primary} />
          <Text style={[styles.viaText, { color: colors.primary, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
            via{" "}
            {journey.stops.map((s, i) => (
              <Text key={s.id}>
                {s.city}
                {s.arrivalTime ? ` (${formatTime(s.arrivalTime)})` : ""}
                {i < journey.stops.length - 1 ? " · " : ""}
              </Text>
            ))}
          </Text>
        </View>
      ) : null}

      <View style={styles.daysBadgeRow}>
        <Feather name="calendar" size={12} color={colors.primary} />
        <Text style={[styles.daysText, { color: colors.primary, fontFamily: "Inter_500Medium" }]}>
          {journey.scheduledDays}
        </Text>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.footer}>
        <View style={styles.footerItem}>
          <Feather name="map-pin" size={12} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]} numberOfLines={1}>
            From: {journey.pickupPoint}
          </Text>
        </View>
        <View style={styles.footerItem}>
          <Feather name="flag" size={12} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]} numberOfLines={1}>
            To: {journey.dropoffPoint}
          </Text>
        </View>
        <View style={styles.footerItem}>
          <Feather name="user" size={12} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            by {journey.contributorName}
          </Text>
        </View>
        <View
          style={styles.safetyActions}
          onStartShouldSetResponder={() => true}
          onTouchEnd={(event) => event.stopPropagation()}
        >
          <UgcSafetyActions
            journeyId={journey.id}
            targetType="journey"
            targetId={journey.id}
            compact
          />
          {journey.contributorId ? (
            <UgcSafetyActions
              journeyId={journey.id}
              targetType="user"
              targetId={journey.contributorId}
              targetUserId={journey.contributorId}
              targetUserName={journey.contributorName}
              compact
            />
          ) : null}
        </View>
      </View>

      <View style={[styles.ratingDivider, { backgroundColor: colors.border }]} />

      <RatingSection journey={journey} onRate={onRate} onPress={onPress} />
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={onPress}
        activeOpacity={0.92}
      >
        {inner}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  inner: { padding: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  companyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    maxWidth: "60%",
  },
  companyText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },
  scoreBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  scoreBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: "#92400E",
  },
  priceBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  priceText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  cityBlock: { width: 90 },
  cityBlockRight: { alignItems: "flex-end" },
  timeText: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 2 },
  cityText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  routeMiddle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stopDotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  stopDot: { width: 6, height: 6, borderRadius: 3 },
  line: { flex: 1, height: 1 },
  viaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginBottom: 8,
  },
  viaText: { fontSize: 11, flex: 1 },
  daysBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  daysText: { fontSize: 12 },
  divider: { height: 1, marginBottom: 12 },
  footer: { gap: 6 },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  safetyActions: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  ratingDivider: { height: 1, marginTop: 12, marginBottom: 12 },
  ratingSection: { gap: 6 },
  communityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  communityLeft: { flex: 1, gap: 4 },
  communityScoreRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ratingLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  ratingCountText: { fontSize: 11 },
  noRatingText: { fontSize: 11 },
  confirmedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    marginLeft: 8,
  },
  confirmedBadgeText: { fontSize: 11 },
  signInHint: { fontSize: 12, fontStyle: "italic" },
  tapHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  tapHintText: { fontSize: 11 },
});
