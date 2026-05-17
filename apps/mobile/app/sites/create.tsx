import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { createSite } from '../../src/data/local/siteRepository';
import { useDatabase } from '../../src/data/local/DatabaseProvider';
import { useAuth } from '../../src/context/AuthContext';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../src/theme/colors';

export default function CreateSiteScreen() {
  const db = useDatabase();
  const router = useRouter();
  const { localUserId } = useAuth();
  const [name, setName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() && !addressLine1.trim()) {
      showAlert('Required', 'Please enter a site name or address.');
      return;
    }

    try {
      setSaving(true);
      await createSite(db, {
        name: name.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
      }, localUserId || 'local_user');
      router.back();
    } catch (error) {
      console.error('Failed to create site:', error);
      showAlert('Error', 'Failed to create site.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>New Site</Text>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="location-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Name</Text>
          </View>
          <TextInput style={styles.input} placeholder="Site name" value={name} onChangeText={setName} autoCapitalize="words" autoFocus />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Address Line 1</Text>
          <TextInput style={styles.input} placeholder="Street address" value={addressLine1} onChangeText={setAddressLine1} autoCapitalize="words" />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Address Line 2</Text>
          <TextInput style={styles.input} placeholder="Apt, suite, unit" value={addressLine2} onChangeText={setAddressLine2} autoCapitalize="words" />
        </View>

        <View style={styles.row}>
          <View style={[styles.section, styles.halfSection]}>
            <Text style={styles.label}>City</Text>
            <TextInput style={styles.input} placeholder="City" value={city} onChangeText={setCity} autoCapitalize="words" />
          </View>
          <View style={[styles.section, styles.halfSection]}>
            <Text style={styles.label}>State</Text>
            <TextInput style={styles.input} placeholder="State" value={state} onChangeText={setState} autoCapitalize="words" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Postal Code</Text>
          <TextInput style={styles.input} placeholder="Postal code" value={postalCode} onChangeText={setPostalCode} keyboardType="default" />
        </View>

        <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={Colors.textInverse} /> : (
            <><Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} /><Text style={styles.saveButtonText}>Save Site</Text></>
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
  row: { flexDirection: 'row', gap: Spacing.md },
  halfSection: { flex: 1 },
  saveButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md, ...Elevation.low },
  saveButtonDisabled: { opacity: 0.5, ...Elevation.none },
  saveButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: '600' as const },
});
