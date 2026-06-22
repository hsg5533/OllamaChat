/**
 * Ollama Chat — tool-calling agent on a phone, talking to Ollama on your PC.
 *
 * @format
 */

import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {
  NavigationContainer,
  DefaultTheme,
  type Theme,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SettingsProvider} from './src/settings';
import ChatScreen from './src/ChatScreen';
import SettingsScreen from './src/SettingsScreen';

const Stack = createNativeStackNavigator();

const navTheme: Theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: '#0b0d12',
    card: '#0b0d12',
    text: '#ffffff',
    border: '#1c2230',
    primary: '#2563eb',
  },
};

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b0d12" />
      <SettingsProvider>
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              contentStyle: {backgroundColor: '#0b0d12'},
            }}>
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

export default App;
