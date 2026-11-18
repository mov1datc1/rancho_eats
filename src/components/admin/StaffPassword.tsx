import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
import '../../shell.css';
export default function StaffPassword(){
 const [email,setEmail]=useState(''),[ready,setReady]=useState(false),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 useEffect(()=>{
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.has('error')||params.has('error_code')){setError('El enlace venció o ya fue usado. Solicita uno nuevo al superadmin.');return;}
  void supabase.auth.getUser().then(({data,error})=>{if(error||!data.user){setError('Abre el enlace que recibiste por correo. Si venció, solicita uno nuevo.');return;}setEmail(data.user.email||'');setReady(true);});
 },[]);
 const save=async(e:React.FormEvent)=>{
  e.preventDefault();setError('');
  if(password.length<12||password.length>128||password!==confirm){setError('Usa entre 12 y 128 caracteres y confirma la misma contraseña.');return;}
  setBusy(true);
  const r=await supabase.auth.updateUser({password});
  if(r.error){setError('No se pudo cambiar la contraseña. Solicita un enlace nuevo si venció.');setBusy(false);return;}
  setPassword('');setConfirm('');await supabase.auth.signOut();setDone(true);setBusy(false);
 };
 return <main className="route-message"><h1>{done?'Tu contraseña está lista':'Configura tu acceso a PideYa'}</h1>{done?<><p>Inicia sesión con tu correo y tu nueva contraseña.</p><a href="/administrador">Entrar al panel</a></>:<><p>Elige una contraseña que solo tú conozcas.</p>{email&&<p>{email}</p>}{ready&&<form onSubmit={save}><label style={{display:'block'}}>Nueva contraseña<input style={{display:'block',boxSizing:'border-box',width:'100%',padding:12,margin:'8px 0 16px'}} type="password" minLength={12} maxLength={128} autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><label style={{display:'block'}}>Confirmar contraseña<input style={{display:'block',boxSizing:'border-box',width:'100%',padding:12,margin:'8px 0'}} type="password" minLength={12} maxLength={128} autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button disabled={busy}>{busy?'Guardando…':'Guardar contraseña'}</button></form>}{error&&<p role="alert">{error}</p>}</>}</main>;
}
