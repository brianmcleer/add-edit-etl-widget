/** @jsx jsx */
import { React, jsx, css, hooks, type FeatureLayerDataSource } from 'jimu-core'
import { Button, Alert, Select, Option, Label, defaultMessages as jimuUIMessages } from 'jimu-ui'
import defaultMessages from '../translations/default'
import type { Schema, SchemaField, FieldMappingConfig, MappingValidationIssue, LoadResult, QAReport, LoadMode } from '../etl/types'
import { transformRecord, validateMapping, analyzeRecords } from '../etl/transform-engine'
import { readSourceRecords } from '../etl/schema'
import { buildAddFeatures, loadIntoTarget, type SourceRow } from '../etl/apply'

const { useState, useMemo, useCallback } = React

type Phase = 'idle' | 'reading' | 'transforming' | 'writing' | 'done'

interface Props {
  sourceDs: FeatureLayerDataSource
  targetDs: FeatureLayerDataSource
  sourceSchema: Schema
  targetSchema: Schema
  targetFields: SchemaField[]
  mapping: FieldMappingConfig
  chunkSize: number
  enableReviewEdit: boolean
  /** author toggle: expose update/upsert load modes at runtime */
  allowUpsert?: boolean
  onMappingChange?: (m: FieldMappingConfig) => void
  onReviewEdit: (addedObjectIds: Array<number | string>) => void
  onLoaded?: (result: LoadResult) => void
}

const fmt = (n: number) => {
  try { return n.toLocaleString() } catch { return String(n) }
}

