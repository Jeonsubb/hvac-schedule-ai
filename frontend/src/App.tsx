import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { CopilotProvider, MetaProvider } from './lib/context'
import { AuthProvider, RequireAuth } from './lib/auth'
import { TourProvider } from './lib/tour'
import { PageSkeleton } from './components/ui'

const Overview = lazy(() => import('./pages/Overview'))
const Schedule = lazy(() => import('./pages/Schedule'))
const Plan = lazy(() => import('./pages/Plan'))
const Validation = lazy(() => import('./pages/Validation'))
const Energy = lazy(() => import('./pages/Energy'))
const Comfort = lazy(() => import('./pages/Comfort'))
const DataPage = lazy(() => import('./pages/Data'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const NotFound = lazy(() => import('./pages/NotFound'))
// public / onboarding (no app chrome)
const Welcome = lazy(() => import('./pages/Welcome'))
const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const Setup = lazy(() => import('./pages/Setup'))
const FeedbackPage = lazy(() => import('./pages/Feedback'))
const Lab = lazy(() => import('./pages/Lab'))

function page(el: React.ReactNode) {
  return <Suspense fallback={<PageSkeleton label="화면을 불러오는 중…" />}>{el}</Suspense>
}

export default function App() {
  return (
    <AuthProvider>
      <TourProvider>
      <MetaProvider>
        <CopilotProvider>
          <Routes>
            <Route path="welcome" element={page(<Welcome />)} />
            <Route path="login" element={page(<Login />)} />
            <Route path="signup" element={page(<Signup />)} />
            {/* QR link for building occupants: no sign-in */}
            <Route path="feedback" element={page(<FeedbackPage />)} />
            {/* simulation lab: a separate, sandboxed page (opens in its own tab) */}
            <Route path="lab" element={page(<Lab />)} />
            <Route path="setup" element={<RequireAuth onboarding>{page(<Setup />)}</RequireAuth>} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={page(<Overview />)} />
              <Route path="energy" element={page(<Energy />)} />
              <Route path="comfort" element={page(<Comfort />)} />
              <Route path="settings" element={page(<SettingsPage />)} />
              <Route path="schedule" element={page(<Schedule />)} />
              <Route path="plan" element={page(<Plan />)} />
              <Route path="validation" element={page(<Validation />)} />
              <Route path="data" element={page(<DataPage />)} />
              <Route path="*" element={page(<NotFound />)} />
            </Route>
          </Routes>
        </CopilotProvider>
      </MetaProvider>
      </TourProvider>
    </AuthProvider>
  )
}
