'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect, useCallback, useRef } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { supabase } from './lib/supabaseClient'
import LoginScreen from './LoginScreen'
import type { Session } from '@supabase/supabase-js'

const MapView = dynamic(() => import('./components/MapView'), { ssr: false })

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

const ZONAS_NDVI = [
  { zona: 1,  rango: '0.90 – 1.00', color: '#005000' },
  { zona: 2,  rango: '0.80 – 0.89', color: '#007800' },
  { zona: 3,  rango: '0.70 – 0.79', color: '#22aa22' },
  { zona: 4,  rango: '0.60 – 0.69', color: '#64c832' },
  { zona: 5,  rango: '0.50 – 0.59', color: '#dcdc00' },
  { zona: 6,  rango: '0.40 – 0.49', color: '#ffb400' },
  { zona: 7,  rango: '0.30 – 0.39', color: '#ff7800' },
  { zona: 8,  rango: '0.20 – 0.29', color: '#dc3c00' },
  { zona: 9,  rango: '0.10 – 0.19', color: '#c81e1e' },
  { zona: 10, rango: '0.00 – 0.09', color: '#8c0000' },
]

const ZONA_PCT: Record<number, number> = {1:100,2:90,3:80,4:70,5:60,6:50,7:40,8:30,9:15,10:5}

type Estado = 'idle' | 'cargando_parcela' | 'parcela_ok' | 'buscando' | 'cargando_rgb' | 'calculando_zonas' | 'done' | 'error'
type ModoVista = 'ninguna' | 'rgb' | 'zonas'
type Pestaña = 'mapa' | 'mis_parcelas' | 'tratamientos'

const TIPOS_TRATAMIENTO = [
  'Herbicida', 'Fungicida', 'Insecticida', 'Abonado',
  'Corrector nutricional', 'Bioestimulante', 'Regulador de crecimiento', 'Otro'
]

interface Tratamiento {
  id: string
  tipo: string
  producto: string
  materiaActiva: string
  dosis: string
  unidadDosis: 'L/ha' | 'Kg/ha'
  dosisMaxima: string      // Dosis máxima permitida por ha (opcional, introducida por usuario)
  aplicMaxima: string       // Nº máximo de aplicaciones por campaña (opcional)
  fecha: string
  aplicador: string
  observaciones: string
  parcelaIds: string[]
  fechaRegistro: string
  mrlResultado?: any
}

interface StockItem {
  id: string
  producto: string
  comprado: string
  unidad: 'L' | 'Kg'
  fechaRegistro: string
}

interface ParcelaGuardada {
  id: string
  nombre: string
  cultivo: string
  fechaPlantacion: string
  infoAdicional: string
  geojson: any
  parcelaInfo: any
  supHa: number
  imagenPreview: string | null
  fechaGuardado: string
}

