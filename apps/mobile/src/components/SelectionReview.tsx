import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  criterionLabel,
  explainScore,
  rejectionDetail,
  rejectionLabel,
  type PhotoEvent,
  type RejectedPhoto,
  type SelectedPhoto,
} from '@albumphoto/core';
import { SourcePhotoThumb } from './SourcePhotoThumb';
import { Chip } from './ui';
import { colors, radius, spacing } from '../theme';

export interface SelectionReviewProps {
  selected: SelectedPhoto[];
  rejected: RejectedPhoto[];
  events: PhotoEvent[];
  /** Nombre total de photos parcourues. */
  analysedCount: number;
  /** photoId → identifiants de personnes reconnues. */
  peopleByPhoto: Map<string, string[]>;
  /** Identifiant de personne → prénom. */
  personNames: Map<string, string>;
  /** Personnes retenues par l'utilisateur. */
  selectedPeople: Set<string>;
  /** Nom du modèle d'identification utilisé (diagnostic). */
  embedderName: string;
  locale?: string;
}

type Tab = 'selected' | 'rejected';

const pct = (v: number): string => `${Math.round(v * 100)}`;
const THUMB = 84;

/**
 * Revue détaillée de la sélection : ce que l'IA a retenu, ce qu'elle a écarté,
 * et pourquoi dans les deux cas. Volontairement bavarde : elle sert d'outil de
 * diagnostic pour régler la notation.
 */
export function SelectionReview({
  selected,
  rejected,
  events,
  analysedCount,
  peopleByPhoto,
  personNames,
  selectedPeople,
  embedderName,
  locale = 'fr-FR',
}: SelectionReviewProps) {
  const [tab, setTab] = useState<Tab>('selected');

  /** Prénoms des personnes choisies présentes sur une photo. */
  const namesOn = useMemo(
    () => (photoId: string) =>
      (peopleByPhoto.get(photoId) ?? [])
        .filter((id) => selectedPeople.has(id))
        .map((id) => personNames.get(id) ?? '')
        .filter(Boolean),
    [peopleByPhoto, personNames, selectedPeople],
  );

  /** Événement auquel appartient une photo retenue. */
  const eventOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) for (const p of event.photos) map.set(p.analysis.photo.id, event.title);
    return map;
  }, [events]);

  const withFaces = useMemo(
    () => [...selected, ...rejected].filter((p) => p.analysis.faces.length > 0).length,
    [selected, rejected],
  );

  const byReason = useMemo(() => {
    const counts = new Map<RejectedPhoto['reason'], number>();
    for (const r of rejected) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rejected]);

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.statRow}>
        <Stat value={String(analysedCount)} label="analysées" />
        <Stat value={String(selected.length)} label="retenues" accent />
        <Stat value={String(rejected.length)} label="écartées" />
        <Stat value={String(events.length)} label={events.length > 1 ? 'événements' : 'événement'} />
      </View>

      <Text style={styles.paragraph}>
        {withFaces} photo{withFaces > 1 ? 's' : ''} avec au moins un visage. Identification par «&nbsp;{embedderName}&nbsp;».
        Chaque photo reçoit une note sur 100 combinant technique (40 %), personnes (30 %), expression (15 %) et
        composition (15 %). Les photos floues, les quasi-doublons et les excès d'un même moment sont ensuite écartés.
      </Text>

      {byReason.length > 0 ? (
        <View style={styles.reasonSummary}>
          {byReason.map(([reason, count]) => (
            <Text key={reason} style={styles.reasonSummaryItem}>
              {rejectionLabel(reason, locale)} : {count}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.tabs}>
        <Chip label={`Retenues (${selected.length})`} selected={tab === 'selected'} onPress={() => setTab('selected')} />
        <Chip label={`Écartées (${rejected.length})`} selected={tab === 'rejected'} onPress={() => setTab('rejected')} />
      </View>
    </View>
  );

  if (tab === 'selected') {
    return (
      <FlatList
        data={selected}
        keyExtractor={(item) => item.analysis.photo.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        initialNumToRender={6}
        windowSize={5}
        removeClippedSubviews
        ListEmptyComponent={<Text style={styles.empty}>Aucune photo retenue avec ces réglages.</Text>}
        renderItem={({ item, index }) => (
          <SelectedRow
            item={item}
            rank={index + 1}
            names={namesOn(item.analysis.photo.id)}
            event={eventOf.get(item.analysis.photo.id) ?? ''}
            locale={locale}
          />
        )}
      />
    );
  }

  return (
    <FlatList
      data={rejected}
      keyExtractor={(item) => item.analysis.photo.id}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      initialNumToRender={6}
      windowSize={5}
      removeClippedSubviews
      ListEmptyComponent={<Text style={styles.empty}>Aucune photo écartée.</Text>}
      renderItem={({ item }) => <RejectedRow item={item} names={namesOn(item.analysis.photo.id)} locale={locale} />}
    />
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && { color: colors.primary }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return 'sans date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sans date';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d);
}

/** Barre d'un critère de notation, avec sa valeur chiffrée. */
function Criterion({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.criterion}>
      <Text style={styles.criterionLabel}>{label}</Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }]} />
      </View>
      <Text style={styles.criterionValue}>{pct(value)}</Text>
    </View>
  );
}

