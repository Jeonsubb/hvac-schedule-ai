import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import Layout from './components/Layout'
import StudioShell from './studio/StudioShell'
import { CopilotProvider, DayProvider, MetaProvider } from './lib/context'
import { AuthProvider, RequireAuth } from './lib/auth'
import { TourProvider } from './lib/tour'
import { VoiceProvider } from './lib/voice/agent'
import { PageSkeleton } from './components/ui'

const Home = lazy(() => import('./pages/Home'))
const Overview = lazy(() => import('./pages/Overview'))
const Schedule = lazy(() => import('./pages/Schedule'))
const Plan = lazy(() => import('./pages/Plan'))
const Validation = lazy(() => import('./pages/Validation'))
const Comfort = lazy(() => import('./pages/Comfort'))
const Energy = lazy(() => import('./pages/Energy'))
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
const StudioOverview = lazy(() => import('./studio/OperationsStudio'))
const NegotiationTheater = lazy(() => import('./studio/NegotiationTheater'))
const ClassicData = lazy(() => import('./pages/ClassicData'))
const ClassicSchedule = lazy(() => import('./pages/ClassicSchedule'))
const ClassicEnergy = lazy(() => import('./pages/ClassicEnergy'))
const ClassicComfort = lazy(() => import('./pages/ClassicComfort'))
const ClassicValidation = lazy(() => import('./pages/ClassicValidation'))
const ClassicSettings = lazy(() => import('./pages/ClassicSettings'))

function page(el: React.ReactNode) {
  return <Suspense fallback={<PageSkeleton label="화면을 불러오는 중…" />}>{el}</Suspense>
}

/** Older tier deep links remain fully functional in the preserved planning workflow. */
function StudioPlanRoute() {
  const [params] = useSearchParams()
  const location = useLocation()
  if (params.has('tier') || params.get('view') === 'tiers') return <Navigate replace to={`/classic/plan${location.search}${location.hash}`} />
  return <NegotiationTheater />
}

export default function App() {
  return (
    <AuthProvider>
      <TourProvider>
      <MetaProvider>
        <DayProvider>
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
            <Route element={<RequireAuth><VoiceProvider><StudioShell /></VoiceProvider></RequireAuth>}>
              <Route path="studio/overview" element={page(<StudioOverview />)} />
              <Route path="studio/plan" element={page(<StudioPlanRoute />)} />
              <Route path="studio/data" element={page(<DataPage />)} />
              <Route path="studio/schedule" element={page(<Schedule />)} />
              <Route path="studio/energy" element={page(<Energy />)} />
              <Route path="studio/comfort" element={page(<Comfort />)} />
              <Route path="studio/validation" element={page(<Validation />)} />
              <Route path="studio/settings" element={page(<SettingsPage />)} />
              <Route path="overview" element={page(<StudioOverview />)} />
              <Route path="plan" element={page(<StudioPlanRoute />)} />
              <Route path="data" element={page(<DataPage />)} />
              <Route path="schedule" element={page(<Schedule />)} />
              <Route path="energy" element={page(<Energy />)} />
              <Route path="comfort" element={page(<Comfort />)} />
              <Route path="validation" element={page(<Validation />)} />
              <Route path="settings" element={page(<SettingsPage />)} />
            </Route>
            <Route
              element={
                <RequireAuth>
                  {/* one voice session above the operator screens: a spoken jump to another screen keeps talking there */}
                  <VoiceProvider>
                    <Layout />
                  </VoiceProvider>
                </RequireAuth>
              }
            >
              <Route index element={page(<Home />)} />
              <Route path="classic/overview" element={page(<Overview />)} />
              <Route path="classic/plan" element={page(<Plan />)} />
              <Route path="classic/data" element={page(<ClassicData />)} />
              <Route path="classic/schedule" element={page(<ClassicSchedule />)} />
              <Route path="classic/energy" element={page(<ClassicEnergy />)} />
              <Route path="classic/comfort" element={page(<ClassicComfort />)} />
              <Route path="classic/validation" element={page(<ClassicValidation />)} />
              <Route path="classic/settings" element={page(<ClassicSettings />)} />
              <Route path="*" element={page(<NotFound />)} />
            </Route>
          </Routes>
        </CopilotProvider>
        </DayProvider>
      </MetaProvider>
      </TourProvider>
    </AuthProvider>
  )
}
