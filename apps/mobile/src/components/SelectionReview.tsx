import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  UNDATED_BUCKET,
  criterionLabel,
  explainScore,
  formatEventTitle,
  rejectionDetail,
  rejectionLabel,
  type PhotoEvent,
  type RejectedPhoto,
  type SelectedPhoto,
  type TimeBucket,
} from '@albumphoto/core';
import { SourcePhotoThumb } from './SourcePhotoThumb';
import { Button, Chip, Stepper } from './ui';
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
  /** Moments candidats, y compris ceux dont aucune photo n'a été retenue. */
  eventBuckets: TimeBucket[];
  /** Nombre de photos imposé par l'utilisateur, par moment. */
  quotas: ReadonlyMap<string, number>;
  /** `undefined` rend la main à l'IA pour ce moment. */
  onQuotaChange: (bucketId: string, quota: number | undefined) => void;
  /** Photos imposées à la main. */
  keep: ReadonlySet<string>;
  /** Photos retirées à la main. */
  drop: ReadonlySet<string>;
  onDecide: (photoId: string, decision: PhotoDecision) => void;
  locale?: string;
}

type Tab = 'selected' | 'rejected' | 'moments';

/** Sort réservé à une photo : imposée, refusée, ou laissé à l'IA. */
export type PhotoDecision = 'keep' | 'drop' | 'auto';

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
  eventBuckets,
  quotas,
  onQuotaChange,
  keep,
  drop,
  onDecide,
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

  /** Photos retenues par moment : ce que l'IA a décidé, et qu'on peut reprendre. */
  const keptByBucket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) if (event.bucketId) counts.set(event.bucketId, event.photos.length);
    return counts;
  }, [events]);

  const withFaces = useMemo(
    () => [...selected, ...rejected].filter((p) => p.analysis.faces.length > 0).length,
    [selected, rejected],
  );

  const decisionOf = useMemo(
    () =>
      (photoId: string): PhotoDecision => (keep.has(photoId) ? 'keep' : drop.has(photoId) ? 'drop' : 'auto'),
    [drop, keep],
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
        composition (15 %). L'expression vient du détecteur de visages — sourires et yeux ouverts ; la technique et la
        composition sont mesurées sans modèle, sur la netteté, l'exposition et la place des visages dans le cadre. Sont
        ensuite écartés ce qui n'est pas une vraie photo, le flou, les quasi-doublons et les excès d'un même moment.
      </Text>

      {keep.size + drop.size > 0 ? (
        <Text style={styles.paragraph}>
          Vos choix : {keep.size} photo{keep.size > 1 ? 's' : ''} imposée{keep.size > 1 ? 's' : ''}, {drop.size}{' '}
          retirée{drop.size > 1 ? 's' : ''}. Ils passent avant la note, et avant la part accordée à leur moment.
        </Text>
      ) : null}

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
        <Chip label={`Moments (${eventBuckets.length})`} selected={tab === 'moments'} onPress={() => setTab('moments')} />
      </View>
    </View>
  );

  if (tab === 'moments') {
    return (
      <FlatList
        data={eventBuckets}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        initialNumToRender={10}
        windowSize={5}
        removeClippedSubviews
        ListEmptyComponent={<Text style={styles.empty}>Aucun moment : les photos parcourues n'ont pas de date.</Text>}
        renderItem={({ item }) => (
          <MomentRow
            bucket={item}
            kept={keptByBucket.get(item.id) ?? 0}
            quota={quotas.get(item.id)}
            onQuotaChange={onQuotaChange}
            locale={locale}
          />
        )}
      />
    );
  }

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
            decision={decisionOf(item.analysis.photo.id)}
            onDecide={onDecide}
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
      renderItem={({ item }) => (
        <RejectedRow
          item={item}
          names={namesOn(item.analysis.photo.id)}
          decision={decisionOf(item.analysis.photo.id)}
          onDecide={onDecide}
          locale={locale}
        />
      )}
    />
  );
}

/**
 * Un moment de l'album et la part qu'on lui accorde. Le compteur part de ce
 * que l'IA a retenu : l'utilisateur corrige une proposition, il ne la refait
 * pas. Le nombre demandé reste un plafond — les quasi-doublons et les photos
 * trop floues sont écartés même quand on en réclame davantage.
 */
