import Index from './pages/Index';
import { Profile } from './pages/Profile';
import { BillingScreen } from './features/billing/BillingScreen';

declare function Route(props: unknown): unknown;
declare function Routes(props: unknown): unknown;
declare function Layout(props: unknown): unknown;

/**
 * React Router JSX config, including a nested route: `settings` under `/app`
 * must be recorded as `/app/settings`, not as the bare relative fragment.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/profile/:userId" element={<Profile />} />
      <Route path="/billing" element={<BillingScreen />} />
      <Route path="/app" element={<Layout />}>
        <Route path="settings" element={<Index />} />
      </Route>
    </Routes>
  );
}
