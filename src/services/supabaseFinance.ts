import type { PersistedEnvelope, RemoteSnapshotDriver } from './persistence'
import { supabase } from './supabaseClient'

const TABLES = {
  settings: 'configuracion',
  categories: 'categorias',
  learningRules: 'reglas_aprendizaje',
  pockets: 'bolsillos',
  obligations: 'obligaciones',
  incomes: 'ingresos',
  debts: 'deudas',
  expenses: 'gastos',
  transfers: 'transferencias',
  obligationPayments: 'pagos_obligaciones',
  debtPayments: 'pagos_deudas',
  monthClosures: 'cierres_mensuales',
} as const

function toNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function hasRelationalData(payload: Record<string, unknown>) {
  return Object.values(payload).some((value) => {
    if (Array.isArray(value)) return value.length > 0
    return Boolean(value)
  })
}

async function deleteRows(table: string, cedula: string) {
  const { error: deleteError } = await supabase!.from(table).delete().eq('user_cedula', cedula)
  if (deleteError) throw deleteError
}

async function insertRows<T extends { user_cedula: string }>(table: string, rows: T[]) {
  if (!rows.length) return

  const { error: insertError } = await supabase!.from(table).insert(rows)
  if (insertError) throw insertError
}

export function createSupabaseFinanceDriver<T>(cedula?: string | null): RemoteSnapshotDriver<T> | null {
  if (!supabase || !cedula) return null
  const client = supabase

  return {
    configured: true,
    profileId: cedula,
    async load() {
      const [
        settingsResult,
        categoriesResult,
        learningRulesResult,
        pocketsResult,
        obligationsResult,
        incomesResult,
        debtsResult,
        expensesResult,
        transfersResult,
        obligationPaymentsResult,
        debtPaymentsResult,
        monthClosuresResult,
      ] = await Promise.all([
        client.from(TABLES.settings).select('*').eq('user_cedula', cedula).maybeSingle(),
        client.from(TABLES.categories).select('*').eq('user_cedula', cedula).order('posicion', { ascending: true }),
        client
          .from(TABLES.learningRules)
          .select('*')
          .eq('user_cedula', cedula)
          .order('aciertos', { ascending: false }),
        client.from(TABLES.pockets).select('*').eq('user_cedula', cedula).order('posicion', { ascending: true }),
        client.from(TABLES.obligations).select('*').eq('user_cedula', cedula).order('created_at', { ascending: false }),
        client.from(TABLES.incomes).select('*').eq('user_cedula', cedula).order('fecha', { ascending: false }),
        client.from(TABLES.debts).select('*').eq('user_cedula', cedula).order('created_at', { ascending: false }),
        client.from(TABLES.expenses).select('*').eq('user_cedula', cedula).order('fecha', { ascending: false }),
        client.from(TABLES.transfers).select('*').eq('user_cedula', cedula).order('fecha', { ascending: false }),
        client
          .from(TABLES.obligationPayments)
          .select('*')
          .eq('user_cedula', cedula)
          .order('fecha_pago', { ascending: false }),
        client
          .from(TABLES.debtPayments)
          .select('*')
          .eq('user_cedula', cedula)
          .order('fecha_pago', { ascending: false }),
        client
          .from(TABLES.monthClosures)
          .select('*')
          .eq('user_cedula', cedula)
          .order('mes', { ascending: false }),
      ])

      const results = [
        settingsResult,
        categoriesResult,
        learningRulesResult,
        pocketsResult,
        obligationsResult,
        incomesResult,
        debtsResult,
        expensesResult,
        transfersResult,
        obligationPaymentsResult,
        debtPaymentsResult,
        monthClosuresResult,
      ]

      const failed = results.find((result) => result.error)
      if (failed?.error) throw failed.error

      const state = {
        pockets: (pocketsResult.data ?? []).map((row) => ({
          id: row.app_id,
          name: row.nombre,
          balance: 0,
          color: row.color,
          icon: row.icono,
          type: row.tipo,
        })),
        expenses: (expensesResult.data ?? []).map((row) => ({
          id: row.app_id,
          description: row.descripcion,
          amount: toNumber(row.monto),
          pocketId: row.bolsillo_id,
          date: row.fecha,
          source: row.origen,
          category: row.nombre_categoria,
          confidence: toNumber(row.confianza),
        })),
        incomes: (incomesResult.data ?? []).map((row) => ({
          id: row.app_id,
          title: row.titulo,
          amount: toNumber(row.monto),
          pocketId: row.bolsillo_id,
          date: row.fecha,
          recurring: Boolean(row.recurrente),
        })),
        transfers: (transfersResult.data ?? []).map((row) => ({
          id: row.app_id,
          fromPocketId: row.bolsillo_origen_id,
          toPocketId: row.bolsillo_destino_id,
          amount: toNumber(row.monto),
          date: row.fecha,
          note: row.nota ?? '',
        })),
        fixedExpenses: (obligationsResult.data ?? []).map((row) => ({
          id: row.app_id,
          title: row.titulo,
          amount: toNumber(row.monto),
          dueDay: row.dia_pago,
          confirmationDay: row.dia_confirmacion,
          pocketId: row.bolsillo_id,
          category: row.nombre_categoria,
          active: Boolean(row.activa),
          lastPaidMonth: row.ultimo_mes_pagado ?? undefined,
        })),
        debts: (debtsResult.data ?? []).map((row) => ({
          id: row.app_id,
          title: row.titulo,
          totalAmount: toNumber(row.monto_total),
          remainingAmount: toNumber(row.monto_pendiente),
          installmentAmount: toNumber(row.monto_cuota),
          dueDay: row.dia_pago,
          pocketId: row.bolsillo_id,
          category: row.nombre_categoria,
          active: row.estado !== 'settled',
        })),
        debtPayments: (debtPaymentsResult.data ?? []).map((row) => ({
          id: row.app_id,
          debtId: row.deuda_id,
          amount: toNumber(row.monto),
          date: row.fecha_pago,
          kind: row.tipo,
        })),
        monthClosures: (monthClosuresResult.data ?? []).map((row) => ({
          monthKey: row.mes,
          closedAt: row.fecha_cierre,
          income: toNumber(row.total_ingresos),
          expense: toNumber(row.total_gastos),
          netFlow: toNumber(row.flujo_neto),
          pocketBalance: toNumber(row.saldo_bolsillos),
          pendingDebt: toNumber(row.deuda_pendiente),
          pendingFixed: toNumber(row.obligaciones_pendientes),
        })),
        learningRules: (learningRulesResult.data ?? []).map((row) => ({
          keyword: row.palabra_clave,
          category: row.nombre_categoria,
          hits: row.aciertos,
        })),
        categories: (categoriesResult.data ?? []).map((row) => row.nombre),
        config: settingsResult.data
          ? {
              pocketTypeLabels: {
                daily: settingsResult.data.pocket_label_daily,
                savings: settingsResult.data.pocket_label_savings,
                fixed: settingsResult.data.pocket_label_fixed,
                invest: settingsResult.data.pocket_label_invest,
              },
            }
          : undefined,
      } satisfies Record<string, unknown>

      if (!hasRelationalData(state)) return null

      const latest = [
        settingsResult.data?.updated_at ?? null,
        ...(pocketsResult.data ?? []).map((row) => row.updated_at ?? row.created_at ?? null),
        ...(incomesResult.data ?? []).map((row) => row.updated_at ?? row.created_at ?? null),
        ...(expensesResult.data ?? []).map((row) => row.updated_at ?? row.created_at ?? null),
        ...(transfersResult.data ?? []).map((row) => row.updated_at ?? row.created_at ?? null),
        ...(obligationsResult.data ?? []).map((row) => row.updated_at ?? row.created_at ?? null),
        ...(debtsResult.data ?? []).map((row) => row.updated_at ?? row.created_at ?? null),
        ...(monthClosuresResult.data ?? []).map((row) => row.fecha_cierre ?? row.created_at ?? null),
      ]
        .filter(Boolean)
        .sort()
        .at(-1)

      return {
        state: state as T,
        updatedAt: latest ?? new Date(0).toISOString(),
      }
    },
    async save(envelope: PersistedEnvelope<T>) {
      const state = envelope.state as Record<string, any>

      const settingsRow = {
        user_cedula: cedula,
        pocket_label_daily: state.config.pocketTypeLabels.daily,
        pocket_label_savings: state.config.pocketTypeLabels.savings,
        pocket_label_fixed: state.config.pocketTypeLabels.fixed,
        pocket_label_invest: state.config.pocketTypeLabels.invest,
        updated_at: envelope.updatedAt,
      }

      const { error: settingsError } = await supabase!
        .from(TABLES.settings)
        .upsert(settingsRow, { onConflict: 'user_cedula' })
      if (settingsError) throw settingsError

      const obligationPaymentRows = (state.fixedExpenses ?? []).flatMap((item: any) =>
        item.lastPaidMonth
          ? [
              {
                user_cedula: cedula,
                app_id: `${item.id}:${item.lastPaidMonth}`,
                obligacion_id: item.id,
                gasto_id: null,
                monto: item.amount,
                fecha_pago: `${item.lastPaidMonth}-01`,
                mes_periodo: item.lastPaidMonth,
                created_at: envelope.updatedAt,
              },
            ]
          : [],
      )
      const debtPaymentRows = (state.debtPayments ?? []).map((item: any) => ({
        user_cedula: cedula,
        app_id: item.id,
        deuda_id: item.debtId,
        gasto_id: null,
        monto: item.amount,
        fecha_pago: item.date,
        tipo: item.kind,
        created_at: envelope.updatedAt,
      }))
      const expenseRows = (state.expenses ?? []).map((item: any) => ({
        user_cedula: cedula,
        app_id: item.id,
        bolsillo_id: item.pocketId,
        nombre_categoria: item.category,
        obligacion_id: null,
        deuda_id: null,
        descripcion: item.description,
        monto: item.amount,
        fecha: item.date,
        origen: item.source,
        confianza: item.confidence,
        updated_at: envelope.updatedAt,
      }))
      const transferRows = (state.transfers ?? []).map((item: any) => ({
        user_cedula: cedula,
        app_id: item.id,
        bolsillo_origen_id: item.fromPocketId,
        bolsillo_destino_id: item.toPocketId,
        monto: item.amount,
        fecha: item.date,
        nota: item.note,
        updated_at: envelope.updatedAt,
      }))
      const incomeRows = (state.incomes ?? []).map((item: any) => ({
        user_cedula: cedula,
        app_id: item.id,
        bolsillo_id: item.pocketId,
        titulo: item.title,
        monto: item.amount,
        fecha: item.date,
        recurrente: item.recurring,
        updated_at: envelope.updatedAt,
      }))
      const obligationRows = (state.fixedExpenses ?? []).map((item: any) => ({
        user_cedula: cedula,
        app_id: item.id,
        titulo: item.title,
        monto: item.amount,
        dia_pago: item.dueDay,
        dia_confirmacion: item.confirmationDay,
        bolsillo_id: item.pocketId,
        nombre_categoria: item.category,
        activa: item.active,
        ultimo_mes_pagado: item.lastPaidMonth ?? null,
        updated_at: envelope.updatedAt,
      }))
      const debtRows = (state.debts ?? []).map((item: any) => ({
        user_cedula: cedula,
        app_id: item.id,
        bolsillo_id: item.pocketId,
        nombre_categoria: item.category,
        titulo: item.title,
        monto_total: item.totalAmount,
        monto_pendiente: item.remainingAmount,
        monto_cuota: item.installmentAmount,
        dia_pago: item.dueDay,
        estado: item.remainingAmount <= 0 ? 'settled' : item.active ? 'active' : 'paused',
        fecha_saldada: item.remainingAmount <= 0 ? envelope.updatedAt : null,
        updated_at: envelope.updatedAt,
      }))
      const learningRuleRows = (state.learningRules ?? []).map((item: any, index: number) => ({
        user_cedula: cedula,
        app_id: `${item.keyword}:${index}`,
        palabra_clave: item.keyword,
        nombre_categoria: item.category,
        aciertos: item.hits,
        updated_at: envelope.updatedAt,
      }))
      const categoryRows = (state.categories ?? []).map((item: any, index: number) => ({
        user_cedula: cedula,
        app_id: `category:${index}:${String(item).toLowerCase()}`,
        nombre: item,
        posicion: index,
        updated_at: envelope.updatedAt,
      }))
      const monthClosureRows = (state.monthClosures ?? []).map((item: any) => ({
        user_cedula: cedula,
        mes: item.monthKey,
        fecha_cierre: item.closedAt,
        total_ingresos: item.income,
        total_gastos: item.expense,
        flujo_neto: item.netFlow,
        saldo_bolsillos: item.pocketBalance,
        deuda_pendiente: item.pendingDebt,
        obligaciones_pendientes: item.pendingFixed,
        created_at: envelope.updatedAt,
      }))
      const pocketRows = (state.pockets ?? []).map((item: any, index: number) => ({
        user_cedula: cedula,
        app_id: item.id,
        nombre: item.name,
        color: item.color,
        icono: item.icon,
        tipo: item.type,
        posicion: index,
        updated_at: envelope.updatedAt,
      }))

      await deleteRows(TABLES.obligationPayments, cedula)
      await deleteRows(TABLES.debtPayments, cedula)
      await deleteRows(TABLES.expenses, cedula)
      await deleteRows(TABLES.transfers, cedula)
      await deleteRows(TABLES.incomes, cedula)
      await deleteRows(TABLES.obligations, cedula)
      await deleteRows(TABLES.debts, cedula)
      await deleteRows(TABLES.learningRules, cedula)
      await deleteRows(TABLES.categories, cedula)
      await deleteRows(TABLES.monthClosures, cedula)
      await deleteRows(TABLES.pockets, cedula)

      await insertRows(TABLES.pockets, pocketRows)
      await insertRows(TABLES.categories, categoryRows)
      await insertRows(TABLES.learningRules, learningRuleRows)
      await insertRows(TABLES.incomes, incomeRows)
      await insertRows(TABLES.obligations, obligationRows)
      await insertRows(TABLES.debts, debtRows)
      await insertRows(TABLES.expenses, expenseRows)
      await insertRows(TABLES.transfers, transferRows)
      await insertRows(TABLES.obligationPayments, obligationPaymentRows)
      await insertRows(TABLES.debtPayments, debtPaymentRows)
      await insertRows(TABLES.monthClosures, monthClosureRows)
    },
  }
}
