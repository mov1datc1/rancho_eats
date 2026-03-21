import { useMemo } from 'react';
import { buildGoogleMapsEmbedUrl } from '../../lib/googleMaps';

type MapViewerProps = {
  lat: number;
  lng: number;
  title?: string;
};

export default function MapViewer({ lat, lng, title = 'Ubicación' }: MapViewerProps) {
  const embedUrl = useMemo(() => buildGoogleMapsEmbedUrl(lat, lng), [lat, lng]);

  return (
    <div>
      <p style={{ fontSize: '.78rem', marginBottom: '.4rem', color: 'var(--muted)' }}>{title}</p>
      <iframe
        title={title}
        src={embedUrl}
        className="loc-preview loc-preview-fallback"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
