import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ── Global crash catchers — log errors before the tab can die ────────────────
window.onerror = (msg, source, line, col, error) => {
  console.error('[GLOBAL ERROR]', { msg, source, line, col, stack: error?.stack });
  return false;
};
window.onunhandledrejection = (event) => {
  console.error('[UNHANDLED REJECTION]', event.reason?.stack || event.reason);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
