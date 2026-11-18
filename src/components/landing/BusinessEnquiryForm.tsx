import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {enquiryCategories,enquiryDelivery,normalizeMXPhone} from '../../lib/businessEnquiry';
const initial={business_name:'',contact_name:'',email:'',phone:'',city:'',category:'',delivery:'',message:'',website:'',consent:false};
export default function BusinessEnquiryForm(){
 const [form,setForm]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reference,setReference]=useState<string|null>(null);
 const request=useRef<string|null>(null),pending=useRef(''),success=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(reference){success.current?.scrollIntoView({block:'center',behavior:'instant'});success.current?.focus({preventScroll:true});}},[reference]);
 const change=(key:keyof typeof initial,value:string|boolean)=>setForm(p=>({...p,[key]:value}));
 async function submit(event:FormEvent){event.preventDefault();if(busy)return;setError('');if([form.business_name,form.contact_name,form.city].some(v=>v.trim().length<2)){setError('Escribe el nombre del negocio, tu nombre y la localidad con al menos dos caracteres.');return;}const phone=normalizeMXPhone(form.phone);if(!phone){setError('Revisa el WhatsApp: escribe 10 dígitos de México, con +52 si lo prefieres.');return;}
  const payload={...form,business_name:form.business_name.trim(),contact_name:form.contact_name.trim(),email:form.email.trim(),city:form.city.trim(),phone};const serialized=JSON.stringify(payload);
  if(!request.current||pending.current!==serialized){request.current=crypto.randomUUID();pending.current=serialized;}
  setBusy(true);try{const {supabase}=await import('../../lib/supabase');const r=await supabase.rpc('submit_business_enquiry',{p_payload:payload,p_request:request.current});if(r.error)throw r.error;if(!r.data?.received)throw Error('not_confirmed');setReference(r.data.reference||'Solicitud recibida');}
  catch(e){const code=(e as Error)?.message||'';setError(code.includes('contact_limit_reached')?'Ya recibimos varias solicitudes con estos datos. Nuestro equipo las revisará; inténtalo más tarde si necesitas actualizar algo.':code.includes('request_limit_reached')?'Estamos recibiendo muchas solicitudes. Inténtalo en un momento.':code.includes('invalid_contact_details')?'Revisa los datos de contacto, la localidad y la autorización antes de enviar.':'No pudimos confirmar el envío. Tus datos siguen aquí: revisa la conexión e inténtalo de nuevo.');}
  finally{setBusy(false);}
 }
 if(reference)return <div ref={success} tabIndex={-1} className="lp-form-success" role="status"><span className="lp-success-mark" aria-hidden="true">✓</span><span className="lp-eyebrow">EL PRIMER PASO YA ESTÁ</span><h3>¡Recibimos tu solicitud!</h3><p>El equipo de PideYa te contactará para revisar tu negocio y los siguientes pasos.</p><div className="lp-request-ref">Tu referencia<strong>{reference}</strong></div><p className="lp-small">La incorporación está sujeta a revisión de datos, condiciones y cobertura.</p><a className="lp-button" href="#inicio">Volver al inicio <span aria-hidden="true">↗</span></a></div>;
 return <form className="lp-lead-form" onSubmit={e=>void submit(e)} aria-label="Solicitud para sumar mi negocio">
  <div className="lp-form-heading"><span className="lp-eyebrow">HABLEMOS DE TU NEGOCIO</span><h3>Queremos conocerte.</h3><p>Déjanos tus datos y el equipo de PideYa te contactará.</p></div>
  <fieldset disabled={busy}><legend className="lp-sr-only">Datos de tu solicitud</legend><div className="lp-form-grid">
   <label>Nombre del negocio<input name="business_name" autoComplete="organization" required minLength={2} maxLength={160} value={form.business_name} onChange={e=>change('business_name',e.target.value)} placeholder="¿Cómo se llama tu negocio?"/></label>
   <label>Tu nombre<input name="contact_name" autoComplete="name" required minLength={2} maxLength={100} value={form.contact_name} onChange={e=>change('contact_name',e.target.value)} placeholder="Nombre de contacto"/></label>
   <label>WhatsApp<input name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20} value={form.phone} onChange={e=>change('phone',e.target.value)} placeholder="Ej. 331 234 5678" aria-describedby="lp-phone-help"/></label>
   <label>Correo electrónico<input name="email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={e=>change('email',e.target.value)} placeholder="tu@negocio.com"/></label>
   <label>Ciudad o localidad<input name="city" autoComplete="address-level2" required minLength={2} maxLength={100} value={form.city} onChange={e=>change('city',e.target.value)} placeholder="Ej. Arandas, Jalisco"/></label>
   <label>Tipo de negocio<select name="category" required value={form.category} onChange={e=>change('category',e.target.value)}><option value="" disabled>Selecciona una opción</option>{enquiryCategories.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
   <label className="lp-field-wide">¿Cómo manejas tus entregas?<select name="delivery" required value={form.delivery} onChange={e=>change('delivery',e.target.value)}><option value="" disabled>Cuéntanos un poco</option>{enquiryDelivery.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
   <label className="lp-field-wide">¿Qué te gustaría contarnos? <span className="lp-optional">Opcional</span><textarea name="message" maxLength={1500} rows={3} value={form.message} onChange={e=>change('message',e.target.value)} placeholder="Qué vendes, dónde estás o qué necesitas para empezar."/></label>
  </div><p id="lp-phone-help" className="lp-small">Usaremos tu WhatsApp y correo para dar seguimiento a esta solicitud.</p>
  <div className="lp-honeypot" aria-hidden="true"><label>Tu sitio web<input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={e=>change('website',e.target.value)}/></label></div>
  <label className="lp-consent"><input name="consent" type="checkbox" required checked={form.consent} onChange={e=>change('consent',e.target.checked)}/><span>He leído el <Link to="/aviso-privacidad" target="_blank" rel="noreferrer">Aviso de Privacidad</Link> y autorizo a PideYa a contactarme sobre mi solicitud.</span></label>
  {!!error&&<p className="lp-form-error" role="alert">{error}</p>}
  <button className="lp-button lp-submit" disabled={busy} aria-busy={busy} type="submit">{busy?'Enviando tu solicitud…':'Quiero mi negocio en PideYa'}<span aria-hidden="true">↗</span></button>
  <p className="lp-small lp-form-footnote">Tu alta se confirma después de revisar los datos, las condiciones y la cobertura.</p>
  </fieldset>
 </form>;
}
