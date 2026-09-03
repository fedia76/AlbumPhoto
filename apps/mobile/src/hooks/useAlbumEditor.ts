import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addPage,
  applyPhotoDrafts,
  changePageTemplate,
  clearSlot,
  cloneAlbum,
  movePage,
  placePhoto,
  removePage,
  setText,
  updateTransform,
  upsertPhoto,
  type Album,
  type CaptionDraft,
  type Photo,
  type PhotoTransform,
  type TextContent,
} from '@albumphoto/core';
import { loadAlbum, saveAlbum } from '../storage/albumStore';

/**
 * État de l'éditeur : l'album est immuable côté React (copie à chaque
 * opération), et sauvegardé automatiquement avec un léger délai.
 */
export function useAlbumEditor(albumId: string) {
  const [album, setAlbum] = useState<Album | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<Album | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Légendes saisies à la main : le modèle ne doit pas les écraser. */
  const manualCaptions = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    loadAlbum(albumId)
      .then((a) => {
        if (!cancelled) setAlbum(a);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const a = pending.current;
    if (!a) return;
    pending.current = null;
    setSaving(true);
    try {
      await saveAlbum(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => () => void flush(), [flush]);

  const mutate = useCallback(
    (fn: (draft: Album) => void) => {
      setAlbum((current) => {
        if (!current) return current;
        const draft = cloneAlbum(current);
        try {
          fn(draft);
        } catch (e) {
          setError((e as Error).message);
          return current;
        }
        pending.current = draft;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 600);
        return draft;
      });
    },
    [flush],
  );

  /**
   * Repose les légendes écrites en tâche de fond. Passe par `mutate` : l'album
   * affiché et le fichier restent d'accord, et les retouches en cours ne sont
   * pas perdues — ce qui arriverait si la tâche écrivait le fichier sous nos
   * pieds pendant que l'éditeur tient une copie.
   *
   * Une légende retouchée à la main pendant que le modèle écrit encore n'est
   * pas remplacée : c'est le dernier mot de l'utilisateur qui compte.
   */
  const applyCaptions = useCallback(
    (drafts: Map<string, CaptionDraft>) =>
      mutate((d) => void applyPhotoDrafts(d, drafts, (text) => manualCaptions.current.has(text))),
    [mutate],
  );

  return {
    album,
    error,
    saving,
    applyCaptions,
    clearError: () => setError(null),
    flush,
    addPage: (templateId: string, index?: number) => {
      let id = '';
      mutate((d) => {
        id = addPage(d, templateId, index).id;
      });
      return id;
    },
    removePage: (pageId: string) => mutate((d) => removePage(d, pageId)),
    movePage: (pageId: string, to: number) => mutate((d) => movePage(d, pageId, to)),
    changeTemplate: (pageId: string, templateId: string) => mutate((d) => void changePageTemplate(d, pageId, templateId)),
    addPhoto: (photo: Photo) => mutate((d) => void upsertPhoto(d, photo)),
    placePhoto: (pageId: string, slotId: string, photoId: string) => mutate((d) => placePhoto(d, pageId, slotId, photoId)),
    clearSlot: (pageId: string, slotId: string) => mutate((d) => clearSlot(d, pageId, slotId)),
    setTransform: (pageId: string, slotId: string, t: PhotoTransform) => mutate((d) => void updateTransform(d, pageId, slotId, t)),
    setText: (pageId: string, slotId: string, content: TextContent) => {
      if (content.role === 'caption' && content.text.trim()) manualCaptions.current.add(content.text);
      mutate((d) => setText(d, pageId, slotId, content));
    },
    setTitle: (title: string) => mutate((d) => void (d.title = title)),
  };
}

export type AlbumEditor = ReturnType<typeof useAlbumEditor>;
