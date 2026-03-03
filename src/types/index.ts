export type RestaurantStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface Restaurant {
  id: string;
  name: string;
  description: string | null;
  phone: string;
  email: string;
  type: string;
  lat: number | null;
  lng: number | null;
  delivery_radius_km: number;
  is_open: boolean;
  status: RestaurantStatus;
  owner_id: string | null;
  zones: string[];
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  price: number;
  available: boolean;
  category: string;
}

export interface CartItem {
  menu_item_id: string;
  name: string;
  qty: number;
  unit_price: number;
  subtotal: number;
}

export interface Order {
  id: string;
  order_number: number;
  restaurant_id: string;
  client_name: string | null;
  client_phone: string | null;
  client_location_note: string | null;
  client_lat: number;
  client_lng: number;
  items: CartItem[];
  total: number;
  status: string;
  created_at: string;
}
