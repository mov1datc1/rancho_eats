import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import MapPicker from './components/map/MapPicker';
import MapViewer from './components/map/MapViewer';
import { supabase } from './lib/supabase';
import { formatPrice, statusLabel } from './lib/utils';
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
  MenuItemOption,
  Order,
  Restaurant
} from './types';

type TabKey = 'cliente' | 'seguimiento' | 'restaurante' | 'registro' | 'admin';
type RestaurantPanelKey = 'dashboard' | 'resumen' | 'pedidos' | 'menu' | 'delivery' | 'config';
type AdminPanelKey = 'dashboard' | 'restaurantes' | 'comisiones' | 'pedidos' | 'antispam' | 'mapa' | 'reportes' | 'config';
type MenuDraftOption = { label: string; price: string; imageUrl: string };

const RESTAURANT_IMAGE_RECOMMENDED = { width: 1200, height: 675 };
const sanitizeImageUrl = (value: string) => value.replace(/\s+/g, '').trim();
const isValidRestaurantImageUrl = (value: string) => /^(https?:\/\/|data:image\/)/i.test(value);


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

const nextStatusByOrderState: Record<string, Array<'ACCEPTED' | 'REJECTED' | 'ON_THE_WAY' | 'DELIVERED'>> = {
  PENDING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['ON_THE_WAY', 'DELIVERED'],
  ON_THE_WAY: ['DELIVERED']
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

const getOrderCommission = (order: Pick<Order, 'commission_amount'>) => Math.max(0, Number(order.commission_amount ?? 0));
const getOrderSubtotal = (order: Pick<Order, 'subtotal' | 'total' | 'commission_amount' | 'delivery_amount'>) => {
  const directSubtotal = Number(order.subtotal ?? NaN);
  if (Number.isFinite(directSubtotal)) return Math.max(0, directSubtotal);
  const fallback = Number(order.total) - getOrderCommission(order) - getOrderDelivery(order);
  return Math.max(0, fallback);
};

const getOrderDelivery = (order: Pick<Order, 'delivery_amount'>) => Math.max(0, Number(order.delivery_amount ?? 0));
const getRestaurantDeliveryFeeByDistance = (restaurant: Restaurant | null, distanceKm: number | null) => {
  if (!restaurant || !Number.isFinite(Number(distanceKm)) || distanceKm == null) return 0;
  const d = Number(distanceKm);
  if (d <= 10) return Math.max(0, Number(restaurant.delivery_fee_0_10 ?? 0));
  if (d <= 15) return Math.max(0, Number(restaurant.delivery_fee_10_15 ?? 0));
  if (d <= 20) return Math.max(0, Number(restaurant.delivery_fee_15_20 ?? 0));
  if (d <= 30) return Math.max(0, Number(restaurant.delivery_fee_20_30 ?? 0));
  return Math.max(0, Number(restaurant.delivery_fee_20_30 ?? 0));
};

const isRpcMissingError = (error: unknown) => {
  const err = error as { code?: string; message?: string; details?: string } | null;
  if (!err) return false;
  return err.code === 'PGRST202'
    || (err.message ?? '').includes('404')
    || (err.details ?? '').toLowerCase().includes('function')
    || (err.message ?? '').toLowerCase().includes('could not find');
};

const isMenuOptionsMissingTableError = (error: unknown) => {
  const err = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  if (!err) return false;
  const fullText = `${err.message ?? ''} ${err.details ?? ''} ${err.hint ?? ''}`.toLowerCase();
  return err.code === 'PGRST205' || fullText.includes('menu_item_options') || fullText.includes('schema cache');
};

const isMenuOptionsImageColumnMissingError = (error: unknown) => {
  const err = error as { message?: string; details?: string; hint?: string } | null;
  if (!err) return false;
  const fullText = `${err.message ?? ''} ${err.details ?? ''} ${err.hint ?? ''}`.toLowerCase();
  return fullText.includes('image_url') && fullText.includes('menu_item_options');
};

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
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
  address: '',
  radius: '10',
  openTime: '09:00',
  closeTime: '21:00'
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('cliente');
  const [restaurantsMenuOpen, setRestaurantsMenuOpen] = useState(false);
  const [restaurantPanel, setRestaurantPanel] = useState<RestaurantPanelKey>('dashboard');
  const [selectedZones, setSelectedZones] = useState<string[]>(['Aranda centro', 'El Saucito']);
  const [adminPanel, setAdminPanel] = useState<AdminPanelKey>('dashboard');

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [pendingRestaurants, setPendingRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [restaurantOrders, setRestaurantOrders] = useState<Order[]>([]);
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLoading, setMenuLoading] = useState(false);
  const [trackNumber, setTrackNumber] = useState('1043');
  const [searchedOrder, setSearchedOrder] = useState<Order | null>(null);

  const [clientPoint, setClientPoint] = useState({ lat: 21.0419, lng: -102.3425 });
  const [registerPoint, setRegisterPoint] = useState({ lat: 21.0419, lng: -102.3425 });
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
    category: 'Especialidades',
    imageUrl: ''
  });
  const [menuDraftOptions, setMenuDraftOptions] = useState<MenuDraftOption[]>([{ label: '', price: '', imageUrl: '' }]);
  const [menuOptionsEnabled, setMenuOptionsEnabled] = useState(true);
  const [menuOptionsNotice, setMenuOptionsNotice] = useState('');
  const [dashboardDateFrom, setDashboardDateFrom] = useState('');
  const [dashboardDateTo, setDashboardDateTo] = useState('');
  const [configDraft, setConfigDraft] = useState({
    openTime: '09:00',
    closeTime: '21:00',
    restaurantImageUrl: '',
    address: '',
    lat: '',
    lng: '',
    deliveryFee0_10: '0',
    deliveryFee10_15: '0',
    deliveryFee15_20: '0',
    deliveryFee20_30: '0'
  });
  const [configPassword, setConfigPassword] = useState('');
  const [restaurantImageMeta, setRestaurantImageMeta] = useState<{ width: number; height: number } | null>(null);
  const [restaurantImageNotice, setRestaurantImageNotice] = useState('');

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    reader.readAsDataURL(file);
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
  const [commissionAmount, setCommissionAmount] = useState(0);
  const [commissionDraft, setCommissionDraft] = useState('0');

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
  const restaurantImageInputRef = useRef<HTMLInputElement | null>(null);

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const isAdminRoute = location.pathname === '/administrador';
  const isRestaurantsRoute = location.pathname === '/restaurantes';
  const isTestRoute = location.pathname === '/pruebas';
  const restaurantsMode = new URLSearchParams(location.search).get('mode') === 'login' ? 'login' : 'register';
  const isStandalone = mobileInstallContext.isStandalone;

  const derivedPendingFromOverview = useMemo(() => adminRestaurants.filter((item) => item.status === 'PENDING'), [adminRestaurants]);
  const cartCount = useMemo(() => cartItems.reduce((acc, item) => acc + item.qty, 0), [cartItems]);
  const cartSubtotal = useMemo(() => cartItems.reduce((acc, item) => acc + item.subtotal, 0), [cartItems]);
  const estimatedDeliveryDistanceKm = useMemo(() => {
    if (!selectedRestaurant) return null;
    if (!Number.isFinite(Number(selectedRestaurant.lat)) || !Number.isFinite(Number(selectedRestaurant.lng))) return null;
    return haversineKm(Number(selectedRestaurant.lat), Number(selectedRestaurant.lng), clientPoint.lat, clientPoint.lng);
  }, [selectedRestaurant, clientPoint.lat, clientPoint.lng]);
  const cartDelivery = useMemo(() => (cartCount > 0 && orderWizardStep === 3 ? getRestaurantDeliveryFeeByDistance(selectedRestaurant, estimatedDeliveryDistanceKm) : 0), [cartCount, orderWizardStep, selectedRestaurant, estimatedDeliveryDistanceKm]);
  const cartCommission = useMemo(() => (cartCount > 0 ? Math.max(0, commissionAmount) : 0), [cartCount, commissionAmount]);
  const cartTotal = useMemo(() => cartSubtotal + cartCommission + cartDelivery, [cartSubtotal, cartCommission, cartDelivery]);
  const groupedMenuItems = useMemo(() => {
    const source = menuItems.filter((item) => item.available);
    return source.reduce<Record<string, MenuItem[]>>((acc, item) => {
      const section = item.category?.trim() || 'Especialidades';
      if (!acc[section]) acc[section] = [];
      acc[section].push(item);
      return acc;
    }, {});
  }, [menuItems]);
  const filteredRestaurantOrders = useMemo(() => {
    const normalizedTerm = orderSearchTerm.trim();
    const fromDate = orderDateFrom ? new Date(`${orderDateFrom}T00:00:00`) : null;
    const toDate = orderDateTo ? new Date(`${orderDateTo}T23:59:59`) : null;

    return restaurantOrders.filter((order) => {
      const orderDate = new Date(order.created_at);
      const matchesOrderNumber = !normalizedTerm || String(order.order_number).includes(normalizedTerm);
      const matchesFrom = !fromDate || orderDate >= fromDate;
      const matchesTo = !toDate || orderDate <= toDate;
      return matchesOrderNumber && matchesFrom && matchesTo;
    });
  }, [restaurantOrders, orderDateFrom, orderDateTo, orderSearchTerm]);
  const selectedOrder = useMemo(
    () => restaurantOrders.find((order) => order.id === selectedOrderId) ?? null,
    [restaurantOrders, selectedOrderId]
  );

  const restaurantImagePreviewSrc = useMemo(() => {
    const cleaned = sanitizeImageUrl(configDraft.restaurantImageUrl);
    return cleaned && isValidRestaurantImageUrl(cleaned) ? cleaned : '';
  }, [configDraft.restaurantImageUrl]);

  const selectedOrderDisplayItems = useMemo(() => {
    if (!selectedOrder || !Array.isArray(selectedOrder.items)) return [] as CartItem[];

    const normalizeMoney = (value: number) => Math.round(value * 100);
    const denormalizeMoney = (value: number) => value / 100;

    const rawItems = selectedOrder.items.filter((item) => Number.isFinite(Number(item.subtotal)) && Number(item.subtotal) > 0);
    const rawSubtotal = rawItems.reduce((acc, item) => acc + normalizeMoney(Number(item.subtotal)), 0);
    const orderTotal = normalizeMoney(Number(selectedOrder.total));

    let itemsToDisplay = rawItems;

    if (rawItems.length > 0 && orderTotal > 0 && rawSubtotal !== orderTotal) {
      const dp = new Map<number, number[]>();
      dp.set(0, []);

      rawItems.forEach((item, index) => {
        const itemValue = normalizeMoney(Number(item.subtotal));
        if (itemValue <= 0) return;

        const snapshot = Array.from(dp.entries());
        snapshot.forEach(([sum, indices]) => {
          const nextSum = sum + itemValue;
          if (nextSum > orderTotal || dp.has(nextSum)) return;
          dp.set(nextSum, [...indices, index]);
        });
      });

      const matched = dp.get(orderTotal);
      if (matched && matched.length > 0) {
        itemsToDisplay = matched.map((index) => rawItems[index]);
      }
    }

    const grouped = new Map<string, CartItem>();
    itemsToDisplay.forEach((item) => {
      const key = `${item.menu_item_id}::${item.option_id ?? item.option_label ?? ''}::${item.name}::${item.unit_price}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...item });
        return;
      }

      const qty = existing.qty + item.qty;
      const subtotal = denormalizeMoney(normalizeMoney(Number(existing.subtotal)) + normalizeMoney(Number(item.subtotal)));
      grouped.set(key, { ...existing, qty, subtotal });
    });

    return Array.from(grouped.values());
  }, [selectedOrder]);
  const pendingOwnedRestaurant = pendingRestaurants.find((item) => item.owner_id && item.owner_id === adminUser?.id) ?? null;
  const dashboardOrders = useMemo(() => {
    const fromDate = dashboardDateFrom ? new Date(`${dashboardDateFrom}T00:00:00`) : null;
    const toDate = dashboardDateTo ? new Date(`${dashboardDateTo}T23:59:59`) : null;

    return restaurantOrders.filter((order) => {
      const orderDate = new Date(order.created_at);
      if (fromDate && orderDate < fromDate) return false;
      if (toDate && orderDate > toDate) return false;
      return true;
    });
  }, [dashboardDateFrom, dashboardDateTo, restaurantOrders]);
  const dashboardMetrics = useMemo(() => {
    const accepted = dashboardOrders.filter((order) => ['ACCEPTED', 'ON_THE_WAY'].includes(order.status)).length;
    const rejected = dashboardOrders.filter((order) => order.status === 'REJECTED').length;
    const delivered = dashboardOrders.filter((order) => order.status === 'DELIVERED').length;
    const pending = dashboardOrders.filter((order) => order.status === 'PENDING').length;
    const deliveredRevenue = dashboardOrders
      .filter((order) => order.status === 'DELIVERED')
      .reduce((acc, order) => acc + Number(order.total), 0);

    return {
      accepted,
      rejected,
      delivered,
      pending,
      total: dashboardOrders.length,
      deliveredRevenue
    };
  }, [dashboardOrders]);
  const dashboardTimeline = useMemo(() => {
    const byDay = new Map<string, { accepted: number; rejected: number; delivered: number }>();

    dashboardOrders.forEach((order) => {
      const key = new Date(order.created_at).toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, { accepted: 0, rejected: 0, delivered: 0 });
      const entry = byDay.get(key);
      if (!entry) return;

      if (['ACCEPTED', 'ON_THE_WAY'].includes(order.status)) entry.accepted += 1;
      if (order.status === 'REJECTED') entry.rejected += 1;
      if (order.status === 'DELIVERED') entry.delivered += 1;
    });

    const points = Array.from(byDay.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, values]) => ({ date, ...values }));

    const maxValue = points.reduce((acc, item) => Math.max(acc, item.accepted, item.rejected, item.delivered), 1);
    return { points, maxValue };
  }, [dashboardOrders]);

  useEffect(() => {
    if (!selectedRestaurant) return;
    setConfigDraft({
      openTime: selectedRestaurant.open_time ?? '09:00',
      closeTime: selectedRestaurant.close_time ?? '21:00',
      restaurantImageUrl: selectedRestaurant.photo_url ?? '',
      address: selectedRestaurant.address ?? '',
      lat: selectedRestaurant.lat != null ? String(selectedRestaurant.lat) : '',
      lng: selectedRestaurant.lng != null ? String(selectedRestaurant.lng) : '',
      deliveryFee0_10: String(selectedRestaurant.delivery_fee_0_10 ?? 0),
      deliveryFee10_15: String(selectedRestaurant.delivery_fee_10_15 ?? 0),
      deliveryFee15_20: String(selectedRestaurant.delivery_fee_15_20 ?? 0),
      deliveryFee20_30: String(selectedRestaurant.delivery_fee_20_30 ?? 0)
    });
    setRestaurantImageMeta(null);
    setRestaurantImageNotice('');
  }, [selectedRestaurant]);

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
        loadAdminMapPoints(rpcAvailable),
        loadCommissionSettings()
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
        loadAdminMapPoints(adminRpcEnabled),
        loadCommissionSettings()
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
      await loadCommissionSettings();
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar la información inicial. Revisa tu conexión con Supabase.');
    } finally {
      setLoading(false);
    }
  };

  const loadCommissionSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('commission_fee')
        .eq('id', 1)
        .maybeSingle();

      if (error) throw error;
      const nextCommission = Math.max(0, Number(data?.commission_fee ?? 0));
      setCommissionAmount(nextCommission);
      setCommissionDraft(nextCommission.toFixed(2));
    } catch (error) {
      console.error(error);
      setCommissionAmount(0);
      setCommissionDraft('0.00');
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
        const { data: pendingData, error: pendingError } = await supabase.rpc('admin_list_restaurant_requests');

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
      let normalizedMenu: MenuItem[] = [];

      if (menuOptionsEnabled) {
        const { data: menuWithOptions, error: menuWithOptionsError } = await supabase
          .from('menu_items')
          .select('*, menu_item_options(*)')
          .eq('restaurant_id', restaurantId)
          .order('sort_order', { ascending: true });

        if (menuWithOptionsError && isMenuOptionsMissingTableError(menuWithOptionsError)) {
          setMenuOptionsEnabled(false);
          setMenuOptionsNotice('Opciones de menú desactivadas temporalmente: falta ejecutar migración 007_menu_item_options.sql en Supabase.');
        } else if (menuWithOptionsError) {
          throw menuWithOptionsError;
        } else {
          normalizedMenu = ((menuWithOptions ?? []) as Array<MenuItem & { menu_item_options?: MenuItemOption[] }>).map((item) => ({
            ...item,
            menu_item_options: [...(item.menu_item_options ?? [])].sort((a, b) => a.sort_order - b.sort_order)
          }));
          setMenuOptionsNotice('');
        }
      }

      if (!menuOptionsEnabled || normalizedMenu.length === 0) {
        const { data: plainMenuData, error: plainMenuError } = await supabase
          .from('menu_items')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('sort_order', { ascending: true });

        if (plainMenuError) throw plainMenuError;
        normalizedMenu = (plainMenuData ?? []) as MenuItem[];
      }

      setMenuItems(normalizedMenu);

      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

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

  const buildCartKey = (menuItemId: string, option?: Pick<MenuItemOption, 'id' | 'label'> | null) => {
    if (!option) return menuItemId;
    return `${menuItemId}::${option.id ?? option.label}`;
  };

  const getItemOptionQty = (menuItemId: string, option?: Pick<MenuItemOption, 'id' | 'label'> | null) => {
    const cartKey = buildCartKey(menuItemId, option);
    return cart[cartKey]?.qty ?? 0;
  };

  const addItem = (item: MenuItem, option?: MenuItemOption) => {
    setCart((prev) => {
      const cartKey = buildCartKey(item.id, option ?? null);
      const existing = prev[cartKey];
      const unitPrice = option?.price ?? item.price;
      if (existing) {
        const qty = existing.qty + 1;
        return {
          ...prev,
          [cartKey]: { ...existing, qty, subtotal: qty * existing.unit_price }
        };
      }

      return {
        ...prev,
        [cartKey]: {
          menu_item_id: item.id,
          option_id: option?.id ?? null,
          option_label: option?.label ?? null,
          name: option?.label ? `${item.name} · ${option.label}` : item.name,
          qty: 1,
          unit_price: unitPrice,
          subtotal: unitPrice
        }
      };
    });
  };

  const removeItem = (item: MenuItem, option?: MenuItemOption) => {
    setCart((prev) => {
      const cartKey = buildCartKey(item.id, option ?? null);
      const existing = prev[cartKey];
      if (!existing) return prev;
      if (existing.qty <= 1) {
        const next = { ...prev };
        delete next[cartKey];
        return next;
      }

      const qty = existing.qty - 1;
      return {
        ...prev,
        [cartKey]: { ...existing, qty, subtotal: qty * existing.unit_price }
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

  const handleQuickOrderStatusChange = async (order: Order, rawStatus: string) => {
    if (!rawStatus) return;
    const status = rawStatus as 'ACCEPTED' | 'REJECTED' | 'ON_THE_WAY' | 'DELIVERED';

    if (status === 'REJECTED') {
      const reason = window.prompt('Motivo de rechazo:', 'No alcanzamos a cubrir esa zona por ahora.');
      if (reason === null) return;
      await updateRestaurantOrderStatus(order, status, reason);
      return;
    }

    await updateRestaurantOrderStatus(order, status);
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
          subtotal: cartSubtotal,
          commission_amount: cartCommission,
          delivery_amount: cartDelivery,
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
        address: registerForm.address || null,
        lat: registerPoint.lat,
        lng: registerPoint.lng,
        delivery_radius_km: Number(registerForm.radius),
        delivery_fee_0_10: 0,
        delivery_fee_10_15: 0,
        delivery_fee_15_20: 0,
        delivery_fee_20_30: 0,
        zones: selectedZones,
        open_time: registerForm.openTime,
        close_time: registerForm.closeTime,
        owner_id: signUpData.user?.id ?? null,
        status: 'PENDING'
      });

      if (insertError) throw insertError;

      setRegisterMessage('✅ Tu solicitud fue enviada. El admin la revisará para activarte.');
      setRegisterForm(baseForm);
      setRegisterPoint({ lat: 21.0419, lng: -102.3425 });
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

  const downloadDashboardPdf = () => {
    const reportWindow = window.open('', '_blank', 'width=900,height=700');
    if (!reportWindow) {
      setErrorMessage('No se pudo abrir la vista de impresión. Habilita pop-ups e inténtalo de nuevo.');
      return;
    }

    reportWindow.document.write(`
      <html>
        <head>
          <title>Reporte ${selectedRestaurant?.name ?? 'Restaurante'}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #2D1810; }
            h1 { margin: 0 0 8px; }
            p { margin: 0 0 16px; color: #6c4f3e; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #e8d7ca; padding: 8px; text-align: left; }
            th { background: #f7eee7; }
          </style>
        </head>
        <body>
          <h1>Dashboard · ${selectedRestaurant?.name ?? 'Restaurante'}</h1>
          <p>Rango: ${dashboardDateFrom || 'inicio'} a ${dashboardDateTo || 'hoy'}</p>
          <table>
            <thead><tr><th>Métrica</th><th>Valor</th></tr></thead>
            <tbody>
              <tr><td>Pedidos totales</td><td>${dashboardMetrics.total}</td></tr>
              <tr><td>Aceptados</td><td>${dashboardMetrics.accepted}</td></tr>
              <tr><td>Rechazados</td><td>${dashboardMetrics.rejected}</td></tr>
              <tr><td>Entregados</td><td>${dashboardMetrics.delivered}</td></tr>
              <tr><td>Pendientes</td><td>${dashboardMetrics.pending}</td></tr>
              <tr><td>Ingresos (entregados)</td><td>${formatPrice(dashboardMetrics.deliveredRevenue)}</td></tr>
            </tbody>
          </table>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
  };

  const onRestaurantImageFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setErrorMessage('');
      setRestaurantImageNotice('');
      const dataUrl = await fileToDataUrl(file);
      const safeDataUrl = sanitizeImageUrl(dataUrl);

      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
        img.src = safeDataUrl;
      });

      setConfigDraft((prev) => ({ ...prev, restaurantImageUrl: safeDataUrl }));
      setRestaurantImageMeta(dimensions);

      if (dimensions.width < RESTAURANT_IMAGE_RECOMMENDED.width || dimensions.height < RESTAURANT_IMAGE_RECOMMENDED.height) {
        setRestaurantImageNotice(`⚠️ Imagen pequeña (${dimensions.width}x${dimensions.height}px). Recomendado: ${RESTAURANT_IMAGE_RECOMMENDED.width}x${RESTAURANT_IMAGE_RECOMMENDED.height}px o mayor.`);
      } else {
        setRestaurantImageNotice(`✅ Imagen lista (${dimensions.width}x${dimensions.height}px).`);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo procesar la imagen. Prueba con JPG/PNG/WebP.');
    } finally {
      event.target.value = '';
    }
  };

  const updateRestaurantSettings = async () => {
    if (!selectedRestaurant) return;
    try {
      setActionLoading(true);
      setErrorMessage('');

      const cleanedImageUrl = sanitizeImageUrl(configDraft.restaurantImageUrl);
      if (cleanedImageUrl && !isValidRestaurantImageUrl(cleanedImageUrl)) {
        setErrorMessage('La imagen debe ser URL (http/https) o base64 válido (data:image/...).');
        return;
      }

      const parsedLat = Number(configDraft.lat);
      const parsedLng = Number(configDraft.lng);
      const fee0_10 = Math.max(0, Number(configDraft.deliveryFee0_10 || 0));
      const fee10_15 = Math.max(0, Number(configDraft.deliveryFee10_15 || 0));
      const fee15_20 = Math.max(0, Number(configDraft.deliveryFee15_20 || 0));
      const fee20_30 = Math.max(0, Number(configDraft.deliveryFee20_30 || 0));

      if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
        setErrorMessage('Configura coordenadas válidas del restaurante para calcular envío por kilometraje.');
        return;
      }

      const payload = {
        open_time: configDraft.openTime,
        close_time: configDraft.closeTime,
        photo_url: cleanedImageUrl || null,
        address: configDraft.address || null,
        lat: parsedLat,
        lng: parsedLng,
        delivery_fee_0_10: fee0_10,
        delivery_fee_10_15: fee10_15,
        delivery_fee_15_20: fee15_20,
        delivery_fee_20_30: fee20_30
      };

      const { data, error } = await supabase
        .from('restaurants')
        .update(payload)
        .eq('id', selectedRestaurant.id)
        .eq('owner_id', adminUser?.id ?? '')
        .select('*')
        .single();

      if (error) throw error;
      setSelectedRestaurant(data as Restaurant);
      await loadInitialData();
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo guardar la configuración del restaurante.');
    } finally {
      setActionLoading(false);
    }
  };

  const updateRestaurantPassword = async () => {
    if (!configPassword.trim() || configPassword.trim().length < 8) {
      setErrorMessage('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');
      const { error } = await supabase.auth.updateUser({ password: configPassword.trim() });
      if (error) throw error;
      setConfigPassword('');
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo actualizar la contraseña.');
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

    const parsedOptions = menuDraftOptions
      .map((option, index) => ({
        label: option.label.trim(),
        price: option.price.trim(),
        image_url: option.imageUrl.trim() || null,
        sort_order: index
      }))
      .filter((option) => option.label && option.price)
      .map((option) => ({
        label: option.label,
        price: Number(option.price),
        image_url: option.image_url,
        sort_order: option.sort_order,
        available: true
      }))
      .filter((option) => Number.isFinite(option.price) && option.price > 0);

    const hasOptions = parsedOptions.length > 0;

    if (!menuDraft.name.trim() || (!hasOptions && !menuDraft.price.trim())) {
      setErrorMessage('Completa nombre y precio del platillo (o agrega opciones con precio).');
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');

      const fallbackPrice = hasOptions ? Math.min(...parsedOptions.map((option) => option.price)) : Number(menuDraft.price);
      const payload = {
        restaurant_id: selectedRestaurant.id,
        name: menuDraft.name.trim(),
        description: menuDraft.description.trim() || null,
        price: fallbackPrice,
        category: menuDraft.category.trim() || 'Especialidades',
        photo_url_1: menuDraft.imageUrl.trim() || null,
        available: true
      };

      const { data: createdItem, error } = await supabase.from('menu_items').insert(payload).select('id').single();
      if (error) throw error;

      if (hasOptions && createdItem?.id) {
        if (menuOptionsEnabled) {
          const optionRows = parsedOptions.map((option) => ({
            menu_item_id: createdItem.id,
            label: option.label,
            price: option.price,
            image_url: option.image_url,
            sort_order: option.sort_order,
            available: true
          }));
          const { error: optionError } = await supabase.from('menu_item_options').insert(optionRows);
          if (optionError && isMenuOptionsMissingTableError(optionError)) {
            setMenuOptionsEnabled(false);
            setMenuOptionsNotice('El platillo se guardó, pero las opciones no: falta ejecutar migración 007_menu_item_options.sql en Supabase.');
          } else if (optionError && isMenuOptionsImageColumnMissingError(optionError)) {
            const fallbackRows = optionRows.map(({ image_url: _discard, ...rest }) => rest);
            const { error: fallbackOptionError } = await supabase.from('menu_item_options').insert(fallbackRows);
            if (fallbackOptionError) throw fallbackOptionError;
            setMenuOptionsNotice('Se guardaron opciones sin imagen. Ejecuta migración 008_menu_item_options_image_url.sql para habilitar imagen por opción.');
          } else if (optionError) {
            throw optionError;
          }
        } else {
          setMenuOptionsNotice('El platillo se guardó sin opciones porque aún falta la migración 007_menu_item_options.sql en Supabase.');
        }
      }

      setMenuDraft({ name: '', description: '', price: '', category: menuDraft.category, imageUrl: '' });
      setMenuDraftOptions([{ label: '', price: '', imageUrl: '' }]);
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

  const editMenuItem = async (item: MenuItem) => {
    const nextName = window.prompt('Nombre del platillo:', item.name);
    if (nextName === null) return;

    const nextPriceRaw = window.prompt('Precio base MXN:', String(item.price));
    if (nextPriceRaw === null) return;

    const nextCategory = window.prompt('Categoría:', item.category ?? 'Especialidades');
    if (nextCategory === null) return;

    const nextDescription = window.prompt('Descripción:', item.description ?? '');
    if (nextDescription === null) return;

    const nextImageUrl = window.prompt('Imagen del platillo (URL o base64):', item.photo_url_1 ?? '');
    if (nextImageUrl === null) return;

    const parsedPrice = Number(nextPriceRaw);
    if (!nextName.trim() || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setErrorMessage('Para editar: captura nombre válido y precio mayor a 0.');
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');
      const { error } = await supabase
        .from('menu_items')
        .update({
          name: nextName.trim(),
          price: parsedPrice,
          category: nextCategory.trim() || 'Especialidades',
          description: nextDescription.trim() || null,
          photo_url_1: nextImageUrl.trim() || null
        })
        .eq('id', item.id);
      if (error) throw error;

      if (menuOptionsEnabled && item.menu_item_options && item.menu_item_options.length > 0) {
        for (const option of item.menu_item_options) {
          const nextOptionPriceRaw = window.prompt(`Precio para opción "${option.label}"`, String(option.price));
          if (nextOptionPriceRaw === null) continue;
          const nextOptionLabel = window.prompt(`Nombre para opción "${option.label}"`, option.label);
          if (nextOptionLabel === null) continue;
          const nextOptionImageUrl = window.prompt(`Imagen para opción "${option.label}" (URL o base64)`, option.image_url ?? '');
          if (nextOptionImageUrl === null) continue;

          const parsedOptionPrice = Number(nextOptionPriceRaw);
          if (!Number.isFinite(parsedOptionPrice) || parsedOptionPrice <= 0) continue;

          const { error: optionUpdateError } = await supabase
            .from('menu_item_options')
            .update({
              label: nextOptionLabel.trim() || option.label,
              price: parsedOptionPrice,
              image_url: nextOptionImageUrl.trim() || null
            })
            .eq('id', option.id);

          if (optionUpdateError && isMenuOptionsImageColumnMissingError(optionUpdateError)) {
            const { error: fallbackOptionUpdateError } = await supabase
              .from('menu_item_options')
              .update({
                label: nextOptionLabel.trim() || option.label,
                price: parsedOptionPrice
              })
              .eq('id', option.id);
            if (fallbackOptionUpdateError) throw fallbackOptionUpdateError;
            setMenuOptionsNotice('Precios de opciones actualizados sin imagen. Ejecuta migración 008_menu_item_options_image_url.sql para habilitar imagen por opción.');
          } else if (optionUpdateError) throw optionUpdateError;
        }
      }

      if (selectedRestaurant) await loadRestaurantData(selectedRestaurant.id);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo editar el platillo.');
    } finally {
      setActionLoading(false);
    }
  };

  const deleteMenuItem = async (item: MenuItem) => {
    const accepted = window.confirm(`¿Seguro que deseas eliminar "${item.name}"? Esta acción no se puede deshacer.`);
    if (!accepted) return;

    try {
      setActionLoading(true);
      setErrorMessage('');
      const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
      if (error) throw error;
      if (selectedRestaurant) await loadRestaurantData(selectedRestaurant.id);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo eliminar el platillo.');
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

  const updateRestaurantStatus = async (
    restaurantId: string,
    status: 'ACTIVE' | 'SUSPENDED',
    previousStatus?: 'PENDING' | 'ACTIVE' | 'SUSPENDED'
  ) => {
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
        let fallbackQuery = supabase
          .from('restaurants')
          .update({ status })
          .eq('id', restaurantId);

        if (previousStatus) {
          fallbackQuery = fallbackQuery.eq('status', previousStatus);
        }

        const { error: fallbackError } = await fallbackQuery;

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

  const updatePendingRestaurant = async (restaurantId: string, status: 'ACTIVE' | 'SUSPENDED') => {
    await updateRestaurantStatus(restaurantId, status, 'PENDING');
  };

  const resetRestaurantPassword = async (restaurantId: string, restaurantName: string) => {
    if (!isAdmin) {
      setErrorMessage('Solo usuarios admin pueden resetear claves de restaurantes.');
      return;
    }

    const nextPassword = window.prompt(`Nueva contraseña para ${restaurantName}:`, '');
    if (nextPassword === null) return;
    if (nextPassword.trim().length < 8) {
      setErrorMessage('La nueva contraseña del restaurante debe tener al menos 8 caracteres.');
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');

      let rpcError: unknown = null;
      const { error } = await supabase.rpc('admin_reset_restaurant_password', {
        p_restaurant_id: restaurantId,
        p_password: nextPassword.trim()
      });
      rpcError = error;

      if (rpcError && isRpcMissingError(rpcError)) {
        const { error: fnError } = await supabase.functions.invoke('admin-restaurants', {
          body: {
            action: 'reset_password',
            restaurant_id: restaurantId,
            password: nextPassword.trim()
          }
        });

        if (fnError) {
          const msg = `${fnError.message ?? ''}`.toLowerCase();
          if (msg.includes('cors') || msg.includes('failed to send a request') || msg.includes('404') || msg.includes('not found')) {
            setAdminFunctionEnabled(false);
          }
          throw fnError;
        }
      } else if (rpcError) {
        throw rpcError;
      }

      window.alert(`✅ Contraseña actualizada para ${restaurantName}. Comparte la nueva clave con el restaurante.`);
    } catch (error) {
      console.error(error);
      setErrorMessage('No pudimos resetear la contraseña del restaurante. Ejecuta la migración 013_admin_reset_restaurant_password.sql o valida la Edge Function admin-restaurants.');
    } finally {
      setActionLoading(false);
    }
  };

  const saveCommissionSettings = async () => {
    if (!isAdmin) {
      setErrorMessage('Solo usuarios admin pueden actualizar comisiones.');
      return;
    }

    const parsed = Number(commissionDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setErrorMessage('Ingresa una comisión válida (número mayor o igual a 0).');
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');

      const normalized = Number(parsed.toFixed(2));
      const { error } = await supabase
        .from('app_settings')
        .upsert({ id: 1, commission_fee: normalized }, { onConflict: 'id' });

      if (error) throw error;

      setCommissionAmount(normalized);
      setCommissionDraft(normalized.toFixed(2));
    } catch (error) {
      console.error(error);
      setErrorMessage('No pudimos guardar la comisión global de la app.');
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
    { key: 'dashboard', label: '📈 Dashboard' },
    { key: 'resumen', label: '📊 Resumen' },
    { key: 'pedidos', label: '📦 Pedidos activos' },
    { key: 'menu', label: '📋 Mi menú' },
    { key: 'delivery', label: '🛵 Delivery' }
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
                  <div className="rcard-img" style={{ background: 'linear-gradient(135deg,#8B2D07,#C8410B)' }}>
                    {restaurant.photo_url && isValidRestaurantImageUrl(sanitizeImageUrl(restaurant.photo_url)) && (
                      <img
                        src={sanitizeImageUrl(restaurant.photo_url)}
                        alt={`Banner ${restaurant.name}`}
                        className="restaurant-banner-photo"
                        onError={(event) => { event.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <span className="banner-fallback">🍽️</span>
                    <div className={`rbadge ${restaurant.is_open ? 'open' : 'closed'}`}>{restaurant.is_open ? 'Abierto' : 'Cerrado'}</div>
                  </div>
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
            <div className="restaurant-sidebar-footer">
              <button className={restaurantPanel === 'config' ? 'active' : ''} onClick={() => setRestaurantPanel('config')}>⚙️ Configuración</button>
            </div>
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

            {restaurantPanel === 'dashboard' && (
              <div className="panel-placeholder">
                <div className="orders-grid-title" style={{ marginTop: 0 }}>📈 Dashboard del restaurante</div>
                <div className="orders-filters" style={{ marginBottom: '.6rem' }}>
                  <input className="fi" type="date" value={dashboardDateFrom} onChange={(e) => setDashboardDateFrom(e.target.value)} />
                  <input className="fi" type="date" value={dashboardDateTo} onChange={(e) => setDashboardDateTo(e.target.value)} />
                  <button className="btn ghost" onClick={() => { setDashboardDateFrom(''); setDashboardDateTo(''); }}>Limpiar fechas</button>
                  <button className="btn" onClick={downloadDashboardPdf}>Descargar en PDF</button>
                </div>

                <div className="stats-row" style={{ marginBottom: '.75rem' }}>
                  <article className="stat-card"><p>ACEPTADOS</p><strong>{dashboardMetrics.accepted}</strong></article>
                  <article className="stat-card"><p>RECHAZADOS</p><strong>{dashboardMetrics.rejected}</strong></article>
                  <article className="stat-card"><p>ENTREGADOS</p><strong>{dashboardMetrics.delivered}</strong></article>
                  <article className="stat-card"><p>INGRESOS</p><strong>{formatPrice(dashboardMetrics.deliveredRevenue)}</strong></article>
                </div>

                <div className="dashboard-timeline-card">
                  <h4>Pedidos por día (aceptados / rechazados / entregados)</h4>
                  {dashboardTimeline.points.length === 0 ? (
                    <p>No hay información para el rango seleccionado.</p>
                  ) : (
                    <div className="dashboard-timeline-grid">
                      {dashboardTimeline.points.map((point) => (
                        <article key={point.date} className="dashboard-day-card">
                          <strong>{new Date(`${point.date}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}</strong>
                          <span>Aceptados: {point.accepted}</span>
                          <span>Rechazados: {point.rejected}</span>
                          <span>Entregados: {point.delivered}</span>
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bars" style={{ background: '#fff', border: '1px solid #ecd8c7', borderRadius: '12px', padding: '.8rem' }}>
                  {[
                    { label: 'Aceptados', value: dashboardMetrics.accepted, color: '#2D6A4F' },
                    { label: 'Rechazados', value: dashboardMetrics.rejected, color: '#B42318' },
                    { label: 'Entregados', value: dashboardMetrics.delivered, color: '#C8410B' },
                    { label: 'Pendientes', value: dashboardMetrics.pending, color: '#8B5E3C' }
                  ].map((item) => {
                    const max = Math.max(1, dashboardMetrics.total);
                    const width = Math.max(6, Math.round((item.value / max) * 100));
                    return (
                      <div key={item.label} className="bar-row">
                        <span>{item.label}</span>
                        <div className="bar-track"><div className="bar-fill" style={{ width: `${width}%`, background: item.color }} /></div>
                        <strong>{item.value}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {restaurantPanel === 'delivery' && (
              <div className="panel-placeholder">
                <div className="orders-grid-title" style={{ marginTop: 0 }}>🛵 Configuración de delivery</div>
                <p className="orders-mode-note" style={{ marginTop: 0 }}>Configura la ubicación base del restaurante y la tarifa por rango de distancia.</p>

                <div className="frow">
                  <div className="fg"><label>Dirección del restaurante</label><input className="fi" value={configDraft.address} onChange={(e) => setConfigDraft((prev) => ({ ...prev, address: e.target.value }))} placeholder="Ej. Calle Morelos 123, Arandas" /></div>
                  <div className="fg"><label>Tarifa 0 a 10 km (MXN)</label><input className="fi" type="number" min="0" step="0.01" value={configDraft.deliveryFee0_10} onChange={(e) => setConfigDraft((prev) => ({ ...prev, deliveryFee0_10: e.target.value }))} /></div>
                </div>
                <div className="frow">
                  <div className="fg"><label>Tarifa 10 a 15 km (MXN)</label><input className="fi" type="number" min="0" step="0.01" value={configDraft.deliveryFee10_15} onChange={(e) => setConfigDraft((prev) => ({ ...prev, deliveryFee10_15: e.target.value }))} /></div>
                  <div className="fg"><label>Tarifa 15 a 20 km (MXN)</label><input className="fi" type="number" min="0" step="0.01" value={configDraft.deliveryFee15_20} onChange={(e) => setConfigDraft((prev) => ({ ...prev, deliveryFee15_20: e.target.value }))} /></div>
                </div>
                <div className="frow">
                  <div className="fg"><label>Tarifa 20 a 30 km (MXN)</label><input className="fi" type="number" min="0" step="0.01" value={configDraft.deliveryFee20_30} onChange={(e) => setConfigDraft((prev) => ({ ...prev, deliveryFee20_30: e.target.value }))} /></div>
                  <div className="fg"><label>Vista previa actual</label><input className="fi" readOnly value={estimatedDeliveryDistanceKm == null ? 'Falta coordenada de restaurante o cliente para estimar.' : `${estimatedDeliveryDistanceKm.toFixed(1)} km → ${formatPrice(cartDelivery)}`} /></div>
                </div>

                <div className="fg">
                  <label>Ubicación en mapa del restaurante</label>
                  <MapPicker
                    lat={Number(configDraft.lat || selectedRestaurant?.lat || 21.0419)}
                    lng={Number(configDraft.lng || selectedRestaurant?.lng || -102.3425)}
                    addressText={configDraft.address}
                    onAddressTextChange={(value) => setConfigDraft((prev) => ({ ...prev, address: value }))}
                    onChange={(point) => setConfigDraft((prev) => ({ ...prev, lat: String(point.lat), lng: String(point.lng) }))}
                  />
                </div>
                <button className="btn" onClick={updateRestaurantSettings} disabled={actionLoading}>Guardar configuración de delivery</button>
              </div>
            )}

            {restaurantPanel === 'config' && (
              <div className="panel-placeholder">
                <div className="orders-grid-title" style={{ marginTop: 0 }}>⚙️ Configuración del restaurante</div>
                <p className="orders-mode-note" style={{ marginTop: 0 }}>Este panel conserva el mismo correo de registro del restaurante.</p>
                <div className="frow">
                  <div className="fg"><label>Correo de acceso</label><input className="fi" value={selectedRestaurant?.email ?? ''} readOnly /></div>
                  <div className="fg"><label>Nueva contraseña</label><input className="fi" type="password" placeholder="Mínimo 8 caracteres" value={configPassword} onChange={(e) => setConfigPassword(e.target.value)} /></div>
                </div>
                <button className="btn ghost" onClick={updateRestaurantPassword} disabled={actionLoading}>Cambiar contraseña</button>

                <div className="frow" style={{ marginTop: '.7rem' }}>
                  <div className="fg"><label>Hora de apertura</label><input className="fi" type="time" value={configDraft.openTime} onChange={(e) => setConfigDraft((prev) => ({ ...prev, openTime: e.target.value }))} /></div>
                  <div className="fg"><label>Hora de cierre</label><input className="fi" type="time" value={configDraft.closeTime} onChange={(e) => setConfigDraft((prev) => ({ ...prev, closeTime: e.target.value }))} /></div>
                </div>
                <div className="fg">
                  <label>Imagen del restaurante (opcional)</label>
                  <p className="input-help">Tamaño recomendado: {RESTAURANT_IMAGE_RECOMMENDED.width} x {RESTAURANT_IMAGE_RECOMMENDED.height}px (16:9), formato JPG/PNG/WebP.</p>
                  <div className="image-picker-row">
                    <button type="button" className="btn ghost" onClick={() => restaurantImageInputRef.current?.click()}>Seleccionar imagen</button>
                    <input
                      ref={restaurantImageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      onChange={(event) => void onRestaurantImageFileChange(event)}
                    />
                    {restaurantImageMeta && <span className="input-help">{restaurantImageMeta.width} x {restaurantImageMeta.height}px</span>}
                  </div>
                  {restaurantImageNotice && <p className="input-help">{restaurantImageNotice}</p>}
                  <input
                    className="fi"
                    placeholder="https://... o data:image/..."
                    value={configDraft.restaurantImageUrl}
                    onChange={(e) => setConfigDraft((prev) => ({ ...prev, restaurantImageUrl: sanitizeImageUrl(e.target.value) }))}
                  />
                  {restaurantImagePreviewSrc && (
                    <div className="restaurant-image-preview">
                      <img
                        src={restaurantImagePreviewSrc}
                        alt="Vista previa restaurante"
                        onError={() => setRestaurantImageNotice('⚠️ La imagen no se pudo previsualizar. Revisa que sea URL/data:image válida.')}
                      />
                    </div>
                  )}
                </div>
                <button className="btn" onClick={updateRestaurantSettings} disabled={actionLoading}>Guardar configuración</button>
              </div>
            )}

            {restaurantPanel === 'resumen' && (
              <>
                <div className="orders-grid-title">📦 Pedidos entrantes</div>
                <p className="orders-mode-note">Vista resumen: tarjetas en tiempo real.</p>
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
                        <p><strong>Subtotal:</strong> {formatPrice(getOrderSubtotal(order))} · <strong>Comisión:</strong> {formatPrice(getOrderCommission(order))} · <strong>Delivery:</strong> {formatPrice(getOrderDelivery(order))} · <strong>Total:</strong> {formatPrice(Number(order.total))}</p>
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
                            >
                              ✗ Rechazar por distancia
                            </button>
                            <button className="btn" disabled={actionLoading} onClick={() => void updateRestaurantOrderStatus(order, 'ACCEPTED', 'Pedido aceptado, habrá demora en entrega.')}>🕒 Aprobado, me tardaré</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

              </>
            )}

            {restaurantPanel === 'pedidos' && (
              <>
                {selectedOrder && (
                  <article className="incoming-order selected-order-card" style={{ marginBottom: '.9rem' }}>
                    <div className="order-head"><h4>Pedido #{selectedOrder.order_number}</h4><span>{statusLabel(selectedOrder.status)}</span></div>
                    <p><strong>Fecha:</strong> {new Date(selectedOrder.created_at).toLocaleString('es-MX')}</p>
                    <p><strong>Subtotal:</strong> {formatPrice(getOrderSubtotal(selectedOrder))} · <strong>Comisión:</strong> {formatPrice(getOrderCommission(selectedOrder))} · <strong>Delivery:</strong> {formatPrice(getOrderDelivery(selectedOrder))} · <strong>Total:</strong> {formatPrice(Number(selectedOrder.total))}</p>
                    <div className="client-box">
                      👤 {selectedOrder.client_name ?? 'Sin nombre'} · 📱 {selectedOrder.client_phone ?? 'Sin teléfono'}
                      {buildWhatsAppUrl(selectedOrder.client_phone, selectedOrder) && (
                        <>
                          {' '}
                          <a className="wa-link" href={buildWhatsAppUrl(selectedOrder.client_phone, selectedOrder) ?? '#'} target="_blank" rel="noreferrer" title="Abrir WhatsApp con mensaje prellenado">
                            WhatsApp
                          </a>
                        </>
                      )}
                      <br />📝 {selectedOrder.client_location_note ?? 'Sin referencia de ubicación'}
                    </div>
                    <div className="detail-items">
                      <h5>Detalle de productos</h5>
                      <ul>
                        {selectedOrderDisplayItems.map((item) => (
                          <li key={`${selectedOrder.id}-${item.menu_item_id}-${item.option_id ?? item.option_label ?? 'base'}`}>{item.qty} × {item.name} · {formatPrice(item.subtotal)}</li>
                        ))}
                      </ul>
                    </div>
                    {selectedOrder.client_lat != null && selectedOrder.client_lng != null && (
                      <div className="mini-map-box">
                        <MapViewer lat={selectedOrder.client_lat} lng={selectedOrder.client_lng} title={`Pedido #${selectedOrder.order_number} · Ubicación cliente`} />
                        <a className="map-link" href={`https://maps.google.com/?q=${selectedOrder.client_lat},${selectedOrder.client_lng}`} target="_blank" rel="noreferrer">Abrir en Google Maps</a>
                      </div>
                    )}
                  </article>
                )}
                <div className="orders-grid-title">📦 Todos los pedidos</div>
                <p className="orders-mode-note">Vista de pedidos activos: tabla con filtros y acciones.</p>

                <div className="orders-filters">
                  <input className="fi" placeholder="Buscar por # pedido" value={orderSearchTerm} onChange={(e) => setOrderSearchTerm(e.target.value)} />
                  <input className="fi" type="date" value={orderDateFrom} onChange={(e) => setOrderDateFrom(e.target.value)} />
                  <input className="fi" type="date" value={orderDateTo} onChange={(e) => setOrderDateTo(e.target.value)} />
                  <button className="btn ghost" onClick={() => { setOrderSearchTerm(''); setOrderDateFrom(''); setOrderDateTo(''); }}>Limpiar filtros</button>
                </div>
                <div className="orders-table-wrap">
                  <table className="orders-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th># Pedido</th>
                        <th>Cliente</th>
                        <th>Total</th>
                        <th>Ubicación</th>
                        <th>Estatus</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRestaurantOrders.map((order) => (
                        <tr key={order.id}>
                          <td>{new Date(order.created_at).toLocaleString('es-MX')}</td>
                          <td>#{order.order_number}</td>
                          <td>{order.client_name ?? 'Sin nombre'}</td>
                          <td>{formatPrice(Number(order.total))}</td>
                          <td>{order.client_location_note ?? 'Sin referencia'}</td>
                          <td><span className="status-chip">{statusLabel(order.status)}</span></td>
                          <td>
                            <div className="table-actions">
                              <select
                                className="fi"
                                disabled={actionLoading || !nextStatusByOrderState[order.status]?.length}
                                value=""
                                onChange={(e) => {
                                  void handleQuickOrderStatusChange(order, e.target.value);
                                  e.target.value = '';
                                }}
                              >
                                <option value="">Cambiar estatus</option>
                                {(nextStatusByOrderState[order.status] ?? []).map((nextStatus) => (
                                  <option key={nextStatus} value={nextStatus}>{statusLabel(nextStatus)}</option>
                                ))}
                              </select>
                              <button className="btn" onClick={() => setSelectedOrderId(order.id)}>Ver detalles</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredRestaurantOrders.length === 0 && (
                        <tr>
                          <td colSpan={7}>No hay pedidos para los filtros seleccionados.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {(restaurantPanel === 'resumen' || restaurantPanel === 'menu') && (
              <div className="menu-editor">
                <div className="menu-editor-head"><h3>📋 Mi Menú</h3></div>
                <div className="menu-create-grid">
                  <div className="fg"><label>Nombre del platillo</label><input className="fi" placeholder="ej. Combo familiar" value={menuDraft.name} onChange={(e) => setMenuDraft((prev) => ({ ...prev, name: e.target.value }))} /></div>
                  <div className="fg"><label>Precio base MXN</label><input className="fi" type="number" min="1" step="1" placeholder="150" value={menuDraft.price} onChange={(e) => setMenuDraft((prev) => ({ ...prev, price: e.target.value }))} /></div>
                  <div className="fg"><label>Categoría</label><input className="fi" placeholder="Especialidades" value={menuDraft.category} onChange={(e) => setMenuDraft((prev) => ({ ...prev, category: e.target.value }))} /></div>
                  <div className="fg menu-create-full">
                    <label>Imagen principal del platillo</label>
                    <p className="field-hint">Medida recomendada: <strong>1200x800 px</strong> (relación 3:2) en JPG/WebP.</p>
                    <div className="menu-option-row menu-option-row-image">
                      <input className="fi" placeholder="Pega URL de imagen o usa el botón para subir" value={menuDraft.imageUrl} onChange={(e) => setMenuDraft((prev) => ({ ...prev, imageUrl: e.target.value }))} />
                      <input className="fi" type="file" accept="image/*" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const dataUrl = await fileToDataUrl(file);
                          setMenuDraft((prev) => ({ ...prev, imageUrl: dataUrl }));
                        } catch {
                          setErrorMessage('No se pudo cargar la imagen del platillo.');
                        }
                      }} />
                    </div>
                  </div>
                  <div className="fg menu-create-full"><label>Descripción</label><textarea className="fta" placeholder="Describe ingredientes o promoción" value={menuDraft.description} onChange={(e) => setMenuDraft((prev) => ({ ...prev, description: e.target.value }))} /></div>
                  <div className="fg menu-create-full">
                    <label>Opciones del platillo (opcional)</label>
                    <p className="field-hint">Ejemplo: pizza Pequeña, Mediana y Grande, cada una con su precio.</p>
                    {!menuOptionsEnabled ? (
                      <div className="menu-empty">Esta función estará disponible cuando se ejecute la migración <code>007_menu_item_options.sql</code>.</div>
                    ) : (
                      <div className="menu-options-editor">
                        {menuDraftOptions.map((option, index) => (
                          <div key={`draft-option-${index}`} className="menu-option-row">
                            <input className="fi" placeholder="Nombre opción (ej. Mediana)" value={option.label} onChange={(e) => setMenuDraftOptions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item))} />
                            <input className="fi" type="number" min="1" step="1" placeholder="Precio" value={option.price} onChange={(e) => setMenuDraftOptions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, price: e.target.value } : item))} />
                            <input className="fi" placeholder="Imagen opción (URL/base64)" value={option.imageUrl} onChange={(e) => setMenuDraftOptions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, imageUrl: e.target.value } : item))} />
                            <input className="fi" type="file" accept="image/*" onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const dataUrl = await fileToDataUrl(file);
                                setMenuDraftOptions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, imageUrl: dataUrl } : item));
                              } catch {
                                setErrorMessage('No se pudo cargar la imagen de la opción.');
                              }
                            }} />
                            {menuDraftOptions.length > 1 && (
                              <button className="btn ghost" type="button" onClick={() => setMenuDraftOptions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button>
                            )}
                          </div>
                        ))}
                        <button className="btn ghost" type="button" onClick={() => setMenuDraftOptions((prev) => [...prev, { label: '', price: '', imageUrl: '' }])}>+ Agregar opción</button>
                      </div>
                    )}
                  </div>
                </div>
                <button className="btn" onClick={createMenuItem} disabled={actionLoading || !selectedRestaurant}>+ Agregar platillo</button>
                {menuOptionsNotice && <div className="pending-badge">⚠️ {menuOptionsNotice}</div>}
                <div className="menu-cards">
                  {menuItems.map((item) => (
                    <article className="menu-card" key={item.id}>
                      <div className="menu-emoji">{item.photo_url_1 ? <img src={item.photo_url_1} alt={item.name} className="menu-photo" /> : '🍽️'}</div>
                      <div className="menu-info">
                        <h4>{item.name}</h4>
                        {item.menu_item_options && item.menu_item_options.length > 0 ? (
                          <div className="menu-card-options">
                            {item.menu_item_options.filter((option) => option.available).map((option) => (
                              <div key={option.id} className="menu-card-option"><span>{option.label}</span><strong>{formatPrice(option.price)}</strong></div>
                            ))}
                          </div>
                        ) : (
                          <p>{formatPrice(item.price)}</p>
                        )}
                        <small>{item.available ? 'Disponible' : 'No disponible'}</small>
                      </div>
                      <div className="menu-card-actions">
                        <button className="btn ghost" onClick={() => toggleMenuItemAvailability(item)}>{item.available ? 'Pausar' : 'Activar'}</button>
                        <button className="btn ghost" onClick={() => editMenuItem(item)}>Editar</button>
                        <button className="btn ghost danger" onClick={() => deleteMenuItem(item)}>Eliminar</button>
                      </div>
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
                <div className="fg"><label>Dirección base del restaurante</label><input className="fi" placeholder="Ej. Av. Hidalgo 120, Arandas" value={registerForm.address} onChange={(e) => setRegisterForm((p) => ({ ...p, address: e.target.value }))} /></div>
                <div className="fg"><label>Ubicación en mapa del restaurante</label><MapPicker lat={registerPoint.lat} lng={registerPoint.lng} addressText={registerForm.address} onAddressTextChange={(value) => setRegisterForm((p) => ({ ...p, address: value }))} onChange={setRegisterPoint} /></div>
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
                  { key: 'comisiones', label: '💰 Comisiones' },
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
                    <div style={{ display: 'flex', gap: '.5rem' }}><button className="btn ghost" onClick={() => void Promise.all([loadPendingRestaurants(adminRpcEnabled), loadAdminDashboardData(adminRpcEnabled), loadAdminOrders(adminRpcEnabled), loadAdminMapPoints(adminRpcEnabled), loadCommissionSettings()])}>Actualizar</button><button className="btn ghost" onClick={signOutAdmin}>Cerrar sesión</button></div>
                  </div>

                  <div className="admin-panel-tabs">
                    {[
                      { key: 'dashboard', label: '📊 Dashboard' },
                      { key: 'restaurantes', label: '🍽️ Restaurantes' },
                      { key: 'comisiones', label: '💰 Comisiones' },
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
                      {adminRestaurants.map((item) => {
                        const nextStatus = item.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
                        const actionLabel = item.status === 'ACTIVE' ? 'Apagar' : 'Encender';

                        return (
                          <div key={item.id} className="admin-restaurant-row">
                            <div>
                              <strong>{item.name}</strong>
                              <p>{item.orders_today} pedidos hoy</p>
                            </div>
                            <div className="admin-restaurant-actions">
                              <span className={`status-pill ${statusClassByRestaurant[item.status]}`}>{item.status}</span>
                              <button
                                className="btn ghost"
                                onClick={() => resetRestaurantPassword(item.id, item.name)}
                                disabled={actionLoading}
                              >
                                Reset clave
                              </button>
                              <button
                                className={`btn ${item.status === 'ACTIVE' ? 'ghost' : 'green'}`}
                                onClick={() => updateRestaurantStatus(item.id, nextStatus, item.status)}
                                disabled={actionLoading}
                              >
                                {actionLabel}
                              </button>
                            </div>
                          </div>
                        );
                      })}
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

                  {adminPanel === 'comisiones' && (
                    <article className="admin-card">
                      <h4>💰 Comisiones por uso de la app</h4>
                      <p style={{ color: 'var(--muted)' }}>Define una comisión fija global por pedido. Se sumará al subtotal de productos en todos los pedidos nuevos.</p>
                      <div className="frow" style={{ marginTop: '.75rem' }}>
                        <div className="fg">
                          <label>Comisión fija por pedido (MXN)</label>
                          <input
                            className="fi"
                            type="number"
                            min="0"
                            step="0.01"
                            value={commissionDraft}
                            onChange={(e) => setCommissionDraft(e.target.value)}
                            placeholder="Ej. 12.00"
                          />
                        </div>
                        <div className="fg">
                          <label>Vista previa para cliente</label>
                          <input className="fi" value={`Subtotal + Comisión = Total (${formatPrice(150)} + ${formatPrice(Math.max(0, Number(commissionDraft) || 0))} = ${formatPrice(150 + Math.max(0, Number(commissionDraft) || 0))})`} readOnly />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                        <button className="btn" onClick={saveCommissionSettings} disabled={actionLoading}>Guardar comisión</button>
                        <button className="btn ghost" onClick={() => setCommissionDraft(commissionAmount.toFixed(2))} disabled={actionLoading}>Restablecer</button>
                      </div>
                      <p style={{ color: 'var(--muted)', marginTop: '.65rem' }}>Comisión activa actual: <strong>{formatPrice(commissionAmount)}</strong>.</p>
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
          <div className="modal-top" style={{ background: 'linear-gradient(135deg,#8B2D07,#C8410B)' }}>
            {selectedRestaurant?.photo_url && isValidRestaurantImageUrl(sanitizeImageUrl(selectedRestaurant.photo_url)) && (
              <img
                src={sanitizeImageUrl(selectedRestaurant.photo_url)}
                alt={`Banner ${selectedRestaurant.name}`}
                className="modal-banner-photo"
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
            )}
            <span className="banner-fallback">🥩</span>
            <button className="modal-x" onClick={() => setMenuOpen(false)}>✕</button>
          </div>
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
                          <div className="product-cover">{item.photo_url_1 ? <img src={item.photo_url_1} alt={item.name} className="product-photo" /> : '🍽️'}</div>
                          <div className="product-body">
                            <div className="product-title">{item.name}</div>
                            <div className="product-desc">{item.description ?? 'Sin descripción'}</div>
                            <div className="product-footer product-footer-stack">
                              {item.menu_item_options && item.menu_item_options.filter((option) => option.available).length > 0 ? (
                                <div className="product-options-list">
                                  {item.menu_item_options.filter((option) => option.available).map((option) => (
                                    <div key={`${item.id}-${option.id}`} className="product-option-row">
                                      <div className="product-option-meta">
                                        {option.image_url ? <img src={option.image_url} alt={option.label} className="option-photo" /> : <span className="option-photo-fallback">🍽️</span>}
                                        <div className="product-price">{option.label} · {formatPrice(option.price)}</div>
                                      </div>
                                      <div className="qty-row">
                                        <button className="madd msub" onClick={() => removeItem(item, option)}>-</button>
                                        <span className="mqty">{getItemOptionQty(item.id, option)}</span>
                                        <button className="madd" onClick={() => addItem(item, option)}>+</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <>
                                  <div className="product-price">{formatPrice(item.price)}</div>
                                  <div className="qty-row">
                                    <button className="madd msub" onClick={() => removeItem(item)}>-</button>
                                    <span className="mqty">{getItemQty(item.id)}</span>
                                    <button className="madd" onClick={() => addItem(item)}>+</button>
                                  </div>
                                </>
                              )}
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
                <MapPicker lat={clientPoint.lat} lng={clientPoint.lng} addressText={clientRef} onAddressTextChange={setClientRef} onChange={setClientPoint} />
              </>
            )}

            <div className="cash-note">💵 Sin registro requerido · Pago en efectivo al recibir · El restaurante confirma antes de salir</div>

            <div className="cart-bar" style={{ display: 'flex' }}>
              <div className="cart-info">
                🛒 {cartCount} productos · Subtotal: <strong>{formatPrice(cartSubtotal)}</strong> + Comisión: <strong>{formatPrice(cartCommission)}</strong> + Delivery: <strong>{formatPrice(cartDelivery)}</strong> · Total a pagar: <strong>{formatPrice(cartTotal)}</strong>
              </div>
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
