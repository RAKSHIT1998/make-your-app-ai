import { ActivityIndicator, Pressable, Text, TextInput, View, type PressableProps, type TextInputProps, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { c } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  const { c, fontSize } = useTheme();
  return <Text style={{ color: c.text, fontSize: fontSize['2xl'], fontWeight: '700', letterSpacing: -0.4 }}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  const { c, fontSize } = useTheme();
  return <Text style={[{ color: muted ? c.textMuted : c.text, fontSize: fontSize.base, lineHeight: 22 }, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { c, radius } = useTheme();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.lg, padding: 16 }, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, ...rest }: PressableProps & { title: string; variant?: 'primary' | 'secondary'; loading?: boolean }) {
  const { c, radius } = useTheme();
  const primary = variant === 'primary';
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => ({
        minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, flexDirection: 'row', gap: 8,
        backgroundColor: primary ? (pressed ? c.brandHover : c.brand) : c.surface,
        borderWidth: primary ? 0 : 1, borderColor: c.border, opacity: off ? 0.5 : 1,
      })}
      {...rest}
    >
      {loading && <ActivityIndicator color={primary ? c.brandFg : c.text} />}
      <Text style={{ color: primary ? c.brandFg : c.text, fontWeight: '600', fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { c, radius } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{props.label}</Text>
      <TextInput
        placeholderTextColor={c.textSubtle}
        accessibilityLabel={props.label}
        {...props}
        style={[{ minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, color: c.text, backgroundColor: c.surface, fontSize: 16 }, props.multiline && { minHeight: 120, textAlignVertical: 'top' }, props.style]}
      />
    </View>
  );
}

const STATUS: Record<string, 'brand' | 'success' | 'warning' | 'danger' | 'muted'> = {
  generating: 'brand', running: 'brand', queued: 'muted', ready: 'success', succeeded: 'success', awaiting_approval: 'warning', error: 'danger', failed: 'danger',
};
export function StatusBadge({ status }: { status: string }) {
  const { c } = useTheme();
  const tone = STATUS[status] ?? 'muted';
  const fg = tone === 'muted' ? c.textMuted : c[tone];
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: tone === 'brand' ? c.brandSoft : c.surfaceMuted }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{status.replace('_', ' ')}</Text>
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const { c } = useTheme();
  if (!error) return null;
  return <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 14 }}>{error instanceof Error ? error.message : 'Something went wrong.'}</Text>;
}

export function Loading() {
  const { c } = useTheme();
  return <View style={{ padding: 32, alignItems: 'center' }}><ActivityIndicator color={c.brand} /></View>;
}
