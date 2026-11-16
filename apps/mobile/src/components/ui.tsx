import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useTheme } from '@/lib/theme';

export type IconName = React.ComponentProps<typeof Feather>['name'];
export function Icon({ name, size = 18, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Feather name={name} size={size} color={color ?? c.text} style={style} />;
}

// ───────── Layout ─────────
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</View>;
}

/** A scrolling page with a large title. `topInset` adds the status-bar gap for screens without a navigation header. */
export function Page({ title, subtitle, right, children, onRefresh, refreshing = false, topInset, contentStyle, testID }: {
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; topInset?: boolean; contentStyle?: StyleProp<ViewStyle>; testID?: string;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Screen>
      <ScrollView
        testID={testID}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[{ padding: 20, paddingTop: topInset ? insets.top + 12 : 16, paddingBottom: 40, gap: 20 }, contentStyle]}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} /> : undefined}
      >
        {(title || right) && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View style={{ flex: 1, gap: 4 }}>
              {title ? <H1>{title}</H1> : null}
              {subtitle ? <Muted>{subtitle}</Muted> : null}
            </View>
            {right}
          </View>
        )}
        {children}
      </ScrollView>
    </Screen>
  );
}

export function Row({ children, gap = 8, style, wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Section({ title, action, onAction, children, style }: { title: string; action?: string; onAction?: () => void; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ gap: 10 }, style]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 }}>{title}</Text>
        {action && onAction ? (
          <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: c.accentText, fontWeight: '600', fontSize: 14 }}>{action}</Text>
          </Pressable>
        ) : null}
      </Row>
      {children}
    </View>
  );
}

// ───────── Type ─────────
export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={[{ color: c.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.7, lineHeight: 36 }, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={[{ color: c.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }, style]}>{children}</Text>;
}
export function H3({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const { c } = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ color: c.text, fontSize: 16, fontWeight: '600' }, style]}>{children}</Text>;
}
export function Body({ children, muted, style, numberOfLines, selectable }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean }) {
  const { c } = useTheme();
  return <Text selectable={selectable} numberOfLines={numberOfLines} style={[{ color: muted ? c.textMuted : c.text, fontSize: 15, lineHeight: 22 }, style]}>{children}</Text>;
}
export const Muted = (p: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) => <Body muted {...p} />;
export function Caption({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const { c } = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ color: c.textSubtle, fontSize: 13, lineHeight: 18 }, style]}>{children}</Text>;
}
export function Overline({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text style={{ color: c.textSubtle, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>{children}</Text>;
}

// ───────── Surfaces ─────────
export function Card({ children, style, onPress, accessibilityLabel, tone, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; tone?: 'accent' | 'warning' | 'danger' | 'success'; testID?: string }) {
  const { c, radius } = useTheme();
  const base: ViewStyle = {
    backgroundColor: tone ? c[`${tone}Soft`] : c.surface, borderColor: tone ? c[tone === 'accent' ? 'accent' : tone] : c.border,
    borderWidth: 1, borderRadius: radius.xl, padding: 16, gap: 8,
  };
  if (!onPress) return <View testID={testID} style={[base, style]}>{children}</View>;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [base, pressed && { backgroundColor: c.surfaceMuted }, style]}>
      {children}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.border, marginLeft: inset }} />;
}

// ───────── Actions ─────────
type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export function Button({ title, onPress, variant = 'primary', size = 'md', icon, loading, disabled, full, style, ...rest }: Omit<PressableProps, 'style'> & {
  title: string; variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: IconName; loading?: boolean; full?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { c, radius } = useTheme();
  const off = disabled || loading;
  const palette: Record<ButtonVariant, { bg: string; bgPressed: string; fg: string; border: string }> = {
    primary: { bg: c.primary, bgPressed: c.primaryHover, fg: c.primaryFg, border: c.primary },
    accent: { bg: c.accent, bgPressed: c.accentHover, fg: c.accentFg, border: c.accent },
    secondary: { bg: c.surface, bgPressed: c.surfaceMuted, fg: c.text, border: c.borderStrong },
    ghost: { bg: 'transparent', bgPressed: c.surfaceMuted, fg: c.text, border: 'transparent' },
    danger: { bg: c.dangerSoft, bgPressed: c.dangerSoft, fg: c.danger, border: c.danger },
  };
  const p = palette[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityLabel={title}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [{
        minHeight: size === 'sm' ? 38 : 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: size === 'sm' ? 12 : 18, flexDirection: 'row', gap: 8, alignSelf: full ? 'stretch' : undefined,
        backgroundColor: pressed ? p.bgPressed : p.bg, borderWidth: 1, borderColor: p.border, opacity: off ? 0.45 : 1,
      }, style]}
      {...rest}
    >
      {loading ? <ActivityIndicator size="small" color={p.fg} /> : icon ? <Feather name={icon} size={size === 'sm' ? 15 : 17} color={p.fg} /> : null}
      <Text style={{ color: p.fg, fontWeight: '600', fontSize: size === 'sm' ? 14 : 16 }} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, tone, size = 44, disabled }: { icon: IconName; label: string; onPress: () => void; tone?: 'accent' | 'muted'; size?: number; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surfaceMuted : 'transparent', opacity: disabled ? 0.4 : 1 })}>
      <Feather name={icon} size={20} color={tone === 'accent' ? c.accentText : tone === 'muted' ? c.textMuted : c.text} />
    </Pressable>
  );
}

