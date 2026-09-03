import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CAPTION_STYLES, type CaptionOption, type CaptionStyle, type Photo } from '@albumphoto/core';
import { colors, radius, spacing } from '../theme';

export const STYLE_LABELS: Record<CaptionStyle, string> = {
  funny: 'Drôle',
  formal: 'Formel',
  poetic: 'Poétique',
  minimal: 'Minimaliste',
  family: 'Famille',
};

function byStyle(options: CaptionOption[]): [CaptionStyle, CaptionOption[]][] {
  return CAPTION_STYLES.map((style) => [style, options.filter((o) => o.style === style)] as const)
    .filter(([, list]) => list.length > 0)
    .map(([style, list]) => [style, [...list]]);
}

/**
 * Ce que l'IA avait à dire d'une photo : la description produite sur l'appareil
 * et les légendes proposées, style par style.
 *
 * Rien n'est régénéré ici — tout a été écrit à la composition de l'album et
 * conservé avec lui. Toucher une proposition la reprend dans le champ de
 * saisie, où elle reste modifiable avant d'être validée.
 */
export function CaptionChooser({
  photos,
  onPick,
}: {
  /** Photos de la page, dans l'ordre des zones. */
  photos: Photo[];
  onPick: (text: string) => void;
}) {
  const useful = photos.filter((p) => p.description || p.captionOptions?.length);
  if (useful.length === 0) return null;
  const several = useful.length > 1;

  return (
    <View style={styles.container}>
      {useful.map((photo, index) => {
        const groups = byStyle(photo.captionOptions ?? []);
        return (
          <View key={photo.id} style={styles.photoBlock}>
            {several ? <Text style={styles.photoLabel}>Photo {index + 1}</Text> : null}
            {photo.description ? (
              <View style={styles.descriptionCard}>
                <Text style={styles.sectionLabel}>Ce que le modèle a vu</Text>
                <Text style={styles.description}>{photo.description}</Text>
              </View>
            ) : null}
            {groups.map(([style, options]) => (
              <View key={style} style={styles.styleBlock}>
                <Text style={styles.sectionLabel}>{STYLE_LABELS[style]}</Text>
                {options.map((option) => (
                  <Pressable
                    key={`${style}-${option.text}`}
                    onPress={() => onPick(option.text)}
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                  >
                    <Text style={styles.optionText}>{option.text}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  photoBlock: { gap: spacing.sm },
  photoLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  descriptionCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 2,
  },
  description: { color: colors.text, fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  sectionLabel: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  styleBlock: { gap: spacing.xs },
  option: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  optionPressed: { backgroundColor: colors.background },
  optionText: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
