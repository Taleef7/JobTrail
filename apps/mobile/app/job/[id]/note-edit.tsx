import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getNoteById, updateNote } from '../../../src/data/local/noteRepository';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';
import type { JobNote } from '../../../src/domain/types';

export default function EditNoteScreen() {
  const { noteId } = useLocalSearchParams<{ id: string; noteId: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [content, setContent] = useState('');
  const [noteType, setNoteType] = useState<string>('manual');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!noteId) return;
      (async () => {
        const note = await getNoteById(db, noteId);
        if (note) {
          setContent(note.content);
          setNoteType(note.noteType);
        }
        setLoading(false);
      })();
    }, [db, noteId])
  );

  const handleSave = async () => {
    if (!content.trim() || !noteId) return;
    try {
      setSaving(true);
      await updateNote(db, noteId, { content: content.trim(), noteType: noteType as JobNote['noteType'] });
      router.back();
    } catch (error) {
      console.error('Failed to update note:', error);
      showAlert('Error', 'Failed to update note.');
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
        <Text style={styles.title}>Edit Note</Text>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="document-text-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Content</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Note content..."
            value={content}
            onChangeText={setContent}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect={true}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {['manual', 'voice', 'ai_generated'].map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.typeButton, noteType === t && styles.typeButtonActive]}
                onPress={() => setNoteType(t)}
              >
                <Text style={[styles.typeButtonText, noteType === t && styles.typeButtonTextActive]}>
                  {t.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
  textArea: { minHeight: 100, paddingTop: Spacing.md },
  typeRow: { flexDirection: 'row', gap: Spacing.sm },
  typeButton: { flex: 1, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  typeButtonActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeButtonText: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary },
  typeButtonTextActive: { color: Colors.textInverse },
  saveButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md, ...Elevation.low },
  saveButtonDisabled: { opacity: 0.5, ...Elevation.none },
  saveButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: '600' as const },
});
