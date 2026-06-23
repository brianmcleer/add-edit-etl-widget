/** @jsx jsx */
import {
  React, jsx, css, type AllWidgetProps, hooks, Immutable,
  DataSourceComponent, type DataSource, type FeatureLayerDataSource, type UseDataSource
} from 'jimu-core'
import { Button, Paper, defaultMessages as jimuUIMessages, Select, Option, Alert } from 'jimu-ui'
import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'

import defaultMessages from './translations/default'
import type { IMConfig } from '../config'
import { versionManager } from '../version-manager'

// --- vendored Add Data pieces ---
import { AddDataPopper, type SupportedTabs } from '../vendor/add-data/runtime/components/add-data-popper'
import { DataList } from '../vendor/add-data/runtime/components/data-list'
import { createDataSourcesByDataOptions, getDataSource } from '../vendor/add-data/runtime/utils'
import type { DataOptions } from '../vendor/add-data/runtime/types'
import { useItemCategoriesInfo } from '../vendor/add-data/utils'

// --- vendored Edit pieces (the real attribute-editing experience) ---
import { constructConfig } from '../vendor/edit/utils'
import { getPrivilege } from '../vendor/edit/runtime/components/utils'
import EditFeatureForm from '../vendor/edit/runtime/components/feature-form-component'
import EditorComponent from '../vendor/edit/runtime/components/editor-component'

// --- ETL ---
import MappingPanel from './components/mapping-panel'
import LoadPanel from './components/load-panel'
import SymbologyPanel from './components/symbology-panel'
import { readSourceSchema, readTargetSchema, editableTargetFields, autoMatch, emptyMappingConfig } from './etl/schema'
import type { FieldMappingConfig, Schema, SchemaField } from './etl/types'

const { useState, useMemo, useEffect, useRef, useCallback } = React

type Step = 'add' | 'map' | 'load' | 'edit'
const STEPS: Step[] = ['add', 'map', 'load', 'edit']
const stepIndex = (s: Step) => STEPS.indexOf(s)

