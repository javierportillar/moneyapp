create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop view if exists public.movimientos cascade;

drop function if exists public.usuario_actual_simple() cascade;
drop function if exists public.cerrar_sesion_simple() cascade;
drop function if exists public.registrar_usuario_simple(text, text, text, text) cascade;
drop function if exists public.iniciar_sesion_simple(text, text) cascade;
drop function if exists public.es_admin_actual() cascade;
drop function if exists public.usuario_actual_id() cascade;
drop function if exists public.token_sesion_actual() cascade;
drop function if exists public.hash_token_sesion(text) cascade;
drop function if exists public.generar_token_sesion() cascade;

drop table if exists public.sesiones cascade;
drop table if exists public.pagos_deudas cascade;
drop table if exists public.pagos_obligaciones cascade;
drop table if exists public.transferencias cascade;
drop table if exists public.gastos cascade;
drop table if exists public.deudas cascade;
drop table if exists public.ingresos cascade;
drop table if exists public.obligaciones cascade;
drop table if exists public.bolsillos cascade;
drop table if exists public.reglas_aprendizaje cascade;
drop table if exists public.categorias cascade;
drop table if exists public.cierres_mensuales cascade;
drop table if exists public.configuracion cascade;
drop table if exists public.finance_snapshots cascade;

drop table if exists public.debt_payments cascade;
drop table if exists public.obligation_payments cascade;
drop table if exists public.transfers cascade;
drop table if exists public.expenses cascade;
drop table if exists public.debts cascade;
drop table if exists public.incomes cascade;
drop table if exists public.obligations cascade;
drop table if exists public.pockets cascade;
drop table if exists public.learning_rules cascade;
drop table if exists public.categories cascade;
drop table if exists public.month_closures cascade;
drop table if exists public.external_accounts cascade;
drop table if exists public.imported_transactions cascade;
drop table if exists public.profiles cascade;

drop type if exists public.external_account_provider cascade;
drop type if exists public.debt_payment_kind cascade;
drop type if exists public.debt_status cascade;
drop type if exists public.expense_source cascade;
drop type if exists public.pocket_type cascade;

create table public.usuarios (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  cedula text not null unique,
  password text not null,
  nombre text,
  typeuser text not null default 'user' check (typeuser in ('admin', 'user')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.sesiones (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  creada_at timestamptz not null default timezone('utc', now()),
  expira_at timestamptz not null default timezone('utc', now()) + interval '30 days',
  revocada_at timestamptz
);

create table public.configuracion (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references public.usuarios (id) on delete cascade,
  etiqueta_bolsillo_operacion text not null default 'Operacion',
  etiqueta_bolsillo_ahorro text not null default 'Ahorro',
  etiqueta_bolsillo_pagos_fijos text not null default 'Pagos fijos',
  etiqueta_bolsillo_meta text not null default 'Meta o inversion',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  nombre text not null,
  posicion integer not null default 0,
  es_sistema boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id),
  unique (usuario_id, nombre)
);

create table public.reglas_aprendizaje (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  palabra_clave text not null,
  categoria_id uuid not null references public.categorias (id) on delete cascade,
  aciertos integer not null default 1 check (aciertos >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id),
  unique (usuario_id, palabra_clave)
);

create table public.bolsillos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  nombre text not null,
  color text not null default '#0f766e',
  icono text not null default '💼',
  tipo text not null check (tipo in ('daily', 'savings', 'fixed', 'invest')),
  posicion integer not null default 0,
  archivado boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id)
);

create table public.obligaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  titulo text not null,
  monto numeric(14,2) not null check (monto > 0),
  dia_pago integer not null check (dia_pago between 1 and 31),
  dia_confirmacion integer not null check (dia_confirmacion between 1 and 31),
  bolsillo_id uuid not null references public.bolsillos (id) on delete restrict,
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  activa boolean not null default true,
  ultimo_mes_pagado text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id)
);

create table public.ingresos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  bolsillo_id uuid not null references public.bolsillos (id) on delete restrict,
  titulo text not null,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  recurrente boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id)
);

