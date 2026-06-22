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

  const chunkSize = options.chunkSize || 200
  const gdbVersion = (targetDs as any).getGDBVersion?.()
  const addedObjectIds: Array<number | string> = []
  let succeeded = 0
  let failed = reports.filter(r => !r.ok).length
  let done = 0

  for (let start = 0; start < graphics.length; start += chunkSize) {
    const slice = graphics.slice(start, start + chunkSize)
    const sliceRows = rowMap.slice(start, start + chunkSize)
    try {
      const result = await layer.applyEdits({ addFeatures: slice }, { gdbVersion })
      const addResults = result?.addFeatureResults || []
      addResults.forEach((ar: any, idx: number) => {
        const sourceIndex = sliceRows[idx]
        const rep = reports.find(r => r.index === sourceIndex)
        if (ar.error) {
          if (rep) { rep.ok = false; rep.error = (ar.error.message || 'applyEdits error') + hint }
          failed++
        } else {
          if (ar.objectId != null) addedObjectIds.push(ar.objectId)
          else if (ar.globalId != null) addedObjectIds.push(ar.globalId)
          succeeded++
        }
      })
      // refresh jimu data source so app sees the inserts
      updateDataSourceAfterEdit(targetDs as any, { addFeatures: slice })
    } catch (e) {
      sliceRows.forEach(sourceIndex => {
        const rep = reports.find(r => r.index === sourceIndex)
        if (rep) { rep.ok = false; rep.error = ((e as Error)?.message || 'applyEdits failed') + hint }
      })
      failed += slice.length
    }
    done += slice.length
    options.onProgress?.(done, graphics.length)
  }

  return {
    attempted: reports.length,
    succeeded,
    failed,
    rows: reports,
    addedObjectIds
  }
}
