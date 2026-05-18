import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';
import { useDatabase } from '../../../src/data/local/DatabaseProvider';
import { useAuth } from '../../../src/context/AuthContext';
import { getVoiceNotesByJobId, deleteVoiceNote, createVoiceNote } from '../../../src/data/local/voiceNoteRepository';
import { formatDate } from '../../../src/utils/formatting';
import { showAlert } from '../../../src/utils/alert';
import type { VoiceNote } from '../../../src/domain/types';
import { Colors, Spacing, Typography, BorderRadius, Elevation } from '../../../src/theme/colors';

const VOICE_DIR = `${FileSystem.documentDirectory}voice_notes/`;

export default function VoiceNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const { user } = useAuth();
  const userId = user?.uid ?? 'local_user';

  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackPos, setPlaybackPos] = useState(0);
  const [playbackDur, setPlaybackDur] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const notes = await getVoiceNotesByJobId(db, id);
      setVoiceNotes(notes);
    } catch (error) {
      console.error('Failed to load voice notes:', error);
    }
}, [db, id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handlePlayAudio = async (audioUri: string, noteId: string) => {
    try {
      // If already playing this note, pause it
      if (playingId === noteId && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlayingId(null);
        return;
      }

      // Stop any existing playback
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      // Check if file exists
      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      if (!fileInfo.exists) {
        showAlert('File Missing', 'Audio file not found.');
        return;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true },
        onPlaybackStatusUpdate
      );
      soundRef.current = sound;
      setPlayingId(noteId);
    } catch (error) {
      console.error('Playback failed:', error);
      showAlert('Playback Error', 'Could not play audio file.');
    }
  };

  const onPlaybackStatusUpdate = useCallback((status: any) => {
    if (status.isLoaded) {
      setPlaybackPos(status.positionMillis);
      setPlaybackDur(status.durationMillis ?? 0);
      if (status.didJustFinish) {
        setPlayingId(null);
        setPlaybackPos(0);
      }
    }
  }, []);

  // Cleanup sound on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission Required', 'Microphone permission is needed to record voice notes.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
      setRecordingDuration(0);

      // Track duration
      const interval = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      // Store interval ref on recording for cleanup
      (recording as any)._durationInterval = interval;
    } catch (error) {
      console.error('Failed to start recording:', error);
      showAlert('Recording Error', 'Could not start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      // Clear duration interval
      const interval = (recording as any)._durationInterval;
      if (interval) clearInterval(interval);

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      setIsRecording(false);
      setRecording(null);

      if (uri) {
        // Save the recording
        await saveVoiceNote(uri, recordingDuration);
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setIsRecording(false);
      setRecording(null);
    }
  };

  const saveVoiceNote = async (audioUri: string, duration: number) => {
    if (!id) return;
    try {
      // Ensure voice notes directory exists
      const dirInfo = await FileSystem.getInfoAsync(VOICE_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(VOICE_DIR, { intermediates: true });
      }

      // Copy recording to app storage
      const fileName = `${uuidv4()}.m4a`;
      const destUri = `${VOICE_DIR}${fileName}`;
      await FileSystem.copyAsync({ from: audioUri, to: destUri });

      // Create voice note record
      await createVoiceNote(db, id, {
        localAudioUri: destUri,
        durationSeconds: duration,
        transcript: transcript.trim() || undefined,
        transcriptSource: transcript.trim() ? 'manual' : undefined,
      }, userId);

      setTranscript('');
      setRecordingDuration(0);
      loadData();
    } catch (error) {
      console.error('Failed to save voice note:', error);
      showAlert('Error', 'Could not save voice note.');
    }
  };

  const handleDelete = (voiceNoteId: string) => {
    Alert.alert('Delete Voice Note', 'Delete this voice note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteVoiceNote(db, voiceNoteId);
          loadData();
        },
      },
    ]);
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Ionicons name="mic-outline" size={24} color={Colors.primary} />
        <Text style={styles.headerTitle}>Voice Notes</Text>
      </View>

      {/* Recording Controls */}
      <View style={styles.recordingSection}>
        {isRecording ? (
          <View style={styles.recordingActive}>
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>
            </View>
            <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
              <Ionicons name="stop-circle" size={48} color={Colors.danger} />
              <Text style={styles.stopButtonText}>Stop Recording</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.recordButton} onPress={startRecording}>
            <Ionicons name="mic" size={32} color={Colors.textInverse} />
            <Text style={styles.recordButtonText}>Start Recording</Text>
          </TouchableOpacity>
        )}

        {/* Transcript input */}
        <View style={styles.transcriptSection}>
          <Text style={styles.transcriptLabel}>Transcript (optional)</Text>
          <TextInput
            style={styles.transcriptInput}
            placeholder="Type or paste transcript..."
            placeholderTextColor={Colors.textTertiary}
            value={transcript}
            onChangeText={setTranscript}
            multiline
            numberOfLines={3}
            editable={!isRecording}
          />
        </View>
      </View>

      {/* Existing Voice Notes */}
      {voiceNotes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recorded Notes</Text>
          {voiceNotes.map((vn) => (
            <View key={vn.id} style={styles.noteCard}>
              {/* Playback controls */}
              {vn.localAudioUri ? (
                <TouchableOpacity
                  style={styles.playButton}
                  onPress={() => handlePlayAudio(vn.localAudioUri!, vn.id)}
                >
                  <Ionicons
                    name={playingId === vn.id ? 'pause' : 'play'}
                    size={22}
                    color={Colors.primary}
                  />
                </TouchableOpacity>
              ) : null}
              <View style={styles.noteContent}>
                <View style={styles.noteHeader}>
                  <Ionicons name="mic" size={16} color={Colors.primary} />
                  <Text style={styles.noteDuration}>
                    {vn.durationSeconds ? formatDuration(vn.durationSeconds) : 'Recording'}
                  </Text>
                  <Text style={styles.noteDate}>{formatDate(vn.createdAt)}</Text>
                </View>
                {/* Progress bar when playing this note */}
                {playingId === vn.id && playbackDur > 0 && (
                  <View style={styles.progressContainer}>
                    <View style={[styles.progressBar, { width: `${Math.min((playbackPos / playbackDur) * 100, 100)}%` }]} />
                    <Text style={styles.progressText}>
                      {formatDuration(Math.floor(playbackPos / 1000))} / {formatDuration(Math.floor(playbackDur / 1000))}
                    </Text>
                  </View>
                )}
                {vn.transcript && (
                  <Text style={styles.noteTranscript}>{vn.transcript}</Text>
                )}
                {vn.transcriptSource && (
                  <Text style={styles.noteSource}>Source: {vn.transcriptSource}</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => handleDelete(vn.id)} style={styles.deleteButton}>
                <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {voiceNotes.length === 0 && !isRecording && (
        <View style={styles.emptySection}>
          <Ionicons name="mic-outline" size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>No voice notes yet</Text>
          <Text style={styles.emptySubtext}>Tap the record button to start</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  headerTitle: { fontSize: Typography.fontSize.xxl, fontWeight: Typography.fontWeight.bold as any, color: Colors.text },
  recordingSection: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.lg, ...Elevation.low },
  recordingActive: { alignItems: 'center', gap: Spacing.md },
  recordingIndicator: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  recordingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.danger },
  recordingTime: { fontSize: Typography.fontSize.xxl, fontWeight: Typography.fontWeight.bold as any, color: Colors.danger },
  stopButton: { alignItems: 'center', gap: Spacing.xs },
  stopButtonText: { fontSize: Typography.fontSize.sm, color: Colors.danger },
  recordButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, padding: Spacing.lg, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, ...Elevation.medium },
  recordButtonText: { color: Colors.textInverse, fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.semibold as any },
  transcriptSection: { marginTop: Spacing.md },
  transcriptLabel: { fontSize: Typography.fontSize.sm, fontWeight: Typography.fontWeight.semibold as any, color: Colors.textSecondary, marginBottom: Spacing.xs },
  transcriptInput: { backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: Typography.fontSize.md, color: Colors.text, minHeight: 80, textAlignVertical: 'top' },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontSize: Typography.fontSize.lg, fontWeight: Typography.fontWeight.semibold as any, color: Colors.text, marginBottom: Spacing.sm },
  noteCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, ...Elevation.low },
  noteContent: { flex: 1 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: 2 },
  noteDuration: { fontSize: Typography.fontSize.md, fontWeight: Typography.fontWeight.semibold as any, color: Colors.text },
  noteDate: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, marginLeft: Spacing.sm },
  noteTranscript: { fontSize: Typography.fontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  noteSource: { fontSize: Typography.fontSize.xs, color: Colors.textTertiary, fontStyle: 'italic' as any, marginTop: 2 },
  deleteButton: { padding: Spacing.sm },
  playButton: { padding: Spacing.xs, marginRight: Spacing.sm },
  progressContainer: { marginTop: Spacing.xs, marginBottom: Spacing.xs, height: 3, backgroundColor: Colors.border, borderRadius: 2 },
  progressBar: { height: 3, backgroundColor: Colors.primary, borderRadius: 2 },
  progressText: { fontSize: 10, color: Colors.textTertiary },
  emptySection: { alignItems: 'center', padding: Spacing.xxl },
  emptyText: { fontSize: Typography.fontSize.lg, color: Colors.textSecondary, marginTop: Spacing.md },
  emptySubtext: { fontSize: Typography.fontSize.sm, color: Colors.textTertiary, marginTop: Spacing.xs },
});