export function averageLatency(services: ServiceProbe[]): number | null {
  const measured = services.filter((service) => (service.status === 'available' || service.status === 'slow') && service.latency !== null)
  if (!measured.length) return null
  return Math.round(measured.reduce((sum, service) => sum + (service.latency ?? 0), 0) / measured.length)
}

export function connectionSummary(services: ServiceProbe[]) {
  return {
    total: services.length,
    healthy: services.filter((service) => (service.status === 'available' || service.status === 'slow')).length,
    average: averageLatency(services),
  }
}
