export function WalkthroughPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">
          Interactive Walkthrough
        </p>
        <h1 className="text-2xl font-bold text-gray-900">Workflow trace</h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Walkthrough steps
        </h2>
        <p className="text-sm text-gray-500">
          Step navigation, code highlights, and workflow receipts will be added
          here.
        </p>
      </div>
    </div>
  );
}
