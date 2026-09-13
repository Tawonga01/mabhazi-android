import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Animated,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { DaysPicker } from "@/components/DaysPicker";
import { useCreateJourney } from "@workspace/api-client-react";
import { SearchModal } from "@/components/SearchModal";
import { TermsAcceptanceCard, useTermsAcceptance } from "@/components/TermsAcceptance";

// ─── Helpers ────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function calcArrival(depH: number, depM: number, durH: number, durM: number): string {
  if (durH === 0 && durM === 0) return "";
  const total = depH * 60 + depM + durH * 60 + durM;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

function formatDuration(h: number, m: number): string {
  if (h === 0 && m === 0) return "";
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Numeric text input ───────────────────────────────────────────────────────

interface NumericInputProps {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  unit: string;
  colors: ReturnType<typeof useColors>;
  width?: number;
}

function NumericInput({ value, min, max, onChange, unit, colors, width = 64 }: NumericInputProps) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => { setRaw(String(value)); }, [value]);

  const commit = (text: string) => {
    const n = parseInt(text, 10);
    if (!isNaN(n)) {
      const clamped = Math.max(min, Math.min(max, n));
      onChange(clamped);
      setRaw(String(clamped));
    } else {
      setRaw(String(value));
    }
  };

  return (
    <View style={numStyles.wrap}>
      <TextInput
        style={[numStyles.box, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, width, fontFamily: "Inter_600SemiBold" }]}
        value={focused ? raw : String(value).padStart(2, "0")}
        onChangeText={(t) => { if (/^\d{0,3}$/.test(t)) setRaw(t); }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          commit(raw);
          setFocused(false);
        }}
        onSubmitEditing={() => commit(raw)}
        keyboardType="number-pad"
        maxLength={3}
        selectTextOnFocus
      />
      <Text style={[numStyles.unit, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>{unit}</Text>
    </View>
  );
}

const numStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  box: { fontSize: 22, textAlign: "center", borderWidth: 1.5, borderRadius: 10, paddingVertical: 8 },
  unit: { fontSize: 13 },
});

// ─── Text field ──────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: "default" | "numeric" | "numbers-and-punctuation";
  colors: ReturnType<typeof useColors>;
}

function Field({ label, icon, value, onChangeText, placeholder, keyboardType = "default", colors }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>{label}</Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name={icon} size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.fieldInput, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={keyboardType === "default" ? "words" : "none"}
        />
      </View>
    </View>
  );
}

interface PickerFieldProps {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  value: string;
  onPress: () => void;
  onClear: () => void;
  placeholder: string;
  colors: ReturnType<typeof useColors>;
}

