import { React, hooks, classNames } from 'jimu-core'
import { interact } from 'jimu-core/dnd'
import { DownFilled } from 'jimu-icons/filled/directional/down'
import { RightFilled } from 'jimu-icons/filled/directional/right'
import { styled } from 'jimu-theme'
import { Button, Checkbox, Icon, defaultMessages as jimuUiDefaultMessages, type StyleState } from 'jimu-ui'
import type { DragDirection, TreeNodeInfo } from './types'

function getDragDirection (targetEl: HTMLElement, event: Interact.DropEvent | Interact.InteractEvent): DragDirection {
  const nativeEvent = ('dragEvent' in event && event.dragEvent) ? event.dragEvent : event
  const clientY = (nativeEvent as any)?.clientY ?? (nativeEvent as any)?.client?.y ?? (nativeEvent as any)?.pageY ?? (nativeEvent as any)?.page?.y ?? 0
  const rect = targetEl.getBoundingClientRect()
  const toTop = clientY - rect.top < (rect.bottom - rect.top) / 3
  const toBottom = rect.bottom - clientY < (rect.bottom - rect.top) / 3
  return toTop ? 'top' : toBottom ? 'bottom' : 'inside'
}

export interface TreeNodeProps {
  treeNodeInfo: TreeNodeInfo
  draggable?: boolean
  titleRender?: (node: TreeNodeInfo) => React.ReactNode
  level?: number
  rootHasGroup?: boolean
  onCheck?: (checked: boolean, node: TreeNodeInfo) => void
  isDroppable?: (dragKey: string, dropKey: string, direction: DragDirection) => boolean
  onDrop?: (dragKey: string, dropKey: string, direction: DragDirection) => void
}

const TreeNodeRoot = styled.div<StyleState<TreeNodeProps>>(({ theme, styleState }) => {
  const { level } = styleState
  return {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    boxShadow: 'none',
    marginLeft: level ? `${level * 16}px` : 0,
    lineHeight: 1.3,
    '&[dragging="true"]': {
      opacity: 0
    },
    '&[drag-over-direction="top"]:not([dragging="true"])': {
      boxShadow: `inset 0 2px 0 0 ${theme.sys.color.primary.main}`
    },
    '&[drag-over-direction="bottom"]:not([dragging="true"])': {
      boxShadow: `inset 0 -2px 0 0 ${theme.sys.color.primary.main}`
    },
    '&[drag-over-direction="inside"]:not([dragging="true"])': {
      boxShadow: `inset 0 0 0 2px ${theme.sys.color.primary.main}`
    },
    '&[drag-over-direction="none"]:not([dragging="true"])': {
      opacity: '.2',
      boxShadow: 'none'
    },
    '.jimu-tree-node-drag-handle': {
      flexShrink: 0,
      opacity: 0
    },
    '.jimu-tree-node-drag-handle:focus': {
      opacity: 1
    },
    '&:hover': {
      '.jimu-tree-node-drag-handle': {
        opacity: 1
      }
    },
    '.jimu-tree-node-expand, .jimu-tree-node-expand-placeholder': {
      flexShrink: 0,
      margin: '0 2px',
      width: '12px',
      height: '12px',
    },
    '.jimu-tree-node-checkbox': {
      flexShrink: 0,
      margin: '0 2px'
    },
    '.jimu-tree-node-title': {
      flex: 1,
      userSelect: 'none'
    }
  }
})

const DragHandle = styled(Button)(() => {
  return {
    padding: '1px 2px',
    border: 0,
    '.icon-btn-sizer': {
      minWidth: '4px',
      minHeight: '16px'
    }
  }
})

const ExpandButton = styled(Button)(() => {
  return {
    padding: 0,
    '.icon-btn-sizer': {
      minWidth: '12px',
      minHeight: '12px'
    }
  }
})

