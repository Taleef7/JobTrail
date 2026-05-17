import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useDatabase } from '../src/data/local/DatabaseProvider';
import { getAllJobs } from '../src/data/local/jobRepository';
import type { Job } from '../src/domain/types';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../src/theme/colors';
import { statusColor, formatDate } from '../src/utils/formatting';

export default function JobListScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    try {
      const allJobs = await getAllJobs(db);
      setJobs(allJobs);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadJobs();
    }, [loadJobs])
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {jobs.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No jobs yet</Text>
          <Text style={styles.emptySubtitle}>Tap + to create your first job</Text>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/job/${item.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) }]}>
                    <Text style={styles.statusText}>{item.status.replace('_', ' ')}</Text>
                  </View>
                  {item.syncStatus && (
                    <View style={[
                      styles.syncDot,
                      item.syncStatus === 'synced' && styles.syncDotSynced,
                      item.syncStatus === 'pending' && styles.syncDotPending,
                      item.syncStatus === 'failed' && styles.syncDotFailed,
                      item.syncStatus === 'local_only' && styles.syncDotLocal,
                      item.syncStatus === 'syncing' && styles.syncDotSyncing,
                    ]} />
                  )}
                </View>
              </View>
              {item.jobType && (
                <Text style={styles.cardSubtitle}>{item.jobType}</Text>
              )}
              <Text style={styles.cardDate}>{formatDate(item.updatedAt)}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/job/create')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: Spacing.md },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyTitle: { fontSize: Typography.fontSize.xl, fontWeight: '600' as const, color: Colors.text, marginBottom: Spacing.sm },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
  emptySubtitle: { fontSize: Typography.fontSize.md, color: Colors.textSecondary },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Elevation.low,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  cardTitle: { fontSize: Typography.fontSize.lg, fontWeight: '600' as const, color: Colors.text, flex: 1, marginRight: Spacing.sm },
  cardSubtitle: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xs },
  cardDate: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary },
  statusBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.full },
  statusText: { fontSize: Typography.fontSize.xs, color: Colors.textInverse, fontWeight: '500' as const, textTransform: 'uppercase' as const },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...Elevation.high,
  },
  fabText: { fontSize: 28, color: Colors.textInverse, fontWeight: '300' as const },
  syncDot: { width: 8, height: 8, borderRadius: 4, marginLeft: Spacing.xs },
  syncDotSynced: { backgroundColor: Colors.syncSynced },
  syncDotPending: { backgroundColor: Colors.syncPending },
  syncDotFailed: { backgroundColor: Colors.syncFailed },
  syncDotLocal: { backgroundColor: Colors.syncLocalOnly },
  syncDotSyncing: { backgroundColor: Colors.syncSyncing },
});