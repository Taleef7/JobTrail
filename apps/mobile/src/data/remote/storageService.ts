import { storage } from './firebaseConfig';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Upload a photo to Firebase Storage.
 * Returns the download URL, or null if Firebase isn't configured.
 */
export async function uploadPhoto(
  localUri: string,
  userId: string,
  jobId: string,
  photoId: string
): Promise<string | null> {
  try {
    const response = await fetch(localUri);
    const blob = await response.blob();
    const storageRef = ref(storage, `users/${userId}/jobs/${jobId}/photos/${photoId}.jpg`);
    await uploadBytes(storageRef, blob);
    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (error) {
    console.warn('Photo upload failed (Firebase may not be configured):', error);
    return null;
  }
}