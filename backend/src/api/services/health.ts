export function getHealthStatus() {
  return {
    status: "ok",
    service: "onboardbuddy-api"
  } as const;
}
