export function GraphPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">
          Architecture Graph
        </p>
        <h1 className="text-2xl font-bold text-gray-900">Dependency map</h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Graph canvas
        </h2>
        <p className="text-sm text-gray-500">
          React Flow architecture, dependency, and workflow graph views will be
          mounted here.
        </p>
      </div>
    </div>
  );
}
