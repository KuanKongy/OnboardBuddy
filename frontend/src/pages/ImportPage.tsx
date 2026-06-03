export function ImportPage() {
  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Repository Import</p>
          <h1>Connect and configure</h1>
        </div>
      </div>

      <div className="panel-grid">
        <div className="panel">
          <h2>GitHub</h2>
          <p>Read-only OAuth, repository selection, and branch selection will be added here.</p>
        </div>
        <div className="panel">
          <h2>Privacy</h2>
          <p>Ignored paths, secret filtering, and cloud-assisted AI settings will be added here.</p>
        </div>
      </div>
    </section>
  );
}
