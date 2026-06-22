import { React, classNames } from 'jimu-core'
import type { StandardComponentProps, StyleState } from 'jimu-ui'
import { TreeNode } from './tree-node'
import { styled } from 'jimu-theme'
import type { TreeNodeInfo, TreeNodeData, DragDirection } from './types'
export type * from './types'

export interface TreeProps extends StandardComponentProps {
  treeData: TreeNodeData[]
  titleRender?: (node: TreeNodeInfo) => React.ReactNode
  checkedKeys?: string[]
  draggable?: boolean
  checkable?: boolean
  height?: number | string
  checkStrictly?: boolean
  onCheck?: (checkedKeys: string[], checkNode: { checked: boolean, treeNode: TreeNodeInfo}) => void
  isDroppable?: (dragNode: TreeNodeInfo, dropNode: TreeNodeInfo, direction: DragDirection) => boolean
  onDrop?: (dragNode: TreeNodeInfo, dropNode: TreeNodeInfo, direction: DragDirection) => void
}

const TreeRoot = styled.div<StyleState<TreeProps>>(({ theme, styleState }) => {
  const { height } = styleState
  return {
    width: '100%',
    height: height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : 'auto',
    overflow: height !== undefined ? 'auto' : 'visible',
  }
})

export function Tree (props: TreeProps) {
  const { treeData, titleRender, draggable, checkStrictly = false, checkedKeys = [], className, style, onCheck, isDroppable, onDrop } = props

  const { treeNodes, treeNodeMap } = React.useMemo(() => {
    const treeNodeMap = new Map<string, TreeNodeInfo>()
    const generateTreeNodes = (nodeDatas: TreeNodeData[], parentKey?: string): TreeNodeInfo[] => {
      return nodeDatas.map(data => {
        let checked: boolean
        let halfChecked: boolean
        const isLeaf = !Array.isArray(data.children)
        if (checkStrictly || isLeaf) {
          checked = checkedKeys.includes(data.key)
          halfChecked = false
        } else {
          const childrenCount = Array.isArray(data.children) ? data.children.length : 0
          const checkedCount = Array.isArray(data.children) ? data.children.filter(child => checkedKeys.includes(child.key)).length : 0
          checked = childrenCount > 0 && checkedCount === childrenCount
          halfChecked = !checked && childrenCount > 0 && checkedCount > 0 && checkedCount < childrenCount
        }
        const treeNode: TreeNodeInfo = {
          key: data.key,
          title: data.title,
          parentKey: parentKey,
          checkable: props.checkable,
          disableCheckbox: data.disableCheckbox,
          checked,
          halfChecked,
          ...(!isLeaf ? { children: generateTreeNodes(data.children, data.key) } : {})
        }
        treeNodeMap.set(data.key, treeNode)
        return treeNode
      })
    }
    const treeNodes = generateTreeNodes(treeData)
    return { treeNodes, treeNodeMap }
  }, [treeData, checkedKeys, checkStrictly, props.checkable])

  const handleCheck = React.useCallback((checked: boolean, treeNode: TreeNodeInfo) => {
    let newCheckedKeys: string[] = [...checkedKeys]
    const isLeaf = !Array.isArray(treeNode.children)
    if (checkStrictly || isLeaf) {
      if (checked) {
        !newCheckedKeys.includes(treeNode.key) && newCheckedKeys.push(treeNode.key)
      } else {
        newCheckedKeys = newCheckedKeys.filter(k => k !== treeNode.key)
      }
    } else {
      const getChildLeafKeys = (node: TreeNodeInfo): string[] => {
        let keys: string[] = []
        node.children.forEach(child => {
          if (Array.isArray(child.children)) {
            keys = keys.concat(getChildLeafKeys(child))
          } else {
            keys.push(child.key)
          }
        })
        return keys
      }
      const childLeafKeys = getChildLeafKeys(treeNode)
      if (checked) {
        newCheckedKeys = Array.from(new Set([...newCheckedKeys, ...childLeafKeys]))
      } else {
        newCheckedKeys = newCheckedKeys.filter(k => !childLeafKeys.includes(k))
      }
    }
    onCheck?.(newCheckedKeys, { checked, treeNode })
  }, [checkStrictly, checkedKeys, onCheck])

  const isNodeDroppable = React.useCallback((dragKey: string, dropKey: string, direction: DragDirection): boolean => {
    if (!isDroppable) return true
    const dragNode = treeNodeMap.get(dragKey)
    const dropNode = treeNodeMap.get(dropKey)
    if (dragNode && dropNode) {
      return isDroppable ? isDroppable(dragNode, dropNode, direction) : true
    }
    return false
  }, [isDroppable, treeNodeMap])

  const handleNodeDrop = React.useCallback((dragKey: string, dropKey: string, direction: DragDirection) => {
    const dragNode = treeNodeMap.get(dragKey)
    const dropNode = treeNodeMap.get(dropKey)
    if (dragNode && dropNode) {
      onDrop?.(dragNode, dropNode, direction)
    }
  }, [onDrop, treeNodeMap])

  const rootHasGroup = treeNodes.some(node => node.children?.length > 0)

  return <TreeRoot className={classNames('jimu-tree', className)} style={style} styleState={props}>
    {treeNodes.map(treeNodeInfo => {
      return <TreeNode
        key={treeNodeInfo.key}
        treeNodeInfo={treeNodeInfo}
        titleRender={titleRender}
        draggable={draggable}
        rootHasGroup={rootHasGroup}
        onCheck={handleCheck}
        isDroppable={isNodeDroppable}
        onDrop={handleNodeDrop}
      />
    })}
  </TreeRoot>
}
