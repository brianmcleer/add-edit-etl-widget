/** @jsx jsx */
import { React, jsx, css, uuidv1, DataSourceTypes, loadArcGISJSAPIModule, getAppStore, defaultMessages as jimuCoreMessages, hooks, polished, focusElementInKeyboardMode, moduleLoader, dataSourceUtils } from 'jimu-core'
import { Loading, LoadingType, Input, Label, Icon, Button, Alert, CollapsablePanel, Select, useTrapFocusLoop, defaultMessages as jimuUIMessages } from 'jimu-ui'

import { PlusOutlined } from 'jimu-icons/outlined/editor/plus'

import defaultMessages from '../../translations/default'
import type { DataOptions, FeatureCollection, LayerInFeatureCollection } from '../../types'
import { getNextAddedDataId, isIOSDevice, preventDefault } from '../../utils'
import { useTheme } from 'jimu-theme'

export interface DataFileUploadProps {
  className?: string
  widgetId: string
  portalUrl: string
  multiDataOptions: DataOptions[]
  nextOrder: number
  onlyOneTab: boolean
  onChange: (multiDataOptions: DataOptions[]) => void
  setErrorMsg: (msg: string) => void
}

interface FileInfo {
  id: string
  name: string
  type: SupportedFileTypes | null
  isZip: boolean
  data: FormData
  size: number //bytes
}

enum SupportedFileTypes {
  CSV = 'csv',
  GeoJson = 'geojson',
  Shapefile = 'shapefile',
  KML = 'kml',
  GPX = 'gpx',
  FileGeoDatabase = 'fileGeodatabase'
}

const SupportedZipFileTypes = [SupportedFileTypes.Shapefile, SupportedFileTypes.FileGeoDatabase]

const MaxFileSize: { [key in SupportedFileTypes]: number /** bytes */ } = {
  [SupportedFileTypes.CSV]: 10485760,
  [SupportedFileTypes.GeoJson]: 10485760,
  [SupportedFileTypes.Shapefile]: 2097152,
  [SupportedFileTypes.FileGeoDatabase]: 10485760,
  // KML size limitaion: https://doc.arcgis.com/en/arcgis-online/reference/kml.htm
  [SupportedFileTypes.KML]: 10485760,
  [SupportedFileTypes.GPX]: 10485760
}

const MaxFileNumber = 30

// value is translate key
enum UploadFileError {
  NotSupportedType = 'notSupportedFileTypeError',
  FailedToUpload = 'failedToUploadError',
  ExceedMaxSize = 'exceedMaxSizeError',
  ExceedMaxRecords = 'exceedMaxRecordsError',
  NoValidData = 'fileHasNoValidData',
  ExceedMaxFileNumber = 'exceedMaxFileNumberError'
}

const UploadFileErrorToMultiFilesError = new Map([
  [UploadFileError.NotSupportedType, 'multiFilesNotSupportedFileTypeError'],
  [UploadFileError.FailedToUpload, 'multiFilesFailedToUploadError'],
  [UploadFileError.ExceedMaxSize, 'multiFilesExceedMaxSizeError'],
  [UploadFileError.ExceedMaxRecords, 'multiFilesExceedMaxRecordsError'],
  [UploadFileError.NoValidData, 'multiFilesHasNoValidData']
])

const MAX_RECORD_COUNT = 4000

const { useState, useEffect, useMemo, useRef } = React

const INPUT_ACCEPT = isIOSDevice() ? undefined : Object.values(SupportedFileTypes).map(t => getFileExtension(t)).join(',')