const LoadPanel = (props: Props) => {
  const { sourceDs, targetDs, sourceSchema, targetSchema, targetFields, mapping, chunkSize, enableReviewEdit, allowUpsert, onMappingChange, onReviewEdit, onLoaded } = props
  const translate = hooks.useTranslation(jimuUIMessages, defaultMessages)

  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<{ done: number, total: number }>({ done: 0, total: 0 })
  const [result, setResult] = useState<LoadResult | null>(null)
  const [previewAttrs, setPreviewAttrs] = useState<Record<string, unknown> | null>(null)
  const [qa, setQa] = useState<QAReport | null>(null)
  const [qaBusy, setQaBusy] = useState(false)

  const loadMode: LoadMode = mapping.load?.mode || 'insert'
  const keyField = mapping.load?.keyField || ''
  const keyFieldDef = targetFields.find(f => f.name === keyField)
  const setLoad = useCallback((patch: Record<string, unknown>) => {
    onMappingChange?.({ ...mapping, load: { mode: loadMode, keyField, ...patch } as any })
  }, [mapping, loadMode, keyField, onMappingChange])

  const busy = phase !== 'idle' && phase !== 'done'

  const doQa = useCallback(async () => {
    setQa(null)
    setQaBusy(true)
    try {
      const raw = await readSourceRecords(sourceDs)
      const rows = raw.map(r => r.attributes)
      setQa(analyzeRecords(rows, mapping, targetFields, keyField || undefined))
    } catch (e) {
      setQa({ rows: 0, fields: [], duplicateKeysInSource: [], warnings: 0 })
    }
    setQaBusy(false)
  }, [sourceDs, mapping, targetFields, keyField])

  const downloadFailedCsv = useCallback(() => {
    if (!result) return
    const failedRows = result.rows.filter(r => !r.ok)
    const lines = ['row_index,error']
    failedRows.forEach(r => {
      const err = (r.error || '').replace(/"/g, '""')
      lines.push(`${r.index},"${err}"`)
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'failed-rows.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [result])

  const issues = useMemo<MappingValidationIssue[]>(
    () => validateMapping(mapping, sourceSchema.fields, targetFields),
    [mapping, sourceSchema.fields, targetFields]
  )
  const errors = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')

  const doPreview = useCallback(async () => {
    setPreviewAttrs(null)
    try {
      const res = await sourceDs.query({ where: '1=1', outFields: ['*'], returnGeometry: false, pageSize: 1, page: 1 } as any)
      const first = (res?.records || [])[0]
      const data = (first as any)?.getData?.() || {}
      const { attributes } = transformRecord(data, mapping, targetFields)
      setPreviewAttrs(attributes)
    } catch (e) {
      setPreviewAttrs({ error: (e as Error).message })
    }
  }, [sourceDs, mapping, targetFields])

  const doLoad = useCallback(async () => {
    setResult(null)
    setProgress({ done: 0, total: 0 })
    try {
      setPhase('reading')
      const raw = await readSourceRecords(sourceDs)
      const rows: SourceRow[] = raw.map(r => ({ attributes: r.attributes, geometry: r.geometry }))

      setPhase('transforming')
      const built = await buildAddFeatures(rows, mapping, targetSchema, targetFields)

      setPhase('writing')
      setProgress({ done: 0, total: built.graphics.length })
      const res = await loadIntoTarget(targetDs, built.graphics, built.rowMap, built.reports, {
        chunkSize,
        mode: loadMode,
        keyField: loadMode !== 'insert' ? keyField : undefined,
        keyIsString: keyFieldDef ? (keyFieldDef.esriType === 'esriFieldTypeString' || keyFieldDef.esriType === 'esriFieldTypeGUID' || keyFieldDef.esriType === 'esriFieldTypeGlobalID') : true,
        onProgress: (done, total) => setProgress({ done, total })
      })
      setResult(res)
      onLoaded?.(res)
    } catch (e) {
      setResult({ attempted: 0, succeeded: 0, failed: 0, rows: [{ index: -1, ok: false, error: (e as Error).message }], addedObjectIds: [] })
    }
    setPhase('done')
  }, [sourceDs, targetDs, mapping, targetSchema, targetFields, chunkSize, loadMode, keyField, keyFieldDef, onLoaded])

  const determinate = phase === 'writing' && progress.total > 0
  const pct = determinate ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0
  const phaseLabel = phase === 'reading'
    ? translate('phaseReading')
    : phase === 'transforming'
      ? translate('phaseTransforming')
      : phase === 'writing'
        ? translate('phaseWriting')
        : translate('phaseDonePrefix')

  return (
    <div css={style} className='etl-load-panel'>
      {errors.length > 0 && (
        <Alert type='error' className='mb-2' withIcon text={translate('validationErrors')} open>
          <ul>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </Alert>
      )}
      {errors.length === 0 && warnings.length === 0 && (
        <Alert type='success' className='mb-2' withIcon text={translate('noIssues')} open />
      )}
      {warnings.length > 0 && (
        <Alert type='warning' className='mb-2' withIcon text={translate('validationWarnings')} open>
          <ul>{warnings.slice(0, 8).map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Alert>
      )}

      {allowUpsert !== false && (
        <div className='load-behavior mb-2'>
          <div>
            <Label className='blk-label'>{translate('loadMode')}</Label>
            <Select size='sm' aria-label={translate('loadMode')} value={loadMode} onChange={(e) => setLoad({ mode: e.target.value })}>
              <Option value='insert'>{translate('loadModeInsert')}</Option>
              <Option value='update'>{translate('loadModeUpdate')}</Option>
              <Option value='upsert'>{translate('loadModeUpsert')}</Option>
            </Select>
          </div>
          {loadMode !== 'insert' && (
            <div>
              <Label className='blk-label'>{translate('keyField')}</Label>
              <Select size='sm' aria-label={translate('keyField')} value={keyField} onChange={(e) => setLoad({ keyField: e.target.value })}>
                <Option value=''>{translate('keyFieldNone')}</Option>
                {targetFields.map(f => <Option key={f.name} value={f.name}>{f.alias || f.name}</Option>)}
              </Select>
            </div>
          )}
          {loadMode !== 'insert' && !keyField && (
            <div className='opt-hint'>{translate('keyFieldRequired')}</div>
          )}
        </div>
      )}

      <div className='actions d-flex' style={{ gap: 8 }}>
        <Button size='sm' type='tertiary' onClick={doQa} disabled={busy || qaBusy}>{qaBusy ? translate('qaChecking') : translate('qaCheck')}</Button>
        <Button size='sm' type='tertiary' onClick={doPreview} disabled={busy}>{translate('previewRow')}</Button>
        <Button size='sm' type='primary' onClick={doLoad} disabled={busy || errors.length > 0 || (loadMode !== 'insert' && !keyField)}>
          {busy ? translate('loadingBtn') : translate('load', { count: '' })}
        </Button>
      </div>

      {qa && !busy && (
        <div className='qa-report mt-2'>
          <div className='qa-title'>{translate('qaTitle', { rows: fmt(qa.rows), warnings: fmt(qa.warnings) })}</div>
          {qa.fields.length === 0 && qa.duplicateKeysInSource.length === 0 && (
            <Alert type='success' withIcon open text={translate('qaClean')} />
          )}
          {qa.fields.length > 0 && (
            <table className='qa-table'>
              <caption className='sr-only'>{translate('qaCaption')}</caption>
              <thead>
                <tr>
                  <th>{translate('qaField')}</th>
                  <th>{translate('qaNulls')}</th>
                  <th>{translate('qaCoercion')}</th>
                  <th>{translate('qaTrunc')}</th>
                  <th>{translate('qaDomain')}</th>
                  <th>{translate('qaSamples')}</th>
                </tr>
              </thead>
              <tbody>
                {qa.fields.map(f => (
                  <tr key={f.field}>
                    <td>{f.field}</td>
                    <td>{fmt(f.nulls)}</td>
                    <td>{fmt(f.coercionFailures)}</td>
                    <td>{fmt(f.truncations)}</td>
                    <td>{fmt(f.domainViolations)}</td>
                    <td className='samples'>{f.samples.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {qa.duplicateKeysInSource.length > 0 && (
            <Alert type='warning' withIcon open className='mt-1'
              text={translate('qaDupKeys', { count: fmt(qa.duplicateKeysInSource.length) })}>
              <div className='samples'>{qa.duplicateKeysInSource.slice(0, 5).map(d => `${d.key} (x${d.count})`).join(', ')}</div>
            </Alert>
          )}
        </div>
      )}

      {previewAttrs && !busy && (
        <div className='preview mt-2'>
          <table>
            <caption className='sr-only'>{translate('previewCaption')}</caption>
            <tbody>
              {Object.entries(previewAttrs).map(([k, v]) => (
                <tr key={k}><td className='k'>{k}</td><td className='v'>{v === null || v === undefined ? '∅' : String(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {busy && (
        <div className='progress-card mt-2' role='status' aria-live='polite'>
          <div className='pc-head'>
            <span className='pc-label'>{phaseLabel}</span>
            {determinate && <span className='pc-pct'>{pct}%</span>}
          </div>
          <div className={'pc-track' + (determinate ? '' : ' indeterminate')}>
            <div className='pc-fill' style={determinate ? { width: pct + '%' } : undefined} />
          </div>
          <div className='pc-sub'>
            {determinate
              ? translate('featuresOfTotal', { done: fmt(progress.done), total: fmt(progress.total) })
              : '\u00A0'}
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className='result mt-2'>
          <Alert type={result.failed === 0 ? 'success' : 'warning'} withIcon open
            text={translate('loadDone', { ok: result.succeeded, attempted: result.attempted, failed: result.failed })} />
          {(result.inserted !== undefined || result.updated !== undefined) && (result.updated || 0) > 0 && (
            <div className='upsert-counts'>{translate('upsertCounts', { inserted: fmt(result.inserted || 0), updated: fmt(result.updated || 0) })}</div>
          )}
          {result.failed > 0 && (
            <ul className='fail-list'>
              {result.rows.filter(r => !r.ok).slice(0, 10).map((r, i) => (
                <li key={i}>#{r.index}: {r.error}</li>
              ))}
            </ul>
          )}
          {result.failed > 0 && (
            <Button size='sm' type='tertiary' className='mt-1' onClick={downloadFailedCsv}>{translate('downloadFailed')}</Button>
          )}
          {enableReviewEdit && result.succeeded > 0 && (
            <Button size='sm' type='secondary' className='mt-2' onClick={() => onReviewEdit(result.addedObjectIds)}>
              {translate('reviewEdit')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export default LoadPanel

const style = css`
  font-size: 0.8125rem;
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .load-behavior { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
  .load-behavior .opt-hint, .opt-hint { grid-column: 1 / -1; color: var(--sys-color-surface-paper-hint); font-size: 0.6875rem; }
  .blk-label { font-weight: 600; font-size: 0.75rem; margin-bottom: 2px; display: block; }
  .qa-report { border: 1px solid var(--sys-color-divider-secondary); border-radius: 4px; padding: 8px; }
  .qa-title { font-weight: 600; margin-bottom: 6px; }
  .qa-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
  .qa-table th, .qa-table td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--sys-color-divider-secondary); }
  .qa-table .samples, .samples { color: var(--sys-color-surface-paper-hint); font-family: monospace; font-size: 0.6875rem; word-break: break-all; }
  .upsert-counts { font-size: 0.75rem; margin-top: 4px; color: var(--sys-color-surface-paper-hint); }
  .preview table { width: 100%; border-collapse: collapse; }
  .preview td { border-bottom: 1px solid var(--sys-color-divider-secondary); padding: 2px 6px; }
  .preview td.k { color: var(--sys-color-surface-paper-hint); font-family: monospace; white-space: nowrap; }

  .progress-card {
    border: 1px solid var(--sys-color-divider-secondary);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--sys-color-surface-overlay);
  }
  .pc-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
  .pc-label { font-weight: 500; color: var(--sys-color-surface-paper-text); }
  .pc-pct { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--sys-color-primary-main); }
  .pc-track {
    position: relative;
    height: 8px;
    border-radius: 999px;
    background: var(--sys-color-divider-secondary);
    overflow: hidden;
  }
  .pc-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--sys-color-primary-main);
    transition: width 0.3s ease;
  }
  .pc-track.indeterminate .pc-fill {
    width: 35%;
    animation: pc-slide 1.1s ease-in-out infinite;
  }
  @keyframes pc-slide {
    0% { transform: translateX(-120%); }
    100% { transform: translateX(320%); }
  }
  .pc-sub {
    margin-top: 6px;
    font-size: 0.75rem;
    color: var(--sys-color-surface-paper-hint);
    font-variant-numeric: tabular-nums;
  }
  .fail-list { margin-top: 4px; color: var(--sys-color-error-main); font-size: 0.75rem; }
`
