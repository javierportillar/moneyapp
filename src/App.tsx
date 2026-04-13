import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { FullscreenComposer } from './components/FullscreenComposer'
import {
  categoryKeywords,
  defaultCategories,
  initialState,
  moduleLabels,
  pocketIcons,
  STORAGE_KEY,
  viewLabels,
} from './domain/finance/constants'
import type {
  AppConfig,
  AppState,
  Category,
  ComposerView,
  Debt,
  DebtPayment,
  Expense,
  FixedExpense,
  Income,
  LearningRule,
  ModuleKey,
  MovementKind,
  Pocket,
  PocketType,
  Transfer,
  ViewKey,
} from './domain/finance/types'
import { usePersistentSnapshot } from './hooks/usePersistentSnapshot'
import { useSimpleUsersAuth } from './hooks/useSimpleUsersAuth'
import { createSupabaseFinanceDriver } from './services/supabaseFinance'
import { getSupabaseClient } from './services/supabaseClient'

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatDateISO(date: Date) {
  return date.toISOString().slice(0, 10)
}

function getMonthKeyFromOffset(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function normalize(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function tokenize(text: string) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
}

function predictCategory(description: string, rules: LearningRule[]) {
  const text = normalize(description)
  const scores = new Map<Category, number>()
  const matches = new Set<string>()

  rules.forEach((rule) => {
    if (text.includes(rule.keyword)) {
      scores.set(rule.category, (scores.get(rule.category) ?? 0) + 2 + rule.hits * 0.2)
      matches.add(rule.keyword)
    }
  })

  ;(Object.entries(categoryKeywords) as [Category, string[]][]).forEach(([category, keywords]) => {
    keywords.forEach((keyword) => {
      if (text.includes(keyword)) {
        scores.set(category, (scores.get(category) ?? 0) + 1)
        matches.add(keyword)
      }
    })
  })

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!ranked) return { category: 'Otros' as Category, confidence: 0.52, matches: [] as string[] }

  return {
    category: ranked[0],
    confidence: Math.min(0.98, 0.58 + ranked[1] * 0.08),
    matches: [...matches].slice(0, 4),
  }
}

function getPocketName(pockets: Pocket[], pocketId: string) {
  return pockets.find((pocket) => pocket.id === pocketId)?.name ?? 'Sin bolsillo'
}

function describePocketType(type: PocketType) {
  if (type === 'daily') return 'Operacion'
  if (type === 'savings') return 'Ahorro'
  if (type === 'fixed') return 'Pagos fijos'
  return 'Meta o inversion'
}

function getModuleSummary(module: ModuleKey) {
  if (module === 'gasto') return 'Registra salidas y aprende categorias'
  if (module === 'ingreso') return 'Distribuye entradas del mes'
  if (module === 'transferencia') return 'Mueve dinero entre bolsillos'
  if (module === 'fijos') return 'Programa obligaciones recurrentes'
  return 'Crea y clasifica tus cuentas internas'
}

function getDefaultIcon(type: PocketType) {
  if (type === 'daily') return '💼'
  if (type === 'savings') return '🛡️'
  if (type === 'fixed') return '🧾'
  return '🎯'
}

function getViewIcon(view: ViewKey) {
  if (view === 'resumen') return '◫'
  if (view === 'bolsillos') return '◉'
  if (view === 'movimientos') return '↕'
  if (view === 'programacion') return '◷'
  if (view === 'deudas') return '¤'
  return '⚙'
}

function hydrateState(raw: AppState) {
  const safePockets =
    raw.pockets?.length
      ? raw.pockets.map((pocket) => ({
          ...pocket,
          balance: 0,
          icon: pocket.icon ?? getDefaultIcon(pocket.type),
        }))
      : initialState.pockets.map((pocket) => ({ ...pocket }))

  return {
    ...raw,
    categories: raw.categories?.length ? raw.categories : [...defaultCategories],
    config: {
      pocketTypeLabels: {
        ...initialState.config.pocketTypeLabels,
        ...(raw.config?.pocketTypeLabels ?? {}),
      },
    },
    debts: raw.debts ?? initialState.debts,
    debtPayments: raw.debtPayments ?? initialState.debtPayments,
    monthClosures: raw.monthClosures ?? initialState.monthClosures,
    incomes: raw.incomes ?? initialState.incomes,
    transfers: raw.transfers ?? initialState.transfers,
    expenses: raw.expenses ?? initialState.expenses,
    learningRules: raw.learningRules ?? initialState.learningRules,
    fixedExpenses: (raw.fixedExpenses ?? initialState.fixedExpenses).map((item) => ({
      ...item,
      active: item.active ?? true,
    })),
    pockets: safePockets,
  }
}

