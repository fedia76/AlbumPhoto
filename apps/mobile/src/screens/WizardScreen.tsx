import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CAPTION_STYLES,
  DEFAULT_MAX_ARTIFICIALITY,
  TemplateCaptionGenerator,
  assembleAlbum,
  detectPeople,
  generateCaptions,
  mergeClusters,
  scanPhotos,
  selectBestPhotos,
  type CaptionStyle,
  type Album,
  type CaptionParams,
  type PersonCluster,
  type PhotoAnalysis,
  type PhotoEvent,
  type SelectedPhoto,
} from '@albumphoto/core';
import { APP_GENERATOR, CAPTION_TIMEOUT_MS, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT, SCAN_LIMIT_PRESETS } from '../config';
import { useNavigation } from '../navigation';
import { createAdapters, ensureMediaPermission, type AppAdapters } from '../services';
import type { CaptionEngine } from '../services/captioner';
import { captionJob } from '../services/captionJob';
import { looksLikeApiKey, maskApiKey, readApiKey, writeApiKey } from '../services/apiKey';
import { renderFaceThumbnail } from '../services/faceThumbnails';
import { saveAlbum } from '../storage/albumStore';
import { log } from '../diagnostics/log';
import { colors, radius, spacing } from '../theme';
import { Button, Chip, Header, ProgressBar, Toggle } from '../components/ui';
import { PersonCard } from '../components/PersonCard';
import { STYLE_LABELS } from '../components/CaptionChooser';
import { SelectionReview } from '../components/SelectionReview';

type Step = 'intro' | 'scanning' | 'people' | 'review' | 'style' | 'generating';

const LOCALE = 'fr-FR';

const ENGINES = ['template', 'llm', 'vlm', 'cloud'] as const satisfies readonly CaptionEngine[];

const ENGINE_LABELS: Record<CaptionEngine, string> = {
  template: 'Gabarits',
  llm: 'Modèle texte',
  vlm: 'Modèle vision',
  cloud: 'Vision + rédaction en ligne',
};

const ENGINE_HINTS: Record<CaptionEngine, string> = {
  template: 'Instantané, hors ligne : des tournures écrites à l\'avance, complétées avec les prénoms, la date et le lieu du moment.',
  llm: "Un petit modèle de langage rédige à partir des faits relevés (prénoms, étiquettes de contenu, date). Il ne voit pas la photo. Téléchargement ~600 Mo. L'album s'ouvre tout de suite, les légendes s'écrivent en arrière-plan.",
  vlm: "Un modèle vision-langage regarde chaque photo avant d'écrire : c'est ce qui donne les légendes les plus justes. Téléchargement ~1 Go, jusqu'à une minute par photo. L'album s'ouvre tout de suite, les légendes s'écrivent en arrière-plan.",
  cloud:
    "Le modèle local regarde la photo et la décrit ; Claude Haiku 4.5 écrit la légende. Seule la description et les prénoms sortent de l'appareil — jamais vos photos. Nécessite une clé d'API Anthropic ; comptez moins d'un centime pour un album.",
};

/** Nom attribué d'office : il ne doit pas gagner sur un nom saisi à la fusion. */
const DEFAULT_NAME = /^Personne \d+$/;

