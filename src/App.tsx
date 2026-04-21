import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  LuArrowLeftRight,
  LuCalendar,
  LuChevronDown,
  LuCircleDollarSign,
  LuEye,
  LuEyeOff,
  LuLayoutDashboard,
  LuMenu,
  LuPencil,
  LuPiggyBank,
  LuSettings2,
  LuWallet,
  LuX,
} from 'react-icons/lu'
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

const percent = new Intl.NumberFormat('es-CO', {
  style: 'percent',
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

function formatDateInputDisplay(value: string) {
  if (!value) return 'Selecciona una fecha'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function getMonthKeyFromOffset(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthName(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'long' })
}

function getMonthsImpacted(dateStr: string, currentMonthKey: string): string[] {
  const monthKey = dateStr.slice(0, 7)
  const months: string[] = []
  let current = monthKey
  
  while (current <= currentMonthKey) {
    months.push(current)
    current = getMonthKeyFromOffset(current, 1)
  }
  
  return months
}

function normalize(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function keepOnlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function getCurrentTimeHHmm() {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function normalizeTimeHHmm(value: string | undefined) {
  if (!value) return '00:00'
  const trimmed = value.trim()
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) return trimmed.slice(0, 5)
  return '00:00'
}

function formatMovementDateTimeDisplay(date: string, time: string | undefined) {
  return `${formatDateInputDisplay(date)} · ${normalizeTimeHHmm(time)}`
}

const learningStopWords = new Set([
  'para',
  'como',
  'pero',
  'porque',
  'desde',
  'hasta',
  'entre',
  'sobre',
  'gasto',
  'pago',
  'compra',
  'compras',
  'casa',
  'banco',
  'tarjeta',
  'cuenta',
  'este',
  'esta',
  'estos',
  'estas',
  'cada',
  'otro',
  'otra',
  'otros',
  'otras',
  'general',
  'movimiento',
])

function deriveLearningKeywords(description: string, matches: string[]) {
  const normalizedMatches = matches.map(normalize).filter(Boolean)
  const normalizedWords = normalize(description)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !learningStopWords.has(word))

  return [...new Set([...normalizedMatches, ...normalizedWords])].slice(0, 4)
}

function getCategoryConfidenceForSelection(selectedCategory: Category, suggestedCategory: Category, confidence: number) {
  if (selectedCategory === suggestedCategory) return confidence
  return Math.max(0.32, Math.min(0.72, confidence * 0.58))
}

function getConfidenceLabel(confidence: number) {
  if (confidence >= 0.8) return 'Alta'
  if (confidence >= 0.6) return 'Media'
  return 'Baja'
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

function getPocketMethod(pockets: Pocket[], pocketId: string) {
  const type = pockets.find((pocket) => pocket.id === pocketId)?.type ?? 'daily'
  return describePocketType(type)
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
  if (view === 'resumen') return <LuLayoutDashboard />
  if (view === 'bolsillos') return <LuWallet />
  if (view === 'movimientos') return <LuArrowLeftRight />
  if (view === 'programacion') return <LuPiggyBank />
  if (view === 'deudas') return <LuCircleDollarSign />
  return <LuSettings2 />
}

function createRobotCheck() {
  const left = Math.floor(Math.random() * 7) + 2
  const right = Math.floor(Math.random() * 8) + 1

  return {
    prompt: `Confirma que no eres un robot. Resuelve ${left} + ${right}`,
    expectedAnswer: String(left + right),
  }
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

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)

  return (
    <span
      className="info-tip"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(event) => {
        event.stopPropagation()
        setShow((current) => !current)
      }}
    >
      <i className="info-tip-icon">i</i>
      {show && <span className="info-tip-bubble">{text}</span>}
    </span>
  )
}

function MetricLabel({ label, info }: { label: string; info?: string }) {
  return (
    <span className="metric-label">
      {label}
      {info ? <InfoTip text={info} /> : null}
    </span>
  )
}

function LoadingProgress({
  progress,
  label,
  title,
  description,
}: {
  progress: number
  label: string
  title: string
  description: string
}) {
  const normalizedProgress = Math.max(0, Math.min(100, progress))
  const radius = 76
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (normalizedProgress / 100) * circumference
  const isComplete = normalizedProgress >= 100

  return (
    <div className="loading-progress-shell">
      <span className="micro-label">{label}</span>
      <div className={isComplete ? 'loading-ring complete' : 'loading-ring'}>
        <svg viewBox="0 0 180 180" aria-hidden="true">
          <defs>
            <linearGradient id="loadingRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="55%" stopColor="#67e8f9" />
              <stop offset="100%" stopColor="#34d399" />
            </linearGradient>
          </defs>
          <circle className="loading-ring-track" cx="90" cy="90" r={radius} />
          <circle
            className="loading-ring-value"
            cx="90"
            cy="90"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="loading-ring-center">
          <strong>{normalizedProgress}%</strong>
          <span>{isComplete ? 'Completo' : 'Cargando'}</span>
        </div>
      </div>
      <div className="loading-copy">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  )
}

function SectionFrame({
  label,
  title,
  subtitle,
  actions,
  collapsed,
  onToggle,
  children,
  className = '',
  emphasis = false,
}: {
  label: string
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
  emphasis?: boolean
}) {
  return (
    <section
      className={`panel banking-panel section-frame ${emphasis ? 'emphasis' : ''} ${
        collapsed ? 'is-collapsed' : ''
      } ${className}`.trim()}
    >
      <div className="section-frame-head">
        <div className="section-frame-copy">
          <span className="micro-label">{label}</span>
          <div className="section-frame-title-row">
            <h2>{title}</h2>
          </div>
          {subtitle ? <div className="section-frame-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <button type="button" className="section-toggle-corner" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Expandir' : 'Minimizar'}>
        <LuChevronDown className={collapsed ? 'section-toggle-icon' : 'section-toggle-icon open'} />
      </button>
      {actions && <div className="section-frame-actions-corner">{actions}</div>}
      {!collapsed && <div className="section-frame-body">{children}</div>}
    </section>
  )
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
    syncNow,
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
  const [openPocketDetailId, setOpenPocketDetailId] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authForm, setAuthForm] = useState({ username: '', cedula: '', nombre: '', password: '' })
  const [authFeedback, setAuthFeedback] = useState<string | null>(null)
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [showAuthPassword, setShowAuthPassword] = useState(false)
  const [robotCheck, setRobotCheck] = useState(() => createRobotCheck())
  const [robotCheckRequested, setRobotCheckRequested] = useState(false)
  const [robotCheckAnswer, setRobotCheckAnswer] = useState('')
  const [robotCheckVerified, setRobotCheckVerified] = useState(false)
  const [activeSummaryBreakdown, setActiveSummaryBreakdown] = useState<'ingresos' | 'gastos' | 'saldoAnterior' | null>(null)
  const [bootProgress, setBootProgress] = useState(0)
  const [bootSettled, setBootSettled] = useState(false)
  const isAdminUser = auth.user?.typeuser === 'admin'
  const loadingPending = (auth.isConfigured && auth.isLoading) || !isReady

  useEffect(() => {
    let progressTimer: number | undefined
    let finishTimer: number | undefined

    if (loadingPending) {
      setBootSettled(false)
      progressTimer = window.setInterval(() => {
        setBootProgress((current) => {
          if (current >= 94) return current
          const nextStep = current < 20 ? 5 : current < 55 ? 3 : 2
          return Math.min(94, current + nextStep)
        })
      }, 90)
    } else {
      setBootProgress(100)
      finishTimer = window.setTimeout(() => {
        setBootSettled(true)
      }, 420)
    }

    return () => {
      if (progressTimer) window.clearInterval(progressTimer)
      if (finishTimer) window.clearTimeout(finishTimer)
    }
  }, [loadingPending])

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

  useEffect(() => {
    if (authMode === 'login') {
      setRobotCheckRequested(false)
      setRobotCheckAnswer('')
      setRobotCheckVerified(false)
      return
    }

    setRobotCheck(createRobotCheck())
    setRobotCheckRequested(false)
    setRobotCheckAnswer('')
    setRobotCheckVerified(false)
  }, [authMode])

  const [expenseForm, setExpenseForm] = useState({
    id: '',
    description: '',
    amount: '',
    pocketId: initialState.pockets[0].id,
    date: today,
    category: 'Otros' as Category,
    categorySource: 'suggested' as 'suggested' | 'manual',
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
    date: string
    pocketType: 'todos' | PocketType
    groupBy: 'dia' | 'mes'
  }>({
    pocketId: 'todos',
    kind: 'todos',
    query: '',
    date: '',
    pocketType: 'todos',
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
	  const [openMovementActionId, setOpenMovementActionId] = useState<string | null>(null)
	  const expenseDateInputRef = useRef<HTMLInputElement | null>(null)
	  const incomeDateInputRef = useRef<HTMLInputElement | null>(null)
	  const transferDateInputRef = useRef<HTMLInputElement | null>(null)
	  const movementFilterDateInputRef = useRef<HTMLInputElement | null>(null)
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isMobileMenuCompact, setIsMobileMenuCompact] = useState(false)
  const [isMobileMenuClosing, setIsMobileMenuClosing] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const mobileMenuCloseTimerRef = useRef<number | null>(null)
  const [userAdminForm, setUserAdminForm] = useState({
    username: '',
    cedula: '',
    nombre: '',
    password: '',
    typeuser: 'user' as 'admin' | 'user',
    editingUsername: '',
  })
  const orderedViews: ViewKey[] = ['resumen', 'movimientos', 'bolsillos', 'programacion', 'deudas', 'configuracion']

  useEffect(() => {
    setIsMobileMenuOpen(false)
    setIsMobileMenuClosing(false)
  }, [activeView])

  useEffect(() => {
    setIsMobileMenuCompact(false)

    const compactTimer = window.setTimeout(() => {
      setIsMobileMenuCompact(true)
    }, 2200)

    return () => {
      window.clearTimeout(compactTimer)
    }
  }, [activeView, activeModule])

  useEffect(() => {
    if (isMobileMenuOpen) {
      setIsMobileMenuCompact(false)
    }
  }, [isMobileMenuOpen])

  useEffect(() => {
    return () => {
      if (mobileMenuCloseTimerRef.current !== null) {
        window.clearTimeout(mobileMenuCloseTimerRef.current)
      }
    }
  }, [])

  function openMobileMenu() {
    if (mobileMenuCloseTimerRef.current !== null) {
      window.clearTimeout(mobileMenuCloseTimerRef.current)
      mobileMenuCloseTimerRef.current = null
    }

    setIsMobileMenuClosing(false)
    setIsMobileMenuCompact(false)
    setIsMobileMenuOpen(true)
  }

  function closeMobileMenu() {
    setIsMobileMenuOpen(false)
    setIsMobileMenuClosing(true)

    if (mobileMenuCloseTimerRef.current !== null) {
      window.clearTimeout(mobileMenuCloseTimerRef.current)
    }

    mobileMenuCloseTimerRef.current = window.setTimeout(() => {
      setIsMobileMenuCompact(true)
      setIsMobileMenuClosing(false)
      mobileMenuCloseTimerRef.current = null
    }, 220)
  }

  const suggestion = useMemo(
    () => predictCategory(expenseForm.description || 'movimiento general', state.learningRules),
    [expenseForm.description, state.learningRules],
  )

  useEffect(() => {
    setExpenseForm((current) => {
      if (current.categorySource === 'manual') return current
      if (current.category === suggestion.category) return current
      return {
        ...current,
        category: suggestion.category,
        categorySource: 'suggested',
      }
    })
  }, [suggestion.category])
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
    const carriedBalance =
      state.incomes
        .filter((income) => income.date.slice(0, 7) < currentMonthKey)
        .reduce((sum, income) => sum + income.amount, 0) -
      state.expenses
        .filter((expense) => expense.date.slice(0, 7) < currentMonthKey)
        .reduce((sum, expense) => sum + expense.amount, 0)

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
      carriedBalance,
      totalExplainedBalance: pocketBalance,
    }
  }, [
    activeDebts,
    currentMonthKey,
    fixedStatus.pending,
    monthExpenses,
    monthIncomes,
    pocketBalances,
    previousMonthExpenses,
    previousMonthIncomes,
    state.expenses,
    state.incomes,
  ])

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
	        time: expense.time,
	        kind: 'gasto' as const,
	        source: expense.source,
	        editable: expense.source === 'manual' || expense.source === 'wallet',
	        deletable: expense.source === 'manual' || expense.source === 'wallet',
	        title: expense.description,
	        amount: -expense.amount,
	        pocketIds: [expense.pocketId],
	        meta: `${expense.category} · ${getPocketName(state.pockets, expense.pocketId)} · ${getPocketMethod(
	          state.pockets,
	          expense.pocketId,
	        )}`,
	        detail: `Salida ${expense.source} · confianza ${Math.round(expense.confidence * 100)}%`,
	      })),
	      ...monthIncomes.map((income) => ({
	        id: income.id,
	        date: income.date,
	        time: income.time,
	        kind: 'ingreso' as const,
	        source: 'manual' as const,
	        editable: true,
	        deletable: true,
	        title: income.title,
	        amount: income.amount,
	        pocketIds: [income.pocketId],
	        meta: `${getPocketName(state.pockets, income.pocketId)} · ${getPocketMethod(
	          state.pockets,
	          income.pocketId,
	        )}`,
	        detail: income.recurring ? 'Ingreso recurrente' : 'Ingreso manual',
	      })),
	      ...monthTransfers.map((transfer) => ({
	        id: transfer.id,
	        date: transfer.date,
	        time: transfer.time,
	        kind: 'transferencia' as const,
	        source: 'transfer' as const,
	        editable: true,
	        deletable: true,
	        title: transfer.note || 'Transferencia interna',
	        amount: transfer.amount,
	        pocketIds: [transfer.fromPocketId, transfer.toPocketId],
	        meta: `${getPocketName(state.pockets, transfer.fromPocketId)} (${getPocketMethod(
	          state.pockets,
	          transfer.fromPocketId,
	        )}) -> ${getPocketName(state.pockets, transfer.toPocketId)} (${getPocketMethod(
	          state.pockets,
	          transfer.toPocketId,
	        )})`,
	        detail: transfer.note.trim() || 'Movimiento interno entre bolsillos',
	      })),
	    ]

	    return items.sort((a, b) => {
	      const aKey = `${a.date}T${normalizeTimeHHmm(a.time)}`
	      const bKey = `${b.date}T${normalizeTimeHHmm(b.time)}`
	      if (aKey === bKey) return 0
	      return aKey < bKey ? 1 : -1
	    })
	  }, [monthExpenses, monthIncomes, monthTransfers, state.pockets])

	  const movementActivity = useMemo(() => {
	    const items = [
	      ...movementMonthExpenses.map((expense) => ({
	        id: expense.id,
	        date: expense.date,
	        time: expense.time,
	        kind: 'gasto' as const,
	        source: expense.source,
	        editable: expense.source === 'manual' || expense.source === 'wallet',
	        deletable: expense.source === 'manual' || expense.source === 'wallet',
	        title: expense.description,
	        amount: -expense.amount,
	        pocketIds: [expense.pocketId],
	        meta: `${expense.category} · ${getPocketName(state.pockets, expense.pocketId)} · ${getPocketMethod(
	          state.pockets,
	          expense.pocketId,
	        )}`,
	        detail: `Salida ${expense.source} · confianza ${Math.round(expense.confidence * 100)}%`,
	      })),
	      ...movementMonthIncomes.map((income) => ({
	        id: income.id,
	        date: income.date,
	        time: income.time,
	        kind: 'ingreso' as const,
	        source: 'manual' as const,
	        editable: true,
	        deletable: true,
	        title: income.title,
	        amount: income.amount,
	        pocketIds: [income.pocketId],
	        meta: `${getPocketName(state.pockets, income.pocketId)} · ${getPocketMethod(
	          state.pockets,
	          income.pocketId,
	        )}`,
	        detail: income.recurring ? 'Ingreso recurrente' : 'Ingreso manual',
	      })),
	      ...movementMonthTransfers.map((transfer) => ({
	        id: transfer.id,
	        date: transfer.date,
	        time: transfer.time,
	        kind: 'transferencia' as const,
	        source: 'transfer' as const,
	        editable: true,
	        deletable: true,
	        title: transfer.note || 'Transferencia interna',
	        amount: transfer.amount,
	        pocketIds: [transfer.fromPocketId, transfer.toPocketId],
	        meta: `${getPocketName(state.pockets, transfer.fromPocketId)} (${getPocketMethod(
	          state.pockets,
	          transfer.fromPocketId,
	        )}) -> ${getPocketName(state.pockets, transfer.toPocketId)} (${getPocketMethod(
	          state.pockets,
	          transfer.toPocketId,
	        )})`,
	        detail: transfer.note.trim() || 'Movimiento interno entre bolsillos',
	      })),
	    ]

	    return items.sort((a, b) => {
	      const aKey = `${a.date}T${normalizeTimeHHmm(a.time)}`
	      const bKey = `${b.date}T${normalizeTimeHHmm(b.time)}`
	      if (aKey === bKey) return 0
	      return aKey < bKey ? 1 : -1
	    })
	  }, [movementMonthExpenses, movementMonthIncomes, movementMonthTransfers, state.pockets])

  const selectedPocket = state.pockets.find((pocket) => pocket.id === selectedPocketId) ?? state.pockets[0]

	  const filteredActivity = useMemo(() => {
	    const normalizedQuery = normalize(movementFilters.query)

	    return movementActivity
	      .filter((item) => {
	        const matchesPocket =
	          movementFilters.pocketId === 'todos' || item.pocketIds.includes(movementFilters.pocketId)
	        const matchesKind = movementFilters.kind === 'todos' || item.kind === movementFilters.kind
	        const matchesDate = !movementFilters.date || item.date === movementFilters.date
	        const matchesQuery =
	          !normalizedQuery ||
	          normalize(item.title).includes(normalizedQuery) ||
	          normalize(item.meta).includes(normalizedQuery) ||
	          normalize(item.detail).includes(normalizedQuery)
	        const matchesPocketType =
	          movementFilters.pocketType === 'todos' ||
	          item.pocketIds.some((pocketId) => {
	            const pocketType = state.pockets.find((pocket) => pocket.id === pocketId)?.type
	            return pocketType === movementFilters.pocketType
	          })

	        return matchesPocket && matchesKind && matchesDate && matchesQuery && matchesPocketType
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
	  }, [
	    movementActivity,
	    movementFilters.date,
	    movementFilters.kind,
	    movementFilters.pocketId,
	    movementFilters.pocketType,
	    movementFilters.query,
	    state.pockets,
	    state.transfers,
	  ])

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

  const movementExpenseRatio =
    movementSummary.inflow > 0
      ? movementSummary.outflow / movementSummary.inflow
      : movementSummary.outflow > 0
        ? 1
        : 0
  const movementVolume = movementSummary.inflow + movementSummary.outflow
  const movementAverageTicket =
    movementSummary.count > 0 ? movementVolume / movementSummary.count : 0

  const summaryDrilldown = useMemo(() => {
    const previousMovements = [
      ...state.incomes
        .filter((item) => item.date.slice(0, 7) < currentMonthKey)
        .map((income) => ({
          id: `income-${income.id}`,
          title: income.title,
          date: income.date,
          amount: income.amount,
          meta: getPocketName(state.pockets, income.pocketId),
        })),
      ...state.expenses
        .filter((item) => item.date.slice(0, 7) < currentMonthKey)
        .map((expense) => ({
          id: `expense-${expense.id}`,
          title: expense.description,
          date: expense.date,
          amount: -expense.amount,
          meta: `${expense.category} · ${getPocketName(state.pockets, expense.pocketId)}`,
        })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1))

    return {
      ingresos: monthIncomes.map((income) => ({
        id: income.id,
        title: income.title,
        date: income.date,
        amount: income.amount,
        meta: getPocketName(state.pockets, income.pocketId),
      })),
      gastos: monthExpenses.map((expense) => ({
        id: expense.id,
        title: expense.description,
        date: expense.date,
        amount: expense.amount,
        meta: `${expense.category} · ${getPocketName(state.pockets, expense.pocketId)}`,
      })),
      saldoAnterior: previousMovements,
    }
  }, [currentMonthKey, monthExpenses, monthIncomes, state.expenses, state.incomes, state.pockets])

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

  const monthOverMonth = useMemo(() => {
    const previousIncome = totals.previousIncomes
    const previousExpense = totals.previousExpenses
    const previousNet = previousIncome - previousExpense
    const currentNet = totals.netFlow
    const netDelta = currentNet - previousNet

    return {
      previousIncome,
      previousExpense,
      previousNet,
      currentNet,
      netDelta,
    }
  }, [totals.netFlow, totals.previousExpenses, totals.previousIncomes])

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
    closeMobileMenu()
    if (module) setActiveModule(module)
  }

  const isMobileMenuExpanded = isMobileMenuOpen || isMobileMenuClosing

  function isSectionCollapsed(sectionId: string) {
    return collapsedSections[sectionId] ?? false
  }

  function toggleSection(sectionId: string) {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }))
  }

  function openMovementOrigin(kind: MovementKind, source?: string) {
    if (kind === 'gasto' && source === 'fixed') {
      jumpToView('programacion')
      return
    }

    if (kind === 'gasto' && source === 'debt') {
      jumpToView('deudas')
      return
    }

    jumpToView('movimientos')
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
      category: 'Otros',
      categorySource: 'suggested',
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
        category: expense.category,
        categorySource: 'manual',
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
    let movementDate = today
    let isRetroactive = false

    if (kind === 'gasto') {
      const expense = state.expenses.find((item) => item.id === movementId)
      if (!expense || (expense.source !== 'manual' && expense.source !== 'wallet')) return
      movementDate = expense.date
      isRetroactive = expense.date.slice(0, 7) < currentMonthKey
    } else if (kind === 'ingreso') {
      const income = state.incomes.find((item) => item.id === movementId)
      if (income) {
        movementDate = income.date
        isRetroactive = income.date.slice(0, 7) < currentMonthKey
      }
    } else {
      const transfer = state.transfers.find((item) => item.id === movementId)
      if (transfer) {
        movementDate = transfer.date
        isRetroactive = transfer.date.slice(0, 7) < currentMonthKey
      }
    }

    let confirmMsg = 'Este movimiento se eliminara de forma permanente.'
    if (isRetroactive) {
      const monthsImpacted = getMonthsImpacted(movementDate, currentMonthKey)
      const monthsNames = monthsImpacted.map(formatMonthName).join(', ')
      confirmMsg = `Este movimiento pertenece a ${formatMonthName(movementDate.slice(0, 7))}. Si lo eliminas, se recalcularán los resultados de: ${monthsNames}. ¿Quieres continuar?`
    }

    if (!window.confirm(confirmMsg)) return

    setState((current) => {
      if (kind === 'gasto') {
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
    if (numericAmount <= 0) return

    const trimmedDescription = expenseForm.description.trim()
    const expenseDate = expenseForm.date || today
    const fallbackTime = getCurrentTimeHHmm()
    const isRetroactive = expenseDate.slice(0, 7) < currentMonthKey

    const executeAddExpense = () => {
      setState((current) => {
        const currentExpense = current.expenses.find((item) => item.id === expenseForm.id)
        const selectedCategory = expenseForm.category
        const selectedConfidence = getCategoryConfidenceForSelection(
          selectedCategory,
          suggestion.category,
          suggestion.confidence,
        )
        const learnedKeywords = trimmedDescription
          ? deriveLearningKeywords(trimmedDescription, suggestion.matches)
          : []
        const expense: Expense = {
          id: expenseForm.id || crypto.randomUUID(),
          description: trimmedDescription || 'Gasto',
          amount: numericAmount,
          pocketId: expenseForm.pocketId,
          date: expenseDate,
          time: currentExpense?.time ?? fallbackTime,
          source: currentExpense?.source ?? 'manual',
          category: selectedCategory,
          confidence: selectedConfidence,
        }

        const learningRules = [...current.learningRules]
        learnedKeywords.forEach((keyword) => {
          const existingIndex = learningRules.findIndex((rule) => rule.keyword === keyword)
          if (existingIndex === -1) {
            learningRules.push({ keyword, category: selectedCategory, hits: 1 })
            return
          }

          const existingRule = learningRules[existingIndex]
          learningRules[existingIndex] = {
            keyword,
            category: selectedCategory,
            hits:
              existingRule.category === selectedCategory
                ? existingRule.hits + 1
                : Math.max(1, Math.round(existingRule.hits * 0.6)) + 1,
          }
        })

        return {
          ...current,
          learningRules,
          expenses: expenseForm.id
            ? current.expenses.map((item) => (item.id === expenseForm.id ? expense : item))
            : [expense, ...current.expenses],
        }
      })

      resetExpenseForm()
      setOpenComposer(null)
    }

    if (isRetroactive) {
      const monthsImpacted = getMonthsImpacted(expenseDate, currentMonthKey)
      const monthsNames = monthsImpacted.map(formatMonthName).join(', ')
      const confirmMsg = `Este movimiento pertenece a ${formatMonthName(expenseDate.slice(0, 7))}. Si lo guardas, se recalcularán los resultados de: ${monthsNames}. ¿Quieres continuar?`
      
      if (!window.confirm(confirmMsg)) return
    }

    executeAddExpense()
  }

  function handleAddIncome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAmount = Number(incomeForm.amount)
    if (!incomeForm.title.trim() || numericAmount <= 0) return

	    const incomeDate = incomeForm.date || today
	    const fallbackTime = getCurrentTimeHHmm()
	    const isRetroactive = incomeDate.slice(0, 7) < currentMonthKey

    const executeAddIncome = () => {
      setState((current) => {
	        const income: Income = {
	          id: incomeForm.id || crypto.randomUUID(),
	          title: incomeForm.title.trim(),
	          amount: numericAmount,
	          pocketId: incomeForm.pocketId,
	          date: incomeDate,
	          time: current.incomes.find((item) => item.id === incomeForm.id)?.time ?? fallbackTime,
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

    if (isRetroactive) {
      const monthsImpacted = getMonthsImpacted(incomeDate, currentMonthKey)
      const monthsNames = monthsImpacted.map(formatMonthName).join(', ')
      const confirmMsg = `Este movimiento pertenece a ${formatMonthName(incomeDate.slice(0, 7))}. Si lo guardas, se recalcularán los resultados de: ${monthsNames}. ¿Quieres continuar?`
      
      if (!window.confirm(confirmMsg)) return
    }

    executeAddIncome()
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

	    const transferDate = transferForm.date || today
	    const fallbackTime = getCurrentTimeHHmm()
	    const isRetroactive = transferDate.slice(0, 7) < currentMonthKey

	    const executeAddTransfer = () => {
	      setState((current) => {
	        const currentTransfer = current.transfers.find((item) => item.id === transferForm.id)
	        const transfer: Transfer = {
	          id: transferForm.id || crypto.randomUUID(),
	          fromPocketId: transferForm.fromPocketId,
	          toPocketId: transferForm.toPocketId,
	          amount: numericAmount,
	          date: transferDate,
	          time: currentTransfer?.time ?? fallbackTime,
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

    if (isRetroactive) {
      const monthsImpacted = getMonthsImpacted(transferDate, currentMonthKey)
      const monthsNames = monthsImpacted.map(formatMonthName).join(', ')
      const confirmMsg = `Este movimiento pertenece a ${formatMonthName(transferDate.slice(0, 7))}. Si lo guardas, se recalcularán los resultados de: ${monthsNames}. ¿Quieres continuar?`
      
      if (!window.confirm(confirmMsg)) return
    }

    executeAddTransfer()
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
	        time: getCurrentTimeHHmm(),
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
	        time: getCurrentTimeHHmm(),
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
    if (authMode === 'register') {
      if (!authForm.cedula.trim() || !authForm.nombre.trim()) return
      if (!robotCheckRequested) {
        setAuthFeedback('Solicita primero la verificacion anti-bot.')
        return
      }

      if (!robotCheckVerified || robotCheckAnswer.trim() !== robotCheck.expectedAnswer) {
        setAuthFeedback('Completa correctamente la verificacion anti-bot antes de crear el usuario.')
        return
      }
    }

    setIsSubmittingAuth(true)
    setAuthFeedback(null)

    const result =
      authMode === 'login'
        ? await auth.signIn(authForm.username.trim(), authForm.password)
        : await auth.signUp(
            authForm.username.trim(),
            authForm.cedula.trim(),
            authForm.password,
            authForm.nombre.trim(),
          )

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
    function openDatePicker(input: HTMLInputElement | null) {
      if (!input) return
      input.focus()
      ;(input as HTMLInputElement & { showPicker?: () => void }).showPicker?.()
      input.click()
    }

    if (activeModule === 'gasto') {
      const selectedExpensePocketName = getPocketName(state.pockets, expenseForm.pocketId)
      const selectedCategoryConfidence = getCategoryConfidenceForSelection(
        expenseForm.category,
        suggestion.category,
        suggestion.confidence,
      )
      const selectedCategoryConfidenceLabel = getConfidenceLabel(selectedCategoryConfidence)
      const isSuggestedCategorySelected = expenseForm.category === suggestion.category
      const categoryLearningKeywords = deriveLearningKeywords(expenseForm.description, suggestion.matches)
      const isExpenseFormValid = Number(expenseForm.amount) > 0

      return (
        <form className="bank-form movement-form" onSubmit={handleAddExpense}>
          <div className="movement-form-layout">
            <section className="movement-form-card movement-form-main movement-expense-description-card">
              <div className="movement-field-grid">
                <label className="movement-field-span-2">
                  Descripcion del gasto
                  <input
                    value={expenseForm.description}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="Ej. Uber oficina, mercado, restaurante"
                  />
                </label>
	                <label>
	                  Monto
	                  <input
	                    type="text"
	                    inputMode="numeric"
	                    pattern="[0-9]*"
	                    value={expenseForm.amount}
	                    onChange={(event) =>
	                      setExpenseForm((current) => ({ ...current, amount: keepOnlyDigits(event.target.value) }))
	                    }
	                    placeholder="85000"
	                  />
	                </label>
                <label>
                  Bolsillo
                  <select
                    value={expenseForm.pocketId}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, pocketId: event.target.value }))
                    }
                  >
                    {state.pockets.map((pocket) => (
                      <option key={pocket.id} value={pocket.id}>
                        {pocket.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="movement-field-span-2">
                  Fecha del movimiento
                  <div className="date-input-shell">
                    <div className="date-input-display" aria-hidden="true">
                      <span>{formatDateInputDisplay(expenseForm.date)}</span>
                      <LuCalendar />
                    </div>
                    <input
                      ref={expenseDateInputRef}
                      className="date-input-native-overlay"
                      type="date"
                      value={expenseForm.date}
                      aria-label="Fecha del movimiento"
                      onChange={(event) => setExpenseForm((current) => ({ ...current, date: event.target.value }))}
                      onClick={() => openDatePicker(expenseDateInputRef.current)}
                    />
                  </div>
                </label>
                <div className="movement-field-span-2 expense-category-card">
                  <label className="expense-category-select">
                    Categoria
                    <select
                      value={expenseForm.category}
                      onChange={(event) =>
                        setExpenseForm((current) => ({
                          ...current,
                          category: event.target.value as Category,
                          categorySource:
                            event.target.value === suggestion.category ? 'suggested' : 'manual',
                        }))
                      }
                    >
                      {state.categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>

                  {!isSuggestedCategorySelected && (
                    <button
                      type="button"
                      className="secondary-button slim expense-category-reset"
                      onClick={() =>
                        setExpenseForm((current) => ({
                          ...current,
                          category: suggestion.category,
                          categorySource: 'suggested',
                        }))
                      }
                    >
                      Usar sugerencia IA
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="composer-action-row movement-form-actions">
            <button type="submit" disabled={!isExpenseFormValid}>
              {expenseForm.id ? 'Guardar gasto' : 'Registrar salida'}
            </button>
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
          </div>

          <section className="movement-form-card expense-post-info-card">
            <div className="expense-category-meta">
              <p>
                Categoria seleccionada: <strong>{expenseForm.category}</strong>.
              </p>
              <p>
                Confianza actual:{' '}
                <strong>
                  {selectedCategoryConfidenceLabel} ({Math.round(selectedCategoryConfidence * 100)}%)
                </strong>
                .
              </p>
              <p>
                La IA propone <strong>{suggestion.category}</strong> con confianza{' '}
                <strong>{Math.round(suggestion.confidence * 100)}%</strong>.
              </p>
              <p>
                {suggestion.matches.length > 0
                  ? `Motivo: detecte ${suggestion.matches.join(', ')} en la descripcion.`
                  : 'Motivo: no habia reglas suficientes, asi que use coincidencias generales del texto.'}
              </p>
              <p>
                {categoryLearningKeywords.length > 0
                  ? `Aprendera con: ${categoryLearningKeywords.join(', ')}.`
                  : 'Aprendera con esta descripcion cuando confirmes el gasto.'}
              </p>
              <span
                className={
                  isSuggestedCategorySelected
                    ? 'expense-category-chip suggested'
                    : 'expense-category-chip manual'
                }
              >
                {isSuggestedCategorySelected ? 'IA activa' : 'Ajuste manual'}
              </span>
            </div>

            <div className="movement-expense-summary">
              <span className="movement-section-label">Salida</span>
              <strong>{selectedExpensePocketName}</strong>
              <p>{expenseForm.date}</p>
              <p>
                Al guardar, esta eleccion reforzara la categoria <strong>{expenseForm.category}</strong>.
              </p>
            </div>
          </section>
        </form>
      )
    }

    if (activeModule === 'ingreso') {
      const selectedIncomePocketName = getPocketName(state.pockets, incomeForm.pocketId)
      const isIncomeFormValid = Number(incomeForm.amount) > 0

      return (
        <form className="bank-form movement-form" onSubmit={handleAddIncome}>
          <div className="movement-form-layout">
            <section className="movement-form-card movement-form-main">
              <div className="movement-field-grid">
                <label className="movement-field-span-2">
                  Concepto del ingreso
                  <input
                    value={incomeForm.title}
                    onChange={(event) => setIncomeForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Ej. nomina, freelance, devolucion"
                  />
                </label>
	                <label>
	                  Monto
	                  <input
	                    type="text"
	                    inputMode="numeric"
	                    pattern="[0-9]*"
	                    value={incomeForm.amount}
	                    onChange={(event) =>
	                      setIncomeForm((current) => ({ ...current, amount: keepOnlyDigits(event.target.value) }))
	                    }
	                    placeholder="5200000"
	                  />
	                </label>
                <label>
                  Bolsillo destino
                  <select
                    value={incomeForm.pocketId}
                    onChange={(event) =>
                      setIncomeForm((current) => ({ ...current, pocketId: event.target.value }))
                    }
                  >
                    {state.pockets.map((pocket) => (
                      <option key={pocket.id} value={pocket.id}>
                        {pocket.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="movement-field-span-2">
                  Fecha del movimiento
                  <div className="date-input-shell">
                    <div className="date-input-display" aria-hidden="true">
                      <span>{formatDateInputDisplay(incomeForm.date)}</span>
                      <LuCalendar />
                    </div>
                    <input
                      ref={incomeDateInputRef}
                      className="date-input-native-overlay"
                      type="date"
                      value={incomeForm.date}
                      aria-label="Fecha del movimiento"
                      onChange={(event) => setIncomeForm((current) => ({ ...current, date: event.target.value }))}
                      onClick={() => openDatePicker(incomeDateInputRef.current)}
                    />
                  </div>
                </label>
              </div>
            </section>
          </div>

          <div className="composer-action-row movement-form-actions">
            <button type="submit" disabled={!isIncomeFormValid}>
              {incomeForm.id ? 'Guardar ingreso' : 'Registrar ingreso'}
            </button>
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
          </div>

          <aside className="movement-form-card movement-form-side">
            <label className="movement-toggle-card">
              <div>
                <span className="movement-section-label">Frecuencia</span>
                <strong>Ingreso recurrente</strong>
                <p>Activalo si este ingreso vuelve mes a mes y quieres mantenerlo identificado.</p>
              </div>
              <input
                type="checkbox"
                checked={incomeForm.recurring}
                onChange={(event) =>
                  setIncomeForm((current) => ({ ...current, recurring: event.target.checked }))
                }
              />
            </label>
          </aside>

          <section className="movement-form-hero movement-form-hero-income movement-form-hero-tail-mobile">
            <div>
              <span className="movement-section-label">Entrada</span>
              <strong>Captura ingresos con trazabilidad</strong>
              <p>Define el origen del dinero, su destino y si debe repetirse en el tiempo.</p>
            </div>
            <div className="movement-hero-badges">
              <span>{selectedIncomePocketName}</span>
              <span>{incomeForm.recurring ? 'Recurrente' : 'Unico'}</span>
            </div>
          </section>
        </form>
      )
    }

    if (activeModule === 'transferencia') {
      const fromPocketName = getPocketName(state.pockets, transferForm.fromPocketId)
      const toPocketName = getPocketName(state.pockets, transferForm.toPocketId)
      const isTransferFormValid =
        transferForm.fromPocketId !== transferForm.toPocketId &&
        Number(transferForm.amount) > 0 &&
        transferForm.fromPocketId.trim().length > 0 &&
        transferForm.toPocketId.trim().length > 0

      return (
        <form className="bank-form movement-form" onSubmit={handleAddTransfer}>
          <div className="movement-form-layout">
            <section className="movement-form-card movement-form-main">
              <div className="movement-field-grid">
                <label>
                  Desde bolsillo
                  <select
                    value={transferForm.fromPocketId}
                    onChange={(event) =>
                      setTransferForm((current) => ({ ...current, fromPocketId: event.target.value }))
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
                  Hacia bolsillo
                  <select
                    value={transferForm.toPocketId}
                    onChange={(event) =>
                      setTransferForm((current) => ({ ...current, toPocketId: event.target.value }))
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
	                  Monto
	                  <input
	                    type="text"
	                    inputMode="numeric"
	                    pattern="[0-9]*"
	                    value={transferForm.amount}
	                    onChange={(event) =>
	                      setTransferForm((current) => ({ ...current, amount: keepOnlyDigits(event.target.value) }))
	                    }
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
                <label className="movement-field-span-2">
                  Fecha del movimiento
                  <div className="date-input-shell">
                    <div className="date-input-display" aria-hidden="true">
                      <span>{formatDateInputDisplay(transferForm.date)}</span>
                      <LuCalendar />
                    </div>
                    <input
                      ref={transferDateInputRef}
                      className="date-input-native-overlay"
                      type="date"
                      value={transferForm.date}
                      aria-label="Fecha del movimiento"
                      onChange={(event) => setTransferForm((current) => ({ ...current, date: event.target.value }))}
                      onClick={() => openDatePicker(transferDateInputRef.current)}
                    />
                  </div>
                </label>
              </div>
            </section>
          </div>

          <div className="composer-action-row movement-form-actions">
            <button type="submit" disabled={!isTransferFormValid}>
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
          </div>

          <aside className="movement-form-card movement-form-side">
            <div className="movement-transfer-preview">
              <span className="movement-section-label">Ruta</span>
              <strong>{fromPocketName}</strong>
              <p>sale desde el bolsillo origen</p>
              <div className="movement-transfer-arrow">hacia</div>
              <strong>{toPocketName}</strong>
              <p>entra al bolsillo destino</p>
            </div>
          </aside>

          <section className="movement-form-hero movement-form-hero-transfer movement-form-hero-tail-mobile">
            <div>
              <span className="movement-section-label">Transferencia</span>
              <strong>Mueve dinero entre bolsillos</strong>
              <p>Confirma origen, destino y monto para mantener el balance interno consistente.</p>
            </div>
            <div className="movement-hero-badges">
              <span>{fromPocketName}</span>
              <span>{toPocketName}</span>
            </div>
          </section>
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
	                type="text"
	                inputMode="numeric"
	                pattern="[0-9]*"
	                value={fixedForm.amount}
	                onChange={(event) =>
	                  setFixedForm((current) => ({ ...current, amount: keepOnlyDigits(event.target.value) }))
	                }
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
        <section className="hero-grid summary-hero-single">
          <article className="portfolio-card">
            <div className="portfolio-head">
              <div>
                <span className="micro-label">Balance</span>
                <strong>{money.format(totals.pocketBalance)}</strong>
                <p className="panel-subtitle">Total conciliado entre saldo arrastrado e impacto del mes actual.</p>
              </div>
              <small>{totals.netFlow >= 0 ? 'Flujo positivo' : 'Flujo negativo'}</small>
            </div>
            <div className="portfolio-metrics summary-reconciliation-grid">
              <div className="reconciliation-row interactive expandable-row" onClick={() => setActiveSummaryBreakdown('ingresos')}>
                <div className="expandable-row-content">
                  <span className="reconciliation-label">Ingresos del mes</span>
                  <strong style={{ color: 'var(--success)' }}>{money.format(totals.totalIncomes)}</strong>
                </div>
                <button type="button" className="expand-arrow-btn" aria-label="Ver detalle">
                  <LuChevronDown />
                </button>
              </div>
              <div className="reconciliation-row interactive expandable-row" onClick={() => setActiveSummaryBreakdown('gastos')}>
                <div className="expandable-row-content">
                  <span className="reconciliation-label">Gastos del mes</span>
                  <strong>{money.format(totals.totalExpenses)}</strong>
                </div>
                <button type="button" className="expand-arrow-btn" aria-label="Ver detalle">
                  <LuChevronDown />
                </button>
              </div>
              {totals.carriedBalance !== 0 && (
                <div className="reconciliation-row interactive expandable-row" onClick={() => setActiveSummaryBreakdown('saldoAnterior')}>
                  <div className="expandable-row-content">
                    <span className="reconciliation-label">Saldo arrastrado</span>
                    <strong className={totals.carriedBalance >= 0 ? 'value-positive' : 'value-negative'}>
                      {money.format(totals.carriedBalance)}
                    </strong>
                  </div>
                  <button type="button" className="expand-arrow-btn" aria-label="Ver detalle">
                    <LuChevronDown />
                  </button>
                </div>
              )}
              <div className="reconciliation-row total-row">
                <MetricLabel
                  label="Balance total"
                  info="Resultado real disponible: saldo arrastrado de meses anteriores más el flujo neto del mes actual. Debe coincidir con el total distribuido en tus bolsillos."
                />
                <strong style={{ fontSize: '1.1em' }}>{money.format(totals.totalExplainedBalance)}</strong>
              </div>
            </div>
          </article>

        </section>

        {activeSummaryBreakdown && (
          <FullscreenComposer
            isOpen={true}
            label="Detalle"
            title={
              activeSummaryBreakdown === 'ingresos'
                ? 'Detalle de ingresos'
                : activeSummaryBreakdown === 'gastos'
                  ? 'Detalle de gastos'
                  : 'Detalle del saldo arrastrado'
            }
            description="Movimientos que componen este total"
            onClose={() => setActiveSummaryBreakdown(null)}
          >
            <div className="summary-detail-list">
              {activeSummaryBreakdown === 'ingresos' && (
                <>
                  {summaryDrilldown.ingresos.map((item) => (
                    <article key={item.id} className="summary-detail-row">
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.date} · {item.meta}</p>
                      </div>
                      <strong className="value-positive">{money.format(item.amount)}</strong>
                    </article>
                  ))}
                  {summaryDrilldown.ingresos.length === 0 && <p className="empty-copy">No hay ingresos en este mes.</p>}
                </>
              )}

              {activeSummaryBreakdown === 'gastos' && (
                <>
                  {summaryDrilldown.gastos.map((item) => (
                    <article key={item.id} className="summary-detail-row">
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.date} · {item.meta}</p>
                      </div>
                      <strong className="value-negative">-{money.format(item.amount)}</strong>
                    </article>
                  ))}
                  {summaryDrilldown.gastos.length === 0 && <p className="empty-copy">No hay gastos en este mes.</p>}
                </>
              )}

              {activeSummaryBreakdown === 'saldoAnterior' && (
                <>
                  {summaryDrilldown.saldoAnterior.map((item) => (
                    <article key={item.id} className="summary-detail-row">
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.date} · {item.meta}</p>
                      </div>
                      <strong className={item.amount >= 0 ? 'value-positive' : 'value-negative'}>
                        {item.amount >= 0 ? '+' : '-'}
                        {money.format(Math.abs(item.amount))}
                      </strong>
                    </article>
                  ))}
                  {summaryDrilldown.saldoAnterior.length === 0 && (
                    <p className="empty-copy">No hay meses anteriores con movimientos para justificar saldo arrastrado.</p>
                  )}
                </>
              )}
            </div>
          </FullscreenComposer>
        )}

        <section className="analytics-grid">
          <SectionFrame
            label="Flujo"
            title="Lectura financiera"
            subtitle="Resumen rápido de cómo está respirando tu caja este mes: cuánto entra, cuánto sale y qué presión ejerce la deuda pendiente."
            collapsed={isSectionCollapsed('summary-lectura')}
            onToggle={() => toggleSection('summary-lectura')}
          >
            <div className="flow-metric-list">
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <MetricLabel label="Ingresos del mes" info="Todo lo que entró durante el mes activo." />
                  <strong>{money.format(totals.totalIncomes)}</strong>
                </div>
                <div className="flow-bar income">
                  <div style={{ width: `${(totals.totalIncomes / summaryAnalytics.maxFlowBase) * 100}%` }} />
                </div>
              </div>
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <MetricLabel label="Gastos del mes" info="Todo lo que salió durante el mes activo." />
                  <strong>{money.format(totals.totalExpenses)}</strong>
                </div>
                <div className="flow-bar expense">
                  <div style={{ width: `${(totals.totalExpenses / summaryAnalytics.maxFlowBase) * 100}%` }} />
                </div>
              </div>
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <MetricLabel
                    label="Deuda pendiente"
                    info="Saldo restante por pagar de todas las deudas activas. No es una salida del mes, pero sí una presión futura sobre tu flujo."
                  />
                  <strong>{money.format(totals.pendingDebt)}</strong>
                </div>
                <div className="flow-bar debt">
                  <div style={{ width: `${(totals.pendingDebt / summaryAnalytics.maxFlowBase) * 100}%` }} />
                </div>
              </div>
            </div>
          </SectionFrame>

          <SectionFrame
            label="Comparativo"
            title="Mes contra mes"
            subtitle={`Tomas el mes actual y lo comparas contra ${previousMonthKey} para entender si el flujo va mejor o peor.`}
            collapsed={isSectionCollapsed('summary-mesmes')}
            onToggle={() => toggleSection('summary-mesmes')}
          >
            <div className="flow-metric-list">
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <MetricLabel
                    label={`Ingresos ${previousMonthKey}`}
                    info="Entradas del mes anterior calculadas en vivo. Si registras algo con fecha anterior, el resumen se ajusta automaticamente."
                  />
                  <strong>{money.format(monthOverMonth.previousIncome)}</strong>
                </div>
                <div className="flow-bar income">
                  <div
                    style={{
                      width: `${(monthOverMonth.previousIncome / summaryAnalytics.maxFlowBase) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <MetricLabel
                    label={`Gastos ${previousMonthKey}`}
                    info="Salidas del mes anterior. Sirve como base para comparar si este mes estás gastando más o menos."
                  />
                  <strong>{money.format(monthOverMonth.previousExpense)}</strong>
                </div>
                <div className="flow-bar expense">
                  <div
                    style={{
                      width: `${(monthOverMonth.previousExpense / summaryAnalytics.maxFlowBase) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flow-metric">
                <div className="flow-metric-head">
                  <MetricLabel
                    label="Variacion del neto"
                    info="Diferencia entre el resultado neto del mes actual y el del mes anterior. Positivo es mejora; negativo es deterioro."
                  />
                  <strong className={monthOverMonth.netDelta >= 0 ? 'value-positive' : 'value-negative'}>
                    {monthOverMonth.netDelta >= 0 ? '+' : ''}
                    {money.format(monthOverMonth.netDelta)}
                  </strong>
                </div>
                <div className="flow-bar debt">
                  <div
                    style={{
                      width: `${Math.min((Math.abs(monthOverMonth.netDelta) / summaryAnalytics.maxFlowBase) * 100, 100)}%`,
                    }}
                  />
                </div>
                <p className="movement-detail">
                  Neto actual {money.format(monthOverMonth.currentNet)} frente a neto previo {money.format(monthOverMonth.previousNet)}
                </p>
              </div>
            </div>
          </SectionFrame>

          <SectionFrame
            label="Bolsillos"
            title="Distribucion del saldo"
            collapsed={isSectionCollapsed('summary-distribucion-saldo')}
            onToggle={() => toggleSection('summary-distribucion-saldo')}
          >
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
          </SectionFrame>

          <SectionFrame
            label="Categorias"
            title="Distribucion del gasto"
            subtitle="Muestra en qué categorías se está concentrando el gasto del mes y qué porcentaje representa cada una sobre el total gastado."
            collapsed={isSectionCollapsed('summary-distribucion-gasto')}
            onToggle={() => toggleSection('summary-distribucion-gasto')}
          >
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
          </SectionFrame>

          <SectionFrame
            label="Deudas"
            title="Amortizacion activa"
            collapsed={isSectionCollapsed('summary-amortizacion')}
            onToggle={() => toggleSection('summary-amortizacion')}
          >
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
          </SectionFrame>

          <SectionFrame
            label="Tendencia"
            title="Flujo diario del mes"
            collapsed={isSectionCollapsed('summary-flujo-diario')}
            onToggle={() => toggleSection('summary-flujo-diario')}
          >
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
          </SectionFrame>

          <SectionFrame
            label="Tendencia"
            title="Ultimos seis meses"
            collapsed={isSectionCollapsed('summary-ultimos-meses')}
            onToggle={() => toggleSection('summary-ultimos-meses')}
          >
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
          </SectionFrame>
        </section>

        <section className="dashboard-grid">
          <div className="primary-column">
            <SectionFrame
              label="Supervisor mensual"
              title="Estado operativo"
              subtitle={coachingMessage}
              collapsed={isSectionCollapsed('summary-operativo')}
              onToggle={() => toggleSection('summary-operativo')}
              emphasis
            >
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
            </SectionFrame>

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

            <SectionFrame
              label="Centro transaccional"
              title={moduleLabels[activeModule]}
              subtitle={getModuleSummary(activeModule)}
              collapsed={isSectionCollapsed('summary-transaccional')}
              onToggle={() => toggleSection('summary-transaccional')}
            >
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
            </SectionFrame>
          </div>

          <aside className="secondary-column">
            <SectionFrame
              label="Bolsillos"
              title="Saldos por bolsillo"
              collapsed={isSectionCollapsed('summary-bolsillos')}
              onToggle={() => toggleSection('summary-bolsillos')}
            >
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
            </SectionFrame>

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

        {auth.user && (
          <section className="panel banking-panel summary-user-panel">
            <div className="panel-header">
              <div>
                <span className="micro-label">Usuario</span>
                <h2>Perfil activo</h2>
              </div>
            </div>
            <div className="summary-user-card">
              <div className="summary-user-copy">
                <strong>Hola, {auth.user.nombre?.split(' ')[0] || auth.user.username}</strong>
                <p>@{auth.user.username}</p>
                <p>{auth.user.cedula}</p>
                <span className="user-type-badge">{auth.user.typeuser ?? 'user'}</span>
              </div>
              <button type="button" className="sidebar-logout-btn" onClick={() => auth.signOut()}>
                Cerrar sesion
              </button>
            </div>
          </section>
        )}
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
          {openPocketDetailId && (
            <FullscreenComposer
              isOpen={Boolean(openPocketDetailId)}
              label="Bolsillo"
              title={state.pockets.find((pocket) => pocket.id === openPocketDetailId)?.name ?? 'Detalle'}
              description="Detalle del bolsillo seleccionado."
              onClose={() => setOpenPocketDetailId(null)}
            >
              {(() => {
                const pocket = state.pockets.find((item) => item.id === openPocketDetailId)
                if (!pocket) return null

                const pocketActivity = activity.filter((item) => item.pocketIds.includes(pocket.id)).slice(0, 8)

                return (
                  <section className="pocket-detail-modal">
                    <div className="pocket-summary-grid">
                      <div className="summary-box">
                        <span>Saldo actual</span>
                        <strong>{money.format(pocketBalances[pocket.id] ?? 0)}</strong>
                      </div>
                      <div className="summary-box">
                        <span>Tipo</span>
                        <strong>{getPocketTypeLabel(pocket.type)}</strong>
                      </div>
                      <div className="summary-box accent">
                        <span>Identidad</span>
                        <strong>
                          <span className="icon-badge inline" style={{ background: pocket.color }}>
                            {pocket.icon}
                          </span>
                          {pocket.name}
                        </strong>
                      </div>
                    </div>
                    <div className="composer-action-row">
                      <button
                        type="button"
                        className="action-trigger"
                        onClick={() => {
                          setOpenPocketDetailId(null)
                          startEditPocket(pocket.id)
                        }}
                      >
                        Editar bolsillo
                      </button>
                    </div>
                    <div className="ledger">
                      {pocketActivity.map((item) => (
                        <article key={item.kind + item.id} className="ledger-row">
                          <div className={`ledger-icon ${item.kind}`}></div>
                          <div className="ledger-copy">
                            <strong>{item.title}</strong>
                            <p>{item.date}</p>
                          </div>
                          <strong className={item.amount >= 0 ? 'value-positive' : 'value-negative'}>
                            {item.amount >= 0 ? '+' : '-'}
                            {money.format(Math.abs(item.amount))}
                          </strong>
                        </article>
                      ))}
                      {pocketActivity.length === 0 && <p className="empty-copy">Este bolsillo no tiene movimientos recientes.</p>}
                    </div>
                  </section>
                )
              })()}
            </FullscreenComposer>
          )}

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

          <SectionFrame
            label="Mapa de bolsillos"
            title="Tus bolsillos"
            collapsed={isSectionCollapsed('pockets-grid')}
            onToggle={() => toggleSection('pockets-grid')}
            actions={
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
            }
          >
            <div className="account-strip two-cols">
              {state.pockets.map((pocket) => (
                <article
                  key={pocket.id}
                  className={pocket.id === selectedPocketId ? 'account-card selected' : 'account-card'}
                  onClick={() => {
                    setSelectedPocketId(pocket.id)
                    setOpenPocketDetailId(pocket.id)
                  }}
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
                      <LuPencil />
                    </button>
                  </div>
                  <strong>{pocket.name}</strong>
                  <p>{money.format(pocketBalances[pocket.id] ?? 0)}</p>
                </article>
              ))}
            </div>
          </SectionFrame>
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
	            enableSwipeClose
	            hideHeader
	            hideHeaderCopy
	            floatingClose={false}
	            panelClassName="movement-composer-panel"
	            toolbarClassName="movement-composer-toolbar"
	            bodyClassName="movement-composer-body"
	            onClose={() => {
	              resetExpenseForm()
	              resetIncomeForm()
	              resetTransferForm()
	              setOpenComposer(null)
	            }}
	          >
	            <section className="movement-composer-switcher-card">
	              <button
	                type="button"
	                className="icon-action-button close-icon-button movement-composer-close"
	                aria-label="Cerrar ventana"
	                title="Cerrar"
	                onClick={() => {
	                  resetExpenseForm()
	                  resetIncomeForm()
	                  resetTransferForm()
	                  setOpenComposer(null)
	                }}
	                onTouchEnd={(event) => {
	                  event.preventDefault()
	                  resetExpenseForm()
	                  resetIncomeForm()
	                  resetTransferForm()
	                  setOpenComposer(null)
	                }}
	              >
	                ×
	              </button>
	              <div className="movement-composer-switcher-copy">
	                <span className="movement-section-label">Tipo de registro</span>
	                <p>Cambia entre gasto, ingreso o transferencia sin salir del flujo.</p>
	              </div>
	              <div className="module-segmented movement-composer-segmented">
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
	            </section>
	            {renderActiveForm()}
	          </FullscreenComposer>
	        )}

        <section className="panel banking-panel movement-command-center">
          <div className="movement-command-header">
            <div>
              <span className="micro-label">Movimientos</span>
              <h2>Centro de movimientos</h2>
            </div>
          </div>

          <div className="movement-command-nav">
            <label className="movement-command-badge movement-command-badge-full">
              <span>Mes activo</span>
              <strong>
                <input
                  type="month"
                  value={movementMonthKey}
                  onChange={(event) => setMovementMonthKey(event.target.value)}
                  className="movement-month-input"
                />
              </strong>
            </label>
          </div>

          <button
            className="action-trigger movement-register-button"
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

	          <div className="movement-filter-layout simplified">
	            <div
	              className={[
	                'filter-field',
	                'compact',
	                'inline',
	                'movement-filter-choice',
	                movementFilters.pocketId !== 'todos' ? 'is-active' : null,
	              ]
	                .filter(Boolean)
	                .join(' ')}
	            >
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
	            <div
	              className={[
	                'filter-field',
	                'compact',
	                'inline',
	                'movement-filter-choice',
	                movementFilters.kind !== 'todos' ? 'is-active' : null,
	              ]
	                .filter(Boolean)
	                .join(' ')}
	            >
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
	          </div>

            <div
              className="movement-summary-grid refined movement-summary-grid-compact movement-summary-grid-premium"
              style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
            >
              <div className="summary-box movement-stat income">
                <span>Entradas</span>
                <strong>{money.format(movementSummary.inflow)}</strong>
                <small>Flujo positivo del periodo</small>
              </div>
              <div className="summary-box movement-stat expense">
                <span>Salidas</span>
                <strong>{money.format(movementSummary.outflow)}</strong>
                <small>{percent.format(movementExpenseRatio)} consumido</small>
              </div>
              <div className="summary-box movement-stat transfer">
                <span>Movimientos</span>
                <strong>{movementSummary.count}</strong>
                <small>Ticket medio {money.format(movementAverageTicket)}</small>
              </div>
	              <div className="summary-box movement-stat balance neutral">
	                <span>Balance</span>
	                <strong>{money.format(movementSummary.inflow - movementSummary.outflow)}</strong>
	                <small>Neto del periodo</small>
	              </div>
          </div>
        </section>

	        <section className="movement-content-stack">
	          <section className="panel banking-panel movement-ledger-panel">
	            <div className="panel-header">
	              <div>
	                <h2>Movimientos detallado</h2>
	              </div>
	              <div className="movement-filter-layout simplified detailed-filters-row">
	                <div className="filter-field compact inline">
	                  <span className="filter-field-label">Detalle</span>
	                  <input
	                    type="search"
	                    value={movementFilters.query}
	                    onChange={(event) =>
	                      setMovementFilters((current) => ({ ...current, query: event.target.value }))
	                    }
	                    placeholder="Buscar por detalle..."
	                  />
	                </div>
	                <div className="filter-field compact inline">
	                  <span className="filter-field-label">Fecha</span>
	                  <div className="date-input-shell">
	                    <div className="date-input-display" aria-hidden="true">
	                      <span>
	                        {movementFilters.date ? formatDateInputDisplay(movementFilters.date) : 'Todas'}
	                      </span>
	                      <LuCalendar />
	                    </div>
	                    <input
	                      ref={movementFilterDateInputRef}
	                      className="date-input-native-overlay"
	                      type="date"
	                      value={movementFilters.date}
	                      aria-label="Filtrar por fecha"
	                      onChange={(event) =>
	                        setMovementFilters((current) => ({ ...current, date: event.target.value }))
	                      }
	                      onClick={() => movementFilterDateInputRef.current?.showPicker?.()}
	                    />
	                  </div>
	                </div>
	                <div className="filter-field compact inline">
	                  <span className="filter-field-label">Metodo</span>
	                  <div className="filter-select-wrap">
	                    <select
	                      value={movementFilters.pocketType}
	                      onChange={(event) =>
	                        setMovementFilters((current) => ({
	                          ...current,
	                          pocketType: event.target.value as 'todos' | PocketType,
	                        }))
	                      }
	                    >
	                      <option value="todos">Todos</option>
	                      <option value="daily">{describePocketType('daily')}</option>
	                      <option value="savings">{describePocketType('savings')}</option>
	                      <option value="fixed">{describePocketType('fixed')}</option>
	                      <option value="invest">{describePocketType('invest')}</option>
	                    </select>
	                  </div>
	                </div>
	                {(movementFilters.query || movementFilters.date || movementFilters.pocketType !== 'todos') && (
	                  <button
	                    type="button"
	                    className="text-link"
	                    onClick={() =>
	                      setMovementFilters((current) => ({
	                        ...current,
	                        query: '',
	                        date: '',
	                        pocketType: 'todos',
	                      }))
	                    }
	                  >
	                    Limpiar
	                  </button>
	                )}
	              </div>
	            </div>
	            <div className="ledger simple-movement-list">
              {filteredActivity.map((item) => (
                <article key={item.kind + item.id} className={`simple-movement-row ${item.kind}`}>
                  <div className="simple-movement-top">
                    <strong>{item.title}</strong>
                    <div className="movement-inline-menu">
                      <button
                        type="button"
                        className="edit-icon-button inline"
                        aria-label={`Acciones de movimiento ${item.title}`}
                        onClick={() =>
                          setOpenMovementActionId((current) => (current === item.id ? null : item.id))
                        }
                      >
                        <LuPencil />
                      </button>
                      {openMovementActionId === item.id && (
                        <div className="movement-popover">
                          {item.editable ? (
                            <button
                              type="button"
                              className="movement-popover-action"
                              onClick={() => {
                                setOpenMovementActionId(null)
                                startEditMovement(item.kind, item.id)
                              }}
                            >
                              Editar movimiento
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="movement-popover-action"
                              onClick={() => {
                                setOpenMovementActionId(null)
                                openMovementOrigin(item.kind, item.source)
                              }}
                            >
                              Abrir origen
                            </button>
                          )}
                          {item.deletable && (
                            <button
                              type="button"
                              className="movement-popover-action danger"
                              onClick={() => {
                                setOpenMovementActionId(null)
                                handleDeleteMovement(item.kind, item.id)
                              }}
                            >
                              Eliminar
                            </button>
                          )}
                          {!item.editable && !item.deletable && (
                            <p className="movement-popover-note">
                              Este movimiento se administra desde su modulo de origen.
                            </p>
                          )}
                          <button
                            type="button"
                            className="movement-popover-action"
                            onClick={() => setOpenMovementActionId(null)}
                          >
                            Cerrar
                          </button>
                        </div>
                      )}
                    </div>
	                  </div>
	                  <div className="simple-movement-meta">
	                    <div className="simple-movement-meta-text">
	                      <p>{formatMovementDateTimeDisplay(item.date, item.time)}</p>
	                      <p className="simple-movement-method">{item.meta}</p>
	                    </div>
	                    <strong className={item.kind === 'ingreso' ? 'simple-income' : 'simple-outflow'}>
	                      {item.kind === 'ingreso' ? '+' : '-'}
	                      {money.format(Math.abs(item.amount))}
	                    </strong>
	                  </div>
                </article>
              ))}
              {filteredActivity.length === 0 && (
                <p className="empty-copy">No hay movimientos con los filtros seleccionados.</p>
              )}
            </div>
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

            <SectionFrame
              label="Listado operativo"
              title="Obligaciones registradas"
              subtitle={`${state.fixedExpenses.length} registro(s)`}
              collapsed={isSectionCollapsed('programacion-obligaciones')}
              onToggle={() => toggleSection('programacion-obligaciones')}
              className="obligation-list-board"
            >
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
                      className={isLate ? 'obligation-row late-row' : 'obligation-row'}
                    >
                      <div className="obligation-header">
                        <div className="obligation-title">
                          <strong>{item.title}</strong>
                          <p className="obligation-subtitle">
                            {getPocketName(state.pockets, item.pocketId)} · {item.category}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="edit-icon-button obligation-edit"
                          aria-label={`Editar obligacion ${item.title}`}
                          onClick={() => startEditFixedExpense(item.id)}
                        >
                          <LuPencil />
                        </button>
                      </div>

                      <div className="obligation-meta">
                        <span className="obligation-chip">Pago dia {item.dueDay}</span>
                        <span className="obligation-chip">Confirmar dia {item.confirmationDay}</span>
                      </div>

                      <div className="obligation-footer">
                        <div className="obligation-amount">
                          <span className="obligation-amount-value">{money.format(item.amount)}</span>
                          <small className={!item.active ? 'paused' : isPaid ? 'paid' : isLate ? 'late' : 'pending'}>
                            {!item.active ? 'Pausada' : isPaid ? 'Pagado' : isLate ? 'Vencido' : 'Pendiente'}
                          </small>
                        </div>

                        <div className="obligation-actions">
                          {item.active && !isPaid && (
                            <button
                              type="button"
                              className={
                                isDueOrPast
                                  ? 'action-trigger obligation-primary warning-button'
                                  : 'action-trigger obligation-primary'
                              }
                              onClick={() => openFixedPaymentConfirmation(item.id)}
                            >
                              {isDueOrPast ? 'Confirmar pagado' : 'Adelantar pago'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="secondary-button slim obligation-secondary"
                            onClick={() => handleToggleFixedExpense(item.id)}
                          >
                            {item.active ? 'Pausar' : 'Reactivar'}
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </SectionFrame>
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
          <SectionFrame
            label="Resumen de deuda"
            title="Saldo pendiente"
            subtitle="Las deudas desaparecen automaticamente de la lista activa al llegar a 0."
            collapsed={isSectionCollapsed('deudas-resumen')}
            onToggle={() => toggleSection('deudas-resumen')}
            emphasis
          >
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
          </SectionFrame>

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

          <SectionFrame
            label="Obligaciones amortizables"
            title="Deudas activas"
            subtitle={`${activeDebts.length} activa(s)`}
            collapsed={isSectionCollapsed('deudas-activas')}
            onToggle={() => toggleSection('deudas-activas')}
            actions={
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
            }
          >
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
                            <LuPencil />
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
                            <LuX />
                          </button>
                        </div>
                        <label>
                          Valor a registrar
                          <input
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            min={0}
                            step={1}
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
          </SectionFrame>

          <SectionFrame
            label="Historial"
            title="Deudas pagadas"
            subtitle={`${completedDebts.length} saldada(s)`}
            collapsed={isSectionCollapsed('deudas-pagadas')}
            onToggle={() => toggleSection('deudas-pagadas')}
          >
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
          </SectionFrame>
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
	          <SectionFrame
	            label="Persistencia"
	            title="Estado de sincronizacion"
	            subtitle={
	              supabaseConfigured
	                ? `Supabase activo con perfil ${profileId ?? 'sin perfil'}.`
	                : 'Supabase aun no esta configurado. La app opera en modo local.'
	            }
	            actions={
	              supabaseConfigured ? (
	                <button type="button" className="text-link" onClick={() => void syncNow()}>
	                  Forzar sincronizacion
	                </button>
	              ) : null
	            }
	            collapsed={isSectionCollapsed('config-sync')}
	            onToggle={() => toggleSection('config-sync')}
	            emphasis
	          >
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
          </SectionFrame>

          <SectionFrame
            label="Categorias"
            title="Gestion de categorias"
            collapsed={isSectionCollapsed('config-categorias')}
            onToggle={() => toggleSection('config-categorias')}
          >
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
          </SectionFrame>

          <SectionFrame
            label="IA"
            title="Reglas de aprendizaje"
            collapsed={isSectionCollapsed('config-reglas')}
            onToggle={() => toggleSection('config-reglas')}
          >
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
          </SectionFrame>

          {isAdminUser && (
            <SectionFrame
              label="Administrador"
              title="Gestion de usuarios"
              subtitle={`${managedUsers.length} usuario(s)`}
              collapsed={isSectionCollapsed('config-usuarios')}
              onToggle={() => toggleSection('config-usuarios')}
              actions={
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
              }
            >
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
                        {showUserAdminPassword ? <LuEyeOff /> : <LuEye />}
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
                        <LuPencil />
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
            </SectionFrame>
          )}
        </div>

        <aside className="secondary-column">
          <SectionFrame
            label="Bolsillos"
            title="Etiquetas de tipos de bolsillo"
            collapsed={isSectionCollapsed('config-pocket-labels')}
            onToggle={() => toggleSection('config-pocket-labels')}
          >
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
          </SectionFrame>
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

  if (loadingPending || !bootSettled) {
    const loadingLabel = auth.isConfigured && auth.isLoading ? 'Usuarios' : 'Inicializando'
    const loadingTitle = auth.isConfigured && auth.isLoading ? 'Validando acceso' : 'Cargando datos financieros'
    const loadingDescription =
      auth.isConfigured && auth.isLoading
        ? 'Estoy conectando tu username con la base de datos.'
        : 'Estoy preparando la informacion local y la capa de sincronizacion.'

    return (
      <main className="banking-app loading-shell">
        <section className="workspace">
          <div className="panel banking-panel emphasis loading-panel">
            <LoadingProgress
              progress={bootProgress}
              label={loadingLabel}
              title={loadingTitle}
              description={loadingDescription}
            />
          </div>
        </section>
      </main>
    )
  }

  if (auth.isConfigured && !auth.user) {
    return (
      <main className="auth-shell">
        <section className={authMode === 'register' ? 'auth-panel register-mode' : 'auth-panel'}>
          <div className="auth-brand">
            <div className="brand-mark">
              <LuWallet />
            </div>
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
            {authMode === 'register' ? (
              <div className="form-grid three auth-register-grid">
                <label>
                  Username
                  <input
                    value={authForm.username}
                    onChange={(event) =>
                      setAuthForm((current) => ({ ...current, username: event.target.value }))
                    }
                    placeholder="usuario_nuevo"
                  />
                </label>
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
                <label>
                  Nombre
                  <input
                    value={authForm.nombre}
                    onChange={(event) =>
                      setAuthForm((current) => ({ ...current, nombre: event.target.value }))
                    }
                    placeholder="Nombre del usuario"
                  />
                </label>
                <label className="auth-register-password">
                  Contrasena
                  <div className="password-field password-field-auth">
                    <input
                      type={showAuthPassword ? 'text' : 'password'}
                      value={authForm.password}
                      onChange={(event) =>
                        setAuthForm((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder="Contrasena inicial"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowAuthPassword((current) => !current)}
                      aria-label={showAuthPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                      title={showAuthPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                    >
                      {showAuthPassword ? <LuEyeOff /> : <LuEye />}
                    </button>
                  </div>
                </label>
              </div>
            ) : (
              <>
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
                <label>
                  Contrasena
                  <div className="password-field password-field-auth">
                    <input
                      type={showAuthPassword ? 'text' : 'password'}
                      value={authForm.password}
                      onChange={(event) =>
                        setAuthForm((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder="Ingresa tu contrasena"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowAuthPassword((current) => !current)}
                      aria-label={showAuthPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                      title={showAuthPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                    >
                      {showAuthPassword ? <LuEyeOff /> : <LuEye />}
                    </button>
                  </div>
                </label>
              </>
            )}
            {authMode === 'register' && (
              <div className="robot-check-card">
                <div className="robot-check-header">
                  <div>
                    <span className="micro-label">Verificacion</span>
                    <strong>No robot</strong>
                    <p>Antes de crear el usuario, solicita y completa una validacion simple.</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setRobotCheck(createRobotCheck())
                      setRobotCheckRequested(true)
                      setRobotCheckAnswer('')
                      setRobotCheckVerified(false)
                      setAuthFeedback(null)
                    }}
                  >
                    {robotCheckRequested ? 'Nueva verificacion' : 'Solicitar verificacion'}
                  </button>
                </div>
                {robotCheckRequested && (
                  <div className="robot-check-body">
                    <label className="robot-check-input-group">
                      <span className="robot-check-prompt">{robotCheck.prompt}</span>
                      <input
                        inputMode="numeric"
                        value={robotCheckAnswer}
                        onChange={(event) => {
                          const nextAnswer = event.target.value.replace(/\D/g, '')
                          setRobotCheckAnswer(nextAnswer)
                          setRobotCheckVerified(nextAnswer === robotCheck.expectedAnswer)
                        }}
                        placeholder="Escribe el resultado"
                      />
                    </label>
                    <p className={`robot-check-status ${robotCheckVerified ? 'success' : ''}`}>
                      {robotCheckVerified
                        ? 'Verificacion completada. Ya puedes crear el usuario.'
                        : 'Resuelve la operacion para habilitar el registro.'}
                    </p>
                  </div>
                )}
              </div>
            )}
            <button type="submit" disabled={isSubmittingAuth}>
              {isSubmittingAuth
                ? 'Procesando...'
                : authMode === 'login'
                  ? 'Ingresar'
                  : 'Crear usuario'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setAuthMode((current) => (current === 'login' ? 'register' : 'login'))
                setAuthFeedback(null)
                setShowAuthPassword(false)
                setAuthForm({ username: '', cedula: '', nombre: '', password: '' })
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

  return (
    <main className="banking-app">
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <div className="brand unified-brand-header">
            <div className="brand-mark">
              <LuWallet />
            </div>
            <div className="brand-copy">
              <strong>MoneyApp</strong>
              <p className="brand-subtitle">
                {auth.user ? `Hola, ${auth.user.nombre?.split(' ')[0] || auth.user.username}` : 'PANEL FINANCIERO'}
              </p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav desktop-nav">
          {orderedViews.map((view) => (
            <button
              key={view}
              className={view === activeView ? 'nav-item active' : 'nav-item'}
              type="button"
              onClick={() => jumpToView(view)}
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
	            {supabaseConfigured && syncError && <small className="movement-detail">{syncError}</small>}
	          </section>
	        </div>
	      </aside>

      <section className="workspace">
        {activeView !== 'resumen' && activeView !== 'movimientos' && (
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
        )}

        <div className="view-stage" data-view={activeView}>
          {activeView === 'resumen' && renderSummaryView()}
          {activeView === 'bolsillos' && renderPocketsView()}
          {activeView === 'movimientos' && renderMovementsView()}
          {activeView === 'programacion' && renderProgrammingView()}
          {activeView === 'deudas' && renderDebtsView()}
          {activeView === 'configuracion' && renderSettingsView()}
        </div>
      </section>

      <div className="mobile-menu-shell">
        {isMobileMenuExpanded && (
          <button
            type="button"
            className={isMobileMenuOpen ? 'mobile-menu-backdrop open' : 'mobile-menu-backdrop'}
            aria-label="Cerrar navegacion"
            onClick={closeMobileMenu}
          />
        )}

        <div className={isMobileMenuExpanded ? 'mobile-menu-panel open' : 'mobile-menu-panel'}>
          <button
            type="button"
            className={
              [
                'mobile-menu-trigger',
                isMobileMenuExpanded ? 'active' : '',
                isMobileMenuClosing ? 'closing' : '',
                !isMobileMenuExpanded && isMobileMenuCompact ? 'compact' : '',
              ]
                .filter(Boolean)
                .join(' ')
            }
            onClick={() => {
              if (isMobileMenuOpen) {
                closeMobileMenu()
                return
              }

              openMobileMenu()
            }}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-finance-menu"
            aria-label={isMobileMenuOpen ? `Cerrar menu de ${viewLabels[activeView]}` : `Abrir menu de ${viewLabels[activeView]}`}
          >
            <span className="mobile-menu-trigger-copy">
              <strong>{viewLabels[activeView]}</strong>
              <span>Navegacion y accesos</span>
            </span>
            <span className={isMobileMenuExpanded ? 'mobile-menu-trigger-icon open' : 'mobile-menu-trigger-icon'}>
              <LuMenu />
            </span>
          </button>

          {isMobileMenuExpanded && (
            <div
              id="mobile-finance-menu"
              className={isMobileMenuOpen ? 'mobile-menu-sheet open' : 'mobile-menu-sheet closing'}
            >
              <div className="mobile-menu-head">
                <div className="mobile-menu-head-copy">
                  <span className="micro-label">Navegacion</span>
                  <strong>{viewLabels[activeView]}</strong>
                  <p>Mueve rapido entre modulos y revisa el contexto financiero del mes.</p>
                </div>
                <button
                  type="button"
                  className="mobile-menu-close"
                  onClick={closeMobileMenu}
                  aria-label="Cerrar menu"
                >
                  <LuX />
                </button>
              </div>

              <div className="mobile-context-strip">
                <article className="mobile-context-card">
                  <MetricLabel label="Saldo total" info="Valor total distribuido entre todos tus bolsillos en este momento." />
                  <strong>{money.format(totals.pocketBalance)}</strong>
                </article>
                <article className="mobile-context-card">
                  <MetricLabel label="Pendiente fijo" info="Monto de obligaciones activas aún no confirmadas en el mes." />
                  <strong>{money.format(totals.pendingFixed)}</strong>
                </article>
                <article className="mobile-context-card wide">
                  <MetricLabel label="Deuda pendiente" info="Saldo restante por pagar en las deudas activas." />
                  <strong>{money.format(totals.pendingDebt)}</strong>
                </article>
              </div>

              <div className="mobile-menu-section navigation-section">
                <div className="mobile-menu-section-head">
                  <span className="micro-label">Secciones</span>
                  <strong>Cambia de vista</strong>
                </div>
                <div className="mobile-menu-grid">
                  {orderedViews.map((view) => (
                    <button
                      key={view}
                      type="button"
                      className={view === activeView ? 'mobile-menu-item active' : 'mobile-menu-item'}
                      onClick={() => jumpToView(view)}
                    >
                      <span className="mobile-menu-item-icon" aria-hidden="true">
                        {getViewIcon(view)}
                      </span>
                      <span>{viewLabels[view]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

export default App
