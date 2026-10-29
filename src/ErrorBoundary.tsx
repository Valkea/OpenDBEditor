import { Component, type ReactNode } from 'react';

/** Show the error instead of an empty page; the schema is safe in the URL, so a reload recovers. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>Something went wrong.</h2>
        <p>Your schema is still in the address bar — reloading brings it back.</p>
        <pre>{this.state.error.message}</pre>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
