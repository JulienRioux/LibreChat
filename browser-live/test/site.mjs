// Fixture web site for the browser tool tests and evals.
// Everything here is invented and deterministic, so a model cannot answer from memory and a
// test can assert exact values. Run standalone: `node site.mjs [port]`.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

/** Deterministic pseudo-random numbers (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

const WORDS =
  'river valley council harvest northern coastal trade route granite quarter season charter district assembly lantern market orchard ferry signal garrison archive survey province meadow harbour census mill bridge guild terrace canal ridge'.split(
    ' ',
  );

/** Filler prose that carries no facts a task asks about. */
function filler(rand, sentences) {
  const out = [];
  for (let i = 0; i < sentences; i++) {
    const n = 9 + Math.floor(rand() * 10);
    const words = [];
    for (let k = 0; k < n; k++) words.push(WORDS[Math.floor(rand() * WORDS.length)]);
    const s = words.join(' ');
    out.push(s[0].toUpperCase() + s.slice(1) + '.');
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// Shop: listing pages without <main>, cards as <article>, ellipsized titles,
// ratings that exist only as a class name, pagination, a label/value table.
// ---------------------------------------------------------------------------
const CATEGORIES = ['Travel', 'Science', 'Cooking', 'History'];
const RATING = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'];
const TITLES = [
  'The Salt Road to Varenne',
  'A Short Atlas of Tidal Islands and the People Who Left Them',
  'Bread, Smoke and Iron',
  'Notes from a Slow Train',
  'The Quiet Mathematics of Honeybees and Other Small Engineers',
  'Kitchen Without Clocks',
  'Empire of Ledgers',
  'Walking the Copper Coast',
  'Starlight for Beginners',
  'The Last Ferry Keeper of Lake Ombra and Her Seven Winters',
  'Field Guide to Ordinary Weather',
  'Stock, Broth and Patience',
  'The Cartographer Who Lied',
  'Forty Mountain Passes',
  'How Glaciers Remember',
  'A Table for Twelve Strangers',
  'The Siege That Never Was',
  'Under Canvas in the Dry Season',
  'Elements in Disguise',
  'Preserving the Late Harvest: Pickles, Jams and Ferments',
  'Letters from the Tin Republic',
  'Night Buses of the Southern Capitals',
  'The Honest Microscope',
  'Dumplings of Nine Provinces',
  'Kings Without Crowns',
  'Lighthouses at the Edge of Maps',
  'Thinking in Tides',
  'One Pot, Many Roads',
  'The Clockmakers Rebellion of 1742 and What Came After',
  'Border Towns',
  'The Reluctant Astronomer',
  'Olive, Lemon, Ash',
  'Granaries of the Old Kingdom',
  'Riverboats and Rain',
  'A Brief History of Measuring Things',
  'Spice Routes for the Home Cook',
];

const rand = seeded(20261120);
const products = TITLES.map((title, i) => ({
  id: i + 1,
  slug: title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, ''),
  title,
  category: CATEGORIES[i % CATEGORIES.length],
  price: (8 + Math.floor(rand() * 4200) / 100).toFixed(2),
  stock: 1 + Math.floor(rand() * 24),
  rating: 1 + Math.floor(rand() * 5),
  isbn: `978-${1000 + Math.floor(rand() * 8999)}-${100 + Math.floor(rand() * 899)}-${Math.floor(rand() * 9)}`,
  pages: 120 + Math.floor(rand() * 520),
  publisher: ['Gull & Anchor Press', 'Thornfield House', 'Meridian Lane', 'Copperplate Books'][
    Math.floor(rand() * 4)
  ],
  year: 1998 + Math.floor(rand() * 27),
  blurb: filler(rand, 14),
}));

const PER_PAGE = 12;
const short = (t) => (t.length > 28 ? t.slice(0, 25).trimEnd() + ' ...' : t);

function shopFrame(title, crumbs, body, q = '') {
  const cats = CATEGORIES.map(
    (c) =>
      `<li><a href="/shop/c/${c.toLowerCase()}/">${c}</a> <span class="count">(${products.filter((p) => p.category === c).length})</span></li>`,
  ).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} | Paper Lantern Books</title>
<style>
body{font-family:sans-serif;margin:0}header,footer{padding:10px 20px;background:#eee}
.page{display:flex}aside{width:200px;padding:10px 20px}.content{flex:1;padding:10px 20px}
ol.grid{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:0}
.star-rating i{display:inline-block;width:12px;height:12px;background:#ccc}
.thumb{display:block;width:120px;height:160px;background:#ddd}
.sr{position:absolute;left:-9999px}
</style></head><body>
<header><a href="/shop/" class="brand">Paper Lantern Books</a>
<form action="/shop/search" method="get" role="search"><input type="search" name="q" placeholder="Search books" value="${esc(q)}"><button type="submit">Search</button></form>
<a href="/shop/basket">Basket (0)</a></header>
<nav aria-label="Breadcrumb"><ul class="breadcrumb">${crumbs}</ul></nav>
<div class="page"><aside><h2>Categories</h2><ul>${cats}</ul></aside>
<div class="content">${body}</div></div>
<footer><a href="/shop/about">About us</a> · <a href="/shop/delivery">Delivery</a> · <a href="/shop/returns">Returns</a></footer>
</body></html>`;
}

function card(p) {
  const href = `/shop/p/${p.slug}/`;
  return `<li><article class="card">
<div class="image"><a href="${href}"><img class="thumb" alt="${esc(p.title)}"></a></div>
<p class="star-rating ${RATING[p.rating]}"><i></i><i></i><i></i><i></i><i></i></p>
<h3><a href="${href}" title="${esc(p.title)}">${esc(short(p.title))}</a></h3>
<div class="buy"><p class="price">£${p.price}</p><p class="stock">${p.stock > 3 ? 'In stock' : 'Low stock'}</p>
<form><button type="button">Add to basket</button></form></div>
</article></li>`;
}

function listing(list, heading, base, pageNo, crumbs, sort) {
  const sorted = list.slice();
  if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
  if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const page = Math.min(Math.max(1, pageNo), pages);
  const slice = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const qs = (n) => `${base}?page=${n}${sort ? `&sort=${sort}` : ''}`;
  const opt = (v, label) =>
    `<option value="${v}"${sort === v ? ' selected' : ''}>${label}</option>`;
  const pager =
    pages > 1
      ? `<ul class="pager">${page > 1 ? `<li class="previous"><a href="${qs(page - 1)}">previous</a></li>` : ''}
<li class="current">Page ${page} of ${pages}</li>${page < pages ? `<li class="next"><a href="${qs(page + 1)}">next</a></li>` : ''}</ul>`
      : '';
  return shopFrame(
    heading,
    crumbs,
    `<h1>${esc(heading)}</h1>
<form class="sort" action="${base}" method="get"><label for="sort">Sort by</label>
<select id="sort" name="sort" onchange="this.form.submit()">${opt('', 'Featured')}${opt('title', 'Title')}${opt('price-asc', 'Price: low to high')}${opt('price-desc', 'Price: high to low')}</select></form>
<p class="results"><strong>${sorted.length}</strong> results - showing <strong>${(page - 1) * PER_PAGE + 1}</strong> to <strong>${(page - 1) * PER_PAGE + slice.length}</strong>.</p>
<section><ol class="grid">${slice.map(card).join('')}</ol></section>${pager}`,
  );
}

function productPage(p) {
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const related = products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
  const cat = p.category.toLowerCase();
  return shopFrame(
    p.title,
    `<li><a href="/shop/">Home</a></li><li><a href="/shop/c/${cat}/">${p.category}</a></li><li class="active">${esc(p.title)}</li>`,
    `<article class="product"><h1>${esc(p.title)}</h1>
<p class="price">£${p.price}</p><p class="stock">In stock (${p.stock} available)</p>
<p class="star-rating ${RATING[p.rating]}"><i></i><i></i><i></i><i></i><i></i></p>
<form><button type="button">Add to basket</button></form>
<h2>Product Description</h2><p>${p.blurb}</p>
<h2>Product Information</h2><table class="info">${row('ISBN', p.isbn)}${row('Pages', p.pages)}${row('Publisher', p.publisher)}${row('Year', p.year)}${row('Price (excl. tax)', '£' + p.price)}${row('Tax', '£0.00')}${row('Availability', `In stock (${p.stock} available)`)}</table>
<h2>Customers also viewed</h2><ol class="grid">${related.map(card).join('')}</ol></article>`,
  );
}

function shop(url) {
  const path = url.pathname;
  const page = Number(url.searchParams.get('page') || 1);
  const sort = url.searchParams.get('sort') || '';
  if (path === '/shop/' || path === '/shop') {
    return listing(
      products,
      'All books',
      '/shop/',
      page,
      '<li><a href="/shop/">Home</a></li><li class="active">All books</li>',
      sort,
    );
  }
  const cat = path.match(/^\/shop\/c\/([a-z]+)\/?$/);
  if (cat) {
    const name = CATEGORIES.find((c) => c.toLowerCase() === cat[1]);
    if (!name) return null;
    return listing(
      products.filter((p) => p.category === name),
      name,
      `/shop/c/${cat[1]}/`,
      page,
      `<li><a href="/shop/">Home</a></li><li class="active">${name}</li>`,
      sort,
    );
  }
  const prod = path.match(/^\/shop\/p\/([a-z0-9-]+)\/?$/);
  if (prod) {
    const p = products.find((x) => x.slug === prod[1]);
    return p ? productPage(p) : null;
  }
  if (path === '/shop/search') {
    const q = (url.searchParams.get('q') || '').trim();
    const hits = q ? products.filter((p) => p.title.toLowerCase().includes(q.toLowerCase())) : [];
    const body = hits.length
      ? `<h1>Search results for "${esc(q)}"</h1><p class="results"><strong>${hits.length}</strong> results.</p><section><ol class="grid">${hits.map(card).join('')}</ol></section>`
      : `<h1>Search results for "${esc(q)}"</h1><p class="results">No books match your search.</p>`;
    return shopFrame(
      'Search',
      '<li><a href="/shop/">Home</a></li><li class="active">Search</li>',
      body,
      q,
    );
  }
  if (['/shop/about', '/shop/delivery', '/shop/returns', '/shop/basket'].includes(path)) {
    const name = path.split('/').pop();
    return shopFrame(
      name,
      '<li><a href="/shop/">Home</a></li>',
      `<h1>${name}</h1><p>${filler(seeded(name.length), 6)}</p>`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Encyclopedia: one long article about an invented country. Facts sit in an
// infobox, in prose deep in the page and in a 30-row table; a long references
// section and large navigation lists pad the page the way real articles do.
// ---------------------------------------------------------------------------
const CITIES = [
  ['Port Calder', 'Westmark', 412300],
  ['Ilvane', 'Highvale', 318950],
  ['Sorrow Bay', 'Westmark', 287410],
  ['Tarn Edwin', 'Highvale', 201675],
  ['Maristow', 'Low Fens', 188240],
  ['Quillhaven', 'Westmark', 151020],
  ['Osk', 'Northreach', 139880],
  ['Brannoch', 'Low Fens', 127560],
  ['Wintergate', 'Northreach', 118300],
  ['Dunmere', 'Highvale', 104915],
  ['Halloway', 'Low Fens', 98700],
  ['Stane', 'Northreach', 91250],
  ['Corriedale', 'Highvale', 84630],
  ['Fenwick Cross', 'Low Fens', 79410],
  ['Aldermouth', 'Westmark', 72880],
  ['Ravensholt', 'Northreach', 66320],
  ['Pellow', 'Low Fens', 61045],
  ['Garrow', 'Highvale', 57790],
  ['Lindisby', 'Westmark', 52610],
  ['Thackmoor', 'Northreach', 48930],
  ['Eskby', 'Low Fens', 44270],
  ['Marrowick', 'Highvale', 40115],
  ['Caldbeck Ferry', 'Westmark', 36890],
  ['Holm', 'Northreach', 33405],
  ['Silverwell', 'Low Fens', 30260],
  ['Brackenfold', 'Highvale', 27940],
  ['Yarrowby', 'Westmark', 25130],
  ['Kettlemere', 'Northreach', 22875],
  ['Astwick', 'Low Fens', 20410],
  ['Uldale', 'Highvale', 18655],
];

const FACTS = {
  Etymology:
    'The name Aldoria is first recorded in the Ilvane Chronicle of 1123, where it appears as "Aldor rīce". Most scholars derive it from the Old Marish word aldor, meaning "elder".',
  'Early settlement':
    'Excavations at Tarn Edwin have dated the oldest lake dwellings to roughly 2400 BCE.',
  'The Tin Wars':
    'The Tin Wars ended with the Treaty of Quillhaven in 1688, which fixed the western border along the River Esk and opened the mines to foreign charter companies.',
  'Union and independence':
    'The four provinces were joined by the Act of Union in 1794. Aldoria declared full independence on 9 March 1921.',
  Geography:
    'The highest point is Mount Serrath at 2,847 metres, and the longest river is the Esk at 612 kilometres.',
  Climate: 'The wettest month in Port Calder is November, with a mean rainfall of 148 millimetres.',
  Government:
    'The national assembly, the Moot, has 180 seats. Members are elected every five years.',
  Economy:
    'Tin remains the largest export and accounted for 34 percent of export earnings in 2023, followed by wool at 19 percent and smoked fish at 11 percent.',
  Transport:
    'The national railway operates 2,310 kilometres of track, of which 640 are electrified.',
  Education:
    'School is compulsory from the age of six to sixteen. The University of Ilvane, founded in 1582, is the oldest in the country.',
  Cuisine:
    'The national dish is braewick, a stew of smoked eel and barley traditionally served on the first day of the herring season.',
  Sport:
    'The most popular sport is field hurling. The national cup final is played each year at Calder Park, which holds 41,500 spectators.',
};

const SECTIONS = [
  ['Etymology', 2],
  ['History', 2],
  ['Early settlement', 3],
  ['The Tin Wars', 3],
  ['Union and independence', 3],
  ['Modern era', 3],
  ['Geography', 2],
  ['Climate', 3],
  ['Wildlife', 3],
  ['Government', 2],
  ['Provinces', 3],
  ['Foreign relations', 3],
  ['Economy', 2],
  ['Transport', 3],
  ['Energy', 3],
  ['Demographics', 2],
  ['Largest cities', 3],
  ['Languages', 3],
  ['Education', 3],
  ['Culture', 2],
  ['Cuisine', 3],
  ['Sport', 3],
  ['See also', 2],
];

function wiki() {
  const r = seeded(7);
  const anchor = (t) => t.replace(/\s+/g, '_');
  const toc = SECTIONS.map(([t]) => `<li><a href="#${anchor(t)}">${t}</a></li>`).join('');
  const langs = Array.from(
    { length: 48 },
    (_, i) =>
      `<li><a href="https://lang${i + 1}.example.org/wiki/Aldoria">Language ${i + 1}</a></li>`,
  ).join('');
  const cities = CITIES.map(
    ([name, prov, pop], i) =>
      `<tr><td>${i + 1}</td><td><a href="/wiki/${anchor(name)}">${name}</a></td><td>${prov}</td><td>${pop.toLocaleString('en-US')}</td></tr>`,
  ).join('');
  const body = SECTIONS.map(([t, level]) => {
    const fact = FACTS[t] ? `<p>${filler(r, 3)} ${FACTS[t]} ${filler(r, 2)}</p>` : '';
    const paras = Array.from({ length: 3 }, () => `<p>${filler(r, 7)}</p>`).join('');
    let extra = '';
    if (t === 'Largest cities') {
      extra = `<table class="wikitable sortable"><caption>Cities of Aldoria by population (2024 census)</caption>
<thead><tr><th>Rank</th><th>City</th><th>Province</th><th>Population</th></tr></thead><tbody>${cities}</tbody></table>`;
    }
    if (t === 'See also') {
      return `<h${level} id="${anchor(t)}">${t}</h${level}><ul><li><a href="/wiki/Outline_of_Aldoria">Outline of Aldoria</a></li><li><a href="/wiki/Index_of_Aldoria-related_articles">Index of Aldoria-related articles</a></li></ul>`;
    }
    return `<h${level} id="${anchor(t)}">${t}</h${level}>${paras}${fact}${extra}`;
  }).join('\n');
  const refs = Array.from(
    { length: 140 },
    (_, i) =>
      `<li id="cite_${i + 1}">${filler(r, 1)} <a href="https://archive.example.org/doc/${1000 + i}">Archived record ${1000 + i}</a>. Retrieved ${1 + (i % 28)} June 2025.</li>`,
  ).join('');
  const info = (k, v) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Aldoria - Open Gazetteer</title>
<meta name="description" content="Aldoria is a country of four provinces on the western sea.">
<style>body{font-family:sans-serif;margin:0}#side{float:left;width:180px}#content{margin-left:200px;max-width:900px}
.infobox{float:right;width:300px;border:1px solid #aaa}.noprint{display:none}</style></head><body>
<header><a href="/wiki/Main_Page">Open Gazetteer</a>
<form action="/wiki/search" role="search"><input type="search" name="q" placeholder="Search Open Gazetteer"><button>Search</button></form>
<nav aria-label="Personal tools"><a href="/wiki/Special:Login">Log in</a> <a href="/wiki/Special:Donate">Donate</a></nav></header>
<div id="side"><nav aria-label="Site"><ul><li><a href="/wiki/Main_Page">Main page</a></li><li><a href="/wiki/Contents">Contents</a></li><li><a href="/wiki/Random">Random article</a></li><li><a href="/wiki/Help">Help</a></li></ul></nav>
<nav aria-label="Languages"><h2>In other languages</h2><ul>${langs}</ul></nav></div>
<main id="content"><h1>Aldoria</h1>
<div class="noprint">This hidden banner must never be shown to the model.</div>
<p class="hatnote">This article is about the country. For the river, see <a href="/wiki/Aldor_(river)">Aldor (river)</a>.</p>
<table class="infobox"><caption>Republic of Aldoria</caption>
${info('Capital', '<a href="/wiki/Ilvane">Ilvane</a>')}${info('Largest city', '<a href="/wiki/Port_Calder">Port Calder</a>')}
${info('Official languages', 'Marish, Low Fennish')}${info('Population (2024 census)', '3,912,480')}
${info('Area', '86,340 km²')}${info('Currency', 'Aldorian mark (ALM)')}${info('HDI (2023)', '0.871')}
${info('Calling code', '+477')}${info('Drives on', 'left')}</table>
<p><b>Aldoria</b>, officially the <b>Republic of Aldoria</b>, is a country of four provinces on the western sea. ${filler(r, 5)}</p>
<p>${filler(r, 6)}</p>
<nav id="toc" aria-label="Contents"><h2>Contents</h2><ol>${toc}</ol></nav>
${body}
<h2 id="References">References</h2><ol class="references">${refs}</ol>
</main>
<footer><ul><li><a href="/wiki/Privacy">Privacy policy</a></li><li><a href="/wiki/About">About Open Gazetteer</a></li><li><a href="/wiki/Disclaimers">Disclaimers</a></li></ul></footer>
</body></html>`;
}

// ---------------------------------------------------------------------------
// News: a front page of <article> teasers without <main>, a consent dialog,
// and a story that continues on a second page.
// ---------------------------------------------------------------------------
const STORIES = [
  [
    'harbour-bridge',
    'Harbour bridge to reopen after two-year repair',
    'Maren Holt',
    'Engineers say the crossing will carry traffic again next month.',
  ],
  [
    'wool-prices',
    'Wool prices reach a ten-year high',
    'Tobias Renn',
    'Graziers in Highvale report the strongest season in a decade.',
  ],
  [
    'school-meals',
    'Council votes to extend free school meals',
    'Ines Quarrie',
    'The scheme will cover every primary school in the Low Fens.',
  ],
  [
    'night-ferry',
    'Night ferry to Sorrow Bay returns for the summer',
    'Maren Holt',
    'The service was suspended in 2022 after storm damage.',
  ],
  [
    'tin-museum',
    'Old smelter to become a museum of tin',
    'Corin Vale',
    'The Quillhaven works closed in 1987 and has stood empty since.',
  ],
  [
    'hurling-final',
    'Ilvane take the cup in extra time',
    'Pell Arden',
    'A late score settled the final in front of a full Calder Park.',
  ],
  [
    'library-hours',
    'Libraries to open on Sundays from October',
    'Ines Quarrie',
    'Seven branches will take part in a one-year trial.',
  ],
  [
    'eel-season',
    'Poor eel season worries smokehouses',
    'Tobias Renn',
    'Catches on the lower Esk are down by a third.',
  ],
];

function newsFrame(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} - The Calder Courier</title>
<style>body{font-family:serif;margin:0 40px}#consent{position:fixed;left:0;right:0;bottom:0;background:#222;color:#fff;padding:16px}
.teasers article{border-bottom:1px solid #ccc;padding:8px 0}</style></head><body>
<header><a href="/news/">The Calder Courier</a><nav aria-label="Sections"><a href="/news/s/local">Local</a> <a href="/news/s/business">Business</a> <a href="/news/s/sport">Sport</a> <a href="/news/s/weather">Weather</a></nav></header>
${body}
<div id="consent" role="dialog" aria-label="Cookie consent"><p>We use cookies to measure readership.</p>
<button type="button" onclick="this.closest('#consent').remove()">Reject all</button>
<button type="button" onclick="this.closest('#consent').remove()">Accept all</button></div>
<footer><a href="/news/contact">Contact the newsroom</a></footer></body></html>`;
}

function news(url) {
  const path = url.pathname;
  if (path === '/news/' || path === '/news') {
    const teasers = STORIES.map(
      ([slug, head, by, sum], i) =>
        `<article><h2><a href="/news/a/${slug}">${head}</a></h2><p class="summary">${sum}</p><p class="byline">By ${by} · <time datetime="2025-06-${String(10 + i).padStart(2, '0')}">${10 + i} June 2025</time></p></article>`,
    ).join('');
    return newsFrame(
      'Front page',
      `<h1 class="sr">Front page</h1><div class="teasers">${teasers}</div>`,
    );
  }
  const m = path.match(/^\/news\/a\/([a-z-]+)$/);
  if (!m) return null;
  const story = STORIES.find((s) => s[0] === m[1]);
  if (!story) return null;
  const [slug, head, by] = story;
  const r = seeded(slug.length * 31);
  const page = Number(url.searchParams.get('page') || 1);
  if (slug !== 'harbour-bridge') {
    return newsFrame(
      head,
      `<main><article><h1>${head}</h1><p class="byline">By ${by}</p><p>${filler(r, 8)}</p><p>${filler(r, 8)}</p></article></main>`,
    );
  }
  if (page === 2) {
    return newsFrame(
      head,
      `<main><article><h1>${head}</h1><p class="byline">By ${by} · Page 2 of 2</p><p>${filler(r, 6)}</p>
<p>The final bill for the work came to 18.4 million marks, about a fifth more than the 15.2 million first budgeted. ${filler(r, 3)}</p>
<p>${filler(r, 6)}</p><p class="pager"><a href="/news/a/harbour-bridge">Previous page</a></p></article></main>`,
    );
  }
  return newsFrame(
    head,
    `<main><article><h1>${head}</h1><p class="byline">By ${by} · Page 1 of 2</p>
<p>The harbour bridge at Port Calder will reopen on 14 July, the port authority has confirmed. ${filler(r, 4)}</p>
<p>${filler(r, 7)}</p><p>${filler(r, 7)}</p><p class="pager"><a href="/news/a/harbour-bridge?page=2">Continue reading</a></p></article></main>`,
  );
}

// ---------------------------------------------------------------------------
// Docs: a wide navigation tree and an options table.
// ---------------------------------------------------------------------------
const OPTIONS = [
  ['listen_port', 'integer', '8420', 'Port the daemon accepts connections on.'],
  ['worker_count', 'integer', '4', 'Number of worker processes started at boot.'],
  ['retry_limit', 'integer', '5', 'How many times a failed job is retried.'],
  ['retry_backoff', 'duration', '750ms', 'Delay before the first retry; doubles on each attempt.'],
  ['queue_depth', 'integer', '2048', 'Jobs held in memory before back-pressure applies.'],
  ['log_level', 'string', 'notice', 'One of debug, info, notice, warn, error.'],
  ['log_format', 'string', 'logfmt', 'Either logfmt or json.'],
  ['tls_min_version', 'string', '1.2', 'Lowest TLS version the listener accepts.'],
  ['idle_timeout', 'duration', '90s', 'Connections idle for longer are closed.'],
  ['max_body_size', 'size', '16MiB', 'Largest request body accepted.'],
  ['snapshot_interval', 'duration', '15m', 'How often state is written to disk.'],
  ['snapshot_keep', 'integer', '7', 'Number of snapshots kept before the oldest is deleted.'],
  ['metrics_path', 'string', '/metrics', 'Path the metrics endpoint is served on.'],
  ['metrics_enabled', 'boolean', 'true', 'Whether the metrics endpoint is served.'],
  ['cache_ttl', 'duration', '10m', 'Lifetime of entries in the result cache.'],
  ['cache_size', 'size', '256MiB', 'Upper bound on memory used by the result cache.'],
  ['shutdown_grace', 'duration', '30s', 'Time allowed for jobs to finish at shutdown.'],
  ['heartbeat_interval', 'duration', '5s', 'How often workers report liveness.'],
  ['cluster_name', 'string', 'default', 'Label attached to every metric and log line.'],
  ['data_dir', 'path', '/var/lib/tarn', 'Directory where state is stored.'],
];

function docs(url) {
  const path = url.pathname;
  const r = seeded(99);
  const nav = Array.from(
    { length: 56 },
    (_, i) =>
      `<li><a href="/docs/topic-${i + 1}">Topic ${i + 1}: ${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]}</a></li>`,
  ).join('');
  const frame = (
    title,
    body,
  ) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} - Tarn documentation</title>
<style>body{font-family:sans-serif;margin:0;display:flex}nav.tree{width:260px}main{flex:1;padding:0 24px}</style></head><body>
<nav class="tree" aria-label="Documentation"><ul><li><a href="/docs/">Overview</a></li><li><a href="/docs/install">Installation</a></li><li><a href="/docs/configuration">Configuration reference</a></li>${nav}</ul></nav>
<main>${body}</main></body></html>`;
  if (path === '/docs/' || path === '/docs') {
    return frame(
      'Overview',
      `<h1>Tarn</h1><p>Tarn is a small job queue daemon. ${filler(r, 5)}</p><h2>Where to start</h2><ul><li><a href="/docs/install">Install Tarn</a></li><li><a href="/docs/configuration">Configuration reference</a> lists every option and its default.</li></ul>`,
    );
  }
  if (path === '/docs/install') {
    return frame(
      'Installation',
      `<h1>Installation</h1><p>${filler(r, 4)}</p><pre><code>curl -sSf https://get.tarn.example/install.sh | sh\ntarn --version</code></pre><p>${filler(r, 4)}</p>`,
    );
  }
  if (path === '/docs/configuration') {
    const rows = OPTIONS.map(
      ([n, t, d, desc]) =>
        `<tr><td><code>${n}</code></td><td>${t}</td><td><code>${d}</code></td><td>${desc}</td></tr>`,
    ).join('');
    return frame(
      'Configuration reference',
      `<h1>Configuration reference</h1><p>${filler(r, 5)}</p><h2>File location</h2><p>Tarn reads <code>/etc/tarn/tarn.toml</code> at start. ${filler(r, 3)}</p>
<h2>Options</h2><table><thead><tr><th>Option</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Reloading</h2><p>Send SIGHUP to reload the file without dropping connections. ${filler(r, 3)}</p>`,
    );
  }
  if (/^\/docs\/topic-\d+$/.test(path))
    return frame(path.slice(6), `<h1>${path.slice(6)}</h1><p>${filler(r, 10)}</p>`);
  return null;
}

// ---------------------------------------------------------------------------
// Dynamic: "#" links run by a script, which fetches the content after a delay.
// ---------------------------------------------------------------------------
const FILMS = {
  2012: [
    ['Tidewater', 4],
    ['The Glass Orchard', 2],
    ['Nine Lanterns', 1],
  ],
  2011: [
    ['A Winter in Osk', 3],
    ['Low Fen Road', 1],
  ],
};

function dynamic() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Award winners by year</title></head><body>
<main><h1>Award winners by year</h1><p>Choose a year to view films. <a href="#films">Jump to films</a></p>
<p class="years"><a href="#" class="year" data-year="2012">2012</a> <a href="#" class="year" data-year="2011">2011</a></p>
<div id="films"></div></main>
<script>
for (const a of document.querySelectorAll('a.year')) {
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    const films = await (await fetch('/dynamic/films?year=' + a.dataset.year)).json();
    document.getElementById('films').innerHTML =
      '<table><thead><tr><th>Title</th><th>Awards</th></tr></thead><tbody>' +
      films.map((f) => '<tr><td>' + f[0] + '</td><td>' + f[1] + '</td></tr>').join('') +
      '</tbody></table>';
  });
}
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Store: a single-page app. The page arrives as an empty frame that its script fills from an
// API, and a search replaces the list without leaving the page. The API answers late, so the
// page's text stays still for a while before the content arrives.
// ---------------------------------------------------------------------------
const STOCK = [
  ['Ridgeback Cordless Drill', '89.40'],
  ['Hollin Claw Hammer', '14.25'],
  ['Tern Panel Saw', '22.10'],
  ['Marram Spirit Level', '18.75'],
  ['Kestrel Impact Drill', '132.60'],
  ['Fenwick Tape Measure', '9.95'],
];

