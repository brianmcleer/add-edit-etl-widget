import {
  React, Immutable, type IMUseDataSource, type ImmutableArray,
  type FeatureDataRecord, dataSourceUtils, hooks, css, type IMThemeVariables, classNames
} from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'
import { Paper, WidgetPlaceholder } from 'jimu-ui'
import { useTheme } from 'jimu-theme'
import 'arcgis-map-components'
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils'
import type { ResourceHandle } from '@arcgis/core/core/Handles'
import type Graphic from '@arcgis/core/Graphic'
import type Layer from '@arcgis/core/layers/Layer'
import type FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import type UpdateWorkflowData from '@arcgis/core/widgets/Editor/UpdateWorkflowData'
import type { ArcgisEditorCustomEvent } from '@arcgis/map-components'
import editWidgetIcon from '../../../icon.svg'
import { getDataSourceById, supportedDsTypes } from '../../utils'
import {
  type EditFeatures, featureFormStyle, flatMapArrayWithView, idsArrayEquals, queryFullFeatures,
  useCalciteColorMapping
} from './utils'
import EditListDataSource from './edit-list-ds'
import EditorCloseWarning from './editor-close-warning'
import useEditor from './use-editor'
import type { CommonProps } from '../widget'
import defaultMessages from '../translations/default'
import EditorCopyPaste from './editor-copy-paste'

interface EditorComponentProps extends CommonProps {
  id: string
  useMapWidgetIds: ImmutableArray<string>
  visible: boolean
}

const getWidgetStyle = (theme: IMThemeVariables) => css`
  ${featureFormStyle}
  overflow: clip;
  --calcite-flow-header-background-color: ${theme.sys.color.surface.paper};
  --calcite-flow-heading-text-color: ${theme.sys.color.surface.paperText};
  --calcite-flow-footer-background-color: ${theme.sys.color.surface.paper};
  --calcite-panel-footer-text-color: ${theme.sys.color.surface.paperText};
  --calcite-accordion-item-heading-text-color: ${theme.sys.color.surface.paperText};
  --calcite-accordion-item-expand-icon-color: ${theme.sys.color.surface.paperText};
  --calcite-action-background-color: ${theme.sys.color.action.default};
  --calcite-action-text-color: ${theme.sys.color.action.text};
  --calcite-action-background-color-press: ${theme.sys.color.action.pressed};
  --calcite-action-background-color-hover: ${theme.sys.color.action.hover};
  --calcite-action-text-color-press: ${theme.sys.color.action.text};
  --calcite-list-content-text-color: ${theme.sys.color.action.text};
  --calcite-list-label-text-color: ${theme.sys.color.action.text};
  --calcite-list-description-text-color: ${theme.sys.color.action.text};
`

export type PasteStep = 'ready' | 'paste' | 'pasteSpecial'

