import type { ComponentType, CSSProperties } from 'react'
import {
  LuBackpack,
  LuBadgeDollarSign,
  LuBaby,
  LuBanknote,
  LuBeer,
  LuBike,
  LuBookOpen,
  LuBriefcase,
  LuBuilding2,
  LuBus,
  LuCakeSlice,
  LuCalculator,
  LuCar,
  LuCat,
  LuChartPie,
  LuCoffee,
  LuCoins,
  LuCreditCard,
  LuDog,
  LuDollarSign,
  LuDoorOpen,
  LuDroplets,
  LuDumbbell,
  LuFilm,
  LuFlame,
  LuFuel,
  LuGamepad2,
  LuGem,
  LuGift,
  LuGlobe,
  LuGraduationCap,
  LuHandCoins,
  LuHeadphones,
  LuHeart,
  LuHeartPulse,
  LuHouse,
  LuKeyRound,
  LuLandmark,
  LuLaptop,
  LuLightbulb,
  LuLuggage,
  LuMap,
  LuMonitor,
  LuMusic,
  LuPartyPopper,
  LuPawPrint,
  LuPencil,
  LuPhone,
  LuPiggyBank,
  LuPill,
  LuPizza,
  LuPlane,
  LuPlug,
  LuReceipt,
  LuRocket,
  LuSandwich,
  LuShield,
  LuShirt,
  LuShoppingBag,
  LuShoppingCart,
  LuSmartphone,
  LuSofa,
  LuSparkles,
  LuStar,
  LuStethoscope,
  LuTarget,
  LuTent,
  LuTrainFront,
  LuTrendingUp,
  LuTrophy,
  LuTruck,
  LuTv,
  LuUtensils,
  LuWallet,
  LuWatch,
  LuWifi,
  LuWine,
  LuZap,
} from 'react-icons/lu'
import type { IconBaseProps } from 'react-icons'

export type PocketIconKey =
  | 'wallet' | 'card' | 'bank' | 'banknote' | 'coins' | 'piggy-bank'
  | 'dollar' | 'receipt' | 'hand-coins' | 'badge-dollar' | 'briefcase' | 'calculator'
  | 'house' | 'sofa' | 'door' | 'key' | 'building'
  | 'cart' | 'utensils' | 'pizza' | 'coffee' | 'wine' | 'beer' | 'cake' | 'sandwich'
  | 'car' | 'bike' | 'plane' | 'bus' | 'train' | 'truck' | 'fuel' | 'rocket'
  | 'globe' | 'map' | 'tent' | 'backpack' | 'luggage'
  | 'pill' | 'stethoscope' | 'heart-pulse' | 'dumbbell'
  | 'book' | 'graduation' | 'pencil'
  | 'film' | 'gamepad' | 'music' | 'tv'
  | 'phone-line' | 'laptop' | 'monitor' | 'headphones' | 'wifi' | 'smartphone'
  | 'bulb' | 'plug' | 'water'
  | 'shopping-bag' | 'shirt' | 'watch' | 'gem'
  | 'dog' | 'cat' | 'paws' | 'baby' | 'gift' | 'party' | 'heart'
  | 'target' | 'trophy' | 'shield' | 'trending' | 'star' | 'sparkles' | 'flame' | 'zap' | 'chart-pie'

type IconComp = ComponentType<IconBaseProps>

export type PocketIconEntry = {
  key: PocketIconKey
  label: string
  group: string
  Icon: IconComp
}

