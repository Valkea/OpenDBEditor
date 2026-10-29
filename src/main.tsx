import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@xyflow/react/dist/base.css';
import './styles/app.css';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Dev-only handle for browser automation and debugging.
if (import.meta.env.DEV) {
  void import('./store/store').then(({ useStore }) => {
    (window as unknown as { __odbe: typeof useStore }).__odbe = useStore;
  });
}