function PickerField({ label, icon, value, onPress, onClear, placeholder, colors }: PickerFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>{label}</Text>
      <TouchableOpacity
        style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <Feather name={icon} size={16} color={colors.mutedForeground} />
        <Text
          style={[
            styles.fieldInput,
            {
              color: value ? colors.foreground : colors.mutedForeground,
              fontFamily: "Inter_400Regular",
            },
          ]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        {value ? (
          <TouchableOpacity
            onPress={onClear}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : (
          <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Thank-you overlay ────────────────────────────────────────────────────────

interface ThankYouOverlayProps {
  visible: boolean;
  fromCity: string;
  toCity: string;
  scheduledDays: string;
  onDismiss: () => void;
  onFindRoute: () => void;
}

function ThankYouOverlay({ visible, fromCity, toCity, scheduledDays, onDismiss, onFindRoute }: ThankYouOverlayProps) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 7 }),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(0.7);
      opacity.setValue(0);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.tyBackdrop}>
        <Animated.View style={[styles.tyCard, { backgroundColor: colors.card, transform: [{ scale }], opacity }]}>
          <View style={[styles.tyIconCircle, { backgroundColor: "#22C55E20" }]}>
            <Feather name="check-circle" size={52} color="#22C55E" />
          </View>
          <Text style={[styles.tyTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            Route Added!
          </Text>
          <View style={[styles.tyRouteBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.tyRoute, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {fromCity} → {toCity}
            </Text>
            {scheduledDays ? (
              <View style={styles.tyDaysRow}>
                <Feather name="calendar" size={13} color={colors.primary} />
                <Text style={[styles.tyDays, { color: colors.primary, fontFamily: "Inter_500Medium" }]}>
                  {scheduledDays}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.tySubtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Thank you for helping the community!
          </Text>
          <TouchableOpacity
            style={[styles.tyBtn, { backgroundColor: colors.accent }]}
            onPress={onFindRoute}
            activeOpacity={0.85}
          >
            <Feather name="search" size={16} color="#FFFFFF" />
            <Text style={[styles.tyBtnText, { fontFamily: "Inter_600SemiBold" }]}>Find this Route</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tySecondaryBtn, { borderColor: colors.border }]}
            onPress={onDismiss}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={15} color={colors.primary} />
            <Text style={[styles.tySecondaryBtnText, { color: colors.primary, fontFamily: "Inter_500Medium" }]}>Add Another Route</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Stop entry ───────────────────────────────────────────────────────────────

interface StopEntry {
  city: string;
  arrivalHour: number;
  arrivalMin: number;
}

const EMPTY_STOP: StopEntry = { city: "", arrivalHour: 12, arrivalMin: 0 };

interface StopRowProps {
  stop: StopEntry;
  index: number;
  onChange: (index: number, stop: StopEntry) => void;
  onRemove: (index: number) => void;
  onPickCity: (index: number) => void;
  colors: ReturnType<typeof useColors>;
}

function StopRow({ stop, index, onChange, onRemove, onPickCity, colors }: StopRowProps) {
  return (
    <View style={[stopStyles.row, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={stopStyles.rowHeader}>
        <View style={[stopStyles.badge, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[stopStyles.badgeText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
            {index + 1}
          </Text>
        </View>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => onRemove(index)}
        >
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[stopStyles.cityPicker, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={() => onPickCity(index)}
        activeOpacity={0.7}
      >
        <Feather name="map-pin" size={14} color={colors.mutedForeground} />
        <Text
          style={[
            stopStyles.cityText,
            { color: stop.city ? colors.foreground : colors.mutedForeground, fontFamily: "Inter_400Regular" },
          ]}
          numberOfLines={1}
        >
          {stop.city || "Select stop city"}
        </Text>
        {stop.city ? (
          <TouchableOpacity onPress={() => onChange(index, { ...stop, city: "" })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : (
          <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
        )}
      </TouchableOpacity>

      <View style={stopStyles.timeRow}>
        <Text style={[stopStyles.timeLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          Arrives at
        </Text>
        <NumericInput
          value={stop.arrivalHour}
          min={0}
          max={23}
          onChange={(v) => onChange(index, { ...stop, arrivalHour: v })}
          unit="h"
          colors={colors}
          width={56}
        />
        <Text style={[stopStyles.timeSep, { color: colors.mutedForeground }]}>:</Text>
        <NumericInput
          value={stop.arrivalMin}
          min={0}
          max={59}
          onChange={(v) => onChange(index, { ...stop, arrivalMin: v })}
          unit="m"
          colors={colors}
          width={56}
        />
      </View>
    </View>
  );
}

const stopStyles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 12 },
  cityPicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cityText: { flex: 1, fontSize: 14 },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timeLabel: { fontSize: 13, flex: 1 },
  timeSep: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
});

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormData {
  fromCity: string;
  toCity: string;
  busCompany: string;
  depHour: number;
  depMin: number;
  durHours: number;
  durMins: number;
  scheduledDays: string;
  pickupPoint: string;
  dropoffPoint: string;
  price: string;
}

const EMPTY_FORM: FormData = {
  fromCity: "", toCity: "", busCompany: "",
  depHour: 8, depMin: 0,
  durHours: 0, durMins: 0,
  scheduledDays: "", pickupPoint: "", dropoffPoint: "", price: "",
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ContributeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [stops, setStops] = useState<StopEntry[]>([]);
  const [thankYouVisible, setThankYouVisible] = useState(false);
  const [lastSubmit, setLastSubmit] = useState({ fromCity: "", toCity: "", scheduledDays: "" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fromCityModal, setFromCityModal] = useState(false);
  const [toCityModal, setToCityModal] = useState(false);
  const [companyModal, setCompanyModal] = useState(false);
  const [stopCityModalIndex, setStopCityModalIndex] = useState<number | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const terms = useTermsAcceptance();
  const mutation = useCreateJourney();
  const queryClient = useQueryClient();

  const set = useCallback(<K extends keyof FormData>(key: K) => (val: FormData[K]) =>
    setForm(prev => ({ ...prev, [key]: val })), []);

  const setStr = useCallback((key: keyof FormData) => (val: string) =>
    setForm(prev => ({ ...prev, [key]: val })), []);

  const departureTime = `${pad(form.depHour)}:${pad(form.depMin)}`;
  const arrivalTime = useMemo(
    () => calcArrival(form.depHour, form.depMin, form.durHours, form.durMins),
    [form.depHour, form.depMin, form.durHours, form.durMins],
  );
  const durationLabel = formatDuration(form.durHours, form.durMins);
  const hasDuration = form.durHours > 0 || form.durMins > 0;

  const allFilled =
    !!form.fromCity && !!form.toCity && !!form.busCompany &&
    hasDuration && !!form.scheduledDays &&
    !!form.pickupPoint && !!form.dropoffPoint && !!form.price;

  const handleDismissThankYou = useCallback(() => {
    setThankYouVisible(false);
    setForm(EMPTY_FORM);
    setStops([]);
  }, []);

  const handleFindRoute = useCallback(() => {
    setThankYouVisible(false);
    setForm(EMPTY_FORM);
    setStops([]);
    router.push({
      pathname: "/(tabs)",
      params: { fromCity: lastSubmit.fromCity, toCity: lastSubmit.toCity },
    });
  }, [lastSubmit, router]);

  const handleAddStop = useCallback(() => {
    if (stops.length >= 5) return;
    setStops(prev => [...prev, { ...EMPTY_STOP }]);
  }, [stops.length]);

  const handleChangeStop = useCallback((index: number, stop: StopEntry) => {
    setStops(prev => prev.map((s, i) => i === index ? stop : s));
  }, []);

  const handleRemoveStop = useCallback((index: number) => {
    setStops(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handlePickStopCity = useCallback((index: number) => {
    setStopCityModalIndex(index);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!allFilled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    const priceNum = parseFloat(form.price);
    if (isNaN(priceNum) || priceNum < 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!isAuthenticated) {
      setSubmitError(null);
      setAuthNotice("Complete sign in in the window that opens. Your route details will stay here.");
      setIsLoggingIn(true);
      try {
        await login();
        setAuthNotice("Sign-in window closed. Once your account appears, tap Submit Route to share this route.");
      } catch {
        setAuthNotice(null);
        setSubmitError("Could not start sign in. Please try again.");
      } finally {
        setIsLoggingIn(false);
      }
      return;
    }
    if (!(await terms.requireAcceptance())) {
      setSubmitError(terms.error ?? "Please accept the current Terms before submitting a route.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    setSubmitError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await mutation.mutateAsync({
        data: {
          fromCity: form.fromCity.trim(),
          toCity: form.toCity.trim(),
          departureTime,
          arrivalTime,
          scheduledDays: form.scheduledDays.trim(),
          busCompany: form.busCompany.trim(),
          pickupPoint: form.pickupPoint.trim(),
          dropoffPoint: form.dropoffPoint.trim(),
          price: priceNum,
          stops: stops
            .filter(s => s.city.trim())
            .map(s => ({
              city: s.city.trim(),
              arrivalTime: `${pad(s.arrivalHour)}:${pad(s.arrivalMin)}`,
            })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      setLastSubmit({ fromCity: form.fromCity, toCity: form.toCity, scheduledDays: form.scheduledDays });
      setThankYouVisible(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        setSubmitError("Your session expired. Please log in again.");
      } else if (status === 428) {
        await terms.refetch();
        setSubmitError("The Terms have changed. Please review and accept the current version.");
      } else {
        setSubmitError("Could not save this route. Please check your connection and try again.");
      }
    }
  }, [form, stops, allFilled, isAuthenticated, login, departureTime, arrivalTime, mutation, queryClient, terms]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.select({
    ios: insets.bottom + 90,
    web: insets.bottom + 100,
    default: insets.bottom + 20,
  });

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email?.split("@")[0] || "You"
    : "";

  if (authLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <ThankYouOverlay
        visible={thankYouVisible}
        fromCity={lastSubmit.fromCity}
        toCity={lastSubmit.toCity}
        scheduledDays={lastSubmit.scheduledDays}
        onDismiss={handleDismissThankYou}
        onFindRoute={handleFindRoute}
      />

      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.pageHeader, { paddingTop: topPad + 8, backgroundColor: colors.primary }]}>
          <Text style={styles.pageTitle}>Contribute a Route</Text>
          <View style={styles.contributorBadge}>
            <Feather name={isAuthenticated ? "user" : "log-in"} size={13} color="rgba(255,255,255,0.8)" />
            <Text style={styles.contributorText}>
              {isAuthenticated
                ? <>Submitting as <Text style={{ fontFamily: "Inter_600SemiBold" }}>{displayName}</Text></>
                : "Sign in when you're ready to submit"}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Route */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
              Route
            </Text>
            <PickerField label="Departure City" icon="map-pin" value={form.fromCity} onPress={() => setFromCityModal(true)} onClear={() => setStr("fromCity")("")} placeholder="e.g. Harare" colors={colors} />
            <PickerField label="Destination City" icon="flag" value={form.toCity} onPress={() => setToCityModal(true)} onClear={() => setStr("toCity")("")} placeholder="e.g. Gweru" colors={colors} />
          </View>

          {/* Bus operator */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
              Bus Operator
            </Text>
            <PickerField label="Company Name" icon="truck" value={form.busCompany} onPress={() => setCompanyModal(true)} onClear={() => setStr("busCompany")("")} placeholder="e.g. Inter Africa" colors={colors} />
          </View>

          {/* Schedule */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
              Schedule
            </Text>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                Departure Time
              </Text>
              <View style={styles.timeRow}>
                <NumericInput value={form.depHour} min={0} max={23} onChange={set("depHour")} unit="h" colors={colors} />
                <Text style={[styles.timeSep, { color: colors.mutedForeground }]}>:</Text>
                <NumericInput value={form.depMin} min={0} max={59} onChange={set("depMin")} unit="m" colors={colors} />
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                Journey Duration
              </Text>
              <View style={styles.timeRow}>
                <NumericInput value={form.durHours} min={0} max={48} onChange={set("durHours")} unit="hrs" colors={colors} />
                <NumericInput value={form.durMins} min={0} max={59} onChange={set("durMins")} unit="min" colors={colors} />
              </View>
            </View>

            {hasDuration ? (
              <View style={[styles.arrivalBadge, { backgroundColor: "#22C55E15", borderColor: "#22C55E40" }]}>
                <Feather name="check-circle" size={15} color="#16A34A" />
                <Text style={[styles.arrivalText, { color: "#16A34A", fontFamily: "Inter_600SemiBold" }]}>
                  Arrives at {arrivalTime}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Operating Days */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
              Operating Days
            </Text>
            <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              Select all days this route runs
            </Text>
            <DaysPicker value={form.scheduledDays} onChange={setStr("scheduledDays")} />
            {form.scheduledDays ? (
              <Text style={[styles.selectedDaysHint, { color: colors.primary, fontFamily: "Inter_500Medium" }]}>
                {form.scheduledDays}
              </Text>
            ) : null}
          </View>

          {/* Stops & Fare */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
              Stops &amp; Fare
            </Text>
            <Field label="Pickup Point" icon="navigation" value={form.pickupPoint} onChangeText={setStr("pickupPoint")} placeholder="e.g. Harare Roadport" colors={colors} />
            <Field label="Drop-off Point" icon="map" value={form.dropoffPoint} onChangeText={setStr("dropoffPoint")} placeholder="e.g. Gweru Bus Terminus" colors={colors} />
            <Field label="Price ($)" icon="tag" value={form.price} onChangeText={setStr("price")} placeholder="e.g. 8.00" keyboardType="numeric" colors={colors} />
          </View>

          {/* Intermediate Stops (Optional) */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sectionTitleRow}>
              <Text style={[styles.sectionTitle, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                Intermediate Stops
              </Text>
              <View style={[styles.optionalBadge, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.optionalText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  Optional
                </Text>
              </View>
            </View>
            <Text style={[styles.stopHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Add cities this bus passes through. Helps others find partial-route journeys.
            </Text>

            {stops.map((stop, i) => (
              <StopRow
                key={i}
                stop={stop}
                index={i}
                onChange={handleChangeStop}
                onRemove={handleRemoveStop}
                onPickCity={handlePickStopCity}
                colors={colors}
              />
            ))}

            {stops.length < 5 ? (
              <TouchableOpacity
                style={[styles.addStopBtn, { borderColor: colors.primary + "60", backgroundColor: colors.primary + "08" }]}
                onPress={handleAddStop}
                activeOpacity={0.7}
              >
                <Feather name="plus-circle" size={16} color={colors.primary} />
                <Text style={[styles.addStopText, { color: colors.primary, fontFamily: "Inter_500Medium" }]}>
                  {stops.length === 0 ? "Add a stop" : "Add another stop"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {submitError ? (
            <View style={[styles.errorBanner, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
              <Feather name="alert-circle" size={15} color="#DC2626" />
              <Text style={[styles.errorBannerText, { color: "#DC2626", fontFamily: "Inter_500Medium" }]}>
                {submitError}
              </Text>
            </View>
          ) : null}

          {authNotice && !isAuthenticated ? (
            <View style={[styles.authNotice, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <ActivityIndicator size="small" color={colors.primary} animating={isLoggingIn} />
              <Text style={[styles.authNoticeText, { color: colors.primary, fontFamily: "Inter_500Medium" }]}>
                {authNotice}
              </Text>
            </View>
          ) : null}

          <TermsAcceptanceCard terms={terms} />

          {isAuthenticated && allFilled && !mutation.isPending ? (
            <View style={[styles.readyBanner, { backgroundColor: "#ECFDF5", borderColor: "#6EE7B7" }]}>
              <Feather name="check-circle" size={14} color="#059669" />
              <Text style={[styles.readyBannerText, { color: "#059669", fontFamily: "Inter_500Medium" }]}>
                Signed in — tap Submit Route to share
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.submitBtn,
              {
                backgroundColor: mutation.isPending || isLoggingIn ? colors.muted : allFilled ? colors.accent : colors.muted,
                opacity: allFilled || mutation.isPending || isLoggingIn ? 1 : 0.6,
              },
            ]}
            onPress={handleSubmit}
            activeOpacity={0.85}
            disabled={mutation.isPending || isLoggingIn || !allFilled}
          >
            {mutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : isLoggingIn ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.submitBtnText}>Signing in…</Text>
              </>
            ) : (
              <>
                <Feather name={isAuthenticated ? "send" : "log-in"} size={18} color="#FFFFFF" />
                <Text style={styles.submitBtnText}>
                  {isAuthenticated ? "Submit Route" : "Sign in & Submit"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <SearchModal
        visible={fromCityModal}
        onClose={() => setFromCityModal(false)}
        onSelect={(v) => setStr("fromCity")(v)}
        title="Departure City"
        mode="city"
      />
      <SearchModal
        visible={toCityModal}
        onClose={() => setToCityModal(false)}
        onSelect={(v) => setStr("toCity")(v)}
        title="Destination City"
        mode="city"
      />
      <SearchModal
        visible={companyModal}
        onClose={() => setCompanyModal(false)}
        onSelect={(v) => setStr("busCompany")(v)}
        title="Bus Company"
        mode="company"
      />
      <SearchModal
        visible={stopCityModalIndex !== null}
        onClose={() => setStopCityModalIndex(null)}
        onSelect={(v) => {
          if (stopCityModalIndex !== null) {
            handleChangeStop(stopCityModalIndex, { ...stops[stopCityModalIndex], city: v });
            setStopCityModalIndex(null);
          }
        }}
        title="Stop City"
        mode="city"
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center" },
  pageHeader: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  pageTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    marginBottom: 6,
  },
  contributorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  contributorText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.8)",
    fontFamily: "Inter_400Regular",
  },
  scrollContent: {
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 15, marginBottom: 2 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  optionalBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  optionalText: { fontSize: 11 },
  stopHint: { fontSize: 12, lineHeight: 17, marginTop: -4 },
  field: { gap: 6 },
  label: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  fieldInput: {
    flex: 1,
    fontSize: 15,
  },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  timeSep: { fontSize: 24, fontFamily: "Inter_600SemiBold" },
  divider: { height: 1 },
  arrivalBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  arrivalText: { fontSize: 14 },
  selectedDaysHint: { fontSize: 13, marginTop: -4 },
  addStopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingVertical: 12,
  },
  addStopText: { fontSize: 14 },
  readyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  readyBannerText: { fontSize: 13, flex: 1 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorBannerText: { fontSize: 13, flex: 1 },
  authNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  authNoticeText: { fontSize: 13, lineHeight: 18, flex: 1 },
  termsCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
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
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 4,
  },
  submitBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  // Login gate
  loginCard: {
    width: "85%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 14,
  },
  loginIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  loginTitle: { fontSize: 20, textAlign: "center" },
  loginSubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  loginBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  loginBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  // Thank-you overlay
  tyBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  tyCard: {
    width: "100%",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 14,
  },
  tyIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  tyTitle: { fontSize: 22 },
  tyRouteBox: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    gap: 6,
  },
  tyRoute: { fontSize: 17 },
  tyDaysRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  tyDays: { fontSize: 13 },
  tySubtitle: { fontSize: 14, textAlign: "center" },
  tyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    width: "100%",
    justifyContent: "center",
  },
  tyBtnText: { fontSize: 15, color: "#FFFFFF" },
  tySecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    width: "100%",
    justifyContent: "center",
  },
  tySecondaryBtnText: { fontSize: 14 },
});
