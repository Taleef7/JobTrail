import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { useAuth } from '../src/context/AuthContext';
import { useSyncStatus } from '../src/context/SyncContext';
import { ModelManager, type ModelStatus } from '../src/ai/ModelManager';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../src/theme/colors';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const { syncStatus } = useSyncStatus();
  const [modelStatus, setModelStatus] = useState<ModelStatus>('not_downloaded');
  const [modelProgress, setModelProgress] = useState(0);
  const [modelLoading, setModelLoading] = useState(false);

  useEffect(() => {
    const modelManager = ModelManager.getInstance();
    const unsubscribe = modelManager.subscribe((status, progress) => {
      setModelStatus(status);
      setModelProgress(progress);
    });
    return unsubscribe;
  }, []);

  const handleDownloadModel = async () => {
    setModelLoading(true);
    try {
      await ModelManager.getInstance().download();
    } catch (error) {
      Alert.alert('Download Failed', error instanceof Error ? error.message : 'Could not download the AI model.');
    } finally {
      setModelLoading(false);
    }
  };

  const handleDeleteModel = () => {
    Alert.alert('Delete AI Model', 'Remove the on-device AI model? You can re-download it later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => ModelManager.getInstance().deleteModel() },
    ]);
  };

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

      {/* AI Model Section */}
      <View style={styles.sectionHeader}>
        <Ionicons name="hardware-chip-outline" size={16} color={Colors.textSecondary} />
        <Text style={styles.sectionHeaderText}>AI Model</Text>
      </View>
      <View style={styles.card}>
        {modelStatus === 'not_downloaded' && (
          <>
            <Text style={styles.modelStatusText}>Not downloaded</Text>
            <Text style={styles.modelDescription}>
              Download the on-device AI model for offline extraction. Works without internet.{'\n'}Size: ~0.8 GB
            </Text>
            <TouchableOpacity
              style={styles.modelButton}
              onPress={handleDownloadModel}
              disabled={modelLoading}
              activeOpacity={0.7}
            >
              <Ionicons name="cloud-download-outline" size={20} color={Colors.textInverse} />
              <Text style={styles.modelButtonText}>Download Model</Text>
            </TouchableOpacity>
          </>
        )}
        {modelStatus === 'downloading' && (
          <>
            <Text style={styles.modelStatusText}>Downloading... {Math.round(modelProgress * 100)}%</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(modelProgress * 100)}%` }]} />
            </View>
            <Text style={styles.modelDescription}>Please keep the app open while downloading.</Text>
          </>
        )}
        {modelStatus === 'ready' && (
          <>
            <View style={styles.modelReadyRow}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.secondary} />
              <Text style={styles.modelStatusText}>Model ready (0.8 GB)</Text>
            </View>
            <Text style={styles.modelDescription}>On-device AI extraction is available for offline use.</Text>
            <TouchableOpacity
              style={styles.deleteModelButton}
              onPress={handleDeleteModel}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              <Text style={styles.deleteModelText}>Delete Model</Text>
            </TouchableOpacity>
          </>
        )}
        {modelStatus === 'error' && (
          <>
            <Text style={styles.modelStatusText}>Download failed</Text>
            <Text style={styles.modelDescription}>Something went wrong. Check your connection and try again.</Text>
            <TouchableOpacity
              style={styles.modelButton}
              onPress={handleDownloadModel}
              disabled={modelLoading}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={20} color={Colors.textInverse} />
              <Text style={styles.modelButtonText}>Retry Download</Text>
            </TouchableOpacity>
          </>
        )}
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
  modelStatusText: {
    fontSize: Typography.fontSize.md,
    fontWeight: Typography.fontWeight.semibold as any,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  modelDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  modelButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  modelButtonText: {
    color: Colors.textInverse,
    fontSize: Typography.fontSize.md,
    fontWeight: Typography.fontWeight.medium as any,
  },
  modelReadyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  deleteModelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
  deleteModelText: {
    fontSize: Typography.fontSize.md,
    color: Colors.danger,
    fontWeight: Typography.fontWeight.medium as any,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.surfaceSecondary,
    overflow: 'hidden' as const,
    marginBottom: Spacing.md,
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
});