export const DataFileUpload = (props: DataFileUploadProps) => {
  const { className = '', onChange, setErrorMsg, nextOrder, portalUrl, widgetId, multiDataOptions, onlyOneTab } = props
  const translate = hooks.useTranslation(jimuCoreMessages, jimuUIMessages, defaultMessages)
  const dragToUploadBtnId = useMemo(() => `${widgetId}-drag-to-upload`, [widgetId])
  const clickToUploadBtnId = useMemo(() => `${widgetId}-click-to-upload`, [widgetId])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const uploadingFileInfo = useRef<FileInfo[]>(null)
  const toRemoveFilesInfo = useRef<FileInfo[]>([])

  useEffect(() => {
    onChange(multiDataOptions)
  }, [multiDataOptions, onChange])

  const uploadRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = async (fileInfo: FileInfo) => {
    if (!fileInfo.type) {
      throw new Error(UploadFileError.NotSupportedType)
    }

    if (fileInfo.size > MaxFileSize[fileInfo.type]) {
      throw new Error(UploadFileError.ExceedMaxSize)
    }

    const featureCollectionResponse = await generateFeatureCollection(fileInfo, portalUrl)
    const featureCollection = (featureCollectionResponse as KmlServiceResponse)?.featureCollection || (featureCollectionResponse as FeatureCollection)
    const layers = fileInfo.type === SupportedFileTypes.KML
      ? (featureCollection?.layers || [])
      : featureCollection?.layers?.filter((ly) => ly?.featureSet?.features?.length > 0)

    if (!layers?.length) {
      throw new Error(UploadFileError.NoValidData)
    }

    if (fileInfo.type === SupportedFileTypes.KML) {
      const kmlResponse = featureCollectionResponse as KmlServiceResponse
      const groupId = getNextAddedDataId(widgetId, nextOrder)
      // Build a nested group-layer dataSourceJson tree from KML folders + featureInfos.
      const folders = kmlResponse?.folders || []
      const folderById = new Map<number, KmlFolder>()
      folders.forEach(folder => folderById.set(folder.id, folder))
      const getGeometryKey = (geometryType: string) => geometryType.replace('esriGeometry', '').toLowerCase()

      // Index base layer definitions by geometry type so we can reuse their schema/renderer.
      const layerByGeometryType = new Map<string, LayerInFeatureCollection>()
      layers.forEach((layer, index) => {
        if (layer?.layerDefinition?.id == null) {
          layer.layerDefinition.id = index
        }
        const geometryType = layer.layerDefinition?.geometryType || layer.featureSet?.geometryType
        if (geometryType && !layerByGeometryType.has(geometryType)) {
          layerByGeometryType.set(geometryType, layer)
        }
      })
      // Index feature by id per geometry type; feature.attributes.id points to folder membership.
      const featuresByGeometryType = new Map<string, Map<number, any>>()
      layers.forEach((layer) => {
        const geometryType = layer.layerDefinition?.geometryType || layer.featureSet?.geometryType
        if (!geometryType) {
          return
        }
        const idToFeature = new Map<number, any>()
        layer.featureSet?.features?.forEach((feature) => {
          const fid = feature?.attributes?.id
          if (typeof fid === 'number') {
            idToFeature.set(fid, feature)
          }
        })
        featuresByGeometryType.set(geometryType, idToFeature)
      })

      // Create a leaf feature-layer child JSON for a specific folder + geometry type.
      const buildFeatureLayerChild = (parentId: string, geometryType: string, featureIds: number[], label: string, index: number, jimuChildId: string) => {
        const baseLayer = layerByGeometryType.get(geometryType)
        if (!baseLayer) {
          return null
        }
        const layerDefinition = { ...baseLayer.layerDefinition }
        const childSchema = buildSchemaFromLayerDefinition(layerDefinition, jimuChildId)
        const childId = dataSourceUtils.getChildDataSourceId(parentId, jimuChildId)
        const featureMap = featuresByGeometryType.get(geometryType) || new Map<number, any>()
        const features = featureIds.map(id => featureMap.get(id)).filter(Boolean)

        return {
          jimuChildId,
          childJson: {
            id: childId,
            type: DataSourceTypes.FeatureLayer,
            sourceLabel: label,
            label,
            layerId: jimuChildId,
            geometryType: layerDefinition?.geometryType,
            isDataInDataSourceInstance: true,
            schema: childSchema,
            data: [{
              layerDefinition,
              featureSet: {
                ...baseLayer.featureSet,
                features
              }
            }]
          }
        }
      }

      // Recursively build group-layer children based on folder structure.
      const buildChildDataSourceJsons = (parentId: string, folderIds: number[], featureInfos: any[]): { [key: string]: any } => {
        const childDataSourceJsons = {}

        folderIds.forEach((folderId) => {
          const folder = folderById.get(folderId)
          if (!folder) {
            return
          }
          const folderJimuChildId = `g${folder.id}`
          const childId = dataSourceUtils.getChildDataSourceId(parentId, folderJimuChildId)
          // Compute unique nested folders from subFolderIds + Folder-type featureInfos.
          const nestedFolderIds = []
          const nestedFolderIdSet = new Set()
          const subFolderIds = folder.subFolderIds || []
          for (let i = 0; i < subFolderIds.length; i++) {
            const id = subFolderIds[i]
            if (!nestedFolderIdSet.has(id)) {
              nestedFolderIdSet.add(id)
              nestedFolderIds.push(id)
            }
          }
          const folderFeatureInfos = folder.featureInfos || []
          for (let i = 0; i < folderFeatureInfos.length; i++) {
            const featureInfo = folderFeatureInfos[i]
            if (featureInfo?.type !== 'Folder') {
              continue
            }
            const id = featureInfo.id
            if (!nestedFolderIdSet.has(id)) {
              nestedFolderIdSet.add(id)
              nestedFolderIds.push(id)
            }
          }
          // Recurse to create this folder's child group/feature layers.
          const nestedChildDataSourceJsons = buildChildDataSourceJsons(
            childId,
            nestedFolderIds,
            (folder.featureInfos || []).filter(f => f.type !== 'Folder')
          )
          // Each KML folder becomes a GroupLayer in the data source tree.
          childDataSourceJsons[folderJimuChildId] = {
            id: childId,
            type: DataSourceTypes.GroupLayer,
            sourceLabel: folder.name,
            label: folder.name,
            childDataSourceJsons: nestedChildDataSourceJsons
          }
        })

        // Group feature ids by geometry type for leaf layers under this folder.
        const featureInfosByType = new Map<string, number[]>()
        ;(featureInfos || []).forEach((featureInfo) => {
          if (featureInfo?.type === 'Folder') {
            return
          }
          const ids = featureInfosByType.get(featureInfo.type) || []
          ids.push(featureInfo.id)
          featureInfosByType.set(featureInfo.type, ids)
        })

        Array.from(featureInfosByType.entries()).forEach(([geometryType, ids], index) => {
          const geometryKey = getGeometryKey(geometryType)
          const label = geometryKey.charAt(0).toUpperCase() + geometryKey.slice(1)
          // Use a short key tied to the current folder for readable DS ids.
          const folderKey = parentId.split('-').pop() || 'root'
          const jimuChildId = `l${folderKey}-${geometryKey}`
          // Leaf layers include only the features listed for this folder.
          const childEntry = buildFeatureLayerChild(parentId, geometryType, ids, label, index, jimuChildId)
          if (childEntry) {
            childDataSourceJsons[childEntry.jimuChildId] = childEntry.childJson
          }
        })

        return childDataSourceJsons
      }

      const rootFolderIds = folders.filter(f => f.parentFolderId == null || f.parentFolderId === -1).map(f => f.id)
      const rootFeatureInfos = (kmlResponse?.featureInfos || []).filter(f => f.type !== 'Folder')
      const childDataSourceJsons = folders.length > 0
        ? buildChildDataSourceJsons(groupId, rootFolderIds, rootFeatureInfos)
        : layers.reduce((acc, layer, index) => {
            const geometryType = layer.layerDefinition?.geometryType || layer.featureSet?.geometryType
            const ids = (layer.featureSet?.features || []).map(f => f?.attributes?.id).filter((id) => typeof id === 'number')
            const geometryKey = getGeometryKey(geometryType)
            const label = geometryKey.charAt(0).toUpperCase() + geometryKey.slice(1)
            const childEntry = buildFeatureLayerChild(groupId, geometryType, ids, label, index, `lroot-${geometryKey}`)
            if (childEntry) {
              acc[childEntry.jimuChildId] = childEntry.childJson
            }
            return acc
          }, {})

      return [{
        dataSourceJson: {
          id: groupId,
          type: DataSourceTypes.GroupLayer,
          sourceLabel: fileInfo.name,
          label: fileInfo.name,
          childDataSourceJsons
        },
        order: nextOrder
      } as DataOptions]
    }

    return layers.map((l: LayerInFeatureCollection, i) => ({
      dataSourceJson: {
        id: getNextAddedDataId(widgetId, nextOrder + i),
        type: DataSourceTypes.FeatureLayer,
        sourceLabel: l.layerDefinition?.name || (i === 0 ? fileInfo.name : `${fileInfo.name} ${i}`)
      },
      order: nextOrder + i,
      restLayer: { ...l, layerDefinition: { ...l.layerDefinition, capabilities: 'Query, Editing, Create, Delete, Update, Extract' } }
    } as DataOptions))
  }

  const handleUploadError = (err: any) => {
    if (err.message === UploadFileError.NotSupportedType) {
      return UploadFileError.NotSupportedType
    } else if (err.message === UploadFileError.ExceedMaxSize || err.details?.messages?.[0]?.includes('max size')) { // File exceeds the max size allowed of 10MB.
      return UploadFileError.ExceedMaxSize
    } else if (err.message === UploadFileError.ExceedMaxRecords || err.message?.includes('maximum number')) { // The maximum number of records allowed (1000) has been exceeded.
      return UploadFileError.ExceedMaxRecords
    } else if (err.message === UploadFileError.NoValidData) {
      return UploadFileError.NoValidData
    } else {
      return UploadFileError.FailedToUpload
    }
  }

  const [errors, setErrors] = useState<Array<{ errStr: string, details?: string[], open: boolean }>>(null)

  const [fileInfos, setFileInfos] = useState<FileInfo[]>([])
  const [showZipTypeConfirm, setShowZipTypeConfirm] = useState(false)

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) {
      return
    }

    setErrors(null)

    const errorInfos = new Map<UploadFileError, string[]>()

    const files: File[] = Array.from(e.target.files)
    if (files.length > MaxFileNumber) {
      errorInfos.set(UploadFileError.ExceedMaxFileNumber, [])
      onUploadFinish(errorInfos)
    } else {
      const fileInfos = files.map(f => getFileInfo(f))
      uploadingFileInfo.current = fileInfos
      const zipFiles = fileInfos.filter((f) => f.isZip)
      if (zipFiles.length > 0) {
        setFileInfos(fileInfos)
        setShowZipTypeConfirm(true)
      } else {
        onUploadFiles(fileInfos)
      }

    }
  }

  // Make sure every zip file's type is selected
  const isZipTypeSelectionValid = fileInfos.filter((f) => f.isZip).every((f) => !!f.type)

  const onConfirmZipType = () => {
    if (!isZipTypeSelectionValid) {
      return
    }
    onUploadFiles(fileInfos)
    setShowZipTypeConfirm(false)
    uploadingFileInfo.current = fileInfos
  }

  const onFileInfoTypeChange = (index: number, type: SupportedFileTypes) => {
    const newFileInfos = [...fileInfos]
    newFileInfos[index].type = type
    newFileInfos[index].data.set('filetype', type)
    setFileInfos(newFileInfos)
  }

  const onSkipZipFilesAndUPload = () => {
    const noZipFileInfos = fileInfos.filter((f) => !f.isZip)
    onUploadFiles(noZipFileInfos)
    setShowZipTypeConfirm(false)
    uploadingFileInfo.current = noZipFileInfos
  }

  const onUploadFiles = async (fileInfos: FileInfo[]) => {
    setIsLoading(true)

    let dataOptions: DataOptions[] = []
    const errorInfos = new Map<UploadFileError, string[]>()

    await Promise.allSettled(fileInfos.map((fileInfo) => handleFileUpload(fileInfo))).then((results) => {
      results.forEach((result, i) => {
        // Break the process if uploading of the file is canceled.
        const fileInfo = fileInfos[i]
        const fileIsCanceled = toRemoveFilesInfo.current.some(f => f.id === fileInfo.id)
        if (fileIsCanceled) {
          toRemoveFilesInfo.current = toRemoveFilesInfo.current.filter(f => f.id !== fileInfo.id)
          return
        }
        if (result.status === 'fulfilled') {
          if (result.value?.length) {
            dataOptions = dataOptions.concat(result.value)
          }
        } else {
          const errType = handleUploadError(result.reason)
          errorInfos.set(errType, errorInfos.has(errType) ? errorInfos.get(errType).concat(fileInfo.name) : [fileInfo.name])
        }
      })
    })
    if (dataOptions?.length > 0) {
      onChange(multiDataOptions.concat(dataOptions))
    }

    setIsLoading(false)

    onUploadFinish(errorInfos)
  }

  const onUploadFinish = (errorInfos: Map<UploadFileError, string[]>) => {
    if (errorInfos.size > 0) {
      const errorDetails = Array.from(errorInfos.keys()).map((errType) => {
        const files = errorInfos.get(errType)
        // ExceedMaxFileNumber error
        if (!files.length) {
          return { errStr: translate(errType) }
        }
        // single file has error
        if (files.length === 1 && errorInfos.size === 1) {
          return { errStr: translate(errType, { fileName: files[0] }) }
        }
        // multiple files
        return {
          errStr: translate(UploadFileErrorToMultiFilesError.get(errType), { number: files.length }),
          details: files
        }
      })
      // only one error and describe the error for single file upload
      if (errorDetails.length === 1 && !errorDetails[0].details) {
        setErrorMsg(errorDetails[0].errStr)
      } else {
        setErrors(errorDetails.map((err) => ({ ...err, open: true })))
      }
    }

    uploadingFileInfo.current = null
    // Clear value to allow to upload the same file again.
    uploadRef.current.value = null
  }

  const confirmZipContainerRef = useRef<HTMLDivElement>(null)
  useTrapFocusLoop(confirmZipContainerRef, true, true, true, showZipTypeConfirm)

  const onFileRemove = () => {
    toRemoveFilesInfo.current = toRemoveFilesInfo.current.concat(uploadingFileInfo.current)
    uploadingFileInfo.current = null
    setIsLoading(false)
  }

  hooks.useUpdateEffect(()=> {
    if (!isLoading && uploadRef.current) {
      focusElementInKeyboardMode(uploadRef.current)
    }
  }, [isLoading])

  const [uploadInputFocused, setUploadInputFocused] = useState(false)
  const theme = useTheme()

  const hideErrorsTimer = useRef<NodeJS.Timeout>(null)
  useEffect(() => {
    if (errors?.length) {
      const newTimer = setTimeout(() => {
        if (hideErrorsTimer.current === newTimer) {
          setErrors(null)
          hideErrorsTimer.current = null
        }
      }, 5000)
      hideErrorsTimer.current = newTimer
    }
  }, [errors])

  const closeErrorAlert = (index: number) => {
    const newErrors = [...errors]
    newErrors[index].open = false
    if (newErrors.every(e => !e.open)) {
      setErrors(null)
    } else {
      setErrors(newErrors)
    }
  }

  const getFileUploadingString = (needStyledDynamicText = false) => {
    const uploadingFileNumber = uploadingFileInfo.current?.length
    const isUploadingMultiFiles = uploadingFileNumber > 1
    const stringKey = isUploadingMultiFiles ? 'filesAreUploading' : 'fileIsUploading'
    const dynamicStringKey = isUploadingMultiFiles ? 'number' : 'fileName'
    const dynamicStringValue = isUploadingMultiFiles ? uploadingFileNumber : uploadingFileInfo.current?.[0]?.name
    return translate(stringKey, {
      [dynamicStringKey]: !isUploadingMultiFiles && needStyledDynamicText
        ? <div className='w-100 multiple-lines-truncate font-16'>{dynamicStringValue}</div>
        : dynamicStringValue
    })
  }

  const supportedTypesDescContainerId = `add-data-${widgetId}-supported-types-desc`
  const uploadReaDescContainerId = `add-data-${widgetId}-upload-area-desc`
  const uploadingTextContainerId = `add-data-${widgetId}-uploading-text-container`

  return <div className={`data-file-upload w-100 h-100 pb-4 pt-6 px-4 d-flex ${className}`} css={getStyle(onlyOneTab)}>
    <div className='supported-type-icons d-flex justify-content-around align-items-center px-6 mb-4'>
      <Icon width={13} height={16} icon={require('../../assets/icons/file.svg')} />
      <Icon width={24} height={24} icon={require('../../assets/icons/file1.svg')} />
      <Icon width={32} height={32} icon={require('../../assets/icons/file2.svg')} />
      <Icon width={24} height={24} icon={require('../../assets/icons/file3.svg')} />
      <Icon width={13} height={16} icon={require('../../assets/icons/file.svg')} />
    </div>

    <div className='supported-types' id={supportedTypesDescContainerId}>{translate('supportedTypesHint')}</div>

    <div className='mt-4 drag-area-container'>
      <Label for={dragToUploadBtnId} className='drag-area text-center d-flex'>
        <div className='font-14' id={uploadReaDescContainerId}>{translate('dropOrBrowseToUpload')}</div>
        <div className='upload-btn-container mt-4' title={translate('upload')} aria-live='assertive'>
          <Label for={clickToUploadBtnId} className='upload-btn text-center mb-0 text-truncate' css={uploadInputFocused ? css`outline: ${polished.rem(2)} solid ${theme.sys.color.primary.dark}` : ''}>
            <PlusOutlined size={15} className='mr-2' />
            <span>{translate('upload')}</span>
          </Label>
          <input
            id={clickToUploadBtnId} title='' className='upload-btn-file-input'
            type='file' accept={INPUT_ACCEPT} onChange={onFileChange} tabIndex={isLoading ? -1 : 0} ref={uploadRef} multiple
            onFocus={() => { setUploadInputFocused(true) }}
            onBlur={() => { setUploadInputFocused(false) }}
            aria-describedby={`${uploadReaDescContainerId} ${supportedTypesDescContainerId}`} />
        </div>
      </Label>
      <Input id={dragToUploadBtnId} onClick={preventDefault} title='' className='drag-area-file-input' type='file' accept={INPUT_ACCEPT} onChange={onFileChange} tabIndex={-1} />
    </div>

    {
      isLoading &&
      <div className='upload-loading-container' title={getFileUploadingString()} aria-live='assertive'>
        <div className='upload-loading-content d-flex flex-column'>
          <div className='w-100 px-4 upload-loading-file-name d-flex justify-content-center align-items-center'>
            <div className='w-100 font-14 text-center' id={uploadingTextContainerId}>
              {getFileUploadingString(true)}
            </div>
          </div>
          <Loading className='upload-loading' type={LoadingType.Secondary} width={30} height={28} />
          <div className='upload-loading-btn'>
            <Button type='danger' onClick={onFileRemove} ref={(ref) => { focusElementInKeyboardMode(ref) }} aria-describedby={uploadingTextContainerId}>{translate('cancel')}</Button>
          </div>
        </div>
      </div>
    }
    {
      showZipTypeConfirm &&
      <div className='confirm-zip-container p-3' ref={confirmZipContainerRef} role='dialog' aria-label={translate('confirmZipType')} aria-modal='true'>
        <div className='confirm-zip-content h-100 d-flex flex-column pt-3 pb-4 px-4' role=''>
          <div className='title mb-4'>{translate('confirmZipType')}</div>
          <div className='zip-files-content'>
            {fileInfos.map((fileInfo, index) => {
              return fileInfo.isZip && <div key={fileInfo.id}>
                <div className='file-name text-truncate' title={fileInfo.name}>{fileInfo.name}</div>
                <Select className='mb-3' size='sm' value={fileInfo.type ?? ''} placeholder={translate('selectType')} onChange={(e, value) => { onFileInfoTypeChange(index, value as SupportedFileTypes) }} aria-label={fileInfo.name}>
                  {SupportedZipFileTypes.map((t) => <option key={t} value={t}>
                    {t === SupportedFileTypes.Shapefile ? 'Shapefile' : translate(t)}
                  </option>)}
                </Select>
              </div>
            })}
          </div>
          <div className='footer pt-4'>
            <Button className='w-100' type='primary' size='sm' onClick={onConfirmZipType} disabled={!isZipTypeSelectionValid}>{translate('ok')}</Button>
            <Button className='w-100' type='default' size='sm' onClick={onSkipZipFilesAndUPload} >{translate('cancel')}</Button>
          </div>
        </div>
      </div>
    }
    {
      errors?.length && <div className='errors-container'>
        {errors.map((err, index) => {
          return <Alert
            className='w-100 mb-2' closable withIcon form='basic' type='warning'
            title={err.errStr} open={err.open} key={err.errStr}
            onClose={() => {
              closeErrorAlert(index)
            }}>
              {err.details?.length && <div className='collapse-panel-container mt-2'>
                <CollapsablePanel label={translate('details')}>
                  {err.details.map((detail, i) => <p key={i} className='mb-1'>{detail}</p>)}
                </CollapsablePanel>
              </div>}
            </Alert>
        })}
      </div>
    }
  </div>
}

