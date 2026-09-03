import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  applyZoom,
  clampTransform,
  getTemplate,
  imageLayoutInSlot,
  panToOffsetDelta,
  slotRectInPixels,
  type Album,
  type Page,
  type PhotoTransform,
  type TemplateSlot,
} from '@albumphoto/core';
import { photoUri } from '../storage/albumStore';
import { colors } from '../theme';

export interface PageViewProps {
  album: Album;
  page: Page;
  /** Largeur d'affichage en px ; la hauteur découle du format de page. */
  width: number;
  /** Zone sélectionnée (éditable au geste). */
  selectedSlotId?: string;
  onSlotPress?: (slot: TemplateSlot) => void;
  onTransformChange?: (slotId: string, transform: PhotoTransform) => void;
  /** Rendu compact (vignettes) : pas de bordures ni de textes d'aide. */
  compact?: boolean;
}

/** Rendu d'une page conforme au format (voir docs/album-format.md §6.1). */
export function PageView({ album, page, width, selectedSlotId, onSlotPress, onTransformChange, compact }: PageViewProps) {
  const template = getTemplate(album, page.templateId);
  const height = (width * album.page.height) / album.page.width;
  if (!template) {
    return (
      <View style={[styles.page, { width, height, backgroundColor: page.background ?? album.theme.background }]}>
        <Text style={styles.missing}>Gabarit inconnu : {page.templateId}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.page, { width, height, backgroundColor: page.background ?? album.theme.background }]}>
      {template.slots.map((slot) => {
        const r = slotRectInPixels(slot, width, height);
        const box = { position: 'absolute' as const, left: r.x, top: r.y, width: r.w, height: r.h };
        if (slot.kind === 'text') {
          const content = page.texts[slot.id];
          const role = content?.role ?? 'caption';
          const fontSize = Math.max(8, (role === 'title' ? 0.055 : role === 'subtitle' ? 0.035 : 0.028) * width);
          return (
            <Pressable key={slot.id} style={[box, styles.textSlot, !compact && !content && styles.emptyText]} onPress={onSlotPress ? () => onSlotPress(slot) : undefined}>
              <Text
                numberOfLines={role === 'title' ? 2 : 3}
                adjustsFontSizeToFit
                style={{
                  fontSize,
                  color: content ? album.theme.textColor ?? colors.text : colors.muted,
                  textAlign: slot.align ?? 'center',
                  fontWeight: role === 'title' ? '700' : '400',
                  fontStyle: role === 'caption' ? 'italic' : 'normal',
                }}
              >
                {content?.text ?? (compact ? '' : 'Texte…')}
              </Text>
            </Pressable>
          );
        }
        const placement = page.photos[slot.id];
        const photo = placement ? album.photos.find((p) => p.id === placement.photoId) : undefined;
        const selected = selectedSlotId === slot.id;
        if (!placement || !photo) {
          return (
            <Pressable key={slot.id} style={[box, styles.emptySlot, selected && styles.selected]} onPress={onSlotPress ? () => onSlotPress(slot) : undefined}>
              {!compact && <Text style={styles.plus}>+</Text>}
            </Pressable>
          );
        }
        const uri = photoUri(album, photo, compact || r.w < 400);
        if (selected && onTransformChange) {
          return (
            <EditableSlot
              key={slot.id}
              album={album}
              slot={slot}
              box={box}
              uri={uri}
              photoWidth={photo.width}
              photoHeight={photo.height}
              transform={placement.transform}
              onChange={(t) => onTransformChange(slot.id, t)}
            />
          );
        }
        const layout = imageLayoutInSlot(photo.width, photo.height, slot, album.page, placement.transform, r.w, r.h);
        return (
          <Pressable key={slot.id} style={[box, styles.photoSlot]} onPress={onSlotPress ? () => onSlotPress(slot) : undefined}>
            <Image source={{ uri }} style={{ position: 'absolute', left: layout.left, top: layout.top, width: layout.imgW, height: layout.imgH }} contentFit="fill" cachePolicy="memory-disk" />
          </Pressable>
        );
      })}
    </View>
  );
}

interface EditableSlotProps {
  album: Album;
  slot: TemplateSlot;
  box: { position: 'absolute'; left: number; top: number; width: number; height: number };
  uri: string;
  photoWidth: number;
  photoHeight: number;
  transform: PhotoTransform;
  onChange: (t: PhotoTransform) => void;
}

/** Zone sélectionnée : glisser pour recadrer, pincer pour zoomer. */
function EditableSlot({ album, slot, box, uri, photoWidth, photoHeight, transform, onChange }: EditableSlotProps) {
  const [live, setLive] = useState<PhotoTransform>(transform);
  const [start, setStart] = useState<PhotoTransform>(transform);
  React.useEffect(() => {
    setLive(transform);
    setStart(transform);
  }, [transform]);

  const commit = useCallback(
    (t: PhotoTransform) => {
      setLive(t);
      setStart(t);
      onChange(t);
    },
    [onChange],
  );

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(2)
    .onUpdate((e) => {
      const d = panToOffsetDelta(e.translationX, e.translationY, box.width, box.height, photoWidth, photoHeight, slot, album.page, start.scale);
      setLive(clampTransform({ ...start, offsetX: start.offsetX + d.dOffsetX, offsetY: start.offsetY + d.dOffsetY }));
    })
    .onEnd((e) => {
      const d = panToOffsetDelta(e.translationX, e.translationY, box.width, box.height, photoWidth, photoHeight, slot, album.page, start.scale);
      commit(clampTransform({ ...start, offsetX: start.offsetX + d.dOffsetX, offsetY: start.offsetY + d.dOffsetY }));
    });

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onUpdate((e) => setLive(applyZoom(start, e.scale)))
    .onEnd((e) => commit(applyZoom(start, e.scale)));

  const gesture = Gesture.Simultaneous(pan, pinch);
  const layout = imageLayoutInSlot(photoWidth, photoHeight, slot, album.page, live, box.width, box.height);
  return (
    <GestureDetector gesture={gesture}>
      <View style={[box, styles.photoSlot, styles.selected]}>
        <Image source={{ uri }} style={{ position: 'absolute', left: layout.left, top: layout.top, width: layout.imgW, height: layout.imgH }} contentFit="fill" cachePolicy="memory-disk" />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  page: { overflow: 'hidden', borderRadius: 2 },
  photoSlot: { overflow: 'hidden', backgroundColor: colors.slotEmpty },
  emptySlot: { backgroundColor: colors.slotEmpty, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  plus: { fontSize: 28, color: colors.muted },
  textSlot: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  emptyText: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 4 },
  selected: { borderWidth: 2, borderColor: colors.selection, borderStyle: 'solid' },
  missing: { color: colors.danger, padding: 8 },
});
