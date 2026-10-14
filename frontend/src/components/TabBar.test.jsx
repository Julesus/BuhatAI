// @vitest-environment happy-dom
// The tab bar is fixed on screen and re-renders on every store write — once a second for the
// whole of a rest. Its buttons must survive that: a component declared inside the render body is
// a new function each time, which React reads as a different type and rebuilds from scratch.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => nav,
  useLocation: () => ({ pathname: '/home' }),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, originalUser

beforeEach(() => {
  const store = useStore.getState()
  originalS = store.S
  originalUser = store.user
  nav.mockClear()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 1, name: 'test' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState({ S: originalS, user: originalUser })
})

const tabs = () => [...host.querySelectorAll('#tabbar button')]

describe('the tab bar across a store write', () => {
  it('keeps the very same buttons instead of rebuilding them every tick', () => {
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    const before = tabs()
    expect(before).toHaveLength(6)

    // What a rest does once a second: S is replaced, so everything reading it re-renders.
    act(() => { useStore.getState().update(s => { s.restSec = 91 }, false) })

    const after = tabs()
    expect(after).toHaveLength(before.length)
    after.forEach((el, i) => expect(el).toBe(before[i]))
  })

  it('still lights the tab for the route it is on, and follows a change of state', () => {
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    expect(tabs()[0].className).toBe('on')
    expect(tabs()[1].className).toBe('')
    expect(tabs()[4].className).toBe('start')

    act(() => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0 } }, false) })
    expect(tabs()[4].className).toBe('start rec')
    expect(tabs()[0].className).toBe('on')
  })
})

// Settings → "Show connection status" off (#369, #330): a stuck sync shows as a dot on Home, the
// tab Settings opens from, and the tab's name says it.
describe('the connection dot on Home', () => {
  const home = () => tabs()[0]
  it('is there for a sync problem only while the banner is switched off', () => {
    const original = useStore.getState().sync
    try {
      useStore.setState({ sync: { status: 'error', lastError: { status: 502 }, pending: true } })
      act(() => { root.render(<TabBar onStart={() => {}} />) })
      expect(home().querySelector('.tab-dot')).toBeNull()
      act(() => { useStore.getState().update(s => { s.connStatus = false }, false) })
      expect(home().querySelector('.tab-dot')).not.toBeNull()
      expect(home().getAttribute('aria-label')).toBe('Home, Connection problem')
      act(() => { useStore.setState({ sync: { status: 'ok', lastError: null, pending: false } }) })
      expect(home().querySelector('.tab-dot')).toBeNull()
      expect(home().getAttribute('aria-label')).toBeNull()
    } finally { useStore.setState({ sync: original }) }
  })
})

// Every tab carries its name under the icon; the floating workout action follows the four tabs.
describe('the tab icons and labels', () => {
  const icon = el => el.querySelector('svg')?.getAttribute('data-icon')
  const label = el => el.querySelector('span:last-child')?.textContent || el.getAttribute('aria-label')
  it('labels every tab and uses one icon per concept', () => {
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    expect(tabs().map(icon)).toEqual(['house', 'calendar', 'chart', 'dumbbell', 'play', 'camera'])
    expect(tabs().map(label)).toEqual(['Home', 'Plan', 'Stats', 'Exercises', 'Start Empty Workout', 'Camera'])
    expect(tabs()[5].disabled).toBe(true)

    act(() => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0 } }, false) })
    expect(icon(tabs()[4])).toBe('play')
    expect(label(tabs()[4])).toBe('Resume')
  })

  it('shows a minimized session’s running time, still named Resume', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 5, 18, 0, 0))
      act(() => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0, start: Date.now() - 754_000 } }, false) })
      act(() => { root.render(<TabBar onStart={() => {}} />) })
      const start = tabs()[4]
      expect(label(start)).toBe('12:34')
      expect(start.getAttribute('aria-label')).toBe('Resume')
      act(() => { vi.advanceTimersByTime(2000) })
      expect(label(start)).toBe('12:36')
      expect(tabs()[4]).toBe(start)   // the same button, only its text ticks

      // a past workout being edited has no clock running
      act(() => { useStore.getState().update(s => { s.active.editingWorkoutId = 'w1' }, false) })
      expect(label(tabs()[4])).toBe('Edit workout')
    } finally { vi.useRealTimers() }
  })
})

describe('the floating workout action', () => {
  it('starts an empty session even when today has a planned routine', () => {
    const onStart = vi.fn()
    act(() => {
      useStore.getState().update(s => {
        s.routines = [{ id: 'r1', name: 'Push', ex: [{ id: '0025' }] }]
        s.week = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, ['r1']]))
      }, false)
      root.render(<TabBar onStart={onStart} />)
    })
    act(() => { tabs()[4].click() })
    expect(onStart).toHaveBeenCalledExactlyOnceWith([])
    expect(nav).not.toHaveBeenCalled()
  })

  it('resumes an existing session without starting another', () => {
    const onStart = vi.fn()
    act(() => {
      useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0 } }, false)
      root.render(<TabBar onStart={onStart} />)
    })
    act(() => { tabs()[4].click() })
    expect(nav).toHaveBeenCalledExactlyOnceWith('/workout')
    expect(onStart).not.toHaveBeenCalled()
  })
})