const MomentRow = React.memo(function MomentRow({
  bucket,
  kept,
  quota,
  onQuotaChange,
  locale,
}: {
  bucket: TimeBucket;
  kept: number;
  quota: number | undefined;
  onQuotaChange: (bucketId: string, quota: number | undefined) => void;
  locale: string;
}) {
  const available = bucket.photoIds.length;
  const title =
    bucket.id === UNDATED_BUCKET
      ? locale.startsWith('fr')
        ? 'Photos sans date'
        : 'Undated photos'
      : formatEventTitle({ title: '', photos: [], ...(bucket.start ? { start: bucket.start } : {}), ...(bucket.end ? { end: bucket.end } : {}) }, locale);
  const short = bucket.start && bucket.end && bucket.start !== bucket.end ? timeSpan(bucket.start, bucket.end, locale) : '';
  const unmet = quota !== undefined && kept < quota;
  return (
    <View style={styles.card}>
      <View style={styles.momentRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.momentTitle}>{title}</Text>
          {short ? <Text style={styles.meta}>{short}</Text> : null}
          <Text style={styles.meta}>
            {available} photo{available > 1 ? 's' : ''} disponible{available > 1 ? 's' : ''} · {kept} retenue{kept > 1 ? 's' : ''}
          </Text>
        </View>
        <Stepper
          {...(quota === undefined ? {} : { value: quota })}
          fallback={kept}
          max={available}
          onChange={(next) => onQuotaChange(bucket.id, next)}
        />
      </View>
      {unmet ? (
        <Text style={styles.momentWarning}>
          {kept} sur {quota} demandées : les autres sont trop floues, quasi identiques, ou pas de vraies photos.
        </Text>
      ) : null}
    </View>
  );
});

/** Plage horaire d'un moment, pour le distinguer d'un autre le même jour. */
function timeSpan(start: string, end: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '';
  return `${fmt.format(from)} – ${fmt.format(to)}`;
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

/**
 * Barre de reprise en main. L'action proposée est toujours l'inverse de l'état
 * courant ; « Laisser l'IA décider » n'apparaît que lorsqu'il y a une décision
 * à défaire, pour ne pas encombrer le cas ordinaire.
 */
function DecisionBar({
  photoId,
  decision,
  onDecide,
  action,
  title,
}: {
  photoId: string;
  decision: PhotoDecision;
  onDecide: (photoId: string, decision: PhotoDecision) => void;
  action: PhotoDecision;
  title: string;
}) {
  return (
    <View style={styles.decisionBar}>
      <Button title={title} variant="secondary" onPress={() => onDecide(photoId, action)} style={styles.decisionButton} />
      {decision !== 'auto' ? (
        <Button
          title="Laisser l'IA décider"
          variant="ghost"
          onPress={() => onDecide(photoId, 'auto')}
          style={styles.decisionButton}
        />
      ) : null}
    </View>
  );
}

const SelectedRow = React.memo(function SelectedRow({
  item,
  rank,
  names,
  event,
  decision,
  onDecide,
  locale,
}: {
  item: SelectedPhoto;
  rank: number;
  names: string[];
  event: string;
  decision: PhotoDecision;
  onDecide: (photoId: string, decision: PhotoDecision) => void;
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
            {decision === 'keep' ? <Text style={styles.decisionTag}>imposée</Text> : null}
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

      <DecisionBar
        photoId={analysis.photo.id}
        decision={decision}
        onDecide={onDecide}
        action="drop"
        title="Retirer de l'album"
      />
    </View>
  );
});

const RejectedRow = React.memo(function RejectedRow({
  item,
  names,
  decision,
  onDecide,
  locale,
}: {
  item: RejectedPhoto;
  names: string[];
  decision: PhotoDecision;
  onDecide: (photoId: string, decision: PhotoDecision) => void;
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
      {analysis.authenticity?.reasons.length ? (
        <Text style={styles.reasonDetail}>{analysis.authenticity.reasons.join(' · ')}</Text>
      ) : null}
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

      <DecisionBar
        photoId={analysis.photo.id}
        decision={decision}
        onDecide={onDecide}
        action="keep"
        title="Ajouter à l'album"
      />
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
  momentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  momentTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  momentWarning: { fontSize: 12, color: '#a5563a', lineHeight: 17 },
  decisionBar: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  decisionButton: { flex: 1, paddingHorizontal: spacing.sm, minHeight: 38 },
  decisionTag: { fontSize: 11, color: colors.primary, fontWeight: '700' },
  mono: { fontFamily: 'monospace', fontSize: 10, color: colors.muted },
});
