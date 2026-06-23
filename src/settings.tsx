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
const STORE_CONTEXT = 'ollama.numCtx';
// Physical device: your PC's LAN IP. Android emulator: http://10.0.2.2:11434
export const DEFAULT_HOST = 'http://192.168.0.27:11434';
export const DEFAULT_MODEL = 'gemma4:e4b';
// Context window. Larger fits longer chats and image tokens; needs more RAM.
export const DEFAULT_CONTEXT = 8192;

interface SettingsValue {
  host: string;
  model: string;
  context: number;
  ready: boolean;
  save: (host: string, model: string, context: number) => Promise<void>;
}

const SettingsContext = createContext<SettingsValue>({
  host: DEFAULT_HOST,
  model: DEFAULT_MODEL,
  context: DEFAULT_CONTEXT,
  ready: false,
  save: async () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState(DEFAULT_HOST);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const h = await AsyncStorage.getItem(STORE_HOST);
      const m = await AsyncStorage.getItem(STORE_MODEL);
      const n = await AsyncStorage.getItem(STORE_CONTEXT);
      if (h) setHost(h);
      if (m) setModel(m);
      if (n) setContext(Number(n) || DEFAULT_CONTEXT);
      setReady(true);
    })();
  }, []);

  const save = async (
    newHost: string,
    newModel: string,
    newContext: number,
  ) => {
    setHost(newHost);
    setModel(newModel);
    setContext(newContext);
    await AsyncStorage.setItem(STORE_HOST, newHost);
    await AsyncStorage.setItem(STORE_MODEL, newModel);
    await AsyncStorage.setItem(STORE_CONTEXT, String(newContext));
  };

  return (
    <SettingsContext.Provider value={{ host, model, context, ready, save }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