/** Assistant IA locale : parcours → personnes → style → génération. */
export function WizardScreen() {
  const nav = useNavigation();
  const [step, setStep] = useState<Step>('intro');
  const [title, setTitle] = useState('Mon album');
  const [subtitle, setSubtitle] = useState('');
  // Saisie libre : le texte fait foi pendant la frappe, le nombre en est dérivé.
  const [scanLimitText, setScanLimitText] = useState(String(DEFAULT_SCAN_LIMIT));
  const [engine, setEngine] = useState<CaptionEngine>('template');
  const [style, setStyle] = useState<CaptionStyle>('family');
  const [targetCount, setTargetCount] = useState(24);
  /** Écarter captures d'écran, images enregistrées et documents photographiés. */
  const [realPhotosOnly, setRealPhotosOnly] = useState(true);
  /**
   * Nombre de photos réclamé pour un moment donné, par clé de tranche. Ces clés
   * sont des dates : elles survivent au changement de personnes ou de cible, et
   * les réglages avec elles.
   */
  const [quotas, setQuotas] = useState<Map<string, number>>(new Map());
  const [progress, setProgress] = useState<{ label: string; value: number }>({ label: '', value: 0 });
  const [analyses, setAnalyses] = useState<PhotoAnalysis[]>([]);
  const [clusters, setClusters] = useState<PersonCluster[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [faceThumbs, setFaceThumbs] = useState<Map<string, string>>(new Map());
  const [mergeMode, setMergeMode] = useState(false);
  const [mergePick, setMergePick] = useState<Set<string>>(new Set());
  /** Clé d'API enregistrée, pour le moteur en ligne. */
  const [storedKey, setStoredKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const adaptersRef = useRef<AppAdapters | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    void readApiKey().then(setStoredKey);
  }, []);

  /** Enregistre la clé du rédacteur en ligne, après un contrôle de forme. */
  const saveKey = async () => {
    const value = keyInput.trim();
    if (!(await writeApiKey(value))) {
      Alert.alert('Clé non enregistrée', "L'appareil a refusé d'enregistrer la clé. Réessayez.");
      return;
    }
    setStoredKey(value);
    setKeyInput('');
    setEditingKey(false);
  };

  /** Nombre de photos à parcourir, borné, ou 0 si la saisie est vide. */
  const scanLimit = useMemo(() => {
    const parsed = Number.parseInt(scanLimitText.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_SCAN_LIMIT) : 0;
  }, [scanLimitText]);

  /**
   * Sélection des photos, recalculée quand les personnes ou la cible changent.
   * Elle n'est calculée qu'à partir de l'écran de revue : inutile d'occuper le
   * fil pendant que l'utilisateur nomme les visages.
   */
  const selection = useMemo(() => {
    if (step !== 'review' && step !== 'style' && step !== 'generating') return null;
    if (analyses.length === 0) return null;
    return selectBestPhotos(analyses, clusters, {
      selectedPeople: selected,
      targetCount,
      locale: LOCALE,
      selection: {
        // 1 laisse tout passer : le filtre se désactive, il ne s'assouplit pas.
        maxArtificiality: realPhotosOnly ? DEFAULT_MAX_ARTIFICIALITY : 1,
        eventQuotas: quotas,
      },
    });
  }, [analyses, clusters, quotas, realPhotosOnly, selected, step, targetCount]);

  /** Fixe la part d'un moment, ou rend la main à l'IA pour celui-ci. */
  const changeQuota = useCallback((bucketId: string, quota: number | undefined) => {
    setQuotas((current) => {
      const next = new Map(current);
      if (quota === undefined) next.delete(bucketId);
      else next.set(bucketId, quota);
      return next;
    });
  }, []);

  /** Images jugées non photographiques parmi tout ce qui a été parcouru. */
  const notPhotoCount = useMemo(
    () => analyses.filter((a) => (a.authenticity?.artificiality ?? 0) > DEFAULT_MAX_ARTIFICIALITY).length,
    [analyses],
  );

  /** Nombre de photos distinctes par personne, recalculé seulement si besoin. */
  const photoCountByCluster = useMemo(
    () => new Map(clusters.map((c) => [c.id, new Set(c.members.map((m) => m.photoId)).size])),
    [clusters],
  );

  const fail = (e: unknown) => {
    log('error', "Échec de l'assistant", e);
    Alert.alert('Erreur', (e as Error).message ?? String(e));
    setStep('intro');
  };

  const startScan = async () => {
    try {
      if (!(await ensureMediaPermission())) {
        Alert.alert('Accès aux photos requis', "L'assistant a besoin de lire vos photos (tout reste sur l'appareil).");
        return;
      }
      setStep('scanning');
      const abort = new AbortController();
      abortRef.current = abort;
      setProgress({ label: 'Préparation des modèles…', value: 0 });
      const adapters = await createAdapters({
        captionEngine: engine,
        onFaceModelDownload: (p) => setProgress({ label: p < 1 ? 'Téléchargement du modèle de reconnaissance des visages (14 Mo)…' : 'Modèle de reconnaissance prêt.', value: p }),
        // Le modèle n'entre en jeu qu'après l'ouverture de l'album : ses
        // rapports d'avancement vont au bandeau de la tâche de fond.
        onModelDownload: (p) => captionJob.reportDownload(p),
        onCaptionActivity: (a) => captionJob.reportActivity(a),
      });
      adaptersRef.current = adapters;
      const result = await scanPhotos(adapters, {
        limit: scanLimit,
        locale: LOCALE,
        signal: abort.signal,
        onProgress: (p) => setProgress({ label: `Analyse des photos… ${p.done}${p.total ? ` / ${p.total}` : ''}`, value: p.total ? p.done / p.total : 0 }),
      });
      if (abort.signal.aborted) return;
      const found = detectPeople(result, { threshold: adapters.embedder.clusterThreshold, minMembers: 2 });
      setAnalyses(result);
      setClusters(found);
      setSelected(new Set(found.slice(0, 4).map((c) => c.id)));
      setNames(new Map(found.map((c, i) => [c.id, `Personne ${i + 1}`])));
      setFaceThumbs(await buildFaceThumbnails(found, result));
      setStep('people');
    } catch (e) {
      fail(e);
    }
  };

  /** Prépare une petite vignette par personne : indispensable à la fluidité. */
  const buildFaceThumbnails = async (found: PersonCluster[], all: PhotoAnalysis[]): Promise<Map<string, string>> => {
    const byId = new Map(all.map((a) => [a.photo.id, a]));
    const thumbs = new Map<string, string>();
    for (let i = 0; i < found.length; i++) {
      const cluster = found[i]!;
      const analysis = byId.get(cluster.representative.photoId);
      const face = analysis?.faces[cluster.representative.faceIndex];
      if (analysis && face) {
        try {
          thumbs.set(cluster.id, await renderFaceThumbnail(analysis.photo, face.rect));
        } catch (e) {
          log('warn', `Vignette de visage impossible pour ${cluster.id}`, e);
        }
      }
      setProgress({ label: `Préparation des visages… ${i + 1} / ${found.length}`, value: (i + 1) / found.length });
    }
    return thumbs;
  };

  const toggleFace = useCallback(
    (id: string) => {
      if (mergeMode) {
        setMergePick((picked) => {
          const next = new Set(picked);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        return;
      }
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [mergeMode],
  );

  const renameFace = useCallback((id: string, value: string) => {
    setNames((current) => new Map(current).set(id, value));
  }, []);

  const cancelMerge = useCallback(() => {
    setMergeMode(false);
    setMergePick(new Set());
  }, []);

  /** Réunit les visages choisis en une seule personne. */
  const applyMerge = useCallback(() => {
    const ids = [...mergePick];
    if (ids.length < 2) return;
    const next = mergeClusters(clusters, ids);
    const survivor = next.find((c) => mergePick.has(c.id));
    setClusters(next);
    if (survivor) {
      // On conserve le prénom saisi par l'utilisateur s'il y en a un.
      const given = ids.map((id) => names.get(id) ?? '').find((n) => n.trim() && !DEFAULT_NAME.test(n.trim()));
      setNames((current) => {
        const copy = new Map(current);
        if (given) copy.set(survivor.id, given);
        for (const id of ids) if (id !== survivor.id) copy.delete(id);
        return copy;
      });
      setSelected((current) => {
        const copy = new Set(current);
        const wasSelected = ids.some((id) => current.has(id));
        for (const id of ids) copy.delete(id);
        if (wasSelected) copy.add(survivor.id);
        return copy;
      });
    }
    cancelMerge();
  }, [cancelMerge, clusters, mergePick, names]);

  /**
   * Confie l'écriture des légendes au modèle, en tâche de fond, l'album étant
   * déjà sur disque. La galerie et l'album n'emploient pas les mêmes
   * identifiants de photo : la correspondance passe par `sourceUri`, que
   * l'assemblage reporte sur chaque photo copiée.
   */
  const startCaptionJob = (
    album: Album,
    chosen: SelectedPhoto[],
    events: PhotoEvent[],
    byPhoto: Map<string, string[]>,
    seedCaptions: Map<string, string>,
    params: Pick<CaptionParams, 'style' | 'locale' | 'albumTitle' | 'personNames' | 'selectedPeople'>,
  ) => {
    const adapters = adaptersRef.current;
    if (!adapters || engine === 'template') return;
    const albumPhotoIdBySource = new Map<string, string>();
    const seed = new Map<string, string>();
    const idByUri = new Map(album.photos.filter((p) => p.sourceUri).map((p) => [p.sourceUri!, p.id]));
    for (const sel of chosen) {
      const source = sel.analysis.photo;
      const albumPhotoId = idByUri.get(source.uri);
      if (!albumPhotoId) continue;
      albumPhotoIdBySource.set(source.id, albumPhotoId);
      const provisional = seedCaptions.get(source.id);
      if (provisional) seed.set(albumPhotoId, provisional);
    }
    captionJob.start({
      albumId: album.id,
      albumTitle: album.title,
      generator: adapters.captions,
      events,
      byPhoto,
      params: { ...params, timeoutMs: CAPTION_TIMEOUT_MS[engine] },
      albumPhotoIdBySource,
      seed,
    });
  };

  const generate = async () => {
    const adapters = adaptersRef.current;
    if (!adapters) return;
    try {
      setStep('generating');
      const abort = new AbortController();
      abortRef.current = abort;
      setProgress({ label: 'Sélection des meilleures photos…', value: 0.05 });
      // La sélection est celle que l'utilisateur vient d'examiner.
      const { selected: chosen, events, byPhoto } = selection ?? { selected: [], events: [], byPhoto: new Map<string, string[]>() };
      if (chosen.length === 0) {
        Alert.alert('Aucune photo retenue', "Essayez avec d'autres personnes ou un parcours plus large.");
        setStep('style');
        return;
      }
      // Légendes de gabarit d'abord : instantanées, elles réservent les zones de
      // texte dans les gabarits de page et donnent un album complet tout de
      // suite. Un modèle, lui, demanderait plusieurs minutes avant la première
      // page — le sien les remplacera une par une, album déjà ouvert.
      const captionParams = {
        style,
        locale: LOCALE,
        albumTitle: title,
        personNames: names,
        selectedPeople: selected,
      };
      setProgress({ label: 'Légendes provisoires…', value: 0.1 });
      const captions = await generateCaptions(new TemplateCaptionGenerator(), events, byPhoto, {
        ...captionParams,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      const album = await assembleAlbum(adapters.importer, {
        title,
        subtitle: subtitle || undefined,
        locale: LOCALE,
        style,
        captionModel: adapters.captions.name,
        selectedPeople: selected,
        personNames: names,
        clusters,
        byPhoto,
        events,
        captions,
        generator: APP_GENERATOR,
        onProgress: (p) => setProgress({ label: `Copie des photos… ${p.done} / ${p.total}`, value: 0.15 + (0.85 * p.done) / Math.max(1, p.total) }),
      });
      await saveAlbum(album);
      // Le modèle prend le relais en tâche de fond, album déjà à l'écran.
      if (engine !== 'template') {
        startCaptionJob(album, chosen, events, byPhoto, captions, captionParams);
      }
      nav.replace({ name: 'editor', albumId: album.id });
    } catch (e) {
      fail(e);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    nav.back();
  };

  // La revue occupe tout l'écran : sa liste est virtualisée, elle ne peut pas
  // vivre dans le ScrollView des autres étapes.
  if (step === 'review') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header
          title="Photos retenues"
          left={<Button title="Retour" variant="ghost" onPress={() => setStep('people')} />}
        />
        <View style={styles.targetRow}>
          <Text style={styles.label}>Nombre de photos souhaité</Text>
          <View style={styles.chips}>
            {[12, 24, 36, 60].map((n) => (
              <Chip key={n} label={`${n}`} selected={targetCount === n} onPress={() => setTargetCount(n)} />
            ))}
          </View>
          <Toggle
            label="Seulement de vraies photos"
            hint={
              notPhotoCount > 0
                ? `${notPhotoCount} image${notPhotoCount > 1 ? 's' : ''} reconnue${notPhotoCount > 1 ? 's' : ''} comme capture d'écran, image enregistrée ou document.`
                : "Aucune capture d'écran ni image enregistrée repérée dans ce parcours."
            }
            value={realPhotosOnly}
            onChange={setRealPhotosOnly}
          />
        </View>
        <View style={{ flex: 1 }}>
          {selection ? (
            <SelectionReview
              selected={selection.selected}
              rejected={selection.rejected}
              events={selection.events}
              analysedCount={analyses.length}
              peopleByPhoto={selection.byPhoto}
              personNames={names}
              selectedPeople={selected}
              embedderName={adaptersRef.current?.embedder.name ?? 'inconnu'}
              eventBuckets={selection.eventBuckets}
              quotas={quotas}
              onQuotaChange={changeQuota}
              locale={LOCALE}
            />
          ) : null}
        </View>
        <View style={styles.footer}>
          <Button
            title={
              selection && selection.selected.length !== targetCount
                ? `Continuer avec ${selection.selected.length} photos`
                : 'Continuer vers les légendes'
            }
            onPress={() => setStep('style')}
            disabled={!selection || selection.selected.length === 0}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title="Assistant IA locale" left={<Button title="Annuler" variant="ghost" onPress={cancel} />} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 'intro' && (
          <>
            <Text style={styles.lead}>Tout se passe sur votre appareil : détection des visages, choix des photos et légendes. Aucune donnée n'est envoyée sur Internet.</Text>
            <Text style={styles.label}>Titre de l'album</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} />
            <Text style={styles.label}>Photos à parcourir (les plus récentes)</Text>
            <View style={styles.chips}>
              {SCAN_LIMIT_PRESETS.map((n) => (
                <Chip key={n} label={`${n}`} selected={scanLimit === n} onPress={() => setScanLimitText(String(n))} />
              ))}
            </View>
            <View style={styles.countRow}>
              <TextInput
                value={scanLimitText}
                onChangeText={(text) => setScanLimitText(text.replace(/[^0-9]/g, '').slice(0, 5))}
                keyboardType="number-pad"
                style={[styles.input, styles.countInput]}
                placeholder={String(DEFAULT_SCAN_LIMIT)}
                placeholderTextColor={colors.muted}
                selectTextOnFocus
                maxLength={5}
              />
              <Text style={styles.countHint}>
                {scanLimit > 0
                  ? `photos, de la plus récente à la plus ancienne (max ${MAX_SCAN_LIMIT}).`
                  : 'Saisissez un nombre de photos à analyser.'}
              </Text>
            </View>
            <Text style={styles.label}>Moteur de légendes</Text>
            <View style={styles.chips}>
              {ENGINES.map((e) => (
                <Chip key={e} label={ENGINE_LABELS[e]} selected={engine === e} onPress={() => setEngine(e)} />
              ))}
            </View>
            <Text style={styles.hint}>{ENGINE_HINTS[engine]}</Text>
            {engine === 'cloud' ? (
              <>
                <Text style={styles.label}>Clé d'API Anthropic</Text>
                {storedKey && !editingKey ? (
                  <View style={styles.countRow}>
                    <Text style={styles.countHint}>Clé enregistrée ({maskApiKey(storedKey)}), conservée sur cet appareil.</Text>
                    <Button
                      title="Changer"
                      variant="ghost"
                      onPress={() => {
                        setEditingKey(true);
                        setKeyInput('');
                      }}
                    />
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={keyInput}
                      onChangeText={setKeyInput}
                      style={styles.input}
                      placeholder="sk-ant-…"
                      placeholderTextColor={colors.muted}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Button
                      title="Enregistrer la clé"
                      variant="secondary"
                      onPress={() => void saveKey()}
                      disabled={!looksLikeApiKey(keyInput)}
                    />
                    <Text style={styles.hint}>À créer sur console.anthropic.com. Elle ne quitte pas l'appareil.</Text>
                  </>
                )}
              </>
            ) : null}
            <Button
              title="Parcourir mes photos"
              onPress={() => void startScan()}
              disabled={scanLimit <= 0 || (engine === 'cloud' && !storedKey)}
            />
          </>
        )}

        {(step === 'scanning' || step === 'generating') && (
          <View style={{ gap: spacing.lg, paddingTop: spacing.xl }}>
            <ProgressBar value={progress.value} label={progress.label} />
            <Text style={styles.hint}>
              {step === 'scanning'
                ? 'Visages, netteté et contenu sont analysés localement. Vous pouvez laisser l\'écran ouvert.'
                : engine !== 'template'
                  ? 'Les photos sont copiées dans l\'album, avec des légendes provisoires. L\'album s\'ouvre dès que c\'est fait ; le modèle écrit ensuite les légendes définitives en arrière-plan.'
                  : 'Composition de l\'album…'}
            </Text>
          </View>
        )}

        {step === 'people' && (
          <>
            <Text style={styles.lead}>
              {clusters.length === 0
                ? "Aucune personne récurrente n'a été détectée. L'album sera composé des meilleures photos."
                : mergeMode
                  ? 'Touchez deux visages (ou plus) qui sont la même personne, puis validez la fusion.'
                  : 'Qui doit figurer dans l\'album ? Touchez un visage pour le sélectionner et donnez-lui un prénom (utile pour les légendes).'}
            </Text>
            <View style={styles.people}>
              {clusters.map((c) => (
                <PersonCard
                  key={c.id}
                  id={c.id}
                  {...(faceThumbs.get(c.id) ? { uri: faceThumbs.get(c.id) } : {})}
                  count={photoCountByCluster.get(c.id) ?? 0}
                  name={names.get(c.id) ?? ''}
                  selected={mergeMode ? mergePick.has(c.id) : selected.has(c.id)}
                  mergeMode={mergeMode}
                  onToggle={toggleFace}
                  onNameChange={renameFace}
                />
              ))}
            </View>
            {clusters.length > 1 ? (
              mergeMode ? (
                <>
                  <Button title={`Fusionner (${mergePick.size})`} onPress={applyMerge} disabled={mergePick.size < 2} />
                  <Button title="Annuler la fusion" variant="ghost" onPress={cancelMerge} />
                </>
              ) : (
                <Button title="Un même visage en double ? Fusionner" variant="secondary" onPress={() => setMergeMode(true)} />
              )
            ) : null}
            <Text style={styles.hint}>
              {analyses.length} photos analysées · {analyses.filter((a) => a.faces.length > 0).length} avec des visages
            </Text>
            {!mergeMode ? <Button title="Voir la sélection de photos" onPress={() => setStep('review')} /> : null}
          </>
        )}

        {step === 'style' && (
          <>
            <Text style={styles.label}>Style des légendes</Text>
            <View style={styles.chips}>
              {CAPTION_STYLES.map((s) => (
                <Chip key={s} label={STYLE_LABELS[s]} selected={style === s} onPress={() => setStyle(s)} />
              ))}
            </View>
            <Text style={styles.label}>Sous-titre (optionnel)</Text>
            <TextInput value={subtitle} onChangeText={setSubtitle} style={styles.input} placeholder="Août 2026" placeholderTextColor={colors.muted} />
            <Text style={styles.hint}>
              {selection ? `${selection.selected.length} photos retenues sur ${analyses.length} analysées.` : ''}
            </Text>
            <Button title="Générer l'album" onPress={() => void generate()} />
            <Button title="Revenir à la sélection" variant="ghost" onPress={() => setStep('review')} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  lead: { fontSize: 15, color: colors.text, lineHeight: 22 },
  label: { fontSize: 13, color: colors.muted, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, fontSize: 16, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  countInput: { width: 96, textAlign: 'center' },
  countHint: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
  hint: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
  targetRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  footer: { padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
