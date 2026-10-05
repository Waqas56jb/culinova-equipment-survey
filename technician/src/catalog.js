import { DATA as BUNDLED } from './data/masterData'

/** Common equipment first within each category (client order preference). */
const CATEGORY_PRIORITY = {
  Refrigeration: [
    'Upright Chiller',
    'Upright Freezer',
    'Upright Dual Temperature',
    'Undercounter Chiller',
    'Undercounter Freezer',
    'Counter Chiller',
    'Counter Freezer',
    'Refrigerated Prep Counter',
    'Chef Base Refrigerator',
    'Ice Maker',
    'Ice Storage Bin',
    'Cold Room / Walk-In Chiller',
    'Freezer Room / Walk-In Freezer',
    'Combination Cold / Freezer Room',
    'Blast Chiller',
    'Blast Freezer',
    'Blast Chiller / Freezer',
    'Chest Freezer',
    'Chest Chiller',
    'Refrigerated Display Case',
    'Multideck Display Chiller',
    'Bottle Cooler',
    'Back Bar Chiller',
    'Wine Cooler',
    'Milk Cooler',
    'Roll-In Chiller',
    'Roll-In Freezer',
    'Drawer Refrigerator',
    'Cold Bain Marie',
    'Ice Cream / Gelato Display',
  ],
  Cooking: [
    'Open Burner Range',
    'Solid Top Range',
    'Induction Range',
    'Wok Range',
    'Fryer',
    'Pressure Fryer',
    'Griddle',
    'Charbroiler',
    'Combi Oven',
    'Convection Oven',
    'Steamer',
    'Salamander',
    'Pasta Cooker',
    'Tilting Bratt Pan',
    'Boiling Pan / Kettle',
    'Microwave Oven',
    'Pizza Oven',
    'Deck Oven',
  ],
  Preparation: [
    'Food Processor',
    'Vegetable Preparation Machine',
    'Meat Mincer / Grinder',
    'Meat Slicer',
    'Stick / Immersion Blender',
    'Food Blender / Liquidizer',
    'Vacuum Packing Machine',
    'Vegetable Cutter / Slicer',
    'Bone Saw',
  ],
  Dishwashing: [
    'Undercounter Dishwasher',
    'Hood Type Dishwasher',
    'Glasswasher',
    'Rack Conveyor Dishwasher',
    'Pot / Utensil Washer',
    'Pre-Rinse Spray Unit',
  ],
  'Beverage & Coffee': [
    'Espresso Coffee Machine',
    'Bean-to-Cup Coffee Machine',
    'Ice Maker',
    'Blender',
    'Juice Extractor',
    'Citrus Juicer',
    'Hot Water Boiler / Dispenser',
  ],
}

function otherLastCats(cats = []) {
  const rest = cats.filter((c) => c !== 'Other')
  return cats.includes('Other') ? [...rest, 'Other'] : rest.slice()
}

function sortEqInCategory(list, categoryName) {
  const pri = CATEGORY_PRIORITY[categoryName] || []
  const rank = (name) => {
    if (/^other /i.test(name)) return 10000
    const i = pri.indexOf(name)
    return i >= 0 ? i : 500 + name.localeCompare(' ')
  }
  return list.slice().sort((a, b) => {
    const ra = rank(a.name)
    const rb = rank(b.name)
    if (ra !== rb) return ra - rb
    return a.name.localeCompare(b.name, 'en')
  })
}

export function catalogFromMaster(DATA = BUNDLED) {
  const cats = otherLastCats(DATA.cats || [])
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
  const cats = otherLastCats(payload.categories?.length ? payload.categories : [])
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

export function equipmentInCategory(eq, cats, pickCat) {
  const list = eq.filter((e) => e.cats.includes(pickCat) && !/^other /i.test(e.name))
  return sortEqInCategory(list, cats[pickCat])
}
