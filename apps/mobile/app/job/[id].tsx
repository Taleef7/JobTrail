import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useDatabase } from '../../src/data/local/DatabaseProvider';
import { getJobById, updateJob } from '../../src/data/local/jobRepository';
import { getNotesByJobId } from '../../src/data/local/noteRepository';
import { getMaterialsByJobId } from '../../src/data/local/materialRepository';
import { getTimeEntriesByJobId } from '../../src/data/local/timeEntryRepository';
import { getExtractionResultsByJobId } from '../../src/data/local/extractionRepository';
import { getPhotosByJobId } from '../../src/data/local/photoRepository';
import { statusColor, formatDate } from '../../src/utils/formatting';
import type { Job, JobNote, MaterialLineItem, TimeEntry, AiExtractionResult, PhotoAsset } from '../../src/domain/types';
import { Colors, Spacing, Typography, BorderRadius } from '../../src/theme/colors';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();

  const [job, setJob] = useState<Job | null>(null);
  const [notes, setNotes] = useState<JobNote[]>([]);
  const [materials, setMaterials] = useState<MaterialLineItem[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [extractions, setExtractions] = useState<AiExtractionResult[]>([]);
  const [photos, setPhotos] = useState<PhotoAsset[]>([]);
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
      console.error('Failed to load job:', error);
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleStatusChange = async (newStatus: string) => {
    if (!job) return;
    try {
      const updated = await updateJob(db, job.id, { status: newStatus as Job['status'] });
      if (updated) setJob(updated);
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const totalMinutes = timeEntries.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);

  if (loading) {
    return <View style={styles.centerContainer}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  if (!job) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>Job not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{job.title}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(job.status) }]}>
            <Text style={styles.statusText}>{job.status.replace('_', ' ')}</Text>
          </View>
          {job.jobType && <Text style={styles.jobType}>{job.jobType}</Text>}
          {job.syncStatus && (
            <Text style={styles.syncStatusText}>
              Sync: {job.syncStatus.replace('_', ' ')}
            </Text>
          )}
        </View>
      </View>

      {/* Status Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status</Text>
        <View style={styles.statusButtons}>
          {(['draft', 'in_progress', 'completed'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.statusButton, job.status === s && styles.statusButtonActive]}
              onPress={() => handleStatusChange(s)}
            >
              <Text style={[styles.statusButtonText, job.status === s && styles.statusButtonTextActive]}>
                {s.replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Notes */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Notes ({notes.length})</Text>
          <TouchableOpacity onPress={() => router.push(`/job/${id}/note`)}>
            <Text style={styles.addAction}>+ Add</Text>
          </TouchableOpacity>
        </View>
        {notes.length === 0 ? (
          <Text style={styles.emptySection}>No notes yet</Text>
        ) : (
          notes.map((note) => (
            <View key={note.id} style={styles.itemCard}>
              <Text style={styles.itemText}>{note.content}</Text>
              <Text style={styles.itemMeta}>{note.noteType} · {formatDate(note.createdAt)}</Text>
            </View>
          ))
        )}
      </View>

      {/* Photos */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Photos ({photos.length})</Text>
          <TouchableOpacity onPress={() => router.push(`/job/${id}/photo`)}>
            <Text style={styles.addAction}>+ Add</Text>
          </TouchableOpacity>
        </View>
        {photos.length === 0 ? (
          <Text style={styles.emptySection}>No photos yet</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {photos.map((photo) => (
              <View key={photo.id} style={styles.photoCard}>
                <Image source={{ uri: photo.localUri }} style={styles.photoThumb} />
                <Text style={styles.photoTypeBadge}>{photo.photoType}</Text>
                {photo.caption && <Text style={styles.photoCaption} numberOfLines={2}>{photo.caption}</Text>}
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Materials */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Materials ({materials.length})</Text>
          <TouchableOpacity onPress={() => router.push(`/job/${id}/material`)}>
            <Text style={styles.addAction}>+ Add</Text>
          </TouchableOpacity>
        </View>
        {materials.length === 0 ? (
          <Text style={styles.emptySection}>No materials yet</Text>
        ) : (
          materials.map((m) => (
            <View key={m.id} style={styles.itemCard}>
              <Text style={styles.itemText}>{m.quantity} {m.unit ?? ''} {m.name}</Text>
              {m.totalCost !== null && <Text style={styles.itemMeta}>${m.totalCost.toFixed(2)}</Text>}
            </View>
          ))
        )}
      </View>

      {/* Time Entries */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Time ({totalMinutes} min)</Text>
          <TouchableOpacity onPress={() => router.push(`/job/${id}/time`)}>
            <Text style={styles.addAction}>+ Add</Text>
          </TouchableOpacity>
        </View>
        {timeEntries.length === 0 ? (
          <Text style={styles.emptySection}>No time entries yet</Text>
        ) : (
          timeEntries.map((t) => (
            <View key={t.id} style={styles.itemCard}>
              <Text style={styles.itemText}>{t.durationMinutes} minutes</Text>
              {t.description && <Text style={styles.itemMeta}>{t.description}</Text>}
            </View>
          ))
        )}
      </View>

      {/* AI Extraction */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>AI Extraction</Text>
        </View>
        {notes.length > 0 ? (
          <TouchableOpacity
            style={styles.extractButton}
            onPress={() => router.push(`/job/${id}/extract`)}
          >
            <Text style={styles.extractButtonText}>Extract from Notes</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.emptySection}>Add a note first to run extraction</Text>
        )}
        {extractions.length > 0 && (
          <View style={styles.extractionHistory}>
            <Text style={styles.extractionHistoryTitle}>Extraction History</Text>
            {extractions.slice(0, 5).map((ext) => {
              let extracted: any = {};
              try { extracted = JSON.parse(ext.extractedJson); } catch {}
              const status = ext.acceptedAt ? 'Accepted' : ext.rejectedAt ? 'Rejected' : 'Pending';
              const statusColor = ext.acceptedAt ? Colors.secondary : ext.rejectedAt ? Colors.accent : Colors.textTertiary;
              const fields: string[] = [];
              if (extracted.jobType) fields.push(`type: ${extracted.jobType}`);
              if (extracted.materials?.length) fields.push(`${extracted.materials.length} material(s)`);
              if (extracted.durationMinutes) fields.push(`${extracted.durationMinutes} min`);
              if (extracted.workPerformed?.length) fields.push(`${extracted.workPerformed.length} task(s)`);

              return (
                <View key={ext.id} style={styles.extractionItem}>
                  <View style={styles.extractionHeader}>
                    <Text style={[styles.extractionStatus, { color: statusColor }]}>{status}</Text>
                    <Text style={styles.extractionMeta}>{ext.provider.replace('_', ' ')}</Text>
                    {ext.confidence !== null && (
                      <Text style={styles.extractionConfidence}>{Math.round(ext.confidence * 100)}%</Text>
                    )}
                  </View>
                  {fields.length > 0 && (
                    <Text style={styles.extractionFields}>{fields.join(' · ')}</Text>
                  )}
                  <Text style={styles.extractionDate}>{formatDate(ext.createdAt)}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Report */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.reportButton}
          onPress={() => router.push(`/job/${id}/report`)}
        >
          <Text style={styles.reportButtonText}>View Report Preview</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: 40 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  header: { marginBottom: Spacing.lg },
  title: { fontSize: Typography.fontSize.xxl, fontWeight: Typography.fontWeight.bold as any, color: Colors.text, marginBottom: Spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.full },
  statusText: { fontSize: Typography.fontSize.xs, color: Colors.textInverse, fontWeight: Typography.fontWeight.medium as any, textTransform: 'uppercase' as any },
  jobType: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, marginLeft: Spacing.sm },
  syncStatusText: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  section: { marginBottom: Spacing.xl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  sectionTitle: { fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.semibold as any, color: Colors.text, marginBottom: Spacing.sm },
  emptySection: { fontSize: Typography.fontSize.sm, color: Colors.textTertiary, fontStyle: 'italic' as any },
  emptyText: { fontSize: Typography.fontSize.lg, color: Colors.textSecondary },
  itemCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  itemText: { fontSize: Typography.fontSize.md, color: Colors.text },
  itemMeta: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  addAction: { fontSize: Typography.fontSize.md, color: Colors.primary, fontWeight: Typography.fontWeight.semibold as any },
  statusButtons: { flexDirection: 'row', gap: Spacing.sm },
  statusButton: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: Colors.border },
  statusButtonActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  statusButtonText: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary },
  statusButtonTextActive: { color: Colors.textInverse },
  extractButton: { backgroundColor: Colors.secondary, borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center' },
  extractButtonText: { color: Colors.textInverse, fontWeight: Typography.fontWeight.semibold as any, fontSize: Typography.fontSize.md },
  acceptedInfo: { fontSize: Typography.fontSize.sm, color: Colors.secondary, marginTop: Spacing.sm },
  extractionHistory: { marginTop: Spacing.md },
  extractionHistoryTitle: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontWeight: Typography.fontWeight.medium as any, marginBottom: Spacing.sm },
  extractionItem: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.sm, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  extractionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 2 },
  extractionStatus: { fontSize: Typography.fontSize.xs, fontWeight: Typography.fontWeight.semibold as any },
  extractionMeta: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary },
  extractionConfidence: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginLeft: 'auto' as any },
  extractionFields: { fontSize: Typography.fontSize.sm, color: Colors.text, marginTop: 2 },
  extractionDate: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 1 },
  reportButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center' },
  reportButtonText: { color: Colors.textInverse, fontWeight: Typography.fontWeight.semibold as any, fontSize: Typography.fontSize.lg },
  photoCard: { marginRight: Spacing.sm, width: 120 },
  photoThumb: { width: 120, height: 90, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary },
  photoTypeBadge: { fontSize: Typography.fontSize.xs, color: Colors.primary, fontWeight: '500' as const, marginTop: 2, textTransform: 'uppercase' as const },
  photoCaption: { fontSize: Typography.fontSize.xs, color: Colors.textSecondary, marginTop: 1 },
});