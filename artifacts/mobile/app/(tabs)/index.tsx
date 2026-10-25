import { ui } from '@/constants/ui';
import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Animated,
} from "react-native";
import { Feather } from "@/components/VectorIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { JourneyCard, type Journey } from "@/components/JourneyCard";
import { JourneyDetailSheet } from "@/components/JourneyDetailSheet";
import { useSearchJourneys, useRateJourney, getSearchJourneysQueryKey, type V2City } from "@workspace/api-client-react";
import { PublicRouteCard } from '@/components/PublicRouteCard';
import { usePublicRoutes } from '@/lib/use-public-routes';
import { useCaptureEntry } from '@/lib/capture-context';
import { searchViewState, searchRoutePrefill, type RoutePrefill } from '@/lib/contribution-moments';
import { CaptureButton } from '@/components/capture/CapturePrimitives';
import { SearchModal } from "@/components/SearchModal";
import { filterBlockedContributors, useBlockedContributors } from "@/hooks/useBlockedContributors";
import { TermsAcceptanceCard, useTermsAcceptance } from "@/components/TermsAcceptance";
import {
  deleteLocalUserRating,
  getLocalUserRating,
  setLocalUserRating,
} from "@/hooks/useLocalUserRatings";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SearchScreen() {
  const colors = useColors();
  const capture = useCaptureEntry();
  const [fromChoice, setFromChoice] = useState<V2City | null>(null), [toChoice, setToChoice] = useState<V2City | null>(null);
  const [searchedRoute, setSearchedRoute] = useState<RoutePrefill>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isAuthenticated, user, isLoading: authLoading } = useAuth();
  const terms = useTermsAcceptance();
  const {
    blockedContributorIds,
    isLoading: isBlockedContributorsLoading,
    error: blockedContributorsError,
    retryBlockedContributors,
  } = useBlockedContributors();
  const params = useLocalSearchParams<{ fromCity?: string; toCity?: string }>();

  const [fromCity, setFromCity] = useState(params.fromCity ?? "");
  const [toCity, setToCity] = useState(params.toCity ?? "");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const [searchParams, setSearchParams] = useState<{
    fromCity?: string;
    toCity?: string;
    day?: string;
  } | null>(null);

  const [ratingLoadingIds, setRatingLoadingIds] = useState<Set<number>>(
    new Set(),
  );

  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [fromCityModal, setFromCityModal] = useState(false);
  const [toCityModal, setToCityModal] = useState(false);

  const expandAnim = useRef(new Animated.Value(1)).current;
  const headerScroll = useRef<ScrollView>(null);
  useEffect(() => { headerScroll.current?.scrollTo({y:0,animated:false}); },[isExpanded]);

  // Auto-trigger search when navigated here from Contribute with pre-filled cities
  useEffect(() => {
    if (params.fromCity || params.toCity) {
      const fc = (params.fromCity as string) ?? "";
      const tc = (params.toCity as string) ?? "";
      setFromChoice(null); setToChoice(null);
      setSearchedRoute(searchRoutePrefill(fc, tc, null, null));
      setFromCity(fc);
      setToCity(tc);
      setSearchParams({ fromCity: fc || undefined, toCity: tc || undefined });
      setHasSearched(true);
      setIsExpanded(false);
      expandAnim.setValue(0);
    }
  // Only run when params change (navigation event)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.fromCity, params.toCity]);

  const { data, isLoading, isFetching, isSuccess, isError, refetch } = useSearchJourneys(
    searchParams ?? {},
    {
      query: {
        queryKey: getSearchJourneysQueryKey(searchParams ?? {}),
        enabled: !!searchParams,
        // Do not refetch on tab-switch / window focus — every refetch writes a
        // search-event row in the DB, inflating stats. Users must tap Search to
        // trigger a new query intentionally.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // Keep results fresh for 3 minutes; only refetch after that.
        staleTime: 3 * 60 * 1000,
      },
    },
  );

  const { mutateAsync: submitRating } = useRateJourney();

  const journeys = (data?.journeys ?? []) as Journey[];
  // Never treat the pre-load [] as a trusted allow-list. This keeps route
  // cards (and their contributor UGC) off-screen until local safety settings
  // have been read successfully.
  const visibleJourneys =
    !isBlockedContributorsLoading && !blockedContributorsError
      ? filterBlockedContributors(journeys, blockedContributorIds)
      : [];

  const safetyReady=!isBlockedContributorsLoading&&!blockedContributorsError;
  const publicRequired=searchParams!==null;
  const publicParams={...(searchedRoute?.origin?{originCityId:searchedRoute.origin.id}:{fromCity:searchParams?.fromCity}),...(searchedRoute?.destination?{destinationCityId:searchedRoute.destination.id}:{toCity:searchParams?.toCity})};
  const publicResults=usePublicRoutes(publicParams,publicRequired&&safetyReady&&!authLoading,user?.id??null,blockedContributorIds,capture.revision);
  const publicItems=safetyReady&&!authLoading?(publicResults.data?.pages.flatMap(page=>page.items)??[]):[];
  const publicHidden=safetyReady&&publicResults.data?.pages.some(page=>page.hasHiddenResults)?1:0;
  const resultItems=[...visibleJourneys.map(journey=>({kind:'legacy' as const,journey})),...publicItems.map(route=>({kind:'lead' as const,route}))];
  const viewState = searchViewState({ searched: hasSearched, loading: isLoading || isFetching || authLoading || publicRequired&&safetyReady&&publicResults.isLoading,
    succeeded: isSuccess&&(!publicRequired||!safetyReady||publicResults.isSuccess),failed:isError||publicRequired&&safetyReady&&publicResults.isError,
    safetyLoading: isBlockedContributorsLoading,safetyFailed:!!blockedContributorsError,total:journeys.length+publicItems.length+publicHidden,visible:resultItems.length });
  const retrySearch=()=>{void refetch();if(publicRequired&&safetyReady)void publicResults.refetch();};

  const collapseSearch = useCallback(() => {
    Animated.timing(expandAnim, {
      toValue: 0,
      duration: 280,
      useNativeDriver: false,
    }).start(() => setIsExpanded(false));
  }, [expandAnim]);

  const expandSearch = useCallback(() => {
    setIsExpanded(true);
    Animated.timing(expandAnim, {
      toValue: 1,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }, [expandAnim]);

  const handleSearch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHasSearched(true);
    setSearchedRoute(searchRoutePrefill(fromCity, toCity, fromChoice, toChoice));
    setSearchParams({
      fromCity: fromCity.trim() || undefined,
      toCity: toCity.trim() || undefined,
      day: selectedDay ?? undefined,
    });
    collapseSearch();
  }, [fromCity, toCity, fromChoice, toChoice, selectedDay, collapseSearch]);

  const swapCities = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFromChoice(toChoice); setToChoice(fromChoice);
    const temp = fromCity;
    setFromCity(toCity);
    setToCity(temp);
  }, [fromCity, toCity, fromChoice, toChoice]);

  const toggleDay = useCallback((day: string) => {
    Haptics.selectionAsync();
    setSelectedDay((prev) => (prev === day ? null : day));
  }, []);

  const patchCache = useCallback(
    (journeyId: number, patch: Partial<Journey>) => {
      queryClient.setQueriesData(
        { queryKey: ["/api/journeys"] },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const d = old as { journeys?: Journey[] };
          if (!Array.isArray(d.journeys)) return old;
          return {
            ...d,
            journeys: d.journeys.map((j) =>
              j.id === journeyId ? { ...j, ...patch } : j,
            ),
          };
        },
      );
    },
    [queryClient],
  );

  const handleRate = useCallback(
    async (journeyId: number, score: number) => {
      if (ratingLoadingIds.has(journeyId)) return;
      if (!(await terms.requireAcceptance())) return;
      Haptics.selectionAsync();
      // 1. Update module-level map (survives re-searches returning userRating:null)
      setLocalUserRating(journeyId, score);
      // 2. Patch cache immediately — React Query notifies subscribers → FlatList re-renders
      patchCache(journeyId, { userRating: score });
      setRatingLoadingIds((prev) => new Set([...prev, journeyId]));
      try {
        const result = await submitRating({ id: journeyId, data: { score } });
        // 3. Patch again with fresh server stats (averageRating + ratingCount)
        patchCache(journeyId, {
          userRating: result.userRating,
          averageRating: result.averageRating,
          ratingCount: result.ratingCount,
        });
      } catch (error) {
        // Rollback on network failure
        deleteLocalUserRating(journeyId);
        patchCache(journeyId, { userRating: null });
        if ((error as { status?: number })?.status === 428) {
          await terms.refetch();
        }
      } finally {
        setRatingLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(journeyId);
          return next;
        });
      }
    },
    [submitRating, patchCache, ratingLoadingIds, terms],
  );

  const handleCardPress = useCallback((journey: Journey) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedJourney(journey);
    setDetailVisible(true);
  }, []);

  const handleDetailClose = useCallback(() => {
    setDetailVisible(false);
  }, []);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.select({
    ios: insets.bottom + 90,
    web: insets.bottom + 100,
    default: insets.bottom + 20,
  });

  const [searchContentHeight, setSearchContentHeight] = useState(378);
  const [compactContentHeight, setCompactContentHeight] = useState(64);
  const cardHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, searchContentHeight],
  });

  const cardOpacity = expandAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });

  const compactOpacity = expandAnim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [1, 0, 0],
  });

  const compactHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [compactContentHeight, 0],
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView ref={headerScroll} style={{ flexGrow: 0, flexShrink: isExpanded ? 1 : 0, maxHeight: isExpanded ? '80%' : undefined }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.header,
          {
            backgroundColor: colors.primary,
            paddingTop: topPad + 8,
          },
        ]}
      >
        <Text style={[styles.appTitle, { color: "#FFFFFF" }]}>Mabhazi.com</Text>

        {/* Compact bar shown after search */}
        <Animated.View
          style={[
            styles.compactBar,
            {
              opacity: compactOpacity,
              height: compactHeight,
              overflow: "hidden",
            },
          ]}
          pointerEvents={isExpanded ? "none" : "auto"}
        >
          <TouchableOpacity
            style={[styles.compactBarInner, { backgroundColor: "#FFFFFF" }]}
            onLayout={event => setCompactContentHeight(Math.ceil(event.nativeEvent.layout.height))}
            onPress={expandSearch}
            activeOpacity={0.85}
          >
            <View style={styles.compactRoute}>
              <Feather name="map-pin" size={14} color={colors.primary} />
              <Text
                style={[styles.compactCity, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {fromCity || "Any"}
              </Text>
              <Feather
                name="arrow-right"
                size={14}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.compactCity, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {toCity || "Any"}
              </Text>
              {selectedDay ? (
                <View
                  style={[
                    styles.compactDay,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={styles.compactDayText}>{selectedDay}</Text>
                </View>
              ) : null}
            </View>
            <View style={[styles.editBtn, { backgroundColor: colors.secondary }]}>
              <Feather name="edit-2" size={13} color={colors.primary} />
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Expanded search card */}
        <Animated.View
          style={{ height: cardHeight, opacity: cardOpacity, overflow: "hidden" }}
          pointerEvents={isExpanded ? "auto" : "none"}
        >
          <View style={styles.searchCard} onLayout={event => setSearchContentHeight(Math.ceil(event.nativeEvent.layout.height))}>
            <View style={styles.inputRow}>
              <View
                style={[styles.inputIcon, { backgroundColor: colors.secondary }]}
              >
                <Feather name="map-pin" size={16} color={colors.primary} />
              </View>
              <TouchableOpacity
                style={[
                  styles.input,
                  { flexDirection: "row", alignItems: "center" },
                ]}
                onPress={() => setFromCityModal(true)}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 15,
                    fontFamily: ui.type.regular,
                    color: fromCity ? colors.foreground : colors.mutedForeground,
                  }}
                  numberOfLines={1}
                >
                  {fromCity || "From city"}
                </Text>
                {fromCity ? (
                  <TouchableOpacity
                    onPress={() => setFromCity("")}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ) : (
                  <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.swapRow}>
              <View
                style={[styles.dividerLine, { backgroundColor: colors.border }]}
              />
              <TouchableOpacity
                style={[
                  styles.swapBtn,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                  },
                ]}
                onPress={swapCities}
              >
                <Feather name="repeat" size={14} color={colors.primary} />
              </TouchableOpacity>
              <View
                style={[styles.dividerLine, { backgroundColor: colors.border }]}
              />
            </View>

            <View style={styles.inputRow}>
              <View
                style={[styles.inputIcon, { backgroundColor: colors.secondary }]}
              >
                <Feather name="flag" size={16} color={colors.accent} />
              </View>
              <TouchableOpacity
                style={[
                  styles.input,
                  { flexDirection: "row", alignItems: "center" },
                ]}
                onPress={() => setToCityModal(true)}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 15,
                    fontFamily: ui.type.regular,
                    color: toCity ? colors.foreground : colors.mutedForeground,
                  }}
                  numberOfLines={1}
                >
                  {toCity || "To city"}
                </Text>
                {toCity ? (
                  <TouchableOpacity
                    onPress={() => setToCity("")}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ) : (
                  <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                )}
              </TouchableOpacity>
            </View>

            <View
              style={[styles.separator, { backgroundColor: colors.border }]}
            />

            <View style={styles.dayFilterSection}>
              <Text
                style={[
                  styles.dayFilterLabel,
                  {
                    color: colors.mutedForeground,
                    fontFamily: ui.type.regular,
                  },
                ]}
              >
              Travel day (optional)
              </Text>
              <View style={styles.dayChips}>
                {DAYS.map((day) => {
                  const active = selectedDay === day;
                  return (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayChip,
                        {
                          backgroundColor: active
                            ? colors.primary
                            : colors.background,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => toggleDay(day)}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.dayChipText,
                          {
                            color: active ? "#FFFFFF" : colors.foreground,
                            fontFamily: active
                              ? ui.type.semibold
                              : ui.type.regular,
                          },
                        ]}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.searchBtn, { backgroundColor: colors.accent }]}
              onPress={handleSearch}
              activeOpacity={0.85}
            >
              <Feather name="search" size={18} color={colors.accentForeground} />
              <Text style={styles.searchBtnText}>Search Routes</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>

      {viewState === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text
            style={[
              styles.loadingText,
              { color: colors.mutedForeground, fontFamily: ui.type.regular },
            ]}
          >
            Finding routes...
          </Text>
        </View>
      ) : viewState === 'error' ? (
        <View style={styles.centered}>
          <Text accessibilityRole="alert" style={[styles.emptyTitle, { color: colors.foreground }]}>Search could not load</Text>
          <CaptureButton title="Try search again" onPress={retrySearch} />
        </View>
      ) : viewState === 'safety_error' ? (
        <View style={styles.centered}>
          <Feather name="alert-triangle" size={48} color={colors.destructive} />
          <Text
            style={[
              styles.emptyTitle,
              { color: colors.destructive, fontFamily: ui.type.semibold },
            ]}
          >
            Block settings unavailable
          </Text>
          <Text
            style={[
              styles.emptySubtitle,
              { color: colors.mutedForeground, fontFamily: ui.type.regular },
            ]}
          >
            {blockedContributorsError}
          </Text>
          <CaptureButton title="Try safety settings again" onPress={() => void retryBlockedContributors().catch(() => undefined)} />
        </View>
      ) : viewState === 'safety_loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text
            style={[
              styles.loadingText,
              { color: colors.mutedForeground, fontFamily: ui.type.regular },
            ]}
          >
            Loading safety settings...
          </Text>
        </View>
      ) : viewState === 'hidden' ? (
        <View style={styles.centered}><Text style={[styles.emptyTitle, { color: colors.foreground }]}>Results hidden by your block settings</Text></View>
      ) : viewState === 'empty' ? (
        <View style={styles.centered}>
          <Feather name="inbox" size={48} color={colors.border} />
          <Text
            style={[
              styles.emptyTitle,
              { color: colors.foreground, fontFamily: ui.type.semibold },
            ]}
          >
            No routes found
          </Text>
          <Text
            style={[
              styles.emptySubtitle,
              { color: colors.mutedForeground, fontFamily: ui.type.regular },
            ]}
          >
            Know a bus on this route?
          </Text>
          <CaptureButton title="Add a route" disabled={capture.isOpen} onPress={() => capture.open({ kind: 'route', entrySurface: 'search_empty', prefill: searchedRoute })} />
        </View>
      ) : viewState === 'idle' ? (
        <View style={styles.centered}>
          <Feather name="compass" size={52} color={colors.border} />
          <Text
            style={[
              styles.emptyTitle,
              { color: colors.foreground, fontFamily: ui.type.semibold },
            ]}
          >
            Search for a route
          </Text>
        </View>
      ) : (
        <FlatList
           data={resultItems}
          keyExtractor={(item) => item.kind==='lead'?'lead:'+item.route.subjectId:'legacy:'+item.journey.id}
          renderItem={({ item }) => item.kind==='lead'? <PublicRouteCard route={item.route} disabled={capture.isOpen} onPress={()=>capture.open({kind:'public_route',subjectId:item.route.subjectId})}/> : (
            <JourneyCard
              journey={{
                ...item.journey,
                 userRating: getLocalUserRating(item.journey.id) ?? item.journey.userRating,
              }}
              onRate={
                isAuthenticated
                  ? (score) => handleRate(item.journey.id, score)
                  : undefined
              }
              onPress={() =>
                handleCardPress({
                  ...item.journey,
                   userRating: getLocalUserRating(item.journey.id) ?? item.journey.userRating,
                })
              }
            />
          )}
          contentContainerStyle={[
            styles.list,
            {
              paddingBottom: bottomPad,
            },
          ]}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={publicResults.hasNextPage?<View style={{margin:16}}><CaptureButton title="Load more route reports" busy={publicResults.isFetchingNextPage} onPress={()=>void publicResults.fetchNextPage()}/></View>:null}
          ListHeaderComponent={
             <View>
               {isAuthenticated && !terms.isAccepted ? (
                 <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                   <TermsAcceptanceCard terms={terms} />
                 </View>
               ) : null}
               <Text
                 style={[
                   styles.resultsCount,
                   {
                     color: colors.mutedForeground,
                     fontFamily: ui.type.medium,
                   },
                 ]}
               >
                  {resultItems.length} route{resultItems.length !== 1 ? "s" : ""} found
               </Text>
             </View>
          }
        />
      )}

      <JourneyDetailSheet
        journey={selectedJourney}
        visible={detailVisible}
        onClose={handleDetailClose}
      />

      <SearchModal
        visible={fromCityModal}
        onClose={() => setFromCityModal(false)}
        onSelect={setFromCity}
        onSelectCity={setFromChoice}
        title="Departure City"
        mode="city"
      />
      <SearchModal
        visible={toCityModal}
        onClose={() => setToCityModal(false)}
        onSelect={setToCity}
        onSelectCity={setToChoice}
        title="Destination City"
        mode="city"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  appTitle: {
    fontSize: 26,
    fontFamily: ui.type.bold,
    marginBottom: 16,
  },
  appSubtitle: {
    fontSize: 13,
    fontFamily: ui.type.regular,
    marginBottom: 8,
  },
  compactBar: {
    marginBottom: 4,
  },
  compactBarInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0,
    shadowRadius: 12,
    elevation: 0,
  },
  compactRoute: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compactCity: {
    fontSize: 16,
    fontFamily: ui.type.semibold,
    flexShrink: 1,
  },
  compactDay: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  compactDayText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: ui.type.semibold,
  },
  editBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  searchCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: ui.radius.group,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0,
    shadowRadius: 24,
    elevation: 0,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  inputIcon: {backgroundColor: ui.color.soft, 
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {minHeight: 50, 
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  swapRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 0,
    paddingLeft: 48,
  },
  dividerLine: { flex: 1, height: 1 },
  swapBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginHorizontal: 8,
  },
  separator: { height: 1, marginVertical: 8 },
  dayFilterSection: { gap: 8, marginBottom: 4 },
  dayFilterLabel: { fontSize: 14 },
  dayChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingVertical: 2,
  },
  dayChip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayChipText: { fontSize: 14 },
  searchBtn: {minHeight: 50, 
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 14,
  },
  searchBtnText: {
    color: ui.color.ink,
    fontSize: 16,
    fontFamily: ui.type.semibold,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 40,
  },
  loadingText: { fontSize: 15, marginTop: 8 },
  emptyTitle: { fontSize: 23, marginTop: 12, textAlign: "center" },
  emptySubtitle: { fontSize: 16, textAlign: "center", lineHeight: 24 },
  list: { paddingTop: 16 },
  resultsCount: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});
