export interface MensajeriaMessages {
  mensajeGeneral: string[]
  mensajesPersonalizados: string[]
}

export interface LiquidPorEstablecimientoItem {
  distrito: number | null
  tipoOrg: string | null
  numero: number | string | null
  nombreEstab: string | null
  secu: number | string | null
  perOpago: string | null // YYYYMM
  nombreOpago: string | null
  liquido: number | null
  fecPago: string | null // DD/MM/YYYY
  opid: number | string | null
}

export interface LiquidacionPorSecuenciaItem {
  // Identificación del agente
  apYNom: string | null
  numDoc: string | null
  sexo: string | null
  cuitCuil: string | null
  mesaPago: string | null // YYYYMM

  // Establecimiento / secuencia
  tipoOrg: string | null
  numero: string | null
  nombreEstab: string | null
  secu: string | null
  rev: string | null

  // Características
  cat: string | null
  rural: string | null
  secciones: string | null
  turnos: string | null
  dobEscolEstab: string | null

  // Detalle de haberes/descuentos
  codigo: string | null
  descripcionCodigo: string | null
  pesos: number | null

  // Orden / fechas
  oPid: string | null
  fecAfec: string | null // YYYYMM
}

export interface ChequesBundle {
  id: string
  periodoYYYYMM: string
  liquidPorEstablecimiento: LiquidPorEstablecimientoItem[]
  liquidacionPorSecuencia: LiquidacionPorSecuenciaItem[]
  mensajeria: MensajeriaMessages
  errors?: string[]
}

