// Fictional catalog for internal QA. Never use these photos as a real merchant's offer.
export const catalog = [
  { slug: 'forno-21', name: 'Forno 21 · PRUEBA', type: 'Restaurantes', image: 'pizzeria', description: 'Pizzería de prueba. Masa artesanal, tamaños y extras. Imágenes ilustrativas; no es un comercio real.', items: [
    { name: 'Pizza Pepperoni', description: 'Tomate, mozzarella y pepperoni. El tamaño indica diámetro y precio completo. Contiene gluten y lácteos.', category: 'Pizzas', image: 'pizzeria', price: 149, options: [['Individual · 25 cm',149,'size'],['Mediana · 30 cm',199,'size'],['Familiar · 38 cm',259,'size'],['Mozzarella extra',25,'extra'],['Pepperoni extra',30,'extra'],['Champiñones',20,'extra'],['Orégano',0,'extra']] },
    { name: 'Pizza Margherita', description: 'Tomate, mozzarella y albahaca. Contiene gluten y lácteos. Usa las notas para retirar un ingrediente.', category: 'Pizzas', image: 'margherita', price: 139, options: [['Individual · 25 cm',139,'size'],['Mediana · 30 cm',189,'size'],['Familiar · 38 cm',249,'size'],['Mozzarella extra',25,'extra'],['Champiñones',20,'extra']] },
    { name: 'Agua natural · 600 ml', description: 'Botella individual. Producto de prueba.', category: 'Bebidas', price: 22 },
  ]},
  { slug: 'huerta-clara', name: 'Huerta Clara · PRUEBA', type: 'Frutería', image: 'grocer', description: 'Frutería de prueba para surtido y faltantes. Presentaciones de peso fijo; imágenes ilustrativas.', items: [
    { name: 'Manzana Gala · bolsa de 1 kg', description: 'Precio por bolsa de 1 kg. Cantidad 2 equivale a dos bolsas. Puedes indicar madurez en las notas.', category: 'Frutas', image: 'apples', price: 49, substitution: true },
    { name: 'Manzana Gala · pieza', description: 'Una pieza. Alternativa de prueba para practicar sustituciones.', category: 'Frutas', image: 'apples', price: 12, substitution: true },
    { name: 'Canasta de temporada', description: 'Canasta de prueba con plátanos, manzanas, naranjas, aguacates y limones. Presentación fija; confirmar cambios con el cliente.', category: 'Canastas', image: 'grocer', price: 229, substitution: false },
  ]},
  { slug: 'tacos-del-patio', name: 'Tacos del Patio · PRUEBA', type: 'Restaurantes', image: 'tacos', description: 'Taquería de prueba. Pastor, piña y tortillas de maíz. Imágenes ilustrativas.', items: [
    { name: 'Orden de tacos al pastor', description: 'Pastor con piña, cebolla y cilantro. La foto muestra la orden de 3. Retira ingredientes en notas.', category: 'Tacos', image: 'tacos', price: 75, options: [['3 tacos',75,'size'],['5 tacos',119,'size'],['Guacamole',18,'extra'],['Salsa aparte',0,'extra']] },
    { name: 'Agua natural · 600 ml', description: 'Botella individual.', category: 'Bebidas', price: 22 },
  ]},
  { slug: 'brasa-urbana', name: 'Brasa Urbana · PRUEBA', type: 'Restaurantes', image: 'burger', description: 'Hamburguesería de prueba. Recetas a la parrilla y extras. Imágenes ilustrativas.', items: [
    { name: 'Hamburguesa clásica', description: 'Res, cheddar, lechuga, tomate y pepinillos en brioche. Contiene gluten, lácteos y huevo. Papas no incluidas.', category: 'Hamburguesas', image: 'burger', price: 129, options: [['Cheddar extra',15,'extra'],['Tocino',25,'extra'],['Carne extra',45,'extra']] },
    { name: 'Agua natural · 600 ml', description: 'Botella individual.', category: 'Bebidas', price: 22 },
  ]},
  { slug: 'miga-y-cafe', name: 'Miga y Café · PRUEBA', type: 'Restaurantes', image: 'cafe', description: 'Cafetería de prueba. Panadería y café. Imágenes ilustrativas.', items: [
    { name: 'Croissant de mantequilla', description: 'Una pieza de hojaldre horneado. Contiene gluten, lácteos y huevo.', category: 'Panadería', image: 'cafe', price: 45, options: [['Mermelada aparte',10,'extra']] },
    { name: 'Café americano', description: 'Café de prueba. Elige el tamaño; sin leche.', category: 'Café', price: 35, options: [['Chico · 240 ml',35,'size'],['Grande · 360 ml',45,'size'],['Shot extra',15,'extra']] },
  ]},
];
