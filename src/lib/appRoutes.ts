const adminAliases = new Set(['/administracion', '/admin']);
const appRoutes = new Set(['/administrador', '/administrador/acceso', '/restaurantes', '/pruebas', '/repartidor', '/privacy', '/aviso-privacidad', '/delete-account']);

export function resolveAppRoute(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const canonical = adminAliases.has(path) ? '/administrador' : path;
  return { canonical, redirect: canonical !== pathname, kind: canonical === '/' ? 'landing' : appRoutes.has(canonical) ? 'app' : 'missing' };
}
