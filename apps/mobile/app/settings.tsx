import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/context/AuthContext';
import { useSyncStatus } from '../src/context/SyncContext';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../src/theme/colors';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const { syncStatus } = useSyncStatus();

  const initials =
    user?.displayName?.[0]?.toUpperCase() ??
    user?.email?.[0]?.toUpperCase() ??
    '?';

  const displayName = user?.displayName || 'No name set';

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
    >
      {/* Profile Section */}
      <View style={[styles.card, styles.profileCard]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.displayName}>{displayName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      {/* Account Section */}
      <View style={styles.sectionHeader}>
        <Ionicons name="shield-outline" size={16} color={Colors.textSecondary} />
        <Text style={styles.sectionHeaderText}>Account</Text>
      </View>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Sync Section */}
      <View style={styles.sectionHeader}>
        <Ionicons name="sync-outline" size={16} color={Colors.textSecondary} />
        <Text style={styles.sectionHeaderText}>Sync</Text>
      </View>
      <View style={styles.card}>
        <View style={styles.syncRow}>
          <View style={styles.syncItem}>
            <Text style={[styles.syncCount, { color: Colors.syncPending }]}>
              {syncStatus.pending}
            </Text>
            <Text style={styles.syncLabel}>Pending</Text>
          </View>
          <View style={styles.syncItem}>
            <Text style={[styles.syncCount, { color: Colors.syncSynced }]}>
              {syncStatus.synced}
            </Text>
            <Text style={styles.syncLabel}>Synced</Text>
          </View>
          <View style={styles.syncItem}>
            <Text style={[styles.syncCount, { color: Colors.syncFailed }]}>
              {syncStatus.failed}
            </Text>
            <Text style={styles.syncLabel}>Failed</Text>
          </View>
        </View>
      </View>

      {/* About Section */}
      <View style={styles.sectionHeader}>
        <Ionicons name="information-circle-outline" size={16} color={Colors.textSecondary} />
        <Text style={styles.sectionHeaderText}>About</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.appName}>JobTrail</Text>
        <Text style={styles.version}>Version 1.0.0</Text>
        <Text style={styles.tagline}>Offline-first field work assistant</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
    ...Elevation.low,
  },
  profileCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    marginTop: Spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  avatarText: {
    fontSize: Typography.fontSize.xxl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.textInverse,
  },
  displayName: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  email: {
    fontSize: Typography.fontSize.md,
    color: Colors.textSecondary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    marginLeft: Spacing.md,
    marginTop: Spacing.sm,
  },
  sectionHeaderText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: Spacing.sm,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  signOutText: {
    fontSize: Typography.fontSize.lg,
    color: Colors.danger,
    fontWeight: Typography.fontWeight.medium,
    marginLeft: Spacing.md,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.sm,
  },
  syncItem: {
    alignItems: 'center',
  },
  syncCount: {
    fontSize: Typography.fontSize.xxl,
    fontWeight: Typography.fontWeight.bold,
  },
  syncLabel: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  appName: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  version: {
    fontSize: Typography.fontSize.md,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  tagline: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
});
