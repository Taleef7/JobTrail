import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { createMaterial } from '../../../src/data/local/materialRepository';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { useAuth } from '../../../src/context/AuthContext';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';

export default function AddMaterialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const { localUserId } = useAuth();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      showAlert('Required', 'Please enter a material name.');
      return;
    }

    const qty = parseFloat(quantity) || 1;
    const cost = unitCost ? parseFloat(unitCost) : undefined;

    try {
      setSaving(true);
      await createMaterial(db, id, {
        name: name.trim(),
        quantity: qty,
        unit: unit.trim() || undefined,
        unitCost: cost,
      }, localUserId || 'local_user');
      router.back();
    } catch (error) {
      console.error('Failed to save material:', error);
      showAlert('Error', 'Failed to save material.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="cube-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Material Name *</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="e.g., PVC trap kit"
            value={name}
            onChangeText={setName}
            autoFocus
            autoCapitalize="words"
            autoCorrect={true}
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Quantity</Text>
            <TextInput
              style={styles.input}
              placeholder="1"
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Unit</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., kit, each"
              value={unit}
              onChangeText={setUnit}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="calculator-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Unit Cost ($)</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            value={unitCost}
            onChangeText={setUnitCost}
            keyboardType="decimal-pad"
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Add Material'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  section: { marginBottom: Spacing.lg },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  label: { fontSize: Typography.fontSize.md, fontWeight: Typography.fontWeight.medium as any, color: Colors.text },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: Typography.fontSize.md, color: Colors.text },
  row: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  rowItem: { flex: 1 },
  saveButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center', alignItems: 'center', marginTop: Spacing.md, ...Elevation.low },
  saveButtonDisabled: { opacity: 0.5, ...Elevation.none },
  saveButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: '600' as const },
  helperText: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, marginTop: 4, marginLeft: 2 },
});