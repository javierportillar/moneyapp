-- Adds `hora` (HH:MM) to movimientos base tables and exposes it in the `movimientos` view.
-- Safe to run on an existing database without dropping data.

alter table public.ingresos add column if not exists hora text;
alter table public.gastos add column if not exists hora text;
alter table public.transferencias add column if not exists hora text;

alter table public.ingresos alter column hora set default '00:00';
alter table public.gastos alter column hora set default '00:00';
alter table public.transferencias alter column hora set default '00:00';

update public.ingresos set hora = coalesce(hora, '00:00') where hora is null;
update public.gastos set hora = coalesce(hora, '00:00') where hora is null;
update public.transferencias set hora = coalesce(hora, '00:00') where hora is null;

alter table public.ingresos alter column hora set not null;
alter table public.gastos alter column hora set not null;
alter table public.transferencias alter column hora set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ingresos_hora_hhmm') then
    alter table public.ingresos
      add constraint ingresos_hora_hhmm
      check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'gastos_hora_hhmm') then
    alter table public.gastos
      add constraint gastos_hora_hhmm
      check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'transferencias_hora_hhmm') then
    alter table public.transferencias
      add constraint transferencias_hora_hhmm
      check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end
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
  g.categoria_id,
  g.hora as hora_movimiento
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
  null::uuid,
  i.hora
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
  null::uuid,
  t.hora
from public.transferencias t;

grant select on table public.movimientos to anon, authenticated;