const Widget = (props: AllWidgetProps<IMConfig>) => {
  const { id, portalUrl, config, useMapWidgetIds } = props
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)
  const rootRef = useRef<HTMLDivElement>(null)
  const mapWidgetId = useMapWidgetIds?.[0]

  const [step, setStep] = useState<Step>(config.startInEditMode ? 'edit' : 'add')
  const [multiDataOptions, setMultiDataOptions] = useState<DataOptions[]>([])
  const [sourceDsId, setSourceDsId] = useState<string>(null)
  const [sourceDs, setSourceDs] = useState<FeatureLayerDataSource>(null)
  const [targetDsMap, setTargetDsMap] = useState<Record<string, FeatureLayerDataSource>>({})
  const [selectedTargetId, setSelectedTargetId] = useState<string>('')
  const [targetLayer, setTargetLayer] = useState<any>(null)
  const [jimuMapView, setJimuMapView] = useState<JimuMapView>(null)
  const [mapping, setMapping] = useState<FieldMappingConfig>(() => config.defaultMapping?.asMutable?.({ deep: true }) || emptyMappingConfig())
  const [canEditFeature, setCanEditFeature] = useState(false)
  const [editorRefresh, setEditorRefresh] = useState(0)

  // ----- Add Data config for the vendored popper -----
  const addDataConfig = useMemo(() => Immutable({
    disableAddBySearch: config.disableAddBySearch,
    disableAddByUrl: config.disableAddByUrl,
    disableAddByFile: config.disableAddByFile,
    placeholderText: config.placeholderText,
    displayedItemTypeCategories: config.displayedItemTypeCategories
  }), [config])
  const itemCategoriesInfo = useItemCategoriesInfo(addDataConfig as any)
  const hiddenTabs = useMemo(() => {
    const t: SupportedTabs[] = []
    if (config.disableAddBySearch) t.push('search')
    if (config.disableAddByUrl) t.push('url')
    if (config.disableAddByFile) t.push('file')
    return t
  }, [config])
  const nextOrder = useMemo(() => multiDataOptions.length > 0 ? Math.max(...multiDataOptions.map(d => d.order)) + 1 : 0, [multiDataOptions])

  const onAddData = useCallback((added: DataOptions[]) => {
    createDataSourcesByDataOptions(added, id, addDataConfig as any).catch(e => console.error('create ds failed', e))
    setMultiDataOptions(prev => {
      const next = prev.concat(added)
      if (added[0]) setSourceDsId(added[0].dataSourceJson.id)
      return next
    })
  }, [id, addDataConfig])

  const onRemoveData = useCallback((dsId: string) => {
    setMultiDataOptions(prev => prev.filter(d => d.dataSourceJson.id !== dsId))
    if (sourceDsId === dsId) setSourceDsId(null)
  }, [sourceDsId])

  // resolve source ds when selection changes
  useEffect(() => {
    if (!sourceDsId) { setSourceDs(null); return }
    const ds = getDataSource(sourceDsId) as FeatureLayerDataSource
    setSourceDs(ds || null)
  }, [sourceDsId, multiDataOptions])

  useEffect(() => { getPrivilege().then(setCanEditFeature).catch(() => setCanEditFeature(false)) }, [])

  // ----- Targets: one or more configured layers; the user picks one to load into -----
  const configuredTargets = useMemo(() => {
    if (config.targetUseDataSources && config.targetUseDataSources.length) return config.targetUseDataSources
    return config.targetUseDataSource ? Immutable([config.targetUseDataSource]) : Immutable([])
  }, [config])

  const targetDs = selectedTargetId ? (targetDsMap[selectedTargetId] || null) : null

  // default the selection to the first configured target, and recover if the
  // current selection is no longer configured (author changed the settings)
  useEffect(() => {
    const ids = configuredTargets.map(t => t.dataSourceId)
    if ((!selectedTargetId || !ids.includes(selectedTargetId)) && ids.length) {
      setSelectedTargetId(ids[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configuredTargets])

  const onTargetCreated = useCallback((dsId: string, ds: DataSource) => {
    setTargetDsMap(prev => ({ ...prev, [dsId]: ds as FeatureLayerDataSource }))
  }, [])

  const targetLabel = useCallback((dsId: string) => {
    return targetDsMap[dsId]?.getLabel?.() || dsId
  }, [targetDsMap])

  // changing the target changes the target schema, so clear the rules; the
  // auto-match effect re-seeds them against the newly selected target
  const onSelectTarget = useCallback((dsId: string) => {
    if (dsId === selectedTargetId) return
    setSelectedTargetId(dsId)
    setMapping(m => ({ ...m, rules: [] }))
  }, [selectedTargetId])

  // Resolve the actual JSAPI FeatureLayer from the target data source (async).
  // A data source that is only configured (not added to a map view) has no
  // synchronous `.layer`, so we materialize it the way the Edit widget does.
  useEffect(() => {
    let cancelled = false
    if (!targetDs) { setTargetLayer(null); return }
    ;(async () => {
      let layer: any
      try { layer = await (targetDs as any).createJSAPILayerByDataSource?.() } catch (e) { layer = undefined }
      if (!layer) layer = (targetDs as any).layer
      try { await layer?.load?.() } catch (e) { /* surfaced later */ }
      if (!cancelled) setTargetLayer(layer || null)
    })()
    return () => { cancelled = true }
  }, [targetDs])

  // schemas
  const sourceSchema: Schema | null = useMemo(() => sourceDs ? readSourceSchema(sourceDs) : null, [sourceDs])
  const targetSchema: Schema | null = useMemo(() => targetDs ? readTargetSchema(targetDs) : null, [targetDs])
  const targetFields: SchemaField[] = useMemo(() => {
    if (!targetDs || !targetSchema) return []
    return editableTargetFields(targetSchema, (targetDs as any).getLayerDefinition?.())
  }, [targetDs, targetSchema])

  // seed an auto-match the first time both schemas are known and no rules exist
  useEffect(() => {
    if (sourceSchema && targetFields.length && mapping.rules.length === 0 && config.allowRuntimeMapping !== false) {
      setMapping(m => ({ ...m, rules: autoMatch(sourceSchema, targetFields) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSchema, targetFields])

  // ---- Map integration (optional; only when a Map widget is linked) ----
  const useGeometryEditor = !!mapWidgetId && config.enableGeometryEdit !== false
  const showOnMap = !!mapWidgetId && config.showOnMap !== false
  const allowSymbology = !!mapWidgetId && config.allowSymbology !== false

  const handleActiveViewChange = useCallback((view: JimuMapView) => {
    setJimuMapView(view && !view.isDestroyed?.() ? view : null)
  }, [])

  // Add the target layer to the linked map if it isn't already there, so it's
  // visible and the geometry editor can discover it. Needed for either feature.
  const needLayerOnMap = showOnMap || useGeometryEditor
  useEffect(() => {
    if (!needLayerOnMap || !jimuMapView || !targetLayer) return
    const map = jimuMapView.view?.map
    if (!map) return
    try {
      const already = map.allLayers?.some?.((l: any) => l === targetLayer || (l.url && targetLayer.url && l.url === targetLayer.url))
      if (!already) map.add(targetLayer)
    } catch (e) { console.error('add target layer to map failed', e) }
  }, [needLayerOnMap, jimuMapView, targetLayer])

  const zoomToObjectIds = useCallback(async (oids: Array<number | string>) => {
    if (!jimuMapView || !targetLayer || !oids?.length) return
    try {
      const q = targetLayer.createQuery()
      q.objectIds = oids as any
      q.returnGeometry = true
      const res = await targetLayer.queryExtent(q)
      if (!res?.extent) return
      const scale = config.zoomScale && config.zoomScale > 0 ? config.zoomScale : 0
      if (scale > 0) {
        // center on the features and apply the configured scale (a real zoom,
        // not just a pan — fixes degenerate point extents that don't change scale)
        await jimuMapView.view.goTo({ target: res.extent.center, scale })
      } else {
        await jimuMapView.view.goTo(res.extent.expand ? res.extent.expand(1.2) : res.extent)
      }
    } catch (e) { console.error('zoom to features failed', e) }
  }, [jimuMapView, targetLayer, config.zoomScale])

  const zoomToSelection = useCallback(() => {
    if (config.zoomToSelected === false || !showOnMap) return
    const ids = (targetDs as any)?.getSelectedRecordIds?.() || []
    if (ids.length) zoomToObjectIds(ids)
  }, [config.zoomToSelected, showOnMap, targetDs, zoomToObjectIds])

  // Edit config built from the resolved target layer. Attribute mode works
  // without a map; geometry mode uses the linked map (edits all editable
  // layers, the OOTB "edit all" behaviour, since mapViewsConfig is empty).
  const editInfo = useMemo(() => {
    if (!targetDs || !targetLayer) return null
    const base = constructConfig(targetDs as any, targetLayer)
    // apply author permission choices on top of the layer's own capabilities
    const allowUpdate = config.allowUpdate !== false
    const layerConfig = {
      ...base,
      addRecords: config.allowCreate !== false ? base.addRecords : false,
      updateRecords: allowUpdate ? base.updateRecords : false,
      updateAttributes: allowUpdate ? base.updateAttributes : false,
      updateGeometries: (config.allowGeometryUpdate !== false && allowUpdate) ? base.updateGeometries : false,
      deleteRecords: config.allowDelete !== false ? base.deleteRecords : false
    }
    const snapGuides = config.snapGuides !== false
    const snapFeature = config.snapFeature !== false
    const snapGrid = !!config.snapGrid
    const advancedTools = config.advancedTools !== false
    const editConfig = Immutable({
      editMode: useGeometryEditor ? 'GEOMETRY' : 'ATTRIBUTE',
      layersConfig: [layerConfig],
      mapViewsConfig: {},
      description: '',
      noDataMessage: '',
      batchEditing: config.batchEditing !== false,
      relatedRecords: config.relatedRecords !== false,
      templateFilter: config.templateFilter !== false,
      liveDataEditing: true,
      initialReshapeMode: !!config.displayVertices,
      // advanced tools
      advancedEditingTools: advancedTools,
      splitButton: advancedTools && config.toolSplit !== false,
      mergeButton: advancedTools && config.toolMerge !== false,
      copyPaste: advancedTools && config.toolCopyPaste !== false,
      // snapping
      snapSettingMode: 'FLEXIBLE',
      selfSnapping: true,
      featureSnapping: true,
      gridSnapping: true,
      defaultSelfEnabled: snapGuides,
      defaultFeatureEnabled: snapFeature,
      defaultGridEnabled: snapGrid,
      defaultSnapLayers: [],
      // tooltips / labels
      tooltip: true,
      defaultTooltipEnabled: config.enableTooltips !== false,
      segmentLabel: true,
      defaultSegmentLabelEnabled: false
    })
    const useDataSources = Immutable([layerConfig.useDataSource]) as unknown as Array<UseDataSource>
    return { editConfig, useDataSources }
  }, [targetDs, targetLayer, useGeometryEditor, config])

  const hasTarget = configuredTargets.length > 0
  const canGoMap = !!sourceDs && !!targetDs
  const editReady = !!editInfo
  const allowMapping = config.allowRuntimeMapping !== false

  // which steps are reachable by clicking the stepper
  const canVisit = useCallback((s: Step): boolean => {
    if (s === 'add') return true
    if (s === 'edit') return hasTarget && editReady
    // map / load need a source + target
    return canGoMap
  }, [hasTarget, editReady, canGoMap])

  const goEdit = useCallback(() => setStep('edit'), [])

  return (
    <Paper className='widget-add-edit-etl jimu-widget' css={style} ref={rootRef} shape='none'>
      {configuredTargets.map((uds) => (
        <DataSourceComponent
          key={uds.dataSourceId}
          useDataSource={uds}
          onDataSourceCreated={(ds: DataSource) => onTargetCreated(uds.dataSourceId, ds)}
          onCreateDataSourceFailed={() => onTargetCreated(uds.dataSourceId, null)}
          onSelectionChange={uds.dataSourceId === selectedTargetId ? zoomToSelection : undefined}
        />
      ))}

      {mapWidgetId && (
        <JimuMapViewComponent useMapWidgetId={mapWidgetId} onActiveViewChange={handleActiveViewChange} />
      )}

      <div className='stepper d-flex align-items-center' role='group' aria-label={translate('stepsNav')}>
        {STEPS.map((s, i) => {
          const reachable = canVisit(s)
          const label = translate(s === 'add' ? 'stepAdd' : s === 'map' ? 'stepMap' : s === 'load' ? 'stepLoad' : 'stepEdit')
          return (
            <button
              key={s}
              type='button'
              className={`step ${step === s ? 'active' : ''} ${stepIndex(step) > i ? 'done' : ''} ${reachable ? '' : 'disabled'}`}
              onClick={() => { if (reachable) setStep(s) }}
              disabled={!reachable}
              aria-current={step === s ? 'step' : undefined}
              aria-label={`${translate('stepN', { n: i + 1 })}: ${label}`}
            >
              <span className='num' aria-hidden='true'>{i + 1}</span>
              <span className='lbl'>{label}</span>
            </button>
          )
        })}
      </div>

      {!hasTarget && <Alert type='warning' open withIcon className='m-3' text={translate('noTarget')} />}

      <div className='step-body'>
        {step === 'add' && (
          <div className='p-3'>
            <p className='hint'>{translate('addPrompt')}</p>
            <AddDataPopper
              buttonSize='lg' portalUrl={portalUrl} widgetId={id} onFinish={onAddData}
              hiddenTabs={hiddenTabs} popperReference={rootRef} nextOrder={nextOrder}
              config={addDataConfig as any} itemCategoriesInfo={itemCategoriesInfo}
              displayedItemTypeCategories={config.displayedItemTypeCategories}
            />
            {multiDataOptions.length > 0 && (
              <div className='mt-3'>
                <DataList multiDataOptions={multiDataOptions} enableDataAction={false} isLoading={false} widgetId={id} onRemoveData={onRemoveData} onChangeData={() => {}} />
                <label className='src-pick mt-2' htmlFor={`${id}-source-pick`}>{translate('chooseSource')}</label>
                <Select id={`${id}-source-pick`} size='sm' aria-label={translate('chooseSource')} value={sourceDsId || ''} onChange={(e) => setSourceDsId(e.target.value)}>
                  <Option value=''>—</Option>
                  {multiDataOptions.map(d => <Option key={d.dataSourceJson.id} value={d.dataSourceJson.id}>{d.dataSourceJson.label || d.dataSourceJson.sourceLabel}</Option>)}
                </Select>
              </div>
            )}
            <div className='nav mt-3 d-flex justify-content-between align-items-center'>
              <Button type='primary' disabled={!canGoMap} onClick={() => setStep('map')}>{translate('next')}</Button>
            </div>

            {/* edit-only shortcut */}
            {hasTarget && (
              <div className='edit-shortcut mt-3'>
                <Button type='link' size='default' className='edit-shortcut-link' disabled={!editReady} onClick={goEdit}>{translate('editExisting')} →</Button>
                <p className='hint sm m-0'>{translate('editExistingHint')}</p>
              </div>
            )}
          </div>
        )}

        {step === 'map' && sourceSchema && targetSchema && (
          <div className='p-3 scroll'>
            {configuredTargets.length > 1 && (
              <div className='target-pick mb-3'>
                <label htmlFor={`${id}-target-pick`} className='blk-label'>{translate('loadInto')}</label>
                <Select id={`${id}-target-pick`} size='sm' aria-label={translate('loadInto')} value={selectedTargetId} onChange={(e) => onSelectTarget(e.target.value)}>
                  {configuredTargets.map(t => <Option key={t.dataSourceId} value={t.dataSourceId}>{targetLabel(t.dataSourceId)}</Option>)}
                </Select>
              </div>
            )}
            {allowMapping
              ? <MappingPanel sourceSchema={sourceSchema} targetSchema={targetSchema} targetFields={targetFields} value={mapping} allowExpressions={config.allowExpressions !== false} onChange={setMapping} />
              : <Alert type='info' open withIcon text='Mapping is fixed by the app author.' />}
            <div className='nav mt-3 d-flex justify-content-between'>
              <Button type='tertiary' onClick={() => setStep('add')}>{translate('back')}</Button>
              <Button type='primary' onClick={() => setStep('load')}>{translate('next')}</Button>
            </div>
          </div>
        )}

        {step === 'load' && sourceDs && targetDs && sourceSchema && targetSchema && (
          <div className='p-3 scroll'>
            <LoadPanel
              sourceDs={sourceDs} targetDs={targetDs} sourceSchema={sourceSchema} targetSchema={targetSchema}
              targetFields={targetFields} mapping={mapping} chunkSize={config.loadChunkSize || 200}
              enableReviewEdit={config.enableReviewEdit !== false && editReady}
              onReviewEdit={() => setStep('edit')}
              onLoaded={(result) => { if (showOnMap) zoomToObjectIds(result.addedObjectIds) }}
            />
            <div className='nav mt-3'>
              <Button type='tertiary' onClick={() => setStep('map')}>{translate('back')}</Button>
            </div>
          </div>
        )}

        {step === 'edit' && (
          editInfo
            ? (
              <div className='edit-body'>
                {allowSymbology && jimuMapView && <SymbologyPanel jimuMapView={jimuMapView} defaultLayer={targetLayer} translate={translate} onApplied={() => setEditorRefresh(v => v + 1)} />}
                {useGeometryEditor
                  ? <EditorComponent
                      key={`editor-${editorRefresh}`}
                      id={id}
                      visible={step === 'edit'}
                      config={editInfo.editConfig as any}
                      canEditFeature={canEditFeature}
                      useMapWidgetIds={useMapWidgetIds}
                    />
                  : <EditFeatureForm
                      label={translate('stepEdit')}
                      config={editInfo.editConfig as any}
                      canEditFeature={canEditFeature}
                      useDataSources={editInfo.useDataSources as any}
                    />}
                <div className='nav p-2 d-flex justify-content-between'>
                  <Button type='tertiary' onClick={() => setStep(canGoMap ? 'load' : 'add')}>{translate('back')}</Button>
                  <Button type='link' size='sm' onClick={() => setStep('add')}>{translate('startOver')}</Button>
                </div>
              </div>
              )
            : (
              <div className='p-3'>
                <Alert type='warning' open withIcon text={hasTarget ? translate('editUnavailable') : translate('noTarget')} />
                <div className='nav mt-3'><Button type='tertiary' onClick={() => setStep('add')}>{translate('back')}</Button></div>
              </div>
              )
        )}
      </div>
    </Paper>
  )
}

Widget.versionManager = versionManager
export default Widget

const style = css`
  display: flex;
  flex-direction: column;
  height: 100%;
  .stepper { padding: 10px 12px; border-bottom: 1px solid var(--sys-color-divider-secondary); gap: 16px; flex-wrap: wrap; }
  .stepper .step { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--sys-color-surface-paper-hint); background: transparent; border: 0; padding: 2px 4px; font: inherit; border-radius: 4px; }
  .stepper .step:focus-visible { outline: 2px solid var(--sys-color-primary-main); outline-offset: 1px; }
  .stepper .step.active { color: var(--sys-color-primary-main); font-weight: 600; }
  .stepper .step.done { color: var(--sys-color-surface-paper-text); }
  .stepper .step.disabled, .stepper .step:disabled { cursor: not-allowed; opacity: 0.5; }
  .stepper .num { width: 20px; height: 20px; border-radius: 50%; border: 1px solid currentColor; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; }
  .step-body { flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; }
  .step-body .scroll { overflow: auto; }
  .hint { color: var(--sys-color-surface-paper-hint); font-size: 0.8125rem; }
  .hint.sm { font-size: 0.75rem; margin-top: 2px; }
  .src-pick { display: block; font-size: 0.75rem; color: var(--sys-color-surface-paper-hint); }
  .edit-shortcut { padding: 10px 12px; border: 1px solid var(--sys-color-divider-secondary); border-left: 3px solid var(--sys-color-primary-main); border-radius: 4px; background: var(--sys-color-surface-background); }
  .edit-shortcut .edit-shortcut-link { font-weight: 600; padding-left: 0; }
  .edit-body { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
`