function getFileInfo (file: File): FileInfo {
  const type = getFileType(file.name)
  const name = type ? file.name.replace(`.${type}`, '') : file.name.replace(/\.zip$/i, '')
  const data = new FormData()
  data.set('file', file)
  if (type) {
    data.set('filetype', type)
  }
  data.set('f', 'json')
  return {
    id: uuidv1(),
    type,
    isZip: isZipFile(file.name),
    name,
    data,
    size: file.size
  }
}

function readFileAsText (fileInfo: FileInfo) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = (event: any) => {
      resolve(event.target.result)
    }
    reader.readAsText(fileInfo.data.get('file') as File)
  })
}

function getKmlServiceUrl () {
  const isPortal = getAppStore().getState()?.portalSelf?.isPortal
  if (isPortal) {
    const portalUrl = getAppStore().getState()?.portalUrl
    return `${portalUrl}/sharing/kml`
  }
  const env = window.jimuConfig.hostEnv
  const envHost = env === 'dev' ? 'devext' : env === 'qa' ? 'qa' : ''
  return `https://utility${envHost}.arcgis.com/sharing/kml`
}

async function extractProjectionFromZip (file: File) {
  try {
    const { JSZip } = await moduleLoader.loadModule('jimu-core/jszip')
    const zip = await JSZip.loadAsync(file)
    const prjEntry = Object.keys(zip.files).find(n => n.toLowerCase().endsWith('.prj'))
    if (!prjEntry) return null
    const wkt = await zip.files[prjEntry].async('string')
    // Optional: parse WKID
    const epsgMatch = wkt.match(/AUTHORITY\["EPSG","(\d+)"\]/)
    return epsgMatch ? { wkid: Number(epsgMatch[1]) } : { wkt }
  } catch (error) {
    console.error('Error extracting projection from zip:', error)
    return null
  }
}

