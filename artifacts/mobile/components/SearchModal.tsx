import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, View } from 'react-native';
import { useListV2Cities, useListBusCompanies, getListV2CitiesQueryKey, getListBusCompaniesQueryKey, type V2City } from '@workspace/api-client-react';
import { CaptureButton, CaptureInput, CapturePickerModal, captureStyles as s } from './capture/CapturePrimitives';
import { ui } from '@/constants/ui';

export interface SearchModalProps {
  visible: boolean;
  onClose(): void;
  onSelect(value: string): void;
  onSelectCity?(city: V2City | null): void;
  title: string;
  mode: 'city' | 'company';
}
/** Same safe dialog and keyboard boundary as route capture. The search input
 * stays fixed; only results scroll. No bottom-sheet animation competes with IME. */
export function SearchModal({ visible, onClose, onSelect, onSelectCity, title, mode }: SearchModalProps) {
  const [query, setQuery] = useState(''), [debouncedQuery, setDebouncedQuery] = useState('');
  const [isDismissing, setIsDismissing] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { if (visible) { setIsDismissing(false); setQuery(''); setDebouncedQuery(''); } }, [visible]);
  const cityParams = { q: debouncedQuery || undefined };
  const cities = useListV2Cities(cityParams, { query: { queryKey: getListV2CitiesQueryKey(cityParams), enabled: mode === 'city' && visible && debouncedQuery.length >= 2, retry: false, staleTime: 60_000 } });
  const companies = useListBusCompanies({ query: { queryKey: getListBusCompaniesQueryKey(), enabled: mode === 'company' && visible, retry: false, staleTime: 300_000 } });
  const current = mode === 'city' ? cities : companies;
  const searching = mode === 'city' && query !== debouncedQuery;
  const pending = searching || current.isLoading && (mode === 'company' || debouncedQuery.length >= 2);
  const failed = current.isError && !searching && (mode === 'company' || debouncedQuery.length >= 2);
  const suggestions: { name: string; city?: V2City }[] = mode === 'city'
    ? (cities.data?.cities ?? []).map(city => ({ name: city.name, city }))
    : (companies.data?.companies ?? []).filter(c => !query || c.name.toLowerCase().includes(query.toLowerCase())).map(c => ({ name: c.name }));
  const close = useCallback(() => { if (isDismissing) return; setIsDismissing(true); Keyboard.dismiss(); onClose(); }, [isDismissing, onClose]);
  const select = useCallback((value: string, city: V2City | null = null) => {
    if (isDismissing) return;
    setIsDismissing(true); Keyboard.dismiss(); onClose();
    requestAnimationFrame(() => { onSelectCity?.(city); onSelect(value); });
  }, [isDismissing, onClose, onSelectCity, onSelect]);
  const custom = () => { if (query.trim().length >= 2) select(query.trim()); };
  if (!visible || isDismissing) return null;
  return <CapturePickerModal title={title} closeLabel={mode === 'city' ? 'Close city search' : 'Close operator search'} onClose={close}
    input={<CaptureInput autoFocus accessibilityLabel={mode === 'city' ? 'Search cities' : 'Search operators'} placeholder={mode === 'city' ? 'Type a city name…' : 'Type to filter companies…'} value={query} onChangeText={setQuery} maxLength={mode === 'city' ? 80 : 160} autoCapitalize="words" returnKeyType="search" onSubmitEditing={custom}/>}
  >
    {pending ? <ActivityIndicator accessibilityLabel={mode === 'city' ? 'Searching cities' : 'Searching operators'} color={ui.color.navy}/> : null}
    {failed ? <View style={{gap:12}}><Text accessibilityRole="alert" style={s.error}>{mode === 'city' ? 'City search could not load.' : 'Operator search could not load.'}</Text><CaptureButton title={mode === 'city' ? 'Try city search again' : 'Try operator search again'} secondary onPress={() => void current.refetch()}/></View> : null}
    {!pending && !failed && mode === 'city' && debouncedQuery.length < 2 ? <Text style={s.note}>Type at least 2 letters to search</Text> : null}
    {!pending && !failed ? suggestions.map((item, i) => <Pressable accessibilityRole="button" accessibilityLabel={item.city ? item.name + ', ' + item.city.placeType : item.name} key={item.city?.id ?? item.name + i} onPress={() => select(item.name, item.city ?? null)} style={{paddingVertical:16,minHeight:56,borderBottomWidth:1,borderColor:ui.color.border,gap:4}}><Text style={s.reviewValue}>{item.name}</Text>{item.city ? <Text style={s.note}>{item.city.placeType}</Text> : null}</Pressable>) : null}
    {!pending && !failed && !suggestions.length && (mode === 'company' || debouncedQuery.length >= 2) ? <View style={{gap:12}}><Text style={s.note}>No {mode === 'city' ? 'cities' : 'companies'} found{query ? ' for "' + query + '"' : ''}</Text>{query.trim().length >= 2 ? <CaptureButton title={'Use "' + query.trim() + '"'} secondary onPress={custom}/> : null}</View> : null}
  </CapturePickerModal>;
}
