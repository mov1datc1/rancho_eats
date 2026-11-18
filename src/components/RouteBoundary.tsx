import { Component, type ReactNode } from 'react';

export default class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="route-message" role="alert"><h1>No pudimos abrir PideYa</h1><p>Revisa tu conexión y vuelve a intentarlo.</p><button onClick={() => window.location.reload()}>Volver a intentar</button><a href="/">Ir al inicio</a></main>;
  }
}
