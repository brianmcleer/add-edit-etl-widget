/** @jsx jsx */
import { React, jsx, css, classNames, loadArcGISJSAPIModule } from 'jimu-core'
import { Popper, PanelHeader, TextInput, NumericInput, Loading, LoadingType, Button, Tooltip } from 'jimu-ui'
import { SearchOutlined } from 'jimu-icons/outlined/editor/search'
import { CheckOutlined } from 'jimu-icons/outlined/application/check'

const { useState, useMemo, useRef, useEffect, useCallback } = React

const DEFAULT_WFS_MAX_RECORD_COUNT = 1000
const WFS_POPPER_DEFAULT_SIZE = { width: 240, height: 600 }

interface WfsFeatureType {
  name: string
  title?: string
}

interface WfsCapabilities {
  featureTypes?: WfsFeatureType[]
}

export interface WfsLayerPopperProps {
  open: boolean
  url: string
  reference: React.RefObject<HTMLElement>
  translate: (id: string, values?: any) => string
  onConfirm: (options: { layerName: string, maxRecordCount: number }) => void
  onClose: () => void
  onError: (message: string) => void
  failedToFetchMessage: string
}

export const WfsLayerPopper = (props: WfsLayerPopperProps) => {
  const { open, url, reference, translate, onConfirm, onClose, onError, failedToFetchMessage } = props
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [featureTypes, setFeatureTypes] = useState<WfsFeatureType[]>([])
  const [searchText, setSearchText] = useState<string>('')
  const [selectedName, setSelectedName] = useState<string>(null)
  const [maxRecordCount, setMaxRecordCount] = useState<number>(DEFAULT_WFS_MAX_RECORD_COUNT)
  const lastUrlRef = useRef<string>(null)
  const [referenceSize, setReferenceSize] = useState(WFS_POPPER_DEFAULT_SIZE)

  const fetchWfsFeatureTypes = useCallback(async (serviceUrl: string) => {
    setIsLoading(true)
    try {
      const wfsUtils = await loadArcGISJSAPIModule('esri/layers/ogc/wfsUtils') as {
        getCapabilities: (url: string) => Promise<WfsCapabilities>
      }
      const capabilities = await wfsUtils.getCapabilities(serviceUrl)
      const nextFeatureTypes = (capabilities?.featureTypes || []).filter(featureType => !!featureType?.name)
      if (!nextFeatureTypes.length) {
        throw new Error('NoFeatureTypes')
      }
      setFeatureTypes(nextFeatureTypes)
      setSelectedName(nextFeatureTypes[0].name)
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
      setFeatureTypes([])
      setSelectedName(null)
      setMaxRecordCount(DEFAULT_WFS_MAX_RECORD_COUNT)
      void fetchWfsFeatureTypes(url)
    }
  }, [open, url, fetchWfsFeatureTypes])

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

  const filteredFeatureTypes = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) {
      return featureTypes
    }
    return featureTypes.filter(featureType => {
      const name = featureType?.name?.toLowerCase() || ''
      const title = featureType?.title?.toLowerCase() || ''
      return name.includes(keyword) || title.includes(keyword)
    })
  }, [featureTypes, searchText])

  const onMaxRecordCountChange = (value?: number) => {
    if (typeof value !== 'number' || isNaN(value)) {
      setMaxRecordCount(DEFAULT_WFS_MAX_RECORD_COUNT)
      return
    }
    setMaxRecordCount(Math.min(30000, Math.max(1, Math.floor(value))))
  }

  const handleConfirm = () => {
    if (!selectedName) {
      return
    }
    onConfirm({ layerName: selectedName, maxRecordCount })
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
      css={wfsPopperStyle}
      autoFocus={false}
      trapFocus={false}
      forceLatestFocusElements>
      <div className='wfs-layer-popper' style={{ width: referenceSize.width, height: referenceSize.height }}>
        <PanelHeader title={translate('addLayer')} className='p-4' showClose={false} level={1} />
        <div className='wfs-layer-content'>
          <div className='url-input-label'>
            {translate('selectLayer')}
          </div>
          <TextInput
            className='wfs-layer-search'
            allowClear
            prefix={<SearchOutlined size='s' />}
            value={searchText}
            onChange={(evt) => { setSearchText(evt.target.value) }}
            placeholder={translate('SearchLabel')}
          />
          <div className='wfs-layer-list' role='listbox' aria-label={translate('selectLayer')}>
            {
              isLoading && <div className='wfs-layer-loading'>
                <Loading className='wfs-layer-loading-spinner' type={LoadingType.Donut} width={24} height={24} />
              </div>
            }
            {
              !isLoading && filteredFeatureTypes.length === 0 &&
              <div className='wfs-layer-empty'>{translate('noAvailableLayers')}</div>
            }
            {
              !isLoading && filteredFeatureTypes.map((featureType) => {
                const label = featureType.title || featureType.name
                const selected = featureType.name === selectedName
                return (
                  <Tooltip title={label} enterDelay={1000} enterNextDelay={1000}>
                    <button
                      key={featureType.name}
                      type='button'
                      className={classNames('wfs-layer-item', { selected })}
                      onClick={() => { setSelectedName(featureType.name) }}
                      role='option'
                      aria-selected={selected}>
                      <span className={classNames('wfs-layer-item-icon', { selected })}>
                        <CheckOutlined size='s' />
                      </span>
                      <span className='wfs-layer-item-label'>{label}</span>
                    </button>
                  </Tooltip>
                )
              })
            }
          </div>
          <div className='wfs-layer-max-record'>
            <div className='url-input-label wfs-layer-max-record-label'>{translate('maximumRecordCount')}</div>
            <NumericInput
              size='sm'
              min={1}
              max={30000}
              showHandlers
              value={maxRecordCount}
              onChange={onMaxRecordCountChange}
              aria-label={translate('maximumRecordCount')}
            />
          </div>
          <div className='wfs-layer-actions'>
            <Button type='primary' className='w-100 mb-2' disabled={!selectedName} onClick={handleConfirm}>
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

const wfsPopperStyle = css`
  z-index: 2;
  background: none;
  border: none;
  box-shadow: none;
  overflow: visible;
  .wfs-layer-popper {
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
  .wfs-layer-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    padding: 0 16px 16px 16px;
    .wfs-layer-search {
      .input-wrapper {
        border-bottom: none;
        border-bottom-left-radius: 0px;
        border-bottom-right-radius: 0px;
      }
    }
  }
  .wfs-layer-list {
    border: 1px solid var(--sys-color-divider-primary);
    border-radius: var(--sys-shape-1);
    border-top-left-radius: 0;
    border-top-right-radius: 0;
    max-height: 140px;
    overflow-y: auto;
    margin-bottom: 12px;
    position: relative;
  }
  .wfs-layer-item {
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
  .wfs-layer-item:hover {
    background: var(--sys-color-action-hover);
  }
  .wfs-layer-item-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    margin-right: 6px;
    opacity: 0;
  }
  .wfs-layer-item-icon.selected {
    opacity: 1;
  }
  .wfs-layer-item-label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wfs-layer-empty {
    padding: 4px 8px;
    color: var(--sys-color-action-disabled-text);
  }
  .wfs-layer-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 80px;
    padding: 12px 0;
  }
  .wfs-layer-max-record {
    margin-bottom: 12px;
  }
  .wfs-layer-max-record-label {
    margin-bottom: 6px;
  }
  .wfs-layer-actions {
    margin-top: auto;
  }
  .wfs-layer-actions .jimu-btn {
    justify-content: center;
  }
`