const EditorComponent = (props: EditorComponentProps) => {
  const { id, config, canEditFeature, useMapWidgetIds, visible } = props
  const { mapViewsConfig, batchEditing = false, advancedEditingTools = true, copyPaste } = config

  const [jimuMapView, setJimuMapView] = React.useState<JimuMapView>(null)
  const [editFeatures, setEditFeatures] = React.useState<EditFeatures>({})
  const [pasteStep, setPasteStep] = React.useState<PasteStep>('ready')

  const translate = hooks.useTranslation(defaultMessages)
  const theme = useTheme()

  const [editor, setEditor] = React.useState<HTMLArcgisEditorElement>(null)
  const editorProps = useEditor({
    config,
    jimuMapView,
    canEditFeature,
    editor
  })

  const mapUseDataSources = React.useMemo(() => {
    if (!jimuMapView || jimuMapView.isDestroyed()) return null
    const layerInfos = editorProps?.layerInfos
    if (!layerInfos) return null

    const viewConfig = mapViewsConfig?.[jimuMapView.id]
    const customizeLayers = viewConfig?.customizeLayers
    const customJimuLayerViewIds = viewConfig?.customJimuLayerViewIds

    const newMapUseDataSources: IMUseDataSource[] = []
    for (const layerInfo of layerInfos) {
      try {
        if (!layerInfo?.enabled || (layerInfo.layer as FeatureLayer).isTable) continue
        const jimuLayerViewId = jimuMapView.getJimuLayerViewIdByAPILayer(layerInfo.layer)
        if (customizeLayers && !customJimuLayerViewIds?.includes(jimuLayerViewId)) continue

        const layerDsId = jimuMapView.getDataSourceIdByAPILayer(layerInfo.layer)
        const layerDs = layerDsId ? getDataSourceById(layerDsId) : null
        if (!layerDs || !supportedDsTypes.includes(layerDs.type)) continue
        const mainDs = layerDs.getMainDataSource()
        const rootDs = layerDs.getRootDataSource()
        const usedDs: IMUseDataSource = Immutable({
          dataSourceId: layerDs.id,
          mainDataSourceId: mainDs?.id,
          dataViewId: layerDs.dataViewId,
          rootDataSourceId: rootDs?.id
        })
        newMapUseDataSources.push(usedDs)
      } catch (e) {
        continue
      }
    }
    return newMapUseDataSources
  }, [editorProps?.layerInfos, jimuMapView, mapViewsConfig])

  const handleActiveViewChange = React.useCallback((jimuMapView: JimuMapView) => {
    // Clear stale editor instance first to avoid writing options during view switch.
    setEditor(null)
    setJimuMapView(jimuMapView)
  }, [])

  const startWorkflow = React.useCallback(async (features: EditFeatures) => {
    if (!editor || !jimuMapView || selectionFromEditor.current) return
    if (editor.activeWorkflow) {
      editor.cancelWorkflow()
    }
    // The number of selected(the layers from the same map)
    const selectionManager = (editor as any).effectiveSelectionManager
    const featureRecords = flatMapArrayWithView(features, jimuMapView)
    if (featureRecords.length === 0) {
      selectionManager?.hasSelection && selectionManager.clear()
    } else {
      selectionFromExb.current = true
      let fullFeatures: Graphic[] = []
      try {
        fullFeatures = await queryFullFeatures(jimuMapView, features)
      } catch (err) {
        console.error('Failed to query editing features:', err)
      }
      if (fullFeatures.length === 0) {
        selectionManager?.hasSelection && selectionManager.clear()
        console.error('No features found for the selected data records.')
      } else if (fullFeatures.length === 1) {
        selectionManager?.hasSelection && selectionManager.clear()
        const activeFeature = fullFeatures[0]
        editor.startUpdateWorkflowAtFeatureEdit(activeFeature)
      } else if (fullFeatures.length > 1) {
        if (jimuMapView.view.type === '2d' && batchEditing) {
          selectionManager?.hasSelection && selectionManager.clear()
          selectionManager && (selectionManager as any).updateSelection({
            current: fullFeatures,
            added: [],
            removed: [],
          })
        } else {
          editor.startUpdateWorkflowAtMultipleFeatureSelection(fullFeatures)
        }
      }
    }
  }, [editor, jimuMapView, batchEditing])

  const selectionFromEditor = React.useRef(false)
  const selectionFromExb = React.useRef(false)
  const handleSelectionChange = React.useCallback((dataSourceIds: string[]) => {
    const newEditFeatures = Object.assign({}, editFeatures)
    for (const dataSourceId of dataSourceIds) {
      const dataSource = getDataSourceById(dataSourceId)
      if (!dataSource) continue
      const selectedRecords = dataSource.getSelectedRecords()
      newEditFeatures[dataSourceId] = selectedRecords
    }
    setEditFeatures(newEditFeatures)
    if (selectionFromEditor.current) {
      window.setTimeout(() => {
        selectionFromEditor.current = false
      }, 50)
    } else if (visible) {
      startWorkflow(newEditFeatures)
    }
  }, [editFeatures, startWorkflow, visible])

  const handleSourceVersionChange = React.useCallback((dataSourceId: string) => {
    const featureRecords = flatMapArrayWithView(editFeatures, jimuMapView)
    const featureCount = featureRecords.length
    if (featureCount === 1) {
      handleSelectionChange([dataSourceId])
    }
  }, [editFeatures, handleSelectionChange, jimuMapView])

  const editFeatureRef = hooks.useLatest(editFeatures)
  React.useEffect(() => {
    if (visible && !editor?.activeWorkflow?.started) {
      startWorkflow(editFeatureRef.current)
    }
    if (!visible && editor?.activeWorkflow?.started) {
      editor.activeWorkflow.cancel()
    }
  }, [editFeatureRef, editor, startWorkflow, visible])

  const [formChange, setFormChange] = React.useState(false)
  const handleSketchUpdate = React.useCallback((event: CustomEvent) => {
    if (event.detail?.detail?.state !== 'active' || formChange) return
    setFormChange(true)
  }, [formChange])
  const previousRootFeatures = React.useRef<Graphic[]>([])
  const selectionChangeHandleRef = React.useRef<ResourceHandle>(null)
  const handleReady = React.useCallback((event: ArcgisEditorCustomEvent<void>) => {
    const editor = event.currentTarget
    if (!jimuMapView?.view || editor?.view !== jimuMapView.view) return
    setEditor(editor)
    if (!editor || !jimuMapView) return
    // #region Sync selection - 2d view with multiple selection
    // The SelectionManager only works in 2D view with multiple selection.
    selectionChangeHandleRef.current?.remove?.()
    const selectionManager = (editor as any).effectiveSelectionManager
    selectionChangeHandleRef.current = jimuMapView.view.type === '2d' && batchEditing && selectionManager && selectionManager.on('selection-change', async (evt) => {
      if (selectionFromExb.current) {
        selectionFromExb.current = false
        return
      }
      const rootDs = jimuMapView.getMapDataSource()
      for (const change of (evt.changes || [])) {
        const layer = change.layer as Layer
        if (!layer) continue
        const dsId = dataSourceUtils.getDataSourceIdByJSAPILayer(rootDs, layer)
        const ds = getDataSourceById(dsId)
        if (!ds) continue
        const layerSelectedIds = change.selection ? change.selection.map(item => typeof item === 'object' ? item.getObjectId() : item) : []
        const dsSelectedIds = ds.getSelectedRecordIds()
        if (!idsArrayEquals(layerSelectedIds, dsSelectedIds) && (layerSelectedIds.length !== 0 || dsSelectedIds.length !== 0)) {
          if (layerSelectedIds.length === 0) {
            ds.clearSelection()
          } else {
            const records = (await ds.query({
              objectIds: layerSelectedIds,
              outFields: ['*'],
              returnGeometry: true
            }))?.records as FeatureDataRecord[]
            ds.selectRecordsByIds(records.map(r => r.getId()), records)
          }
          selectionFromEditor.current = true
        }
      }
    })
    // #endregion
  }, [batchEditing, jimuMapView])

  const watchCandidatesRef = React.useRef<ResourceHandle>(null)
  const watchFeatureFormRef = React.useRef<ResourceHandle>(null)
  const handlePropertyChange = React.useCallback((event: ArcgisEditorCustomEvent<{ name: 'activeWorkflow' | 'state' }>) => {
    if (event.detail.name !== 'activeWorkflow') return
    watchCandidatesRef.current?.remove?.()
    watchFeatureFormRef.current?.remove?.()
    const editor = event.currentTarget
    const wf = editor.activeWorkflow

    // #region Sync selection - 3D view and 2d view with single selection
    watchCandidatesRef.current = reactiveUtils.watch(() => (wf?.data as UpdateWorkflowData)?.candidates, (candidates, oldCandidates) => {
      const data = editor.activeWorkflow?.data as any
      const rootFeatures = data?.rootFeatures?.toArray?.() || []
      const singleSelection = previousRootFeatures.current.length === 0 && rootFeatures.length === 1
      const singleUnselection = previousRootFeatures.current.length === 1 && rootFeatures.length === 0
      const selectionManager = (editor as any).effectiveSelectionManager
      const singleSelectionInBatchMode = (singleSelection || singleUnselection) && !selectionManager?.hasSelection
      if (jimuMapView.view.type === '2d' && batchEditing && !singleSelectionInBatchMode) return
      previousRootFeatures.current = rootFeatures || []
      // If "Select by point", the selection manager's "selection-change" event won't be triggered
      // So we need to sync the selection here
      // Also we must inactivate the "Select by point" tool, or clicking on the map won't trigger exb's selection change
      editor.cancelSelectionTool()
      if (selectionFromExb.current) {
        if (candidates !== undefined) {
          selectionFromExb.current = false
        }
        return
      }
      // In 4.33, the candidates is null on single selections, so we need to use rootFeatures instead.
      const candidateFeatures = candidates?.length > 0 ? candidates : rootFeatures
      const candidateFeatureMap: { [layerId: string]: Graphic[] } = {}
      for (const c of (candidateFeatures || [])) {
        if (!candidateFeatureMap[c.layer.id]) {
          candidateFeatureMap[c.layer.id] = []
        }
        candidateFeatureMap[c.layer.id].push(c)
      }
      const layers = editor.layerInfos.map(l => l.layer)
      for (const layer of layers) {
        const rootDs = jimuMapView.getMapDataSource()
        const dsId = dataSourceUtils.getDataSourceIdByJSAPILayer(rootDs, layer)
        const ds = getDataSourceById(dsId)
        if (!ds) continue
        const candidateFeatures = candidateFeatureMap[layer.id] || []
        const candidateIds: Array<string | number> = []
        const candidateRecords = []
        for (const feature of candidateFeatures) {
          const record = ds.buildRecord(feature)
          candidateRecords.push(record)
          candidateIds.push(record.getId())
        }
        const selectedIds = ds.getSelectedRecordIds()
        if (!idsArrayEquals(selectedIds, candidateIds) && (selectedIds.length !== 0 || candidateIds.length !== 0)) {
          const allWithGeometry = candidateRecords.every(r => r.feature.geometry)
          if (allWithGeometry) {
            ds.selectRecordsByIds(candidateIds, candidateRecords)
          } else {
            ds.query({
              objectIds: candidateIds,
              outFields: ['*'],
              returnGeometry: true
            }).then(result => {
              const records = (result?.records || []) as FeatureDataRecord[]
              ds.selectRecordsByIds(candidateIds, records)
            }).catch(() => {
              console.error(new Error('Failed to query features'))
            })
          }
          selectionFromEditor.current = true
        }
      }
    }, { initial: true })
    // #endregion

    // #region Monitor form changes
    watchFeatureFormRef.current = reactiveUtils.watch(() => wf?.data?.viewModel?.formViewModel, (formViewModel) => {
      if (!formViewModel) {
        setFormChange(false)
        return
      }
      if ('features' in formViewModel) {
        formViewModel.on('values-change', (e) => {
          if (e.source === 'user') {
            setFormChange(true)
          }
        })
      }
    }, { initial: true })
    // #endregion
  }, [batchEditing, jimuMapView])

  const previousBatchEditing = hooks.usePrevious(batchEditing)
  React.useEffect(() => {
    if (!editor) return
    // Editor does not handle the change of batch editing mode currently.
    if (previousBatchEditing !== batchEditing) {
      // Clear the active tool when batch editing is turned off
      const selectionToolbar = (editor as any)._selectionToolbar
      if (!batchEditing && selectionToolbar?.activeOperation) {
        selectionToolbar.cancel?.()
      }
      // Restart the workflow after batch editing mode changed
      if (editor.activeWorkflow) {
        startWorkflow(editFeatures)
      }
    }
  }, [batchEditing, editFeatures, editor, previousBatchEditing, startWorkflow])

  React.useEffect(() => {
    return () => {
      selectionChangeHandleRef.current?.remove?.()
      watchCandidatesRef.current?.remove?.()
      watchFeatureFormRef.current?.remove?.()
    }
  }, [])

  const mapWidgetId = useMapWidgetIds?.[0]

  const calciteColorMapping = useCalciteColorMapping()

  return (
    <Paper shape='none' className='jimu-widget widget-edit' css={[getWidgetStyle(theme), calciteColorMapping]}>
      {advancedEditingTools && copyPaste && mapWidgetId && jimuMapView && jimuMapView.view.type === '2d' && editor &&
        <EditorCopyPaste
          jimuMapView={jimuMapView}
          editor={editor}
          mapWidgetId={mapWidgetId}
          widgetId={id}
          formChange={formChange}
          onStepChange={setPasteStep}
        />
      }
      {mapWidgetId && jimuMapView && <div className={classNames('edit-con h-100', { 'd-none': pasteStep === 'pasteSpecial' })}>
        <arcgis-editor
          key={jimuMapView.id}
          referenceElement={jimuMapView.mapComponent}
          {...editorProps}
          onarcgisReady={handleReady}
          onarcgisPropertyChange={handlePropertyChange}
          onarcgisSketchUpdate={handleSketchUpdate}
        ></arcgis-editor>
      </div>}
      {!mapWidgetId && <WidgetPlaceholder
        autoFlip
        icon={editWidgetIcon}
        name={translate('_widgetLabel')}
        data-testid='editPlaceholder'
      />}
      <JimuMapViewComponent
        useMapWidgetId={mapWidgetId}
        onActiveViewChange={handleActiveViewChange}
      />
      {mapWidgetId && !jimuMapView && <div className='jimu-secondary-loading' />}
      {editor && <EditListDataSource
        useDataSources={mapUseDataSources}
        unsavedChange={formChange && !!editor?.activeWorkflow?.data?.viewModel?.formViewModel}
        onSelectionChange={handleSelectionChange}
        onSourceVersionChange={handleSourceVersionChange}
      />}
      <EditorCloseWarning id={props.id} formChange={formChange} />
    </Paper>
  )
}

export default EditorComponent
