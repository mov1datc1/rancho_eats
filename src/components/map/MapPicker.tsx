import { useMemo } from 'react';
import { ARANDA_CENTER, buildStaticMapUrl, hasMapboxToken } from '../../lib/mapbox';

type MapPickerProps = {
  lat: number;
  lng: number;
  onChange: (next: { lat: number; lng: number }) => void;
};

export default function MapPicker({ lat, lng, onChange }: MapPickerProps) {
  const staticMapUrl = useMemo(() => buildStaticMapUrl(lat, lng), [lat, lng]);

  if (!hasMapboxToken()) {
    return (
      <div className="loc-box">
        <h4>🗺️ Mapa no disponible</h4>
        <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
          Falta VITE_MAPBOX_TOKEN en tu entorno local.
        </p>
      </div>
    );
  }

  return (
    <div className="loc-box">
      <h4>📍 Ubicación del cliente</h4>
      <img src={staticMapUrl} alt="Vista previa del mapa" className="loc-preview" />
      <div className="coord-grid">
        <label>
          <span>Latitud</span>
          <input
            className="track-input"
            value={lat}
            type="number"
            step="0.0001"
            onChange={(event) => onChange({ lat: Number(event.target.value), lng })}
          />
        </label>
        <label>
          <span>Longitud</span>
          <input
            className="track-input"
            value={lng}
            type="number"
            step="0.0001"
            onChange={(event) => onChange({ lat, lng: Number(event.target.value) })}
          />
        </label>
      </div>
      <button className="btn ghost" onClick={() => onChange({ lat: ARANDA_CENTER.lat, lng: ARANDA_CENTER.lng })}>
        Volver al centro de Aranda
      </button>
    </div>
  );
}
