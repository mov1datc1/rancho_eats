import { useMemo } from 'react';
import { buildStaticMapUrl, hasMapboxToken } from '../../lib/mapbox';

type MapViewerProps = {
  lat: number;
  lng: number;
  title?: string;
};

export default function MapViewer({ lat, lng, title = 'Ubicación' }: MapViewerProps) {
  const staticMapUrl = useMemo(() => buildStaticMapUrl(lat, lng), [lat, lng]);

  if (!hasMapboxToken()) {
    return <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Mapa deshabilitado por falta de token.</p>;
  }

  return (
    <div>
      <p style={{ fontSize: '.78rem', marginBottom: '.4rem', color: 'var(--muted)' }}>{title}</p>
      <img src={staticMapUrl} alt={title} className="loc-preview" />
    </div>
  );
}
