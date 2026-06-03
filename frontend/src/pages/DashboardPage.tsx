export function DashboardPage() {
  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Projects</h1>
        </div>
        <button className="primary-button" type="button">
          Add Project
        </button>
      </div>

      <div className="empty-state">
        <h2>No projects yet</h2>
        <p>Project cards, analysis status, stale badges, and commit metadata will live here.</p>
      </div>
    </section>
  );
}
