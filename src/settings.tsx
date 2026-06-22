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
// Physical device: your PC's LAN IP. Android emulator: http://10.0.2.2:11434
export const DEFAULT_HOST = 'http://192.168.0.27:11434';
export const DEFAULT_MODEL = 'gemma4:e4b';

interface SettingsValue {
  host: string;
  model: string;
  ready: boolean;
  save: (host: string, model: string) => Promise<void>;
}

const SettingsContext = createContext<SettingsValue>({
  host: DEFAULT_HOST,
  model: DEFAULT_MODEL,
  ready: false,
  save: async () => {},
});

export function SettingsProvider({children}: {children: ReactNode}) {
  const [host, setHost] = useState(DEFAULT_HOST);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const h = await AsyncStorage.getItem(STORE_HOST);
      const m = await AsyncStorage.getItem(STORE_MODEL);
      if (h) setHost(h);
      if (m) setModel(m);
      setReady(true);
    })();
  }, []);

  const save = async (newHost: string, newModel: string) => {
    setHost(newHost);
    setModel(newModel);
    await AsyncStorage.setItem(STORE_HOST, newHost);
    await AsyncStorage.setItem(STORE_MODEL, newModel);
  };

  return (
    <SettingsContext.Provider value={{host, model, ready, save}}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
