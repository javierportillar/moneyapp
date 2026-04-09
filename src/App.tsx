import { useEffect, useMemo, useState } from 'react'
import './App.css'

type PocketType = 'daily' | 'savings' | 'fixed' | 'invest'
type ViewKey = 'resumen' | 'bolsillos' | 'movimientos' | 'programacion' | 'deudas' | 'configuracion'
type ModuleKey = 'gasto' | 'ingreso' | 'transferencia' | 'fijos' | 'bolsillos'
type MovementKind = 'gasto' | 'ingreso' | 'transferencia'

type Pocket = {
  id: string
  name: string
  balance: number
  color: string
  icon: string
  type: PocketType
}

type Category = string

type Expense = {
  id: string
  description: string
  amount: number
  pocketId: string
  date: string
  source: 'manual' | 'wallet' | 'fixed' | 'debt'
  category: Category
  confidence: number
}

type Debt = {
  id: string
  title: string
  totalAmount: number
  remainingAmount: number
  installmentAmount: number
  dueDay: number
  pocketId: string
  category: Category
  active: boolean
}

type Income = {
  id: string
  title: string
  amount: number
  pocketId: string
  date: string
  recurring: boolean
}

type Transfer = {
  id: string
  fromPocketId: string
  toPocketId: string
  amount: number
  date: string
  note: string
}

type FixedExpense = {
  id: string
  title: string
  amount: number
  dueDay: number
  confirmationDay: number
  pocketId: string
  category: Category
  active: boolean
  lastPaidMonth?: string
}

type LearningRule = {
  keyword: string
  category: Category
  hits: number
}

type AppConfig = {
  appName: string
  currency: string
  locale: string
  paydayStartDay: number
  pocketTypeLabels: Record<PocketType, string>
}

type AppState = {
  pockets: Pocket[]
  expenses: Expense[]
  incomes: Income[]
  transfers: Transfer[]
  fixedExpenses: FixedExpense[]
  debts: Debt[]
  learningRules: LearningRule[]
  categories: Category[]
  config: AppConfig
}

const STORAGE_KEY = 'finpilot-v2'
const pocketIcons = ['💼', '🏠', '🛒', '💳', '🧾', '🎯', '✈️', '🛡️', '📈', '💰']
const defaultCategories = [
  'Hogar',
  'Comida',
  'Transporte',
  'Salud',
  'Entretenimiento',
  'Suscripciones',
  'Ahorro',
  'Inversion',
  'Educacion',
  'Servicios',
  'Compras',
  'Otros',
] as const

const categoryKeywords: Record<string, string[]> = {
  Hogar: ['arriendo', 'renta', 'hogar', 'limpieza', 'ikea'],
  Comida: ['restaurante', 'almuerzo', 'cafe', 'mercado', 'super', 'carulla', 'uber eats'],
  Transporte: ['uber', 'didi', 'gasolina', 'peaje', 'metro', 'parking'],
  Salud: ['farmacia', 'medicina', 'doctor', 'clinica', 'salud'],
  Entretenimiento: ['cine', 'bar', 'netflix', 'spotify', 'ticket', 'gaming'],
  Suscripciones: ['notion', 'icloud', 'adobe', 'openai', 'youtube', 'membresia'],
  Ahorro: ['ahorro', 'reserva', 'fondo'],
  Inversion: ['broker', 'etf', 'accion', 'crypto', 'inversion'],
  Educacion: ['curso', 'platzi', 'udemy', 'libro', 'academia'],
  Servicios: ['internet', 'agua', 'luz', 'energia', 'telefono'],
  Compras: ['amazon', 'falabella', 'exito', 'compra', 'tienda'],
  Otros: [],
}

