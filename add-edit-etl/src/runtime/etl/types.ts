/**
 * ETL field-mapping data model.
 *
 * The mapping problem is "conform a SOURCE schema (data the runtime user just
 * added via the Add Data flow) onto a TARGET schema (the editable layer the
 * widget author configured on the Edit side)". The model below is expressive
 * enough to cover every cardinality the spec asks for:
 *
 *   1:1  one source field  -> one target field      (mode: 'direct' | 'expression')
 *   M:1  many source fields -> one target field      (mode: 'concat'|'coalesce'|'sum'|'avg'|'min'|'max'|'expression')
 *   1:M  one source field   -> many target fields     (mode: 'splitDelimiter'|'splitRegex'|'duplicate')
 *   M:M  many source fields -> many target fields      (mode: 'expression', one expression per target)
 *
 * A rule always declares its sourceFields[] and targetFields[]; the `mode`
 * decides how the engine turns the former into the latter. M:M is modelled as
 * a single rule with N targets, each computed by its own expression over the
 * shared set of M source inputs - that general case subsumes all the others,
 * but the named modes exist so a non-coder can build the common shapes without
 * writing an expression.
 */

import type { JimuFieldType } from 'jimu-core'

export type Cardinality = '1:1' | 'M:1' | '1:M' | 'M:M'

export type TransformMode =
  // 1:1
  | 'direct' // copy source[0] -> target[0] with type coercion
  | 'dateParse' // parse source[0] as a date (options.dateFormat hint) -> epoch ms
  | 'valueMap' // look source[0] up in options.valueMap -> mapped value
  | 'numberScale' // numeric conversion: value * factor + offset, rounded to precision
  // M:1
  | 'concat' // join source values with options.delimiter
  | 'template' // options.template with {field} placeholders over the source row
  | 'coalesce' // first non-null/non-empty source value
  | 'sum' | 'avg' | 'min' | 'max' // numeric reductions over source values
  // 1:M
  | 'splitDelimiter' // split source[0] by options.delimiter, assign parts to targets in order
  | 'splitRegex' // run options.regex against source[0], assign capture groups to targets in order
  | 'duplicate' // copy source[0] into every target
  // 1:1 / M:1 / 1:M / M:M
  | 'expression' // evaluate options.expressions[i] for each target i (general case)
  | 'constant' // write options.constant into every target (no source needed)

export interface TransformOptions {
  delimiter?: string // for concat / splitDelimiter
  regex?: string // for splitRegex (first matching group set wins)
  regexFlags?: string
  /** One expression per target field, aligned by index with targetFields. */
  expressions?: string[]
  constant?: string | number | boolean | null
  trim?: boolean // trim string outputs
  emptyAsNull?: boolean // '' becomes null before coercion
  /** When true the engine coerces each output to the target field's esri type. Default true. */
  coerce?: boolean
  /** dateParse: an input format hint like 'MM/DD/YYYY' or 'DD.MM.YYYY HH:mm'.
   *  Blank means auto (ISO first, then native Date parsing). */
  dateFormat?: string
  /** valueMap: source value -> output value lookup (keys compared as strings). */
  valueMap?: Record<string, string | number | boolean | null>
  /** valueMap: what happens when a value is not in the map.
   *  'passthrough' keeps the original (default), 'null' writes null,
   *  'default' writes mapDefault. */
  unmapped?: 'passthrough' | 'null' | 'default'
  mapDefault?: string | number | boolean | null
  /** numberScale: output = value * factor + offset, then rounded to precision
   *  decimal places when precision is set. factor defaults to 1, offset to 0. */
  factor?: number
  offset?: number
  precision?: number
  /** template: text with {sourceField} placeholders, e.g. '{num} {street}, {city}'. */
  template?: string
}

export interface FieldMappingRule {
  id: string
  cardinality: Cardinality
  /** jimuName(s) of source fields this rule reads. */
  sourceFields: string[]
  /** name(s) of target fields this rule writes. */
  targetFields: string[]
  mode: TransformMode
  options?: TransformOptions
  /** Author/user note shown in the UI. */
  note?: string
  enabled?: boolean
}

/** How the merged feature's geometry is produced. */
export type GeometryMode = 'passthrough' | 'fromXY' | 'none'

export interface GeometryMapping {
  mode: GeometryMode
  /** for fromXY */
  xField?: string
  yField?: string
  zField?: string
  /** wkid the X/Y values are expressed in (defaults to 4326). */
  sourceWkid?: number
}

export interface FieldMappingConfig {
  rules: FieldMappingRule[]
  geometry: GeometryMapping
  /** last-wins (default) lets a later rule overwrite an earlier rule's target. */
  conflictResolution?: 'lastWins' | 'firstWins'
  /** How records are written to the target. Travels with the mapping XML so a
   *  saved workflow keeps its load behavior. */
  load?: LoadBehavior
}

/** insert: always add. update: only update rows whose key matches an existing
 *  feature. upsert: update on key match, insert otherwise. */
export type LoadMode = 'insert' | 'update' | 'upsert'

export interface LoadBehavior {
  mode?: LoadMode
  /** Target field used to match incoming rows to existing features. */
  keyField?: string
}

/** Minimal field descriptor used on both sides of the mapping UI. */
export interface SchemaField {
  name: string // physical field name (target.applyEdits uses this)
  jimuName?: string // jimu field name (source.query / record.getData uses this)
  alias?: string
  type: JimuFieldType | string
  esriType?: string // esriFieldTypeString etc, used for coercion
  nullable?: boolean
  editable?: boolean
  length?: number
  /** target only: a value already supplied by the service when omitted. */
  hasDefault?: boolean
  defaultValue?: unknown
  /** target only: coded value domain, used by the preflight QA report. */
  domain?: { type: string, codedValues?: Array<{ code: string | number, name: string }>, range?: [number, number] }
}

export interface Schema {
  fields: SchemaField[]
  objectIdField?: string
  /** target only */
  globalIdField?: string
  geometryType?: string
  wkid?: number
}

export interface MappingValidationIssue {
  level: 'error' | 'warning'
  targetField?: string
  sourceField?: string
  message: string
}

export interface TransformReportRow {
  /** index of the source record in the batch. */
  index: number
  ok: boolean
  error?: string
}

export interface LoadResult {
  attempted: number
  succeeded: number
  failed: number
  rows: TransformReportRow[]
  /** objectIds returned by the service for the inserted features. */
  addedObjectIds: Array<number | string>
  /** upsert/update accounting */
  inserted?: number
  updated?: number
}

/** Per-target-field statistics from the preflight QA pass. */
export interface FieldQA {
  field: string
  nulls: number
  coercionFailures: number
  truncations: number
  domainViolations: number
  /** up to a few sample offending values for the message */
  samples: string[]
}

export interface QAReport {
  rows: number
  fields: FieldQA[]
  /** duplicate key values found within the incoming data (key -> count>1). */
  duplicateKeysInSource: Array<{ key: string, count: number }>
  /** total warnings across the run */
  warnings: number
}
