/** @jsx jsx */
/**
 * Lets the runtime user change the symbology of a chosen feature layer on the
 * map. It uses the same symbol picker the out of the box Draw widget uses as its
 * reference, SymbolSelector with JimuSymbolType from jimu-ui/advanced/map, and
 * applies the chosen symbol to the selected layer with a SimpleRenderer.
 *
 * Notes that matter:
 *  - The symbol the picker emits, and the one already on a layer's renderer, are
 *    symbol instances that serialize themselves. We pass them straight to the
 *    picker and never flatten them to plain JSON, because the picker calls
 *    toJSON() on whatever it receives.
 *  - Different builds of SymbolSelector emit the change through different prop
 *    names, so we wire all of them to one handler.
 *  - Setting a brand new renderer object (not mutating the old one) is what makes
 *    the FeatureLayer redraw on the map.
 */
import { React, jsx, css, loadArcGISJSAPIModules } from 'jimu-core'
import { Select, Option } from 'jimu-ui'
import { SymbolSelector, JimuSymbolType } from 'jimu-ui/advanced/map'

const { useState, useEffect, useCallback, useMemo, useRef } = React

interface Props {
  jimuMapView: any
  defaultLayer?: any
  translate: (id: string, values?: any) => string
  /** Called (debounced) after a symbol is applied, so the host can refresh the
   *  editor's create-feature templates, which do not watch renderer changes. */
  onApplied?: () => void
}

// Identify a layer by its service identity so two instances of the same service
// layer are treated as one. Falls back to id or title for non-service layers.
function layerKey (l: any): string {
  if (!l) return ''
  if (l.url) return `${l.url}/${l.layerId ?? ''}`
  return l.id || l.title || ''
}

// The picker may hand back the symbol directly, or wrapped in an object. Pull
// out the actual symbol we can feed to a renderer.
function resolveSymbol (arg: any): any {
  if (!arg) return null
  if (typeof arg.toJSON === 'function') return arg
  if (arg.symbol) return arg.symbol
  if (arg.jimuSymbol) return arg.jimuSymbol
  return arg
}

