import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
} from 'expo-audio';
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
  const [transcript, setTranscript] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 500);

  const audioPlayer = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(audioPlayer);

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

  useEffect(() => {
    return () => {
      audioPlayer.pause();
    };
  }, [audioPlayer]);

  useEffect(() => {
    if (playerStatus.didJustFinish && playingId) {
      // Defer state update to avoid eslint-plugin-react-hooks v7 set-state-in-effect rule.
      // playerStatus is an external system (expo-audio) — the effect correctly synchronizes.
      const id = setTimeout(() => setPlayingId(null), 0);
      return () => clearTimeout(id);
    }
  }, [playerStatus.didJustFinish, playingId]);

  const handlePlayAudio = async (audioUri: string, noteId: string) => {
    try {
      if (playingId === noteId) {
        if (playerStatus.playing) {
          audioPlayer.pause();
        } else {
          audioPlayer.play();
        }
        return;
      }

      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      if (!fileInfo.exists) {
        showAlert('File Missing', 'Audio file not found.');
        return;
      }

      audioPlayer.replace(audioUri);
      setPlayingId(noteId);
      audioPlayer.play();
    } catch (error) {
      console.error('Playback failed:', error);
      showAlert('Playback Error', 'Could not play audio file.');
    }
  };

  const startRecording = async () => {
    try {
      const permissions = await requestRecordingPermissionsAsync();
      if (!permissions.granted) {
        showAlert('Permission Required', 'Microphone permission is needed to record voice notes.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setTranscript('');
    } catch (error) {
      console.error('Failed to start recording:', error);
      showAlert('Recording Error', 'Could not start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    try {
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false });

      const finalState = audioRecorder.getStatus();
      const uri = finalState.url;
      const durationMs = finalState.durationMillis || recorderState.durationMillis;
      if (uri) {
        await saveVoiceNote(uri, Math.floor(durationMs / 1000));
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      showAlert('Recording Error', 'Could not save recording. Please try again.');
    }
  };

  const saveVoiceNote = async (audioUri: string, duration: number) => {
    if (!id) return;
    try {
      const dirInfo = await FileSystem.getInfoAsync(VOICE_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(VOICE_DIR, { intermediates: true });
      }

      const fileName = `${uuidv4()}.m4a`;
      const destUri = `${VOICE_DIR}${fileName}`;
      await FileSystem.copyAsync({ from: audioUri, to: destUri });

      await createVoiceNote(db, id, {
        localAudioUri: destUri,
        durationSeconds: duration,
        transcript: transcript.trim() || undefined,
        transcriptSource: transcript.trim() ? 'manual' : undefined,
      }, userId);

      setTranscript('');
      loadData();
    } catch (error) {
      console.error('Failed to save voice note:', error);
      showAlert('Error', 'Could not save voice note.');
    }
  };

  const handleDelete = (voiceNoteId: string) => {
    if (playingId === voiceNoteId) {
      audioPlayer.pause();
      setPlayingId(null);
    }
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
    const secs = Math.floor(seconds) % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isRecording = recorderState.isRecording;
  const recordingDuration = Math.floor(recorderState.durationMillis / 1000);
  const playbackPos = playerStatus.currentTime * 1000;
  const playbackDur = playerStatus.duration > 0 ? playerStatus.duration * 1000 : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Ionicons name="mic-outline" size={24} color={Colors.primary} />
        <Text style={styles.headerTitle}>Voice Notes</Text>
      </View>

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

      {voiceNotes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recorded Notes</Text>
          {voiceNotes.map((vn) => {
            const isThisLoaded = playingId === vn.id;
            return (
              <View key={vn.id} style={styles.noteCard}>
                {vn.localAudioUri ? (
                  <TouchableOpacity
                    style={styles.playButton}
                    onPress={() => handlePlayAudio(vn.localAudioUri!, vn.id)}
                  >
                    <Ionicons
                      name={isThisLoaded && playerStatus.playing ? 'pause' : 'play'}
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
                  {isThisLoaded && playbackDur > 0 && (
                    <View style={styles.progressContainer}>
                      <View
                        style={[
                          styles.progressBar,
                          { width: `${Math.min((playbackPos / playbackDur) * 100, 100)}%` },
                        ]}
                      />
                      <Text style={styles.progressText}>
                        {formatDuration(playerStatus.currentTime)} / {formatDuration(playerStatus.duration)}
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
            );
          })}
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
