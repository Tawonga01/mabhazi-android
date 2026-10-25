import React, { forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listV2Cities, type V2City } from '@workspace/api-client-react';
import { CaptureFrameContext } from '@/lib/capture-context';
import { Feather } from '@/components/VectorIcon';

export const captureStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#102744', paddingHorizontal: 16 },
  avoid: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  panel: { width: '100%', maxWidth: 450, maxHeight: '100%', flexShrink: 1, backgroundColor: '#F4F6FA', borderRadius: 26, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 22, paddingRight: 10, paddingVertical: 12, gap: 8, borderBottomColor: '#DEE4EC', borderBottomWidth: 1 },
  title: { color: '#102744', fontSize: 23, fontWeight: '700' },
  close: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  body: { padding: 22, gap: 16 }, footer: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16, gap: 4, borderTopWidth: 1, borderColor: '#DEE4EC', backgroundColor: '#F4F6FA' },
  note: { fontSize: 14, lineHeight: 21, color: '#4F6075' }, label: { fontSize: 14, fontWeight: '600', color: '#102744' },
  input: { minHeight: 50, borderWidth: 1, borderColor: '#B8C5D5', borderRadius: 12, padding: 13, backgroundColor: '#FFF', color: '#102744', fontSize: 16 },
  error: { fontSize: 14, lineHeight: 21, color: '#9B2440' },
  group: { borderRadius: 16, padding: 16, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#DEE4EC', gap: 12 },
  primary: { minHeight: 50, padding: 14, borderRadius: 14, backgroundColor: '#FF9B45', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#102744', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondary: { minHeight: 44, padding: 10, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#24476A', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  choice: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 12, borderWidth: 1, borderColor: '#B8C5D5', backgroundColor: '#FFF', borderRadius: 12 },
  selected: { backgroundColor: '#DFE9F5', borderColor: '#24476A' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disabled: { opacity: 0.5 }, reviewValue: { color: '#102744', fontSize: 17, lineHeight: 24 },
});
const s = captureStyles;
export function CaptureFrame({ title, children, footer, onClose, busy = false, phase = '', closeLabel = 'Close form and keep draft', appearance='form' }: { title: string; appearance?:'form'|'route'; closeLabel?: string; children: React.ReactNode; footer?: React.ReactNode; onClose?(): void; busy?: boolean; phase?: string }) {
  const insets = useSafeAreaInsets(), body = useRef<ScrollView>(null), presentation = useContext(CaptureFrameContext);
  useEffect(() => presentation?.register(onClose, busy), [presentation, onClose, busy]);
  useEffect(() => { body.current?.scrollTo({ y: 0, animated: false }); }, [phase]);
  useFocusEffect(useCallback(() => {
    if (!onClose || presentation?.overlay) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (!busy) onClose(); return true; });
    return () => listener.remove();
  }, [onClose, busy, presentation]));
  // A root modal owns its system inset; a tab screen already has the Android inset.
  return <View style={[s.backdrop, { paddingTop: insets.top + 12, paddingBottom: presentation?.overlay ? insets.bottom + 12 : Platform.OS === 'web' ? 96 : 12 }]}>
    <KeyboardAvoidingView style={s.avoid} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
      <View style={[s.panel,appearance==='route'&&{backgroundColor:'#102744'}]}>
        <View style={[s.header,appearance==='route'&&{borderBottomWidth:0,paddingBottom:0}]}><Text accessibilityRole="header" style={[s.title,{flex:1},appearance==='route'&&{fontSize:16,fontWeight:'500',color:'#B6C5D8'}]}>{title}</Text>
          {onClose ? <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} disabled={busy} onPress={onClose} style={[s.close,appearance==='route'&&{backgroundColor:'#233B57',borderRadius:22},busy&&s.disabled]}><Feather name="x" size={22} color={appearance==='route'?'#DDE7F1':'#24476A'} /></Pressable> : null}
        </View>
        <ScrollView ref={body} style={{ flexShrink: 1 }} contentContainerStyle={[s.body,appearance==='route'&&{paddingTop:18,gap:24}]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>{children}</ScrollView>
        {footer ? <View style={[s.footer,appearance==='route'&&{borderTopWidth:0,backgroundColor:'#102744',paddingTop:6}]}>{footer}</View> : null}
      </View>
    </KeyboardAvoidingView>
  </View>;
}
export function CaptureButton({ title, onPress, disabled = false, busy = false, secondary = false, onDark = false }: { title: string; onPress(): void; disabled?: boolean; busy?: boolean; secondary?: boolean; onDark?:boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={[secondary ? s.secondary : s.primary, (disabled || busy) && s.disabled]}>
    {busy ? <ActivityIndicator color="#102744" accessibilityLabel="Please wait" /> : <Text style={[secondary?s.secondaryText:s.primaryText,secondary&&onDark&&{color:'#D6E2EE'}]}>{title}</Text>}
  </Pressable>;
}
export function CaptureHelp({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 4 }}><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(value => !value)} style={[s.secondary, { alignItems: 'flex-start' }]}><Text style={s.secondaryText}>{label} {open ? '−' : '+'}</Text></Pressable>{open ? children : null}</View>;
}
export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return <View style={{ gap: 7 }}><Text style={s.label}>{label}</Text>{children}{hint ? <Text style={s.note}>{hint}</Text> : null}{error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}</View>;
}
export const CaptureInput = forwardRef<TextInput, TextInputProps>(function CaptureInput(props, ref) {
  return <TextInput ref={ref} placeholderTextColor="#6D7D91" autoCorrect={false} {...props} style={[s.input, props.editable === false && s.disabled, props.style]} />;
});
export function CityField({ label, city, onPress, disabled, error, hint }: { label: string; city: V2City | null; onPress(): void; disabled?: boolean; error?: string; hint?: string }) {
  return <Field label={label} error={error}><Pressable accessibilityRole="button" accessibilityLabel={`Choose ${label.toLowerCase().replace(' *','')}`} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[s.input, disabled && s.disabled]}><Text style={{ color: '#102744', fontSize: 16 }}>{city?.name ?? (hint ? hint + ' — choose a city' : 'Choose a city')}</Text></Pressable></Field>;
}
export function Choices<T extends string>({ label, value, options, onChange, disabled, error }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange(value: T): void; disabled?: boolean; error?: string }) {
  return <Field label={label} error={error}><View style={s.choices}>{options.map(([key, text]) => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={`${label}: ${text}`} aria-checked={value === key} accessibilityState={{ checked: value === key, disabled: !!disabled }} disabled={disabled} onPress={() => onChange(key)} style={[s.choice, value === key && s.selected, disabled && s.disabled]}><Text style={s.secondaryText}>{text}</Text></Pressable>)}</View></Field>;
}
export function ReviewRow({ label, value }: { label: string; value: string }) { return <View style={{ gap: 4 }}><Text style={s.label}>{label}</Text><Text style={s.reviewValue}>{value}</Text></View>; }
export function CityPicker({ title, close, select, initialQuery = '' }: { title: string; close(): void; select(city: V2City): void; initialQuery?: string }) {
  const insets = useSafeAreaInsets(), [search, setSearch] = useState(initialQuery), [cities, setCities] = useState<V2City[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setBusy(true); setError(''); setCities([]);
    const timeout = setTimeout(() => { if (alive) { controller.abort(); setBusy(false); setError('City search timed out. Try again.'); } }, 15000);
    const timer = setTimeout(() => {
      listV2Cities({ q: search }, { signal: controller.signal }).then(result => { if (alive && !controller.signal.aborted) setCities(result.cities); })
        .catch(() => { if (alive && !controller.signal.aborted) setError('City search could not load. Try again.'); })
        .finally(() => { clearTimeout(timeout); if (alive) setBusy(false); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [search, retry]);
  return <Modal visible animationType="slide" onRequestClose={close}><View style={{ flex: 1, backgroundColor: '#F4F6FA', padding: 22, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text accessibilityRole="header" style={[s.title, { flex: 1 }]}>{title}</Text><CaptureButton title="Close city search" secondary onPress={close} /></View>
    <CaptureInput autoFocus accessibilityLabel="Search cities" placeholder="Search a city" value={search} maxLength={80} onChangeText={setSearch} />
    {busy ? <ActivityIndicator accessibilityLabel="Searching cities" /> : null}
    {error ? <><Text accessibilityRole="alert" style={s.error}>{error}</Text><CaptureButton title="Try city search again" secondary onPress={() => setRetry(v => v + 1)} /></> : null}
    {!busy && !error && !cities.length ? <Text style={s.note}>No matching city. Try a different spelling.</Text> : null}
    <ScrollView keyboardShouldPersistTaps="handled">{cities.map(city => <Pressable key={city.id} accessibilityRole="button" accessibilityLabel={`${city.name}, ${city.placeType}`} style={[s.group, { marginBottom: 8 }]} onPress={() => select(city)}><Text style={s.label}>{city.name}</Text><Text style={s.note}>{city.placeType}</Text></Pressable>)}</ScrollView>
  </View></Modal>;
}