export default function SymbologyPanel (props: Props) {
  const { jimuMapView, defaultLayer, translate } = props
  const rendererCtorRef = useRef<any>(null)
  const onAppliedRef = useRef(props.onApplied)
  const appliedTimerRef = useRef<any>(null)
  useEffect(() => { onAppliedRef.current = props.onApplied })
  useEffect(() => () => { if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current) }, [])

  // Feature layers currently on the map, de-duplicated by service identity so a
  // layer never appears twice. The on-map instance is preferred; the default
  // target is only added if its service layer is not already listed.
  const layers = useMemo(() => {
    const coll = jimuMapView?.view?.map?.allLayers || jimuMapView?.view?.map?.layers
    const seen = new Set<string>()
    const out: any[] = []
    if (coll?.toArray) {
      coll.toArray().forEach((l: any) => {
        if (l?.type !== 'feature') return
        const k = layerKey(l)
        if (seen.has(k)) return
        seen.add(k); out.push(l)
      })
    }
    if (defaultLayer && !seen.has(layerKey(defaultLayer))) out.push(defaultLayer)
    return out
  }, [jimuMapView, defaultLayer])

  // The list item that matches the default target (by service identity), so the
  // initial selection always points at an item actually shown in the dropdown.
  const defaultId = useMemo(() => {
    if (!layers.length) return ''
    if (defaultLayer) {
      const match = layers.find(l => layerKey(l) === layerKey(defaultLayer))
      if (match) return match.id
    }
    return layers[0].id
  }, [layers, defaultLayer])

  const [selectedLayerId, setSelectedLayerId] = useState<string>('')
  const selectedLayer = useMemo(() => {
    return layers.find(l => l.id === selectedLayerId) || layers.find(l => l.id === defaultId) || layers[0] || null
  }, [layers, selectedLayerId, defaultId])

  const [symbol, setSymbol] = useState<any>(null)

  useEffect(() => {
    if (!layers.length) return
    if (!selectedLayerId || !layers.some(l => l.id === selectedLayerId)) {
      setSelectedLayerId(defaultId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, defaultId])

  // seed the picker from the selected layer's current symbol (instance, not JSON)
  useEffect(() => {
    setSymbol(selectedLayer?.renderer?.symbol || null)
  }, [selectedLayer])

  const jimuSymbolType = selectedLayer?.geometryType === 'polygon'
    ? JimuSymbolType.Polygon
    : (selectedLayer?.geometryType === 'polyline' ? JimuSymbolType.Polyline : JimuSymbolType.Point)

  const applySymbol = useCallback(async (arg: any) => {
    // feed back exactly what the picker emitted (safe shape for the picker)
    setSymbol(arg)
    const sym = resolveSymbol(arg)
    if (!selectedLayer || !sym) return
    try {
      if (!rendererCtorRef.current) {
        const [SimpleRenderer] = await loadArcGISJSAPIModules(['esri/renderers/SimpleRenderer'])
        rendererCtorRef.current = SimpleRenderer
      }
      const SimpleRenderer = rendererCtorRef.current
      // assign a NEW renderer object so the layer redraws
      selectedLayer.renderer = new SimpleRenderer({ symbol: sym })
      // if a duplicate instance of the same service layer is on the map, keep it in sync
      const coll = jimuMapView?.view?.map?.allLayers
      coll?.toArray?.().forEach((l: any) => {
        if (l !== selectedLayer && l?.type === 'feature' && l.url && l.url === selectedLayer.url && l.layerId === selectedLayer.layerId) {
          l.renderer = new SimpleRenderer({ symbol: sym })
        }
      })
      // let the host refresh the editor's create-feature templates once the user
      // pauses (those templates do not react to renderer changes on their own)
      if (onAppliedRef.current) {
        if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current)
        appliedTimerRef.current = setTimeout(() => onAppliedRef.current?.(), 600)
      }
    } catch (e) { console.error('apply symbology failed', e) }
  }, [selectedLayer, jimuMapView])

  if (!layers.length) {
    return (
      <div css={style} className='symbology-panel'>
        <div className='sym-head'><span className='sym-label'>{translate('symbology')}</span></div>
        <div className='sym-hint'>{translate('symbologyNoLayers')}</div>
      </div>
    )
  }

  return (
    <div css={style} className='symbology-panel'>
      <div className='sym-head'>
        <span className='sym-label'>{translate('symbology')}</span>
        {layers.length > 1 && (
          <Select
            size='sm'
            className='sym-layer'
            aria-label={translate('symbologyLayer')}
            value={selectedLayer?.id || ''}
            onChange={(e) => setSelectedLayerId(e.target.value)}
          >
            {layers.map(l => <Option key={l.id} value={l.id}>{l.title || l.id}</Option>)}
          </Select>
        )}
      </div>
      <div className='sym-row'>
        <span className='sym-hint'>{translate('symbologyHint')}</span>
        <span className='sym-swatch'>
          <SymbolSelector
            jimuSymbolType={jimuSymbolType}
            symbol={symbol || undefined}
            onPointSymbolChanged={applySymbol}
            onPolylineSymbolChanged={applySymbol}
            onPolygonSymbolChanged={applySymbol}
          />
        </span>
      </div>
    </div>
  )
}

const style = css`
  padding: 10px 12px;
  border-bottom: 1px solid var(--sys-color-divider-secondary);
  background: var(--sys-color-surface-background);
  .sym-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  .sym-label { font-weight: 600; }
  .sym-layer { flex: 0 1 60%; min-width: 0; }
  .sym-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sym-hint { font-size: 0.75rem; color: var(--sys-color-surface-paper-hint); flex: 1; }
  .sym-swatch { display: inline-flex; align-items: center; justify-content: center; padding: 4px; background: var(--sys-color-surface-paper); border: 1px solid var(--sys-color-divider-secondary); border-radius: 4px; }
`

