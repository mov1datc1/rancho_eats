const googleMapsApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();

export type GoogleStaticMarker = {
  lat: number;
  lng: number;
  color?: 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'gray' | 'black' | 'brown';
  label?: string;
  size?: 'tiny' | 'mid' | 'small';
};

type GoogleStaticMapOptions = {
  center?: { lat: number; lng: number };
  zoom?: number;
  size?: string;
  scale?: 1 | 2;
  maptype?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid';
  markers?: GoogleStaticMarker[];
};

export const hasGoogleMapsApiKey = () => Boolean(googleMapsApiKey);

export function buildGoogleMapsEmbedUrl(lat: number, lng: number, zoom = 15): string {
  const clampedZoom = Math.min(20, Math.max(3, Math.round(zoom)));
  return `https://maps.google.com/maps?q=${lat},${lng}&z=${clampedZoom}&output=embed`;
}

export function buildGoogleStaticMapUrl({
  center,
  zoom = 15,
  size = '1200x700',
  scale = 2,
  maptype = 'roadmap',
  markers = []
}: GoogleStaticMapOptions): string | null {
  if (!googleMapsApiKey) return null;

  const params = new URLSearchParams({
    size,
    scale: String(scale),
    maptype,
    key: googleMapsApiKey
  });

  if (center) {
    params.set('center', `${center.lat},${center.lng}`);
    params.set('zoom', String(Math.min(20, Math.max(3, Math.round(zoom)))));
  }

  markers.forEach((marker) => {
    const parts = [
      marker.size ? `size:${marker.size}` : null,
      marker.color ? `color:${marker.color}` : null,
      marker.label ? `label:${marker.label.slice(0, 1).toUpperCase()}` : null,
      `${marker.lat},${marker.lng}`
    ].filter(Boolean);

    params.append('markers', parts.join('|'));
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
