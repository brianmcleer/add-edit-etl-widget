import type { ImmutableObject, UseDataSource } from 'jimu-core'
import type { ItemTypeCategory } from 'jimu-ui/basic/item-selector'
import type { FieldMappingConfig } from './runtime/etl/types'

/**
 * Config for the merged Add + ETL + Edit widget.
 *
 *  - addData*  : carried over from the Add Data widget (which ingest tabs are on).
 *  - target*   : the editable layer the data is loaded into (the "target schema"),
 *                carried over from the Edit widget's layersConfig concept but
 *                simplified to a single target.
 *  - etl*      : default mapping + which ETL features the runtime user may use.
 */
export interface Config {
  // ----- Add Data side -----
  disableAddBySearch?: boolean
  disableAddByUrl?: boolean
  disableAddByFile?: boolean
  placeholderText?: string
  displayedItemTypeCategories?: ItemTypeCategory[]

  // ----- Target (Edit side) -----
  /** The editable target layer the merged records are appended to.
   *  Retained for backward compatibility with single-target configs. */
  targetUseDataSource?: UseDataSource
  /** One or more editable target layers. At runtime the user picks which one to
   *  load into. When set, this takes precedence over targetUseDataSource. */
  targetUseDataSources?: UseDataSource[]
  /** Allow the runtime user to edit appended features in a feature form after load. */
  enableReviewEdit?: boolean
  /** Open directly on the Edit step (edit existing data; skip add/map/load). */
  startInEditMode?: boolean
  /** When a Map widget is linked, use the full geometry editor (sketch/move) in the Edit step. */
  enableGeometryEdit?: boolean
  /** Add the target layer to the linked map (if not already present) and zoom to loaded features. */
  showOnMap?: boolean
  /** Map scale (denominator, e.g. 2500 = 1:2500) used when zooming to features. 0/undefined = fit extent. */
  zoomScale?: number
  /** Zoom to a feature when it is selected during editing. */
  zoomToSelected?: boolean
  /** Let the runtime user change the target layer's symbology on the map. */
  allowSymbology?: boolean

  // ----- Editing options (parity with OOTB Edit) -----
  /** Permit adding new features. */
  allowCreate?: boolean
  /** Permit updating existing feature attributes. */
  allowUpdate?: boolean
  /** Permit deleting features. */
  allowDelete?: boolean
  /** Permit moving/reshaping geometry (geometry mode only). */
  allowGeometryUpdate?: boolean
  // snapping (geometry mode)
  /** Geometry guides / self snapping. */
  snapGuides?: boolean
  /** Feature-to-feature snapping. */
  snapFeature?: boolean
  /** Grid snapping. */
  snapGrid?: boolean
  // advanced tools (geometry mode)
  /** Master toggle for advanced editing tools (split/merge/copy-paste). */
  advancedTools?: boolean
  /** Show the split tool. */
  toolSplit?: boolean
  /** Show the merge tool (requires batch editing). */
  toolMerge?: boolean
  /** Show the copy & paste tool (2D only). */
  toolCopyPaste?: boolean
  /** Start editing in reshape mode, showing vertices. */
  displayVertices?: boolean
  // behavior (both modes)
  /** Show drawing tooltips. */
  enableTooltips?: boolean
  /** Show the template picker in the form. */
  templateFilter?: boolean
  /** Allow batch (multi-feature) editing. */
  batchEditing?: boolean
  /** Allow editing related records. */
  relatedRecords?: boolean

  // ----- ETL -----
  /** Author-provided starting mapping; the runtime user can override it. */
  defaultMapping?: FieldMappingConfig
  /** Let the runtime user edit/define mappings (false = use defaultMapping as-is). */
  allowRuntimeMapping?: boolean
  /** Allow the free-form expression mode (M:M / M:1 / 1:M via code). */
  allowExpressions?: boolean
  /** applyEdits chunk size. */
  loadChunkSize?: number
  /** Expose the update and upsert load modes (match by key field) at runtime. Default true. */
  allowUpsert?: boolean
}

export type IMConfig = ImmutableObject<Config>
