import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '20px', fontFamily: 'system-ui, sans-serif', lineHeight: '1.6', color: '#2D3748' }}>
      <h1 style={{ color: '#1A202C' }}>Aviso de Privacidad de Pide Ya</h1>
      <p><strong>Última actualización:</strong> 25 de mayo de 2026</p>

      <h2>1. Información que recopilamos</h2>
      <p>En <strong>Pide Ya</strong> recopilamos la siguiente información personal para brindar y mejorar nuestros servicios:</p>
      <ul>
        <li><strong>Información de cuenta:</strong> Nombre, número de teléfono, correo electrónico y dirección de entrega.</li>
        <li><strong>Datos de ubicación:</strong> Recopilamos datos de ubicación precisos (GPS) para mostrarte establecimientos cercanos, calcular costos de envío y permitir que los repartidores entreguen tu pedido de manera exacta.</li>
        <li><strong>Información de uso:</strong> Historial de pedidos y preferencias dentro de la aplicación.</li>
      </ul>

      <h2>2. Uso de la información</h2>
      <p>Utilizamos tus datos personales exclusivamente para los siguientes fines:</p>
      <ul>
        <li>Procesar y entregar tus pedidos de comida o productos.</li>
        <li>Comunicarnos contigo respecto al estado de tu orden.</li>
        <li>Proporcionar soporte al cliente.</li>
        <li>Mejorar el rendimiento y la seguridad de la aplicación.</li>
      </ul>

      <h2>3. Permisos de Ubicación</h2>
      <p>Nuestra aplicación solicita acceso a tu ubicación en primer plano (cuando la app está abierta) para identificar la dirección de entrega de manera automática. No rastreamos tu ubicación en segundo plano a menos que seas un repartidor activo usando la versión de repartidores de la app.</p>

      <h2>4. Compartir información</h2>
      <p>No vendemos ni alquilamos tu información personal a terceros. Solo compartimos tu nombre, teléfono y dirección de entrega con el restaurante y el repartidor asignado a tu orden con el único propósito de completar la entrega.</p>

      <h2>5. Retención y Eliminación de Datos</h2>
      <p>Conservamos tu información mientras tu cuenta esté activa. Tienes derecho a solicitar la eliminación permanente de tu cuenta y todos tus datos asociados en cualquier momento.</p>
      <p>Puedes eliminar tu cuenta de forma instantánea dirigiéndote a <strong>Perfil &gt; Eliminar cuenta</strong> dentro de la aplicación, o puedes solicitar la eliminación manual ingresando a <a href="/delete-account" style={{ color: '#3182CE' }}>nuestro portal de eliminación de datos</a>.</p>

      <h2>6. Contacto</h2>
      <p>Si tienes dudas sobre este aviso de privacidad o sobre el manejo de tus datos, puedes contactarnos a través de los canales de soporte oficiales indicados dentro de la aplicación o al correo soporte@pide-ya.app.</p>
    </div>
  );
}
