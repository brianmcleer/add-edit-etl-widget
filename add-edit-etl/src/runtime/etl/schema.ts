/**
 * Schema helpers - bridge between jimu DataSources and the framework-free
 * transform engine.
 *
 *  - readSourceSchema(): the schema of the layer the user just added. We read
 *    jimu field names (used by record.getData()) AND the physical name.
 *  - readTargetSchema(): the schema + editability of the configured editable
 *    layer, including esri field types used for coercion, nullability and the
 *    presence of service-side defaults (so required-field validation is sane).
 *  - autoMatch(): proposes 1:1 rules where source and target field names/aliases
 *    line up, giving the user a head start before they refine cardinalities.
 */

import { type FeatureLayerDataSource, type DataSource, dataSourceUtils } from 'jimu-core'
import type EsriGeometry from 'esri/geometry/Geometry'
import type { Schema, SchemaField, FieldMappingRule, FieldMappingConfig } from './types'

function normName (s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function readSourceSchema (ds: DataSource): Schema {
  const schema = ds?.getSchema?.()
  const fields: SchemaField[] = []
  if (schema?.fields) {
    Object.values(schema.fields).forEach((f: any) => {
      fields.push({
        name: f.name,
        jimuName: f.jimuName || f.name,
        alias: f.alias,
        type: f.type,
        esriType: f.esriType,
        nullable: f.nullable !== false,
        length: f.length
      })
    })
  }
  const fld = (ds as FeatureLayerDataSource)
  return {
    fields,
    objectIdField: schema?.idField,
    geometryType: fld?.getGeometryType?.() as string,
    wkid: (fld?.getLayerDefinition?.() as any)?.extent?.spatialReference?.wkid
  }
}

export function readTargetSchema (ds: FeatureLayerDataSource): Schema {
  const schema = ds?.getSchema?.()
  const layerDef: any = ds?.getLayerDefinition?.() || {}
  const defByName = new Map<string, any>((layerDef.fields || []).map((f: any) => [f.name, f]))
  const fields: SchemaField[] = []
  if (schema?.fields) {
    Object.values(schema.fields).forEach((f: any) => {
      const raw = defByName.get(f.name) || {}
      fields.push({
        name: f.name,
        jimuName: f.jimuName || f.name,
        alias: f.alias || raw.alias,
        type: f.type,
        esriType: f.esriType || raw.type,
        nullable: raw.nullable !== false,
        editable: raw.editable !== false,
        length: f.length || raw.length,
        hasDefault: raw.defaultValue !== null && raw.defaultValue !== undefined,
        defaultValue: raw.defaultValue,
        domain: raw.domain && raw.domain.type === 'codedValue'
          ? { type: 'codedValue', codedValues: (raw.domain.codedValues || []).map((cv: any) => ({ code: cv.code, name: cv.name })) }
          : (raw.domain && raw.domain.type === 'range' ? { type: 'range', range: raw.domain.range } : undefined)
      })
    })
  }
  return {
    fields,
    objectIdField: layerDef.objectIdField || schema?.idField,
    globalIdField: layerDef.globalIdField,
    geometryType: layerDef.geometryType,
    wkid: layerDef.extent?.spatialReference?.wkid
  }
}

/** Editable target fields excluding system-managed ones. */
export function editableTargetFields (target: Schema, layerDef: any): SchemaField[] {
  const editInfo = layerDef?.editFieldsInfo || {}
  const system = new Set([
    target.objectIdField, target.globalIdField,
    editInfo.creationDateField, editInfo.creatorField,
    editInfo.editDateField, editInfo.editorField,
    layerDef?.geometryProperties?.shapeAreaFieldName,
    layerDef?.geometryProperties?.shapeLengthFieldName
  ].filter(Boolean))
  return target.fields.filter(f => f.editable !== false && !system.has(f.name))
}

/**
 * Propose 1:1 direct rules by matching normalized field names then aliases.
 * Returns rules the user can keep, delete or convert to other cardinalities.
 */
export function autoMatch (source: Schema, targetFields: SchemaField[]): FieldMappingRule[] {
  const rules: FieldMappingRule[] = []
  const usedSources = new Set<string>()
  const sourceIndex = source.fields.map(f => ({ f, n: normName(f.name), a: normName(f.alias || '') }))

  targetFields.forEach((t, i) => {
    const tn = normName(t.name)
    const ta = normName(t.alias || '')
    let hit = sourceIndex.find(s => !usedSources.has(s.f.jimuName) && s.n === tn)
    if (!hit) hit = sourceIndex.find(s => !usedSources.has(s.f.jimuName) && ta && s.a === ta)
    if (!hit) hit = sourceIndex.find(s => !usedSources.has(s.f.jimuName) && (s.n === ta || s.a === tn))
    if (hit) {
      usedSources.add(hit.f.jimuName)
      rules.push({
        id: `rule_${Date.now()}_${i}`,
        cardinality: '1:1',
        sourceFields: [hit.f.jimuName],
        targetFields: [t.name],
        mode: 'direct',
        options: { coerce: true, trim: true },
        enabled: true
      })
    }
  })
  return rules
}

export function emptyMappingConfig (): FieldMappingConfig {
  return { rules: [], geometry: { mode: 'passthrough', sourceWkid: 4326 }, conflictResolution: 'lastWins' }
}

/**
 * Read every source record as a plain attribute object keyed by jimuName,
 * plus the JSAPI geometry (if any) for passthrough. Paginated to stay within
 * service limits.
 */
export async function readSourceRecords (
  ds: FeatureLayerDataSource,
  pageSize = 1000
): Promise<Array<{ attributes: Record<string, unknown>, geometry: EsriGeometry | null }>> {
  const out: Array<{ attributes: Record<string, unknown>, geometry: EsriGeometry | null }> = []
  let start = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await ds.query({
      where: '1=1',
      outFields: ['*'],
      returnGeometry: true,
      page: Math.floor(start / pageSize) + 1,
      pageSize
    } as any)
    const records = result?.records || []
    for (const r of records) {
      const data = (r as any).getData?.() || {}
      let geometry: EsriGeometry | null = null
      try {
        const f = (r as any).feature
        if (f?.geometry) geometry = await dataSourceUtils.changeToJSAPIGraphic(f).then((g: any) => g.geometry)
      } catch (e) { geometry = null }
      out.push({ attributes: data, geometry })
    }
    if (records.length < pageSize) break
    start += pageSize
    if (start > 200000) break // hard safety cap
  }
  return out
}