function App() {
  const now = new Date()
  const today = formatDateISO(now)
  const currentMonthKey = today.slice(0, 7)
  const currentDay = now.getDate()
  const auth = useSimpleUsersAuth()
  const remoteDriver = createSupabaseFinanceDriver<AppState>(auth.user?.id)
  const {
    state,
    setState,
    isReady,
    syncSource,
    syncError,
    lastSyncedAt,
    supabaseConfigured,
    profileId,
  } = usePersistentSnapshot<AppState>({
    storageKey: STORAGE_KEY,
    initialState,
    hydrate: hydrateState,
    remote: remoteDriver,
  })
  const [activeView, setActiveView] = useState<ViewKey>('resumen')
  const [activeModule, setActiveModule] = useState<ModuleKey>('gasto')
  const [openComposer, setOpenComposer] = useState<ComposerView | null>(null)
  const [selectedPocketId, setSelectedPocketId] = useState(initialState.pockets[0].id)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authForm, setAuthForm] = useState({ username: '', cedula: '', password: '' })
  const [authFeedback, setAuthFeedback] = useState<string | null>(null)
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [showAuthPassword, setShowAuthPassword] = useState(false)
  const isAdminUser = auth.user?.typeuser === 'admin'

  useEffect(() => {
    if (isAdminUser) {
      void loadManagedUsers()
    } else {
      setManagedUsers([])
      setShowUserAdminForm(false)
      resetUserAdminForm()
    }
  }, [isAdminUser])

  useEffect(() => {
    if (!state.pockets.length) return
    if (!state.pockets.some((pocket) => pocket.id === selectedPocketId)) {
      setSelectedPocketId(state.pockets[0].id)
    }
  }, [selectedPocketId, state.pockets])

  const [expenseForm, setExpenseForm] = useState({
    id: '',
    description: '',
    amount: '',
    pocketId: initialState.pockets[0].id,
    date: today,
  })
  const [incomeForm, setIncomeForm] = useState({
    id: '',
    title: '',
    amount: '',
    pocketId: initialState.pockets[0].id,
    recurring: true,
    date: today,
  })
  const [transferForm, setTransferForm] = useState({
    id: '',
    fromPocketId: initialState.pockets[0].id,
    toPocketId: initialState.pockets[1].id,
    amount: '',
    note: '',
    date: today,
  })
  const [fixedForm, setFixedForm] = useState({
    id: '',
    title: '',
    amount: '',
    dueDay: String(Math.min(currentDay + 3, 28)),
    confirmationDay: String(Math.min(currentDay + 4, 28)),
    pocketId: initialState.pockets[2].id,
    category: 'Servicios' as Category,
  })
  const [pocketForm, setPocketForm] = useState({
    id: '',
    name: '',
    type: 'daily' as PocketType,
    color: '#0f766e',
    icon: '💼',
  })
  const [categoryForm, setCategoryForm] = useState('')
  const [movementFilters, setMovementFilters] = useState<{
    pocketId: string
    kind: 'todos' | MovementKind
    query: string
    groupBy: 'dia' | 'mes'
  }>({
    pocketId: 'todos',
    kind: 'todos',
    query: '',
    groupBy: 'dia',
  })
  const [movementMonthKey, setMovementMonthKey] = useState(currentMonthKey)
  const [debtForm, setDebtForm] = useState({
    id: '',
    title: '',
    totalAmount: '',
    installmentAmount: '',
    dueDay: String(Math.min(currentDay + 7, 28)),
    pocketId: initialState.pockets[0].id,
    category: 'Otros' as Category,
  })
  const [debtPaymentDrafts, setDebtPaymentDrafts] = useState<Record<string, string>>({})
  const [openDebtPaymentId, setOpenDebtPaymentId] = useState<string | null>(null)
  const [fixedPaymentDraft, setFixedPaymentDraft] = useState<{
    fixedId: string
    pocketId: string
    paymentDate: string
  } | null>(null)
  const [managedUsers, setManagedUsers] = useState<
    Array<{ username: string; cedula: string; nombre: string | null; password: string; typeuser: 'admin' | 'user' }>
  >([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersFeedback, setUsersFeedback] = useState<string | null>(null)
  const [showUserAdminForm, setShowUserAdminForm] = useState(false)
  const [showUserAdminPassword, setShowUserAdminPassword] = useState(false)
  const [userAdminForm, setUserAdminForm] = useState({
    username: '',
    cedula: '',
    nombre: '',
    password: '',
    typeuser: 'user' as 'admin' | 'user',
    editingUsername: '',
  })
  const orderedViews: ViewKey[] = ['resumen', 'movimientos', 'bolsillos', 'programacion', 'deudas', 'configuracion']

  const suggestion = useMemo(
    () => predictCategory(expenseForm.description || 'movimiento general', state.learningRules),
    [expenseForm.description, state.learningRules],
  )
  const previousMonthKey = getMonthKeyFromOffset(currentMonthKey, -1)

  const monthExpenses = useMemo(
    () => state.expenses.filter((expense) => expense.date.startsWith(currentMonthKey)),
    [currentMonthKey, state.expenses],
  )
  const monthIncomes = useMemo(
    () => state.incomes.filter((income) => income.date.startsWith(currentMonthKey)),
    [currentMonthKey, state.incomes],
  )
  const monthTransfers = useMemo(
    () => state.transfers.filter((transfer) => transfer.date.startsWith(currentMonthKey)),
    [currentMonthKey, state.transfers],
  )
  const movementMonthExpenses = useMemo(
    () => state.expenses.filter((expense) => expense.date.startsWith(movementMonthKey)),
    [movementMonthKey, state.expenses],
  )
  const movementMonthIncomes = useMemo(
    () => state.incomes.filter((income) => income.date.startsWith(movementMonthKey)),
    [movementMonthKey, state.incomes],
  )
  const movementMonthTransfers = useMemo(
    () => state.transfers.filter((transfer) => transfer.date.startsWith(movementMonthKey)),
    [movementMonthKey, state.transfers],
  )
  const previousMonthExpenses = useMemo(
    () => state.expenses.filter((expense) => expense.date.startsWith(previousMonthKey)),
    [previousMonthKey, state.expenses],
  )
  const previousMonthIncomes = useMemo(
    () => state.incomes.filter((income) => income.date.startsWith(previousMonthKey)),
    [previousMonthKey, state.incomes],
  )
  const activeDebts = useMemo(
    () => state.debts.filter((debt) => debt.active && debt.remainingAmount > 0),
    [state.debts],
  )
  const completedDebts = useMemo(
    () => state.debts.filter((debt) => debt.remainingAmount <= 0),
    [state.debts],
  )
  const monthlyDebtCommitment = useMemo(
    () =>
      activeDebts.reduce(
        (sum, debt) => sum + Math.min(debt.installmentAmount, Math.max(0, debt.remainingAmount)),
        0,
      ),
    [activeDebts],
  )

  const pocketBalances = useMemo(() => {
    const balances = Object.fromEntries(state.pockets.map((pocket) => [pocket.id, 0]))

    state.incomes.forEach((income) => {
      balances[income.pocketId] = (balances[income.pocketId] ?? 0) + income.amount
    })

    state.expenses.forEach((expense) => {
      balances[expense.pocketId] = (balances[expense.pocketId] ?? 0) - expense.amount
    })

    state.transfers.forEach((transfer) => {
      balances[transfer.fromPocketId] = (balances[transfer.fromPocketId] ?? 0) - transfer.amount
      balances[transfer.toPocketId] = (balances[transfer.toPocketId] ?? 0) + transfer.amount
    })

    return balances
  }, [state.expenses, state.incomes, state.pockets, state.transfers])

  const fixedStatus = useMemo(() => {
    const activeItems = state.fixedExpenses.filter((item) => item.active)
    const paused = state.fixedExpenses.filter((item) => !item.active)
    const paid = activeItems.filter((item) => item.lastPaidMonth === currentMonthKey)
    const pending = activeItems.filter((item) => item.lastPaidMonth !== currentMonthKey)
    const overdue = pending.filter((item) => item.confirmationDay < currentDay)
    const review = pending.filter((item) => item.confirmationDay <= currentDay)
    return { activeItems, paid, pending, overdue, paused, review }
  }, [currentDay, currentMonthKey, state.fixedExpenses])

  const obligationSummary = useMemo(() => {
    const totalActiveAmount = fixedStatus.activeItems.reduce((sum, item) => sum + item.amount, 0)
    const totalPendingAmount = fixedStatus.pending.reduce((sum, item) => sum + item.amount, 0)

    const byDueDay = fixedStatus.activeItems.reduce<Record<number, number>>((acc, item) => {
      acc[item.dueDay] = (acc[item.dueDay] ?? 0) + item.amount
      return acc
    }, {})

    const heaviestDueDay =
      Object.entries(byDueDay)
        .map(([day, total]) => ({ day: Number(day), total }))
        .sort((a, b) => b.total - a.total)[0] ?? null

    const nextDeadlines = fixedStatus.pending
      .slice()
      .sort((a, b) => a.dueDay - b.dueDay)
      .slice(0, 4)

    const nextConfirmations = fixedStatus.pending
      .slice()
      .sort((a, b) => a.confirmationDay - b.confirmationDay)
      .slice(0, 4)

    const highestObligation =
      fixedStatus.activeItems.slice().sort((a, b) => b.amount - a.amount)[0] ?? null

    return {
      totalActiveAmount,
      totalPendingAmount,
      heaviestDueDay,
      nextDeadlines,
      nextConfirmations,
      highestObligation,
    }
  }, [fixedStatus.activeItems, fixedStatus.pending])

  const totals = useMemo(() => {
    const pocketBalance = Object.values(pocketBalances).reduce((sum, balance) => sum + balance, 0)
    const totalExpenses = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0)
    const totalIncomes = monthIncomes.reduce((sum, income) => sum + income.amount, 0)
    const previousExpenses = previousMonthExpenses.reduce((sum, expense) => sum + expense.amount, 0)
    const previousIncomes = previousMonthIncomes.reduce((sum, income) => sum + income.amount, 0)
    const pendingFixed = fixedStatus.pending.reduce((sum, item) => sum + item.amount, 0)
    const pendingDebt = activeDebts.reduce((sum, debt) => sum + debt.remainingAmount, 0)

    return {
      pocketBalance,
      totalExpenses,
      totalIncomes,
      previousExpenses,
      previousIncomes,
      pendingFixed,
      pendingDebt,
      netFlow: totalIncomes - totalExpenses,
      debtToIncomeRatio: totalIncomes > 0 ? pendingDebt / totalIncomes : 0,
    }
  }, [activeDebts, fixedStatus.pending, monthExpenses, monthIncomes, pocketBalances, previousMonthExpenses, previousMonthIncomes])

  const topCategories = useMemo(() => {
    const grouped = monthExpenses.reduce<Record<string, number>>((acc, expense) => {
      acc[expense.category] = (acc[expense.category] ?? 0) + expense.amount
      return acc
    }, {})
    return Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 4)
  }, [monthExpenses])

  const activity = useMemo(() => {
    const items = [
      ...monthExpenses.map((expense) => ({
        id: expense.id,
        date: expense.date,
        kind: 'gasto' as const,
        source: expense.source,
        editable: expense.source === 'manual' || expense.source === 'wallet',
        deletable: expense.source === 'manual' || expense.source === 'wallet',
        title: expense.description,
        amount: -expense.amount,
        pocketIds: [expense.pocketId],
        meta: `${expense.category} · ${getPocketName(state.pockets, expense.pocketId)}`,
        detail: `Salida ${expense.source} · confianza ${Math.round(expense.confidence * 100)}%`,
      })),
      ...monthIncomes.map((income) => ({
        id: income.id,
        date: income.date,
        kind: 'ingreso' as const,
        editable: true,
        deletable: true,
        title: income.title,
        amount: income.amount,
        pocketIds: [income.pocketId],
        meta: getPocketName(state.pockets, income.pocketId),
        detail: income.recurring ? 'Ingreso recurrente' : 'Ingreso manual',
      })),
      ...monthTransfers.map((transfer) => ({
        id: transfer.id,
        date: transfer.date,
        kind: 'transferencia' as const,
        editable: true,
        deletable: true,
        title: transfer.note || 'Transferencia interna',
        amount: transfer.amount,
        pocketIds: [transfer.fromPocketId, transfer.toPocketId],
        meta: `${getPocketName(state.pockets, transfer.fromPocketId)} -> ${getPocketName(
          state.pockets,
          transfer.toPocketId,
        )}`,
        detail: transfer.note.trim() || 'Movimiento interno entre bolsillos',
      })),
    ]

    return items.sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [monthExpenses, monthIncomes, monthTransfers, state.pockets])

  const movementActivity = useMemo(() => {
    const items = [
      ...movementMonthExpenses.map((expense) => ({
        id: expense.id,
        date: expense.date,
        kind: 'gasto' as const,
        source: expense.source,
        editable: expense.source === 'manual' || expense.source === 'wallet',
        deletable: expense.source === 'manual' || expense.source === 'wallet',
        title: expense.description,
        amount: -expense.amount,
        pocketIds: [expense.pocketId],
        meta: `${expense.category} · ${getPocketName(state.pockets, expense.pocketId)}`,
        detail: `Salida ${expense.source} · confianza ${Math.round(expense.confidence * 100)}%`,
      })),
      ...movementMonthIncomes.map((income) => ({
        id: income.id,
        date: income.date,
        kind: 'ingreso' as const,
        editable: true,
        deletable: true,
        title: income.title,
        amount: income.amount,
        pocketIds: [income.pocketId],
        meta: getPocketName(state.pockets, income.pocketId),
        detail: income.recurring ? 'Ingreso recurrente' : 'Ingreso manual',
      })),
      ...movementMonthTransfers.map((transfer) => ({
        id: transfer.id,
        date: transfer.date,
        kind: 'transferencia' as const,
        editable: true,
        deletable: true,
        title: transfer.note || 'Transferencia interna',
        amount: transfer.amount,
        pocketIds: [transfer.fromPocketId, transfer.toPocketId],
        meta: `${getPocketName(state.pockets, transfer.fromPocketId)} -> ${getPocketName(
          state.pockets,
          transfer.toPocketId,
        )}`,
        detail: transfer.note.trim() || 'Movimiento interno entre bolsillos',
      })),
    ]

    return items.sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [movementMonthExpenses, movementMonthIncomes, movementMonthTransfers, state.pockets])

  const selectedPocket = state.pockets.find((pocket) => pocket.id === selectedPocketId) ?? state.pockets[0]

  const selectedPocketActivity = useMemo(
    () => activity.filter((item) => item.pocketIds.includes(selectedPocketId)),
    [activity, selectedPocketId],
  )

  const filteredActivity = useMemo(() => {
    return movementActivity
      .filter((item) => {
        const matchesPocket =
          movementFilters.pocketId === 'todos' || item.pocketIds.includes(movementFilters.pocketId)
        const matchesKind = movementFilters.kind === 'todos' || item.kind === movementFilters.kind
        const matchesQuery =
          !movementFilters.query ||
          normalize(`${item.title} ${item.meta} ${item.detail}`).includes(normalize(movementFilters.query))
        return matchesPocket && matchesKind && matchesQuery
      })
      .map((item) => {
        if (item.kind !== 'transferencia' || movementFilters.pocketId === 'todos') {
          return item
        }

        const transfer = state.transfers.find((entry) => entry.id === item.id)
        if (!transfer) return item

        const isOutgoing = transfer.fromPocketId === movementFilters.pocketId
        const signedAmount = isOutgoing ? -transfer.amount : transfer.amount
        const transferPocketName = isOutgoing
          ? getPocketName(state.pockets, transfer.toPocketId)
          : getPocketName(state.pockets, transfer.fromPocketId)

        return {
          ...item,
          amount: signedAmount,
          detail: isOutgoing
            ? `Salida por transferencia hacia ${transferPocketName}`
            : `Entrada por transferencia desde ${transferPocketName}`,
        }
      })
  }, [movementActivity, movementFilters, state.pockets, state.transfers])

  const groupedFilteredActivity = useMemo(() => {
    return filteredActivity.reduce<Record<string, typeof filteredActivity>>((acc, item) => {
      const groupKey = movementFilters.groupBy === 'mes' ? item.date.slice(0, 7) : item.date
      if (!acc[groupKey]) acc[groupKey] = []
      acc[groupKey].push(item)
      return acc
    }, {})
  }, [filteredActivity, movementFilters.groupBy])

  const movementSummary = useMemo(() => {
    const inflow = filteredActivity
      .filter((item) => item.amount > 0)
      .reduce((sum, item) => sum + item.amount, 0)
    const outflow = filteredActivity
      .filter((item) => item.amount < 0)
      .reduce((sum, item) => sum + Math.abs(item.amount), 0)
    const transfers = filteredActivity.filter((item) => item.kind === 'transferencia').length

    return {
      inflow,
      outflow,
      transfers,
      count: filteredActivity.length,
    }
  }, [filteredActivity])

  const summaryAnalytics = useMemo(() => {
    const maxFlowBase = Math.max(
      totals.totalIncomes,
      totals.totalExpenses,
      totals.pendingDebt,
      1,
    )

    const categoryBreakdown = state.categories
      .map((category) => {
        const total = monthExpenses
          .filter((expense) => expense.category === category)
          .reduce((sum, expense) => sum + expense.amount, 0)

        return {
          category,
          total,
          ratio: totals.totalExpenses > 0 ? total / totals.totalExpenses : 0,
        }
      })
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)

    const pocketBreakdown = state.pockets
      .map((pocket) => ({
        id: pocket.id,
        name: pocket.name,
        icon: pocket.icon,
        color: pocket.color,
        balance: pocketBalances[pocket.id] ?? 0,
      }))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))

    const debtBreakdown = activeDebts.map((debt) => {
      const paidAmount = debt.totalAmount - debt.remainingAmount
      const estimatedMonthsLeft = Math.max(1, Math.ceil(debt.remainingAmount / Math.max(1, debt.installmentAmount)))
      return {
        ...debt,
        paidAmount,
        ratio: debt.totalAmount > 0 ? paidAmount / debt.totalAmount : 0,
        estimatedPayoffMonth: getMonthKeyFromOffset(currentMonthKey, estimatedMonthsLeft - 1),
      }
    })

    const monthTrend = Array.from({ length: 6 }, (_, index) => {
      const monthKey = getMonthKeyFromOffset(currentMonthKey, index - 5)
      const income = state.incomes
        .filter((item) => item.date.startsWith(monthKey))
        .reduce((sum, item) => sum + item.amount, 0)
      const expense = state.expenses
        .filter((item) => item.date.startsWith(monthKey))
        .reduce((sum, item) => sum + item.amount, 0)
      return {
        monthKey,
        income,
        expense,
        net: income - expense,
      }
    })

    const maxTrendBase = Math.max(
      ...monthTrend.flatMap((item) => [item.income, item.expense, Math.abs(item.net)]),
      1,
    )

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const dailyTrend = Array.from({ length: daysInMonth }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      const date = `${currentMonthKey}-${day}`
      const income = monthIncomes.filter((item) => item.date === date).reduce((sum, item) => sum + item.amount, 0)
      const expense = monthExpenses.filter((item) => item.date === date).reduce((sum, item) => sum + item.amount, 0)
      return {
        date,
        label: day,
        net: income - expense,
      }
    })

    const maxDailyNet = Math.max(...dailyTrend.map((item) => Math.abs(item.net)), 1)

    return {
      maxFlowBase,
      categoryBreakdown,
      pocketBreakdown,
      debtBreakdown,
      monthTrend,
      maxTrendBase,
      dailyTrend,
      maxDailyNet,
    }
  }, [activeDebts, currentMonthKey, monthExpenses, monthIncomes, now, pocketBalances, state.categories, state.expenses, state.incomes, state.pockets, totals])

  const debtPaymentHistory = useMemo(() => {
    return state.debtPayments.reduce<Record<string, DebtPayment[]>>((acc, payment) => {
      if (!acc[payment.debtId]) acc[payment.debtId] = []
      acc[payment.debtId].push(payment)
      acc[payment.debtId].sort((a, b) => (a.date < b.date ? 1 : -1))
      return acc
    }, {})
  }, [state.debtPayments])

  const currentMonthClosed = state.monthClosures.some((item) => item.monthKey === currentMonthKey)
  const previousClosure = state.monthClosures.find((item) => item.monthKey === previousMonthKey)

  const coachingMessage = useMemo(() => {
    if (fixedStatus.overdue.length > 0) {
      return `Hay ${fixedStatus.overdue.length} compromiso(s) vencido(s). Prioriza caja antes de mover saldo a metas.`
    }
    if (totals.netFlow < 0) {
      return 'El flujo del mes esta negativo. Conviene contener gastos variables y revisar categorias dominantes.'
    }
    if (fixedStatus.pending.length > 0) {
      return 'Tu posicion es estable, pero aun debes provisionar los pagos fijos pendientes del mes.'
    }
    return 'La operacion del mes esta bajo control. Ya puedes pensar en automatizacion y conexion bancaria real.'
  }, [fixedStatus.overdue.length, fixedStatus.pending.length, totals.netFlow])

  function getPocketTypeLabel(type: PocketType) {
    return state.config.pocketTypeLabels[type] || describePocketType(type)
  }

  function jumpToView(view: ViewKey, module?: ModuleKey) {
    setActiveView(view)
    if (module) setActiveModule(module)
  }

  function openComposerForView(view: ComposerView, module?: ModuleKey) {
    setOpenComposer(view)
    if (module) setActiveModule(module)
  }

  function resetPocketForm() {
    setPocketForm({ id: '', name: '', type: 'daily', color: '#0f766e', icon: '💼' })
  }

  function resetExpenseForm() {
    setExpenseForm({
      id: '',
      description: '',
      amount: '',
      pocketId: initialState.pockets[0].id,
      date: today,
    })
  }

  function resetIncomeForm() {
    setIncomeForm({
      id: '',
      title: '',
      amount: '',
      pocketId: initialState.pockets[0].id,
      recurring: true,
      date: today,
    })
  }

  function resetTransferForm() {
    setTransferForm({
      id: '',
      fromPocketId: initialState.pockets[0].id,
      toPocketId: initialState.pockets[1].id,
      amount: '',
      note: '',
      date: today,
    })
  }

  function resetFixedForm() {
    setFixedForm({
      id: '',
      title: '',
      amount: '',
      dueDay: String(Math.min(currentDay + 3, 28)),
      confirmationDay: String(Math.min(currentDay + 4, 28)),
      pocketId: initialState.pockets[2].id,
      category: 'Servicios',
    })
  }

  function resetDebtForm() {
    setDebtForm({
      id: '',
      title: '',
      totalAmount: '',
      installmentAmount: '',
      dueDay: String(Math.min(currentDay + 7, 28)),
      pocketId: initialState.pockets[0].id,
      category: 'Otros',
    })
  }

  function openFixedPaymentConfirmation(fixedId: string) {
    const fixed = state.fixedExpenses.find((item) => item.id === fixedId)
    if (!fixed) return

    setFixedPaymentDraft({
      fixedId,
      pocketId: fixed.pocketId || state.pockets[0]?.id || initialState.pockets[0].id,
      paymentDate: today,
    })
  }

  function closeFixedPaymentConfirmation() {
    setFixedPaymentDraft(null)
  }

  function startEditPocket(pocketId: string) {
    const pocket = state.pockets.find((item) => item.id === pocketId)
    if (!pocket) return
    setSelectedPocketId(pocketId)
    setActiveModule('bolsillos')
    setOpenComposer('bolsillos')
    setPocketForm({
      id: pocket.id,
      name: pocket.name,
      type: pocket.type,
      color: pocket.color,
      icon: pocket.icon,
    })
  }

  function startEditFixedExpense(fixedId: string) {
    const fixed = state.fixedExpenses.find((item) => item.id === fixedId)
    if (!fixed) return
    setActiveModule('fijos')
    setOpenComposer('programacion')
    setFixedForm({
      id: fixed.id,
      title: fixed.title,
      amount: String(fixed.amount),
      dueDay: String(fixed.dueDay),
      confirmationDay: String(fixed.confirmationDay),
      pocketId: fixed.pocketId,
      category: fixed.category,
    })
  }

  function startEditDebt(debtId: string) {
    const debt = state.debts.find((item) => item.id === debtId)
    if (!debt) return
    setOpenComposer('deudas')
    setDebtForm({
      id: debt.id,
      title: debt.title,
      totalAmount: String(debt.totalAmount),
      installmentAmount: String(debt.installmentAmount),
      dueDay: String(debt.dueDay),
      pocketId: debt.pocketId,
      category: debt.category,
    })
  }

  function startEditMovement(kind: MovementKind, movementId: string) {
    setActiveView('movimientos')
    setActiveModule(kind)
    setOpenComposer('movimientos')

    if (kind === 'gasto') {
      const expense = state.expenses.find((item) => item.id === movementId)
      if (!expense || (expense.source !== 'manual' && expense.source !== 'wallet')) return

      setExpenseForm({
        id: expense.id,
        description: expense.description,
        amount: String(expense.amount),
        pocketId: expense.pocketId,
        date: expense.date,
      })
      return
    }

    if (kind === 'ingreso') {
      const income = state.incomes.find((item) => item.id === movementId)
      if (!income) return

      setIncomeForm({
        id: income.id,
        title: income.title,
        amount: String(income.amount),
        pocketId: income.pocketId,
        recurring: income.recurring,
        date: income.date,
      })
      return
    }

    const transfer = state.transfers.find((item) => item.id === movementId)
    if (!transfer) return

    setTransferForm({
      id: transfer.id,
      fromPocketId: transfer.fromPocketId,
      toPocketId: transfer.toPocketId,
      amount: String(transfer.amount),
      note: transfer.note,
      date: transfer.date,
    })
  }

  function handleDeleteMovement(kind: MovementKind, movementId: string) {
    if (!window.confirm('Este movimiento se eliminara de forma permanente.')) return

    setState((current) => {
      if (kind === 'gasto') {
        const expense = current.expenses.find((item) => item.id === movementId)
        if (!expense || (expense.source !== 'manual' && expense.source !== 'wallet')) return current

        return {
          ...current,
          expenses: current.expenses.filter((item) => item.id !== movementId),
        }
      }

      if (kind === 'ingreso') {
        return {
          ...current,
          incomes: current.incomes.filter((item) => item.id !== movementId),
        }
      }

      return {
        ...current,
        transfers: current.transfers.filter((item) => item.id !== movementId),
      }
    })

    if (expenseForm.id === movementId) resetExpenseForm()
    if (incomeForm.id === movementId) resetIncomeForm()
    if (transferForm.id === movementId) resetTransferForm()
  }

  function handleExportMovements() {
    const header = ['fecha', 'tipo', 'titulo', 'meta', 'detalle', 'valor']
    const rows = filteredActivity.map((item) => [
      item.date,
      item.kind,
      item.title,
      item.meta,
      item.detail,
      String(item.amount),
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `movimientos-${movementMonthKey}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleAddExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAmount = Number(expenseForm.amount)
    if (!expenseForm.description.trim() || numericAmount <= 0) return

    setState((current) => {
      const currentExpense = current.expenses.find((item) => item.id === expenseForm.id)
      const expense: Expense = {
        id: expenseForm.id || crypto.randomUUID(),
        description: expenseForm.description.trim(),
        amount: numericAmount,
        pocketId: expenseForm.pocketId,
        date: expenseForm.date || currentExpense?.date || today,
        source: currentExpense?.source ?? 'manual',
        category: suggestion.category,
        confidence: suggestion.confidence,
      }

      return {
        ...current,
        expenses: expenseForm.id
          ? current.expenses.map((item) => (item.id === expenseForm.id ? expense : item))
          : [expense, ...current.expenses],
      }
    })

    resetExpenseForm()
    setOpenComposer(null)
  }

  function handleAddIncome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAmount = Number(incomeForm.amount)
    if (!incomeForm.title.trim() || numericAmount <= 0) return

    setState((current) => {
      const currentIncome = current.incomes.find((item) => item.id === incomeForm.id)
      const income: Income = {
        id: incomeForm.id || crypto.randomUUID(),
        title: incomeForm.title.trim(),
        amount: numericAmount,
        pocketId: incomeForm.pocketId,
        date: incomeForm.date || currentIncome?.date || today,
        recurring: incomeForm.recurring,
      }

      return {
        ...current,
        incomes: incomeForm.id
          ? current.incomes.map((item) => (item.id === incomeForm.id ? income : item))
          : [income, ...current.incomes],
      }
    })

    resetIncomeForm()
    setOpenComposer(null)
  }

  function handleAddTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAmount = Number(transferForm.amount)
    if (
      transferForm.fromPocketId === transferForm.toPocketId ||
      numericAmount <= 0 ||
      !transferForm.fromPocketId ||
      !transferForm.toPocketId
    ) {
      return
    }

    setState((current) => {
      const currentTransfer = current.transfers.find((item) => item.id === transferForm.id)
      const transfer: Transfer = {
        id: transferForm.id || crypto.randomUUID(),
        fromPocketId: transferForm.fromPocketId,
        toPocketId: transferForm.toPocketId,
        amount: numericAmount,
        date: transferForm.date || currentTransfer?.date || today,
        note: transferForm.note.trim(),
      }

      return {
        ...current,
        transfers: transferForm.id
          ? current.transfers.map((item) => (item.id === transferForm.id ? transfer : item))
          : [transfer, ...current.transfers],
      }
    })

    resetTransferForm()
    setOpenComposer(null)
  }

  function handleAddFixedExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAmount = Number(fixedForm.amount)
    const numericDay = Number(fixedForm.dueDay)
    const numericConfirmationDay = Number(fixedForm.confirmationDay)
    if (
      !fixedForm.title.trim() ||
      numericAmount <= 0 ||
      numericDay < 1 ||
      numericDay > 31 ||
      numericConfirmationDay < 1 ||
      numericConfirmationDay > 31
    ) {
      return
    }

    setState((current) => {
      const nextFixed: FixedExpense = {
        id: fixedForm.id || crypto.randomUUID(),
        title: fixedForm.title.trim(),
        amount: numericAmount,
        dueDay: numericDay,
        confirmationDay: numericConfirmationDay,
        pocketId: fixedForm.pocketId,
        category: fixedForm.category,
        active: true,
        lastPaidMonth: current.fixedExpenses.find((item) => item.id === fixedForm.id)?.lastPaidMonth,
      }

      return {
        ...current,
        fixedExpenses: fixedForm.id
          ? current.fixedExpenses.map((item) => (item.id === fixedForm.id ? nextFixed : item))
          : [nextFixed, ...current.fixedExpenses],
      }
    })

    resetFixedForm()
    setOpenComposer(null)
  }

  function handleAddPocket(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pocketForm.name.trim()) return

    const newPocket: Pocket = {
      id: pocketForm.id || crypto.randomUUID(),
      name: pocketForm.name.trim(),
      balance: 0,
      color: pocketForm.color,
      icon: pocketForm.icon,
      type: pocketForm.type,
    }

    setState((current) => ({
      ...current,
      pockets: pocketForm.id
        ? current.pockets.map((item) => (item.id === pocketForm.id ? newPocket : item))
        : [...current.pockets, newPocket],
    }))
    resetPocketForm()
    setOpenComposer(null)
  }

  function handleDeletePocket(pocketId: string) {
    const targetPocket = state.pockets.find((item) => item.id === pocketId)
    if (!targetPocket) return

    const linkedIncomeCount = state.incomes.filter((item) => item.pocketId === pocketId).length
    const linkedExpenseCount = state.expenses.filter((item) => item.pocketId === pocketId).length
    const linkedTransferCount = state.transfers.filter(
      (item) => item.fromPocketId === pocketId || item.toPocketId === pocketId,
    ).length
    const linkedFixedCount = state.fixedExpenses.filter((item) => item.pocketId === pocketId).length
    const linkedDebtCount = state.debts.filter((item) => item.pocketId === pocketId).length

    const totalLinks =
      linkedIncomeCount + linkedExpenseCount + linkedTransferCount + linkedFixedCount + linkedDebtCount

    if (totalLinks > 0) {
      window.alert(
        `No puedes eliminar el bolsillo ${targetPocket.name} porque tiene relacion con ${totalLinks} registro(s) entre movimientos, obligaciones o deudas.`,
      )
      return
    }

    if (!window.confirm(`Se eliminara el bolsillo ${targetPocket.name}. Esta accion no se puede deshacer.`)) return

    setState((current) => ({
      ...current,
      pockets: current.pockets.filter((item) => item.id !== pocketId),
    }))

    if (selectedPocketId === pocketId) {
      const nextPocket = state.pockets.find((item) => item.id !== pocketId)
      if (nextPocket) setSelectedPocketId(nextPocket.id)
    }

    resetPocketForm()
    setOpenComposer(null)
  }

  function handleCategoryCorrection(expenseId: string, category: Category) {
    setState((current) => {
      const expense = current.expenses.find((item) => item.id === expenseId)
      if (!expense) return current

      const keywords = tokenize(expense.description).slice(0, 3)
      const nextRules = [...current.learningRules]

      keywords.forEach((keyword) => {
        const index = nextRules.findIndex((rule) => rule.keyword === keyword)
        if (index >= 0) nextRules[index] = { keyword, category, hits: nextRules[index].hits + 1 }
        else nextRules.push({ keyword, category, hits: 1 })
      })

      return {
        ...current,
        learningRules: nextRules,
        expenses: current.expenses.map((item) =>
          item.id === expenseId ? { ...item, category, confidence: 0.99 } : item,
        ),
      }
    })
  }

  function handlePayFixedExpense(fixedId: string, paymentPocketId?: string, paymentDate?: string) {
    setState((current) => {
      const fixed = current.fixedExpenses.find((item) => item.id === fixedId)
      const effectiveDate = paymentDate || today
      const effectiveMonthKey = effectiveDate.slice(0, 7)

      if (!fixed || fixed.lastPaidMonth === effectiveMonthKey) return current

      const expense: Expense = {
        id: crypto.randomUUID(),
        description: fixed.title,
        amount: fixed.amount,
        pocketId: paymentPocketId || fixed.pocketId,
        date: effectiveDate,
        source: 'fixed',
        category: fixed.category,
        confidence: 1,
      }

      return {
        ...current,
        expenses: [expense, ...current.expenses],
        fixedExpenses: current.fixedExpenses.map((item) =>
          item.id === fixedId ? { ...item, lastPaidMonth: effectiveMonthKey } : item,
        ),
      }
    })
  }

  function handleConfirmFixedPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!fixedPaymentDraft?.fixedId || !fixedPaymentDraft.pocketId || !fixedPaymentDraft.paymentDate) return

    handlePayFixedExpense(fixedPaymentDraft.fixedId, fixedPaymentDraft.pocketId, fixedPaymentDraft.paymentDate)
    closeFixedPaymentConfirmation()
  }

  function handleToggleFixedExpense(fixedId: string) {
    setState((current) => ({
      ...current,
      fixedExpenses: current.fixedExpenses.map((item) =>
        item.id === fixedId ? { ...item, active: !item.active } : item,
      ),
    }))
  }

  function handleCloseMonth() {
    setState((current) => {
      if (current.monthClosures.some((item) => item.monthKey === currentMonthKey)) return current

      return {
        ...current,
        monthClosures: [
          {
            monthKey: currentMonthKey,
            closedAt: today,
            income: totals.totalIncomes,
            expense: totals.totalExpenses,
            netFlow: totals.netFlow,
            pocketBalance: totals.pocketBalance,
            pendingDebt: totals.pendingDebt,
            pendingFixed: totals.pendingFixed,
          },
          ...current.monthClosures,
        ],
      }
    })
  }

  function handleAddDebt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const totalAmount = Number(debtForm.totalAmount)
    const installmentAmount = Number(debtForm.installmentAmount)
    const dueDay = Number(debtForm.dueDay)

    if (
      !debtForm.title.trim() ||
      totalAmount <= 0 ||
      installmentAmount <= 0 ||
      dueDay < 1 ||
      dueDay > 31
    ) {
      return
    }

    setState((current) => {
      const existing = current.debts.find((item) => item.id === debtForm.id)
      const paidAmount = existing ? existing.totalAmount - existing.remainingAmount : 0
      const remainingAmount = Math.max(0, totalAmount - paidAmount)
      const nextDebt: Debt = {
        id: debtForm.id || crypto.randomUUID(),
        title: debtForm.title.trim(),
        totalAmount,
        remainingAmount,
        installmentAmount,
        dueDay,
        pocketId: debtForm.pocketId,
        category: debtForm.category,
        active: remainingAmount > 0,
      }

      return {
        ...current,
        debts: debtForm.id
          ? current.debts.map((item) => (item.id === debtForm.id ? nextDebt : item))
          : [nextDebt, ...current.debts],
      }
    })

    resetDebtForm()
    setOpenComposer(null)
  }

  function handlePayDebt(debtId: string, kind: 'scheduled' | 'extra' = 'scheduled') {
    setState((current) => {
      const debt = current.debts.find((item) => item.id === debtId)
      if (!debt || !debt.active || debt.remainingAmount <= 0) return current

      const draftAmount = Number(debtPaymentDrafts[debtId] || debt.installmentAmount)
      const paymentAmount = Math.min(Math.max(draftAmount, 0), debt.remainingAmount)
      if (paymentAmount <= 0) return current

      const expense: Expense = {
        id: crypto.randomUUID(),
        description: `Abono deuda: ${debt.title}`,
        amount: paymentAmount,
        pocketId: debt.pocketId,
        date: today,
        source: 'debt',
        category: debt.category,
        confidence: 1,
      }

      return {
        ...current,
        expenses: [expense, ...current.expenses],
        debtPayments: [
          {
            id: crypto.randomUUID(),
            debtId,
            amount: paymentAmount,
            date: today,
            kind,
          },
          ...current.debtPayments,
        ],
        debts: current.debts
          .map((item) => {
            if (item.id !== debtId) return item
            const remaining = Math.max(0, item.remainingAmount - paymentAmount)
            return {
              ...item,
              remainingAmount: remaining,
              active: remaining > 0,
            }
          }),
      }
    })

    setDebtPaymentDrafts((current) => ({ ...current, [debtId]: '' }))
    setOpenDebtPaymentId(null)
  }

  function handleAddCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextCategory = categoryForm.trim()
    if (!nextCategory || state.categories.includes(nextCategory)) return

    setState((current) => ({
      ...current,
      categories: [...current.categories, nextCategory],
    }))
    setCategoryForm('')
  }

  function handleRemoveCategory(category: Category) {
    if (state.categories.length <= 1) return
    if (!window.confirm(`La categoria ${category} se reemplazara por Otros en los registros actuales.`)) return

    setState((current) => ({
      ...current,
      categories: current.categories.filter((item) => item !== category),
      expenses: current.expenses.map((expense) =>
        expense.category === category ? { ...expense, category: 'Otros' } : expense,
      ),
      fixedExpenses: current.fixedExpenses.map((fixed) =>
        fixed.category === category ? { ...fixed, category: 'Otros' } : fixed,
      ),
      learningRules: current.learningRules.filter((rule) => rule.category !== category),
    }))
  }

  function handleRemoveLearningRule(keyword: string) {
    setState((current) => ({
      ...current,
      learningRules: current.learningRules.filter((rule) => rule.keyword !== keyword),
    }))
  }

  function updatePocketTypeLabels(value: AppConfig['pocketTypeLabels']) {
    setState((current) => ({
      ...current,
      config: {
        ...current.config,
        pocketTypeLabels: value,
      },
    }))
  }

  async function loadManagedUsers() {
    const client = getSupabaseClient()
    if (!client || !isAdminUser) return
    setUsersLoading(true)
    setUsersFeedback(null)

    const { data, error } = await client
      .from('usuarios')
      .select('username, cedula, nombre, password, typeuser')
      .order('created_at', { ascending: true })

    if (error) {
      setUsersFeedback(error.message)
      setUsersLoading(false)
      return
    }

    setManagedUsers(data ?? [])
    setUsersLoading(false)
  }

  function resetUserAdminForm() {
    setShowUserAdminForm(false)
    setShowUserAdminPassword(false)
    setUserAdminForm({
      username: '',
      cedula: '',
      nombre: '',
      password: '',
      typeuser: 'user',
      editingUsername: '',
    })
  }

  function startEditManagedUser(username: string) {
    const target = managedUsers.find((item) => item.username === username)
    if (!target) return
    setShowUserAdminForm(true)
    setShowUserAdminPassword(false)
    setUserAdminForm({
      username: target.username,
      cedula: target.cedula,
      nombre: target.nombre ?? '',
      password: target.password,
      typeuser: target.typeuser,
      editingUsername: target.username,
    })
  }

  async function handleSubmitManagedUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = getSupabaseClient()
    if (
      !client ||
      !isAdminUser ||
      !userAdminForm.username.trim() ||
      !userAdminForm.cedula.trim() ||
      !userAdminForm.password.trim()
    ) {
      return
    }

    setUsersLoading(true)
    setUsersFeedback(null)

    if (userAdminForm.editingUsername) {
      const { error } = await client
        .from('usuarios')
        .update({
          username: userAdminForm.username.trim(),
          cedula: userAdminForm.cedula.trim(),
          nombre: userAdminForm.nombre.trim() || null,
          password: userAdminForm.password.trim(),
          typeuser: userAdminForm.typeuser,
        })
        .eq('username', userAdminForm.editingUsername)

      if (error) {
        setUsersFeedback(error.message)
        setUsersLoading(false)
        return
      }

      setUsersFeedback('Usuario actualizado correctamente.')
    } else {
      const { data, error } = await client
        .from('usuarios')
        .insert({
          username: userAdminForm.username.trim(),
          cedula: userAdminForm.cedula.trim(),
          nombre: userAdminForm.nombre.trim() || `Usuario ${userAdminForm.cedula.trim()}`,
          password: userAdminForm.password.trim(),
          typeuser: userAdminForm.typeuser,
        })
        .select('id')
        .single()

      if (error) {
        setUsersFeedback(error.message)
        setUsersLoading(false)
        return
      }

      if (data?.id) {
        const { error: configError } = await client.from('configuracion').upsert(
          {
            usuario_id: data.id,
          },
          { onConflict: 'usuario_id' },
        )

        if (configError) {
          setUsersFeedback(configError.message)
          setUsersLoading(false)
          return
        }

        const defaultCategoryRows = defaultCategories.map((category, index) => ({
          usuario_id: data.id,
          app_id: `category:${index}:${String(category).toLowerCase()}`,
          nombre: category,
          posicion: index,
          es_sistema: true,
        }))

        const { error: categoriesError } = await client.from('categorias').upsert(defaultCategoryRows, {
          onConflict: 'usuario_id,app_id',
        })

        if (categoriesError) {
          setUsersFeedback(categoriesError.message)
          setUsersLoading(false)
          return
        }

        const defaultPocketRows = initialState.pockets.map((pocket, index) => ({
          usuario_id: data.id,
          app_id: pocket.id,
          nombre: pocket.name,
          color: pocket.color,
          icono: pocket.icon,
          tipo: pocket.type,
          posicion: index,
          archivado: false,
        }))

        const { error: pocketsError } = await client.from('bolsillos').upsert(defaultPocketRows, {
          onConflict: 'usuario_id,app_id',
        })

        if (pocketsError) {
          setUsersFeedback(pocketsError.message)
          setUsersLoading(false)
          return
        }
      }

      setUsersFeedback('Usuario creado correctamente.')
    }

    resetUserAdminForm()
    await loadManagedUsers()
  }

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!authForm.username.trim() || !authForm.password.trim()) return
    if (authMode === 'register' && !authForm.cedula.trim()) return

    setIsSubmittingAuth(true)
    setAuthFeedback(null)

    const result =
      authMode === 'login'
        ? await auth.signIn(authForm.username.trim(), authForm.password)
        : await auth.signUp(authForm.username.trim(), authForm.cedula.trim(), authForm.password)

    setIsSubmittingAuth(false)

    if (result.error) {
      setAuthFeedback(result.error)
      return
    }

    setAuthFeedback(
      authMode === 'login'
        ? 'Sesion iniciada correctamente.'
        : 'Usuario creado correctamente.',
    )
  }

  function renderActiveForm() {
    if (activeModule === 'gasto') {
      return (
        <form className="bank-form" onSubmit={handleAddExpense}>
          <label>
            Descripcion del gasto
            <input
              value={expenseForm.description}
              onChange={(event) => setExpenseForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Ej. Uber oficina, mercado, restaurante"
            />
          </label>
          <div className="form-grid two">
            <label>
              Monto
              <input
                type="number"
                value={expenseForm.amount}
                onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder="85000"
              />
            </label>
            <label>
              Bolsillo
              <select
                value={expenseForm.pocketId}
                onChange={(event) => setExpenseForm((current) => ({ ...current, pocketId: event.target.value }))}
              >
                {state.pockets.map((pocket) => (
                  <option key={pocket.id} value={pocket.id}>
                    {pocket.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Fecha del movimiento
            <input
              type="date"
              value={expenseForm.date}
              onChange={(event) => setExpenseForm((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <div className="smart-box">
            <span>Categoria sugerida</span>
            <strong>{suggestion.category}</strong>
            <p>Confianza estimada: {Math.round(suggestion.confidence * 100)}%</p>
            <p>
              {suggestion.matches.length > 0
                ? `Pistas detectadas: ${suggestion.matches.join(', ')}`
                : 'Sin reglas previas suficientes. Esta sugerencia usa coincidencias generales.'}
            </p>
          </div>
          <button type="submit">{expenseForm.id ? 'Guardar gasto' : 'Registrar salida'}</button>
          {expenseForm.id && (
            <button
              type="button"
              className="secondary-button cancel-action"
              onClick={() => {
                resetExpenseForm()
                setOpenComposer(null)
              }}
            >
              Cancelar edicion
            </button>
          )}
        </form>
      )
    }

    if (activeModule === 'ingreso') {
      return (
        <form className="bank-form" onSubmit={handleAddIncome}>
          <label>
            Concepto del ingreso
            <input
              value={incomeForm.title}
              onChange={(event) => setIncomeForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Ej. nomina, freelance, devolucion"
            />
          </label>
          <div className="form-grid two">
            <label>
              Monto
              <input
                type="number"
                value={incomeForm.amount}
                onChange={(event) => setIncomeForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder="5200000"
              />
            </label>
            <label>
              Bolsillo destino
              <select
                value={incomeForm.pocketId}
                onChange={(event) => setIncomeForm((current) => ({ ...current, pocketId: event.target.value }))}
              >
                {state.pockets.map((pocket) => (
                  <option key={pocket.id} value={pocket.id}>
                    {pocket.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Fecha del movimiento
            <input
              type="date"
              value={incomeForm.date}
              onChange={(event) => setIncomeForm((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={incomeForm.recurring}
              onChange={(event) => setIncomeForm((current) => ({ ...current, recurring: event.target.checked }))}
            />
            <span>Marcar como ingreso recurrente</span>
          </label>
          <button type="submit">{incomeForm.id ? 'Guardar ingreso' : 'Registrar ingreso'}</button>
          {incomeForm.id && (
            <button
              type="button"
              className="secondary-button cancel-action"
              onClick={() => {
                resetIncomeForm()
                setOpenComposer(null)
              }}
            >
              Cancelar edicion
            </button>
          )}
        </form>
      )
    }

    if (activeModule === 'transferencia') {
      return (
        <form className="bank-form" onSubmit={handleAddTransfer}>
          <div className="form-grid two">
            <label>
              Desde bolsillo
              <select
                value={transferForm.fromPocketId}
                onChange={(event) => setTransferForm((current) => ({ ...current, fromPocketId: event.target.value }))}
              >
                {state.pockets.map((pocket) => (
                  <option key={pocket.id} value={pocket.id}>
                    {pocket.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hacia bolsillo
              <select
                value={transferForm.toPocketId}
                onChange={(event) => setTransferForm((current) => ({ ...current, toPocketId: event.target.value }))}
              >
                {state.pockets.map((pocket) => (
                  <option key={pocket.id} value={pocket.id}>
                    {pocket.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid two">
            <label>
              Monto
              <input
                type="number"
                value={transferForm.amount}
                onChange={(event) => setTransferForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder="250000"
              />
            </label>
            <label>
              Nota
              <input
                value={transferForm.note}
                onChange={(event) => setTransferForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Ej. provision fin de mes"
              />
            </label>
          </div>
          <label>
            Fecha del movimiento
            <input
              type="date"
              value={transferForm.date}
              onChange={(event) => setTransferForm((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <button type="submit">
            {transferForm.id ? 'Guardar transferencia' : 'Ejecutar transferencia'}
          </button>
          {transferForm.id && (
            <button
              type="button"
              className="secondary-button cancel-action"
              onClick={() => {
                resetTransferForm()
                setOpenComposer(null)
              }}
            >
              Cancelar edicion
            </button>
          )}
        </form>
      )
    }

    if (activeModule === 'fijos') {
      return (
        <form className="bank-form" onSubmit={handleAddFixedExpense}>
          <label>
            Nombre del gasto fijo
            <input
              value={fixedForm.title}
              onChange={(event) => setFixedForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Ej. arriendo, internet, seguro"
            />
          </label>
          <div className="form-grid three">
            <label>
              Monto mensual
              <input
                type="number"
                value={fixedForm.amount}
                onChange={(event) => setFixedForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder="184000"
              />
            </label>
            <label>
              Dia de pago
              <input
                type="number"
                min="1"
                max="31"
                value={fixedForm.dueDay}
                onChange={(event) => setFixedForm((current) => ({ ...current, dueDay: event.target.value }))}
              />
            </label>
            <label>
              Dia de confirmacion
              <input
                type="number"
                min="1"
                max="31"
                value={fixedForm.confirmationDay}
                onChange={(event) =>
                  setFixedForm((current) => ({ ...current, confirmationDay: event.target.value }))
                }
              />
            </label>
            <label>
              Categoria
              <select
                value={fixedForm.category}
                onChange={(event) =>
                  setFixedForm((current) => ({ ...current, category: event.target.value as Category }))
                }
              >
                {state.categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Bolsillo pagador
            <select
              value={fixedForm.pocketId}
              onChange={(event) => setFixedForm((current) => ({ ...current, pocketId: event.target.value }))}
            >
              {state.pockets.map((pocket) => (
                <option key={pocket.id} value={pocket.id}>
                  {pocket.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">{fixedForm.id ? 'Guardar obligacion' : 'Registrar obligacion'}</button>
          {fixedForm.id && (
            <button
              type="button"
              className="secondary-button cancel-action"
              onClick={() => {
                resetFixedForm()
                setOpenComposer(null)
              }}
            >
              Cancelar edicion
            </button>
          )}
        </form>
      )
    }

    return (
      <form className="bank-form" onSubmit={handleAddPocket}>
        <label>
          Nombre del bolsillo
          <input
            value={pocketForm.name}
            onChange={(event) => setPocketForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Ej. emergencia, viajes, impuestos"
          />
        </label>
        <div className="form-grid three">
          <label>
            Tipo
            <select
              value={pocketForm.type}
              onChange={(event) =>
                setPocketForm((current) => ({
                  ...current,
                  type: event.target.value as PocketType,
                  icon: current.icon === getDefaultIcon(current.type) ? getDefaultIcon(event.target.value as PocketType) : current.icon,
                }))
              }
            >
              <option value="daily">Operacion</option>
              <option value="savings">Ahorro</option>
              <option value="fixed">Pagos fijos</option>
              <option value="invest">Meta o inversion</option>
            </select>
          </label>
          <label>
            Color
            <input
              type="color"
              value={pocketForm.color}
              onChange={(event) => setPocketForm((current) => ({ ...current, color: event.target.value }))}
            />
          </label>
          <label>
            Icono
            <select
              value={pocketForm.icon}
              onChange={(event) => setPocketForm((current) => ({ ...current, icon: event.target.value }))}
            >
              {pocketIcons.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="pocket-preview">
          <span className="icon-badge large" style={{ background: pocketForm.color }}>
            {pocketForm.icon}
          </span>
          <div>
            <strong>{pocketForm.name || 'Nuevo bolsillo'}</strong>
            <p>Saldo inicial {money.format(0)}</p>
          </div>
        </div>
        <button type="submit">{pocketForm.id ? 'Guardar bolsillo' : 'Crear bolsillo'}</button>
        {pocketForm.id && (
          <div className="composer-action-row">
            <button
              type="button"
              className="secondary-button delete-action"
              onClick={() => handleDeletePocket(pocketForm.id)}
            >
              Eliminar bolsillo
            </button>
            <button
              type="button"
              className="secondary-button cancel-action"
              onClick={() => {
                resetPocketForm()
                setOpenComposer(null)
              }}
            >
              Cancelar edicion
            </button>
          </div>
        )}
      </form>
    )
  }

  function renderSummaryView() {
    return (
      <>
        <section className="hero-grid">
          <article className="portfolio-card">
            <div className="portfolio-head">
              <div>
                <span className="micro-label">Posicion consolidada</span>
                <strong>{money.format(totals.pocketBalance)}</strong>
              </div>
              <small>{totals.netFlow >= 0 ? 'Flujo positivo' : 'Flujo negativo'}</small>
            </div>
            <div className="portfolio-metrics">
              <div>
                <span>Ingresos</span>
                <strong>{money.format(totals.totalIncomes)}</strong>
              </div>
              <div>
                <span>Gastos</span>
                <strong>{money.format(totals.totalExpenses)}</strong>
              </div>
              <div>
                <span>Neto</span>
                <strong>{money.format(totals.netFlow)}</strong>
              </div>
            </div>
          </article>

          <article className="quick-stats">
            <div className="quick-stat">
              <span>Transferencias</span>
              <strong>{monthTransfers.length}</strong>
            </div>
            <div className="quick-stat">
              <span>Pagados</span>
              <strong>{fixedStatus.paid.length}</strong>
            </div>
            <div className="quick-stat">
              <span>Vencidos</span>
              <strong>{fixedStatus.overdue.length}</strong>
            </div>
            <div className="quick-stat">
              <span>Cierre mensual</span>
              <strong>{currentMonthClosed ? 'Cerrado' : 'Abierto'}</strong>
            </div>
          </article>
        </section>

        <section className="analytics-grid">
          <article className="panel banking-panel analytics-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Flujo</span>
                <h2>Lectura financiera</h2>
              </div>
            </div>
            <div className="flow-metric-list">
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <span>Ingresos del mes</span>
                  <strong>{money.format(totals.totalIncomes)}</strong>
                </div>
                <div className="flow-bar income">
                  <div style={{ width: `${(totals.totalIncomes / summaryAnalytics.maxFlowBase) * 100}%` }} />
                </div>
              </div>
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <span>Gastos del mes</span>
                  <strong>{money.format(totals.totalExpenses)}</strong>
                </div>
                <div className="flow-bar expense">
                  <div style={{ width: `${(totals.totalExpenses / summaryAnalytics.maxFlowBase) * 100}%` }} />
                </div>
              </div>
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <span>Deuda pendiente</span>
                  <strong>{money.format(totals.pendingDebt)}</strong>
                </div>
                <div className="flow-bar debt">
                  <div style={{ width: `${(totals.pendingDebt / summaryAnalytics.maxFlowBase) * 100}%` }} />
                </div>
              </div>
            </div>
          </article>

          <article className="panel banking-panel analytics-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Categorias</span>
                <h2>Distribucion del gasto</h2>
              </div>
            </div>
            <div className="category-analytics">
              {summaryAnalytics.categoryBreakdown.map((item) => (
                <div key={item.category} className="analytics-row">
                  <div className="analytics-row-head">
                    <span>{item.category}</span>
                    <strong>{money.format(item.total)}</strong>
                  </div>
                  <div className="flow-bar neutral">
                    <div style={{ width: `${item.ratio * 100}%` }} />
                  </div>
                </div>
              ))}
              {summaryAnalytics.categoryBreakdown.length === 0 && (
                <p className="empty-copy">Todavia no hay gasto suficiente para dibujar categorias.</p>
              )}
            </div>
          </article>

          <article className="panel banking-panel analytics-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Comparativo</span>
                <h2>Mes contra mes</h2>
              </div>
            </div>
            <div className="flow-metric-list">
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <span>Ingresos {previousMonthKey}</span>
                  <strong>{money.format(previousClosure?.income ?? totals.previousIncomes)}</strong>
                </div>
                <div className="flow-bar income">
                  <div
                    style={{
                      width: `${((previousClosure?.income ?? totals.previousIncomes) / summaryAnalytics.maxFlowBase) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <span>Gastos {previousMonthKey}</span>
                  <strong>{money.format(previousClosure?.expense ?? totals.previousExpenses)}</strong>
                </div>
                <div className="flow-bar expense">
                  <div
                    style={{
                      width: `${((previousClosure?.expense ?? totals.previousExpenses) / summaryAnalytics.maxFlowBase) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <span>Ratio deuda / ingreso</span>
                  <strong>{Math.round(totals.debtToIncomeRatio * 100)}%</strong>
                </div>
                <div className="flow-bar debt">
                  <div style={{ width: `${Math.min(totals.debtToIncomeRatio * 100, 100)}%` }} />
                </div>
              </div>
            </div>
          </article>

          <article className="panel banking-panel analytics-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Bolsillos</span>
                <h2>Distribucion del saldo</h2>
              </div>
            </div>
            <div className="pocket-analytics">
              {summaryAnalytics.pocketBreakdown.map((item) => {
                const maxPocketBase = Math.max(
                  ...summaryAnalytics.pocketBreakdown.map((entry) => Math.abs(entry.balance)),
                  1,
                )

                return (
                  <div key={item.id} className="analytics-row">
                    <div className="analytics-row-head">
                      <span className="analytics-pocket-name">
                        <span className="icon-badge inline" style={{ background: item.color }}>
                          {item.icon}
                        </span>
                        {item.name}
                      </span>
                      <strong>{money.format(item.balance)}</strong>
                    </div>
                    <div className={item.balance >= 0 ? 'flow-bar income' : 'flow-bar expense'}>
                      <div style={{ width: `${(Math.abs(item.balance) / maxPocketBase) * 100}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </article>

          <article className="panel banking-panel analytics-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Deudas</span>
                <h2>Amortizacion activa</h2>
              </div>
            </div>
            <div className="debt-analytics">
              {summaryAnalytics.debtBreakdown.map((debt) => (
                <div key={debt.id} className="analytics-row">
                  <div className="analytics-row-head">
                    <span>{debt.title}</span>
                    <strong>{money.format(debt.remainingAmount)}</strong>
                  </div>
                  <div className="flow-bar debt">
                    <div style={{ width: `${debt.ratio * 100}%` }} />
                  </div>
                  <p className="movement-detail">
                    Pagado {money.format(debt.paidAmount)} de {money.format(debt.totalAmount)}
                  </p>
                  <p className="movement-detail">Cierre estimado: {debt.estimatedPayoffMonth}</p>
                </div>
              ))}
              {summaryAnalytics.debtBreakdown.length === 0 && (
                <p className="empty-copy">No hay deudas activas para analizar.</p>
              )}
            </div>
          </article>

          <article className="panel banking-panel analytics-panel wide-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Tendencia</span>
                <h2>Flujo diario del mes</h2>
              </div>
              <button type="button" className="action-trigger ghost" onClick={handleCloseMonth}>
                {currentMonthClosed ? 'Mes cerrado' : 'Cerrar mes'}
              </button>
            </div>
            <div className="daily-trend-board">
              {summaryAnalytics.dailyTrend.map((item) => (
                <div key={item.date} className="daily-trend-bar">
                  <div
                    className={item.net >= 0 ? 'trend-fill positive' : 'trend-fill negative'}
                    style={{
                      height: `${Math.max((Math.abs(item.net) / summaryAnalytics.maxDailyNet) * 100, 6)}%`,
                    }}
                  />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel banking-panel analytics-panel wide-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Tendencia</span>
                <h2>Ultimos seis meses</h2>
              </div>
            </div>
            <div className="monthly-trend-board">
              {summaryAnalytics.monthTrend.map((item) => (
                <div key={item.monthKey} className="monthly-trend-row">
                  <div>
                    <strong>{item.monthKey}</strong>
                    <p className="movement-detail">Neto {money.format(item.net)}</p>
                  </div>
                  <div className="monthly-trend-bars">
                    <div className="flow-bar income">
                      <div style={{ width: `${(item.income / summaryAnalytics.maxTrendBase) * 100}%` }} />
                    </div>
                    <div className="flow-bar expense">
                      <div style={{ width: `${(item.expense / summaryAnalytics.maxTrendBase) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="dashboard-grid">
          <div className="primary-column">
            <section className="panel banking-panel emphasis">
              <span className="micro-label">Supervisor mensual</span>
              <h2>Estado operativo</h2>
              <p>{coachingMessage}</p>
              <div className="status-grid">
                <div>
                  <span>Pendientes</span>
                  <strong>{fixedStatus.pending.length}</strong>
                </div>
                <div>
                  <span>Pagados</span>
                  <strong>{fixedStatus.paid.length}</strong>
                </div>
              </div>
              <div className="review-list">
                {fixedStatus.review.slice(0, 3).map((item) => (
                  <div key={item.id} className="review-chip">
                    <span>{item.title}</span>
                    <strong>Confirmar dia {item.confirmationDay}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel banking-panel">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Movimientos</span>
                  <h2>Actividad reciente</h2>
                </div>
                <button className="text-link" type="button" onClick={() => jumpToView('movimientos')}>
                  Ver todos
                </button>
              </div>
              <div className="ledger">
                {activity.slice(0, 6).map((item) => (
                  <article key={item.kind + item.id} className="ledger-row">
                    <div className={`ledger-icon ${item.kind}`}></div>
                    <div className="ledger-copy">
                      <strong>{item.title}</strong>
                      <p>
                        {item.date} · {item.meta}
                      </p>
                    </div>
                    <strong className={item.amount >= 0 ? 'value-positive' : 'value-negative'}>
                      {item.amount >= 0 ? '+' : '-'}
                      {money.format(Math.abs(item.amount))}
                    </strong>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel banking-panel">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Centro transaccional</span>
                  <h2>{moduleLabels[activeModule]}</h2>
                </div>
                <p>{getModuleSummary(activeModule)}</p>
              </div>
              <div className="module-segmented">
                {(Object.keys(moduleLabels) as ModuleKey[]).map((module) => (
                  <button
                    key={module}
                    type="button"
                    className={module === activeModule ? 'segment active' : 'segment'}
                    onClick={() => setActiveModule(module)}
                  >
                    {moduleLabels[module]}
                  </button>
                ))}
              </div>
              {renderActiveForm()}
            </section>
          </div>

          <aside className="secondary-column">
            <section className="panel banking-panel">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Bolsillos</span>
                  <h2>Saldos por bolsillo</h2>
                </div>
              </div>
              <div className="account-strip">
                {state.pockets.map((pocket) => (
                  <article key={pocket.id} className="account-card">
                    <div className="account-card-top">
                      <span className="icon-badge" style={{ background: pocket.color }}>
                        {pocket.icon}
                      </span>
                      <span>{getPocketTypeLabel(pocket.type)}</span>
                    </div>
                    <strong>{pocket.name}</strong>
                    <p>{money.format(pocketBalances[pocket.id] ?? 0)}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel banking-panel">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Categorias</span>
                  <h2>Concentracion del gasto</h2>
                </div>
              </div>
              <div className="category-board">
                {topCategories.map(([category, total]) => (
                  <div key={category} className="category-tile">
                    <span>{category}</span>
                    <strong>{money.format(total)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </>
    )
  }

  function renderPocketsView() {
    if (!selectedPocket) {
      return (
        <section className="dashboard-grid">
          <div className="primary-column">
            <section className="panel banking-panel emphasis">
              <span className="micro-label">Resumen operativo</span>
              <h2>Prioridad del mes</h2>
              <p>
                {fixedStatus.overdue.length > 0
                  ? `Tienes ${fixedStatus.overdue.length} obligacion(es) vencida(s). Conviene confirmar pagos antes de mover saldo a otros bolsillos.`
                  : fixedStatus.pending.length > 0
                    ? `Aun quedan ${fixedStatus.pending.length} obligacion(es) por ejecutar o confirmar en ${currentMonthKey}.`
                    : 'Todas las obligaciones activas de este mes ya fueron confirmadas.'}
              </p>
              <div className="status-grid obligation-metrics">
                <div>
                  <span>Vencidas</span>
                  <strong>{fixedStatus.overdue.length}</strong>
                </div>
                <div>
                  <span>Revision</span>
                  <strong>{fixedStatus.review.length}</strong>
                </div>
                <div>
                  <span>Pagadas</span>
                  <strong>{fixedStatus.paid.length}</strong>
                </div>
                <div>
                  <span>Pausadas</span>
                  <strong>{fixedStatus.paused.length}</strong>
                </div>
              </div>
            </section>

            <section className="panel banking-panel">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Mapa de bolsillos</span>
                  <h2>Tus cuentas internas</h2>
                </div>
                <button
                  className="action-trigger"
                  type="button"
                  onClick={() => {
                    resetPocketForm()
                    openComposerForView('bolsillos', 'bolsillos')
                  }}
                >
                  Registrar bolsillo
                </button>
              </div>
              <p className="empty-copy">
                Todavia no hay bolsillos disponibles para este perfil. Crea uno o espera la inicializacion del perfil.
              </p>
            </section>
          </div>
        </section>
      )
    }

    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          {openComposer === 'bolsillos' && (
            <section className="panel banking-panel action-panel">
              <div className="composer-toolbar">
                <div>
                  <span className="micro-label">Accion</span>
                  <h2>{pocketForm.id ? 'Editar bolsillo' : 'Registrar bolsillo'}</h2>
                  <p>Configura nombre, tipo, color e icono para tu nuevo bolsillo.</p>
                </div>
                <button
                  type="button"
                  className="secondary-button cancel-action"
                  onClick={() => {
                    resetPocketForm()
                    setOpenComposer(null)
                  }}
                >
                  Cerrar
                </button>
              </div>
              <form className="bank-form" onSubmit={handleAddPocket}>
                <label>
                  Nombre del bolsillo
                  <input
                    value={pocketForm.name}
                    onChange={(event) =>
                      setPocketForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Ej. emergencia, viajes, impuestos"
                  />
                </label>
                <div className="form-grid three">
                  <label>
                    Tipo
                    <select
                      value={pocketForm.type}
                      onChange={(event) =>
                        setPocketForm((current) => ({
                          ...current,
                          type: event.target.value as PocketType,
                          icon:
                            current.icon === getDefaultIcon(current.type)
                              ? getDefaultIcon(event.target.value as PocketType)
                              : current.icon,
                        }))
                      }
                    >
                      <option value="daily">Operacion</option>
                      <option value="savings">Ahorro</option>
                      <option value="fixed">Pagos fijos</option>
                      <option value="invest">Meta o inversion</option>
                    </select>
                  </label>
                  <label>
                    Color
                    <input
                      type="color"
                      value={pocketForm.color}
                      onChange={(event) =>
                        setPocketForm((current) => ({ ...current, color: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Icono
                    <select
                      value={pocketForm.icon}
                      onChange={(event) =>
                        setPocketForm((current) => ({ ...current, icon: event.target.value }))
                      }
                    >
                      {pocketIcons.map((icon) => (
                        <option key={icon} value={icon}>
                          {icon}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="pocket-preview">
                  <span className="icon-badge large" style={{ background: pocketForm.color }}>
                    {pocketForm.icon}
                  </span>
                  <div>
                    <strong>{pocketForm.name || 'Nuevo bolsillo'}</strong>
                    <p>Saldo inicial {money.format(0)}</p>
                  </div>
                </div>
                <button type="submit">{pocketForm.id ? 'Guardar cambios' : 'Crear bolsillo'}</button>
                {pocketForm.id && (
                  <div className="composer-action-row">
                    <button
                      type="button"
                      className="secondary-button delete-action"
                      onClick={() => handleDeletePocket(pocketForm.id)}
                    >
                      Eliminar bolsillo
                    </button>
                    <button
                      type="button"
                      className="secondary-button cancel-action"
                      onClick={() => {
                        resetPocketForm()
                        setOpenComposer(null)
                      }}
                    >
                      Cancelar edicion
                    </button>
                  </div>
                )}
              </form>
            </section>
          )}

          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Detalle</span>
                <h2>{selectedPocket.name}</h2>
              </div>
              <button className="text-link" type="button" onClick={() => jumpToView('movimientos')}>
                Ir a movimientos
              </button>
            </div>
            <div className="pocket-summary-grid">
              <div className="summary-box">
                <span>Saldo actual</span>
                <strong>{money.format(pocketBalances[selectedPocket.id] ?? 0)}</strong>
              </div>
              <div className="summary-box">
                <span>Tipo</span>
                <strong>{getPocketTypeLabel(selectedPocket.type)}</strong>
              </div>
              <div className="summary-box accent">
                <span>Identidad</span>
                <strong>
                  <span className="icon-badge inline" style={{ background: selectedPocket.color }}>
                    {selectedPocket.icon}
                  </span>
                  {selectedPocket.name}
                </strong>
              </div>
            </div>
            <div className="ledger">
              {selectedPocketActivity.slice(0, 6).map((item) => (
                <article key={item.kind + item.id} className="ledger-row">
                  <div className={`ledger-icon ${item.kind}`}></div>
                  <div className="ledger-copy">
                    <strong>{item.title}</strong>
                    <p>
                      {item.date} · {item.meta}
                    </p>
                  </div>
                  <strong className={item.amount >= 0 ? 'value-positive' : 'value-negative'}>
                    {item.amount >= 0 ? '+' : '-'}
                    {money.format(Math.abs(item.amount))}
                  </strong>
                </article>
              ))}
            </div>
          </section>

          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Mapa de bolsillos</span>
                <h2>Tus cuentas internas</h2>
              </div>
              <button
                className="action-trigger"
                type="button"
                onClick={() => {
                  resetPocketForm()
                  openComposerForView('bolsillos', 'bolsillos')
                }}
              >
                Registrar bolsillo
              </button>
            </div>
            <div className="account-strip two-cols">
              {state.pockets.map((pocket) => (
                <article
                  key={pocket.id}
                  className={pocket.id === selectedPocketId ? 'account-card selected' : 'account-card'}
                  onClick={() => setSelectedPocketId(pocket.id)}
                >
                  <div className="account-card-top">
                    <div className="card-heading-inline">
                      <span className="icon-badge" style={{ background: pocket.color }}>
                        {pocket.icon}
                      </span>
                      <span>{getPocketTypeLabel(pocket.type)}</span>
                    </div>
                    <button
                      type="button"
                      className="edit-icon-button"
                      aria-label={`Editar bolsillo ${pocket.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        startEditPocket(pocket.id)
                      }}
                    >
                      ✎
                    </button>
                  </div>
                  <strong>{pocket.name}</strong>
                  <p>{money.format(pocketBalances[pocket.id] ?? 0)}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    )
  }

  function renderMovementsView() {
    return (
      <>
        {openComposer === 'movimientos' && (
          <FullscreenComposer
            isOpen={openComposer === 'movimientos'}
            label="Registrar"
            title={moduleLabels[activeModule]}
            description={getModuleSummary(activeModule)}
            onClose={() => {
              resetExpenseForm()
              resetIncomeForm()
              resetTransferForm()
              setOpenComposer(null)
            }}
            toolbarContent={
              <div className="module-segmented">
                {(['gasto', 'ingreso', 'transferencia'] as ModuleKey[]).map((module) => (
                  <button
                    key={module}
                    type="button"
                    className={module === activeModule ? 'segment active' : 'segment'}
                    onClick={() => setActiveModule(module)}
                  >
                    {moduleLabels[module]}
                  </button>
                ))}
              </div>
            }
          >
            {renderActiveForm()}
          </FullscreenComposer>
        )}

        <section className="panel banking-panel movement-command-center">
          <div className="movement-command-header">
            <div>
              <span className="micro-label">Filtro operativo</span>
              <h2>Centro de movimientos</h2>
              <p className="movement-detail">
                Consulta, registra y exporta la actividad del mes sin perder contexto del bolsillo y el tipo de movimiento.
              </p>
            </div>
          </div>

          <div className="movement-command-nav">
            <div className="movement-command-actions">
              <div className="movement-command-badge">
                <span>Mes activo</span>
                <strong>{movementMonthKey}</strong>
              </div>
              <div className="movement-command-badge">
                <span>Resultados</span>
                <strong>{movementSummary.count}</strong>
              </div>
              <div className="movement-command-buttons">
                <button
                  className="action-trigger"
                  type="button"
                  onClick={() => {
                    resetExpenseForm()
                    resetIncomeForm()
                    resetTransferForm()
                    openComposerForView('movimientos', 'gasto')
                  }}
                >
                  Registrar movimiento
                </button>
                <button className="secondary-button" type="button" onClick={handleExportMovements}>
                  Exportar CSV
                </button>
              </div>
            </div>
          </div>

          <div className="movement-filter-layout">
            <div className="movement-filter-row movement-filter-row-primary">
              <div className="filter-field month-field compact inline">
                <span className="filter-field-label">Mes</span>
                <input
                  type="month"
                  value={movementMonthKey}
                  onChange={(event) => setMovementMonthKey(event.target.value)}
                />
              </div>
              <div className="filter-field search-field expanded inline">
                <span className="filter-field-label">Buscar</span>
                <input
                  value={movementFilters.query}
                  onChange={(event) =>
                    setMovementFilters((current) => ({ ...current, query: event.target.value }))
                  }
                  placeholder="Descripcion, bolsillo o categoria"
                />
              </div>
            </div>

            <div className="movement-filter-row movement-filter-row-secondary">
              <div className="filter-field filter-select-card compact inline">
                <span className="filter-field-label">Bolsillo</span>
                <div className="filter-select-wrap">
                  <select
                    value={movementFilters.pocketId}
                    onChange={(event) =>
                      setMovementFilters((current) => ({ ...current, pocketId: event.target.value }))
                    }
                  >
                    <option value="todos">Todos los bolsillos</option>
                    {state.pockets.map((pocket) => (
                      <option key={pocket.id} value={pocket.id}>
                        {pocket.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="filter-field filter-select-card compact inline">
                <span className="filter-field-label">Tipo</span>
                <div className="filter-select-wrap">
                  <select
                    value={movementFilters.kind}
                    onChange={(event) =>
                      setMovementFilters((current) => ({
                        ...current,
                        kind: event.target.value as 'todos' | MovementKind,
                      }))
                    }
                  >
                    <option value="todos">Todos</option>
                    <option value="gasto">Gastos</option>
                    <option value="ingreso">Ingresos</option>
                    <option value="transferencia">Transferencias</option>
                  </select>
                </div>
              </div>
              <div className="filter-field grouping-field compact inline">
                <span className="filter-field-label">Agrupacion</span>
                <div className="module-segmented compact">
                  {(['dia', 'mes'] as const).map((groupBy) => (
                    <button
                      key={groupBy}
                      type="button"
                      className={movementFilters.groupBy === groupBy ? 'segment active' : 'segment'}
                      onClick={() => setMovementFilters((current) => ({ ...current, groupBy }))}
                    >
                      {groupBy === 'dia' ? 'Por dia' : 'Por mes'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="movement-filter-strip">
            <span className="movement-filter-strip-label">Filtro activo</span>
            <strong>
              {movementFilters.pocketId === 'todos'
                ? 'Vista global'
                : getPocketName(state.pockets, movementFilters.pocketId)}
            </strong>
            <span>
              {movementFilters.kind === 'todos'
                ? 'Todos los tipos'
                : `Solo ${movementFilters.kind}`}
            </span>
            <span>Mes consultado: {movementMonthKey}</span>
          </div>

          <div className="movement-summary-grid refined">
              <div className="summary-box movement-stat income">
                <span>Entradas filtradas</span>
                <strong>{money.format(movementSummary.inflow)}</strong>
              </div>
              <div className="summary-box movement-stat expense">
                <span>Salidas filtradas</span>
                <strong>{money.format(movementSummary.outflow)}</strong>
              </div>
              <div className="summary-box movement-stat transfer">
                <span>Transferencias</span>
                <strong>{movementSummary.transfers}</strong>
              </div>
          </div>
        </section>

        <section className="movement-content-stack">
          <section className="panel banking-panel movement-ledger-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Libro mayor</span>
                <h2>Detalle de movimientos</h2>
              </div>
              <p>{filteredActivity.length} registros visibles</p>
            </div>
            <div className="ledger grouped-ledger">
              {Object.entries(groupedFilteredActivity).map(([groupKey, items]) => (
                <section key={groupKey} className="movement-group">
                  <div className="movement-group-head">
                    <strong>{groupKey}</strong>
                    <span>{items.length} registro(s)</span>
                  </div>
                  {items.map((item) => (
                    <article key={item.kind + item.id} className={`ledger-row movement-row ${item.kind}`}>
                      <div className={`ledger-icon ${item.kind}`}></div>
                      <div className="ledger-copy">
                        <strong>{item.title}</strong>
                        <p>
                          {item.date} · {item.meta}
                        </p>
                        <p className="movement-detail">{item.detail}</p>
                      </div>
                      <div className="movement-actions">
                        <strong className={item.amount >= 0 ? 'value-positive' : 'value-negative'}>
                          {item.amount >= 0 ? '+' : '-'}
                          {money.format(Math.abs(item.amount))}
                        </strong>
                        {(item.editable || item.deletable) && (
                          <div className="movement-action-row">
                            {item.editable && (
                              <button
                                type="button"
                                className="edit-icon-button inline"
                                aria-label={`Editar movimiento ${item.title}`}
                                onClick={() => startEditMovement(item.kind, item.id)}
                              >
                                ✎
                              </button>
                            )}
                            {item.deletable && (
                              <button
                                type="button"
                                className="text-link compact danger"
                                onClick={() => handleDeleteMovement(item.kind, item.id)}
                              >
                                Eliminar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              ))}
              {filteredActivity.length === 0 && (
                <p className="empty-copy">No hay movimientos con los filtros seleccionados.</p>
              )}
            </div>
          </section>

          <section className="movement-insight-grid">
            <section className="panel banking-panel">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Lectura rapida</span>
                  <h2>Saldo por bolsillo</h2>
                </div>
              </div>
              <div className="pocket-list-compact movement-pocket-grid">
                {state.pockets.map((pocket) => (
                  <article key={pocket.id} className="compact-pocket-row">
                    <div className="compact-pocket-name">
                      <span className="icon-badge inline" style={{ background: pocket.color }}>
                        {pocket.icon}
                      </span>
                      <strong>{pocket.name}</strong>
                    </div>
                    <span>{money.format(pocketBalances[pocket.id] ?? 0)}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel banking-panel">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Clasificacion</span>
                  <h2>Revisar IA</h2>
                </div>
              </div>
              <div className="ledger">
                {movementMonthExpenses.slice(0, 4).map((expense) => (
                  <article key={expense.id} className="ledger-row editable">
                    <div className="ledger-copy">
                      <strong>{expense.description}</strong>
                      <p>
                        {expense.date} · {getPocketName(state.pockets, expense.pocketId)}
                      </p>
                    </div>
                    <div className="ledger-actions">
                      <span>{money.format(expense.amount)}</span>
                      <select
                        value={expense.category}
                        onChange={(event) =>
                          handleCategoryCorrection(expense.id, event.target.value as Category)
                        }
                      >
                        {state.categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
                {movementMonthExpenses.length === 0 && (
                  <p className="empty-copy">Sin gastos para auditar este mes.</p>
                )}
              </div>
            </section>
          </section>
        </section>
      </>
    )
  }

  function renderProgrammingView() {
    const fixedPaymentTarget = fixedPaymentDraft
      ? state.fixedExpenses.find((item) => item.id === fixedPaymentDraft.fixedId) ?? null
      : null
    const fixedPaymentIsDueOrPast = fixedPaymentTarget ? fixedPaymentTarget.dueDay <= currentDay : false

    return (
      <>
        {openComposer === 'programacion' && (
          <FullscreenComposer
            isOpen={openComposer === 'programacion'}
            label="Nueva obligacion"
            title={fixedForm.id ? 'Editar obligacion' : 'Registrar obligacion'}
            description="Define monto, bolsillo, categoria y dias de pago y confirmacion."
            onClose={() => {
              resetFixedForm()
              setOpenComposer(null)
            }}
          >
            {renderActiveForm()}
          </FullscreenComposer>
        )}

        {fixedPaymentDraft && fixedPaymentTarget && (
          <FullscreenComposer
            isOpen={Boolean(fixedPaymentDraft && fixedPaymentTarget)}
            label="Confirmacion"
            title={fixedPaymentIsDueOrPast ? 'Confirmar pago de obligacion' : 'Adelantar pago de obligacion'}
            description="Valida el valor, la fecha efectiva y el bolsillo desde el que saldra el pago."
            onClose={closeFixedPaymentConfirmation}
          >
            <form className="bank-form obligation-payment-form" onSubmit={handleConfirmFixedPayment}>
              <section className="payment-confirmation-card">
                <div className="payment-confirmation-head">
                  <div>
                    <span className="micro-label">Obligacion</span>
                    <h3>{fixedPaymentTarget.title}</h3>
                  </div>
                  <strong>{money.format(fixedPaymentTarget.amount)}</strong>
                </div>
                <div className="payment-confirmation-grid">
                  <div className="summary-box">
                    <span>Categoria</span>
                    <strong>{fixedPaymentTarget.category}</strong>
                  </div>
                  <div className="summary-box">
                    <span>Dia programado</span>
                    <strong>{fixedPaymentTarget.dueDay}</strong>
                  </div>
                  <div className="summary-box">
                    <span>Confirmacion</span>
                    <strong>Dia {fixedPaymentTarget.confirmationDay}</strong>
                  </div>
                </div>
              </section>

              <div className="form-grid two">
                <label>
                  Fecha del pago
                  <input
                    type="date"
                    value={fixedPaymentDraft.paymentDate}
                    onChange={(event) =>
                      setFixedPaymentDraft((current) =>
                        current ? { ...current, paymentDate: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <label>
                  Bolsillo desde el que se paga
                  <select
                    value={fixedPaymentDraft.pocketId}
                    onChange={(event) =>
                      setFixedPaymentDraft((current) =>
                        current ? { ...current, pocketId: event.target.value } : current,
                      )
                    }
                  >
                    {state.pockets.map((pocket) => (
                      <option key={pocket.id} value={pocket.id}>
                        {pocket.name} · {money.format(pocketBalances[pocket.id] ?? 0)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <section className="payment-confirmation-card compact">
                <div className="status-grid obligation-payment-metrics">
                  <div>
                    <span>Accion</span>
                    <strong>{fixedPaymentIsDueOrPast ? 'Confirmar pagado' : 'Adelantar pago'}</strong>
                  </div>
                  <div>
                    <span>Se registrara como</span>
                    <strong>Gasto fijo</strong>
                  </div>
                </div>
              </section>

              <div className="composer-action-row">
                <button
                  type="submit"
                  className={fixedPaymentIsDueOrPast ? 'warning-button' : undefined}
                >
                  {fixedPaymentIsDueOrPast ? 'Confirmar pagado' : 'Adelantar pago'}
                </button>
                <button
                  type="button"
                  className="secondary-button cancel-action"
                  onClick={closeFixedPaymentConfirmation}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </FullscreenComposer>
        )}

        <section className="dashboard-grid">
          <div className="primary-column">
            <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Calendario financiero</span>
                <h2>Obligaciones</h2>
              </div>
              <div className="panel-header-actions">
                <p>{fixedStatus.pending.length} pendientes este mes</p>
                <button
                  className="action-trigger"
                  type="button"
                  onClick={() => {
                    resetFixedForm()
                    openComposerForView('programacion', 'fijos')
                  }}
                >
                  Registrar obligacion
                </button>
              </div>
            </div>
            <section className="obligation-overview-board">
              <article className="obligation-hero-card">
                <div className="obligation-hero-head">
                  <div>
                    <span className="micro-label">Carga mensual</span>
                    <h3>{money.format(obligationSummary.totalActiveAmount)}</h3>
                  </div>
                  <small>{fixedStatus.pending.length} por confirmar este mes</small>
                </div>
                <div className="obligation-hero-metrics">
                  <div>
                    <span>Pendiente</span>
                    <strong>{money.format(obligationSummary.totalPendingAmount)}</strong>
                  </div>
                  <div>
                    <span>Activas</span>
                    <strong>{fixedStatus.activeItems.length}</strong>
                  </div>
                  <div>
                    <span>Pagadas</span>
                    <strong>{fixedStatus.paid.length}</strong>
                  </div>
                  <div>
                    <span>Pausadas</span>
                    <strong>{fixedStatus.paused.length}</strong>
                  </div>
                </div>
              </article>

              <div className="obligation-insight-grid">
                <article className="summary-box accent">
                  <span>Dia con mayor carga</span>
                  <strong>
                    {obligationSummary.heaviestDueDay
                      ? `Dia ${obligationSummary.heaviestDueDay.day}`
                      : 'Sin carga'}
                  </strong>
                  <p className="movement-detail">
                    {obligationSummary.heaviestDueDay
                      ? money.format(obligationSummary.heaviestDueDay.total)
                      : 'Aun no hay obligaciones activas'}
                  </p>
                </article>
                <article className="summary-box">
                  <span>Obligacion mas pesada</span>
                  <strong>{obligationSummary.highestObligation?.title ?? 'Sin datos'}</strong>
                  <p className="movement-detail">
                    {obligationSummary.highestObligation
                      ? money.format(obligationSummary.highestObligation.amount)
                      : 'Sin obligaciones activas'}
                  </p>
                </article>
                <article className="summary-box">
                  <span>En revision hoy</span>
                  <strong>{fixedStatus.review.length}</strong>
                  <p className="movement-detail">
                    {fixedStatus.overdue.length} vencida(s) y {fixedStatus.pending.length - fixedStatus.overdue.length}{' '}
                    pendiente(s)
                  </p>
                </article>
              </div>
            </section>

            <section className="obligation-agenda-grid">
              <article className="panel banking-panel obligation-agenda-panel">
                <div className="panel-header">
                  <div>
                    <span className="micro-label">Agenda</span>
                    <h3>Proximos pagos</h3>
                  </div>
                </div>
                <div className="obligation-agenda-list">
                  {obligationSummary.nextDeadlines.map((item) => (
                    <div key={item.id} className="compact-pocket-row obligation-agenda-row">
                      <div>
                        <strong>{item.title}</strong>
                        <p className="movement-detail">
                          Dia {item.dueDay} · {getPocketName(state.pockets, item.pocketId)}
                        </p>
                      </div>
                      <span>{money.format(item.amount)}</span>
                    </div>
                  ))}
                  {obligationSummary.nextDeadlines.length === 0 && (
                    <p className="empty-copy">No hay pagos pendientes por agendar.</p>
                  )}
                </div>
              </article>

              <article className="panel banking-panel obligation-agenda-panel">
                <div className="panel-header">
                  <div>
                    <span className="micro-label">Control</span>
                    <h3>Proximas confirmaciones</h3>
                  </div>
                </div>
                <div className="obligation-agenda-list">
                  {obligationSummary.nextConfirmations.map((item) => (
                    <div key={item.id} className="compact-pocket-row obligation-agenda-row">
                      <div>
                        <strong>{item.title}</strong>
                        <p className="movement-detail">
                          Confirmar dia {item.confirmationDay} · {item.category}
                        </p>
                      </div>
                      <span>{money.format(item.amount)}</span>
                    </div>
                  ))}
                  {obligationSummary.nextConfirmations.length === 0 && (
                    <p className="empty-copy">No hay confirmaciones pendientes.</p>
                  )}
                </div>
              </article>
            </section>

            <section className="obligation-list-board">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Listado operativo</span>
                  <h3>Obligaciones registradas</h3>
                </div>
                <p>{state.fixedExpenses.length} registro(s)</p>
              </div>
              <div className="fixed-stack">
              {state.fixedExpenses
                .sort((a, b) => a.dueDay - b.dueDay)
                .map((item) => {
                  const isPaid = item.lastPaidMonth === currentMonthKey
                  const isDueOrPast = !isPaid && item.dueDay <= currentDay
                  const isLate = !isPaid && item.dueDay < currentDay

                  return (
                    <article
                      key={item.id}
                      className={isLate ? 'fixed-card obligation-row late-row' : 'fixed-card obligation-row'}
                    >
                      <div className="obligation-main">
                        <div className="card-title-row">
                          <strong>{item.title}</strong>
                          <button
                            type="button"
                            className="edit-icon-button"
                            aria-label={`Editar obligacion ${item.title}`}
                            onClick={() => startEditFixedExpense(item.id)}
                          >
                            ✎
                          </button>
                        </div>
                        <div className="obligation-chip-row">
                          <span className="obligation-chip">Pago dia {item.dueDay}</span>
                          <span className="obligation-chip">Confirmar dia {item.confirmationDay}</span>
                          <span className="obligation-chip">{getPocketName(state.pockets, item.pocketId)}</span>
                          <span className="obligation-chip">{item.category}</span>
                        </div>
                      </div>
                      <div className="fixed-card-side">
                        <span>{money.format(item.amount)}</span>
                        <small className={!item.active ? 'paused' : isPaid ? 'paid' : isLate ? 'late' : 'pending'}>
                          {!item.active ? 'Pausada' : isPaid ? 'Pagado' : isLate ? 'Vencido' : 'Pendiente'}
                        </small>
                        {item.active && !isPaid && (
                          <button
                            type="button"
                            className={isDueOrPast ? 'warning-button' : undefined}
                            onClick={() => openFixedPaymentConfirmation(item.id)}
                          >
                            {isDueOrPast ? 'Confirmar pagado' : 'Adelantar pago'}
                          </button>
                        )}
                        <button type="button" className="secondary-button slim" onClick={() => handleToggleFixedExpense(item.id)}>
                          {item.active ? 'Pausar' : 'Reactivar'}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
            </section>
          </div>

          <aside className="secondary-column">
            <section className="panel banking-panel">
              <span className="micro-label">Agenda</span>
              <h2>Siguiente bloque</h2>
              <div className="review-list">
                {obligationSummary.nextDeadlines.slice(0, 3).map((item) => (
                  <div key={item.id} className="review-chip">
                    <span>{item.title}</span>
                    <strong>Dia {item.dueDay}</strong>
                  </div>
                ))}
                {obligationSummary.nextDeadlines.length === 0 && (
                  <p className="empty-copy">No hay pagos proximos por atender.</p>
                )}
              </div>
            </section>
          </aside>
        </section>
      </>
    )
  }

  function renderDebtsView() {
    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <section className="panel banking-panel emphasis">
            <span className="micro-label">Resumen de deuda</span>
            <h2>Saldo pendiente</h2>
            <p>Las deudas desaparecen automaticamente de la lista activa al llegar a 0.</p>
            <div className="status-grid">
              <div>
                <span>Deuda total</span>
                <strong>{money.format(totals.pendingDebt)}</strong>
              </div>
              <div>
                <span>Cuotas del mes</span>
                <strong>{money.format(monthlyDebtCommitment)}</strong>
              </div>
              <div>
                <span>Activas</span>
                <strong>{activeDebts.length}</strong>
              </div>
              <div>
                <span>Saldadas</span>
                <strong>{completedDebts.length}</strong>
              </div>
            </div>
          </section>

          {openComposer === 'deudas' && (
            <FullscreenComposer
              isOpen={openComposer === 'deudas'}
              label="Nueva deuda"
              title={debtForm.id ? 'Editar deuda' : 'Registrar deuda'}
              description="Define saldo total, cuota estimada, bolsillo pagador y categoria asociada."
              onClose={() => {
                resetDebtForm()
                setOpenComposer(null)
              }}
            >
              <form className="bank-form" onSubmit={handleAddDebt}>
                <label>
                  Nombre de la deuda
                  <input
                    value={debtForm.title}
                    onChange={(event) => setDebtForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Ej. credito, prestamo, tarjeta"
                  />
                </label>
                <div className="form-grid two">
                  <label>
                    Total de la deuda
                    <input
                      type="number"
                      value={debtForm.totalAmount}
                      onChange={(event) =>
                        setDebtForm((current) => ({ ...current, totalAmount: event.target.value }))
                      }
                      placeholder="2400000"
                    />
                  </label>
                  <label>
                    Cuota por pago
                    <input
                      type="number"
                      value={debtForm.installmentAmount}
                      onChange={(event) =>
                        setDebtForm((current) => ({ ...current, installmentAmount: event.target.value }))
                      }
                      placeholder="400000"
                    />
                  </label>
                </div>
                <div className="form-grid three">
                  <label>
                    Dia de pago
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={debtForm.dueDay}
                      onChange={(event) => setDebtForm((current) => ({ ...current, dueDay: event.target.value }))}
                    />
                  </label>
                  <label>
                    Bolsillo pagador
                    <select
                      value={debtForm.pocketId}
                      onChange={(event) =>
                        setDebtForm((current) => ({ ...current, pocketId: event.target.value }))
                      }
                    >
                      {state.pockets.map((pocket) => (
                        <option key={pocket.id} value={pocket.id}>
                          {pocket.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Categoria
                    <select
                      value={debtForm.category}
                      onChange={(event) =>
                        setDebtForm((current) => ({ ...current, category: event.target.value as Category }))
                      }
                    >
                      {state.categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="submit">{debtForm.id ? 'Guardar deuda' : 'Crear deuda'}</button>
                {debtForm.id && (
                  <button
                    type="button"
                    className="secondary-button cancel-action"
                    onClick={() => {
                      resetDebtForm()
                      setOpenComposer(null)
                    }}
                  >
                    Cancelar edicion
                  </button>
                )}
              </form>
            </FullscreenComposer>
          )}

          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Obligaciones amortizables</span>
                <h2>Deudas activas</h2>
              </div>
              <div className="panel-header-actions">
                <p>{activeDebts.length} activa(s)</p>
                <button
                  className="action-trigger"
                  type="button"
                  onClick={() => {
                    resetDebtForm()
                    openComposerForView('deudas')
                  }}
                >
                  Registrar deuda
                </button>
              </div>
            </div>
            <div className="debt-stack">
              {activeDebts.map((debt) => {
                const progress = Math.round(
                  ((debt.totalAmount - debt.remainingAmount) / debt.totalAmount) * 100,
                )

                return (
                  <article key={debt.id} className="debt-card">
                    <div className="debt-card-top">
                      <div>
                        <div className="card-title-row">
                          <strong>{debt.title}</strong>
                          <button
                            type="button"
                            className="edit-icon-button"
                            aria-label={`Editar deuda ${debt.title}`}
                            onClick={() => startEditDebt(debt.id)}
                          >
                            ✎
                          </button>
                        </div>
                        <p>
                          Cuota {money.format(debt.installmentAmount)} · dia {debt.dueDay} ·{' '}
                          {getPocketName(state.pockets, debt.pocketId)}
                        </p>
                      </div>
                      <div className="debt-card-side">
                        <span>{money.format(debt.remainingAmount)}</span>
                        <small>Pendiente</small>
                      </div>
                    </div>
                    <div className="debt-progress">
                      <div className="debt-progress-bar">
                        <div style={{ width: `${progress}%` }} />
                      </div>
                      <p>
                        Pagado {money.format(debt.totalAmount - debt.remainingAmount)} de{' '}
                        {money.format(debt.totalAmount)}
                      </p>
                      <p className="movement-detail">
                        Cierre estimado:{' '}
                        {getMonthKeyFromOffset(
                          currentMonthKey,
                          Math.max(0, Math.ceil(debt.remainingAmount / Math.max(1, debt.installmentAmount)) - 1),
                        )}
                      </p>
                    </div>
                    <div className="debt-actions">
                      <button
                        type="button"
                        className="action-trigger debt-trigger"
                        onClick={() =>
                          setOpenDebtPaymentId((current) => (current === debt.id ? null : debt.id))
                        }
                      >
                        Ingresar cuota o abono
                      </button>
                    </div>
                    {openDebtPaymentId === debt.id && (
                      <div className="debt-entry-panel">
                        <div className="debt-entry-head">
                          <div>
                            <span className="micro-label">Registro de pago</span>
                            <strong>Ingresa una cuota o un abono extraordinario</strong>
                          </div>
                          <button
                            type="button"
                            className="edit-icon-button inline"
                            aria-label={`Cancelar ingreso de pago para ${debt.title}`}
                            onClick={() => setOpenDebtPaymentId(null)}
                          >
                            ×
                          </button>
                        </div>
                        <label>
                          Valor a registrar
                          <input
                            type="number"
                            value={debtPaymentDrafts[debt.id] ?? String(debt.installmentAmount)}
                            onChange={(event) =>
                              setDebtPaymentDrafts((current) => ({
                                ...current,
                                [debt.id]: event.target.value,
                              }))
                            }
                            placeholder={String(debt.installmentAmount)}
                          />
                        </label>
                        <p className="debt-entry-help">
                          Cuota sugerida: {money.format(debt.installmentAmount)}. Puedes registrar un valor menor o un abono extraordinario.
                        </p>
                        <div className="debt-entry-actions">
                          <button type="button" className="action-trigger debt-submit" onClick={() => handlePayDebt(debt.id, 'scheduled')}>
                            Registrar cuota
                          </button>
                          <button
                            type="button"
                            className="secondary-button slim debt-secondary-action"
                            onClick={() => handlePayDebt(debt.id, 'extra')}
                          >
                            Registrar abono extra
                          </button>
                          <button
                            type="button"
                            className="secondary-button slim debt-cancel-action"
                            onClick={() => setOpenDebtPaymentId(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="debt-history">
                      {(debtPaymentHistory[debt.id] ?? []).slice(0, 3).map((payment) => (
                        <div key={payment.id} className="history-chip">
                          <span>{payment.kind === 'extra' ? 'Abono extra' : 'Cuota'} · {payment.date}</span>
                          <strong>{money.format(payment.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                )
              })}
              {activeDebts.length === 0 && (
                <p className="empty-copy">
                  No tienes deudas activas. Las que lleguen a 0 dejan de mostrarse aqui.
                </p>
              )}
            </div>
          </section>

          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Historial</span>
                <h2>Deudas pagadas</h2>
              </div>
              <p>{completedDebts.length} saldada(s)</p>
            </div>
            <div className="debt-stack">
              {completedDebts.map((debt) => {
                const payments = debtPaymentHistory[debt.id] ?? []
                const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0)
                const lastPaymentDate = payments[0]?.date ?? 'Sin pagos'

                return (
                  <details key={debt.id} className="debt-history-card">
                    <summary className="debt-history-summary">
                      <div>
                        <strong>{debt.title}</strong>
                        <p>
                          {payments.length} cuota(s) / abono(s) · ultima fecha {lastPaymentDate}
                        </p>
                      </div>
                      <div className="debt-card-side">
                        <span>{money.format(totalPaid)}</span>
                        <small>Saldada</small>
                      </div>
                    </summary>
                    <div className="debt-history-body">
                      <div className="status-grid debt-history-metrics">
                        <div>
                          <span>Total deuda</span>
                          <strong>{money.format(debt.totalAmount)}</strong>
                        </div>
                        <div>
                          <span>Numero de pagos</span>
                          <strong>{payments.length}</strong>
                        </div>
                      </div>
                      <div className="debt-history-list">
                        {payments.map((payment, index) => (
                          <div key={payment.id} className="history-chip">
                            <span>
                              Pago {payments.length - index} · {payment.kind === 'extra' ? 'Abono extra' : 'Cuota'} · {payment.date}
                            </span>
                            <strong>{money.format(payment.amount)}</strong>
                          </div>
                        ))}
                        {payments.length === 0 && (
                          <p className="empty-copy">No hay historial detallado de pagos para esta deuda.</p>
                        )}
                      </div>
                    </div>
                  </details>
                )
              })}
              {completedDebts.length === 0 && (
                <p className="empty-copy">Aun no tienes deudas saldadas en el historial.</p>
              )}
            </div>
          </section>
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel">
            <span className="micro-label">Atencion inmediata</span>
            <h2>Prioridad de cobro</h2>
            <div className="review-list">
              {activeDebts.slice(0, 3).map((debt) => (
                <div key={debt.id} className="review-chip">
                  <span>{debt.title}</span>
                  <strong>{money.format(debt.remainingAmount)}</strong>
                </div>
              ))}
              {activeDebts.length === 0 && <p className="empty-copy">No hay deudas activas por revisar.</p>}
            </div>
          </section>
        </aside>
      </section>
    )
  }

  function renderSettingsView() {
    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <section className="panel banking-panel emphasis">
            <span className="micro-label">Persistencia</span>
            <h2>Estado de sincronizacion</h2>
            <p>
              {supabaseConfigured
                ? `Supabase activo con perfil ${profileId ?? 'sin perfil'}.`
                : 'Supabase aun no esta configurado. La app opera en modo local.'}
            </p>
            <div className="status-grid">
              <div>
                <span>Origen</span>
                <strong>{syncSource}</strong>
              </div>
              <div>
                <span>Ultimo guardado</span>
                <strong>{lastSyncedAt ? lastSyncedAt.slice(0, 16).replace('T', ' ') : 'Pendiente'}</strong>
              </div>
            </div>
            {syncError && <p className="movement-detail">{syncError}</p>}
          </section>

          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Categorias</span>
                <h2>Gestion de categorias</h2>
              </div>
            </div>
            <form className="bank-form inline-form" onSubmit={handleAddCategory}>
              <label>
                Nueva categoria
                <input
                  value={categoryForm}
                  onChange={(event) => setCategoryForm(event.target.value)}
                  placeholder="Ej. Mascotas, Impuestos, Regalos"
                />
              </label>
              <button type="submit">Agregar categoria</button>
            </form>
            <div className="settings-chip-grid">
              {state.categories.map((category) => (
                <div key={category} className="settings-chip">
                  <span>{category}</span>
                  {category !== 'Otros' && (
                    <button type="button" className="text-link compact" onClick={() => handleRemoveCategory(category)}>
                      Quitar
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">IA</span>
                <h2>Reglas de aprendizaje</h2>
              </div>
            </div>
            <div className="settings-chip-grid">
              {state.learningRules.map((rule) => (
                <div key={rule.keyword} className="settings-chip">
                  <span>
                    {rule.keyword} → {rule.category} · {rule.hits} acierto(s)
                  </span>
                  <button
                    type="button"
                    className="text-link compact"
                    onClick={() => handleRemoveLearningRule(rule.keyword)}
                  >
                    Quitar
                  </button>
                </div>
              ))}
              {state.learningRules.length === 0 && (
                <p className="empty-copy">Todavia no hay reglas aprendidas por correcciones manuales.</p>
              )}
            </div>
          </section>

          {isAdminUser && (
            <section className="panel banking-panel">
              <div className="panel-header">
                <div>
                  <span className="micro-label">Administrador</span>
                  <h2>Gestion de usuarios</h2>
                </div>
                <div className="panel-header-actions">
                  <p>{managedUsers.length} usuario(s)</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setUsersFeedback(null)
                      setShowUserAdminForm(true)
                      setUserAdminForm({
                        username: '',
                        cedula: '',
                        nombre: '',
                        password: '',
                        typeuser: 'user',
                        editingUsername: '',
                      })
                    }}
                  >
                    Nuevo usuario
                  </button>
                </div>
              </div>
              {showUserAdminForm && (
              <form className="bank-form user-admin-form" onSubmit={handleSubmitManagedUser}>
                <div className="form-grid three">
                  <label>
                    Username
                    <input
                      value={userAdminForm.username}
                      onChange={(event) =>
                        setUserAdminForm((current) => ({ ...current, username: event.target.value }))
                      }
                      placeholder="usuario_admin"
                    />
                  </label>
                  <label>
                    Cedula
                    <input
                      value={userAdminForm.cedula}
                      onChange={(event) =>
                        setUserAdminForm((current) => ({ ...current, cedula: event.target.value }))
                      }
                      placeholder="1234567890"
                    />
                  </label>
                  <label>
                    Nombre
                    <input
                      value={userAdminForm.nombre}
                      onChange={(event) =>
                        setUserAdminForm((current) => ({ ...current, nombre: event.target.value }))
                      }
                      placeholder="Nombre del usuario"
                    />
                  </label>
                  <label>
                    Contrasena
                    <div className="password-field">
                      <input
                        type={showUserAdminPassword ? 'text' : 'password'}
                        value={userAdminForm.password}
                        onChange={(event) =>
                          setUserAdminForm((current) => ({ ...current, password: event.target.value }))
                        }
                        placeholder="Contrasena inicial"
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowUserAdminPassword((current) => !current)}
                        aria-label={showUserAdminPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                        title={showUserAdminPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                      >
                        {showUserAdminPassword ? '🙈' : '👁'}
                      </button>
                    </div>
                  </label>
                </div>
                <label className="toggle-row">
                  <span>Typeuser</span>
                  <select
                    value={userAdminForm.typeuser}
                    onChange={(event) =>
                      setUserAdminForm((current) => ({
                        ...current,
                        typeuser: event.target.value as 'admin' | 'user',
                      }))
                    }
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <button type="submit" disabled={usersLoading}>
                  {userAdminForm.editingUsername ? 'Guardar cambios' : 'Crear usuario'}
                </button>
                <button
                  type="button"
                  className="secondary-button cancel-action"
                  onClick={() => resetUserAdminForm()}
                >
                  Cancelar
                </button>
              </form>
              )}
              {usersFeedback && <p className="movement-detail admin-feedback">{usersFeedback}</p>}
              <div className="managed-users-grid">
                {managedUsers.map((managedUser) => (
                  <article key={managedUser.username} className="managed-user-card">
                    <div className="card-title-row">
                      <div>
                        <strong>{managedUser.nombre || `Usuario ${managedUser.cedula}`}</strong>
                        <p>@{managedUser.username}</p>
                        <p>{managedUser.cedula}</p>
                      </div>
                      <button
                        type="button"
                        className="edit-icon-button"
                        aria-label={`Editar usuario ${managedUser.username}`}
                        onClick={() => startEditManagedUser(managedUser.username)}
                      >
                        ✎
                      </button>
                    </div>
                    <div className="managed-user-meta">
                      <span>{managedUser.typeuser === 'admin' ? 'admin' : 'user'}</span>
                      <strong>Clave: {managedUser.password}</strong>
                    </div>
                  </article>
                ))}
                {managedUsers.length === 0 && !usersLoading && (
                  <p className="empty-copy">Todavia no hay usuarios registrados en el panel.</p>
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Bolsillos</span>
                <h2>Etiquetas de tipos de bolsillo</h2>
              </div>
            </div>
            <form className="bank-form">
              <div className="settings-group">
                <p className="movement-detail">
                  Aqui defines el nombre oficial de cada tipo de bolsillo. No se manejan alias adicionales.
                </p>
                <div className="form-grid two">
                  <label>
                    Operacion
                    <input
                      value={state.config.pocketTypeLabels.daily}
                      onChange={(event) =>
                        updatePocketTypeLabels({
                          ...state.config.pocketTypeLabels,
                          daily: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Ahorro
                    <input
                      value={state.config.pocketTypeLabels.savings}
                      onChange={(event) =>
                        updatePocketTypeLabels({
                          ...state.config.pocketTypeLabels,
                          savings: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Pagos fijos
                    <input
                      value={state.config.pocketTypeLabels.fixed}
                      onChange={(event) =>
                        updatePocketTypeLabels({
                          ...state.config.pocketTypeLabels,
                          fixed: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Meta o inversion
                    <input
                      value={state.config.pocketTypeLabels.invest}
                      onChange={(event) =>
                        updatePocketTypeLabels({
                          ...state.config.pocketTypeLabels,
                          invest: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </form>
          </section>
        </aside>
      </section>
    )
  }

  const viewDescription =
    activeView === 'resumen'
      ? 'Vision consolidada del mes activo'
      : activeView === 'bolsillos'
        ? 'Consulta saldo y detalle por bolsillo'
        : activeView === 'movimientos'
          ? 'Historial operativo y registro rapido'
          : activeView === 'programacion'
            ? 'Control de obligaciones y pagos recurrentes'
            : activeView === 'deudas'
              ? 'Seguimiento de deudas hasta saldo cero'
            : 'Categorias y parametros generales de la aplicacion'

  if (auth.isConfigured && auth.isLoading) {
    return (
      <main className="banking-app loading-shell">
        <section className="workspace">
          <div className="panel banking-panel emphasis">
            <span className="micro-label">Usuarios</span>
            <h1>Validando acceso</h1>
            <p>Estoy conectando tu username con la base de datos.</p>
          </div>
        </section>
      </main>
    )
  }

  if (auth.isConfigured && !auth.user) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="auth-brand">
            <div className="brand-mark">F</div>
            <div>
              <strong>MoneyApp</strong>
              <p>Acceso seguro a tu perfil financiero</p>
            </div>
          </div>

          <div className="auth-copy">
            <span className="micro-label">Usuarios publicos</span>
            <h1>{authMode === 'login' ? 'Inicia sesion con tu username' : 'Crea tu usuario'}</h1>
            <p>
              Cada username tendra su propio perfil, asociado a una cedula, bolsillos, obligaciones, deudas y movimientos.
            </p>
          </div>

          <form className="bank-form auth-form" onSubmit={handleAuthSubmit}>
            <label>
              Username
              <input
                value={authForm.username}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, username: event.target.value }))
                }
                placeholder="usuario_admin"
              />
            </label>
            {authMode === 'register' && (
              <label>
                Cedula
                <input
                  inputMode="numeric"
                  value={authForm.cedula}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, cedula: event.target.value }))
                  }
                  placeholder="1234567890"
                />
              </label>
            )}
            <label>
              Contrasena
              <div className="password-field password-field-auth">
                <input
                  type={showAuthPassword ? 'text' : 'password'}
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder={authMode === 'login' ? 'Ingresa tu contrasena' : 'Define la contrasena inicial'}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowAuthPassword((current) => !current)}
                  aria-label={showAuthPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                  title={showAuthPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                >
                  {showAuthPassword ? '🙈' : '👁'}
                </button>
              </div>
            </label>
            <button type="submit" disabled={isSubmittingAuth}>
              {isSubmittingAuth
                ? 'Procesando...'
                : authMode === 'login'
                  ? 'Ingresar'
                  : 'Crear usuario simple'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setAuthMode((current) => (current === 'login' ? 'register' : 'login'))
                setAuthFeedback(null)
                setShowAuthPassword(false)
              }}
            >
              {authMode === 'login' ? 'Crear cuenta' : 'Ya tengo cuenta'}
            </button>
          </form>

          {(authFeedback || auth.authError) && (
            <div className="auth-feedback">
              <p>{authFeedback ?? auth.authError}</p>
            </div>
          )}
        </section>
      </main>
    )
  }

  if (!isReady) {
    return (
      <main className="banking-app loading-shell">
        <section className="workspace">
          <div className="panel banking-panel emphasis">
            <span className="micro-label">Inicializando</span>
            <h1>Cargando datos financieros</h1>
            <p>Estoy preparando la informacion local y la capa de sincronizacion.</p>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="banking-app">
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <div className="brand">
            <div className="brand-mark">F</div>
            <div className="brand-copy">
              <strong>MoneyApp</strong>
              <p>Control financiero</p>
            </div>
          </div>
        </div>

        {auth.user && (
          <section className="sidebar-card sidebar-user-card">
            <span className="micro-label">Usuario</span>
            <strong>{auth.user.nombre || `@${auth.user.username}`}</strong>
            <p>@{auth.user.username}</p>
            <p>{auth.user.cedula}</p>
            <p>{auth.user.typeuser ?? 'user'}</p>
            <button type="button" className="secondary-button cancel-action" onClick={() => auth.signOut()}>
              Cerrar sesion
            </button>
          </section>
        )}

        <nav className="sidebar-nav desktop-nav">
          {orderedViews.map((view) => (
            <button
              key={view}
              className={view === activeView ? 'nav-item active' : 'nav-item'}
              type="button"
              onClick={() => setActiveView(view)}
            >
              <span className="nav-item-icon" aria-hidden="true">
                {getViewIcon(view)}
              </span>
              <span className="nav-item-label">{viewLabels[view]}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-support">
          <section className="sidebar-card">
            <span className="micro-label">Mes operativo</span>
            <strong>{currentMonthKey}</strong>
            <p>{dateFormatter.format(now)}</p>
          </section>

          <section className="sidebar-card muted">
            <span className="micro-label">Recomendacion</span>
            <p>{coachingMessage}</p>
            <small>Persistencia: {supabaseConfigured ? `Supabase + ${syncSource}` : 'localStorage'}</small>
          </section>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">Panel financiero</p>
            <h1>{viewLabels[activeView]}</h1>
            <p className="view-description">{viewDescription}</p>
          </div>
          <div className="topbar-meta">
            <div className="meta-chip">
              <span>Obligaciones pendientes</span>
              <strong>{money.format(totals.pendingFixed)}</strong>
            </div>
            <div className="meta-chip dark">
              <span>Patrimonio</span>
              <strong>{money.format(totals.pocketBalance)}</strong>
            </div>
          </div>
        </header>

        {activeView === 'resumen' && renderSummaryView()}
        {activeView === 'bolsillos' && renderPocketsView()}
        {activeView === 'movimientos' && renderMovementsView()}
        {activeView === 'programacion' && renderProgrammingView()}
        {activeView === 'deudas' && renderDebtsView()}
        {activeView === 'configuracion' && renderSettingsView()}
      </section>

      <nav className="mobile-dock">
        {orderedViews.map((view) => (
          <button
            key={view}
            type="button"
            className={view === activeView ? 'mobile-dock-item active' : 'mobile-dock-item'}
            onClick={() => setActiveView(view)}
            aria-label={viewLabels[view]}
          >
            <span className="mobile-dock-icon" aria-hidden="true">
              {getViewIcon(view)}
            </span>
            <span className="mobile-dock-label">{viewLabels[view]}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}

export default App
