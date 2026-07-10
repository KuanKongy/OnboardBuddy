#!/usr/bin/env node

const CHECKS = [
  {
    name: "backend API",
    url: "http://localhost:3000/api/health",
  },
  {
    name: "frontend",
    url: "http://localhost:5173/",
  },
];

async function probe(name, url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return `${name} (${url}) returned HTTP ${res.status}`;
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `${name} (${url}) — ${message}`;
  }
}

const failures = [];
for (const check of CHECKS) {
  const failure = await probe(check.name, check.url);
  if (failure) failures.push(failure);
}

if (failures.length > 0) {
  console.error("Docker stack is not reachable. Start it first:\n");
  console.error("  docker compose up --build -d\n");
  console.error("Failures:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("Docker stack is up (API + frontend reachable).");
