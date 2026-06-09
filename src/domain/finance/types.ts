export type PocketType = 'daily' | 'savings' | 'fixed' | 'invest'
export type ViewKey = 'resumen' | 'bolsillos' | 'movimientos' | 'programacion' | 'deudas' | 'configuracion' | 'provisiones' | 'analisis' | 'metas'
export type ModuleKey = 'gasto' | 'ingreso' | 'transferencia' | 'fijos' | 'bolsillos'
export type MovementKind = 'gasto' | 'ingreso' | 'transferencia'
export type ComposerView = 'movimientos' | 'bolsillos' | 'programacion' | 'deudas' | 'provisiones' | 'metas'

export type GoalType = 'fixed-term' | 'indefinite'

export type Pocket = {
  id: string
  name: string
  balance: number
  color: string
  icon: string
  type: PocketType
  /** Si true, todo gasto/transferencia saliente genera un gasto adicional del 0.4% (4x1000). */
  taxes4x1000?: boolean
}

export type Category = string

export type Expense = {
  id: string
  description: string
  amount: number
  pocketId: string
  date: string
  time?: string
  source: 'manual' | 'wallet' | 'fixed' | 'debt'
  category: Category
  confidence: number
  /** Si este gasto es un 4x1000 generado automáticamente por otro gasto. */
  parentExpenseId?: string
  /** Si este gasto es un 4x1000 generado automáticamente por una transferencia. */
  parentTransferId?: string
}

export type Debt = {
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

export type DebtPayment = {
  id: string
  debtId: string
  amount: number
  date: string
  kind: 'scheduled' | 'extra'
}

export type Income = {
  id: string
  title: string
  amount: number
  pocketId: string
  date: string
  time?: string
  recurring: boolean
}

export type Transfer = {
  id: string
  fromPocketId: string
  toPocketId: string
  amount: number
  date: string
  time?: string
  note: string
}

export type FixedExpense = {
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

export type LearningRule = {
  keyword: string
  category: Category
  hits: number
}

export type Provision = {
  id: string
  name: string
  pocketId: string
  monthlyAmount: number
  active: boolean
}

export type Goal = {
  id: string
  name: string
  type: GoalType
  pocketId: string
  targetAmount: number
  targetDate?: string       // YYYY-MM-DD · solo cuando type === 'fixed-term'
  startDate: string         // YYYY-MM-DD
  icon: string
  color: string
  description?: string
  active: boolean
  completedAt?: string      // ISO timestamp cuando se completa
}

export type MonthClosure = {
  monthKey: string
  closedAt: string
  income: number
  expense: number
  netFlow: number
  pocketBalance: number
  pendingDebt: number
  pendingFixed: number
}

export type AppConfig = {
  pocketTypeLabels: Record<PocketType, string>
}

export type AppState = {
  pockets: Pocket[]
  expenses: Expense[]
  incomes: Income[]
  transfers: Transfer[]
  fixedExpenses: FixedExpense[]
  debts: Debt[]
  debtPayments: DebtPayment[]
  monthClosures: MonthClosure[]
  learningRules: LearningRule[]
  categories: Category[]
  config: AppConfig
  provisions: Provision[]
  goals: Goal[]
}
