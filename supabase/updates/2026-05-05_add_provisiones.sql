-- Tabla de provisiones mensuales (metas de ahorro por bolsillo)
create table if not exists public.provisiones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  app_id text not null,
  nombre text not null,
  bolsillo_id uuid not null references public.bolsillos (id) on delete restrict,
  monto_mensual numeric(14,2) not null check (monto_mensual > 0),
  activa boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (usuario_id, app_id)
);

create index if not exists idx_provisiones_usuario on public.provisiones (usuario_id, activa);

drop trigger if exists trg_provisiones_updated_at on public.provisiones;
create trigger trg_provisiones_updated_at
  before update on public.provisiones
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.provisiones to anon, authenticated;

alter table public.provisiones enable row level security;

create policy provisiones_owner_all on public.provisiones
for all
using (usuario_id = public.usuario_actual_id() or public.es_admin_actual())
with check (usuario_id = public.usuario_actual_id() or public.es_admin_actual());
