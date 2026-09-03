import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import type { NormRect } from '@albumphoto/core';
import { colors, radius, spacing } from '../theme';

export interface PersonCardProps {
  /** URI de la photo de référence et rectangle du visage (normalisé). */
  uri: string;
  faceRect: NormRect;
  photoWidth: number;
  photoHeight: number;
  count: number;
  name: string;
  selected: boolean;
  onToggle: () => void;
  onNameChange: (name: string) => void;
}

const SIZE = 96;

/** Carte d'une personne détectée : visage recadré, nombre de photos, nom, sélection. */
export function PersonCard({ uri, faceRect, photoWidth, photoHeight, count, name, selected, onToggle, onNameChange }: PersonCardProps) {
  // Recadrage « cover » du visage avec une marge de 60 %.
  const m = 0.6;
  const cx = faceRect.x + faceRect.w / 2;
  const cy = faceRect.y + faceRect.h / 2;
  const side = Math.max(faceRect.w * photoWidth, faceRect.h * photoHeight) * (1 + m);
  const scale = SIZE / side;
  const imgW = photoWidth * scale;
  const imgH = photoHeight * scale;
  const left = SIZE / 2 - cx * imgW;
  const top = SIZE / 2 - cy * imgH;
  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <Pressable onPress={onToggle} style={styles.face}>
        <Image source={{ uri }} style={{ position: 'absolute', left, top, width: imgW, height: imgH }} contentFit="fill" cachePolicy="memory-disk" />
        <View style={[styles.check, selected && styles.checkOn]}>
          <Text style={styles.checkText}>{selected ? '✓' : ''}</Text>
        </View>
      </Pressable>
      <TextInput value={name} onChangeText={onNameChange} placeholder="Prénom" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="words" />
      <Text style={styles.count}>
        {count} photo{count > 1 ? 's' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: SIZE + spacing.md * 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', gap: spacing.xs },
  cardSelected: { borderColor: colors.primary },
  face: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', backgroundColor: colors.slotEmpty },
  check: { position: 'absolute', right: 4, bottom: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary },
  checkText: { color: colors.primaryText, fontWeight: '700' },
  input: { width: '100%', textAlign: 'center', fontSize: 15, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 4 },
  count: { fontSize: 12, color: colors.muted },
});
