import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationProvider, useNavigation } from './src/navigation';
import { HomeScreen } from './src/screens/HomeScreen';
import { EditorScreen } from './src/screens/EditorScreen';
import { WizardScreen } from './src/screens/WizardScreen';

function Router() {
  const { route } = useNavigation();
  switch (route.name) {
    case 'editor':
      return <EditorScreen key={route.albumId} albumId={route.albumId} />;
    case 'wizard':
      return <WizardScreen />;
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationProvider>
          <StatusBar style="dark" />
          <Router />
        </NavigationProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
