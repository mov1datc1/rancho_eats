export type DraftOption = { label: string; price: string; imageUrl: string; optionType: 'size' | 'extra' };

export function parseMenuDraft(base: string, drafts: DraftOption[]) {
  const options = drafts.filter(o => o.label.trim() || o.price.trim() || o.imageUrl.trim()).map((o, index) => {
    const price = Number(o.price.replace(',', '.'));
    if (!o.label.trim() || !o.price.trim() || !Number.isFinite(price) || price < 0 || (o.optionType === 'size' && price === 0)) {
      throw new Error('Cada opción necesita nombre y precio válido; un extra gratuito puede costar 0.');
    }
    return { label: o.label.trim(), price, image_url: o.imageUrl.trim() || null, option_type: o.optionType, sort_order: index, available: true };
  });
  const sizes = options.filter(o => o.option_type === 'size');
  const price = sizes.length ? Math.min(...sizes.map(o => o.price)) : Number(base.replace(',', '.'));
  if ((!sizes.length && !base.trim()) || !Number.isFinite(price) || price <= 0) throw new Error('Indica el precio base o al menos un tamaño con precio completo. Los extras no sustituyen el precio base.');
  return { price, options };
}
