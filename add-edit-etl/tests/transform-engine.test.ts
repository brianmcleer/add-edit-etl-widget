import { transformRecord, validateMapping } from '../src/runtime/etl/transform-engine'
import type { FieldMappingConfig, SchemaField } from '../src/runtime/etl/types'

const targetFields: SchemaField[] = [
  { name: 'FULLNAME', type: 'STRING', esriType: 'esriFieldTypeString', nullable: true, length: 50, editable: true },
  { name: 'FIRST', type: 'STRING', esriType: 'esriFieldTypeString', nullable: true, editable: true },
  { name: 'LAST', type: 'STRING', esriType: 'esriFieldTypeString', nullable: true, editable: true },
  { name: 'CITY', type: 'STRING', esriType: 'esriFieldTypeString', nullable: true, editable: true },
  { name: 'STATE', type: 'STRING', esriType: 'esriFieldTypeString', nullable: true, editable: true },
  { name: 'TOTAL', type: 'NUMBER', esriType: 'esriFieldTypeDouble', nullable: true, editable: true },
  { name: 'SCORE', type: 'NUMBER', esriType: 'esriFieldTypeInteger', nullable: true, editable: true },
  { name: 'STATUS', type: 'STRING', esriType: 'esriFieldTypeString', nullable: false, editable: true },
  { name: 'COMBO', type: 'STRING', esriType: 'esriFieldTypeString', nullable: true, editable: true }
] as any

const geom = { mode: 'none' as const }

describe('ETL transform engine - cardinalities', () => {
  it('1:1 direct trims and coerces to target type', () => {
    const cfg: FieldMappingConfig = { rules: [
      { id: 'r1', cardinality: '1:1', sourceFields: ['fname'], targetFields: ['FIRST'], mode: 'direct', options: { trim: true } },
      { id: 'r2', cardinality: '1:1', sourceFields: ['score_str'], targetFields: ['SCORE'], mode: 'direct', options: { coerce: true } }
    ], geometry: geom }
    const { attributes } = transformRecord({ fname: '  Ada ', score_str: '42.9' }, cfg, targetFields)
    expect(attributes.FIRST).toBe('Ada')
    expect(attributes.SCORE).toBe(42)
  })

  it('M:1 concat / coalesce / sum', () => {
    const cfg: FieldMappingConfig = { rules: [
      { id: 'a', cardinality: 'M:1', sourceFields: ['first', 'last'], targetFields: ['FULLNAME'], mode: 'concat', options: { delimiter: ' ' } },
      { id: 'b', cardinality: 'M:1', sourceFields: ['email', 'altemail'], targetFields: ['STATUS'], mode: 'coalesce' },
      { id: 'c', cardinality: 'M:1', sourceFields: ['q1', 'q2', 'q3'], targetFields: ['TOTAL'], mode: 'sum' }
    ], geometry: geom }
    const { attributes } = transformRecord({ first: 'Ada', last: 'Lovelace', email: '', altemail: 'a@x.io', q1: 1, q2: '2', q3: 3 }, cfg, targetFields)
    expect(attributes.FULLNAME).toBe('Ada Lovelace')
    expect(attributes.STATUS).toBe('a@x.io')
    expect(attributes.TOTAL).toBe(6)
  })

  it('1:M splitDelimiter / splitRegex / duplicate', () => {
    const cfg: FieldMappingConfig = { rules: [
      { id: 'a', cardinality: '1:M', sourceFields: ['place'], targetFields: ['CITY', 'STATE'], mode: 'splitDelimiter', options: { delimiter: ', ', trim: true } },
      { id: 'b', cardinality: '1:M', sourceFields: ['code'], targetFields: ['FIRST', 'LAST'], mode: 'splitRegex', options: { regex: '^(\\w+)-(\\w+)$' } },
      { id: 'c', cardinality: '1:M', sourceFields: ['tag'], targetFields: ['COMBO', 'STATUS'], mode: 'duplicate' }
    ], geometry: geom }
    const { attributes } = transformRecord({ place: 'Denver, CO', code: 'AB-CD', tag: 'live' }, cfg, targetFields)
    expect(attributes.CITY).toBe('Denver')
    expect(attributes.STATE).toBe('CO')
    expect(attributes.FIRST).toBe('AB')
    expect(attributes.LAST).toBe('CD')
    expect(attributes.COMBO).toBe('live')
    expect(attributes.STATUS).toBe('live')
  })

  it('M:M expression maps many sources to many targets', () => {
    const cfg: FieldMappingConfig = { rules: [
      { id: 'a', cardinality: 'M:M', sourceFields: ['fn', 'ln'], targetFields: ['FULLNAME', 'COMBO'], mode: 'expression',
        options: { expressions: ["helpers.join(' ', $.fn, $.ln)", "helpers.upper($.ln) + '_' + $.fn"] } }
    ], geometry: geom }
    const { attributes } = transformRecord({ fn: 'Grace', ln: 'Hopper' }, cfg, targetFields)
    expect(attributes.FULLNAME).toBe('Grace Hopper')
    expect(attributes.COMBO).toBe('HOPPER_Grace')
  })

  it('validation flags missing source and required unmapped target', () => {
    const cfg: FieldMappingConfig = { rules: [
      { id: 'a', cardinality: '1:1', sourceFields: ['nope'], targetFields: ['FIRST'], mode: 'direct' }
    ], geometry: geom }
    const issues = validateMapping(cfg, [{ name: 'real', jimuName: 'real', type: 'STRING' }] as any, targetFields)
    expect(issues.some(i => i.level === 'error' && /not in the added data/.test(i.message))).toBe(true)
    expect(issues.some(i => i.level === 'error' && i.targetField === 'STATUS')).toBe(true)
  })
})