interface KmlFolder {
  id: number
  name: string
  parentFolderId: number
  subFolderIds?: number[]
  featureInfos?: any[]
}

interface KmlServiceResponse {
  featureCollection: FeatureCollection
  featureInfos?: any[]
  folders?: KmlFolder[]
}

async function generateFeatureCollection (fileInfo: FileInfo, portalUrl: string): Promise<FeatureCollection | KmlServiceResponse> {
  const esriRequest: typeof __esri.request = await loadArcGISJSAPIModule('esri/request')

  if (fileInfo.type === SupportedFileTypes.KML) {
    const serviceUrl = getKmlServiceUrl()
    const kmlString = await readFileAsText(fileInfo)
    const res = await esriRequest(serviceUrl, {
      query: {
        kmlString: encodeURIComponent(kmlString),
        model: 'simple',
        folders: ''
        // outSR: JSON.stringify(outSpatialReference)
      },
      responseType: 'json'
    })
    return res?.data as KmlServiceResponse
  }

  let publishParameters: any = {}
  let sourceSR = null

  // GPX file does not need publishParameters
  if (fileInfo.type !== SupportedFileTypes.GPX) {
    const isPortal = getAppStore().getState()?.portalSelf?.isPortal
    // GeoJSON file in portal does not need analyze
    if (isPortal && fileInfo.type === SupportedFileTypes.GeoJson) {
      publishParameters = {
        targetSR: {
          wkid: 102100,
          latestWkid: 3857
        },
        type: fileInfo.type,
        maxRecordCount: MAX_RECORD_COUNT
      }
    } else {
      if (fileInfo.type === SupportedFileTypes.Shapefile) {
        sourceSR = await extractProjectionFromZip(fileInfo.data.get('file') as File)
      }
      // 1. Use REST API analyze to get `publishParameters` which is needed in REST API generate.
      const analyzeUrl = `${portalUrl}/sharing/rest/content/features/analyze`
      fileInfo.data.set('analyzeParameters', JSON.stringify({
        targetSR: sourceSR,
        enableGlobalGeocoding: true,
        sourceLocale: getAppStore().getState().appContext?.locale ?? 'en' // TODO: use org geocode service
      }))
      const analyzeResponse = await esriRequest(analyzeUrl, {
        body: fileInfo.data,
        method: 'post'
      })
      fileInfo.data.delete('analyzeParameters')
      publishParameters = analyzeResponse?.data?.publishParameters
    }
  }

  // 2. Use REST API generate to get features from the uploaded file.
  const generateUrl = `${portalUrl}/sharing/rest/content/features/generate`
  fileInfo.data.set('publishParameters', JSON.stringify({
    ...publishParameters,
    name: fileInfo.name,
    maxRecordCount: fileInfo.type === SupportedFileTypes.CSV ? publishParameters.maxRecordCount : MAX_RECORD_COUNT,
    targetSR: sourceSR
  }))
  const generateResponse = await esriRequest(generateUrl, {
    body: fileInfo.data,
    method: 'post'
  })
  fileInfo.data.delete('publishParameters')

  if (generateResponse?.data?.featureCollection) {
    (generateResponse?.data?.featureCollection as FeatureCollection)?.layers?.forEach((ly) => {
      ly.featureSet?.features?.forEach((feature) => {
        ly.layerDefinition?.fields?.forEach((field) => {
          const attrValue = feature.attributes?.[field.name]
          if (field.type === 'esriFieldTypeSmallInteger') {
            if (typeof attrValue === 'boolean') {
              feature.attributes[field.name] = attrValue ? 1 : 0
              return
            }
            if (typeof attrValue !== 'number') {
              feature.attributes[field.name] = null
            }
          }
        })
      })

      // if file name is not included in the layerDefinition, the layer name could be general,
      // like: "points", "polygons", which is not readable when there are too many layers,
      // so we can add the file name as prefix here to increase recognition of the layer name
      if (!ly.layerDefinition?.name?.includes(fileInfo.name)) {
        ly.layerDefinition.name = `${fileInfo.name} - ${ly.layerDefinition.name}`
      }
    })
  }

  return generateResponse?.data?.featureCollection as FeatureCollection
}

