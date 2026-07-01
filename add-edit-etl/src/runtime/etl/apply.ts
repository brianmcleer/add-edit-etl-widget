/**
 * Load step - turn transformed records into Graphics and append them to the
 * configured editable target layer via applyEdits, in chunks, then refresh the
 * jimu data source so the rest of the app (tables, the Edit feature form, etc.)
 * sees the new rows immediately.
 *
 * This deliberately reuses the Edit widget's own post-edit refresh
 * (updateDataSourceAfterEdit) so behaviour matches the OOTB Edit widget.
 */

import { loadArcGISJSAPIModules, type FeatureLayerDataSource } from 'jimu-core'
import type EsriGeometry from 'esri/geometry/Geometry'
import type EsriGraphic from 'esri/Graphic'
import type EsriFeatureLayer from 'esri/layers/FeatureLayer'
import { updateDataSourceAfterEdit } from '../../vendor/edit/runtime/components/utils'
import { transformRecord } from './transform-engine'
import { buildGeometryForRecord } from './geometry'
import type { FieldMappingConfig, Schema, LoadResult, SchemaField, TransformReportRow } from './types'

export interface SourceRow {
  attributes: Record<string, unknown>
  geometry: EsriGeometry | null
}

export interface BuildResult {
  graphics: EsriGraphic[]
  rowMap: number[] // graphics[i] came from source row rowMap[i]
  reports: TransformReportRow[]
}

/** Transform every source row into a JSAPI Graphic ready for applyEdits. */
export async function buildAddFeatures (
  rows: SourceRow[],
  mapping: FieldMappingConfig,
  targetSchema: Schema,
  targetFields: SchemaField[]
): Promise<BuildResult> {
  const [Graphic] = await loadArcGISJSAPIModules(['esri/Graphic'])
  const graphics: EsriGraphic[] = []
  const rowMap: number[] = []
  const reports: TransformReportRow[] = []

  for (let i = 0; i < rows.length; i++) {
    try {
      const { attributes } = transformRecord(rows[i].attributes, mapping, targetFields)
      const geometry = await buildGeometryForRecord(mapping.geometry, rows[i].attributes, rows[i].geometry, targetSchema)
      const g = new Graphic({ attributes, geometry: geometry || undefined })
      graphics.push(g)
      rowMap.push(i)
      reports.push({ index: i, ok: true })
    } catch (e) {
      reports.push({ index: i, ok: false, error: (e as Error)?.message || 'transform failed' })
    }
  }
  return { graphics, rowMap, reports }
}

export interface LoadOptions {
  chunkSize?: number
  gdbVersion?: string
  onProgress?: (done: number, total: number) => void
  /** insert (default) | update | upsert, with the target key field to match on. */
  mode?: 'insert' | 'update' | 'upsert'
  keyField?: string
  /** whether the key field is a string type (for SQL quoting). */
  keyIsString?: boolean
}

/** Resolve a usable JSAPI FeatureLayer from a jimu data source. */
async function resolveTargetLayer (targetDs: FeatureLayerDataSource): Promise<EsriFeatureLayer | null> {
  let layer: any
  try {
    layer = await (targetDs as any).createJSAPILayerByDataSource?.()
  } catch (e) {
    layer = undefined
  }
  if (!layer) layer = (targetDs as any).layer
  if (!layer) return null
  try { await layer.load?.() } catch (e) { /* applyEdits will surface load errors */ }
  return layer as EsriFeatureLayer
}

/** Only a hard block: no layer at all, or no applyEdits method to call. */
function hasApplyEdits (layer: any): layer is EsriFeatureLayer {
  return !!layer && typeof layer.applyEdits === 'function'
}

/** SQL-quote a key value for a where clause. */
function sqlLiteral (v: unknown, isString: boolean): string {
  if (isString) return "'" + String(v).replace(/'/g, "''") + "'"
  return String(v)
}

/**
 * Query the target service for existing features whose key field matches any
 * incoming key, returning key -> objectId. Batched IN clauses keep the where
 * length sane. Per the JS SDK, FeatureLayer.queryFeatures queries the service
 * directly, so this sees all existing rows, not just drawn ones.
 */
export async function fetchExistingKeys (
  layer: EsriFeatureLayer,
  keyField: string,
  keys: unknown[],
  keyIsString: boolean
): Promise<Map<string, number | string>> {
  const found = new Map<string, number | string>()
  const oidField = (layer as any).objectIdField || 'OBJECTID'
  const unique = Array.from(new Set(keys.filter(k => k !== null && k !== undefined && k !== '').map(k => String(k))))
  const batchSize = 300
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize)
    const where = `${keyField} IN (${batch.map(k => sqlLiteral(k, keyIsString)).join(',')})`
    const q = (layer as any).createQuery()
    q.where = where
    q.outFields = [oidField, keyField]
    q.returnGeometry = false
    const res = await (layer as any).queryFeatures(q)
    for (const f of res?.features || []) {
      const k = f.attributes?.[keyField]
      const oid = f.attributes?.[oidField]
      if (k !== null && k !== undefined && oid !== null && oid !== undefined && !found.has(String(k))) {
        found.set(String(k), oid)
      }
    }
  }
  return found
}


/** Human-readable note about what the layer reports, appended to real errors. */
function capabilityHint (layer: any): string {
  const ops = layer?.capabilities?.operations
  const bits: string[] = []
  if (layer?.editingEnabled === false) bits.push('editingEnabled=false')
  if (ops && ops.supportsAdd === false) bits.push('supportsAdd=false')
  if (ops && ops.supportsAdd === true) bits.push('supportsAdd=true')
  return bits.length ? ' [layer reports: ' + bits.join(', ') + ']' : ''
}

