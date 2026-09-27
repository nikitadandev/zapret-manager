import { describe, expect, it } from 'vitest'
import { averageLatency, connectionSummary } from './utils'

const services: ServiceProbe[] = [
  { id: 'youtube', name: 'YouTube', host: 'youtube.com', latency: 40, status: 'available' },
  { id: 'discord', name: 'Discord', host: 'discord.com', latency: 80, status: 'available' },
  { id: 'github', name: 'GitHub', host: 'github.com', latency: null, status: 'unavailable' },
]

describe('connection metrics', () => {
  it('ignores unavailable services when averaging latency', () => {
    expect(averageLatency(services)).toBe(60)
  })

  it('reports reachable services separately from the total', () => {
    expect(connectionSummary(services)).toEqual({ total: 3, healthy: 2, average: 60 })
  })

  it('returns null when no latency has been measured', () => {
    expect(averageLatency(services.map((service) => ({ ...service, latency: null })))).toBeNull()
  })
})

it('excludes failed HTTP responses even when latency was measured', () => {
  expect(averageLatency([
    ...services,
    { id: 'blocked', name: 'Blocked', host: 'example.com', latency: 900, status: 'unavailable' },
  ])).toBe(60)
})

it('counts slow but reachable services as healthy', () => {
  expect(connectionSummary([{ ...services[0], status: 'slow', latency: 1500 }])).toEqual({ total: 1, healthy: 1, average: 1500 })
})
