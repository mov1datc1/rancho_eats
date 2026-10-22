import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { notificationV2 } from '../lib/notificationDevice';

type Incident = { id: string; order_id: string; created_at: string };
export default function NotificationOperations() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!notificationV2) return;
    let disposed = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      const result = await supabase.from('notification_incidents').select('id,order_id,created_at')
        .is('resolved_at', null).order('created_at', { ascending: true }).limit(50);
      if (disposed) return;
      if (result.error) setError('No se pudieron consultar los pedidos sin atención. Revisa la conexión.');
      else { setError(''); setIncidents(result.data || []); }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  if (!notificationV2) return null;
  return <section aria-label="Pedidos sin atención" style={{ marginTop: 24 }}>
    <h4>Pedidos pendientes de aceptación</h4>
    <p>Si un negocio lleva más de siete minutos sin aceptar, contacta al negocio y revisa el pedido.</p>
    {error ? <p role="alert">{error}</p> : incidents.length === 0 ? <p>No hay incidencias pendientes registradas.</p> :
      <ul>{incidents.map(item => <li key={item.id}>Pedido {item.order_id} — incidencia desde {new Date(item.created_at).toLocaleTimeString('es-MX')}</li>)}</ul>}
  </section>;
}
