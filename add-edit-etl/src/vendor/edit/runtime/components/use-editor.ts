import { Immutable, React, hooks, JSAPILayerTypes } from 'jimu-core'
import type { JimuLayerView, JimuMapView } from 'jimu-arcgis'
import SketchTooltipOptions from '@arcgis/core/views/interactive/sketch/SketchTooltipOptions'
import SketchLabelOptions from '@arcgis/core/views/interactive/sketch/SketchLabelOptions'
import SnappingOptions from '@arcgis/core/views/interactive/snapping/SnappingOptions'
import FeatureSnappingLayerSource from '@arcgis/core/views/interactive/snapping/FeatureSnappingLayerSource'
import type { ResourceHandle } from '@arcgis/core/core/Handles'
import type SubtypeGroupLayer from '@arcgis/core/layers/SubtypeGroupLayer'
import type FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import type SubtypeSublayer from '@arcgis/core/layers/support/SubtypeSublayer'
import type SceneLayer from '@arcgis/core/layers/SceneLayer'
import type { EditsResultEvent } from '@arcgis/core/editing/types'
import type { LayerInfo as EditorLayerInfo, SupportingWidgetDefaults } from '@arcgis/core/widgets/Editor/types'
import type VisibleElements from '@arcgis/core/widgets/FeatureTemplates/VisibleElements'
import type { CollectionAfterItemEvent } from '@arcgis/core/core/Collection'
import type Layer from '@arcgis/core/layers/Layer'
import { type IMConfig, type LayersConfig, SnapSettingMode } from '../../config'
import { getDataSourceById, getEditDataSource, getFlatFormElements, SUPPORTED_JIMU_LAYER_TYPES, type SupportedDataSource, type SupportedLayer } from '../../utils'
import { constructUneditableInfo, getDefaultSnapSources, getEditorLayerInfo, isEditableLayerView, updateDataSourceAfterEdit } from './utils'
import Graphic from 'esri/Graphic'

interface UseEditorOptions {
  config: IMConfig
  jimuMapView: JimuMapView
  canEditFeature: boolean
  editor: HTMLArcgisEditorElement
}

