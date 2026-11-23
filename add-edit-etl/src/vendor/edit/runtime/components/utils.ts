import {
  dataSourceUtils, esri, type ImmutableArray, privilegeUtils, ServiceManager, SessionManager,
  type SubtypeSublayerDataSource, type ArcGISQueriableDataSource, type FeatureDataRecord,
  type FeatureLayerDataSource, type DataSource, ExBAddedJSAPIProperties, type DataRecord,
  css, React
} from 'jimu-core'
import { hooks as uiHooks } from 'jimu-ui'
import type { JimuMapView, JimuLayerView } from 'jimu-arcgis'
import type { IItem } from '@esri/arcgis-rest-portal'
import Query from '@arcgis/core/rest/support/Query'
import FieldElement from '@arcgis/core/form/elements/FieldElement'
import GroupElement from '@arcgis/core/form/elements/GroupElement'
import FormTemplate from '@arcgis/core/form/FormTemplate'
import ExpressionInfo from '@arcgis/core/form/ExpressionInfo'
import type { LayerInfo as EditorLayerInfo } from '@arcgis/core/widgets/Editor/types'
import type Graphic from '@arcgis/core/Graphic'
import type { Edits } from '@arcgis/core/editing/types'
import type FeatureLayer from '@arcgis/core/layers/FeatureLayer'
import type SubtypeSublayer from '@arcgis/core/layers/support/SubtypeSublayer'
import type FeatureSet from '@arcgis/core/rest/support/FeatureSet'
import type FeatureTemplate from '@arcgis/core/layers/support/FeatureTemplate'
import type SharedTemplate from '@arcgis/core/editing/sharedTemplates/SharedTemplate'
import type Field from '@arcgis/core/layers/support/Field'
import { type LayersConfig, type TreeFields, LayerHonorModeType } from '../../config'
import { type SupportedLayer, type SupportedDataSource, constructConfig, getEditHiddenFields, getDsPrivileges, getFlatFormElements } from '../../utils'
import type { LayerInfo } from './feature-form-component'
import { useTheme } from 'jimu-theme'

export interface EditFeatures {
  [dsId: string]: FeatureDataRecord[]
}

export const flatMapArray = (editFeatures: EditFeatures) => {
  // flat editFeatures
  const flatEditFeatures: FeatureDataRecord[] = []
  for (const dsId in editFeatures) {
    if (editFeatures?.[dsId]) {
      flatEditFeatures.push(...editFeatures[dsId])
    }
  }
  return flatEditFeatures
}

export const flatMapArrayWithView = (editFeatures: EditFeatures, jimuMapView: JimuMapView) => {
  const flatEditFeatures: FeatureDataRecord[] = []
  const mapDsId = jimuMapView?.dataSourceId
  for (const dsId in editFeatures) {
    if (dsId.indexOf(mapDsId) === 0 && editFeatures?.[dsId]) {
      flatEditFeatures.push(...editFeatures[dsId])
    }
  }
  return flatEditFeatures
}

export function isEditableLayerView (
  layerView: JimuLayerView,
  customizeLayers: boolean,
  customJimuLayerViewIds: ImmutableArray<string>,
  liveDataEditing: boolean
) {
  const layer = layerView.layer
  const hasUrl = !!layer.url
  const isDrawMeasurements = layer.id.toString().includes('jimu-draw-measurements-layer')
  const notEditable = layer[ExBAddedJSAPIProperties.EXB_NOT_EDITABLE]
  const isFromRuntime = layerView.fromRuntime
  let shouldShow
  if (isFromRuntime) {
    shouldShow = liveDataEditing
  } else {
    shouldShow = customizeLayers ? customJimuLayerViewIds.includes(layerView.id) : true
  }
  const isVisible = layerView.isLayerVisible()
  return hasUrl && !isDrawMeasurements && !notEditable && shouldShow && isVisible
}

export const getDsAccessibleInfo = async (url: string) => {
  if (!url) return false
  const request = esri.restRequest.request
  try {
    const info = await request(`${url}?f=json`)
    if (Object.keys(info).includes('error')) {
      return false
    } else {
      return true
    }
  } catch (err) {
    return false
  }
}