const SelectedRow = React.memo(function SelectedRow({
  item,
  rank,
  names,
  event,
  locale,
}: {
  item: SelectedPhoto;
  rank: number;
  names: string[];
  event: string;
  locale: string;
}) {
  const { analysis, score } = item;
  const { strengths, weaknesses } = explainScore(score, analysis.quality, names, locale);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <SourcePhotoThumb photo={analysis.photo} size={THUMB} />
        <View style={styles.cardHead}>
          <View style={styles.titleRow}>
            <Text style={styles.rank}>#{rank}</Text>
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreBadgeText}>{pct(score.score)}</Text>
            </View>
          </View>
          <Text style={styles.date}>{formatDate(analysis.photo.takenAt, locale)}</Text>
          {event ? <Text style={styles.event}>{event}</Text> : null}
          <Text style={styles.meta}>
            {analysis.faces.length} visage{analysis.faces.length > 1 ? 's' : ''}
            {names.length > 0 ? ` · ${names.join(', ')}` : ''}
          </Text>
          {analysis.labels.length > 0 ? <Text style={styles.meta}>Contenu : {analysis.labels.join(', ')}</Text> : null}
        </View>
      </View>

      <View style={styles.criteria}>
        <Criterion label={criterionLabel('technical', locale)} value={score.technical} />
        <Criterion label={criterionLabel('people', locale)} value={score.people} />
        <Criterion label={criterionLabel('expression', locale)} value={score.expression} />
        <Criterion label={criterionLabel('composition', locale)} value={score.composition} />
      </View>

      {strengths.length > 0 ? (
        <Text style={styles.strengths}>
          <Text style={styles.plus}>+ </Text>
          {strengths.join(' · ')}
        </Text>
      ) : null}
      {weaknesses.length > 0 ? (
        <Text style={styles.weaknesses}>
          <Text style={styles.minus}>− </Text>
          {weaknesses.join(' · ')}
        </Text>
      ) : null}

      <Text style={styles.mono}>
        netteté {pct(analysis.quality.sharpness)} · exposition {pct(analysis.quality.exposure)} · contraste{' '}
        {pct(analysis.quality.contrast)} · couleurs {pct(analysis.quality.colorfulness)} · luminance{' '}
        {Math.round(analysis.quality.meanLuma)} · laplacien {Math.round(analysis.quality.laplacianVariance)}
      </Text>
    </View>
  );
});

const RejectedRow = React.memo(function RejectedRow({
  item,
  names,
  locale,
}: {
  item: RejectedPhoto;
  names: string[];
  locale: string;
}) {
  const { analysis, score, reason } = item;
  const { weaknesses } = explainScore(score, analysis.quality, names, locale);
  return (
    <View style={[styles.card, styles.cardRejected]}>
      <View style={styles.cardTop}>
        <SourcePhotoThumb photo={analysis.photo} size={THUMB} />
        <View style={styles.cardHead}>
          <View style={styles.titleRow}>
            <View style={styles.reasonBadge}>
              <Text style={styles.reasonBadgeText}>{rejectionLabel(reason, locale)}</Text>
            </View>
            <Text style={styles.scoreMuted}>{pct(score.score)}/100</Text>
          </View>
          <Text style={styles.date}>{formatDate(analysis.photo.takenAt, locale)}</Text>
          <Text style={styles.meta}>
            {analysis.faces.length} visage{analysis.faces.length > 1 ? 's' : ''}
            {names.length > 0 ? ` · ${names.join(', ')}` : ''}
          </Text>
        </View>
      </View>
      <Text style={styles.reasonDetail}>{rejectionDetail(reason, locale)}</Text>
      {weaknesses.length > 0 ? (
        <Text style={styles.weaknesses}>
          <Text style={styles.minus}>− </Text>
          {weaknesses.join(' · ')}
        </Text>
      ) : null}
      <Text style={styles.mono}>
        note {pct(score.score)} · technique {pct(score.technical)} · personnes {pct(score.people)} · expression{' '}
        {pct(score.expression)} · composition {pct(score.composition)} · netteté {pct(analysis.quality.sharpness)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  headerBlock: { gap: spacing.md, marginBottom: spacing.xs },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  paragraph: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  reasonSummary: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  reasonSummaryItem: { fontSize: 12, color: colors.muted },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  empty: { color: colors.muted, textAlign: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardRejected: { opacity: 0.92 },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  cardHead: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { fontSize: 15, fontWeight: '700', color: colors.text },
  scoreBadge: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  scoreBadgeText: { color: colors.primaryText, fontWeight: '700', fontSize: 12 },
  scoreMuted: { color: colors.muted, fontSize: 12 },
  reasonBadge: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  reasonBadgeText: { color: '#3a2a00', fontWeight: '700', fontSize: 11 },
  date: { fontSize: 12, color: colors.text },
  event: { fontSize: 12, color: colors.primary },
  meta: { fontSize: 12, color: colors.muted },
  criteria: { gap: 4 },
  criterion: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  criterionLabel: { width: 84, fontSize: 11, color: colors.muted },
  criterionValue: { width: 26, textAlign: 'right', fontSize: 11, color: colors.muted, fontVariant: ['tabular-nums'] },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.primary },
  strengths: { fontSize: 12, color: '#1f7a45', lineHeight: 17 },
  weaknesses: { fontSize: 12, color: '#a5563a', lineHeight: 17 },
  plus: { fontWeight: '700' },
  minus: { fontWeight: '700' },
  reasonDetail: { fontSize: 12, color: colors.text, lineHeight: 17 },
  mono: { fontFamily: 'monospace', fontSize: 10, color: colors.muted },
});
