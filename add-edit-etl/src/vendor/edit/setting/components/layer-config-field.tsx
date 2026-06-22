import {
  React, Immutable, css, type IMFieldSchema, hooks
} from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { defaultMessages as jimuUIMessages, Checkbox, Button, TextArea, Label, Popper, Select } from 'jimu-ui'
import { FieldSelector } from 'jimu-ui/advanced/data-source-selector'
import { AddFolderOutlined } from 'jimu-icons/outlined/editor/add-folder'

import { type TreeFields, LayerHonorModeType } from '../../config'
import defaultMessages from '../translations/default'
import { getDataSourceById, getEditHiddenFields } from '../../utils'
import type { LayerConfigProps } from './layer-config'
import { type DragDirection, Tree, type TreeNodeData, type TreeNodeInfo } from './tree'
import { getTreeFieldsKey, moveTreeFields } from './utils'
import LayerConfigFieldTitle from './layer-config-field-title'

type LayerConfigFieldProps = Pick<LayerConfigProps, 'layerConfig' | 'onChange' | 'layerDefinition' | 'layerEditingEnabled'>

const style = css`
  .fields-list-header {
    background: var(--ref-palette-neutral-300);
    border-bottom: 1px solid var(--ref-palette-neutral-600);
    height: 34px;
    width: 100%;
    flex-wrap: nowrap;
    .jimu-checkbox {
      margin-top: 2px;
    }
    .fields-list-check {
      margin-left: 18px;
    }
  }
  .selected-fields-con{
    margin-top: 0 !important;
    .jimu-tree {
      max-height: 300px;
      overflow-y: auto;
      background: var(--ref-palette-neutral-300);
    }
    .jimu-tree-node {
      border-top: 1px solid var(--ref-palette-neutral-400);
    }
  }
`

