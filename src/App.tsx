import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  LuArrowLeftRight,
  LuCalendar,
  LuChevronDown,
  LuCircleDollarSign,
  LuEye,
  LuEyeOff,
  LuFlag,
  LuLayoutDashboard,
  LuMenu,
  LuPencil,
  LuPiggyBank,
  LuChartLine,
  LuSettings2,
  LuTarget,
  LuTrash2,
  LuTrophy,
  LuWallet,
  LuX,
} from 'react-icons/lu'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
  Goal,
  GoalType,
  Income,
  LearningRule,
  ModuleKey,
  MovementKind,
  Pocket,
  PocketType,
  Provision,
  Transfer,
  ViewKey,
} from './domain/finance/types'
import { usePersistentSnapshot } from './hooks/usePersistentSnapshot'
import { useSimpleUsersAuth } from './hooks/useSimpleUsersAuth'
import { createSupabaseFinanceDriver, markEntityForRemoteDelete } from './services/supabaseFinance'
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
  if (view === 'provisiones') return <LuTarget />
  if (view === 'analisis') return <LuChartLine />
  if (view === 'metas') return <LuFlag />
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
    provisions: raw.provisions ?? initialState.provisions,
    goals: raw.goals ?? initialState.goals,
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

const CHART_PALETTE = [
  '#60a5fa', '#34d399', '#f59e0b', '#a78bfa', '#f472b6',
  '#fb7185', '#22d3ee', '#facc15', '#4ade80', '#c084fc',
  '#fb923c', '#38bdf8',
]

const formatChartMoney = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

function ChartTooltip({ active, payload, label, formatValue }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="recharts-tip">
      {label && <strong className="recharts-tip-label">{label}</strong>}
      {payload.map((entry: any) => (
        <div key={entry.dataKey ?? entry.name} className="recharts-tip-row">
          <i className="chart-dot" style={{ background: entry.color ?? entry.payload?.fill }} />
          <span>{entry.name}</span>
          <strong>{formatValue ? formatValue(entry.value) : entry.value}</strong>
        </div>
      ))}
    </div>
  )
}

