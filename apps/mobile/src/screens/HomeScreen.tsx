import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addPage, createAlbum } from '@albumphoto/core';
import { APP_GENERATOR } from '../config';
import { useNavigation } from '../navigation';
import { deleteAlbum, listAlbums, saveAlbum, type AlbumSummary } from '../storage/albumStore';
import { colors, radius, spacing } from '../theme';
import { Button, EmptyState, Header } from '../components/ui';
import { acknowledgeBootCrash, crashedAtPreviousBoot } from '../diagnostics/boot';

export function HomeScreen() {
  const nav = useNavigation();
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [showCrashNotice, setShowCrashNotice] = useState(crashedAtPreviousBoot);

  const refresh = useCallback(() => {
    listAlbums()
      .then(setAlbums)
      .catch(() => setAlbums([]));
  }, []);
  useEffect(refresh, [refresh]);

  const createEmpty = async () => {
    const album = createAlbum({ title: 'Nouvel album', generator: APP_GENERATOR });
    addPage(album, 'cover');
    await saveAlbum(album);
    nav.navigate({ name: 'editor', albumId: album.id });
  };

  const confirmDelete = (a: AlbumSummary) => {
    Alert.alert('Supprimer cet album ?', `« ${a.title} » et ses photos copiées seront supprimés de l'application.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => void deleteAlbum(a.id).then(refresh) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        title="Mes albums"
        right={<Button title="Diagnostic" variant="ghost" onPress={() => nav.navigate({ name: 'diagnostics' })} />}
      />
      {showCrashNotice ? (
        <Pressable
          style={styles.notice}
          onPress={() => {
            acknowledgeBootCrash();
            setShowCrashNotice(false);
            nav.navigate({ name: 'diagnostics' });
          }}
        >
          <Text style={styles.noticeTitle}>Le lancement précédent s'est interrompu</Text>
          <Text style={styles.noticeText}>Touchez ici pour voir le détail et partager le rapport.</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={albums ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          albums === null ? null : <EmptyState title="Aucun album pour l'instant" text="Laissez l'IA locale composer un album à partir de vos photos, ou partez d'une page blanche." />
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => nav.navigate({ name: 'editor', albumId: item.id })} onLongPress={() => confirmDelete(item)}>
            <View style={styles.cover}>{item.coverUri ? <Image source={{ uri: item.coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.cardMeta}>
                {item.pageCount} page{item.pageCount > 1 ? 's' : ''} · {item.photoCount} photo{item.photoCount > 1 ? 's' : ''}
              </Text>
              <Text style={styles.cardMeta}>Modifié le {new Date(item.updatedAt).toLocaleDateString('fr-FR')}</Text>
            </View>
          </Pressable>
        )}
      />
      <View style={styles.actions}>
        <Button title="✨ Créer avec l'IA locale" onPress={() => nav.navigate({ name: 'wizard' })} />
        <Button title="Album vide" variant="secondary" onPress={() => void createEmpty()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md, gap: spacing.md },
  card: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center' },
  cover: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.slotEmpty, overflow: 'hidden' },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  cardMeta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  actions: { padding: spacing.md, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  notice: { margin: spacing.md, marginBottom: 0, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#fdeaea', borderWidth: 1, borderColor: colors.danger },
  noticeTitle: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  noticeText: { color: colors.text, fontSize: 13, marginTop: 2 },
});
