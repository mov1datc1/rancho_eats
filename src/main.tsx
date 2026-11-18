import React, {lazy,Suspense} from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter,Navigate,useLocation } from 'react-router-dom';
import LandingPage from './components/landing/LandingPage';
import RouteBoundary from './components/RouteBoundary';
import {resolveAppRoute} from './lib/appRoutes';
import './shell.css';
const App=lazy(()=>import('./App'));
const AdminEntry=lazy(()=>import('./components/admin/AdminEntry'));
const StaffPassword=lazy(()=>import('./components/admin/StaffPassword'));
function RootRoute(){
  const location=useLocation();
  const route=resolveAppRoute(location.pathname);
  if(route.redirect)return <Navigate replace to={{pathname:route.canonical,search:location.search,hash:location.hash}}/>;
  if(route.kind==='missing')return <main className="route-message"><h1>No encontramos esta página</h1><p>Elige dónde quieres continuar.</p><a href="/administrador">Abrir administración</a><a href="/">Ir al inicio</a></main>;
  return <RouteBoundary key={location.pathname}>{route.kind==='landing'?<LandingPage/>:<Suspense fallback={<div className="route-loading" role="status">Abriendo PideYa…</div>}>{location.pathname==='/administrador/acceso'?<StaffPassword/>:location.pathname==='/administrador'?<AdminEntry/>:<App/>}</Suspense>}</RouteBoundary>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RootRoute />
    </BrowserRouter>
  </React.StrictMode>
);


if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (!registration) return;

      const promptRefresh = () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      };

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            promptRefresh();
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }).catch(() => undefined);
  });
}

// A visible browser title distinguishes QA from the production application.
if (import.meta.env.VITE_PIDEYA_ENV === 'staging') document.title = '[PRUEBAS] PideYa';
