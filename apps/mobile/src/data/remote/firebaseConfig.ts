import { initializeApp } from 'firebase/app';
/* eslint-disable import/no-duplicates */
import { initializeAuth } from 'firebase/auth';
// @ts-expect-error — getReactNativePersistence is only exported from the RN bundle
import { getReactNativePersistence } from 'firebase/auth';
/* eslint-enable import/no-duplicates */
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { createAsyncStorage } from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// Initialize Auth with React Native persistence so auth state survives app restarts
const appStorage = createAsyncStorage('firebase_auth');
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(appStorage),
});

export const db = getFirestore(app);

enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence: not supported in this environment');
  }
});

export const storage = getStorage(app);