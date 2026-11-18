import {createContext,useContext} from 'react';
export type StaffAccess={user_id:string;owner:boolean;full:boolean;active:boolean;name:string;role:string;permissions:string[]};
export const StaffContext=createContext<StaffAccess|null>(null);
export const useStaffAccess=()=>useContext(StaffContext);
export async function boundedStaffAccess<T>(work:()=>Promise<T>,timeout=15000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('ACCESS_TIMEOUT')),timeout);})]);}
 finally{if(timer)clearTimeout(timer);}
}
export const STAFF_PERMISSIONS=[
 ['orders.read','Consultar pedidos'],['orders.write','Cambiar estados de pedidos'],
 ['commissions.read','Consultar comisiones y recibos'],['commissions.collect','Registrar cobros'],
 ['businesses.read','Consultar negocios'],['leads.read','Consultar solicitudes de negocios'],['incidents.read','Consultar incidencias de pedidos'],
 ['admin.full','Administrar toda la plataforma (sin gestionar accesos)']
] as const;
export function normalizeStaffPermissions(values:string[]){
 const result=new Set(values);
 if(result.has('orders.write'))result.add('orders.read');
 if(result.has('commissions.collect'))result.add('commissions.read');
 return [...result].filter(p=>STAFF_PERMISSIONS.some(([id])=>id===p)).sort();
}
export function staffError(message:string){
 if(message==='auth_email_not_configured')return 'Falta conectar el correo de acceso (SMTP de Supabase Auth). Por ahora puedes dar acceso a cuentas existentes con correo confirmado.';
 const errors:Record<string,string>={not_authorized:'Tu perfil no permite esta acción.',member_changed_refresh:'El acceso cambió. Actualiza antes de guardar.',role_changed_refresh:'El rol cambió. Actualiza antes de guardar.',protected_account:'La cuenta principal está protegida.',member_exists:'Esta cuenta ya pertenece al equipo.',confirmed_account_required:'No encontramos una cuenta con ese correo confirmado. Usa la invitación para crearla.',account_exists_use_existing:'Ese correo ya tiene cuenta. Selecciona «Dar acceso a cuenta existente».',email_rate_limit:'Espera 90 segundos antes de reenviar. Límite de 20 solicitudes al día.',auth_rate_limit:'El servicio de correo alcanzó su límite. Reintenta más tarde.',auth_email_failed:'No se pudo solicitar el correo. Revisa el SMTP de Supabase Auth.',email_requested_access_pending_review:'El correo se solicitó, pero el alta necesita revisión. Actualiza el listado antes de repetir.',order_changed_refresh:'El pedido cambió. Actualiza la lista.',use_delivery_or_picking_workflow:'Este cambio requiere el flujo de entrega o surtido.',order_has_custody:'El pedido tiene una entrega con custodia. Gestiona primero su retorno.',reason_required:'Describe el motivo del cambio (mínimo 10 caracteres).'};
 return errors[message]||'No se pudo completar la acción. Actualiza y vuelve a intentar.';
}
