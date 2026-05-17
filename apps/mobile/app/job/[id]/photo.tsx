import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { createPhoto } from '../../../src/data/local/photoRepository';
import { useAuth } from '../../../src/context/AuthContext';
import { showAlert } from '../../../src/utils/alert';
import { Colors, Spacing, Typography, BorderRadius } from '../../../src/theme/colors';

const PHOTO_TYPES = ['before', 'after', 'general', 'issue', 'material'] as const;

export default function AddPhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const { localUserId } = useAuth();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [photoType, setPhotoType] = useState<string>('general');
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showAlert('Permission Required', 'Camera permission is needed to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!imageUri) {
      showAlert('Required', 'Please select or take a photo first.');
      return;
    }
    setSaving(true);
    try {
      await createPhoto(db, id!, {
        userId: localUserId || 'local_user',
        localUri: imageUri,
        remoteUrl: null,
        photoType: photoType as any,
        caption: caption.trim() || null,
        takenAt: new Date().toISOString(),
        uploadStatus: 'pending',
        syncStatus: 'local_only',
      });
      router.back();
    } catch {
      showAlert('Error', 'Failed to save photo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Image picker buttons */}
      <View style={styles.imagePickerRow}>
        <TouchableOpacity style={styles.pickerButton} onPress={pickImage}>
          <Ionicons name="images-outline" size={20} color={Colors.primary} />
          <Text style={styles.pickerButtonText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pickerButton} onPress={takePhoto}>
          <Ionicons name="camera-outline" size={20} color={Colors.primary} />
          <Text style={styles.pickerButtonText}>Camera</Text>
        </TouchableOpacity>
      </View>

      {/* Image preview */}
      {imageUri && (
        <Image source={{ uri: imageUri }} style={styles.preview} />
      )}

      {/* Photo type selector */}
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Ionicons name="pricetag-outline" size={16} color={Colors.textSecondary} />
          <Text style={styles.label}>Photo Type</Text>
        </View>
        <View style={styles.typeRow}>
          {PHOTO_TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.typeChip, photoType === type && styles.typeChipActive]}
              onPress={() => setPhotoType(type)}
            >
              <Text style={[styles.typeChipText, photoType === type && styles.typeChipTextActive]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Caption */}
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Ionicons name="chatbubble-outline" size={16} color={Colors.textSecondary} />
          <Text style={styles.label}>Caption (optional)</Text>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Add a caption..."
          value={caption}
          onChangeText={setCaption}
          multiline
          numberOfLines={2}
        />
      </View>

      {/* Save */}
      <TouchableOpacity
        style={[styles.saveButton, saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color={Colors.textInverse} />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
            <Text style={styles.saveButtonText}>Add Photo</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: 40 },
  imagePickerRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  pickerButton: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickerButtonText: { fontSize: Typography.fontSize.md, color: Colors.primary, fontWeight: Typography.fontWeight.semibold as any },
  preview: {
    width: '100%',
    height: 240,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.surfaceSecondary,
    resizeMode: 'contain',
  },
  section: { marginBottom: Spacing.lg },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  label: { fontSize: Typography.fontSize.md, fontWeight: Typography.fontWeight.semibold as any, color: Colors.text },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  typeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeChipText: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary },
  typeChipTextActive: { color: Colors.textInverse },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: { color: Colors.textInverse, fontWeight: Typography.fontWeight.semibold as any, fontSize: Typography.fontSize.lg },
});