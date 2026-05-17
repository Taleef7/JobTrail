import React, { createContext, useContext, useEffect, useState } from 'react';
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

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '1044261050198.apps.googleusercontent.com';

type AuthContextType = {
  user: FirebaseUser | null;
  localUserId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  googleRequest: ReturnType<typeof Google.useIdTokenAuthRequest>[0];
  googlePromptAsync: (() => Promise<any>) | null;
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

  const [googleRequest, googleResponse, googlePromptAsync] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_CLIENT_ID,
  });

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const { id_token } = googleResponse.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential).catch(console.error);
    }
  }, [googleResponse]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
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

  const signInWithGoogle = async () => {
    if (googlePromptAsync) {
      await googlePromptAsync();
    }
  };

  return (
    <AuthContext.Provider value={{ user, localUserId, loading, signIn, signUp, signOut, signInWithGoogle, googleRequest, googlePromptAsync }}>
      {children}
    </AuthContext.Provider>
  );
}