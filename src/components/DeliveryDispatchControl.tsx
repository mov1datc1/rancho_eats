import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
export default function DeliveryDispatchControl({ orderId, status, onChange }: {
    orderId: string;
    status: string;
    onChange: () => void;
}) {
    const [offer, setOffer] = useState<any>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const load = useCallback(async () => { const r = await supabase.from('delivery_offers').select('*,driver_profiles(name)').eq('order_id', orderId).order('offered_at', { ascending: false }).limit(1).maybeSingle(); if (r.error) {
        setMessage('No se pudo verificar la oferta.');
        return;
    } setOffer(r.data); }, [orderId]);
    useEffect(() => { void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [load, status]);
    const act = async (name: string, args: Record<string, unknown>) => { setBusy(true); try {
        const r = await supabase.rpc(name, args);
        if (r.error)
            throw r.error;
        await load();
        onChange();
        setMessage('Operación guardada.');
    }
    catch {
        setMessage('No se pudo guardar. Actualiza el pedido, turno y custodia.');
    }
    finally {
        setBusy(false);
    } };
    const labels: Record<string, string> = { OFFERED: 'Esperando confirmación', ACCEPTED: 'Confirmado por repartidor', HANDOVER: 'Paquete bajo custodia', PICKED: 'Recogida confirmada', DECLINED: 'Rechazada', EXPIRED: 'Vencida', CANCELLED: 'Cancelada', RELEASED: 'Reserva liberada', CLOSED: 'Finalizado' };
    return <section className="admin-card"><h4>Oferta de reparto</h4>{offer && <><p>{offer.driver_profiles?.name} · {labels[offer.state] || 'Actualizar estado'}</p>{offer.note && <p>{offer.note}</p>}{offer.state === 'OFFERED' && <p>Vence: {new Date(offer.expires_at).toLocaleString('es-MX')}. La notificación no confirma aceptación.</p>}{offer.state === 'ACCEPTED' && <button className="btn" disabled={busy || status !== 'READY'} onClick={() => { if (window.confirm('¿Entregaste físicamente el paquete a este repartidor? Quedará bajo su custodia.'))
        void act('merchant_confirm_handover', { p_offer_id: offer.id }); }}>Entregué el paquete al repartidor</button>}{['OFFERED', 'ACCEPTED'].includes(offer.state) && <button className="btn ghost" disabled={busy} onClick={() => { const note = window.prompt('Motivo para retirar la oferta o reserva (mínimo 5 caracteres)'); if (note && note.trim().length >= 5)
        void act('release_delivery_reservation', { p_order_id: orderId, p_offer_id: offer.id, p_note: note, p_token: null }); }}>Retirar oferta / reserva</button>}</>}{!['HANDOVER', 'PICKED', 'CLOSED'].includes(offer?.state) && ['ACCEPTED', 'PREPARING', 'PICKING', 'ADJUSTED', 'READY'].includes(status) && <button className="btn ghost" disabled={busy} onClick={() => { const note = window.prompt('Solo si no puedes atender el reparto y el paquete no fue recogido: motivo para el cliente'); if (note && note.trim().length >= 5 && window.confirm('¿Cancelar el pedido y avisar al cliente con este motivo?'))
        void act('merchant_cancel_uncollected_delivery', { p_order_id: orderId, p_note: note }); }}>No puedo atender este reparto</button>}{message && <p role="status">{message}</p>}<button className="btn ghost" disabled={busy} onClick={() => void load()}>Actualizar oferta</button></section>;
}
