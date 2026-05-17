import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { createClient } from '../../src/data/local/clientRepository';
import { useDatabase } from '../../src/data/local/DatabaseProvider';
import { useAuth } from '../../src/context/AuthContext';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../src/theme/colors';

export default function CreateClientScreen() {
  const db = useDatabase();
  const router = useRouter();
  const { localUserId } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      showAlert('Required', 'Please enter a client name.');
      return;
    }

    try {
      setSaving(true);
      await createClient(db, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      }, localUserId || 'local_user');
      router.back();
    } catch (error) {
      console.error('Failed to create client:', error);
      showAlert('Error', 'Failed to create client.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>New Client</Text>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="person-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Name *</Text>
          </View>
          <TextInput style={styles.input} placeholder="Client name" value={name} onChangeText={setName} autoCapitalize="words" autoFocus />
        </View>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="call-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Phone</Text>
          </View>
          <TextInput style={styles.input} placeholder="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </View>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="mail-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Email</Text>
          </View>
          <TextInput style={styles.input} placeholder="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Notes about this client..."
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={Colors.textInverse} /> : (
            <><Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} /><Text style={styles.saveButtonText}>Save Client</Text></>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
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