create table public.deudas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  bolsillo_id uuid not null references public.bolsillos (id) on delete restrict,
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  titulo text not null,
  monto_total numeric(14,2) not null check (monto_total > 0),
  monto_pendiente numeric(14,2) not null check (monto_pendiente >= 0),
  monto_cuota numeric(14,2) not null check (monto_cuota > 0),
  dia_pago integer not null check (dia_pago between 1 and 31),
  estado text not null default 'active' check (estado in ('active', 'settled', 'paused')),
  fecha_saldada timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id)
);

create table public.gastos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  bolsillo_id uuid not null references public.bolsillos (id) on delete restrict,
  categoria_id uuid not null references public.categorias (id) on delete restrict,
  obligacion_id uuid references public.obligaciones (id) on delete set null,
  deuda_id uuid references public.deudas (id) on delete set null,
  descripcion text not null,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  origen text not null check (origen in ('manual', 'wallet', 'fixed', 'debt')),
  confianza numeric(4,3) not null default 1 check (confianza between 0 and 1),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id)
);

create table public.transferencias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  bolsillo_origen_id uuid not null references public.bolsillos (id) on delete restrict,
  bolsillo_destino_id uuid not null references public.bolsillos (id) on delete restrict,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  nota text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id),
  check (bolsillo_origen_id <> bolsillo_destino_id)
);

create table public.pagos_obligaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  obligacion_id uuid not null references public.obligaciones (id) on delete cascade,
  gasto_id uuid references public.gastos (id) on delete set null,
  monto numeric(14,2) not null check (monto > 0),
  fecha_pago date not null,
  mes_periodo text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id)
);

create table public.pagos_deudas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  deuda_id uuid not null references public.deudas (id) on delete cascade,
  gasto_id uuid references public.gastos (id) on delete set null,
  monto numeric(14,2) not null check (monto > 0),
  fecha_pago date not null,
  tipo text not null default 'scheduled' check (tipo in ('scheduled', 'extra')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id)
);

create table public.cierres_mensuales (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  mes text not null,
  total_ingresos numeric(14,2) not null default 0,
  total_gastos numeric(14,2) not null default 0,
  flujo_neto numeric(14,2) not null default 0,
  saldo_bolsillos numeric(14,2) not null default 0,
  deuda_pendiente numeric(14,2) not null default 0,
  obligaciones_pendientes numeric(14,2) not null default 0,
  fecha_cierre timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, mes)
);

create index idx_sesiones_usuario on public.sesiones (usuario_id, expira_at) where revocada_at is null;
create index idx_categorias_usuario on public.categorias (usuario_id, posicion, nombre);
create index idx_reglas_aprendizaje_usuario on public.reglas_aprendizaje (usuario_id, palabra_clave);
create index idx_bolsillos_usuario on public.bolsillos (usuario_id, tipo, posicion);
create index idx_obligaciones_usuario on public.obligaciones (usuario_id, activa, dia_pago);
create index idx_ingresos_usuario on public.ingresos (usuario_id, fecha desc);
create index idx_deudas_usuario on public.deudas (usuario_id, estado, dia_pago);
create index idx_gastos_usuario on public.gastos (usuario_id, fecha desc);
create index idx_transferencias_usuario on public.transferencias (usuario_id, fecha desc);
create index idx_pagos_obligaciones_usuario on public.pagos_obligaciones (usuario_id, fecha_pago desc);
create index idx_pagos_deudas_usuario on public.pagos_deudas (usuario_id, fecha_pago desc);
create index idx_cierres_mensuales_usuario on public.cierres_mensuales (usuario_id, mes desc);

drop trigger if exists trg_usuarios_updated_at on public.usuarios;
create trigger trg_usuarios_updated_at before update on public.usuarios for each row execute function public.set_updated_at();

drop trigger if exists trg_configuracion_updated_at on public.configuracion;
create trigger trg_configuracion_updated_at before update on public.configuracion for each row execute function public.set_updated_at();

drop trigger if exists trg_categorias_updated_at on public.categorias;
create trigger trg_categorias_updated_at before update on public.categorias for each row execute function public.set_updated_at();

drop trigger if exists trg_reglas_aprendizaje_updated_at on public.reglas_aprendizaje;
create trigger trg_reglas_aprendizaje_updated_at before update on public.reglas_aprendizaje for each row execute function public.set_updated_at();

