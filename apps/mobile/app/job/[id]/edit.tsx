import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { getJobById, updateJob } from '../../../src/data/local/jobRepository';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';
import type { Job } from '../../../src/domain/types';

const PRIORITIES = [
  { value: 'low', icon: 'arrow-down-outline' as const, label: 'Low' },
  { value: 'normal', icon: 'remove-outline' as const, label: 'Normal' },
  { value: 'high', icon: 'arrow-up-outline' as const, label: 'High' },
] as const;

export default function EditJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState<Job | null>(null);

  const [title, setTitle] = useState('');
  const [jobType, setJobType] = useState('');
  const [priority, setPriority] = useState<string>('normal');
  const [roughNotes, setRoughNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [clientName, setClientName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');

  const loadJob = useCallback(async () => {
    if (!id) return;
    try {
      const j = await getJobById(db, id);
      setJob(j);
      if (j) {
        setTitle(j.title);
        setJobType(j.jobType ?? '');
        setPriority(j.priority ?? 'normal');
        setRoughNotes(j.roughNotes ?? '');
        setInternalNotes(j.internalNotes ?? '');
        setClientName(j.clientId ?? '');
        setSiteAddress(j.siteId ?? '');
      }
    } catch (error) {
      console.error('Failed to load job:', error);
      showAlert('Error', 'Failed to load job data.');
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      loadJob();
    }, [loadJob])
  );

  const handleSave = async () => {
    if (!title.trim()) {
      showAlert('Required', 'Please enter a job title.');
      return;
    }

    try {
      setSaving(true);
      const updated = await updateJob(db, id!, {
        title: title.trim(),
        jobType: jobType.trim() || undefined,
        priority,
        clientId: clientName.trim() || undefined,
        siteId: siteAddress.trim() || undefined,
        roughNotes: roughNotes.trim() || undefined,
        internalNotes: internalNotes.trim() || undefined,
      });
      if (updated) {
        router.back();
      } else {
        showAlert('Error', 'Job not found. It may have been deleted.');
      }
    } catch (error) {
      console.error('Failed to update job:', error);
      showAlert('Error', 'Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.textTertiary} />
        <Text style={styles.emptyText}>Job not found</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Edit Job</Text>
        <Text style={styles.subtitle}>Update job details</Text>

        {/* Title */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="create-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Title *</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="e.g., Kitchen sink repair"
            value={title}
            onChangeText={setTitle}
            autoCapitalize="sentences"
            autoCorrect
          />
        </View>

        {/* Job Type */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="briefcase-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Job Type</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="e.g., plumbing, electrical, cleaning"
            value={jobType}
            onChangeText={setJobType}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Client */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="person-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Client</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Client name"
            value={clientName}
            onChangeText={setClientName}
            autoCapitalize="words"
          />
        </View>

        {/* Site */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="location-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Site</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Site address or location"
            value={siteAddress}
            onChangeText={setSiteAddress}
            autoCapitalize="sentences"
          />
        </View>

        {/* Priority */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="flag-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Priority</Text>
          </View>
          <View style={styles.priorityRow}>
            {PRIORITIES.map((p) => {
              const selected = priority === p.value;
              return (
                <TouchableOpacity
                  key={p.value}
                  style={[
                    styles.priorityChip,
                    selected && styles.priorityChipSelected,
                  ]}
                  onPress={() => setPriority(p.value)}
                >
                  <Ionicons
                    name={p.icon}
                    size={16}
                    color={selected ? Colors.textInverse : Colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.priorityChipText,
                      selected && styles.priorityChipTextSelected,
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Rough Notes */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="document-text-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Rough Notes</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Rough notes about this job..."
            value={roughNotes}
            onChangeText={setRoughNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect
          />
        </View>

        {/* Internal Notes */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="lock-closed-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Internal Notes</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Internal notes (not shared with customer)..."
            value={internalNotes}
            onChangeText={setInternalNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect
          />
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: Spacing.md,
  },
  emptyText: {
    fontSize: Typography.fontSize.lg,
    color: Colors.textSecondary,
  },
  title: {
    fontSize: Typography.fontSize.xxl,
    fontWeight: Typography.fontWeight.bold as any,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.fontSize.md,
    color: Colors.textSecondary,
    marginBottom: Spacing.xl,
  },
  section: { marginBottom: Spacing.lg },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  label: {
    fontSize: Typography.fontSize.md,
    fontWeight: Typography.fontWeight.medium as any,
    color: Colors.text,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSize.md,
    color: Colors.text,
  },
  textArea: {
    minHeight: 100,
    paddingTop: Spacing.md,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  priorityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  priorityChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    ...Elevation.low,
  },
  priorityChipText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium as any,
    color: Colors.textSecondary,
  },
  priorityChipTextSelected: {
    color: Colors.textInverse,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    ...Elevation.low,
  },
  saveButtonDisabled: {
    opacity: 0.5,
    ...Elevation.none,
  },
  saveButtonText: {
    color: Colors.textInverse,
    fontSize: Typography.fontSize.lg,
    fontWeight: '600' as const,
  },
});
