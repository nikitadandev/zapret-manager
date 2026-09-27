import { describe, expect, it } from 'vitest'
import engineModule from './engine.cjs'

const { ZapretEngine } = engineModule

describe('Flowseal strategy mapping', () => {
  const engine = new ZapretEngine('/tmp/zapret-manager-test', () => undefined)

  it('maps the default strategy to general.bat', () => {
    expect(engine.strategyFile('General')).toBe('general.bat')
  })

  it('maps numbered ALT strategies to the official file names', () => {
    expect(engine.strategyFile('General ALT 7')).toBe('general (ALT7).bat')
    expect(engine.strategyFile('General ALT 13')).toBe('general (ALT13).bat')
  })

  it('maps the unnumbered ALT strategy', () => {
    expect(engine.strategyFile('General ALT')).toBe('general (ALT).bat')
  })
})
