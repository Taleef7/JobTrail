import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { createJob } from '../../src/data/local/jobRepository';
import { useDatabase } from '../../src/data/local/DatabaseProvider';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../src/theme/colors';

export default function CreateJobScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [jobType, setJobType] = useState('');
  const [roughNotes, setRoughNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) {
      showAlert('Required', 'Please enter a job title.');
      return;
    }

    try {
      setSaving(true);
      const job = await createJob(db, {
        title: title.trim(),
        jobType: jobType.trim() || undefined,
        roughNotes: roughNotes.trim() || undefined,
      });
      router.replace(`/job/${job.id}`);
    } catch (error) {
      console.error('Failed to create job:', error);
      showAlert('Error', 'Failed to create job. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.label}>Job Title *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Kitchen sink repair"
            value={title}
            onChangeText={setTitle}
            autoFocus
            autoCapitalize="sentences"
            autoCorrect={true}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Job Type</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., plumbing, electrical, cleaning"
            value={jobType}
            onChangeText={setJobType}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Initial Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the job, what you did, materials used, time spent..."
            value={roughNotes}
            onChangeText={setRoughNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect={true}
          />
          <Text style={styles.helperText}>Describe the job, what you did, materials used, time spent...</Text>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? 'Creating...' : 'Create Job'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  section: { marginBottom: Spacing.lg },
  label: {
    fontSize: Typography.fontSize.md,
    fontWeight: Typography.fontWeight.medium as any,
    color: Colors.text,
    marginBottom: Spacing.sm,
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
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    alignItems: 'center',
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
  helperText: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 4, marginLeft: 2 },
});