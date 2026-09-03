import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type * as MediaLibrary from 'expo-media-library/legacy';
import { getTemplate, newId, type Photo, type TemplateSlot } from '@albumphoto/core';
import { useNavigation } from '../navigation';
import { useAlbumEditor } from '../hooks/useAlbumEditor';
import { PageView } from '../components/PageView';
import { TemplatePicker } from '../components/TemplatePicker';
import { PhotoPicker } from '../components/PhotoPicker';
import { Button, Header } from '../components/ui';
import { assetToSource } from '../services/photoSource';
import { BundlePhotoImporter } from '../services/importer';
import { colors, radius, spacing } from '../theme';

export function EditorScreen({ albumId }: { albumId: string }) {
  const nav = useNavigation();
  const editor = useAlbumEditor(albumId);
  const { album } = editor;
  const { width } = useWindowDimensions();
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string | undefined>();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [textFor, setTextFor] = useState<{ slotId: string; text: string } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (editor.error) Alert.alert('Erreur', editor.error, [{ text: 'OK', onPress: editor.clearError }]);
  }, [editor.error, editor.clearError]);

  const page = album?.pages[Math.min(pageIndex, Math.max(0, (album?.pages.length ?? 1) - 1))];
  const template = album && page ? getTemplate(album, page.templateId) : undefined;
  const pageWidth = width - spacing.md * 2;
  const importer = useMemo(() => new BundlePhotoImporter(), []);

  if (!album) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Album" left={<Button title="Retour" variant="ghost" onPress={nav.back} />} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  const onSlotPress = (slot: TemplateSlot) => {
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
  };

  const onPick = async (asset: MediaLibrary.Asset) => {
    const slotId = pickerFor;
    setPickerFor(null);
    if (!slotId || !page) return;
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
    editor.addPage('single', pageIndex + 1);
    setPageIndex(pageIndex + 1);
    setSelectedSlot(undefined);
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
          setPageIndex(Math.max(0, pageIndex - 1));
          setSelectedSlot(undefined);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        title={album.title}
        left={<Button title="Retour" variant="ghost" onPress={() => void editor.flush().then(nav.back)} />}
        right={editor.saving ? <ActivityIndicator /> : <Button title="Titre" variant="ghost" onPress={() => setEditingTitle(true)} />}
      />

      <FlatList
        horizontal
        data={album.pages}
        keyExtractor={(p) => p.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        style={{ flexGrow: 0 }}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => {
              setPageIndex(index);
              setSelectedSlot(undefined);
            }}
            style={[styles.stripItem, index === pageIndex && styles.stripItemSelected]}
          >
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

      <ScrollView contentContainerStyle={styles.canvas}>
        {page ? (
          <View style={styles.pageShadow}>
            <PageView
              album={album}
              page={page}
              width={pageWidth}
              selectedSlotId={selectedSlot}
              onSlotPress={onSlotPress}
              onTransformChange={(slotId, t) => editor.setTransform(page.id, slotId, t)}
            />
          </View>
        ) : (
          <Text style={styles.hint}>Ajoutez une page avec « + ».</Text>
        )}
        <Text style={styles.hint}>
          {selectedSlot ? 'Glissez pour recadrer, pincez pour zoomer.' : 'Touchez une zone pour y placer une photo ou un texte.'}
        </Text>
      </ScrollView>

      {showTemplates && page && <TemplatePicker page={album.page} selectedId={page.templateId} onSelect={(t) => editor.changeTemplate(page.id, t.id)} />}

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
            <Text style={styles.modalTitle}>{editingTitle ? "Titre de l'album" : template?.slots.find((s) => s.id === textFor?.slotId)?.id === 'title' ? 'Titre' : 'Légende'}</Text>
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

      {importing && (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primaryText} size="large" />
          <Text style={{ color: colors.primaryText, marginTop: spacing.sm }}>Import de la photo…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  strip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: 'flex-end' },
  stripItem: { alignItems: 'center', padding: 3, borderRadius: radius.sm, borderWidth: 2, borderColor: 'transparent' },
  stripItemSelected: { borderColor: colors.primary },
  stripLabel: { fontSize: 10, color: colors.muted, marginTop: 2 },
  stripAdd: { width: 70, height: 84, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border },
  stripAddText: { fontSize: 24, color: colors.muted },
  canvas: { padding: spacing.md, alignItems: 'center', gap: spacing.md },
  pageShadow: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4, backgroundColor: colors.surface },
  hint: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tool: { flex: 1, paddingHorizontal: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  modalInput: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: 16, color: colors.text, textAlignVertical: 'top' },
  overlay: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
