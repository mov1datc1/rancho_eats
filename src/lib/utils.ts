export function formatPrice(amount: number): string {
  return `$${amount.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Pendiente',
    ACCEPTED: 'Aceptado',
    ON_THE_WAY: 'En camino',
    DELIVERED: 'Entregado',
    REJECTED: 'Rechazado',
    CANCELLED: 'Cancelado'
  };

  return labels[status] ?? status;
}