const initialState: AppState = {
  pockets: [
    { id: 'p1', name: 'Operacion', balance: 0, color: '#0f766e', icon: '💼', type: 'daily' },
    { id: 'p2', name: 'Colchon', balance: 0, color: '#1d4ed8', icon: '🛡️', type: 'savings' },
    { id: 'p3', name: 'Pagos fijos', balance: 0, color: '#f59e0b', icon: '🧾', type: 'fixed' },
    { id: 'p4', name: 'Meta viaje', balance: 0, color: '#7c3aed', icon: '✈️', type: 'invest' },
  ],
  fixedExpenses: [
    {
      id: 'f1',
      title: 'Arriendo',
      amount: 1300000,
      dueDay: 5,
      confirmationDay: 6,
      pocketId: 'p3',
      category: 'Hogar',
      active: true,
      lastPaidMonth: '2026-04',
    },
    {
      id: 'f2',
      title: 'Internet + celular',
      amount: 184000,
      dueDay: 12,
      confirmationDay: 13,
      pocketId: 'p3',
      category: 'Servicios',
      active: true,
    },
    {
      id: 'f3',
      title: 'Notion + iCloud',
      amount: 78000,
      dueDay: 16,
      confirmationDay: 17,
      pocketId: 'p3',
      category: 'Suscripciones',
      active: true,
    },
  ],
  debts: [
    {
      id: 'd1',
      title: 'Credito laptop',
      totalAmount: 2400000,
      remainingAmount: 1600000,
      installmentAmount: 400000,
      dueDay: 25,
      pocketId: 'p1',
      category: 'Compras',
      active: true,
    },
  ],
  incomes: [
    {
      id: 'i1',
      title: 'Nomina abril',
      amount: 5200000,
      pocketId: 'p1',
      date: '2026-04-01',
      recurring: true,
    },
  ],
  transfers: [
    {
      id: 't1',
      fromPocketId: 'p1',
      toPocketId: 'p2',
      amount: 400000,
      date: '2026-04-02',
      note: 'Reserva quincena',
    },
  ],
  expenses: [
    {
      id: 'e1',
      description: 'Uber aeropuerto',
      amount: 48000,
      pocketId: 'p1',
      date: '2026-04-06',
      source: 'wallet',
      category: 'Transporte',
      confidence: 0.94,
    },
    {
      id: 'e2',
      description: 'Carulla mercado semanal',
      amount: 168000,
      pocketId: 'p1',
      date: '2026-04-05',
      source: 'wallet',
      category: 'Comida',
      confidence: 0.91,
    },
    {
      id: 'e3',
      description: 'Notion plan team',
      amount: 58000,
      pocketId: 'p3',
      date: '2026-04-03',
      source: 'manual',
      category: 'Suscripciones',
      confidence: 0.9,
    },
  ],
  learningRules: [
    { keyword: 'carulla', category: 'Comida', hits: 3 },
    { keyword: 'uber', category: 'Transporte', hits: 4 },
    { keyword: 'notion', category: 'Suscripciones', hits: 2 },
  ],
  categories: [...defaultCategories],
  config: {
    appName: 'FinPilot',
    currency: 'COP',
    locale: 'es-CO',
    paydayStartDay: 1,
    pocketTypeLabels: {
      daily: 'Cuenta operativa',
      savings: 'Reserva y liquidez',
      fixed: 'Debitos y pagos',
      invest: 'Meta o inversion',
    },
  },
}

const moduleLabels: Record<ModuleKey, string> = {
  gasto: 'Registrar gasto',
  ingreso: 'Registrar ingreso',
  transferencia: 'Transferencia',
  fijos: 'Obligaciones',
  bolsillos: 'Bolsillos',
}

const viewLabels: Record<ViewKey, string> = {
  resumen: 'Resumen',
  bolsillos: 'Bolsillos',
  movimientos: 'Movimientos',
  programacion: 'Obligaciones',
  deudas: 'Deudas',
  configuracion: 'Configuracion',
}

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

  rules.forEach((rule) => {
    if (text.includes(rule.keyword)) {
      scores.set(rule.category, (scores.get(rule.category) ?? 0) + 2 + rule.hits * 0.2)
    }
  })

  ;(Object.entries(categoryKeywords) as [Category, string[]][]).forEach(([category, keywords]) => {
    keywords.forEach((keyword) => {
      if (text.includes(keyword)) {
        scores.set(category, (scores.get(category) ?? 0) + 1)
      }
    })
  })

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!ranked) return { category: 'Otros' as Category, confidence: 0.52 }

  return {
    category: ranked[0],
    confidence: Math.min(0.98, 0.58 + ranked[1] * 0.08),
  }
}

function getPocketName(pockets: Pocket[], pocketId: string) {
  return pockets.find((pocket) => pocket.id === pocketId)?.name ?? 'Sin bolsillo'
}

