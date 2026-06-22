import {
  type ArcGISQueriableDataSource,
  type DataSource,
  type DataSourceJson,
  DataSourceTypes,
  type GroupLayerDataSource,
  type IMDataSourceJson,
  loadArcGISJSAPIModules,
  type SetDataSourceMixin
} from 'jimu-core'

interface FeatureCollectionLayerData { layerDefinition: any, featureSet: any, popupInfo?: any }
interface FeatureCollectionItemData { layers: FeatureCollectionLayerData[] }
interface ItemInfoSetter { setItemInfo?: (itemInfo: any) => void }

// Cache item/child data stripped from dataSourceJson so we can rebuild layers without deep Immutable.
const featureCollectionItemDataByGroupId = new Map<string, FeatureCollectionItemData>()
const featureCollectionLayerDataByChildId = new Map<string, FeatureCollectionLayerData>()

const isFeatureCollectionLayerData = (value: unknown): value is FeatureCollectionLayerData => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const typedValue = value as FeatureCollectionLayerData
  return !!typedValue.layerDefinition && !!typedValue.featureSet
}

// Mark group layer as feature collection so child creation uses the item-data path.
export const setFeatureCollectionItemInfo = (groupDs: GroupLayerDataSource & ItemInfoSetter, childCount: number) => {
  groupDs.setItemInfo?.({
    type: 'Feature Collection',
    typeKeywords: childCount === 1 ? ['Singlelayer'] : []
  })
}

const toMutableFeature = (feature: any) => {
  if (!feature) {
    return feature
  }
  return {
    ...feature,
    attributes: { ...(feature.attributes || {}) },
    geometry: feature.geometry
      ? {
          ...feature.geometry,
          spatialReference: feature.geometry.spatialReference ? { ...feature.geometry.spatialReference } : feature.geometry.spatialReference
        }
      : feature.geometry
  }
}

export const getItemDataFromChildDataSourceJsons = (dsJson: IMDataSourceJson | DataSourceJson): FeatureCollectionItemData | null => {
  const childDataSourceJsons = dsJson?.childDataSourceJsons
  if (!childDataSourceJsons) {
    return null
  }

  const layers: FeatureCollectionLayerData[] = []

  const collectLayers = (childJsons: { [key: string]: any }) => {
    Object.values(childJsons).forEach(childJson => {
      if (childJson?.childDataSourceJsons) {
        collectLayers(childJson.childDataSourceJsons)
        return
      }
      const layerData = Array.isArray(childJson?.data) ? childJson.data[0] : null
      if (!layerData?.layerDefinition || !layerData?.featureSet) {
        return
      }
      layers.push({
        layerDefinition: layerData.layerDefinition,
        featureSet: layerData.featureSet,
        popupInfo: layerData.popupInfo
      })
    })
  }

  collectLayers(childDataSourceJsons)

  return layers.length ? { layers } : null
}

// Extract layerDefinition/featureSet from child ds JSONs and strip heavy data for Immutable.
export const extractFeatureCollectionDataFromChildDataSourceJsons = (dsJson: DataSourceJson) => {
  const childDataSourceJsons = dsJson?.childDataSourceJsons
  if (!childDataSourceJsons) {
    return { dataSourceJson: dsJson, itemData: null }
  }

  const layers: FeatureCollectionLayerData[] = []

  const stripChildJsons = (childJsons: { [key: string]: any }) => {
    const stripped = {}
    Object.keys(childJsons).forEach((jimuChildId) => {
      const childJson = childJsons[jimuChildId]
      if (childJson?.childDataSourceJsons) {
        stripped[jimuChildId] = {
          ...childJson,
          childDataSourceJsons: stripChildJsons(childJson.childDataSourceJsons)
        }
        return
      }
      const layerData = Array.isArray(childJson?.data) ? childJson.data[0] : null
      if (isFeatureCollectionLayerData(layerData)) {
        layers.push({
          layerDefinition: layerData.layerDefinition,
          featureSet: layerData.featureSet,
          popupInfo: layerData.popupInfo
        })
        if (childJson?.id) {
          featureCollectionLayerDataByChildId.set(childJson.id, layerData)
        }
      }

      if (childJson) {
        const { data, ...rest } = childJson
        stripped[jimuChildId] = rest
      }
    })
    return stripped
  }

  const strippedChildDataSourceJsons = stripChildJsons(childDataSourceJsons)

  if (!layers.length) {
    return { dataSourceJson: dsJson, itemData: null }
  }

  const itemData = { layers }
  if (dsJson?.id) {
    featureCollectionItemDataByGroupId.set(dsJson.id, itemData)
  }

  return {
    dataSourceJson: {
      ...dsJson,
      childDataSourceJsons: strippedChildDataSourceJsons
    },
    itemData
  }
}

