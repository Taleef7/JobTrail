import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Path } from 'react-native-svg';
import { v4 as uuidv4 } from 'uuid';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import {
  createApproval,
  getApprovalsByJobId,
  deleteApproval,
} from '../../../src/data/local/customerApprovalRepository';
import { useAuth } from '../../../src/context/AuthContext';
import type { CustomerApproval } from '../../../src/domain/types';
import { formatDate } from '../../../src/utils/formatting';
import { showAlert } from '../../../src/utils/alert';
import SignatureCanvas from '../../../src/components/SignatureCanvas';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';

const SIG_DIR = `${FileSystem.documentDirectory}signatures/`;

/**
 * Extract SVG path `d` attributes from a raw SVG XML string.
 */
function extractPathsFromSvg(svgXml: string): string[] {
  const paths: string[] = [];
  const regex = /<path d="([^"]*)"/g;
  let match;
  while ((match = regex.exec(svgXml)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const { localUserId } = useAuth();

  const [customerName, setCustomerName] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [signatureBase64, setSignatureBase64] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<CustomerApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signaturePreviews, setSignaturePreviews] = useState<Record<string, string[]>>({});

  const loadApprovals = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getApprovalsByJobId(db, id);
      setApprovals(data);

      // Load signature previews from local files
      const previews: Record<string, string[]> = {};
      for (const approval of data) {
        if (approval.signatureLocalUri) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(approval.signatureLocalUri);
            if (fileInfo.exists) {
              const svgXml = await FileSystem.readAsStringAsync(approval.signatureLocalUri, {
                encoding: FileSystem.EncodingType.UTF8,
              });
              previews[approval.id] = extractPathsFromSvg(svgXml);
            } else {
              previews[approval.id] = [];
            }
          } catch {
            previews[approval.id] = [];
          }
        }
      }
      setSignaturePreviews(previews);
    } catch (error) {
      console.error('Failed to load approvals:', error);
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      loadApprovals();
    }, [loadApprovals])
  );

  const handleSave = async () => {
    if (!signatureBase64) {
      showAlert('Required', 'Please provide a signature.');
      return;
    }

    setSaving(true);
    try {
      await FileSystem.makeDirectoryAsync(SIG_DIR, { intermediates: true });

      const sigId = uuidv4();
      const filePath = `${SIG_DIR}${sigId}.png`;
      await FileSystem.writeAsStringAsync(filePath, signatureBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await createApproval(
        db,
        id,
        {
          customerName: customerName.trim() || undefined,
          signatureLocalUri: filePath,
          approvalNotes: approvalNotes.trim() || undefined,
        },
        localUserId || 'local_user'
      );

      router.back();
    } catch (error) {
      console.error('Failed to save approval:', error);
      showAlert('Error', 'Failed to save approval.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (approvalId: string, filePath: string | null) => {
    showAlert('Delete Approval', 'Are you sure you want to delete this approval?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteApproval(db, approvalId);
            if (filePath) {
              const info = await FileSystem.getInfoAsync(filePath);
              if (info.exists) {
                await FileSystem.deleteAsync(filePath);
              }
            }
            loadApprovals();
          } catch (error) {
            console.error('Failed to delete approval:', error);
            showAlert('Error', 'Failed to delete approval.');
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="checkmark-done-outline" size={24} color={Colors.primary} />
          <Text style={styles.headerTitle}>Customer Approval</Text>
        </View>

        {/* Customer Name */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="person-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Customer Name (optional)</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Enter customer name..."
            value={customerName}
            onChangeText={setCustomerName}
            autoCapitalize="words"
          />
        </View>

        {/* Signature */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="pencil-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Customer Signature</Text>
          </View>
          <SignatureCanvas onSignatureChange={setSignatureBase64} />
        </View>

        {/* Approval Notes */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Ionicons name="document-text-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.label}>Approval Notes (optional)</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Add any notes..."
            value={approvalNotes}
            onChangeText={setApprovalNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
              <Text style={styles.saveButtonText}>Save Approval</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Existing Approvals */}
        {loading ? (
          <ActivityIndicator style={styles.loader} color={Colors.primary} />
        ) : (
          approvals.length > 0 && (
            <View style={styles.existingSection}>
              <Text style={styles.existingTitle}>Existing Approvals</Text>
              {approvals.map((approval) => (
                <View key={approval.id} style={styles.approvalCard}>
                  <View style={styles.approvalHeader}>
                    <View style={styles.approvalInfo}>
                      <Text style={styles.approvalName}>
                        {approval.customerName ?? 'Unknown'}
                      </Text>
                      <Text style={styles.approvalDate}>
                        {formatDate(approval.approvedAt || approval.createdAt)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDelete(approval.id, approval.signatureLocalUri)}
                      style={styles.deleteButton}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                    </TouchableOpacity>
                  </View>
                  {approval.approvalNotes ? (
                    <Text style={styles.approvalNotes}>{approval.approvalNotes}</Text>
                  ) : null}
                  {signaturePreviews[approval.id]?.length > 0 ? (
                    <View style={styles.signaturePreview}>
                      <Svg height={60} width="100%" viewBox={`0 0 ${size.width} 200`}>
                        {signaturePreviews[approval.id].map((d, i) => (
                          <Path
                            key={i}
                            d={d}
                            stroke="black"
                            strokeWidth={2}
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}
                      </Svg>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const size = { width: 300 };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  headerTitle: {
    fontSize: Typography.fontSize.xxl,
    fontWeight: Typography.fontWeight.bold as any,
    color: Colors.text,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  label: {
    fontSize: Typography.fontSize.md,
    fontWeight: Typography.fontWeight.medium as any,
    color: Colors.text,
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
    gap: Spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
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
  loader: {
    marginTop: Spacing.xl,
  },
  existingSection: {
    marginTop: Spacing.xl,
  },
  existingTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold as any,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  approvalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Elevation.low,
  },
  approvalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  approvalInfo: {
    flex: 1,
  },
  approvalName: {
    fontSize: Typography.fontSize.md,
    fontWeight: Typography.fontWeight.medium as any,
    color: Colors.text,
  },
  approvalDate: {
    fontSize: Typography.fontSize.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  approvalNotes: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  deleteButton: {
    padding: Spacing.xs,
    marginLeft: Spacing.sm,
  },
  signaturePreview: {
    marginTop: Spacing.sm,
    height: 60,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
  },
});
