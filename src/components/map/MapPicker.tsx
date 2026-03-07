import { useMemo, useRef, useState } from 'react';
import { ARANDA_CENTER, buildStaticMapUrl, hasMapboxToken } from '../../lib/mapbox';

type MapPickerProps = {
  lat: number;
  lng: number;
  onChange: (next: { lat: number; lng: number }) => void;
};

const BASE_LAT_RANGE = 0.08;
const BASE_LNG_RANGE = 0.08;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export default function MapPicker({ lat, lng, onChange }: MapPickerProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(14);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);

  const staticMapUrl = useMemo(() => buildStaticMapUrl(lat, lng, zoom), [lat, lng, zoom]);
  const openStreetMapEmbedUrl = useMemo(() => {
    const delta = Math.max(0.02, 0.18 / Math.max(1, zoom - 8));
    const left = lng - delta;
    const right = lng + delta;
    const top = lat + delta;
    const bottom = lat - delta;

    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`;
  }, [lat, lng, zoom]);

  const updateFromPointer = (clientX: number, clientY: number) => {
    if (!mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(clientY - rect.top, 0), rect.height);

    const lngRatio = x / rect.width;
    const latRatio = y / rect.height;

    const zoomFactor = Math.pow(2, 12 - zoom);
    const latRange = BASE_LAT_RANGE * zoomFactor;
    const lngRange = BASE_LNG_RANGE * zoomFactor;

    const nextLng = lng + (lngRatio - 0.5) * lngRange;
    const nextLat = lat - (latRatio - 0.5) * latRange;

    onChange({
      lat: Number(nextLat.toFixed(6)),
      lng: Number(nextLng.toFixed(6))
    });
  };

  const zoomIn = () => setZoom((prev) => clamp(prev + 1, 10, 18));
  const zoomOut = () => setZoom((prev) => clamp(prev - 1, 10, 18));

  const useGpsLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6))
        });
        setZoom(16);
      },
      () => {
        // intentionally silent: UI already has manual controls
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
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

      <div className="map-controls">
        <button className="btn ghost map-control-btn" type="button" onClick={zoomOut}>− Zoom</button>
        <span className="map-zoom-label">Nivel: {zoom}</span>
        <button className="btn ghost map-control-btn" type="button" onClick={zoomIn}>+ Zoom</button>
        <button className="btn green map-gps-btn" type="button" onClick={useGpsLocation}>Usar mi GPS</button>
      </div>

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
        onWheel={(event) => {
          event.preventDefault();
          if (event.deltaY < 0) zoomIn();
          else zoomOut();
        }}
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
        {!mapLoadFailed ? (
          <img
            src={staticMapUrl}
            alt="Vista previa del mapa"
            className="loc-preview"
            onError={() => setMapLoadFailed(true)}
          />
        ) : (
          <>
            <iframe
              title="Mapa de respaldo"
              src={openStreetMapEmbedUrl}
              className="loc-preview loc-preview-fallback"
              loading="lazy"
            />
            <small className="map-fallback-note">Mostrando mapa de respaldo para mejorar compatibilidad en Safari iPhone.</small>
          </>
        )}
        <div className="map-pin" title="Arrastra el pin">📍</div>
      </div>

      <div className="coord-grid">
        <label>
          <span>Latitud</span>
          <input
            className="coord-input"
            value={lat}
            type="number"
            step="0.0001"
            onChange={(event) => onChange({ lat: Number(event.target.value), lng })}
          />
        </label>
        <label>
          <span>Longitud</span>
          <input
            className="coord-input"
            value={lng}
            type="number"
            step="0.0001"
            onChange={(event) => onChange({ lat, lng: Number(event.target.value) })}
          />
        </label>
      </div>

      <button className="btn ghost" onClick={() => {
        onChange({ lat: ARANDA_CENTER.lat, lng: ARANDA_CENTER.lng });
        setZoom(14);
      }}>
        Volver al centro de Aranda
      </button>
    </div>
  );
}