drop trigger if exists trg_bolsillos_updated_at on public.bolsillos;
create trigger trg_bolsillos_updated_at before update on public.bolsillos for each row execute function public.set_updated_at();

drop trigger if exists trg_obligaciones_updated_at on public.obligaciones;
create trigger trg_obligaciones_updated_at before update on public.obligaciones for each row execute function public.set_updated_at();

drop trigger if exists trg_ingresos_updated_at on public.ingresos;
create trigger trg_ingresos_updated_at before update on public.ingresos for each row execute function public.set_updated_at();

drop trigger if exists trg_deudas_updated_at on public.deudas;
create trigger trg_deudas_updated_at before update on public.deudas for each row execute function public.set_updated_at();

drop trigger if exists trg_gastos_updated_at on public.gastos;
create trigger trg_gastos_updated_at before update on public.gastos for each row execute function public.set_updated_at();

drop trigger if exists trg_transferencias_updated_at on public.transferencias;
create trigger trg_transferencias_updated_at before update on public.transferencias for each row execute function public.set_updated_at();

create or replace function public.token_sesion_actual()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-app-session', '');
$$;

create or replace function public.hash_token_sesion(p_token text)
returns text
language sql
stable
as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.generar_token_sesion()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function public.usuario_actual_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.usuario_id
  from public.sesiones s
  where s.token_hash = public.hash_token_sesion(public.token_sesion_actual())
    and s.revocada_at is null
    and s.expira_at > timezone('utc', now())
  order by s.creada_at desc
  limit 1;
$$;

create or replace function public.es_admin_actual()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = public.usuario_actual_id()
      and u.typeuser = 'admin'
  );
$$;

