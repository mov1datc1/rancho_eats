INSERT INTO restaurants (name, description, phone, email, type, delivery_radius_km, zones, open_time, close_time, is_open, status, lat, lng)
VALUES
  ('El Asadero de Don Chuy',
   'La mejor carne asada de Aranda, directo a tu rancho desde 1998.',
   '344-123-4567', 'asadero@test.com', 'CARNES', 20,
   ARRAY['Aranda centro','El Saucito','Las Flores','La Providencia'],
   '10:00', '22:00', TRUE, 'ACTIVE', 21.0419, -102.3425),

  ('Birriería Don Lupe',
   'Birria de res y chiva, consomé y tacos. La tradición de siempre.',
   '344-234-5678', 'birreria@test.com', 'BIRRIA', 15,
   ARRAY['Aranda centro','El Llano','San José'],
   '08:00', '16:00', TRUE, 'ACTIVE', 21.0409, -102.3415),

  ('Pollos Rosticería La Palma',
   'Pollos rostizados al carbón, costillas y más.',
   '344-345-6789', 'lapalma@test.com', 'POLLOS', 12,
   ARRAY['Aranda centro','Arandas'],
   '11:00', '20:00', FALSE, 'ACTIVE', 21.0429, -102.3405);
