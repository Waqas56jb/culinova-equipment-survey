import { DATA as BUNDLED } from './data/masterData'

export function catalogFromMaster(DATA = BUNDLED) {
  const cats = DATA.cats || []
  const defs = DATA.defs || {}
  const eq = (DATA.eq || []).map((e) => ({
    id: e[0],
    cats: Array.isArray(e[1]) ? e[1] : [e[1]],
    name: e[2],
    alias: e[3],
    attrs: e[4] || [],
  }))
  return { cats, defs, eq, source: 'bundle' }
}

export function catalogFromApi(payload) {
  const cats = payload.categories?.length ? payload.categories : []
  const defs = {}
  for (const d of payload.attr_defs || []) {
    defs[d.key] = { l: d.label || d.key, t: d.input_type || 't', o: d.options || [] }
  }
  const eq = (payload.types || []).map((t) => {
    const idx = cats.indexOf(t.category)
    return {
      id: t.code,
      cats: [idx >= 0 ? idx : Math.max(0, cats.length - 1)],
      name: t.name,
      alias: t.aliases || '',
      attrs: t.attr_keys || [],
    }
  })
  return { cats, defs, eq, source: payload.source || 'api' }
}

export function otherTypeForCategory(eq, cats, pickCat) {
  const inCat = eq.filter((e) => pickCat == null || e.cats.includes(pickCat))
  return inCat.find((e) => /^other /i.test(e.name)) || eq.find((e) => /^other /i.test(e.name)) || null
}