function GroupedBarChart({
  data,
  formatValue,
}: {
  data: Array<{ label: string; income: number; expense: number }>
  formatValue?: (value: number) => string
}) {
  if (!data.length) {
    return <p className="empty-copy">Sin datos suficientes para graficar.</p>
  }
  return (
    <div className="chart-shell chart-shell-bar">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="chartIncomeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="chartExpenseGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#e11d48" stopOpacity={0.8} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="rgba(226, 232, 240, 0.65)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <YAxis
            stroke="rgba(226, 232, 240, 0.65)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatChartMoney}
            width={50}
          />
          <Tooltip
            content={<ChartTooltip formatValue={formatValue} />}
            cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
            iconType="circle"
            iconSize={8}
            formatter={(value: string) => <span style={{ color: 'rgba(226, 232, 240, 0.85)' }}>{value}</span>}
          />
          <Bar dataKey="income" name="Ingresos" fill="url(#chartIncomeGradient)" radius={[5, 5, 0, 0]} maxBarSize={42} />
          <Bar dataKey="expense" name="Gastos" fill="url(#chartExpenseGradient)" radius={[5, 5, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function DonutChart({
  data,
  formatValue,
  centerLabel = 'Total',
}: {
  data: Array<{ label: string; value: number; color?: string }>
  formatValue?: (value: number) => string
  centerLabel?: string
}) {
  const filteredData = data.filter((item) => item.value > 0)
  const total = filteredData.reduce((sum, item) => sum + item.value, 0)
  if (total <= 0) {
    return <p className="empty-copy">Sin datos para graficar.</p>
  }
  const chartData = filteredData.map((item, index) => ({
    ...item,
    name: item.label,
    color: item.color ?? CHART_PALETTE[index % CHART_PALETTE.length],
  }))

  return (
    <div className="donut-chart-shell">
      <div className="donut-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius="60%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="rgba(15, 23, 42, 0.6)"
              strokeWidth={2}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={<ChartTooltip formatValue={formatValue ?? ((v) => money.format(v))} />}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <span>{centerLabel}</span>
          <strong>{formatValue ? formatValue(total) : formatChartMoney(total)}</strong>
        </div>
      </div>
      <div className="donut-legend">
        {chartData.map((slice) => (
          <div key={slice.name} className="donut-legend-item">
            <i className="chart-dot" style={{ background: slice.color }} />
            <span className="donut-legend-label">{slice.label}</span>
            <strong className="donut-legend-value">{((slice.value / total) * 100).toFixed(0)}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function LineAreaChart({
  data,
  formatValue,
  showZeroLine = true,
}: {
  data: Array<{ label: string; value: number }>
  formatValue?: (value: number) => string
  showZeroLine?: boolean
}) {
  if (data.length < 2) {
    return <p className="empty-copy">Necesitas al menos dos puntos para proyectar.</p>
  }
  const hasNegative = data.some((d) => d.value < 0)
  return (
    <div className="chart-shell chart-shell-area">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="lineAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="rgba(226, 232, 240, 0.65)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            stroke="rgba(226, 232, 240, 0.65)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatChartMoney}
            width={50}
          />
          <Tooltip
            content={<ChartTooltip formatValue={formatValue ?? ((v) => money.format(v))} />}
            cursor={{ stroke: 'rgba(96, 165, 250, 0.4)', strokeDasharray: '3 3' }}
          />
          {hasNegative && showZeroLine && (
            <ReferenceLine y={0} stroke="rgba(251, 113, 133, 0.6)" strokeDasharray="3 3" />
          )}
          <Area
            type="monotone"
            dataKey="value"
            name="Saldo"
            stroke="#60a5fa"
            strokeWidth={2.5}
            fill="url(#lineAreaGradient)"
            dot={{ r: 3, fill: '#67e8f9', stroke: '#0f172a', strokeWidth: 1 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ScenarioAreaChart({
  data,
}: {
  data: Array<{ label: string; pesimista: number; realista: number; optimista: number }>
}) {
  if (data.length < 2) {
    return <p className="empty-copy">Sin datos suficientes para proyectar escenarios.</p>
  }
  return (
    <div className="chart-shell chart-shell-area">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="scenarioOpt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="scenarioReal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="scenarioPes" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
          <XAxis dataKey="label" stroke="rgba(226, 232, 240, 0.65)" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="rgba(226, 232, 240, 0.65)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatChartMoney} width={50} />
          <Tooltip content={<ChartTooltip formatValue={(v: number) => money.format(v)} />} cursor={{ stroke: 'rgba(96, 165, 250, 0.4)', strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={8} formatter={(value: string) => <span style={{ color: 'rgba(226, 232, 240, 0.85)' }}>{value}</span>} />
          <Area type="monotone" dataKey="optimista" name="Optimista" stroke="#34d399" strokeWidth={2} fill="url(#scenarioOpt)" />
          <Area type="monotone" dataKey="realista" name="Realista" stroke="#60a5fa" strokeWidth={2.5} fill="url(#scenarioReal)" />
          <Area type="monotone" dataKey="pesimista" name="Pesimista" stroke="#fb7185" strokeWidth={2} fill="url(#scenarioPes)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function WeekdayBarChart({
  data,
}: {
  data: Array<{ label: string; fullLabel: string; value: number; count: number }>
}) {
  return (
    <div className="chart-shell chart-shell-bar">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="weekdayGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.8} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
          <XAxis dataKey="label" stroke="rgba(226, 232, 240, 0.65)" fontSize={11} tickLine={false} axisLine={false} interval={0} />
          <YAxis stroke="rgba(226, 232, 240, 0.65)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatChartMoney} width={50} />
          <Tooltip
            content={(props: any) => {
              if (!props.active || !props.payload?.length) return null
              const d = props.payload[0].payload
              return (
                <div className="recharts-tip">
                  <strong className="recharts-tip-label">{d.fullLabel}</strong>
                  <div className="recharts-tip-row">
                    <i className="chart-dot" style={{ background: '#a78bfa' }} />
                    <span>Gasto promedio</span>
                    <strong>{money.format(d.value)}</strong>
                  </div>
                  <div className="recharts-tip-row">
                    <i className="chart-dot" style={{ background: '#94a3b8' }} />
                    <span>Transacciones</span>
                    <strong>{d.count}</strong>
                  </div>
                </div>
              )
            }}
            cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          />
          <Bar dataKey="value" name="Gasto promedio" fill="url(#weekdayGradient)" radius={[5, 5, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function SavingsRateChart({
  data,
}: {
  data: Array<{ label: string; value: number }>
}) {
  if (data.length < 2) {
    return <p className="empty-copy">Sin histórico suficiente.</p>
  }
  return (
    <div className="chart-shell chart-shell-area">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="savingsRateGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
          <XAxis dataKey="label" stroke="rgba(226, 232, 240, 0.65)" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="rgba(226, 232, 240, 0.65)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} width={50} />
          <Tooltip content={<ChartTooltip formatValue={(v: number) => `${v}%`} />} cursor={{ stroke: 'rgba(96, 165, 250, 0.4)', strokeDasharray: '3 3' }} />
          <ReferenceLine y={20} stroke="rgba(52, 211, 153, 0.5)" strokeDasharray="3 3" label={{ value: 'Meta 20%', fill: 'rgba(52, 211, 153, 0.85)', fontSize: 10, position: 'insideTopRight' }} />
          <Area type="monotone" dataKey="value" name="Tasa de ahorro" stroke="#34d399" strokeWidth={2.5} fill="url(#savingsRateGradient)" dot={{ r: 3, fill: '#10b981', stroke: '#0f172a', strokeWidth: 1 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function HorizontalBarList({
  data,
  formatValue,
}: {
  data: Array<{ label: string; value: number; color?: string }>
  formatValue: (value: number) => string
}) {
  if (!data.length) {
    return <p className="empty-copy">Sin datos disponibles.</p>
  }
  const truncate = (text: string, max = 16) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  const chartData = data.map((item, index) => ({
    ...item,
    name: truncate(item.label),
    fullName: item.label,
    color: item.color ?? CHART_PALETTE[index % CHART_PALETTE.length],
  }))
  const dynamicHeight = Math.max(180, chartData.length * 44)
  return (
    <div className="chart-shell chart-shell-hbar" style={{ height: dynamicHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" horizontal={false} />
          <XAxis
            type="number"
            stroke="rgba(226, 232, 240, 0.65)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatChartMoney}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="rgba(226, 232, 240, 0.85)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={110}
          />
          <Tooltip
            content={<ChartTooltip formatValue={formatValue} />}
            cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
          />
          <Bar dataKey="value" name="Total" radius={[0, 6, 6, 0]} maxBarSize={28}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
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
    pullNow,
  } = usePersistentSnapshot<AppState>({
    storageKey: STORAGE_KEY,
    initialState,
    hydrate: hydrateState,
    remote: remoteDriver,
  })

  // ─────────────── Supabase Realtime: sync instantáneo entre dispositivos ───────────────
  useEffect(() => {
    if (!auth.user?.id || !pullNow) return
    const client = getSupabaseClient()
    if (!client) return

    const userId = auth.user.id
    let debounceTimer: number | null = null

    // Cuando llegan muchos cambios juntos (e.g. el usuario añade 3 cosas
    // rápido en otro dispositivo), debouncamos para no recargar 3 veces.
    const scheduleRefresh = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        void pullNow()
      }, 400)
    }

    const tablesToWatch = [
      'bolsillos',
      'gastos',
      'ingresos',
      'transferencias',
      'obligaciones',
      'deudas',
      'pagos_obligaciones',
      'pagos_deudas',
      'cierres_mensuales',
      'categorias',
      'reglas_aprendizaje',
      'provisiones',
      'metas',
      'configuracion',
    ]

    const channel = client.channel(`finpilot-realtime-${userId}`)

    tablesToWatch.forEach((table) => {
      channel.on(
        // @ts-expect-error - tipo de postgres_changes no es exhaustivo
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `usuario_id=eq.${userId}`,
        },
        scheduleRefresh,
      )
    })

    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        // suscripción exitosa
      }
    })

    return () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      void client.removeChannel(channel)
    }
  }, [auth.user?.id, pullNow])
  const [activeView, setActiveView] = useState<ViewKey>('resumen')
  const [activeModule, setActiveModule] = useState<ModuleKey>('gasto')
  const [openComposer, setOpenComposer] = useState<ComposerView | null>(null)
  const [openObligationMetric, setOpenObligationMetric] = useState<
    null | 'pending' | 'active' | 'paid' | 'paused'
  >(null)
  const [uiNotice, setUiNotice] = useState<null | { id: number; title: string; message: string }>(
    null,
  )
  const noticeTimerRef = useRef<number | null>(null)
  const actionLoadingRef = useRef<Record<string, boolean>>({})
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [activeView, activeModule])

  function computePocketBalances(snapshot: AppState) {
    const balances = Object.fromEntries(snapshot.pockets.map((pocket) => [pocket.id, 0])) as Record<
      string,
      number
    >

    snapshot.incomes.forEach((income) => {
      balances[income.pocketId] = (balances[income.pocketId] ?? 0) + income.amount
    })

    snapshot.expenses.forEach((expense) => {
      balances[expense.pocketId] = (balances[expense.pocketId] ?? 0) - expense.amount
    })

    snapshot.transfers.forEach((transfer) => {
      balances[transfer.fromPocketId] = (balances[transfer.fromPocketId] ?? 0) - transfer.amount
      balances[transfer.toPocketId] = (balances[transfer.toPocketId] ?? 0) + transfer.amount
    })

    return balances
  }

  function showUiNotice(title: string, message: string) {
    setUiNotice({ id: Date.now(), title, message })
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      setUiNotice(null)
      noticeTimerRef.current = null
    }, 3000)
  }

  function beginAction(key: string) {
    if (actionLoadingRef.current[key]) return false
    actionLoadingRef.current[key] = true
    setActionLoading((current) => ({ ...current, [key]: true }))
    return true
  }

  function endAction(key: string, delayMs = 350) {
    window.setTimeout(() => {
      delete actionLoadingRef.current[key]
      setActionLoading((current) => {
        if (!current[key]) return current
        const next = { ...current }
        delete next[key]
        return next
      })
    }, delayMs)
  }

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    }
  }, [])

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
  const [summaryMonthKey, setSummaryMonthKey] = useState(currentMonthKey)
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
  const [provisionForm, setProvisionForm] = useState({
    id: '',
    name: '',
    pocketId: initialState.pockets[0].id,
    monthlyAmount: '',
    createNewPocket: false,
    newPocketName: '',
    newPocketColor: '#7c3aed',
    newPocketIcon: '🎯',
  })
  const [goalForm, setGoalForm] = useState({
    id: '',
    name: '',
    type: 'fixed-term' as GoalType,
    pocketId: initialState.pockets[0].id,
    targetAmount: '',
    targetDate: '',
    icon: '🎯',
    color: '#7c3aed',
    description: '',
    createNewPocket: false,
    newPocketName: '',
  })
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
  const orderedViews: ViewKey[] = ['resumen', 'movimientos', 'bolsillos', 'programacion', 'deudas', 'provisiones', 'metas', 'analisis', 'configuracion']

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
  const previousMonthKey = getMonthKeyFromOffset(summaryMonthKey, -1)

  const monthExpenses = useMemo(
    () => state.expenses.filter((expense) => expense.date.startsWith(summaryMonthKey)),
    [summaryMonthKey, state.expenses],
  )
  const monthIncomes = useMemo(
    () => state.incomes.filter((income) => income.date.startsWith(summaryMonthKey)),
    [summaryMonthKey, state.incomes],
  )
  const monthTransfers = useMemo(
    () => state.transfers.filter((transfer) => transfer.date.startsWith(summaryMonthKey)),
    [summaryMonthKey, state.transfers],
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

  const activeProvisions = useMemo(
    () => state.provisions.filter((provision) => provision.active),
    [state.provisions],
  )

  const totalMonthlyProvision = useMemo(
    () => activeProvisions.reduce((sum, provision) => sum + provision.monthlyAmount, 0),
    [activeProvisions],
  )

  const provisionProgress = useMemo(() => {
    const progress: Record<string, number> = {}
    for (const provision of activeProvisions) {
      const fromIncomes = state.incomes
        .filter((income) => income.pocketId === provision.pocketId && income.date.startsWith(currentMonthKey))
        .reduce((sum, income) => sum + income.amount, 0)
      const fromTransfers = state.transfers
        .filter((transfer) => transfer.toPocketId === provision.pocketId && transfer.date.startsWith(currentMonthKey))
        .reduce((sum, transfer) => sum + transfer.amount, 0)
      progress[provision.id] = fromIncomes + fromTransfers
    }
    return progress
  }, [activeProvisions, state.incomes, state.transfers, currentMonthKey])

  // ─────────────── Cálculos para el módulo de Análisis ───────────────
  const analysisMonths = useMemo(() => {
    const months: string[] = []
    for (let offset = -5; offset <= 0; offset++) {
      months.push(getMonthKeyFromOffset(currentMonthKey, offset))
    }
    return months
  }, [currentMonthKey])

  const monthlyFlowSeries = useMemo(() => {
    return analysisMonths.map((monthKey) => {
      const income = state.incomes
        .filter((item) => item.date.startsWith(monthKey))
        .reduce((sum, item) => sum + item.amount, 0)
      const expense = state.expenses
        .filter((item) => item.date.startsWith(monthKey))
        .reduce((sum, item) => sum + item.amount, 0)
      return {
        monthKey,
        label: monthKey.slice(5),
        income,
        expense,
        net: income - expense,
      }
    })
  }, [analysisMonths, state.incomes, state.expenses])

  const averagesLast6 = useMemo(() => {
    const monthsWithIncome = monthlyFlowSeries.filter((m) => m.income > 0)
    const monthsWithExpense = monthlyFlowSeries.filter((m) => m.expense > 0)
    const totalIncome = monthsWithIncome.reduce((sum, m) => sum + m.income, 0)
    const totalExpense = monthsWithExpense.reduce((sum, m) => sum + m.expense, 0)
    const avgIncome = monthsWithIncome.length ? totalIncome / monthsWithIncome.length : 0
    const avgExpense = monthsWithExpense.length ? totalExpense / monthsWithExpense.length : 0
    const avgNet = avgIncome - avgExpense
    const savingsRate = avgIncome > 0 ? avgNet / avgIncome : 0
    return { avgIncome, avgExpense, avgNet, savingsRate }
  }, [monthlyFlowSeries])

  const expensesByCategory = useMemo(() => {
    const buckets: Record<string, number> = {}
    state.expenses
      .filter((expense) => expense.date.startsWith(currentMonthKey))
      .forEach((expense) => {
        buckets[expense.category] = (buckets[expense.category] ?? 0) + expense.amount
      })
    return Object.entries(buckets)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
  }, [state.expenses, currentMonthKey])

  const expensesByPocket = useMemo(() => {
    const buckets: Record<string, number> = {}
    state.expenses
      .filter((expense) => expense.date.startsWith(currentMonthKey))
      .forEach((expense) => {
        buckets[expense.pocketId] = (buckets[expense.pocketId] ?? 0) + expense.amount
      })
    return Object.entries(buckets)
      .map(([pocketId, value]) => {
        const pocket = state.pockets.find((p) => p.id === pocketId)
        return {
          label: pocket ? `${pocket.icon} ${pocket.name}` : 'Sin bolsillo',
          value,
          subtitle: pocket?.name ?? undefined,
        }
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [state.expenses, state.pockets, currentMonthKey])

  const debtAnalysis = useMemo(() => {
    const totalDebt = activeDebts.reduce((sum, d) => sum + d.remainingAmount, 0)
    const totalInstallment = activeDebts.reduce(
      (sum, d) => sum + Math.min(d.installmentAmount, d.remainingAmount),
      0,
    )
    const monthsToPayoff = totalInstallment > 0 ? Math.ceil(totalDebt / totalInstallment) : 0
    const debtToIncomeRatio = averagesLast6.avgIncome > 0 ? totalDebt / averagesLast6.avgIncome : 0
    const installmentToIncomeRatio =
      averagesLast6.avgIncome > 0 ? totalInstallment / averagesLast6.avgIncome : 0
    return {
      totalDebt,
      totalInstallment,
      monthsToPayoff,
      debtToIncomeRatio,
      installmentToIncomeRatio,
      activeCount: activeDebts.length,
    }
  }, [activeDebts, averagesLast6.avgIncome])

  const savingsProjection = useMemo(() => {
    const totalIncomes = state.incomes.reduce((sum, item) => sum + item.amount, 0)
    const totalExpenses = state.expenses.reduce((sum, item) => sum + item.amount, 0)
    const currentTotal = totalIncomes - totalExpenses
    const series: Array<{ label: string; value: number }> = []
    let runningTotal = currentTotal
    series.push({ label: 'Hoy', value: runningTotal })
    for (let i = 1; i <= 6; i++) {
      runningTotal += averagesLast6.avgNet
      const futureKey = getMonthKeyFromOffset(currentMonthKey, i)
      series.push({ label: futureKey.slice(5), value: runningTotal })
    }
    return { series, currentTotal, projected6Months: runningTotal }
  }, [state.incomes, state.expenses, averagesLast6.avgNet, currentMonthKey])

  const historicalBalanceSeries = useMemo(() => {
    let runningBalance = 0
    return monthlyFlowSeries.map((month) => {
      runningBalance += month.net
      return { label: month.label, value: runningBalance }
    })
  }, [monthlyFlowSeries])

  const topExpensesThisMonth = useMemo(() => {
    return state.expenses
      .filter((expense) => expense.date.startsWith(currentMonthKey))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
  }, [state.expenses, currentMonthKey])

  const fixedCommitmentRatio = useMemo(() => {
    const totalFixed = state.fixedExpenses
      .filter((item) => item.active)
      .reduce((sum, item) => sum + item.amount, 0)
    const totalProvisions = totalMonthlyProvision
    const totalDebtInstallments = debtAnalysis.totalInstallment
    const totalCommitments = totalFixed + totalProvisions + totalDebtInstallments
    const ratio = averagesLast6.avgIncome > 0 ? totalCommitments / averagesLast6.avgIncome : 0
    return { totalFixed, totalProvisions, totalDebtInstallments, totalCommitments, ratio }
  }, [state.fixedExpenses, totalMonthlyProvision, debtAnalysis.totalInstallment, averagesLast6.avgIncome])

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

  // ─────────────── Cálculos para módulo de Metas ───────────────
  const goalProgressList = useMemo(() => {
    const todayDate = new Date(`${today}T00:00:00`)
    return state.goals.map((goal) => {
      const currentAmount = Math.max(0, pocketBalances[goal.pocketId] ?? 0)
      const progress = goal.targetAmount > 0 ? Math.min(1, currentAmount / goal.targetAmount) : 0
      const remaining = Math.max(0, goal.targetAmount - currentAmount)
      const isCompleted = currentAmount >= goal.targetAmount

      // Días desde el inicio
      const startDate = new Date(`${goal.startDate}T00:00:00`)
      const daysSinceStart = Math.max(
        1,
        Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
      )

      // Ritmo de ahorro promedio diario (cuánto ha acumulado / días)
      const dailyPace = currentAmount / daysSinceStart

      let monthlyContributionNeeded = 0
      let daysRemaining = 0
      let estimatedCompletionDate: string | undefined
      let isOnTrack = true

      if (goal.type === 'fixed-term' && goal.targetDate) {
        const targetDate = new Date(`${goal.targetDate}T00:00:00`)
        daysRemaining = Math.max(
          0,
          Math.floor((targetDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)),
        )
        const monthsRemaining = Math.max(1, daysRemaining / 30)
        monthlyContributionNeeded = remaining / monthsRemaining

        // ¿Vas bien?
        const expectedAccumulated =
          (goal.targetAmount * daysSinceStart) / (daysSinceStart + daysRemaining)
        isOnTrack = currentAmount >= expectedAccumulated * 0.9
      } else if (goal.type === 'indefinite' && dailyPace > 0) {
        const daysToCompletion = remaining / dailyPace
        const completionDate = new Date(todayDate.getTime() + daysToCompletion * 24 * 60 * 60 * 1000)
        estimatedCompletionDate = formatDateISO(completionDate)
      }

      return {
        goal,
        currentAmount,
        progress,
        remaining,
        isCompleted,
        daysSinceStart,
        daysRemaining,
        monthlyContributionNeeded,
        estimatedCompletionDate,
        isOnTrack,
        dailyPace,
      }
    })
  }, [state.goals, pocketBalances, today])

  const activeGoals = useMemo(() => goalProgressList.filter((g) => g.goal.active), [goalProgressList])
  const completedGoals = useMemo(
    () => goalProgressList.filter((g) => !g.goal.active || g.isCompleted),
    [goalProgressList],
  )

  // ─────────────── Análisis avanzado: KPIs diarios, comparativos, patrones, alertas ───────────────
  const currentMonthDate = new Date(`${currentMonthKey}-01T00:00:00`)
  const daysInCurrentMonth = new Date(
    currentMonthDate.getFullYear(),
    currentMonthDate.getMonth() + 1,
    0,
  ).getDate()
  const daysRemainingInMonth = Math.max(1, daysInCurrentMonth - currentDay + 1)

  const currentMonthRealExpense = useMemo(
    () =>
      state.expenses
        .filter((expense) => expense.date.startsWith(currentMonthKey))
        .reduce((sum, item) => sum + item.amount, 0),
    [state.expenses, currentMonthKey],
  )

  const currentMonthRealIncome = useMemo(
    () =>
      state.incomes
        .filter((income) => income.date.startsWith(currentMonthKey))
        .reduce((sum, item) => sum + item.amount, 0),
    [state.incomes, currentMonthKey],
  )

  const previousMonthRealExpense = useMemo(() => {
    const prev = getMonthKeyFromOffset(currentMonthKey, -1)
    return state.expenses
      .filter((expense) => expense.date.startsWith(prev))
      .reduce((sum, item) => sum + item.amount, 0)
  }, [state.expenses, currentMonthKey])

  const previousMonthRealIncome = useMemo(() => {
    const prev = getMonthKeyFromOffset(currentMonthKey, -1)
    return state.incomes
      .filter((income) => income.date.startsWith(prev))
      .reduce((sum, item) => sum + item.amount, 0)
  }, [state.incomes, currentMonthKey])

  // KPI 1: Presupuesto disponible HOY
  const dailyBudget = useMemo(() => {
    const totalCash = Object.values(pocketBalances).reduce((sum, value) => sum + value, 0)
    const unpaidFixed = state.fixedExpenses
      .filter((item) => item.active && item.lastPaidMonth !== currentMonthKey)
      .reduce((sum, item) => sum + item.amount, 0)
    const remainingDebtInstallments = activeDebts.reduce(
      (sum, debt) => sum + Math.min(debt.installmentAmount, debt.remainingAmount),
      0,
    )
    const committed = unpaidFixed + remainingDebtInstallments
    const available = Math.max(0, totalCash - committed)
    return {
      totalCash,
      committed,
      available,
      perDay: Math.floor(available / daysRemainingInMonth),
      daysRemaining: daysRemainingInMonth,
    }
  }, [pocketBalances, state.fixedExpenses, activeDebts, currentMonthKey, daysRemainingInMonth])

  // KPI 2: Ritmo del mes
  const monthPace = useMemo(() => {
    const dayProgress = currentDay / daysInCurrentMonth
    const expectedSpentByNow = averagesLast6.avgExpense * dayProgress
    const paceRatio = expectedSpentByNow > 0 ? currentMonthRealExpense / expectedSpentByNow : 0
    let status: 'good' | 'ok' | 'warn' | 'bad' = 'ok'
    let label = 'En línea'
    if (paceRatio < 0.85) {
      status = 'good'
      label = 'Ahorrando'
    } else if (paceRatio <= 1.05) {
      status = 'ok'
      label = 'En línea'
    } else if (paceRatio <= 1.2) {
      status = 'warn'
      label = 'Adelantado'
    } else {
      status = 'bad'
      label = 'Gastando demasiado'
    }
    return {
      dayProgress,
      expectedSpentByNow,
      actualSpent: currentMonthRealExpense,
      paceRatio,
      status,
      label,
    }
  }, [currentDay, daysInCurrentMonth, averagesLast6.avgExpense, currentMonthRealExpense])

  // KPI 3: Runway (meses que aguantas sin ingresar)
  const financialRunway = useMemo(() => {
    const totalCash = Object.values(pocketBalances).reduce((sum, value) => sum + value, 0)
    const months = averagesLast6.avgExpense > 0 ? totalCash / averagesLast6.avgExpense : 0
    let status: 'good' | 'ok' | 'warn' | 'bad' = 'ok'
    if (months >= 6) status = 'good'
    else if (months >= 3) status = 'ok'
    else if (months >= 1) status = 'warn'
    else status = 'bad'
    return { totalCash, months, status }
  }, [pocketBalances, averagesLast6.avgExpense])

  // KPI 4: Cobertura fondo de emergencia
  const emergencyFundCoverage = useMemo(() => {
    const savingsBalance = state.pockets
      .filter((pocket) => pocket.type === 'savings')
      .reduce((sum, pocket) => sum + (pocketBalances[pocket.id] ?? 0), 0)
    const months = averagesLast6.avgExpense > 0 ? savingsBalance / averagesLast6.avgExpense : 0
    const target = averagesLast6.avgExpense * 3 // estándar mundial: 3 meses
    const progressToTarget = target > 0 ? Math.min(1, savingsBalance / target) : 0
    let status: 'good' | 'ok' | 'warn' | 'bad' = 'bad'
    if (months >= 6) status = 'good'
    else if (months >= 3) status = 'ok'
    else if (months >= 1) status = 'warn'
    else status = 'bad'
    return { savingsBalance, months, target, progressToTarget, status }
  }, [state.pockets, pocketBalances, averagesLast6.avgExpense])

  // Comparativo mes actual vs anterior
  const momComparison = useMemo(() => {
    const incomeDelta = previousMonthRealIncome > 0
      ? (currentMonthRealIncome - previousMonthRealIncome) / previousMonthRealIncome
      : 0
    const expenseDelta = previousMonthRealExpense > 0
      ? (currentMonthRealExpense - previousMonthRealExpense) / previousMonthRealExpense
      : 0
    const currentSavings = currentMonthRealIncome - currentMonthRealExpense
    const previousSavings = previousMonthRealIncome - previousMonthRealExpense
    const savingsDelta = previousSavings !== 0
      ? (currentSavings - previousSavings) / Math.abs(previousSavings)
      : 0
    return {
      currentIncome: currentMonthRealIncome,
      previousIncome: previousMonthRealIncome,
      incomeDelta,
      currentExpense: currentMonthRealExpense,
      previousExpense: previousMonthRealExpense,
      expenseDelta,
      currentSavings,
      previousSavings,
      savingsDelta,
    }
  }, [
    currentMonthRealIncome,
    previousMonthRealIncome,
    currentMonthRealExpense,
    previousMonthRealExpense,
  ])

  // Tendencia por categoría
  const categoryTrends = useMemo(() => {
    const prevMonths = [
      getMonthKeyFromOffset(currentMonthKey, -1),
      getMonthKeyFromOffset(currentMonthKey, -2),
      getMonthKeyFromOffset(currentMonthKey, -3),
    ]
    const buckets: Record<string, { current: number; previous: number }> = {}
    state.expenses.forEach((expense) => {
      if (expense.date.startsWith(currentMonthKey)) {
        buckets[expense.category] = buckets[expense.category] ?? { current: 0, previous: 0 }
        buckets[expense.category].current += expense.amount
      } else if (prevMonths.some((m) => expense.date.startsWith(m))) {
        buckets[expense.category] = buckets[expense.category] ?? { current: 0, previous: 0 }
        buckets[expense.category].previous += expense.amount / 3
      }
    })
    return Object.entries(buckets)
      .map(([category, values]) => {
        const delta = values.previous > 0
          ? (values.current - values.previous) / values.previous
          : values.current > 0 ? 1 : 0
        return {
          category,
          current: values.current,
          avgPrevious: values.previous,
          delta,
        }
      })
      .filter((item) => item.current > 0)
      .sort((a, b) => b.current - a.current)
      .slice(0, 6)
  }, [state.expenses, currentMonthKey])

  // Histórico tasa de ahorro
  const savingsRateHistory = useMemo(() => {
    return monthlyFlowSeries.map((month) => ({
      label: month.label,
      value: month.income > 0 ? Math.round(((month.income - month.expense) / month.income) * 100) : 0,
    }))
  }, [monthlyFlowSeries])

  // Patrón por día de la semana
  const spendingByWeekday = useMemo(() => {
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    const last3MonthKeys = [
      currentMonthKey,
      getMonthKeyFromOffset(currentMonthKey, -1),
      getMonthKeyFromOffset(currentMonthKey, -2),
    ]
    const totals = Array(7).fill(0) as number[]
    const counts = Array(7).fill(0) as number[]
    state.expenses
      .filter((expense) => last3MonthKeys.some((m) => expense.date.startsWith(m)))
      .forEach((expense) => {
        const date = new Date(`${expense.date}T00:00:00`)
        const weekday = date.getDay()
        totals[weekday] += expense.amount
        counts[weekday] += 1
      })
    return dayNames.map((label, index) => ({
      label: label.slice(0, 3),
      fullLabel: label,
      value: counts[index] > 0 ? Math.round(totals[index] / counts[index]) : 0,
      count: counts[index],
    }))
  }, [state.expenses, currentMonthKey])

  // Gastos hormiga
  const smallExpensesAnalysis = useMemo(() => {
    const threshold = 50000
    const small = state.expenses
      .filter((expense) => expense.amount < threshold && expense.date.startsWith(currentMonthKey))
    const total = small.reduce((sum, item) => sum + item.amount, 0)
    const byDescription = small.reduce<Record<string, { count: number; total: number }>>(
      (acc, expense) => {
        const key = normalize(expense.description)
        acc[key] = acc[key] ?? { count: 0, total: 0 }
        acc[key].count += 1
        acc[key].total += expense.amount
        return acc
      },
      {},
    )
    const recurring = Object.entries(byDescription)
      .map(([key, value]) => {
        const sample = small.find((e) => normalize(e.description) === key)
        return {
          description: sample?.description ?? key,
          count: value.count,
          total: value.total,
        }
      })
      .filter((item) => item.count >= 2)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
    return { total, count: small.length, threshold, recurring }
  }, [state.expenses, currentMonthKey])

  // Alertas inteligentes
  const smartAlerts = useMemo(() => {
    const alerts: Array<{ id: string; tone: 'warn' | 'bad' | 'info'; title: string; detail: string }> = []

    // Categorías que se dispararon
    categoryTrends
      .filter((trend) => trend.delta >= 0.3 && trend.avgPrevious > 10000)
      .slice(0, 3)
      .forEach((trend) => {
        alerts.push({
          id: `cat:${trend.category}`,
          tone: trend.delta >= 0.5 ? 'bad' : 'warn',
          title: `${trend.category} subó ${Math.round(trend.delta * 100)}%`,
          detail: `${money.format(trend.current)} vs promedio ${money.format(trend.avgPrevious)}`,
        })
      })

    // Bolsillos en rojo o muy bajos
    state.pockets.forEach((pocket) => {
      const balance = pocketBalances[pocket.id] ?? 0
      if (balance < 0) {
        alerts.push({
          id: `pocket-neg:${pocket.id}`,
          tone: 'bad',
          title: `${pocket.name} en rojo`,
          detail: `Saldo: ${money.format(balance)}`,
        })
      } else if (balance > 0 && balance < 50000) {
        alerts.push({
          id: `pocket-low:${pocket.id}`,
          tone: 'warn',
          title: `${pocket.name} con saldo bajo`,
          detail: `Quedan ${money.format(balance)}`,
        })
      }
    })

    // Obligaciones próximas a vencer (próximos 5 días)
    state.fixedExpenses
      .filter((item) => item.active && item.lastPaidMonth !== currentMonthKey)
      .forEach((item) => {
        const daysUntilDue = item.dueDay - currentDay
        if (daysUntilDue >= 0 && daysUntilDue <= 5) {
          alerts.push({
            id: `fixed:${item.id}`,
            tone: daysUntilDue <= 2 ? 'bad' : 'warn',
            title: `${item.title} vence ${daysUntilDue === 0 ? 'hoy' : `en ${daysUntilDue} día${daysUntilDue === 1 ? '' : 's'}`}`,
            detail: `${money.format(item.amount)} · día ${item.dueDay}`,
          })
        }
      })

    // Pace alert
    if (monthPace.status === 'bad') {
      alerts.push({
        id: 'pace',
        tone: 'bad',
        title: `Vas ${Math.round((monthPace.paceRatio - 1) * 100)}% sobre el ritmo`,
        detail: `Has gastado ${money.format(monthPace.actualSpent)} vs ${money.format(monthPace.expectedSpentByNow)} esperado.`,
      })
    }

    return alerts.slice(0, 8)
  }, [categoryTrends, state.pockets, pocketBalances, state.fixedExpenses, currentMonthKey, currentDay, monthPace])

  // Proyección con escenarios
  const scenarioProjection = useMemo(() => {
    const totalCash = Object.values(pocketBalances).reduce((sum, value) => sum + value, 0)
    const optimisticNet = averagesLast6.avgIncome * 1.05 - averagesLast6.avgExpense * 0.9
    const realisticNet = averagesLast6.avgNet
    const pessimisticNet = averagesLast6.avgIncome * 0.9 - averagesLast6.avgExpense * 1.15

    const series: Array<{ label: string; pesimista: number; realista: number; optimista: number }> = [
      { label: 'Hoy', pesimista: totalCash, realista: totalCash, optimista: totalCash },
    ]
    let p = totalCash
    let r = totalCash
    let o = totalCash
    for (let i = 1; i <= 6; i++) {
      p += pessimisticNet
      r += realisticNet
      o += optimisticNet
      const futureKey = getMonthKeyFromOffset(currentMonthKey, i)
      series.push({ label: futureKey.slice(5), pesimista: p, realista: r, optimista: o })
    }
    return { series, currentTotal: totalCash, optimisticEnd: o, realisticEnd: r, pessimisticEnd: p }
  }, [pocketBalances, averagesLast6.avgIncome, averagesLast6.avgExpense, averagesLast6.avgNet, currentMonthKey])

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
        .filter((income) => income.date.slice(0, 7) < summaryMonthKey)
        .reduce((sum, income) => sum + income.amount, 0) -
      state.expenses
        .filter((expense) => expense.date.slice(0, 7) < summaryMonthKey)
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
    fixedStatus.pending,
    monthExpenses,
    monthIncomes,
    pocketBalances,
    previousMonthExpenses,
    previousMonthIncomes,
    state.expenses,
    state.incomes,
    summaryMonthKey,
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

	  const pocketActivityById = useMemo(() => {
	    type PocketActivityItem = {
	      id: string
	      date: string
	      time?: string
	      kind: 'gasto' | 'ingreso' | 'transferencia'
	      title: string
	      amount: number
	      meta: string
	    }

	    const grouped = state.pockets.reduce<Record<string, PocketActivityItem[]>>((acc, pocket) => {
	      acc[pocket.id] = []
	      return acc
	    }, {})

	    const addPocketActivity = (pocketId: string, item: PocketActivityItem) => {
	      if (!grouped[pocketId]) grouped[pocketId] = []
	      grouped[pocketId].push(item)
	    }

	    state.incomes.forEach((income) => {
	      addPocketActivity(income.pocketId, {
	        id: `income-${income.id}`,
	        date: income.date,
	        time: income.time,
	        kind: 'ingreso',
	        title: income.title,
	        amount: income.amount,
	        meta: income.recurring ? 'Ingreso recurrente' : 'Ingreso manual',
	      })
	    })

	    state.expenses.forEach((expense) => {
	      addPocketActivity(expense.pocketId, {
	        id: `expense-${expense.id}`,
	        date: expense.date,
	        time: expense.time,
	        kind: 'gasto',
	        title: expense.description,
	        amount: -expense.amount,
	        meta: `${expense.category} · ${expense.source}`,
	      })
	    })

	    state.transfers.forEach((transfer) => {
	      addPocketActivity(transfer.fromPocketId, {
	        id: `transfer-out-${transfer.id}`,
	        date: transfer.date,
	        time: transfer.time,
	        kind: 'transferencia',
	        title: transfer.note || 'Transferencia interna',
	        amount: -transfer.amount,
	        meta: `Salida hacia ${getPocketName(state.pockets, transfer.toPocketId)}`,
	      })

	      addPocketActivity(transfer.toPocketId, {
	        id: `transfer-in-${transfer.id}`,
	        date: transfer.date,
	        time: transfer.time,
	        kind: 'transferencia',
	        title: transfer.note || 'Transferencia interna',
	        amount: transfer.amount,
	        meta: `Entrada desde ${getPocketName(state.pockets, transfer.fromPocketId)}`,
	      })
	    })

	    Object.values(grouped).forEach((items) => {
	      items.sort((a, b) => {
	        const aKey = `${a.date}T${normalizeTimeHHmm(a.time)}`
	        const bKey = `${b.date}T${normalizeTimeHHmm(b.time)}`
	        if (aKey === bKey) return 0
	        return aKey < bKey ? 1 : -1
	      })
	    })

	    return grouped
	  }, [state.expenses, state.incomes, state.pockets, state.transfers])

	  const pocketMovementTotalsById = useMemo(() => {
	    return state.pockets.reduce<Record<string, { inflow: number; outflow: number; count: number }>>((acc, pocket) => {
	      const items = pocketActivityById[pocket.id] ?? []
	      acc[pocket.id] = {
	        inflow: items.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0),
	        outflow: items.filter((item) => item.amount < 0).reduce((sum, item) => sum + Math.abs(item.amount), 0),
	        count: items.length,
	      }
	      return acc
	    }, {})
	  }, [pocketActivityById, state.pockets])

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

  const pocketsById = useMemo(() => new Map(state.pockets.map((pocket) => [pocket.id, pocket])), [state.pockets])
  const transfersById = useMemo(
    () => new Map(state.transfers.map((transfer) => [transfer.id, transfer])),
    [state.transfers],
  )

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

  const movementSummaryActivity = useMemo(() => {
    if (movementFilters.pocketId === 'todos') return movementActivity
    return movementActivity.filter((item) => item.pocketIds.includes(movementFilters.pocketId))
  }, [movementActivity, movementFilters.pocketId])

  function summarizeMovementTotals(
    items: typeof movementActivity,
    pocketId: string,
    pocketType: 'todos' | PocketType,
  ) {
    const matchesPocketType = (id: string) =>
      pocketType === 'todos' ? true : pocketsById.get(id)?.type === pocketType

    let inflow = 0
    let outflow = 0

    items.forEach((item) => {
      if (item.kind === 'transferencia') {
        const transfer = transfersById.get(item.id)
        if (!transfer) return

        const includeFrom =
          (pocketId === 'todos' || transfer.fromPocketId === pocketId) && matchesPocketType(transfer.fromPocketId)
        const includeTo =
          (pocketId === 'todos' || transfer.toPocketId === pocketId) && matchesPocketType(transfer.toPocketId)

        if (includeFrom) outflow += transfer.amount
        if (includeTo) inflow += transfer.amount
        return
      }

      const itemPocketId = item.pocketIds[0]
      if (itemPocketId && !matchesPocketType(itemPocketId)) return

      if (item.amount > 0) inflow += item.amount
      if (item.amount < 0) outflow += Math.abs(item.amount)
    })

    return {
      inflow,
      outflow,
      count: items.length,
    }
  }

  const movementSummary = useMemo(() => {
    return summarizeMovementTotals(movementSummaryActivity, movementFilters.pocketId, 'todos')
  }, [movementFilters.pocketId, movementSummaryActivity])

	  const movementListSummary = useMemo(() => {
	    return summarizeMovementTotals(filteredActivity, movementFilters.pocketId, movementFilters.pocketType)
	  }, [filteredActivity, movementFilters.kind, movementFilters.pocketId, movementFilters.pocketType, movementFilters.query])

	  function getMovementScopePocketIds(pocketId: string, pocketType: 'todos' | PocketType) {
	    return state.pockets
	      .filter((pocket) => pocketId === 'todos' || pocket.id === pocketId)
	      .filter((pocket) => pocketType === 'todos' || pocket.type === pocketType)
	      .map((pocket) => pocket.id)
	  }

	  function calculateScopedBalanceBeforeMonth(
	    monthKey: string,
	    pocketId: string,
	    pocketType: 'todos' | PocketType,
	  ) {
	    const scopePocketIds = new Set(getMovementScopePocketIds(pocketId, pocketType))
	    let balance = 0

	    state.incomes.forEach((income) => {
	      if (income.date.slice(0, 7) < monthKey && scopePocketIds.has(income.pocketId)) {
	        balance += income.amount
	      }
	    })

	    state.expenses.forEach((expense) => {
	      if (expense.date.slice(0, 7) < monthKey && scopePocketIds.has(expense.pocketId)) {
	        balance -= expense.amount
	      }
	    })

	    state.transfers.forEach((transfer) => {
	      if (transfer.date.slice(0, 7) >= monthKey) return
	      if (scopePocketIds.has(transfer.fromPocketId)) balance -= transfer.amount
	      if (scopePocketIds.has(transfer.toPocketId)) balance += transfer.amount
	    })

	    return balance
	  }

	  const movementOpeningBalance = useMemo(
	    () => calculateScopedBalanceBeforeMonth(movementMonthKey, movementFilters.pocketId, 'todos'),
	    [movementFilters.pocketId, movementMonthKey, state.expenses, state.incomes, state.pockets, state.transfers],
	  )

	  const movementEffectiveInflow = movementSummary.inflow + Math.max(0, movementOpeningBalance)
	  const movementEffectiveOutflow = movementSummary.outflow + Math.max(0, -movementOpeningBalance)
	  const movementClosingBalance = movementEffectiveInflow - movementEffectiveOutflow

	  const shouldShowMovementOpeningRow = useMemo(() => {
	    if (movementOpeningBalance === 0) return false
	    if (movementFilters.date) return false
	    if (movementFilters.kind !== 'todos' && movementFilters.kind !== 'ingreso') return false
	    if (movementFilters.pocketType !== 'todos') return false
	    const normalizedQuery = normalize(movementFilters.query)
	    if (!normalizedQuery) return true
	    return (
	      normalize('saldo anterior cierre mensual balance heredado').includes(normalizedQuery) ||
	      normalize(formatMonthName(movementMonthKey)).includes(normalizedQuery)
	    )
	  }, [
	    movementFilters.date,
	    movementFilters.kind,
	    movementFilters.pocketType,
	    movementFilters.query,
	    movementMonthKey,
	    movementOpeningBalance,
	  ])

	  const movementExpenseRatio =
	    movementEffectiveInflow > 0
	      ? movementEffectiveOutflow / movementEffectiveInflow
	      : movementEffectiveOutflow > 0
	        ? 1
	        : 0
  const movementVolume = movementListSummary.inflow + movementListSummary.outflow
  const movementAverageTicket =
    movementListSummary.count > 0 ? movementVolume / movementListSummary.count : 0

  const summaryDrilldown = useMemo(() => {
    const previousMovements = [
      ...state.incomes
        .filter((item) => item.date.slice(0, 7) < summaryMonthKey)
        .map((income) => ({
          id: `income-${income.id}`,
          title: income.title,
          date: income.date,
          amount: income.amount,
          meta: getPocketName(state.pockets, income.pocketId),
        })),
      ...state.expenses
        .filter((item) => item.date.slice(0, 7) < summaryMonthKey)
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
  }, [monthExpenses, monthIncomes, state.expenses, state.incomes, state.pockets, summaryMonthKey])

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
        estimatedPayoffMonth: getMonthKeyFromOffset(summaryMonthKey, estimatedMonthsLeft - 1),
      }
    })

    const monthTrend = Array.from({ length: 6 }, (_, index) => {
      const monthKey = getMonthKeyFromOffset(summaryMonthKey, index - 5)
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

    const [summaryYear, summaryMonth] = summaryMonthKey.split('-').map(Number)
    const daysInMonth = new Date(summaryYear, summaryMonth, 0).getDate()
    const dailyTrend = Array.from({ length: daysInMonth }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      const date = `${summaryMonthKey}-${day}`
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
  }, [activeDebts, monthExpenses, monthIncomes, pocketBalances, state.categories, state.expenses, state.incomes, state.pockets, summaryMonthKey, totals])

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

  function resetProvisionForm() {
    setProvisionForm({
      id: '',
      name: '',
      pocketId: state.pockets[0]?.id ?? initialState.pockets[0].id,
      monthlyAmount: '',
      createNewPocket: false,
      newPocketName: '',
      newPocketColor: '#7c3aed',
      newPocketIcon: '🎯',
    })
  }

  function startEditProvision(provisionId: string) {
    const provision = state.provisions.find((item) => item.id === provisionId)
    if (!provision) return
    setOpenComposer('provisiones')
    setProvisionForm({
      id: provision.id,
      name: provision.name,
      pocketId: provision.pocketId,
      monthlyAmount: String(provision.monthlyAmount),
      createNewPocket: false,
      newPocketName: '',
      newPocketColor: '#7c3aed',
      newPocketIcon: '🎯',
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
    setOpenPocketDetailId(null)
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
    const actionKey = `movimientos:eliminar:${kind}:${movementId}`
    if (!beginAction(actionKey)) return
    try {
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

      // 🛡️ Marca explícita para borrado remoto (el sync NO borra por diferencia)
      if (kind === 'gasto') markEntityForRemoteDelete('expense', movementId)
      else if (kind === 'ingreso') markEntityForRemoteDelete('income', movementId)
      else markEntityForRemoteDelete('transfer', movementId)

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
    } finally {
      endAction(actionKey, 650)
    }
  }

  function handleAddExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAmount = Number(expenseForm.amount)
    if (numericAmount <= 0) return

    const trimmedDescription = expenseForm.description.trim()
    const expenseDate = expenseForm.date || today
    const fallbackTime = getCurrentTimeHHmm()
    const isRetroactive = expenseDate.slice(0, 7) < currentMonthKey

    const pocketId = expenseForm.pocketId
    const pocketName = getPocketName(state.pockets, pocketId)
    const balances = computePocketBalances(state)
    const existingExpense = expenseForm.id
      ? state.expenses.find((item) => item.id === expenseForm.id)
      : undefined
    const availableBalance =
      (balances[pocketId] ?? 0) +
      (existingExpense && existingExpense.pocketId === pocketId ? existingExpense.amount : 0)

    if (numericAmount > availableBalance) {
      showUiNotice(
        'Saldo insuficiente',
        `El bolsillo "${pocketName}" tiene ${money.format(
          availableBalance,
        )} disponibles y estás intentando registrar ${money.format(numericAmount)}.`,
      )
      return
    }

    const actionKey = expenseForm.id ? 'movimientos:guardar-gasto' : 'movimientos:registrar-gasto'
    const executeAddExpense = () => {
      if (!beginAction(actionKey)) return
      try {
        setState((current) => {
        const currentExpense = expenseForm.id
          ? current.expenses.find((item) => item.id === expenseForm.id)
          : undefined

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
      } finally {
        endAction(actionKey)
      }
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

    const actionKey = incomeForm.id ? 'movimientos:guardar-ingreso' : 'movimientos:registrar-ingreso'
    const executeAddIncome = () => {
      if (!beginAction(actionKey)) return
      try {
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
      } finally {
        endAction(actionKey)
      }
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
    const fromPocketId = transferForm.fromPocketId
    const fromPocketName = getPocketName(state.pockets, fromPocketId)
    const transferBalances = computePocketBalances(state)
    const existingTransfer = transferForm.id
      ? state.transfers.find((item) => item.id === transferForm.id)
      : undefined
    const transferAvailableBalance =
      (transferBalances[fromPocketId] ?? 0) +
      (existingTransfer && existingTransfer.fromPocketId === fromPocketId ? existingTransfer.amount : 0)

    if (numericAmount > transferAvailableBalance) {
      showUiNotice(
        'Saldo insuficiente',
        `El bolsillo "${fromPocketName}" tiene ${money.format(
          transferAvailableBalance,
        )} disponibles y estás intentando transferir ${money.format(numericAmount)}.`,
      )
      return
    }

		    const actionKey = transferForm.id
		      ? 'movimientos:guardar-transferencia'
		      : 'movimientos:ejecutar-transferencia'
		    const executeAddTransfer = () => {
		      if (!beginAction(actionKey)) return
		      try {
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
		      } finally {
		        endAction(actionKey)
		      }
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

	    const actionKey = fixedForm.id ? 'obligaciones:guardar' : 'obligaciones:registrar'
	    if (!beginAction(actionKey)) return
	    try {
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
	    } finally {
	      endAction(actionKey)
	    }
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

    const actionKey = pocketForm.id ? 'bolsillos:guardar' : 'bolsillos:crear'
    if (!beginAction(actionKey)) return
    try {
      setState((current) => ({
        ...current,
        pockets: pocketForm.id
          ? current.pockets.map((item) => (item.id === pocketForm.id ? newPocket : item))
          : [...current.pockets, newPocket],
      }))
      resetPocketForm()
      setOpenComposer(null)
    } finally {
      endAction(actionKey)
    }
  }

  function handleDeletePocket(pocketId: string) {
    const actionKey = `bolsillos:eliminar:${pocketId}`
    if (!beginAction(actionKey)) return
    try {
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

    // 🛡️ Marca explícita para borrado remoto
    markEntityForRemoteDelete('pocket', pocketId)

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
    } finally {
      endAction(actionKey, 650)
    }
  }

	  function handlePayFixedExpense(fixedId: string, paymentPocketId?: string, paymentDate?: string) {
	    const actionKey = `obligaciones:pagar:${fixedId}`
	    if (!beginAction(actionKey)) return false
	    try {
	    const fixed = state.fixedExpenses.find((item) => item.id === fixedId)
	    const effectiveDate = paymentDate || today
	    const effectiveMonthKey = effectiveDate.slice(0, 7)
	    if (!fixed || fixed.lastPaidMonth === effectiveMonthKey) return false

	    const resolvedPocketId = paymentPocketId || fixed.pocketId
	    const balances = computePocketBalances(state)
	    const availableBalance = balances[resolvedPocketId] ?? 0
	    if (fixed.amount > availableBalance) {
	      showUiNotice(
	        'Saldo insuficiente',
	        `El bolsillo "${getPocketName(state.pockets, resolvedPocketId)}" tiene ${money.format(
	          availableBalance,
	        )} disponibles y estás intentando pagar ${money.format(fixed.amount)}.`,
	      )
	      return false
	    }

	    setState((current) => {
	      const currentFixed = current.fixedExpenses.find((item) => item.id === fixedId)
	      if (!currentFixed || currentFixed.lastPaidMonth === effectiveMonthKey) return current

	      const expense: Expense = {
	        id: crypto.randomUUID(),
	        description: currentFixed.title,
	        amount: currentFixed.amount,
	        pocketId: resolvedPocketId,
	        date: effectiveDate,
	        time: getCurrentTimeHHmm(),
	        source: 'fixed',
	        category: currentFixed.category,
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

	    return true
	    } finally {
	      endAction(actionKey)
	    }
	  }

	  function handleConfirmFixedPayment(event: React.FormEvent<HTMLFormElement>) {
	    event.preventDefault()
	    if (!fixedPaymentDraft?.fixedId || !fixedPaymentDraft.pocketId || !fixedPaymentDraft.paymentDate) return

	    const didPay = handlePayFixedExpense(
	      fixedPaymentDraft.fixedId,
	      fixedPaymentDraft.pocketId,
	      fixedPaymentDraft.paymentDate,
	    )
	    if (didPay) {
	      closeFixedPaymentConfirmation()
	    }
	  }

  function handleToggleFixedExpense(fixedId: string) {
    setState((current) => ({
      ...current,
      fixedExpenses: current.fixedExpenses.map((item) =>
        item.id === fixedId ? { ...item, active: !item.active } : item,
      ),
    }))
  }

  function handleAddProvision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const monthlyAmount = Number(provisionForm.monthlyAmount)
    if (!provisionForm.name.trim() || monthlyAmount <= 0) return

    const actionKey = provisionForm.id ? 'provisiones:guardar' : 'provisiones:crear'
    if (!beginAction(actionKey)) return
    try {
      setState((current) => {
        let targetPocketId = provisionForm.pocketId

        if (provisionForm.createNewPocket && provisionForm.newPocketName.trim()) {
          const newPocket: Pocket = {
            id: crypto.randomUUID(),
            name: provisionForm.newPocketName.trim(),
            balance: 0,
            color: provisionForm.newPocketColor,
            icon: provisionForm.newPocketIcon,
            type: 'invest',
          }
          targetPocketId = newPocket.id
          const nextProvision: Provision = {
            id: provisionForm.id || crypto.randomUUID(),
            name: provisionForm.name.trim(),
            pocketId: targetPocketId,
            monthlyAmount,
            active: true,
          }
          return {
            ...current,
            pockets: [...current.pockets, newPocket],
            provisions: provisionForm.id
              ? current.provisions.map((item) => (item.id === provisionForm.id ? nextProvision : item))
              : [nextProvision, ...current.provisions],
          }
        }

        const nextProvision: Provision = {
          id: provisionForm.id || crypto.randomUUID(),
          name: provisionForm.name.trim(),
          pocketId: targetPocketId,
          monthlyAmount,
          active: true,
        }
        return {
          ...current,
          provisions: provisionForm.id
            ? current.provisions.map((item) => (item.id === provisionForm.id ? nextProvision : item))
            : [nextProvision, ...current.provisions],
        }
      })

      resetProvisionForm()
      setOpenComposer(null)
      showUiNotice(
        provisionForm.id ? 'Provision actualizada' : 'Provision creada',
        provisionForm.id
          ? `Se actualizaron los datos de "${provisionForm.name.trim()}".`
          : `"${provisionForm.name.trim()}" fue agregada a tus provisiones mensuales.`,
      )
    } finally {
      endAction(actionKey)
    }
  }

  function handleDeleteProvision(provisionId: string) {
    const provision = state.provisions.find((item) => item.id === provisionId)
    if (!provision) return
    const actionKey = `provisiones:eliminar:${provisionId}`
    if (!beginAction(actionKey)) return
    try {
      // 🛡️ Marca explícita para borrado remoto
      markEntityForRemoteDelete('provision', provisionId)
      setState((current) => ({
        ...current,
        provisions: current.provisions.filter((item) => item.id !== provisionId),
      }))
      showUiNotice('Provision eliminada', `"${provision.name}" fue eliminada de tus provisiones.`)
    } finally {
      endAction(actionKey)
    }
  }

  function handleToggleProvision(provisionId: string) {
    setState((current) => ({
      ...current,
      provisions: current.provisions.map((item) =>
        item.id === provisionId ? { ...item, active: !item.active } : item,
      ),
    }))
  }

  function resetGoalForm() {
    setGoalForm({
      id: '',
      name: '',
      type: 'fixed-term',
      pocketId: state.pockets[0]?.id ?? initialState.pockets[0].id,
      targetAmount: '',
      targetDate: '',
      icon: '🎯',
      color: '#7c3aed',
      description: '',
      createNewPocket: false,
      newPocketName: '',
    })
  }

  function startEditGoal(goalId: string) {
    const goal = state.goals.find((item) => item.id === goalId)
    if (!goal) return
    setOpenComposer('metas')
    setGoalForm({
      id: goal.id,
      name: goal.name,
      type: goal.type,
      pocketId: goal.pocketId,
      targetAmount: String(goal.targetAmount),
      targetDate: goal.targetDate ?? '',
      icon: goal.icon,
      color: goal.color,
      description: goal.description ?? '',
      createNewPocket: false,
      newPocketName: '',
    })
  }

  function handleAddGoal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const targetAmount = Number(goalForm.targetAmount)
    if (!goalForm.name.trim() || targetAmount <= 0) {
      showUiNotice('Datos incompletos', 'Ingresa nombre y monto objetivo válidos.')
      return
    }
    if (goalForm.type === 'fixed-term') {
      if (!goalForm.targetDate) {
        showUiNotice('Falta fecha objetivo', 'Las metas de término fijo requieren una fecha objetivo.')
        return
      }
      if (goalForm.targetDate <= today) {
        showUiNotice('Fecha inválida', 'La fecha objetivo debe ser posterior a hoy.')
        return
      }
    }

    const actionKey = goalForm.id ? 'metas:guardar' : 'metas:crear'
    if (!beginAction(actionKey)) return
    try {
      setState((current) => {
        let targetPocketId = goalForm.pocketId

        if (goalForm.createNewPocket && goalForm.newPocketName.trim()) {
          const newPocket: Pocket = {
            id: crypto.randomUUID(),
            name: goalForm.newPocketName.trim(),
            balance: 0,
            color: goalForm.color,
            icon: goalForm.icon,
            type: 'invest',
          }
          targetPocketId = newPocket.id
          const nextGoal: Goal = {
            id: goalForm.id || crypto.randomUUID(),
            name: goalForm.name.trim(),
            type: goalForm.type,
            pocketId: targetPocketId,
            targetAmount,
            targetDate: goalForm.type === 'fixed-term' ? goalForm.targetDate : undefined,
            startDate: today,
            icon: goalForm.icon,
            color: goalForm.color,
            description: goalForm.description.trim() || undefined,
            active: true,
          }
          return {
            ...current,
            pockets: [...current.pockets, newPocket],
            goals: goalForm.id
              ? current.goals.map((item) => (item.id === goalForm.id ? nextGoal : item))
              : [nextGoal, ...current.goals],
          }
        }

        const existing = current.goals.find((item) => item.id === goalForm.id)
        const nextGoal: Goal = {
          id: goalForm.id || crypto.randomUUID(),
          name: goalForm.name.trim(),
          type: goalForm.type,
          pocketId: targetPocketId,
          targetAmount,
          targetDate: goalForm.type === 'fixed-term' ? goalForm.targetDate : undefined,
          startDate: existing?.startDate ?? today,
          icon: goalForm.icon,
          color: goalForm.color,
          description: goalForm.description.trim() || undefined,
          active: existing?.active ?? true,
          completedAt: existing?.completedAt,
        }

        return {
          ...current,
          goals: goalForm.id
            ? current.goals.map((item) => (item.id === goalForm.id ? nextGoal : item))
            : [nextGoal, ...current.goals],
        }
      })

      showUiNotice(
        goalForm.id ? 'Meta actualizada' : 'Meta creada',
        goalForm.id
          ? `Se actualizaron los datos de "${goalForm.name.trim()}".`
          : `"${goalForm.name.trim()}" fue añadida a tus metas.`,
      )
      resetGoalForm()
      setOpenComposer(null)
    } finally {
      endAction(actionKey)
    }
  }

  function handleDeleteGoal(goalId: string) {
    const goal = state.goals.find((item) => item.id === goalId)
    if (!goal) return
    const actionKey = `metas:eliminar:${goalId}`
    if (!beginAction(actionKey)) return
    try {
      // 🛡️ Marca explícita para borrado remoto
      markEntityForRemoteDelete('goal', goalId)
      setState((current) => ({
        ...current,
        goals: current.goals.filter((item) => item.id !== goalId),
      }))
      showUiNotice('Meta eliminada', `"${goal.name}" fue eliminada de tus metas.`)
    } finally {
      endAction(actionKey)
    }
  }

  function handleCompleteGoal(goalId: string) {
    setState((current) => ({
      ...current,
      goals: current.goals.map((item) =>
        item.id === goalId
          ? { ...item, active: false, completedAt: new Date().toISOString() }
          : item,
      ),
    }))
    const goal = state.goals.find((item) => item.id === goalId)
    if (goal) showUiNotice('Meta completada', `¡Felicidades! "${goal.name}" está completada.`)
  }

  function handleReactivateGoal(goalId: string) {
    setState((current) => ({
      ...current,
      goals: current.goals.map((item) =>
        item.id === goalId ? { ...item, active: true, completedAt: undefined } : item,
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

	    const actionKey = debtForm.id ? 'deudas:guardar' : 'deudas:crear'
	    if (!beginAction(actionKey)) return
	    try {
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
	    } finally {
	      endAction(actionKey)
	    }
  }

		  function handlePayDebt(debtId: string, kind: 'scheduled' | 'extra' = 'scheduled') {
		    const actionKey = `deudas:pagar:${debtId}`
		    if (!beginAction(actionKey)) return
		    try {
		    const debt = state.debts.find((item) => item.id === debtId)
		    if (!debt || !debt.active || debt.remainingAmount <= 0) return

	    const draftAmount = Number(debtPaymentDrafts[debtId] || debt.installmentAmount)
	    const paymentAmount = Math.min(Math.max(draftAmount, 0), debt.remainingAmount)
	    if (paymentAmount <= 0) return

	    const balances = computePocketBalances(state)
	    const availableBalance = balances[debt.pocketId] ?? 0
	    if (paymentAmount > availableBalance) {
	      showUiNotice(
	        'Saldo insuficiente',
	        `El bolsillo "${getPocketName(state.pockets, debt.pocketId)}" tiene ${money.format(
	          availableBalance,
	        )} disponibles y estás intentando registrar ${money.format(paymentAmount)}.`,
	      )
	      return
	    }

	    setState((current) => {
	      const currentDebt = current.debts.find((item) => item.id === debtId)
	      if (!currentDebt || !currentDebt.active || currentDebt.remainingAmount <= 0) return current

	      const nextAmount = Math.min(paymentAmount, currentDebt.remainingAmount)
	      if (nextAmount <= 0) return current

	      const expense: Expense = {
	        id: crypto.randomUUID(),
	        description: `Abono deuda: ${currentDebt.title}`,
	        amount: nextAmount,
	        pocketId: currentDebt.pocketId,
	        date: today,
	        time: getCurrentTimeHHmm(),
	        source: 'debt',
	        category: currentDebt.category,
	        confidence: 1,
	      }

	      return {
	        ...current,
	        expenses: [expense, ...current.expenses],
	        debtPayments: [
	          {
	            id: crypto.randomUUID(),
	            debtId,
	            amount: nextAmount,
	            date: today,
	            kind,
	          },
	          ...current.debtPayments,
	        ],
	        debts: current.debts.map((item) => {
	          if (item.id !== debtId) return item
	          const remaining = Math.max(0, item.remainingAmount - nextAmount)
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
		    } finally {
		      endAction(actionKey)
		    }
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
    const actionKey = `categorias:eliminar:${category}`
    if (!beginAction(actionKey)) return
    try {
      if (state.categories.length <= 1) return
      if (!window.confirm(`La categoria ${category} se reemplazara por Otros en los registros actuales.`)) return

      // 🛡️ Marca explícita para borrado remoto
      markEntityForRemoteDelete('category', category)
      // Las reglas asociadas también se borran del remoto
      state.learningRules
        .filter((rule) => rule.category === category)
        .forEach((rule) => markEntityForRemoteDelete('learningRule', rule.keyword))

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
    } finally {
      endAction(actionKey, 650)
    }
  }

  function handleRemoveLearningRule(keyword: string) {
    const actionKey = `reglas:eliminar:${keyword}`
    if (!beginAction(actionKey)) return
    try {
      // 🛡️ Marca explícita para borrado remoto
      markEntityForRemoteDelete('learningRule', keyword)
      setState((current) => ({
        ...current,
        learningRules: current.learningRules.filter((rule) => rule.keyword !== keyword),
      }))
    } finally {
      endAction(actionKey, 650)
    }
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
	      const expenseActionKey = expenseForm.id ? 'movimientos:guardar-gasto' : 'movimientos:registrar-gasto'
	      const isExpenseBusy = Boolean(actionLoading[expenseActionKey])

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
	            <button type="submit" disabled={!isExpenseFormValid || isExpenseBusy}>
	              {isExpenseBusy
	                ? expenseForm.id
	                  ? 'Guardando...'
	                  : 'Registrando...'
	                : expenseForm.id
	                  ? 'Guardar gasto'
	                  : 'Registrar salida'}
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
	      const incomeActionKey = incomeForm.id ? 'movimientos:guardar-ingreso' : 'movimientos:registrar-ingreso'
	      const isIncomeBusy = Boolean(actionLoading[incomeActionKey])

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
	            <button type="submit" disabled={!isIncomeFormValid || isIncomeBusy}>
	              {isIncomeBusy
	                ? incomeForm.id
	                  ? 'Guardando...'
	                  : 'Registrando...'
	                : incomeForm.id
	                  ? 'Guardar ingreso'
	                  : 'Registrar ingreso'}
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
	      const transferActionKey = transferForm.id
	        ? 'movimientos:guardar-transferencia'
	        : 'movimientos:ejecutar-transferencia'
	      const isTransferBusy = Boolean(actionLoading[transferActionKey])
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
	            <button type="submit" disabled={!isTransferFormValid || isTransferBusy}>
	              {isTransferBusy
	                ? transferForm.id
	                  ? 'Guardando...'
	                  : 'Ejecutando...'
	                : transferForm.id
	                  ? 'Guardar transferencia'
	                  : 'Ejecutar transferencia'}
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
	      const fixedActionKey = fixedForm.id ? 'obligaciones:guardar' : 'obligaciones:registrar'
	      const isFixedBusy = Boolean(actionLoading[fixedActionKey])
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
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={fixedForm.dueDay}
                onChange={(event) =>
                  setFixedForm((current) => ({ ...current, dueDay: keepOnlyDigits(event.target.value).slice(0, 2) }))
                }
              />
            </label>
            <label>
              Dia de confirmacion
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={fixedForm.confirmationDay}
                onChange={(event) =>
                  setFixedForm((current) => ({
                    ...current,
                    confirmationDay: keepOnlyDigits(event.target.value).slice(0, 2),
                  }))
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
	          <button type="submit" disabled={isFixedBusy}>
	            {isFixedBusy
	              ? fixedForm.id
	                ? 'Guardando...'
	                : 'Registrando...'
	              : fixedForm.id
	                ? 'Guardar obligacion'
	                : 'Registrar obligacion'}
	          </button>
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

	    const pocketActionKey = pocketForm.id ? 'bolsillos:guardar' : 'bolsillos:crear'
	    const isPocketBusy = Boolean(actionLoading[pocketActionKey])

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
	        <button type="submit" disabled={isPocketBusy}>
	          {isPocketBusy
	            ? pocketForm.id
	              ? 'Guardando...'
	              : 'Creando...'
	            : pocketForm.id
	              ? 'Guardar bolsillo'
	              : 'Crear bolsillo'}
	        </button>
        {pocketForm.id && (
          <div className="composer-action-row">
            <button
              type="button"
              className="secondary-button delete-action"
              disabled={Boolean(actionLoading[`bolsillos:eliminar:${pocketForm.id}`])}
              onClick={() => handleDeletePocket(pocketForm.id)}
            >
              {actionLoading[`bolsillos:eliminar:${pocketForm.id}`] ? 'Eliminando...' : 'Eliminar bolsillo'}
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
                <p className="panel-subtitle">
                  Total conciliado entre saldo arrastrado e impacto de {formatMonthName(summaryMonthKey)}.
                </p>
              </div>
              <label className="summary-month-selector">
                <span>Mes del resumen</span>
                <input
                  type="month"
                  value={summaryMonthKey}
                  onChange={(event) => setSummaryMonthKey(event.target.value || currentMonthKey)}
                />
              </label>
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
            subtitle={`Resumen rapido de ${formatMonthName(summaryMonthKey)}: cuanto entra, cuanto sale y que presion ejerce la deuda pendiente.`}
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
            subtitle={`${formatMonthName(summaryMonthKey)} contra ${formatMonthName(previousMonthKey)} para entender si el flujo va mejor o peor.`}
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
          {openComposer === 'bolsillos' && (
            <FullscreenComposer
              isOpen={openComposer === 'bolsillos'}
              label="Bolsillo"
              title={pocketForm.id ? 'Editar bolsillo' : 'Registrar bolsillo'}
              description="Configura nombre, tipo, color e icono del bolsillo."
              toolbarClassName="no-sticky"
              bodyClassName="scroll-on-panel"
              onClose={() => {
                resetPocketForm()
                setOpenComposer(null)
              }}
            >
              {renderActiveForm()}
            </FullscreenComposer>
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
	                  className={[
	                    'account-card',
	                    pocket.id === selectedPocketId ? 'selected' : null,
	                    openPocketDetailId === pocket.id ? 'expanded' : null,
	                  ]
	                    .filter(Boolean)
	                    .join(' ')}
	                  onClick={() => {
	                    setSelectedPocketId(pocket.id)
	                    setOpenPocketDetailId((current) => (current === pocket.id ? null : pocket.id))
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
	                  {openPocketDetailId === pocket.id &&
	                    (() => {
	                      const pocketActivity = pocketActivityById[pocket.id] ?? []
	                      const pocketTotals = pocketMovementTotalsById[pocket.id] ?? {
	                        inflow: 0,
	                        outflow: 0,
	                        count: 0,
	                      }
	                      const recentActivity = pocketActivity.slice(0, 6)

	                      return (
	                        <section className="pocket-inline-detail" onClick={(event) => event.stopPropagation()}>
	                          <div className="pocket-inline-metrics">
	                            <div>
	                              <span>Entradas acumuladas</span>
	                              <strong className="value-positive">{money.format(pocketTotals.inflow)}</strong>
	                            </div>
	                            <div>
	                              <span>Salidas acumuladas</span>
	                              <strong className="value-negative">{money.format(pocketTotals.outflow)}</strong>
	                            </div>
	                            <div>
	                              <span>Movimientos</span>
	                              <strong>{pocketTotals.count}</strong>
	                            </div>
	                          </div>
	                          <div className="pocket-inline-head">
	                            <span>Movimiento acumulado</span>
	                            <button type="button" className="text-link" onClick={() => startEditPocket(pocket.id)}>
	                              Editar
	                            </button>
	                          </div>
	                          <div className="pocket-inline-ledger">
	                            {recentActivity.map((item) => (
	                              <article key={item.id} className={`pocket-inline-row ${item.kind}`}>
	                                <div>
	                                  <strong>{item.title}</strong>
	                                  <p>{formatMovementDateTimeDisplay(item.date, item.time)} · {item.meta}</p>
	                                </div>
	                                <strong className={item.amount >= 0 ? 'value-positive' : 'value-negative'}>
	                                  {item.amount >= 0 ? '+' : '-'}
	                                  {money.format(Math.abs(item.amount))}
	                                </strong>
	                              </article>
	                            ))}
	                            {recentActivity.length === 0 && (
	                              <p className="empty-copy">Este bolsillo todavia no tiene movimientos registrados.</p>
	                            )}
	                          </div>
	                        </section>
	                      )
	                    })()}
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
	                <strong>{money.format(movementEffectiveInflow)}</strong>
	                <small>
	                  {movementOpeningBalance > 0
	                    ? `Incluye saldo anterior ${money.format(movementOpeningBalance)}`
	                    : 'Flujo positivo del periodo'}
	                </small>
	              </div>
	              <div className="summary-box movement-stat expense">
	                <span>Salidas</span>
	                <strong>{money.format(movementEffectiveOutflow)}</strong>
	                <small>{percent.format(movementExpenseRatio)} consumido</small>
	              </div>
              <div className="summary-box movement-stat transfer">
                <span>Movimientos</span>
                <strong>{movementListSummary.count}</strong>
                <small>Ticket medio {money.format(movementAverageTicket)}</small>
              </div>
		              <div className="summary-box movement-stat balance neutral">
		                <span>Balance</span>
		                <strong>{money.format(movementClosingBalance)}</strong>
		                <small>Balance del periodo</small>
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
                            (() => {
                              const deleteActionKey = `movimientos:eliminar:${item.kind}:${item.id}`
                              const isDeleting = Boolean(actionLoading[deleteActionKey])
                              return (
                            <button
                              type="button"
                              className="movement-popover-action danger"
                              disabled={isDeleting}
                              onClick={() => {
                                setOpenMovementActionId(null)
                                handleDeleteMovement(item.kind, item.id)
                              }}
                            >
                              {isDeleting ? 'Eliminando...' : 'Eliminar'}
                            </button>
                              )
                            })()
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
	                      {item.kind === 'transferencia' ? (
	                        (() => {
	                          const transfer = state.transfers.find((entry) => entry.id === item.id)
	                          if (!transfer) return <p className="simple-movement-method">{item.meta}</p>

	                          const fromPocketName = getPocketName(state.pockets, transfer.fromPocketId)
	                          const toPocketName = getPocketName(state.pockets, transfer.toPocketId)

	                          return (
	                            <div className="simple-transfer-method">
	                              <p className="simple-movement-method">Salida: {fromPocketName}</p>
	                              <p className="simple-movement-method">Entrada: {toPocketName}</p>
	                            </div>
	                          )
	                        })()
	                      ) : (
	                        <p className="simple-movement-method">{item.meta}</p>
	                      )}
	                    </div>
	                    {item.kind === 'transferencia' && movementFilters.pocketId === 'todos' ? (
	                      (() => {
	                        const transfer = state.transfers.find((entry) => entry.id === item.id)
	                        if (!transfer) {
	                          return (
	                            <strong className="simple-outflow">
	                              -{money.format(Math.abs(item.amount))}
	                            </strong>
	                          )
	                        }

	                        const fromPocketName = getPocketName(state.pockets, transfer.fromPocketId)
	                        const toPocketName = getPocketName(state.pockets, transfer.toPocketId)

	                        return (
	                          <div className="simple-transfer-amount" aria-label="Salida y entrada de transferencia">
	                            <div className="simple-transfer-line simple-outflow">
	                              <span>-{money.format(transfer.amount)}</span>
	                              <small>{fromPocketName}</small>
	                            </div>
	                            <div className="simple-transfer-line simple-income">
	                              <span>+{money.format(transfer.amount)}</span>
	                              <small>{toPocketName}</small>
	                            </div>
	                          </div>
	                        )
	                      })()
	                    ) : (
	                      <strong className={item.amount >= 0 ? 'simple-income' : 'simple-outflow'}>
	                        {item.amount >= 0 ? '+' : '-'}
	                        {money.format(Math.abs(item.amount))}
	                      </strong>
	                    )}
	                  </div>
	                </article>
	              ))}
	              {shouldShowMovementOpeningRow && (
	                <article className="simple-movement-row ingreso movement-opening-row">
	                  <div className="simple-movement-top">
	                    <strong>Saldo anterior</strong>
	                  </div>
	                  <div className="simple-movement-meta">
	                    <div className="simple-movement-meta-text">
	                      <p>Antes de {formatMonthName(movementMonthKey)}</p>
	                      <p className="simple-movement-method">
	                        Cierre acumulado de meses anteriores
	                        {movementFilters.pocketId !== 'todos'
	                          ? ` · ${getPocketName(state.pockets, movementFilters.pocketId)}`
	                          : ''}
	                      </p>
	                    </div>
	                    <strong className={movementOpeningBalance >= 0 ? 'simple-income' : 'simple-outflow'}>
	                      {movementOpeningBalance >= 0 ? '+' : '-'}
	                      {money.format(Math.abs(movementOpeningBalance))}
	                    </strong>
	                  </div>
	                </article>
	              )}
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
            toolbarClassName="no-sticky"
            bodyClassName="scroll-on-panel"
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
	                  disabled={Boolean(actionLoading[`obligaciones:pagar:${fixedPaymentTarget.id}`])}
	                >
	                  {actionLoading[`obligaciones:pagar:${fixedPaymentTarget.id}`]
	                    ? 'Procesando...'
	                    : fixedPaymentIsDueOrPast
	                      ? 'Confirmar pagado'
	                      : 'Adelantar pago'}
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
            <div className="obligation-register-cta">
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

            <SectionFrame
              label="Obligaciones"
              title="Obligaciones pendientes"
              subtitle={`${fixedStatus.pending.length} por confirmar este mes`}
              collapsed={isSectionCollapsed('programacion-pendientes')}
              onToggle={() => toggleSection('programacion-pendientes')}
              className="obligation-list-board"
            >
              <div className="fixed-stack">
                {fixedStatus.pending
                  .slice()
                  .sort((a, b) => a.dueDay - b.dueDay)
                  .map((item) => {
                    const isDueOrPast = item.dueDay <= currentDay
                    const isLate = item.dueDay < currentDay

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
                            <small className={isLate ? 'late' : 'pending'}>{isLate ? 'Vencido' : 'Pendiente'}</small>
                          </div>

                          <div className="obligation-actions">
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
                            <button
                              type="button"
                              className="secondary-button slim obligation-secondary"
                              onClick={() => handleToggleFixedExpense(item.id)}
                            >
                              Pausar
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                {fixedStatus.pending.length === 0 && (
                  <p className="empty-copy">No hay obligaciones pendientes por confirmar.</p>
                )}
              </div>
            </SectionFrame>

            <SectionFrame
              label="Obligaciones"
              title="Obligaciones pagadas"
              subtitle={`${fixedStatus.paid.length} confirmada(s) este mes`}
              collapsed={isSectionCollapsed('programacion-pagadas')}
              onToggle={() => toggleSection('programacion-pagadas')}
              className="obligation-list-board"
            >
              <div className="fixed-stack">
                {fixedStatus.paid
                  .slice()
                  .sort((a, b) => a.dueDay - b.dueDay)
                  .map((item) => (
                    <article key={item.id} className="obligation-row">
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
                          <small className="paid">Pagado</small>
                        </div>

                        <div className="obligation-actions">
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
                  ))}
                {fixedStatus.paid.length === 0 && (
                  <p className="empty-copy">Aun no has confirmado pagos este mes.</p>
                )}
              </div>
            </SectionFrame>

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

            <SectionFrame
              label="Panorama"
              title="Carga mensual"
              subtitle={`${fixedStatus.pending.length} pendiente(s) · ${fixedStatus.overdue.length} vencida(s) · ${fixedStatus.paid.length} pagada(s)`}
              collapsed={isSectionCollapsed('programacion-panorama')}
              onToggle={() => toggleSection('programacion-panorama')}
            >
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
                    <button
                      type="button"
                      className={openObligationMetric === 'pending' ? 'obligation-metric-tile is-open' : 'obligation-metric-tile'}
                      onClick={() =>
                        setOpenObligationMetric((current) => (current === 'pending' ? null : 'pending'))
                      }
                      aria-expanded={openObligationMetric === 'pending'}
                    >
                      <span>Pendiente</span>
                      <strong>{money.format(obligationSummary.totalPendingAmount)}</strong>
                    </button>
                    <button
                      type="button"
                      className={openObligationMetric === 'active' ? 'obligation-metric-tile is-open' : 'obligation-metric-tile'}
                      onClick={() =>
                        setOpenObligationMetric((current) => (current === 'active' ? null : 'active'))
                      }
                      aria-expanded={openObligationMetric === 'active'}
                    >
                      <span>Activas</span>
                      <strong>{fixedStatus.activeItems.length}</strong>
                    </button>
                    <button
                      type="button"
                      className={openObligationMetric === 'paid' ? 'obligation-metric-tile is-open' : 'obligation-metric-tile'}
                      onClick={() =>
                        setOpenObligationMetric((current) => (current === 'paid' ? null : 'paid'))
                      }
                      aria-expanded={openObligationMetric === 'paid'}
                    >
                      <span>Pagadas</span>
                      <strong>{fixedStatus.paid.length}</strong>
                    </button>
                    <button
                      type="button"
                      className={openObligationMetric === 'paused' ? 'obligation-metric-tile is-open' : 'obligation-metric-tile'}
                      onClick={() =>
                        setOpenObligationMetric((current) => (current === 'paused' ? null : 'paused'))
                      }
                      aria-expanded={openObligationMetric === 'paused'}
                    >
                      <span>Pausadas</span>
                      <strong>{fixedStatus.paused.length}</strong>
                    </button>
                  </div>

                  {openObligationMetric && (
                    <div className="obligation-metric-detail" role="region" aria-label="Detalle de panorama">
                      {openObligationMetric === 'pending' && (
                        <>
                          <p className="movement-detail">Pendientes por confirmar (máx. 6).</p>
                          <div className="obligation-metric-list">
                            {fixedStatus.pending
                              .slice()
                              .sort((a, b) => a.dueDay - b.dueDay)
                              .slice(0, 6)
                              .map((item) => (
                                <div key={item.id} className="compact-pocket-row obligation-metric-row">
                                  <div>
                                    <strong>{item.title}</strong>
                                    <p className="movement-detail">Día {item.dueDay} · {item.category}</p>
                                  </div>
                                  <span>{money.format(item.amount)}</span>
                                </div>
                              ))}
                            {fixedStatus.pending.length === 0 && (
                              <p className="empty-copy">No hay obligaciones pendientes.</p>
                            )}
                          </div>
                        </>
                      )}

                      {openObligationMetric === 'active' && (
                        <>
                          <p className="movement-detail">Obligaciones activas (máx. 6).</p>
                          <div className="obligation-metric-list">
                            {fixedStatus.activeItems
                              .slice()
                              .sort((a, b) => a.dueDay - b.dueDay)
                              .slice(0, 6)
                              .map((item) => (
                                <div key={item.id} className="compact-pocket-row obligation-metric-row">
                                  <div>
                                    <strong>{item.title}</strong>
                                    <p className="movement-detail">Día {item.dueDay} · {getPocketName(state.pockets, item.pocketId)}</p>
                                  </div>
                                  <span>{money.format(item.amount)}</span>
                                </div>
                              ))}
                            {fixedStatus.activeItems.length === 0 && (
                              <p className="empty-copy">No hay obligaciones activas.</p>
                            )}
                          </div>
                        </>
                      )}

                      {openObligationMetric === 'paid' && (
                        <>
                          <p className="movement-detail">Confirmadas este mes (máx. 6).</p>
                          <div className="obligation-metric-list">
                            {fixedStatus.paid
                              .slice()
                              .sort((a, b) => a.dueDay - b.dueDay)
                              .slice(0, 6)
                              .map((item) => (
                                <div key={item.id} className="compact-pocket-row obligation-metric-row">
                                  <div>
                                    <strong>{item.title}</strong>
                                    <p className="movement-detail">Día {item.dueDay} · {item.category}</p>
                                  </div>
                                  <span>{money.format(item.amount)}</span>
                                </div>
                              ))}
                            {fixedStatus.paid.length === 0 && (
                              <p className="empty-copy">Aún no hay pagos confirmados este mes.</p>
                            )}
                          </div>
                        </>
                      )}

                      {openObligationMetric === 'paused' && (
                        <>
                          <p className="movement-detail">Pausadas (máx. 6).</p>
                          <div className="obligation-metric-list">
                            {fixedStatus.paused
                              .slice()
                              .sort((a, b) => a.dueDay - b.dueDay)
                              .slice(0, 6)
                              .map((item) => (
                                <div key={item.id} className="compact-pocket-row obligation-metric-row">
                                  <div>
                                    <strong>{item.title}</strong>
                                    <p className="movement-detail">Día {item.dueDay} · {item.category}</p>
                                  </div>
                                  <span>{money.format(item.amount)}</span>
                                </div>
                              ))}
                            {fixedStatus.paused.length === 0 && (
                              <p className="empty-copy">No hay obligaciones pausadas.</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </article>

                <div className="obligation-insight-grid">
                  <div className="obligation-insight-top">
                    <article className="summary-box">
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
                  </div>
                  <article className="summary-box">
                    <span>En revision hoy</span>
                    <strong>{fixedStatus.review.length}</strong>
                    <p className="movement-detail">
                      {fixedStatus.overdue.length} vencida(s) y{' '}
                      {fixedStatus.pending.length - fixedStatus.overdue.length} pendiente(s)
                    </p>
                  </article>
                </div>

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
              </section>
            </SectionFrame>
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
    const debtActionKey = debtForm.id ? 'deudas:guardar' : 'deudas:crear'
    const isDebtBusy = Boolean(actionLoading[debtActionKey])
    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <div className="debt-register-cta">
            <button
              className="action-trigger ghost debt-register-trigger"
              type="button"
              onClick={() => {
                resetDebtForm()
                openComposerForView('deudas')
              }}
            >
              Registrar deuda
            </button>
          </div>

          {openComposer === 'deudas' && (
            <FullscreenComposer
              isOpen={openComposer === 'deudas'}
              label="Nueva deuda"
              title={debtForm.id ? 'Editar deuda' : 'Registrar deuda'}
              description="Define saldo total, cuota estimada, bolsillo pagador y categoria asociada."
              toolbarClassName="no-sticky"
              bodyClassName="scroll-on-panel"
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
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={debtForm.totalAmount}
                      onChange={(event) =>
                        setDebtForm((current) => ({ ...current, totalAmount: keepOnlyDigits(event.target.value) }))
                      }
                      placeholder="2400000"
                    />
                  </label>
                  <label>
                    Cuota por pago
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={debtForm.installmentAmount}
                      onChange={(event) =>
                        setDebtForm((current) => ({ ...current, installmentAmount: keepOnlyDigits(event.target.value) }))
                      }
                      placeholder="400000"
                    />
                  </label>
                </div>
                <div className="form-grid three">
                  <label>
                    Dia de pago
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={2}
                      value={debtForm.dueDay}
                      onChange={(event) =>
                        setDebtForm((current) => ({ ...current, dueDay: keepOnlyDigits(event.target.value).slice(0, 2) }))
                      }
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
	                <button type="submit" disabled={isDebtBusy}>
	                  {isDebtBusy
	                    ? debtForm.id
	                      ? 'Guardando...'
	                      : 'Creando...'
	                    : debtForm.id
	                      ? 'Guardar deuda'
	                      : 'Crear deuda'}
	                </button>
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
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={debtPaymentDrafts[debt.id] ?? String(debt.installmentAmount)}
                            onChange={(event) =>
                              setDebtPaymentDrafts((current) => ({
                                ...current,
                                [debt.id]: keepOnlyDigits(event.target.value),
                              }))
                            }
                            placeholder={String(debt.installmentAmount)}
                          />
                        </label>
                        <p className="debt-entry-help">
                          Cuota sugerida: {money.format(debt.installmentAmount)}. Puedes registrar un valor menor o un abono extraordinario.
                        </p>
	                        <div className="debt-entry-actions">
	                          <button
	                            type="button"
	                            className="action-trigger debt-submit"
	                            disabled={Boolean(actionLoading[`deudas:pagar:${debt.id}`])}
	                            onClick={() => handlePayDebt(debt.id, 'scheduled')}
	                          >
	                            {actionLoading[`deudas:pagar:${debt.id}`] ? 'Registrando...' : 'Registrar cuota'}
	                          </button>
	                          <button
	                            type="button"
	                            className="secondary-button slim debt-secondary-action"
	                            disabled={Boolean(actionLoading[`deudas:pagar:${debt.id}`])}
	                            onClick={() => handlePayDebt(debt.id, 'extra')}
	                          >
	                            {actionLoading[`deudas:pagar:${debt.id}`] ? 'Registrando...' : 'Registrar abono extra'}
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

  function renderProvisionesView() {
    const isProvisionBusy = Boolean(actionLoading[provisionForm.id ? 'provisiones:guardar' : 'provisiones:crear'])
    const inactiveProvisions = state.provisions.filter((p) => !p.active)

    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <div className="debt-register-cta">
            <button
              className="action-trigger ghost debt-register-trigger"
              type="button"
              onClick={() => {
                resetProvisionForm()
                setOpenComposer('provisiones')
              }}
            >
              Nueva provision
            </button>
          </div>

          {openComposer === 'provisiones' && (
            <FullscreenComposer
              isOpen={openComposer === 'provisiones'}
              label="Provision mensual"
              title={provisionForm.id ? 'Editar provision' : 'Nueva provision'}
              description="Define cuanto quieres destinar mensualmente a un bolsillo especifico."
              toolbarClassName="no-sticky"
              bodyClassName="scroll-on-panel"
              onClose={() => {
                resetProvisionForm()
                setOpenComposer(null)
              }}
            >
              <form className="bank-form" onSubmit={handleAddProvision}>
                <label>
                  Nombre de la provision
                  <input
                    value={provisionForm.name}
                    onChange={(event) => setProvisionForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ej. Fondo viaje, Emergencias, Meta casa"
                  />
                </label>
                <label>
                  Monto mensual objetivo
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={provisionForm.monthlyAmount}
                    onChange={(event) =>
                      setProvisionForm((current) => ({ ...current, monthlyAmount: keepOnlyDigits(event.target.value) }))
                    }
                    placeholder="500000"
                  />
                </label>

                <div className="provision-pocket-toggle">
                  <label className="provision-toggle-label">
                    <input
                      type="checkbox"
                      checked={provisionForm.createNewPocket}
                      onChange={(event) =>
                        setProvisionForm((current) => ({ ...current, createNewPocket: event.target.checked }))
                      }
                    />
                    Crear un nuevo bolsillo para esta provision
                  </label>
                </div>

                {provisionForm.createNewPocket ? (
                  <div className="form-grid two">
                    <label>
                      Nombre del bolsillo
                      <input
                        value={provisionForm.newPocketName}
                        onChange={(event) =>
                          setProvisionForm((current) => ({ ...current, newPocketName: event.target.value }))
                        }
                        placeholder="Ej. Meta viaje Europa"
                      />
                    </label>
                    <label>
                      Icono
                      <select
                        value={provisionForm.newPocketIcon}
                        onChange={(event) =>
                          setProvisionForm((current) => ({ ...current, newPocketIcon: event.target.value }))
                        }
                      >
                        {pocketIcons.map((icon) => (
                          <option key={icon} value={icon}>
                            {icon}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Color
                      <input
                        type="color"
                        value={provisionForm.newPocketColor}
                        onChange={(event) =>
                          setProvisionForm((current) => ({ ...current, newPocketColor: event.target.value }))
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <label>
                    Bolsillo destino
                    <select
                      value={provisionForm.pocketId}
                      onChange={(event) =>
                        setProvisionForm((current) => ({ ...current, pocketId: event.target.value }))
                      }
                    >
                      {state.pockets.map((pocket) => (
                        <option key={pocket.id} value={pocket.id}>
                          {pocket.icon} {pocket.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <button type="submit" disabled={isProvisionBusy}>
                  {isProvisionBusy
                    ? provisionForm.id ? 'Guardando...' : 'Creando...'
                    : provisionForm.id ? 'Guardar provision' : 'Crear provision'}
                </button>
                {provisionForm.id && (
                  <button
                    type="button"
                    className="secondary-button cancel-action"
                    onClick={() => {
                      resetProvisionForm()
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
            label="Compromisos mensuales"
            title="Provisiones activas"
            subtitle={`${activeProvisions.length} activa(s)`}
            collapsed={isSectionCollapsed('provisiones-activas')}
            onToggle={() => toggleSection('provisiones-activas')}
          >
            <div className="debt-stack">
              {activeProvisions.map((provision) => {
                const allocated = provisionProgress[provision.id] ?? 0
                const progress = provision.monthlyAmount > 0
                  ? Math.min(100, Math.round((allocated / provision.monthlyAmount) * 100))
                  : 0
                const pocket = state.pockets.find((p) => p.id === provision.pocketId)
                const isComplete = allocated >= provision.monthlyAmount

                return (
                  <article key={provision.id} className="debt-card provision-card">
                    <div className="debt-card-top">
                      <div>
                        <div className="card-title-row">
                          <strong>
                            {pocket?.icon && <span className="provision-pocket-icon">{pocket.icon}</span>}
                            {provision.name}
                          </strong>
                          <div className="provision-card-actions">
                            <button
                              type="button"
                              className="edit-icon-button"
                              aria-label={`Editar provision ${provision.name}`}
                              onClick={() => startEditProvision(provision.id)}
                            >
                              <LuPencil />
                            </button>
                            <button
                              type="button"
                              className="edit-icon-button"
                              aria-label={`Eliminar provision ${provision.name}`}
                              onClick={() => handleDeleteProvision(provision.id)}
                            >
                              <LuTrash2 />
                            </button>
                          </div>
                        </div>
                        <p>
                          Bolsillo: {pocket?.name ?? 'Sin bolsillo'} · Meta {money.format(provision.monthlyAmount)}/mes
                        </p>
                      </div>
                      <div className="debt-card-side">
                        <span className={isComplete ? 'provision-amount-complete' : ''}>
                          {money.format(allocated)}
                        </span>
                        <small>{isComplete ? 'Completado' : 'Acumulado'}</small>
                      </div>
                    </div>
                    <div className="debt-progress">
                      <div className="debt-progress-bar">
                        <div
                          className={isComplete ? 'provision-bar-complete' : ''}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p>
                        {money.format(allocated)} de {money.format(provision.monthlyAmount)} ({progress}%)
                      </p>
                      {!isComplete && (
                        <p className="movement-detail">
                          Faltan {money.format(Math.max(0, provision.monthlyAmount - allocated))} para completar la meta
                        </p>
                      )}
                    </div>
                    <div className="debt-actions">
                      <button
                        type="button"
                        className="secondary-button slim debt-cancel-action"
                        onClick={() => handleToggleProvision(provision.id)}
                      >
                        Pausar
                      </button>
                    </div>
                  </article>
                )
              })}
              {activeProvisions.length === 0 && (
                <p className="empty-copy">
                  No tienes provisiones activas. Crea una para empezar a rastrear tus metas mensuales.
                </p>
              )}
            </div>
          </SectionFrame>

          {inactiveProvisions.length > 0 && (
            <SectionFrame
              label="Pausadas"
              title="Provisiones pausadas"
              subtitle={`${inactiveProvisions.length} pausada(s)`}
              collapsed={isSectionCollapsed('provisiones-pausadas')}
              onToggle={() => toggleSection('provisiones-pausadas')}
            >
              <div className="debt-stack">
                {inactiveProvisions.map((provision) => {
                  const pocket = state.pockets.find((p) => p.id === provision.pocketId)
                  return (
                    <article key={provision.id} className="debt-card provision-card paused">
                      <div className="debt-card-top">
                        <div>
                          <div className="card-title-row">
                            <strong>
                              {pocket?.icon && <span className="provision-pocket-icon">{pocket.icon}</span>}
                              {provision.name}
                            </strong>
                            <button
                              type="button"
                              className="edit-icon-button"
                              aria-label={`Eliminar provision ${provision.name}`}
                              onClick={() => handleDeleteProvision(provision.id)}
                            >
                              <LuTrash2 />
                            </button>
                          </div>
                          <p>Bolsillo: {pocket?.name ?? 'Sin bolsillo'} · {money.format(provision.monthlyAmount)}/mes</p>
                        </div>
                        <div className="debt-card-side">
                          <span>Pausada</span>
                        </div>
                      </div>
                      <div className="debt-actions">
                        <button
                          type="button"
                          className="action-trigger debt-trigger"
                          onClick={() => handleToggleProvision(provision.id)}
                        >
                          Reactivar
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </SectionFrame>
          )}
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel emphasis">
            <span className="micro-label">Resumen del mes</span>
            <h2>Compromisos mensuales</h2>
            <div className="status-grid">
              <div>
                <span>Meta total</span>
                <strong>{money.format(totalMonthlyProvision)}</strong>
              </div>
              <div>
                <span>Acumulado</span>
                <strong>
                  {money.format(
                    activeProvisions.reduce((sum, p) => sum + (provisionProgress[p.id] ?? 0), 0),
                  )}
                </strong>
              </div>
              <div>
                <span>Activas</span>
                <strong>{activeProvisions.length}</strong>
              </div>
              <div>
                <span>Completadas</span>
                <strong>
                  {activeProvisions.filter((p) => (provisionProgress[p.id] ?? 0) >= p.monthlyAmount).length}
                </strong>
              </div>
            </div>
          </section>

          <section className="panel banking-panel">
            <span className="micro-label">Pendientes del mes</span>
            <h2>Por completar</h2>
            <div className="review-list">
              {activeProvisions
                .filter((p) => (provisionProgress[p.id] ?? 0) < p.monthlyAmount)
                .slice(0, 4)
                .map((provision) => {
                  const pocket = state.pockets.find((p) => p.id === provision.pocketId)
                  const remaining = provision.monthlyAmount - (provisionProgress[provision.id] ?? 0)
                  return (
                    <div key={provision.id} className="review-chip">
                      <span>{pocket?.icon} {provision.name}</span>
                      <strong>{money.format(remaining)}</strong>
                    </div>
                  )
                })}
              {activeProvisions.filter((p) => (provisionProgress[p.id] ?? 0) < p.monthlyAmount).length === 0 && (
                <p className="empty-copy">Todas las provisiones del mes estan completas.</p>
              )}
            </div>
          </section>
        </aside>
      </section>
    )
  }

  function renderMetasView() {
    const isGoalBusy = Boolean(actionLoading[goalForm.id ? 'metas:guardar' : 'metas:crear'])
    const totalTarget = activeGoals.reduce((sum, g) => sum + g.goal.targetAmount, 0)
    const totalAccumulated = activeGoals.reduce((sum, g) => sum + g.currentAmount, 0)
    const overallProgress = totalTarget > 0 ? Math.min(1, totalAccumulated / totalTarget) : 0

    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          <div className="debt-register-cta">
            <button
              className="action-trigger ghost debt-register-trigger"
              type="button"
              onClick={() => {
                resetGoalForm()
                setOpenComposer('metas')
              }}
            >
              Nueva meta
            </button>
          </div>

          {openComposer === 'metas' && (
            <FullscreenComposer
              isOpen={openComposer === 'metas'}
              label="Meta de ahorro"
              title={goalForm.id ? 'Editar meta' : 'Nueva meta'}
              description="Define un objetivo de ahorro acumulativo. Las metas de término fijo calculan cuánto debes destinar cada mes."
              toolbarClassName="no-sticky"
              bodyClassName="scroll-on-panel"
              onClose={() => {
                resetGoalForm()
                setOpenComposer(null)
              }}
            >
              <form className="bank-form" onSubmit={handleAddGoal}>
                <div className="goal-type-selector">
                  <button
                    type="button"
                    className={`goal-type-option ${goalForm.type === 'fixed-term' ? 'active' : ''}`}
                    onClick={() => setGoalForm((current) => ({ ...current, type: 'fixed-term' }))}
                  >
                    <strong>Término fijo</strong>
                    <small>Tienes fecha objetivo · te dice cuánto ahorrar al mes</small>
                  </button>
                  <button
                    type="button"
                    className={`goal-type-option ${goalForm.type === 'indefinite' ? 'active' : ''}`}
                    onClick={() => setGoalForm((current) => ({ ...current, type: 'indefinite', targetDate: '' }))}
                  >
                    <strong>Indefinido</strong>
                    <small>Sin fecha límite · ahorras a tu ritmo</small>
                  </button>
                </div>

                <label>
                  Nombre de la meta
                  <input
                    value={goalForm.name}
                    onChange={(event) => setGoalForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ej. Viaje a Europa, Casa propia, Moto"
                  />
                </label>

                <div className="form-grid two">
                  <label>
                    Monto objetivo
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={goalForm.targetAmount}
                      onChange={(event) =>
                        setGoalForm((current) => ({ ...current, targetAmount: keepOnlyDigits(event.target.value) }))
                      }
                      placeholder="5000000"
                    />
                  </label>
                  {goalForm.type === 'fixed-term' && (
                    <label>
                      Fecha objetivo
                      <input
                        type="date"
                        value={goalForm.targetDate}
                        min={today}
                        onChange={(event) =>
                          setGoalForm((current) => ({ ...current, targetDate: event.target.value }))
                        }
                      />
                    </label>
                  )}
                </div>

                <div className="form-grid two">
                  <label>
                    Icono
                    <select
                      value={goalForm.icon}
                      onChange={(event) => setGoalForm((current) => ({ ...current, icon: event.target.value }))}
                    >
                      {pocketIcons.map((icon) => (
                        <option key={icon} value={icon}>
                          {icon}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Color
                    <input
                      type="color"
                      value={goalForm.color}
                      onChange={(event) => setGoalForm((current) => ({ ...current, color: event.target.value }))}
                    />
                  </label>
                </div>

                <div className="provision-pocket-toggle">
                  <label className="provision-toggle-label">
                    <input
                      type="checkbox"
                      checked={goalForm.createNewPocket}
                      onChange={(event) =>
                        setGoalForm((current) => ({ ...current, createNewPocket: event.target.checked }))
                      }
                    />
                    Crear un nuevo bolsillo dedicado a esta meta
                  </label>
                </div>

                {goalForm.createNewPocket ? (
                  <label>
                    Nombre del nuevo bolsillo
                    <input
                      value={goalForm.newPocketName}
                      onChange={(event) =>
                        setGoalForm((current) => ({ ...current, newPocketName: event.target.value }))
                      }
                      placeholder="Ej. Fondo Europa, Ahorro casa"
                    />
                  </label>
                ) : (
                  <label>
                    Bolsillo donde se acumula
                    <select
                      value={goalForm.pocketId}
                      onChange={(event) => setGoalForm((current) => ({ ...current, pocketId: event.target.value }))}
                    >
                      {state.pockets.map((pocket) => (
                        <option key={pocket.id} value={pocket.id}>
                          {pocket.icon} {pocket.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label>
                  Descripción (opcional)
                  <input
                    value={goalForm.description}
                    onChange={(event) => setGoalForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Detalles, motivación, recordatorio..."
                  />
                </label>

                <button type="submit" disabled={isGoalBusy}>
                  {isGoalBusy
                    ? goalForm.id ? 'Guardando...' : 'Creando...'
                    : goalForm.id ? 'Guardar meta' : 'Crear meta'}
                </button>
                {goalForm.id && (
                  <button
                    type="button"
                    className="secondary-button cancel-action"
                    onClick={() => {
                      resetGoalForm()
                      setOpenComposer(null)
                    }}
                  >
                    Cancelar edición
                  </button>
                )}
              </form>
            </FullscreenComposer>
          )}

          {/* ─── Resumen general ─── */}
          {activeGoals.length > 0 && (
            <SectionFrame
              label="Visión general"
              title="Todas tus metas"
              subtitle={`${activeGoals.length} activa(s) · ${money.format(totalAccumulated)} de ${money.format(totalTarget)}`}
              collapsed={isSectionCollapsed('metas-resumen')}
              onToggle={() => toggleSection('metas-resumen')}
              emphasis
            >
              <div className="goals-overview">
                <div className="goals-overall-bar">
                  <div className="goals-overall-track">
                    <div
                      className="goals-overall-fill"
                      style={{ width: `${overallProgress * 100}%` }}
                    />
                  </div>
                  <div className="goals-overall-meta">
                    <span>{percent.format(overallProgress)} acumulado</span>
                    <strong>Faltan {money.format(totalTarget - totalAccumulated)}</strong>
                  </div>
                </div>
              </div>
            </SectionFrame>
          )}

          <SectionFrame
            label="Metas activas"
            title="En progreso"
            subtitle={`${activeGoals.length} meta(s) activa(s)`}
            collapsed={isSectionCollapsed('metas-activas')}
            onToggle={() => toggleSection('metas-activas')}
          >
            <div className="goals-stack">
              {activeGoals.map((data) => {
                const { goal, currentAmount, progress, remaining, isCompleted, monthlyContributionNeeded, daysRemaining, isOnTrack, estimatedCompletionDate } = data
                const pocket = state.pockets.find((p) => p.id === goal.pocketId)
                const accentColor = goal.color

                return (
                  <article
                    key={goal.id}
                    className={`goal-card ${isCompleted ? 'goal-completed' : ''}`}
                    style={{ '--goal-accent': accentColor } as React.CSSProperties}
                  >
                    <div className="goal-card-head">
                      <div className="goal-card-identity">
                        <span className="goal-icon" style={{ background: `${accentColor}22`, color: accentColor }}>
                          {goal.icon}
                        </span>
                        <div>
                          <div className="card-title-row">
                            <strong>{goal.name}</strong>
                            <span className={`goal-type-badge ${goal.type}`}>
                              {goal.type === 'fixed-term' ? 'Término fijo' : 'Indefinido'}
                            </span>
                          </div>
                          <p className="goal-meta">
                            {pocket?.icon} {pocket?.name ?? 'Sin bolsillo'}
                            {goal.targetDate && ` · vence ${formatDateInputDisplay(goal.targetDate)}`}
                          </p>
                          {goal.description && <p className="goal-description">{goal.description}</p>}
                        </div>
                      </div>
                      <div className="goal-card-actions">
                        <button
                          type="button"
                          className="edit-icon-button"
                          aria-label={`Editar meta ${goal.name}`}
                          onClick={() => startEditGoal(goal.id)}
                        >
                          <LuPencil />
                        </button>
                        <button
                          type="button"
                          className="edit-icon-button"
                          aria-label={`Eliminar meta ${goal.name}`}
                          onClick={() => handleDeleteGoal(goal.id)}
                        >
                          <LuTrash2 />
                        </button>
                      </div>
                    </div>

                    <div className="goal-progress-section">
                      <div className="goal-progress-numbers">
                        <strong style={{ color: accentColor }}>{money.format(currentAmount)}</strong>
                        <small>de {money.format(goal.targetAmount)}</small>
                      </div>
                      <div className="goal-progress-bar">
                        <div
                          className="goal-progress-fill"
                          style={{
                            width: `${progress * 100}%`,
                            background: isCompleted
                              ? 'linear-gradient(90deg, #34d399, #10b981)'
                              : `linear-gradient(90deg, ${accentColor}, ${accentColor}dd)`,
                          }}
                        />
                      </div>
                      <div className="goal-progress-percent">
                        <span>{percent.format(progress)} completado</span>
                        {!isCompleted && <span>Faltan {money.format(remaining)}</span>}
                      </div>
                    </div>

                    {!isCompleted && (
                      <div className="goal-insights">
                        {goal.type === 'fixed-term' && (
                          <>
                            <div className="goal-insight">
                              <span>Cuota sugerida</span>
                              <strong>{money.format(Math.ceil(monthlyContributionNeeded))}/mes</strong>
                            </div>
                            <div className="goal-insight">
                              <span>Tiempo restante</span>
                              <strong>{daysRemaining} días</strong>
                            </div>
                            <div className="goal-insight">
                              <span>Estado</span>
                              <strong className={isOnTrack ? 'positive' : 'negative'}>
                                {isOnTrack ? '✓ Al día' : '⚠ Atrasado'}
                              </strong>
                            </div>
                          </>
                        )}
                        {goal.type === 'indefinite' && (
                          <>
                            <div className="goal-insight">
                              <span>Ritmo diario</span>
                              <strong>{money.format(Math.round(data.dailyPace))}/día</strong>
                            </div>
                            <div className="goal-insight">
                              <span>Llegada estimada</span>
                              <strong>
                                {estimatedCompletionDate ? formatDateInputDisplay(estimatedCompletionDate) : '—'}
                              </strong>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {isCompleted && (
                      <div className="goal-completion-banner">
                        <span>🎉 ¡Meta alcanzada!</span>
                        <button
                          type="button"
                          className="action-trigger debt-trigger"
                          onClick={() => handleCompleteGoal(goal.id)}
                        >
                          Marcar como completada
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
              {activeGoals.length === 0 && (
                <p className="empty-copy">
                  No tienes metas activas. Crea una para empezar a perseguir tus objetivos.
                </p>
              )}
            </div>
          </SectionFrame>

          {completedGoals.filter((g) => !g.goal.active).length > 0 && (
            <SectionFrame
              label="Logros"
              title="Metas completadas"
              subtitle={`${completedGoals.filter((g) => !g.goal.active).length} meta(s) alcanzada(s)`}
              collapsed={isSectionCollapsed('metas-completadas')}
              onToggle={() => toggleSection('metas-completadas')}
            >
              <div className="goals-stack">
                {completedGoals
                  .filter((g) => !g.goal.active)
                  .map((data) => {
                    const { goal } = data
                    return (
                      <article key={goal.id} className="goal-card goal-archived">
                        <div className="goal-card-head">
                          <div className="goal-card-identity">
                            <span
                              className="goal-icon"
                              style={{ background: `${goal.color}22`, color: goal.color }}
                            >
                              {goal.icon}
                            </span>
                            <div>
                              <strong>{goal.name}</strong>
                              <p className="goal-meta">
                                Completada · {money.format(goal.targetAmount)}
                                {goal.completedAt && ` · ${formatDateInputDisplay(goal.completedAt.slice(0, 10))}`}
                              </p>
                            </div>
                          </div>
                          <div className="goal-card-actions">
                            <button
                              type="button"
                              className="edit-icon-button"
                              aria-label={`Reactivar meta ${goal.name}`}
                              onClick={() => handleReactivateGoal(goal.id)}
                            >
                              <LuTrophy />
                            </button>
                            <button
                              type="button"
                              className="edit-icon-button"
                              aria-label={`Eliminar meta ${goal.name}`}
                              onClick={() => handleDeleteGoal(goal.id)}
                            >
                              <LuTrash2 />
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
              </div>
            </SectionFrame>
          )}
        </div>

        <aside className="secondary-column">
          <section className="panel banking-panel emphasis">
            <span className="micro-label">Resumen</span>
            <h2>Tus metas</h2>
            <div className="status-grid">
              <div>
                <span>Total objetivo</span>
                <strong>{money.format(totalTarget)}</strong>
              </div>
              <div>
                <span>Acumulado</span>
                <strong>{money.format(totalAccumulated)}</strong>
              </div>
              <div>
                <span>Activas</span>
                <strong>{activeGoals.length}</strong>
              </div>
              <div>
                <span>Completadas</span>
                <strong>{completedGoals.filter((g) => !g.goal.active).length}</strong>
              </div>
            </div>
          </section>

          <section className="panel banking-panel">
            <span className="micro-label">Compromiso mensual</span>
            <h2>Cuotas sugeridas</h2>
            <div className="review-list">
              {activeGoals
                .filter((g) => g.goal.type === 'fixed-term' && !g.isCompleted)
                .map((data) => (
                  <div key={data.goal.id} className="review-chip">
                    <span>
                      {data.goal.icon} {data.goal.name}
                      <small className="chip-meta">{data.daysRemaining} días restantes</small>
                    </span>
                    <strong>{money.format(Math.ceil(data.monthlyContributionNeeded))}</strong>
                  </div>
                ))}
              {activeGoals.filter((g) => g.goal.type === 'fixed-term' && !g.isCompleted).length === 0 && (
                <p className="empty-copy">No tienes metas con fecha objetivo activa.</p>
              )}
            </div>
            {activeGoals.filter((g) => g.goal.type === 'fixed-term' && !g.isCompleted).length > 0 && (
              <p className="analytics-footnote">
                Suma cuotas:{' '}
                {money.format(
                  Math.ceil(
                    activeGoals
                      .filter((g) => g.goal.type === 'fixed-term' && !g.isCompleted)
                      .reduce((sum, g) => sum + g.monthlyContributionNeeded, 0),
                  ),
                )}
                /mes para alcanzar todas tus metas a tiempo.
              </p>
            )}
          </section>
        </aside>
      </section>
    )
  }

  function renderAnalisisView() {
    const healthLabel =
      averagesLast6.savingsRate >= 0.2
        ? { text: 'Excelente', tone: 'good' }
        : averagesLast6.savingsRate >= 0.1
          ? { text: 'Estable', tone: 'ok' }
          : averagesLast6.savingsRate >= 0
            ? { text: 'Atencion', tone: 'warn' }
            : { text: 'En rojo', tone: 'bad' }

    const debtRiskLabel =
      debtAnalysis.installmentToIncomeRatio >= 0.4
        ? { text: 'Alto', tone: 'bad' }
        : debtAnalysis.installmentToIncomeRatio >= 0.25
          ? { text: 'Moderado', tone: 'warn' }
          : debtAnalysis.installmentToIncomeRatio > 0
            ? { text: 'Saludable', tone: 'good' }
            : { text: 'Sin deuda', tone: 'good' }

    const formatDelta = (delta: number) => {
      const sign = delta > 0 ? '+' : ''
      return `${sign}${(delta * 100).toFixed(0)}%`
    }

    return (
      <section className="dashboard-grid">
        <div className="primary-column">
          {/* ─── KPIs DIARIOS - Lo más importante del día ─── */}
          <SectionFrame
            label="Hoy"
            title="Pulso del día"
            subtitle="Las métricas que importan ahora mismo"
            collapsed={isSectionCollapsed('analisis-kpis')}
            onToggle={() => toggleSection('analisis-kpis')}
            emphasis
          >
            <div className="kpi-grid">
              <div className="kpi-card kpi-primary">
                <span className="kpi-label">Puedes gastar hoy</span>
                <strong className="kpi-value">{money.format(dailyBudget.perDay)}</strong>
                <small className="kpi-detail">
                  {money.format(dailyBudget.available)} disponibles / {dailyBudget.daysRemaining} días restantes
                </small>
              </div>
              <div className={`kpi-card kpi-${monthPace.status}`}>
                <span className="kpi-label">Ritmo del mes</span>
                <strong className="kpi-value">{monthPace.label}</strong>
                <small className="kpi-detail">
                  {percent.format(monthPace.dayProgress)} del mes · {money.format(monthPace.actualSpent)} gastado
                </small>
              </div>
              <div className={`kpi-card kpi-${financialRunway.status}`}>
                <span className="kpi-label">Autonomía</span>
                <strong className="kpi-value">
                  {financialRunway.months < 100 ? `${financialRunway.months.toFixed(1)} meses` : '∞'}
                </strong>
                <small className="kpi-detail">Sin ingresos, con gasto promedio</small>
              </div>
              <div className={`kpi-card kpi-${emergencyFundCoverage.status}`}>
                <span className="kpi-label">Fondo emergencia</span>
                <strong className="kpi-value">{emergencyFundCoverage.months.toFixed(1)} meses</strong>
                <small className="kpi-detail">
                  Meta: 3 meses · {percent.format(emergencyFundCoverage.progressToTarget)} del objetivo
                </small>
              </div>
            </div>
          </SectionFrame>

          {/* ─── ALERTAS INTELIGENTES ─── */}
          {smartAlerts.length > 0 && (
            <SectionFrame
              label="Atención"
              title="Alertas activas"
              subtitle={`${smartAlerts.length} señal(es) que requieren tu atención`}
              collapsed={isSectionCollapsed('analisis-alertas')}
              onToggle={() => toggleSection('analisis-alertas')}
            >
              <div className="alerts-stack">
                {smartAlerts.map((alert) => (
                  <div key={alert.id} className={`alert-chip alert-${alert.tone}`}>
                    <div className="alert-indicator" />
                    <div className="alert-body">
                      <strong>{alert.title}</strong>
                      <small>{alert.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </SectionFrame>
          )}

          {/* ─── COMPARATIVO MES ACTUAL VS ANTERIOR ─── */}
          <SectionFrame
            label="Mes a mes"
            title="Este mes vs el anterior"
            subtitle="Cómo te comparas con el período pasado"
            collapsed={isSectionCollapsed('analisis-mom')}
            onToggle={() => toggleSection('analisis-mom')}
          >
            <div className="mom-grid">
              <div className="mom-card">
                <span className="mom-label">Ingresos</span>
                <strong>{money.format(momComparison.currentIncome)}</strong>
                <small className="mom-previous">vs {money.format(momComparison.previousIncome)}</small>
                <span className={`mom-delta ${momComparison.incomeDelta >= 0 ? 'positive' : 'negative'}`}>
                  {momComparison.incomeDelta >= 0 ? '↑' : '↓'} {formatDelta(momComparison.incomeDelta)}
                </span>
              </div>
              <div className="mom-card">
                <span className="mom-label">Gastos</span>
                <strong>{money.format(momComparison.currentExpense)}</strong>
                <small className="mom-previous">vs {money.format(momComparison.previousExpense)}</small>
                <span className={`mom-delta ${momComparison.expenseDelta <= 0 ? 'positive' : 'negative'}`}>
                  {momComparison.expenseDelta >= 0 ? '↑' : '↓'} {formatDelta(momComparison.expenseDelta)}
                </span>
              </div>
              <div className="mom-card">
                <span className="mom-label">Ahorro neto</span>
                <strong className={momComparison.currentSavings >= 0 ? 'positive' : 'negative'}>
                  {money.format(momComparison.currentSavings)}
                </strong>
                <small className="mom-previous">vs {money.format(momComparison.previousSavings)}</small>
                <span className={`mom-delta ${momComparison.savingsDelta >= 0 ? 'positive' : 'negative'}`}>
                  {momComparison.savingsDelta >= 0 ? '↑' : '↓'} {formatDelta(momComparison.savingsDelta)}
                </span>
              </div>
            </div>
          </SectionFrame>

          {/* ─── SALUD FINANCIERA ORIGINAL ─── */}
          <SectionFrame
            label="Vista 360"
            title="Salud financiera"
            subtitle="Promedios de los ultimos 6 meses comparados con tu compromiso mensual."
            collapsed={isSectionCollapsed('analisis-salud')}
            onToggle={() => toggleSection('analisis-salud')}
          >
            <div className="analytics-metrics">
              <div className="analytics-metric">
                <span>Ingreso promedio</span>
                <strong>{money.format(averagesLast6.avgIncome)}</strong>
                <small>/mes</small>
              </div>
              <div className="analytics-metric">
                <span>Gasto promedio</span>
                <strong>{money.format(averagesLast6.avgExpense)}</strong>
                <small>/mes</small>
              </div>
              <div className="analytics-metric">
                <span>Ahorro promedio</span>
                <strong className={averagesLast6.avgNet >= 0 ? 'positive' : 'negative'}>
                  {money.format(averagesLast6.avgNet)}
                </strong>
                <small>{percent.format(averagesLast6.savingsRate)} de tasa</small>
              </div>
              <div className="analytics-metric">
                <span>Estado</span>
                <strong className={`tag-${healthLabel.tone}`}>{healthLabel.text}</strong>
                <small>Salud financiera</small>
              </div>
            </div>
          </SectionFrame>

          <SectionFrame
            label="Flujo mensual"
            title="Ingresos vs gastos"
            subtitle="Comparativo de los ultimos 6 meses"
            collapsed={isSectionCollapsed('analisis-flujo')}
            onToggle={() => toggleSection('analisis-flujo')}
          >
            <GroupedBarChart data={monthlyFlowSeries} />
          </SectionFrame>

          <SectionFrame
            label="Composicion del gasto"
            title="Distribucion por categoria"
            subtitle={`Mes actual · ${expensesByCategory.length} categoria(s) con gasto`}
            collapsed={isSectionCollapsed('analisis-categorias')}
            onToggle={() => toggleSection('analisis-categorias')}
          >
            <DonutChart
              data={expensesByCategory.map((item) => ({ label: item.label, value: item.value }))}
              formatValue={(value) => money.format(value)}
            />
          </SectionFrame>

          <SectionFrame
            label="Bolsillos mas usados"
            title="Gasto por bolsillo"
            subtitle="Top 6 bolsillos del mes"
            collapsed={isSectionCollapsed('analisis-bolsillos')}
            onToggle={() => toggleSection('analisis-bolsillos')}
          >
            <HorizontalBarList
              data={expensesByPocket}
              formatValue={(value) => money.format(value)}
            />
          </SectionFrame>

          <SectionFrame
            label="Trayectoria"
            title="Evolucion del saldo neto"
            subtitle="Suma acumulada del flujo (ingresos − gastos) por mes"
            collapsed={isSectionCollapsed('analisis-trayectoria')}
            onToggle={() => toggleSection('analisis-trayectoria')}
          >
            <LineAreaChart data={historicalBalanceSeries} />
          </SectionFrame>

          {/* ─── TENDENCIA POR CATEGORÍA ─── */}
          <SectionFrame
            label="Tendencias"
            title="¿Qué categorías subieron o bajaron?"
            subtitle="Mes actual vs promedio de los últimos 3 meses"
            collapsed={isSectionCollapsed('analisis-tendencias')}
            onToggle={() => toggleSection('analisis-tendencias')}
          >
            <div className="trend-list">
              {categoryTrends.map((trend) => {
                const isUp = trend.delta > 0.05
                const isDown = trend.delta < -0.05
                const arrow = isUp ? '↑' : isDown ? '↓' : '→'
                const toneClass = isUp ? 'negative' : isDown ? 'positive' : 'neutral'
                return (
                  <div key={trend.category} className="trend-row">
                    <div className="trend-row-head">
                      <span className="trend-category">{trend.category}</span>
                      <span className={`trend-delta ${toneClass}`}>
                        {arrow} {formatDelta(trend.delta)}
                      </span>
                    </div>
                    <div className="trend-amounts">
                      <strong>{money.format(trend.current)}</strong>
                      <small>vs prom. {money.format(trend.avgPrevious)}</small>
                    </div>
                  </div>
                )
              })}
              {categoryTrends.length === 0 && (
                <p className="empty-copy">No hay categorías con gastos este mes para comparar.</p>
              )}
            </div>
          </SectionFrame>

          {/* ─── HISTÓRICO TASA DE AHORRO ─── */}
          <SectionFrame
            label="Disciplina"
            title="Tasa de ahorro histórica"
            subtitle="¿Estás mejorando? La meta saludable es 20%+"
            collapsed={isSectionCollapsed('analisis-tasa-ahorro')}
            onToggle={() => toggleSection('analisis-tasa-ahorro')}
          >
            <SavingsRateChart data={savingsRateHistory} />
          </SectionFrame>

          {/* ─── PATRÓN POR DÍA DE LA SEMANA ─── */}
          <SectionFrame
            label="Patrones"
            title="Gasto por día de la semana"
            subtitle="Promedio de los últimos 3 meses"
            collapsed={isSectionCollapsed('analisis-semana')}
            onToggle={() => toggleSection('analisis-semana')}
          >
            <WeekdayBarChart data={spendingByWeekday} />
          </SectionFrame>

          {/* ─── PROYECCIÓN CON ESCENARIOS ─── */}
          <SectionFrame
            label="Proyección"
            title="Saldo a 6 meses · 3 escenarios"
            subtitle="Optimista: gasto -10% e ingreso +5% · Pesimista: gasto +15% e ingreso -10%"
            collapsed={isSectionCollapsed('analisis-proyeccion')}
            onToggle={() => toggleSection('analisis-proyeccion')}
          >
            <div className="projection-shell">
              <ScenarioAreaChart data={scenarioProjection.series} />
              <div className="projection-meta scenarios">
                <div>
                  <span>Optimista</span>
                  <strong className="positive">{money.format(scenarioProjection.optimisticEnd)}</strong>
                </div>
                <div>
                  <span>Realista</span>
                  <strong>{money.format(scenarioProjection.realisticEnd)}</strong>
                </div>
                <div>
                  <span>Pesimista</span>
                  <strong className={scenarioProjection.pessimisticEnd < 0 ? 'negative' : ''}>
                    {money.format(scenarioProjection.pessimisticEnd)}
                  </strong>
                </div>
              </div>
            </div>
          </SectionFrame>
        </div>

        <aside className="secondary-column">
          <SectionFrame
            label="Analisis de deuda"
            title="Capacidad vs compromiso"
            subtitle="Cuanto pesa la deuda sobre tus ingresos"
            collapsed={isSectionCollapsed('analisis-deuda')}
            onToggle={() => toggleSection('analisis-deuda')}
            emphasis
          >
            <div className="analytics-metrics compact">
              <div className="analytics-metric">
                <span>Deuda pendiente</span>
                <strong>{money.format(debtAnalysis.totalDebt)}</strong>
                <small>{debtAnalysis.activeCount} activa(s)</small>
              </div>
              <div className="analytics-metric">
                <span>Cuotas del mes</span>
                <strong>{money.format(debtAnalysis.totalInstallment)}</strong>
                <small>{percent.format(debtAnalysis.installmentToIncomeRatio)} del ingreso</small>
              </div>
              <div className="analytics-metric">
                <span>Tiempo de liquidacion</span>
                <strong>{debtAnalysis.monthsToPayoff || '—'}</strong>
                <small>{debtAnalysis.monthsToPayoff ? 'meses al ritmo actual' : 'Sin deuda activa'}</small>
              </div>
              <div className="analytics-metric">
                <span>Riesgo</span>
                <strong className={`tag-${debtRiskLabel.tone}`}>{debtRiskLabel.text}</strong>
                <small>Deuda / ingreso</small>
              </div>
            </div>
            <div className="ratio-bar">
              <span className="ratio-bar-label">
                Cuota/ingreso: {percent.format(debtAnalysis.installmentToIncomeRatio)}
              </span>
              <div className="ratio-bar-track">
                <div
                  className={`ratio-bar-fill tone-${debtRiskLabel.tone}`}
                  style={{ width: `${Math.min(100, debtAnalysis.installmentToIncomeRatio * 100)}%` }}
                />
              </div>
              <small>Recomendado: mantener bajo el 30%.</small>
            </div>
          </SectionFrame>

          <SectionFrame
            label="Compromisos mensuales"
            title="Distribucion del ingreso"
            subtitle="Cuanto se va en fijos, deudas y provisiones"
            collapsed={isSectionCollapsed('analisis-compromisos')}
            onToggle={() => toggleSection('analisis-compromisos')}
          >
            <DonutChart
              data={[
                { label: 'Obligaciones fijas', value: fixedCommitmentRatio.totalFixed, color: '#f59e0b' },
                { label: 'Cuotas de deuda', value: fixedCommitmentRatio.totalDebtInstallments, color: '#fb7185' },
                { label: 'Provisiones', value: fixedCommitmentRatio.totalProvisions, color: '#a78bfa' },
                {
                  label: 'Disponible',
                  value: Math.max(0, averagesLast6.avgIncome - fixedCommitmentRatio.totalCommitments),
                  color: '#34d399',
                },
              ]}
              formatValue={(value) => money.format(value)}
            />
            <p className="analytics-footnote">
              Tu compromiso total es {money.format(fixedCommitmentRatio.totalCommitments)} ({percent.format(fixedCommitmentRatio.ratio)} del ingreso promedio).
            </p>
          </SectionFrame>

          <SectionFrame
            label="Top gastos"
            title="Mayores salidas del mes"
            subtitle="Los 5 movimientos mas grandes"
            collapsed={isSectionCollapsed('analisis-top-gastos')}
            onToggle={() => toggleSection('analisis-top-gastos')}
          >
            <div className="review-list">
              {topExpensesThisMonth.map((expense) => (
                <div key={expense.id} className="review-chip">
                  <span>
                    {expense.description}
                    <small className="chip-meta">{expense.category} · {expense.date.slice(8, 10)}/{expense.date.slice(5, 7)}</small>
                  </span>
                  <strong>{money.format(expense.amount)}</strong>
                </div>
              ))}
              {topExpensesThisMonth.length === 0 && (
                <p className="empty-copy">No hay gastos registrados este mes todavia.</p>
              )}
            </div>
          </SectionFrame>

          {/* ─── GASTOS HORMIGA ─── */}
          <SectionFrame
            label="Gastos hormiga"
            title="Pequeños pero frecuentes"
            subtitle={`Transacciones menores a ${money.format(smallExpensesAnalysis.threshold)}`}
            collapsed={isSectionCollapsed('analisis-hormiga')}
            onToggle={() => toggleSection('analisis-hormiga')}
          >
            <div className="ant-expenses-summary">
              <div className="ant-summary-card">
                <span>Total acumulado</span>
                <strong>{money.format(smallExpensesAnalysis.total)}</strong>
                <small>{smallExpensesAnalysis.count} transacciones este mes</small>
              </div>
            </div>
            <div className="review-list">
              {smallExpensesAnalysis.recurring.map((item) => (
                <div key={item.description} className="review-chip">
                  <span>
                    {item.description}
                    <small className="chip-meta">{item.count} veces este mes</small>
                  </span>
                  <strong>{money.format(item.total)}</strong>
                </div>
              ))}
              {smallExpensesAnalysis.recurring.length === 0 && (
                <p className="empty-copy">
                  No tienes patrones de gastos pequeños repetidos. ¡Bien hecho!
                </p>
              )}
            </div>
          </SectionFrame>
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
		                <button
		                  type="button"
		                  className="text-link"
		                  disabled={Boolean(actionLoading['sync:now'])}
		                  onClick={async () => {
		                    const actionKey = 'sync:now'
		                    if (!beginAction(actionKey)) return
		                    try {
		                      await syncNow()
		                    } finally {
		                      endAction(actionKey, 650)
		                    }
		                  }}
		                >
		                  {actionLoading['sync:now'] ? 'Sincronizando...' : 'Forzar sincronizacion'}
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
                    <button
                      type="button"
                      className="text-link compact"
                      disabled={Boolean(actionLoading[`categorias:eliminar:${category}`])}
                      onClick={() => handleRemoveCategory(category)}
                    >
                      {actionLoading[`categorias:eliminar:${category}`] ? 'Quitando...' : 'Quitar'}
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
                    disabled={Boolean(actionLoading[`reglas:eliminar:${rule.keyword}`])}
                    onClick={() => handleRemoveLearningRule(rule.keyword)}
                  >
                    {actionLoading[`reglas:eliminar:${rule.keyword}`] ? 'Quitando...' : 'Quitar'}
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
      {uiNotice &&
        createPortal(
          <div className="ui-notice-shell" role="alert" aria-live="assertive">
            <div className="ui-notice-card">
              <div className="ui-notice-copy">
                <strong>{uiNotice.title}</strong>
                <p>{uiNotice.message}</p>
              </div>
              <button
                type="button"
                className="ui-notice-close"
                aria-label="Cerrar alerta"
                onClick={() => setUiNotice(null)}
              >
                <LuX />
              </button>
            </div>
          </div>,
          document.body,
        )}
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
          </header>
        )}

        <div className="view-stage" data-view={activeView}>
          {activeView === 'resumen' && renderSummaryView()}
          {activeView === 'bolsillos' && renderPocketsView()}
          {activeView === 'movimientos' && renderMovementsView()}
          {activeView === 'programacion' && renderProgrammingView()}
          {activeView === 'deudas' && renderDebtsView()}
          {activeView === 'provisiones' && renderProvisionesView()}
          {activeView === 'metas' && renderMetasView()}
          {activeView === 'analisis' && renderAnalisisView()}
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
