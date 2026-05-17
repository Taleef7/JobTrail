import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useDatabase } from '../../src/data/local/DatabaseProvider';
import { getJobById, updateJob, deleteJob } from '../../src/data/local/jobRepository';
import { showAlert } from '../../src/utils/alert';
import { getNotesByJobId, deleteNote } from '../../src/data/local/noteRepository';
import { getMaterialsByJobId, deleteMaterial } from '../../src/data/local/materialRepository';
import { getTimeEntriesByJobId, deleteTimeEntry } from '../../src/data/local/timeEntryRepository';
import { getExtractionResultsByJobId } from '../../src/data/local/extractionRepository';
import { getPhotosByJobId, deletePhoto } from '../../src/data/local/photoRepository';
import { getApprovalsByJobId, deleteApproval } from '../../src/data/local/customerApprovalRepository';
import { getVoiceNotesByJobId, deleteVoiceNote } from '../../src/data/local/voiceNoteRepository';
import { statusColor, formatDate } from '../../src/utils/formatting';
import type { Job, JobNote, MaterialLineItem, TimeEntry, AiExtractionResult, PhotoAsset, CustomerApproval, VoiceNote } from '../../src/domain/types';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../src/theme/colors';

function syncDotColor(status: string): string {
  switch (status) {
    case 'synced': return Colors.syncSynced;
    case 'pending': return Colors.syncPending;
    case 'syncing': return Colors.syncSyncing;
    case 'failed': return Colors.syncFailed;
    case 'conflict': return Colors.syncConflict;
    default: return Colors.syncLocalOnly;
  }
}

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
  const [approvals, setApprovals] = useState<CustomerApproval[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
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
      const a = await getApprovalsByJobId(db, id);
      const vn = await getVoiceNotesByJobId(db, id);
      setJob(j);
      setNotes(n);
      setPhotos(p);
      setMaterials(m);
      setTimeEntries(t);
      setExtractions(e);
      setApprovals(a);
      setVoiceNotes(vn);
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

  const handleDeleteJob = () => {
    Alert.alert('Delete Job', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteJob(db, id);
            router.replace('/');
          } catch {
            showAlert('Error', 'Failed to delete job.');
          }
        },
      },
    ]);
  };

  const handleDeleteNote = (noteId: string) => {
    Alert.alert('Delete Note', 'Delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteNote(db, noteId);
          loadData();
        },
      },
    ]);
  };

  const handleDeleteMaterial = (materialId: string) => {
    Alert.alert('Delete Material', 'Delete this material?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteMaterial(db, materialId);
          loadData();
        },
      },
    ]);
  };

  const handleDeleteTimeEntry = (timeEntryId: string) => {
    Alert.alert('Delete Time Entry', 'Delete this time entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTimeEntry(db, timeEntryId);
          loadData();
        },
      },
    ]);
  };

  const handleDeletePhoto = (photoId: string) => {
    Alert.alert('Delete Photo', 'Delete this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deletePhoto(db, photoId);
          loadData();
        },
      },
    ]);
  };

  const handleDeleteApproval = (approvalId: string) => {
    Alert.alert('Delete Approval', 'Delete this approval?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteApproval(db, approvalId);
          loadData();
        },
      },
    ]);
  };

  const handleDeleteVoiceNote = (voiceNoteId: string) => {
    Alert.alert('Delete Voice Note', 'Delete this voice note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteVoiceNote(db, voiceNoteId);
          loadData();
        },
      },
    ]);
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
        <View style={styles.metaRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(job.status) }]}>
            <Text style={styles.statusText}>{job.status.replace('_', ' ')}</Text>
          </View>
          {job.jobType && <Text style={styles.jobType}>{job.jobType}</Text>}
          {job.syncStatus && (
            <View style={[styles.syncDot, { backgroundColor: syncDotColor(job.syncStatus) }]} />
          )}
        </View>
        {job.clientId && (
          <View style={styles.clientRow}>
            <Ionicons name="person-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.clientText}>{job.clientId}</Text>
          </View>
        )}
        {job.siteId && (
          <View style={styles.clientRow}>
            <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.clientText}>{job.siteId}</Text>
          </View>
        )}
      </View>

      {/* Edit Button */}
      <TouchableOpacity style={styles.editButton} onPress={() => router.push(`/job/${id}/edit`)}>
        <Ionicons name="create-outline" size={16} color={Colors.primary} />
        <Text style={styles.editButtonText}>Edit</Text>
      </TouchableOpacity>

      {/* Status Toggle */}
      <View style={styles.statusToggleRow}>
        {(['draft', 'in_progress', 'completed'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.statusToggleButton, job.status === s && styles.statusToggleActive]}
            onPress={() => handleStatusChange(s)}
          >
            <Text style={[styles.statusToggleText, job.status === s && styles.statusToggleTextActive]}>
              {s.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Notes */}
      {notes.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="document-text-outline" size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Notes · {notes.length}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push(`/job/${id}/note`)}>
              <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          {notes.map((note) => (
            <TouchableOpacity key={note.id} style={styles.itemCard} onPress={() => router.push(`/job/${id}/note-edit?noteId=${note.id}`)}>
              <View style={styles.itemRow}>
                <View style={styles.itemContent}>
                  <Text style={styles.itemText}>{note.content}</Text>
                  <Text style={styles.itemMeta}>{note.noteType} · {formatDate(note.createdAt)}</Text>
                </View>
                <TouchableOpacity onPress={() => handleDeleteNote(note.id)} style={styles.itemDeleteButton}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="camera-outline" size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Photos · {photos.length}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push(`/job/${id}/photo`)}>
              <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
{photos.map((photo) => (
               <View key={photo.id} style={styles.photoCard}>
                 <Image source={{ uri: photo.localUri }} style={styles.photoThumb} />
                 <View style={styles.photoRow}>
                   <Text style={styles.photoTypeBadge}>{photo.photoType}</Text>
                   <TouchableOpacity onPress={() => handleDeletePhoto(photo.id)}>
                     <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                   </TouchableOpacity>
                 </View>
                 {photo.caption && <Text style={styles.photoCaption} numberOfLines={2}>{photo.caption}</Text>}
               </View>
             ))}
          </ScrollView>
        </View>
      )}

      {/* Materials */}
      {materials.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="construct-outline" size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Materials · {materials.length}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push(`/job/${id}/material`)}>
              <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          {materials.map((m) => (
            <TouchableOpacity key={m.id} style={styles.itemCard} onPress={() => router.push(`/job/${id}/material-edit?materialId=${m.id}`)}>
              <View style={styles.itemRow}>
                <View style={styles.itemContent}>
                  <Text style={styles.itemText}>{m.quantity} {m.unit ?? ''} {m.name}</Text>
                  {m.totalCost !== null && <Text style={styles.itemMeta}>${m.totalCost.toFixed(2)}</Text>}
                </View>
                <TouchableOpacity onPress={() => handleDeleteMaterial(m.id)} style={styles.itemDeleteButton}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Time Entries */}
      {timeEntries.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="time-outline" size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Time · {totalMinutes} min</Text>
            </View>
            <TouchableOpacity onPress={() => router.push(`/job/${id}/time`)}>
              <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          {timeEntries.map((t) => (
            <TouchableOpacity key={t.id} style={styles.itemCard} onPress={() => router.push(`/job/${id}/time-edit?timeEntryId=${t.id}`)}>
              <View style={styles.itemRow}>
                <View style={styles.itemContent}>
                  <Text style={styles.itemText}>{t.durationMinutes} minutes</Text>
                  {t.description && <Text style={styles.itemMeta}>{t.description}</Text>}
                </View>
                <TouchableOpacity onPress={() => handleDeleteTimeEntry(t.id)} style={styles.itemDeleteButton}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* AI Extraction */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="sparkles-outline" size={18} color={Colors.primary} />
            <Text style={styles.sectionTitle}>AI Extraction</Text>
          </View>
          {notes.length > 0 && (
            <TouchableOpacity onPress={() => router.push(`/job/${id}/extract`)}>
              <Ionicons name="sparkles-outline" size={22} color={Colors.secondary} />
            </TouchableOpacity>
          )}
        </View>
        {notes.length === 0 && (
          <Text style={styles.emptySection}>Add a note first to run extraction</Text>
        )}
        {extractions.length > 0 && (
          <View style={styles.extractionHistory}>
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
                      <Text style={styles.extractionConfidence}>Confidence: {Math.round(ext.confidence * 100)}%</Text>
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

      {/* Voice Notes */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="mic-outline" size={18} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Voice Notes{voiceNotes.length > 0 ? ` · ${voiceNotes.length}` : ''}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push(`/job/${id}/voice`)}>
            <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        {voiceNotes.length === 0 && (
          <Text style={styles.emptySection}>No voice notes yet</Text>
        )}
        {voiceNotes.map((vn) => (
          <View key={vn.id} style={styles.itemCard}>
            <View style={styles.itemRow}>
              <View style={styles.itemContent}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="mic" size={14} color={Colors.primary} />
                  <Text style={styles.itemText}>
                    {vn.durationSeconds ? `${Math.floor(vn.durationSeconds / 60)}:${(vn.durationSeconds % 60).toString().padStart(2, '0')}` : 'Recording'}
                  </Text>
                </View>
                {vn.transcript && <Text style={styles.itemMeta} numberOfLines={2}>{vn.transcript}</Text>}
                <Text style={styles.itemMeta}>{formatDate(vn.createdAt)}</Text>
              </View>
              <TouchableOpacity onPress={() => handleDeleteVoiceNote(vn.id)} style={styles.itemDeleteButton}>
                <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Customer Approval */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="checkmark-done-outline" size={18} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Approval{approvals.length > 0 ? ` · ${approvals.length}` : ''}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push(`/job/${id}/approval`)}>
            <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        {approvals.length === 0 && (
          <Text style={styles.emptySection}>No approvals yet</Text>
        )}
        {approvals.map((approval) => (
          <View key={approval.id} style={styles.itemCard}>
            <View style={styles.itemRow}>
              <View style={styles.itemContent}>
                <Text style={styles.itemText}>{approval.customerName || 'Unknown'}</Text>
                <Text style={styles.itemMeta}>{approval.approvedAt ? formatDate(approval.approvedAt) : ''}</Text>
                {approval.approvalNotes && <Text style={styles.itemMeta}>{approval.approvalNotes}</Text>}
              </View>
              <TouchableOpacity onPress={() => handleDeleteApproval(approval.id)} style={styles.itemDeleteButton}>
                <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Report */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.reportButton}
          onPress={() => router.push(`/job/${id}/report`)}
        >
          <Ionicons name="document-text-outline" size={20} color={Colors.textInverse} style={{ marginRight: Spacing.sm }} />
          <Text style={styles.reportButtonText}>View Report Preview</Text>
        </TouchableOpacity>
      </View>

      {/* Delete Job */}
      <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteJob}>
        <Ionicons name="trash-outline" size={20} color={Colors.danger} />
        <Text style={styles.deleteButtonText}>Delete Job</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: 80 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  header: { marginBottom: Spacing.md },
  title: { fontSize: Typography.fontSize.xxl, fontWeight: Typography.fontWeight.bold as any, color: Colors.text, marginBottom: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.full },
  statusText: { fontSize: Typography.fontSize.xs, color: Colors.textInverse, fontWeight: Typography.fontWeight.medium as any, textTransform: 'uppercase' as any },
  jobType: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 4 },
  clientText: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary },
  editButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.md },
  editButtonText: { fontSize: Typography.fontSize.md, color: Colors.primary, fontWeight: Typography.fontWeight.medium as any },
  statusToggleRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl },
  statusToggleButton: { flex: 1, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  statusToggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary, ...Elevation.low },
  statusToggleText: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontWeight: Typography.fontWeight.medium as any },
  statusToggleTextActive: { color: Colors.textInverse },
  section: { marginBottom: Spacing.xl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sectionTitle: { fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.semibold as any, color: Colors.text },
  emptySection: { fontSize: Typography.fontSize.sm, color: Colors.textTertiary, fontStyle: 'italic' as any },
  emptyText: { fontSize: Typography.fontSize.lg, color: Colors.textSecondary },
  itemCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border, ...Elevation.low },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  itemContent: { flex: 1 },
  itemDeleteButton: { padding: Spacing.xs, marginLeft: Spacing.sm },
  itemText: { fontSize: Typography.fontSize.md, color: Colors.text },
  itemMeta: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  extractionHistory: { marginTop: Spacing.sm },
  extractionItem: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.sm, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border, ...Elevation.low },
  extractionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 2 },
  extractionStatus: { fontSize: Typography.fontSize.xs, fontWeight: Typography.fontWeight.semibold as any },
  extractionMeta: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary },
  extractionConfidence: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginLeft: 'auto' as any },
  extractionFields: { fontSize: Typography.fontSize.sm, color: Colors.text, marginTop: 2 },
  extractionDate: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 1 },
  reportButton: { flexDirection: 'row', backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', justifyContent: 'center', ...Elevation.medium },
  reportButtonText: { color: Colors.textInverse, fontWeight: Typography.fontWeight.semibold as any, fontSize: Typography.fontSize.lg },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    marginTop: Spacing.xl,
    marginBottom: Spacing.xxl,
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: BorderRadius.md,
  },
  deleteButtonText: {
    fontSize: Typography.fontSize.lg,
    color: Colors.danger,
    fontWeight: '600' as const,
  },
photoCard: { marginRight: Spacing.sm, width: 120 },
  photoThumb: { width: 120, height: 90, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary },
  photoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  photoTypeBadge: { fontSize: Typography.fontSize.xs, color: Colors.primary, fontWeight: '500' as const, textTransform: 'uppercase' as const },
  photoCaption: { fontSize: Typography.fontSize.xs, color: Colors.textSecondary, marginTop: 1 },
});
