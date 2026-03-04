import { useMemo, useRef, useState } from 'react';
import { ARANDA_CENTER, buildStaticMapUrl, hasMapboxToken } from '../../lib/mapbox';

type MapPickerProps = {
  lat: number;
  lng: number;
  onChange: (next: { lat: number; lng: number }) => void;
};

const LAT_RANGE = 0.08;
const LNG_RANGE = 0.08;

export default function MapPicker({ lat, lng, onChange }: MapPickerProps) {
  const staticMapUrl = useMemo(() => buildStaticMapUrl(lat, lng), [lat, lng]);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const updateFromPointer = (clientX: number, clientY: number) => {
    if (!mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(clientY - rect.top, 0), rect.height);

    const lngRatio = x / rect.width;
    const latRatio = y / rect.height;

    const nextLng = lng + (lngRatio - 0.5) * LNG_RANGE;
    const nextLat = lat - (latRatio - 0.5) * LAT_RANGE;

    onChange({
      lat: Number(nextLat.toFixed(6)),
      lng: Number(nextLng.toFixed(6)),
    });
  };

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
      <h4>📍 ¿A dónde te llevamos? <span className="req">*Requerido</span></h4>
      <p className="loc-sub">Toca o arrastra el pin para marcar tu ubicación exacta en el mapa.</p>
      <div
        className={`map-touch ${dragging ? 'dragging' : ''}`}
        ref={mapRef}
        onMouseDown={(event) => {
          setDragging(true);
          updateFromPointer(event.clientX, event.clientY);
        }}
        onMouseMove={(event) => {
          if (!dragging) return;
          updateFromPointer(event.clientX, event.clientY);
        }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (!touch) return;
          setDragging(true);
          updateFromPointer(touch.clientX, touch.clientY);
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (!touch || !dragging) return;
          updateFromPointer(touch.clientX, touch.clientY);
        }}
        onTouchEnd={() => setDragging(false)}
        onClick={(event) => updateFromPointer(event.clientX, event.clientY)}
      >
        <img src={staticMapUrl} alt="Vista previa del mapa" className="loc-preview" />
        <div className="map-pin" title="Arrastra el pin">📍</div>
      </div>
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
