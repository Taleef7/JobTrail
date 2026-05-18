// Crypto polyfill MUST be imported before any code that uses uuid
import '../src/utils/cryptoPolyfill';

import { Stack, useSegments, useRouter } from 'expo-router';
import { StyleSheet, View, ActivityIndicator, Text } from 'react-native';
import { useEffect } from 'react';
import { DatabaseProvider } from '../src/data/local/DatabaseProvider';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { SyncProvider } from '../src/context/SyncContext';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { Colors, Spacing, Typography } from '../src/theme/colors';

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === 'auth';

    if (!user && !inAuthGroup) {
      router.replace('/auth/login');
    } else if (user && inAuthGroup) {
      router.replace('/');
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: Colors.textInverse,
          headerTitleStyle: { fontWeight: '600' as const },
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Jobs' }} />
        <Stack.Screen name="job/create" options={{ title: 'New Job', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]" options={{ title: 'Job Details' }} />
        <Stack.Screen name="job/[id]/note" options={{ title: 'Add Note', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]/material" options={{ title: 'Add Material', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]/time" options={{ title: 'Add Time', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]/extract" options={{ title: 'AI Suggestions' }} />
        <Stack.Screen name="job/[id]/photo" options={{ title: 'Add Photo', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]/report" options={{ title: 'Report Preview' }} />
        <Stack.Screen name="job/[id]/edit" options={{ title: 'Edit Job' }} />
        <Stack.Screen name="job/[id]/voice" options={{ title: 'Voice Notes' }} />
        <Stack.Screen name="job/[id]/approval" options={{ title: 'Customer Approval' }} />
        <Stack.Screen name="job/[id]/note-edit" options={{ title: 'Edit Note', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]/material-edit" options={{ title: 'Edit Material', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]/time-edit" options={{ title: 'Edit Time Entry', presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="clients/index" options={{ title: 'Clients' }} />
        <Stack.Screen name="clients/create" options={{ title: 'New Client', presentation: 'modal' }} />
        <Stack.Screen name="sites/index" options={{ title: 'Sites' }} />
        <Stack.Screen name="sites/create" options={{ title: 'New Site', presentation: 'modal' }} />
        <Stack.Screen name="auth/login" options={{ title: 'Sign In', headerShown: false }} />
        <Stack.Screen name="auth/signup" options={{ title: 'Sign Up', headerShown: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <AuthProvider>
        <SyncProvider>
          <ErrorBoundary>
            <AuthGate />
          </ErrorBoundary>
        </SyncProvider>
      </AuthProvider>
    </DatabaseProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.fontSize.md,
    color: Colors.textSecondary,
  },
});