import {
  appActions, getAppStore, React, hooks, classNames, css, defaultMessages as jimuCoreMessages,
  type FeatureDataRecord
} from 'jimu-core'
import type { JimuMapView } from 'jimu-arcgis'
import { ConfirmDialog, defaultMessages as jimuUiMessages } from 'jimu-ui'
import 'arcgis-map-components'
import type { ArcgisPasteCustomEvent } from '@arcgis/map-components'
import * as reactiveUtils from 'esri/core/reactiveUtils'
import type { ClipboardItem, ClipboardSupportedLayer } from 'esri/applications/Components/clipboard'
import type { ApplySet, ApplySetLayerEditResult, ApplySetServiceEditResult, ApplySetSupportedLayer } from 'esri/applications/Components/applySetUtils'
import type { FeatureEditResult } from 'esri/layers/graphics/editingSupport'
import type Graphic from 'esri/Graphic'
import type { GraphicLayer } from 'esri/Graphic'
import type FeatureLayer from 'esri/layers/FeatureLayer'
import type SubtypeGroupLayer from 'esri/layers/SubtypeGroupLayer'
import type Editor from 'esri/widgets/Editor'
import { updateDataSourceAfterEdit } from './utils'
import defaultMessages from '../translations/default'
import { getDataSourceById } from '../../utils'
import type { PasteStep } from './editor-component'

export interface CopyPastePanelProps {
  jimuMapView: JimuMapView
  editor: Editor
  mapWidgetId: string
  widgetId: string
  formChange: boolean
  onStepChange: (step: PasteStep) => void
}

const copyPasteToolStyle = css`
  display: flex;
  gap: 4px;
  position: absolute;
  top: 9px;
  right: 4px;
  z-index: 2;
`

const pastePanelStyle = css`
  max-width: unset;
  --arcgis-paste-width: 100%;
  --arcgis-paste-height: 100%;
`