// Rehydrate child data sources from cached feature collection data.
export const applyFeatureCollectionToChildDataSources = (ds: DataSource & SetDataSourceMixin) => {
  if (!ds?.isDataSourceSet?.()) {
    return
  }

  const dsJson = ds.getDataSourceJson()
  const childDataSourceJsons = dsJson?.childDataSourceJsons
  if (!childDataSourceJsons) {
    return
  }

  ds.getChildDataSources().forEach(childDs => {
    const jimuChildId = childDs.jimuChildId
    const childJson = jimuChildId ? childDataSourceJsons[jimuChildId] : null
    const layerDataFromJson = Array.isArray(childJson?.data) ? childJson.data[0] : null
    // Prefer in-JSON data, otherwise fall back to cached feature collection data.
    const layerData = (isFeatureCollectionLayerData(layerDataFromJson) ? layerDataFromJson : null) || featureCollectionLayerDataByChildId.get(childDs.id)
    const hasCachedLayerData = featureCollectionLayerDataByChildId.has(childDs.id)
    if (!layerData || (!childJson?.isDataInDataSourceInstance && !hasCachedLayerData)) {
      return
    }
    hydrateFeatureCollectionChildDataSource(childDs, layerData)
  })
}

const hydrateFeatureCollectionChildDataSource = (childDs: DataSource, layerDataOverride?: FeatureCollectionLayerData) => {
  if (!childDs) {
    return
  }
  const layerData = layerDataOverride || featureCollectionLayerDataByChildId.get(childDs.id) ||
    (Array.isArray((childDs as any)?.getDataSourceJson?.()?.data) ? (childDs as any).getDataSourceJson().data[0] : null)
  if (!isFeatureCollectionLayerData(layerData)) {
    return
  }
  const featureDs = childDs as ArcGISQueriableDataSource
  if (typeof featureDs.setLayerDefinition !== 'function' || typeof featureDs.setSourceRecords !== 'function') {
    return
  }
  featureDs.setLayerDefinition(layerData.layerDefinition)
  if (layerData.popupInfo && typeof featureDs.setPopupInfo === 'function') {
    featureDs.setPopupInfo(layerData.popupInfo)
  }
  // Build records from raw features without mutating immutable inputs.
  const records = (layerData.featureSet?.features || []).map(f => featureDs.buildRecord(toMutableFeature(f)))
  featureDs.setSourceRecords(records)
}

interface FeatureLayerModules {
  FeatureLayer: typeof __esri.FeatureLayer
  Graphic: typeof __esri.Graphic
  Field: typeof __esri.Field
  jsonUtils: typeof __esri.supportJsonUtils
}

const createFeatureLayerFromLayerData = (
  modules: FeatureLayerModules,
  layerData: FeatureCollectionLayerData,
  title: string,
  layerId?: string
) => {
  const { FeatureLayer, Graphic, Field, jsonUtils } = modules
  const layerDefinition = layerData?.layerDefinition
  const featureSet = layerData?.featureSet
  if (!layerDefinition) {
    return null
  }
  const renderer = layerDefinition?.drawingInfo?.renderer
  return new FeatureLayer({
    id: layerId,
    source: featureSet?.features?.map(f => Graphic.fromJSON(f)) || [],
    objectIdField: layerDefinition?.objectIdField,
    fields: layerDefinition?.fields?.map(f => Field.fromJSON(f)),
    sourceJSON: layerDefinition,
    title: layerDefinition?.name || title,
    renderer: renderer ? jsonUtils.fromJSON(renderer) : undefined
  })
}

type JsApiLayerModules = [
  typeof __esri.GroupLayer,
  typeof __esri.FeatureLayer,
  typeof __esri.Graphic,
  typeof __esri.Field,
  typeof __esri.supportJsonUtils
]

// Rebuild a JSAPI GroupLayer directly from dataSourceJson to avoid relying on child DS creation.
const createGroupLayerFromDataSourceJson = async (dsJson: IMDataSourceJson | DataSourceJson, modules: JsApiLayerModules): Promise<__esri.GroupLayer> => {
  const [GroupLayer, FeatureLayer, Graphic, Field, jsonUtils] = modules
  const featureLayerModules = { FeatureLayer, Graphic, Field, jsonUtils }
  const childJsons = dsJson?.childDataSourceJsons || {}

  const childLayers = await Promise.all(Object.entries(childJsons).map(async ([jimuChildId, childJson]: [string, any]) => {
    if (!childJson) {
      return null
    }

    const childLayerId = jimuChildId || childJson?.layerId || childJson?.id

    if (childJson?.type === DataSourceTypes.GroupLayer || childJson?.childDataSourceJsons) {
      // Recurse through nested KML folders.
      const groupLayer = await createGroupLayerFromDataSourceJson(childJson, modules)
      if (groupLayer && childLayerId) {
        groupLayer.id = childLayerId
      }
      return groupLayer
    }

    // Leaf feature layer: use cached feature collection data (or embedded data in JSON).
    const layerData = featureCollectionLayerDataByChildId.get(childJson.id) || (Array.isArray(childJson?.data) ? childJson.data[0] : null)
    if (!isFeatureCollectionLayerData(layerData)) {
      return null
    }
    const childTitle = childJson.label || childJson.sourceLabel
    return createFeatureLayerFromLayerData(featureLayerModules, layerData, childTitle, childLayerId)
  }))

  // Always return a GroupLayer so zoom-to can use it as a valid target.
  const layers = childLayers.filter(Boolean)
  return new GroupLayer({
    title: dsJson?.label || dsJson?.sourceLabel,
    layers
  })
}