/** Catálogo completo de íconos disponibles para bolsillos. */
export const pocketIconCatalog: PocketIconEntry[] = [
  // ───── Dinero / banca ─────
  { key: 'wallet', label: 'Billetera', group: 'Dinero', Icon: LuWallet },
  { key: 'card', label: 'Tarjeta', group: 'Dinero', Icon: LuCreditCard },
  { key: 'bank', label: 'Banco', group: 'Dinero', Icon: LuLandmark },
  { key: 'banknote', label: 'Billete', group: 'Dinero', Icon: LuBanknote },
  { key: 'coins', label: 'Monedas', group: 'Dinero', Icon: LuCoins },
  { key: 'piggy-bank', label: 'Alcancía', group: 'Dinero', Icon: LuPiggyBank },
  { key: 'dollar', label: 'Dólar', group: 'Dinero', Icon: LuDollarSign },
  { key: 'receipt', label: 'Recibo', group: 'Dinero', Icon: LuReceipt },
  { key: 'hand-coins', label: 'Mano monedas', group: 'Dinero', Icon: LuHandCoins },
  { key: 'badge-dollar', label: 'Insignia $', group: 'Dinero', Icon: LuBadgeDollarSign },
  { key: 'briefcase', label: 'Maletín', group: 'Dinero', Icon: LuBriefcase },
  { key: 'calculator', label: 'Calculadora', group: 'Dinero', Icon: LuCalculator },

  // ───── Hogar ─────
  { key: 'house', label: 'Casa', group: 'Hogar', Icon: LuHouse },
  { key: 'sofa', label: 'Sofá', group: 'Hogar', Icon: LuSofa },
  { key: 'door', label: 'Puerta', group: 'Hogar', Icon: LuDoorOpen },
  { key: 'key', label: 'Llave', group: 'Hogar', Icon: LuKeyRound },
  { key: 'building', label: 'Edificio', group: 'Hogar', Icon: LuBuilding2 },

  // ───── Comida ─────
  { key: 'cart', label: 'Mercado', group: 'Comida', Icon: LuShoppingCart },
  { key: 'utensils', label: 'Cubiertos', group: 'Comida', Icon: LuUtensils },
  { key: 'pizza', label: 'Pizza', group: 'Comida', Icon: LuPizza },
  { key: 'coffee', label: 'Café', group: 'Comida', Icon: LuCoffee },
  { key: 'wine', label: 'Vino', group: 'Comida', Icon: LuWine },
  { key: 'beer', label: 'Cerveza', group: 'Comida', Icon: LuBeer },
  { key: 'cake', label: 'Torta', group: 'Comida', Icon: LuCakeSlice },
  { key: 'sandwich', label: 'Sándwich', group: 'Comida', Icon: LuSandwich },

  // ───── Transporte ─────
  { key: 'car', label: 'Carro', group: 'Transporte', Icon: LuCar },
  { key: 'bike', label: 'Bicicleta', group: 'Transporte', Icon: LuBike },
  { key: 'plane', label: 'Avión', group: 'Transporte', Icon: LuPlane },
  { key: 'bus', label: 'Bus', group: 'Transporte', Icon: LuBus },
  { key: 'train', label: 'Tren', group: 'Transporte', Icon: LuTrainFront },
  { key: 'truck', label: 'Camión', group: 'Transporte', Icon: LuTruck },
  { key: 'fuel', label: 'Gasolina', group: 'Transporte', Icon: LuFuel },
  { key: 'rocket', label: 'Cohete', group: 'Transporte', Icon: LuRocket },

  // ───── Viajes ─────
  { key: 'globe', label: 'Mundo', group: 'Viajes', Icon: LuGlobe },
  { key: 'map', label: 'Mapa', group: 'Viajes', Icon: LuMap },
  { key: 'tent', label: 'Camping', group: 'Viajes', Icon: LuTent },
  { key: 'backpack', label: 'Mochila', group: 'Viajes', Icon: LuBackpack },
  { key: 'luggage', label: 'Equipaje', group: 'Viajes', Icon: LuLuggage },

  // ───── Salud / fitness ─────
  { key: 'pill', label: 'Medicina', group: 'Salud', Icon: LuPill },
  { key: 'stethoscope', label: 'Médico', group: 'Salud', Icon: LuStethoscope },
  { key: 'heart-pulse', label: 'Salud', group: 'Salud', Icon: LuHeartPulse },
  { key: 'dumbbell', label: 'Gimnasio', group: 'Salud', Icon: LuDumbbell },

  // ───── Educación ─────
  { key: 'book', label: 'Libro', group: 'Educación', Icon: LuBookOpen },
  { key: 'graduation', label: 'Educación', group: 'Educación', Icon: LuGraduationCap },
  { key: 'pencil', label: 'Lápiz', group: 'Educación', Icon: LuPencil },

  // ───── Entretenimiento ─────
  { key: 'film', label: 'Cine', group: 'Entretenimiento', Icon: LuFilm },
  { key: 'gamepad', label: 'Videojuegos', group: 'Entretenimiento', Icon: LuGamepad2 },
  { key: 'music', label: 'Música', group: 'Entretenimiento', Icon: LuMusic },
  { key: 'tv', label: 'TV', group: 'Entretenimiento', Icon: LuTv },

  // ───── Tecnología ─────
  { key: 'smartphone', label: 'Celular', group: 'Tecnología', Icon: LuSmartphone },
  { key: 'laptop', label: 'Laptop', group: 'Tecnología', Icon: LuLaptop },
  { key: 'monitor', label: 'Monitor', group: 'Tecnología', Icon: LuMonitor },
  { key: 'headphones', label: 'Audífonos', group: 'Tecnología', Icon: LuHeadphones },
  { key: 'wifi', label: 'WiFi', group: 'Tecnología', Icon: LuWifi },
  { key: 'phone-line', label: 'Teléfono', group: 'Tecnología', Icon: LuPhone },

  // ───── Servicios ─────
  { key: 'bulb', label: 'Luz', group: 'Servicios', Icon: LuLightbulb },
  { key: 'plug', label: 'Energía', group: 'Servicios', Icon: LuPlug },
  { key: 'water', label: 'Agua', group: 'Servicios', Icon: LuDroplets },

  // ───── Compras / moda ─────
  { key: 'shopping-bag', label: 'Compras', group: 'Compras', Icon: LuShoppingBag },
  { key: 'shirt', label: 'Ropa', group: 'Compras', Icon: LuShirt },
  { key: 'watch', label: 'Reloj', group: 'Compras', Icon: LuWatch },
  { key: 'gem', label: 'Joya', group: 'Compras', Icon: LuGem },

  // ───── Familia / mascotas / regalos ─────
  { key: 'dog', label: 'Perro', group: 'Familia', Icon: LuDog },
  { key: 'cat', label: 'Gato', group: 'Familia', Icon: LuCat },
  { key: 'paws', label: 'Mascota', group: 'Familia', Icon: LuPawPrint },
  { key: 'baby', label: 'Bebé', group: 'Familia', Icon: LuBaby },
  { key: 'gift', label: 'Regalo', group: 'Familia', Icon: LuGift },
  { key: 'party', label: 'Fiesta', group: 'Familia', Icon: LuPartyPopper },
  { key: 'heart', label: 'Corazón', group: 'Familia', Icon: LuHeart },

  // ───── Metas / logros ─────
  { key: 'target', label: 'Meta', group: 'Metas', Icon: LuTarget },
  { key: 'trophy', label: 'Trofeo', group: 'Metas', Icon: LuTrophy },
  { key: 'shield', label: 'Escudo', group: 'Metas', Icon: LuShield },
  { key: 'trending', label: 'Tendencia', group: 'Metas', Icon: LuTrendingUp },
  { key: 'star', label: 'Estrella', group: 'Metas', Icon: LuStar },
  { key: 'sparkles', label: 'Brillos', group: 'Metas', Icon: LuSparkles },
  { key: 'flame', label: 'Llama', group: 'Metas', Icon: LuFlame },
  { key: 'zap', label: 'Rayo', group: 'Metas', Icon: LuZap },
  { key: 'chart-pie', label: 'Estadística', group: 'Metas', Icon: LuChartPie },
]