/** Append graphics to the target layer in chunks, collecting service results. */
export async function loadIntoTarget (
  targetDs: FeatureLayerDataSource,
  graphics: EsriGraphic[],
  rowMap: number[],
  baseReports: TransformReportRow[],
  options: LoadOptions = {}
): Promise<LoadResult> {
  const layer = await resolveTargetLayer(targetDs)
  const reports = baseReports.slice()

  if (!hasApplyEdits(layer)) {
    const msg = 'Could not resolve an editable feature layer from the configured target data source.'
    rowMap.forEach(srcIdx => {
      const rep = reports.find(r => r.index === srcIdx)
      if (rep) { rep.ok = false; rep.error = msg } else reports.push({ index: srcIdx, ok: false, error: msg })
    })
    return { attempted: graphics.length, succeeded: 0, failed: reports.filter(r => !r.ok).length, rows: reports, addedObjectIds: [] }
  }

  const hint = capabilityHint(layer)

  const mode = options.mode || 'insert'
  const keyField = options.keyField

  // For update/upsert, look up which incoming keys already exist on the service
  // and stamp matches with the existing objectId so applyEdits updates them.
  let existing = new Map<string, number | string>()
  const oidField = (layer as any).objectIdField || 'OBJECTID'
  if (mode !== 'insert' && keyField) {
    try {
      const keys = graphics.map(g => (g as any).attributes?.[keyField])
      existing = await fetchExistingKeys(layer, keyField, keys, options.keyIsString !== false)
    } catch (e) {
      const msg = 'Could not query existing features by key: ' + ((e as Error)?.message || 'query failed')
      rowMap.forEach(srcIdx => {
        const rep = reports.find(r => r.index === srcIdx)
        if (rep) { rep.ok = false; rep.error = msg } else reports.push({ index: srcIdx, ok: false, error: msg })
      })
      return { attempted: graphics.length, succeeded: 0, failed: reports.filter(r => !r.ok).length, rows: reports, addedObjectIds: [], inserted: 0, updated: 0 }
    }
  }

  const chunkSize = options.chunkSize || 200
  const gdbVersion = (targetDs as any).getGDBVersion?.()
  const addedObjectIds: Array<number | string> = []
  let succeeded = 0
  let failed = reports.filter(r => !r.ok).length
  let inserted = 0
  let updated = 0
  let done = 0

  for (let start = 0; start < graphics.length; start += chunkSize) {
    const slice = graphics.slice(start, start + chunkSize)
    const sliceRows = rowMap.slice(start, start + chunkSize)

    // route each graphic: add, update (existing oid attached), or skip
    const addFeatures: EsriGraphic[] = []
    const addRows: number[] = []
    const updateFeatures: EsriGraphic[] = []
    const updateRows: number[] = []

    slice.forEach((g, idx) => {
      const srcIdx = sliceRows[idx]
      const key = keyField ? (g as any).attributes?.[keyField] : undefined
      const oid = key !== null && key !== undefined ? existing.get(String(key)) : undefined
      if (mode === 'insert' || (mode === 'upsert' && oid === undefined)) {
        addFeatures.push(g); addRows.push(srcIdx)
      } else if (oid !== undefined) {
        ;(g as any).attributes[oidField] = oid
        updateFeatures.push(g); updateRows.push(srcIdx)
      } else {
        // update-only mode with no match: report as skipped
        const rep = reports.find(r => r.index === srcIdx)
        const msg = `No existing feature matches key "${String(key)}" (update-only mode).`
        if (rep) { rep.ok = false; rep.error = msg }
        failed++
      }
    })

    try {
      const edits: any = {}
      if (addFeatures.length) edits.addFeatures = addFeatures
      if (updateFeatures.length) edits.updateFeatures = updateFeatures
      if (!addFeatures.length && !updateFeatures.length) {
        done += slice.length
        options.onProgress?.(done, graphics.length)
        continue
      }
      const result = await layer.applyEdits(edits, { gdbVersion })
      const addResults = result?.addFeatureResults || []
      addResults.forEach((ar: any, idx: number) => {
        const sourceIndex = addRows[idx]
        const rep = reports.find(r => r.index === sourceIndex)
        if (ar.error) {
          if (rep) { rep.ok = false; rep.error = (ar.error.message || 'applyEdits error') + hint }
          failed++
        } else {
          if (ar.objectId != null) addedObjectIds.push(ar.objectId)
          else if (ar.globalId != null) addedObjectIds.push(ar.globalId)
          succeeded++; inserted++
        }
      })
      const updateResults = result?.updateFeatureResults || []
      updateResults.forEach((ur: any, idx: number) => {
        const sourceIndex = updateRows[idx]
        const rep = reports.find(r => r.index === sourceIndex)
        if (ur.error) {
          if (rep) { rep.ok = false; rep.error = (ur.error.message || 'applyEdits update error') + hint }
          failed++
        } else {
          if (ur.objectId != null) addedObjectIds.push(ur.objectId)
          succeeded++; updated++
        }
      })
      // refresh jimu data source so app sees the changes
      updateDataSourceAfterEdit(targetDs as any, edits)
    } catch (e) {
      const affected = [...addRows, ...updateRows]
      affected.forEach(sourceIndex => {
        const rep = reports.find(r => r.index === sourceIndex)
        if (rep) { rep.ok = false; rep.error = ((e as Error)?.message || 'applyEdits failed') + hint }
      })
      failed += affected.length
    }
    done += slice.length
    options.onProgress?.(done, graphics.length)
  }

  return {
    attempted: reports.length,
    succeeded,
    failed,
    rows: reports,
    addedObjectIds,
    inserted,
    updated
  }
}