// Build a JSAPI GroupLayer by walking the KML child dataSourceJsons to preserve hierarchy.
const createGroupLayerFromDataSource = async (ds: DataSource & SetDataSourceMixin): Promise<__esri.GroupLayer> => {
  const modules = await loadArcGISJSAPIModules([
    'esri/layers/GroupLayer',
    'esri/layers/FeatureLayer',
    'esri/Graphic',
    'esri/layers/support/Field',
    'esri/renderers/support/jsonUtils'
  ]) as JsApiLayerModules

  return createGroupLayerFromDataSourceJson(ds.getDataSourceJson(), modules)
}

// Attach a JSAPI GroupLayer and create a fresh layer per add-to-map call.
export const applyGroupLayerForChildDataSourceJsons = async (ds: DataSource & SetDataSourceMixin) => {
  if (!ds?.isDataSourceSet?.()) {
    return
  }

  const dsJson = ds.getDataSourceJson()
  if (dsJson?.type !== DataSourceTypes.GroupLayer || dsJson?.url || dsJson?.itemId) {
    return
  }

  const itemData = featureCollectionItemDataByGroupId.get(ds.id) || getItemDataFromChildDataSourceJsons(dsJson)
  const groupDs = ds as GroupLayerDataSource & ItemInfoSetter
  setFeatureCollectionItemInfo(groupDs, itemData?.layers?.length || ds.getChildDataSources().length)

  // Build the runtime JSAPI GroupLayer from dataSourceJson, not from child data sources.
  const groupLayer = await createGroupLayerFromDataSource(ds)
  if (!groupLayer) {
    return
  }

  // Tag the layer with the data source id so runtime layer-id mapping can stop at the correct root.
  ;(groupDs as any).setJimuChildIdAsLayerId?.(groupLayer, groupDs)

  groupDs.layer = groupLayer
  groupDs.createJSAPILayerByDataSource = () => {
    return createGroupLayerFromDataSource(ds).then((layer) => {
      ;(groupDs as any).setJimuChildIdAsLayerId?.(layer, groupDs)
      return layer
    })
  }

  // Ensure lazily created child data sources get feature collection records
  // when leaf layers are created later via map-layer actions.
  const patchKey = '__exb_kml_child_ds_hydrate_patched__'
  const anyGroupDs = groupDs as any
  if (!anyGroupDs[patchKey] && typeof anyGroupDs.createChildDataSourceById === 'function') {
    const originalCreateChild = anyGroupDs.createChildDataSourceById.bind(groupDs)
    anyGroupDs[patchKey] = true
    anyGroupDs.createChildDataSourceById = async (...args) => {
      const childDs = await originalCreateChild(...args)
      const childDsJson = childDs?.getDataSourceJson?.()
      const isChildGroupLayer = childDs?.isDataSourceSet?.() && childDsJson?.type === DataSourceTypes.GroupLayer && !childDsJson?.url && !childDsJson?.itemId
      if (isChildGroupLayer) {
        await applyGroupLayerForChildDataSourceJsons(childDs as DataSource & SetDataSourceMixin)
        applyFeatureCollectionToChildDataSources(childDs as DataSource & SetDataSourceMixin)
      } else {
        hydrateFeatureCollectionChildDataSource(childDs)
      }
      applyFeatureCollectionToChildDataSources(groupDs)
      return childDs
    }
  }
}

// Clean caches when data sources are destroyed.
export const clearFeatureCollectionCache = (dataSources: DataSource[]) => {
  dataSources.forEach(ds => {
    if (ds.isDataSourceSet()) {
      ds.getAllChildDataSources().forEach(childDs => {
        featureCollectionLayerDataByChildId.delete(childDs.id)
      })
    }
  })
  dataSources.forEach(ds => {
    featureCollectionItemDataByGroupId.delete(ds.id)
  })
}
