import { useMemo } from 'react';
import { buildGoogleMapsEmbedUrl, buildGoogleStaticMapUrl, hasGoogleMapsApiKey, type GoogleStaticMarker } from '../../lib/googleMaps';

type MapViewerProps = {
  lat: number;
  lng: number;
  title?: string;
  zoom?: number;
  markers?: GoogleStaticMarker[];
};

export default function MapViewer({ lat, lng, title = 'Ubicación', zoom = 15, markers }: MapViewerProps) {
  const staticMapUrl = useMemo(
    () => buildGoogleStaticMapUrl({
      center: markers?.length ? undefined : { lat, lng },
      zoom,
      markers: markers?.length ? markers : [{ lat, lng, color: 'red', label: 'U' }]
    }),
    [lat, lng, markers, zoom]
  );
  const embedUrl = useMemo(() => buildGoogleMapsEmbedUrl(lat, lng, zoom), [lat, lng, zoom]);

  return (
    <div>
      <p style={{ fontSize: '.78rem', marginBottom: '.4rem', color: 'var(--muted)' }}>{title}</p>
      {hasGoogleMapsApiKey() && staticMapUrl ? (
        <img src={staticMapUrl} alt={title} className="loc-preview loc-preview-fallback" loading="lazy" />
      ) : (
        <iframe
          title={title}
          src={embedUrl}
          className="loc-preview loc-preview-fallback"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      )}
    </div>
  );
}
