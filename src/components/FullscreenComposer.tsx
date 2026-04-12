import { useEffect, type ReactNode } from 'react'

type FullscreenComposerProps = {
  isOpen: boolean
  label: string
  title: string
  description: string
  onClose: () => void
  toolbarContent?: ReactNode
  children: ReactNode
}

export function FullscreenComposer(props: FullscreenComposerProps) {
  useEffect(() => {
    if (!props.isOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [props.isOpen, props.onClose])

  if (!props.isOpen) return null

  return (
    <div className="fullscreen-composer-shell">
      <div className="fullscreen-composer-backdrop" onClick={props.onClose} />
      <section className="fullscreen-composer-panel banking-panel action-panel">
        <div className="composer-toolbar fullscreen">
          <div>
            <span className="micro-label">{props.label}</span>
            <h2>{props.title}</h2>
            <p>{props.description}</p>
          </div>
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
        {props.toolbarContent}
        <div className="fullscreen-composer-body">{props.children}</div>
      </section>
    </div>
  )
}
