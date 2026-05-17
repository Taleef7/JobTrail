import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { createMaterial } from '../../../src/data/local/materialRepository';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius } from '../../../src/theme/colors';

export default function AddMaterialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
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
      });
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
          <Text style={styles.label}>Material Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., PVC trap kit"
            value={name}
            onChangeText={setName}
            autoFocus
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
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Unit Cost ($)</Text>
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
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Add Material'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg },
  section: { marginBottom: Spacing.lg },
  label: { fontSize: Typography.fontSize.md, fontWeight: Typography.fontWeight.medium as any, color: Colors.text, marginBottom: Spacing.sm },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: Typography.fontSize.md, color: Colors.text },
  row: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  rowItem: { flex: 1 },
  saveButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', marginTop: Spacing.sm },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.semibold as any },
});