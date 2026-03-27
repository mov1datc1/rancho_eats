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
  delivery_fee_0_10?: number | null;
  delivery_fee_10_15?: number | null;
  delivery_fee_15_20?: number | null;
  delivery_fee_20_30?: number | null;
  address?: string | null;
  is_open: boolean;
  status: RestaurantStatus;
  owner_id: string | null;
  zones: string[];
  open_time?: string;
  close_time?: string;
  photo_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  price: number;
  available: boolean;
  category: string;
  photo_url_1?: string | null;
  photo_url_2?: string | null;
  menu_item_options?: MenuItemOption[];
}

export interface MenuItemOption {
  id: string;
  menu_item_id: string;
  label: string;
  price: number;
  image_url?: string | null;
  available: boolean;
  sort_order: number;
  option_type?: 'size' | 'extra';

}

export interface CartItem {
  menu_item_id: string;
  option_id?: string | null;
  option_label?: string | null;
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
  subtotal?: number | null;
  commission_amount?: number | null;
  delivery_amount?: number | null;
  total: number;
  status: string;
  rejection_reason?: string | null;
  delivery_driver_id?: string | null;
  delivery_driver_name?: string | null;
  delivery_driver_phone?: string | null;
  delivery_assigned_at?: string | null;
  delivery_started_at?: string | null;
  delivered_at?: string | null;
  driver_last_lat?: number | null;
  driver_last_lng?: number | null;
  driver_location_accuracy_m?: number | null;
  driver_location_updated_at?: string | null;
  created_at: string;
}

export interface DriverProfile {
  id: string;
  restaurant_id: string;
  name: string;
  phone: string;
  vehicle_label?: string | null;
  notes?: string | null;
  is_active: boolean;
  access_token: string;
  last_location_at?: string | null;
  created_at: string;
  updated_at: string;
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
