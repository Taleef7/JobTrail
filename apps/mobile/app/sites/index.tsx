import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { useDatabase } from '../../src/data/local/DatabaseProvider';
import { getAllSites, deleteSite } from '../../src/data/local/siteRepository';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../src/theme/colors';
import type { Site } from '../../src/domain/types';

export default function SitesScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSites = useCallback(async () => {
    try {
      const data = await getAllSites(db);
      setSites(data);
    } catch (error) {
      console.error('Failed to load sites:', error);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadSites();
    }, [loadSites])
  );

  const handleDelete = (site: Site) => {
    const label = site.name || site.addressLine1 || 'this site';
    showAlert('Delete Site', `Delete ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSite(db, site.id);
          loadSites();
        },
      },
    ]);
  };

  const formatAddress = (site: Site): string => {
    const parts = [site.addressLine1, site.addressLine2, site.city, site.state, site.postalCode].filter(Boolean);
    return parts.join(', ') || 'No address';
  };

  if (loading) {
    return <View style={styles.centerContainer}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={sites}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sites.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="location-outline" size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No Sites</Text>
            <Text style={styles.emptySubtitle}>Tap + to add a site</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.siteCard}>
            <View style={styles.siteInfo}>
              <Text style={styles.siteName}>{item.name || 'Unnamed Site'}</Text>
              <Text style={styles.siteAddress}>{formatAddress(item)}</Text>
            </View>
            <TouchableOpacity onPress={() => handleDelete(item)} style={styles.deleteButton}>
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/sites/create')}>
        <Ionicons name="add" size={28} color={Colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  listContent: { padding: Spacing.lg, paddingBottom: 100 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: Typography.fontSize.xl, fontWeight: Typography.fontWeight.semibold as any, color: Colors.textSecondary },
  emptySubtitle: { fontSize: Typography.fontSize.md, color: Colors.textTertiary },
  siteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Elevation.low,
  },
  siteInfo: { flex: 1 },
  siteName: { fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.medium as any, color: Colors.text },
  siteAddress: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  deleteButton: { padding: Spacing.sm },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Elevation.medium,
  },
});
