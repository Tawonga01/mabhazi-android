import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Platform,
  Animated,
  Dimensions,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useListCities,
  useListBusCompanies,
  getListCitiesQueryKey,
  getListBusCompaniesQueryKey,
} from "@workspace/api-client-react";

export interface SearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  title: string;
  mode: "city" | "company";
}

const { height: SCREEN_H } = Dimensions.get("window");

export function SearchModal({
  visible,
  onClose,
  onSelect,
  title,
  mode,
}: SearchModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isDismissing, setIsDismissing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (visible) {
      setIsDismissing(false);
      setQuery("");
      setDebouncedQuery("");
      opacity.setValue(0);
      translateY.setValue(SCREEN_H);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== "web" }),
        Animated.spring(translateY, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]).start(() => {
        inputRef.current?.focus();
      });
    }
  }, [visible, translateY, opacity]);

  const cityParams = { q: debouncedQuery || undefined };
  const { data: citiesData, isLoading: citiesLoading } = useListCities(
    cityParams,
    {
      query: {
        queryKey: getListCitiesQueryKey(cityParams),
        enabled: mode === "city" && visible && debouncedQuery.length >= 2,
        staleTime: 60 * 1000,
      },
    },
  );

  const { data: companiesData } = useListBusCompanies({
    query: {
      queryKey: getListBusCompaniesQueryKey(),
      enabled: mode === "company" && visible,
      staleTime: 5 * 60 * 1000,
    },
  });

  const suggestions: string[] =
    mode === "city"
      ? (citiesData?.cities ?? [])
      : (companiesData?.companies ?? [])
          .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
          .map((c) => c.name);

  const isLoading = mode === "city" && citiesLoading && debouncedQuery.length >= 2;

  const handleClose = useCallback(() => {
    if (isDismissing) return;
    setIsDismissing(true);
    Keyboard.dismiss();
    onClose();
  }, [isDismissing, onClose]);

  const handleSelect = useCallback(
    (value: string) => {
      if (isDismissing) return;
      setIsDismissing(true);
      Keyboard.dismiss();
      onClose();
      requestAnimationFrame(() => onSelect(value));
    },
    [isDismissing, onSelect, onClose],
  );

  const handleCustom = useCallback(() => {
    if (query.trim().length >= 2) handleSelect(query.trim());
  }, [query, handleSelect]);

  if (!visible || isDismissing) return null;

  const iconName: React.ComponentProps<typeof Feather>["name"] = mode === "city" ? "map-pin" : "truck";

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.4)", opacity }]}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              transform: [{ translateY }],
              paddingBottom: Platform.OS === "ios" ? insets.bottom : 24,
            },
          ]}
        >
          <View style={styles.grabberWrap}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={[styles.iconWrap, { backgroundColor: colors.secondary }]}>
                <Feather name={iconName} size={16} color={colors.primary} />
              </View>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={[styles.closeBtn, { backgroundColor: colors.secondary }]}>
              <Feather name="x" size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              ref={inputRef}
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder={mode === "city" ? "Type a city name…" : "Type to filter companies…"}
              placeholderTextColor={colors.mutedForeground}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={handleCustom}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x-circle" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          {isLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={suggestions}
              keyExtractor={(item, i) => `${item}-${i}`}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 20 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.item, { borderBottomColor: colors.border }]}
                  onPress={() => handleSelect(item)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.itemIcon, { backgroundColor: colors.secondary }]}>
                    <Feather name={iconName} size={14} color={colors.primary} />
                  </View>
                  <Text style={[styles.itemText, { color: colors.foreground }]}>{item}</Text>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  {mode === "city" && debouncedQuery.length < 2 ? (
                    <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                      Type at least 2 letters to search
                    </Text>
                  ) : (
                    <>
                      <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
                         <Feather name="inbox" size={24} color={colors.primary} />
                      </View>
                      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                        No {mode === "city" ? "cities" : "companies"} found
                        {query ? ` for "${query}"` : ""}
                      </Text>
                      {query.trim().length >= 2 && (
                        <TouchableOpacity style={[styles.useCustomBtn, { backgroundColor: colors.primary }]} onPress={handleCustom}>
                          <Feather name="plus" size={14} color={colors.primaryForeground} />
                          <Text style={[styles.useCustomText, { color: colors.primaryForeground }]}>
                            Use "{query.trim()}"
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              }
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    minHeight: "50%",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 16 },
      android: { elevation: 16 },
    }),
  },
  grabberWrap: { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 16, fontFamily: "Inter_500Medium" },
  centerBox: { padding: 40, alignItems: "center" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  itemText: { fontSize: 16, fontFamily: "Inter_500Medium", flex: 1 },
  empty: { padding: 40, alignItems: "center", gap: 12 },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  emptyText: { fontSize: 15, textAlign: "center", fontFamily: "Inter_400Regular" },
  useCustomBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  useCustomText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});