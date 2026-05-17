import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { getJobById } from '../../../src/data/local/jobRepository';
import { getNotesByJobId } from '../../../src/data/local/noteRepository';
import { getMaterialsByJobId } from '../../../src/data/local/materialRepository';
import { getTimeEntriesByJobId } from '../../../src/data/local/timeEntryRepository';
import { getExtractionResultsByJobId } from '../../../src/data/local/extractionRepository';
import { getPhotosByJobId } from '../../../src/data/local/photoRepository';
import { formatDate } from '../../../src/utils/formatting';
import type { Job, JobNote, MaterialLineItem, TimeEntry, AiExtractionResult, PhotoAsset } from '../../../src/domain/types';
import { Colors, Spacing, Typography, BorderRadius } from '../../../src/theme/colors';

export default function ReportPreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();

  const [job, setJob] = useState<Job | null>(null);
  const [notes, setNotes] = useState<JobNote[]>([]);
  const [photos, setPhotos] = useState<PhotoAsset[]>([]);
  const [materials, setMaterials] = useState<MaterialLineItem[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [extractions, setExtractions] = useState<AiExtractionResult[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [j, n, p, m, t, e] = await Promise.all([
        getJobById(db, id),
        getNotesByJobId(db, id),
        getPhotosByJobId(db, id),
        getMaterialsByJobId(db, id),
        getTimeEntriesByJobId(db, id),
        getExtractionResultsByJobId(db, id),
      ]);
      setJob(j);
      setNotes(n);
      setPhotos(p);
      setMaterials(m);
      setTimeEntries(t);
      setExtractions(e);
    } catch (error) {
      console.error('Failed to load report data:', error);
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  if (loading) {
    return <View style={styles.centerContainer}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  if (!job) {
    return <View style={styles.centerContainer}><Text style={styles.emptyText}>Job not found</Text></View>;
  }

  const totalMinutes = timeEntries.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);
  const totalCost = materials.reduce((sum, m) => sum + (m.totalCost ?? 0), 0);

  // Get accepted extraction data
  const acceptedExtractions = extractions.filter((e) => e.acceptedAt);
  let extractedFollowUps: string[] = [];
  let extractedWorkPerformed: string[] = [];

  for (const ext of acceptedExtractions) {
    try {
      const parsed = JSON.parse(ext.extractedJson);
      if (parsed.followUpNotes) extractedFollowUps = [...extractedFollowUps, ...parsed.followUpNotes];
      if (parsed.workPerformed) extractedWorkPerformed = [...extractedWorkPerformed, ...parsed.workPerformed];
    } catch { /* skip malformed */ }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.reportHeader}>
        <Text style={styles.reportTitle}>JobTrail Report</Text>
        <Text style={styles.reportSubtitle}>{job.title}</Text>
        {job.jobType && <Text style={styles.reportMeta}>Type: {job.jobType}</Text>}
        <Text style={styles.reportMeta}>Status: {job.status.replace('_', ' ')}</Text>
        <Text style={styles.reportMeta}>Date: {formatDate(job.createdAt, 'long')}</Text>
      </View>

      <View style={styles.divider} />

      {/* Work Performed */}
      {(extractedWorkPerformed.length > 0 || notes.length > 0) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Work Performed</Text>
          {extractedWorkPerformed.map((w, i) => (
            <Text key={i} style={styles.bulletItem}>• {w}</Text>
          ))}
          {notes.map((n) => (
            <Text key={n.id} style={styles.bulletItem}>• {n.content}</Text>
          ))}
        </View>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <View style={styles.photoGrid}>
            {photos.map((photo) => (
              <View key={photo.id} style={styles.photoItem}>
                <Image source={{ uri: photo.localUri }} style={styles.photoImage} />
                <Text style={styles.photoTypeLabel}>{photo.photoType}</Text>
                {photo.caption && <Text style={styles.photoCaption}>{photo.caption}</Text>}
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Materials */}
      {materials.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Materials Used</Text>
          {materials.map((m) => (
            <View key={m.id} style={styles.materialRow}>
              <Text style={styles.bulletItem}>{m.quantity} {m.unit ?? ''} {m.name}</Text>
              {m.totalCost !== null && m.totalCost > 0 && (
                <Text style={styles.costText}>${m.totalCost.toFixed(2)}</Text>
              )}
            </View>
          ))}
          {totalCost > 0 && (
            <Text style={styles.totalCost}>Total: ${totalCost.toFixed(2)}</Text>
          )}
        </View>
      )}

      {/* Labor Time */}
      {totalMinutes > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Labor Time</Text>
          <Text style={styles.bulletItem}>
            Total: {totalMinutes} minutes ({Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m)
          </Text>
          {timeEntries.map((t) => (
            <Text key={t.id} style={styles.subBulletItem}>
              • {t.durationMinutes} min{t.description ? ` — ${t.description}` : ''}
            </Text>
          ))}
        </View>
      )}

      {/* Follow-up Notes */}
      {extractedFollowUps.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Follow-up</Text>
          {extractedFollowUps.map((f, i) => (
            <Text key={i} style={styles.bulletItem}>• {f}</Text>
          ))}
        </View>
      )}

      {/* Internal Notes */}
      {job.internalNotes && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.bulletItem}>{job.internalNotes}</Text>
        </View>
      )}

      {/* Rough Notes */}
      {job.roughNotes && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Original Notes</Text>
          <Text style={styles.roughNotes}>{job.roughNotes}</Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.reportFooter}>
        <Text style={styles.footerText}>Generated by JobTrail</Text>
        <Text style={styles.footerText}>{formatDate(new Date().toISOString(), 'long')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: 40 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  emptyText: { fontSize: Typography.fontSize.lg, color: Colors.textSecondary },
  reportHeader: { marginBottom: Spacing.lg },
  reportTitle: { fontSize: Typography.fontSize.xxl, fontWeight: Typography.fontWeight.bold as any, color: Colors.primary, marginBottom: Spacing.xs },
  reportSubtitle: { fontSize: Typography.fontSize.xl, fontWeight: Typography.fontWeight.semibold as any, color: Colors.text, marginBottom: Spacing.sm },
  reportMeta: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, marginBottom: 2 },
  divider: { height: 1, backgroundColor: Colors.border, marginBottom: Spacing.lg },
  section: { marginBottom: Spacing.xl },
  sectionTitle: { fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.semibold as any, color: Colors.text, marginBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: Spacing.xs },
  bulletItem: { fontSize: Typography.fontSize.md, color: Colors.text, lineHeight: 24, marginBottom: 2 },
  subBulletItem: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginLeft: Spacing.md },
  materialRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  costText: { fontSize: Typography.fontSize.md, color: Colors.textSecondary },
  totalCost: { fontSize: Typography.fontSize.md, fontWeight: Typography.fontWeight.semibold as any, color: Colors.text, marginTop: Spacing.sm },
  roughNotes: { fontSize: Typography.fontSize.sm, color: Colors.textTertiary, fontStyle: 'italic' as any, lineHeight: 20 },
  reportFooter: { marginTop: Spacing.xxl, paddingTop: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border, alignItems: 'center' },
  footerText: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photoItem: { width: '48%', marginBottom: Spacing.sm },
  photoImage: { width: '100%', height: 120, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary },
  photoTypeLabel: { fontSize: Typography.fontSize.xs, color: Colors.primary, fontWeight: '500' as any, marginTop: 2, textTransform: 'uppercase' as any },
  photoCaption: { fontSize: Typography.fontSize.xs, color: Colors.textSecondary, marginTop: 1 },
});