function describePocketType(type: PocketType) {
  if (type === 'daily') return 'Cuenta operativa'
  if (type === 'savings') return 'Reserva y liquidez'
  if (type === 'fixed') return 'Debitos y pagos'
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

function hydrateState(raw: AppState) {
  return {
    ...raw,
    categories: raw.categories?.length ? raw.categories : [...defaultCategories],
    config: {
      ...(raw.config ?? initialState.config),
      pocketTypeLabels: {
        ...initialState.config.pocketTypeLabels,
        ...(raw.config?.pocketTypeLabels ?? {}),
      },
    },
    debts: raw.debts ?? initialState.debts,
    pockets: raw.pockets.map((pocket) => ({
      ...pocket,
      balance: 0,
      icon: pocket.icon ?? getDefaultIcon(pocket.type),
    })),
  }
}

function App() {
  const now = new Date()
  const today = formatDateISO(now)
  const currentMonthKey = today.slice(0, 7)
  const currentDay = now.getDate()

  const [state, setState] = useState<AppState>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? hydrateState(JSON.parse(stored) as AppState) : initialState
  })
  const [activeView, setActiveView] = useState<ViewKey>('resumen')
  const [activeModule, setActiveModule] = useState<ModuleKey>('gasto')
  const [selectedPocketId, setSelectedPocketId] = useState(initialState.pockets[0].id)

  const [expenseForm, setExpenseForm] = useState({
    id: '',
    description: '',
    amount: '',
    pocketId: initialState.pockets[0].id,
  })
  const [incomeForm, setIncomeForm] = useState({
    id: '',
    title: '',
    amount: '',
    pocketId: initialState.pockets[0].id,
    recurring: true,
  })
  const [transferForm, setTransferForm] = useState({
    id: '',
    fromPocketId: initialState.pockets[0].id,
    toPocketId: initialState.pockets[1].id,
    amount: '',
    note: '',
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
  }>({
    pocketId: 'todos',
    kind: 'todos',
  })
  const [debtForm, setDebtForm] = useState({
    title: '',
    totalAmount: '',
    installmentAmount: '',
    dueDay: String(Math.min(currentDay + 7, 28)),
    pocketId: initialState.pockets[0].id,
    category: 'Otros' as Category,
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const suggestion = useMemo(
    () => predictCategory(expenseForm.description || 'movimiento general', state.learningRules),
    [expenseForm.description, state.learningRules],
  )

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
  const activeDebts = useMemo(
    () => state.debts.filter((debt) => debt.active && debt.remainingAmount > 0),
    [state.debts],
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
    const paid = activeItems.filter((item) => item.lastPaidMonth === currentMonthKey)
    const pending = activeItems.filter((item) => item.lastPaidMonth !== currentMonthKey)
    const overdue = pending.filter((item) => item.confirmationDay < currentDay)
    return { activeItems, paid, pending, overdue }
  }, [currentDay, currentMonthKey, state.fixedExpenses])

  const totals = useMemo(() => {
    const pocketBalance = Object.values(pocketBalances).reduce((sum, balance) => sum + balance, 0)
    const totalExpenses = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0)
    const totalIncomes = monthIncomes.reduce((sum, income) => sum + income.amount, 0)
    const pendingFixed = fixedStatus.pending.reduce((sum, item) => sum + item.amount, 0)
    const pendingDebt = activeDebts.reduce((sum, debt) => sum + debt.remainingAmount, 0)

    return {
      pocketBalance,
      totalExpenses,
      totalIncomes,
      pendingFixed,
      pendingDebt,
      netFlow: totalIncomes - totalExpenses,
    }
  }, [activeDebts, fixedStatus.pending, monthExpenses, monthIncomes, pocketBalances])

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

  const selectedPocket = state.pockets.find((pocket) => pocket.id === selectedPocketId) ?? state.pockets[0]

  const selectedPocketActivity = useMemo(
    () => activity.filter((item) => item.pocketIds.includes(selectedPocketId)),
    [activity, selectedPocketId],
  )

  const filteredActivity = useMemo(() => {
    return activity
      .filter((item) => {
        const matchesPocket =
          movementFilters.pocketId === 'todos' || item.pocketIds.includes(movementFilters.pocketId)
        const matchesKind = movementFilters.kind === 'todos' || item.kind === movementFilters.kind
        return matchesPocket && matchesKind
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
  }, [activity, movementFilters, state.pockets, state.transfers])

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
      return {
        ...debt,
        paidAmount,
        ratio: debt.totalAmount > 0 ? paidAmount / debt.totalAmount : 0,
      }
    })

    return {
      maxFlowBase,
      categoryBreakdown,
      pocketBreakdown,
      debtBreakdown,
    }
  }, [activeDebts, monthExpenses, pocketBalances, state.categories, state.pockets, totals])

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

  function resetPocketForm() {
    setPocketForm({ id: '', name: '', type: 'daily', color: '#0f766e', icon: '💼' })
  }

  function resetExpenseForm() {
    setExpenseForm({
      id: '',
      description: '',
      amount: '',
      pocketId: initialState.pockets[0].id,
    })
  }

  function resetIncomeForm() {
    setIncomeForm({
      id: '',
      title: '',
      amount: '',
      pocketId: initialState.pockets[0].id,
      recurring: true,
    })
  }

  function resetTransferForm() {
    setTransferForm({
      id: '',
      fromPocketId: initialState.pockets[0].id,
      toPocketId: initialState.pockets[1].id,
      amount: '',
      note: '',
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

  function startEditPocket(pocketId: string) {
    const pocket = state.pockets.find((item) => item.id === pocketId)
    if (!pocket) return
    setSelectedPocketId(pocketId)
    setActiveModule('bolsillos')
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

  function startEditMovement(kind: MovementKind, movementId: string) {
    setActiveView('movimientos')
    setActiveModule(kind)

    if (kind === 'gasto') {
      const expense = state.expenses.find((item) => item.id === movementId)
      if (!expense || (expense.source !== 'manual' && expense.source !== 'wallet')) return

      setExpenseForm({
        id: expense.id,
        description: expense.description,
        amount: String(expense.amount),
        pocketId: expense.pocketId,
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
    })
  }

  function handleDeleteMovement(kind: MovementKind, movementId: string) {
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
        date: currentExpense?.date ?? today,
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
        date: currentIncome?.date ?? today,
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
        date: currentTransfer?.date ?? today,
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

  function handlePayFixedExpense(fixedId: string) {
    setState((current) => {
      const fixed = current.fixedExpenses.find((item) => item.id === fixedId)
      if (!fixed || fixed.lastPaidMonth === currentMonthKey) return current

      const expense: Expense = {
        id: crypto.randomUUID(),
        description: fixed.title,
        amount: fixed.amount,
        pocketId: fixed.pocketId,
        date: today,
        source: 'fixed',
        category: fixed.category,
        confidence: 1,
      }

      return {
        ...current,
        expenses: [expense, ...current.expenses],
        fixedExpenses: current.fixedExpenses.map((item) =>
          item.id === fixedId ? { ...item, lastPaidMonth: currentMonthKey } : item,
        ),
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

    setState((current) => ({
      ...current,
      debts: [
        {
          id: crypto.randomUUID(),
          title: debtForm.title.trim(),
          totalAmount,
          remainingAmount: totalAmount,
          installmentAmount,
          dueDay,
          pocketId: debtForm.pocketId,
          category: debtForm.category,
          active: true,
        },
        ...current.debts,
      ],
    }))

    setDebtForm({
      title: '',
      totalAmount: '',
      installmentAmount: '',
      dueDay: String(Math.min(currentDay + 7, 28)),
      pocketId: initialState.pockets[0].id,
      category: 'Otros',
    })
  }

  function handlePayDebt(debtId: string) {
    setState((current) => {
      const debt = current.debts.find((item) => item.id === debtId)
      if (!debt || !debt.active || debt.remainingAmount <= 0) return current

      const paymentAmount = Math.min(debt.installmentAmount, debt.remainingAmount)
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
        debts: current.debts
          .map((item) => {
            if (item.id !== debtId) return item
            const remaining = Math.max(0, item.remainingAmount - paymentAmount)
            return {
              ...item,
              remainingAmount: remaining,
              active: remaining > 0,
            }
          })
          .filter((item) => item.active || item.remainingAmount > 0),
      }
    })
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

  function updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setState((current) => ({
      ...current,
      config: {
        ...current.config,
        [key]: value,
      },
    }))
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
          <div className="smart-box">
            <span>Categoria sugerida</span>
            <strong>{suggestion.category}</strong>
            <p>Confianza estimada: {Math.round(suggestion.confidence * 100)}%</p>
          </div>
          <button type="submit">{expenseForm.id ? 'Guardar gasto' : 'Registrar salida'}</button>
          {expenseForm.id && (
            <button type="button" className="secondary-button" onClick={resetExpenseForm}>
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
            <button type="button" className="secondary-button" onClick={resetIncomeForm}>
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
          <button type="submit">
            {transferForm.id ? 'Guardar transferencia' : 'Ejecutar transferencia'}
          </button>
          {transferForm.id && (
            <button type="button" className="secondary-button" onClick={resetTransferForm}>
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
          <button type="submit">{fixedForm.id ? 'Guardar obligacion' : 'Agregar gasto fijo'}</button>
          {fixedForm.id && (
            <button type="button" className="secondary-button" onClick={resetFixedForm}>
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
          <button type="button" className="secondary-button" onClick={resetPocketForm}>
            Cancelar edicion
          </button>
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
          </article>
        </section>

        <section className="account-strip">
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
                </div>
              ))}
              {summaryAnalytics.debtBreakdown.length === 0 && (
                <p className="empty-copy">No hay deudas activas para analizar.</p>
              )}
            </div>
          </article>
        </section>

        <section className="dashboard-grid">
          <div className="primary-column">
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
          </div>

          <aside className="secondary-column">
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
    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Mapa de bolsillos</span>
                <h2>Tus cuentas internas</h2>
              </div>
              <button className="text-link" type="button" onClick={() => setActiveModule('bolsillos')}>
                Crear nuevo
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
                    <span className="icon-badge" style={{ background: pocket.color }}>
                      {pocket.icon}
                    </span>
                    <span>{getPocketTypeLabel(pocket.type)}</span>
                  </div>
                  <strong>{pocket.name}</strong>
                  <p>{money.format(pocketBalances[pocket.id] ?? 0)}</p>
                  <button
                    type="button"
                    className="text-link compact"
                    onClick={(event) => {
                      event.stopPropagation()
                      startEditPocket(pocket.id)
                    }}
                  >
                    Editar
                  </button>
                </article>
              ))}
            </div>
          </section>

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
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Accion</span>
                <h2>{pocketForm.id ? 'Editar bolsillo' : 'Nuevo bolsillo'}</h2>
              </div>
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
                <button type="button" className="secondary-button" onClick={resetPocketForm}>
                  Cancelar edicion
                </button>
              )}
            </form>
          </section>
        </aside>
      </section>
    )
  }

  function renderMovementsView() {
    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Filtro operativo</span>
                <h2>Consulta por bolsillo y tipo</h2>
              </div>
              <p>{movementSummary.count} resultado(s)</p>
            </div>
            <div className="movement-filter-board">
              <div className="filter-field">
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
              <div className="filter-field">
                <span className="filter-field-label">Tipo de movimiento</span>
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
              <div className="movement-filter-card">
                <span>Filtro activo</span>
                <strong>
                  {movementFilters.pocketId === 'todos'
                    ? 'Vista global'
                    : getPocketName(state.pockets, movementFilters.pocketId)}
                </strong>
                <p>
                  {movementFilters.kind === 'todos'
                    ? 'Todos los tipos'
                    : `Solo ${movementFilters.kind}`}
                </p>
              </div>
            </div>
            <div className="movement-summary-grid">
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

          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Libro mayor</span>
                <h2>Detalle de movimientos</h2>
              </div>
              <p>{filteredActivity.length} registros visibles</p>
            </div>
            <div className="ledger">
              {filteredActivity.map((item) => (
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
                            className="text-link compact"
                            onClick={() => startEditMovement(item.kind, item.id)}
                          >
                            Editar
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
              {filteredActivity.length === 0 && (
                <p className="empty-copy">No hay movimientos con los filtros seleccionados.</p>
              )}
            </div>
          </section>
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Registrar</span>
                <h2>Movimiento rapido</h2>
              </div>
            </div>
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
            {renderActiveForm()}
          </section>

          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Lectura rapida</span>
                <h2>Saldo por bolsillo</h2>
              </div>
            </div>
            <div className="pocket-list-compact">
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
              {monthExpenses.slice(0, 4).map((expense) => (
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
            </div>
          </section>
        </aside>
      </section>
    )
  }

  function renderProgrammingView() {
    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Calendario financiero</span>
                <h2>Obligaciones</h2>
              </div>
              <p>{fixedStatus.pending.length} pendientes este mes</p>
            </div>
            <div className="fixed-stack">
              {state.fixedExpenses
                .filter((item) => item.active)
                .sort((a, b) => a.dueDay - b.dueDay)
                .map((item) => {
                  const isPaid = item.lastPaidMonth === currentMonthKey
                  const isLate = !isPaid && item.dueDay < currentDay

                  return (
                    <article key={item.id} className="fixed-card">
                      <div>
                        <strong>{item.title}</strong>
                        <p>
                          Pago dia {item.dueDay} · confirmar dia {item.confirmationDay} · {getPocketName(state.pockets, item.pocketId)} · {item.category}
                        </p>
                      </div>
                      <div className="fixed-card-side">
                        <span>{money.format(item.amount)}</span>
                        <small className={isPaid ? 'paid' : isLate ? 'late' : 'pending'}>
                          {isPaid ? 'Pagado' : isLate ? 'Vencido' : 'Pendiente'}
                        </small>
                        {!isPaid && (
                          <button type="button" onClick={() => handlePayFixedExpense(item.id)}>
                            Marcar pago
                          </button>
                        )}
                        <button type="button" className="secondary-button slim" onClick={() => startEditFixedExpense(item.id)}>
                          Editar
                        </button>
                      </div>
                    </article>
                  )
                })}
            </div>
          </section>
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Nueva obligacion</span>
                <h2>{fixedForm.id ? 'Editar obligacion' : 'Agregar obligacion'}</h2>
              </div>
            </div>
            <div className="module-segmented">
              {(['fijos', 'ingreso'] as ModuleKey[]).map((module) => (
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
        </aside>
      </section>
    )
  }

  function renderDebtsView() {
    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Obligaciones amortizables</span>
                <h2>Deudas activas</h2>
              </div>
              <p>{activeDebts.length} activa(s)</p>
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
                        <strong>{debt.title}</strong>
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
                    </div>
                    <div className="debt-actions">
                      <button type="button" onClick={() => handlePayDebt(debt.id)}>
                        Registrar abono
                      </button>
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
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Nueva deuda</span>
                <h2>Agregar obligacion</h2>
              </div>
            </div>
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
              <button type="submit">Crear deuda</button>
            </form>
          </section>

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
                <span>Activas</span>
                <strong>{activeDebts.length}</strong>
              </div>
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
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Aplicacion</span>
                <h2>Parametros generales</h2>
              </div>
            </div>
            <form className="bank-form">
              <label>
                Nombre de la aplicacion
                <input
                  value={state.config.appName}
                  onChange={(event) => updateConfig('appName', event.target.value)}
                />
              </label>
              <div className="form-grid two">
                <label>
                  Moneda
                  <select
                    value={state.config.currency}
                    onChange={(event) => updateConfig('currency', event.target.value)}
                  >
                    <option value="COP">COP</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </label>
                <label>
                  Idioma regional
                  <select
                    value={state.config.locale}
                    onChange={(event) => updateConfig('locale', event.target.value)}
                  >
                    <option value="es-CO">es-CO</option>
                    <option value="es-ES">es-ES</option>
                    <option value="en-US">en-US</option>
                  </select>
                </label>
              </div>
              <label>
                Dia base de inicio de ciclo
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={state.config.paydayStartDay}
                  onChange={(event) => updateConfig('paydayStartDay', Number(event.target.value))}
                />
              </label>
              <div className="settings-group">
                <span className="micro-label">Etiquetas de tipos de bolsillo</span>
                <div className="form-grid two">
                  <label>
                    Operacion
                    <input
                      value={state.config.pocketTypeLabels.daily}
                      onChange={(event) =>
                        updateConfig('pocketTypeLabels', {
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
                        updateConfig('pocketTypeLabels', {
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
                        updateConfig('pocketTypeLabels', {
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
                        updateConfig('pocketTypeLabels', {
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

  return (
    <main className="banking-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <strong>FinPilot</strong>
            <p>Control financiero</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {(Object.keys(viewLabels) as ViewKey[]).map((view) => (
            <button
              key={view}
              className={view === activeView ? 'nav-item active' : 'nav-item'}
              type="button"
              onClick={() => setActiveView(view)}
            >
              {viewLabels[view]}
            </button>
          ))}
        </nav>

        <section className="sidebar-card">
          <span className="micro-label">Mes operativo</span>
          <strong>{currentMonthKey}</strong>
          <p>{dateFormatter.format(now)}</p>
        </section>

        <section className="sidebar-card muted">
          <span className="micro-label">Recomendacion</span>
          <p>{coachingMessage}</p>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
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
    </main>
  )
}

export default App
