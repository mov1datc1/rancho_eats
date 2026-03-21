import { useEffect, useMemo, useRef, useState } from 'react';
import { buildStaticMapUrl, hasMapboxToken } from '../../lib/mapbox';
import { buildGoogleMapsEmbedUrl } from '../../lib/googleMaps';
import {
  clampZoom,
  getSuggestionSubtitle,
  getSuggestionTitleWithQuery,
  projectToMercator,
  rankSuggestions,
  unprojectFromMercator
} from '../../lib/mapPickerHelpers';
import type { AddressSuggestion } from '../../lib/mapPickerHelpers';

type MapPickerProps = {
  lat: number;
  lng: number;
  addressText: string;
  onAddressTextChange: (value: string) => void;
  onChange: (next: { lat: number; lng: number }) => void;
};

export default function MapPicker({ lat, lng, addressText, onAddressTextChange, onChange }: MapPickerProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(15);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [addressOptions, setAddressOptions] = useState<AddressSuggestion[]>([]);

  const staticMapUrl = useMemo(() => buildStaticMapUrl(lat, lng, zoom), [lat, lng, zoom]);
  const canUseMapbox = hasMapboxToken();
  const googleMapsEmbedUrl = useMemo(() => buildGoogleMapsEmbedUrl(lat, lng, zoom), [lat, lng, zoom]);

  useEffect(() => {
    if (addressText.trim().length < 3) {
      setAddressOptions([]);
      return;
    }

    const controller = new AbortController();
    setSearchingAddress(true);

    const timeout = window.setTimeout(async () => {
      try {
        const biasDelta = 0.4;
        const viewBox = `${lng - biasDelta},${lat + biasDelta},${lng + biasDelta},${lat - biasDelta}`;

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&accept-language=es&countrycodes=mx&dedupe=1&limit=8&bounded=1&viewbox=${encodeURIComponent(viewBox)}&q=${encodeURIComponent(addressText)}`,
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
        setAddressOptions(rankSuggestions(addressText, lat, lng, data));
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
  }, [addressText, lat, lng]);

  const updateFromPointer = (clientX: number, clientY: number) => {
    if (!mapRef.current) return;

    const rect = mapRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(clientY - rect.top, 0), rect.height);

    const centerPoint = projectToMercator(lat, lng, zoom);
    const pointX = centerPoint.x + (x - rect.width / 2);
    const pointY = centerPoint.y + (y - rect.height / 2);

    const { latitude, longitude } = unprojectFromMercator(pointX, pointY, zoom);

    onChange({
      lat: Number(latitude.toFixed(6)),
      lng: Number(longitude.toFixed(6))
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
                onAddressTextChange(getSuggestionTitleWithQuery(option, addressText));
                setAddressOptions([]);
                setZoom(15);
              }}
            >
              <span className="address-option-title">{getSuggestionTitleWithQuery(option, addressText)}</span>
              <span className="address-option-subtitle">{getSuggestionSubtitle(option)}</span>
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
        <div className="map-zoom-controls" aria-label="Controles de zoom">
          <button
            type="button"
            className="map-zoom-btn"
            onClick={(event) => {
              event.stopPropagation();
              setZoom((previousZoom) => clampZoom(previousZoom + 1));
            }}
            aria-label="Acercar mapa"
          >
            +
          </button>
          <button
            type="button"
            className="map-zoom-btn"
            onClick={(event) => {
              event.stopPropagation();
              setZoom((previousZoom) => clampZoom(previousZoom - 1));
            }}
            aria-label="Alejar mapa"
          >
            −
          </button>
        </div>
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
              src={googleMapsEmbedUrl}
              className="loc-preview loc-preview-fallback"
              loading="lazy"
            />
            <small className="map-fallback-note">Usando Google Maps como respaldo para que la ubicación siga visible en todos los dispositivos.</small>
          </>
        )}
        <div className="map-pin" title="Arrastra el pin">📍</div>
      </div>
    </div>
  );
}
