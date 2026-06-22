import { React, type DataSource, type DataSourceConstructorOptions, DataSourceManager, DataSourcesChangeMessage, DataSourcesChangeType, Immutable, loadArcGISJSAPIModules, MessageManager, MutableStoreManager, type ServiceDefinition, ServiceManager, SupportedLayerServiceTypes, ExportFormat, type SetDataSourceMixin, type IMDataSourceJson, type DataSourceJson, DataSourceTypes } from 'jimu-core'
import type { FeatureLayerDataSourceConstructorOptions } from 'jimu-data-source'
import type { DataOptions } from './types'
import type { IMConfig } from '../config'
import {
  applyFeatureCollectionToChildDataSources,
  applyGroupLayerForChildDataSourceJsons,
  clearFeatureCollectionCache,
  extractFeatureCollectionDataFromChildDataSourceJsons
} from './kml-utils'

export function getDataSource (id: string): DataSource {
  return DataSourceManager.getInstance().getDataSource(id)
}

export function publishDataSourcesChangeMessage (widgetId: string, type: DataSourcesChangeType, dataSources: DataSource[]) {
  const dataSourcesChangeMessage = new DataSourcesChangeMessage(widgetId, type, dataSources)
  MessageManager.getInstance().publishMessage(dataSourcesChangeMessage)
}

const addExportSettingsForDataOptions = (multiDataOptions: DataOptions[], config: IMConfig) => {
  return multiDataOptions.map((option) => {
    const dsJson = { ...option.dataSourceJson }
    dsJson.disableExport = config.disableExport
    if (!dsJson.disableExport) {
      dsJson.exportOptions = {
        formats: Object.values(ExportFormat).filter((f) => !config.notAllowedExportFormat?.includes(f))
      }
    }
    return {
      ...option,
      dataSourceJson: dsJson
    }
  })
}

const updateExportSettingForChildDataSources = (ds: DataSource & SetDataSourceMixin) => {
  const dsJson = ds.getDataSourceJson()
  const childDss = ds.getAllChildDataSources?.()
  if (childDss?.length > 0) {
    childDss.forEach((childDs) => {
      const childJson = childDs.getDataSourceJson()
      const childJsonWithoutData = typeof childJson?.without === 'function' ? childJson.without('data') : childJson
      const nextChildJson = childJsonWithoutData
        .set('disableExport', dsJson.disableExport)
        .set('exportOptions', dsJson.exportOptions)
      DataSourceManager.getInstance().updateDataSourceByDataSourceJson(childDs, nextChildJson)
    })
  }
}

export async function createDataSourcesByDataOptions (multiDataOptions: DataOptions[], widgetId: string, config: IMConfig, publishMessage = true): Promise<DataSource[]> {
  if (!multiDataOptions || multiDataOptions.length === 0) {
    return Promise.resolve([])
  }

  let FeatureLayer: typeof __esri.FeatureLayer
  let Graphic: typeof __esri.Graphic
  let Field: typeof __esri.Field
  let jsonUtils: typeof __esri.supportJsonUtils
  if (multiDataOptions.some(o => o.restLayer)) {
    const apiModules = await loadArcGISJSAPIModules(['esri/layers/FeatureLayer', 'esri/Graphic', 'esri/layers/support/Field', 'esri/renderers/support/jsonUtils'])
    FeatureLayer = apiModules[0]
    Graphic = apiModules[1]
    Field = apiModules[2]
    jsonUtils = apiModules[3]
  }

  const dataOptions = addExportSettingsForDataOptions(multiDataOptions, config)

  const featureLayerOptions: FeatureLayerDataSourceConstructorOptions[] = []
  const dataSourceConstructorOptions: DataSourceConstructorOptions[] = dataOptions.map(o => {
    if (o.restLayer && FeatureLayer && Graphic && Field && jsonUtils) {
      const renderer = o.restLayer.layerDefinition?.drawingInfo?.renderer
      const option = {
        id: o.dataSourceJson.id,
        dataSourceJson: Immutable(o.dataSourceJson),
        layer: new FeatureLayer({
          source: o.restLayer.featureSet?.features?.map(f => Graphic.fromJSON(f)) || [],
          objectIdField: o.restLayer.layerDefinition?.objectIdField,
          fields: o.restLayer.layerDefinition?.fields?.map(f => Field.fromJSON(f)),
          sourceJSON: o.restLayer.layerDefinition,
          title: o.dataSourceJson.label || o.dataSourceJson.sourceLabel,
          renderer: renderer ? jsonUtils.fromJSON(renderer) : undefined
        })
      } as FeatureLayerDataSourceConstructorOptions
      featureLayerOptions.push(option)
      return option as DataSourceConstructorOptions
    }
    const dataSourceJson = o.dataSourceJson as DataSourceJson
    // KML group layers embed feature collection data in child dataSourceJsons.
    // Strip heavy data before Immutable and pass itemData for later group layer creation.
    const { dataSourceJson: strippedJson, itemData: extractedItemData } = extractFeatureCollectionDataFromChildDataSourceJsons(dataSourceJson)
    return ({
      id: strippedJson.id,
      dataSourceJson: Immutable(strippedJson),
      itemData: extractedItemData
    } as DataSourceConstructorOptions)
  })

  // Capabilities of the client-side layer will be changed after load. Need to set it back.
  await Promise.allSettled(featureLayerOptions.filter(o => o.layer).map(async (o) => {
    const capabilitiesBeforeLoad = (o.layer as __esri.FeatureLayer).sourceJSON?.capabilities
    if (capabilitiesBeforeLoad) {
      await o.layer.load()
      ;(o.layer as __esri.FeatureLayer).sourceJSON.capabilities = capabilitiesBeforeLoad
    }
  }))

  return Promise.allSettled(dataSourceConstructorOptions.map(async (o) => {
    const ds = await DataSourceManager.getInstance().createDataSource(o)
    const dsJson = (o as any).dataSourceJson as IMDataSourceJson
    const isRuntimeGroupLayer = dsJson?.type === DataSourceTypes.GroupLayer && dsJson?.childDataSourceJsons && !dsJson?.url && !dsJson?.itemId
    if (isRuntimeGroupLayer) {
      // Attach a JSAPI GroupLayer early so child data sources can be created from it.
      await applyGroupLayerForChildDataSourceJsons(ds as DataSource & SetDataSourceMixin)
    }
    if (ds.isDataSourceSet() && !ds.areChildDataSourcesCreated()) {
      await ds.childDataSourcesReady()
    }
    return ds
  }))
    .then(res => res.filter(r => r.status === 'fulfilled').map(r => (r as unknown as PromiseFulfilledResult<DataSource>).value))
    .then(async dataSources => {
      dataSources.forEach((ds: DataSource & SetDataSourceMixin) => {
        applyFeatureCollectionToChildDataSources(ds)
      })
      // Ensure KML group layers get a JSAPI GroupLayer for add-to-map.
      await Promise.allSettled(dataSources.map(ds => applyGroupLayerForChildDataSourceJsons(ds as DataSource & SetDataSourceMixin)))
      dataSources.forEach((ds: DataSource & SetDataSourceMixin) => {
        updateExportSettingForChildDataSources(ds)
      })
      // publish message
      if (publishMessage && dataSources.length > 0) {
        publishDataSourcesChangeMessage(widgetId, DataSourcesChangeType.Create, dataSources)
      }

      if (dataSources.length < multiDataOptions.length) {
        return Promise.reject(new Error('Failed to create some data source.'))
      }

      return dataSources
    })
}

