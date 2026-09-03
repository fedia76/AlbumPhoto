import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationProvider, useNavigation } from './src/navigation';
import { HomeScreen } from './src/screens/HomeScreen';
import { EditorScreen } from './src/screens/EditorScreen';
import { WizardScreen } from './src/screens/WizardScreen';
import { DiagnosticsScreen } from './src/screens/DiagnosticsScreen';
import { ErrorBoundary } from './src/diagnostics/ErrorBoundary';
import { markBootSucceeded } from './src/diagnostics/boot';
import { describeError, log, readLog, setFatalHandler } from './src/diagnostics/log';
import { FatalErrorScreen } from './src/diagnostics/FatalErrorScreen';

function Router() {
  const { route } = useNavigation();
  switch (route.name) {
    case 'editor':
      return <EditorScreen key={route.albumId} albumId={route.albumId} />;
    case 'wizard':
      return <WizardScreen />;
    case 'diagnostics':
      return <DiagnosticsScreen />;
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  const [fatal, setFatal] = useState<unknown>(null);

  useEffect(() => {
    // L'interface est montée : le démarrage est allé jusqu'au bout.
    markBootSucceeded();
    log('info', 'Interface affichée');
    // Une erreur fatale affiche un rapport au lieu de fermer l'application.
    setFatalHandler((error) => setFatal(error));
  }, []);

  const dismissFatal = useCallback(() => setFatal(null), []);

  if (fatal !== null) {
    return <FatalErrorScreen title="Une erreur est survenue" message={describeError(fatal)} log={readLog()} onRetry={dismissFatal} />;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <NavigationProvider>
            <StatusBar style="dark" />
            <Router />
          </NavigationProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