const LayerConfigField = (props: LayerConfigFieldProps) => {
  const { layerConfig, layerDefinition, layerEditingEnabled, onChange } = props
  const { useDataSource, showFields, groupedFields: imGroupedFields, layerHonorMode } = layerConfig
  const [isOpenDetailPopper, setIsOpenDetailPopper] = React.useState(false)
  const [curEditField, setCurEditField] = React.useState<TreeFields>(null)
  const [groupUpdating, setGroupUpdating] = React.useState(false)

  const popperRef = React.useRef<HTMLElement>(null)
  const popperTextRef = React.useRef<HTMLInputElement>(null)

  const translate = hooks.useTranslation(defaultMessages, jimuUIMessages)

  const groupedFields = React.useMemo(() => imGroupedFields.asMutable({ deep: true }), [imGroupedFields])

  const editCount = React.useMemo(() => {
    let count = 0
    groupedFields?.forEach(field => {
      if (field?.children) {
        field.children.forEach(child => {
          if (child.editAuthority) count++
        })
      } else {
        if (field.editAuthority) count++
      }
    })
    return count
  }, [groupedFields])

  const selectorFields = React.useMemo(() => showFields.map(f => f.jimuName), [showFields])

  const hiddenFields = React.useMemo(() => Immutable(getEditHiddenFields(layerDefinition) || []), [layerDefinition])

  const { treeData, checkedKeys, fieldMap } = React.useMemo(() => {
    const checkedKeys: string[] = []
    const fieldMap = new Map<string, TreeFields>()
    const getTreeData = (groupedFields: TreeFields[]) => {
      return groupedFields.filter(f => !hiddenFields.includes(f.jimuName)).map((item) => {
        if (layerEditingEnabled) {
          if (!item.groupKey) {
            item.editAuthority && checkedKeys.push(item.jimuName)
          } else {
            if (item.children && item.children.length > 0) {
              item.children.filter(f => !hiddenFields.includes(f.jimuName)).forEach(child => {
                child.editAuthority && checkedKeys.push(child.jimuName)
              })
            }
          }
        }
        const key = getTreeFieldsKey(item)
        fieldMap.set(key, item)
        const treeItemData: TreeNodeData = {
          key,
          title: item.alias || item.jimuName || item.name,
          disableCheckbox: item?.groupKey ? item.children.length === 0 : layerEditingEnabled ? !item.editable : true,
          ...(item.groupKey ? { children: getTreeData(item.children) } : {})
        }
        return treeItemData
      })
    }
    const treeData = getTreeData(groupedFields)
    return { treeData, checkedKeys, fieldMap }
  }, [groupedFields, hiddenFields, layerEditingEnabled])

  const [hasUncheck, indeterminate] = React.useMemo(() => {
    let fieldCount = 0
    let checkedCount = 0
    fieldMap.forEach((item) => {
      if (!item.groupKey) {
        fieldCount++
        if (item.editAuthority) {
          checkedCount++
        }
      }
    })
    return [checkedCount < fieldCount, checkedCount > 0 && checkedCount < fieldCount]
  }, [fieldMap])

  const handleHonorModeChange = React.useCallback((e: any, hornorMode: string) => {
    onChange(layerConfig.set('layerHonorMode', hornorMode))
  }, [layerConfig, onChange])

  const onFieldChange = React.useCallback((allSelectedFields: IMFieldSchema[]) => {
    if (!allSelectedFields) return
    const newShowFields = allSelectedFields.filter(item => item)
    let newGroupedFields = groupedFields
    const addFields = newShowFields.filter(nf => !showFields.find(f => f.jimuName === nf.jimuName))
    for (const addField of addFields) {
      const fieldsConfig = layerDefinition?.fields || []
      const orgField = fieldsConfig.find(field => field.name === addField.jimuName)
      const defaultAuthority = orgField?.editable
      newGroupedFields.push({
        ...addField.asMutable({ deep: true }),
        editAuthority: defaultAuthority,
        subDescription: addField?.description || '',
        editable: defaultAuthority
      })
    }
    const removeFields = showFields.filter(f => !newShowFields.find(nf => nf.jimuName === f.jimuName))
    const removeFieldNames = removeFields.map(f => f.jimuName)
    newGroupedFields = newGroupedFields.filter(f => !removeFieldNames.includes(f.jimuName))
    for (let i = 0; i < newGroupedFields.length; i++) {
      const field = newGroupedFields[i]
      if (field.children) {
        field.children = field.children.filter(f => !removeFieldNames.includes(f.jimuName))
      }
    }
    onChange(layerConfig.set('showFields', newShowFields).set('groupedFields', newGroupedFields))
  }, [groupedFields, layerConfig, layerDefinition?.fields, onChange, showFields])

  const handleTreeBoxAll = React.useCallback(() => {
    const newGroupedFields = groupedFields
    newGroupedFields.forEach(field => {
      if (field.editable) {
        field.editAuthority = hasUncheck
      }
      if (field.children) {
        field.children.forEach(childField => {
          childField.editAuthority = hasUncheck
        })
      }
    })
    onChange(layerConfig.set('groupedFields', newGroupedFields))
  }, [groupedFields, hasUncheck, layerConfig, onChange])

  const addGroupForFields = React.useCallback(() => {
    setGroupUpdating(() => {
      setTimeout(() => {
        setGroupUpdating(false)
      }, 1000)
      return true
    })
    const newGroupId = getGroupMaxId(groupedFields) + 1
    const newGroupField = {
      jimuName: `${translate('group')}-${newGroupId}`,
      name: `${translate('group')}-${newGroupId}`,
      alias: `${translate('group')}-${newGroupId}`,
      subDescription: '',
      editAuthority: false,
      editable: true,
      children: [],
      groupKey: newGroupId
    } as TreeFields
    const newGroupedFields = [newGroupField, ...groupedFields]
    onChange(layerConfig.set('groupedFields', newGroupedFields))
  }, [groupedFields, layerConfig, onChange, translate])

  const removeGroup = React.useCallback((groupKey: number) => {
    let newGroupedFields = []
    for (const field of groupedFields) {
      if (field.groupKey === groupKey) {
        newGroupedFields = newGroupedFields.concat(field.children)
      } else {
        newGroupedFields = newGroupedFields.concat(field)
      }
    }
    onChange(layerConfig.set('groupedFields', newGroupedFields))
    if (curEditField?.groupKey === groupKey) {
      setIsOpenDetailPopper(false)
    }
  }, [curEditField?.groupKey, groupedFields, layerConfig, onChange])

  const handleGroupNameChange = React.useCallback((groupKey: number, newName: string) => {
    const group = groupedFields.find(item => item.groupKey === groupKey)
    group.alias = newName
    group.name = newName
    onChange(layerConfig.set('groupedFields', groupedFields))
  }, [groupedFields, layerConfig, onChange])

  const showDetailPopper = React.useCallback((ref: React.RefObject<HTMLDivElement>, curField: TreeFields) => {
    popperRef.current = ref.current
    setCurEditField(curField)
    setIsOpenDetailPopper(old => !old)
  }, [])

  const closeDetailPopper = React.useCallback(() => {
    setIsOpenDetailPopper(false)
  }, [])

  const titleRender = React.useCallback((treeNode: TreeNodeInfo) => {
    const { key, children } = treeNode
    const selectedDs = getDataSourceById(useDataSource?.dataSourceId)
    const allFieldsSchema = selectedDs?.getSchema()
    const allFields = allFieldsSchema?.fields ? Object.values(allFieldsSchema?.fields) : []
    const disableDescription = children ? false : !checkFieldsExist(allFields, key)
    const item = fieldMap.get(key)
    return <LayerConfigFieldTitle
      item={item}
      disableDescription={disableDescription}
      onGroupNameChange={handleGroupNameChange}
      removeGroup={removeGroup}
      showDetailPopper={showDetailPopper}
    />
  }, [fieldMap, handleGroupNameChange, removeGroup, showDetailPopper, useDataSource?.dataSourceId])

  const handleCheck = React.useCallback((checkedKeys: string[], checkNode: { checked: boolean, treeNode: TreeNodeInfo}) => {
    const newGroupedFields = groupedFields
    const updateChecked = (nodes: TreeFields[]) => {
      nodes.forEach(node => {
        const key = getTreeFieldsKey(node)
        if (!node.children) {
          node.editAuthority = checkedKeys.includes(key)
        } else {
          updateChecked(node.children)
        }
      })
    }
    updateChecked(newGroupedFields)
    onChange(layerConfig.set('groupedFields', newGroupedFields))
  }, [groupedFields, layerConfig, onChange])

  const isDroppable = React.useCallback((dragNode: TreeNodeInfo, dropNode: TreeNodeInfo, direction: DragDirection): boolean => {
    const dragField = fieldMap.get(dragNode.key)
    const dropField = fieldMap.get(dropNode.key)
    const dropParentField = fieldMap.get(dropNode.parentKey)
    const isTargetGroup = dropField?.groupKey
    const isTargetParentGroup = dropParentField?.groupKey
    const isSourceGroup = dragField?.groupKey
    let droppable = true
    if (direction === 'inside' && (!isTargetGroup || isSourceGroup)) {
      droppable = false
    }
    if (direction !== 'inside' && isTargetParentGroup && isSourceGroup) {
      droppable = false
    }
    return droppable
  }, [fieldMap])

  const handleDrop = React.useCallback((dragNode: TreeNodeInfo, dropNode: TreeNodeInfo, direction: DragDirection) => {
    const newGroupedFields = moveTreeFields(groupedFields, dragNode.key, dropNode.key, direction)
    onChange(layerConfig.set('groupedFields', newGroupedFields))
  }, [groupedFields, layerConfig, onChange])

  const findEditingIndex = React.useCallback((targetId: string) => {
    let editingIndex: number[]
    groupedFields.forEach((field, index) => {
      if (field.jimuName === targetId) {
        editingIndex = [index]
      } else if (field?.children) {
        const subIndex = field.children.findIndex(item => item.jimuName === targetId)
        if (subIndex > -1) {
          editingIndex = [index, subIndex]
        }
      }
    })
    return editingIndex
  }, [groupedFields])

  const handleTreeDescChange = React.useCallback(() => {
    const newGroupedFields = groupedFields
    const editingIndex = findEditingIndex(curEditField?.jimuName)
    const newValue = popperTextRef.current?.value || ''
    // edit description
    if (editingIndex.length === 2) {
      const [index, subIndex] = editingIndex
      const field = newGroupedFields[index].children[subIndex]
      if (field) {
        field.subDescription = newValue
      }
    } else if (editingIndex.length === 1) {
      const [index] = editingIndex
      const field = newGroupedFields[index]
      field.subDescription = newValue
    }
    onChange(layerConfig.set('groupedFields', newGroupedFields))
    setIsOpenDetailPopper(false)
  }, [curEditField?.jimuName, findEditingIndex, groupedFields, layerConfig, onChange])

  return <SettingSection title={translate('configFields')} css={style}>
    <SettingRow>
      <Select size='sm' className='w-100' value={layerHonorMode} onChange={handleHonorModeChange}>
        <option value={LayerHonorModeType.Webmap}>{translate('layerHonorSetting')}</option>
        <option value={LayerHonorModeType.Custom}>{translate('layerCustomize')}</option>
      </Select>
    </SettingRow>
    {layerHonorMode === LayerHonorModeType.Custom &&
      <React.Fragment>
        <SettingRow flow='wrap' label={translate('configFieldsTip')}>
          <FieldSelector
            useDataSources={ useDataSource ? Immutable([useDataSource]) : Immutable([]) }
            selectedFields={Immutable(selectorFields)}
            isMultiple
            isDataSourceDropDownHidden
            useDropdown
            useMultiDropdownBottomTools
            hiddenFields={hiddenFields}
            onChange={onFieldChange}
          />
        </SettingRow>

        <SettingRow flow='wrap' label={layerEditingEnabled && translate('editableCount', { count: editCount })}>
          <div className='fields-list-header form-inline'>
            <div className='d-flex w-100 fields-list-check'>
              {layerEditingEnabled &&
                <Checkbox
                  id='editAll'
                  data-field='editAll'
                  onClick={handleTreeBoxAll}
                  checked={!hasUncheck}
                  indeterminate={indeterminate}
                  title={hasUncheck
                    ? `${translate('editable')} (${translate('checkAll')})`
                    : `${translate('editable')} (${translate('uncheckAll')})`
                  }
                />
              }
              <Label
                for='editAll'
                style={{ cursor: 'pointer' }}
                className='ml-2'
                title={translate('field')}
              >
                {translate('field')}
              </Label>
            </div>
            <Button
              icon
              size='sm'
              type='tertiary'
              disableHoverEffect
              disableRipple
              onClick={addGroupForFields}
              title={translate('addGroup')}
              aria-label={translate('addGroup')}
              disabled={groupUpdating}
            >
              <AddFolderOutlined />
            </Button>
          </div>
        </SettingRow>

        <SettingRow className='selected-fields-con'>
          <Tree
            treeData={treeData}
            titleRender={titleRender}
            checkable={true}
            checkedKeys={checkedKeys}
            checkStrictly={false}
            draggable={true}
            isDroppable={isDroppable}
            onCheck={handleCheck}
            onDrop={handleDrop}
          />
          {curEditField && <Popper
            placement='bottom-start'
            reference={popperRef}
            offsetOptions={[-27, 3]}
            open={isOpenDetailPopper}
            arrowOptions={false}
            toggle={closeDetailPopper}
          >
            <div style={{ width: 228 }} className='p-4'>
              <TextArea
                ref={popperTextRef}
                id={curEditField?.jimuName}
                className='w-100'
                height={60}
                placeholder={translate('editFieldDescription')}
                defaultValue={curEditField?.subDescription || curEditField?.description}
              />
              <div className='d-flex justify-content-end mt-4'>
                <Button size='sm' type='primary' onClick={handleTreeDescChange}>
                  {translate('commonModalOk')}
                </Button>
                <Button size='sm' className='ml-1' onClick={closeDetailPopper}>
                  {translate('commonModalCancel')}
                </Button>
              </div>
            </div>
          </Popper>}
        </SettingRow>
      </React.Fragment>
    }
  </SettingSection>
}

const checkFieldsExist = (allFields: IMFieldSchema[], jimuName: string) => {
  let exist = false
  for (const item of allFields) {
    if (item.jimuName === jimuName) {
      exist = true
      break
    }
  }
  return exist
}

const getGroupMaxId = (arr: TreeFields[]): number => {
  const numbers = []
  arr.forEach(item => {
    if (item?.groupKey) {
      numbers.push(item?.groupKey)
    }
  })
  return numbers.length > 0 ? Math.max.apply(null, numbers) : 0
}

export default LayerConfigField
