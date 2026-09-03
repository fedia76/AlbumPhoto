import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '../theme';

export interface PersonCardProps {
  id: string;
  /** Vignette du visage déjà recadrée (voir `services/faceThumbnails`). */
  uri?: string;
  count: number;
  name: string;
  selected: boolean;
  /** En mode fusion, la sélection désigne les visages à réunir. */
  mergeMode?: boolean;
  /** Rappels stables : l'identifiant est passé en argument pour que
   *  `React.memo` puisse éviter de redessiner toutes les cartes à chaque frappe. */
  onToggle: (id: string) => void;
  onNameChange: (id: string, name: string) => void;
}

const SIZE = 96;

/** Carte d'une personne détectée : visage, nombre de photos, nom, sélection. */
export const PersonCard = React.memo(function PersonCard({
  id,
  uri,
  count,
  name,
  selected,
  mergeMode,
  onToggle,
  onNameChange,
}: PersonCardProps) {
  return (
    <View style={[styles.card, selected && (mergeMode ? styles.cardMerging : styles.cardSelected)]}>
      <Pressable onPress={() => onToggle(id)} style={styles.face}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={id} /> : null}
        <View style={[styles.check, selected && (mergeMode ? styles.checkMerging : styles.checkOn)]}>
          <Text style={styles.checkText}>{selected ? '✓' : ''}</Text>
        </View>
      </Pressable>
      <TextInput
        value={name}
        onChangeText={(text) => onNameChange(id, text)}
        placeholder="Prénom"
        placeholderTextColor={colors.muted}
        style={styles.input}
        autoCapitalize="words"
        editable={!mergeMode}
      />
      <Text style={styles.count}>
        {count} photo{count > 1 ? 's' : ''}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: SIZE + spacing.md * 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardSelected: { borderColor: colors.primary },
  cardMerging: { borderColor: colors.accent },
  face: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', backgroundColor: colors.slotEmpty },
  check: { position: 'absolute', right: 4, bottom: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary },
  checkMerging: { backgroundColor: colors.accent },
  checkText: { color: colors.primaryText, fontWeight: '700' },
  input: { width: '100%', textAlign: 'center', fontSize: 15, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 4 },
  count: { fontSize: 12, color: colors.muted },
});