/** Map de key → componente, para resolución rápida. */
const iconMap = new Map<string, IconComp>(
  pocketIconCatalog.map((entry) => [entry.key, entry.Icon]),
)

/** Lista de keys disponibles (para el picker). */
export const availablePocketIconKeys: PocketIconKey[] = pocketIconCatalog.map((entry) => entry.key)

/** Heurística simple para detectar si un string es un emoji legacy (no es una key conocida). */
function isLegacyEmoji(name: string): boolean {
  return !iconMap.has(name)
}

/**
 * Componente que renderiza el ícono de un bolsillo.
 * Si `name` es una key del catálogo, renderiza el componente SVG.
 * Si no (emoji legacy), lo renderiza como texto para mantener compatibilidad.
 */
export function PocketIcon({
  name,
  size = 20,
  style,
  className,
}: {
  name: string
  size?: number
  style?: CSSProperties
  className?: string
}) {
  const Icon = iconMap.get(name)
  if (Icon) {
    return <Icon size={size} style={style} className={className} />
  }
  // Fallback para bolsillos viejos que aún tienen emojis guardados
  if (isLegacyEmoji(name)) {
    return (
      <span style={{ fontSize: size, lineHeight: 1, ...style }} className={className}>
        {name}
      </span>
    )
  }
  // Fallback final: ícono por defecto
  return <LuWallet size={size} style={style} className={className} />
}

/** Ícono default para cada tipo de bolsillo. */
export function getDefaultPocketIconKey(type: 'daily' | 'savings' | 'fixed' | 'invest'): PocketIconKey {
  if (type === 'daily') return 'wallet'
  if (type === 'savings') return 'piggy-bank'
  if (type === 'fixed') return 'receipt'
  return 'target'
}
