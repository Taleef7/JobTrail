import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getTimeEntryById, updateTimeEntry } from '../../../src/data/local/timeEntryRepository';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';

export default function EditTimeScreen() {
  const { timeEntryId } = useLocalSearchParams<{ id: string; timeEntryId: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!timeEntryId) return;
      (async () => {
        const entry = await getTimeEntryById(db, timeEntryId);
        if (entry) {
          setDuration(String(entry.durationMinutes ?? ''));
          setDescription(entry.description ?? '');
        }
        setLoading(false);
      })();
    }, [db, timeEntryId])
  );

  const handleSave = async () => {
    if (!duration.trim() || !timeEntryId) return;
    try {
      setSaving(true);
      await updateTimeEntry(db, timeEntryId, {
        durationMinutes: parseInt(duration, 10) || 0,
        description: description.trim() || null,
      });
      router.back();
    } catch (error) {
      console.error('Failed to update time entry:', error);
      showAlert('Error', 'Failed to update time entry.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.centerContainer}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Edit Time</Text>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="time-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Duration (minutes)</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="30"
            value={duration}
            onChangeText={setDuration}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="document-text-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Description</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What did you work on?"
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
          {saving ? <ActivityIndicator color={Colors.textInverse} /> : (
            <><Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} /><Text style={styles.saveButtonText}>Save Changes</Text></>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  title: { fontSize: Typography.fontSize.xxl, fontWeight: Typography.fontWeight.bold as any, color: Colors.text, marginBottom: Spacing.lg },
  section: { marginBottom: Spacing.lg },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  label: { fontSize: Typography.fontSize.md, fontWeight: Typography.fontWeight.medium as any, color: Colors.text },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: Typography.fontSize.md, color: Colors.text },
  textArea: { minHeight: 80, paddingTop: Spacing.md },
  saveButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md, ...Elevation.low },
  saveButtonDisabled: { opacity: 0.5, ...Elevation.none },
  saveButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: '600' as const },
});
