-- Vincula los gastos de 4x1000 al gasto o transferencia que los originó.
-- Cuando el gasto/transferencia padre se borra, el 4x1000 hijo también se borra.
--
-- Guardamos el app_id (no el uuid de la BD) para mantener consistencia con el
-- resto del modelo y para que el cliente pueda mapear sin queries adicionales.

ALTER TABLE public.gastos
  ADD COLUMN IF NOT EXISTS gasto_padre_app_id text,
  ADD COLUMN IF NOT EXISTS transferencia_padre_app_id text;

CREATE INDEX IF NOT EXISTS idx_gastos_padre_gasto
  ON public.gastos (usuario_id, gasto_padre_app_id)
  WHERE gasto_padre_app_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gastos_padre_transferencia
  ON public.gastos (usuario_id, transferencia_padre_app_id)
  WHERE transferencia_padre_app_id IS NOT NULL;