export function TreeNode (props: TreeNodeProps) {
  const { treeNodeInfo, titleRender, draggable, level = 0, rootHasGroup, onCheck, isDroppable, onDrop } = props
  const { key, title, children, checkable, disableCheckbox, checked, halfChecked } = treeNodeInfo

  const translate = hooks.useTranslation(jimuUiDefaultMessages)
  const [expanded, setExpanded] = React.useState<boolean>(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setExpanded(!!children?.length)
  }, [children])

  const handleCheck = React.useCallback((event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    onCheck?.(checked, treeNodeInfo)
  }, [onCheck, treeNodeInfo])

  const handleExpand = React.useCallback(() => {
    setExpanded(value => !value)
  }, [])

  React.useEffect(() => {
    const nodeEl = rootRef.current
    if (!nodeEl) return

    const clearDropIndicator = () => {
      nodeEl.removeAttribute('drag-over-direction')
    }
    const handleDropzoneEvent = (dropEvent: Interact.DropEvent, commitDrop: boolean) => {
      const dragEl = dropEvent?.relatedTarget
      const dragKey = dragEl instanceof HTMLElement ? dragEl.dataset?.nodeKey : null
      const dropKey = nodeEl.dataset?.nodeKey
      if (!dragKey || !dropKey || dragKey === dropKey) {
        clearDropIndicator()
        return
      }
      const direction = getDragDirection(nodeEl, dropEvent)
      const droppable = typeof isDroppable === 'function' ? isDroppable(dragKey, dropKey, direction) : true
      nodeEl.setAttribute('drag-over-direction', droppable ? direction : 'none')
      if (commitDrop && droppable) {
        onDrop?.(dragKey, dropKey, direction)
      }
      if (commitDrop) {
        clearDropIndicator()
      }
    }
    const updateDropIndicator = (dropEvent: Interact.DropEvent) => {
      handleDropzoneEvent(dropEvent, false)
    }
    const commitDrop = (dropEvent: Interact.DropEvent) => {
      handleDropzoneEvent(dropEvent, true)
    }

    const interaction = interact(nodeEl)
    interaction.draggable({
      enabled: !!draggable,
      allowFrom: '.jimu-tree-node, .jimu-tree-node-drag-handle, .jimu-tree-node-expand, .jimu-tree-node-checkbox, .jimu-tree-node-title',
      ignoreFrom: 'input, textarea, select, [contenteditable="true"]',
      listeners: {
        start: () => {
          nodeEl.setAttribute('dragging', 'true')
          clearDropIndicator()
          setExpanded(false)
        },
        end: () => {
          nodeEl.removeAttribute('dragging')
          clearDropIndicator()
        }
      }
    })
    interaction.dropzone({
      enabled: !!draggable,
      accept: '.jimu-tree-node',
      overlap: 'pointer',
      ondragenter: updateDropIndicator,
      ondropmove: updateDropIndicator,
      ondragleave: clearDropIndicator,
      ondrop: commitDrop
    })

    return () => {
      try {
        interaction.unset()
      } catch (e) {
        console.error(e)
      }
    }
  }, [draggable, isDroppable, onDrop])

  const expandLabel = translate(expanded ? 'collapse' : 'expand')

  return <React.Fragment>
    <TreeNodeRoot
      ref={rootRef}
      styleState={props}
      data-node-key={key}
      className='jimu-tree-node'
    >
      {draggable &&
        <DragHandle icon variant='text' className='jimu-tree-node-drag-handle'>
          <Icon icon={require('../../assets/icons/drag-16.svg')} width={4} height={16} />
        </DragHandle>
      }
      {children?.length > 0 &&
        <ExpandButton
          icon
          variant='text'
          disableHoverEffect
          disableRipple
          title={expandLabel}
          aria-label={expandLabel}
          className='jimu-tree-node-expand'
          onClick={handleExpand}
        >
          <DownFilled size='s' autoFlip className={classNames({ 'd-none': !expanded })} />
          <RightFilled size='s' autoFlip className={classNames({ 'd-none': expanded })} />
        </ExpandButton>
      }
      {(level > 0 || rootHasGroup) && !children?.length && <span className='jimu-tree-node-expand-placeholder' aria-hidden='true' />}
      {checkable &&
        <Checkbox
          checked={checked}
          indeterminate={halfChecked}
          disabled={disableCheckbox}
          className='jimu-tree-node-checkbox'
          onChange={handleCheck}
        />
      }
      <div className='jimu-tree-node-title'>
      {titleRender ? titleRender(treeNodeInfo) : title}
      </div>
    </TreeNodeRoot>
    {children && children.length > 0 && expanded &&
      children.map(childItem => {
        return <TreeNode
          key={childItem.key}
          treeNodeInfo={childItem}
          titleRender={titleRender}
          draggable={draggable}
          level={level + 1}
          onCheck={onCheck}
          isDroppable={isDroppable}
          onDrop={onDrop}
        />
      })
    }
  </React.Fragment>
}