function isZipFile (name: string): boolean {
  return name?.toLowerCase().endsWith('.zip')
}

function buildSchemaFromLayerDefinition (layerDefinition: LayerInFeatureCollection['layerDefinition'], jimuChildId: string) {
  const fields = {}
  layerDefinition?.fields?.forEach(field => {
    const jimuField = dataSourceUtils.convertFieldToJimuField(field, null, null)
    if (jimuField) {
      fields[jimuField.jimuName] = jimuField
    }
  })

  return {
    label: layerDefinition?.name,
    childId: jimuChildId,
    jimuChildId,
    idField: layerDefinition?.objectIdField,
    fields
  }
}

function getFileType (name: string): SupportedFileTypes | null {
  if (isZipFile(name)) {
    return null
  }
  return Object.values(SupportedFileTypes).find(t => name?.endsWith(getFileExtension(t))) || null
}

function getFileExtension (supportedFileType: SupportedFileTypes): string {
  return supportedFileType === SupportedFileTypes.Shapefile || supportedFileType === SupportedFileTypes.FileGeoDatabase ? '.zip' : `.${supportedFileType}`
}

const getStyle = (onlyOneTab: boolean) => {
  return css`
  flex-direction: column;
  color: var(--sys-color-surface-overlay-hint);

  .font-14 {
    font-size: 14px;
  }

  .font-16 {
    font-size: 16px;
    font-weight: 500;
  }
  .confirm-zip-container {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    left: 0;
    background-color: rgba(0, 0, 0, 0.3);
    color: var(--sys-color-surface-overlay-text);
    z-index: 20;
    .confirm-zip-content {
      background-color: var(--sys-color-surface-overlay);
      .title {
        font-family: var(--sys-typography-title2-font-family);
        font-weight: var(--sys-typography-title2-font-weight);
        font-size: var(--sys-typography-title2-font-size);
        line-height: var(--sys-typography-title2-line-height);
      }
      .zip-files-content {
        flex: 1;
        overflow-y: auto;
        .file-name {
          margin-bottom: var(--sys-spacing-1);
          font-family: var(--sys-typography-title3-font-family);
          font-weight: var(--sys-typography-title3-font-weight);
          font-size: var(--sys-typography-title3-font-size);
          line-height: var(--sys-typography-title3-line-height);
        }

      }
      .footer {
        .jimu-btn:first-of-type {
          margin-bottom: 6px;
        }
      }
    }
  }

  .upload-loading-container {
    position: absolute;
    top: ${onlyOneTab ? '56px' : '89px'};
    bottom: 0;
    right: 0;
    left: 0;
    background-color: var(--sys-color-surface-overlay);
    z-index: 2;
    .upload-loading-content {
      height: calc(100% - 60px);
      padding-top: 80px;
      color: var(--sys-color-surface-overlay-text);
      .upload-loading-file-name {
        height: 100px;
        word-break: break-word;
        overflow: hidden;
      }
      .upload-loading {
        position: relative;
        height: 146px;
      }
      .upload-loading-btn {
        height: 32px;
        margin-top: 10px;
        text-align: center;
        button.btn-danger {
          background-color: var(--sys-color-error-main);
          border: 0;
        }
      }
    }
  }

  .supported-type-icons svg {
    color: var(--sys-color-primary-main);
  }

  .supported-types {
    font-size: 13px;
  }

  .drag-area-container {
    width: 100%;
    flex: 1
  }
  .drag-area {
    border: 1px dashed var(--sys-color-divider-secondary);
    width: 100%;
    height: 100%;
    user-select: none;
    flex-direction: column;
    justify-content: center;
  }
  .upload-btn {
    border: 1px solid var(--sys-color-divider-secondary);
    color: var(--sys-color-surface-overlay-text);
    background-color: var(--sys-color-primary-text);
    border-radius: 2px;
    line-height: 28px;
    padding-left: 16px;
    padding-right: 16px;
    height: 30px;
    user-select: none;
    max-width: 100%;
  }
  .upload-btn-container {
    line-height: 0;
    width: max-content;
    margin: 0 auto;
  }
  .upload-btn-container:hover {
    .upload-btn {
      background-color: var(--sys-color-action-hover) !important;
    }
  }
  .drag-area-container, .upload-btn-container {
    position: relative;
    display: inline-block;
    z-index: 1;
  }
  .upload-btn-file-input, .drag-area-file-input {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    opacity: 0;
  }
  .upload-btn-file-input {
    cursor: pointer;
  }

  .errors-container {
    position: absolute;
    top: ${onlyOneTab ? '56px' : '89px'};
    left: 0;
    right: 0;
    z-index: 2;
    max-height: 100%;
    overflow-y: auto;
    .jimu-alert-panel-title {
      font-size: 13px;
      font-weight: 400;
    }
    .jimu-alert-panel-left-part {
      flex: 1;
    }
    .jimu-alert-message {
      flex: 1;
      color: var(--sys-color-surface-overlay-text);
    }
    .jimu-alert-action {
      color: var(--sys-color-action-text);
    }
    .collapse-label {
      font-size: 13px;
      .title {
        color: var(--sys-color-surface-overlay-text) !important;
      }
    }
    .collapse-panel-container {
      margin: 0 -30px 0 -28px;
      border-top: 1px solid var(--sys-color-divider-tertiary);
      .jimu-collapsable-action .jimu-btn {
        color: var(--sys-color-action-text);
      }
    }
  }

`
}
