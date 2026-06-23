import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { Agent } from './agent';
import { useSettings } from './settings';

const DOWNLOAD = RNFS.DownloadDirectoryPath;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic)$/i;

interface Attachment {
  uri: string; // for preview
  base64: string; // sent to the model
}

interface ChatLine {
  id: string;
  role: 'user' | 'ai' | 'tool';
  text: string;
  image?: string; // preview uri for user messages with an attached image
}

// Reveals text progressively (typewriter effect) for AI replies.
function TypingText({
  text,
  style,
  onTick,
}: {
  text: string;
  style: any;
  onTick?: () => void;
}) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    let i = 0;
    setShown('');
    const step = Math.max(1, Math.ceil(text.length / 240));
    const id = setInterval(() => {
      i = Math.min(text.length, i + step);
      setShown(text.slice(0, i));
      onTick?.();
      if (i >= text.length) {
        clearInterval(id);
      }
    }, 18);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return <Text style={style}>{shown}</Text>;
}

export default function ChatScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const { host, model, context, ready } = useSettings();
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [dlImages, setDlImages] = useState<string[] | null>(null);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const agentRef = useRef<Agent | null>(null);
  const counter = useRef(0);
  const listRef = useRef<FlatList<ChatLine>>(null);

  // Rebuild the agent whenever host/model change (or settings finish loading).
  useEffect(() => {
    if (ready) {
      agentRef.current = new Agent({ host, model, context });
    }
  }, [host, model, context, ready]);

  // Speech-to-text via the native SttModule (Android SpeechRecognizer).
  useEffect(() => {
    const emitter = new NativeEventEmitter(NativeModules.SttModule);
    const onResults = emitter.addListener('stt_results', (e: any) => {
      if (e?.text) {
        setInput(e.text);
      }
    });
    const onEnd = emitter.addListener('stt_end', () => setListening(false));
    const onError = emitter.addListener('stt_error', () => setListening(false));
    return () => {
      onResults.remove();
      onEnd.remove();
      onError.remove();
    };
  }, []);

  const toggleListening = async () => {
    if (listening) {
      NativeModules.SttModule?.stop();
      setListening(false);
      return;
    }
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      Alert.alert('Microphone permission denied');
      return;
    }
    setInput('');
    setListening(true);
    NativeModules.SttModule?.start('ko-KR');
  };

  const nextId = () => `${counter.current++}`;
  const scrollEnd = () => listRef.current?.scrollToEnd({ animated: false });
  // Scroll after the new row has laid out (animated).
  const scrollSoon = () =>
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

  const addLine = (role: ChatLine['role'], text: string) => {
    setLines(prev => [...prev, { id: nextId(), role, text }]);
    scrollSoon();
  };

  const pickFromGallery = async () => {
    const res = await launchImageLibrary({
      mediaType: 'photo',
      includeBase64: true,
      quality: 0.7,
    });
    const a = res.assets?.[0];
    if (a?.base64 && a.uri) {
      setAttachment({ uri: a.uri, base64: a.base64 });
    }
  };

  const takePhoto = async () => {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      Alert.alert('Camera permission denied');
      return;
    }
    const res = await launchCamera({
      mediaType: 'photo',
      includeBase64: true,
      quality: 0.7,
      saveToPhotos: true,
    });
    const a = res.assets?.[0];
    if (a?.base64 && a.uri) {
      setAttachment({ uri: a.uri, base64: a.base64 });
    }
  };

  const openDownloadPicker = async () => {
    try {
      const entries = await RNFS.readDir(DOWNLOAD);
      const imgs = entries
        .filter(e => e.isFile() && IMAGE_EXT.test(e.name))
        .map(e => e.name);
      setDlImages(imgs);
    } catch (e) {
      Alert.alert('error', (e as Error).message);
    }
  };

  const selectDownloadImage = async (name: string) => {
    try {
      const path = `${DOWNLOAD}/${name}`;
      const base64 = await RNFS.readFile(path, 'base64');
      setAttachment({ uri: `file://${path}`, base64 });
    } catch (e) {
      Alert.alert('error', (e as Error).message);
    } finally {
      setDlImages(null);
    }
  };

  const addImage = () => {
    Alert.alert('Add image', undefined, [
      { text: 'Gallery', onPress: pickFromGallery },
      { text: 'Camera', onPress: takePhoto },
      { text: 'Download folder', onPress: openDownloadPicker },
    ]);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !attachment) || busy || !agentRef.current) {
      return;
    }
    const images = attachment ? [attachment.base64] : undefined;
    const imageUri = attachment?.uri;
    setInput('');
    setAttachment(null);
    setLines(prev => [
      ...prev,
      { id: nextId(), role: 'user', text: text || '(image)', image: imageUri },
    ]);
    scrollSoon();
    setBusy(true);
    try {
      const answer = await agentRef.current.ask(
        text || 'Describe this image.',
        e => {
          if (e.type === 'tool_call') {
            addLine('tool', `→ ${e.name}(${JSON.stringify(e.args)})`);
          } else {
            addLine('tool', `← ${e.result}`);
          }
        },
        images,
      );
      addLine('ai', answer);
      if (speakOn) {
        NativeModules.SpeakModule?.speak(answer);
      }
    } catch (err) {
      addLine('ai', `error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const renderItem = ({ item }: { item: ChatLine }) => {
    if (item.role === 'tool') {
      return (
        <View style={styles.toolWrap}>
          <Text style={styles.toolText}>{item.text}</Text>
        </View>
      );
    }
    const isUser = item.role === 'user';
    return (
      <View style={[styles.bubble, isUser ? styles.user : styles.ai]}>
        {item.image && (
          <Image source={{ uri: item.image }} style={styles.bubbleImage} />
        )}
        {item.role === 'ai' ? (
          <TypingText
            text={item.text}
            style={styles.aiText}
            onTick={scrollEnd}
          />
        ) : (
          <Text style={styles.userText}>{item.text}</Text>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={'padding'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Ollama Chat</Text>
          <Text style={styles.subtitle}>{model}</Text>
        </View>
        <View style={styles.headerBtns}>
          <TouchableOpacity
            style={[styles.gearBtn, speakOn && styles.gearBtnActive]}
            onPress={() => {
              if (speakOn) {
                NativeModules.SpeakModule?.stop();
              }
              setSpeakOn(v => !v);
            }}
            hitSlop={10}
          >
            <Text style={styles.gear}>{speakOn ? '🔊' : '🔇'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.gearBtn}
            onPress={() => navigation.navigate('Settings')}
            hitSlop={10}
          >
            <Text style={styles.gear}>⚙︎</Text>
          </TouchableOpacity>
        </View>
      </View>

      {lines.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>Ask me anything.</Text>
          <Text style={styles.emptyHint}>
            Search the web, read/write files, set alarms, find contacts, and
            more. Tap 🎤 to talk, 🔊 to hear replies.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={lines}
          keyExtractor={i => i.id}
          renderItem={renderItem}
        />
      )}

      {attachment && (
        <View style={styles.attachBar}>
          <Image source={{ uri: attachment.uri }} style={styles.attachThumb} />
          <TouchableOpacity
            style={styles.attachRemove}
            onPress={() => setAttachment(null)}
          >
            <Text style={styles.attachRemoveText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.inputRow, { paddingBottom: insets.bottom || 8 }]}>
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={addImage}
          disabled={busy}
        >
          <Text style={styles.attachBtnText}>＋</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={listening ? 'Listening…' : 'Ask something…'}
          placeholderTextColor="#5b6472"
          editable={!busy}
          onSubmitEditing={send}
          returnKeyType="send"
          multiline
        />
        <TouchableOpacity
          style={[styles.micBtn, listening && styles.micBtnActive]}
          onPress={toggleListening}
          disabled={busy}
        >
          <Text style={styles.micBtnText}>{listening ? '■' : '🎤'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sendBtn, busy && styles.sendBtnDisabled]}
          onPress={send}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendBtnText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={dlImages !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDlImages(null)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setDlImages(null)}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Download images</Text>
            {dlImages && dlImages.length > 0 ? (
              <FlatList
                data={dlImages}
                keyExtractor={n => n}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.dlRow}
                    onPress={() => selectDownloadImage(item)}
                  >
                    <Image
                      source={{ uri: `file://${DOWNLOAD}/${item}` }}
                      style={styles.dlThumb}
                    />
                    <Text style={styles.dlName} numberOfLines={1}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={styles.muted}>No images in Download.</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0d12' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1c2230',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  subtitle: { color: '#5e9bff', fontSize: 12, marginTop: 2 },
  headerBtns: { flexDirection: 'row', gap: 8 },
  gearBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#161b26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearBtnActive: { backgroundColor: '#16233a' },
  gear: { color: '#cbd5e1', fontSize: 20 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyText: { color: '#e5e7eb', fontSize: 17, fontWeight: '600' },
  emptyHint: {
    color: '#5b6472',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  list: { flex: 1 },
  listContent: { padding: 14 },
  bubble: {
    maxWidth: '86%',
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 11,
    marginVertical: 5,
  },
  user: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563eb',
    borderBottomRightRadius: 4,
  },
  ai: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1f2b',
    borderBottomLeftRadius: 4,
  },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  aiText: { color: '#e8ebf0', fontSize: 15, lineHeight: 21 },
  toolWrap: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  toolText: { color: '#d9a441', fontSize: 12, fontFamily: 'monospace' },
  inputRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1c2230',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: '#161b26',
    color: '#fff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    marginRight: 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#2a3344' },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#161b26',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  micBtnActive: { backgroundColor: '#dc2626' },
  micBtnText: { color: '#cbd5e1', fontSize: 18 },
  bubbleImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginBottom: 8,
    resizeMode: 'cover',
  },
  attachBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  attachThumb: { width: 64, height: 64, borderRadius: 10 },
  attachRemove: {
    position: 'absolute',
    left: 64,
    top: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#161b26',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  attachBtnText: { color: '#9aa4b2', fontSize: 24, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#11151e',
    borderRadius: 16,
    padding: 16,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: '#1c2230',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  dlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dlThumb: { width: 48, height: 48, borderRadius: 8, marginRight: 12 },
  dlName: { color: '#cbd5e1', fontSize: 14, flex: 1 },
  muted: { color: '#5b6472', fontSize: 14, paddingVertical: 12 },
});
