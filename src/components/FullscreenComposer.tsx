import { useEffect, type ReactNode } from 'react'

type FullscreenComposerProps = {
  isOpen: boolean
  label: string
  title: string
  description: string
  onClose: () => void
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

  const panelClassName = ['fullscreen-composer-panel', 'banking-panel', 'action-panel', props.panelClassName]
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

  return (
    <div className="fullscreen-composer-shell">
      <div className="fullscreen-composer-backdrop" onClick={props.onClose} />
      <section className={panelClassName}>
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
