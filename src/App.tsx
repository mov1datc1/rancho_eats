import { Navigate, Route, Routes } from 'react-router-dom';

function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <h1 className="font-display text-4xl font-black text-brand">ArandaEats</h1>
      <p className="mt-3 text-base text-text">
        Configuración inicial completada. Continuamos con integración de base de datos y vistas.
      </p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
