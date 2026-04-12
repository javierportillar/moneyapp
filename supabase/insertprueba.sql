begin;

do $$
declare
  v_usuario_id uuid;
begin
  select u.id
  into v_usuario_id
  from public.usuarios u
  where u.username = 'prueba'
    and u.id = '0a85ffe2-096c-463c-9cdd-0b63b29f2e8a';

  if v_usuario_id is null then
    raise exception 'No existe el usuario prueba con el id esperado.';
  end if;

  delete from public.pagos_obligaciones where usuario_id = v_usuario_id;
  delete from public.pagos_deudas where usuario_id = v_usuario_id;
  delete from public.gastos where usuario_id = v_usuario_id;
  delete from public.transferencias where usuario_id = v_usuario_id;
  delete from public.ingresos where usuario_id = v_usuario_id;
  delete from public.obligaciones where usuario_id = v_usuario_id;
  delete from public.deudas where usuario_id = v_usuario_id;
  delete from public.reglas_aprendizaje where usuario_id = v_usuario_id;
  delete from public.cierres_mensuales where usuario_id = v_usuario_id;
  delete from public.bolsillos where usuario_id = v_usuario_id;
  delete from public.categorias where usuario_id = v_usuario_id;

  insert into public.configuracion (
    id,
    usuario_id,
    etiqueta_bolsillo_operacion,
    etiqueta_bolsillo_ahorro,
    etiqueta_bolsillo_pagos_fijos,
    etiqueta_bolsillo_meta
  )
  values (
    '6e6bc5f8-8d1e-4ee4-b5d4-c8f3e43e9001',
    v_usuario_id,
    'Operacion',
    'Ahorro',
    'Pagos fijos',
    'Meta o inversion'
  )
  on conflict (usuario_id) do update
  set etiqueta_bolsillo_operacion = excluded.etiqueta_bolsillo_operacion,
      etiqueta_bolsillo_ahorro = excluded.etiqueta_bolsillo_ahorro,
      etiqueta_bolsillo_pagos_fijos = excluded.etiqueta_bolsillo_pagos_fijos,
      etiqueta_bolsillo_meta = excluded.etiqueta_bolsillo_meta,
      updated_at = timezone('utc', now());

  insert into public.categorias (id, usuario_id, app_id, nombre, posicion, es_sistema) values
    ('b533db77-3225-45db-8f7b-4b91aee10101', v_usuario_id, 'category:0:hogar', 'Hogar', 0, true),
    ('b533db77-3225-45db-8f7b-4b91aee10102', v_usuario_id, 'category:1:comida', 'Comida', 1, true),
    ('b533db77-3225-45db-8f7b-4b91aee10103', v_usuario_id, 'category:2:transporte', 'Transporte', 2, true),
    ('b533db77-3225-45db-8f7b-4b91aee10104', v_usuario_id, 'category:3:salud', 'Salud', 3, true),
    ('b533db77-3225-45db-8f7b-4b91aee10105', v_usuario_id, 'category:4:entretenimiento', 'Entretenimiento', 4, true),
    ('b533db77-3225-45db-8f7b-4b91aee10106', v_usuario_id, 'category:5:suscripciones', 'Suscripciones', 5, true),
    ('b533db77-3225-45db-8f7b-4b91aee10107', v_usuario_id, 'category:6:ahorro', 'Ahorro', 6, true),
    ('b533db77-3225-45db-8f7b-4b91aee10108', v_usuario_id, 'category:7:inversion', 'Inversion', 7, true),
    ('b533db77-3225-45db-8f7b-4b91aee10109', v_usuario_id, 'category:8:educacion', 'Educacion', 8, true),
    ('b533db77-3225-45db-8f7b-4b91aee10110', v_usuario_id, 'category:9:servicios', 'Servicios', 9, true),
    ('b533db77-3225-45db-8f7b-4b91aee10111', v_usuario_id, 'category:10:compras', 'Compras', 10, true),
    ('b533db77-3225-45db-8f7b-4b91aee10112', v_usuario_id, 'category:11:otros', 'Otros', 11, true);

  insert into public.reglas_aprendizaje (id, usuario_id, app_id, palabra_clave, categoria_id, aciertos) values
    ('0e7263d8-0f89-4a4c-8aef-601d4fb00101', v_usuario_id, 'rule:arriendo', 'arriendo', 'b533db77-3225-45db-8f7b-4b91aee10101', 8),
    ('0e7263d8-0f89-4a4c-8aef-601d4fb00102', v_usuario_id, 'rule:mercado', 'mercado', 'b533db77-3225-45db-8f7b-4b91aee10102', 6),
    ('0e7263d8-0f89-4a4c-8aef-601d4fb00103', v_usuario_id, 'rule:uber', 'uber', 'b533db77-3225-45db-8f7b-4b91aee10103', 5),
    ('0e7263d8-0f89-4a4c-8aef-601d4fb00104', v_usuario_id, 'rule:netflix', 'netflix', 'b533db77-3225-45db-8f7b-4b91aee10106', 4),
    ('0e7263d8-0f89-4a4c-8aef-601d4fb00105', v_usuario_id, 'rule:curso', 'curso', 'b533db77-3225-45db-8f7b-4b91aee10109', 3);

  insert into public.bolsillos (id, usuario_id, app_id, nombre, color, icono, tipo, posicion, archivado) values
    ('4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', v_usuario_id, 'p1', 'Operacion principal', '#0f766e', '💼', 'daily', 0, false),
    ('4a2ef380-4e9e-4d2c-88fa-e582cb7d1002', v_usuario_id, 'p2', 'Colchon', '#2563eb', '🛡️', 'savings', 1, false),
    ('4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', v_usuario_id, 'p3', 'Pagos fijos', '#f59e0b', '🧾', 'fixed', 2, false),
    ('4a2ef380-4e9e-4d2c-88fa-e582cb7d1004', v_usuario_id, 'p4', 'Meta viaje', '#7c3aed', '✈️', 'invest', 3, false);

  insert into public.ingresos (id, usuario_id, app_id, bolsillo_id, titulo, monto, fecha, recurrente) values
    ('f274ab4d-4b30-4d85-8c2f-7dbd7a410101', v_usuario_id, 'income:feb:salary', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'Salario febrero', 4200000, '2026-02-03', true),
    ('f274ab4d-4b30-4d85-8c2f-7dbd7a410102', v_usuario_id, 'income:feb:freelance', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'Proyecto freelance', 850000, '2026-02-18', false),
    ('f274ab4d-4b30-4d85-8c2f-7dbd7a410103', v_usuario_id, 'income:mar:salary', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'Salario marzo', 4200000, '2026-03-03', true),
    ('f274ab4d-4b30-4d85-8c2f-7dbd7a410104', v_usuario_id, 'income:mar:refund', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'Reembolso salud', 180000, '2026-03-19', false),
    ('f274ab4d-4b30-4d85-8c2f-7dbd7a410105', v_usuario_id, 'income:apr:salary', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'Salario abril', 4300000, '2026-04-03', true),
    ('f274ab4d-4b30-4d85-8c2f-7dbd7a410106', v_usuario_id, 'income:apr:bonus', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'Bono trimestral', 600000, '2026-04-10', false);

  insert into public.transferencias (id, usuario_id, app_id, bolsillo_origen_id, bolsillo_destino_id, monto, fecha, nota) values
    ('5e3e56f6-3ebd-4f6e-a906-05e77f8a0101', v_usuario_id, 'transfer:feb:save', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1002', 500000, '2026-02-04', 'Provision de ahorro febrero'),
    ('5e3e56f6-3ebd-4f6e-a906-05e77f8a0102', v_usuario_id, 'transfer:feb:fixed', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 900000, '2026-02-05', 'Fondeo pagos fijos febrero'),
    ('5e3e56f6-3ebd-4f6e-a906-05e77f8a0103', v_usuario_id, 'transfer:mar:trip', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1004', 350000, '2026-03-05', 'Aporte meta viaje marzo'),
    ('5e3e56f6-3ebd-4f6e-a906-05e77f8a0104', v_usuario_id, 'transfer:mar:fixed', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 950000, '2026-03-06', 'Fondeo pagos fijos marzo'),
    ('5e3e56f6-3ebd-4f6e-a906-05e77f8a0105', v_usuario_id, 'transfer:apr:save', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1002', 650000, '2026-04-05', 'Ahorro abril'),
    ('5e3e56f6-3ebd-4f6e-a906-05e77f8a0106', v_usuario_id, 'transfer:apr:trip', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1004', 500000, '2026-04-06', 'Meta viaje abril'),
    ('5e3e56f6-3ebd-4f6e-a906-05e77f8a0107', v_usuario_id, 'transfer:apr:fixed', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 1000000, '2026-04-06', 'Fondeo pagos fijos abril');

  insert into public.obligaciones (id, usuario_id, app_id, titulo, monto, dia_pago, dia_confirmacion, bolsillo_id, categoria_id, activa, ultimo_mes_pagado) values
    ('6a1f2bc1-52e4-4204-8485-0de1b6f40101', v_usuario_id, 'fixed:rent', 'Arriendo', 1250000, 5, 6, '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10101', true, '2026-04'),
    ('6a1f2bc1-52e4-4204-8485-0de1b6f40102', v_usuario_id, 'fixed:internet', 'Internet hogar', 95000, 8, 9, '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10110', true, '2026-04'),
    ('6a1f2bc1-52e4-4204-8485-0de1b6f40103', v_usuario_id, 'fixed:phone', 'Plan celular', 72000, 10, 11, '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10110', true, '2026-04'),
    ('6a1f2bc1-52e4-4204-8485-0de1b6f40104', v_usuario_id, 'fixed:netflix', 'Netflix', 38900, 12, 13, '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10106', true, '2026-03');

  insert into public.deudas (id, usuario_id, app_id, bolsillo_id, categoria_id, titulo, monto_total, monto_pendiente, monto_cuota, dia_pago, estado, fecha_saldada) values
    ('87cb2075-9aa4-4550-8c24-4ab5dfb10101', v_usuario_id, 'debt:laptop', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10111', 'Credito laptop', 2400000, 1200000, 400000, 25, 'active', null),
    ('87cb2075-9aa4-4550-8c24-4ab5dfb10102', v_usuario_id, 'debt:trip-card', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10105', 'Tarjeta viaje', 900000, 0, 300000, 18, 'settled', '2026-04-02 12:00:00+00');

  insert into public.gastos (id, usuario_id, app_id, bolsillo_id, categoria_id, obligacion_id, deuda_id, descripcion, monto, fecha, origen, confianza) values
    ('9ea92a4d-5855-4e31-84ce-69db3dc10101', v_usuario_id, 'expense:feb:rent', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10101', '6a1f2bc1-52e4-4204-8485-0de1b6f40101', null, 'Arriendo', 1250000, '2026-02-05', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10102', v_usuario_id, 'expense:feb:internet', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10110', '6a1f2bc1-52e4-4204-8485-0de1b6f40102', null, 'Internet hogar', 95000, '2026-02-08', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10103', v_usuario_id, 'expense:feb:phone', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10110', '6a1f2bc1-52e4-4204-8485-0de1b6f40103', null, 'Plan celular', 72000, '2026-02-10', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10104', v_usuario_id, 'expense:feb:market', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10102', null, null, 'Mercado quincenal', 280000, '2026-02-14', 'manual', 0.94),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10105', v_usuario_id, 'expense:feb:uber', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10103', null, null, 'Uber aeropuerto', 46000, '2026-02-20', 'wallet', 0.88),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10106', v_usuario_id, 'expense:feb:laptop-installment', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10111', null, '87cb2075-9aa4-4550-8c24-4ab5dfb10101', 'Cuota credito laptop febrero', 400000, '2026-02-25', 'debt', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10107', v_usuario_id, 'expense:mar:rent', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10101', '6a1f2bc1-52e4-4204-8485-0de1b6f40101', null, 'Arriendo', 1250000, '2026-03-05', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10108', v_usuario_id, 'expense:mar:internet', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10110', '6a1f2bc1-52e4-4204-8485-0de1b6f40102', null, 'Internet hogar', 95000, '2026-03-08', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10109', v_usuario_id, 'expense:mar:phone', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10110', '6a1f2bc1-52e4-4204-8485-0de1b6f40103', null, 'Plan celular', 72000, '2026-03-10', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10110', v_usuario_id, 'expense:mar:netflix', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10106', '6a1f2bc1-52e4-4204-8485-0de1b6f40104', null, 'Netflix', 38900, '2026-03-12', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10111', v_usuario_id, 'expense:mar:restaurant', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10102', null, null, 'Cena restaurante', 120000, '2026-03-16', 'manual', 0.91),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10112', v_usuario_id, 'expense:mar:laptop-installment', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10111', null, '87cb2075-9aa4-4550-8c24-4ab5dfb10101', 'Cuota credito laptop marzo', 400000, '2026-03-25', 'debt', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10113', v_usuario_id, 'expense:apr:rent', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10101', '6a1f2bc1-52e4-4204-8485-0de1b6f40101', null, 'Arriendo', 1250000, '2026-04-05', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10114', v_usuario_id, 'expense:apr:internet', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10110', '6a1f2bc1-52e4-4204-8485-0de1b6f40102', null, 'Internet hogar', 95000, '2026-04-08', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10115', v_usuario_id, 'expense:apr:phone', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1003', 'b533db77-3225-45db-8f7b-4b91aee10110', '6a1f2bc1-52e4-4204-8485-0de1b6f40103', null, 'Plan celular', 72000, '2026-04-10', 'fixed', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10116', v_usuario_id, 'expense:apr:market', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10102', null, null, 'Mercado mensual', 315000, '2026-04-13', 'wallet', 0.93),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10117', v_usuario_id, 'expense:apr:laptop-installment', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10111', null, '87cb2075-9aa4-4550-8c24-4ab5dfb10101', 'Cuota credito laptop abril', 400000, '2026-04-25', 'debt', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10118', v_usuario_id, 'expense:apr:laptop-extra', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10111', null, '87cb2075-9aa4-4550-8c24-4ab5dfb10101', 'Abono extra credito laptop', 400000, '2026-04-26', 'debt', 1),
    ('9ea92a4d-5855-4e31-84ce-69db3dc10119', v_usuario_id, 'expense:apr:trip-card', '4a2ef380-4e9e-4d2c-88fa-e582cb7d1001', 'b533db77-3225-45db-8f7b-4b91aee10105', null, '87cb2075-9aa4-4550-8c24-4ab5dfb10102', 'Cuota final tarjeta viaje', 300000, '2026-04-02', 'debt', 1);

  insert into public.pagos_obligaciones (id, usuario_id, app_id, obligacion_id, gasto_id, monto, fecha_pago, mes_periodo) values
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0101', v_usuario_id, 'fixed:rent:2026-02', '6a1f2bc1-52e4-4204-8485-0de1b6f40101', '9ea92a4d-5855-4e31-84ce-69db3dc10101', 1250000, '2026-02-05', '2026-02'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0102', v_usuario_id, 'fixed:internet:2026-02', '6a1f2bc1-52e4-4204-8485-0de1b6f40102', '9ea92a4d-5855-4e31-84ce-69db3dc10102', 95000, '2026-02-08', '2026-02'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0103', v_usuario_id, 'fixed:phone:2026-02', '6a1f2bc1-52e4-4204-8485-0de1b6f40103', '9ea92a4d-5855-4e31-84ce-69db3dc10103', 72000, '2026-02-10', '2026-02'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0104', v_usuario_id, 'fixed:rent:2026-03', '6a1f2bc1-52e4-4204-8485-0de1b6f40101', '9ea92a4d-5855-4e31-84ce-69db3dc10107', 1250000, '2026-03-05', '2026-03'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0105', v_usuario_id, 'fixed:internet:2026-03', '6a1f2bc1-52e4-4204-8485-0de1b6f40102', '9ea92a4d-5855-4e31-84ce-69db3dc10108', 95000, '2026-03-08', '2026-03'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0106', v_usuario_id, 'fixed:phone:2026-03', '6a1f2bc1-52e4-4204-8485-0de1b6f40103', '9ea92a4d-5855-4e31-84ce-69db3dc10109', 72000, '2026-03-10', '2026-03'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0107', v_usuario_id, 'fixed:netflix:2026-03', '6a1f2bc1-52e4-4204-8485-0de1b6f40104', '9ea92a4d-5855-4e31-84ce-69db3dc10110', 38900, '2026-03-12', '2026-03'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0108', v_usuario_id, 'fixed:rent:2026-04', '6a1f2bc1-52e4-4204-8485-0de1b6f40101', '9ea92a4d-5855-4e31-84ce-69db3dc10113', 1250000, '2026-04-05', '2026-04'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0109', v_usuario_id, 'fixed:internet:2026-04', '6a1f2bc1-52e4-4204-8485-0de1b6f40102', '9ea92a4d-5855-4e31-84ce-69db3dc10114', 95000, '2026-04-08', '2026-04'),
    ('24f00d0e-947e-4a75-b6fa-6a1a42ff0110', v_usuario_id, 'fixed:phone:2026-04', '6a1f2bc1-52e4-4204-8485-0de1b6f40103', '9ea92a4d-5855-4e31-84ce-69db3dc10115', 72000, '2026-04-10', '2026-04');

  insert into public.pagos_deudas (id, usuario_id, app_id, deuda_id, gasto_id, monto, fecha_pago, tipo) values
    ('afec2862-378f-4205-a0c8-10bf3f9b0101', v_usuario_id, 'debtpay:laptop:feb', '87cb2075-9aa4-4550-8c24-4ab5dfb10101', '9ea92a4d-5855-4e31-84ce-69db3dc10106', 400000, '2026-02-25', 'scheduled'),
    ('afec2862-378f-4205-a0c8-10bf3f9b0102', v_usuario_id, 'debtpay:laptop:mar', '87cb2075-9aa4-4550-8c24-4ab5dfb10101', '9ea92a4d-5855-4e31-84ce-69db3dc10112', 400000, '2026-03-25', 'scheduled'),
    ('afec2862-378f-4205-a0c8-10bf3f9b0103', v_usuario_id, 'debtpay:laptop:apr', '87cb2075-9aa4-4550-8c24-4ab5dfb10101', '9ea92a4d-5855-4e31-84ce-69db3dc10117', 400000, '2026-04-25', 'scheduled'),
    ('afec2862-378f-4205-a0c8-10bf3f9b0104', v_usuario_id, 'debtpay:laptop:apr-extra', '87cb2075-9aa4-4550-8c24-4ab5dfb10101', '9ea92a4d-5855-4e31-84ce-69db3dc10118', 400000, '2026-04-26', 'extra'),
    ('afec2862-378f-4205-a0c8-10bf3f9b0105', v_usuario_id, 'debtpay:trip-card:apr', '87cb2075-9aa4-4550-8c24-4ab5dfb10102', '9ea92a4d-5855-4e31-84ce-69db3dc10119', 300000, '2026-04-02', 'scheduled');

  insert into public.cierres_mensuales (id, usuario_id, mes, total_ingresos, total_gastos, flujo_neto, saldo_bolsillos, deuda_pendiente, obligaciones_pendientes, fecha_cierre) values
    ('0f52d68c-4ab6-43eb-9cb0-15442de50101', v_usuario_id, '2026-02', 5050000, 2143000, 2907000, 2907000, 2000000, 0, '2026-02-28 23:00:00+00'),
    ('0f52d68c-4ab6-43eb-9cb0-15442de50102', v_usuario_id, '2026-03', 4380000, 1975900, 2404100, 5311100, 1600000, 0, '2026-03-31 23:00:00+00'),
    ('0f52d68c-4ab6-43eb-9cb0-15442de50103', v_usuario_id, '2026-04', 4900000, 2432000, 2468000, 7779100, 1200000, 38900, '2026-04-11 12:00:00+00');
end $$;

commit;
