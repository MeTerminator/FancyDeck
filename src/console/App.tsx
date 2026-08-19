import { Route, Routes } from 'react-router'
import { Shell } from './components/Shell'
import { AppearancePage } from './pages/AppearancePage'
import { DataPage } from './pages/DataPage'
import { LayoutsPage } from './pages/LayoutsPage'
import { OverviewPage } from './pages/OverviewPage'
import { PluginsPage } from './pages/PluginsPage'
import { TooltipProvider } from './ui/tooltip'

export function ConsoleApp() {
  return (
    <TooltipProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/layouts" element={<LayoutsPage />} />
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/appearance" element={<AppearancePage />} />
          <Route path="/data" element={<DataPage />} />
        </Routes>
      </Shell>
    </TooltipProvider>
  )
}