export const getPrivilege = async () => {
  const exbAccess = await privilegeUtils.checkExbAccess(privilegeUtils.CheckTarget.Experience)
  return exbAccess?.capabilities?.canEditFeature
}

export const getIsAdvancedPermission = async (dataSource: SupportedDataSource): Promise<boolean> => {
  const layerItemInfo = await dataSource?.fetchItemInfo().then((info: IItem) => {
    return info
  }).catch(err => {
    console.error(err)
  })
  if (!layerItemInfo || !layerItemInfo.url) return false
  // user is admin/owner, or user and item are in the same update org
  // If there is no portalUrl, it means it's non-hosted (sampleServer6)
  const portalUrl = (await ServiceManager.getInstance().fetchArcGISServerInfo(layerItemInfo.url))?.owningSystemUrl
  if (!portalUrl) return false
  const sessionForItem = SessionManager.getInstance().getSessionByUrl(portalUrl)
  // If there is no session, it means there was no pop-up login
  if (!sessionForItem) return false
  const user = await sessionForItem.getUser()
  const isAdmin = user?.role === 'org_admin'
  const isOrgItem = layerItemInfo?.isOrgItem
  // Grants the ability to update and categorize content in the organization and edit hosted feature layers in your organization.
  const hasUpdateItems = (user?.privileges || []).includes('portal:admin:updateItems')
  const allowAdminEdit = isAdmin && isOrgItem && hasUpdateItems
  const isOwner = layerItemInfo.owner === user?.username
  const isInUpdatedGroup = await privilegeUtils.isItemInTheUpdatedGroup(layerItemInfo.id, sessionForItem)
  return allowAdminEdit || isOwner || isInUpdatedGroup
}

export const getTimezone = (dataSource: SupportedDataSource) => {
  return dataSourceUtils.getTimezoneAPIFromRuntime(dataSource.getTimezone())
}

export const idsArrayEquals = (selection: ImmutableArray<string|number> | Array<string|number>, preSelection: ImmutableArray<string|number> | Array<string|number>) => {
  return Array.isArray(selection) &&
    Array.isArray(preSelection) &&
    selection.length === preSelection.length &&
    selection.every((v, i) => preSelection[i] === v)
}

export const getDisplayField = (dataSource: SupportedDataSource) => {
  const layerDefinition = dataSource?.getLayerDefinition()
  const belongToLayerDefinition = (dataSource.belongToDataSource as ArcGISQueriableDataSource)?.getLayerDefinition()
  const displayField = layerDefinition?.displayField ||
    belongToLayerDefinition?.displayField
  return displayField
}

export const useFeatureTitle = (record: FeatureDataRecord, dataSource: FeatureLayerDataSource | SubtypeSublayerDataSource) => {
  const records = React.useMemo(() => record ? [record] : [], [record])
  const featureTitleMap = useFeatureTitleMap(records, dataSource)
  const id = record?.getId()
  return featureTitleMap.get(id) || ''
}

function buildFeatureTitleMap (
  records: FeatureDataRecord[],
  titles: Map<number | string, string> | undefined,
  dataSource: FeatureLayerDataSource | SubtypeSublayerDataSource
) {
  const displayField = getDisplayField(dataSource)
  const map = new Map<number | string, string>()
  records.forEach((record) => {
    if (!record) return
    const id = record.getId()
    let title = titles?.get(id)
    if (!title || title === '') {
      title = record.getFieldValue(displayField) || record.getId() || ''
    }
    if (title && !map.get(id)) {
      map.set(id, title)
    }
  })
  return map
}

