export function buildGoogleMapsEmbedUrl(lat: number, lng: number, zoom = 15): string {
  const clampedZoom = Math.min(20, Math.max(3, Math.round(zoom)));
  return `https://maps.google.com/maps?q=${lat},${lng}&z=${clampedZoom}&output=embed`;
}
