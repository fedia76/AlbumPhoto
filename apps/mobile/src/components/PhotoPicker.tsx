import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';
import { Button, EmptyState } from './ui';
import { ensureMediaPermission } from '../services/photoSource';

/** Grille des photos de l'appareil pour choisir une photo à placer. */
export function PhotoPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (asset: MediaLibrary.Asset) => void }) {
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [denied, setDenied] = useState(false);
  const { width } = useWindowDimensions();
  const cols = 4;
  const size = (width - spacing.xs * (cols + 1)) / cols;

  const loadMore = useCallback(async () => {
    if (!hasMore) return;
    if (!(await ensureMediaPermission())) {
      setDenied(true);
      return;
    }
    const page = await MediaLibrary.getAssetsAsync({ first: 60, after: cursor, mediaType: ['photo'], sortBy: [['creationTime', false]] });
    setAssets((prev) => [...prev, ...page.assets]);
    setCursor(page.endCursor);
    setHasMore(page.hasNextPage);
  }, [cursor, hasMore]);

  useEffect(() => {
    if (visible && assets.length === 0) void loadMore();
  }, [visible, assets.length, loadMore]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Choisir une photo</Text>
          <Button title="Fermer" variant="ghost" onPress={onClose} />
        </View>
        {denied ? (
          <EmptyState title="Accès aux photos refusé" text="Autorisez l'accès à la galerie dans les réglages pour continuer." />
        ) : (
          <FlatList
            data={assets}
            numColumns={cols}
            keyExtractor={(a) => a.id}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.6}
            contentContainerStyle={{ padding: spacing.xs }}
            renderItem={({ item }) => (
              <Pressable onPress={() => onPick(item)} style={{ width: size, height: size, margin: spacing.xs / 2 }}>
                <Image source={{ uri: item.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.id} />
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
});
