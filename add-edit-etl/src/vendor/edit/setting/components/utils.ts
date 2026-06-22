import type { JimuLayerView } from 'jimu-arcgis'
import { SUPPORTED_JIMU_LAYER_TYPES } from '../../utils'
import { type ImmutableObject, JSAPILayerTypes } from 'jimu-core'
import { TreeItemActionType } from 'jimu-ui/basic/list-tree'
import type { TreeFields } from '../../config'
import type { DragDirection } from './tree'

export function isSupportedJimuLayerView (jimuLayerView: JimuLayerView): boolean {
  if (!jimuLayerView || !jimuLayerView.type) {
    return false
  }
  const viewType = jimuLayerView.layer.type
  // Some BuildingComponentSublayer doesn't have layer view, so need to check jimuLayerView.view here.
  const isViewPass = viewType !== JSAPILayerTypes.BuildingComponentSublayer || jimuLayerView.view
  const isSupported = SUPPORTED_JIMU_LAYER_TYPES.includes(viewType)
  const hasUrl = !!jimuLayerView.layer?.url
  return isViewPass && isSupported && hasUrl
}

export const overrideItemBlockInfo = ({ itemBlockInfo }, refComponent) => {
  return {
    name: TreeItemActionType.RenderOverrideItem,
    children: [{
      name: TreeItemActionType.RenderOverrideItemDroppableContainer,
      children: [{
        name: TreeItemActionType.RenderOverrideItemDraggableContainer,
        children: [{
          name: TreeItemActionType.RenderOverrideItemBody,
          children: [{
            name: TreeItemActionType.RenderOverrideItemMainLine,
            children: [{
              name: TreeItemActionType.RenderOverrideItemDragHandle
            }, {
              name: TreeItemActionType.RenderOverrideItemIcon,
              autoCollapsed: true
            }, {
              name: TreeItemActionType.RenderOverrideItemTitle
            }, {
              name: TreeItemActionType.RenderOverrideItemDetailToggle
            }, {
              name: TreeItemActionType.RenderOverrideItemCommands
            }]
          }]
        }]
      }]
    }]
  }
}

export const getTreeFieldsKey = (item: ImmutableObject<TreeFields> | TreeFields) => {
  return typeof item.groupKey === 'number' && !isNaN(item.groupKey) ? `${item.groupKey}` : item.jimuName
}

export function moveTreeFields (
  tree: TreeFields[],
  dragKey: string,
  dropKey: string,
  direction: DragDirection
): TreeFields[] {
  if (!tree?.length || dragKey === dropKey) return tree

  const newTree = tree.map(n => ({ ...n, children: n.children ? [...n.children] : undefined }))

  let dragNode: TreeFields
  let dragList: TreeFields[]
  let dragIndex: number
  let dropNode: TreeFields
  let dropIndex: number
  let dropList: TreeFields[]
  const findNode = (nodes: TreeFields[]) => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const key = getTreeFieldsKey(n)
      if (key === dragKey) {
        dragNode = n
        dragIndex = i
        dragList = nodes
      }
      if (key === dropKey) {
        dropNode = n
        dropIndex = i
        dropList = nodes
      }
      if (dragNode && dropNode) {
        break
      }
      if (n.children) {
        findNode(n.children)
      }
    }
  }
  findNode(newTree)

  if (!dropNode || !dropNode) return tree
  dragList.splice(dragIndex, 1)
  if (direction === 'inside') {
    dropNode.children = [...(dropNode.children ?? []), dragNode]
  } else {
    let targetIndex = dropIndex + (direction === 'bottom' ? 1 : 0)
    if (dragList === dropList && dragIndex < dropIndex) {
      targetIndex -= 1
    }
    dropList.splice(targetIndex, 0, dragNode)
  }

  return newTree
}
