import React, { useMemo, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '../navigation';
import { clearLog, readLog, readLogTail } from '../diagnostics/log';
import { environmentSummary, runProbes } from '../diagnostics/probe';
import { Button, Header } from '../components/ui';
import { colors, radius, spacing } from '../theme';

/** Écran « Diagnostic » : état des modules natifs et journal partageable. */
export function DiagnosticsScreen() {
  const nav = useNavigation();
  const [refreshKey, setRefreshKey] = useState(0);
  const probes = useMemo(() => runProbes(), [refreshKey]);
  const environment = useMemo(() => environmentSummary(), []);
  const logView = useMemo(() => readLogTail(), [refreshKey]);

  /** Le rapport partagé contient le journal entier, pas seulement l'extrait. */
  const report = [
    'AlbumPhoto — rapport de diagnostic',
    '',
    environment,
    '',
    ...probes.map((p) => `${p.ok ? 'OK  ' : 'ÉCHEC'} ${p.name} — ${p.detail}`),
    '',
    '--- Journal ---',
    readLog() || '(vide)',
  ].join('\n');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title="Diagnostic" left={<Button title="Retour" variant="ghost" onPress={nav.back} />} />

      <View style={styles.actions}>
        <Button title="Partager" onPress={() => void Share.share({ message: report.slice(0, 60000) })} style={styles.action} />
        <Button title="Actualiser" variant="secondary" onPress={() => setRefreshKey((k) => k + 1)} style={styles.action} />
        <Button
          title="Vider"
          variant="danger"
          onPress={() => {
            clearLog();
            setRefreshKey((k) => k + 1);
          }}
          style={styles.action}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>
          Cet écran remplace les journaux système, inaccessibles sans ordinateur. Partagez le rapport pour signaler un
          problème.
        </Text>

        <Text style={styles.section}>Environnement</Text>
        <View style={styles.card}>
          <Text style={styles.mono}>{environment}</Text>
        </View>

        <Text style={styles.section}>Modules natifs</Text>
        <View style={styles.card}>
          {probes.map((p) => (
            <View key={p.name} style={styles.row}>
              <Text style={[styles.badge, p.ok ? styles.badgeOk : p.required ? styles.badgeError : styles.badgeWarn]}>
                {p.ok ? '✓' : p.required ? '✕' : '!'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{p.role}</Text>
                <Text style={styles.rowDetail}>
                  {p.name} — {p.detail}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.section}>
          Journal {logView.totalChars > 0 ? `(${Math.round(logView.totalChars / 1024)} Ko)` : ''}
        </Text>
        <View style={styles.card}>
          {logView.truncated ? <Text style={styles.tailNote}>Fin du journal ; le partage contient le tout.</Text> : null}
          <Text selectable style={styles.mono}>
            {logView.text || '(vide)'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  action: { flex: 1, paddingHorizontal: spacing.sm },
  tailNote: { fontSize: 11, color: colors.muted, fontStyle: 'italic' },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  section: { fontSize: 13, color: colors.muted, marginTop: spacing.sm, textTransform: 'uppercase' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  badge: { width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, color: colors.primaryText, fontWeight: '700', overflow: 'hidden' },
  badgeOk: { backgroundColor: '#2e9e5b' },
  badgeWarn: { backgroundColor: colors.accent },
  badgeError: { backgroundColor: colors.danger },
  rowTitle: { fontSize: 15, color: colors.text, fontWeight: '600' },
  rowDetail: { fontSize: 12, color: colors.muted },
  mono: { fontFamily: 'monospace', fontSize: 11, color: colors.text },
});