// ───────── Inputs ─────────
export function Field({ label, hint, error, multiline, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { c, radius } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
      <TextInput
        placeholderTextColor={c.textSubtle}
        accessibilityLabel={label}
        multiline={multiline}
        onFocus={(e) => { setFocus(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
        {...props}
        style={[{
          minHeight: 48, borderWidth: 1, borderColor: error ? c.danger : focus ? c.focus : c.border, borderRadius: radius.lg,
          paddingHorizontal: 14, paddingVertical: 12, color: c.text, backgroundColor: c.surface, fontSize: 16,
        }, multiline && { minHeight: 132, textAlignVertical: 'top' }, style]}
      />
      {error ? <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 13 }}>{error}</Text> : hint ? <Caption>{hint}</Caption> : null}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const { c, radius } = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', padding: 3, borderRadius: radius.lg, backgroundColor: c.surfaceMuted, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: on ? c.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: c.border }}>
            <Text numberOfLines={1} style={{ color: on ? c.text : c.textMuted, fontWeight: '600', fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityState={{ selected: !!selected }}
      style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primary : c.surface }}>
      {icon ? <Feather name={icon} size={14} color={selected ? c.primaryFg : c.textMuted} /> : null}
      <Text style={{ color: selected ? c.primaryFg : c.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function ToggleRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Row gap={12} style={{ minHeight: 52 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Body style={{ fontWeight: '600' }}>{label}</Body>
        {hint ? <Caption>{hint}</Caption> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} trackColor={{ true: c.accent, false: c.borderStrong }} thumbColor="#FFFFFF" {...(Platform.OS === 'web' ? ({ activeThumbColor: '#FFFFFF' } as object) : {})} />
    </Row>
  );
}

// ───────── Status ─────────
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const { c } = useTheme();
  const fg = tone === 'neutral' ? c.textMuted : tone === 'accent' ? c.accentText : c[tone];
  const bg = tone === 'neutral' ? c.surfaceMuted : c[`${tone}Soft`];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: bg, alignSelf: 'flex-start' }}>
      {icon ? <Feather name={icon} size={12} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const STATUS: Record<string, [string, Tone]> = {
  draft: ['Draft', 'neutral'], generating: ['Building', 'accent'], ready: ['Ready', 'success'], error: ['Needs attention', 'danger'], archived: ['Archived', 'neutral'],
  queued: ['Queued', 'neutral'], running: ['Working', 'accent'], awaiting_approval: ['Needs approval', 'warning'], succeeded: ['Done', 'success'], failed: ['Failed', 'danger'], canceled: ['Stopped', 'neutral'],
};
export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status.replace(/_/g, ' '), 'neutral'];
  return <Badge label={label} tone={tone} />;
}

export function ListRow({ icon, title, subtitle, right, onPress, chevron = !!onPress, destructive, testID }: {
  icon?: IconName; title: string; subtitle?: string | null; right?: ReactNode; onPress?: () => void; chevron?: boolean; destructive?: boolean; testID?: string;
}) {
  const { c, radius } = useTheme();
  const content = (
    <>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: destructive ? c.dangerSoft : c.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={17} color={destructive ? c.danger : c.text} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: destructive ? c.danger : c.text, fontSize: 16, fontWeight: '500' }}>{title}</Text>
        {subtitle ? <Caption numberOfLines={2}>{subtitle}</Caption> : null}
      </View>
      {right}
      {chevron ? <Feather name="chevron-right" size={18} color={c.textSubtle} /> : null}
    </>
  );
  const style: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 };
  if (!onPress) return <View testID={testID} style={style}>{content}</View>;
  return <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [style, pressed && { opacity: 0.6 }]}>{content}</Pressable>;
}

/** A grouped list inside one card, rows separated by hairlines. */
export function Group({ children }: { children: ReactNode }) {
  const { c, radius } = useTheme();
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14 }}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <Divider /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'accent' | 'danger' | 'success' }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 130, gap: 2 }}>
      <Caption>{label}</Caption>
      <Text style={{ color: tone === 'accent' ? c.accentText : tone ? c[tone] : c.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Caption>{hint}</Caption> : null}
    </View>
  );
}

export function Avatar({ label, size = 40 }: { label: string; size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.accentText, fontWeight: '700', fontSize: size * 0.38 }}>{label}</Text>
    </View>
  );
}

