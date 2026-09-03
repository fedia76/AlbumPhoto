/**
 * Écran de secours affiché quand l'application ne peut pas démarrer ou qu'une
 * erreur fatale survient. Volontairement sans aucune dépendance en dehors de
 * React Native : il doit s'afficher même si tout le reste est cassé.
 */
import React from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

export interface FatalErrorScreenProps {
  title?: string;
  message: string;
  /** Journal complet à joindre au partage. */
  log?: string;
  onRetry?: () => void;
}

export function FatalErrorScreen({ title, message, log, onRetry }: FatalErrorScreenProps) {
  const body = log && log.length > 0 ? `${message}\n\n--- Journal ---\n${log}` : message;
  const share = () => {
    void Share.share({ message: `AlbumPhoto — rapport d'erreur\n\n${body}`.slice(0, 60000) });
  };
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title ?? "AlbumPhoto n'a pas pu démarrer"}</Text>
      <Text style={styles.lead}>
        Voici le détail de l'erreur. Partagez-le (par message ou par mail) pour qu'elle puisse être corrigée.
      </Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text selectable style={styles.mono}>
          {body}
        </Text>
      </ScrollView>
      <View style={styles.actions}>
        <Pressable onPress={share} style={[styles.button, styles.primary]}>
          <Text style={styles.primaryText}>Partager le rapport</Text>
        </Pressable>
        {onRetry ? (
          <Pressable onPress={onRetry} style={styles.button}>
            <Text style={styles.buttonText}>Réessayer</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1c1e', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  lead: { color: '#c7c7cc', fontSize: 14, lineHeight: 20 },
  scroll: { flex: 1, backgroundColor: '#000000', borderRadius: 10 },
  scrollContent: { padding: 12 },
  mono: { color: '#ffd7a8', fontSize: 12, fontFamily: 'monospace' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#3a3a3c' },
  primary: { backgroundColor: '#2f6fed' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
