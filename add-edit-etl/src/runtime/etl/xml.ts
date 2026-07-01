/**
 * Import / export the field-mapping configuration as XML, so a runtime user can
 * save a mapping once and reuse it across repetitive loads.
 *
 * The format is intentionally simple and human-readable. `mappingToXml` is
 * framework-free; `xmlToMapping` uses the browser DOMParser (always present in
 * the EB runtime). Parsing is tolerant: unknown elements are ignored and
 * missing optional pieces fall back to sensible defaults, but malformed XML or
 * a wrong root element throws so the UI can report it.
 */

import type {
  FieldMappingConfig, FieldMappingRule, GeometryMapping, GeometryMode,
  Cardinality, TransformMode, TransformOptions
} from './types'

export const MAPPING_XML_VERSION = '1'

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const bool = (v: unknown): string => (v ? 'true' : 'false')

function optionsToXml (opts: TransformOptions | undefined, indent: string): string {
  const o = opts || {}
  const attrs: string[] = []
  if (o.delimiter !== undefined) attrs.push(`delimiter="${esc(o.delimiter)}"`)
  if (o.regexFlags !== undefined) attrs.push(`regexFlags="${esc(o.regexFlags)}"`)
  if (o.dateFormat !== undefined) attrs.push(`dateFormat="${esc(o.dateFormat)}"`)
  if (o.unmapped !== undefined) attrs.push(`unmapped="${esc(o.unmapped)}"`)
  if (o.factor !== undefined) attrs.push(`factor="${esc(o.factor)}"`)
  if (o.offset !== undefined) attrs.push(`offset="${esc(o.offset)}"`)
  if (o.precision !== undefined) attrs.push(`precision="${esc(o.precision)}"`)
  if (o.trim !== undefined) attrs.push(`trim="${bool(o.trim)}"`)
  if (o.emptyAsNull !== undefined) attrs.push(`emptyAsNull="${bool(o.emptyAsNull)}"`)
  if (o.coerce !== undefined) attrs.push(`coerce="${bool(o.coerce)}"`)

  const children: string[] = []
  if (o.regex !== undefined) children.push(`${indent}  <regex>${esc(o.regex)}</regex>`)
  if (o.template !== undefined) children.push(`${indent}  <template>${esc(o.template)}</template>`)
  if (o.mapDefault !== undefined) {
    const t = o.mapDefault === null ? 'null' : typeof o.mapDefault
    children.push(`${indent}  <mapDefault type="${t}">${esc(o.mapDefault)}</mapDefault>`)
  }
  if (o.valueMap && Object.keys(o.valueMap).length) {
    const entries = Object.entries(o.valueMap).map(([k, v]) => {
      const t = v === null ? 'null' : typeof v
      return `${indent}    <entry key="${esc(k)}" type="${t}">${esc(v)}</entry>`
    }).join('\n')
    children.push(`${indent}  <valueMap>\n${entries}\n${indent}  </valueMap>`)
  }
  if (o.constant !== undefined) {
    const t = o.constant === null ? 'null' : typeof o.constant
    children.push(`${indent}  <constant type="${t}">${esc(o.constant)}</constant>`)
  }
  if (o.expressions && o.expressions.length) {
    const exprs = o.expressions.map(e => `${indent}    <expression>${esc(e)}</expression>`).join('\n')
    children.push(`${indent}  <expressions>\n${exprs}\n${indent}  </expressions>`)
  }

  const attrStr = attrs.length ? ' ' + attrs.join(' ') : ''
  if (!children.length) return `${indent}<options${attrStr}/>`
  return `${indent}<options${attrStr}>\n${children.join('\n')}\n${indent}</options>`
}

