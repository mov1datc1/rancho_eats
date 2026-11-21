// Business hours and pause, in Mexico City time. Same rule as the database function business_open_now()
// (migration 071); the server is the authority, this only decides what the screen shows.
// Shared verbatim by the customer app, the merchant app and the web portal.

export type DayHours = { open: string; close: string } | null;
export type WeeklyHours = Record<string, DayHours>;
export type HoursSource = {
  is_open?: boolean | null;
  paused_until?: string | null;
  weekly_hours?: WeeklyHours | null;
  open_time?: string | null;
  close_time?: string | null;
};
export type OpenState = {
  open: boolean;
  reason: 'open' | 'paused' | 'closed';
  /** Short status, e.g. "Abierto", "En pausa", "Cerrado". */
  label: string;
  /** Next change, e.g. "Cierra a las 9:00 p.m.", "Vuelve a las 7:30 p.m.", "Abre mañana a las 9:00 a.m.". */
  detail: string;
};

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mexico City has no daylight saving time since 2022: UTC-6 all year.
const MX_OFFSET_MIN = -6 * 60;
const mx = (d: Date) => new Date(d.getTime() + MX_OFFSET_MIN * 60_000);

export const validTime = (t?: string | null) => !!t && HHMM.test(t);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function formatTime(t: string): string {
  const m = toMin(t), h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

export function formatClock(iso: string): string {
  const d = mx(new Date(iso));
  return formatTime(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`);
}

/** Weekly hours from a single range (what older records have). */
export function weekFromRange(open?: string | null, close?: string | null): WeeklyHours | null {
  if (!validTime(open) || !validTime(close)) return null;
  return Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [String(d), { open: open!, close: close! }]));
}

export function weeklyHours(r: HoursSource): WeeklyHours | null {
  return r.weekly_hours ?? weekFromRange(r.open_time, r.close_time);
}

function day(week: WeeklyHours, d: number): DayHours {
  const v = week[String(((d % 7) + 7) % 7)];
  return v && validTime(v.open) && validTime(v.close) ? v : null;
}

/** Inside opening hours at `now` (ignores the pause). */
export function inHours(week: WeeklyHours | null, now = new Date()): boolean {
  if (!week) return true;
  const t = mx(now), dow = t.getUTCDay(), mins = t.getUTCHours() * 60 + t.getUTCMinutes();
  const y = day(week, dow - 1);
  if (y && toMin(y.close) < toMin(y.open) && mins < toMin(y.close)) return true;
  const today = day(week, dow);
  if (!today) return false;
  const o = toMin(today.open), c = toMin(today.close);
  if (o === c) return true;
  if (c < o) return mins >= o;
  return mins >= o && mins < c;
}

function closingDetail(week: WeeklyHours, now: Date): string {
  const t = mx(now), dow = t.getUTCDay(), mins = t.getUTCHours() * 60 + t.getUTCMinutes();
  const y = day(week, dow - 1);
  if (y && toMin(y.close) < toMin(y.open) && mins < toMin(y.close)) return `Cierra a las ${formatTime(y.close)}`;
  const today = day(week, dow);
  if (!today || today.open === today.close) return 'Abierto todo el día';
  return `Cierra a las ${formatTime(today.close)}`;
}

function nextOpening(week: WeeklyHours, now: Date): string {
  const t = mx(now), dow = t.getUTCDay(), mins = t.getUTCHours() * 60 + t.getUTCMinutes();
  for (let i = 0; i < 7; i++) {
    const h = day(week, dow + i);
    if (!h || (i === 0 && toMin(h.open) <= mins)) continue;
    const when = i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${WEEKDAYS[(dow + i) % 7].toLowerCase()}`;
    return `Abre ${when} a las ${formatTime(h.open)}`;
  }
  return 'Sin horario de apertura';
}

export function businessOpenState(r: HoursSource, now = new Date()): OpenState {
  const week = weeklyHours(r);
  const pauseOver = !!r.paused_until && Date.parse(r.paused_until) <= now.getTime();
  if (r.is_open === false && !pauseOver) {
    return { open: false, reason: 'paused', label: 'En pausa', detail: r.paused_until ? `Vuelve a las ${formatClock(r.paused_until)}` : 'Vuelve pronto' };
  }
  if (!inHours(week, now)) return { open: false, reason: 'closed', label: 'Cerrado', detail: week ? nextOpening(week, now) : '' };
  return { open: true, reason: 'open', label: 'Abierto', detail: week ? closingDetail(week, now) : '' };
}

/** One line per day for summaries, e.g. "Lunes: 9:00 a.m. – 9:00 p.m.". */
export function describeWeek(week: WeeklyHours | null): { day: string; text: string }[] {
  return [1, 2, 3, 4, 5, 6, 0].map(d => {
    const h = week ? day(week, d) : null;
    return { day: WEEKDAYS[d], text: !h ? 'Cerrado' : h.open === h.close ? 'Abierto todo el día' : `${formatTime(h.open)} – ${formatTime(h.close)}` };
  });
}
