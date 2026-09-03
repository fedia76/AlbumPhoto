import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCaptionJob } from '../hooks/useCaptionJob';
import { captionJob, type CaptionJobState } from '../services/captionJob';
import { colors, radius, spacing } from '../theme';

function headline(job: CaptionJobState): string {
  switch (job.status) {
    case 'running':
      return `Légendes en cours… ${job.done} / ${job.total}`;
    case 'done':
      return job.reason ? `Légendes terminées (gabarits)` : `Légendes terminées : ${job.written} / ${job.total}`;
    case 'cancelled':
      return `Écriture arrêtée à ${job.done} / ${job.total}`;
    default:
      return 'Écriture des légendes interrompue';
  }
}

function detail(job: CaptionJobState): string | undefined {
  if (job.status === 'running') {
    return job.detail ?? 'Vous pouvez feuilleter votre album pendant ce temps.';
  }
  if (job.reason) return `${job.reason} Les légendes restantes viennent des gabarits.`;
  if (job.status === 'done') return "Les pages sont à jour.";
  return undefined;
}

/**
 * Avancement de l'écriture des légendes en tâche de fond.
 *
 * Le bandeau n'apparaît que si une tâche existe, et — quand `albumId` est
 * fourni — qu'elle concerne bien cet album. Il reste après la fin pour dire
 * comment cela s'est terminé, jusqu'à ce que l'utilisateur le referme.
 */
export function CaptionProgress({ albumId, onOpen }: { albumId?: string; onOpen?: (albumId: string) => void }) {
  const job = useCaptionJob(albumId);
  if (!job) return null;
  const running = job.status === 'running';
  const ratio = job.total > 0 ? job.done / job.total : 0;
  const text = detail(job);
  return (
    <View style={[styles.banner, !running && job.status !== 'done' && styles.bannerWarn]}>
      <View style={styles.row}>
        <Pressable
          style={styles.texts}
          disabled={!onOpen}
          onPress={() => onOpen?.(job.albumId)}
          accessibilityRole={onOpen ? 'button' : 'text'}
        >
          <Text style={styles.title}>{headline(job)}</Text>
          <Text style={styles.detail} numberOfLines={2}>
            {onOpen ? `« ${job.albumTitle} » · ${text ?? ''}`.trim() : text ?? ''}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => (running ? captionJob.cancel() : captionJob.dismiss())}
          hitSlop={8}
          style={styles.action}
        >
          <Text style={styles.actionText}>{running ? 'Arrêter' : 'Masquer'}</Text>
        </Pressable>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  bannerWarn: { backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  texts: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 12 },
  action: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.background },
  actionText: { color: colors.text, fontSize: 13 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: colors.primary },
});
