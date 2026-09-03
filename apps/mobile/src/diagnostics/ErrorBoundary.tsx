import React from 'react';
import { FatalErrorScreen } from './FatalErrorScreen';
import { describeError, log, readLog } from './log';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: unknown;
}

/** Empêche une erreur de rendu de fermer l'application ; affiche le détail. */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    log('error', `Erreur de rendu React${info.componentStack ? `\n${info.componentStack}` : ''}`, error);
  }

  override render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <FatalErrorScreen
          title="Une erreur est survenue"
          message={describeError(this.state.error)}
          log={readLog()}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
