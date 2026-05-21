-- Agrega bandera de gravamen 4x1000 a los bolsillos.
-- Cuando está en true, todo gasto/transferencia saliente desde ese bolsillo
-- generará automáticamente un gasto adicional de 0.4% por concepto del impuesto.

ALTER TABLE public.bolsillos
  ADD COLUMN IF NOT EXISTS cobra_4x1000 boolean NOT NULL DEFAULT false;
