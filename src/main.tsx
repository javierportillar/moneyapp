import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const userAgent = navigator.userAgent
const isIOSSafari =
  /iP(ad|hone|od)/.test(userAgent) &&
  /WebKit/.test(userAgent) &&
  !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)

if (isIOSSafari) {
  let lastTouchEnd = 0

  const preventGestureZoom = (event: Event) => {
    event.preventDefault()
  }

  const preventDoubleTapZoom = (event: TouchEvent) => {
    const now = Date.now()
    if (now - lastTouchEnd <= 300) {
      event.preventDefault()
    }
    lastTouchEnd = now
  }

  document.addEventListener('gesturestart', preventGestureZoom)
  document.addEventListener('gesturechange', preventGestureZoom)
  document.addEventListener('gestureend', preventGestureZoom)
  document.addEventListener('touchend', preventDoubleTapZoom, { passive: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