function store(url) {
  // `?live=1` also opens a request the server never answers while the page is open.
  const live = url.searchParams.get('live') === '1' ? "fetch('/store/api/live');" : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ironbark Hardware</title></head><body>
<header><a href="/store/">Ironbark Hardware</a></header>
<main><h1>All tools</h1>
<form id="search" role="search"><input type="search" name="q" aria-label="Search tools"> <button>Search</button></form>
<h2 id="status"></h2>
<ul id="items"></ul></main>
<script>
const items = document.getElementById('items');
const status = document.getElementById('status');
async function load(q) {
  const found = await (await fetch('/store/api/tools?q=' + encodeURIComponent(q))).json();
  items.innerHTML = found.map((t) => '<li>' + t[0] + ' · £' + t[1] + '</li>').join('');
  return found.length;
}
load('');
${live}
document.getElementById('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = new FormData(e.target).get('q');
  status.textContent = 'Searched for: ' + q;
  const count = await load(q);
  status.textContent += ' · ' + count + ' found';
});
</script></body></html>`;
}

export const data = { products, CITIES, OPTIONS, STORIES, FACTS, CATEGORIES, FILMS, STOCK };

export function render(href) {
  const url = new URL(href, 'http://fixture.test');
  if (url.pathname.startsWith('/shop')) return shop(url);
  if (url.pathname === '/wiki/Aldoria') return wiki();
  if (url.pathname.startsWith('/wiki/')) {
    const name = decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name)} - Open Gazetteer</title></head><body><main><h1>${esc(name)}</h1><p>${filler(seeded(name.length), 6)}</p><p><a href="/wiki/Aldoria">Back to Aldoria</a></p></main></body></html>`;
  }
  if (url.pathname.startsWith('/news')) return news(url);
  if (url.pathname.startsWith('/docs')) return docs(url);
  if (url.pathname === '/dynamic/') return dynamic();
  if (url.pathname === '/store/') return store(url);
  if (url.pathname === '/') {
    return '<!doctype html><html><head><title>Fixture index</title></head><body><h1>Fixture sites</h1><ul><li><a href="/shop/">Paper Lantern Books</a></li><li><a href="/wiki/Aldoria">Aldoria</a></li><li><a href="/news/">The Calder Courier</a></li><li><a href="/docs/">Tarn documentation</a></li></ul></body></html>';
  }
  return null;
}

export function serve(port = 8080, host = '127.0.0.1') {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://fixture.test');
    if (url.pathname === '/dynamic/films') {
      // Answered late on purpose: a tool that looks too early sees no change.
      const films = FILMS[url.searchParams.get('year')] ?? [];
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(films));
      }, 600);
      return;
    }
    if (url.pathname === '/store/api/tools') {
      // Slower than a tool's look at the page: the text stays still while this is on its way.
      const words = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const found = STOCK.filter(([title]) => words.every((w) => title.toLowerCase().includes(w)));
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(found));
      }, 1200);
      return;
    }
    if (url.pathname === '/store/api/live') {
      // Held open like a live feed; it ends when the page goes away.
      const timer = setTimeout(() => res.end(), 60000);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    const html = render(req.url || '/');
    if (html == null) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        '<!doctype html><title>Not found</title><h1>Page not found</h1><p><a href="/">Index</a></p>',
      );
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.argv[2] || process.env.FIXTURE_PORT || 8080);
  serve(port, '0.0.0.0').then(() => console.error(`[fixture] serving on :${port}`));
}
