import { useMemo, useState } from 'react';
import MapPicker from './components/map/MapPicker';

type TabKey = 'cliente' | 'seguimiento' | 'restaurante' | 'registro' | 'admin';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('cliente');
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);
  const [clientPoint, setClientPoint] = useState({ lat: 21.0419, lng: -102.3425 });
  const [trackNumber, setTrackNumber] = useState('1043');

  const showOrder = useMemo(() => {
    const val = trackNumber.replace('#', '').trim();
    return val === '' || val === '1043';
  }, [trackNumber]);

  const addItem = (price: number) => {
    setCartCount((v) => v + 1);
    setCartTotal((v) => v + price);
  };

  const openMenu = () => {
    setMenuOpen(true);
    setCartCount(0);
    setCartTotal(0);
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
              <p>Sin registro, sin complicaciones. Pon tu ubicación en el mapa y los restaurantes de Aranda te llevan lo que quieras.</p>
              <div className="search-card">
                <label>¿Qué se te antoja hoy?</label>
                <div className="search-row">
                  <input className="si" type="text" placeholder="Birria, pozole, gorditas…" />
                  <button className="btn">Ver restaurantes</button>
                </div>
                <div className="track-card" style={{ marginTop: 0, padding: 0, boxShadow: 'none' }}>
                  <div className="divider">o busca tu pedido</div>
                  <div className="search-row">
                    <input className="si" placeholder="Número de pedido ej. #1043" value={trackNumber} onChange={(e) => setTrackNumber(e.target.value)} />
                    <button className="btn ghost" onClick={() => setActiveTab('seguimiento')}>Rastrear →</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="s-title">Restaurantes disponibles</div>
            <div className="s-sub">Toca un restaurante para ver su menú.</div>
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
                <div className="rcard-body"><div className="rname">Pollos Rosticería La Palma</div></div>
              </div>
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
            </div>
            {showOrder ? <div className="track-result"><div className="tr-header"><div className="tr-rest">El Asadero de Don Chuy</div></div></div> : <div className="track-lookup">Pedido no encontrado</div>}
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
            <div className="mitem"><div className="mimg">🥩</div><div className="minfo"><div className="mname">Arrachera completa</div></div><div><div className="mprice">$140</div><button className="madd" onClick={() => addItem(140)}>+</button></div></div>
            <div className="mitem"><div className="mimg">🍖</div><div className="minfo"><div className="mname">Combo familiar parrillada</div></div><div><div className="mprice">$480</div><button className="madd" onClick={() => addItem(480)}>+</button></div></div>

            <MapPicker lat={clientPoint.lat} lng={clientPoint.lng} onChange={setClientPoint} />

            {cartCount > 0 && (
              <div className="cart-bar" style={{ display: 'flex' }}>
                <div className="cart-info">🛒 {cartCount} items · Total: <strong>${cartTotal}</strong></div>
                <button className="btn" onClick={() => { setMenuOpen(false); setActiveTab('seguimiento'); }}>Enviar pedido →</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