export default function Home() {
  // ── Autenticación ─────────────────────────────────────────────────────────
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoaded, setDataLoaded] = useState(false)

  // ── Navegación ──────────────────────────────────────────────────────────
  const [pestana, setPestana] = useState<Pestaña>('mapa')

  // ── Estado mapa ──────────────────────────────────────────────────────────
  const [estado, setEstado] = useState<Estado>('idle')
  const [error, setError] = useState('')
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [seleccionando, setSeleccionando] = useState(false)

  const [parcGeojson, setParcGeojson] = useState<any>(null)
  const [parcelaInfo, setParcelaInfo] = useState<any>(null)
  const [parcelaSupHa, setParcelaSupHa] = useState<number>(0)

  const [fechaInicio, setFechaInicio] = useState('2024-05-01')
  const [fechaFin, setFechaFin] = useState('2024-08-31')
  const [productos, setProductos] = useState<any[]>([])
  const [productoSel, setProductoSel] = useState('')

  const [imagenUrl, setImagenUrl] = useState<string | null>(null)
  const [modoVista, setModoVista] = useState<ModoVista>('ninguna')

  const [zonasData, setZonasData] = useState<any[]>([])
  const [mododibujo, setMododibujo] = useState(false)
  const [historico, setHistorico] = useState<any[]>([])
  const [mostrarHistorico, setMostrarHistorico] = useState(false)
  const [flujoUrl, setFlujoUrl] = useState<string | null>(null)
  const [flujoStats, setFlujoStats] = useState<any>(null)
  const [calculandoFlujo, setCalculandoFlujo] = useState(false)
  const [mostrarFlujo, setMostrarFlujo] = useState(false)
  const [kgPorHa, setKgPorHa] = useState<Record<string, string>>({})
  const [produccion, setProduccion] = useState<any>(null)

  // ── Mis Parcelas ──────────────────────────────────────────────────────────
  const [misParcelas, setMisParcelas] = useState<ParcelaGuardada[]>([])
  const [formularioVisible, setFormularioVisible] = useState(false)
  const [parcelaEditar, setParcelaEditar] = useState<ParcelaGuardada | null>(null)
  const [formNombre, setFormNombre] = useState('')
  const [formCultivo, setFormCultivo] = useState('')
  const [formFechaPlantacion, setFormFechaPlantacion] = useState('')
  const [formInfoAdicional, setFormInfoAdicional] = useState('')
  const [formError, setFormError] = useState('')
  const [parcelaVistaEnMapa, setParcelaVistaEnMapa] = useState<any>(null)
  const [imagenPreviewForm, setImagenPreviewForm] = useState<string | null>(null)

  // ── Tratamientos ──────────────────────────────────────────────────────────
  const [tratamientos, setTratamientos] = useState<Tratamiento[]>([])
  const [parcelaDetalleId, setParcelaDetalleId] = useState<string | null>(null)
  // Form tratamiento
  const [formTrat, setFormTrat] = useState(false)
  const [tratEditar, setTratEditar] = useState<Tratamiento | null>(null)
  const [tratParcelaCtx, setTratParcelaCtx] = useState<string | null>(null) // parcela ctx si viene desde ficha
  const [tTipo, setTTipo] = useState('')
  const [tProducto, setTProducto] = useState('')
  const [tMateriaActiva, setTMateriaActiva] = useState('')
  const [tDosis, setTDosis] = useState('')
  const [mrlResultado, setMrlResultado] = useState<any>(null)
  const [consultandoMrl, setConsultandoMrl] = useState(false)
  const [tUnidad, setTUnidad] = useState<'L/ha' | 'Kg/ha'>('L/ha')
  const [tFecha, setTFecha] = useState('')
  const [tAplicador, setTAplicador] = useState('')
  const [tObs, setTObs] = useState('')
  const [tParcelas, setTParcelas] = useState<string[]>([])
  const [tError, setTError] = useState('')
  const [tratExpandido, setTratExpandido] = useState<string | null>(null)
  // Filtros
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroProducto, setFiltroProducto] = useState('')
  const [filtroParcela, setFiltroParcela] = useState('')
  const [tDosisMaxima, setTDosisMaxima] = useState('')
  const [tAplicMaxima, setTAplicMaxima] = useState('')

  // ── Subpestañas de TRATAMIENTOS ──────────────────────────────────────────
  const [subTabTrat, setSubTabTrat] = useState<'realizados' | 'estadistica' | 'stock'>('realizados')
  const [statExpandido, setStatExpandido] = useState<string | null>(null)

  // ── Stock ─────────────────────────────────────────────────────────────────
  const [stock, setStock] = useState<StockItem[]>([])
  const [formStock, setFormStock] = useState(false)
  const [stockProducto, setStockProducto] = useState('')
  const [stockCantidad, setStockCantidad] = useState('')
  const [stockUnidad, setStockUnidad] = useState<'L' | 'Kg'>('L')

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${BACKEND}/health`).then(r => setBackendOk(r.ok)).catch(() => setBackendOk(false))
  }, [])

  // ── Autenticación: escuchar sesión ──────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      if (!sess) setDataLoaded(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // ── Cargar datos del usuario desde Supabase al iniciar sesión ────────────────
  useEffect(() => {
    if (!session || dataLoaded) return

    const cargarDatos = async () => {
      try {
        const [pRes, tRes, sRes, hRes] = await Promise.all([
          supabase.from('parcelas').select('*').order('created_at', { ascending: false }),
          supabase.from('tratamientos').select('*').order('created_at', { ascending: false }),
          supabase.from('stock').select('*').order('created_at', { ascending: false }),
          supabase.from('historico').select('*').order('created_at', { ascending: false }).limit(20),
        ])

        if (pRes.data) {
          setMisParcelas(pRes.data.map((p: any) => ({
            id: p.id, nombre: p.nombre || '', cultivo: p.cultivo,
            fechaPlantacion: p.fecha_plantacion || '', infoAdicional: p.info_adicional || '',
            geojson: p.geojson, parcelaInfo: p.parcela_info, supHa: Number(p.sup_ha) || 0,
            imagenPreview: p.imagen_preview, fechaGuardado: p.fecha_guardado,
          })))
        }

        if (tRes.data) {
          setTratamientos(tRes.data.map((t: any) => ({
            id: t.id, tipo: t.tipo, producto: t.producto, materiaActiva: t.materia_activa || '',
            dosis: t.dosis || '', unidadDosis: t.unidad_dosis || 'L/ha',
            dosisMaxima: t.dosis_maxima || '', aplicMaxima: t.aplic_maxima || '',
            fecha: t.fecha, aplicador: t.aplicador || '', observaciones: t.observaciones || '',
            parcelaIds: t.parcela_ids || [], fechaRegistro: t.fecha_registro,
            mrlResultado: t.mrl_resultado || undefined,
          })))
        }

        if (sRes.data) {
          setStock(sRes.data.map((s: any) => ({
            id: s.id, producto: s.producto, comprado: s.comprado, unidad: s.unidad,
            fechaRegistro: s.fecha_registro,
          })))
        }

        if (hRes.data) {
          setHistorico(hRes.data.map((h: any) => ({
            id: h.id, fecha: h.fecha, fecha_guardado: h.fecha_guardado, parcela: h.parcela,
            sup_ha: h.sup_ha, sup_ha_num: Number(h.sup_ha_num) || 0,
            geojson: h.geojson, parcelaInfo: h.parcela_info, zonas: h.zonas,
          })))
        }
      } catch (e) {
        console.error('Error cargando datos:', e)
      } finally {
        setDataLoaded(true)
      }
    }

    cargarDatos()
  }, [session, dataLoaded])

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    setMisParcelas([]); setTratamientos([]); setStock([]); setHistorico([])
    setParcGeojson(null); setParcelaInfo(null); setParcelaSupHa(0)
    setPestana('mapa'); deseleccionar()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getBbox = (geojson: any): string => {
    const geom = geojson.features[0].geometry
    const allCoords: number[][] = []
    if (geom.type === 'Polygon') allCoords.push(...geom.coordinates[0])
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((p: any) => allCoords.push(...p[0]))
    const lons = allCoords.map(c => c[0])
    const lats = allCoords.map(c => c[1])
    const pad = 0.00005
    return `${Math.min(...lons)-pad},${Math.min(...lats)-pad},${Math.max(...lons)+pad},${Math.max(...lats)+pad}`
  }

  const getFecha = () => productos.find(p => p.id === productoSel)?.fecha || fechaInicio

  const resetear = () => {
    setImagenUrl(null); setModoVista('ninguna')
    setZonasData([]); setProduccion(null); setKgPorHa({})
    setFlujoUrl(null); setFlujoStats(null); setMostrarFlujo(false)
  }

  const getEsriPreviewUrl = (geojson: any): string => {
    // Calcular bbox de la parcela
    const geom = geojson.features[0].geometry
    const allCoords: number[][] = []
    if (geom.type === 'Polygon') allCoords.push(...geom.coordinates[0])
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((p: any) => allCoords.push(...p[0]))
    const lons = allCoords.map(c => c[0])
    const lats = allCoords.map(c => c[1])
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)

    // Esri World Imagery Export API (gratuita, sin API key)
    const bbox = `${minLon},${minLat},${maxLon},${maxLat}`
    const bboxSR = '4326'
    const size = '400,400'
    const imageSR = '4326'
    const format = 'jpg'
    const url = `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=${bboxSR}&size=${size}&imageSR=${imageSR}&format=${format}&f=image`
    return url
  }

  const deseleccionar = () => {
    setParcGeojson(null); setParcelaInfo(null); setParcelaSupHa(0)
    setProductos([]); setProductoSel(''); setEstado('idle')
    setError(''); setMododibujo(false); setSeleccionando(false)
    setParcelaVistaEnMapa(null)
    resetear()
  }

  // ── GUARDAR PARCELA → abre formulario en MIS PARCELAS ────────────────────
  const abrirFormularioGuardar = () => {
    setFormNombre('')
    setFormCultivo('')
    setFormFechaPlantacion('')
    setFormInfoAdicional('')
    setFormError('')
    setParcelaEditar(null)
    // Generar preview del satélite Esri recortado a la parcela
    if (parcGeojson) {
      const esriUrl = getEsriPreviewUrl(parcGeojson)
      setImagenPreviewForm(esriUrl)
    }
    setFormularioVisible(true)
    setPestana('mis_parcelas')
  }

  // ── Funciones tratamientos ───────────────────────────────────────────────
  const saveTratamientos = (lista: Tratamiento[]) => {
    setTratamientos(lista)
  }

  const upsertTratamientoDB = async (t: Tratamiento) => {
    if (!session) return
    try {
      await supabase.from('tratamientos').upsert({
        id: t.id, user_id: session.user.id, tipo: t.tipo, producto: t.producto,
        materia_activa: t.materiaActiva, dosis: t.dosis, unidad_dosis: t.unidadDosis,
        dosis_maxima: t.dosisMaxima, aplic_maxima: t.aplicMaxima, fecha: t.fecha,
        aplicador: t.aplicador, observaciones: t.observaciones, parcela_ids: t.parcelaIds,
        fecha_registro: t.fechaRegistro, mrl_resultado: t.mrlResultado || null,
      })
    } catch (e) { console.error('Error guardando tratamiento:', e) }
  }

  const abrirFormTrat = (parcelaId?: string, trat?: Tratamiento) => {
    setTratEditar(trat || null)
    setTratParcelaCtx(parcelaId || null)
    setTTipo(trat?.tipo || '')
    setTProducto(trat?.producto || '')
    setTMateriaActiva(trat?.materiaActiva || '')
    setTDosis(trat?.dosis || '')
    setMrlResultado(trat?.mrlResultado || null)
    setTUnidad(trat?.unidadDosis || 'L/ha')
    setTDosisMaxima(trat?.dosisMaxima || '')
    setTAplicMaxima(trat?.aplicMaxima || '')
    setTFecha(trat?.fecha || '')
    setTAplicador(trat?.aplicador || '')
    setTObs(trat?.observaciones || '')
    setTParcelas(trat?.parcelaIds || (parcelaId ? [parcelaId] : []))
    setTError('')
    setFormTrat(true)
  }

  const guardarTratamiento = async () => {
    if (!tTipo) { setTError('El tipo es obligatorio'); return }
    if (!tProducto.trim()) { setTError('El producto es obligatorio'); return }
    if (!tDosis.trim()) { setTError('La dosis es obligatoria'); return }
    if (!tFecha) { setTError('La fecha es obligatoria'); return }
    if (tParcelas.length === 0) { setTError('Selecciona al menos una parcela'); return }

    const nuevo: Tratamiento = {
      id: tratEditar?.id || String(Date.now()),
      tipo: tTipo, producto: tProducto.trim(), materiaActiva: tMateriaActiva.trim(),
      dosis: tDosis.trim(), unidadDosis: tUnidad,
      dosisMaxima: tDosisMaxima.trim(), aplicMaxima: tAplicMaxima.trim(),
      fecha: tFecha,
      aplicador: tAplicador.trim(), observaciones: tObs.trim(),
      parcelaIds: tParcelas, fechaRegistro: new Date().toLocaleDateString('es-ES'),
      mrlResultado: mrlResultado || undefined,
    }
    const lista = tratEditar
      ? tratamientos.map(t => t.id === tratEditar.id ? nuevo : t)
      : [nuevo, ...tratamientos]
    saveTratamientos(lista)
    upsertTratamientoDB(nuevo)
    setFormTrat(false)
    setTratEditar(null)
  }

  const consultarMRL = async (sustancia: string, cultivo: string) => {
    if (!sustancia.trim() || !cultivo.trim()) return
    setConsultandoMrl(true)
    setMrlResultado(null)
    try {
      const r = await fetch(`${BACKEND}/mrl/consultar?sustancia=${encodeURIComponent(sustancia)}&cultivo=${encodeURIComponent(cultivo)}`)
      const data = await r.json()
      setMrlResultado(data)
    } catch (e) {
      setMrlResultado({ encontrado: false, motivo: 'Error consultando la base de datos MRL' })
    } finally {
      setConsultandoMrl(false)
    }
  }

  const eliminarTratamiento = async (id: string) => {
    if (!confirm('¿Eliminar este tratamiento?')) return
    saveTratamientos(tratamientos.filter(t => t.id !== id))
    try { await supabase.from('tratamientos').delete().eq('id', id) } catch (e) { console.error(e) }
  }

  const tratamientosDeParcela = (parcelaId: string) =>
    tratamientos.filter(t => t.parcelaIds.includes(parcelaId))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))

  const tratamientosFiltrados = tratamientos
    .filter(t => !filtroTipo || t.tipo === filtroTipo)
    .filter(t => !filtroProducto || t.producto.toLowerCase().includes(filtroProducto.toLowerCase()))
    .filter(t => !filtroParcela || t.parcelaIds.includes(filtroParcela))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))

  const totalHaTratadas = () => {
    const parcelasUnicas = new Set(tratamientos.flatMap(t => t.parcelaIds))
    return Array.from(parcelasUnicas).reduce((acc: number, id: string) => {
      const p = misParcelas.find(p => p.id === id)
      return acc + (p?.supHa || 0)
    }, 0)
  }

  // ── Funciones STOCK ───────────────────────────────────────────────────────
  const saveStock = (lista: StockItem[]) => {
    setStock(lista)
  }

  const upsertStockDB = async (s: StockItem) => {
    if (!session) return
    try {
      await supabase.from('stock').upsert({
        id: s.id, user_id: session.user.id, producto: s.producto,
        comprado: s.comprado, unidad: s.unidad, fecha_registro: s.fechaRegistro,
      })
    } catch (e) { console.error('Error guardando stock:', e) }
  }

  const guardarStockItem = async () => {
    if (!stockProducto.trim() || !stockCantidad.trim() || Number(stockCantidad) <= 0) return
    const nombreNorm = stockProducto.trim().toLowerCase()
    const existente = stock.find(s => s.producto.toLowerCase() === nombreNorm && s.unidad === stockUnidad)

    let nuevaLista: StockItem[]
    let itemActualizado: StockItem
    if (existente) {
      itemActualizado = { ...existente, comprado: (Number(existente.comprado) + Number(stockCantidad)).toString(), fechaRegistro: new Date().toLocaleDateString('es-ES') }
      nuevaLista = stock.map(s => s.id === existente.id ? itemActualizado : s)
    } else {
      itemActualizado = {
        id: String(Date.now()),
        producto: stockProducto.trim(),
        comprado: stockCantidad.trim(),
        unidad: stockUnidad,
        fechaRegistro: new Date().toLocaleDateString('es-ES'),
      }
      nuevaLista = [itemActualizado, ...stock]
    }
    saveStock(nuevaLista)
    upsertStockDB(itemActualizado)
    setStockProducto(''); setStockCantidad(''); setStockUnidad('L'); setFormStock(false)
  }

  const eliminarStockItem = async (id: string) => {
    if (!confirm('¿Eliminar este producto del stock?')) return
    saveStock(stock.filter(s => s.id !== id))
    try { await supabase.from('stock').delete().eq('id', id) } catch (e) { console.error(e) }
  }

  // Calcula el total usado de un producto en todos los tratamientos (suma dosis × superficie de cada parcela)
  const calcularUsoProducto = (nombreProducto: string): number => {
    return tratamientos
      .filter(t => t.producto.toLowerCase() === nombreProducto.toLowerCase())
      .reduce((acc, t) => {
        const supTotal = misParcelas
          .filter(p => t.parcelaIds.includes(p.id))
          .reduce((a, p) => a + p.supHa, 0)
        return acc + (Number(t.dosis) || 0) * supTotal
      }, 0)
  }

  // ── Funciones ESTADÍSTICA ─────────────────────────────────────────────────
  // Agrupa tratamientos por cultivo → producto, calculando dosis ponderada y aplicaciones
  interface StatProducto {
    producto: string
    materiaActiva: string
    unidad: string
    numAplicaciones: number
    aplicMaxima: number | null
    dosisPonderada: number
    dosisMaxima: number | null
    detalleParcelas: { nombre: string; dosis: number; supHa: number; total: number }[]
  }

  const estadisticasPorCultivo = (): Record<string, StatProducto[]> => {
    const resultado: Record<string, Record<string, StatProducto>> = {}

    tratamientos.forEach(t => {
      const parcelasAfectadas = misParcelas.filter(p => t.parcelaIds.includes(p.id))
      // Agrupar por cultivo de cada parcela afectada
      const cultivosEnTrat = new Set(parcelasAfectadas.map(p => p.cultivo))

      cultivosEnTrat.forEach(cultivo => {
        if (!resultado[cultivo]) resultado[cultivo] = {}
        const key = t.producto.toLowerCase()
        const parcelasDeEsteCultivo = parcelasAfectadas.filter(p => p.cultivo === cultivo)
        const supTotalCultivo = parcelasDeEsteCultivo.reduce((a, p) => a + p.supHa, 0)

        if (!resultado[cultivo][key]) {
          resultado[cultivo][key] = {
            producto: t.producto,
            materiaActiva: t.materiaActiva,
            unidad: t.unidadDosis,
            numAplicaciones: 0,
            aplicMaxima: t.aplicMaxima ? Number(t.aplicMaxima) : null,
            dosisPonderada: 0,
            dosisMaxima: t.dosisMaxima ? Number(t.dosisMaxima) : null,
            detalleParcelas: [],
          }
        }

        const entry = resultado[cultivo][key]
        entry.numAplicaciones += 1
        if (t.aplicMaxima) entry.aplicMaxima = Number(t.aplicMaxima)
        if (t.dosisMaxima) entry.dosisMaxima = Number(t.dosisMaxima)

        // Acumular: suma de dosis por aplicación (no media), dividir por superficie al final
        parcelasDeEsteCultivo.forEach(p => {
          // Buscar si ya existe esta parcela en detalleParcelas para sumar dosis
          const existente = entry.detalleParcelas.find(d => d.nombre === (p.nombre || p.cultivo))
          if (existente) {
            // Misma parcela, nueva aplicación → sumar dosis
            existente.dosis += Number(t.dosis) || 0
            existente.total = existente.dosis * existente.supHa
          } else {
            entry.detalleParcelas.push({
              nombre: p.nombre || p.cultivo,
              dosis: Number(t.dosis) || 0,
              supHa: p.supHa,
              total: (Number(t.dosis) || 0) * p.supHa,
            })
          }
        })
      })
    })

    // Calcular dosis ponderada final: Σ(dosis_acumulada * sup) / Σsup
    // dosis_acumulada = suma de todas las aplicaciones en esa parcela
    const final: Record<string, StatProducto[]> = {}
    Object.entries(resultado).forEach(([cultivo, productos]) => {
      final[cultivo] = Object.values(productos).map(p => {
        const supTotal = p.detalleParcelas.reduce((a, d) => a + d.supHa, 0)
        const sumaTotal = p.detalleParcelas.reduce((a, d) => a + d.total, 0)
        return {
          ...p,
          dosisPonderada: supTotal > 0 ? sumaTotal / supTotal : 0,
        }
      })
    })
    return final
  }

  const parcelaDetalle = misParcelas.find(p => p.id === parcelaDetalleId) || null

  const guardarParcela = async () => {
    if (!formCultivo.trim()) { setFormError('El cultivo es obligatorio'); return }
    if (!session) { setFormError('Debes iniciar sesión'); return }

    const nueva: ParcelaGuardada = {
      id: parcelaEditar?.id || String(Date.now()),
      nombre: formNombre.trim(),
      cultivo: formCultivo.trim(),
      fechaPlantacion: formFechaPlantacion,
      infoAdicional: formInfoAdicional.trim(),
      geojson: parcGeojson,
      parcelaInfo: parcelaInfo,
      supHa: parcelaSupHa,
      imagenPreview: imagenPreviewForm || imagenUrl,
      fechaGuardado: new Date().toLocaleDateString('es-ES'),
    }

    let nuevaLista: ParcelaGuardada[]
    if (parcelaEditar) {
      nuevaLista = misParcelas.map(p => p.id === parcelaEditar.id ? nueva : p)
    } else {
      nuevaLista = [nueva, ...misParcelas]
    }
    setMisParcelas(nuevaLista)

    try {
      await supabase.from('parcelas').upsert({
        id: nueva.id, user_id: session.user.id, nombre: nueva.nombre, cultivo: nueva.cultivo,
        fecha_plantacion: nueva.fechaPlantacion, info_adicional: nueva.infoAdicional,
        geojson: nueva.geojson, parcela_info: nueva.parcelaInfo, sup_ha: nueva.supHa,
        imagen_preview: nueva.imagenPreview, fecha_guardado: nueva.fechaGuardado,
      })
    } catch (e) { console.error('Error guardando parcela:', e) }

    setFormularioVisible(false)
    setParcelaEditar(null)
  }

  const cancelarFormulario = () => {
    setFormularioVisible(false)
    setParcelaEditar(null)
    setFormError('')
    if (!parcelaEditar) setPestana('mapa')
  }

  const abrirEditar = (p: ParcelaGuardada) => {
    setParcelaEditar(p)
    setFormNombre(p.nombre)
    setFormCultivo(p.cultivo)
    setFormFechaPlantacion(p.fechaPlantacion)
    setFormInfoAdicional(p.infoAdicional)
    setFormError('')
    // Usar imagen guardada o regenerar desde Esri
    setImagenPreviewForm(p.imagenPreview || (p.geojson ? getEsriPreviewUrl(p.geojson) : null))
    setFormularioVisible(true)
    setParcGeojson(p.geojson)
    setParcelaInfo(p.parcelaInfo)
    setParcelaSupHa(p.supHa)
  }

  const eliminarParcela = async (id: string) => {
    if (!confirm('¿Eliminar esta parcela?')) return
    const nueva = misParcelas.filter(p => p.id !== id)
    setMisParcelas(nueva)
    try { await supabase.from('parcelas').delete().eq('id', id) } catch (e) { console.error(e) }
  }

  const verEnMapa = (p: ParcelaGuardada) => {
    // Limpiar estado anterior sin borrar lo que viene de la parcela
    setImagenUrl(null)
    setModoVista('ninguna')
    setZonasData([])
    setProduccion(null)
    setKgPorHa({})
    setFlujoUrl(null)
    setFlujoStats(null)
    setMostrarFlujo(false)
    // Cargar parcela
    setParcGeojson(p.geojson)
    setParcelaInfo(p.parcelaInfo)
    setParcelaSupHa(p.supHa)
    setParcelaVistaEnMapa(p.geojson)
    // Resetear búsqueda de imágenes para que el usuario pueda buscar
    setProductos([])
    setProductoSel('')
    setSeleccionando(false)
    setMododibujo(false)
    setError('')
    setEstado('parcela_ok')
    setPestana('mapa')
  }

  // ── Histórico ─────────────────────────────────────────────────────────────
  const guardarEnHistorico = async (zonasCalculadas: any[], fecha: string) => {
    if (!zonasCalculadas.length) return
    const entrada = {
      id: Date.now(),
      fecha,
      fecha_guardado: new Date().toLocaleDateString('es-ES'),
      parcela: parcelaInfo?.origen === 'dibujado_mano'
        ? 'Dibujada a mano'
        : `Mun:${parcelaInfo?.municipio} Pol:${parcelaInfo?.poligono} Par:${parcelaInfo?.parcela}`,
      sup_ha: parcelaSupHa.toFixed(4),
      sup_ha_num: parcelaSupHa,
      geojson: parcGeojson,
      parcelaInfo: parcelaInfo,
      zonas: zonasCalculadas.filter(z => z.pixeles > 0).map(z => ({
        zona: z.zona, pixeles: z.pixeles,
        sup_ha_real: z.sup_ha_real.toFixed(4),
        sup_ha_real_num: z.sup_ha_real,
        pct: parcelaSupHa > 0 ? ((z.sup_ha_real / parcelaSupHa) * 100).toFixed(1) : '0',
      })),
    }
    const nuevo = [entrada, ...historico].slice(0, 20)
    setHistorico(nuevo)
    if (session) {
      try {
        await supabase.from('historico').insert({
          id: String(entrada.id), user_id: session.user.id, fecha: entrada.fecha,
          fecha_guardado: entrada.fecha_guardado, parcela: entrada.parcela,
          sup_ha: entrada.sup_ha, sup_ha_num: entrada.sup_ha_num,
          geojson: entrada.geojson, parcela_info: entrada.parcelaInfo, zonas: entrada.zonas,
        })
        // Limpiar entradas antiguas más allá de las 20 últimas
        const idsAConservar = nuevo.map(e => String(e.id))
        const { data: todas } = await supabase.from('historico').select('id').eq('user_id', session.user.id)
        if (todas) {
          const idsABorrar = todas.map((r: any) => r.id).filter((id: string) => !idsAConservar.includes(id))
          if (idsABorrar.length > 0) {
            await supabase.from('historico').delete().in('id', idsABorrar)
          }
        }
      } catch (e) { console.error('Error guardando histórico:', e) }
    }
  }

  // ── Handlers mapa ─────────────────────────────────────────────────────────
  const handleParcelasDibujadas = useCallback((geojson: any, supHa: number) => {
    setParcGeojson(geojson); setParcelaInfo({ origen: 'dibujado_mano' })
    setParcelaSupHa(supHa); setProductos([]); resetear(); setEstado('parcela_ok')
    setParcelaVistaEnMapa(null)
  }, [])

  const handleMapClick = useCallback(async (lat: number, lon: number) => {
    setSeleccionando(false); setEstado('cargando_parcela'); setError('')
    setParcGeojson(null); setParcelaInfo(null); setProductos([])
    setParcelaSupHa(0); setParcelaVistaEnMapa(null); resetear()
    try {
      const r = await fetch(`${BACKEND}/sigpac/punto?lat=${lat}&lon=${lon}`)
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || `Error ${r.status}`) }
      const data = await r.json()
      setParcGeojson(data)
      const props = data.features?.[0]?.properties || {}
      setParcelaInfo(props)
      const supM2 = Number(props.superficie || 0)
      setParcelaSupHa(supM2 > 1000 ? supM2 / 10000 : supM2)
      setEstado('parcela_ok')
    } catch (e: any) { setEstado('error'); setError('No se encontró parcela: ' + e.message) }
  }, [])

  const buscarImagenes = async () => {
    if (!parcGeojson?.features?.length) return
    setParcelaVistaEnMapa(null)  // Permitir overlays al buscar imágenes
    setEstado('buscando'); setError(''); setProductos([]); resetear()
    try {
      const bbox = getBbox(parcGeojson)
      const r = await fetch(`${BACKEND}/sentinel/buscar?bbox=${bbox}&fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}&max_nubosidad=30`)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const data = await r.json()
      if (!data.productos?.length) { setEstado('parcela_ok'); setError('No hay imágenes en ese periodo.'); return }
      setProductos(data.productos); setProductoSel(data.productos[0].id); setEstado('parcela_ok')
    } catch (e: any) { setEstado('error'); setError('Error buscando imágenes: ' + e.message) }
  }

  const verImagenRGB = async () => {
    if (!productoSel || !parcGeojson) return
    setEstado('cargando_rgb'); setError(''); resetear()
    try {
      const bbox = getBbox(parcGeojson)
      const gp = encodeURIComponent(JSON.stringify(parcGeojson))
      const r = await fetch(`${BACKEND}/imagen/rgb?bbox=${bbox}&fecha=${getFecha()}&geojson=${gp}`)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const blob = await r.blob()
      setImagenUrl(URL.createObjectURL(blob)); setModoVista('rgb'); setEstado('parcela_ok')
    } catch (e: any) { setEstado('error'); setError('Error cargando imagen: ' + e.message) }
  }

  const calcularZonasNDVI = async () => {
    if (!productoSel || !parcGeojson) return
    setEstado('calculando_zonas'); setError(''); setZonasData([]); setProduccion(null); setKgPorHa({})
    try {
      const bbox = getBbox(parcGeojson)
      const gp = encodeURIComponent(JSON.stringify(parcGeojson))
      const r = await fetch(`${BACKEND}/ndvi/zonas?bbox=${bbox}&fecha=${getFecha()}&geojson=${gp}`)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const data = await r.json()
      setZonasData(data.zonas)
      const ir = await fetch(`${BACKEND}${data.imagen_url}`)
      const blob = await ir.blob()
      if (imagenUrl) URL.revokeObjectURL(imagenUrl)
      setImagenUrl(URL.createObjectURL(blob)); setModoVista('zonas'); setEstado('done')
      const totalPx = data.zonas.reduce((acc: number, z: any) => acc + z.pixeles, 0)
      const zonasConSupLocal = data.zonas.filter((z: any) => z.pixeles > 0).map((z: any) => ({
        ...z, sup_ha_real: totalPx > 0 ? (z.pixeles / totalPx) * parcelaSupHa : 0,
      }))
      guardarEnHistorico(zonasConSupLocal, getFecha())
    } catch (e: any) { setEstado('error'); setError('Error calculando NDVI: ' + e.message) }
  }

  const calcularFlujo = async () => {
    if (!parcGeojson) return
    setCalculandoFlujo(true); setError(''); setFlujoUrl(null); setFlujoStats(null)
    try {
      const bbox = getBbox(parcGeojson)
      const gp = encodeURIComponent(JSON.stringify(parcGeojson))
      const r = await fetch(`${BACKEND}/flujo/analizar?bbox=${bbox}&geojson=${gp}`)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const data = await r.json()
      setFlujoStats(data.stats)
      const ir = await fetch(`${BACKEND}${data.imagen_url}`)
      const blob = await ir.blob()
      const url = URL.createObjectURL(blob)
      setFlujoUrl(url)
      setMostrarFlujo(true)
      setImagenUrl(url)
      setModoVista('zonas')
    } catch (e: any) { setError('Error en análisis de flujo: ' + e.message) }
    finally { setCalculandoFlujo(false) }
  }

  const calcularProduccion = async (kgHaCalculado: Record<string, number>) => {
    const totalPixeles = zonasData.reduce((acc, z) => acc + z.pixeles, 0)
    const zonasConSup = zonasData.filter(z => z.pixeles > 0).map(z => ({
      ...z,
      superficie_ha: totalPixeles > 0 ? (z.pixeles / totalPixeles) * parcelaSupHa : 0,
      color_hex: ZONAS_NDVI.find(zn => zn.zona === z.zona)?.color || '#888',
    }))
    const kgFinal: Record<string, string> = {}
    Object.entries(kgHaCalculado).forEach(([z, v]) => { kgFinal[z] = String(v) })
    try {
      const r = await fetch(`${BACKEND}/ndvi/produccion`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zonas: zonasConSup, kg_por_ha: kgFinal }),
      })
      if (!r.ok) throw new Error(`Error ${r.status}`)
      setProduccion(await r.json())
    } catch (e: any) { setError('Error calculando producción: ' + e.message) }
  }

  // Regla de tres
  const kgHaCalculado: Record<string, number> = {}
  const entradas = Object.entries(kgPorHa).filter(([_, v]) => v !== '' && Number(v) > 0)
  if (entradas.length > 0) {
    const [zonaRef, kgRef] = entradas[0]
    const pctRef = ZONA_PCT[Number(zonaRef)] || 100
    const kgZona1 = Number(kgRef) / (pctRef / 100)
    Object.entries(ZONA_PCT).forEach(([z, pct]) => { kgHaCalculado[z] = Math.round(kgZona1 * (pct / 100)) })
  }

  const totalPixeles = zonasData.reduce((acc, z) => acc + z.pixeles, 0)
  const zonasConSup = zonasData.filter(z => z.pixeles > 0).map(z => ({
    ...z, sup_ha_real: totalPixeles > 0 ? (z.pixeles / totalPixeles) * parcelaSupHa : 0,
  }))

  const cargando = ['cargando_parcela', 'buscando', 'cargando_rgb', 'calculando_zonas'].includes(estado)

  // ── Colores overlay ───────────────────────────────────────────────────────
  const indiceColorMapa = parcelaVistaEnMapa
    ? 'transparent'
    : modoVista === 'rgb' ? '#fbbf24' : '#3ddc6e'

  // ── RENDER ────────────────────────────────────────────────────────────────

  // Pantalla de carga mientras se comprueba la sesión
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 32 }}>🌱</div>
          <span className="spinner"/>
        </div>
      </div>
    )
  }

  // Pantalla de login/registro si no hay sesión
  if (!session) {
    return <LoginScreen onLogin={async () => {
      const { data } = await supabase.auth.getSession()
      setSession(data.session)
    }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── TABS ── */}
      <div style={{ display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', borderRight: '1px solid var(--border)' }}>
          <span style={{ fontSize: 16 }}>🌱</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--green)', fontWeight: 700, letterSpacing: '0.05em' }}>SIGPAC · SENTINEL</span>
        </div>
        {(['mapa', 'mis_parcelas', 'tratamientos'] as Pestaña[]).map(tab => (
          <button
            key={tab}
            onClick={() => setPestana(tab)}
            style={{
              padding: '12px 20px', border: 'none', background: 'transparent',
              fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              color: pestana === tab ? 'var(--green)' : 'var(--muted)',
              borderBottom: `2px solid ${pestana === tab ? 'var(--green)' : 'transparent'}`,
              letterSpacing: '0.06em', transition: 'all 0.15s',
            }}
          >
            {tab === 'mapa' ? '🗺 MAPA' : tab === 'mis_parcelas' ? '📁 MIS PARCELAS' : '🧪 TRATAMIENTOS'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={backendOk ? 'pulse' : ''} style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: backendOk === null ? '#4a7a56' : backendOk ? 'var(--green)' : 'var(--red)' }}/>
            <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
              {backendOk ? 'BACKEND OK' : 'OFFLINE'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              👤 {session.user.email}
            </span>
            <button onClick={cerrarSesion} style={{ padding: '4px 10px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(255,107,107,0.3)', color: '#fca5a5', fontFamily: 'var(--mono)', fontSize: 9, cursor: 'pointer' }}>
              SALIR
            </button>
          </div>
        </div>
      </div>

      {/* ── CONTENIDO ── */}
      <div style={{ flex: pestana === 'tratamientos' ? '0 0 0px' : 1, overflow: 'hidden', display: 'flex' }}>

        {/* ════════════════ PESTAÑA MAPA ════════════════ */}
        {pestana === 'mapa' && (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>

            {/* Sidebar */}
            <aside style={{ width: 300, height: '100%', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, borderRight: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>

              {/* PASO 1 */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>1</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>SELECCIONAR PARCELA</span>
                </div>

                <button onClick={() => { setSeleccionando(s => !s); setMododibujo(false) }} style={{ width: '100%', padding: '10px', borderRadius: 8, background: seleccionando ? 'var(--green)' : 'var(--surface2)', border: `1px solid ${seleccionando ? 'var(--green)' : 'var(--border)'}`, color: seleccionando ? 'var(--bg)' : 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s' }}>
                  {estado === 'cargando_parcela' ? <><span className="spinner"/> BUSCANDO...</> : seleccionando ? '✕ CANCELAR' : '⊕ CLIC EN EL MAPA'}
                </button>

                {seleccionando && <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(77,184,255,0.06)', border: '1px solid rgba(77,184,255,0.2)', fontSize: 11, color: 'var(--blue)', fontFamily: 'var(--mono)' }}>👆 Haz clic sobre una parcela en el mapa</div>}

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/><span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>O</span><div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
                </div>

                <button onClick={() => { setMododibujo(m => !m); setSeleccionando(false) }} style={{ width: '100%', padding: '9px', borderRadius: 8, background: mododibujo ? 'rgba(77,184,255,0.15)' : 'var(--surface2)', border: `1px solid ${mododibujo ? 'var(--blue)' : 'var(--border)'}`, color: mododibujo ? 'var(--blue)' : 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s' }}>
                  {mododibujo ? '✕ CANCELAR DIBUJO' : '✏ DIBUJAR PARCELA A MANO'}
                </button>
                {mododibujo && <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 6, background: 'rgba(77,184,255,0.06)', border: '1px solid rgba(77,184,255,0.2)', fontSize: 10, color: 'var(--blue)', fontFamily: 'var(--mono)', lineHeight: 1.6 }}>✏ Haz clic para dibujar · Doble clic para cerrar</div>}

                {parcelaInfo && (
                  <div style={{ marginTop: 8, padding: '10px', borderRadius: 6, background: 'var(--green-dim)', border: '1px solid rgba(61,220,110,0.2)', fontSize: 11, fontFamily: 'var(--mono)' }}>
                    <div style={{ color: 'var(--green)', fontWeight: 700, marginBottom: 6 }}>✓ PARCELA SELECCIONADA</div>
                    <div style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
                      {parcelaInfo.origen === 'dibujado_mano'
                        ? <div style={{ color: 'var(--blue)', fontSize: 10 }}>✏ Dibujada a mano</div>
                        : <>
                          {parcelaInfo.municipio && <div>Mun: <span style={{ color: 'var(--text)' }}>{parcelaInfo.municipio}</span></div>}
                          {parcelaInfo.poligono && <div>Pol: <span style={{ color: 'var(--text)' }}>{parcelaInfo.poligono}</span></div>}
                          {parcelaInfo.parcela && <div>Par: <span style={{ color: 'var(--text)' }}>{parcelaInfo.parcela}</span></div>}
                          {parcelaInfo.uso_sigpac && <div>Uso: <span style={{ color: 'var(--text)' }}>{parcelaInfo.uso_sigpac}</span></div>}
                        </>
                      }
                      {parcelaSupHa > 0 && <div>Sup: <span style={{ color: 'var(--text)' }}>{parcelaSupHa.toFixed(4)} ha</span></div>}
                    </div>
                  </div>
                )}

                {parcGeojson && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button onClick={deseleccionar} style={{ flex: 1, padding: '7px', borderRadius: 6, background: 'transparent', border: '1px solid rgba(255,107,107,0.3)', color: '#fca5a5', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer' }}>
                      ✕ DESELECCIONAR
                    </button>
                    <button onClick={abrirFormularioGuardar} style={{ flex: 1, padding: '7px', borderRadius: 6, background: 'rgba(61,220,110,0.1)', border: '1px solid rgba(61,220,110,0.3)', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                      💾 GUARDAR
                    </button>
                  </div>
                )}
              </section>

              {/* PASO 2: Periodo */}
              {parcGeojson && (
                <>
                  <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
                  <section>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>2</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>PERIODO</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                      {[{ label: 'Desde', val: fechaInicio, set: setFechaInicio }, { label: 'Hasta', val: fechaFin, set: setFechaFin }].map(f => (
                        <div key={f.label}>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{f.label}</div>
                          <input type="date" value={f.val} onChange={e => f.set(e.target.value)} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 6px', color: 'var(--text)', fontSize: 11, fontFamily: 'var(--mono)', outline: 'none' }}/>
                        </div>
                      ))}
                    </div>
                    <button onClick={buscarImagenes} disabled={cargando} style={{ width: '100%', padding: '8px', borderRadius: 6, background: 'transparent', border: '1px solid var(--blue)', color: 'var(--blue)', fontSize: 11, fontFamily: 'var(--mono)', cursor: cargando ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      {estado === 'buscando' ? <><span className="spinner"/> BUSCANDO...</> : '◎ BUSCAR IMÁGENES'}
                    </button>
                    {productos.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Imagen ({productos.length} disponibles)</div>
                        <select value={productoSel} onChange={e => { setProductoSel(e.target.value); resetear() }} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 6px', color: 'var(--text)', fontSize: 10, fontFamily: 'var(--mono)', outline: 'none' }}>
                          {productos.map(p => <option key={p.id} value={p.id}>{p.fecha} · ☁ {p.nubosidad ?? '?'}% · {p.size_mb}MB</option>)}
                        </select>
                        <button onClick={verImagenRGB} disabled={cargando} style={{ width: '100%', marginTop: 8, padding: '9px', borderRadius: 6, background: modoVista === 'rgb' ? 'rgba(251,191,36,0.15)' : 'var(--surface2)', border: `1px solid ${modoVista === 'rgb' ? 'var(--amber)' : 'var(--border)'}`, color: modoVista === 'rgb' ? 'var(--amber)' : 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, cursor: cargando ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s' }}>
                          {estado === 'cargando_rgb' ? <><span className="spinner" style={{ borderTopColor: 'var(--amber)' }}/> CARGANDO...</> : modoVista === 'rgb' ? '🛰 IMAGEN CARGADA' : '🛰 VER IMAGEN REAL'}
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}

              {/* PASO 3: NDVI */}
              {productos.length > 0 && (
                <>
                  <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
                  <section>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>3</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>MAPA NDVI</span>
                    </div>
                    <button onClick={calcularZonasNDVI} disabled={cargando} style={{ width: '100%', padding: '11px', borderRadius: 8, background: cargando ? 'var(--surface2)' : 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, cursor: cargando ? 'wait' : 'pointer', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s' }}>
                      {estado === 'calculando_zonas' ? <><span className="spinner" style={{ borderTopColor: 'var(--bg)' }}/> PROCESANDO...</> : '▶ CALCULAR NDVI'}
                    </button>
                    {zonasConSup.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 9, color: 'var(--green)', fontFamily: 'var(--mono)', marginBottom: 8, letterSpacing: '0.08em', fontWeight: 700 }}>ZONAS NDVI · SUPERFICIE</div>
                        {zonasConSup.map(z => {
                          const zi = ZONAS_NDVI.find(zn => zn.zona === z.zona)!
                          const pct = parcelaSupHa > 0 ? ((z.sup_ha_real / parcelaSupHa) * 100).toFixed(1) : '0'
                          return (
                            <div key={z.zona} style={{ marginBottom: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                <div style={{ width: 10, height: 10, borderRadius: 2, background: zi.color, flexShrink: 0 }}/>
                                <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', flex: 1 }}>Z{z.zona} <span style={{ opacity: 0.6 }}>({zi.rango})</span></div>
                                <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text)', fontWeight: 600 }}>{z.sup_ha_real.toFixed(4)} ha</div>
                                <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: zi.color, width: 32, textAlign: 'right' }}>{pct}%</div>
                              </div>
                              <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: zi.color, borderRadius: 2, transition: 'width 0.3s' }}/>
                              </div>
                            </div>
                          )
                        })}
                        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 6, textAlign: 'right' }}>
                          Total: <span style={{ color: 'var(--green)', fontWeight: 700 }}>{parcelaSupHa.toFixed(4)} ha</span>
                        </div>
                      </div>
                    )}
                  </section>
                </>
              )}

              {/* PASO 4: Producción */}
              {zonasConSup.length > 0 && (
                <>
                  <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
                  <section>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0 }}>4</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>CÁLCULO DE PRODUCCIÓN</span>
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 8 }}>Introduce un valor y el resto se calcula por regla de tres</div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                      <select id="zona-select" defaultValue="" style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '7px 8px', color: 'var(--text)', fontSize: 11, fontFamily: 'var(--mono)', outline: 'none' }}>
                        <option value="" disabled>Selecciona zona...</option>
                        {zonasConSup.map(z => {
                          const zi = ZONAS_NDVI.find(zn => zn.zona === z.zona)!
                          return <option key={z.zona} value={String(z.zona)}>Z{z.zona} · {zi.rango} · {z.sup_ha_real.toFixed(3)}ha</option>
                        })}
                      </select>
                      <input id="kg-input" type="number" min="0" placeholder="kg/ha" style={{ width: 90, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '7px 8px', color: 'var(--text)', fontSize: 11, fontFamily: 'var(--mono)', outline: 'none' }}/>
                      <button onClick={() => {
                        const sel = (document.getElementById('zona-select') as HTMLSelectElement)?.value
                        const kg  = (document.getElementById('kg-input') as HTMLInputElement)?.value
                        if (sel && kg && Number(kg) > 0) setKgPorHa({ [sel]: kg })
                      }} style={{ padding: '7px 10px', borderRadius: 5, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✓</button>
                    </div>
                    {Object.keys(kgHaCalculado).length > 0 && (
                      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 6, letterSpacing: '0.06em' }}>VALORES CALCULADOS:</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                          {zonasConSup.map(z => {
                            const zi = ZONAS_NDVI.find(zn => zn.zona === z.zona)!
                            const val = kgHaCalculado[String(z.zona)]
                            const esRef = kgPorHa[String(z.zona)] !== undefined && kgPorHa[String(z.zona)] !== ''
                            if (!val) return null
                            return (
                              <div key={z.zona} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 6, height: 6, borderRadius: 1, background: zi.color, flexShrink: 0 }}/>
                                <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: esRef ? 'var(--green)' : 'var(--muted)' }}>
                                  Z{z.zona}: <span style={{ color: esRef ? 'var(--green)' : 'var(--text)', fontWeight: esRef ? 700 : 400 }}>{val}</span>
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        <button onClick={() => setKgPorHa({})} style={{ marginTop: 6, fontSize: 9, color: '#fca5a5', fontFamily: 'var(--mono)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Borrar valores</button>
                      </div>
                    )}
                    <button onClick={() => calcularProduccion(kgHaCalculado)} disabled={Object.keys(kgHaCalculado).length === 0} style={{ width: '100%', padding: '10px', borderRadius: 8, background: Object.keys(kgHaCalculado).length > 0 ? 'var(--green)' : 'var(--surface2)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, cursor: Object.keys(kgHaCalculado).length > 0 ? 'pointer' : 'not-allowed', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      🌾 CALCULAR PRODUCCIÓN
                    </button>
                  </section>
                </>
              )}

              {/* Resultado producción */}
              {produccion && (
                <>
                  <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
                  <section>
                    <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em', marginBottom: 10 }}>ESTIMACIÓN DE COSECHA</div>
                    {produccion.zonas.filter((z: any) => z.kg_por_ha > 0).map((z: any) => (
                      <div key={z.zona} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 10, fontFamily: 'var(--mono)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 7, height: 7, borderRadius: 2, background: z.color_hex }}/>
                          <span style={{ color: 'var(--muted)' }}>Z{z.zona}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 9, opacity: 0.6 }}>{z.superficie_ha.toFixed(4)}ha · {Math.round(z.kg_por_ha)}kg/ha</span>
                        </div>
                        <span style={{ color: 'var(--text)', fontWeight: 700 }}>{Math.round(z.kg_estimados).toLocaleString()} kg</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 10, padding: '12px', borderRadius: 8, background: 'var(--green-dim)', border: '1px solid rgba(61,220,110,0.3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11, fontFamily: 'var(--mono)' }}>
                        <span style={{ color: 'var(--muted)' }}>Superficie analizada</span>
                        <span style={{ color: 'var(--text)' }}>{produccion.total_ha.toFixed(4)} ha</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11, fontFamily: 'var(--mono)' }}>
                        <span style={{ color: 'var(--muted)' }}>Total kilogramos</span>
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>{Math.round(produccion.total_kg).toLocaleString()} kg</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--mono)', marginBottom: 5 }}>
                        <span style={{ color: 'var(--muted)' }}>Rendimiento medio</span>
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>{produccion.total_ha > 0 ? Math.round(produccion.total_kg / produccion.total_ha).toLocaleString() : 0} kg/ha</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontFamily: 'var(--mono)', fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(61,220,110,0.2)' }}>
                        <span style={{ color: 'var(--muted)' }}>TOTAL TONELADAS</span>
                        <span style={{ color: 'var(--green)', fontSize: 18 }}>{produccion.total_toneladas.toFixed(3)} t</span>
                      </div>
                    </div>
                  </section>
                </>
              )}

              {/* Flujo de agua */}
              {parcGeojson && (
                <>
                  <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
                  <section>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <span style={{ fontSize: 16 }}>💧</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--blue)', letterSpacing: '0.08em', fontWeight: 700 }}>FLUJO DE AGUA</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 10, lineHeight: 1.6 }}>MDT del IGN · Algoritmo D8 · Cauces y acumulación</div>
                    <button onClick={calcularFlujo} disabled={calculandoFlujo} style={{ width: '100%', padding: '10px', borderRadius: 8, background: calculandoFlujo ? 'var(--surface2)' : 'rgba(77,184,255,0.15)', border: '1px solid var(--blue)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, cursor: calculandoFlujo ? 'wait' : 'pointer', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s' }}>
                      {calculandoFlujo ? <><span className="spinner" style={{ borderTopColor: 'var(--blue)' }}/> CALCULANDO MDT...</> : '💧 ANALIZAR FLUJO DE AGUA'}
                    </button>
                    {flujoStats && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                          {[{ color: '#0050c8', label: 'Cauces (alta acumulación)' }, { color: '#64b4dc', label: 'Acumulación media' }, { color: '#c85040', label: 'Pendiente alta >15°' }].map(l => (
                            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }}/>
                              <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{l.label}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                          {[{ k: 'Alt. mín', v: `${flujoStats.altitud_min}m` }, { k: 'Alt. máx', v: `${flujoStats.altitud_max}m` }, { k: 'Alt. media', v: `${flujoStats.altitud_media}m` }, { k: 'Pend. media', v: `${flujoStats.pendiente_media}°` }].map(s => (
                            <div key={s.k} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px' }}>
                              <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.k}</div>
                              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--blue)', marginTop: 2 }}>{s.v}</div>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => { setMostrarFlujo(f => !f); if (!mostrarFlujo && flujoUrl) { setImagenUrl(flujoUrl); setModoVista('zonas') } else { setImagenUrl(null); setModoVista('ninguna') } }} style={{ width: '100%', marginTop: 8, padding: '8px', borderRadius: 6, background: mostrarFlujo ? 'rgba(77,184,255,0.15)' : 'var(--surface2)', border: `1px solid ${mostrarFlujo ? 'var(--blue)' : 'var(--border)'}`, color: mostrarFlujo ? 'var(--blue)' : 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>
                          {mostrarFlujo ? '🗺 OCULTAR MAPA DE FLUJO' : '🗺 VER MAPA DE FLUJO'}
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}

              {/* Histórico */}
              <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
              <section>
                <button onClick={() => setMostrarHistorico(h => !h)} style={{ width: '100%', padding: '8px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', letterSpacing: '0.06em' }}>
                  <span>📋 HISTÓRICO ({historico.length})</span>
                  <span>{mostrarHistorico ? '▲' : '▼'}</span>
                </button>
                {mostrarHistorico && (
                  <div style={{ marginTop: 8 }}>
                    {historico.length === 0
                      ? <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', textAlign: 'center', padding: '12px 0' }}>Sin análisis guardados</div>
                      : <>
                        <button onClick={async () => { if (confirm('¿Borrar todo el histórico?')) { setHistorico([]); if (session) { try { await supabase.from('historico').delete().eq('user_id', session.user.id) } catch (e) { console.error(e) } } } }} style={{ fontSize: 9, color: '#fca5a5', fontFamily: 'var(--mono)', background: 'transparent', border: 'none', cursor: 'pointer', marginBottom: 8, textDecoration: 'underline' }}>Borrar histórico</button>
                        {historico.map((entrada: any) => (
                          <div key={entrada.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)', fontWeight: 700 }}>{entrada.fecha}</span>
                              <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{entrada.fecha_guardado}</span>
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 6 }}>{entrada.parcela} · {entrada.sup_ha} ha</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                              {entrada.zonas?.map((z: any) => {
                                const zi = ZONAS_NDVI.find(zn => zn.zona === z.zona)!
                                return <div key={z.zona} title={`Z${z.zona}: ${z.sup_ha_real}ha (${z.pct}%)`} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)' }}><div style={{ width: 7, height: 7, borderRadius: 1, background: zi?.color || '#888' }}/><span>{z.pct}%</span></div>
                              })}
                            </div>
                            {entrada.geojson && (
                              <button onClick={async () => {
                                setParcGeojson(entrada.geojson); setParcelaInfo(entrada.parcelaInfo || {})
                                setParcelaSupHa(entrada.sup_ha_num || parseFloat(entrada.sup_ha))
                                setEstado('calculando_zonas'); setError(''); setZonasData([]); setProduccion(null); setKgPorHa({}); setMostrarHistorico(false)
                                try {
                                  const geom = entrada.geojson.features[0].geometry
                                  const allCoords: number[][] = []
                                  if (geom.type === 'Polygon') allCoords.push(...geom.coordinates[0])
                                  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((p: any) => allCoords.push(...p[0]))
                                  const lons = allCoords.map((c: number[]) => c[0]); const lats = allCoords.map((c: number[]) => c[1])
                                  const pad = 0.00005
                                  const bbox = `${Math.min(...lons)-pad},${Math.min(...lats)-pad},${Math.max(...lons)+pad},${Math.max(...lats)+pad}`
                                  const gp = encodeURIComponent(JSON.stringify(entrada.geojson))
                                  const r = await fetch(`${BACKEND}/ndvi/zonas?bbox=${bbox}&fecha=${entrada.fecha}&geojson=${gp}`)
                                  if (!r.ok) throw new Error(`Error ${r.status}`)
                                  const data = await r.json(); setZonasData(data.zonas)
                                  const ir = await fetch(`${BACKEND}${data.imagen_url}`); const blob = await ir.blob()
                                  setImagenUrl(URL.createObjectURL(blob)); setModoVista('zonas'); setEstado('done')
                                } catch (e: any) { setEstado('error'); setError('Error recargando: ' + e.message) }
                              }} style={{ width: '100%', padding: '5px', borderRadius: 5, background: 'rgba(61,220,110,0.08)', border: '1px solid rgba(61,220,110,0.2)', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer', letterSpacing: '0.04em' }}>
                                ▶ CARGAR ANÁLISIS
                              </button>
                            )}
                          </div>
                        ))}
                      </>
                    }
                  </div>
                )}
              </section>

              {error && <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)', color: '#fca5a5', fontSize: 11, fontFamily: 'var(--mono)' }}>⚠ {error}</div>}

              <div style={{ paddingTop: 4, fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', lineHeight: 1.7 }}>
                SIGPAC WMS · Copernicus DS<br />NDVI · MDT · Estimación cosecha<br />100% FREE & OPEN DATA
              </div>
            </aside>

            {/* Área mapa */}
            <div style={{ flex: 1, position: 'relative' }}>
              <MapView
                onParcelaClick={handleMapClick}
                onParcelasDibujadas={handleParcelasDibujadas}
                parcGeojson={parcGeojson}
                imagenUrl={parcelaVistaEnMapa ? null : imagenUrl}
                indiceColor={parcelaVistaEnMapa ? 'transparent' : modoVista === 'rgb' ? '#fbbf24' : '#3ddc6e'}
                parcelaVistaColor={parcelaVistaEnMapa ? '#888888' : undefined}
                seleccionando={seleccionando}
                mododibujo={mododibujo}
                onMododibujoCambiado={setMododibujo}
              />
              <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, fontFamily: 'var(--mono)', fontSize: 11, background: 'rgba(15,26,18,0.92)', border: '1px solid var(--border)', backdropFilter: 'blur(8px)', borderRadius: 6, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                {parcelaVistaEnMapa && <span style={{ color: '#888' }}>📁 PARCELA GUARDADA</span>}
                {!parcelaVistaEnMapa && modoVista === 'ninguna' && <span style={{ color: 'var(--muted)' }}>SIN OVERLAY</span>}
                {!parcelaVistaEnMapa && modoVista === 'rgb' && <span style={{ color: 'var(--amber)' }}>🛰 COLOR NATURAL</span>}
                {!parcelaVistaEnMapa && modoVista === 'zonas' && <span style={{ color: 'var(--green)', fontWeight: 700 }}>🌿 MAPA NDVI</span>}
              </div>
              {estado === 'idle' && !seleccionando && !parcelaVistaEnMapa && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none', zIndex: 500 }}>
                  <div style={{ fontSize: 56, marginBottom: 14, opacity: 0.2 }}>🌾</div>
                  <p style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: '0.08em', lineHeight: 1.8 }}>PULSA "CLIC EN EL MAPA"<br />Y SELECCIONA UNA PARCELA</p>
                </div>
              )}
              {seleccionando && (
                <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, pointerEvents: 'none', background: 'rgba(77,184,255,0.1)', border: '1px solid var(--blue)', backdropFilter: 'blur(8px)', borderRadius: 8, padding: '10px 20px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--blue)', letterSpacing: '0.06em' }}>
                  👆 HAZ CLIC SOBRE UNA PARCELA EN EL MAPA
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════ PESTAÑA MIS PARCELAS ════════════════ */}
        {pestana === 'mis_parcelas' && (
          <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>

            {/* Formulario guardar/editar */}
            {formularioVisible && (
              <div style={{ width: 480, height: '100%', background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.06em' }}>
                    {parcelaEditar ? '✏ EDITAR PARCELA' : '💾 GUARDAR PARCELA'}
                  </div>
                </div>

                <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Preview imagen */}
                  <div style={{ width: '100%', height: 200, borderRadius: 8, overflow: 'hidden', background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {imagenPreviewForm
                      ? <img src={imagenPreviewForm} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Preview parcela" onError={e => { (e.target as HTMLImageElement).style.display='none' }}/>
                      : <div style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10 }}>
                          <div style={{ fontSize: 32, marginBottom: 8 }}>🌾</div>
                          Sin imagen disponible
                        </div>
                    }
                  </div>

                  {/* Info parcela */}
                  {parcelaInfo && (
                    <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--green-dim)', border: '1px solid rgba(61,220,110,0.2)', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                      {parcelaInfo.origen === 'dibujado_mano'
                        ? '✏ Parcela dibujada a mano'
                        : `Mun: ${parcelaInfo.municipio} · Pol: ${parcelaInfo.poligono} · Par: ${parcelaInfo.parcela}`}
                      {parcelaSupHa > 0 && ` · ${parcelaSupHa.toFixed(4)} ha`}
                    </div>
                  )}

                  {/* Formulario */}
                  {[
                    { label: 'Nombre de la parcela', key: 'nombre', value: formNombre, set: setFormNombre, obligatorio: false, placeholder: 'Ej: Finca El Olivar' },
                    { label: 'Cultivo', key: 'cultivo', value: formCultivo, set: setFormCultivo, obligatorio: true, placeholder: 'Ej: Trigo, Olivo, Viñedo...' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {f.label} {f.obligatorio && <span style={{ color: '#ff6b6b' }}>*</span>}
                      </label>
                      <input
                        type="text"
                        value={f.value}
                        onChange={e => f.set(e.target.value)}
                        placeholder={f.placeholder}
                        style={{ width: '100%', background: 'var(--surface2)', border: `1px solid ${f.obligatorio && !f.value.trim() && formError ? '#ff6b6b' : 'var(--border)'}`, borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}
                      />
                    </div>
                  ))}

                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Fecha de plantación</label>
                    <input type="date" value={formFechaPlantacion} onChange={e => setFormFechaPlantacion(e.target.value)} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}/>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Información adicional</label>
                    <textarea value={formInfoAdicional} onChange={e => setFormInfoAdicional(e.target.value)} placeholder="Notas, observaciones, variedad..." rows={3} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none', resize: 'vertical' }}/>
                  </div>

                  {formError && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)', color: '#fca5a5', fontSize: 12, fontFamily: 'var(--mono)' }}>⚠ {formError}</div>}
                </div>

                {/* Botones */}
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                  <button onClick={guardarParcela} style={{ flex: 1, padding: '12px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, cursor: 'pointer', letterSpacing: '0.06em' }}>
                    💾 GUARDAR
                  </button>
                  <button onClick={cancelarFormulario} style={{ flex: 1, padding: '12px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                    CANCELAR
                  </button>
                </div>
              </div>
            )}

            {/* Lista de parcelas guardadas */}
            <div style={{ flex: 1, height: '100%', overflow: 'auto', padding: 24, background: 'var(--bg)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>📁 Mis Parcelas</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{misParcelas.length} parcela{misParcelas.length !== 1 ? 's' : ''} guardada{misParcelas.length !== 1 ? 's' : ''}</div>
                </div>
              </div>

              {/* Resumen total parcelas */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 20px', flex: 1 }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Total parcelas</div>
                  <div style={{ fontSize: 24, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)' }}>{misParcelas.length}</div>
                </div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 20px', flex: 1 }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Superficie total</div>
                  <div style={{ fontSize: 24, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--blue)' }}>{misParcelas.reduce((a, p) => a + p.supHa, 0).toFixed(2)} ha</div>
                </div>
              </div>

              {/* Detalle parcela */}
              {parcelaDetalle && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button onClick={() => setParcelaDetalleId(null)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}>←</button>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{parcelaDetalle.nombre || parcelaDetalle.cultivo}</span>
                    </div>
                    <button onClick={() => abrirFormTrat(parcelaDetalle.id)} style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ AÑADIR TRATAMIENTO</button>
                  </div>
                  <div style={{ padding: 16 }}>
                    {/* Info parcela */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 8, marginBottom: 16 }}>
                      {[
                        { k: 'Cultivo', v: parcelaDetalle.cultivo },
                        { k: 'Superficie', v: `${parcelaDetalle.supHa.toFixed(4)} ha` },
                        { k: 'Plantación', v: parcelaDetalle.fechaPlantacion || '—' },
                        { k: 'Tratamientos', v: String(tratamientosDeParcela(parcelaDetalle.id).length) },
                      ].map(s => (
                        <div key={s.k} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
                          <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.k}</div>
                          <div style={{ fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                    {/* Historial tratamientos */}
                    <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.06em', marginBottom: 10, fontWeight: 700 }}>HISTORIAL DE TRATAMIENTOS</div>
                    {tratamientosDeParcela(parcelaDetalle.id).length === 0
                      ? <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', padding: '16px 0', textAlign: 'center' }}>Sin tratamientos registrados</div>
                      : tratamientosDeParcela(parcelaDetalle.id).map(t => (
                        <div key={t.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '10px 12px', marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)' }}>{t.fecha}</span>
                                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--blue)', background: 'rgba(77,184,255,0.1)', border: '1px solid rgba(77,184,255,0.2)', borderRadius: 4, padding: '1px 6px' }}>{t.tipo}</span>
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, marginBottom: 2 }}>{t.producto}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                                {t.dosis} {t.unidadDosis}
                                {t.aplicador && ` · ${t.aplicador}`}
                              </div>
                              {t.observaciones && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>{t.observaciones}</div>}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                              <button onClick={() => abrirFormTrat(parcelaDetalle.id, t)} style={{ padding: '4px 8px', borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer' }}>✏</button>
                              <button onClick={() => eliminarTratamiento(t.id)} style={{ padding: '4px 8px', borderRadius: 4, background: 'transparent', border: '1px solid rgba(255,107,107,0.3)', color: '#fca5a5', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer' }}>✕</button>
                            </div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}

              {misParcelas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📁</div>
                  <div style={{ fontSize: 13, letterSpacing: '0.06em', marginBottom: 8 }}>SIN PARCELAS GUARDADAS</div>
                  <div style={{ fontSize: 10, lineHeight: 1.6 }}>Selecciona una parcela en el mapa<br />y pulsa "💾 GUARDAR" para añadirla aquí</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                  {misParcelas.map(p => (
                    <div
                      key={p.id}
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.2s' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#2a4a30')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                      onClick={() => setParcelaDetalleId(p.id)}
                    >
                      {/* Imagen */}
                      <div style={{ height: 140, background: 'var(--surface2)', position: 'relative', overflow: 'hidden' }}>
                        {p.imagenPreview
                          ? <img src={p.imagenPreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={p.nombre || p.cultivo}/>
                          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 10 }}>
                              <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, marginBottom: 4 }}>🌾</div>Sin imagen</div>
                            </div>
                        }
                        {/* Botón ver en mapa */}
                        <button
                          onClick={e => { e.stopPropagation(); verEnMapa(p) }}
                          title="Ver en el mapa"
                          style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: '50%', background: 'rgba(15,26,18,0.85)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, backdropFilter: 'blur(4px)', transition: 'background 0.2s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(61,220,110,0.2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(15,26,18,0.85)')}
                        >
                          👁
                        </button>
                      </div>

                      {/* Info */}
                      <div style={{ padding: '12px 14px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 4, letterSpacing: '0.04em' }}>
                          {p.cultivo.toUpperCase()}
                        </div>
                        {p.nombre && <div style={{ fontSize: 11, color: 'var(--text)', marginBottom: 4 }}>{p.nombre}</div>}
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', lineHeight: 1.6 }}>
                          {p.supHa > 0 && <div>{p.supHa.toFixed(4)} ha</div>}
                          {p.fechaPlantacion && <div>Plantación: {p.fechaPlantacion}</div>}
                          <div style={{ marginTop: 4, opacity: 0.6 }}>Guardada: {p.fechaGuardado}</div>
                        </div>
                      </div>

                      {/* Footer tarjeta */}
                      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button onClick={e => { e.stopPropagation(); abrirEditar(p) }} style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>✏ Editar info</button>
                        <button onClick={e => { e.stopPropagation(); eliminarParcela(p.id) }} style={{ fontSize: 9, color: '#fca5a5', fontFamily: 'var(--mono)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Eliminar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

        {/* ════════════════ PESTAÑA TRATAMIENTOS ════════════════ */}
        {pestana === 'tratamientos' && (
          <div style={{ flex: 1, height: '100%', overflow: 'auto', padding: 24, background: 'var(--bg)' }}>

            {/* Panel resumen */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 12, marginBottom: 24 }}>
              {[
                { k: 'Total tratamientos', v: String(tratamientos.length), color: 'var(--green)' },
                { k: 'Ha tratadas', v: totalHaTratadas().toFixed(2), color: 'var(--blue)' },
                { k: 'Parcelas tratadas', v: String(Array.from(new Set(tratamientos.flatMap(t => t.parcelaIds))).length), color: 'var(--amber)' },
                { k: 'Último tratamiento', v: tratamientos.length > 0 ? [...tratamientos].sort((a,b) => b.fecha.localeCompare(a.fecha))[0].fecha : '—', color: 'var(--muted)' },
              ].map(s => (
                <div key={s.k} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{s.k}</div>
                  <div style={{ fontSize: 20, fontFamily: 'var(--mono)', fontWeight: 700, color: s.color }}>{s.v}</div>
                </div>
              ))}
            </div>

            {/* Cabecera + botón nuevo */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>🧪 Tratamientos</div>
              <button onClick={() => abrirFormTrat()} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, cursor: 'pointer', letterSpacing: '0.06em' }}>+ NUEVO TRATAMIENTO</button>
            </div>

            {/* Navegación subpestañas */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
              {(['realizados', 'estadistica', 'stock'] as const).map(st => (
                <button
                  key={st}
                  onClick={() => setSubTabTrat(st)}
                  style={{
                    padding: '8px 16px', border: 'none', background: 'transparent',
                    fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    color: subTabTrat === st ? 'var(--green)' : 'var(--muted)',
                    borderBottom: `2px solid ${subTabTrat === st ? 'var(--green)' : 'transparent'}`,
                    letterSpacing: '0.06em', marginBottom: -1,
                  }}
                >
                  {st === 'realizados' ? '📋 REALIZADOS' : st === 'estadistica' ? '📊 ESTADÍSTICA' : '📦 STOCK'}
                </button>
              ))}
            </div>

            {/* ── SUBPESTAÑA REALIZADOS ── */}
            {subTabTrat === 'realizados' && (
              <>
            {/* Filtros */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: filtroTipo ? 'var(--text)' : 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)', outline: 'none' }}>
                <option value="">Todos los tipos</option>
                {TIPOS_TRATAMIENTO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="text" placeholder="Filtrar por producto..." value={filtroProducto} onChange={e => setFiltroProducto(e.target.value)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 11, fontFamily: 'var(--mono)', outline: 'none', minWidth: 160 }}/>
              <select value={filtroParcela} onChange={e => setFiltroParcela(e.target.value)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: filtroParcela ? 'var(--text)' : 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)', outline: 'none' }}>
                <option value="">Todas las parcelas</option>
                {misParcelas.map(p => <option key={p.id} value={p.id}>{p.nombre || p.cultivo}</option>)}
              </select>
              {(filtroTipo || filtroProducto || filtroParcela) && (
                <button onClick={() => { setFiltroTipo(''); setFiltroProducto(''); setFiltroParcela('') }} style={{ padding: '6px 12px', borderRadius: 6, background: 'transparent', border: '1px solid rgba(255,107,107,0.3)', color: '#fca5a5', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }}>✕ Limpiar</button>
              )}
            </div>

            {/* Lista tratamientos */}
            {tratamientosFiltrados.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🧪</div>
                <div style={{ fontSize: 13, letterSpacing: '0.06em' }}>SIN TRATAMIENTOS REGISTRADOS</div>
                <div style={{ fontSize: 10, marginTop: 8, lineHeight: 1.6 }}>Pulsa "+ NUEVO TRATAMIENTO" o añade uno desde una parcela</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tratamientosFiltrados.map(t => {
                  const parcelasAfectadas = misParcelas.filter(p => t.parcelaIds.includes(p.id))
                  const supTotal = parcelasAfectadas.reduce((a, p) => a + p.supHa, 0)
                  const expandido = tratExpandido === t.id
                  return (
                    <div key={t.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {/* Fila principal */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }} onClick={() => setTratExpandido(expandido ? null : t.id)}>
                        <span style={{ fontSize: 16 }}>{expandido ? '▼' : '▶'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)' }}>{t.fecha}</span>
                            <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--blue)', background: 'rgba(77,184,255,0.1)', border: '1px solid rgba(77,184,255,0.2)', borderRadius: 4, padding: '1px 7px' }}>{t.tipo}</span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{t.producto}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                            {t.dosis} {t.unidadDosis} · {t.parcelaIds.length} parcela{t.parcelaIds.length !== 1 ? 's' : ''} · {supTotal.toFixed(2)} ha
                            {t.aplicador && ` · ${t.aplicador}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={e => { e.stopPropagation(); abrirFormTrat(undefined, t) }} style={{ padding: '5px 10px', borderRadius: 5, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }}>✏</button>
                          <button onClick={e => { e.stopPropagation(); eliminarTratamiento(t.id) }} style={{ padding: '5px 10px', borderRadius: 5, background: 'transparent', border: '1px solid rgba(255,107,107,0.3)', color: '#fca5a5', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }}>✕</button>
                        </div>
                      </div>

                      {/* Detalle expandido */}
                      {expandido && (
                        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'var(--surface2)' }}>
                          {/* Tabla parcelas */}
                          <div style={{ marginBottom: t.observaciones ? 12 : 0 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, marginBottom: 6 }}>
                              {['Parcela','Sup. (ha)','% total','Dosis'].map(h => (
                                <div key={h} style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                              ))}
                            </div>
                            {parcelasAfectadas.map(p => {
                              const pct = supTotal > 0 ? ((p.supHa / supTotal) * 100).toFixed(1) : '0'
                              return (
                                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                                  <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{p.nombre || p.cultivo}</div>
                                  <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', textAlign: 'right' }}>{p.supHa.toFixed(4)}</div>
                                  <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', textAlign: 'right' }}>{pct}%</div>
                                  <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--blue)', textAlign: 'right' }}>{t.dosis} {t.unidadDosis}</div>
                                </div>
                              )
                            })}
                            {/* Total */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, padding: '6px 0', marginTop: 2 }}>
                              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', fontWeight: 700 }}>TOTAL</div>
                              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 700, textAlign: 'right' }}>{supTotal.toFixed(4)}</div>
                              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', textAlign: 'right' }}>100%</div>
                              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--blue)', textAlign: 'right' }}>{(Number(t.dosis) * supTotal).toFixed(2)} {t.unidadDosis.replace('/ha','')}</div>
                            </div>
                          </div>
                          {t.observaciones && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', marginTop: 8 }}>📝 {t.observaciones}</div>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
              </>
            )}

            {/* ── SUBPESTAÑA ESTADÍSTICA ── */}
            {subTabTrat === 'estadistica' && (
              <div>
                {Object.keys(estadisticasPorCultivo()).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📊</div>
                    <div style={{ fontSize: 13, letterSpacing: '0.06em' }}>SIN DATOS ESTADÍSTICOS</div>
                    <div style={{ fontSize: 10, marginTop: 8, lineHeight: 1.6 }}>Registra tratamientos en parcelas para ver el análisis de uso</div>
                  </div>
                ) : (
                  Object.entries(estadisticasPorCultivo()).map(([cultivo, productos]) => (
                    <div key={cultivo} style={{ marginBottom: 28 }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.06em', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                        🌾 {cultivo.toUpperCase()}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 16 }}>
                        {productos.map(p => {
                          const key = `${cultivo}-${p.producto}`
                          const expandido = statExpandido === key
                          const tieneMax = p.aplicMaxima !== null && p.aplicMaxima > 0
                          const tieneDosisMax = p.dosisMaxima !== null && p.dosisMaxima > 0

                          // Datos para el donut: dosis ponderada aplicada vs dosis máxima permitida
                          const usado = tieneDosisMax ? Math.min(p.dosisPonderada, p.dosisMaxima as number) : 0
                          const restante = tieneDosisMax ? Math.max((p.dosisMaxima as number) - p.dosisPonderada, 0) : 0
                          const excedido = tieneDosisMax && p.dosisPonderada > (p.dosisMaxima as number)

                          const pieData = tieneDosisMax
                            ? [
                                { name: 'Usado', value: usado },
                                { name: 'Restante', value: restante },
                              ]
                            : []

                          const colorUsado = excedido ? '#ff6b6b' : 'var(--green)'

                          return (
                            <div key={key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                              <div
                                onClick={() => setStatExpandido(expandido ? null : key)}
                                style={{ padding: '14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                              >
                                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', textAlign: 'center', marginBottom: 8, minHeight: 28, display: 'flex', alignItems: 'center' }}>
                                  {p.producto}
                                </div>

                                {tieneDosisMax ? (
                                  <div style={{ position: 'relative', width: 130, height: 130 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                      <PieChart>
                                        <Pie
                                          data={pieData}
                                          dataKey="value"
                                          innerRadius={42}
                                          outerRadius={60}
                                          startAngle={90}
                                          endAngle={-270}
                                          stroke="none"
                                        >
                                          <Cell fill={excedido ? '#ff6b6b' : '#3ddc6e'} />
                                          <Cell fill="#2a3a30" />
                                        </Pie>
                                      </PieChart>
                                    </ResponsiveContainer>
                                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                      <div style={{ fontSize: 16, fontFamily: 'var(--mono)', fontWeight: 700, color: excedido ? '#ff6b6b' : 'var(--text)' }}>
                                        {p.dosisPonderada.toFixed(2)}/{p.dosisMaxima}
                                      </div>
                                      <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: '0.06em' }}>{p.unidad}</div>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 130 }}>
                                    <div style={{ fontSize: 22, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)' }}>
                                      {p.dosisPonderada.toFixed(2)}
                                    </div>
                                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 700, marginTop: 2 }}>
                                      {p.unidad}
                                    </div>
                                    <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: 6, letterSpacing: '0.06em' }}>DOSIS MEDIA PONDERADA</div>
                                  </div>
                                )}

                                {tieneMax && (
                                  <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
                                    Aplicaciones: <span style={{ color: p.numAplicaciones > (p.aplicMaxima as number) ? '#ff6b6b' : 'var(--text)', fontWeight: 700 }}>{p.numAplicaciones}</span> / {p.aplicMaxima}
                                  </div>
                                )}

                                <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: 6 }}>
                                  {expandido ? '▲ Ocultar detalle' : '▼ Ver detalle por parcela'}
                                </div>
                              </div>

                              {expandido && (
                                <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--surface2)' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, marginBottom: 4 }}>
                                    {['Parcela','Dosis','Sup.','Total'].map(h => (
                                      <div key={h} style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</div>
                                    ))}
                                  </div>
                                  {p.detalleParcelas.map((d, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 10 }}>
                                      <div style={{ color: 'var(--text)' }}>{d.nombre}</div>
                                      <div style={{ fontFamily: 'var(--mono)', color: 'var(--text)', textAlign: 'right' }}>{d.dosis}</div>
                                      <div style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', textAlign: 'right' }}>{d.supHa.toFixed(2)}ha</div>
                                      <div style={{ fontFamily: 'var(--mono)', color: 'var(--blue)', textAlign: 'right' }}>{d.total.toFixed(2)}</div>
                                    </div>
                                  ))}
                                  {tieneDosisMax && (
                                    <div style={{ marginTop: 6, fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                                      Restante hasta máx: <span style={{ color: p.dosisPonderada > (p.dosisMaxima as number) ? '#ff6b6b' : 'var(--green)', fontWeight: 700 }}>
                                        {Math.max((p.dosisMaxima as number) - p.dosisPonderada, 0).toFixed(2)} {p.unidad}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── SUBPESTAÑA STOCK ── */}
            {subTabTrat === 'stock' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                  <button onClick={() => setFormStock(true)} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, cursor: 'pointer', letterSpacing: '0.06em' }}>+ AÑADIR PRODUCTO</button>
                </div>

                {stock.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📦</div>
                    <div style={{ fontSize: 13, letterSpacing: '0.06em' }}>SIN PRODUCTOS EN STOCK</div>
                    <div style={{ fontSize: 10, marginTop: 8, lineHeight: 1.6 }}>Pulsa "+ AÑADIR PRODUCTO" para empezar a controlar tu inventario</div>
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    {/* Cabecera tabla */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8, padding: '10px 16px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                      {['Producto','Comprado','Usado','Existencias',''].map(h => (
                        <div key={h} style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: h === 'Producto' || h === '' ? 'left' : 'right' }}>{h}</div>
                      ))}
                    </div>
                    {stock.map(s => {
                      const comprado = Number(s.comprado) || 0
                      const usado = calcularUsoProducto(s.producto)
                      const existencias = comprado - usado
                      return (
                        <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{s.producto}</div>
                          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', textAlign: 'right' }}>{comprado.toFixed(2)} {s.unidad}</div>
                          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--blue)', textAlign: 'right' }}>{usado.toFixed(2)} {s.unidad}</div>
                          <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, textAlign: 'right', color: existencias < 0 ? '#ff6b6b' : 'var(--green)' }}>
                            {existencias.toFixed(2)} {s.unidad}
                          </div>
                          <button onClick={() => eliminarStockItem(s.id)} style={{ padding: '4px 8px', borderRadius: 4, background: 'transparent', border: '1px solid rgba(255,107,107,0.3)', color: '#fca5a5', fontFamily: 'var(--mono)', fontSize: 10, cursor: 'pointer', justifySelf: 'end' }}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Modal añadir stock */}
                {formStock && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 380, overflow: 'auto' }}>
                      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>📦 AÑADIR PRODUCTO A STOCK</span>
                        <button onClick={() => setFormStock(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
                      </div>
                      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Nombre del producto</label>
                          <input type="text" value={stockProducto} onChange={e => setStockProducto(e.target.value)} placeholder="Debe coincidir con el nombre usado en tratamientos" style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}/>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                          <div>
                            <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cantidad comprada</label>
                            <input type="number" min="0" step="0.01" value={stockCantidad} onChange={e => setStockCantidad(e.target.value)} placeholder="0.00" style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}/>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Unidad</label>
                            <select value={stockUnidad} onChange={e => setStockUnidad(e.target.value as 'L' | 'Kg')} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}>
                              <option value="L">L</option>
                              <option value="Kg">Kg</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                        <button onClick={guardarStockItem} style={{ flex: 1, padding: '11px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>💾 GUARDAR</button>
                        <button onClick={() => setFormStock(false)} style={{ flex: 1, padding: '11px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, cursor: 'pointer' }}>CANCELAR</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        )}


      {/* ── Modal formulario tratamiento ── */}
      {formTrat && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 480, maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{tratEditar ? '✏ EDITAR TRATAMIENTO' : '🧪 NUEVO TRATAMIENTO'}</span>
              <button onClick={() => setFormTrat(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tipo de tratamiento <span style={{ color: '#ff6b6b' }}>*</span></label>
                <select value={tTipo} onChange={e => setTTipo(e.target.value)} style={{ width: '100%', background: 'var(--surface2)', border: `1px solid ${!tTipo && tError ? '#ff6b6b' : 'var(--border)'}`, borderRadius: 6, padding: '9px 12px', color: tTipo ? 'var(--text)' : 'var(--muted)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}>
                  <option value="" disabled>Selecciona tipo...</option>
                  {TIPOS_TRATAMIENTO.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Producto utilizado <span style={{ color: '#ff6b6b' }}>*</span></label>
                <input type="text" value={tProducto} onChange={e => setTProducto(e.target.value)} placeholder="Nombre del producto..." style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}/>
              </div>
              {/* Materia activa + consulta MRL */}
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Materia activa <span style={{ color: '#ff6b6b' }}>*</span></label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="text" value={tMateriaActiva} onChange={e => { setTMateriaActiva(e.target.value); setMrlResultado(null) }} placeholder="Ej: glifosato, clorpirifos..." style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}/>
                  <button
                    onClick={() => {
                      const cultivo = tratParcelaCtx
                        ? misParcelas.find(p => p.id === tratParcelaCtx)?.cultivo || ''
                        : tParcelas.length > 0 ? misParcelas.find(p => p.id === tParcelas[0])?.cultivo || '' : ''
                      consultarMRL(tMateriaActiva, cultivo)
                    }}
                    disabled={!tMateriaActiva.trim() || consultandoMrl}
                    style={{ padding: '9px 12px', borderRadius: 6, background: 'rgba(77,184,255,0.15)', border: '1px solid var(--blue)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 11, cursor: tMateriaActiva.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', fontWeight: 700 }}
                  >
                    {consultandoMrl ? '...' : '🔍 MRL'}
                  </button>
                </div>
                <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 3 }}>
                  Se usará el cultivo de la parcela seleccionada para consultar el límite EU
                </div>
              </div>
              {/* Resultado MRL */}
              {mrlResultado && (
                <div style={{ padding: '10px 12px', borderRadius: 7, background: mrlResultado.encontrado ? 'rgba(61,220,110,0.06)' : 'rgba(251,191,36,0.06)', border: `1px solid ${mrlResultado.encontrado ? 'rgba(61,220,110,0.25)' : 'rgba(251,191,36,0.25)'}` }}>
                  {mrlResultado.encontrado ? (
                    <>
                      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 700, marginBottom: 4 }}>
                        ✓ MRL ENCONTRADO {mrlResultado.tipo === 'parcial' ? '(coincidencia parcial)' : ''}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>SUSTANCIA OFICIAL</div>
                          <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{mrlResultado.sustancia_oficial}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>CULTIVO OFICIAL</div>
                          <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{mrlResultado.cultivo_oficial}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>MRL MÁXIMO</div>
                          <div style={{ fontSize: 16, color: 'var(--green)', fontWeight: 700 }}>{mrlResultado.mrl} {mrlResultado.unidad}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>FUENTE</div>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', lineHeight: 1.4 }}>EU Reg. EC 396/2005</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--amber)', fontWeight: 700, marginBottom: 4 }}>⚠ {mrlResultado.motivo}</div>
                      {mrlResultado.sugerencias_cultivos && (
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 4 }}>Cultivos disponibles para esta sustancia:</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {mrlResultado.sugerencias_cultivos.slice(0,6).map((s: any, i: number) => (
                              <span key={i} style={{ fontSize: 9, fontFamily: 'var(--mono)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', color: 'var(--text)' }}>{s.cultivo}: {s.mrl} mg/kg</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Dosis <span style={{ color: '#ff6b6b' }}>*</span></label>
                  <input type="number" min="0" step="0.01" value={tDosis} onChange={e => setTDosis(e.target.value)} placeholder="0.00" style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}/>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Unidad</label>
                  <select value={tUnidad} onChange={e => setTUnidad(e.target.value as 'L/ha' | 'Kg/ha')} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}>
                    <option value="L/ha">L/ha</option>
                    <option value="Kg/ha">Kg/ha</option>
                  </select>
                </div>
              </div>
              {/* Dosis máxima y aplicaciones máximas (opcionales, para estadísticas) */}
              <div style={{ padding: '10px 12px', borderRadius: 7, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 8, letterSpacing: '0.06em' }}>
                  📊 PARA ESTADÍSTICAS (opcional)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5 }}>Dosis máx. permitida ({tUnidad})</label>
                    <input type="number" min="0" step="0.01" value={tDosisMaxima} onChange={e => setTDosisMaxima(e.target.value)} placeholder="Ej: 4.0" style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--sans)', outline: 'none' }}/>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5 }}>Nº máx. aplicaciones/campaña</label>
                    <input type="number" min="0" step="1" value={tAplicMaxima} onChange={e => setTAplicMaxima(e.target.value)} placeholder="Ej: 4" style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--sans)', outline: 'none' }}/>
                  </div>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Fecha del tratamiento <span style={{ color: '#ff6b6b' }}>*</span></label>
                <input type="date" value={tFecha} onChange={e => setTFecha(e.target.value)} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}/>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Aplicador / Responsable</label>
                <input type="text" value={tAplicador} onChange={e => setTAplicador(e.target.value)} placeholder="Nombre del aplicador..." style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}/>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Observaciones</label>
                <textarea value={tObs} onChange={e => setTObs(e.target.value)} rows={2} placeholder="Notas adicionales..." style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none', resize: 'vertical' }}/>
              </div>
              {!tratParcelaCtx && (
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Parcelas afectadas <span style={{ color: '#ff6b6b' }}>*</span></label>
                  {misParcelas.length === 0
                    ? <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', padding: '8px 0' }}>Sin parcelas guardadas. Ve a "Mis Parcelas" primero.</div>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 160, overflowY: 'auto' }}>
                        {misParcelas.map(p => (
                          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 8px', borderRadius: 5, background: tParcelas.includes(p.id) ? 'var(--green-dim)' : 'var(--surface2)', border: `1px solid ${tParcelas.includes(p.id) ? 'rgba(61,220,110,0.3)' : 'var(--border)'}`, transition: 'all 0.15s' }}>
                            <input type="checkbox" checked={tParcelas.includes(p.id)} onChange={e => setTParcelas(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))} style={{ accentColor: 'var(--green)' }}/>
                            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{p.nombre || p.cultivo}</span>
                            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{p.supHa.toFixed(2)} ha</span>
                          </label>
                        ))}
                      </div>
                  }
                  {tParcelas.length > 0 && (
                    <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 5, background: 'var(--surface2)', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--green)' }}>
                      {tParcelas.length} parcela{tParcelas.length > 1 ? 's' : ''} · {misParcelas.filter(p => tParcelas.includes(p.id)).reduce((a, p) => a + p.supHa, 0).toFixed(4)} ha total
                    </div>
                  )}
                </div>
              )}
              {tError && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)', color: '#fca5a5', fontSize: 12, fontFamily: 'var(--mono)' }}>⚠ {tError}</div>}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
              <button onClick={guardarTratamiento} style={{ flex: 1, padding: '11px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>💾 GUARDAR</button>
              <button onClick={() => setFormTrat(false)} style={{ flex: 1, padding: '11px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, cursor: 'pointer' }}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}