export const useFeatureTitleMap = (records: FeatureDataRecord[], dataSource: FeatureLayerDataSource | SubtypeSublayerDataSource) => {
  const [featureTitleMap, setFeatureTitleMap] = React.useState(new Map<number | string, string>())

  React.useEffect(() => {
    if (!dataSource || records.length === 0) {
      setFeatureTitleMap(new Map())
      return
    }
    const layer = dataSource.layer as any
    const features = records.map(r => r.feature as Graphic)
    if (typeof layer?.getFeatureTitles === 'function') {
      layer.getFeatureTitles(features, {
        fetchMissingFields: true,
        removeHTML: true,
      }).then((titles: Map<number | string, string>) => {
        setFeatureTitleMap(buildFeatureTitleMap(records, titles, dataSource))
      }).catch(() => {
        setFeatureTitleMap(buildFeatureTitleMap(records, undefined, dataSource))
      })
    } else {
      setFeatureTitleMap(buildFeatureTitleMap(records, undefined, dataSource))
    }
  }, [dataSource, records])
  return featureTitleMap
}

export const constructUneditableInfo = (layer: SupportedLayer) => {
  return {
    layer,
    enabled: false,
    addEnabled: false,
    updateEnabled: false,
    deleteEnabled: false,
    attributeUpdatesEnabled: false,
    geometryUpdatesEnabled: false,
    attachmentsOnUpdateEnabled: false,
  } as EditorLayerInfo
}

export const constructFormElements = (groupedFields: TreeFields[], hiddenFields: string[], fieldElements: FieldElement[]): Array<FieldElement | GroupElement> => {
  const elements = groupedFields.filter(f => !hiddenFields.includes(f.jimuName)).map(item => {
    if (item.children) {
      return new GroupElement({
        label: item.name,
        description: item.subDescription || item?.description,
        elements: item.children.filter(f => !hiddenFields.includes(f.jimuName)).map(ele => {
          const existElement = fieldElements.find(e => e.fieldName === ele.jimuName)
          const fieldElement = existElement ? existElement.clone() : new FieldElement({
            fieldName: ele.jimuName,
            label: ele.alias || ele.name
          })
          fieldElement.description = ele.subDescription || ele.description
          fieldElement.editableExpression = ele.editAuthority && !fieldElement.valueExpression ? 'editableTrue' : 'editableFalse'
          return fieldElement
        })
      })
    } else {
      const existElement = fieldElements.find(e => e.fieldName === item.jimuName)
      const fieldElement = existElement ? existElement.clone() : new FieldElement({
        fieldName: item.jimuName,
        label: item?.alias || item?.name
      })
      fieldElement.description = item.subDescription || item?.description
      fieldElement.editableExpression = item.editAuthority && !fieldElement.valueExpression ? 'editableTrue' : 'editableFalse'
      return fieldElement
    }
  })
  return elements
}

export const constructExpressionInfos = (expressionInfos: ExpressionInfo[]) => {
  const infos: ExpressionInfo[] = [...(expressionInfos || [])]
  infos.push(new ExpressionInfo({ name: 'editableTrue', expression: 'true' }))
  infos.push(new ExpressionInfo({ name: 'editableFalse', expression: 'false' }))
  return infos
}

const constructFormTemplate = (
  editorUseLayer: FeatureLayer | SubtypeSublayer,
  layerConfig: LayersConfig,
  relatedRecords: boolean,
  hiddenFields: string[]
) => {
  const { groupedFields, layerHonorMode } = layerConfig
  const originalFormTemplate = editorUseLayer.formTemplate
  const editorFormTemplate: FormTemplate = originalFormTemplate ? originalFormTemplate.clone() : new FormTemplate()
  const fieldElements = getFlatFormElements(originalFormTemplate?.elements).filter((e): e is FieldElement => e.type === 'field')
  let expressionInfosConstructed = false
  if (layerHonorMode === LayerHonorModeType.Custom) {
    editorFormTemplate.expressionInfos = constructExpressionInfos(editorFormTemplate.expressionInfos)
    expressionInfosConstructed = true
    editorFormTemplate.elements = constructFormElements(groupedFields, hiddenFields, fieldElements)
  }
  if (!relatedRecords && editorFormTemplate.elements) {
    const flatElements = getFlatFormElements(editorFormTemplate.elements)
    for (const element of flatElements) {
      if (element.type === 'relationship') {
        if (!expressionInfosConstructed) {
          editorFormTemplate.expressionInfos = constructExpressionInfos(editorFormTemplate.expressionInfos)
          expressionInfosConstructed = true
        }
        element.editableExpression = 'editableFalse'
      }
    }
  }
  editorFormTemplate.title = originalFormTemplate?.title || editorUseLayer.title
  return editorFormTemplate
}

