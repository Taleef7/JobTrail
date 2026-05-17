import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { useDatabase } from '../../src/data/local/DatabaseProvider';
import { getAllClients, deleteClient } from '../../src/data/local/clientRepository';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../src/theme/colors';
import type { Client } from '../../src/domain/types';

export default function ClientsScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const loadClients = useCallback(async () => {
    try {
      const data = await getAllClients(db);
      setClients(data);
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadClients();
    }, [loadClients])
  );

  const handleDelete = (client: Client) => {
    showAlert('Delete Client', `Delete ${client.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteClient(db, client.id);
          loadClients();
        },
      },
    ]);
  };

  if (loading) {
    return <View style={styles.centerContainer}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={clients}
        keyExtractor={(item) => item.id}
        contentContainerStyle={clients.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No Clients</Text>
            <Text style={styles.emptySubtitle}>Tap + to add a client</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.clientCard}>
            <View style={styles.clientInfo}>
              <Text style={styles.clientName}>{item.name}</Text>
              {item.phone && <Text style={styles.clientDetail}>{item.phone}</Text>}
              {item.email && <Text style={styles.clientDetail}>{item.email}</Text>}
            </View>
            <TouchableOpacity onPress={() => handleDelete(item)} style={styles.deleteButton}>
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/clients/create')}>
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
  clientCard: {
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
  clientInfo: { flex: 1 },
  clientName: { fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.medium as any, color: Colors.text },
  clientDetail: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, marginTop: 2 },
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
