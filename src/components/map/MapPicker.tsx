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
  address?: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
};

const BASE_LAT_RANGE = 0.08;
const BASE_LNG_RANGE = 0.08;

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getDistanceKm = (originLat: number, originLng: number, targetLat: number, targetLng: number) => {
  const latDistance = originLat - targetLat;
  const lngDistance = originLng - targetLng;
  const kmPerLatDegree = 111;
  const kmPerLngDegree = 111 * Math.cos((originLat * Math.PI) / 180);

  return Math.sqrt(Math.pow(latDistance * kmPerLatDegree, 2) + Math.pow(lngDistance * kmPerLngDegree, 2));
};

const getSuggestionTitle = (suggestion: AddressSuggestion) => {
  const houseNumber = suggestion.address?.house_number?.trim();
  const road = suggestion.address?.road?.trim();

  if (road && houseNumber) return `${road} ${houseNumber}`;
  if (road) return road;

  return suggestion.display_name.split(',')[0]?.trim() ?? suggestion.display_name;
};

const getSuggestionSubtitle = (suggestion: AddressSuggestion) => {
  const address = suggestion.address;
  if (!address) return suggestion.display_name;

  const locality = address.neighbourhood || address.suburb;
  const city = address.city || address.town || address.village || address.municipality || address.county;

  return [locality, city, address.state].filter(Boolean).join(', ') || suggestion.display_name;
};

const rankSuggestions = (query: string, currentLat: number, currentLng: number, suggestions: AddressSuggestion[]) => {
  const queryNormalized = normalizeText(query);
  const queryTokens = queryNormalized.split(' ').filter(Boolean);
  const houseNumber = queryTokens.find((token) => /^\d+[a-z]?$/.test(token));
  const streetTokens = queryTokens.filter((token) => token.length > 2 && token !== houseNumber);

  return [...suggestions].sort((a, b) => {
    const aTitle = normalizeText(getSuggestionTitle(a));
    const bTitle = normalizeText(getSuggestionTitle(b));
    const aSubtitle = normalizeText(getSuggestionSubtitle(a));
    const bSubtitle = normalizeText(getSuggestionSubtitle(b));

    const getTokenHits = (text: string) => streetTokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
    const aStreetHits = getTokenHits(aTitle);
    const bStreetHits = getTokenHits(bTitle);

    if (aStreetHits !== bStreetHits) return bStreetHits - aStreetHits;

    if (houseNumber) {
      const aHasNumber = aTitle.includes(houseNumber);
      const bHasNumber = bTitle.includes(houseNumber);
      if (aHasNumber !== bHasNumber) return aHasNumber ? -1 : 1;
    }

    const localWords = ['arandas', 'jalisco'];
    const aLocalHits = localWords.reduce((sum, token) => sum + (aSubtitle.includes(token) ? 1 : 0), 0);
    const bLocalHits = localWords.reduce((sum, token) => sum + (bSubtitle.includes(token) ? 1 : 0), 0);

    if (aLocalHits !== bLocalHits) return bLocalHits - aLocalHits;

    const aDistance = getDistanceKm(currentLat, currentLng, Number(a.lat), Number(a.lon));
    const bDistance = getDistanceKm(currentLat, currentLng, Number(b.lat), Number(b.lon));

    return aDistance - bDistance;
  });
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
        const biasDelta = 0.4;
        const viewBox = `${lng - biasDelta},${lat + biasDelta},${lng + biasDelta},${lat - biasDelta}`;

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&accept-language=es&countrycodes=mx&dedupe=1&limit=8&viewbox=${encodeURIComponent(viewBox)}&q=${encodeURIComponent(addressText)}`,
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
                onAddressTextChange(getSuggestionTitle(option));
                setAddressOptions([]);
                setZoom(16);
              }}
            >
              <span className="address-option-title">{getSuggestionTitle(option)}</span>
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
