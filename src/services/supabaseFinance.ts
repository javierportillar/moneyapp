import type {
  AppState,
  Category,
  Debt,
  DebtPayment,
  Expense,
  FixedExpense,
  Income,
  LearningRule,
  MonthClosure,
  Pocket,
  PocketType,
  Transfer,
} from '../domain/finance/types'
import type { PersistedEnvelope, RemoteSnapshotDriver } from './persistence'
import { getSupabaseClient } from './supabaseClient'

const TABLES = {
  users: 'usuarios',
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

function normalizeTimeFromDb(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) return trimmed.slice(0, 5)
  return undefined
}

function extractLocalTimeHHmm(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function hasRelationalData(state: Partial<AppState>) {
  return (
    Boolean(state.config) ||
    (state.categories?.length ?? 0) > 0 ||
    (state.pockets?.length ?? 0) > 0 ||
    (state.incomes?.length ?? 0) > 0 ||
    (state.expenses?.length ?? 0) > 0 ||
    (state.transfers?.length ?? 0) > 0 ||
    (state.fixedExpenses?.length ?? 0) > 0 ||
    (state.debts?.length ?? 0) > 0 ||
    (state.debtPayments?.length ?? 0) > 0 ||
    (state.monthClosures?.length ?? 0) > 0
  )
}

async function fetchExistingAppIds(table: string, usuarioId: string) {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase no esta configurado.')
  const { data, error } = await client.from(table).select('id, app_id').eq('usuario_id', usuarioId)
  if (error) throw error
  return new Map<string, string>((data ?? []).map((row: any) => [row.app_id, row.id]))
}

async function fetchExistingMonthClosures(usuarioId: string) {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase no esta configurado.')
  const { data, error } = await client.from(TABLES.monthClosures).select('id, mes').eq('usuario_id', usuarioId)
  if (error) throw error
  return new Map<string, string>((data ?? []).map((row: any) => [row.mes, row.id]))
}

async function upsertRows(table: string, rows: any[], onConflict: string) {
  if (!rows.length) return
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase no esta configurado.')
  const { error } = await client.from(table).upsert(rows, { onConflict })
  if (!error) return

  throw error
}

function omitColumns<T extends Record<string, any>>(rows: T[], columns: string[]) {
  return rows.map((row) => {
    const copy = { ...row }
    columns.forEach((column) => {
      delete copy[column]
    })
    return copy
  })
}

async function upsertRowsWithFallback(
  table: string,
  rows: any[],
  onConflict: string,
  fallbackColumns: string[],
) {
  if (!rows.length) return
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase no esta configurado.')

  const { error } = await client.from(table).upsert(rows, { onConflict })
  if (!error) return

  const message = String((error as any)?.message ?? '')
  const shouldRetry = fallbackColumns.some(
    (column) =>
      message.includes(column) &&
      (message.includes('schema cache') || message.includes('Could not find') || message.includes('does not exist')),
  )

  if (!shouldRetry) throw error

  const strippedRows = omitColumns(rows, fallbackColumns)
  const { error: retryError } = await client.from(table).upsert(strippedRows, { onConflict })
  if (retryError) throw retryError
}

async function deleteRowsByAppId(table: string, usuarioId: string, keepAppIds: string[]) {
  const existing = await fetchExistingAppIds(table, usuarioId)
  const idsToDelete = [...existing.entries()]
    .filter(([appId]) => !keepAppIds.includes(appId))
    .map(([, id]) => id)

  if (!idsToDelete.length) return

  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase no esta configurado.')
  const { error } = await client.from(table).delete().in('id', idsToDelete)
  if (error) throw error
}

async function deleteMonthClosures(usuarioId: string, keepMonthKeys: string[]) {
  const existing = await fetchExistingMonthClosures(usuarioId)
  const idsToDelete = [...existing.entries()]
    .filter(([monthKey]) => !keepMonthKeys.includes(monthKey))
    .map(([, id]) => id)

  if (!idsToDelete.length) return

  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase no esta configurado.')
  const { error } = await client.from(TABLES.monthClosures).delete().in('id', idsToDelete)
  if (error) throw error
}

export function createSupabaseFinanceDriver<T>(usuarioId?: string | null): RemoteSnapshotDriver<T> | null {
  const client = getSupabaseClient()
  if (!client || !usuarioId) return null

  return {
    configured: true,
    profileId: usuarioId,
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
        debtPaymentsResult,
        monthClosuresResult,
      ] = await Promise.all([
        client.from(TABLES.settings).select('*').eq('usuario_id', usuarioId).maybeSingle(),
        client.from(TABLES.categories).select('*').eq('usuario_id', usuarioId).order('posicion', { ascending: true }),
        client
          .from(TABLES.learningRules)
          .select('*')
          .eq('usuario_id', usuarioId)
          .order('aciertos', { ascending: false }),
        client.from(TABLES.pockets).select('*').eq('usuario_id', usuarioId).order('posicion', { ascending: true }),
        client.from(TABLES.obligations).select('*').eq('usuario_id', usuarioId).order('created_at', { ascending: false }),
        client.from(TABLES.incomes).select('*').eq('usuario_id', usuarioId).order('fecha', { ascending: false }),
        client.from(TABLES.debts).select('*').eq('usuario_id', usuarioId).order('created_at', { ascending: false }),
        client.from(TABLES.expenses).select('*').eq('usuario_id', usuarioId).order('fecha', { ascending: false }),
        client.from(TABLES.transfers).select('*').eq('usuario_id', usuarioId).order('fecha', { ascending: false }),
        client.from(TABLES.debtPayments).select('*').eq('usuario_id', usuarioId).order('fecha_pago', { ascending: false }),
        client.from(TABLES.monthClosures).select('*').eq('usuario_id', usuarioId).order('mes', { ascending: false }),
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
        debtPaymentsResult,
        monthClosuresResult,
      ]

      const failed = results.find((result) => result.error)
      if (failed?.error) throw failed.error

      const categoryIdToName = new Map<string, Category>(
        (categoriesResult.data ?? []).map((row: any) => [row.id, row.nombre as Category]),
      )
      const pocketIdToAppId = new Map<string, string>(
        (pocketsResult.data ?? []).map((row: any) => [row.id, row.app_id]),
      )
      const debtIdToAppId = new Map<string, string>(
        (debtsResult.data ?? []).map((row: any) => [row.id, row.app_id]),
      )

      const pockets: Pocket[] = (pocketsResult.data ?? []).map((row: any) => ({
        id: row.app_id,
        name: row.nombre,
        balance: 0,
        color: row.color,
        icon: row.icono,
        type: row.tipo as PocketType,
      }))

      const expenses: Expense[] = (expensesResult.data ?? []).map((row: any) => ({
        id: row.app_id,
        description: row.descripcion,
        amount: toNumber(row.monto),
        pocketId: pocketIdToAppId.get(row.bolsillo_id) ?? '',
        date: row.fecha,
        time: normalizeTimeFromDb(row.hora) ?? extractLocalTimeHHmm(row.created_at),
        source: row.origen,
        category: categoryIdToName.get(row.categoria_id) ?? 'Otros',
        confidence: toNumber(row.confianza),
      }))

      const incomes: Income[] = (incomesResult.data ?? []).map((row: any) => ({
        id: row.app_id,
        title: row.titulo,
        amount: toNumber(row.monto),
        pocketId: pocketIdToAppId.get(row.bolsillo_id) ?? '',
        date: row.fecha,
        time: normalizeTimeFromDb(row.hora) ?? extractLocalTimeHHmm(row.created_at),
        recurring: Boolean(row.recurrente),
      }))

      const transfers: Transfer[] = (transfersResult.data ?? []).map((row: any) => ({
        id: row.app_id,
        fromPocketId: pocketIdToAppId.get(row.bolsillo_origen_id) ?? '',
        toPocketId: pocketIdToAppId.get(row.bolsillo_destino_id) ?? '',
        amount: toNumber(row.monto),
        date: row.fecha,
        time: normalizeTimeFromDb(row.hora) ?? extractLocalTimeHHmm(row.created_at),
        note: row.nota ?? '',
      }))

      const fixedExpenses: FixedExpense[] = (obligationsResult.data ?? []).map((row: any) => ({
        id: row.app_id,
        title: row.titulo,
        amount: toNumber(row.monto),
        dueDay: row.dia_pago,
        confirmationDay: row.dia_confirmacion,
        pocketId: pocketIdToAppId.get(row.bolsillo_id) ?? '',
        category: categoryIdToName.get(row.categoria_id) ?? 'Otros',
        active: Boolean(row.activa),
        lastPaidMonth: row.ultimo_mes_pagado ?? undefined,
      }))

      const debts: Debt[] = (debtsResult.data ?? []).map((row: any) => ({
        id: row.app_id,
        title: row.titulo,
        totalAmount: toNumber(row.monto_total),
        remainingAmount: toNumber(row.monto_pendiente),
        installmentAmount: toNumber(row.monto_cuota),
        dueDay: row.dia_pago,
        pocketId: pocketIdToAppId.get(row.bolsillo_id) ?? '',
        category: categoryIdToName.get(row.categoria_id) ?? 'Otros',
        active: row.estado !== 'settled',
      }))

      const debtPayments: DebtPayment[] = (debtPaymentsResult.data ?? []).map((row: any) => ({
        id: row.app_id,
        debtId: debtIdToAppId.get(row.deuda_id) ?? '',
        amount: toNumber(row.monto),
        date: row.fecha_pago,
        kind: row.tipo,
      }))

      const monthClosures: MonthClosure[] = (monthClosuresResult.data ?? []).map((row: any) => ({
        monthKey: row.mes,
        closedAt: row.fecha_cierre,
        income: toNumber(row.total_ingresos),
        expense: toNumber(row.total_gastos),
        netFlow: toNumber(row.flujo_neto),
        pocketBalance: toNumber(row.saldo_bolsillos),
        pendingDebt: toNumber(row.deuda_pendiente),
        pendingFixed: toNumber(row.obligaciones_pendientes),
      }))

      const learningRules: LearningRule[] = (learningRulesResult.data ?? []).map((row: any) => ({
        keyword: row.palabra_clave,
        category: categoryIdToName.get(row.categoria_id) ?? 'Otros',
        hits: row.aciertos,
      }))

      const categories = (categoriesResult.data ?? []).map((row: any) => row.nombre as Category)

      const state: Partial<AppState> = {
        pockets,
        expenses,
        incomes,
        transfers,
        fixedExpenses,
        debts,
        debtPayments,
        monthClosures,
        learningRules,
        categories,
        config: settingsResult.data
          ? {
              pocketTypeLabels: {
                daily: settingsResult.data.etiqueta_bolsillo_operacion,
                savings: settingsResult.data.etiqueta_bolsillo_ahorro,
                fixed: settingsResult.data.etiqueta_bolsillo_pagos_fijos,
                invest: settingsResult.data.etiqueta_bolsillo_meta,
              },
            }
          : undefined,
      }

      if (!hasRelationalData(state)) return null

      const latest = [
        settingsResult.data?.updated_at ?? null,
        ...(pocketsResult.data ?? []).map((row: any) => row.updated_at ?? row.created_at ?? null),
        ...(incomesResult.data ?? []).map((row: any) => row.updated_at ?? row.created_at ?? null),
        ...(expensesResult.data ?? []).map((row: any) => row.updated_at ?? row.created_at ?? null),
        ...(transfersResult.data ?? []).map((row: any) => row.updated_at ?? row.created_at ?? null),
        ...(obligationsResult.data ?? []).map((row: any) => row.updated_at ?? row.created_at ?? null),
        ...(debtsResult.data ?? []).map((row: any) => row.updated_at ?? row.created_at ?? null),
        ...(monthClosuresResult.data ?? []).map((row: any) => row.fecha_cierre ?? row.created_at ?? null),
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
      const state = envelope.state as AppState

      const [
        existingCategories,
        existingPockets,
        existingObligations,
        existingDebts,
        existingExpenses,
        existingTransfers,
        existingIncomes,
        existingLearningRules,
        existingDebtPayments,
        existingObligationPayments,
        existingMonthClosures,
      ] = await Promise.all([
        fetchExistingAppIds(TABLES.categories, usuarioId),
        fetchExistingAppIds(TABLES.pockets, usuarioId),
        fetchExistingAppIds(TABLES.obligations, usuarioId),
        fetchExistingAppIds(TABLES.debts, usuarioId),
        fetchExistingAppIds(TABLES.expenses, usuarioId),
        fetchExistingAppIds(TABLES.transfers, usuarioId),
        fetchExistingAppIds(TABLES.incomes, usuarioId),
        fetchExistingAppIds(TABLES.learningRules, usuarioId),
        fetchExistingAppIds(TABLES.debtPayments, usuarioId),
        fetchExistingAppIds(TABLES.obligationPayments, usuarioId),
        fetchExistingMonthClosures(usuarioId),
      ])

      const categoryRows = state.categories.map((nombre, index) => ({
        id: existingCategories.get(`category:${index}:${String(nombre).toLowerCase()}`) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: `category:${index}:${String(nombre).toLowerCase()}`,
        nombre,
        posicion: index,
        updated_at: envelope.updatedAt,
      }))
      const categoryNameToId = new Map<string, string>(categoryRows.map((row) => [row.nombre, row.id]))

      const pocketRows = state.pockets.map((item, index) => ({
        id: existingPockets.get(item.id) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: item.id,
        nombre: item.name,
        color: item.color,
        icono: item.icon,
        tipo: item.type,
        posicion: index,
        updated_at: envelope.updatedAt,
      }))
      const pocketAppIdToId = new Map<string, string>(pocketRows.map((row) => [row.app_id, row.id]))

      const obligationRows = state.fixedExpenses.map((item) => ({
        id: existingObligations.get(item.id) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: item.id,
        titulo: item.title,
        monto: item.amount,
        dia_pago: item.dueDay,
        dia_confirmacion: item.confirmationDay,
        bolsillo_id: pocketAppIdToId.get(item.pocketId) ?? null,
        categoria_id: categoryNameToId.get(item.category) ?? categoryNameToId.get('Otros') ?? null,
        activa: item.active,
        ultimo_mes_pagado: item.lastPaidMonth ?? null,
        updated_at: envelope.updatedAt,
      }))
      const obligationAppIdToId = new Map<string, string>(obligationRows.map((row) => [row.app_id, row.id]))

      const debtRows = state.debts.map((item) => ({
        id: existingDebts.get(item.id) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: item.id,
        bolsillo_id: pocketAppIdToId.get(item.pocketId) ?? null,
        categoria_id: categoryNameToId.get(item.category) ?? categoryNameToId.get('Otros') ?? null,
        titulo: item.title,
        monto_total: item.totalAmount,
        monto_pendiente: item.remainingAmount,
        monto_cuota: item.installmentAmount,
        dia_pago: item.dueDay,
        estado: item.remainingAmount <= 0 ? 'settled' : item.active ? 'active' : 'paused',
        fecha_saldada: item.remainingAmount <= 0 ? envelope.updatedAt : null,
        updated_at: envelope.updatedAt,
      }))
      const debtAppIdToId = new Map<string, string>(debtRows.map((row) => [row.app_id, row.id]))

      const expenseRows = state.expenses.map((item) => ({
        id: existingExpenses.get(item.id) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: item.id,
        bolsillo_id: pocketAppIdToId.get(item.pocketId) ?? null,
        categoria_id: categoryNameToId.get(item.category) ?? categoryNameToId.get('Otros') ?? null,
        obligacion_id:
          item.source === 'fixed'
            ? obligationRows.find((candidate) => candidate.titulo === item.description)?.id ?? null
            : null,
        deuda_id:
          item.source === 'debt'
            ? debtRows.find((candidate) => item.description.includes(candidate.titulo))?.id ?? null
            : null,
        descripcion: item.description,
        monto: item.amount,
        fecha: item.date,
        hora: normalizeTimeFromDb(item.time) ?? '00:00',
        origen: item.source,
        confianza: item.confidence,
        updated_at: envelope.updatedAt,
      }))
      const transferRows = state.transfers.map((item) => ({
        id: existingTransfers.get(item.id) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: item.id,
        bolsillo_origen_id: pocketAppIdToId.get(item.fromPocketId) ?? null,
        bolsillo_destino_id: pocketAppIdToId.get(item.toPocketId) ?? null,
        monto: item.amount,
        fecha: item.date,
        hora: normalizeTimeFromDb(item.time) ?? '00:00',
        nota: item.note,
        updated_at: envelope.updatedAt,
      }))

      const incomeRows = state.incomes.map((item) => ({
        id: existingIncomes.get(item.id) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: item.id,
        bolsillo_id: pocketAppIdToId.get(item.pocketId) ?? null,
        titulo: item.title,
        monto: item.amount,
        fecha: item.date,
        hora: normalizeTimeFromDb(item.time) ?? '00:00',
        recurrente: item.recurring,
        updated_at: envelope.updatedAt,
      }))

      const obligationPaymentRows = state.fixedExpenses.flatMap((item) =>
        item.lastPaidMonth
          ? [
              {
                id: existingObligationPayments.get(`${item.id}:${item.lastPaidMonth}`) ?? crypto.randomUUID(),
                usuario_id: usuarioId,
                app_id: `${item.id}:${item.lastPaidMonth}`,
                obligacion_id: obligationAppIdToId.get(item.id) ?? null,
                gasto_id:
                  expenseRows.find(
                    (expense) =>
                      expense.descripcion === item.title &&
                      expense.origen === 'fixed' &&
                      expense.fecha.startsWith(item.lastPaidMonth ?? ''),
                  )?.id ?? null,
                monto: item.amount,
                fecha_pago: `${item.lastPaidMonth}-01`,
                mes_periodo: item.lastPaidMonth,
              },
            ]
          : [],
      )

      const debtPaymentRows = state.debtPayments.map((item) => ({
        id: existingDebtPayments.get(item.id) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: item.id,
        deuda_id: debtAppIdToId.get(item.debtId) ?? null,
        gasto_id:
          expenseRows.find(
            (expense) =>
              expense.deuda_id === debtAppIdToId.get(item.debtId) &&
              expense.fecha === item.date &&
              toNumber(expense.monto) === item.amount,
          )?.id ?? null,
        monto: item.amount,
        fecha_pago: item.date,
        tipo: item.kind,
      }))

      const monthClosureRows = state.monthClosures.map((item) => ({
        id: existingMonthClosures.get(item.monthKey) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        mes: item.monthKey,
        total_ingresos: item.income,
        total_gastos: item.expense,
        flujo_neto: item.netFlow,
        saldo_bolsillos: item.pocketBalance,
        deuda_pendiente: item.pendingDebt,
        obligaciones_pendientes: item.pendingFixed,
        fecha_cierre: item.closedAt,
        created_at: envelope.updatedAt,
      }))

      const learningRuleRows = state.learningRules.map((item, index) => ({
        id: existingLearningRules.get(`${item.keyword}:${index}`) ?? crypto.randomUUID(),
        usuario_id: usuarioId,
        app_id: `${item.keyword}:${index}`,
        palabra_clave: item.keyword,
        categoria_id: categoryNameToId.get(item.category) ?? categoryNameToId.get('Otros') ?? null,
        aciertos: item.hits,
        updated_at: envelope.updatedAt,
      }))

      const { error: settingsError } = await client
        .from(TABLES.settings)
        .upsert(
          {
            usuario_id: usuarioId,
            etiqueta_bolsillo_operacion: state.config.pocketTypeLabels.daily,
            etiqueta_bolsillo_ahorro: state.config.pocketTypeLabels.savings,
            etiqueta_bolsillo_pagos_fijos: state.config.pocketTypeLabels.fixed,
            etiqueta_bolsillo_meta: state.config.pocketTypeLabels.invest,
            updated_at: envelope.updatedAt,
          },
          { onConflict: 'usuario_id' },
        )

      if (settingsError) throw settingsError

      await upsertRows(TABLES.categories, categoryRows, 'usuario_id,app_id')
      await upsertRows(TABLES.pockets, pocketRows, 'usuario_id,app_id')
      await upsertRows(TABLES.learningRules, learningRuleRows, 'usuario_id,app_id')
      await upsertRowsWithFallback(TABLES.incomes, incomeRows, 'usuario_id,app_id', ['hora'])
      await upsertRows(TABLES.obligations, obligationRows, 'usuario_id,app_id')
      await upsertRows(TABLES.debts, debtRows, 'usuario_id,app_id')
      await upsertRowsWithFallback(TABLES.expenses, expenseRows, 'usuario_id,app_id', ['hora'])
      await upsertRowsWithFallback(TABLES.transfers, transferRows, 'usuario_id,app_id', ['hora'])
      await upsertRows(
        TABLES.obligationPayments,
        obligationPaymentRows.filter((row) => row.obligacion_id),
        'usuario_id,app_id',
      )
      await upsertRows(
        TABLES.debtPayments,
        debtPaymentRows.filter((row) => row.deuda_id),
        'usuario_id,app_id',
      )
      await upsertRows(TABLES.monthClosures, monthClosureRows, 'usuario_id,mes')

      await deleteRowsByAppId(
        TABLES.obligationPayments,
        usuarioId,
        obligationPaymentRows.filter((row) => row.obligacion_id).map((row) => row.app_id),
      )
      await deleteRowsByAppId(
        TABLES.debtPayments,
        usuarioId,
        debtPaymentRows.filter((row) => row.deuda_id).map((row) => row.app_id),
      )
      await deleteRowsByAppId(TABLES.transfers, usuarioId, transferRows.map((row) => row.app_id))
      await deleteRowsByAppId(TABLES.expenses, usuarioId, expenseRows.map((row) => row.app_id))
      await deleteRowsByAppId(TABLES.incomes, usuarioId, incomeRows.map((row) => row.app_id))
      await deleteRowsByAppId(TABLES.obligations, usuarioId, obligationRows.map((row) => row.app_id))
      await deleteRowsByAppId(TABLES.debts, usuarioId, debtRows.map((row) => row.app_id))
      await deleteRowsByAppId(TABLES.learningRules, usuarioId, learningRuleRows.map((row) => row.app_id))
      await deleteMonthClosures(
        usuarioId,
        monthClosureRows.map((row) => row.mes),
      )
      await deleteRowsByAppId(TABLES.categories, usuarioId, categoryRows.map((row) => row.app_id))
      await deleteRowsByAppId(TABLES.pockets, usuarioId, pocketRows.map((row) => row.app_id))
    },
  }
}
