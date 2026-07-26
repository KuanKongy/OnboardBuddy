declare function createBrowserRouter(routes: unknown[]): unknown;
declare const Reports: unknown;
declare const ReportDetail: unknown;

/**
 * Object-literal router config with nesting. Also holds a decoy: a plain
 * config object that has a `path` but no element/children must NOT be read as
 * a route.
 */
export const router = createBrowserRouter([
  {
    path: '/reports',
    Component: Reports,
    children: [{ path: ':reportId', Component: ReportDetail }],
  },
]);

export const uploadConfig = { path: '/var/tmp/uploads', maxBytes: 1024 };
