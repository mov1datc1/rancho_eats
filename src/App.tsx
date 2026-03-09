import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import MapPicker from './components/map/MapPicker';
import MapViewer from './components/map/MapViewer';
import { supabase } from './lib/supabase';
import { formatPrice, haversineKm, statusLabel } from './lib/utils';
import type {
  AdminActivityItem,
  AdminAntiSpamItem,
  AdminMapPoint,
  AdminOrderFeedItem,
  AdminOrdersByRestaurant,
  AdminRestaurantOverview,
  AdminSummary,
  CartItem,
  MenuItem,
  Order,
  Restaurant
} from './types';

type TabKey = 'cliente' | 'seguimiento' | 'restaurante' | 'registro' | 'admin';
type RestaurantPanelKey = 'resumen' | 'pedidos' | 'menu' | 'promociones' | 'zona' | 'historial' | 'config';
type AdminPanelKey = 'dashboard' | 'restaurantes' | 'pedidos' | 'antispam' | 'mapa' | 'reportes' | 'config';



const statusClassByRestaurant = {
  ACTIVE: 'aprobado',
  PENDING: 'pendiente',
  SUSPENDED: 'rechazado'
} as const;

const activityDotClass: Record<string, string> = {
  ORDER_CREATED: 'dot-orange',
  ORDER_DELIVERED: 'dot-green',
  ORDER_CANCELLED: 'dot-orange',
  SPAM_BLOCK: 'dot-red',
  REGISTRATION_PENDING: 'dot-amber'
};