export const queryFullFeatures = async (jimuMapView: JimuMapView, features: EditFeatures) => {
  const promises: Array<Promise<FeatureSet>> = []
  for (const dsId in features) {
    const layerFeaturesArray = features[dsId]
    if (layerFeaturesArray?.length > 0) {
      const ids = layerFeaturesArray.map(r => r.getId())
      const jimuLayerView = jimuMapView.getJimuLayerViewByDataSourceId(dsId)
      const currentEditLayer = jimuLayerView?.layer
      if (!currentEditLayer) continue
      const query = new Query({
        objectIds: ids,
        outFields: ['*'],
        returnGeometry: true
      })
      promises.push(currentEditLayer.queryFeatures(query))
    }
  }
  const results = await Promise.all(promises)
  const fullFeatures = results.reduce<Graphic[]>((prev, cur) => {
    if (Array.isArray(cur.features)) {
      return prev.concat(cur.features)
    } else {
      return prev
    }
  }, [])
  return fullFeatures
}

export const getEditorLayerInfo = async (
  dataSource: FeatureLayerDataSource | SubtypeSublayerDataSource,
  layerConfig: LayersConfig,
  jimuLayerView: JimuLayerView,
  relatedRecords: boolean,
  canEditFeature: boolean
) => {
  let showUpdateBtn = false
  let editorLayerInfo: EditorLayerInfo
  const editorUseLayer = jimuLayerView.layer as FeatureLayer | SubtypeSublayer
  const fullEditingPrivileges = (editorUseLayer as any)?.userHasFullEditingPrivileges
  const isAdvancedPermission = await getIsAdvancedPermission(dataSource)
  const layerEditingEnabled = editorUseLayer.editingEnabled
  let editorLayerConfig = layerConfig
  if (!editorLayerConfig) {
    editorLayerConfig = constructConfig(dataSource, editorUseLayer)
  }
  const layerDefinition = dataSource.getLayerDefinition()
  const hiddenFields = getEditHiddenFields(layerDefinition)
  const usedFormTemplate = constructFormTemplate(editorUseLayer, editorLayerConfig, relatedRecords, hiddenFields)
  if (isAdvancedPermission || fullEditingPrivileges) {
    showUpdateBtn = true
    editorLayerInfo = {
      layer: editorUseLayer,
      formTemplate: usedFormTemplate,
      enabled: true,
      addEnabled: true,
      updateEnabled: true,
      deleteEnabled: true,
      attributeUpdatesEnabled: true,
      geometryUpdatesEnabled: true
    }
  } else if (!layerEditingEnabled || !dataSource) {
    editorLayerInfo = constructUneditableInfo(editorUseLayer)
  } else {
    const { addRecords, deleteRecords, updateRecords, updateAttributes, updateGeometries } = editorLayerConfig
    // New logic of API: The user with advanced permissions can modify the configuration regardless of the configuration
    const haveUpdatePrivilege = updateRecords || deleteRecords
    if (isAdvancedPermission || haveUpdatePrivilege) {
      showUpdateBtn = true
    }
    // fetch to confirm whether it's a public source
    const accessible = await getDsAccessibleInfo(editorUseLayer?.url)
    // exb access and privilege
    const editable = accessible || canEditFeature
    const {allowGeometryUpdates, create, update, deletable} = getDsPrivileges(layerDefinition)
    editorLayerInfo = {
      layer: editorUseLayer,
      formTemplate: usedFormTemplate,
      enabled: editable && (addRecords || updateRecords || deleteRecords),
      addEnabled: addRecords && create,
      updateEnabled: updateRecords && update,
      deleteEnabled: deleteRecords && deletable,
      attributeUpdatesEnabled: updateAttributes && update,
      geometryUpdatesEnabled: updateGeometries && allowGeometryUpdates
    }
  }
  return { showUpdateBtn, editorLayerInfo }
}