const useEditor = (options: UseEditorOptions) => {
  const { config, jimuMapView, canEditFeature, editor } = options
  const { mapViewsConfig, relatedRecords, liveDataEditing } = config

  const [editorLayerInfos, setEditorLayerInfos] = React.useState<EditorLayerInfo[]>([])
  const [showUpdateBtn, setShowUpdateBtn] = React.useState(false)
  const updateEditorLayerInfos = React.useCallback(() => {
    if (!jimuMapView || typeof canEditFeature !== 'boolean') return
    let allLayerViews = jimuMapView.getAllJimuLayerViews()
    const mapViewConfig = mapViewsConfig?.[jimuMapView.id]
    const customizeLayers = mapViewConfig?.customizeLayers
    const customJimuLayerViewIds = mapViewConfig?.customJimuLayerViewIds
    const layersConfig = mapViewConfig?.layersConfig || Immutable<LayersConfig[]>([])
    if (customizeLayers) {
      allLayerViews = allLayerViews.sort((a, b) => {
        const aIndex = layersConfig.findIndex(layerConfig => layerConfig.id === a.layerDataSourceId)
        const bIndex = layersConfig.findIndex(layerConfig => layerConfig.id === b.layerDataSourceId)
        return aIndex - bIndex
      })
    }
    const allLayers = jimuMapView.view?.map?.allLayers?.toArray?.() || []
    const uneditableLayers = allLayers.filter(layer => {
      const layerType = layer.type as JSAPILayerTypes
      const isSupported = SUPPORTED_JIMU_LAYER_TYPES.includes(layerType)
      const notInJimuLayerView = !allLayerViews.find(layerView => layerView.layer === layer)
      const isKnowledgeGraphSublayer = layerType === JSAPILayerTypes.KnowledgeGraphSublayer
      if (isKnowledgeGraphSublayer) {
        return true
      }
      return isSupported && notInJimuLayerView
    }) as SupportedLayer[]
    const supportedLayerViews = allLayerViews.filter(layerView => {
      const layer = layerView.layer
      const isSupported = SUPPORTED_JIMU_LAYER_TYPES.includes(layer.type)
      return isSupported
    })
    const editableLayerViews: JimuLayerView[] = []
    supportedLayerViews.forEach(layerView => {
      const isEditable = isEditableLayerView(layerView, customizeLayers, customJimuLayerViewIds, liveDataEditing)
      if (isEditable) {
        editableLayerViews.push(layerView)
      } else {
        uneditableLayers.push(layerView.layer)
      }
    })
    const uneditableLayerInfos = uneditableLayers.map(layer => constructUneditableInfo(layer))
    const editablePromise = editableLayerViews.map(async (layerView) => {
      const ds = await layerView.getOrCreateLayerDataSource() as SupportedDataSource
      if (!ds) return null
      const layerConfig = layersConfig.filter(l => l.id === ds?.id)?.[0]?.asMutable?.({ deep: true })
      const dataSource = getEditDataSource(ds)
      return getEditorLayerInfo(dataSource, layerConfig, layerView, relatedRecords, canEditFeature)
    })
    Promise.all(editablePromise).then((results) => {
      const validResults = results.filter(v => !!v)
      setShowUpdateBtn(validResults.some(r => r.showUpdateBtn))
      const layerInfos = validResults.map(r => r.editorLayerInfo).concat(uneditableLayerInfos)
      const relatedTableInfos = []
      const allTables = (jimuMapView.view.map.allTables.toArray() || []) as FeatureLayer[]
      for (const layerInfo of layerInfos) {
        const elements = getFlatFormElements(layerInfo.formTemplate?.elements || [])
        const hasRelationships = elements.some(e => e.type === 'relationship')
        if (!hasRelationships) continue
        const relationships = (layerInfo.layer as FeatureLayer | SubtypeSublayer | SceneLayer).relationships
        for (const relationship of relationships) {
          const relatedTableId = relationship.relatedTableId
          const relatedTable = allTables.find(t => t.layerId === relatedTableId)
          if (!relatedTable) continue
          const relatedTableInfo = relatedTableInfos.find(tableInfo => tableInfo.layer === relatedTable)
          if (relatedTableInfo) continue
          relatedTableInfos.push({
            layer: relatedTable,
            enabled: true,
            addEnabled: layerInfo.addEnabled,
            updateEnabled: layerInfo.updateEnabled,
            deleteEnabled: layerInfo.deleteEnabled,
          })
        }
      }
      setEditorLayerInfos(layerInfos.concat(relatedTableInfos))
    })
  }, [canEditFeature, jimuMapView, liveDataEditing, mapViewsConfig, relatedRecords])

  React.useEffect(() => {
    updateEditorLayerInfos()
  }, [updateEditorLayerInfos])

  const updateEditorLayerInfosRef = hooks.useLatest(updateEditorLayerInfos)
  React.useEffect(() => {
    if (!jimuMapView?.view?.map?.layers) return
    const visibleChangedListener = () => {
      updateEditorLayerInfosRef.current()
    }
    let timer: number = null
    let lastLayerCount = jimuMapView.getAllJimuLayerViews().length
    const layersChangedListener = (jimuLayerView: JimuLayerView) => {
      // if the layer is from runtime, update layerInfos immediately
      if (jimuLayerView.fromRuntime) {
        updateEditorLayerInfosRef.current()
        return
      }
      // if the layer is created while map loading, debounce the update for 5 seconds
      // to avoid too many updates
      if (timer) {
        window.clearTimeout(timer)
      }
      timer = window.setTimeout(() => {
        const currentLayerCount = jimuMapView.getAllJimuLayerViews().length
        if (currentLayerCount === lastLayerCount) return
        updateEditorLayerInfosRef.current()
        lastLayerCount = currentLayerCount
      }, 5000)
    }
    const nonEditLayerAddListener = (event: CollectionAfterItemEvent<Layer>) => {
      if (event?.item?.declaredClass === 'esri.layers.GraphicsLayer' || event?.item?.listMode === 'hide') {
        updateEditorLayerInfosRef.current()
      }
    }
    jimuMapView.addJimuLayerViewsVisibleChangeListener(visibleChangedListener)
    jimuMapView.addJimuLayerViewCreatedListener(layersChangedListener)
    const afterAddListener = jimuMapView.view?.map?.allLayers?.on('after-add', nonEditLayerAddListener)
    jimuMapView.addJimuLayerViewRemovedListener(layersChangedListener)
    return () => {
      jimuMapView?.removeJimuLayerViewsVisibleChangeListener?.(visibleChangedListener)
      jimuMapView?.removeJimuLayerViewCreatedListener?.(layersChangedListener)
      afterAddListener?.remove?.()
      jimuMapView?.removeJimuLayerViewRemovedListener?.(layersChangedListener)
    }
  }, [jimuMapView, updateEditorLayerInfosRef])

  const { selfSnapping, featureSnapping, gridSnapping = false, defaultSelfEnabled, defaultFeatureEnabled, defaultGridEnabled = false, snapSettingMode, defaultSnapLayers, tooltip, defaultTooltipEnabled = false, segmentLabel = true, defaultSegmentLabelEnabled = false, templateFilter, initialReshapeMode, advancedEditingTools = true, splitButton = true, mergeButton = true, batchEditing = false } = config

  React.useEffect(() => {
    if (!editor || !jimuMapView?.view || editor.view !== jimuMapView.view) return
    editor.tooltipOptions = new SketchTooltipOptions({ enabled: defaultTooltipEnabled })
  }, [defaultTooltipEnabled, editor, jimuMapView])

  React.useEffect(() => {
    if (!editor || !jimuMapView?.view || editor.view !== jimuMapView.view) return
    editor.labelOptions = new SketchLabelOptions({ enabled: defaultSegmentLabelEnabled })
  }, [defaultSegmentLabelEnabled, editor, jimuMapView])

  React.useEffect(() => {
    if (!editor || !jimuMapView?.view || editor.view !== jimuMapView.view) return
    const defaultSnappingSources = getDefaultSnapSources(jimuMapView, defaultSnapLayers)
    const featureSources = defaultSnappingSources.map(option => new FeatureSnappingLayerSource(option))
    editor.snappingOptions = new SnappingOptions({
      enabled: defaultSelfEnabled || defaultFeatureEnabled || defaultGridEnabled,
      selfEnabled: defaultSelfEnabled,
      featureEnabled: defaultFeatureEnabled,
      gridEnabled: defaultGridEnabled && gridSnapping,
      featureSources: featureSources
    })
  }, [defaultFeatureEnabled, defaultGridEnabled, defaultSelfEnabled, defaultSnapLayers, editor, gridSnapping, jimuMapView])

  const editorProps = React.useMemo(() => {
    const flexibleMode = snapSettingMode === SnapSettingMode.Flexible
    const snapOn = selfSnapping || featureSnapping || gridSnapping
    const snappingControlsOpen = flexibleMode && snapOn
    const supportingWidgetDefaults: SupportingWidgetDefaults = {
      featureTemplates: {
        visibleElements: {
          filter: templateFilter
        } as VisibleElements
      },
      sketch: {
        defaultUpdateOptions: {
          tool: initialReshapeMode ? 'reshape' : 'transform'
        }
      }
    }
    const props = {
      hideSelectionToolbar: !batchEditing,
      hideSnappingControlsElementsEnabledToggle: !snappingControlsOpen || (!selfSnapping && !featureSnapping && !gridSnapping),
      hideSnappingControlsElementsSelfEnabledToggle: !snappingControlsOpen || !selfSnapping,
      hideSnappingControlsElementsFeatureEnabledToggle: !snappingControlsOpen || !featureSnapping,
      hideSnappingControlsElementsGridControls: !snappingControlsOpen || !gridSnapping,
      hideSnappingControlsElementsGridEnabledToggle: !snappingControlsOpen || !gridSnapping,
      hideSnappingControlsElementsLayerList: !snappingControlsOpen || !featureSnapping,
      hideTooltipsToggle: !tooltip,
      hideLabelsToggle: !segmentLabel,
      hideSettingsMenu: !snappingControlsOpen && !tooltip && !segmentLabel,
      hideSplitButton: !advancedEditingTools || !splitButton,
      hideMergeButton: !advancedEditingTools || !batchEditing || !mergeButton,
      supportingWidgetDefaults,
      hideEditFeaturesSection: !showUpdateBtn,
      layerInfos: editorLayerInfos
    }
    return props
  }, [advancedEditingTools, batchEditing, editorLayerInfos, featureSnapping, gridSnapping, initialReshapeMode, mergeButton, segmentLabel, selfSnapping, showUpdateBtn, snapSettingMode, splitButton, templateFilter, tooltip])

  const updateDataSource = React.useCallback(async (
    layer: SubtypeGroupLayer | FeatureLayer,
    event: EditsResultEvent
  ) => {
    // Only update data source when editing or adding
    const dsId = jimuMapView.getDataSourceIdByAPILayer(layer)
    const ds = getDataSourceById(dsId)
    if (!ds) return
    const addIds = event.addedFeatures.map(f => f.objectId)
    let addFeatures = []
    if (addIds.length > 0) {
      const addFeatureSet = await layer.queryFeatures({
        objectIds: addIds,
        outFields: ['*'],
        returnGeometry: false
      })
      addFeatures = addFeatureSet?.features || []
    }

    const updateIds = event.updatedFeatures.map(f => f.objectId)
    // For a single update, optimistically trigger one update first to reduce source version change lag.
    if (updateIds.length === 1) {
      updateDataSourceAfterEdit(ds, { updateFeatures: [new Graphic({attributes: {objectId: updateIds[0]}})] })
    }
    let updateFeatures = []
    if (updateIds.length > 0) {
      const updateFeatureSet = await layer.queryFeatures({
        objectIds: updateIds,
        outFields: ['*'],
        returnGeometry: false
      })
      updateFeatures = updateFeatureSet?.features || []
    }
    const deleteFeatures = event.deletedFeatures.map(f => ({objectId: f.objectId}))
    updateDataSourceAfterEdit(ds, { addFeatures, updateFeatures, deleteFeatures})
  }, [jimuMapView])
  React.useEffect(() => {
    const handles: ResourceHandle[] = []
    for (const layerInfo of editorLayerInfos) {
      if (!layerInfo.enabled) continue
      const editorLayer = layerInfo.layer
      if (editorLayer.type === 'subtype-sublayer') {
        const subtypeGrouplayer = editorLayer.parent
        const handle = subtypeGrouplayer?.on('edits', (event) => {
          updateDataSource(subtypeGrouplayer, event)
        })
        handles.push(handle)
      } else {
        const featureLayer = editorLayer as FeatureLayer
        const handle = featureLayer.on('edits', (event) => {
          updateDataSource(featureLayer, event)
        })
        handles.push(handle)
      }
    }
    return () => {
      for (const handle of handles) {
        handle.remove()
      }
    }
  }, [editorLayerInfos, updateDataSource])

  return editorProps
}

export default useEditor
