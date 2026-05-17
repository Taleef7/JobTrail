import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  signInWithCredential,
  GoogleAuthProvider,
  type User as FirebaseUser,
} from 'firebase/auth';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { auth } from '../data/remote/firebaseConfig';
import { useDatabase } from '../data/local/DatabaseProvider';
import { createUser, getUserByCloudUid } from '../data/local/userRepository';
import { showAlert } from '../utils/alert';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';
const GOOGLE_SIGN_IN_AVAILABLE = !!GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes('example');

type AuthContextType = {
  user: FirebaseUser | null;
  localUserId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  googleAvailable: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [localUserId, setLocalUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const db = useDatabase();

  const [, googleResponse, googlePromptAsync] = Google.useIdTokenAuthRequest(
    GOOGLE_SIGN_IN_AVAILABLE
      ? { clientId: GOOGLE_CLIENT_ID }
      : { clientId: 'disabled' }
  );

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const { id_token } = googleResponse.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential).catch((error) => {
        showAlert('Sign In Failed', 'Could not sign in with Google. Please try again.');
        console.error('Google sign-in error:', error);
      });
    } else if (googleResponse?.type === 'error') {
      showAlert('Sign In Failed', 'Google sign-in was cancelled or failed.');
    }
  }, [googleResponse]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          let localUser = await getUserByCloudUid(db, firebaseUser.uid);
          if (!localUser) {
            localUser = await createUser(db, {
              cloudUid: firebaseUser.uid,
              email: firebaseUser.email ?? '',
              displayName: firebaseUser.displayName,
              lastSyncedAt: null,
            });
          }
          setLocalUserId(localUser.id);
        } catch (error) {
          console.error('Failed to create/get local user:', error);
        }
      } else {
        setLocalUserId(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [db]);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    void credential;
    void displayName;
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const signInWithGoogle = useCallback(async () => {
    if (!GOOGLE_SIGN_IN_AVAILABLE) {
      showAlert('Not Available', 'Google Sign-In is not configured. Please sign in with email and password.');
      return;
    }
    try {
      await googlePromptAsync();
    } catch (error) {
      showAlert('Sign In Failed', 'Could not open Google Sign-In. Please try again.');
      console.error('Google sign-in prompt error:', error);
    }
  }, [googlePromptAsync]);

  return (
    <AuthContext.Provider value={{ user, localUserId, loading, signIn, signUp, signOut, signInWithGoogle, googleAvailable: GOOGLE_SIGN_IN_AVAILABLE }}>
      {children}
    </AuthContext.Provider>
  );
}