import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PageSpinner } from "@/components/ui/page-spinner";
import { useAuth } from "@/contexts/AuthContext";
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <PageSpinner className="h-screen w-full bg-background" iconClassName="h-8 w-8" label="Checking your session" />
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
