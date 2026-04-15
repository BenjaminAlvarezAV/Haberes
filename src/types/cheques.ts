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
  tipoOrgInt: string | null
  numeroInt: string | null
  nombreEstabInt: string | null
  secu: string | null
  rev: string | null
  /** Código de establecimiento tal como viene del servicio (ej. 0097MT0006). */
  estabPag: string | null
  distritoInt: string | null
  ccticas: string | null
  ccticasInt: string | null
  nomDistInt: string | null

  // Características
  cat: string | null
  catInt: string | null
  rural: string | null
  ruralInt: string | null
  secciones: string | null
  seccionesInt: string | null
  turnos: string | null
  turnosInt: string | null
  dobEscolEstab: string | null
  esCarcel: string | null
  esDeno?: string | null
  direccion: string | null
  cargoReal: string | null
  choraria: string | null
  apoyoReal: string | null
  cargoInt: string | null
  apoyoInt: string | null
  antig: string | null
  inas: string | null

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

