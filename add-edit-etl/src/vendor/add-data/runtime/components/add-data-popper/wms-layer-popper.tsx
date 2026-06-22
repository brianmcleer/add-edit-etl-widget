/** @jsx jsx */
import { React, jsx, css, classNames, loadArcGISJSAPIModule } from 'jimu-core'
import { Popper, PanelHeader, TextInput, Loading, LoadingType, Button, Tooltip } from 'jimu-ui'
import { SearchOutlined } from 'jimu-icons/outlined/editor/search'
import { CheckOutlined } from 'jimu-icons/outlined/application/check'

const { useState, useMemo, useRef, useEffect, useCallback } = React

const WMS_POPPER_DEFAULT_SIZE = { width: 240, height: 600 }

interface WmsSublayerInfo {
  id: string
  title?: string
  name?: string
}

export interface WmsLayerPopperProps {
  open: boolean
  url: string
  reference: React.RefObject<HTMLElement>
  translate: (id: string, values?: any) => string
  onConfirm: (options: { layerId: string }) => void
  onClose: () => void
  onError: (message: string) => void
  failedToFetchMessage: string
}

export const WmsLayerPopper = (props: WmsLayerPopperProps) => {
  const { open, url, reference, translate, onConfirm, onClose, onError, failedToFetchMessage } = props
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [sublayers, setSublayers] = useState<WmsSublayerInfo[]>([])
  const [searchText, setSearchText] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const lastUrlRef = useRef<string>(null)
  const [referenceSize, setReferenceSize] = useState(WMS_POPPER_DEFAULT_SIZE)

  const fetchWmsSublayers = useCallback(async (serviceUrl: string) => {
    setIsLoading(true)
    try {
      const WMSLayer = await loadArcGISJSAPIModule('esri/layers/WMSLayer') as typeof __esri.WMSLayer
      const layer = new WMSLayer({ url: serviceUrl })
      await layer.load()
      const allSublayers = (layer.allSublayers?.toArray() || layer.sublayers?.toArray() || [])
      const nextSublayers = allSublayers
        .filter((sublayer) => sublayer?.id != null)
        .map((sublayer) => ({
          id: `${sublayer.id}`,
          title: (sublayer as any).title,
          name: (sublayer as any).name
        }))
      if (!nextSublayers.length) {
        throw new Error('NoSublayers')
      }
      setSublayers(nextSublayers)
      setSelectedIds(new Set())
      lastUrlRef.current = serviceUrl
    } catch (err) {
      onError(failedToFetchMessage)
      onClose()
    } finally {
      setIsLoading(false)
    }
  }, [failedToFetchMessage, onClose, onError])

  useEffect(() => {
    if (!open) {
      return
    }
    if (!url) {
      return
    }
    setSearchText('')
    if (url !== lastUrlRef.current) {
      setSublayers([])
      setSelectedIds(new Set())
      void fetchWmsSublayers(url)
    }
  }, [open, url, fetchWmsSublayers])

  const updateReferenceSize = useCallback(() => {
    const node = reference?.current
    if (!node) {
      return
    }
    const rect = node.getBoundingClientRect()
    if (rect?.width && rect?.height) {
      setReferenceSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }
  }, [reference])

  useEffect(() => {
    if (!open) {
      return
    }
    updateReferenceSize()
    if (!reference?.current || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => { updateReferenceSize() })
    observer.observe(reference.current)
    return () => {
      observer.disconnect()
    }
  }, [open, reference, updateReferenceSize])

  const filteredSublayers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) {
      return sublayers
    }
    return sublayers.filter((sublayer) => {
      const name = sublayer.name?.toLowerCase() || ''
      const title = sublayer.title?.toLowerCase() || ''
      return name.includes(keyword) || title.includes(keyword) || sublayer.id.includes(keyword)
    })
  }, [sublayers, searchText])

  const toggleSublayer = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allSelected = sublayers.length > 0 && selectedIds.size === sublayers.length
  const onToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sublayers.map((s) => s.id)))
    }
  }

  const handleConfirm = () => {
    if (!selectedIds.size) {
      return
    }
    const selectedInOrder = sublayers.filter((s) => selectedIds.has(s.id)).map((s) => s.id)
    onConfirm({ layerId: selectedInOrder.join('-') })
  }

  if (!open) {
    return null
  }

  return (
    <Popper
      open={open}
      toggle={onClose}
      reference={reference}
      placement='top-start'
      offsetOptions={[0, -referenceSize.height]}
      css={wmsPopperStyle}
      autoFocus={false}
      trapFocus={false}
      forceLatestFocusElements>
      <div className='wms-layer-popper' style={{ width: referenceSize.width, height: referenceSize.height }}>
        <PanelHeader title={translate('addLayer')} className='p-4' showClose={false} level={1} />
        <div className='wms-layer-content'>
          <div className='url-input-label'>
            {translate('selectLayersToAdd')}
          </div>
          <TextInput
            className='wms-layer-search'
            allowClear
            prefix={<SearchOutlined size='s' />}
            value={searchText}
            onChange={(evt) => { setSearchText(evt.target.value) }}
            placeholder={translate('SearchLabel')}
          />
          <div className='wms-layer-list' role='listbox' aria-label={translate('selectLayer')}>
            {
              isLoading && <div className='wms-layer-loading'>
                <Loading className='wms-layer-loading-spinner' type={LoadingType.Donut} width={24} height={24} />
              </div>
            }
            {
              !isLoading && filteredSublayers.length === 0 &&
              <div className='wms-layer-empty'>{translate('noAvailableLayers')}</div>
            }
            {
              !isLoading && filteredSublayers.map((sublayer) => {
                const label = sublayer.title || sublayer.name || sublayer.id
                const selected = selectedIds.has(sublayer.id)
                return (
                  <Tooltip title={label} enterDelay={1000} enterNextDelay={1000}>
                    <button
                      key={sublayer.id}
                      type='button'
                      className={classNames('wms-layer-item', { selected })}
                      onClick={() => { toggleSublayer(sublayer.id) }}
                      role='option'
                      aria-selected={selected}>
                      <span className={classNames('wms-layer-item-icon', { selected })}>
                        <CheckOutlined size='s' />
                      </span>
                      <span className='wms-layer-item-label'>{label}</span>
                    </button>
                  </Tooltip>
                )
              })
            }
          </div>
          <Button
            className='wms-layer-select-toggle'
            variant='text'
            color='primary'
            disabled={isLoading || sublayers.length === 0}
            onClick={onToggleSelectAll}>
            {translate(allSelected ? 'deselectAll' : 'selectAll')}
          </Button>
          <div className='wms-layer-actions'>
            <Button type='primary' className='w-100 mb-2' disabled={!selectedIds.size} onClick={handleConfirm}>
              {translate('ok')}
            </Button>
            <Button className='w-100' onClick={onClose}>
              {translate('cancel')}
            </Button>
          </div>
        </div>
      </div>
    </Popper>
  )
}