const formatRelative = (value: string) => {
  const now = Date.now();
  const ts = new Date(value).getTime();
  const diffMin = Math.max(1, Math.floor((now - ts) / 60000));
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr} hr`;
  const diffDay = Math.floor(diffHr / 24);
  return `hace ${diffDay} día${diffDay > 1 ? 's' : ''}`;
};

const isRpcMissingError = (error: unknown) => {
  const err = error as { code?: string; message?: string; details?: string } | null;
  if (!err) return false;
  return err.code === 'PGRST202'
    || (err.message ?? '').includes('404')
    || (err.details ?? '').toLowerCase().includes('function')
    || (err.message ?? '').toLowerCase().includes('could not find');
};


const getMobileInstallContext = () => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { isMobile: false, isiOS: false, isStandalone: false };
  }

  const ua = navigator.userAgent.toLowerCase();
  const isiOS = /iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && 'ontouchend' in document);
  const isAndroid = /android/.test(ua);
  const isMobile = isiOS || isAndroid;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

  return { isMobile, isiOS, isStandalone };
};

const baseForm = {
  restaurantName: '',
  email: '',
  whatsapp: '',
  password: '',
  type: 'OTRO',
  description: '',
  radius: '10',
  openTime: '09:00',
  closeTime: '21:00'
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('cliente');
  const [restaurantsMenuOpen, setRestaurantsMenuOpen] = useState(false);
  const [restaurantPanel, setRestaurantPanel] = useState<RestaurantPanelKey>('resumen');
  const [selectedZones, setSelectedZones] = useState<string[]>(['Aranda centro', 'El Saucito']);
  const [adminPanel, setAdminPanel] = useState<AdminPanelKey>('dashboard');

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [pendingRestaurants, setPendingRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [restaurantOrders, setRestaurantOrders] = useState<Order[]>([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLoading, setMenuLoading] = useState(false);
  const [trackNumber, setTrackNumber] = useState('1043');
  const [searchedOrder, setSearchedOrder] = useState<Order | null>(null);

  const [clientPoint, setClientPoint] = useState({ lat: 21.0419, lng: -102.3425 });
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientRef, setClientRef] = useState('');
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [orderWizardStep, setOrderWizardStep] = useState<1 | 2 | 3>(1);

  const [registerForm, setRegisterForm] = useState(baseForm);
  const [registerMessage, setRegisterMessage] = useState('');
  const [menuDraft, setMenuDraft] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Especialidades'
  });

  const [adminSummary, setAdminSummary] = useState<AdminSummary>({
    active_restaurants: 0,
    pending_restaurants: 0,
    orders_month: 0,
    moved_month: 0,
    blocked_entities: 0
  });
  const [adminRestaurants, setAdminRestaurants] = useState<AdminRestaurantOverview[]>([]);
  const [adminActivity, setAdminActivity] = useState<AdminActivityItem[]>([]);
  const [adminAntiSpam, setAdminAntiSpam] = useState<AdminAntiSpamItem[]>([]);
  const [adminOrdersChart, setAdminOrdersChart] = useState<AdminOrdersByRestaurant[]>([]);
  const [adminOrders, setAdminOrders] = useState<AdminOrderFeedItem[]>([]);
  const [adminMapPoints, setAdminMapPoints] = useState<AdminMapPoint[]>([]);

  const location = useLocation();
  const navigate = useNavigate();

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminRpcEnabled, setAdminRpcEnabled] = useState(false);
  const [adminFunctionEnabled, setAdminFunctionEnabled] = useState(true);

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [testRestaurants, setTestRestaurants] = useState<Array<Pick<Restaurant, 'id' | 'name' | 'status' | 'email' | 'phone' | 'owner_id' | 'created_at'>>>([]);
  const [testViewerInfo, setTestViewerInfo] = useState({
    userId: null as string | null,
    isAdmin: false,
    pendingVisibleCount: 0,
    functionPendingCount: 0,
    functionAvailable: false
  });

  const mobileInstallContext = getMobileInstallContext();
  const [showPwaBanner, setShowPwaBanner] = useState(() => mobileInstallContext.isMobile && !mobileInstallContext.isStandalone);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [pwaHelpText, setPwaHelpText] = useState(() => mobileInstallContext.isiOS ? 'En iPhone/iPad: toca Compartir y luego “Agregar a pantalla de inicio”.' : mobileInstallContext.isMobile ? 'Si no aparece el popup automático, abre el menú del navegador y toca “Instalar app”.' : '');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => (typeof Notification !== 'undefined' ? Notification.permission : 'default'));
  const searchedOrderStatusRef = useRef<string | null>(null);

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const isAdminRoute = location.pathname === '/administrador';
  const isRestaurantsRoute = location.pathname === '/restaurantes';
  const isTestRoute = location.pathname === '/pruebas';
  const restaurantsMode = new URLSearchParams(location.search).get('mode') === 'login' ? 'login' : 'register';
  const isStandalone = mobileInstallContext.isStandalone;

  const derivedPendingFromOverview = useMemo(() => adminRestaurants.filter((item) => item.status === 'PENDING'), [adminRestaurants]);
  const cartCount = useMemo(() => cartItems.reduce((acc, item) => acc + item.qty, 0), [cartItems]);
  const cartTotal = useMemo(() => cartItems.reduce((acc, item) => acc + item.subtotal, 0), [cartItems]);
  const groupedMenuItems = useMemo(() => {
    const source = menuItems.filter((item) => item.available);
    return source.reduce<Record<string, MenuItem[]>>((acc, item) => {
      const section = item.category?.trim() || 'Especialidades';
      if (!acc[section]) acc[section] = [];
      acc[section].push(item);
      return acc;
    }, {});
  }, [menuItems]);
  const pendingOwnedRestaurant = pendingRestaurants.find((item) => item.owner_id && item.owner_id === adminUser?.id) ?? null;


  const playNewOrderSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.42);
    } catch {
      // no-op
    }
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') return 'denied' as NotificationPermission;
    if (Notification.permission === 'granted') {
      setNotificationPermission('granted');
      return 'granted';
    }
    const result = await Notification.requestPermission();
    setNotificationPermission(result);
    return result;
  };

  const notifyUser = async (title: string, body: string) => {
    if (typeof Notification === 'undefined') return;
    const permission = Notification.permission === 'granted' ? 'granted' : await requestNotificationPermission();
    if (permission === 'granted') {
      new Notification(title, { body, icon: '/icon-192.svg' });
    }
  };

  useEffect(() => {
    void loadInitialData();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAdminUser(session?.user ?? null);
      if (!session?.user) {
        setIsAdmin(false);
        return;
      }

      void checkAdminProfile(session.user.id);
    });

    void loadCurrentSession();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!selectedRestaurant) return;
    void loadRestaurantData(selectedRestaurant.id);
  }, [selectedRestaurant?.id]);

  useEffect(() => {
    const bootAdmin = async () => {
      if (!isAdmin) {
        setPendingRestaurants([]);
        setAdminRpcEnabled(false);
        setAdminFunctionEnabled(true);
        return;
      }

      const rpcAvailable = await loadAdminRpcAvailability();
      await Promise.all([
        loadPendingRestaurants(rpcAvailable),
        loadAdminDashboardData(rpcAvailable),
        loadAdminOrders(rpcAvailable),
        loadAdminMapPoints(rpcAvailable)
      ]);
    };

    void bootAdmin();
  }, [isAdmin]);

  useEffect(() => {
    const refreshAdmin = async () => {
      if (activeTab !== 'admin' || !isAdmin) return;
      await Promise.all([
        loadPendingRestaurants(adminRpcEnabled),
        loadAdminDashboardData(adminRpcEnabled),
        loadAdminOrders(adminRpcEnabled),
        loadAdminMapPoints(adminRpcEnabled)
      ]);
    };

    void refreshAdmin();
  }, [activeTab, isAdmin, adminRpcEnabled]);

  useEffect(() => {
    if (activeTab !== 'admin' || !isAdmin) return;
    if (adminPanel === 'pedidos') void loadAdminOrders();
    if (adminPanel === 'mapa') void loadAdminMapPoints();
  }, [activeTab, isAdmin, adminPanel]);

  useEffect(() => {
    if (isAdminRoute) setActiveTab('admin');
    else if (isRestaurantsRoute && restaurantsMode === 'register') setActiveTab('registro');
    else if (isRestaurantsRoute && restaurantsMode === 'login' && activeTab !== 'restaurante') setActiveTab('registro');
  }, [isAdminRoute, isRestaurantsRoute, restaurantsMode]);

  useEffect(() => {
    if (!isTestRoute) return;
    void loadTestRestaurants();
  }, [isTestRoute]);


  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as any);
      setShowPwaBanner(true);
      setPwaHelpText('');
    };

    const { isMobile, isiOS } = getMobileInstallContext();

    if (!isStandalone && isMobile) {
      setShowPwaBanner(true);
      if (isiOS) {
        setPwaHelpText('En iPhone/iPad: toca Compartir y luego “Agregar a pantalla de inicio”.');
      } else {
        setPwaHelpText('Si no aparece el popup automático, abre el menú del navegador y toca “Instalar app”.');
      }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, [isStandalone]);


  useEffect(() => {
    if (!selectedRestaurant?.id || activeTab !== 'restaurante') return;

    const channel = supabase
      .channel(`restaurant-orders-${selectedRestaurant.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `restaurant_id=eq.${selectedRestaurant.id}`
      }, (payload) => {
        void loadRestaurantData(selectedRestaurant.id);

        const next = payload.new as Order;
        if (payload.eventType === 'INSERT' && next?.status === 'PENDING') {
          void notifyUser('Nuevo pedido entrante', `Pedido #${next.order_number} listo para revisar en tu panel.`);
          playNewOrderSound();
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedRestaurant?.id, activeTab]);

  useEffect(() => {
    if (!searchedOrder?.id) return;

    const channel = supabase
      .channel(`order-status-${searchedOrder.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${searchedOrder.id}`
      }, (payload) => {
        const nextOrder = payload.new as Order;
        setSearchedOrder(nextOrder);

        if (searchedOrderStatusRef.current && searchedOrderStatusRef.current !== nextOrder.status) {
          void notifyUser(
            `Pedido #${nextOrder.order_number} actualizado`,
            `Nuevo estatus: ${statusLabel(nextOrder.status)}`
          );
        }

        searchedOrderStatusRef.current = nextOrder.status;
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [searchedOrder?.id]);


  useEffect(() => {
    searchedOrderStatusRef.current = searchedOrder?.status ?? null;
  }, [searchedOrder?.id]);



  const installPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setShowPwaBanner(false);
      return;
    }

    const { isiOS } = getMobileInstallContext();
    if (isiOS) {
      alert('Para instalar en iPhone/iPad: Safari → Compartir → Agregar a pantalla de inicio.');
    } else {
      alert('Para instalar: abre el menú del navegador (⋮) y elige “Instalar app” o “Agregar a pantalla de inicio”.');
    }
  };

  const loadAdminRpcAvailability = async () => {
    const { error } = await supabase.rpc('admin_dashboard_summary');
    if (error && isRpcMissingError(error)) {
      setAdminRpcEnabled(false);
      return false;
    }

    setAdminRpcEnabled(true);
    return true;
  };

  const loadCurrentSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error(error);
      return;
    }

    const currentUser = data.session?.user ?? null;
    setAdminUser(currentUser);

    if (currentUser) {
      await checkAdminProfile(currentUser.id);
    }
  };

  const checkAdminProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('admin_profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      setIsAdmin(Boolean(data));
    } catch (error) {
      console.error(error);
      setIsAdmin(false);
    }
  };

  const loadInitialData = async () => {
    try {
      setLoading(true);
      setErrorMessage('');

      const { data: activeData, error: activeError } = await supabase
        .from('restaurants')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

      if (activeError) throw activeError;

      const parsedActive = (activeData ?? []) as Restaurant[];
      setRestaurants(parsedActive);
      setSelectedRestaurant(parsedActive[0] ?? null);

    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar la información inicial. Revisa tu conexión con Supabase.');
    } finally {
      setLoading(false);
    }
  };


  const fetchPendingRestaurantsFromFunction = async () => {
    if (!adminFunctionEnabled) return null;

    const { data, error } = await supabase.functions.invoke('admin-restaurants', {
      body: { action: 'list_pending' }
    });

    if (error) {
      const msg = `${error.message ?? ''}`.toLowerCase();
      if (msg.includes('404') || msg.includes('not found') || msg.includes('cors') || msg.includes('failed to send a request')) {
        setAdminFunctionEnabled(false);
        return null;
      }
      throw error;
    }

    return (data?.items ?? []) as Restaurant[];
  };

  const loadPendingRestaurants = async (rpcEnabled = adminRpcEnabled) => {
    try {
      if (rpcEnabled) {
        const { data: pendingData, error: pendingError } = await supabase
          .rpc('admin_list_restaurant_requests');

        if (!pendingError) {
          setPendingRestaurants((pendingData ?? []) as Restaurant[]);
          return;
        }

        if (isRpcMissingError(pendingError)) setAdminRpcEnabled(false);
      }

      const { data: fallbackData, error: fallbackError } = await supabase
        .from('restaurants')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false });

      if (fallbackError) throw fallbackError;
      if ((fallbackData ?? []).length > 0) {
        setPendingRestaurants((fallbackData ?? []) as Restaurant[]);
        return;
      }

      const fnData = await fetchPendingRestaurantsFromFunction();
      if (fnData) {
        setPendingRestaurants(fnData);
        return;
      }

      setPendingRestaurants([]);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar la bandeja de solicitudes pendientes del admin. Revisa migraciones 002/003, CORS de Edge Functions y proyecto Supabase configurado.');
    }
  };

  const loadAdminDashboardData = async (rpcEnabled = adminRpcEnabled) => {
    try {
      if (rpcEnabled) {
        const [summaryRes, restaurantsRes, activityRes, antiSpamRes, chartRes] = await Promise.all([
          supabase.rpc('admin_dashboard_summary'),
          supabase.rpc('admin_restaurants_overview'),
          supabase.rpc('admin_recent_activity'),
          supabase.rpc('admin_antispam_overview'),
          supabase.rpc('admin_orders_by_restaurant_30d')
        ]);

        const hasRpcMissing = [summaryRes.error, restaurantsRes.error, activityRes.error, antiSpamRes.error, chartRes.error]
          .some((error) => isRpcMissingError(error));

        if (!hasRpcMissing) {
          if (summaryRes.error) throw summaryRes.error;
          if (restaurantsRes.error) throw restaurantsRes.error;
          if (activityRes.error) throw activityRes.error;
          if (antiSpamRes.error) throw antiSpamRes.error;
          if (chartRes.error) throw chartRes.error;

          const summary = (summaryRes.data?.[0] ?? summaryRes.data ?? null) as AdminSummary | null;
          if (summary) setAdminSummary(summary);
          setAdminRestaurants((restaurantsRes.data ?? []) as AdminRestaurantOverview[]);
          setAdminActivity((activityRes.data ?? []) as AdminActivityItem[]);
          setAdminAntiSpam((antiSpamRes.data ?? []) as AdminAntiSpamItem[]);
          setAdminOrdersChart((chartRes.data ?? []) as AdminOrdersByRestaurant[]);
          return;
        }

        setAdminRpcEnabled(false);
      }

      {
        const [restaurantsDataRes, ordersDataRes, blockedDataRes] = await Promise.all([
          supabase.from('restaurants').select('id,name,status,created_at'),
          supabase.from('orders').select('id,restaurant_id,status,total,created_at,order_number,client_name,client_location_note,client_ip,cancelled_at,updated_at').gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
          supabase.from('blocked_entities').select('id,value,reason,created_at')
        ]);

        if (restaurantsDataRes.error) throw restaurantsDataRes.error;
        if (ordersDataRes.error) throw ordersDataRes.error;
        if (blockedDataRes.error) throw blockedDataRes.error;

        const restaurantsData = (restaurantsDataRes.data ?? []) as Array<{ id: string; name: string; status: 'ACTIVE' | 'PENDING' | 'SUSPENDED'; created_at?: string }>;
        const ordersData = (ordersDataRes.data ?? []) as Array<{ id: string; restaurant_id: string; status: string; total: number; created_at: string; order_number: number; client_name: string | null; client_location_note: string | null; client_ip: string | null; cancelled_at: string | null; updated_at: string }>;
        const blockedData = (blockedDataRes.data ?? []) as Array<{ id: string; value: string; reason: string | null; created_at: string }>;

        const today = new Date().toISOString().slice(0, 10);
        const statusWeight = { ACTIVE: 0, PENDING: 1, SUSPENDED: 2 } as const;

        setAdminSummary({
          active_restaurants: restaurantsData.filter((r) => r.status === 'ACTIVE').length,
          pending_restaurants: restaurantsData.filter((r) => r.status === 'PENDING').length,
          orders_month: ordersData.length,
          moved_month: ordersData
            .filter((o) => ['DELIVERED', 'ACCEPTED', 'ON_THE_WAY'].includes(o.status))
            .reduce((acc, item) => acc + Number(item.total), 0),
          blocked_entities: blockedData.length
        });

        setAdminRestaurants(
          restaurantsData
            .sort((a, b) => (statusWeight[a.status] - statusWeight[b.status]) || ((b.created_at ?? '').localeCompare(a.created_at ?? '')))
            .slice(0, 8)
            .map((restaurant) => ({
              id: restaurant.id,
              name: restaurant.name,
              status: restaurant.status,
              orders_today: ordersData.filter((order) => order.restaurant_id === restaurant.id && order.created_at.slice(0, 10) === today).length
            }))
        );

        const activityFromOrders: AdminActivityItem[] = ordersData
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 6)
          .map((order) => ({
            kind: order.status === 'CANCELLED' ? 'ORDER_CANCELLED' : order.status === 'DELIVERED' ? 'ORDER_DELIVERED' : 'ORDER_CREATED',
            title: `Pedido #${order.order_number}`,
            detail: order.client_location_note ?? order.client_name ?? 'Actividad de pedido',
            happened_at: order.created_at
          }));

        const activityFromPending: AdminActivityItem[] = restaurantsData
          .filter((r) => r.status === 'PENDING')
          .slice(0, 2)
          .map((r) => ({
            kind: 'REGISTRATION_PENDING',
            title: `Registro nuevo: ${r.name}`,
            detail: 'Solicitud pendiente de aprobación',
            happened_at: r.created_at ?? new Date().toISOString()
          }));

        const activityFromBlocked: AdminActivityItem[] = blockedData
          .slice(0, 2)
          .map((b) => ({
            kind: 'SPAM_BLOCK',
            title: `Entidad bloqueada: ${b.value}`,
            detail: b.reason ?? 'Posible spam',
            happened_at: b.created_at
          }));

        setAdminActivity(
          [...activityFromOrders, ...activityFromPending, ...activityFromBlocked]
            .sort((a, b) => b.happened_at.localeCompare(a.happened_at))
            .slice(0, 8)
        );

        const antiSpamMap = new Map<string, { orders_today: number; cancelled: number; rejected: number; last_order_at: string }>();
        ordersData.forEach((order) => {
          const key = order.client_ip && order.client_ip.trim() ? order.client_ip : 'Sin IP';
          const current = antiSpamMap.get(key) ?? { orders_today: 0, cancelled: 0, rejected: 0, last_order_at: order.created_at };
          if (order.created_at.slice(0, 10) === today) current.orders_today += 1;
          if (order.status === 'CANCELLED') current.cancelled += 1;
          if (order.status === 'REJECTED') current.rejected += 1;
          if (order.created_at > current.last_order_at) current.last_order_at = order.created_at;
          antiSpamMap.set(key, current);
        });

        setAdminAntiSpam(
          Array.from(antiSpamMap.entries())
            .map(([entity, stats]) => ({ entity, ...stats }))
            .sort((a, b) => (b.orders_today - a.orders_today) || b.last_order_at.localeCompare(a.last_order_at))
            .slice(0, 10)
        );

        setAdminOrdersChart(
          restaurantsData
            .map((restaurant) => ({
              restaurant_name: restaurant.name,
              orders_count: ordersData.filter((order) => order.restaurant_id === restaurant.id).length
            }))
            .sort((a, b) => b.orders_count - a.orders_count)
            .slice(0, 8)
        );

        return;
      }

    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar el dashboard del super admin.');
    }
  };

  const loadAdminOrders = async (rpcEnabled = adminRpcEnabled) => {
    try {
      if (rpcEnabled) {
        const { data, error } = await supabase.rpc('admin_orders_feed', { p_limit: 60 });
        if (!error) {
          setAdminOrders((data ?? []) as AdminOrderFeedItem[]);
          return;
        }

        if (!isRpcMissingError(error)) throw error;
        setAdminRpcEnabled(false);
      }

      const { data: fallbackOrders, error: fallbackError } = await supabase
        .from('orders')
        .select('id,order_number,status,total,client_name,client_phone,client_location_note,created_at,restaurant_id')
        .order('created_at', { ascending: false })
        .limit(60);
      if (fallbackError) throw fallbackError;

      const restaurantIds = Array.from(new Set((fallbackOrders ?? []).map((order) => order.restaurant_id).filter(Boolean)));
      const { data: fallbackRestaurants } = await supabase.from('restaurants').select('id,name').in('id', restaurantIds.length > 0 ? restaurantIds : ['00000000-0000-0000-0000-000000000000']);
      const byId = new Map((fallbackRestaurants ?? []).map((r) => [r.id, r.name]));

      setAdminOrders(((fallbackOrders ?? []) as Array<{ id: string; order_number: number; status: string; total: number; client_name: string | null; client_phone: string | null; client_location_note: string | null; created_at: string; restaurant_id: string }>).map((order) => ({
        ...order,
        restaurant_name: byId.get(order.restaurant_id) ?? 'Restaurante'
      })) as AdminOrderFeedItem[]);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar la sección de pedidos de admin.');
    }
  };

  const loadAdminMapPoints = async (rpcEnabled = adminRpcEnabled) => {
    try {
      if (rpcEnabled) {
        const { data, error } = await supabase.rpc('admin_live_map_points', { p_limit: 120 });
        if (!error) {
          setAdminMapPoints((data ?? []) as AdminMapPoint[]);
          return;
        }

        if (!isRpcMissingError(error)) throw error;
        setAdminRpcEnabled(false);
      }

      const { data: fallbackMap, error: fallbackError } = await supabase
        .from('restaurants')
        .select('id,name,lat,lng,status,is_open')
        .not('lat', 'is', null)
        .not('lng', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(120);

      if (fallbackError) throw fallbackError;
      setAdminMapPoints((fallbackMap ?? []) as AdminMapPoint[]);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar el mapa en vivo de admin.');
    }
  };

  const blockEntity = async (value: string) => {
    try {
      setActionLoading(true);
      let error = null as { code?: string; message?: string; details?: string } | null;
      if (adminRpcEnabled) {
        const rpcRes = await supabase.rpc('admin_block_entity', {
          p_value: value,
          p_reason: 'Bloqueo manual desde panel super admin'
        });
        error = rpcRes.error as typeof error;
        if (error && isRpcMissingError(error)) setAdminRpcEnabled(false);
      }

      if (error && !isRpcMissingError(error)) throw error;

      if (!adminRpcEnabled || (error && isRpcMissingError(error))) {
        const { error: fallbackError } = await supabase
          .from('blocked_entities')
          .insert({ type: 'IP', value, reason: 'Bloqueo manual desde panel super admin', blocked_by: adminUser?.id ?? null });
        if (fallbackError) throw fallbackError;
      }

      await Promise.all([loadAdminDashboardData(), loadAdminOrders()]);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo bloquear la entidad sospechosa.');
    } finally {
      setActionLoading(false);
    }
  };

  const loadRestaurantData = async (restaurantId: string) => {
    try {
      setMenuLoading(true);
      const { data: menuData, error: menuError } = await supabase
        .from('menu_items')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('sort_order', { ascending: true });

      if (menuError) throw menuError;
      setMenuItems((menuData ?? []) as MenuItem[]);

      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (ordersError) throw ordersError;
      setRestaurantOrders((ordersData ?? []) as Order[]);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar el menú o los pedidos del restaurante.');
    } finally {
      setMenuLoading(false);
    }
  };

  const openMenu = (restaurant: Restaurant) => {
    if (!restaurant.is_open) {
      setErrorMessage('Este restaurante está cerrado por ahora, disculpa las molestias ocasionadas.');
      return;
    }

    setErrorMessage('');
    setSelectedRestaurant(restaurant);
    setMenuOpen(true);
    setCart({});
    setClientName('');
    setClientPhone('');
    setClientRef('');
    setOrderWizardStep(1);
    void loadRestaurantData(restaurant.id);
  };

  const getItemQty = (menuItemId: string) => cart[menuItemId]?.qty ?? 0;

  const addItem = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev[item.id];
      if (existing) {
        const qty = existing.qty + 1;
        return {
          ...prev,
          [item.id]: { ...existing, qty, subtotal: qty * existing.unit_price }
        };
      }

      return {
        ...prev,
        [item.id]: {
          menu_item_id: item.id,
          name: item.name,
          qty: 1,
          unit_price: item.price,
          subtotal: item.price
        }
      };
    });
  };

  const removeItem = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev[item.id];
      if (!existing) return prev;
      if (existing.qty <= 1) {
        const next = { ...prev };
        delete next[item.id];
        return next;
      }

      const qty = existing.qty - 1;
      return {
        ...prev,
        [item.id]: { ...existing, qty, subtotal: qty * existing.unit_price }
      };
    });
  };


  const updateRestaurantOrderStatus = async (
    order: Order,
    nextStatus: 'ACCEPTED' | 'REJECTED' | 'ON_THE_WAY' | 'DELIVERED',
    reason?: string
  ) => {
    if (!selectedRestaurant) return;

    try {
      setActionLoading(true);
      setErrorMessage('');
      const payload: Record<string, unknown> = {
        status: nextStatus,
        rejection_reason: nextStatus === 'REJECTED' ? (reason ?? 'No podemos cubrir esta distancia por ahora.') : null
      };

      const { error } = await supabase
        .from('orders')
        .update(payload)
        .eq('id', order.id)
        .eq('restaurant_id', selectedRestaurant.id);

      if (error) throw error;
      await loadRestaurantData(selectedRestaurant.id);

      if (searchedOrder?.id === order.id) {
        const { data } = await supabase.from('orders').select('*').eq('id', order.id).maybeSingle();
        if (data) setSearchedOrder(data as Order);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage('No pudimos actualizar el estatus del pedido.');
    } finally {
      setActionLoading(false);
    }
  };


  const goToWizardStep = (step: 1 | 2 | 3) => {
    if (step === 2 && cartCount === 0) {
      setErrorMessage('Primero agrega al menos un platillo para continuar.');
      return;
    }

    if (step === 3 && cartCount === 0) {
      setErrorMessage('Primero agrega al menos un platillo para continuar.');
      return;
    }

    setErrorMessage('');
    setOrderWizardStep(step);
  };

  const submitOrder = async () => {
    if (!selectedRestaurant) return;
    if (cartCount === 0) {
      setErrorMessage('Agrega al menos un platillo antes de enviar el pedido.');
      return;
    }

    if (orderWizardStep !== 3) {
      setErrorMessage('Completa los 3 pasos antes de enviar el pedido.');
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');

      const { data: orderNumberData, error: orderNumberError } = await supabase.rpc('get_next_order_number');
      if (orderNumberError) throw orderNumberError;

      const { data: orderData, error: orderInsertError } = await supabase
        .from('orders')
        .insert({
          order_number: Number(orderNumberData),
          restaurant_id: selectedRestaurant.id,
          client_name: clientName || null,
          client_phone: clientPhone || null,
          client_location_note: clientRef || null,
          client_lat: clientPoint.lat,
          client_lng: clientPoint.lng,
          items: cartItems,
          total: cartTotal,
          status: 'PENDING'
        })
        .select('*')
        .single();

      if (orderInsertError) throw orderInsertError;

      await supabase.functions.invoke('notify-restaurant', {
        body: {
          restaurant_id: selectedRestaurant.id,
          order_number: orderData.order_number,
          client_name: clientName || 'Sin nombre',
          client_phone: clientPhone || null,
          total: cartTotal
        }
      });

      setSearchedOrder(orderData as Order);
      setTrackNumber(`#${orderData.order_number}`);
      setMenuOpen(false);
      setActiveTab('seguimiento');
      await loadRestaurantData(selectedRestaurant.id);
    } catch (error) {
      console.error(error);
      setErrorMessage('No pudimos enviar el pedido. Inténtalo de nuevo en unos segundos.');
    } finally {
      setActionLoading(false);
    }
  };

  const searchOrder = async () => {
    try {
      setActionLoading(true);
      const cleanOrderNumber = Number(trackNumber.replace('#', '').trim());
      if (!cleanOrderNumber) {
        setSearchedOrder(null);
        return;
      }

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('order_number', cleanOrderNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setSearchedOrder((data as Order | null) ?? null);
    } catch (error) {
      console.error(error);
      setErrorMessage('No pudimos buscar el pedido en este momento.');
    } finally {
      setActionLoading(false);
    }
  };

  const submitRegister = async () => {
    try {
      setActionLoading(true);
      setRegisterMessage('');

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: registerForm.email,
        password: registerForm.password
      });

      if (signUpError) throw signUpError;

      const { error: insertError } = await supabase.from('restaurants').insert({
        name: registerForm.restaurantName,
        description: registerForm.description,
        phone: registerForm.whatsapp,
        email: registerForm.email,
        type: registerForm.type,
        delivery_radius_km: Number(registerForm.radius),
        zones: selectedZones,
        open_time: registerForm.openTime,
        close_time: registerForm.closeTime,
        owner_id: signUpData.user?.id ?? null,
        status: 'PENDING'
      });

      if (insertError) throw insertError;

      setRegisterMessage('✅ Tu solicitud fue enviada. El admin la revisará para activarte.');
      setRegisterForm(baseForm);
      setSelectedZones(['Aranda centro']);
      await loadInitialData();
    } catch (error) {
      console.error(error);
      setRegisterMessage('❌ No se pudo enviar tu registro. Revisa tus datos e inténtalo de nuevo.');
    } finally {
      setActionLoading(false);
    }
  };


  const loadOwnedRestaurant = async (userId: string) => {
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      setActiveTab('registro');
      setRegisterMessage('❌ No encontramos un restaurante vinculado a este usuario. Regístralo primero.');
      return null;
    }

    const owned = data as Restaurant;
    setSelectedRestaurant(owned);

    if (owned.status !== 'ACTIVE') {
      setActiveTab('registro');
      setRegisterMessage(`⏳ Tu restaurante está en estatus ${owned.status}. El super admin debe aprobarlo para entrar al panel.`);
      return null;
    }

    await loadRestaurantData(owned.id);
    setActiveTab('restaurante');
    setRegisterMessage(`✅ Bienvenido a tu panel, ${owned.name}.`);
    return owned;
  };


  const toggleRestaurantOpenStatus = async () => {
    if (!selectedRestaurant) return;

    try {
      setActionLoading(true);
      setErrorMessage('');
      const nextOpenState = !selectedRestaurant.is_open;

      const { data, error } = await supabase
        .from('restaurants')
        .update({ is_open: nextOpenState })
        .eq('id', selectedRestaurant.id)
        .eq('owner_id', adminUser?.id ?? '')
        .select('*')
        .single();

      if (error) throw error;

      setSelectedRestaurant(data as Restaurant);
      await Promise.all([loadInitialData(), loadRestaurantData(selectedRestaurant.id)]);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo actualizar el estado de abierto/cerrado del restaurante.');
    } finally {
      setActionLoading(false);
    }
  };

  const buildWhatsAppUrl = (phone: string | null | undefined, order?: Order) => {
    const clean = (phone ?? '').replace(/\D/g, '');
    if (!clean) return null;
    const withCountry = clean.startsWith('52') ? clean : `52${clean}`;

    const message = order
      ? `Hola ${order.client_name ?? ''}, te escribimos de ${selectedRestaurant?.name ?? 'tu restaurante'}. Ya revisamos tu pedido #${order.order_number} por ${formatPrice(Number(order.total))}. Estatus actual: ${statusLabel(order.status)}. Puedes darle seguimiento en ArandaEats con tu número de pedido #${order.order_number}.`
      : 'Hola, te escribimos de ArandaEats para dar seguimiento a tu pedido.';

    return `https://wa.me/${withCountry}?text=${encodeURIComponent(message.trim())}`;
  };

  const createMenuItem = async () => {
    if (!selectedRestaurant) {
      setErrorMessage('No hay restaurante activo para crear platillos.');
      return;
    }

    if (!menuDraft.name.trim() || !menuDraft.price.trim()) {
      setErrorMessage('Completa nombre y precio del platillo.');
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');

      const payload = {
        restaurant_id: selectedRestaurant.id,
        name: menuDraft.name.trim(),
        description: menuDraft.description.trim() || null,
        price: Number(menuDraft.price),
        category: menuDraft.category.trim() || 'Especialidades',
        available: true
      };

      const { error } = await supabase.from('menu_items').insert(payload);
      if (error) throw error;

      setMenuDraft({ name: '', description: '', price: '', category: menuDraft.category });
      await loadRestaurantData(selectedRestaurant.id);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo crear el platillo. Revisa permisos del restaurante.');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleMenuItemAvailability = async (item: MenuItem) => {
    try {
      setActionLoading(true);
      const { error } = await supabase.from('menu_items').update({ available: !item.available }).eq('id', item.id);
      if (error) throw error;
      if (selectedRestaurant) await loadRestaurantData(selectedRestaurant.id);
    } catch (error) {
      console.error(error);
      setErrorMessage('No pudimos actualizar la disponibilidad del platillo.');
    } finally {
      setActionLoading(false);
    }
  };

  const signInRestaurant = async () => {
    try {
      setActionLoading(true);
      setRegisterMessage('');
      const { data, error } = await supabase.auth.signInWithPassword({
        email: registerForm.email,
        password: registerForm.password
      });
      if (error) throw error;
      if (!data.user) throw new Error('Sin usuario autenticado');
      setAdminUser(data.user);
      await loadOwnedRestaurant(data.user.id);
    } catch (error) {
      console.error(error);
      setRegisterMessage('❌ No se pudo iniciar sesión. Verifica correo y contraseña.');
    } finally {
      setActionLoading(false);
    }
  };

  const updatePendingRestaurant = async (restaurantId: string, status: 'ACTIVE' | 'SUSPENDED') => {
    if (!isAdmin) {
      setErrorMessage('Solo usuarios admin pueden aprobar o rechazar restaurantes.');
      return;
    }

    try {
      setActionLoading(true);
      let rpcError: unknown = null;
      if (adminRpcEnabled) {
        const { error } = await supabase.rpc('admin_update_restaurant_status', {
          p_restaurant_id: restaurantId,
          p_status: status
        });
        rpcError = error;
      }

      if (!adminRpcEnabled || (rpcError && isRpcMissingError(rpcError))) {
        const { error: fallbackError } = await supabase
          .from('restaurants')
          .update({ status })
          .eq('id', restaurantId)
          .eq('status', 'PENDING');

        if (fallbackError) {
          if (!adminFunctionEnabled) throw fallbackError;
          const { error: fnError } = await supabase.functions.invoke('admin-restaurants', {
            body: { action: 'update_status', restaurant_id: restaurantId, status }
          });
          if (fnError) {
            const msg = `${fnError.message ?? ''}`.toLowerCase();
            if (msg.includes('cors') || msg.includes('failed to send a request') || msg.includes('404') || msg.includes('not found')) {
              setAdminFunctionEnabled(false);
            }
            throw fnError;
          }
        }

        setAdminRpcEnabled(false);
      } else if (rpcError) {
        throw rpcError;
      }

      await Promise.all([loadInitialData(), loadPendingRestaurants(), loadAdminDashboardData()]);
    } catch (error) {
      console.error(error);
      setErrorMessage('No pudimos actualizar el estado del restaurante.');
    } finally {
      setActionLoading(false);
    }
  };

  const signInAdmin = async () => {
    try {
      setActionLoading(true);
      setErrorMessage('');
      const { error } = await supabase.auth.signInWithPassword({
        email: adminEmail,
        password: adminPassword
      });

      if (error) throw error;
      setAdminPassword('');
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo iniciar sesión como admin. Revisa tus credenciales.');
    } finally {
      setActionLoading(false);
    }
  };

  const signOutAdmin = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setAdminUser(null);
    setPendingRestaurants([]);
  };

  const toggleZone = (zone: string) => {
    setSelectedZones((prev) => (prev.includes(zone) ? prev.filter((item) => item !== zone) : [...prev, zone]));
  };

  const loadTestRestaurants = async () => {
    try {
      setLoading(true);
      setErrorMessage('');

      const { data: sessionData } = await supabase.auth.getSession();
      const viewerId = sessionData.session?.user?.id ?? null;

      let viewerIsAdmin = false;
      if (viewerId) {
        const { data: adminProfile } = await supabase
          .from('admin_profiles')
          .select('id')
          .eq('id', viewerId)
          .maybeSingle();
        viewerIsAdmin = Boolean(adminProfile);
      }

      const { data, error } = await supabase
        .from('restaurants')
        .select('id,name,status,email,phone,owner_id,created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const visibleRows = (data ?? []) as Array<Pick<Restaurant, 'id' | 'name' | 'status' | 'email' | 'phone' | 'owner_id' | 'created_at'>>;

      const { count: pendingVisibleCount } = await supabase
        .from('restaurants')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'PENDING');

      let functionPendingCount = 0;
      let functionAvailable = false;
      if (viewerIsAdmin) {
        const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-restaurants', {
          body: { action: 'list_pending' }
        });

        if (!fnError) {
          functionAvailable = true;
          functionPendingCount = Array.isArray(fnData?.items) ? fnData.items.length : 0;
        }
      }

      setTestRestaurants(visibleRows);
      setTestViewerInfo({
        userId: viewerId,
        isAdmin: viewerIsAdmin,
        pendingVisibleCount: pendingVisibleCount ?? 0,
        functionPendingCount,
        functionAvailable
      });
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar /pruebas. Revisa URL/keys de Supabase y RLS.');
    } finally {
      setLoading(false);
    }
  };

  const restaurantPanels: Array<{ key: RestaurantPanelKey; label: string }> = [
    { key: 'resumen', label: '📊 Resumen' },
    { key: 'pedidos', label: '📦 Pedidos activos' },
    { key: 'menu', label: '📋 Mi menú' },
    { key: 'promociones', label: '🏷️ Promociones' },
    { key: 'zona', label: '📍 Zona de entrega' },
    { key: 'historial', label: '📈 Historial' },
    { key: 'config', label: '⚙️ Configuración' }
  ];

  return (
    <div>
      <nav className="ae-nav">
        <div className="logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>Aranda<span>Eats</span></div>
        <ul className="nav-links">
          <li><a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Inicio</a></li>
          <li><a href="#">¿Cómo funciona?</a></li>
          <li><a href="#" onClick={(e) => { e.preventDefault(); navigate('/pruebas'); }}>Pruebas</a></li>
          <li style={{ position: 'relative' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setRestaurantsMenuOpen((prev) => !prev); }}>Para restaurantes</a>
            {restaurantsMenuOpen && (
              <div style={{ position: 'absolute', top: '2rem', right: 0, background: '#fff', border: '1px solid #ecd8c7', borderRadius: '10px', boxShadow: 'var(--shadow)', minWidth: '180px', zIndex: 1200 }}>
                <button className="btn ghost" style={{ width: '100%', border: 0, borderBottom: '1px solid #f0e4d8', borderRadius: 0, textAlign: 'left' }} onClick={() => { navigate('/restaurantes?mode=register'); setRestaurantsMenuOpen(false); }}>Registrarse</button>
                <button className="btn ghost" style={{ width: '100%', border: 0, borderRadius: 0, textAlign: 'left' }} onClick={() => { navigate('/restaurantes?mode=login'); setRestaurantsMenuOpen(false); }}>Ingresar</button>
              </div>
            )}
          </li>
        </ul>
        {!isAdminRoute && (
          <button className="nav-cta" onClick={() => navigate('/restaurantes?mode=register')}>Registrar Restaurante</button>
        )}
      </nav>

      {!isAdminRoute && !isRestaurantsRoute && !isTestRoute && (
        <div className="tabs">
          {[
            { key: 'cliente', label: '👤 Cliente' },
            { key: 'seguimiento', label: '📦 Seguimiento' }
          ].map((tab) => (
            <button key={tab.key} className={`tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key as TabKey)}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {!isAdminRoute && !isRestaurantsRoute && showPwaBanner && !isStandalone && (
        <div className="pwa-banner pwa-banner-top">
          <div>
            <p>📲 Instala ArandaEats para pedir y dar seguimiento más rápido desde tu celular.</p>
            {pwaHelpText && <small className="pwa-help">{pwaHelpText}</small>}
          </div>
          <button className="pwa-install" onClick={() => void installPwa()}>+ Instalar APP</button>
        </div>
      )}
      {errorMessage && <div className="global-error">{errorMessage}</div>}
      {loading && <div className="global-loading">Cargando datos de la plataforma…</div>}

      {!isAdminRoute && !isRestaurantsRoute && !isTestRoute && activeTab === 'cliente' && (
        <div className="page active">
          <div className="hero">
            <div className="hero-inner">
              <div className="hero-badge">📍 Aranda de Arandas, Jalisco — y todos sus ranchos</div>
              <h1>Tu comida favorita<br />hasta tu <em>rancho</em></h1>
              <p>Sin registro, sin complicaciones. Pon tu ubicación en el mapa y los restaurantes de Aranda te llevan lo que quieras — aunque sea camino de tierra.</p>
            </div>
          </div>

          <div className="section">
            <div className="s-title">Restaurantes disponibles</div>
            <div className="rest-grid">
              {restaurants.map((restaurant) => (
                <div key={restaurant.id} className="rcard" onClick={() => openMenu(restaurant)}>
                  <div className="rcard-img" style={{ background: 'linear-gradient(135deg,#8B2D07,#C8410B)' }}>🍽️<div className={`rbadge ${restaurant.is_open ? 'open' : 'closed'}`}>{restaurant.is_open ? 'Abierto' : 'Cerrado'}</div></div>
                  <div className="rcard-body">
                    <div className="rname">{restaurant.name}</div>
                    <div className="rmeta"><span>📦 {restaurant.type}</span><span>📍 {restaurant.delivery_radius_km} km</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {showPwaBanner && !isStandalone && (
            <div className="pwa-banner pwa-banner-footer">
              <div>
                <p>📲 ¿Te vas? También puedes instalar ArandaEats desde aquí.</p>
                {pwaHelpText && <small className="pwa-help">{pwaHelpText}</small>}
              </div>
              <button className="pwa-install" onClick={() => void installPwa()}>+ Instalar APP</button>
            </div>
          )}
        </div>
      )}

      {!isAdminRoute && !isRestaurantsRoute && !isTestRoute && activeTab === 'seguimiento' && (
        <div className="page active">
          <div className="track-wrap">
            <div className="track-lookup">
              <h3>🔍 Buscar tu pedido</h3>
              <div className="track-input-row">
                <input className="track-input" value={trackNumber} onChange={(e) => setTrackNumber(e.target.value)} placeholder="ej. 1043 o #1043" />
                <button className="btn" onClick={searchOrder} disabled={actionLoading}>Buscar</button>
              </div>
            </div>

            {searchedOrder ? (
              <div className="track-result">
                <div className="tr-header">
                  <div className="tr-num">Pedido confirmado</div>
                  <div className="tr-rest">{restaurants.find((item) => item.id === searchedOrder.restaurant_id)?.name ?? 'Restaurante'}</div>
                  <div className="tr-time">{new Date(searchedOrder.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} · Total: {formatPrice(Number(searchedOrder.total))}</div>
                </div>
                <div className="order-summary">
                  <div className="confirm-pill">✅ Tu número de pedido es <strong>#{searchedOrder.order_number}</strong></div>
                  {(searchedOrder.items ?? []).map((item) => (
                    <div key={`${item.menu_item_id}-${item.qty}`}>• {item.qty}x {item.name} · {formatPrice(item.subtotal)}</div>
                  ))}
                  <div className="summary-foot"><strong>Total: {formatPrice(Number(searchedOrder.total))}</strong> · Pago en efectivo<br />📌 Estatus actual: <strong>{statusLabel(searchedOrder.status)}</strong>{searchedOrder.status === 'REJECTED' && searchedOrder.rejection_reason ? ` · Motivo: ${searchedOrder.rejection_reason}` : ''}<br />📍 {searchedOrder.client_location_note ?? 'Sin referencia'}<br />👤 {searchedOrder.client_name ?? 'Sin nombre'} · 📱 {searchedOrder.client_phone ?? 'Sin teléfono'}<br /><span style={{ color: 'var(--muted)' }}>Esta vista se actualiza automáticamente cuando el restaurante cambia el estatus.</span></div>
                </div>
              </div>
            ) : (
              <div className="track-lookup">No hay pedido seleccionado aún. Busca por número para ver el detalle.</div>
            )}
          </div>
        </div>
      )}

      {isTestRoute && (
        <div className="page active">
          <div className="section">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div className="s-title">🔬 Pruebas de conexión front-back</div>
                <p style={{ color: 'var(--muted)' }}>Consulta directa a <code>restaurants</code> para validar estatus (ACTIVE/PENDING/SUSPENDED).</p>
              </div>
              <button className="btn" onClick={() => void loadTestRestaurants()} disabled={loading}>Recargar tabla</button>
            </div>

            <div className="admin-card" style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '.85rem', marginBottom: '.35rem' }}>
                <strong>Sesión actual:</strong> {testViewerInfo.userId ? `autenticado (${testViewerInfo.userId})` : 'anónimo (sin login)'}
              </p>
              <p style={{ fontSize: '.85rem', marginBottom: '.35rem' }}>
                <strong>Es admin:</strong> {testViewerInfo.isAdmin ? 'sí' : 'no'}
              </p>
              <p style={{ fontSize: '.85rem', marginBottom: '.35rem' }}>
                <strong>PENDING visibles por query directa:</strong> {testViewerInfo.pendingVisibleCount}
              </p>
              {testViewerInfo.isAdmin && (
                <p style={{ fontSize: '.85rem', marginBottom: '.35rem' }}>
                  <strong>PENDING por Edge Function admin-restaurants:</strong> {testViewerInfo.functionAvailable ? testViewerInfo.functionPendingCount : 'función no disponible / no desplegada'}
                </p>
              )}
              <p style={{ fontSize: '.82rem', color: 'var(--muted)' }}>
                Si aquí solo ves ACTIVE, casi siempre es por RLS: la policy pública de <code>restaurants</code> permite leer únicamente <code>status = ACTIVE</code>.
                La confirmación de correo de Supabase Auth no cambia el filtro de estatus; lo que define visibilidad es la sesión + policies/migraciones.
              </p>

              {testViewerInfo.isAdmin && testViewerInfo.pendingVisibleCount === 0 && (
                <div style={{ marginTop: '.7rem', border: '1px solid #f0b28f', background: '#fff6ef', borderRadius: '10px', padding: '.7rem .85rem' }}>
                  <p style={{ fontSize: '.82rem', marginBottom: '.35rem' }}><strong>Diagnóstico:</strong> tu cuenta sí está en <code>admin_profiles</code>, pero no está pudiendo leer filas <code>PENDING</code>.</p>
                  <p style={{ fontSize: '.8rem', color: 'var(--mid)', marginBottom: '.2rem' }}>1) Ejecuta la migración <code>002_admin_restaurant_policies.sql</code> en este mismo proyecto Supabase.</p>
                  <p style={{ fontSize: '.8rem', color: 'var(--mid)', marginBottom: '.2rem' }}>2) Verifica que exista la policy <code>restaurants_select_admin</code> en la tabla <code>restaurants</code>.</p>
                  <p style={{ fontSize: '.8rem', color: 'var(--mid)' }}>3) (Opcional) Despliega <code>admin-restaurants</code> para fallback de pendientes si faltan RPCs.</p>
                </div>
              )}

              {testViewerInfo.isAdmin && !testViewerInfo.functionAvailable && (
                <div style={{ marginTop: '.55rem', border: '1px solid #e7d4c2', background: '#fff', borderRadius: '10px', padding: '.65rem .8rem' }}>
                  <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
                    <strong>Fallback Edge Function:</strong> no disponible. Si quieres validación cruzada de pendientes, despliega <code>supabase/functions/admin-restaurants</code> con CORS habilitado.
                  </p>
                </div>
              )}
            </div>

            <div className="admin-card" style={{ overflow: 'auto' }}>
              <table className="spam-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Estatus</th>
                    <th>Email</th>
                    <th>Teléfono</th>
                    <th>Owner ID</th>
                    <th>Creado</th>
                  </tr>
                </thead>
                <tbody>
                  {testRestaurants.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td><span className={`status-pill ${statusClassByRestaurant[row.status]}`}>{row.status}</span></td>
                      <td>{row.email}</td>
                      <td>{row.phone}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '.78rem' }}>{row.owner_id ?? '—'}</td>
                      <td>{new Date(row.created_at).toLocaleString('es-MX')}</td>
                    </tr>
                  ))}
                  {testRestaurants.length === 0 && !loading && (
                    <tr><td colSpan={6}>Sin datos disponibles.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {isRestaurantsRoute && restaurantsMode === 'login' && activeTab === 'restaurante' && (
        <div className="page active restaurant-page">
          <aside className="restaurant-sidebar">
            <h3>🍽️ Mi Restaurante</h3>
            <ul>
              {restaurantPanels.map((panel) => (
                <li key={panel.key}><button className={restaurantPanel === panel.key ? 'active' : ''} onClick={() => setRestaurantPanel(panel.key)}>{panel.label}</button></li>
              ))}
            </ul>
          </aside>

          <section className="restaurant-main">
            <div className="restaurant-header-row">
              <div>
                <h2>{selectedRestaurant?.name ?? 'Sin restaurante activo'}</h2>
                <p>{selectedRestaurant?.is_open ? '● Abierto' : '● Cerrado'} · {selectedRestaurant?.type ?? 'Sin tipo'}</p>
              </div>
              <button
                className={`btn ${selectedRestaurant?.is_open ? 'ghost' : 'green'}`}
                onClick={() => void toggleRestaurantOpenStatus()}
                disabled={actionLoading || !selectedRestaurant}
              >
                {selectedRestaurant?.is_open ? 'Cerrar restaurante' : 'Abrir restaurante'}
              </button>
            </div>

            <div className="stats-row">
              <article className="stat-card"><p>PEDIDOS</p><strong>{restaurantOrders.length}</strong><small>Últimos registros</small></article>
              <article className="stat-card"><p>PENDIENTES</p><strong>{restaurantOrders.filter((o) => o.status === 'PENDING').length}</strong><small>Activos ahora</small></article>
              <article className="stat-card"><p>GANADO</p><strong>{formatPrice(restaurantOrders.filter((o) => o.status === 'DELIVERED').reduce((acc, item) => acc + Number(item.total), 0))}</strong><small>Entregados</small></article>
              <article className="stat-card"><p>MENÚ</p><strong>{menuItems.length}</strong><small>Platillos cargados</small></article>
            </div>

            {(restaurantPanel === 'resumen' || restaurantPanel === 'pedidos') && (
              <>
                <div className="orders-grid-title">📦 Pedidos entrantes</div>
                <div className="orders-grid">
                  {restaurantOrders.length === 0 && <div className="menu-empty">Aún no hay pedidos entrantes para este restaurante.</div>}
                  {restaurantOrders.map((order) => {
                    const distanceKm =
                      selectedRestaurant?.lat != null
                      && selectedRestaurant?.lng != null
                      && order.client_lat != null
                      && order.client_lng != null
                        ? haversineKm(selectedRestaurant.lat, selectedRestaurant.lng, order.client_lat, order.client_lng)
                        : null;

                    return (
                      <article key={order.id} className={`incoming-order ${order.status === 'PENDING' ? 'new' : ''}`}>
                        <div className="order-head"><h4>Pedido #{order.order_number}</h4><span>{statusLabel(order.status)}</span></div>
                        <p><strong>Total:</strong> {formatPrice(Number(order.total))}</p>
                        <div className="client-box">
                          👤 {order.client_name ?? 'Sin nombre'} · 📱 {order.client_phone ?? 'Sin teléfono'}
                          {buildWhatsAppUrl(order.client_phone, order) && (
                            <>
                              {' '}
                              <a className="wa-link" href={buildWhatsAppUrl(order.client_phone, order) ?? '#'} target="_blank" rel="noreferrer" title="Abrir WhatsApp con mensaje prellenado">
                                WhatsApp
                              </a>
                            </>
                          )}
                          <br />📝 {order.client_location_note ?? 'Sin referencia de ubicación'}
                        </div>
                        <div className="distance-box">📍 Distancia estimada: <strong>{distanceKm != null ? `${distanceKm.toFixed(1)} km` : 'Sin coordenadas suficientes'}</strong></div>
                        {order.client_lat != null && order.client_lng != null && (
                          <div className="mini-map-box">
                            <MapViewer lat={order.client_lat} lng={order.client_lng} title={`Pedido #${order.order_number} · Ubicación cliente`} />
                            <a className="map-link" href={`https://maps.google.com/?q=${order.client_lat},${order.client_lng}`} target="_blank" rel="noreferrer">Abrir en Google Maps</a>
                          </div>
                        )}

                        {order.status === 'PENDING' && (
                          <div className="order-actions">
                            <button className="btn green" disabled={actionLoading} onClick={() => void updateRestaurantOrderStatus(order, 'ACCEPTED')}>✓ Aceptar pedido</button>
                            <button
                              className="btn amber"
                              disabled={actionLoading}
                              onClick={() => {
                                const reason = window.prompt('Motivo de rechazo por distancia:', 'No alcanzamos a cubrir esa zona por ahora.');
                                if (reason !== null) void updateRestaurantOrderStatus(order, 'REJECTED', reason);
                              }}
                            >✗ Rechazar por distancia</button>
                            <button className="btn" disabled={actionLoading} onClick={() => void updateRestaurantOrderStatus(order, 'ACCEPTED', 'Pedido aceptado, habrá demora en entrega.')}>🕒 Aprobado, me tardaré</button>
                          </div>
                        )}

                        {order.status === 'ACCEPTED' && (
                          <div className="order-actions">
                            <button className="btn" disabled={actionLoading} onClick={() => void updateRestaurantOrderStatus(order, 'ON_THE_WAY')}>🛵 Marcar en camino</button>
                          </div>
                        )}

                        {order.status === 'ON_THE_WAY' && (
                          <div className="order-actions">
                            <button className="btn green" disabled={actionLoading} onClick={() => void updateRestaurantOrderStatus(order, 'DELIVERED')}>✅ Marcar entregado</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            )}

            {(restaurantPanel === 'resumen' || restaurantPanel === 'menu') && (
              <div className="menu-editor">
                <div className="menu-editor-head"><h3>📋 Mi Menú</h3></div>
                <div className="menu-create-grid">
                  <div className="fg"><label>Nombre del platillo</label><input className="fi" placeholder="ej. Combo familiar" value={menuDraft.name} onChange={(e) => setMenuDraft((prev) => ({ ...prev, name: e.target.value }))} /></div>
                  <div className="fg"><label>Precio MXN</label><input className="fi" type="number" min="1" step="1" placeholder="150" value={menuDraft.price} onChange={(e) => setMenuDraft((prev) => ({ ...prev, price: e.target.value }))} /></div>
                  <div className="fg"><label>Categoría</label><input className="fi" placeholder="Especialidades" value={menuDraft.category} onChange={(e) => setMenuDraft((prev) => ({ ...prev, category: e.target.value }))} /></div>
                  <div className="fg menu-create-full"><label>Descripción</label><textarea className="fta" placeholder="Describe ingredientes o promoción" value={menuDraft.description} onChange={(e) => setMenuDraft((prev) => ({ ...prev, description: e.target.value }))} /></div>
                </div>
                <button className="btn" onClick={createMenuItem} disabled={actionLoading || !selectedRestaurant}>+ Agregar platillo</button>
                <div className="menu-cards">
                  {menuItems.map((item) => (
                    <article className="menu-card" key={item.id}>
                      <div className="menu-emoji">🍽️</div>
                      <div className="menu-info"><h4>{item.name}</h4><p>{formatPrice(item.price)}</p><small>{item.available ? 'Disponible' : 'No disponible'}</small></div>
                      <button className="btn ghost" onClick={() => toggleMenuItemAvailability(item)}>{item.available ? 'Pausar' : 'Activar'}</button>
                    </article>
                  ))}
                  {menuItems.length === 0 && <div className="menu-empty">Aún no tienes platillos. Usa el formulario para agregar el primero.</div>}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {isRestaurantsRoute && restaurantsMode === 'register' && (
        <div className="page active">
          <div className="regpage">
            <div className="regcard">
              <div className="reghead">
                <h2>Registra tu restaurante</h2>
                <p>El admin revisará y activará tu cuenta en 24 hrs</p>
              </div>
              <div className="regbody">
                <div className="fg"><label>Nombre del restaurante</label><input className="fi" placeholder="ej. Birriería La Guadalupana" value={registerForm.restaurantName} onChange={(e) => setRegisterForm((p) => ({ ...p, restaurantName: e.target.value }))} /></div>
                <div className="frow">
                  <div className="fg"><label>Email</label><input className="fi" type="email" placeholder="tu@correo.com" value={registerForm.email} onChange={(e) => setRegisterForm((p) => ({ ...p, email: e.target.value }))} /></div>
                  <div className="fg"><label>WhatsApp</label><input className="fi" placeholder="344 000 0000" value={registerForm.whatsapp} onChange={(e) => setRegisterForm((p) => ({ ...p, whatsapp: e.target.value }))} /></div>
                </div>
                <div className="frow">
                  <div className="fg"><label>Contraseña del panel</label><input className="fi" type="password" placeholder="Mínimo 8 caracteres" value={registerForm.password} onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))} /></div>
                  <div className="fg"><label>Tipo de comida</label><select className="fs" value={registerForm.type} onChange={(e) => setRegisterForm((p) => ({ ...p, type: e.target.value }))}><option value="CARNES">Carnes y parrilla</option><option value="BIRRIA">Birria y caldos</option><option value="TACOS">Tacos y antojitos</option><option value="POLLOS">Pollos y asados</option><option value="MARISCOS">Mariscos</option><option value="CORRIDA">Comida corrida</option><option value="ANTOJITOS">Antojitos</option><option value="OTRO">Otro</option></select></div>
                </div>
                <div className="fg"><label>Descripción breve</label><textarea className="fta" placeholder="¿Qué hace especial a tu restaurante?" value={registerForm.description} onChange={(e) => setRegisterForm((p) => ({ ...p, description: e.target.value }))} /></div>
                <div className="fg"><label>Radio de entrega máximo</label><select className="fs" value={registerForm.radius} onChange={(e) => setRegisterForm((p) => ({ ...p, radius: e.target.value }))}><option value="5">5 km</option><option value="10">10 km</option><option value="15">15 km</option><option value="20">20 km</option><option value="30">30 km</option></select></div>
                <div className="fg"><label>Zonas que cubre</label><div className="zchips">{['Aranda centro', 'Arandas', 'El Saucito', 'Las Flores', 'La Providencia', 'San José', 'El Llano', 'Ranchos varios'].map((zone) => (<button key={zone} type="button" className={`zchip ${selectedZones.includes(zone) ? 'on' : ''}`} onClick={() => toggleZone(zone)}>{zone}</button>))}</div></div>
                <div className="frow"><div className="fg"><label>Apertura</label><input className="fi" type="time" value={registerForm.openTime} onChange={(e) => setRegisterForm((p) => ({ ...p, openTime: e.target.value }))} /></div><div className="fg"><label>Cierre</label><input className="fi" type="time" value={registerForm.closeTime} onChange={(e) => setRegisterForm((p) => ({ ...p, closeTime: e.target.value }))} /></div></div>
                <button className="btnreg" onClick={submitRegister} disabled={actionLoading}>Enviar registro →</button>
                {registerMessage && <div className="regterms">{registerMessage}</div>}
              </div>
            </div>
          </div>
        </div>
      )}



      {isRestaurantsRoute && restaurantsMode === 'login' && activeTab !== 'restaurante' && (
        <div className="page active">
          <div className="regpage">
            <div className="regcard" style={{ maxWidth: '560px' }}>
              <div className="reghead">
                <h2>Ingreso de restaurante</h2>
                <p>Accede a tu panel con correo y contraseña</p>
              </div>
              <div className="regbody">
                <div className="fg"><label>Email</label><input className="fi" type="email" placeholder="tu@correo.com" value={registerForm.email} onChange={(e) => setRegisterForm((p) => ({ ...p, email: e.target.value }))} /></div>
                <div className="fg"><label>Contraseña del panel</label><input className="fi" type="password" placeholder="********" value={registerForm.password} onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))} /></div>
                <button className="btnreg" onClick={signInRestaurant} disabled={actionLoading}>Ingresar al panel →</button>
                {pendingOwnedRestaurant && <div className="pending-badge">⏳ {pendingOwnedRestaurant.name} está pendiente por aprobación del super admin.</div>}
                <div className="regterms">¿No tienes cuenta? <a href="#" onClick={(e) => { e.preventDefault(); navigate('/restaurantes?mode=register'); }}>Regístrate aquí</a>.</div>
                {registerMessage && <div className="regterms">{registerMessage}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {isAdminRoute && (
        <div className="page active">
          <div className="admin-layout" style={!isAdmin ? { gridTemplateColumns: '1fr' } : undefined}>
            {isAdmin && (<aside className="admin-sidebar">
              <h3>⚙️ Admin</h3>
              <ul>
                {[
                  { key: 'dashboard', label: '📊 Dashboard' },
                  { key: 'restaurantes', label: '🍽️ Restaurantes' },
                  { key: 'pedidos', label: '📦 Pedidos' },
                  { key: 'antispam', label: '🚨 Anti-spam' },
                  { key: 'mapa', label: '📍 Mapa en vivo' },
                  { key: 'reportes', label: '📈 Reportes' },
                  { key: 'config', label: '⚙️ Config' }
                ].map((panel) => (
                  <li
                    key={panel.key}
                    className={adminPanel === panel.key ? 'active' : ''}
                    onClick={() => setAdminPanel(panel.key as AdminPanelKey)}
                  >
                    {panel.label}
                  </li>
                ))}
              </ul>
            </aside>)}

            <section className="admin-main">
              <div className="admin-top">
                <h2>Panel de Administración — ArandaEats</h2>
                <span>{new Date().toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' })} · {new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} hrs</span>
              </div>

              {!isAdmin ? (
                <article className="admin-card">
                  <h4>Inicia sesión como super admin</h4>
                  <p>Solo las cuentas en <code>admin_profiles</code> pueden aprobar restaurantes pendientes.</p>
                  <div className="frow" style={{ marginTop: '1rem' }}>
                    <div className="fg"><label>Email admin</label><input className="fi" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@arandaeats.com" /></div>
                    <div className="fg"><label>Contraseña</label><input className="fi" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="••••••••" /></div>
                  </div>
                  <button className="btn" onClick={signInAdmin} disabled={actionLoading}>Entrar al panel admin</button>
                </article>
              ) : (
                <>
                  <div className="admin-session">
                    <p>Sesión admin activa: <strong>{adminUser?.email}</strong></p>
                    <div style={{ display: 'flex', gap: '.5rem' }}><button className="btn ghost" onClick={() => void Promise.all([loadPendingRestaurants(adminRpcEnabled), loadAdminDashboardData(adminRpcEnabled), loadAdminOrders(adminRpcEnabled), loadAdminMapPoints(adminRpcEnabled)])}>Actualizar</button><button className="btn ghost" onClick={signOutAdmin}>Cerrar sesión</button></div>
                  </div>

                  <div className="admin-panel-tabs">
                    {[
                      { key: 'dashboard', label: '📊 Dashboard' },
                      { key: 'restaurantes', label: '🍽️ Restaurantes' },
                      { key: 'pedidos', label: '📦 Pedidos' },
                      { key: 'antispam', label: '🚨 Anti-spam' },
                      { key: 'mapa', label: '📍 Mapa en vivo' },
                      { key: 'reportes', label: '📈 Reportes' },
                      { key: 'config', label: '⚙️ Config' }
                    ].map((panel) => (
                      <button
                        key={panel.key}
                        className={`admin-panel-tab ${adminPanel === panel.key ? 'active' : ''}`}
                        onClick={() => setAdminPanel(panel.key as AdminPanelKey)}
                      >
                        {panel.label}
                      </button>
                    ))}
                  </div>

                  {(adminPanel === 'dashboard' || adminPanel === 'restaurantes') && (
                    <div className="admin-stats">
                      <article className="admin-stat-card"><strong>{adminSummary.active_restaurants}</strong><span>REST. ACTIVOS</span></article>
                      <article className="admin-stat-card"><strong style={{ color: 'var(--brand)' }}>{adminSummary.pending_restaurants}</strong><span>PEND. APROB.</span></article>
                      <article className="admin-stat-card"><strong>{adminSummary.orders_month}</strong><span>PEDIDOS/MES</span></article>
                      <article className="admin-stat-card"><strong style={{ color: 'var(--green)' }}>{formatPrice(adminSummary.moved_month)}</strong><span>MOVIDO/MES</span></article>
                      <article className="admin-stat-card"><strong style={{ color: '#C00' }}>{adminSummary.blocked_entities}</strong><span>IPS BLOQ.</span></article>
                    </div>
                  )}

                  {(adminPanel === 'dashboard' || adminPanel === 'restaurantes') && (
                    <article className="admin-card">
                      <h4>📝 Solicitudes pendientes para aprobación</h4>
                      <div className="admin-requests">
                        {(pendingRestaurants.length > 0 ? pendingRestaurants : derivedPendingFromOverview).map((request) => (
                          <article className="admin-request-card" key={request.id}>
                            <h4>{request.name}</h4>
                            <p>Correo: {'email' in request ? request.email : 'No disponible'} · WhatsApp: {'phone' in request ? request.phone : 'No disponible'}</p>
                            <div className="admin-status-row">
                              <span className="status-pill pendiente">PENDIENTE</span>
                              <div className="order-actions">
                                <button className="btn green" onClick={() => updatePendingRestaurant(request.id, 'ACTIVE')} disabled={actionLoading}>Aprobar</button>
                                <button className="btn ghost" onClick={() => updatePendingRestaurant(request.id, 'SUSPENDED')} disabled={actionLoading}>Rechazar</button>
                              </div>
                            </div>
                          </article>
                        ))}
                        {pendingRestaurants.length === 0 && derivedPendingFromOverview.length === 0 && <article className="admin-request-card"><h4>Sin solicitudes pendientes</h4><p>Todo está al día por ahora.</p></article>}
                      </div>
                    </article>
                  )}

                  {(adminPanel === 'dashboard' || adminPanel === 'restaurantes') && (
                    <article className="admin-card">
                      <h4>🍽️ Restaurantes</h4>
                      {adminRestaurants.map((item) => (
                        <div key={item.id} className="admin-restaurant-row">
                          <div>
                            <strong>{item.name}</strong>
                            <p>{item.orders_today} pedidos hoy</p>
                          </div>
                          <span className={`status-pill ${statusClassByRestaurant[item.status]}`}>{item.status}</span>
                        </div>
                      ))}
                    </article>
                  )}

                  {(adminPanel === 'dashboard' || adminPanel === 'pedidos') && (
                    <article className="admin-card">
                      <h4>📦 Pedidos de la plataforma</h4>
                      <div className="admin-orders-table-wrap">
                        <table className="spam-table">
                          <thead>
                            <tr><th>#</th><th>Restaurante</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Fecha</th></tr>
                          </thead>
                          <tbody>
                            {adminOrders.map((order) => (
                              <tr key={order.id}>
                                <td>#{order.order_number}</td>
                                <td>{order.restaurant_name}</td>
                                <td>{order.client_name ?? 'Sin nombre'} · {order.client_phone ?? 'Sin teléfono'}</td>
                                <td>{formatPrice(order.total)}</td>
                                <td>{statusLabel(order.status)}</td>
                                <td>{formatRelative(order.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  )}

                  {(adminPanel === 'dashboard' || adminPanel === 'antispam') && (
                    <article className="admin-card spam-card">
                      <h4>🚨 Panel Anti-Spam — IPs y dispositivos sospechosos</h4>
                      <table className="spam-table">
                        <thead>
                          <tr><th>IP / Dispositivo</th><th>Pedidos hoy</th><th>Cancelados</th><th>Rechazados</th><th>Último pedido</th><th>Acción</th></tr>
                        </thead>
                        <tbody>
                          {adminAntiSpam.map((row) => (
                            <tr key={row.entity}>
                              <td>{row.entity}</td>
                              <td>{row.orders_today}</td>
                              <td>{row.cancelled}</td>
                              <td>{row.rejected}</td>
                              <td>{formatRelative(row.last_order_at)}</td>
                              <td><button className={`btn ${row.orders_today >= 5 ? 'red' : 'ghost'}`} onClick={() => row.orders_today >= 5 && void blockEntity(row.entity)} disabled={actionLoading}>{row.orders_today >= 5 ? 'Bloquear IP' : 'Vigilar'}</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </article>
                  )}

                  {(adminPanel === 'dashboard' || adminPanel === 'mapa') && (
                    <article className="admin-card">
                      <h4>📍 Mapa en vivo — restaurantes activos</h4>
                      <div className="admin-live-map">
                        {adminMapPoints.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((point) => {
                          const x = Math.min(96, Math.max(4, ((point.lng + 103) / 1.5) * 100));
                          const y = Math.min(94, Math.max(6, ((21.8 - point.lat) / 1.2) * 100));
                          return (
                            <div key={point.id} className="admin-map-point" style={{ left: `${x}%`, top: `${y}%` }}>
                              <span className={`admin-map-dot ${point.status === 'ACTIVE' ? 'ok' : 'warn'}`}>📍</span>
                              <small>{point.name}</small>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  )}

                  {(adminPanel === 'dashboard' || adminPanel === 'reportes') && (
                    <article className="admin-card">
                      <h4>📊 Pedidos por restaurante — últimos 30 días</h4>
                      <div className="bars">
                        {adminOrdersChart.map((item) => {
                          const max = adminOrdersChart[0]?.orders_count ?? 1;
                          const width = Math.max(8, Math.round((item.orders_count / max) * 100));
                          return (
                            <div key={item.restaurant_name} className="bar-row">
                              <span>{item.restaurant_name}</span>
                              <div className="bar-track"><div className="bar-fill" style={{ width: `${width}%` }} /></div>
                              <strong>{item.orders_count}</strong>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  )}

                  {adminPanel === 'config' && (
                    <article className="admin-card">
                      <h4>⚙️ Configuración super admin</h4>
                      <div className="frow">
                        <div className="fg"><label>Cuenta actual</label><input className="fi" value={adminUser?.email ?? ''} readOnly /></div>
                        <div className="fg"><label>Estatus de rol</label><input className="fi" value={isAdmin ? 'SUPER ADMIN ACTIVO' : 'Sin permisos'} readOnly /></div>
                      </div>
                      <p style={{ color: 'var(--muted)' }}>Proyecto conectado: <code>{import.meta.env.VITE_SUPABASE_URL}</code></p><p style={{ color: 'var(--muted)' }}>Si en SQL Editor ves restaurantes PENDING y aquí no, casi siempre es por URL/KEY de otro proyecto o migraciones 002/003 faltantes.</p>
                      <p style={{ color: 'var(--muted)' }}>Fallback Edge Function admin-restaurants: <strong>{adminFunctionEnabled ? 'habilitado' : 'deshabilitado (error CORS/404 detectado)'}</strong>.</p>
                    </article>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      )}

      <div className={`overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-top" style={{ background: 'linear-gradient(135deg,#8B2D07,#C8410B)' }}>🥩<button className="modal-x" onClick={() => setMenuOpen(false)}>✕</button></div>
          <div className="modal-body">
            <div className="mtitle">{selectedRestaurant?.name ?? 'Menú del restaurante'}</div>
            <div className="mmeta">⭐ 4.8 · 📍 Hasta {Math.round(selectedRestaurant?.delivery_radius_km ?? 20)} km · ⏱️ ~45 min · 💵 Solo efectivo</div>

            <div className="wizard-steps" role="tablist" aria-label="Pasos para pedir">
              <button className={`wizard-step ${orderWizardStep === 1 ? 'active' : orderWizardStep > 1 ? 'done' : ''}`} onClick={() => goToWizardStep(1)}>1. Productos</button>
              <button className={`wizard-step ${orderWizardStep === 2 ? 'active' : orderWizardStep > 2 ? 'done' : ''}`} onClick={() => goToWizardStep(2)}>2. Datos y referencia</button>
              <button className={`wizard-step ${orderWizardStep === 3 ? 'active' : ''}`} onClick={() => goToWizardStep(3)}>3. Ubicación en mapa</button>
            </div>

            {orderWizardStep === 1 && (
              <>
                <div className="wizard-section-title">Paso 1 · Elige tus productos</div>
                <div className="menu-categories-scroll">
                  {Object.keys(groupedMenuItems).map((sectionName) => (
                    <span key={sectionName} className="menu-chip">{sectionName}</span>
                  ))}
                </div>

                {Object.entries(groupedMenuItems).map(([sectionName, sectionItems]) => (
                  <div key={sectionName} className="menu-section">
                    <h4>{sectionName.toUpperCase()}</h4>
                    <div className="product-grid">
                      {sectionItems.map((item) => (
                        <article className="product-card" key={item.id}>
                          <div className="product-cover">🍽️</div>
                          <div className="product-body">
                            <div className="product-title">{item.name}</div>
                            <div className="product-desc">{item.description ?? 'Sin descripción'}</div>
                            <div className="product-footer">
                              <div className="product-price">{formatPrice(item.price)}</div>
                              <div className="qty-row">
                                <button className="madd msub" onClick={() => removeItem(item)}>-</button>
                                <span className="mqty">{getItemQty(item.id)}</span>
                                <button className="madd" onClick={() => addItem(item)}>+</button>
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}

                {menuLoading && <div className="menu-empty">Cargando platillos del restaurante…</div>}
                {!menuLoading && Object.keys(groupedMenuItems).length === 0 && (
                  <div className="menu-empty">
                    Este restaurante aún no tiene platillos publicados.
                    <br />
                    Pídele al restaurante que agregue su menú en el panel de restaurantes.
                  </div>
                )}
              </>
            )}

            {orderWizardStep === 2 && (
              <>
                <div className="wizard-section-title">Paso 2 · Tus datos y referencia</div>
                <div className="client-form">
                  <div className="client-form-title">Tus datos de contacto <span>(opcionales pero muy útiles)</span></div>
                  <div className="cf-grid">
                    <div><label className="cfl">Tu nombre</label><input className="cfi" placeholder="ej. Juan Pérez" value={clientName} onChange={(e) => setClientName(e.target.value)} /></div>
                    <div><label className="cfl">WhatsApp</label><input className="cfi" placeholder="344 123 4567" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} /></div>
                  </div>
                  <div><label className="cfl">Referencia de tu ubicación (ayuda mucho al repartidor)</label><textarea className="cfta" placeholder="ej. Rancho Las Flores, después del puente..." value={clientRef} onChange={(e) => setClientRef(e.target.value)} /></div>
                  <div className="cf-hint">💡 Si das tu WhatsApp, el restaurante puede confirmarte antes de salir. Mientras más detallada la referencia, más fácil llega.</div>
                </div>
              </>
            )}

            {orderWizardStep === 3 && (
              <>
                <div className="wizard-section-title">Paso 3 · Marca tu ubicación en el mapa</div>
                <MapPicker lat={clientPoint.lat} lng={clientPoint.lng} onChange={setClientPoint} />
              </>
            )}

            <div className="cash-note">💵 Sin registro requerido · Pago en efectivo al recibir · El restaurante confirma antes de salir</div>

            <div className="cart-bar" style={{ display: 'flex' }}>
              <div className="cart-info">🛒 {cartCount} productos · Total: <strong>{formatPrice(cartTotal)}</strong></div>
              <div className="wizard-actions">
                {orderWizardStep > 1 && (
                  <button className="btn ghost" onClick={() => setOrderWizardStep((prev) => (prev === 3 ? 2 : 1))} disabled={actionLoading}>Atrás</button>
                )}
                {orderWizardStep < 3 ? (
                  <button className="btn btn-order" onClick={() => goToWizardStep((orderWizardStep + 1) as 2 | 3)} disabled={actionLoading || cartCount === 0}>
                    Continuar
                  </button>
                ) : (
                  <button className="btn btn-order" onClick={submitOrder} disabled={actionLoading || cartCount === 0}>HACER PEDIDO</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
