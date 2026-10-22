import { supabase } from './supabase';
export const notificationV2 = import.meta.env.VITE_NOTIFICATION_V2 === 'true';
const storageKey = 'pideya_web_notification_endpoint';

export async function registerWebNotifications() {
  if (!notificationV2 || !('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: ownedRestaurant, error: ownerError } = await supabase.from('restaurants').select('id').eq('owner_id', user.id).limit(1).maybeSingle();
  if (ownerError) throw ownerError;
  if (!ownedRestaurant) return; // Admin-only accounts do not receive restaurant orders.
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error('Falta configurar Web Push');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0));
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  }
  const { data: current } = await supabase.auth.getUser();
  if (current.user?.id !== user.id) return;
  const { data: id, error } = await supabase.rpc('register_notification_endpoint', {
    p_app: 'web', p_provider: 'webpush', p_token: subscription.endpoint, p_subscription: subscription.toJSON(),
  });
  if (error) throw error;
  const previous = localStorage.getItem(storageKey);
  if (previous && previous !== id) await supabase.rpc('unregister_notification_endpoint', { p_id: previous });
  localStorage.setItem(storageKey, id);
}

export async function unregisterWebNotifications() {
  const id = localStorage.getItem(storageKey);
  if (!id) return;
  const { error } = await supabase.rpc('unregister_notification_endpoint', { p_id: id });
  if (error) throw error;
  localStorage.removeItem(storageKey);
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
}