// ───────── Feedback ─────────
export function EmptyState({ icon, title, body, action, onAction }: { icon: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 16, gap: 10 }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={22} color={c.textMuted} />
      </View>
      <H3 style={{ textAlign: 'center' }}>{title}</H3>
      {body ? <Muted style={{ textAlign: 'center', maxWidth: 320 }}>{body}</Muted> : null}
      {action && onAction ? <Button title={action} onPress={onAction} variant="secondary" size="sm" style={{ marginTop: 4 }} /> : null}
    </View>
  );
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function ErrorText({ error }: { error: unknown }) {
  const { c } = useTheme();
  if (!error) return null;
  return <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 14, lineHeight: 20 }}>{errorMessage(error)}</Text>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card tone="danger" style={{ gap: 10 }}>
      <Row><Icon name="alert-circle" color={useTheme().c.danger} /><H3 style={{ flex: 1 }}>Couldn't load this</H3></Row>
      <ErrorText error={error} />
      {onRetry ? <Button title="Try again" variant="secondary" size="sm" icon="refresh-cw" onPress={onRetry} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}

export function Loading({ label }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 10 }} accessibilityLabel={label ?? 'Loading'}>
      <ActivityIndicator color={c.accent} />
      {label ? <Caption>{label}</Caption> : null}
    </View>
  );
}

export function Skeleton({ height = 16, width = '100%', radius: r = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }), Animated.timing(v, { toValue: 0.5, duration: 700, useNativeDriver: Platform.OS !== 'web' })]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ height, width, borderRadius: r, backgroundColor: c.surfaceSunken, opacity: v }, style]} />;
}

export function SkeletonCards({ count = 3, height = 72 }: { count?: number; height?: number }) {
  return <View style={{ gap: 10 }} accessibilityLabel="Loading">{Array.from({ length: count }, (_, i) => <Skeleton key={i} height={height} radius={16} />)}</View>;
}

// ───────── Sheets and confirmation ─────────
export function Sheet({ open, onClose, title, children, testID }: { open: boolean; onClose: () => void; title: string; children: ReactNode; testID?: string }) {
  const { c, radius } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View testID={testID} accessibilityViewIsModal style={{ backgroundColor: c.surface, borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4, maxHeight: '88%', paddingBottom: insets.bottom + 12 }}>
          <View style={{ alignItems: 'center', paddingTop: 8 }}><View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong }} /></View>
          <Row style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4 }}>
            <H2 style={{ flex: 1, fontSize: 18 }}>{title}</H2>
            <IconButton icon="x" label="Close" onPress={onClose} size={40} />
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }}>{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ConfirmOptions { title: string; body?: string; confirm: string; destructive?: boolean }
interface ConfirmState { open: ConfirmOptions | null; resolve: ((ok: boolean) => void) | null }
const useConfirmStore = create<ConfirmState>(() => ({ open: null, resolve: null }));
/** Promise-based confirmation that works the same on iOS, Android and the web build. */
export function confirmAction(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().resolve?.(false);
    useConfirmStore.setState({ open: o, resolve });
  });
}
export function ConfirmHost() {
  const { open, resolve } = useConfirmStore();
  const done = (ok: boolean) => {
    resolve?.(ok);
    useConfirmStore.setState({ open: null, resolve: null });
  };
  return (
    <Sheet open={!!open} onClose={() => done(false)} title={open?.title ?? ''} testID="confirm-sheet">
      {open?.body ? <Muted>{open.body}</Muted> : null}
      <Button title={open?.confirm ?? 'OK'} variant={open?.destructive ? 'danger' : 'primary'} onPress={() => done(true)} full />
      <Button title="Cancel" variant="ghost" onPress={() => done(false)} full />
    </Sheet>
  );
}

interface ToastItem { id: number; text: string; tone: 'success' | 'error' | 'info' }
const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let toastSeq = 0;
function push(text: string, tone: ToastItem['tone']) {
  const id = ++toastSeq;
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, text, tone }] }));
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), tone === 'error' ? 5000 : 3200);
}
export const toast = { success: (t: string) => push(t, 'success'), error: (t: string) => push(t, 'error'), info: (t: string) => push(t, 'info') };

export function ToastHost() {
  const { c, radius } = useTheme();
  const items = useToasts((s) => s.items);
  const insets = useSafeAreaInsets();
  if (!items.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 8, gap: 8 }}>
      {items.map((t) => (
        <View key={t.id} accessibilityLiveRegion="polite" accessibilityRole={t.tone === 'error' ? 'alert' : 'text'}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: c.primary, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
          <Feather name={t.tone === 'success' ? 'check-circle' : t.tone === 'error' ? 'alert-circle' : 'info'} size={18} color={t.tone === 'error' ? c.accent : c.primaryFg} />
          <Text style={{ color: c.primaryFg, flex: 1, fontSize: 15 }}>{t.text}</Text>
        </View>
      ))}
    </View>
  );
}
