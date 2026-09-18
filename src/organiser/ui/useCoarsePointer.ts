import { useEffect, useState } from 'react'

/** True on a touch screen: bigger targets, fewer buttons, and the actions that keys usually cover — and no Esc,
 *  so anything that names a key has to say something else here. Obsidian's own `is-mobile` counts, since a phone
 *  with a keyboard attached still draws the phone's chrome. */
export function useCoarsePointer(): boolean {
  const query = () =>
    (typeof document !== 'undefined' && document.body.classList.contains('is-mobile')) ||
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  const [coarse, setCoarse] = useState(query)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(pointer: coarse)')
    const on = () => setCoarse(query())
    mq.addEventListener('change', on)
    const body = typeof document !== 'undefined' ? document.body : null
    const mo = body ? new MutationObserver(on) : null
    if (body) mo?.observe(body, { attributes: true, attributeFilter: ['class'] })
    return () => {
      mq.removeEventListener('change', on)
      mo?.disconnect()
    }
  }, [])
  return coarse
}
