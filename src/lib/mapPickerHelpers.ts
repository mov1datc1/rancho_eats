export type AddressSuggestion = {
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

export const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const clampZoom = (value: number) => Math.min(18, Math.max(12, value));

export const projectToMercator = (latitude: number, longitude: number, zoomLevel: number) => {
  const tileSize = 256;
  const scale = tileSize * Math.pow(2, zoomLevel);
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);

  const x = ((longitude + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale;

  return { x, y };
};

export const unprojectFromMercator = (x: number, y: number, zoomLevel: number) => {
  const tileSize = 256;
  const scale = tileSize * Math.pow(2, zoomLevel);

  const longitude = (x / scale) * 360 - 180;
  const yNormalized = 0.5 - y / scale;
  const latitude = (180 / Math.PI) * (2 * Math.atan(Math.exp(yNormalized * 2 * Math.PI)) - Math.PI / 2);

  return { latitude, longitude };
};

export const getDistanceKm = (originLat: number, originLng: number, targetLat: number, targetLng: number) => {
  const latDistance = originLat - targetLat;
  const lngDistance = originLng - targetLng;
  const kmPerLatDegree = 111;
  const kmPerLngDegree = 111 * Math.cos((originLat * Math.PI) / 180);

  return Math.sqrt(Math.pow(latDistance * kmPerLatDegree, 2) + Math.pow(lngDistance * kmPerLngDegree, 2));
};

export const getQueryHouseNumber = (query: string) => {
  const queryTokens = normalizeText(query).split(' ').filter(Boolean);
  return queryTokens.find((token) => /^\d+[a-z]?$/.test(token));
};

export const getSuggestionTitle = (suggestion: AddressSuggestion) => {
  const houseNumber = suggestion.address?.house_number?.trim();
  const road = suggestion.address?.road?.trim();

  if (road && houseNumber) return `${road} ${houseNumber}`;
  if (road) return road;

  return suggestion.display_name.split(',')[0]?.trim() ?? suggestion.display_name;
};

export const getSuggestionTitleWithQuery = (suggestion: AddressSuggestion, query: string) => {
  const title = getSuggestionTitle(suggestion);
  const queryHouseNumber = getQueryHouseNumber(query);
  if (!queryHouseNumber) return title;

  const titleNormalized = normalizeText(title);
  if (titleNormalized.includes(queryHouseNumber)) return title;

  const firstDisplaySegment = suggestion.display_name.split(',')[0]?.trim() ?? '';
  const firstDisplaySegmentNormalized = normalizeText(firstDisplaySegment);
  const hasNumberInDisplay = firstDisplaySegmentNormalized.includes(queryHouseNumber);

  if (hasNumberInDisplay) return firstDisplaySegment;

  const road = suggestion.address?.road?.trim();
  if (road) return `${road} ${queryHouseNumber}`;

  return title;
};

export const getSuggestionSubtitle = (suggestion: AddressSuggestion) => {
  const address = suggestion.address;
  if (!address) return suggestion.display_name;

  const locality = address.neighbourhood || address.suburb;
  const city = address.city || address.town || address.village || address.municipality || address.county;

  return [locality, city, address.state].filter(Boolean).join(', ') || suggestion.display_name;
};

export const rankSuggestions = (query: string, currentLat: number, currentLng: number, suggestions: AddressSuggestion[]) => {
  const queryNormalized = normalizeText(query);
  const queryTokens = queryNormalized.split(' ').filter(Boolean);
  const houseNumber = queryTokens.find((token) => /^\d+[a-z]?$/.test(token));
  const streetTokens = queryTokens.filter((token) => token.length > 2 && token !== houseNumber);

  return [...suggestions].sort((a, b) => {
    const aTitle = normalizeText(getSuggestionTitleWithQuery(a, query));
    const bTitle = normalizeText(getSuggestionTitleWithQuery(b, query));
    const aSubtitle = normalizeText(getSuggestionSubtitle(a));
    const bSubtitle = normalizeText(getSuggestionSubtitle(b));

    const getTokenHits = (text: string) => streetTokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
    const aStreetHits = getTokenHits(aTitle);
    const bStreetHits = getTokenHits(bTitle);

    if (aStreetHits !== bStreetHits) return bStreetHits - aStreetHits;

    if (houseNumber) {
      const aHasNumber = aTitle.includes(houseNumber) || normalizeText(a.display_name).includes(houseNumber);
      const bHasNumber = bTitle.includes(houseNumber) || normalizeText(b.display_name).includes(houseNumber);
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
