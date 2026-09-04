import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.surface : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? colors.primaryText : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'secondary' && styles.secondaryBorder,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Header({ title, left, right }: { title: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>{left}</View>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Text style={styles.progressLabel}>{label}</Text> : null}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && { color: colors.primaryText }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Interrupteur avec son intitulé et son explication. `Switch` de React Native
 * ne porte pas de texte : sur ces écrans de réglage, l'explication compte
 * autant que le réglage lui-même.
 */
export function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <View style={[styles.toggleBox, value && styles.toggleBoxOn]}>
        {value ? <Text style={styles.toggleMark}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryBorder: { borderWidth: 1, borderColor: colors.border },
  buttonText: { fontSize: 16, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerSide: { width: 90 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: colors.text },
  progressTrack: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary },
  progressLabel: { color: colors.muted, fontSize: 13 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  toggleBox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleMark: { color: colors.primaryText, fontSize: 15, fontWeight: '700', lineHeight: 18 },
  toggleLabel: { fontSize: 15, color: colors.text },
  toggleHint: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 2 },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center' },
  emptyText: { color: colors.muted, textAlign: 'center' },
});
