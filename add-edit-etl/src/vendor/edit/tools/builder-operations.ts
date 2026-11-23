import { Immutable, type extensionSpec, type IMAppConfig, type ImmutableArray, type ImmutableObject } from 'jimu-core'
import { defaultMessages as jimuUiMessages } from 'jimu-ui'
import { EditModeType, LayerHonorModeType, type LayersConfig, type IMConfig, type MapViewConfig } from '../config'

export default class BuilderOperations implements extensionSpec.BuilderOperationsExtension {
  id = 'edit-builder-operation'
  widgetId: string

  getTranslationKey (appConfig: IMAppConfig): Promise<extensionSpec.TranslationKey[]> {
    const config = appConfig.widgets[this.widgetId].config as IMConfig
    const {
      editMode,
      description,
      noDataMessage,
      layersConfig = Immutable([]) as ImmutableArray<LayersConfig>,
      mapViewsConfig = Immutable({}) as ImmutableObject<MapViewConfig>
    } = config
    const keys: extensionSpec.TranslationKey[] = []
    if (editMode === EditModeType.Attribute) {
      description && keys.push({
        keyType: 'value',
        key: `widgets.${this.widgetId}.config.description`,
        label: {
          key: 'description',
          enLabel: jimuUiMessages.description
        },
        valueType: 'text'
      })
      noDataMessage && keys.push({
        keyType: 'value',
        key: `widgets.${this.widgetId}.config.noDataMessage`,
        label: {
          key: 'noDataMessage',
          enLabel: jimuUiMessages.noDataMessage
        },
        valueType: 'text'
      })
      const layersConfigKeys = getKeysInLayersConfig(layersConfig, `widgets.${this.widgetId}.config`, true)
      layersConfigKeys.length > 0 &&keys.push(...layersConfigKeys)
    } else if (editMode === EditModeType.Geometry) {
      for (const [jimuMapViewId, mapViewConfig] of Object.entries(mapViewsConfig)) {
        const layersConfigKeys = getKeysInLayersConfig(mapViewConfig.layersConfig, `widgets.${this.widgetId}.config.mapViewsConfig.${jimuMapViewId}`)
        layersConfigKeys.length > 0 && keys.push(...layersConfigKeys)
      }
    }

    return Promise.resolve(keys)
  }
}

export function getKeysInLayersConfig (layersConfig: ImmutableArray<LayersConfig> = Immutable([]), path: string, includeLabel?: boolean) {
  const keys: extensionSpec.TranslationKey[] = []
  layersConfig.forEach((layerConfig, layerIndex) => {
    const layerName = layerConfig.name
    const layerPath = `${path}.layersConfig[${layerIndex}]`
    const layerChildrenKeys: extensionSpec.TranslationKey[] = []
    if (includeLabel) {
      layerChildrenKeys.push({
        keyType: 'value',
        key: `${layerPath}.name`,
        groupKey: layerPath,
        label: {
          key: 'i18nLabelFor',
          values: { value: layerName },
          enLabel: `Label for "${layerName}"`
        },
        valueType: 'text'
      })
    }
    if (layerConfig.layerHonorMode === LayerHonorModeType.Custom && layerConfig.groupedFields.length > 0) {
      layerConfig.groupedFields.forEach((item, itemIndex) => {
        const itemPath = `${layerPath}.groupedFields[${itemIndex}]`
        const itemName = item.alias || item.jimuName || item.name
        const isGroup = !!item.groupKey
        if (isGroup) {
          layerChildrenKeys.push({
            keyType: 'group',
            key: itemPath,
            groupKey: layerPath,
            label: itemName
          })
          layerChildrenKeys.push({
            keyType: 'value',
            key: `${itemPath}.name`,
            groupKey: itemPath,
            label: {
              key: 'fieldGroupLabel',
              values: { value: itemName },
              enLabel: `Label for group "${itemName}"`
            },
            valueType: 'text'
          })
          if (item.subDescription) {
            layerChildrenKeys.push(getItemDescriptionKey(itemPath, itemPath, itemName, true))
          }
          if (item.children.length > 0) {
            item.children.forEach((childItem, childIndex) => {
              const childItemName = childItem.alias || childItem.jimuName || childItem.name
              if (childItem.subDescription) {
                layerChildrenKeys.push(getItemDescriptionKey(`${itemPath}.children[${childIndex}]`, itemPath, childItemName, false))
              }
            })
          }
        } else if (item.subDescription) {
          layerChildrenKeys.push(getItemDescriptionKey(itemPath, isGroup ? itemPath : layerPath, itemName, false))
        }
      })
    }
    if (layerChildrenKeys.length > 0) {
      keys.push({
        keyType: 'group',
        key: layerPath,
        label: layerName
      })
      keys.push(...layerChildrenKeys)
    }
  })
  return keys
}

function getItemDescriptionKey (path: string, groupKey: string, itemName: string, isGroup: boolean): extensionSpec.TranslationKey {
  return {
    keyType: 'value',
    key: `${path}.subDescription`,
    groupKey,
    label: {
      key: isGroup ? 'groupDescription' : 'fieldDescription',
      values: { value: itemName },
      enLabel: isGroup ? `Description for group "${itemName}"` : `Description for field "${itemName}"`
    },
    valueType: 'textarea'
  }
}