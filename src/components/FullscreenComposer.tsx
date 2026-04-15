import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react'

type FullscreenComposerProps = {
  isOpen: boolean
  label: string
  title: string
  description: string
  onClose: () => void
  enableSwipeClose?: boolean
  hideHeader?: boolean
  hideHeaderCopy?: boolean
  toolbarContent?: ReactNode
  toolbarContentPosition?: 'header' | 'body'
  panelClassName?: string
  toolbarClassName?: string
  bodyClassName?: string
  children: ReactNode
}

export function FullscreenComposer(props: FullscreenComposerProps) {
  const touchStateRef = useRef({
    startX: 0,
    startY: 0,
    deltaX: 0,
    tracking: false,
    horizontal: false,
  })

  useEffect(() => {
    if (!props.isOpen) return

    const previousBodyOverflow = document.body.style.overflow
    const previousBodyTouchAction = document.body.style.touchAction
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior

    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'
    document.documentElement.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehavior = 'none'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.body.style.touchAction = previousBodyTouchAction
      document.documentElement.style.overflow = previousHtmlOverflow
      document.documentElement.style.overscrollBehavior = previousHtmlOverscrollBehavior
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [props.isOpen, props.onClose])

  if (!props.isOpen) return null

  const panelClassName = [
    'fullscreen-composer-panel',
    'banking-panel',
    'action-panel',
    props.enableSwipeClose ? 'swipe-close-enabled' : null,
    props.panelClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const toolbarClassName = [
    'composer-toolbar',
    'fullscreen',
    props.hideHeaderCopy ? 'composer-toolbar-minimal' : null,
    props.toolbarClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const bodyClassName = ['fullscreen-composer-body', props.bodyClassName].filter(Boolean).join(' ')
  const toolbarInBody = props.toolbarContentPosition === 'body'

  function resetSwipeState() {
    touchStateRef.current = {
      startX: 0,
      startY: 0,
      deltaX: 0,
      tracking: false,
      horizontal: false,
    }
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    if (!props.enableSwipeClose) return
    const touch = event.touches[0]
    const edgeSwipeZone = 28
    if (touch.clientX > edgeSwipeZone) {
      resetSwipeState()
      return
    }
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      deltaX: 0,
      tracking: true,
      horizontal: false,
    }
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    if (!props.enableSwipeClose || !touchStateRef.current.tracking) return

    const touch = event.touches[0]
    const deltaX = touch.clientX - touchStateRef.current.startX
    const deltaY = touch.clientY - touchStateRef.current.startY

    if (!touchStateRef.current.horizontal) {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return
      if (Math.abs(deltaX) <= Math.abs(deltaY) || deltaX <= 0) {
        touchStateRef.current.tracking = false
        return
      }
      touchStateRef.current.horizontal = true
    }

    if (event.cancelable) {
      event.preventDefault()
    }

    touchStateRef.current.deltaX = Math.min(180, Math.max(0, deltaX))
  }

  function handleTouchEnd() {
    if (!props.enableSwipeClose) return

    const shouldClose = touchStateRef.current.deltaX > 96
    if (shouldClose) {
      resetSwipeState()
      props.onClose()
      return
    }

    resetSwipeState()
  }

  return (
    <div className="fullscreen-composer-shell">
      <div className="fullscreen-composer-backdrop" onClick={props.onClose} />
      <section
        className={panelClassName}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {!props.hideHeader && (
          <div className={toolbarClassName}>
            {!props.hideHeaderCopy && (
              <div>
                <span className="micro-label">{props.label}</span>
                <h2>{props.title}</h2>
                <p>{props.description}</p>
              </div>
            )}
            <button
              type="button"
              className="icon-action-button close-icon-button"
              aria-label="Cerrar ventana"
              title="Cerrar (Esc)"
              onClick={props.onClose}
            >
              ×
            </button>
          </div>
        )}
        {!toolbarInBody && props.toolbarContent}
        <div className={bodyClassName}>
          {toolbarInBody && props.toolbarContent}
          {props.children}
        </div>
      </section>
    </div>
  )
}