const wmsPopperStyle = css`
  z-index: 2;
  background: none;
  border: none;
  box-shadow: none;
  overflow: visible;
  .wms-layer-popper {
    color: var(--sys-color-surface-overlay-text);
    display: flex;
    flex-direction: column;
    background: var(--sys-color-surface-overlay);
    border-width: 1px;
    border-style: solid;
    border-color: var(--sys-color-divider-secondary);
    border-radius: var(--sys-shape-2);
    box-shadow: var(--sys-shadow-2);
    .panel-header {
      .title {
        color: var(--sys-color-surface-overlay-text);
      }
      .jimu-btn {
        color: var(--sys-color-action-text);
      }
    }
    .url-input-label {
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 8px;
      color: var(--sys-color-surface-overlay-text);
    }
  }
  .wms-layer-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    padding: 0 16px 16px 16px;
    .wms-layer-search {
      .input-wrapper {
        border-bottom: none;
        border-bottom-left-radius: 0px;
        border-bottom-right-radius: 0px;
      }
    }
  }
  .wms-layer-list {
    border: 1px solid var(--sys-color-divider-primary);
    border-radius: var(--sys-shape-1);
    border-top-left-radius: 0;
    border-top-right-radius: 0;
    max-height: 140px;
    overflow-y: auto;
    margin-bottom: 12px;
    position: relative;
  }
  .wms-layer-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 8px 0 6px;
    height: 28px;
    line-height: 28px;
    background: none;
    border: 1px solid transparent;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .wms-layer-item:hover {
    background: var(--sys-color-action-hover);
  }
  .wms-layer-item-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    margin-right: 6px;
    opacity: 0;
  }
  .wms-layer-item-icon.selected {
    opacity: 1;
  }
  .wms-layer-item-label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wms-layer-empty {
    padding: 4px 8px;
    color: var(--sys-color-action-disabled-text);
  }
  .wms-layer-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 80px;
    padding: 12px 0;
  }
  .wms-layer-actions {
    margin-top: auto;
  }
  .wms-layer-actions .jimu-btn {
    justify-content: center;
  }
  .wms-layer-select-toggle {
    padding: 0;
    width: auto;
    align-self: flex-start;
    margin-bottom: 12px;
  }
`
