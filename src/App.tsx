import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import MapPicker from './components/map/MapPicker';
import { supabase } from './lib/supabase';
import { formatPrice, statusLabel } from './lib/utils';
import type { CartItem, MenuItem, Order, Restaurant } from './types';

type TabKey = 'cliente' | 'seguimiento' | 'restaurante' | 'registro' | 'admin';
type RestaurantPanelKey = 'resumen' | 'pedidos' | 'menu' | 'promociones' | 'zona' | 'historial' | 'config';

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
  const [restaurantPanel, setRestaurantPanel] = useState<RestaurantPanelKey>('resumen');
  const [selectedZones, setSelectedZones] = useState<string[]>(['Aranda centro', 'El Saucito']);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [pendingRestaurants, setPendingRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [restaurantOrders, setRestaurantOrders] = useState<Order[]>([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [trackNumber, setTrackNumber] = useState('1043');
  const [searchedOrder, setSearchedOrder] = useState<Order | null>(null);

  const [clientPoint, setClientPoint] = useState({ lat: 21.0419, lng: -102.3425 });
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientRef, setClientRef] = useState('');
  const [cart, setCart] = useState<Record<string, CartItem>>({});

  const [registerForm, setRegisterForm] = useState(baseForm);
  const [registerMessage, setRegisterMessage] = useState('');

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const cartCount = useMemo(() => cartItems.reduce((acc, item) => acc + item.qty, 0), [cartItems]);
  const cartTotal = useMemo(() => cartItems.reduce((acc, item) => acc + item.subtotal, 0), [cartItems]);

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
    if (!isAdmin) {
      setPendingRestaurants([]);
      return;
    }

    void loadPendingRestaurants();
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab === 'admin' && isAdmin) {
      void loadPendingRestaurants();
    }
  }, [activeTab, isAdmin]);

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

  const loadPendingRestaurants = async () => {
    try {
      const { data: pendingData, error: pendingError } = await supabase
        .rpc('admin_list_restaurant_requests');

      if (pendingError) throw pendingError;
      setPendingRestaurants((pendingData ?? []) as Restaurant[]);
    } catch (error) {
      console.error(error);
      setErrorMessage('No se pudo cargar la bandeja de solicitudes pendientes del admin.');
    }
  };

  const loadRestaurantData = async (restaurantId: string) => {
    try {
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
    }
  };

  const openMenu = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant);
    setMenuOpen(true);
    setCart({});
    setClientName('');
    setClientPhone('');
    setClientRef('');
  };

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

  const submitOrder = async () => {
    if (!selectedRestaurant) return;
    if (cartCount === 0) {
      setErrorMessage('Agrega al menos un platillo antes de enviar el pedido.');
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

  const updatePendingRestaurant = async (restaurantId: string, status: 'ACTIVE' | 'SUSPENDED') => {
    if (!isAdmin) {
      setErrorMessage('Solo usuarios admin pueden aprobar o rechazar restaurantes.');
      return;
    }

    try {
      setActionLoading(true);
      const { error } = await supabase.rpc('admin_update_restaurant_status', {
        p_restaurant_id: restaurantId,
        p_status: status
      });

      if (error) throw error;
      await Promise.all([loadInitialData(), loadPendingRestaurants()]);
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
        <div className="logo">Aranda<span>Eats</span></div>
        <ul className="nav-links">
          <li><a href="#">Inicio</a></li>
          <li><a href="#">¿Cómo funciona?</a></li>
          <li><a href="#">Para restaurantes</a></li>
        </ul>
        <button className="nav-cta" onClick={() => setActiveTab('registro')}>Registrar Restaurante</button>
      </nav>

      <div className="tabs">
        {[
          { key: 'cliente', label: '👤 Cliente' },
          { key: 'seguimiento', label: '📦 Seguimiento' },
          { key: 'restaurante', label: '🍽️ Restaurante' },
          { key: 'registro', label: '📝 Registro' },
          { key: 'admin', label: '⚙️ Admin' }
        ].map((tab) => (
          <button key={tab.key} className={`tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key as TabKey)}>
            {tab.label}
          </button>
        ))}
      </div>

      {errorMessage && <div className="global-error">{errorMessage}</div>}
      {loading && <div className="global-loading">Cargando datos de la plataforma…</div>}

      {activeTab === 'cliente' && (
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
        </div>
      )}

      {activeTab === 'seguimiento' && (
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
                  <div className="tr-num">Pedido #{searchedOrder.order_number}</div>
                  <div className="tr-rest">{restaurants.find((item) => item.id === searchedOrder.restaurant_id)?.name ?? 'Restaurante'}</div>
                  <div className="tr-time">Total: {formatPrice(Number(searchedOrder.total))} · Estado: {statusLabel(searchedOrder.status)}</div>
                </div>
                <div className="order-summary">
                  {(searchedOrder.items ?? []).map((item) => (
                    <div key={`${item.menu_item_id}-${item.qty}`}>• {item.qty}x {item.name} · {formatPrice(item.subtotal)}</div>
                  ))}
                  <div className="summary-foot"><strong>Total: {formatPrice(Number(searchedOrder.total))}</strong><br />👤 {searchedOrder.client_name ?? 'Sin nombre'} · 📱 {searchedOrder.client_phone ?? 'Sin teléfono'}<br />📍 {searchedOrder.client_location_note ?? 'Sin referencia'}</div>
                </div>
              </div>
            ) : (
              <div className="track-lookup">No hay pedido seleccionado aún. Busca por número para ver el detalle.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'restaurante' && (
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
                  {restaurantOrders.slice(0, 2).map((order) => (
                    <article key={order.id} className={`incoming-order ${order.status === 'PENDING' ? 'new' : ''}`}>
                      <div className="order-head"><h4>Pedido #{order.order_number}</h4><span>{statusLabel(order.status)}</span></div>
                      <p><strong>Total:</strong> {formatPrice(Number(order.total))}</p>
                      <div className="client-box">👤 {order.client_name ?? 'Sin nombre'} · 📱 {order.client_phone ?? 'Sin teléfono'}<br />📝 {order.client_location_note ?? 'Sin referencia de ubicación'}</div>
                      <div className="order-actions"><button className="btn green">✓ Aceptar</button><button className="btn ghost">✗ No puedo ir</button></div>
                    </article>
                  ))}
                </div>
              </>
            )}

            {(restaurantPanel === 'resumen' || restaurantPanel === 'menu') && (
              <div className="menu-editor">
                <div className="menu-editor-head"><h3>📋 Mi Menú</h3></div>
                <div className="menu-cards">
                  {menuItems.map((item) => (
                    <article className="menu-card" key={item.id}><div className="menu-emoji">🍽️</div><div className="menu-info"><h4>{item.name}</h4><p>{formatPrice(item.price)}</p><small>{item.available ? 'Disponible' : 'No disponible'}</small></div></article>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'registro' && (
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

      {activeTab === 'admin' && (
        <div className="page active">
          <div className="section">
            <div className="s-title">Panel Admin — Solicitudes de restaurantes</div>
            {!isAdmin ? (
              <article className="admin-request-card">
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
                  <p style={{ margin: 0, color: 'var(--muted)' }}>Sesión admin activa: <strong>{adminUser?.email}</strong></p>
                  <button className="btn ghost" onClick={signOutAdmin}>Cerrar sesión</button>
                </div>
                <div className="admin-requests">
                  {pendingRestaurants.map((request) => (
                    <article className="admin-request-card" key={request.id}>
                      <h4>{request.name}</h4>
                      <p>Correo: {request.email} · WhatsApp: {request.phone}</p>
                      <div className="admin-status-row">
                        <span className="status-pill pendiente">PENDIENTE</span>
                        <div className="order-actions">
                          <button className="btn green" onClick={() => updatePendingRestaurant(request.id, 'ACTIVE')} disabled={actionLoading}>Aprobar</button>
                          <button className="btn ghost" onClick={() => updatePendingRestaurant(request.id, 'SUSPENDED')} disabled={actionLoading}>Rechazar</button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {pendingRestaurants.length === 0 && <article className="admin-request-card"><h4>Sin solicitudes pendientes</h4><p>Todo está al día por ahora.</p></article>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className={`overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-top" style={{ background: 'linear-gradient(135deg,#8B2D07,#C8410B)' }}>🍽️<button className="modal-x" onClick={() => setMenuOpen(false)}>✕</button></div>
          <div className="modal-body">
            <div className="mtitle">{selectedRestaurant?.name ?? 'Menú del restaurante'}</div>
            {menuItems.filter((item) => item.available).map((item) => (
              <div className="mitem" key={item.id}><div className="mimg">🍽️</div><div className="minfo"><div className="mname">{item.name}</div><div className="mdesc">{item.description ?? 'Sin descripción'}</div></div><div><div className="mprice">{formatPrice(item.price)}</div><button className="madd" onClick={() => addItem(item)}>+</button></div></div>
            ))}

            <div className="client-form">
              <div className="client-form-title">Tus datos de contacto <span>(opcionales pero muy útiles)</span></div>
              <div className="cf-grid">
                <div><label className="cfl">Tu nombre</label><input className="cfi" placeholder="ej. Juan Pérez" value={clientName} onChange={(e) => setClientName(e.target.value)} /></div>
                <div><label className="cfl">WhatsApp</label><input className="cfi" placeholder="344 123 4567" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} /></div>
              </div>
              <div><label className="cfl">Referencia de tu ubicación</label><textarea className="cfta" placeholder="ej. Rancho Las Flores, después del puente..." value={clientRef} onChange={(e) => setClientRef(e.target.value)} /></div>
              <div className="cf-hint">💡 Si das tu WhatsApp, el restaurante puede confirmarte antes de salir.</div>
            </div>

            <MapPicker lat={clientPoint.lat} lng={clientPoint.lng} onChange={setClientPoint} />

            {cartCount > 0 && (
              <div className="cart-bar" style={{ display: 'flex' }}>
                <div className="cart-info">🛒 {cartCount} items · Total: <strong>{formatPrice(cartTotal)}</strong></div>
                <button className="btn" onClick={submitOrder} disabled={actionLoading}>Enviar pedido →</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