create or replace function public.iniciar_sesion_simple(p_username text, p_password text)
returns table (
  token text,
  id uuid,
  username text,
  cedula text,
  nombre text,
  typeuser text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario public.usuarios%rowtype;
  v_token text;
begin
  select *
  into v_usuario
  from public.usuarios
  where public.usuarios.username = p_username;

  if not found or v_usuario.password <> p_password then
    raise exception 'Credenciales invalidas';
  end if;

  v_token := public.generar_token_sesion();

  insert into public.sesiones (token_hash, usuario_id)
  values (public.hash_token_sesion(v_token), v_usuario.id);

  return query
  select v_token, v_usuario.id, v_usuario.username, v_usuario.cedula, v_usuario.nombre, v_usuario.typeuser;
end;
$$;

create or replace function public.registrar_usuario_simple(
  p_username text,
  p_cedula text,
  p_password text,
  p_nombre text default null
)
returns table (
  token text,
  id uuid,
  username text,
  cedula text,
  nombre text,
  typeuser text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario public.usuarios%rowtype;
  v_token text;
begin
  insert into public.usuarios (username, cedula, password, nombre, typeuser)
  values (
    trim(p_username),
    trim(p_cedula),
    p_password,
    coalesce(nullif(trim(coalesce(p_nombre, '')), ''), 'Usuario ' || trim(p_cedula)),
    'user'
  )
  returning * into v_usuario;

  insert into public.configuracion (usuario_id)
  values (v_usuario.id)
  on conflict (usuario_id) do nothing;

  v_token := public.generar_token_sesion();

  insert into public.sesiones (token_hash, usuario_id)
  values (public.hash_token_sesion(v_token), v_usuario.id);

  return query
  select v_token, v_usuario.id, v_usuario.username, v_usuario.cedula, v_usuario.nombre, v_usuario.typeuser;
end;
$$;

create or replace function public.cerrar_sesion_simple()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sesiones
  set revocada_at = timezone('utc', now())
  where token_hash = public.hash_token_sesion(public.token_sesion_actual())
    and revocada_at is null;
end;
$$;

create or replace function public.usuario_actual_simple()
returns table (
  id uuid,
  username text,
  cedula text,
  nombre text,
  typeuser text
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.username, u.cedula, u.nombre, u.typeuser
  from public.usuarios u
  where u.id = public.usuario_actual_id();
$$;

create or replace view public.movimientos
with (security_invoker = true) as
select
  g.usuario_id,
  g.app_id as source_app_id,
  'gasto'::text as tipo_movimiento,
  g.fecha as fecha_movimiento,
  g.descripcion as titulo,
  g.monto,
  g.bolsillo_id as bolsillo_principal_id,
  null::uuid as bolsillo_secundario_id,
  g.origen,
  g.categoria_id
from public.gastos g
union all
select
  i.usuario_id,
  i.app_id,
  'ingreso'::text,
  i.fecha,
  i.titulo,
  i.monto,
  i.bolsillo_id,
  null::uuid,
  case when i.recurrente then 'recurrente' else 'manual' end,
  null::uuid
from public.ingresos i
union all
select
  t.usuario_id,
  t.app_id,
  'transferencia'::text,
  t.fecha,
  coalesce(t.nota, 'Transferencia interna'),
  t.monto,
  t.bolsillo_origen_id,
  t.bolsillo_destino_id,
  'transferencia',
  null::uuid
from public.transferencias t;

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table public.usuarios to anon, authenticated;
grant select, insert, update, delete on table public.configuracion to anon, authenticated;
grant select, insert, update, delete on table public.categorias to anon, authenticated;
grant select, insert, update, delete on table public.reglas_aprendizaje to anon, authenticated;
grant select, insert, update, delete on table public.bolsillos to anon, authenticated;
grant select, insert, update, delete on table public.obligaciones to anon, authenticated;
grant select, insert, update, delete on table public.ingresos to anon, authenticated;
grant select, insert, update, delete on table public.deudas to anon, authenticated;
grant select, insert, update, delete on table public.gastos to anon, authenticated;
grant select, insert, update, delete on table public.transferencias to anon, authenticated;
grant select, insert, update, delete on table public.pagos_obligaciones to anon, authenticated;
grant select, insert, update, delete on table public.pagos_deudas to anon, authenticated;
grant select, insert, update, delete on table public.cierres_mensuales to anon, authenticated;
grant select on table public.movimientos to anon, authenticated;

grant execute on function public.iniciar_sesion_simple(text, text) to anon, authenticated;
grant execute on function public.registrar_usuario_simple(text, text, text, text) to anon, authenticated;
grant execute on function public.cerrar_sesion_simple() to anon, authenticated;
grant execute on function public.usuario_actual_simple() to anon, authenticated;

alter table public.usuarios enable row level security;
alter table public.configuracion enable row level security;
alter table public.categorias enable row level security;
alter table public.reglas_aprendizaje enable row level security;
alter table public.bolsillos enable row level security;
alter table public.obligaciones enable row level security;
alter table public.ingresos enable row level security;
alter table public.deudas enable row level security;
alter table public.gastos enable row level security;
alter table public.transferencias enable row level security;
alter table public.pagos_obligaciones enable row level security;
alter table public.pagos_deudas enable row level security;
alter table public.cierres_mensuales enable row level security;
alter table public.sesiones enable row level security;

create policy usuarios_select_propios_o_admin on public.usuarios
for select
using (id = public.usuario_actual_id() or public.es_admin_actual());

create policy usuarios_insert_admin on public.usuarios
for insert
with check (public.es_admin_actual());

create policy usuarios_update_propios_o_admin on public.usuarios
for update
using (id = public.usuario_actual_id() or public.es_admin_actual())
with check (
  (
    id = public.usuario_actual_id()
    and id = public.usuario_actual_id()
    and typeuser = (select u.typeuser from public.usuarios u where u.id = public.usuario_actual_id())
  )
  or public.es_admin_actual()
);

create policy configuracion_owner_all on public.configuracion
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy categorias_owner_all on public.categorias
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy reglas_aprendizaje_owner_all on public.reglas_aprendizaje
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy bolsillos_owner_all on public.bolsillos
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy obligaciones_owner_all on public.obligaciones
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy ingresos_owner_all on public.ingresos
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy deudas_owner_all on public.deudas
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy gastos_owner_all on public.gastos
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy transferencias_owner_all on public.transferencias
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy pagos_obligaciones_owner_all on public.pagos_obligaciones
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy pagos_deudas_owner_all on public.pagos_deudas
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy cierres_mensuales_owner_all on public.cierres_mensuales
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());

create policy sesiones_sin_acceso_directo on public.sesiones
for all
using (false)
with check (false);
