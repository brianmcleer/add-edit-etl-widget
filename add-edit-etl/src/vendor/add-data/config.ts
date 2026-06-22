import type { ExportFormat, Size } from 'jimu-core'
import type { ItemCategory, ItemTypeCategory } from 'jimu-ui/basic/item-selector'
import type { ImmutableObject } from 'seamless-immutable'

export interface Config {
  disableAddBySearch?: boolean
  disableAddByUrl?: boolean
  disableAddByFile?: boolean
  placeholderText?: string
  itemCategoriesInfo?: ItemCategoryInfo[]

  disableRenaming?: boolean

  displayedItemTypeCategories?: ItemTypeCategory[]

  disableExport?: boolean
  notAllowedExportFormat?: ExportFormat[]

  panelSize?: Size
}

export type IMConfig = ImmutableObject<Config>

export interface ItemCategoryInfo {
  type: ItemCategory
  customLabel?: string
  enabled: boolean
  curatedFilter?: string
  id: string
}
