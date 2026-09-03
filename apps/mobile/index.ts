import { registerRootComponent } from 'expo';
import React from 'react';
import { installGlobalHandlers, log, readLog, describeError } from './src/diagnostics/log';
import { markBootStart } from './src/diagnostics/boot';
import { FatalErrorScreen } from './src/diagnostics/FatalErrorScreen';

/**
 * Point d'entrée protégé.
 *
 * Si le chargement de l'application échoue (module natif absent, erreur à
 * l'évaluation d'un module), on n'affiche pas un écran noir : on enregistre
 * l'erreur et on affiche un rapport partageable depuis le téléphone.
 */
installGlobalHandlers();
markBootStart();

let Root: React.ComponentType;
try {
  // Import dynamique : une exception ici est capturée au lieu de fermer l'app.
  Root = (require('./App') as { default: React.ComponentType }).default;
} catch (error) {
  log('error', "Échec du chargement de l'application", error);
  const message = describeError(error);
  const logText = readLog();
  Root = function BootFailure() {
    return React.createElement(FatalErrorScreen, { message, log: logText });
  };
}

registerRootComponent(Root);
