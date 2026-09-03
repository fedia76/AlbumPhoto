import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type * as MediaLibrary from 'expo-media-library/legacy';
import { getTemplate, newId, photoSlots, type Page, type Photo, type TemplateSlot } from '@albumphoto/core';
import { useNavigation } from '../navigation';
import { useAlbumEditor } from '../hooks/useAlbumEditor';
import { CaptionChooser } from '../components/CaptionChooser';
import { CaptionProgress } from '../components/CaptionProgress';
import { PageView } from '../components/PageView';
import { TemplatePicker } from '../components/TemplatePicker';
import { PhotoPicker } from '../components/PhotoPicker';
import { Button, Header } from '../components/ui';
import { captionJob } from '../services/captionJob';
import { assetToSource } from '../services/photoSource';
import { BundlePhotoImporter } from '../services/importer';
import { colors, radius, spacing } from '../theme';

export function EditorScreen({ albumId }: { albumId: string }) {
  const nav = useNavigation();
  const editor = useAlbumEditor(albumId);
  const { album } = editor;
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string | undefined>();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [textFor, setTextFor] = useState<{ slotId: string; text: string } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [importing, setImporting] = useState(false);
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const pager = useRef<FlatList<Page>>(null);
  const importer = useMemo(() => new BundlePhotoImporter(), []);

  useEffect(() => {
    if (editor.error) Alert.alert('Erreur', editor.error, [{ text: 'OK', onPress: editor.clearError }]);
  }, [editor.error, editor.clearError]);

  // Tant que cet écran est ouvert, c'est lui qui applique les légendes que la
  // tâche de fond produit : lui laisser écrire le fichier de son côté ferait
  // travailler l'éditeur sur une copie périmée. La revendication est refaite
  // dès que l'album est chargé, car elle rejoue les légendes déjà écrites — et
  // avant le chargement, il n'y avait rien à modifier.
  const albumLoaded = album !== null;
  useEffect(() => captionJob.claim(albumId, editor.applyCaptions), [albumId, editor.applyCaptions, albumLoaded]);

  const pageCount = album?.pages.length ?? 0;
  const safeIndex = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const page = album?.pages[safeIndex];
  const template = album && page ? getTemplate(album, page.templateId) : undefined;

  /**
   * Photos de la page dont on modifie la légende : ce sont elles qui portent la
   * description et les propositions de l'IA. Vide pour un titre ou un
   * sous-titre, qui ne décrivent aucune photo.
   */
  const captionPhotos = useMemo<Photo[]>(() => {
    // La page en cours, et elle seule : chercher la page par le nom de la zone
    // ramenait toujours la première, « c1 » étant le nom de *toutes* les zones
    // de légende.
    if (!album || !page || !template || !textFor) return [];
    if (textFor.slotId === 'title' || textFor.slotId === 'subtitle') return [];
    return photoSlots(template)
      .map((slot) => page.photos[slot.id]?.photoId)
      .map((photoId) => album.photos.find((ph) => ph.id === photoId))
      .filter((ph): ph is Photo => !!ph);
  }, [album, page, template, textFor]);

  /** Change de page et amène le carrousel dessus. */
  const goToPage = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min(index, pageCount - 1));
      setPageIndex(clamped);
      setSelectedSlot(undefined);
      if (canvas.width > 0 && pageCount > 0) {
        pager.current?.scrollToOffset({ offset: clamped * canvas.width, animated });
      }
    },
    [canvas.width, pageCount],
  );

  const onCanvasLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCanvas((c) => (c.width === width && c.height === height ? c : { width, height }));
  }, []);

  const onPagerSettled = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (canvas.width <= 0) return;
      const index = Math.round(e.nativeEvent.contentOffset.x / canvas.width);
      if (index !== pageIndex) {
        setPageIndex(index);
        setSelectedSlot(undefined);
      }
    },
    [canvas.width, pageIndex],
  );

  const onSlotPress = useCallback(
    (slot: TemplateSlot) => {
      if (!page) return;
      if (slot.kind === 'text') {
        setTextFor({ slotId: slot.id, text: page.texts[slot.id]?.text ?? '' });
        return;
      }
      if (!page.photos[slot.id]) {
        setPickerFor(slot.id);
        return;
      }
      setSelectedSlot((s) => (s === slot.id ? undefined : slot.id));
    },
    [page],
  );

  const onPick = async (asset: MediaLibrary.Asset) => {
    const slotId = pickerFor;
    setPickerFor(null);
    if (!slotId || !page || !album) return;
    setImporting(true);
    try {
      const source = assetToSource(asset);
      const files = await importer.importPhoto(album.id, source);
      const photo: Photo = { id: newId(), src: files.src, width: source.width, height: source.height, sourceUri: source.uri };
      if (files.thumb) photo.thumb = files.thumb;
      if (files.mimeType) photo.mimeType = files.mimeType;
      if (source.takenAt) photo.takenAt = source.takenAt;
      editor.addPhoto(photo);
      editor.placePhoto(page.id, slotId, photo.id);
      setSelectedSlot(slotId);
    } catch (e) {
      Alert.alert('Import impossible', (e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const addPageAfter = () => {
    editor.addPage('single', safeIndex + 1);
    goToPage(safeIndex + 1);
  };

  const deletePage = () => {
    if (!page) return;
    Alert.alert('Supprimer la page ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          editor.removePage(page.id);
          goToPage(Math.max(0, safeIndex - 1));
        },
      },
    ]);
  };

  if (!album) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Album" left={<Button title="Retour" variant="ghost" onPress={nav.back} />} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  // La page tient entièrement dans l'espace disponible, largeur et hauteur.
  const aspect = album.page.width / album.page.height;
  const pageWidth =
    canvas.width > 0 && canvas.height > 0
      ? Math.max(1, Math.min(canvas.width - spacing.md * 2, (canvas.height - spacing.md * 2) * aspect))
      : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        title={album.title}
        left={<Button title="Retour" variant="ghost" onPress={() => void editor.flush().then(nav.back)} />}
        right={editor.saving ? <ActivityIndicator /> : <Button title="Titre" variant="ghost" onPress={() => setEditingTitle(true)} />}
      />
      <CaptionProgress albumId={albumId} />

      <FlatList
        horizontal
        data={album.pages}
        keyExtractor={(p) => p.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        style={styles.stripContainer}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => goToPage(index)} style={[styles.stripItem, index === safeIndex && styles.stripItemSelected]}>
            <PageView album={album} page={item} width={64} compact />
            <Text style={styles.stripLabel}>{index + 1}</Text>
          </Pressable>
        )}
        ListFooterComponent={
          <Pressable onPress={addPageAfter} style={[styles.stripItem, styles.stripAdd]}>
            <Text style={styles.stripAddText}>+</Text>
          </Pressable>
        }
      />

      <View style={styles.canvas} onLayout={onCanvasLayout}>
        {pageCount === 0 ? (
          <Text style={styles.hint}>Ajoutez une page avec « + ».</Text>
        ) : canvas.width > 0 ? (
          <FlatList
            ref={pager}
            data={album.pages}
            keyExtractor={(p) => p.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            // Le glissement de page ne doit pas concurrencer le recadrage d'une
            // photo sélectionnée.
            scrollEnabled={selectedSlot === undefined}
            onMomentumScrollEnd={onPagerSettled}
            getItemLayout={(_, index) => ({ length: canvas.width, offset: canvas.width * index, index })}
            onScrollToIndexFailed={() => undefined}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            renderItem={({ item }) => (
              <View style={[styles.pageSlide, { width: canvas.width }]}>
                <View style={styles.pageShadow}>
                  <PageView
                    album={album}
                    page={item}
                    width={pageWidth}
                    {...(item.id === page?.id && selectedSlot ? { selectedSlotId: selectedSlot } : {})}
                    onSlotPress={onSlotPress}
                    onTransformChange={(slotId, t) => editor.setTransform(item.id, slotId, t)}
                  />
                </View>
              </View>
            )}
          />
        ) : null}
      </View>

      <Text style={styles.hint}>
        {pageCount > 0 ? `Page ${safeIndex + 1} / ${pageCount} · ` : ''}
        {selectedSlot ? 'Glissez pour recadrer, pincez pour zoomer.' : 'Balayez pour changer de page, touchez une zone pour la modifier.'}
      </Text>

      {showTemplates && page ? (
        <TemplatePicker page={album.page} selectedId={page.templateId} onSelect={(t) => editor.changeTemplate(page.id, t.id)} />
      ) : null}

      <View style={styles.toolbar}>
        <Button title={showTemplates ? 'Masquer' : 'Gabarit'} variant="secondary" onPress={() => setShowTemplates((v) => !v)} style={styles.tool} />
        {selectedSlot && page?.photos[selectedSlot] ? (
          <>
            <Button title="Remplacer" variant="secondary" onPress={() => setPickerFor(selectedSlot)} style={styles.tool} />
            <Button
              title="Retirer"
              variant="danger"
              onPress={() => {
                editor.clearSlot(page.id, selectedSlot);
                setSelectedSlot(undefined);
              }}
              style={styles.tool}
            />
          </>
        ) : (
          <>
            <Button title="Page +" variant="secondary" onPress={addPageAfter} style={styles.tool} />
            <Button title="Suppr. page" variant="secondary" onPress={deletePage} disabled={!page} style={styles.tool} />
          </>
        )}
      </View>

      <PhotoPicker visible={pickerFor !== null} onClose={() => setPickerFor(null)} onPick={(a) => void onPick(a)} />

      <Modal visible={textFor !== null || editingTitle} transparent animationType="fade" onRequestClose={() => (setTextFor(null), setEditingTitle(false))}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editingTitle ? "Titre de l'album" : textFor?.slotId === 'title' ? 'Titre' : 'Légende'}
            </Text>
            {captionPhotos.length > 0 ? (
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                <CaptionChooser
                  photos={captionPhotos}
                  onPick={(text) => setTextFor((cur) => (cur ? { ...cur, text } : cur))}
                />
              </ScrollView>
            ) : null}
            <TextInput
              autoFocus
              multiline={!editingTitle}
              value={editingTitle ? album.title : textFor?.text ?? ''}
              onChangeText={(t) => (editingTitle ? editor.setTitle(t) : setTextFor((cur) => (cur ? { ...cur, text: t } : cur)))}
              style={styles.modalInput}
              placeholder="Votre texte…"
              placeholderTextColor={colors.muted}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' }}>
              <Button title="Annuler" variant="ghost" onPress={() => (setTextFor(null), setEditingTitle(false))} />
              <Button
                title="OK"
                onPress={() => {
                  if (textFor && page) {
                    const slot = template?.slots.find((s) => s.id === textFor.slotId);
                    const role = slot?.id === 'title' ? 'title' : slot?.id === 'subtitle' ? 'subtitle' : 'caption';
                    if (textFor.text.trim()) editor.setText(page.id, textFor.slotId, { text: textFor.text.trim(), role });
                    else editor.clearSlot(page.id, textFor.slotId);
                  }
                  setTextFor(null);
                  setEditingTitle(false);
                }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {importing ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primaryText} size="large" />
          <Text style={{ color: colors.primaryText, marginTop: spacing.sm }}>Import de la photo…</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  stripContainer: { flexGrow: 0 },
  strip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: 'flex-end' },
  stripItem: { alignItems: 'center', padding: 3, borderRadius: radius.sm, borderWidth: 2, borderColor: 'transparent' },
  stripItemSelected: { borderColor: colors.primary },
  stripLabel: { fontSize: 10, color: colors.muted, marginTop: 2 },
  stripAdd: { width: 70, height: 84, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border },
  stripAddText: { fontSize: 24, color: colors.muted },
  canvas: { flex: 1 },
  pageSlide: { alignItems: 'center', justifyContent: 'center' },
  pageShadow: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4, backgroundColor: colors.surface },
  hint: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tool: { flex: 1, paddingHorizontal: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  modalScroll: { maxHeight: 340 },
  modalInput: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: 16, color: colors.text, textAlignVertical: 'top' },
  overlay: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
