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
drop view if exists public.movement_feed cascade;
drop view if exists public.users cascade;

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

create table if not exists public.usuarios (
  cedula text primary key,
  username text not null unique,
  password text not null,
  nombre text,
  typeuser text not null default 'user' check (typeuser in ('admin', 'user')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_usuarios_updated_at on public.usuarios;
create trigger trg_usuarios_updated_at
before update on public.usuarios
for each row execute function public.set_updated_at();

create table if not exists public.configuracion (
  user_cedula text primary key references public.usuarios (cedula) on delete cascade,
  pocket_label_daily text not null default 'Operacion',
  pocket_label_savings text not null default 'Ahorro',
  pocket_label_fixed text not null default 'Pagos fijos',
  pocket_label_invest text not null default 'Meta o inversion',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.categorias (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  nombre text not null,
  posicion integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id)
);

create table if not exists public.reglas_aprendizaje (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  palabra_clave text not null,
  nombre_categoria text not null,
  aciertos integer not null default 1 check (aciertos >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id)
);

create table if not exists public.bolsillos (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  nombre text not null,
  color text not null default '#0f766e',
  icono text not null default '💼',
  tipo text not null check (tipo in ('daily', 'savings', 'fixed', 'invest')),
  posicion integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id)
);

create table if not exists public.obligaciones (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  titulo text not null,
  monto numeric(14,2) not null check (monto > 0),
  dia_pago integer not null check (dia_pago between 1 and 31),
  dia_confirmacion integer not null check (dia_confirmacion between 1 and 31),
  bolsillo_id text not null,
  nombre_categoria text not null,
  activa boolean not null default true,
  ultimo_mes_pagado text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id),
  foreign key (user_cedula, bolsillo_id) references public.bolsillos (user_cedula, app_id) on delete restrict
);

create table if not exists public.ingresos (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  bolsillo_id text not null,
  titulo text not null,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  recurrente boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id),
  foreign key (user_cedula, bolsillo_id) references public.bolsillos (user_cedula, app_id) on delete restrict
);

create table if not exists public.deudas (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  bolsillo_id text not null,
  nombre_categoria text not null,
  titulo text not null,
  monto_total numeric(14,2) not null check (monto_total > 0),
  monto_pendiente numeric(14,2) not null check (monto_pendiente >= 0),
  monto_cuota numeric(14,2) not null check (monto_cuota > 0),
  dia_pago integer not null check (dia_pago between 1 and 31),
  estado text not null default 'active' check (estado in ('active', 'settled', 'paused')),
  fecha_saldada timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id),
  foreign key (user_cedula, bolsillo_id) references public.bolsillos (user_cedula, app_id) on delete restrict
);

create table if not exists public.gastos (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  bolsillo_id text not null,
  nombre_categoria text not null,
  obligacion_id text,
  deuda_id text,
  descripcion text not null,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  origen text not null check (origen in ('manual', 'wallet', 'fixed', 'debt')),
  confianza numeric(4,3) not null default 1 check (confianza between 0 and 1),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id),
  foreign key (user_cedula, bolsillo_id) references public.bolsillos (user_cedula, app_id) on delete restrict,
  foreign key (user_cedula, obligacion_id) references public.obligaciones (user_cedula, app_id) on delete set null,
  foreign key (user_cedula, deuda_id) references public.deudas (user_cedula, app_id) on delete set null
);

create table if not exists public.transferencias (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  bolsillo_origen_id text not null,
  bolsillo_destino_id text not null,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  nota text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id),
  foreign key (user_cedula, bolsillo_origen_id) references public.bolsillos (user_cedula, app_id) on delete restrict,
  foreign key (user_cedula, bolsillo_destino_id) references public.bolsillos (user_cedula, app_id) on delete restrict,
  check (bolsillo_origen_id <> bolsillo_destino_id)
);

create table if not exists public.pagos_obligaciones (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  obligacion_id text not null,
  gasto_id text,
  monto numeric(14,2) not null check (monto > 0),
  fecha_pago date not null,
  mes_periodo text not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id),
  foreign key (user_cedula, obligacion_id) references public.obligaciones (user_cedula, app_id) on delete cascade,
  foreign key (user_cedula, gasto_id) references public.gastos (user_cedula, app_id) on delete set null
);

create table if not exists public.pagos_deudas (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  app_id text not null,
  deuda_id text not null,
  gasto_id text,
  monto numeric(14,2) not null check (monto > 0),
  fecha_pago date not null,
  tipo text not null default 'scheduled' check (tipo in ('scheduled', 'extra')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, app_id),
  foreign key (user_cedula, deuda_id) references public.deudas (user_cedula, app_id) on delete cascade,
  foreign key (user_cedula, gasto_id) references public.gastos (user_cedula, app_id) on delete set null
);

create table if not exists public.cierres_mensuales (
  user_cedula text not null references public.usuarios (cedula) on delete cascade,
  mes text not null,
  total_ingresos numeric(14,2) not null default 0,
  total_gastos numeric(14,2) not null default 0,
  flujo_neto numeric(14,2) not null default 0,
  saldo_bolsillos numeric(14,2) not null default 0,
  deuda_pendiente numeric(14,2) not null default 0,
  obligaciones_pendientes numeric(14,2) not null default 0,
  fecha_cierre timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_cedula, mes)
);

