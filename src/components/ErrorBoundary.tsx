import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null; incidentId: string | null };

function incidentId() {
  try { return crypto.randomUUID(); } catch { return `ui-${Date.now()}`; }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, incidentId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, incidentId: incidentId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('userFLEX Admin UI error', {
      incidentId: this.state.incidentId,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="login-screen">
        <div className="login-card" style={{ maxWidth: 620 }}>
          <h2>userFLEX se recuperó de un error de interfaz</h2>
          <p>La página no continuará en un estado incompleto. Recarga el panel para volver a sincronizar los datos.</p>
          <p className="help">Código de diagnóstico: {this.state.incidentId}</p>
          <button className="button primary" onClick={() => window.location.reload()}>Recargar panel</button>
        </div>
      </main>
    );
  }
}
