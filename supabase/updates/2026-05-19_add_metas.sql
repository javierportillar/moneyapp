-- Tabla de metas de ahorro (término fijo o indefinido)
create table if not exists public.metas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  nombre text not null,
  tipo text not null check (tipo in ('fixed-term', 'indefinite')),
  bolsillo_id uuid not null references public.bolsillos (id) on delete restrict,
  monto_objetivo numeric(14,2) not null check (monto_objetivo > 0),
  fecha_objetivo date,
  fecha_inicio date not null default current_date,
  icono text not null default '🎯',
  color text not null default '#7c3aed',
  descripcion text,
  activa boolean not null default true,
  fecha_completada timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id),
  -- Las metas de término fijo deben tener fecha objetivo
  check (
    (tipo = 'indefinite' and fecha_objetivo is null)
    or (tipo = 'fixed-term' and fecha_objetivo is not null and fecha_objetivo >= fecha_inicio)
  )
);

create index if not exists idx_metas_usuario on public.metas (usuario_id, activa, tipo);
create index if not exists idx_metas_bolsillo on public.metas (bolsillo_id);

drop trigger if exists trg_metas_updated_at on public.metas;
create trigger trg_metas_updated_at
  before update on public.metas
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.metas to anon, authenticated;

alter table public.metas enable row level security;

create policy metas_owner_all on public.metas
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());