export async function updateDataSourcesByDataOptions (multiDataOptions: DataOptions[]): Promise<void> {
  if (!multiDataOptions || multiDataOptions.length === 0) {
    return Promise.resolve()
  }

  return Promise.resolve().then(() => {
    // TODO: need to publish message to tell framework data source is updated?
    multiDataOptions.forEach(d => {
      const ds = getDataSource(d.dataSourceJson.id)
      if (ds) {
        DataSourceManager.getInstance().updateDataSourceByDataSourceJson(ds, Immutable(d.dataSourceJson))
        updateExportSettingForChildDataSources(ds as DataSource & SetDataSourceMixin)
      }
    })
  })
}

export function destroyDataSourcesById (ids: string[], widgetId: string, publishMessage = true): Promise<void> {
  const dataSources = ids.map(id => getDataSource(id)).filter(ds => !!ds)
  // publish message
  if (publishMessage && dataSources.length > 0) {
    publishDataSourcesChangeMessage(widgetId, DataSourcesChangeType.Remove, dataSources)
  }

  return Promise.resolve().then(() => {
    clearFeatureCollectionCache(dataSources)
    ids.forEach(id => {
      // Remove filter actions.
      MutableStoreManager.getInstance().updateStateValue('setFilter', id, null)
      DataSourceManager.getInstance().destroyDataSource(id)
    })
  })
}

export function preventDefault (evt: React.MouseEvent<HTMLDivElement>) {
  evt.stopPropagation()
  evt.preventDefault()
  evt.nativeEvent?.stopImmediatePropagation()
}

export function usePrevious <T> (state: T): T | undefined {
  const prevRef = React.useRef<T>(null)
  const curRef = React.useRef<T>(null)

  if (!Object.is(curRef.current, state)) {
    prevRef.current = curRef.current
    curRef.current = state
  }

  return prevRef.current
}

export function getNextAddedDataId (widgetId: string, order: number): string {
  // Use time stamp since if one data is loading (the data source json hasn't been created yet) and user adds another data at the same time, the data source id will be duplicated.
  return `add-data-${widgetId}-${order}-${new Date().getTime()}`
}

export function getLayerUrlByServiceDefinition (serviceUrl: string, serviceDefinition: ServiceDefinition) {
  const layers = (serviceDefinition?.layers || []).concat(serviceDefinition?.tables || [])
  const layerId = `${layers[0]?.id || 0}`
  return `${serviceUrl}/${layerId}`
}

export async function getLayerInfoFromSingleLayerFeatureService (serviceUrl: string, serviceDefinition: ServiceDefinition) {
  const layers = (serviceDefinition?.layers || []).concat(serviceDefinition?.tables || [])
  // If the single layer is not feature layer or table, will still create feature service data source.
  if (layers.length === 1 && ((serviceDefinition?.layers?.length === 1 && serviceDefinition?.layers?.[0]?.type === SupportedLayerServiceTypes.FeatureLayer) || (serviceDefinition?.tables?.length === 1))) {
    const url = getLayerUrlByServiceDefinition(serviceUrl, serviceDefinition)
    const layerDefinition = await ServiceManager.getInstance().fetchServiceInfo(url).then(res => res.definition)
    return { url, layerDefinition }
  }
  return null
}

export function isIOSDevice () {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent)
}

export const updateExportSettingForDataSources = (multiDataOptions: DataOptions[], config: IMConfig) => {
  updateDataSourcesByDataOptions(addExportSettingsForDataOptions(multiDataOptions, config))
}