create index if not exists idx_categorias_user on public.categorias (user_cedula, posicion, nombre);
create index if not exists idx_reglas_aprendizaje_user on public.reglas_aprendizaje (user_cedula, palabra_clave);
create index if not exists idx_bolsillos_user on public.bolsillos (user_cedula, tipo, posicion);
create index if not exists idx_obligaciones_user on public.obligaciones (user_cedula, activa, dia_pago);
create index if not exists idx_ingresos_user on public.ingresos (user_cedula, fecha desc);
create index if not exists idx_deudas_user on public.deudas (user_cedula, estado, dia_pago);
create index if not exists idx_gastos_user on public.gastos (user_cedula, fecha desc);
create index if not exists idx_transferencias_user on public.transferencias (user_cedula, fecha desc);
create index if not exists idx_pagos_obligaciones_user on public.pagos_obligaciones (user_cedula, fecha_pago desc);
create index if not exists idx_pagos_deudas_user on public.pagos_deudas (user_cedula, fecha_pago desc);
create index if not exists idx_cierres_mensuales_user on public.cierres_mensuales (user_cedula, mes desc);

drop trigger if exists trg_configuracion_updated_at on public.configuracion;
create trigger trg_configuracion_updated_at
before update on public.configuracion
for each row execute function public.set_updated_at();

drop trigger if exists trg_categorias_updated_at on public.categorias;
create trigger trg_categorias_updated_at
before update on public.categorias
for each row execute function public.set_updated_at();

drop trigger if exists trg_reglas_aprendizaje_updated_at on public.reglas_aprendizaje;
create trigger trg_reglas_aprendizaje_updated_at
before update on public.reglas_aprendizaje
for each row execute function public.set_updated_at();

drop trigger if exists trg_bolsillos_updated_at on public.bolsillos;
create trigger trg_bolsillos_updated_at
before update on public.bolsillos
for each row execute function public.set_updated_at();

drop trigger if exists trg_obligaciones_updated_at on public.obligaciones;
create trigger trg_obligaciones_updated_at
before update on public.obligaciones
for each row execute function public.set_updated_at();

drop trigger if exists trg_ingresos_updated_at on public.ingresos;
create trigger trg_ingresos_updated_at
before update on public.ingresos
for each row execute function public.set_updated_at();

drop trigger if exists trg_deudas_updated_at on public.deudas;
create trigger trg_deudas_updated_at
before update on public.deudas
for each row execute function public.set_updated_at();

drop trigger if exists trg_gastos_updated_at on public.gastos;
create trigger trg_gastos_updated_at
before update on public.gastos
for each row execute function public.set_updated_at();

drop trigger if exists trg_transferencias_updated_at on public.transferencias;
create trigger trg_transferencias_updated_at
before update on public.transferencias
for each row execute function public.set_updated_at();

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

drop policy if exists "usuarios_public_all" on public.usuarios;
create policy "usuarios_public_all" on public.usuarios for all using (true) with check (true);

drop policy if exists "configuracion_public_all" on public.configuracion;
create policy "configuracion_public_all" on public.configuracion for all using (true) with check (true);

drop policy if exists "categorias_public_all" on public.categorias;
create policy "categorias_public_all" on public.categorias for all using (true) with check (true);

drop policy if exists "reglas_aprendizaje_public_all" on public.reglas_aprendizaje;
create policy "reglas_aprendizaje_public_all" on public.reglas_aprendizaje for all using (true) with check (true);

drop policy if exists "bolsillos_public_all" on public.bolsillos;
create policy "bolsillos_public_all" on public.bolsillos for all using (true) with check (true);

drop policy if exists "obligaciones_public_all" on public.obligaciones;
create policy "obligaciones_public_all" on public.obligaciones for all using (true) with check (true);

drop policy if exists "ingresos_public_all" on public.ingresos;
create policy "ingresos_public_all" on public.ingresos for all using (true) with check (true);

drop policy if exists "deudas_public_all" on public.deudas;
create policy "deudas_public_all" on public.deudas for all using (true) with check (true);

drop policy if exists "gastos_public_all" on public.gastos;
create policy "gastos_public_all" on public.gastos for all using (true) with check (true);

drop policy if exists "transferencias_public_all" on public.transferencias;
create policy "transferencias_public_all" on public.transferencias for all using (true) with check (true);

drop policy if exists "pagos_obligaciones_public_all" on public.pagos_obligaciones;
create policy "pagos_obligaciones_public_all" on public.pagos_obligaciones for all using (true) with check (true);

drop policy if exists "pagos_deudas_public_all" on public.pagos_deudas;
create policy "pagos_deudas_public_all" on public.pagos_deudas for all using (true) with check (true);

drop policy if exists "cierres_mensuales_public_all" on public.cierres_mensuales;
create policy "cierres_mensuales_public_all" on public.cierres_mensuales for all using (true) with check (true);

create or replace view public.movimientos as
select
  g.user_cedula,
  g.app_id as source_id,
  'gasto'::text as tipo_movimiento,
  g.fecha as fecha_movimiento,
  g.descripcion as titulo,
  g.monto,
  g.bolsillo_id as bolsillo_principal_id,
  null::text as bolsillo_secundario_id,
  g.origen as origen,
  g.nombre_categoria
from public.gastos g
union all
select
  i.user_cedula,
  i.app_id,
  'ingreso'::text,
  i.fecha,
  i.titulo,
  i.monto,
  i.bolsillo_id,
  null::text,
  case when i.recurrente then 'recurrente' else 'manual' end,
  null::text
from public.ingresos i
union all
select
  t.user_cedula,
  t.app_id,
  'transferencia'::text,
  t.fecha,
  coalesce(t.nota, 'Transferencia interna'),
  t.monto,
  t.bolsillo_origen_id,
  t.bolsillo_destino_id,
  'transferencia',
  null::text
from public.transferencias t;
