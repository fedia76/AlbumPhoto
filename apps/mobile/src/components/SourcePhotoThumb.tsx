import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import type { SourcePhoto } from '@albumphoto/core';
import { getPhotoThumbnail } from '../services/photoThumbnails';
import { colors, radius } from '../theme';

/** Vignette d'une photo de l'appareil, produite à la demande puis mise en cache. */
export function SourcePhotoThumb({ photo, size }: { photo: SourcePhoto; size: number }) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPhotoThumbnail(photo, size * 2)
      .then((u) => {
        if (alive) setUri(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [photo, size]);

  return (
    <View style={[styles.box, { width: size, height: size }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={photo.id} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.slotEmpty },
});
