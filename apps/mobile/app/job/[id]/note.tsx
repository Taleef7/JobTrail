import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { createNote } from '../../../src/data/local/noteRepository';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { useAuth } from '../../../src/context/AuthContext';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';

export default function AddNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const { localUserId } = useAuth();
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!content.trim()) {
      showAlert('Required', 'Please enter a note.');
      return;
    }

    try {
      setSaving(true);
      await createNote(db, id, { content: content.trim(), noteType: 'manual' }, localUserId || 'local_user');
      router.back();
    } catch (error) {
      console.error('Failed to save note:', error);
      showAlert('Error', 'Failed to save note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.labelRow}>
          <Ionicons name="create-outline" size={16} color={Colors.textSecondary} />
          <Text style={styles.label}>Note *</Text>
        </View>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="What happened on the job..."
          value={content}
          onChangeText={setContent}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          autoFocus
          autoCapitalize="sentences"
          autoCorrect={true}
        />

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Note'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  label: { fontSize: Typography.fontSize.md, fontWeight: Typography.fontWeight.medium as any, color: Colors.text },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: Typography.fontSize.md, color: Colors.text },
  textArea: { minHeight: 150, paddingTop: Spacing.md },
  saveButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center', alignItems: 'center', marginTop: Spacing.md, ...Elevation.low },
  saveButtonDisabled: { opacity: 0.5, ...Elevation.none },
  saveButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: '600' as const },
  helperText: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 4, marginLeft: 2 },
});