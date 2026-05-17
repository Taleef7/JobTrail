import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getMaterialById, updateMaterial } from '../../../src/data/local/materialRepository';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';

export default function EditMaterialScreen() {
  const { materialId } = useLocalSearchParams<{ id: string; materialId: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!materialId) return;
      (async () => {
        const material = await getMaterialById(db, materialId);
        if (material) {
          setName(material.name);
          setQuantity(String(material.quantity));
          setUnit(material.unit ?? '');
          setUnitCost(material.unitCost !== null ? String(material.unitCost) : '');
        }
        setLoading(false);
      })();
    }, [db, materialId])
  );

  const handleSave = async () => {
    if (!name.trim() || !materialId) return;
    try {
      setSaving(true);
      const qty = parseFloat(quantity) || 1;
      const cost = unitCost ? parseFloat(unitCost) : null;
      const totalCost = cost !== null ? qty * cost : null;
      await updateMaterial(db, materialId, {
        name: name.trim(),
        quantity: qty,
        unit: unit.trim() || null,
        unitCost: cost,
        totalCost,
      });
      router.back();
    } catch (error) {
      console.error('Failed to update material:', error);
      showAlert('Error', 'Failed to update material.');
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
        <Text style={styles.title}>Edit Material</Text>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="cube-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Name</Text>
          </View>
          <TextInput style={styles.input} placeholder="Material name" value={name} onChangeText={setName} autoCapitalize="sentences" />
        </View>

        <View style={styles.row}>
          <View style={[styles.section, styles.halfSection]}>
            <Text style={styles.label}>Quantity</Text>
            <TextInput style={styles.input} placeholder="1" value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
          </View>
          <View style={[styles.section, styles.halfSection]}>
            <Text style={styles.label}>Unit</Text>
            <TextInput style={styles.input} placeholder="pcs, ft, kg..." value={unit} onChangeText={setUnit} autoCapitalize="none" />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="calculator-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Unit Cost</Text>
          </View>
          <TextInput style={styles.input} placeholder="0.00" value={unitCost} onChangeText={setUnitCost} keyboardType="decimal-pad" />
        </View>

        <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
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
  row: { flexDirection: 'row', gap: Spacing.md },
  halfSection: { flex: 1 },
  saveButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md, ...Elevation.low },
  saveButtonDisabled: { opacity: 0.5, ...Elevation.none },
  saveButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: '600' as const },
});
