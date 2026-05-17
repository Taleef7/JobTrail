import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { createJob } from '../../src/data/local/jobRepository';
import { useDatabase } from '../../src/data/local/DatabaseProvider';
import { useAuth } from '../../src/context/AuthContext';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../src/theme/colors';

export default function CreateJobScreen() {
  const db = useDatabase();
  const router = useRouter();
  const { localUserId } = useAuth();
  const [title, setTitle] = useState('');
  const [jobType, setJobType] = useState('');
  const [clientName, setClientName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
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
        clientId: clientName.trim() || undefined,
        siteId: siteAddress.trim() || undefined,
        roughNotes: roughNotes.trim() || undefined,
      }, localUserId || 'local_user');
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
        <Text style={styles.title}>Create Job</Text>
        <Text style={styles.subtitle}>Create a new job to track your work</Text>

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

        <View style={styles.section}>
          <Text style={styles.label}>Initial Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Add notes about this job..."
            value={roughNotes}
            onChangeText={setRoughNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect={true}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color={Colors.textInverse} /> : (
            <><Ionicons name="checkmark" size={20} color={Colors.textInverse} /><Text style={styles.saveButtonText}>Create Job</Text></>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
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
  label: {
    fontSize: Typography.fontSize.md,
    fontWeight: Typography.fontWeight.medium as any,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
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
