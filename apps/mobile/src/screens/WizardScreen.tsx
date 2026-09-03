import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CAPTION_STYLES,
  assembleAlbum,
  detectPeople,
  generateCaptions,
  scanPhotos,
  selectBestPhotos,
  type CaptionStyle,
  type PersonCluster,
  type PhotoAnalysis,
} from '@albumphoto/core';
import { APP_GENERATOR, DEFAULT_SCAN_LIMIT } from '../config';
import { useNavigation } from '../navigation';
import { createAdapters, ensureMediaPermission, type AppAdapters } from '../services';
import type { CaptionEngine } from '../services/captioner';
import { saveAlbum } from '../storage/albumStore';
import { colors, radius, spacing } from '../theme';
import { Button, Chip, Header, ProgressBar } from '../components/ui';
import { PersonCard } from '../components/PersonCard';

type Step = 'intro' | 'scanning' | 'people' | 'style' | 'generating';

const STYLE_LABELS: Record<CaptionStyle, string> = {
  funny: 'Drôle',
  formal: 'Formel',
  poetic: 'Poétique',
  minimal: 'Minimaliste',
  family: 'Famille',
};

const LOCALE = 'fr-FR';

/** Assistant IA locale : parcours → personnes → style → génération. */
export function WizardScreen() {
  const nav = useNavigation();
  const [step, setStep] = useState<Step>('intro');
  const [title, setTitle] = useState('Mon album');
  const [subtitle, setSubtitle] = useState('');
  const [scanLimit, setScanLimit] = useState(DEFAULT_SCAN_LIMIT);
  const [engine, setEngine] = useState<CaptionEngine>('template');
  const [style, setStyle] = useState<CaptionStyle>('family');
  const [targetCount, setTargetCount] = useState(24);
  const [progress, setProgress] = useState<{ label: string; value: number }>({ label: '', value: 0 });
  const [analyses, setAnalyses] = useState<PhotoAnalysis[]>([]);
  const [clusters, setClusters] = useState<PersonCluster[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const adaptersRef = useRef<AppAdapters | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const fail = (e: unknown) => {
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
        locale: LOCALE,
        captionEngine: engine,
        onFaceModelDownload: (p) => setProgress({ label: p < 1 ? 'Téléchargement du modèle de reconnaissance des visages (14 Mo)…' : 'Modèle de reconnaissance prêt.', value: p }),
        onModelDownload: (p) => setProgress({ label: `Téléchargement du modèle de légendes… ${Math.round(p * 100)} %`, value: p }),
      });
      adaptersRef.current = adapters;
      const result = await scanPhotos(adapters, {
        limit: scanLimit,
        signal: abort.signal,
        onProgress: (p) => setProgress({ label: `Analyse des photos… ${p.done}${p.total ? ` / ${p.total}` : ''}`, value: p.total ? p.done / p.total : 0 }),
      });
      if (abort.signal.aborted) return;
      const found = detectPeople(result, { threshold: adapters.embedder.clusterThreshold, minMembers: 2 });
      setAnalyses(result);
      setClusters(found);
      setSelected(new Set(found.slice(0, 4).map((c) => c.id)));
      setNames(new Map(found.map((c, i) => [c.id, `Personne ${i + 1}`])));
      setStep('people');
    } catch (e) {
      fail(e);
    }
  };

  const generate = async () => {
    const adapters = adaptersRef.current;
    if (!adapters) return;
    try {
      setStep('generating');
      const abort = new AbortController();
      abortRef.current = abort;
      setProgress({ label: 'Sélection des meilleures photos…', value: 0.05 });
      const { selected: chosen, events, byPhoto } = selectBestPhotos(analyses, clusters, { selectedPeople: selected, targetCount, locale: LOCALE });
      if (chosen.length === 0) {
        Alert.alert('Aucune photo retenue', "Essayez avec d'autres personnes ou un parcours plus large.");
        setStep('style');
        return;
      }
      const captions = await generateCaptions(adapters.captions, events, byPhoto, {
        style,
        locale: LOCALE,
        albumTitle: title,
        personNames: names,
        selectedPeople: selected,
        signal: abort.signal,
        onProgress: (p) => setProgress({ label: `Rédaction des légendes… ${p.done} / ${p.total}`, value: 0.1 + (0.5 * p.done) / Math.max(1, p.total) }),
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
        onProgress: (p) => setProgress({ label: `Copie des photos… ${p.done} / ${p.total}`, value: 0.6 + (0.4 * p.done) / Math.max(1, p.total) }),
      });
      await saveAlbum(album);
      nav.replace({ name: 'editor', albumId: album.id });
    } catch (e) {
      fail(e);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    nav.back();
  };

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
              {[200, 600, 1500].map((n) => (
                <Chip key={n} label={`${n}`} selected={scanLimit === n} onPress={() => setScanLimit(n)} />
              ))}
            </View>
            <Text style={styles.label}>Moteur de légendes</Text>
            <View style={styles.chips}>
              <Chip label="Gabarits (instantané)" selected={engine === 'template'} onPress={() => setEngine('template')} />
              <Chip label="LLM local (téléchargement ~600 Mo)" selected={engine === 'llm'} onPress={() => setEngine('llm')} />
            </View>
            <Button title="Parcourir mes photos" onPress={() => void startScan()} />
          </>
        )}

        {(step === 'scanning' || step === 'generating') && (
          <View style={{ gap: spacing.lg, paddingTop: spacing.xl }}>
            <ProgressBar value={progress.value} label={progress.label} />
            <Text style={styles.hint}>{step === 'scanning' ? 'Visages, netteté et contenu sont analysés localement. Vous pouvez laisser l\'écran ouvert.' : 'Composition de l\'album…'}</Text>
          </View>
        )}

        {step === 'people' && (
          <>
            <Text style={styles.lead}>
              {clusters.length === 0
                ? "Aucune personne récurrente n'a été détectée. L'album sera composé des meilleures photos."
                : 'Qui doit figurer dans l\'album ? Touchez un visage pour le sélectionner et donnez-lui un prénom (utile pour les légendes).'}
            </Text>
            <View style={styles.people}>
              {clusters.map((c) => {
                const a = analyses.find((x) => x.photo.id === c.representative.photoId);
                const face = a?.faces[c.representative.faceIndex];
                if (!a || !face) return null;
                return (
                  <PersonCard
                    key={c.id}
                    uri={a.photo.uri}
                    faceRect={face.rect}
                    photoWidth={a.photo.width}
                    photoHeight={a.photo.height}
                    count={new Set(c.members.map((m) => m.photoId)).size}
                    name={names.get(c.id) ?? ''}
                    selected={selected.has(c.id)}
                    onToggle={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    onNameChange={(n) => setNames((m) => new Map(m).set(c.id, n))}
                  />
                );
              })}
            </View>
            <Text style={styles.hint}>
              {analyses.length} photos analysées · {analyses.filter((a) => a.faces.length > 0).length} avec des visages
            </Text>
            <Button title="Continuer" onPress={() => setStep('style')} />
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
            <Text style={styles.label}>Nombre de photos souhaité</Text>
            <View style={styles.chips}>
              {[12, 24, 36, 60].map((n) => (
                <Chip key={n} label={`${n}`} selected={targetCount === n} onPress={() => setTargetCount(n)} />
              ))}
            </View>
            <Text style={styles.label}>Sous-titre (optionnel)</Text>
            <TextInput value={subtitle} onChangeText={setSubtitle} style={styles.input} placeholder="Août 2026" placeholderTextColor={colors.muted} />
            <Button title="Générer l'album" onPress={() => void generate()} />
            <Button title="Revenir aux personnes" variant="ghost" onPress={() => setStep('people')} />
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
  hint: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
});