function CopyPastePanel (props: CopyPastePanelProps) {
  const { jimuMapView, editor, mapWidgetId, widgetId, formChange, onStepChange } = props

  const translate = hooks.useTranslation(jimuUiMessages, jimuCoreMessages, defaultMessages)

  const [step, setStep] = React.useState<PasteStep>('ready')
  const [pasteComponent, setPasteComponent] = React.useState<HTMLArcgisPasteElement>(null)
  const [clipboardItems, setClipboardItems] = React.useState<ClipboardItem[]>([])
  const [warningBeforePaste, setWarningBeforePaste] = React.useState<'paste' | 'pasteSpecial'>(null)
  const [selectedFeatures, setSelectedFeatures] = React.useState<Graphic[]>([])
  const [copying, setCopying] = React.useState(false)

  const copyFeatures = React.useCallback(async () => {
    const esriClipboard = pasteComponent?.clipboard
    if (!esriClipboard) return
    setCopying(true)
    try{
    const copyData: Array<{
        layer: ClipboardSupportedLayer
        graphic: Graphic
        type: 'feature' | 'string'
    }> = []
    const featureLayerMap = selectedFeatures.reduce((map, graphic) => {
      const layer = jimuMapView.jimuLayerViews[(graphic as any).jimuLayerViewId]?.layer as ClipboardSupportedLayer
      if (!layer) {
        return map
      }
      if (!map.get(layer)) {
        map.set(layer, [])
      }
      map.get(layer).push(graphic)
      return map
    }, new Map<GraphicLayer, Graphic[]>())
    const promises = Array.from(featureLayerMap.entries()).map(([layer, graphics]) => {
      const featureLayer = layer as FeatureLayer
      const ids = graphics.map(g => g.getObjectId() ?? g.getGlobalId()).filter(id => id !== undefined)
      if (ids.length === 0) {
        return Promise.resolve()
      }
      return featureLayer.queryFeatures({
        objectIds: ids,
        outFields: ['*'],
        returnGeometry: true,
        outSpatialReference: jimuMapView.view.spatialReference
      }).then(result => {
        const features = result.features
        return features
      }).catch(() => {
        console.error('Failed to query features for copy')
      })
    })
    const features = await Promise.allSettled(promises).then(results => {
      const allFeatures: Graphic[] = []
      results.forEach(res => {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          allFeatures.push(...res.value)
        }
      })
      return allFeatures
    })
    features.forEach((graphic) => {
      const layer = graphic.layer as ClipboardSupportedLayer
      if (!layer) return
      copyData.push({
        graphic,
        layer,
        type: 'feature',
      })
    })
    esriClipboard.setData(copyData)
    } catch (err) {
      console.error('Failed to copy features: ', err)
    } finally {
      setCopying(false)
    }
  }, [jimuMapView, pasteComponent?.clipboard, selectedFeatures])

  const layerPermissionsCheck = React.useMemo(() => ({
    canCreate: (layer: FeatureLayer | SubtypeGroupLayer) => {
      const layerInfos = editor?.layerInfos || []
      const layerInfo = layerInfos.find(l => l.layer?.id === layer?.id)
      return !layerInfo || layerInfo.addEnabled
    },
    canUpdate: (layer: FeatureLayer | SubtypeGroupLayer) => {
      const layerInfos = editor?.layerInfos || []
      const layerInfo = layerInfos.find(l => l.layer?.id === layer?.id)
      return !layerInfo || (layerInfo.updateEnabled && layerInfo.geometryUpdatesEnabled)
    },
  }), [editor?.layerInfos])

  const startPaste = React.useCallback((step: 'paste' | 'pasteSpecial') => {
    if (pasteComponent?.closed) {
      pasteComponent.closed = false
    }
    setStep(step)
  }, [pasteComponent])

  const handleConfirmStartPaste = React.useCallback(() => {
    if (warningBeforePaste) {
      startPaste(warningBeforePaste)
    }
    setWarningBeforePaste(null)
  }, [startPaste, warningBeforePaste])

  const handleCancelStartPaste = React.useCallback(() => {
    setWarningBeforePaste(null)
  }, [])

  const tryPasteWithAttributes = React.useCallback(() => {
    if (formChange) {
      setWarningBeforePaste('pasteSpecial')
    } else {
      startPaste('pasteSpecial')
    }
  }, [formChange, startPaste])

  const cancelPaste = React.useCallback(() => {
    setStep('ready')
  }, [])

  const updateDataSource = React.useCallback((
    result: ApplySetServiceEditResult | ApplySetLayerEditResult
  ) => {
    const layerFeaturesMap = new Map<ApplySetSupportedLayer, FeatureEditResult[]>()
    if (result.type === 'layer') {
      const addFeatureResults = result.edits.addFeatureResults
      const layer = result.layer
      layerFeaturesMap.set(layer, addFeatureResults)
    } else {
      const allJimuLayerViews = jimuMapView?.getAllJimuLayerViews()
      const serviceUrl = result.featureService.url
      for (const edit of result.edits) {
        const layerView = allJimuLayerViews.find(jlv => {
          const l = jlv.layer
          return l?.layerId === edit.id && l?.url && l.url.includes(serviceUrl)
        })
        if (!layerView) continue
        const addFeatureResults = edit.addFeatureResults
        layerFeaturesMap.set(layerView.layer, addFeatureResults)
      }
    }
    const promises = []
    layerFeaturesMap.forEach((features, layer) => {
      const dsId = jimuMapView.getDataSourceIdByAPILayer(layer)
      const ds = getDataSourceById(dsId)
      if (!ds) return
      promises.push(new Promise<void>((resolve, reject) => {
        const addIds = features.map(f => f.objectId ?? f.globalId)
        if (addIds.length > 0) {
          ds.query({
            objectIds: addIds,
            outFields: ['*'],
            returnGeometry: true
          }).then(result => {
            const records = (result?.records || []) as FeatureDataRecord[]
            const featurePromises = records.map(r => r.getJSAPIGraphic())
            Promise.all(featurePromises).then((addFeatures) => {
              updateDataSourceAfterEdit(ds, { addFeatures })
              ds.selectRecordsByIds(addIds, records)
            }).catch(() => {
              console.error('Failed to get added features graphics')
            })
            resolve()
          }).catch(() => {
            reject(new Error('Failed to query added features'))
          })
        } else {
          reject(new Error('No features to add'))
        }
      }))
    })
  }, [jimuMapView])

  const handleApplyPaste = React.useCallback((e: ArcgisPasteCustomEvent<{
    completionCallback?: Promise<{
        success: boolean
        errorCode?: string
        errorMessage?: string
    }> | Promise<void>
    applySet?: ApplySet
  }>) => {
    const promise = new Promise<void>((resolve, reject) => {
      try {
        const applySet = e.detail.applySet
        if (applySet) {
          pasteComponent.writeChanges(applySet)
          .then((result) => {
            if (Array.isArray(result)) {
              for (const res of result) {
                updateDataSource(res)
              }
            } else {
              updateDataSource(result)
            }
            setStep('ready')
            resolve()
          })
          .catch((err) => {
            reject(new Error('Failed to apply paste edits: ' + err.message))
            console.error(err)
          })
        } else {
          resolve()
        }
      } catch (err) {
        reject(new Error('Failed to save edits: ' + err.message))
      }
    })
    e.detail.completionCallback = promise
  }, [pasteComponent, updateDataSource])

  const handlePasteReady = React.useCallback((evt: ArcgisPasteCustomEvent<void>) => {
    const pasteComponent = evt.target
    setPasteComponent(pasteComponent)
  }, [])

  const prevJimuMapView = hooks.usePrevious(jimuMapView)
  const selectedFeaturesReqIdRef = React.useRef(0)
  React.useEffect(() => {
    // clear clipboard when changing map view
    if (prevJimuMapView !== jimuMapView && pasteComponent?.clipboard?.hasItems) {
      pasteComponent.clipboard.setData([])
    }
    // listen to selected features change
    const updateSelectedFeatures = async () => {
      if (jimuMapView) {
        const reqId = ++selectedFeaturesReqIdRef.current
        const features = await jimuMapView.getSelectedFeatures()
        if (reqId === selectedFeaturesReqIdRef.current) {
          setSelectedFeatures(features)
        }
      }
    }
    if (jimuMapView) {
      updateSelectedFeatures()
      jimuMapView.addJimuLayerViewSelectedFeaturesChangeListener(updateSelectedFeatures)
    }
    return () => {
      if (jimuMapView) {
        jimuMapView.removeJimuLayerViewSelectedFeaturesChangeListener(updateSelectedFeatures)
      }
    }
  }, [jimuMapView, pasteComponent, prevJimuMapView])

  // watch clipboard items change
  React.useEffect(() => {
    if (!pasteComponent) return
    const watchClipboard = reactiveUtils.watch(() => pasteComponent?.clipboard?.version, (version) => {
      const items = pasteComponent?.clipboard?.items
      setClipboardItems(items ? items.toArray() : [])
    })
    return () => {
      watchClipboard?.remove()
    }
  }, [pasteComponent])

  const requestControl = React.useCallback(async () => {
    const action = appActions.requestAutoControlMapWidget(mapWidgetId, widgetId)
    getAppStore().dispatch(action)
    jimuMapView.clearSelectedFeatures()
    const selectionToolbar = (editor as any)._selectionToolbar
    if (selectionToolbar?.activeOperation) {
      selectionToolbar.cancel?.()
    }
    if (pasteComponent) {
      await pasteComponent.showClipboardItems(true)
      await pasteComponent.startMoveClipboard(true)
    }
  }, [editor, jimuMapView, mapWidgetId, pasteComponent, widgetId])

  const releaseControl = React.useCallback(async () => {
    const action = appActions.releaseAutoControlMapWidget(mapWidgetId)
    getAppStore().dispatch(action)
    if (pasteComponent) {
      await pasteComponent.showClipboardItems(false)
      await pasteComponent.cancelMoveClipboard()
    }
  }, [mapWidgetId, pasteComponent])

  React.useEffect(() => {
    // update paste open for parent
    onStepChange(step)
    // manage map control
    if (step === 'ready') {
      releaseControl()
    } else {
      requestControl()
    }
  }, [onStepChange, releaseControl, requestControl, step])

  React.useEffect(() => {
    return () => {
      void releaseControl()
    }
  }, [releaseControl])

  const clipboardEmpty = !clipboardItems || clipboardItems.length === 0
  const noSelection = !Array.isArray(selectedFeatures) || selectedFeatures.length === 0
  const exceedMaxCount = Array.isArray(selectedFeatures) && selectedFeatures.length > 200
  const [unsupportedLayers, selectionFromMultiLayers] = React.useMemo(() => {
    const unsupportedLayers = []
    const uniqueLayers = []
    let selectionFromMultiLayers = false
    if (noSelection) return [unsupportedLayers, selectionFromMultiLayers]
    selectedFeatures.forEach((graphic) => {
      const layer = graphic?.layer
      const layerType = layer?.type
      if (layer && layerType && !['feature', 'subtype-group', 'subtype-sublayer'].includes(layerType)) {
        !unsupportedLayers.includes(layer) && unsupportedLayers.push(layer)
      }
      !uniqueLayers.includes(layer) && uniqueLayers.push(layer)
    })
    selectionFromMultiLayers = uniqueLayers.length >1
    return [unsupportedLayers, selectionFromMultiLayers]
  }, [noSelection, selectedFeatures])
  const unsupportedLayerNames = unsupportedLayers.map(l => l.title || l.id || '').join(', ')
  const hasUnsupportedLayers = unsupportedLayers.length > 0
  const disableCopy = noSelection || exceedMaxCount || selectionFromMultiLayers || hasUnsupportedLayers || copying
  let copyTooltip = translate('copy')
  if (noSelection || selectionFromMultiLayers) {
    copyTooltip = translate('canNotCopyMultipleLayers')
  } else if (exceedMaxCount) {
    copyTooltip = `${translate('maximum')}: 200`
  } else if (hasUnsupportedLayers) {
    copyTooltip = translate('copySupportedLayersOnly', { layers: unsupportedLayerNames })
  }

  return <React.Fragment>
    {pasteComponent && ['ready', 'paste'].includes(step) &&
      <div className='copy-paste-tool' css={copyPasteToolStyle}>
        {step === 'ready' && <React.Fragment>
          <calcite-action
            id={`${widgetId}-editor-copy`}
            icon='copy'
            text=''
            loading={copying}
            disabled={disableCopy}
            aria-label={translate('copy')}
            onClick={copyFeatures}
          ></calcite-action>
          <calcite-tooltip reference-element={`${widgetId}-editor-copy`} placement='bottom'>
            <span>{copyTooltip}</span>
          </calcite-tooltip>
          <calcite-action
            id={`${widgetId}-editor-paste`}
            icon='paste-with-attribute'
            text=''
            disabled={clipboardEmpty}
            aria-label={translate('paste')}
            onClick={tryPasteWithAttributes}
          ></calcite-action>
          <calcite-tooltip reference-element={`${widgetId}-editor-paste`} placement='bottom'>
            <span>{translate('paste')}</span>
          </calcite-tooltip>
        </React.Fragment>}
      </div>
    }
    <arcgis-paste
      view={jimuMapView?.view}
      alwaysShowFeatureForm
      pasteWithMultipleLayersEnabled={false}
      pasteWithMultipleFeaturesEnabled
      maximumFeatureCount={200}
      supportedCommands={['paste', 'paste-as']}
      hideHeaderCloseButton
      layerPermissionsCheck={layerPermissionsCheck}
      className={classNames('w-100 h-100', {'d-none': step !== 'pasteSpecial'})}
      css={pastePanelStyle}
      onarcgisReady={handlePasteReady}
      onarcgisApplyPasteCommand={handleApplyPaste}
      onarcgisClose={cancelPaste}
    >
      <calcite-action
        slot='home-header-actions-start'
        icon='chevron-left'
        text=''
        title={translate('back')}
        aria-label={translate('back')}
        iconFlipRtl
        onClick={cancelPaste}
      ></calcite-action>
      <calcite-notice slot='commands-page-message' className='mt-4' open icon="move">
        <div slot="message">{translate('moveClipboardFeatures')}</div>
      </calcite-notice>
    </arcgis-paste>
    {warningBeforePaste &&
      <ConfirmDialog
        level='warning'
        title={translate('selectionChangeConfirmTitle')}
        hasNotShowAgainOption={false}
        content={translate('selectionChangeConfirmTips')}
        confirmLabel={translate('discardConfirm')}
        cancelLabel={translate('discardCancel')}
        onConfirm={handleConfirmStartPaste}
        onClose={handleCancelStartPaste}
      />
    }
  </React.Fragment>
}

export default CopyPastePanel
