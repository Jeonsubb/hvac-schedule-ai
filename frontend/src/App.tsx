import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { CopilotProvider, MetaProvider } from './lib/context'
import { PageSkeleton } from './components/ui'

const Overview = lazy(() => import('./pages/Overview'))
const Schedule = lazy(() => import('./pages/Schedule'))
const Validation = lazy(() => import('./pages/Validation'))
const Energy = lazy(() => import('./pages/Energy'))
const DataPage = lazy(() => import('./pages/Data'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const NotFound = lazy(() => import('./pages/NotFound'))

function page(el: React.ReactNode) {
  return <Suspense fallback={<PageSkeleton label="화면을 불러오는 중…" />}>{el}</Suspense>
}

export default function App() {
  return (
    <MetaProvider>
      <CopilotProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={page(<Overview />)} />
            <Route path="schedule" element={page(<Schedule />)} />
            <Route path="validation" element={page(<Validation />)} />
            <Route path="energy" element={page(<Energy />)} />
            <Route path="data" element={page(<DataPage />)} />
            <Route path="settings" element={page(<SettingsPage />)} />
            <Route path="*" element={page(<NotFound />)} />
          </Route>
        </Routes>
      </CopilotProvider>
    </MetaProvider>
  )
}
