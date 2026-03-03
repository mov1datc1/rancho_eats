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


export interface AdminSummary {
  active_restaurants: number;
  pending_restaurants: number;
  orders_month: number;
  moved_month: number;
  blocked_entities: number;
}

export interface AdminRestaurantOverview {
  id: string;
  name: string;
  status: RestaurantStatus;
  orders_today: number;
}

export interface AdminActivityItem {
  kind: string;
  title: string;
  detail: string;
  happened_at: string;
}

export interface AdminAntiSpamItem {
  entity: string;
  orders_today: number;
  cancelled: number;
  rejected: number;
  last_order_at: string;
}

export interface AdminOrdersByRestaurant {
  restaurant_name: string;
  orders_count: number;
}


export interface AdminOrderFeedItem {
  id: string;
  order_number: number;
  restaurant_name: string;
  status: string;
  total: number;
  client_name: string | null;
  client_phone: string | null;
  client_location_note: string | null;
  created_at: string;
}

export interface AdminMapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: RestaurantStatus;
  is_open: boolean;
}
