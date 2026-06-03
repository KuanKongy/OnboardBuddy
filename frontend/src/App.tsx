import { Activity, BookOpen, GitBranch, Network, ShieldCheck } from "lucide-react";
import { NavLink, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { DriftPage } from "./pages/DriftPage";
import { GraphPage } from "./pages/GraphPage";
import { ImportPage } from "./pages/ImportPage";
import { PackagePage } from "./pages/PackagePage";
import { WalkthroughPage } from "./pages/WalkthroughPage";

const navItems = [
  { to: "/", label: "Projects", icon: BookOpen },
  { to: "/import", label: "Import", icon: GitBranch },
  { to: "/package", label: "Package", icon: ShieldCheck },
  { to: "/walkthrough", label: "Walkthrough", icon: Activity },
  { to: "/graph", label: "Graph", icon: Network }
];

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">OB</div>
          <div>
            <p className="brand-name">OnboardBuddy</p>
            <p className="brand-subtitle">Project backbone</p>
          </div>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                key={item.to}
                to={item.to}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/package" element={<PackagePage />} />
          <Route path="/walkthrough" element={<WalkthroughPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/drift" element={<DriftPage />} />
        </Routes>
      </main>
    </div>
  );
}
