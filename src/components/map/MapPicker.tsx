import { useEffect, useMemo, useRef, useState } from 'react';
import { buildStaticMapUrl, hasMapboxToken } from '../../lib/mapbox';

type MapPickerProps = {
  lat: number;
  lng: number;
  addressText: string;
  onAddressTextChange: (value: string) => void;
  onChange: (next: { lat: number; lng: number }) => void;
};

type AddressSuggestion = {
  display_name: string;
  lat: string;
  lon: string;
  place_id: number;
};

const BASE_LAT_RANGE = 0.08;
const BASE_LNG_RANGE = 0.08;

export default function MapPicker({ lat, lng, addressText, onAddressTextChange, onChange }: MapPickerProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(15);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [addressOptions, setAddressOptions] = useState<AddressSuggestion[]>([]);

  const staticMapUrl = useMemo(() => buildStaticMapUrl(lat, lng, zoom), [lat, lng, zoom]);
  const canUseMapbox = hasMapboxToken();
  const openStreetMapEmbedUrl = useMemo(() => {
    const delta = Math.max(0.02, 0.18 / Math.max(1, zoom - 8));
    const left = lng - delta;
    const right = lng + delta;
    const top = lat + delta;
    const bottom = lat - delta;

    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`;
  }, [lat, lng, zoom]);

  useEffect(() => {
    if (addressText.trim().length < 3) {
      setAddressOptions([]);
      return;
    }

    const controller = new AbortController();
    setSearchingAddress(true);

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=mx&limit=5&q=${encodeURIComponent(addressText)}`,
          {
            signal: controller.signal,
            headers: {
              Accept: 'application/json'
            }
          }
        );

        if (!response.ok) {
          setAddressOptions([]);
          return;
        }

        const data = (await response.json()) as AddressSuggestion[];
        setAddressOptions(data);
      } catch {
        setAddressOptions([]);
      } finally {
        setSearchingAddress(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [addressText]);

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

  return (
    <div className="loc-box">
      <h4>📍 ¿A dónde te llevamos? <span className="req">*Requerido</span></h4>
      <p className="loc-sub">Escribe tu dirección para buscarla o mueve el pin directamente en el mapa.</p>

      <label className="cfl" htmlFor="address-search">Dirección</label>
      <input
        id="address-search"
        className="cfi"
        placeholder="Ej. Calle Juárez 120, Arandas"
        value={addressText}
        onChange={(event) => onAddressTextChange(event.target.value)}
      />

      {(searchingAddress || addressOptions.length > 0) && (
        <div className="address-options" role="listbox" aria-label="Sugerencias de dirección">
          {searchingAddress && <div className="address-option muted">Buscando direcciones…</div>}
          {!searchingAddress && addressOptions.map((option) => (
            <button
              key={option.place_id}
              className="address-option"
              type="button"
              onClick={() => {
                onChange({ lat: Number(option.lat), lng: Number(option.lon) });
                onAddressTextChange(option.display_name);
                setAddressOptions([]);
                setZoom(16);
              }}
            >
              {option.display_name}
            </button>
          ))}
        </div>
      )}

      <div className="map-controls">
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
        {canUseMapbox && !mapLoadFailed ? (
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
            <small className="map-fallback-note">{canUseMapbox ? 'Mostrando mapa de respaldo para mejorar compatibilidad en Safari iPhone.' : 'Token de Mapbox inválido o bloqueado. Mostrando mapa de respaldo.'}</small>
          </>
        )}
        <div className="map-pin" title="Arrastra el pin">📍</div>
      </div>
    </div>
  );
}
