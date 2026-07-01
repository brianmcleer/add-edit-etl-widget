import { transformRecord, validateMapping, analyzeRecords } from '../src/runtime/etl/transform-engine'
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

describe('ETL transform engine - v1.2 modes', () => {
  it('dateParse honors a format hint and rejects rollovers', () => {
    const cfg: FieldMappingConfig = { rules: [
      { id: 'd1', cardinality: '1:1', sourceFields: ['when'], targetFields: ['FULLNAME'], mode: 'dateParse', options: { dateFormat: 'MM/DD/YYYY', coerce: false } }
    ], geometry: geom }
    const ok = transformRecord({ when: '06/15/2026' }, cfg, targetFields)
    expect(ok.attributes.FULLNAME).toBe(new Date(2026, 5, 15).getTime())
    const bad = transformRecord({ when: '13/45/2026' }, cfg, targetFields)
    expect(bad.attributes.FULLNAME).toBeNull()
  })

  it('valueMap maps, passes through, nulls, or defaults unmapped values', () => {
    const base = { id: 'v1', cardinality: '1:1' as const, sourceFields: ['s'], targetFields: ['STATUS'], mode: 'valueMap' as const }
    const mapped = transformRecord({ s: 'OOS' }, { rules: [{ ...base, options: { valueMap: { OOS: 'Out of Service' } } }], geometry: geom }, targetFields)
    expect(mapped.attributes.STATUS).toBe('Out of Service')
    const def = transformRecord({ s: 'ZZ' }, { rules: [{ ...base, options: { valueMap: {}, unmapped: 'default', mapDefault: 'Unknown' } }], geometry: geom }, targetFields)
    expect(def.attributes.STATUS).toBe('Unknown')
  })

  it('numberScale converts units with precision', () => {
    const cfg: FieldMappingConfig = { rules: [
      { id: 'n1', cardinality: '1:1', sourceFields: ['ft'], targetFields: ['TOTAL'], mode: 'numberScale', options: { factor: 0.3048, precision: 2 } }
    ], geometry: geom }
    const { attributes } = transformRecord({ ft: '100' }, cfg, targetFields)
    expect(attributes.TOTAL).toBe(30.48)
  })

  it('template renders {field} placeholders', () => {
    const cfg: FieldMappingConfig = { rules: [
      { id: 't1', cardinality: 'M:1', sourceFields: ['num', 'street'], targetFields: ['COMBO'], mode: 'template', options: { template: '{num} {street}' } }
    ], geometry: geom }
    const { attributes } = transformRecord({ num: 680, street: 'North Ave' }, cfg, targetFields)
    expect(attributes.COMBO).toBe('680 North Ave')
  })

  it('analyzeRecords reports domain violations and duplicate keys', () => {
    const tf: any = [
      { name: 'STATUS', type: 'STRING', esriType: 'esriFieldTypeString', domain: { type: 'codedValue', codedValues: [{ code: 'Active', name: 'Active' }] } },
      { name: 'FIRST', type: 'STRING', esriType: 'esriFieldTypeString' }
    ]
    const cfg: FieldMappingConfig = { rules: [
      { id: 'a', cardinality: '1:1', sourceFields: ['s'], targetFields: ['STATUS'], mode: 'direct' },
      { id: 'b', cardinality: '1:1', sourceFields: ['k'], targetFields: ['FIRST'], mode: 'direct' }
    ], geometry: geom }
    const qa = analyzeRecords([
      { s: 'Active', k: 'A' }, { s: 'Broken', k: 'A' }
    ], cfg, tf, 'FIRST')
    expect(qa.fields.find(f => f.field === 'STATUS')?.domainViolations).toBe(1)
    expect(qa.duplicateKeysInSource).toEqual([{ key: 'A', count: 2 }])
  })
})
