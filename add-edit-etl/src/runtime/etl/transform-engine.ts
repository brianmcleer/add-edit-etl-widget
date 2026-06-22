/**
 * Transform engine.
 *
 * Pure, framework-free logic: given a plain source attribute object and a set
 * of mapping rules, produce a target attribute object whose values are coerced
 * to the target schema's field types. Keeping this free of jimu/JSAPI imports
 * makes it unit-testable and reusable by the per-record review path and the
 * bulk-load path alike.
 */

import type {
  FieldMappingRule,
  SchemaField,
  TransformMode,
  TransformOptions,
  MappingValidationIssue,
  FieldMappingConfig
} from './types'

const isNil = (v: unknown): boolean => v === null || v === undefined
const isEmpty = (v: unknown): boolean => isNil(v) || (typeof v === 'string' && v.trim() === '')

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

/**
 * Helpers exposed to user expressions. Expressions are written by the person
 * using the widget (e.g. `helpers.upper($.FIRST) + ' ' + $.LAST`). They run
 * only in that user's own browser - there is no server eval - but the app
 * author can still disable the 'expression' mode entirely via config
 * (allowExpressions=false) if untrusted runtime users are a concern.
 */
export const expressionHelpers = {
  concat: (...args: unknown[]) => args.filter(a => !isNil(a)).join(''),
  join: (sep: string, ...args: unknown[]) => args.filter(a => !isNil(a)).join(sep),
  upper: (s: unknown) => (isNil(s) ? s : String(s).toUpperCase()),
  lower: (s: unknown) => (isNil(s) ? s : String(s).toLowerCase()),
  trim: (s: unknown) => (isNil(s) ? s : String(s).trim()),
  substring: (s: unknown, start: number, end?: number) => (isNil(s) ? s : String(s).substring(start, end)),
  replace: (s: unknown, a: string, b: string) => (isNil(s) ? s : String(s).split(a).join(b)),
  toNumber: (s: unknown) => {
    if (isNil(s) || s === '') return null
    const n = Number(s)
    return Number.isNaN(n) ? null : n
  },
  toString: (s: unknown) => (isNil(s) ? s : String(s)),
  ifNull: (v: unknown, fallback: unknown) => (isNil(v) ? fallback : v),
  coalesce: (...args: unknown[]) => args.find(a => !isEmpty(a)) ?? null,
  now: () => Date.now(),
  padStart: (s: unknown, len: number, pad = '0') => (isNil(s) ? s : String(s).padStart(len, pad))
}

/**
 * Evaluate a single expression against a source attribute object.
 * The Function is built in strict mode with only `$` (the source row) and
 * `helpers` in scope; it has no lexical access to widget/window state.
 */
export function evaluateExpression (expression: string, source: Record<string, unknown>): unknown {
  if (!expression || expression.trim() === '') return null
  // eslint-disable-next-line no-new-func
  const fn = new Function('$', 'helpers', '"use strict"; return (' + expression + ');')
  return fn(source, expressionHelpers)
}

// ---------------------------------------------------------------------------
// Type coercion
// ---------------------------------------------------------------------------

const INT_TYPES = new Set([
  'esriFieldTypeSmallInteger', 'esriFieldTypeInteger', 'esriFieldTypeOID',
  'esriFieldTypeBigInteger'
])
const FLOAT_TYPES = new Set(['esriFieldTypeSingle', 'esriFieldTypeDouble'])
const STRING_TYPES = new Set(['esriFieldTypeString', 'esriFieldTypeGUID', 'esriFieldTypeGlobalID', 'esriFieldTypeXML'])
const DATE_TYPES = new Set(['esriFieldTypeDate', 'esriFieldTypeDateOnly', 'esriFieldTypeTimestampOffset'])

