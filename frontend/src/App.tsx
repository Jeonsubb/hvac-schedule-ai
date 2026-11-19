import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { CopilotProvider, MetaProvider } from './lib/context'
import Overview from './pages/Overview'
import Schedule from './pages/Schedule'
import Validation from './pages/Validation'
import Energy from './pages/Energy'
import DataPage from './pages/Data'
import SettingsPage from './pages/Settings'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <MetaProvider>
      <CopilotProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="validation" element={<Validation />} />
            <Route path="energy" element={<Energy />} />
            <Route path="data" element={<DataPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </CopilotProvider>
    </MetaProvider>
  )
}
