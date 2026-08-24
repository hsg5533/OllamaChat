import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE_HOST = 'ollama.host';
const STORE_MODEL = 'ollama.model';
const STORE_API_TYPE = 'ollama.apiType';
const STORE_OFFLINE_MODE = 'ollama.offline';
export type ApiType = 'ollama' | 'llama';
export const DEFAULT_HOST = 'http://192.168.0.27:11434';
export const DEFAULT_MODEL = 'gemma4:e4b';
export const DEFAULT_API_TYPE: ApiType = 'ollama';
// When on, always answer with the on-device model — the server is never
// contacted (as opposed to only falling back to it when unreachable).
export const DEFAULT_OFFLINE_MODE = false;

interface SettingsValue {
  host: string;
  model: string;
  apiType: ApiType;
  offline: boolean;
  ready: boolean;
  save: (
    host: string,
    model: string,
    apiType: ApiType,
    offline: boolean,
  ) => Promise<void>;
}

const SettingsContext = createContext<SettingsValue>({
  host: DEFAULT_HOST,
  model: DEFAULT_MODEL,
  apiType: DEFAULT_API_TYPE,
  offline: DEFAULT_OFFLINE_MODE,
  ready: false,
  save: async () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState(DEFAULT_HOST);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [apiType, setApiType] = useState<ApiType>(DEFAULT_API_TYPE);
  const [offline, setOffline] = useState(DEFAULT_OFFLINE_MODE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const h = await AsyncStorage.getItem(STORE_HOST);
      const m = await AsyncStorage.getItem(STORE_MODEL);
      const a = await AsyncStorage.getItem(STORE_API_TYPE);
      const o = await AsyncStorage.getItem(STORE_OFFLINE_MODE);
      if (h) setHost(h);
      if (m) setModel(m);
      if (a === 'ollama' || a === 'llama') setApiType(a);
      if (o) setOffline(o === 'true');
      setReady(true);
    })();
  }, []);

  const save = async (
    newHost: string,
    newModel: string,
    newApiType: ApiType,
    newOffline: boolean,
  ) => {
    setHost(newHost);
    setModel(newModel);
    setApiType(newApiType);
    setOffline(newOffline);
    await AsyncStorage.setItem(STORE_HOST, newHost);
    await AsyncStorage.setItem(STORE_MODEL, newModel);
    await AsyncStorage.setItem(STORE_API_TYPE, newApiType);
    await AsyncStorage.setItem(STORE_OFFLINE_MODE, String(newOffline));
  };

  return (
    <SettingsContext.Provider
      value={{ host, model, apiType, offline, ready, save }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
