import { useMemo, useState } from 'react';
import MapPicker from './components/map/MapPicker';

type TabKey = 'cliente' | 'seguimiento' | 'restaurante' | 'registro' | 'admin';
type RestaurantPanelKey = 'resumen' | 'pedidos' | 'menu' | 'promociones' | 'zona' | 'historial' | 'config';

type AdminRequest = {
  id: string;
  name: string;
  owner: string;
  phone: string;
  status: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
};

const trackSteps = [
  { icon: '✓', title: 'Pedido enviado', desc: '2x Arrachera + 1x Combo familiar — $760 en efectivo', status: 'done' },
  { icon: '👀', title: 'Restaurante revisando tu ubicación', desc: 'Verificando si pueden llegar a Rancho Las Flores (8.2 km)', status: 'active' },
  { icon: '🛵', title: 'En camino', desc: 'Esperando confirmación del restaurante', status: 'wait' },
  { icon: '✅', title: 'Entregado', desc: 'Pago en efectivo al recibir', status: 'wait' }
] as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('cliente');
  const [restaurantPanel, setRestaurantPanel] = useState<RestaurantPanelKey>('resumen');
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);
  const [trackNumber, setTrackNumber] = useState('1043');
  const [clientPoint, setClientPoint] = useState({ lat: 21.0419, lng: -102.3425 });
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientRef, setClientRef] = useState('');
  const [selectedZones, setSelectedZones] = useState<string[]>(['Aranda centro', 'El Saucito']);
  const [adminRequests, setAdminRequests] = useState<AdminRequest[]>([
    { id: 'req-1', name: 'Antojitos Doña Petra', owner: 'Petra López', phone: '344 555 1111', status: 'PENDIENTE' },
    { id: 'req-2', name: 'Cocina El Ranchero', owner: 'Carlos Méndez', phone: '344 555 2222', status: 'PENDIENTE' }
  ]);

  const showOrder = useMemo(() => trackNumber.replace('#', '').trim() === '1043' || trackNumber.trim() === '', [trackNumber]);

  const openMenu = () => {
    setMenuOpen(true);
    setCartCount(0);
    setCartTotal(0);
    setClientName('');
    setClientPhone('');
    setClientRef('');
  };

  const addItem = (price: number) => {
    setCartCount((v) => v + 1);
    setCartTotal((v) => v + price);
  };

  const updateRequest = (id: string, status: AdminRequest['status']) => {
    setAdminRequests((prev) => prev.map((request) => (request.id === id ? { ...request, status } : request)));
  };

  const toggleZone = (zone: string) => {
    setSelectedZones((prev) =>
      prev.includes(zone) ? prev.filter((item) => item !== zone) : [...prev, zone]
    );
  };

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'cliente', label: '👤 Cliente' },
    { key: 'seguimiento', label: '📦 Seguimiento' },
    { key: 'restaurante', label: '🍽️ Restaurante' },
    { key: 'registro', label: '📝 Registro' },
    { key: 'admin', label: '⚙️ Admin' }
  ];

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
        {tabs.map((tab) => (
          <button key={tab.key} className={`tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'cliente' && (
        <div className="page active">
          <div className="pwa-banner">
            <p>📱 <strong>Instala ArandaEats</strong> en tu celular — sin App Store, directo desde aquí</p>
            <button className="pwa-install">+ Instalar app</button>
          </div>

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
              <div className="rcard" onClick={openMenu}>
                <div className="rcard-img" style={{ background: 'linear-gradient(135deg,#8B2D07,#C8410B)' }}>🥩<div className="rbadge open">Abierto</div></div>
                <div className="rcard-body"><div className="rname">El Asadero de Don Chuy</div><div className="rmeta"><span>⭐ 4.8</span><span>🕐 ~45 min</span></div></div>
              </div>
              <div className="rcard" onClick={openMenu}>
                <div className="rcard-img" style={{ background: 'linear-gradient(135deg,#4A1A05,#8B4513)' }}>🌮<div className="rbadge open">Abierto</div></div>
                <div className="rcard-body"><div className="rname">Birriería Don Lupe</div><div className="rmeta"><span>⭐ 4.9</span><span>🕐 ~30 min</span></div></div>
              </div>
              <div className="rcard">
                <div className="rcard-img" style={{ background: 'linear-gradient(135deg,#1A3A1A,#2D6A4F)' }}>🍗<div className="rbadge closed">Cerrado</div></div>
                <div className="rcard-body"><div className="rname">Pollos Rosticería La Palma</div><div className="rmeta"><span>⭐ 4.6</span><span>🕐 ~35 min</span></div></div>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="s-title">Mapa de restaurantes</div>
            <div className="s-sub">Toca el mapa para colocar tu pin. Funciona aunque estés en camino de tierra sin dirección.</div>
            <div className="map-wrap">
              <div className="road h" />
              <div className="road v" />
              <div className="road dirt" />
              <div className="map-hint">👆 Toca para colocar tu ubicación</div>
              <div className="pin" style={{ left: '38%', top: '45%' }}><div className="pin-dot pr"><span>🍽️</span></div><div className="pin-lbl">El Asadero</div></div>
              <div className="pin" style={{ left: '42%', top: '58%' }}><div className="pin-dot pr"><span>🌮</span></div><div className="pin-lbl">Don Lupe</div></div>
              <div className="pin" style={{ left: '72%', top: '65%' }}><div className="pin-dot pu"><span>📍</span></div><div className="pin-lbl">Tú — Rancho Las Flores</div></div>
              <div className="map-legend"><div><span className="ldot" style={{ background: 'var(--brand)' }} />Restaurantes</div><div><span className="ldot" style={{ background: 'var(--green)' }} />Tu ubicación</div></div>
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
                <button className="btn">Buscar</button>
              </div>
              <div className="lookup-help">También puedes entrar directo al link que te compartió el restaurante</div>
            </div>

            {showOrder ? (
              <div className="track-result">
                <div className="tr-header">
                  <div className="tr-num">Pedido</div>
                  <div className="tr-rest">El Asadero de Don Chuy</div>
                  <div className="tr-time">Hoy 2:14 PM · Total: $760</div>
                </div>
                <div className="order-summary">
                  <div>• 2x Arrachera completa · $280</div>
                  <div>• 1x Combo familiar parrillada · $480</div>
                  <div className="summary-foot"><strong>Total: $760</strong> · Pago en efectivo<br />📍 Rancho Las Flores — junto al árbol grande de la entrada<br />👤 Juan Pérez · 📱 344 123 4567</div>
                </div>
                <div className="cancel-expired">⏱️ Tiempo de cancelación vencido · Para cancelar llama directamente al restaurante por WhatsApp.</div>
                <div className="steps">
                  {trackSteps.map((step) => (
                    <div className="step" key={step.title}>
                      <div className={`sdot ${step.status}`}>{step.icon}</div>
                      <div className="sinfo"><div className="sname">{step.title}</div><div className="sdesc">{step.desc}</div></div>
                    </div>
                  ))}
                </div>
                <div className="tr-actions">
                  <button className="btn ghost">✕ Cancelar pedido</button>
                  <div className="limit-note">Solo antes de que el restaurante acepte y dentro de los primeros 5 min</div>
                  <button className="btn green">📲 Llamar al restaurante por WhatsApp · 344 123 4567</button>
                </div>
              </div>
            ) : (
              <div className="track-lookup">Pedido no encontrado</div>
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
                <li key={panel.key}>
                  <button className={restaurantPanel === panel.key ? 'active' : ''} onClick={() => setRestaurantPanel(panel.key)}>{panel.label}</button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="restaurant-main">
            <div className="restaurant-header-row">
              <div>
                <h2>El Asadero de Don Chuy</h2>
                <p>Vie 28 Feb 2026 — <span>● Abierto</span></p>
              </div>
              <button className="btn dark">🛑 Cerrar por hoy</button>
            </div>

            {(restaurantPanel === 'resumen' || restaurantPanel === 'pedidos') && (
              <>
                <div className="stats-row">
                  <article className="stat-card"><p>PEDIDOS HOY</p><strong>12</strong><small>↑ 3 vs ayer</small></article>
                  <article className="stat-card"><p>EN CAMINO</p><strong>2</strong><small>Activos ahora</small></article>
                  <article className="stat-card"><p>GANADO HOY</p><strong>$2,480</strong><small>Efectivo</small></article>
                  <article className="stat-card"><p>CALIFICACIÓN</p><strong>4.8⭐</strong><small>48 reseñas</small></article>
                </div>

                <div className="orders-grid-title">📦 Pedidos entrantes — ve la ubicación antes de aceptar</div>
                <div className="orders-grid">
                  <article className="incoming-order new">
                    <div className="order-head"><h4>Pedido #1043</h4><span>🔴 NUEVO</span></div>
                    <p>• 2x Arrachera completa ($280)<br />• 1x Combo familiar ($480)<br /><strong>Total: $760</strong></p>
                    <div className="client-box">👤 <strong>Juan Pérez</strong> · 📱 <strong>344 123 4567</strong><br />📝 Junto al árbol grande de la entrada, casa de block gris con portón azul</div>
                    <div className="location-link">🗺️ Ver ubicación exacta — Rancho El Saucito (11.4 km)</div>
                    <div className="order-actions"><button className="btn green">✓ Aceptar</button><button className="btn ghost">✗ No puedo ir</button></div>
                  </article>

                  <article className="incoming-order suspicious">
                    <div className="order-head"><h4>Pedido #1044</h4><span>⚠️ SOSPECHOSO</span></div>
                    <div className="alert-box">⚠️ Esta IP tiene 3 pedidos activos simultáneos — posible spam</div>
                    <p>• 1x Arrachera completa ($140)<br /><strong>Total: $140</strong></p>
                    <div className="client-box danger">👤 Sin nombre · Sin teléfono<br />📝 Sin referencia de ubicación</div>
                    <div className="location-link">🗺️ Ver ubicación — Coordenadas inusuales</div>
                    <div className="order-actions"><button className="btn ghost">✗ Rechazar</button><button className="btn red">🚩 Reportar spam</button></div>
                  </article>
                </div>
              </>
            )}

            {(restaurantPanel === 'resumen' || restaurantPanel === 'menu') && (
              <div className="menu-editor">
                <div className="menu-editor-head"><h3>📋 Mi Menú</h3><button className="btn">+ Agregar platillo</button></div>
                <div className="menu-cards">
                  <article className="menu-card"><div className="menu-emoji">🥩</div><div className="menu-info"><h4>Arrachera completa</h4><p>$140</p><small>🏷️ 2x1 miércoles</small></div></article>
                  <article className="menu-card"><div className="menu-emoji">🍗</div><div className="menu-info"><h4>Combo familiar</h4><p>$480</p><small>✅ 4-6 personas</small></div></article>
                  <article className="menu-card"><div className="menu-emoji">🧀</div><div className="menu-info"><h4>Queso asado</h4><p>$80</p><small>Disponible</small></div></article>
                  <article className="menu-card dashed"><div>+<br />Nuevo platillo</div></article>
                </div>
              </div>
            )}

            {restaurantPanel === 'promociones' && <div className="panel-placeholder">Promociones: crea descuentos por día, combos y banners para Home.</div>}
            {restaurantPanel === 'zona' && <div className="panel-placeholder">Zona de entrega: ajusta radio, comunidades y cobertura por rancho.</div>}
            {restaurantPanel === 'historial' && <div className="panel-placeholder">Historial: consulta pedidos entregados, cancelados y rechazados.</div>}
            {restaurantPanel === 'config' && <div className="panel-placeholder">Configuración: perfil, horarios, WhatsApp, contraseña y estado abierto/cerrado.</div>}
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
                <div className="fg"><label>Nombre del restaurante</label><input className="fi" placeholder="ej. Birriería La Guadalupana" /></div>
                <div className="frow">
                  <div className="fg"><label>Email</label><input className="fi" type="email" placeholder="tu@correo.com" /></div>
                  <div className="fg"><label>WhatsApp</label><input className="fi" placeholder="344 000 0000" /></div>
                </div>
                <div className="frow">
                  <div className="fg"><label>Contraseña del panel</label><input className="fi" type="password" placeholder="Mínimo 8 caracteres" /></div>
                  <div className="fg"><label>Tipo de comida</label><select className="fs"><option>Carnes y parrilla</option><option>Birria y caldos</option><option>Tacos y antojitos</option><option>Pollos y asados</option><option>Mariscos</option><option>Comida corrida</option></select></div>
                </div>
                <div className="fg"><label>Descripción breve</label><textarea className="fta" placeholder="¿Qué hace especial a tu restaurante?" /></div>
                <div className="fg"><label>Radio de entrega máximo</label><select className="fs"><option>5 km (solo Aranda centro)</option><option>10 km</option><option>15 km</option><option>20 km (ranchos lejanos)</option><option>Sin límite fijo — caso por caso</option></select></div>
                <div className="fg">
                  <label>Zonas que cubre</label>
                  <div className="zchips">
                    {['Aranda centro','Arandas','El Saucito','Las Flores','La Providencia','San José','El Llano','Ranchos varios'].map((zone) => (
                      <button key={zone} type="button" className={`zchip ${selectedZones.includes(zone) ? 'on' : ''}`} onClick={() => toggleZone(zone)}>{zone}</button>
                    ))}
                  </div>
                </div>
                <div className="fg"><label>Logo del restaurante</label><div className="upload"><div className="uico">📷</div><div>Arrastra o <strong>toca para subir</strong></div><div style={{ fontSize: '.71rem', marginTop: '.25rem' }}>JPG, PNG · Máx 5MB</div></div></div>
                <div className="frow">
                  <div className="fg"><label>Apertura</label><input className="fi" type="time" defaultValue="09:00" /></div>
                  <div className="fg"><label>Cierre</label><input className="fi" type="time" defaultValue="21:00" /></div>
                </div>
                <button className="btnreg">Enviar registro →</button>
                <div className="regterms">Al registrarte aceptas los términos de ArandaEats. Tu solicitud estará activa una vez aprobada.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'admin' && (
        <div className="page active">
          <div className="section">
            <div className="s-title">Panel Admin — Solicitudes de restaurantes</div>
            <div className="admin-requests">
              {adminRequests.map((request) => (
                <article className="admin-request-card" key={request.id}>
                  <h4>{request.name}</h4>
                  <p>Propietario: {request.owner} · WhatsApp: {request.phone}</p>
                  <div className="admin-status-row">
                    <span className={`status-pill ${request.status.toLowerCase()}`}>{request.status}</span>
                    <div className="order-actions">
                      <button className="btn green" onClick={() => updateRequest(request.id, 'APROBADO')}>Aprobar</button>
                      <button className="btn ghost" onClick={() => updateRequest(request.id, 'RECHAZADO')}>Rechazar</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={`overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-top" style={{ background: 'linear-gradient(135deg,#8B2D07,#C8410B)' }}>🥩
            <button className="modal-x" onClick={() => setMenuOpen(false)}>✕</button>
          </div>
          <div className="modal-body">
            <div className="mtitle">El Asadero de Don Chuy</div>
            <div className="mitem"><div className="mimg">🥩</div><div className="minfo"><div className="mname">Arrachera completa</div><div className="mdesc">300g marinada, tortillas, frijoles y salsas</div></div><div><div className="mprice">$140</div><button className="madd" onClick={() => addItem(140)}>+</button></div></div>
            <div className="mitem"><div className="mimg">🍖</div><div className="minfo"><div className="mname">Combo familiar parrillada</div><div className="mdesc">1kg carne + costillas + pollo + tortillas + aguas</div></div><div><div className="mprice">$480</div><button className="madd" onClick={() => addItem(480)}>+</button></div></div>
            <div className="mitem"><div className="mimg">🧀</div><div className="minfo"><div className="mname">Queso asado</div><div className="mdesc">200g con rajas</div></div><div><div className="mprice">$80</div><button className="madd" onClick={() => addItem(80)}>+</button></div></div>
            <div className="mitem"><div className="mimg">🥤</div><div className="minfo"><div className="mname">Agua fresca 1.5L</div><div className="mdesc">Horchata, limón o Jamaica</div></div><div><div className="mprice">$60</div><button className="madd" onClick={() => addItem(60)}>+</button></div></div>

            <div className="client-form">
              <div className="client-form-title">Tus datos de contacto <span>(opcionales pero muy útiles)</span></div>
              <div className="cf-grid">
                <div>
                  <label className="cfl">Tu nombre</label>
                  <input className="cfi" placeholder="ej. Juan Pérez" value={clientName} onChange={(e) => setClientName(e.target.value)} />
                </div>
                <div>
                  <label className="cfl">WhatsApp</label>
                  <input className="cfi" placeholder="344 123 4567" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="cfl">Referencia de tu ubicación</label>
                <textarea className="cfta" placeholder="ej. Rancho Las Flores, después del puente..." value={clientRef} onChange={(e) => setClientRef(e.target.value)} />
              </div>
              <div className="cf-hint">💡 Si das tu WhatsApp, el restaurante puede confirmarte antes de salir. Mientras más detallada la referencia, más fácil llega.</div>
            </div>

            <MapPicker lat={clientPoint.lat} lng={clientPoint.lng} onChange={setClientPoint} />

            {cartCount > 0 && (
              <div className="cart-bar" style={{ display: 'flex' }}>
                <div className="cart-info">🛒 {cartCount} items · Total: <strong>${cartTotal}</strong></div>
                <button className="btn" onClick={() => { setMenuOpen(false); setActiveTab('seguimiento'); }}>Enviar pedido →</button>
              </div>
            )}
            <div className="foot-note">💵 Sin registro requerido · Pago en efectivo al recibir · El restaurante confirma antes de salir</div>
          </div>
        </div>
      </div>
    </div>
  );
}
