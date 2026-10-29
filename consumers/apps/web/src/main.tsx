import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyAppearance, readAppearance } from './appearance.ts'
import { App } from './App.tsx'
import { Site } from './site/Site.tsx'
import { SourceNotice } from './SourceNotice.tsx'
import './styles.css'
import './site/site.css'

const path = window.location.pathname
const messenger = path === '/app' || path.startsWith('/app/')
if (messenger) applyAppearance(readAppearance())
else document.documentElement.dataset.app = 'site'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SourceNotice />
    {messenger ? <App /> : <Site />}
  </StrictMode>
)
