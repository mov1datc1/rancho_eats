export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(n);
export function renderReceipt(s) {
  for (const key of ['total','subtotal','delivery','fee']) {
    if (s[key] === null || s[key] === undefined || !Number.isFinite(Number(s[key])) || Number(s[key]) < 0) throw new Error('INVALID_SUMMARY');
  }
  if (Math.abs(Number(s.total)-Number(s.subtotal)-Number(s.delivery)-Number(s.fee)) > 0.011) throw new Error('INVALID_SUMMARY');
  if (!Array.isArray(s.items) || s.items.length > 100) throw new Error('INVALID_SUMMARY');
  const items = s.items.map(i => {
    if (!Number.isFinite(Number(i.qty)) || Number(i.qty)<=0 || !Number.isFinite(Number(i.amount)) || Number(i.amount)<0) throw new Error('INVALID_SUMMARY');
    return { name:String(i.name).slice(0,200), qty:Number(i.qty), amount:Number(i.amount) };
  });
  // Incomplete legacy breakdowns must not produce misleading receipts.
  if (Math.abs(items.reduce((sum,i)=>sum+i.amount,0)-Number(s.subtotal))>0.02) throw new Error('ITEM_TOTAL_MISMATCH');
  const date = new Intl.DateTimeFormat('es-MX', { timeZone:'America/Mexico_City', dateStyle:'long', timeStyle:'short' }).format(new Date(s.delivered_at));
  const reference=String(s.reference).replace(/[\r\n]/g,' ').slice(0,80);
  const payment={cash:'Efectivo',card:'Tarjeta'}[s.payment_method] || 'Consulta tu pedido en la app';
  const row=(label,value,bold=false)=>`<tr><td style="padding:9px 0;${bold?'font-weight:bold;':''}">${escapeHtml(label)}</td><td align="right" style="padding:9px 0;white-space:nowrap;${bold?'font-size:24px;font-weight:bold;color:#247362;':''}">${escapeHtml(value)}</td></tr>`;
  const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu pedido fue entregado</title></head>
<body style="margin:0;background:#F7F5EF;color:#1E293B;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">Gracias por pedir con PideYa. Aquí está el resumen final de tu pedido.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">
<tr><td style="padding:4px 12px 24px"><span style="font-size:24px;font-weight:bold;color:#247362">PideYa</span></td></tr>
<tr><td style="background:#FFFFFF;border-radius:24px;padding:28px 24px"><p style="margin:0 0 12px;color:#247362;font-size:13px;font-weight:bold;letter-spacing:1px">PEDIDO ENTREGADO</p><h1 style="font-size:30px;line-height:1.2;margin:0 0 12px">Tu pedido,<br>entregado.</h1><p style="font-size:16px;line-height:1.6;margin:0 0 24px">Gracias por pedir con PideYa. Este es tu resumen final.</p>
<div style="background:#F1F7F5;border-radius:14px;padding:16px;overflow-wrap:anywhere"><strong>${escapeHtml(s.restaurant)}</strong><br><span style="font-size:14px;line-height:1.8">${escapeHtml(reference)} · ${escapeHtml(date)}</span></div>
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;margin-top:18px">${items.map(i=>row(`${i.qty} × ${i.name}`,money(i.amount))).join('')}</table>
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;border-top:1px solid #E2E8F0;margin-top:12px">${row('Productos',money(s.subtotal))}${row('Envío',money(s.delivery))}${row('Servicio PideYa',money(s.fee))}${row('Total final',`${money(s.total)} MXN`,true)}</table>
<p style="font-size:14px;color:#64748B">Forma de pago: ${escapeHtml(payment)}</p><p style="font-size:14px;line-height:1.6">Puedes consultar este pedido desde el historial de tu cuenta en la app.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#247362" style="border-radius:24px"><a href="https://www.pide-ya.app/" style="display:inline-block;padding:14px 24px;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;border-radius:24px">Ir a PideYa</a></td></tr></table></td></tr>
<tr><td style="padding:22px 14px;color:#64748B;font-size:12px;line-height:1.7">Recibes este resumen porque realizaste un pedido con tu cuenta de PideYa. Es un mensaje de tu pedido, sin promociones.<br>¿Necesitas ayuda? Abre el pedido en la app.</td></tr></table></td></tr></table></body></html>`;
  const text=`PideYa — Pedido entregado\n${s.restaurant}\n${reference} · ${date}\n\n${items.map(i=>`${i.qty} × ${i.name}: ${money(i.amount)}`).join('\n')}\n\nProductos: ${money(s.subtotal)}\nEnvío: ${money(s.delivery)}\nServicio PideYa: ${money(s.fee)}\nTotal final: ${money(s.total)} MXN\nForma de pago: ${payment}\n\nConsulta el pedido en el historial de tu cuenta en la app.\nhttps://www.pide-ya.app/\n\nEste es un resumen de tu pedido, sin promociones.`;
  return { subject:`Tu pedido ${reference} fue entregado · PideYa`, html, text };
}
