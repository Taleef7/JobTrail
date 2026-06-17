import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { showAlert } from '../../../src/utils/alert';
import { useAuth } from '../../../src/context/AuthContext';
import { getJobById, updateJob } from '../../../src/data/local/jobRepository';
import { getNotesByJobId } from '../../../src/data/local/noteRepository';
import { createExtractionResult, acceptExtractionResult } from '../../../src/data/local/extractionRepository';
import { createMaterial } from '../../../src/data/local/materialRepository';
import { createTimeEntry } from '../../../src/data/local/timeEntryRepository';
import { CascadeAiProvider, ModelManager, AiError } from '../../../src/ai';
import type { Job, JobNote, JobExtractionResult } from '../../../src/domain/types';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

const PROVIDER_LABELS: Record<string, string> = {
  'apple-foundation': 'Apple Intelligence',
  'local-llm': 'On-device AI',
  'cloud': 'Cloud AI (Gemini)',
  'rule-based': 'Rule-based',
};

function aiErrorToUserMessage(err: AiError): string {
  switch (err.kind) {
    case 'timeout':
      return 'The AI service took too long to respond. Check your connection and try again.';
    case 'rate_limit':
      return 'Too many requests in a short time. Wait a moment and try again.';
    case 'parse':
      return 'The AI returned an unexpected response. Please try again, or switch to Rule-based.';
    case 'auth':
      return 'The Gemini API key was rejected. Check EXPO_PUBLIC_GEMINI_API_KEY in .env.';
    case 'network':
      return 'Network error reaching the AI service. Check your connection.';
    default:
      return 'Extraction failed. Please try again.';
  }
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return Colors.secondary;
  if (confidence >= 0.5) return Colors.accent;
  return Colors.danger;
}

