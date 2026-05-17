import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { createTimeEntry } from '../../../src/data/local/timeEntryRepository';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';

export default function AddTimeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [durationMinutes, setDurationMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const minutes = parseInt(durationMinutes, 10);
    if (!minutes || minutes <= 0) {
      showAlert('Required', 'Please enter a valid duration in minutes.');
      return;
    }

    try {
      setSaving(true);
      await createTimeEntry(db, id, {
        durationMinutes: minutes,
        description: description.trim() || undefined,
      });
      router.back();
    } catch (error) {
      console.error('Failed to save time entry:', error);
      showAlert('Error', 'Failed to save time entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.label}>Duration (minutes) *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., 55"
            value={durationMinutes}
            onChangeText={setDurationMinutes}
            keyboardType="number-pad"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helperText}>Enter the time spent in minutes</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What did you work on? Describe the task, progress, or issues..."
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
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
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Add Time Entry'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  section: { marginBottom: Spacing.lg },
  label: { fontSize: Typography.fontSize.md, fontWeight: Typography.fontWeight.medium as any, color: Colors.text, marginBottom: Spacing.sm },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: Typography.fontSize.md, color: Colors.text },
  textArea: { minHeight: 80, paddingTop: Spacing.md },
  saveButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', marginTop: Spacing.md, ...Elevation.low },
  saveButtonDisabled: { opacity: 0.5, ...Elevation.none },
  saveButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: '600' as const },
  helperText: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 4, marginLeft: 2 },
});