/** Coerce a raw value to the esri field type of the target field. */
export function coerceValue (value: unknown, target: SchemaField): { value: unknown, issue?: MappingValidationIssue } {
  const esriType = target.esriType || ''
  if (isNil(value)) {
    if (target.nullable === false && !target.hasDefault) {
      return { value: null, issue: { level: 'warning', targetField: target.name, message: `Non-nullable field "${target.name}" received an empty value.` } }
    }
    return { value: null }
  }

  if (INT_TYPES.has(esriType)) {
    const n = typeof value === 'number' ? value : parseInt(String(value).trim(), 10)
    if (Number.isNaN(n)) return { value: null, issue: { level: 'warning', targetField: target.name, message: `Could not coerce "${String(value)}" to integer for "${target.name}".` } }
    return { value: Math.trunc(n) }
  }
  if (FLOAT_TYPES.has(esriType)) {
    const n = typeof value === 'number' ? value : Number(String(value).trim())
    if (Number.isNaN(n)) return { value: null, issue: { level: 'warning', targetField: target.name, message: `Could not coerce "${String(value)}" to number for "${target.name}".` } }
    return { value: n }
  }
  if (DATE_TYPES.has(esriType)) {
    if (typeof value === 'number') return { value }
    const t = Date.parse(String(value))
    if (Number.isNaN(t)) return { value: null, issue: { level: 'warning', targetField: target.name, message: `Could not parse date "${String(value)}" for "${target.name}".` } }
    return { value: t } // applyEdits expects epoch ms for date fields
  }
  if (STRING_TYPES.has(esriType)) {
    let s = String(value)
    let issue: MappingValidationIssue | undefined
    if (typeof target.length === 'number' && target.length > 0 && s.length > target.length) {
      s = s.substring(0, target.length)
      issue = { level: 'warning', targetField: target.name, message: `Value truncated to ${target.length} chars for "${target.name}".` }
    }
    return { value: s, issue }
  }
  // unknown/other types: pass through
  return { value }
}

// ---------------------------------------------------------------------------
// Per-mode value production
// ---------------------------------------------------------------------------

function applyStringOpts (v: unknown, opts: TransformOptions): unknown {
  if (typeof v === 'string') {
    if (opts.trim) v = v.trim()
    if (opts.emptyAsNull && v === '') return null
  }
  return v
}

/**
 * Produce the raw (un-coerced) value(s) a rule contributes, returned as a map
 * of targetFieldName -> raw value. The caller coerces afterwards.
 */
export function runRule (rule: FieldMappingRule, source: Record<string, unknown>): Record<string, unknown> {
  const opts = rule.options || {}
  const mode: TransformMode = rule.mode
  const src = rule.sourceFields.map(f => source[f])
  const out: Record<string, unknown> = {}

  switch (mode) {
    case 'constant': {
      rule.targetFields.forEach(t => { out[t] = opts.constant ?? null })
      return out
    }
    case 'direct': {
      out[rule.targetFields[0]] = applyStringOpts(src[0], opts)
      return out
    }
    case 'concat': {
      const sep = opts.delimiter ?? ' '
      const joined = src.filter(v => !isNil(v)).map(v => String(v)).join(sep)
      out[rule.targetFields[0]] = applyStringOpts(joined, opts)
      return out
    }
    case 'coalesce': {
      const first = src.find(v => !isEmpty(v))
      out[rule.targetFields[0]] = applyStringOpts(first ?? null, opts)
      return out
    }
    case 'sum':
    case 'avg':
    case 'min':
    case 'max': {
      const nums = src.map(v => Number(v)).filter(n => !Number.isNaN(n))
      let val: number | null = null
      if (nums.length > 0) {
        if (mode === 'sum') val = nums.reduce((a, b) => a + b, 0)
        else if (mode === 'avg') val = nums.reduce((a, b) => a + b, 0) / nums.length
        else if (mode === 'min') val = Math.min(...nums)
        else val = Math.max(...nums)
      }
      out[rule.targetFields[0]] = val
      return out
    }
    case 'duplicate': {
      rule.targetFields.forEach(t => { out[t] = applyStringOpts(src[0], opts) })
      return out
    }
    case 'splitDelimiter': {
      const sep = opts.delimiter ?? ','
      const parts = isNil(src[0]) ? [] : String(src[0]).split(sep)
      rule.targetFields.forEach((t, i) => { out[t] = applyStringOpts(parts[i] ?? null, opts) })
      return out
    }
    case 'splitRegex': {
      let groups: RegExpMatchArray | null = null
      if (!isNil(src[0]) && opts.regex) {
        try {
          const re = new RegExp(opts.regex, opts.regexFlags || '')
          groups = String(src[0]).match(re)
        } catch (e) { groups = null }
      }
      // groups[1..n] are capture groups; assign in order to targets
      rule.targetFields.forEach((t, i) => { out[t] = applyStringOpts(groups?.[i + 1] ?? null, opts) })
      return out
    }
    case 'expression': {
      rule.targetFields.forEach((t, i) => {
        const expr = opts.expressions?.[i] ?? opts.expressions?.[0] ?? ''
        let v: unknown = null
        try { v = evaluateExpression(expr, source) } catch (e) { v = null }
        out[t] = applyStringOpts(v, opts)
      })
      return out
    }
    default:
      return out
  }
}

