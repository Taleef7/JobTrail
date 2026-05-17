import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../../src/context/AuthContext';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../src/theme/colors';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithGoogle, googleRequest } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      showAlert('Required', 'Please enter email and password.');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (error: any) {
      showAlert('Sign In Failed', error.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      showAlert('Google Sign In Failed', error.message || 'Could not sign in with Google.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Sign In</Text>
        <Text style={styles.subtitle}>Sign in to your JobTrail account</Text>

        <View style={styles.formCard}>
          <View style={styles.section}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="email@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.googleButton, (googleLoading || !googleRequest) && styles.buttonDisabled]}
          onPress={handleGoogleSignIn}
          disabled={googleLoading || !googleRequest}
        >
          {googleLoading ? (
            <ActivityIndicator color={Colors.text} />
          ) : (
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkContainer} onPress={() => router.push('/auth/signup')}>
          <Text style={styles.linkText}>No account? Sign Up</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, justifyContent: 'center', flex: 1 },
  title: {
    fontSize: Typography.fontSize.xxl,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.fontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  section: { marginBottom: Spacing.lg },
  formCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Elevation.low },
  label: {
    fontSize: Typography.fontSize.md,
    fontWeight: '500' as const,
    color: Colors.text,
    marginBottom: Spacing.sm,
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
  button: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    alignItems: 'center',
    marginTop: Spacing.md,
    ...Elevation.medium,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: Colors.textInverse,
    fontSize: Typography.fontSize.lg,
    fontWeight: '600' as const,
  },
  linkContainer: { marginTop: Spacing.lg, alignItems: 'center' },
  linkText: { fontSize: Typography.fontSize.md, color: Colors.primary },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { marginHorizontal: Spacing.md, fontSize: Typography.fontSize.sm, color: Colors.textTertiary },
  googleButton: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Elevation.low,
  },
  googleButtonText: {
    color: Colors.text,
    fontSize: Typography.fontSize.lg,
    fontWeight: '600' as const,
  },
});