export type DragDirection = 'top' | 'bottom' | 'inside'

export interface TreeNodeInfo {
  key: string
  title: string
  children?: TreeNodeInfo[]
  checkable: boolean
  disableCheckbox: boolean
  checked: boolean
  halfChecked?: boolean
  parentKey?: string
}

export interface TreeNodeData {
  key: string
  title: string
  disableCheckbox?: boolean
  children?: TreeNodeData[]
}