import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BUILTIN_TEMPLATES, type PageSize, type Template } from '@albumphoto/core';
import { colors, radius, spacing } from '../theme';

/** Vignette schématique d'un gabarit (rectangles des zones). */
export function TemplateThumb({ template, page, width, selected }: { template: Template; page: PageSize; width: number; selected?: boolean }) {
  const height = (width * page.height) / page.width;
  return (
    <View style={[styles.thumb, { width, height }, selected && styles.thumbSelected]}>
      {template.slots.map((s) => (
        <View
          key={s.id}
          style={{
            position: 'absolute',
            left: s.rect.x * width,
            top: s.rect.y * height,
            width: s.rect.w * width,
            height: s.rect.h * height,
            backgroundColor: s.kind === 'photo' ? colors.muted : 'transparent',
            borderWidth: s.kind === 'text' ? 1 : 0,
            borderColor: colors.border,
            borderRadius: 1,
          }}
        />
      ))}
    </View>
  );
}

export function TemplatePicker({ page, selectedId, onSelect }: { page: PageSize; selectedId?: string; onSelect: (template: Template) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {BUILTIN_TEMPLATES.map((t) => (
        <Pressable key={t.id} onPress={() => onSelect(t)} style={styles.item}>
          <TemplateThumb template={t} page={page} width={64} selected={t.id === selectedId} />
          <Text style={styles.label} numberOfLines={1}>
            {t.name}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  item: { alignItems: 'center', width: 72 },
  thumb: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' },
  thumbSelected: { borderColor: colors.primary, borderWidth: 2 },
  label: { fontSize: 11, color: colors.muted, marginTop: 4 },
});
