import { useMemo, useState } from 'react';
import MapPicker from './components/map/MapPicker';

type TabKey = 'cliente' | 'seguimiento' | 'restaurante' | 'registro' | 'admin';

const trackSteps = [
  { icon: '✓', title: 'Pedido enviado', desc: '2x Arrachera + 1x Combo familiar — $760 en efectivo', status: 'done' },
  { icon: '👀', title: 'Restaurante revisando tu ubicación', desc: 'Verificando si pueden llegar a Rancho Las Flores (8.2 km)', status: 'active' },
  { icon: '🛵', title: 'En camino', desc: 'Esperando confirmación del restaurante', status: 'wait' },
  { icon: '✅', title: 'Entregado', desc: 'Pago en efectivo al recibir', status: 'wait' }
] as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('cliente');
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);
  const [trackNumber, setTrackNumber] = useState('1043');
  const [clientPoint, setClientPoint] = useState({ lat: 21.0419, lng: -102.3425 });
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientRef, setClientRef] = useState('');

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

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'cliente', label: '👤 Cliente' },
    { key: 'seguimiento', label: '📦 Seguimiento' },
    { key: 'restaurante', label: '🍽️ Restaurante' },
    { key: 'registro', label: '📝 Registro' },
    { key: 'admin', label: '⚙️ Admin' }
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

      {activeTab === 'restaurante' && <div className="page active"><div className="section"><div className="s-title">Panel Restaurante</div></div></div>}
      {activeTab === 'registro' && <div className="page active"><div className="section"><div className="s-title">Registro</div></div></div>}
      {activeTab === 'admin' && <div className="page active"><div className="section"><div className="s-title">Panel Admin</div></div></div>}

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
