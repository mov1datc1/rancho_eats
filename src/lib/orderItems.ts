import type { CartItem } from '../types';
const amount = (v: unknown, fallback = 0) => Number.isFinite(Number(v)) && v !== null ? Number(v) : fallback;

// Both clients serialize order lines differently. Preserve every line; never
// guess which products were ordered by trying to match the grand total.
export function normalizeOrderItems(items: unknown): CartItem[] {
  return (Array.isArray(items) ? items : []).filter(i => i && typeof i === 'object').map((i, index) => {
    const options: Array<{ label?: string; price?: unknown }> = Array.isArray(i.options) ? i.options.filter((o: unknown) => o && typeof o === "object") : [];
    const qty = amount(i.qty ?? i.quantity, 1);
    const unit = i.unit_price != null ? amount(i.unit_price) : amount(i.price) + options.reduce((sum, o) => sum + amount(o.price), 0);
    return {
      menu_item_id: String(i.menu_item_id ?? i.id ?? index),
      option_id: i.option_id ?? null,
      option_label: [i.option_label, ...options.map(o => String(o.label ?? '')), i.notes ?? i.note].filter(Boolean).join(' · ') || null,
      name: String(i.name ?? 'Producto'), qty, unit_price: unit,
      subtotal: Math.round(unit * qty * 100) / 100,
    };
  });
}
export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
