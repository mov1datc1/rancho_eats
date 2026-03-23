import { useMemo } from 'react';
import {
  buildGoogleMapsEmbedUrl,
  buildGoogleStaticMapUrl,
  getStaticMapViewport,
  hasGoogleMapsApiKey,
  type GoogleStaticMarker,
  type GoogleStaticPath
} from '../../lib/googleMaps';

type MapOverlay = {
  lat: number;
  lng: number;
  icon: string;
  tone?: 'home' | 'driver' | 'neutral';
};

type MapViewerProps = {
  lat: number;
  lng: number;
  title?: string;
  zoom?: number;
  markers?: GoogleStaticMarker[];
  paths?: GoogleStaticPath[];
  overlays?: MapOverlay[];
};

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 700;

const projectToMercator = (latitude: number, longitude: number, zoomLevel: number) => {
  const tileSize = 256;
  const scale = tileSize * Math.pow(2, zoomLevel);
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);

  const x = ((longitude + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale;

  return { x, y };
};

export default function MapViewer({ lat, lng, title = 'Ubicación', zoom = 15, markers, paths, overlays }: MapViewerProps) {
  const mapPoints = useMemo(() => {
    const markerPoints = (markers ?? []).map((marker) => ({ lat: marker.lat, lng: marker.lng }));
    const overlayPoints = (overlays ?? []).map((overlay) => ({ lat: overlay.lat, lng: overlay.lng }));
    return [...markerPoints, ...overlayPoints];
  }, [markers, overlays]);

  const viewport = useMemo(
    () => getStaticMapViewport(mapPoints.length ? mapPoints : [{ lat, lng }], MAP_WIDTH, MAP_HEIGHT),
    [lat, lng, mapPoints]
  );

  const resolvedCenter = viewport?.center ?? { lat, lng };
  const resolvedZoom = viewport?.zoom ?? zoom;

  const staticMapUrl = useMemo(
    () => buildGoogleStaticMapUrl({
      center: resolvedCenter,
      zoom: resolvedZoom,
      markers: markers?.length ? markers : [{ lat, lng, color: 'red', label: 'U' }],
      paths
    }),
    [lat, lng, markers, paths, resolvedCenter, resolvedZoom]
  );
  const embedUrl = useMemo(() => buildGoogleMapsEmbedUrl(lat, lng, resolvedZoom), [lat, lng, resolvedZoom]);

  const overlayStyles = useMemo(() => {
    const centerProjected = projectToMercator(resolvedCenter.lat, resolvedCenter.lng, resolvedZoom);

    return (overlays ?? []).map((overlay) => {
      const projected = projectToMercator(overlay.lat, overlay.lng, resolvedZoom);
      const left = 50 + ((projected.x - centerProjected.x) / MAP_WIDTH) * 100;
      const top = 50 + ((projected.y - centerProjected.y) / MAP_HEIGHT) * 100;

      return {
        ...overlay,
        left: Math.min(92, Math.max(8, left)),
        top: Math.min(88, Math.max(12, top))
      };
    });
  }, [overlays, resolvedCenter.lat, resolvedCenter.lng, resolvedZoom]);

  return (
    <div>
      <p style={{ fontSize: '.78rem', marginBottom: '.4rem', color: 'var(--muted)' }}>{title}</p>
      <div className="map-viewer-frame">
        {hasGoogleMapsApiKey() && staticMapUrl ? (
          <img src={staticMapUrl} alt={title} className="loc-preview loc-preview-fallback map-viewer-image" loading="lazy" />
        ) : (
          <iframe
            title={title}
            src={embedUrl}
            className="loc-preview loc-preview-fallback map-viewer-image"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
        {hasGoogleMapsApiKey() && overlayStyles.map((overlay, index) => (
          <div
            key={`${overlay.icon}-${overlay.lat}-${overlay.lng}-${index}`}
            className={`map-overlay-badge map-overlay-badge-${overlay.tone ?? 'neutral'}`}
            style={{ left: `${overlay.left}%`, top: `${overlay.top}%` }}
            aria-label={overlay.tone === 'home' ? 'Cliente' : overlay.tone === 'driver' ? 'Repartidor' : title}
            title={overlay.tone === 'home' ? 'Cliente' : overlay.tone === 'driver' ? 'Repartidor' : title}
          >
            <span>{overlay.icon}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