// ---------------------------------------------------------------------------
// Whole-record transform
// ---------------------------------------------------------------------------

export interface TransformOutput {
  attributes: Record<string, unknown>
  issues: MappingValidationIssue[]
}

export function transformRecord (
  source: Record<string, unknown>,
  config: FieldMappingConfig,
  targetFields: SchemaField[]
): TransformOutput {
  const targetByName = new Map(targetFields.map(f => [f.name, f]))
  const conflict = config.conflictResolution || 'lastWins'
  const attributes: Record<string, unknown> = {}
  const written = new Set<string>()
  const issues: MappingValidationIssue[] = []

  for (const rule of config.rules) {
    if (rule.enabled === false) continue
    const raw = runRule(rule, source)
    for (const [tName, rawVal] of Object.entries(raw)) {
      if (conflict === 'firstWins' && written.has(tName)) continue
      const tField = targetByName.get(tName)
      if (!tField) continue
      const coerced = (rule.options?.coerce === false)
        ? { value: rawVal as unknown, issue: undefined as MappingValidationIssue | undefined }
        : coerceValue(rawVal, tField)
      attributes[tName] = coerced.value
      if (coerced.issue) issues.push(coerced.issue)
      written.add(tName)
    }
  }

  return { attributes, issues }
}

/**
 * Static validation of a mapping config against both schemas. Surfaces:
 *  - required (non-nullable, no default) target fields that nothing writes
 *  - rules referencing missing source/target fields
 *  - cardinality / field-count mismatches
 *  - expression count mismatches
 */
export function validateMapping (
  config: FieldMappingConfig,
  sourceFields: SchemaField[],
  targetFields: SchemaField[]
): MappingValidationIssue[] {
  const issues: MappingValidationIssue[] = []
  const sourceNames = new Set(sourceFields.map(f => f.jimuName || f.name))
  const targetNames = new Set(targetFields.map(f => f.name))
  const writtenTargets = new Set<string>()

  for (const rule of config.rules) {
    if (rule.enabled === false) continue
    rule.sourceFields.forEach(s => {
      if (rule.mode !== 'constant' && !sourceNames.has(s)) {
        issues.push({ level: 'error', sourceField: s, message: `Source field "${s}" is not in the added data.` })
      }
    })
    rule.targetFields.forEach(t => {
      if (!targetNames.has(t)) issues.push({ level: 'error', targetField: t, message: `Target field "${t}" is not in the target layer.` })
      writtenTargets.add(t)
    })
    // cardinality sanity
    if (rule.cardinality === '1:1' && (rule.sourceFields.length > 1 || rule.targetFields.length > 1)) {
      issues.push({ level: 'warning', message: `Rule ${rule.id} is marked 1:1 but has multiple fields.` })
    }
    if (rule.cardinality === 'M:1' && rule.targetFields.length !== 1) {
      issues.push({ level: 'warning', message: `Rule ${rule.id} is M:1 but writes ${rule.targetFields.length} targets.` })
    }
    if (rule.cardinality === '1:M' && rule.sourceFields.length !== 1) {
      issues.push({ level: 'warning', message: `Rule ${rule.id} is 1:M but reads ${rule.sourceFields.length} sources.` })
    }
    if (rule.mode === 'expression' && (rule.options?.expressions?.length ?? 0) < rule.targetFields.length) {
      issues.push({ level: 'warning', message: `Rule ${rule.id} has fewer expressions than target fields; missing ones resolve to null.` })
    }
  }

  // required targets unmapped
  for (const tf of targetFields) {
    if (tf.editable === false) continue
    if (tf.nullable === false && !tf.hasDefault && !writtenTargets.has(tf.name)) {
      issues.push({ level: 'error', targetField: tf.name, message: `Required target field "${tf.name}" is not mapped.` })
    }
  }

  return issues
}
