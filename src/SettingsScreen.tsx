import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings, type ApiType } from './settings';

interface ModelInfo {
  name: string; // sent to the server / stored as the setting
  label: string; // shown in the UI
  size: number;
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function fmtSize(bytes: number) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

export default function SettingsScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const {
    host: savedHost,
    model: savedModel,
    apiType: savedApiType,
    offline: savedOffline,
    save,
  } = useSettings();
  const [host, setHost] = useState(savedHost);
  const [model, setModel] = useState(savedModel);
  const [apiType, setApiType] = useState<ApiType>(savedApiType);
  const [offline, setOffline] = useState(savedOffline);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchModels = async (h: string, type: ApiType) => {
    setLoading(true);
    setError('');
    try {
      const base = h.replace(/\/$/, '');
      const res = await fetch(
        type === 'llama' ? `${base}/v1/models` : `${base}/api/tags`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const list: ModelInfo[] =
        type === 'llama'
          ? (data.data ?? []).map((m: any) => ({
              name: m.id,
              label: basename(m.id),
              size: 0,
            }))
          : (data.models ?? []).map((m: any) => ({
              name: m.name,
              label: m.name,
              size: m.size ?? 0,
            }));
      setModels(list);
      if (list.length === 0) {
        setError(
          type === 'llama'
            ? 'No models found — is the llama.cpp server running?'
            : 'No models found — pull one with `ollama pull <model>`.',
        );
      }
    } catch (e) {
      setModels([]);
      setError(`Can't reach ${h}\n${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels(savedHost, savedApiType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        {/* Server */}
        <Text style={styles.section}>SERVER</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Host</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={host}
              onChangeText={setHost}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.0.27:11434"
              placeholderTextColor="#5b6472"
            />
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={() => fetchModels(host, apiType)}
            >
              <Text style={styles.refreshBtnText}>↻</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Server type */}
        <Text style={styles.section}>SERVER TYPE</Text>
        <View style={styles.chipRow}>
          {[
            { id: 'ollama' as const, label: 'Ollama' },
            { id: 'llama' as const, label: 'llama.cpp' },
          ].map(t => (
            <TouchableOpacity
              key={t.id}
              style={[styles.chip, apiType === t.id && styles.chipSel]}
              onPress={() => {
                setApiType(t.id);
                fetchModels(host, t.id);
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  apiType === t.id && styles.chipTextSel,
                ]}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Models */}
        <Text style={styles.section}>MODEL</Text>
        <View style={styles.card}>
          {loading ? (
            <ActivityIndicator color="#5e9bff" style={styles.loader} />
          ) : models.length > 0 ? (
            models.map((m, idx) => {
              const selected = m.name === model;
              return (
                <TouchableOpacity
                  key={m.name}
                  style={[styles.modelRow, idx > 0 && styles.modelRowBorder]}
                  onPress={() => setModel(m.name)}
                >
                  <View style={styles.flex}>
                    <Text
                      style={[
                        styles.modelName,
                        selected && styles.modelNameSel,
                      ]}
                    >
                      {m.label}
                    </Text>
                    {!!m.size && (
                      <Text style={styles.modelSize}>{fmtSize(m.size)}</Text>
                    )}
                  </View>
                  <View style={[styles.check, selected && styles.checkSel]}>
                    {selected && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={styles.muted}>Tap ↻ to load models.</Text>
          )}
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}

        {/* Offline */}
        <Text style={styles.section}>OFFLINE</Text>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => setOffline(v => !v)}
        >
          <View style={styles.flex}>
            <Text style={styles.linkText}>Offline mode</Text>
            <Text style={styles.help}>
              Always answer with the on-device model — the server above is never
              contacted. When off, the server is used normally and the on-device
              model only kicks in if it can't be reached. Tools that need the
              network (web search, etc.) won't work either way while offline.
            </Text>
          </View>
          <View style={[styles.check, offline && styles.checkSel]}>
            {offline && <Text style={styles.checkMark}>✓</Text>}
          </View>
        </TouchableOpacity>

        {/* Permissions */}
        <Text style={styles.section}>PERMISSIONS</Text>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={async () => {
            try {
              await Linking.sendIntent(
                'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION',
              );
            } catch {
              await Linking.openSettings();
            }
          }}
        >
          <Text style={styles.linkText}>Grant file access</Text>
          <Text style={styles.linkChevron}>›</Text>
        </TouchableOpacity>
        <Text style={styles.help}>
          Needed for the agent to read/write files in your Download folder.
        </Text>

        <TouchableOpacity
          style={[styles.saveBtn, !model && styles.saveBtnDisabled]}
          onPress={async () => {
            await save(host.trim(), model, apiType, offline);
            navigation.goBack();
          }}
          disabled={!model}
        >
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0d12' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1c2230',
  },
  back: { color: '#5e9bff', fontSize: 32, width: 44, lineHeight: 34 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerSpacer: { width: 44 },
  content: { padding: 16 },
  section: {
    color: '#5b6472',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#11151e',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1c2230',
  },
  label: { color: '#9aa4b2', fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    backgroundColor: '#0b0d12',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#232b3a',
    fontSize: 14,
  },
  refreshBtn: {
    marginLeft: 8,
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#1b2433',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: { color: '#5e9bff', fontSize: 20, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#11151e',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1c2230',
  },
  chipSel: { backgroundColor: '#16233a', borderColor: '#2563eb' },
  chipText: { color: '#9aa4b2', fontSize: 13 },
  chipTextSel: { color: '#fff', fontWeight: '600' },
  loader: { paddingVertical: 14 },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
  },
  modelRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1c2230',
  },
  modelName: { color: '#cbd5e1', fontSize: 15 },
  modelNameSel: { color: '#fff', fontWeight: '600' },
  modelSize: { color: '#5b6472', fontSize: 12, marginTop: 2 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2a3344',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSel: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  muted: { color: '#5b6472', fontSize: 14, paddingVertical: 6 },
  error: { color: '#f87171', fontSize: 13, marginTop: 10, marginLeft: 4 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#11151e',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: '#1c2230',
  },
  linkText: { color: '#e5e7eb', fontSize: 15 },
  linkChevron: { color: '#5b6472', fontSize: 20 },
  help: { color: '#5b6472', fontSize: 12, marginTop: 8, marginLeft: 4 },
  saveBtn: {
    marginTop: 28,
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#2a3344' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
