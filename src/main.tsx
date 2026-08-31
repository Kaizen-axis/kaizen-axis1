import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppProvider } from './context/AppContext.tsx'
import { NotificationProvider } from './context/NotificationContext.tsx'
import { ChatUnreadProvider } from './context/ChatUnreadContext.tsx'

// ── PWA: registra o Service Worker em produção ───────────────────────────────
// O SW usa estratégia cirúrgica: nunca intercepta Supabase nem métodos não-GET,
// portanto uploads de arquivos e real-time continuam funcionando normalmente.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let reloadingForServiceWorker = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForServiceWorker) return;
    reloadingForServiceWorker = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
    console.warn('[PWA] Falha ao registrar Service Worker:', err);
  });
}

import { Component, ReactNode } from 'react';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red', background: '#fff' }}>
          <h1>Algo deu errado.</h1>
          <pre>{this.state.error?.message}</pre>
          <pre>{this.state.error?.stack}</pre>
          <button onClick={() => { localStorage.clear(); window.location.reload(); }}>
            Limpar Dados e Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <NotificationProvider>
          <ChatUnreadProvider>
            <App />
          </ChatUnreadProvider>
        </NotificationProvider>
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
)
