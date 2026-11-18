import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
export default function DriverOffersControl({ token, onChange }: {
    token: string;
    onChange: () => void;
}) {
    const [offers, setOffers] = useState<any[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const load = useCallback(async () => { const r = await supabase.rpc('driver_delivery_offers', { p_token: token }); if (r.error) {
        setMessage('No se pudieron verificar las ofertas.');
        return;
    } setOffers(r.data || []); }, [token]);
    useEffect(() => { void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [load]);
    const act = async (name: string, args: Record<string, unknown>) => { setBusy(true); try {
        const r = await supabase.rpc(name, { p_token: token, ...args });
        if (r.error)
            throw r.error;
        await load();
        onChange();
        setMessage('Respuesta guardada.');
    }
    catch {
        setMessage('No se pudo guardar. Actualiza la oferta, el turno y la custodia.');
    }
    finally {
        setBusy(false);
    } };
    return <section className="driver-panel"><h3>Ofertas y recogida</h3>{message && <p role="status">{message}</p>}{offers.map(o => <article className="incoming-order" key={o.id}><h4>Pedido #{o.order_number}</h4><p>{o.client_location_note || 'Revisa el destino'} · Cobro previsto: ${Number(o.expected_cash).toFixed(2)}</p>{typeof o.client_lat === 'number' && typeof o.client_lng === 'number' && <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${o.client_lat},${o.client_lng}`}>Ver destino</a>}
 {o.state === 'OFFERED' && <><p>Responde antes de {new Date(o.expires_at).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })}</p><button className="btn green" disabled={busy || Date.parse(o.expires_at) <= Date.now()} onClick={() => void act('driver_reply_delivery', { p_offer_id: o.id, p_accept: true, p_note: null })}>Aceptar reparto</button><button className="btn ghost" disabled={busy} onClick={() => { const note = window.prompt('Motivo del rechazo (mínimo 5 caracteres)'); if (note && note.trim().length >= 5)
            void act('driver_reply_delivery', { p_offer_id: o.id, p_accept: false, p_note: note }); }}>No puedo llevarlo</button></>}
 {o.state === 'ACCEPTED' && <><p>Reserva confirmada. El negocio debe confirmar que te entrega el paquete.</p><button className="btn ghost" disabled={busy} onClick={() => { const note = window.prompt('Motivo para liberar sin recoger'); if (note && note.trim().length >= 5)
            void act('release_delivery_reservation', { p_order_id: o.order_id, p_offer_id: o.id, p_note: note }); }}>Ya no puedo llevarlo</button></>}
 {o.state === 'HANDOVER' && <button className="btn green" disabled={busy} onClick={async () => { setBusy(true); try {
            const r = await supabase.rpc('driver_take_order', { p_access_token: token, p_order_id: o.order_id });
            if (r.error)
                throw r.error;
            await load();
            onChange();
        }
        catch {
            setMessage('No se pudo confirmar la recogida. Actualiza el estado.');
        }
        finally {
            setBusy(false);
        } }}>Confirmar que recibí el paquete</button>}
 {o.state === 'EXPIRED' && <p>Oferta vencida.</p>}</article>)}<button className="btn ghost" disabled={busy} onClick={() => void load()}>Actualizar ofertas</button></section>;
}
