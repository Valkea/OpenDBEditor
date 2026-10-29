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

// Cache the whole app so it keeps working with no network (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}

// Dev-only handle for browser automation and debugging.
if (import.meta.env.DEV) {
  void import('./store/store').then(({ useStore }) => {
    (window as unknown as { __odbe: typeof useStore }).__odbe = useStore;
  });
}
