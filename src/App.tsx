import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { loadUser } from './store';
import BottomNav from './components/BottomNav';
import Onboarding from './pages/Onboarding';
import Wardrobe from './pages/Wardrobe';
import Outfits from './pages/Outfits';
import AskAnera from './pages/AskAnera';
import Purchase from './pages/Purchase';
import Insights from './pages/Insights';
import Declutter from './pages/Declutter';
import Social from './pages/Social';

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: '80px' }}>
        {children}
      </div>
      <BottomNav />
    </div>
  );
}

export default function App() {
  const user = loadUser();

  return (
    <BrowserRouter>
      <Routes>
        {/* Onboarding — no nav */}
        <Route
          path="/onboarding"
          element={<Onboarding />}
        />

        {/* App pages */}
        <Route
          path="/wardrobe"
          element={<AppShell><Wardrobe /></AppShell>}
        />
        <Route
          path="/outfits"
          element={<AppShell><Outfits /></AppShell>}
        />
        <Route
          path="/ask"
          element={<AppShell><AskAnera /></AppShell>}
        />
        <Route
          path="/purchase"
          element={<AppShell><Purchase /></AppShell>}
        />
        <Route
          path="/insights"
          element={<AppShell><Insights /></AppShell>}
        />
        <Route
          path="/declutter"
          element={<AppShell><Declutter /></AppShell>}
        />
        <Route
          path="/social"
          element={<AppShell><Social /></AppShell>}
        />

        {/* Default redirect */}
        <Route
          path="*"
          element={
            <Navigate to={user.onboardingComplete ? '/wardrobe' : '/onboarding'} replace />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
