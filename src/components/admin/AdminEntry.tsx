import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {supabase} from '../../lib/supabase';
import {boundedStaffAccess,StaffContext,type StaffAccess} from '../../lib/staffAccess';
const App=lazy(()=>import('../../App'));
const StaffWorkspace=lazy(()=>import('./StaffWorkspace'));
export default function AdminEntry(){
 const [access,setAccess]=useState<StaffAccess|null>(null),[loading,setLoading]=useState(true),[signedIn,setSignedIn]=useState(false),[error,setError]=useState(false);
 const generation=useRef(0);
 const refresh=async()=>{
  const n=++generation.current;
  try{
   const result=await boundedStaffAccess(async()=>{
    const session=await supabase.auth.getSession();if(session.error)throw session.error;
    if(!session.data.session)return {signedIn:false,access:null};
    const r=await supabase.rpc('staff_my_access');if(r.error)throw r.error;
    return {signedIn:true,access:r.data as StaffAccess};
   });
   if(n===generation.current){setSignedIn(result.signedIn);setAccess(result.access);setError(false);setLoading(false);}
  }catch{if(n===generation.current){setError(true);setLoading(false);}}
 };
 useEffect(()=>{
  void refresh();
  const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{setTimeout(()=>void refresh(),0);});
  const focus=()=>{if(document.visibilityState==='visible')void refresh();};
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  const timer=setInterval(focus,30000);
  return()=>{generation.current++;subscription.unsubscribe();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[]);
 if(loading)return <div className="route-loading" role="status">Comprobando acceso…</div>;
 if(error)return <main className="route-message" role="alert"><h1>No pudimos verificar tu acceso</h1><p>Revisa tu conexión. No se han cambiado tus permisos.</p><button onClick={()=>{setLoading(true);void refresh();}}>Volver a intentar</button></main>;
 if(signedIn&&!access?.active)return <main className="route-message"><h1>Sin acceso al equipo</h1><p>Esta cuenta no tiene un acceso activo al panel. Contacta al superadmin principal.</p><button onClick={()=>void supabase.auth.signOut()}>Usar otra cuenta</button></main>;
 return <StaffContext.Provider value={access}><Suspense fallback={<div className="route-loading" role="status">Abriendo tu espacio…</div>}>{access?.active&&!access.full?<StaffWorkspace access={access}/>:<App/>}</Suspense></StaffContext.Provider>;
}