function ruleToXml (rule: FieldMappingRule, indent: string): string {
  const src = rule.sourceFields.map(f => `${indent}    <field>${esc(f)}</field>`).join('\n')
  const tgt = rule.targetFields.map(f => `${indent}    <field>${esc(f)}</field>`).join('\n')
  const note = rule.note !== undefined ? `${indent}  <note>${esc(rule.note)}</note>\n` : ''
  return [
    `${indent}<rule id="${esc(rule.id)}" cardinality="${esc(rule.cardinality)}" mode="${esc(rule.mode)}" enabled="${bool(rule.enabled !== false)}">`,
    note +
    `${indent}  <sourceFields>\n${src}\n${indent}  </sourceFields>`,
    `${indent}  <targetFields>\n${tgt}\n${indent}  </targetFields>`,
    optionsToXml(rule.options, indent + '  '),
    `${indent}</rule>`
  ].join('\n')
}

export function mappingToXml (config: FieldMappingConfig): string {
  const g = config.geometry || { mode: 'passthrough' as GeometryMode }
  const geomAttrs = [
    `mode="${esc(g.mode)}"`,
    g.sourceWkid !== undefined ? `sourceWkid="${esc(g.sourceWkid)}"` : '',
    g.xField !== undefined ? `xField="${esc(g.xField)}"` : '',
    g.yField !== undefined ? `yField="${esc(g.yField)}"` : '',
    g.zField !== undefined ? `zField="${esc(g.zField)}"` : ''
  ].filter(Boolean).join(' ')

  const rules = (config.rules || []).map(r => ruleToXml(r, '    ')).join('\n')

  const loadEl = config.load
    ? `  <load mode="${esc(config.load.mode || 'insert')}"${config.load.keyField ? ` keyField="${esc(config.load.keyField)}"` : ''}/>`
    : null

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<fieldMapping version="${MAPPING_XML_VERSION}">`,
    `  <conflictResolution>${esc(config.conflictResolution || 'lastWins')}</conflictResolution>`,
    ...(loadEl ? [loadEl] : []),
    `  <geometry ${geomAttrs}/>`,
    '  <rules>',
    rules,
    '  </rules>',
    '</fieldMapping>',
    ''
  ].join('\n')
}

// ---- parsing ----

const txt = (el: Element | null): string => (el?.textContent ?? '').trim()
const attr = (el: Element, name: string): string | undefined => {
  const v = el.getAttribute(name)
  return v === null ? undefined : v
}
const parseBool = (v: string | undefined): boolean | undefined =>
  v === undefined ? undefined : v === 'true'

function parseOptions (el: Element | null): TransformOptions | undefined {
  if (!el) return undefined
  const o: TransformOptions = {}
  const delimiter = attr(el, 'delimiter'); if (delimiter !== undefined) o.delimiter = delimiter
  const regexFlags = attr(el, 'regexFlags'); if (regexFlags !== undefined) o.regexFlags = regexFlags
  const dateFormat = attr(el, 'dateFormat'); if (dateFormat !== undefined) o.dateFormat = dateFormat
  const unmapped = attr(el, 'unmapped'); if (unmapped !== undefined) o.unmapped = unmapped as any
  const factor = attr(el, 'factor'); if (factor !== undefined) o.factor = Number(factor)
  const offset = attr(el, 'offset'); if (offset !== undefined) o.offset = Number(offset)
  const precision = attr(el, 'precision'); if (precision !== undefined) o.precision = Number(precision)
  const trim = parseBool(attr(el, 'trim')); if (trim !== undefined) o.trim = trim
  const emptyAsNull = parseBool(attr(el, 'emptyAsNull')); if (emptyAsNull !== undefined) o.emptyAsNull = emptyAsNull
  const coerce = parseBool(attr(el, 'coerce')); if (coerce !== undefined) o.coerce = coerce

  const regexEl = el.getElementsByTagName('regex')[0]
  if (regexEl) o.regex = txt(regexEl)

  const constEl = el.getElementsByTagName('constant')[0]
  if (constEl) {
    const t = attr(constEl, 'type')
    const raw = txt(constEl)
    o.constant = t === 'number' ? Number(raw) : t === 'boolean' ? raw === 'true' : t === 'null' ? null : raw
  }

  const tplEl = el.getElementsByTagName('template')[0]
  if (tplEl) o.template = tplEl.textContent ?? ''

  const mapDefEl = el.getElementsByTagName('mapDefault')[0]
  if (mapDefEl) {
    const t = attr(mapDefEl, 'type')
    const raw = txt(mapDefEl)
    o.mapDefault = t === 'number' ? Number(raw) : t === 'boolean' ? raw === 'true' : t === 'null' ? null : raw
  }

  const vmEl = el.getElementsByTagName('valueMap')[0]
  if (vmEl) {
    const vm: Record<string, string | number | boolean | null> = {}
    Array.from(vmEl.getElementsByTagName('entry')).forEach(en => {
      const k = attr(en, 'key')
      if (k === undefined) return
      const t = attr(en, 'type')
      const raw = (en.textContent ?? '').trim()
      vm[k] = t === 'number' ? Number(raw) : t === 'boolean' ? raw === 'true' : t === 'null' ? null : raw
    })
    o.valueMap = vm
  }

  const exprsEl = el.getElementsByTagName('expressions')[0]
  if (exprsEl) {
    o.expressions = Array.from(exprsEl.getElementsByTagName('expression')).map(e => e.textContent ?? '')
  }
  return o
}

function fieldsOf (parent: Element | null): string[] {
  if (!parent) return []
  return Array.from(parent.getElementsByTagName('field')).map(f => (f.textContent ?? '').trim()).filter(Boolean)
}

export function xmlToMapping (xml: string): FieldMappingConfig {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.getElementsByTagName('parsererror')[0]
  if (parseError) throw new Error('The file is not valid XML.')
  const root = doc.documentElement
  if (!root || root.nodeName !== 'fieldMapping') {
    throw new Error('Not a field-mapping file (expected a <fieldMapping> root element).')
  }

  const crEl = root.getElementsByTagName('conflictResolution')[0]
  const conflictResolution = txt(crEl) === 'firstWins' ? 'firstWins' : 'lastWins'

  const loadEl = root.getElementsByTagName('load')[0]
  const load = loadEl
    ? {
        mode: ((attr(loadEl, 'mode') as any) || 'insert'),
        keyField: attr(loadEl, 'keyField')
      }
    : undefined

  const gEl = root.getElementsByTagName('geometry')[0]
  const geometry: GeometryMapping = { mode: 'passthrough' }
  if (gEl) {
    geometry.mode = (attr(gEl, 'mode') as GeometryMode) || 'passthrough'
    const wkid = attr(gEl, 'sourceWkid'); if (wkid !== undefined) geometry.sourceWkid = Number(wkid)
    const xF = attr(gEl, 'xField'); if (xF !== undefined) geometry.xField = xF
    const yF = attr(gEl, 'yField'); if (yF !== undefined) geometry.yField = yF
    const zF = attr(gEl, 'zField'); if (zF !== undefined) geometry.zField = zF
  }

  const rulesParent = root.getElementsByTagName('rules')[0]
  const ruleEls = rulesParent ? Array.from(rulesParent.getElementsByTagName('rule')) : []
  const rules: FieldMappingRule[] = ruleEls.map((el, i) => {
    const sourceFields = fieldsOf(el.getElementsByTagName('sourceFields')[0])
    const targetFields = fieldsOf(el.getElementsByTagName('targetFields')[0])
    const noteEl = el.getElementsByTagName('note')[0]
    const rule: FieldMappingRule = {
      id: attr(el, 'id') || `rule_${Date.now()}_${i}`,
      cardinality: (attr(el, 'cardinality') as Cardinality) || '1:1',
      mode: (attr(el, 'mode') as TransformMode) || 'direct',
      enabled: parseBool(attr(el, 'enabled')) !== false,
      sourceFields,
      targetFields,
      options: parseOptions(el.getElementsByTagName('options')[0])
    }
    if (noteEl) rule.note = txt(noteEl)
    return rule
  })

  const out: FieldMappingConfig = { rules, geometry, conflictResolution }
  if (load) out.load = load
  return out
}
