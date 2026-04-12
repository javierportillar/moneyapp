import type { AppState, ModuleKey, ViewKey } from './types'

export const STORAGE_KEY = 'finpilot-v2'
export const pocketIcons = ['💼', '🏠', '🛒', '💳', '🧾', '🎯', '✈️', '🛡️', '📈', '💰']

export const defaultCategories = [
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

export const categoryKeywords: Record<string, string[]> = {
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

export const initialState: AppState = {
  pockets: [
    { id: 'p1', name: 'Operacion', balance: 0, color: '#0f766e', icon: '💼', type: 'daily' },
    { id: 'p2', name: 'Colchon', balance: 0, color: '#1d4ed8', icon: '🛡️', type: 'savings' },
    { id: 'p3', name: 'Pagos fijos', balance: 0, color: '#f59e0b', icon: '🧾', type: 'fixed' },
    { id: 'p4', name: 'Meta viaje', balance: 0, color: '#7c3aed', icon: '✈️', type: 'invest' },
  ],
  fixedExpenses: [],
  debts: [],
  debtPayments: [],
  monthClosures: [],
  incomes: [],
  transfers: [],
  expenses: [],
  learningRules: [],
  categories: [...defaultCategories],
  config: {
    pocketTypeLabels: {
      daily: 'Operacion',
      savings: 'Ahorro',
      fixed: 'Pagos fijos',
      invest: 'Meta o inversion',
    },
  },
}

export const moduleLabels: Record<ModuleKey, string> = {
  gasto: 'Registrar gasto',
  ingreso: 'Registrar ingreso',
  transferencia: 'Transferencia',
  fijos: 'Obligaciones',
  bolsillos: 'Bolsillos',
}

export const viewLabels: Record<ViewKey, string> = {
  resumen: 'Resumen',
  bolsillos: 'Bolsillos',
  movimientos: 'Movimientos',
  programacion: 'Obligaciones',
  deudas: 'Deudas',
  configuracion: 'Configuracion',
}
