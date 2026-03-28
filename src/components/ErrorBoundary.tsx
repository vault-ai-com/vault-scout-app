import React, { Component, type ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { isChunkLoadError } from '@/lib/lazy-retry';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Caught error:', error);

    if (isChunkLoadError(error)) {
      const key = 'eb_chunk_reload_' + window.location.pathname;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
        return;
      }
      sessionStorage.removeItem(key);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    window.location.href = import.meta.env.BASE_URL || '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      if (this.props.fallbackMessage) {
        return (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="p-3 rounded-full mb-4" style={{ background: 'hsl(var(--destructive) / 0.1)' }}>
              <AlertCircle className="w-6 h-6" aria-hidden="true" style={{ color: 'hsl(var(--destructive))' }} />
            </div>
            <p className="text-sm mb-4 max-w-md" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {this.props.fallbackMessage}
            </p>
            <button type="button" onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground">
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Försök igen
            </button>
          </div>
        );
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="max-w-md w-full rounded-2xl p-8 text-center"
            style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ background: 'hsl(var(--destructive) / 0.1)' }}>
              <AlertCircle className="w-8 h-8 text-destructive" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-bold mb-2 text-foreground">Något gick fel</h2>
            <p className="text-sm mb-6 text-muted-foreground">
              Ett oväntat fel inträffade. Försök att ladda om sidan.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <details className="mb-6 text-left">
                <summary className="text-xs cursor-pointer mb-2 text-muted-foreground">Tekniska detaljer</summary>
                <pre className="text-xs p-3 rounded-lg overflow-auto max-h-40 bg-muted text-foreground">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            <div className="flex gap-3 justify-center">
              <button type="button" onClick={this.handleGoHome}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border text-foreground">
                <Home className="w-4 h-4" aria-hidden="true" />
                Startsida
              </button>
              <button type="button" onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground">
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Försök igen
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