export default function ExtractScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const { localUserId } = useAuth();

  const [job, setJob] = useState<Job | null>(null);
  const [notes, setNotes] = useState<JobNote[]>([]);
  const [extractionResult, setExtractionResult] = useState<JobExtractionResult | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [providerUsed, setProviderUsed] = useState<string | null>(null);

  const [acceptMaterials, setAcceptMaterials] = useState(true);
  const [acceptDuration, setAcceptDuration] = useState(true);
  const [acceptFollowUp, setAcceptFollowUp] = useState(true);
  const [acceptJobType, setAcceptJobType] = useState(true);

  const cascadeProvider = useMemo(() => {
    return new CascadeAiProvider({
      geminiApiKey: GEMINI_API_KEY || undefined,
      modelManager: ModelManager.getInstance(),
    });
  }, []);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [j, n] = await Promise.all([
        getJobById(db, id),
        getNotesByJobId(db, id),
      ]);
      setJob(j);
      setNotes(n);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleExtract = async () => {
    const roughNotes = job?.roughNotes;
    if (!notes.length && !roughNotes) {
      showAlert('No Notes', 'Add a note or job description before running extraction.');
      return;
    }

    setExtracting(true);
    try {
      const parts: string[] = [];
      if (roughNotes) parts.push(roughNotes);
      parts.push(...notes.map((n) => n.content));
      const combinedText = parts.join('\n');
      const result = await cascadeProvider.extractJobFields({
        noteText: combinedText,
        jobId: id!,
      });

      const providerName = cascadeProvider.getLastProviderUsed();
      setProviderUsed(providerName);

      const saved = await createExtractionResult(db, {
        jobId: id!,
        sourceType: 'note',
        provider: providerName,
        inputText: combinedText,
        extractedJson: JSON.stringify(result),
        confidence: result.confidence ?? undefined,
      }, localUserId || 'local_user');

      setExtractionResult(result);
      setExtractionId(saved.id);
    } catch (error) {
      console.error('Extraction failed:', error);
      const message =
        error instanceof AiError
          ? aiErrorToUserMessage(error)
          : 'Extraction failed. Please try again.';
      showAlert('Extraction failed', message);
    } finally {
      setExtracting(false);
    }
  };

  const handleApply = async () => {
    if (!extractionResult || !extractionId || !job) return;

    setApplying(true);
    try {
      // Apply accepted suggestions
      if (acceptMaterials && extractionResult.materials.length > 0) {
        for (const mat of extractionResult.materials) {
          await createMaterial(db, id!, {
            name: mat.name,
            quantity: mat.quantity ?? 1,
            unit: mat.unit ?? undefined,
            unitCost: mat.estimatedCost ?? undefined,
          }, localUserId || 'local_user');
        }
      }

      if (acceptDuration && extractionResult.durationMinutes != null) {
        await createTimeEntry(db, id!, {
          durationMinutes: extractionResult.durationMinutes,
          description: 'AI extracted duration',
        }, localUserId || 'local_user');
      }

      // Update job type if accepted
      if (acceptJobType && extractionResult.jobType) {
        await updateJob(db, id!, { jobType: extractionResult.jobType });
      }

      // Update job internal notes with follow-up if accepted
      if (acceptFollowUp && extractionResult.followUpNotes.length > 0) {
        const followUpText = extractionResult.followUpNotes.join('; ');
        const currentNotes = job.internalNotes ?? '';
        await updateJob(db, id!, {
          internalNotes: currentNotes ? `${currentNotes}\n\nFollow-up: ${followUpText}` : `Follow-up: ${followUpText}`,
        });
      }

      // Mark extraction as accepted
      await acceptExtractionResult(db, extractionId);

      showAlert('Applied', 'Suggestions have been applied to the job.', [
        { text: 'View Job', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('Failed to apply suggestions:', error);
      showAlert('Error', 'Failed to apply suggestions.');
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return <View style={styles.centerContainer}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  if (!job) {
    return <View style={styles.centerContainer}><Text style={styles.emptyText}>Job not found</Text></View>;
  }

  const hasNotes = notes.length > 0 || Boolean(job?.roughNotes);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {!extractionResult ? (
        <View style={styles.extractSection}>
          <View style={styles.titleRow}>
            <Ionicons name="sparkles" size={24} color={Colors.secondary} />
            <Text style={styles.title}>Extract Job Details</Text>
          </View>
          <Text style={styles.description}>
            Automatically detect materials, time, and follow-up items from your notes.
          </Text>

          <Text style={styles.notePreview}>
{notes.length > 0 || job?.roughNotes
              ? 'Extract structured fields from your notes using the best available AI engine'
              : 'Add a job description first'} 
          </Text>

          <TouchableOpacity
            style={[styles.extractButton, (extracting || !hasNotes) && styles.buttonDisabled]}
            onPress={handleExtract}
            disabled={extracting || !hasNotes}
          >
            <Ionicons name="sparkles" size={20} color={Colors.textInverse} />
            <Text style={styles.extractButtonText}>{extracting ? 'Extracting...' : 'Extract Details'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.resultsSection}>
          <Text style={styles.title}>Extraction Results</Text>

          {providerUsed && (
            <View style={styles.providerUsedRow}>
              <Ionicons name="hardware-chip-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.providerUsedText}>
                Extracted with: {PROVIDER_LABELS[providerUsed] ?? providerUsed}
              </Text>
            </View>
          )}

          <View style={styles.confidenceRow}>
            <View style={styles.confidenceBarTrack}>
              <View style={[styles.confidenceBarFill, { width: `${Math.round((extractionResult.confidence ?? 0) * 100)}%`, backgroundColor: confidenceColor(extractionResult.confidence ?? 0) }]} />
            </View>
            <Text style={styles.confidence}>Confidence {Math.round((extractionResult.confidence ?? 0) * 100)}%</Text>
          </View>

          {/* Job Type */}
          {extractionResult.jobType && (
            <View style={styles.suggestionCard}>
              <TouchableOpacity style={styles.checkboxRow} onPress={() => setAcceptJobType(!acceptJobType)}>
                <View style={[styles.checkbox, acceptJobType && styles.checkboxChecked]}>
                  {acceptJobType && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <View style={styles.suggestionContent}>
                  <Text style={styles.suggestionLabel}>Job Type</Text>
                  <Text style={styles.suggestionValue}>{extractionResult.jobType}</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* Work Performed */}
          {extractionResult.workPerformed.length > 0 && (
            <View style={styles.suggestionCard}>
              <Text style={styles.suggestionLabel}>Work Performed</Text>
              {extractionResult.workPerformed.map((w, i) => (
                <Text key={i} style={styles.suggestionValue}>• {w}</Text>
              ))}
            </View>
          )}

          {/* Materials */}
          {extractionResult.materials.length > 0 && (
            <View style={styles.suggestionCard}>
              <TouchableOpacity style={styles.checkboxRow} onPress={() => setAcceptMaterials(!acceptMaterials)}>
                <View style={[styles.checkbox, acceptMaterials && styles.checkboxChecked]}>
                  {acceptMaterials && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <View style={styles.suggestionContent}>
                  <Text style={styles.suggestionLabel}>Materials</Text>
                  {extractionResult.materials.map((m, i) => (
                    <Text key={i} style={styles.suggestionValue}>
                      • {m.quantity ?? 1} {m.unit ?? ''} {m.name}
                    </Text>
                  ))}
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* Duration */}
          {extractionResult.durationMinutes !== undefined && (
            <View style={styles.suggestionCard}>
              <TouchableOpacity style={styles.checkboxRow} onPress={() => setAcceptDuration(!acceptDuration)}>
                <View style={[styles.checkbox, acceptDuration && styles.checkboxChecked]}>
                  {acceptDuration && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <View style={styles.suggestionContent}>
                  <Text style={styles.suggestionLabel}>Duration</Text>
                  <Text style={styles.suggestionValue}>{extractionResult.durationMinutes} minutes</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* Customer Approval */}
          {extractionResult.customerApproved !== undefined && (
            <View style={styles.suggestionCard}>
              <Text style={styles.suggestionLabel}>Customer Approval</Text>
              <Text style={styles.suggestionValue}>
                {extractionResult.customerApproved ? 'Approved ✓' : 'Not approved'}
              </Text>
            </View>
          )}

          {/* Follow-up Notes */}
          {extractionResult.followUpNotes.length > 0 && (
            <View style={styles.suggestionCard}>
              <TouchableOpacity style={styles.checkboxRow} onPress={() => setAcceptFollowUp(!acceptFollowUp)}>
                <View style={[styles.checkbox, acceptFollowUp && styles.checkboxChecked]}>
                  {acceptFollowUp && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <View style={styles.suggestionContent}>
                  <Text style={styles.suggestionLabel}>Follow-up Notes</Text>
                  {extractionResult.followUpNotes.map((f, i) => (
                    <Text key={i} style={styles.suggestionValue}>• {f}</Text>
                  ))}
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* Missing Fields */}
          {extractionResult.missingFields.length > 0 && (
            <View style={styles.suggestionCard}>
              <Text style={styles.suggestionLabel}>Missing Information</Text>
              {extractionResult.missingFields.map((f, i) => (
                <Text key={i} style={styles.missingValue}>• {formatFieldName(f)}</Text>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.applyButton, applying && styles.buttonDisabled]}
            onPress={handleApply}
            disabled={applying}
          >
            <Text style={styles.applyButtonText}>
              {applying ? 'Applying...' : 'Accept Selected & Apply'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.reRunButton}
            onPress={() => {
              setExtractionResult(null);
              setExtractionId(null);
              setProviderUsed(null);
            }}
          >
            <Text style={styles.reRunButtonText}>Re-run Extraction</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function formatFieldName(field: string): string {
  const map: Record<string, string> = {
    materials: 'Materials used',
    durationMinutes: 'Labor time',
    customerApproval: 'Customer approval status',
  };
  return map[field] ?? field;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: 40 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  emptyText: { fontSize: Typography.fontSize.lg, color: Colors.textSecondary },
  extractSection: { marginTop: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  title: { fontSize: Typography.fontSize.xxl, fontWeight: Typography.fontWeight.bold as any, color: Colors.text },
  description: { fontSize: Typography.fontSize.md, color: Colors.textSecondary, marginBottom: Spacing.lg, lineHeight: 22 },
  notePreview: { fontSize: Typography.fontSize.md, color: Colors.text, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.lg, lineHeight: 22 },
  extractButton: { backgroundColor: Colors.secondary, borderRadius: BorderRadius.md, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, ...Elevation.low },
  extractButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.semibold as any },
  resultsSection: { marginTop: Spacing.md },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  confidence: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary },
  confidenceBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' as const },
  confidenceBarFill: { height: 6, borderRadius: 3 },
  suggestionCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border, ...Elevation.low },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start' },
  checkbox: { width: 24, height: 24, borderRadius: BorderRadius.sm, borderWidth: 2, borderColor: Colors.border, marginRight: Spacing.md, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.surface },
  checkboxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkmark: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' as any },
  suggestionContent: { flex: 1 },
  suggestionLabel: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, fontWeight: Typography.fontWeight.medium as any, marginBottom: 2 },
  suggestionValue: { fontSize: Typography.fontSize.md, color: Colors.text, lineHeight: 22 },
  missingValue: { fontSize: Typography.fontSize.sm, color: Colors.accent, lineHeight: 20 },
  applyButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', marginTop: Spacing.lg, ...Elevation.medium },
  applyButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.semibold as any },
  buttonDisabled: { opacity: 0.6 },
  reRunButton: { marginTop: Spacing.md, padding: Spacing.md, alignItems: 'center' },
  reRunButtonText: { color: Colors.textSecondary, fontSize: Typography.fontSize.md },
  providerUsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  providerUsedText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.fontWeight.medium as any,
  },
});
