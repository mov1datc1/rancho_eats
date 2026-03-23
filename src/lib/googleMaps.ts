const googleMapsApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();

export type GoogleStaticMarker = {
  lat: number;
  lng: number;
  color?: 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'gray' | 'black' | 'brown';
  label?: string;
  size?: 'tiny' | 'mid' | 'small';
};

export type GoogleStaticPath = {
  color?: string;
  weight?: number;
  fillcolor?: string;
  points: Array<{ lat: number; lng: number }>;
};

type GoogleStaticMapOptions = {
  center?: { lat: number; lng: number };
  zoom?: number;
  size?: string;
  scale?: 1 | 2;
  maptype?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid';
  markers?: GoogleStaticMarker[];
  paths?: GoogleStaticPath[];
};

export const hasGoogleMapsApiKey = () => Boolean(googleMapsApiKey);

const projectToMercator = (latitude: number, longitude: number, zoomLevel: number) => {
  const tileSize = 256;
  const scale = tileSize * Math.pow(2, zoomLevel);
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);

  const x = ((longitude + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale;

  return { x, y };
};

const unprojectFromMercator = (x: number, y: number, zoomLevel: number) => {
  const tileSize = 256;
  const scale = tileSize * Math.pow(2, zoomLevel);

  const longitude = (x / scale) * 360 - 180;
  const yNormalized = 0.5 - y / scale;
  const latitude = (180 / Math.PI) * (2 * Math.atan(Math.exp(yNormalized * 2 * Math.PI)) - Math.PI / 2);

  return { lat: latitude, lng: longitude };
};

export function getStaticMapViewport(
  points: Array<{ lat: number; lng: number }>,
  width = 1200,
  height = 700,
  padding = 140
): { center: { lat: number; lng: number }; zoom: number } | null {
  if (!points.length) return null;
  if (points.length === 1) return { center: points[0], zoom: 16 };

  const referenceZoom = 20;
  const projected = points.map((point) => projectToMercator(point.lat, point.lng, referenceZoom));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const center = unprojectFromMercator((minX + maxX) / 2, (minY + maxY) / 2, referenceZoom);

  for (let zoom = 18; zoom >= 12; zoom -= 1) {
    const scaled = points.map((point) => projectToMercator(point.lat, point.lng, zoom));
    const spanX = Math.max(...scaled.map((point) => point.x)) - Math.min(...scaled.map((point) => point.x));
    const spanY = Math.max(...scaled.map((point) => point.y)) - Math.min(...scaled.map((point) => point.y));

    if (spanX <= width - padding * 2 && spanY <= height - padding * 2) {
      return { center, zoom };
    }
  }

  return { center, zoom: 12 };
}

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
  markers = [],
  paths = []
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

  paths.forEach((path) => {
    if (path.points.length < 2) return;

    const parts = [
      path.weight ? `weight:${path.weight}` : null,
      path.color ? `color:${path.color}` : null,
      path.fillcolor ? `fillcolor:${path.fillcolor}` : null,
      ...path.points.map((point) => `${point.lat},${point.lng}`)
    ].filter(Boolean);

    params.append('path', parts.join('|'));
  });

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
