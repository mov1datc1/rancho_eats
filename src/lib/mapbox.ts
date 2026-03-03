export const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export const ARANDA_CENTER = {
  lat: 21.0419,
  lng: -102.3425,
  zoom: 11
};

export function hasMapboxToken(): boolean {
  return Boolean(mapboxToken && mapboxToken.startsWith('pk.'));
}

export function buildStaticMapUrl(lat: number, lng: number, zoom = 12): string {
  if (!hasMapboxToken()) return '';

  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+2D6A4F(${lng},${lat})/${lng},${lat},${zoom}/800x360?access_token=${mapboxToken}`;
}