export const updateDataSourceAfterEdit = (dataSource: DataSource, edits: Edits) => {
  const { addFeatures = [], updateFeatures = [], deleteFeatures = [] } = edits
  for (const addFeature of addFeatures) {
    const record = dataSource.buildRecord(addFeature)
    dataSource.afterAddRecord(record)
  }
  const updateRecords: DataRecord[] = []
  for (const updateFeature of updateFeatures) {
    const recordId = updateFeature.getObjectId()
    const originalFeature = (dataSource.getRecordById(recordId) as FeatureDataRecord)?.feature as Graphic
    const originalAttributes = originalFeature?.attributes || {}
    const newAttributes = Object.assign(originalAttributes, updateFeature?.attributes)
    updateFeature.attributes = newAttributes
    const record = dataSource.buildRecord(updateFeature)
    updateRecords.push(record)
  }
  dataSource.afterUpdateRecords(updateRecords)
  const deleteRecordIds = []
  for (const deleteFeature of deleteFeatures) {
    if ('attributes' in deleteFeature) {
      const recordId = deleteFeature.getObjectId()
      deleteRecordIds.push(recordId)
    } else {
      deleteRecordIds.push(deleteFeature?.objectId || deleteFeature?.globalId)
    }
  }
  dataSource.afterDeleteRecordsByIds(deleteRecordIds)
}

export const applyAttributeUpdates = (layerInfo: LayerInfo, params: Edits) => {
  const dataSource = layerInfo.dataSource
  const layer = layerInfo.layer
  const gdbVersion = dataSource.getGDBVersion()
  return layer.applyEdits(params, { gdbVersion })
}

export const useCalciteColorMapping = () => {
  const isClassicTheme = uiHooks.useClassicTheme()
  const theme = useTheme()
  const isDarkTheme = theme.sys.color.mode === 'dark'
  return isClassicTheme && !isDarkTheme ? css`--calcite-color-background: #f7f7f7;` : ''
}

export const featureFormStyle = css`
  .esri-widget {
    background-color: unset !important;
  }
  .esri-feature-form__text-element {
    color: inherit;
  }
  .esri-feature-form__text-element p {
    color: inherit;
  }
`

export const getDefaultSnapSources = (jimuMapView: JimuMapView, defaultSnapLayers?: ImmutableArray<string>) => {
  if (!jimuMapView?.jimuLayerViews) return []
  if (!defaultSnapLayers || defaultSnapLayers.length === 0) return []

  const allViewLayerKeys = Object.keys(jimuMapView.jimuLayerViews)
  const snapLayersSources = allViewLayerKeys
    .filter(layerViewId => defaultSnapLayers.includes(jimuMapView.jimuLayerViews[layerViewId].layerDataSourceId))
    .map(lvId => ({
      layer: jimuMapView.jimuLayerViews[lvId].layer,
      enabled: true
    }))

  return snapLayersSources
}

interface CreationAttributes {
  [key: string]: any
}

export const getLayerDefaultAttributes = (fields: Field[]): CreationAttributes => {
  return (fields || []).reduce<CreationAttributes>((attributes, field) => {
    if (field?.name && field.defaultValue !== undefined && field.defaultValue !== null) {
      attributes[field.name] = field.defaultValue
    }
    return attributes
  }, {})
}

export function getCreationAttributes (template: FeatureTemplate | SharedTemplate): CreationAttributes {
  const isSharedTemplate = template != null && "templateId" in template && "definition" in template
  const sharedTemplateType = isSharedTemplate ? template.type : null

  if (sharedTemplateType === "group" || sharedTemplateType === "preset") {
    // Group and preset templates create multiple features, so there is no
    // singular attribute object to return.
    return {}
  }

  if (template != null && "prototype" in template) {
    return { ...template.prototype?.attributes }
  }

  if (sharedTemplateType === "feature") {
    const sharedTemplate = template as {
      definition?: {
        defaultValues?: HashMap<any>;
      };
    }

    return {
      ...sharedTemplate.definition?.defaultValues,
    }
  }

  return {}
}
