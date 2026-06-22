/**
 * Geometry handling for the merge step.
 *
 *  - passthrough: reuse the source feature's geometry, reprojecting to the
 *    target layer's spatial reference when they differ.
 *  - fromXY: build a point from two (optionally three) source attribute fields.
 *  - none: append as a table row (no geometry).
 *
 * Projection uses the JSAPI projection engine, loaded on demand so the module
 * stays light when geometry is passthrough within the same SR.
 */

import { loadArcGISJSAPIModules } from 'jimu-core'
import type EsriGeometry from 'esri/geometry/Geometry'
import type { GeometryMapping, Schema } from './types'

let _project: any
let _Point: any
let _SpatialReference: any

async function ensureModules () {
  if (_project && _Point && _SpatialReference) return
  const [projectOperator, Point, SpatialReference] = await loadArcGISJSAPIModules([
    'esri/geometry/operators/projectOperator',
    'esri/geometry/Point',
    'esri/geometry/SpatialReference'
  ])
  if (!projectOperator.isLoaded()) await projectOperator.load()
  _project = projectOperator
  _Point = Point
  _SpatialReference = SpatialReference
}

export async function buildGeometryForRecord (
  mapping: GeometryMapping,
  sourceAttrs: Record<string, unknown>,
  sourceGeometry: EsriGeometry | null,
  target: Schema
): Promise<EsriGeometry | null> {
  if (mapping.mode === 'none') return null

  const targetWkid = target.wkid || 4326

  if (mapping.mode === 'fromXY') {
    const x = Number(sourceAttrs[mapping.xField])
    const y = Number(sourceAttrs[mapping.yField])
    if (Number.isNaN(x) || Number.isNaN(y)) return null
    await ensureModules()
    const z = mapping.zField != null ? Number(sourceAttrs[mapping.zField]) : undefined
    let pt = new _Point({ x, y, z: Number.isNaN(z) ? undefined : z, spatialReference: new _SpatialReference({ wkid: mapping.sourceWkid || 4326 }) })
    if ((mapping.sourceWkid || 4326) !== targetWkid) {
      pt = _project.execute(pt, new _SpatialReference({ wkid: targetWkid }))
    }
    return pt
  }

  // passthrough
  if (!sourceGeometry) return null
  const srcWkid = (sourceGeometry as any).spatialReference?.wkid
  if (srcWkid && srcWkid !== targetWkid) {
    await ensureModules()
    return _project.execute(sourceGeometry, new _SpatialReference({ wkid: targetWkid }))
  }
  return sourceGeometry
}
