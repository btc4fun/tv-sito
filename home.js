/*
 * Home TV - la schermata principale.
 *
 * In alto saluto, data, ora e impostazioni. Al centro il titolo grande
 * dell'elemento selezionato. Sotto le file di app: Preferiti, poi le app
 * raggruppate per tipo. La fila attiva resta sempre allo stesso punto.
 * Tutto si modifica dal TV: OK tenuto premuto (o Giallo) apre le opzioni,
 * l'ingranaggio in alto apre le impostazioni.
 *
 * Solo JavaScript ES5: il browser del TV e' datato.
 */
(function () {
  'use strict';

  var $ = UI.$;
  var DEMO = UI.DEMO;
  var VERSIONE = '1.1.0';

  /* ============================================================ dati */

  var DEFAULT_FAVS = ['Netflix', 'Disney+', 'Prime Video', 'YouTube', 'Apple TV', 'DAZN',
    'RaiPlay', 'Mediaset Infinity', 'NOW', 'Spotify'];

  var cfg = UI.load('tvh-config', {});      // config.json da GitHub
  var prefs = UI.load('tvh-prefs', {});     // scelte fatte sul TV
  // All'avvio, prima di scrivere sul servizio, ci si allinea con la sua copia:
  // serve se la memoria della pagina e' stata cancellata, o se nel frattempo
  // qualcosa e' cambiato dal telefono (per esempio il link del sito).
  // Vince la modifica piu' recente (ogni salvataggio ha la sua ora, "rev").
  var ripristinoFatto = DEMO;
  var vuotoAvvio = vuoto(prefs), revAvvio = prefs.rev || 0;
  // memoria vuota = nessuna scelta vera (ghVisto e rev li scrive gia' adottaGithub, appena arriva config.json)
  function vuoto(o) {
    if (!o || typeof o !== 'object') return true;
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k) && k !== 'ghVisto' && k !== 'rev') return false;
    return true;
  }
  var NON_AUTORIZZATA = 'pagina non autorizzata';
  var MSG_NOME_GITHUB = 'Il servizio del TV non riconosce questa pagina: in TizenBrew aggiungi il modulo tuonome/tv-sito';
  var apps = DEMO ? null : UI.load('tvh-apps', null);
  var colors = UI.load('tvh-colors', {});
  var last = UI.load('tvh-last', null);
  // Continua a guardare (dal servizio del TV; l'ultima copia per averla subito all'apertura)
  var visti = DEMO ? [] : UI.load('tvh-visti', []);
  if (!Array.isArray(visti)) visti = [];
  var vistiTotale = 0; // quanti ne ricorda il TV (anche i film finiti, che nella fila non ci sono)

  var DEFAULTS = {
    tema: 'notte', luce: 'vivace', categorie: true, nome: '', ricerca: 'duckduckgo',
    nomeSito: 'Il mio sito', url: '',
    bloccoPubblicita: true, bloccoAvanzato: false, schermoInteroAutomatico: true, apriHomeAllAccensione: true,
    decorazioni: true // le decorazioni delle feste (Halloween, Natale): si possono spegnere in Impostazioni
  };

  // valore effettivo: scelta fatta sul TV, altrimenti config.json, altrimenti predefinito
  function opt(k) {
    if (prefs[k] !== undefined && prefs[k] !== null) return prefs[k];
    if (k === 'ricerca' && ricercaDaConfig()) return ricercaDaConfig();
    if (cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '') return cfg[k];
    return DEFAULTS[k];
  }

  // il motore di ricerca di config.json (un indirizzo, "browser.ricerca") come voce delle impostazioni
  function ricercaDaConfig() {
    var m = cfg.browser && typeof cfg.browser.ricerca === 'string' ? /^https?:\/\/(?:www\.)?([^\/?#]+)/i.exec(cfg.browser.ricerca) : null;
    if (!m) return '';
    var h = m[1].toLowerCase();
    return /google\./.test(h) ? 'google' : /bing\./.test(h) ? 'bing' : /ecosia\./.test(h) ? 'ecosia' : /duckduckgo\./.test(h) ? 'duckduckgo' : h;
  }

  // Nome e link del sito: vince l'ultima modifica. Se su GitHub cambiano,
  // si usa il valore nuovo di GitHub; se li cambi dal TV, vale il TV.
  function adottaGithub() {
    prefs.ghVisto = prefs.ghVisto || {};
    var cambiato = false;
    var chiavi = ['url', 'nomeSito'];
    for (var i = 0; i < chiavi.length; i++) {
      var k = chiavi[i], g = cfg[k];
      if (g === undefined) continue;
      if (prefs.ghVisto[k] === undefined) { prefs.ghVisto[k] = g; cambiato = true; continue; }
      if (prefs.ghVisto[k] !== g) { prefs.ghVisto[k] = g; delete prefs[k]; cambiato = true; }
    }
    if (cambiato) salvaPrefs();
  }

  var DEMO_APPS = ['Netflix', 'Disney+', 'Prime Video', 'YouTube', 'Apple TV', 'DAZN', 'RaiPlay',
    'Mediaset Infinity', 'NOW', 'Spotify', 'Twitch', 'Plex', 'Crunchyroll', 'Samsung TV Plus',
    'SmartThings', 'Internet', 'Galleria', 'Apps', 'Amazon Music'].map(function (n) {
      return { id: 'demo.' + n.replace(/\W+/g, ''), name: n, icon: '' };
    });

  /* ============================================================ categorie */

  var CATS = [
    { id: 'video', titolo: 'Video e musica', re: /youtube|twitch|tiktok|vimeo|dailymotion|spotify|deezer|apple music|amazon music|tidal|soundcloud|radio|music|musica|podcast/i },
    { id: 'sport', titolo: 'Sport', re: /dazn|sky ?sport|eurosport|nba|nfl|formula|\bf1\b|uefa|sport/i },
    { id: 'giochi', titolo: 'Giochi', re: /game|giochi|xbox|geforce|steam|luna|blacknut|playstation|arcade/i },
    { id: 'film', titolo: 'Film e serie', re: /netflix|prime video|amazon|disney|apple tv|^now\b|paramount|raiplay|rai play|mediaset|infinity|discovery|plex|jellyfin|emby|stremio|kodi|crunchyroll|mubi|rakuten|pluto|tv plus|chili|timvision|sky go|\bmax\b|hbo|film|cinema/i },
    { id: 'strumenti', titolo: 'Strumenti', re: /internet|browser|smartthings|store|^apps$|galleria|gallery|impostazioni|settings|manual|bixby|alexa|assistant|mirror|remote|file|camera|meteo|weather|workspace/i }
  ];
  var ORDINE_FILE = ['film', 'sport', 'video', 'giochi', 'altre', 'strumenti'];
  var TITOLI = { film: 'Film e serie', sport: 'Sport', video: 'Video e musica', giochi: 'Giochi', altre: 'Altre app', strumenti: 'Strumenti' };

  function categoria(name) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].re.test(name)) return CATS[i].id;
    return 'altre';
  }

  var DESCR = [
    [/netflix/i, 'Film e serie TV'],
    [/disney/i, 'Film, serie e cartoni'],
    [/prime video|amazon/i, 'Film e serie di Prime'],
    [/youtube/i, 'Video da tutto il mondo'],
    [/apple tv/i, 'Film e serie Apple'],
    [/dazn/i, 'Sport in diretta'],
    [/raiplay/i, 'Rai in diretta e on demand'],
    [/mediaset|infinity/i, 'Mediaset in diretta e on demand'],
    [/^now\b/i, 'Cinema, serie e sport'],
    [/spotify|music|deezer/i, 'Musica e podcast'],
    [/twitch/i, 'Dirette e giochi'],
    [/plex|jellyfin|kodi/i, 'La tua libreria di film'],
    [/crunchyroll/i, 'Anime'],
    [/paramount/i, 'Film e serie Paramount'],
    [/\bmax\b|hbo/i, 'Film e serie HBO'],
    [/pluto|tv plus/i, 'Canali gratuiti'],
    [/internet/i, 'Il browser di Samsung'],
    [/smartthings/i, 'Casa connessa'],
    [/store|^apps$/i, 'Scarica nuove app'],
    [/gallery|galleria/i, 'Foto e video']
  ];
  function descr(name) {
    for (var i = 0; i < DESCR.length; i++) if (DESCR[i][0].test(name)) return DESCR[i][1];
    return '';
  }

  /* ============================================================ colori */

  var HOUSE = {
    sito: { a: '255,123,71', b: '168,50,27' },
    web: { a: '34,195,174', b: '11,87,98' },
    gear: { a: '120,132,156', b: '40,46,60' }
  };
  var PALETTE = [
    ['59,76,202', '26,35,102'], ['142,63,184', '61,24,87'], ['15,155,142', '10,71,68'],
    ['217,98,43', '110,38,17'], ['86,96,107', '34,39,45'], ['47,158,90', '18,65,39'],
    ['194,59,78', '86,21,32'], ['43,123,191', '16,54,90']
  ];

  function colorsFor(item) {
    if (HOUSE[item.kind]) return HOUSE[item.kind];
    if (item.id && colors[item.id]) return colors[item.id];
    var p = PALETTE[UI.hash(item.nomeVero || item.name || '') % PALETTE.length]; // un'app rinominata tiene il suo colore
    return { a: p[0], b: p[1] };
  }
  function dim(rgb, f) {
    var p = rgb.split(',');
    return Math.round(p[0] * f) + ',' + Math.round(p[1] * f) + ',' + Math.round(p[2] * f);
  }
  function cardBg(item) {
    var c = colorsFor(item);
    if (c.edge) return 'rgb(' + c.edge + ')';
    return 'linear-gradient(140deg, rgb(' + dim(c.a, 0.85) + ') 0%, rgb(' + dim(c.b, 0.85) + ') 100%)';
  }
  function isFull(item) { return !!(item.id && colors[item.id] && colors[item.id].edge); }

  // Un solo strato a tutto schermo per luce + ombra: sul TV ogni strato in piu' costa.
  var SHADE = 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,.5) 70%, rgba(0,0,0,.78) 100%),';
  function washCss(c) {
    var luce = opt('luce');
    if (luce === 'spenta') return SHADE + 'var(--bg)';
    var k = luce === 'tenue' ? 0.5 : 1;
    return SHADE +
      'radial-gradient(140rem 80rem at 84% 0%, rgba(' + c.a + ',' + (0.55 * k) + ') 0%, rgba(' + c.a + ',0) 70%),' +
      'radial-gradient(110rem 70rem at 0% 60%, rgba(' + c.b + ',' + (0.32 * k) + ') 0%, rgba(' + c.b + ',0) 70%),var(--bg)';
  }

  // Colori dell'icona, letti da una copia minuscola (24x14 pixel).
  var tinyCanvas = null;
  function tone(c, f) {
    var mx = Math.max(c[0], c[1], c[2]) || 1;
    var s = Math.min(210, Math.max(90, mx)) * f / mx;
    return Math.round(c[0] * s) + ',' + Math.round(c[1] * s) + ',' + Math.round(c[2] * s);
  }
  function extractColors(img) {
    var W = 24, H = 14, d;
    try {
      tinyCanvas = tinyCanvas || document.createElement('canvas');
      tinyCanvas.width = W; tinyCanvas.height = H;
      var ctx = tinyCanvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      d = ctx.getImageData(0, 0, W, H).data;
    } catch (e) { return null; }
    var acc = [[0, 0, 0, 0], [0, 0, 0, 0]];
    var edge = [0, 0, 0, 0], edgeN = 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4, a = d[i + 3] / 255;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) {
          edge[0] += d[i]; edge[1] += d[i + 1]; edge[2] += d[i + 2]; edge[3] += a; edgeN++;
        }
        if (a < 0.2) continue;
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        var sat = mx ? (mx - mn) / mx : 0;
        var w = a * (0.15 + sat * sat * 2) * (mx > 30 ? 1 : 0.3);
        var k = x < W / 2 ? 0 : 1;
        acc[k][0] += r * w; acc[k][1] += g * w; acc[k][2] += b * w; acc[k][3] += w;
      }
    }
    if (!acc[0][3] && !acc[1][3]) return null;
    function avg(v, other) {
      var s = v[3] ? v : other;
      return [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    }
    var out = { a: tone(avg(acc[0], acc[1]), 1), b: tone(avg(acc[1], acc[0]), 0.72) };
    // icona "piena" (bordi opachi): il riquadro prende il colore del bordo
    if (edgeN && edge[3] / edgeN > 0.92) {
      out.edge = Math.round(edge[0] / edgeN) + ',' + Math.round(edge[1] / edgeN) + ',' + Math.round(edge[2] / edgeN);
    }
    return out;
  }

  /* ============================================================ modello: file e riquadri */

  function norm(s) { return ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ') + ' '; }
  function findByName(list, name) {
    var n = norm(name);
    for (var i = 0; i < list.length; i++) if (norm(list[i].name) === n) return list[i];
    for (var j = 0; j < list.length; j++) if (norm(list[j].name).indexOf(n) !== -1) return list[j];
    return null;
  }

  function appItem(a) {
    var nomi = prefs.nomiApp || {};
    return { key: 'app:' + a.id, kind: 'app', id: a.id, name: nomi[a.id] || a.name, nomeVero: a.name, icon: a.icon || '', cat: categoria(a.name) };
  }
  function sitoItem() { return { key: 'sito', kind: 'sito', name: opt('nomeSito') || 'Il mio sito', url: opt('url') }; }
  // gli altri tuoi siti (aggiunti col "+"): uguali al tuo sito, ognuno col suo nome, il suo link e il suo blocco della
  // pubblicita' (completo come il tuo sito, o normale come il browser), quanti ne vuoi
  function altriSiti() {
    return Array.isArray(prefs.siti) ? prefs.siti.filter(function (s) { return s && s.id && typeof s.url === 'string'; }) : [];
  }
  function bloccoDi(s) { return s && s.blocco === 'completo' ? 'completo' : 'normale'; }
  function altroSitoItem(s) {
    return { key: 'sito:' + s.id, kind: 'sito', sid: s.id, name: s.nome || UI.hostOf(s.url) || 'Sito', url: s.url, blocco: bloccoDi(s) };
  }
  function webItem() { return { key: 'web', kind: 'web', name: 'Browser' }; }
  var AGGIUNGI = { key: 'aggiungi', kind: 'aggiungi', name: 'Aggiungi' };

  function nascosta(a) {
    var ids = prefs.nascoste || [];
    if (ids.indexOf(a.id) !== -1) return true;
    var nomi = cfg.nascoste || [];
    for (var i = 0; i < nomi.length; i++) if (norm(a.name) === norm(nomi[i])) return true;
    return false;
  }

  function appVisibili() {
    var list = (DEMO ? DEMO_APPS : (apps || [])).filter(function (a) { return !nascosta(a); });
    list.sort(function (x, y) { return x.name.toLowerCase() < y.name.toLowerCase() ? -1 : 1; });
    return list;
  }

  // chiavi dei preferiti, in ordine
  function chiaviPreferiti(list) {
    if (prefs.preferiti && prefs.preferiti.length) return prefs.preferiti.slice();
    var keys = ['sito', 'web'];
    var names = cfg.preferite && cfg.preferite.length ? cfg.preferite : DEFAULT_FAVS;
    for (var n = 0; n < names.length; n++) {
      var a = findByName(list, names[n]);
      if (a && keys.indexOf('app:' + a.id) === -1) keys.push('app:' + a.id);
    }
    return keys;
  }

  var rows = []; // [{ id, titolo, items }]

  function build() {
    var list = appVisibili();
    var byKey = { sito: sitoItem(), web: webItem() };
    altriSiti().forEach(function (s) { var it = altroSitoItem(s); byKey[it.key] = it; });
    var items = list.map(appItem);
    for (var i = 0; i < items.length; i++) byKey[items[i].key] = items[i];

    var favKeys = chiaviPreferiti(list);
    // il tuo sito e il browser ci sono sempre
    if (favKeys.indexOf('sito') === -1) favKeys.unshift('sito');
    if (favKeys.indexOf('web') === -1) favKeys.splice(1, 0, 'web');
    // i siti che hai aggiunto stanno sempre nei preferiti, come il tuo sito
    altriSiti().forEach(function (s) { if (favKeys.indexOf('sito:' + s.id) === -1) favKeys.push('sito:' + s.id); });
    var fav = [];
    for (var f = 0; f < favKeys.length; f++) if (byKey[favKeys[f]]) fav.push(byKey[favKeys[f]]);
    fav.push(AGGIUNGI); // in fondo: il "+"

    rows = [{ id: 'preferiti', titolo: 'Preferiti', items: fav }];
    // subito sotto i preferiti: quello che stavi guardando (al massimo 10, una scheda per film o serie)
    if (visti.length) rows.push({ id: 'continua', titolo: 'Continua a guardare', items: visti.map(continuaItem) });
    if (opt('categorie')) {
      var gruppi = {};
      for (var j = 0; j < items.length; j++) (gruppi[items[j].cat] = gruppi[items[j].cat] || []).push(items[j]);
      for (var o = 0; o < ORDINE_FILE.length; o++) {
        var g = gruppi[ORDINE_FILE[o]];
        if (g && g.length) rows.push({ id: ORDINE_FILE[o], titolo: TITOLI[ORDINE_FILE[o]], items: g });
      }
    } else if (items.length) {
      rows.push({ id: 'tutte', titolo: 'Tutte le app', items: items });
    }
  }

  function inPreferiti(item) {
    var r = rows[0].items;
    for (var i = 0; i < r.length; i++) if (r[i].key === item.key) return true;
    return false;
  }

  /* ============================================================ disegno */

  var GLYPH = {
    sito: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M8 9h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V13a4 4 0 0 1 4-4zm0 4v18h32V13zm12 3.5L30 22l-10 5.5zM15 39h18v3H15z"/></svg>',
    aggiungi: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M22 10h4v12h12v4H26v12h-4V26H10v-4h12z"/></svg>',
    web: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4a20 20 0 1 1 0 40 20 20 0 0 1 0-40zm0 4a16 16 0 1 0 0 32 16 16 0 0 0 0-32zm8.5 7.5L28 28l-12.5 4.5L20 20zM24 21.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>'
  };

  function continuaItem(v) { return { key: 'c:' + v.id, kind: 'continua', id: 'c:' + v.id, name: v.nome, v: v }; }
  function tempo(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function puntataDi(v) {
    if (v.episodio == null) return v.anno ? String(v.anno) : '';
    return v.stagione ? 'S' + v.stagione + ' E' + v.episodio : 'Puntata ' + v.episodio;
  }
  // l'immagine che il sito mostra per quel film o quella serie (se non si carica resta il colore)
  function continuaHTML(item) {
    var v = item.v, se = puntataDi(v), sotto = v.prossima ? 'Prossima puntata' + (se ? ' · ' + se : '') : se;
    var quota = v.durata && !v.prossima ? Math.max(3, Math.min(100, Math.round(v.posizione / v.durata * 100))) : 0;
    var foto = /^https?:\/\//i.test(v.immagine || '') ?
      '<img class="cont-foto" alt="" decoding="async" referrerpolicy="no-referrer" src="' + UI.esc(v.immagine) + '">' : '';
    return '<div class="tile" data-key="' + UI.esc(item.key) + '"><div class="lift"><div class="card continua" style="background:' + cardBg(item) + '">' +
      foto + '<div class="cont-velo"></div><div class="label"><b>' + UI.esc(v.nome) + '</b>' + (sotto ? '<small>' + UI.esc(sotto) + '</small>' : '') + '</div>' +
      (quota ? '<div class="cont-barra"><i style="width:' + quota + '%"></i></div>' : '') +
      '</div><div class="arrows"><i>‹</i><i>›</i></div></div></div>';
  }

  function tileHTML(item) {
    if (item.kind === 'continua') return continuaHTML(item);
    var cls = 'card', style = '', inner = '';
    if (item.kind === 'aggiungi') {
      cls += ' add';
      inner = GLYPH.aggiungi + '<div class="label" style="color:var(--text-2)">Aggiungi</div>';
    } else if (item.kind === 'sito' || item.kind === 'web') {
      cls += item.kind === 'sito' ? ' sito' : ' web';
      var sotto = item.kind === 'sito' ? (UI.validUrl(item.url) ? UI.hostOf(item.url) : 'Imposta il link') : 'Cerca e naviga';
      inner = GLYPH[item.kind] + '<div class="label">' + UI.esc(item.name) + '<small>' + UI.esc(sotto) + '</small></div>';
    } else {
      style = ' style="background:' + cardBg(item) + '"';
      if (item.icon && !DEMO) {
        inner = '<img alt=""' + (isFull(item) ? ' class="full"' : '') + ' crossorigin="anonymous" data-id="' +
          UI.esc(item.id) + '" src="' + UI.esc(UI.iconUrl(item.icon)) + '">';
      } else {
        inner = '<div class="label">' + UI.esc(item.name) + '</div>';
      }
    }
    return '<div class="tile" data-key="' + UI.esc(item.key) + '"><div class="lift"><div class="' + cls + '"' + style + '>' +
      inner + '</div><div class="arrows"><i>‹</i><i>›</i></div></div></div>';
  }

  var rowsEl = $('rows');
  var geo = {};
  var signature = '';

  function measure() {
    var r = UI.rem();
    geo.rem = r;
    geo.pad = 9.6 * r;
    geo.rowH = 30 * r;
    geo.rowY = 52 * r;
    geo.step = 32 * r;           // larghezza riquadro + spazio
    geo.tileW = 28.8 * r;
    geo.view = window.innerWidth - 2 * geo.pad;
  }

  function render(force) {
    build();
    var sig = JSON.stringify([rows, opt('url'), opt('nomeSito'), DEMO]);
    if (sig === signature && !force) return;
    signature = sig;

    var keepKey = cur ? cur.item && cur.item.key : (last && last.key);
    var keepRow = cur ? cur.rowId : (last && last.row);
    var keepArea = cur ? cur.area : 'rows';
    var keepI = cur ? cur.i : 0;

    var html = '';
    for (var r = 0; r < rows.length; r++) {
      html += '<section class="row" data-r="' + r + '" style="top:' + (r * 30) + 'rem">' +
        '<div class="row-title">' + UI.esc(rows[r].titolo) + '</div><div class="track">';
      for (var i = 0; i < rows[r].items.length; i++) html += tileHTML(rows[r].items[i]);
      html += '</div></section>';
    }
    rowsEl.innerHTML = html;
    festaTeschio(); // Halloween
    measure();

    cur = null;
    if (keepArea === 'top') { focusTop(true); return; }
    // si ritrova l'elemento (prima nella stessa fila, poi ovunque), altrimenti lo stesso posto
    var target = null;
    for (var a = 0; a < rows.length && !target; a++) {
      if (rows[a].id !== keepRow) continue;
      for (var b = 0; b < rows[a].items.length; b++) if (rows[a].items[b].key === keepKey) { target = [a, b]; break; }
      if (!target) target = [a, Math.min(keepI, rows[a].items.length - 1)];
    }
    for (var c = 0; c < rows.length && !target; c++) {
      for (var d = 0; d < rows[c].items.length; d++) if (rows[c].items[d].key === keepKey) { target = [c, d]; break; }
    }
    if (!target) target = [0, 0];
    focus(target[0], target[1], true);
  }

  function rowEl(r) { return rowsEl.children[r]; }
  function trackEl(r) { var e = rowEl(r); return e ? e.children[1] : null; }
  function tileEl(r, i) { var t = trackEl(r); return t ? t.children[i] : null; }

  /* ============================================================ selezione */

  var cur = null; // { area: 'rows'|'top', r, i, item, el, rowId }
  var offsets = [];

  function trackOffset(r, i) {
    var n = rows[r].items.length;
    var total = n * geo.step - 3.2 * geo.rem;
    var max = Math.max(0, total - geo.view);
    return Math.min(Math.max(0, (i - 1) * geo.step), max);
  }

  function setRowClasses(active) {
    for (var r = 0; r < rows.length; r++) {
      var e = rowEl(r);
      if (!e) continue;
      e.className = 'row' + (r < active ? ' past' : '') + (r === active ? ' active' : '');
    }
  }

  function blurCur() {
    if (!cur) return;
    if (cur.el) cur.el.classList.remove('f');
  }

  function focus(r, i, instant) {
    if (!rows[r] || !rows[r].items.length) return;
    i = Math.max(0, Math.min(rows[r].items.length - 1, i));
    var el = tileEl(r, i);
    if (!el) return;
    if (cur && cur.el === el) return;
    var cambioFila = !cur || cur.area !== 'rows' || cur.r !== r;
    blurCur();
    el.classList.add('f');
    cur = { area: 'rows', r: r, i: i, item: rows[r].items[i], el: el, rowId: rows[r].id };

    offsets[r] = trackOffset(r, i);
    UI.setTransform(trackEl(r), 'translate3d(' + (-offsets[r]) + 'px,0,0)');
    if (cambioFila) {
      UI.setTransform(rowsEl, 'translate3d(0,' + (geo.rowY - r * geo.rowH) + 'px,0)');
      setRowClasses(r);
    }
    scheduleHero(instant);
    rememberLater();
  }

  var gearEl = $('gear');
  function focusTop(instant) {
    blurCur();
    gearEl.classList.add('f');
    var r = cur && cur.area === 'rows' ? cur.r : 0;
    cur = { area: 'top', r: r, i: 0, item: { kind: 'gear', key: 'gear', name: 'Impostazioni' }, el: gearEl };
    if (rows.length) {
      UI.setTransform(rowsEl, 'translate3d(0,' + geo.rowY + 'px,0)');
      setRowClasses(0);
    }
    scheduleHero(instant);
  }

  function screenX(r, i) { return i * geo.step - (offsets[r] || 0) + geo.tileW / 2; }

  function nearestIndex(r, x) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < rows[r].items.length; i++) {
      var d = Math.abs(i * geo.step - trackOffset(r, i) + geo.tileW / 2 - x);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function move(dir) {
    if (!cur) return;
    if (cur.area === 'top') {
      if (dir === 'down' && rows.length) {
        var keep = cur.r || 0;
        cur.el.classList.remove('f');
        cur = null;
        focus(keep, rows[keep] ? (lastIndex[keep] || 0) : 0);
      }
      return;
    }
    var r = cur.r, i = cur.i;
    if (dir === 'left') focus(r, i - 1);
    else if (dir === 'right') focus(r, i + 1);
    else if (dir === 'up') {
      if (r === 0) { lastIndex[0] = i; focusTop(); }
      else { lastIndex[r] = i; focus(r - 1, nearestIndex(r - 1, screenX(r, i))); }
    } else if (dir === 'down' && r < rows.length - 1) {
      lastIndex[r] = i;
      focus(r + 1, nearestIndex(r + 1, screenX(r, i)));
    }
  }
  var lastIndex = {};

  /* ------------------------------------------------------------ titolo grande */

  var heroText = $('hero-text'), heroCap = $('hero-cap'), heroTitle = $('hero-title'), heroSub = $('hero-sub'), heroChips = $('hero-chips');
  var heroTimer = null, fadeTimer = null, ambientTimer = null, heroKey = '';

  function chip(key, text) { return '<span class="chip"><b>' + key + '</b>' + text + '</span>'; }

  // col puntatore del telefono il titolo grande e la luce seguono la scheda indicata (le file restano ferme:
  // se si spostassero, la scheda scapperebbe da sotto il puntatore)
  var sopraItem = null;
  function itemDaChiave(k) {
    for (var r = 0; r < rows.length; r++) for (var i = 0; i < rows[r].items.length; i++) if (rows[r].items[i].key === k) return rows[r].items[i];
    return null;
  }
  document.addEventListener('hometvsopra', function (ev) {
    var t = ev.target, it = null;
    if (t && t.classList && t.classList.contains('tile')) it = itemDaChiave(t.getAttribute('data-key'));
    if (it === sopraItem) return;
    sopraItem = it;
    if (cur) scheduleHero(false);
  });
  function itemInVista() { return (!moving && sopraItem) || cur.item; }

  function heroData() {
    var it = itemInVista();
    if (moving) {
      return ['Preferiti', 'Sposta ' + it.name, 'Usa le frecce sinistra e destra', chip('‹ ›', 'Sposta') + chip('OK', 'Fatto')];
    }
    if (it.kind === 'gear') {
      return ['Home', 'Impostazioni', 'Tema, luce, il tuo sito, il browser, l\'accensione', chip('OK', 'Apri')];
    }
    var chips = chip('OK', 'Apri') + chip('OK', 'Tieni premuto per le opzioni');
    if (it.kind === 'sito') {
      return [it.sid ? 'Un tuo sito' : 'Il tuo sito', it.name, UI.validUrl(it.url) ? UI.hostOf(it.url) +
        (it.sid ? ' · ' + (it.blocco === 'completo' ? 'Blocco completo' : 'Blocco normale') : '') :
        'Il link non è ancora impostato: mandalo dal telefono o tieni premuto OK', chips];
    }
    if (it.kind === 'aggiungi') {
      return ['Preferiti', 'Aggiungi', 'Un sito come app (anche da un preferito del browser), un\'app del TV, le app nascoste', chip('OK', 'Scegli')];
    }
    if (it.kind === 'web') return ['Navigazione', 'Browser', 'Preferiti, cronologia e ricerca, senza pubblicità', chips];
    if (it.kind === 'continua') {
      var v = it.v, se = puntataDi(v);
      var dove = v.prossima ? 'La prossima puntata' : (v.durata ? 'Sei a ' + tempo(v.posizione) + ' di ' + tempo(v.durata) : '');
      return ['Continua a guardare', v.nome + (se ? ' · ' + se : ''), [dove, v.sito].filter(function (x) { return !!x; }).join(' · ') || ' ',
        chip('OK', v.prossima ? 'Guarda' : 'Riprendi') + chip('OK', 'Tieni premuto per le opzioni')];
    }
    return [TITOLI[it.cat] || 'App', it.name, descr(it.nomeVero || it.name) || ' ', chips];
  }

  function scheduleHero(instant) {
    clearTimeout(heroTimer);
    if (instant) { showHero(true); return; }
    heroTimer = setTimeout(function () { showHero(false); }, 90);
  }

  function showHero(instant) {
    if (!cur) return;
    // la luce cambia solo quando la selezione si ferma: niente dissolvenze mentre si scorre
    clearTimeout(ambientTimer);
    if (instant) setAmbient(itemInVista());
    else ambientTimer = setTimeout(function () { if (cur) setAmbient(itemInVista()); }, 220);

    var d = heroData();
    var key = d.join('|');
    if (key === heroKey) return;
    heroKey = key;
    clearTimeout(fadeTimer);
    // si cambia solo quello che cambia (le scritte uguali non si ridisegnano)
    function put() {
      if (heroCap.textContent !== d[0]) heroCap.textContent = d[0];
      if (heroTitle.textContent !== d[1]) heroTitle.textContent = d[1];
      if (heroSub.textContent !== d[2]) heroSub.textContent = d[2];
      if (heroChips.__html !== d[3]) { heroChips.__html = d[3]; heroChips.innerHTML = d[3]; }
      heroText.className = 'hero-text';
    }
    if (instant) { put(); return; }
    heroText.className = 'hero-text fade';
    fadeTimer = setTimeout(put, 140);
  }

  // La luce si disegna in piccolo (192 x 108) e il TV la allarga a tutto schermo: si vede uguale (e' una sfumatura), ma a
  // ogni scelta il TV disegna 20 mila punti invece di 2 milioni (la sfumatura a tutto schermo faceva scattare la home).
  // Dove il disegno non c'e', la luce resta uno sfondo come prima
  var washA = $('wash-a'), washB = $('wash-b'), washOnA = true, lastWash = '';
  var LW = 192, LH = 108;
  function ellisse(x, cx, cy, rx, ry, rgb, a) {
    x.save();
    x.translate(cx, cy);
    x.scale(1, ry / rx);
    var g = x.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    g.addColorStop(0.7, 'rgba(' + rgb + ',0)');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    x.fillStyle = g;
    x.fillRect(-cx, -cy * rx / ry, LW, LH * rx / ry);
    x.restore();
  }
  // come washCss: sotto il colore del tema, poi le due luci (140x80 rem in alto a destra, 110x70 rem a sinistra), sopra l'ombra
  function disegnaLuce(cv, c, bg) {
    var x = null;
    // senza trasparenza: il TV sa che copre tutto lo sfondo e non lo ridisegna sotto
    try { x = cv.getContext && cv.getContext('2d', { alpha: false }); } catch (e) { x = null; }
    if (!x) return false;
    var luce = opt('luce'), k = luce === 'tenue' ? 0.5 : 1;
    x.fillStyle = bg;
    x.fillRect(0, 0, LW, LH);
    if (luce !== 'spenta') {
      ellisse(x, 0, 0.6 * LH, 110 / 192 * LW, 70 / 108 * LH, c.b, 0.32 * k);
      ellisse(x, 0.84 * LW, 0, 140 / 192 * LW, 80 / 108 * LH, c.a, 0.55 * k);
    }
    festaLuce(x); // Halloween
    var g = x.createLinearGradient(0, 0, 0, LH);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.38, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,.78)');
    x.fillStyle = g;
    x.fillRect(0, 0, LW, LH);
    festaVignetta(x); // Halloween
    return true;
  }
  function setAmbient(item) {
    var c = colorsFor(item), bg = '';
    try { bg = getComputedStyle(document.body).backgroundColor || ''; } catch (e) {}
    var key = [opt('luce'), c.a, c.b, bg, festaAccese()].join('|'); // (accendere o spegnere le decorazioni la ridisegna)
    if (key === lastWash) return;
    lastWash = key;
    var next = washOnA ? washB : washA, now = washOnA ? washA : washB;
    if (!disegnaLuce(next, c, bg || '#0b0c10')) next.style.background = washCss(c);
    next.className = 'wash on';
    now.className = 'wash';
    washOnA = !washOnA;
  }

  var rememberTimer = null;
  function rememberLater() {
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(remember, 600);
  }
  function remember() {
    if (cur && cur.area === 'rows') UI.save('tvh-last', { row: cur.rowId, key: cur.item.key });
  }

  /* ============================================================ azioni */

  function open(item) {
    remember();
    if (item.kind === 'gear') { openSettings(); return; }
    if (item.kind === 'continua') { apriContinua(item, false); return; }
    if (item.kind === 'aggiungi') { menuAggiungi(); return; }
    if (item.kind === 'sito') {
      var url = item.url;
      if (!UI.validUrl(url)) { editLink(item); return; }
      UI.toast('Apro ' + item.name + '…');
      location.href = url;
      return;
    }
    if (item.kind === 'web') { location.href = 'browser.html'; return; }
    if (DEMO) { UI.toast('Anteprima: sul TV qui si apre ' + item.name); return; }
    UI.toast('Apro ' + item.name + '…');
    UI.service('/api/launch', { id: item.id })['catch'](function () {
      UI.toast('Non riesco ad aprire ' + item.name + '. Riprova tra qualche secondo.');
    });
  }

  /* ------------------------------------------------------------ continua a guardare */

  function getVisti() {
    if (DEMO) return;
    UI.service('/api/visti').then(function (j) {
      var nuovi = j && Array.isArray(j.visti) ? j.visti : [];
      var totale = j && typeof j.totale === 'number' ? j.totale : nuovi.length;
      if (totale !== vistiTotale) { vistiTotale = totale; if (settingsOpen) drawSettings(); }
      if (JSON.stringify(nuovi) === JSON.stringify(visti)) return;
      visti = nuovi;
      UI.save('tvh-visti', visti);
      render();
      if (settingsOpen) drawSettings();
    }, function () {});
  }
  // si apre la pagina e il video riparte da dov'eri (o dall'inizio)
  function apriContinua(item, daCapo) {
    if (DEMO) { UI.toast('Anteprima: sul TV qui riprende ' + item.name); return; }
    UI.toast((daCapo ? 'Riparto dall\'inizio: ' : 'Riprendo ') + item.name + '…');
    UI.service('/api/visti/riprendi', { id: item.v.id, daCapo: !!daCapo }).then(function (j) {
      location.href = j && UI.validUrl(j.url) ? j.url : item.v.url;
    }, function () { location.href = item.v.url; });
  }
  function cambiaContinua(azione, item, corpo, fatto) {
    var b = corpo || {};
    b.id = item.v.id;
    UI.service('/api/visti/' + azione, b).then(function () { if (fatto) UI.toast(fatto); getVisti(); }, function () {
      UI.toast('Non riesco a raggiungere il TV: riprova tra poco');
    });
  }
  function opzioniContinua(item) {
    var v = item.v, se = puntataDi(v);
    UI.openSheet({ title: item.name, subtitle: ['Continua a guardare', se, v.sito].filter(function (x) { return !!x; }).join(' · '), items: [
      { label: v.prossima ? 'Guarda la prossima puntata' : 'Riprendi', value: v.prossima || !v.durata ? '' : tempo(v.posizione),
        action: function () { apriContinua(item, false); } },
      { label: 'Ricomincia dall\'inizio', disabled: !!v.prossima, action: function () { apriContinua(item, true); } },
      { label: 'Segna come visto', action: function () { cambiaContinua('visto', item, null, 'Segnato come visto'); } },
      { label: 'Rinomina', action: function () {
        UI.openEditor({ title: 'Nome della scheda', value: item.name, placeholder: 'Per esempio La casa di carta',
          hint: 'Il nome che vedi sulla scheda. Vuoto: torna quello trovato dal sito.',
          onSave: function (t) { cambiaContinua('rinomina', item, { titolo: t }, t ? 'Rinominata' : 'Torna il nome trovato dal sito'); } });
      } },
      { label: 'Togli da Continua a guardare', action: function () { cambiaContinua('togli', item, null, 'Tolta da Continua a guardare'); } }
    ] });
  }
  function svuotaContinua() {
    UI.openSheet({ title: 'Svuotare Continua a guardare?', subtitle: 'Il TV dimentica dove eri arrivato in tutti i video', items: [
      { label: 'Svuota', action: function () {
        UI.service('/api/visti/svuota', {}).then(function () { UI.toast('Continua a guardare svuotato'); getVisti(); },
          function () { UI.toast('Non riesco, riprova'); });
      } },
      { label: 'Annulla', action: function () {} }
    ] });
  }

  function favKeysNow() {
    var k = [];
    for (var i = 0; i < rows[0].items.length; i++) if (rows[0].items[i].kind !== 'aggiungi') k.push(rows[0].items[i].key);
    return k;
  }

  function options(item) {
    if (!item || item.kind === 'gear') return;
    if (item.kind === 'continua') { opzioniContinua(item); return; }
    if (item.kind === 'aggiungi') { menuAggiungi(); return; }
    var items = [{ label: 'Apri', action: function () { open(item); } }];
    var fav = inPreferiti(item);
    // si sposta solo dalla fila dei preferiti
    if (fav && cur && cur.area === 'rows' && cur.r === 0) items.push({ label: 'Sposta', action: function () { startMove(); } });
    if (item.kind === 'sito') {
      items.push({ label: 'Cambia link', action: function () { editLink(item); } });
      items.push({ label: 'Cambia nome', action: function () { editNomeSito(item); } });
      if (item.sid) {
        items.push({ label: 'Blocco della pubblicit\u00e0', value: item.blocco === 'completo' ? 'Completo' : 'Normale',
          action: function () { setTimeout(function () { cambiaBlocco(item); }, 120); } });
        // la conferma e' un altro menu: si apre dopo che questo si e' chiuso
        items.push({ label: 'Togli questo sito', action: function () { setTimeout(function () { togliSito(item); }, 120); } });
      }
    }
    if (item.kind === 'app') {
      if (fav) items.push({ label: 'Togli dai preferiti', action: function () { toggleFav(item); } });
      else items.push({ label: 'Aggiungi ai preferiti', action: function () { toggleFav(item); } });
      items.push({ label: 'Rinomina', action: function () { rinominaApp(item); } });
      items.push({ label: 'Nascondi questa app', action: function () { nascondi(item); } });
    }
    UI.openSheet({ title: item.name, subtitle: item.kind === 'app' ? (TITOLI[item.cat] || 'App') : (item.kind === 'sito' ? (item.sid ? 'Un tuo sito' : 'Il tuo sito') : 'Browser'), items: items });
  }

  function toggleFav(item) {
    var keys = favKeysNow();
    var at = keys.indexOf(item.key);
    if (at === -1) { keys.push(item.key); UI.toast(item.name + ' aggiunta ai preferiti'); }
    else { keys.splice(at, 1); UI.toast(item.name + ' tolta dai preferiti'); }
    prefs.preferiti = keys;
    salvaPrefs();
    render(true);
  }

  function nascondi(item) {
    prefs.nascoste = (prefs.nascoste || []).concat([item.id]);
    if (prefs.preferiti) prefs.preferiti = prefs.preferiti.filter(function (k) { return k !== item.key; });
    salvaPrefs();
    UI.toast(item.name + ' nascosta. La ritrovi in Impostazioni');
    render(true);
  }

  /* ------------------------------------------------------------ spostamento nei preferiti */

  var moving = false;

  function startMove() {
    if (!cur || cur.r !== 0) return;
    if (!prefs.preferiti) prefs.preferiti = favKeysNow();
    moving = true;
    cur.el.classList.add('moving');
    heroKey = '';
    showHero(true);
  }

  function moveBy(d) {
    var keys = favKeysNow();
    var i = cur.i, j = i + d;
    if (j < 0 || j >= keys.length) return;
    var t = keys[i]; keys[i] = keys[j]; keys[j] = t;
    prefs.preferiti = keys;
    render(true);
    cur.el.classList.add('moving');
    heroKey = '';
    showHero(true);
  }

  function endMove() {
    moving = false;
    if (cur && cur.el) cur.el.classList.remove('moving');
    salvaPrefs();
    heroKey = '';
    showHero(true);
    UI.toast('Preferiti salvati');
  }

  /* ============================================================ impostazioni */

  var settingsOpen = false, setSel = 0, setItems = [];
  var settingsEl = $('settings'), setListEl = $('settings-list');

  var NOMI = {
    tema: { notte: 'Notte', grafite: 'Grafite', blu: 'Blu notte', nero: 'Nero' },
    luce: { vivace: 'Vivace', tenue: 'Tenue', spenta: 'Spenta' },
    ricerca: { duckduckgo: 'DuckDuckGo', google: 'Google', bing: 'Bing', ecosia: 'Ecosia' }
  };
  var serviceState = DEMO ? 'Anteprima sul computer' : 'Controllo…';

  function settingsModel() {
    var nasc = (prefs.nascoste || []).length;
    return [
      { group: 'Home' },
      // l'avvio automatico: quando accendi il TV (ovunque fossi) torna la home; se non lo vuoi, No
      { label: 'Riapri la home all\'accensione', bool: 'apriHomeAllAccensione' },
      { label: 'Tema', cycle: 'tema', values: ['notte', 'grafite', 'blu', 'nero'] },
      { label: 'Luce dell\'app selezionata', cycle: 'luce', values: ['vivace', 'tenue', 'spenta'] },
      { label: 'Raggruppa le app per tipo', bool: 'categorie' },
      { label: 'Il tuo nome nel saluto', text: 'nome', title: 'Il tuo nome', placeholder: 'Per esempio Anna' },
      { label: 'App nascoste', value: nasc ? nasc + ' (OK per mostrarle)' : 'Nessuna', action: nasc ? mostraNascoste : null },
      { label: 'Ripristina i preferiti', value: '', action: ripristinaPreferiti },
      { label: 'Decorazioni delle feste', bool: 'decorazioni', on: 'Accese', off: 'Spente' }, // spente: la home e' leggera come senza
      { label: 'Continua a guardare', value: Math.max(vistiTotale, visti.length) ? Math.max(vistiTotale, visti.length) + ' video (OK per svuotare)' : 'Vuoto',
        action: Math.max(vistiTotale, visti.length) ? svuotaContinua : null },
      { group: 'Il mio sito' },
      { label: 'Nome', text: 'nomeSito', title: 'Nome del sito', placeholder: 'Il mio sito' },
      { label: 'Link', text: 'url', title: 'Link del sito', placeholder: 'https://…', url: true },
      { label: 'Blocco pubblicità', bool: 'bloccoPubblicita', on: 'Attivo', off: 'Spento' },
      // spento di base: lo accende chi vuole (alcuni siti lo vietano nelle loro condizioni d'uso)
      { label: 'Blocco avanzato', bool: 'bloccoAvanzato', on: 'Acceso', off: 'Spento' },
      { label: 'Liste di filtri (EasyList)', value: statoListe(), action: aggiornaListe },
      { label: 'Schermo intero automatico', bool: 'schermoInteroAutomatico' },
      { group: 'Browser' },
      { label: 'Motore di ricerca', cycle: 'ricerca', values: ['duckduckgo', 'google', 'bing', 'ecosia'] },
      { label: 'Cancella la cronologia', value: '', action: cancellaCronologia },
      { group: 'Telefono' },
      { label: 'Collega un telefono', value: telStato.attivo === false ? 'Non disponibile' : 'Telecomando e tastiera', action: apriAbbina },
      { label: 'Telefoni collegati', value: telStato.collegati ? telStato.collegati + ' (OK per scollegarli)' : 'Nessuno',
        action: telStato.collegati ? scollegaTelefoni : null },
      { label: 'Tasti del TV dal telefono', value: TASTI_STATO[telStato.tasti] || TASTI_STATO.mai,
        action: telStato.tasti === 'ok' ? null : chiediPermessoTasti },
      { group: 'Questo TV' }
    ].concat(righeQuestoTv(), [{ label: 'Versione di Home TV', info: VERSIONE }]).filter(function (x) { return !!x; });
  }

  // "Questo TV": chi e' il TV e cosa sa fare, dal profilo del TV (profilo.js); OK su una voce dice cosa fare
  var profiloTv = null;
  function righeQuestoTv() {
    if (DEMO) return [{ label: 'Televisore', info: 'Anteprima sul computer' }];
    var p = profiloTv;
    if (!p) return [{ label: 'Televisore', info: serviceState }];
    var righe = [
      { label: 'Modello', info: (p.modello || 'Non letto') + (p.anno ? ' (' + p.anno + ')' : '') },
      { label: 'Sistema', info: (p.tizen ? 'Tizen ' + p.tizen : 'Tizen') + (p.chromium ? ' · motore web ' + p.chromium : '') },
      { label: 'TizenBrew', info: p.tizenbrew || 'Versione non letta' },
      { label: 'Schermo', info: p.risoluzione || (window.innerWidth + 'x' + window.innerHeight) }
    ];
    (p.diagnosi || []).forEach(function (d) {
      if (d.id === 'tizen') return; // gia' in "Sistema"
      righe.push({ label: d.nome, value: (d.stato === 'manca' ? '✕ ' : d.stato === 'ok' ? '' : '? ') + d.testo,
        action: function () { UI.openSheet({ title: d.nome, subtitle: d.testo + (d.fare ? '. ' + d.fare : ''), items: [{ label: 'OK' }] }); return 'keep'; } });
    });
    return righe;
  }

  function valueOf(s) {
    if (s.cycle) return NOMI[s.cycle][opt(s.cycle)] || opt(s.cycle);
    if (s.bool) return opt(s.bool) ? (s.on || 'Sì') : (s.off || 'No');
    if (s.text) {
      var v = opt(s.text);
      if (s.url) return UI.validUrl(v) ? UI.hostOf(v) : 'Non impostato';
      return v || 'Nessuno';
    }
    if (s.info) return s.info;
    return s.value || '';
  }

  function focusable(s) { return !s.group && !s.info; }

  function drawSettings() {
    setItems = settingsModel();
    if (!focusable(setItems[setSel] || {})) setSel = 1;
    var html = '';
    for (var i = 0; i < setItems.length; i++) {
      var s = setItems[i];
      if (s.group) { html += '<div class="set-group">' + UI.esc(s.group) + '</div>'; continue; }
      // data-scrive: col trackpad il telefono apre subito la tastiera (la riga apre la finestra per scrivere)
      html += '<div class="set-row' + (s.info ? ' info' : '') + (i === setSel ? ' f' : '') + '" data-i="' + i + '"' +
        (s.text ? ' data-scrive="' + UI.esc(s.title || s.label) + '"' : '') + '>' +
        UI.esc(s.label) + '<em>' + UI.esc(valueOf(s)) + '</em></div>';
    }
    setListEl.innerHTML = html;
    // tiene la riga scelta a meta' schermo
    var el = setListEl.querySelector('.set-row.f');
    var r = UI.rem();
    var y = el ? el.offsetTop : 0;
    UI.setTransform(setListEl, 'translate3d(0,' + Math.min(9.6 * r, 50 * r - y) + 'px,0)');
  }

  function settingsKeys(a) {
    if (a === 'up' || a === 'down') {
      var d = a === 'up' ? -1 : 1, n = setSel + d;
      while (n >= 0 && n < setItems.length && !focusable(setItems[n])) n += d;
      if (n >= 0 && n < setItems.length) { setSel = n; drawSettings(); }
    } else if (a === 'ok') activateSetting(setItems[setSel], 1);
    else if (a === 'left' || a === 'right') {
      var s = setItems[setSel];
      if (s && s.cycle) activateSetting(s, a === 'left' ? -1 : 1);
      else if (s && s.bool) activateSetting(s, 1);
    } else if (a === 'back' || a === 'blue') closeSettings();
  }

  function activateSetting(s, dir) {
    if (!s || !focusable(s)) return;
    if (s.cycle) {
      var i = s.values.indexOf(opt(s.cycle));
      prefs[s.cycle] = s.values[(i + dir + s.values.length) % s.values.length];
      applyPrefs();
    } else if (s.bool) {
      prefs[s.bool] = !opt(s.bool);
      applyPrefs();
    } else if (s.text) {
      UI.openEditor({
        title: s.title, value: opt(s.text) || '', placeholder: s.placeholder,
        onSave: function (v) {
          if (s.url && v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
          if (s.url && v && !UI.validUrl(v)) { UI.toast('Questo non sembra un indirizzo valido'); return; }
          prefs[s.text] = v;
          applyPrefs();
          UI.toast('Salvato');
        }
      });
    } else if (s.action) s.action();
    drawSettings();
  }

  function openSettings() {
    settingsOpen = true;
    setSel = 1;
    drawSettings();
    settingsEl.className = 'open';
    UI.pushKeys(settingsKeys);
    checkService();
    checkTelefono();
    checkAdblock();
  }

  function closeSettings() {
    settingsOpen = false;
    settingsEl.className = '';
    UI.popKeys(settingsKeys);
  }

  // il titolo grande della scheda scelta, rifatto subito (per esempio dopo averla rinominata)
  function rifaiTitolo() { heroKey = ''; showHero(true); }
  // il tuo sito (item senza sid) o uno dei siti aggiunti col "+"
  function sitoAggiunto(item) {
    var s = altriSiti();
    for (var i = 0; i < s.length; i++) if (item && s[i].id === item.sid) return s[i];
    return null;
  }
  function editLink(item) {
    var s = sitoAggiunto(item);
    UI.openEditor({
      title: 'Link del sito', value: (s ? s.url : opt('url')) || '', placeholder: 'https://…',
      onSave: function (v) {
        if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
        if (v && !UI.validUrl(v)) { UI.toast('Questo non sembra un indirizzo valido'); return; }
        if (s) s.url = v; else prefs.url = v;
        applyPrefs();
        UI.toast(v ? 'Link salvato' : 'Link tolto');
      }
    });
  }
  function editNomeSito(item) {
    var s = sitoAggiunto(item);
    UI.openEditor({
      title: 'Nome del sito', value: (s ? s.nome : opt('nomeSito')) || '', placeholder: 'Il mio sito',
      onSave: function (v) {
        if (s) s.nome = v || UI.hostOf(s.url); else prefs.nomeSito = v || undefined;
        applyPrefs();
        rifaiTitolo();
        UI.toast('Nome salvato');
      }
    });
  }
  // un sito nuovo come app: un riquadro in piu' uguale al tuo sito, col blocco della pubblicita' scelto
  function creaSito(nome, url, blocco) {
    var s = { id: 's' + Date.now().toString(36), nome: nome || UI.hostOf(url), url: url, blocco: blocco === 'completo' ? 'completo' : 'normale' };
    prefs.siti = altriSiti().concat([s]);
    if (prefs.preferiti) prefs.preferiti = favKeysNow().concat(['sito:' + s.id]);
    applyPrefs();
    UI.toast(s.nome + ' aggiunto alla home (blocco ' + s.blocco + ')');
  }
  // quanto bloccare su quel sito: completo come il tuo sito (anche i link verso altri siti, e dalle pagine esterne si
  // torna indietro) o normale come il browser (via la pubblicita', tutti i link funzionano)
  function scegliBlocco(nome, attuale, fatto) {
    UI.openSheet({
      title: 'Blocco della pubblicit\u00e0', subtitle: nome + '. Si cambia quando vuoi: OK tenuto premuto sul riquadro.',
      items: [
        { label: 'Normale (come il browser)', value: attuale === 'normale' ? 'scelto' : 'via la pubblicit\u00e0',
          action: function () { fatto('normale'); } },
        { label: 'Completo (come il tuo sito)', value: attuale === 'completo' ? 'scelto' : 'anche i link',
          action: function () { fatto('completo'); } },
        // (un menu nuovo si apre dopo che questo si e' chiuso)
        { label: 'Cosa cambia?', action: function () { setTimeout(function () {
          UI.openSheet({ title: 'Normale o completo?', subtitle: 'Normale, come nel browser: la pubblicit\u00e0 sparisce e tutti i link ' +
            'funzionano (va bene per quasi tutti i siti). Completo, come il tuo sito: in pi\u00f9 ogni link ' +
            'verso un altro sito viene bloccato e dalle pagine esterne si torna indietro da soli (per i siti pieni di pubblicit\u00e0 ' +
            'che aprono altre pagine).', items: [{ label: 'OK', action: function () { setTimeout(function () { scegliBlocco(nome, attuale, fatto); }, 120); } }] });
        }, 120); } }
      ]
    });
  }
  function cambiaBlocco(item) {
    var s = sitoAggiunto(item);
    if (!s) return;
    scegliBlocco(item.name, bloccoDi(s), function (b) {
      s.blocco = b;
      applyPrefs();
      rifaiTitolo();
      UI.toast('Blocco ' + b + ' su ' + item.name);
    });
  }
  function aggiungiSito() {
    UI.openEditor({
      title: 'Link del sito', placeholder: 'esempio: raiplay.it', hint: 'Scrivi con la tastiera del TV o dal telefono. OK per andare avanti, Indietro per annullare.',
      onSave: function (v) {
        if (!v) return;
        if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
        if (!UI.validUrl(v)) { UI.toast('Questo non sembra un indirizzo valido'); return; }
        var nome = UI.hostOf(v).split('.')[0];
        nome = nome.charAt(0).toUpperCase() + nome.slice(1);
        setTimeout(function () {
          UI.openEditor({ title: 'Nome del riquadro', value: nome, onSave: function (n) {
            setTimeout(function () { scegliBlocco(n || nome, '', function (b) { creaSito(n || nome, v, b); }); }, 120);
          } });
        }, 120);
      }
    });
  }
  function togliSito(item) {
    UI.openSheet({
      title: 'Togliere ' + item.name + '?', subtitle: 'Il riquadro sparisce dalla home (puoi rimetterlo col +).',
      items: [
        { label: 'Togli', action: function () {
          prefs.siti = altriSiti().filter(function (s) { return s.id !== item.sid; });
          if (prefs.preferiti) prefs.preferiti = prefs.preferiti.filter(function (k) { return k !== item.key; });
          applyPrefs();
          UI.toast(item.name + ' tolto dalla home');
        } },
        { label: 'Annulla' }
      ]
    });
  }
  function rinominaApp(item) {
    UI.openEditor({
      title: 'Nome di ' + item.nomeVero, value: item.name, placeholder: item.nomeVero,
      hint: 'Lascia vuoto per tornare al nome dell\'app. OK o Fatto per salvare, Indietro per annullare.',
      onSave: function (v) {
        var nomi = prefs.nomiApp && typeof prefs.nomiApp === 'object' ? prefs.nomiApp : {};
        if (v && v !== item.nomeVero) nomi[item.id] = v; else delete nomi[item.id];
        prefs.nomiApp = nomi;
        applyPrefs();
        rifaiTitolo();
        UI.toast(v && v !== item.nomeVero ? 'Rinominata' : 'Torna il nome dell\'app');
      }
    });
  }
  // il "+": cosa si puo' aggiungere alla home
  function menuAggiungi() {
    var voci = [{ label: 'Un sito come app', action: function () { setTimeout(aggiungiSito, 120); } },
      { label: 'Un preferito del browser', action: function () { setTimeout(daPreferitoBrowser, 120); } },
      { label: 'Un\'app del TV nei preferiti', action: function () { setTimeout(appNeiPreferiti, 120); } }];
    if ((prefs.nascoste || []).length) voci.push({ label: 'Rimetti le app nascoste (' + prefs.nascoste.length + ')', action: mostraNascoste });
    UI.openSheet({ title: 'Aggiungi alla home', subtitle: 'Un sito diventa un riquadro come il tuo sito', items: voci });
  }
  function daPreferitoBrowser() {
    function mostra(lista) {
      lista = (lista || []).filter(function (p) { return p && UI.validUrl(p.url); });
      if (!lista.length) { UI.toast('Nel browser non ci sono preferiti: aggiungine dal browser, o scegli "Un sito come app"', 4500); return; }
      UI.openSheet({ title: 'Quale preferito?', subtitle: 'Diventa un riquadro nella home',
        items: lista.slice(0, 40).map(function (p) {
          return { label: p.nome || UI.hostOf(p.url), value: UI.hostOf(p.url), action: function () {
            setTimeout(function () { scegliBlocco(p.nome || UI.hostOf(p.url), '', function (b) { creaSito(p.nome, p.url, b); }); }, 120);
          } };
        }) });
    }
    if (DEMO) { mostra(UI.load('tvb-preferiti', null) || UI.preferitiIniziali(cfg)); return; }
    // gli stessi che mostra il browser sul TV (mai aperto: quelli di partenza piu' quelli aggiunti dai siti)
    UI.service('/api/browser').then(function (j) { mostra(UI.preferitiBrowser(cfg, j)); },
      function () { mostra(UI.preferitiIniziali(cfg)); });
  }
  function appNeiPreferiti() {
    if (!DEMO && !apps) { UI.toast('App del TV non ancora lette: riprova tra poco'); return; }
    var fav = favKeysNow(), lista = appVisibili().map(appItem).filter(function (it) { return fav.indexOf(it.key) === -1; });
    if (!lista.length) { UI.toast('Tutte le app sono gi\u00e0 nei preferiti'); return; }
    UI.openSheet({ title: 'Quale app?', subtitle: 'Va nei preferiti, in alto',
      items: lista.slice(0, 60).map(function (it) { return { label: it.name, action: function () { toggleFav(it); } }; }) });
  }

  function mostraNascoste() {
    prefs.nascoste = [];
    applyPrefs();
    UI.toast('Tutte le app sono di nuovo visibili');
  }
  function ripristinaPreferiti() {
    UI.openSheet({
      title: 'Ripristinare i preferiti?', subtitle: 'Tornano le app scelte all\'inizio, nell\'ordine iniziale.',
      items: [
        { label: 'Ripristina', action: function () { delete prefs.preferiti; applyPrefs(); UI.toast('Preferiti ripristinati'); } },
        { label: 'Annulla' }
      ]
    });
  }
  function cancellaCronologia() {
    UI.openSheet({
      title: 'Cancellare la cronologia?', subtitle: 'I siti visitati spariscono dal browser. I preferiti restano.',
      items: [
        { label: 'Cancella', action: function () {
          UI.save('tvb-cronologia', []);
          UI.service('/api/browser', { svuotaCronologia: true }).then(function () {
            UI.toast('Cronologia cancellata');
          }, function () { UI.toast(DEMO ? 'Cronologia cancellata' : 'Cronologia del TV non raggiungibile, riprova'); });
        } },
        { label: 'Annulla' }
      ]
    });
  }

  // liste di filtri della comunita' (le scarica il servizio del TV, ogni giorno)
  var adbStato = null;
  var MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function quandoBreve(t) {
    var d = new Date(t), oggi = new Date(), m = d.getMinutes();
    var ora = d.getHours() + ':' + (m < 10 ? '0' : '') + m;
    if (d.toDateString() === oggi.toDateString()) return 'oggi ' + ora;
    if (d.toDateString() === new Date(oggi.getTime() - 86400000).toDateString()) return 'ieri ' + ora;
    return d.getDate() + ' ' + MESI_BREVI[d.getMonth()];
  }
  function statoListe() {
    if (DEMO) return 'EasyList, Italia';
    var s = adbStato;
    if (!s) return 'Controllo…';
    if (s.stato === 'scarico') return 'Le scarico adesso…';
    if (!s.quando) return s.stato === 'errore' ? 'Non scaricate (OK per riprovare)' : 'Non ancora scaricate';
    var n = s.conta && s.conta.usate ? ' · ' + Math.round(s.conta.usate / 1000) + ' mila regole' : '';
    return (s.stato === 'aggiorno' ? 'Aggiorno… ' : '') + 'Aggiornate ' + quandoBreve(s.quando) + n;
  }
  function checkAdblock() {
    if (DEMO) return;
    UI.service('/api/adblock/stato').then(function (s) {
      adbStato = s;
      if (settingsOpen) drawSettings();
    }, function () {});
  }
  function aggiornaListe() {
    if (DEMO) { UI.toast('Sul TV qui si scaricano di nuovo le liste di filtri', 3500); return; }
    UI.service('/api/adblock/aggiorna', {}).then(function (s) {
      adbStato = s;
      if (settingsOpen) drawSettings();
      UI.toast('Scarico le liste di filtri aggiornate…', 3000);
      setTimeout(checkAdblock, 6000);
      setTimeout(checkAdblock, 20000);
    }, function () { UI.toast('Il servizio del TV non risponde: riapri TizenBrew', 4000); });
  }

  function checkService() {
    if (DEMO) return;
    UI.service('/api/status').then(function (s) {
      serviceState = 'Collegate (' + s.apps + ' app)';
      if (settingsOpen) drawSettings();
    }, function (e) {
      serviceState = e && e.message === NON_AUTORIZZATA ? MSG_NOME_GITHUB : 'Non collegate: riapri TizenBrew';
      if (settingsOpen) drawSettings();
    });
    UI.profiloTv().then(function (p) { profiloTv = p; if (settingsOpen) drawSettings(); });
  }

  // Autodiagnosi all'avvio: se sul TV manca qualcosa di importante lo si dice una volta (con cosa fare); il dettaglio
  // sta in Impostazioni, Questo TV
  var IMPORTANTI = { servizio: 1, casa: 1, app: 1, salvataggio: 1, telefono: 1, tizen: 1 };
  function autodiagnosi(volta) {
    if (DEMO) return;
    volta = volta || 1;
    UI.profiloTv().then(function (p) {
      profiloTv = p;
      var d = (p.diagnosi || []).filter(function (x) { return x.stato === 'manca' && IMPORTANTI[x.id] === 1; })[0];
      // all'accensione il servizio del TV puo' partire dopo la home: prima di dirlo si riprova (4 volte, ogni 5 s)
      // (non quando riprovare non serve: il motore web del TV 2017, la pagina non riconosciuta)
      if (d && d.id === 'servizio' && !d.fisso && volta < 4) { setTimeout(function () { autodiagnosi(volta + 1); }, 5000); return; }
      // una volta al giorno per ogni cosa (alcune non si possono risolvere: non si ripetono a ogni avvio di TizenBrew)
      var oggi = new Date().toDateString(), gia = false;
      if (!d) return;
      try { gia = localStorage.getItem('tvh-diagnosi-' + d.id) === oggi; } catch (e) {}
      if (gia) return;
      try { localStorage.setItem('tvh-diagnosi-' + d.id, oggi); } catch (e) {}
      UI.toast(d.nome + ': ' + d.testo + (d.fare ? '. ' + d.fare : '') + ' (Impostazioni, Questo TV)', 12000, true);
    });
  }

  /* ------------------------------------------------------------ salvataggio */

  var syncTimer = null;
  function salvaPrefs() {
    prefs.rev = Date.now();
    UI.save('tvh-prefs', prefs);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncService, 400);
  }

  // Il servizio conserva le scelte (per i siti, che le leggono da li', e come copia di riserva).
  function syncService() {
    if (DEMO || !ripristinoFatto) return; // si sincronizza appena finito il ripristino
    var out = {
      url: opt('url'), nomeSito: opt('nomeSito'),
      siti: altriSiti(), // gli altri tuoi siti: nei siti valgono come il tuo (main.js e liste di filtri)
      bloccoPubblicita: !!opt('bloccoPubblicita'), bloccoAvanzato: !!opt('bloccoAvanzato'), schermoInteroAutomatico: !!opt('schermoInteroAutomatico'),
      apriHomeAllAccensione: !!opt('apriHomeAllAccensione'),
      dominiConsentiti: cfg.dominiConsentiti || [], paroleBloccate: cfg.paroleBloccate || [],
      selettoriExtra: cfg.selettoriExtra || [],
      // liste di filtri scelte in config.json (vuoto = quelle predefinite: EasyList, EasyList Italy; col blocco avanzato anche anti-adblock)
      listeFiltri: Array.isArray(cfg.listeFiltri) ? cfg.listeFiltri : [],
      home: prefs
    };
    UI.service('/api/prefs', out)['catch'](function () {});
    UI.service('/api/settings', { apriAllAccensione: !!opt('apriHomeAllAccensione') })['catch'](function () {});
  }

  function applyPrefs() {
    document.documentElement.setAttribute('data-tema', opt('tema'));
    festa(); // Halloween
    salvaPrefs();
    lastWash = '';
    render(true);
    updateGreeting();
    if (settingsOpen) drawSettings();
  }

  /* ============================================================ telefono */

  var telStato = { collegati: 0 };
  var TASTI_STATO = {
    ok: 'Attivi, anche in Netflix', attesa: 'Scegli Consenti sul TV', mai: 'OK per attivarli',
    negato: 'Non consentiti: OK per chiedere di nuovo', assente: 'Non disponibili su questo TV'
  };

  // volume, spegnimento e tasti dentro le altre app: il TV chiede il permesso una volta
  function chiediPermessoTasti() {
    if (DEMO) { UI.toast('Sul TV comparira\' una richiesta: scegli Consenti', 4000); return; }
    UI.service('/api/telefono/permesso', {}).then(function (t) {
      telStato = t;
      if (settingsOpen) drawSettings();
      UI.toast('Sul TV compare una richiesta per "Home TV": scegli Consenti', 5000);
      setTimeout(function () { checkTelefono(); }, 8000);
      setTimeout(function () { checkTelefono(); }, 20000);
    }, function () { UI.toast('Il servizio del TV non risponde: riapri TizenBrew', 4000); });
  }
  var pairEl = $('pair'), pairKeys = null, pairTimer = null, pairRinnovo = null, qrPronto = null;

  function checkTelefono(dopo) {
    if (DEMO) { telStato = { attivo: true, collegati: 0 }; if (dopo) dopo(); return; }
    UI.service('/api/telefono').then(function (t) {
      telStato = t || telStato;
      if (settingsOpen) drawSettings();
      if (dopo) dopo();
    }, function () {});
  }

  // la libreria del codice QR si carica solo quando serve
  function caricaQr() {
    if (qrPronto) return qrPronto;
    qrPronto = new Promise(function (ok, no) {
      if (window.qrcode) { ok(); return; }
      var sc = document.createElement('script');
      sc.src = 'qrcode.js';
      sc.onload = function () { if (window.qrcode) ok(); else no(); };
      sc.onerror = function () { qrPronto = null; no(); };
      document.head.appendChild(sc);
    });
    return qrPronto;
  }

  function disegnaQr(box, testo) {
    caricaQr().then(function () {
      var qr = window.qrcode(0, 'M');
      qr.addData(testo);
      qr.make();
      var n = qr.getModuleCount(), path = '';
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) if (qr.isDark(r, c)) path += 'M' + c + ' ' + r + 'h1v1h-1z';
      }
      box.innerHTML = '<svg viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges"><path fill="#0b0c10" d="' + path + '"/></svg>';
    }, function () {
      box.innerHTML = '<div class="vuoto">Codice QR non disponibile: scrivi l\'indirizzo qui accanto in Safari.</div>';
    });
  }

  function chiudiAbbina() {
    clearInterval(pairTimer); clearInterval(pairRinnovo);
    pairTimer = pairRinnovo = null;
    pairEl.className = '';
    pairEl.innerHTML = '';
    if (pairKeys) { UI.popKeys(pairKeys); pairKeys = null; }
  }

  function mostraAbbina(t) {
    var ip = (t.indirizzi && t.indirizzi[0]) || '';
    var indirizzo = ip ? 'http://' + ip + ':' + t.porta : '';
    pairEl.innerHTML = '<div class="pair-card">' +
      '<div class="pair-qr" id="pair-qr"></div>' +
      '<div class="pair-text"><h2>Collega il telefono</h2><ol>' +
      '<li>Inquadra il QR con la <b>fotocamera</b> dell\'iPhone e apri il link (il telefono deve essere sulla <b>stessa Wi-Fi</b>).</li>' +
      '<li>Quando il TV chiede di consentire <b>Home TV</b>, scegli <b>Consenti</b>.</li>' +
      '<li>In Safari: <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>.</li></ol></div>' +
      '<div class="pair-addr">Oppure scrivi in Safari<strong>' + UI.esc(indirizzo ? indirizzo.replace('http://', '') : 'indirizzo non trovato') + '</strong></div>' +
      '<div class="pair-pin">Codice, se il telefono lo chiede<strong>' + UI.esc(t.codice || '') + '</strong></div>' +
      '<div class="pair-foot">Il codice vale 10 minuti, per un telefono. Indietro per chiudere.</div></div>';
    if (indirizzo) disegnaQr($('pair-qr'), indirizzo + '/?pin=' + t.codice);
    else $('pair-qr').innerHTML = '<div class="vuoto">Il TV non sembra collegato alla rete di casa.</div>';
  }

  // Anteprima (sul computer, senza il TV): il telefono qui non si puo' collegare. Niente QR finto da
  // inquadrare (porterebbe a un indirizzo che non esiste): si spiega dove si collega davvero.
  function mostraAnteprimaAbbina() {
    var nota = typeof window.hometvNotaTelefono === 'string' ? window.hometvNotaTelefono : '';
    pairEl.innerHTML = '<div class="pair-card">' +
      '<div class="pair-qr"><div class="vuoto">Nell\'anteprima il codice QR non c\'&egrave;: qui non c\'&egrave; il TV a cui collegarsi.</div></div>' +
      '<div class="pair-text"><h2>Collega il telefono</h2>' +
      '<p>Sul TV qui compaiono il codice QR e un codice di 6 cifre: il telefono li usa per collegarsi al TV sulla Wi-Fi di casa.</p>' +
      (nota ? '<p>' + UI.esc(nota) + '</p>' : '') + '</div>' +
      '<div class="pair-foot">Indietro per chiudere.</div></div>';
  }

  function apriAbbina() {
    if (DEMO) {
      chiudiAbbina();
      pairEl.className = 'open';
      pairKeys = function (a) { if (a === 'back' || a === 'ok' || a === 'blue') chiudiAbbina(); };
      UI.pushKeys(pairKeys);
      mostraAnteprimaAbbina();
      return 'keep';
    }
    UI.service('/api/telefono/codice', {}).then(function (t) {
      if (!t.attivo) {
        UI.toast('Il telecomando sul telefono non e\' disponibile su questo TV' + (t.errore ? ' (' + t.errore + ')' : ''), 5000);
        return;
      }
      chiudiAbbina();
      var prima = t.collegati || 0, primaAbb = t.abbinamenti || 0;
      pairEl.className = 'open';
      pairKeys = function (a) { if (a === 'back' || a === 'ok' || a === 'blue') chiudiAbbina(); };
      UI.pushKeys(pairKeys);
      mostraAbbina(t);
      // appena il telefono si collega, la finestra si chiude da sola
      pairTimer = setInterval(function () {
        UI.service('/api/telefono').then(function (s) {
          if ((s.collegati || 0) > prima || (s.abbinamenti || 0) > primaAbb) {
            telStato = s;
            chiudiAbbina();
            if (settingsOpen) drawSettings();
            UI.toast('Telefono collegato. Se il TV chiede di consentire Home TV, scegli Consenti', 6000);
            setTimeout(function () { checkTelefono(); }, 15000);
          }
        }, function () {});
      }, 2000);
      // codice nuovo prima che scada
      pairRinnovo = setInterval(function () {
        UI.service('/api/telefono/codice', {}).then(mostraAbbina, function () {});
      }, 9 * 60 * 1000);
    }, function () { UI.toast('Il servizio del TV non risponde: riapri TizenBrew', 4000); });
  }

  function scollegaTelefoni() {
    UI.openSheet({
      title: 'Scollegare i telefoni?', subtitle: 'Per usarli di nuovo andranno ricollegati con un codice',
      items: [
        { label: 'Scollega tutti', action: function () {
          UI.service('/api/telefono/scollega', {}).then(function (t) {
            telStato = t;
            if (settingsOpen) drawSettings();
            UI.toast('Telefoni scollegati');
          }, function () { UI.toast('Non riesco, riprova'); });
        } },
        { label: 'Annulla', action: function () {} }
      ]
    });
  }

  /* ============================================================ orologio e saluto */

  var greetEl = $('greeting'), dateEl = $('date'), timeEl = $('time');
  var lastSaluto = '';
  function updateGreeting() {
    var n = opt('nome');
    greetEl.textContent = (lastSaluto || UI.saluto()) + (n ? ', ' + n : '');
  }
  UI.startClock(function (ora, data, saluto) {
    timeEl.textContent = ora;
    dateEl.textContent = data;
    lastSaluto = saluto;
    updateGreeting();
  });

  /* ============================================================ tasti e mouse */

  UI.onKeys(function (a) {
    if (!cur) return;
    if (moving) {
      if (a === 'left') moveBy(-1);
      else if (a === 'right') moveBy(1);
      else if (a === 'ok' || a === 'back' || a === 'hold') endMove();
      return;
    }
    if (a === 'left' || a === 'right' || a === 'up' || a === 'down') move(a);
    else if (a === 'ok') open(cur.item);
    else if (a === 'hold' || a === 'yellow') options(cur.item);
    else if (a === 'back') {
      if (cur.area === 'top') focus(0, 0);
      else if (cur.r > 0 || cur.i > 0) focus(0, 0);
    } else if (a === 'blue') openSettings();
  });

  function tileFromEvent(ev) {
    var t = ev.target;
    while (t && t !== document.body && !(t.classList && t.classList.contains('tile'))) t = t.parentNode;
    if (!t || t === document.body) return null;
    var row = t.parentNode.parentNode;
    var r = +row.getAttribute('data-r');
    var list = t.parentNode.children;
    for (var i = 0; i < list.length; i++) if (list[i] === t) return [r, i];
    return null;
  }
  rowsEl.addEventListener('click', function (ev) {
    if (moving || settingsOpen || UI.sheetOpen() || UI.editorOpen()) return;
    var p = tileFromEvent(ev);
    if (!p) return;
    var gia = cur && cur.area === 'rows' && cur.r === p[0] && cur.i === p[1];
    if (!gia) focus(p[0], p[1]);
    // col puntatore del telefono un clic apre subito (col mouse il primo clic seleziona)
    if (gia || (ev.hometvPuntatore && cur && cur.area === 'rows' && cur.r === p[0] && cur.i === p[1])) open(cur.item);
  });
  // trackpad: due dita in orizzontale sopra un'altra fila fanno scorrere quella (prima si va li')
  rowsEl.addEventListener('hometvscorri', function (ev) {
    var d = ev.detail || {};
    if (moving || settingsOpen || UI.sheetOpen() || UI.editorOpen() || Math.abs(d.dx || 0) <= Math.abs(d.dy || 0)) return;
    var p = tileFromEvent(ev);
    if (p && !(cur && cur.area === 'rows' && cur.r === p[0])) focus(p[0], p[1]);
  });
  rowsEl.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    if (moving || settingsOpen || UI.sheetOpen() || UI.editorOpen()) return;
    var p = tileFromEvent(ev);
    if (!p) return;
    focus(p[0], p[1]);
    options(cur.item);
  });
  gearEl.addEventListener('click', function () {
    if (moving || settingsOpen || UI.sheetOpen() || UI.editorOpen()) return;
    focusTop();
    openSettings();
  });
  setListEl.addEventListener('click', function (ev) {
    var t = ev.target;
    while (t && t !== setListEl && !(t.classList && t.classList.contains('set-row'))) t = t.parentNode;
    if (!t || t === setListEl) return;
    var i = +t.getAttribute('data-i');
    if (!focusable(setItems[i])) return;
    if (setSel === i || ev.hometvPuntatore) { setSel = i; activateSetting(setItems[i], 1); }
    else { setSel = i; drawSettings(); }
  });

  /* ============================================================ icone */

  var saveColorsTimer = null;
  rowsEl.addEventListener('load', function (ev) {
    var img = ev.target;
    if (!img || img.tagName !== 'IMG') return;
    var id = img.getAttribute('data-id');
    if (!id || colors[id]) return;
    var c = extractColors(img);
    if (!c) return;
    colors[id] = c;
    clearTimeout(saveColorsTimer);
    saveColorsTimer = setTimeout(function () { UI.save('tvh-colors', colors); }, 1500);
    var item = { id: id, kind: 'app', name: '' };
    var imgs = rowsEl.querySelectorAll('img[data-id="' + id.replace(/"/g, '') + '"]');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].parentNode.style.background = cardBg(item);
      if (c.edge) imgs[i].className = 'full';
    }
    if (cur && cur.item.id === id) { lastWash = ''; setAmbient(cur.item); }
  }, true);

  rowsEl.addEventListener('error', function (ev) {
    var img = ev.target;
    if (!img || img.tagName !== 'IMG') return;
    // l'immagine di Continua a guardare: resta la scheda colorata col titolo
    if (img.className === 'cont-foto') { img.parentNode.removeChild(img); return; }
    var card = img.parentNode;
    var tile = card.parentNode.parentNode;
    var key = tile.getAttribute('data-key') || '';
    var name = '';
    for (var r = 0; r < rows.length && !name; r++) {
      for (var i = 0; i < rows[r].items.length; i++) if (rows[r].items[i].key === key) { name = rows[r].items[i].name; break; }
    }
    var label = document.createElement('div');
    label.className = 'label';
    label.textContent = name;
    card.replaceChild(label, img);
  }, true);

  /* ============================================================ caricamento */

  function getConfig() {
    return fetch('config.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (c) {
        cfg = c || {};
        UI.save('tvh-config', cfg);
        adottaGithub();
        heroKey = '';
        render();
        if (cur) showHero(true);
        syncService();
      })['catch'](function () { /* si usa la copia salvata */ });
  }

  var tries = 0, appsTimer = null;
  function getApps() {
    if (DEMO) return;
    clearTimeout(appsTimer);
    appsTimer = null;
    UI.service('/api/apps').then(function (j) {
      tries = 0;
      if (j && j.apps) {
        apps = j.apps;
        UI.save('tvh-apps', apps);
        render();
      }
    }, function (e) {
      tries++;
      if (!apps && cur && cur.area === 'rows' && cur.r === 0) {
        heroSub.textContent = e && e.message === NON_AUTORIZZATA ? MSG_NOME_GITHUB : 'Sto collegando le app del TV…';
        heroKey = '';
      }
      appsTimer = setTimeout(getApps, tries < 20 ? 1500 : 10000);
    });
  }

  // Se la memoria della pagina e' stata cancellata, le scelte si recuperano dal
  // servizio. Il servizio puo' partire qualche secondo dopo la pagina: si riprova.
  var tentativiRipristino = 0;
  function restorePrefs() {
    if (ripristinoFatto) return;
    UI.service('/api/prefs').then(function (p) {
      var copia = p && p.home && typeof p.home === 'object' && !Array.isArray(p.home) ? p.home : null;
      if (copia && !vuoto(copia) && (vuotoAvvio || (copia.rev || 0) > revAvvio)) {
        var locali = prefs;
        prefs = copia;
        if (vuotoAvvio) {
          // memoria cancellata: le scelte fatte in questi primi secondi restano, il resto torna dalla copia
          for (var k in locali) {
            if (Object.prototype.hasOwnProperty.call(locali, k) && k !== 'ghVisto' && k !== 'rev') prefs[k] = locali[k];
          }
        }
        adottaGithub();
      }
      ripristinoFatto = true;
      applyPrefs();
    }, function (e) {
      // pagina non riconosciuta dal servizio: niente copia da leggere. Se no si riprova sempre (prima ogni 2 secondi,
      // poi ogni 15): mai scrivere sul servizio prima di aver letto la sua copia, se no la si cancellerebbe
      if (e && e.message === NON_AUTORIZZATA) { ripristinoFatto = true; syncService(); return; }
      tentativiRipristino++;
      setTimeout(restorePrefs, tentativiRipristino < 60 ? 2000 : 15000);
    });
  }

  // tornando alla home (da Netflix, dal sito...): se dal telefono e' cambiato qualcosa, lo si prende
  function prendiNovita() {
    if (DEMO || !ripristinoFatto) return;
    UI.service('/api/prefs').then(function (p) {
      var copia = p && p.home && typeof p.home === 'object' && !Array.isArray(p.home) ? p.home : null;
      if (copia && (copia.rev || 0) > (prefs.rev || 0)) {
        prefs = copia;
        adottaGithub();
        applyPrefs();
      }
    }, function () {});
  }

  // link del sito arrivato dal telefono
  function nuovoLinkSito(u) {
    if (!UI.validUrl(u)) return;
    UI.closeEditor(); // la finestra "Link" aperta non deve rimettere il link vecchio con OK
    prefs.url = u;
    applyPrefs();
    heroKey = '';
    if (cur) showHero(true);
    UI.toast('Link del sito aggiornato: ' + UI.hostOf(u), 4000);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { getApps(); getConfig(); prendiNovita(); getVisti(); }
  });
  window.addEventListener('resize', function () {
    measure();
    if (cur && cur.area === 'rows') { var c = cur; cur = null; focus(c.r, c.i, true); }
  });

  /* ===== Halloween: da togliere dopo il 2 novembre (qui andranno anche le decorazioni di Natale) =====
   * La scenografia (luna, albero, cimitero, ragnatele, ghirlanda, zucche, pipistrelli, fantasma, foglie: in index.html,
   * nascosta) e il teschio si vedono da subito e fino al 2 novembre compreso, secondo la data del TV; poi spariscono da
   * soli. In Impostazioni > Home si possono spegnere.
   * (?halloween nell'indirizzo le mostra sempre, per provarle) */
  var FESTA_FINE = new Date(2026, 10, 3).getTime(); // il 3 novembre 2026 alle 0 (i mesi partono da 0)
  function festaAttiva() { return /[?&]halloween\b/.test(location.search) || Date.now() < FESTA_FINE; }
  function festaAccese() { return festaAttiva() && opt('decorazioni') !== false; }
  function festa() {
    var el = $('festa'), si = festaAccese();
    if (el) el.hidden = !si;
    document.documentElement.classList.toggle('festa-on', si);
    // spente: via anche il teschio dalle schede (la home torna leggera come senza decorazioni); riaccese: si rimette
    if (!si) {
      var t = document.querySelectorAll('.festa-teschio, .festa-dita');
      for (var i = 0; i < t.length; i++) if (t[i].parentNode) t[i].parentNode.removeChild(t[i]);
    } else if (!document.querySelector('.festa-teschio')) festaTeschio();
    // e la luce dell'app si ridisegna subito (con o senza la tinta della festa)
    if (cur) { lastWash = ''; try { setAmbient(itemInVista()); } catch (e) {} }
  }
  // il teschio va nella terza scheda (o la prima dopo) della prima fila che ha uno sfondo pieno: dietro la scheda la
  // testa, davanti le mani sul bordo. Si rimette ogni volta che le file si ridisegnano
  function festaTeschio() {
    var m = $('festa-teschio'), track = trackEl(0);
    if (!festaAccese() || !m || !m.content || !track) return;
    for (var i = 2; i < track.children.length; i++) {
      var lift = track.children[i].querySelector('.lift'), card = lift && lift.querySelector('.card');
      if (!card || card.classList.contains('add')) continue;
      var pezzi = document.importNode(m.content, true), dita = pezzi.querySelectorAll('.festa-dita');
      lift.insertBefore(pezzi.querySelector('.festa-teschio'), card); // la testa dietro la scheda
      for (var k = 0; k < dita.length; k++) lift.appendChild(dita[k]);  // le dita davanti, sul bordo
      return;
    }
  }
  // la luce dell'app tinta di viola notte (verso la luna) e arancio zucca, piu' buia ai bordi: si disegna nella stessa
  // tela piccola della luce, non costa niente
  function festaLuce(x) {
    if (!festaAccese()) return;
    ellisse(x, 0.78 * LW, 0.18 * LH, 80 / 192 * LW, 52 / 108 * LH, '118,64,196', 0.46);
    ellisse(x, 0.86 * LW, 0.5 * LH, 54 / 192 * LW, 34 / 108 * LH, '255,124,32', 0.36);
  }
  function festaVignetta(x) {
    if (!festaAccese()) return;
    var g = x.createRadialGradient(LW / 2, LH * 0.45, LH * 0.42, LW / 2, LH * 0.45, LW * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(8,4,16,.6)');
    x.fillStyle = g;
    x.fillRect(0, 0, LW, LH);
  }
  /* ===== fine Halloween ===== */

  document.documentElement.setAttribute('data-tema', opt('tema'));
  festa(); // Halloween
  render(true);
  getConfig();
  getApps();
  getVisti();
  restorePrefs();
  UI.ascoltaTelefono('Home', {
    // testo senza una casella aperta: diventa una ricerca nel browser
    testo: function (t, invio) { if (invio) location.href = 'browser.html?q=' + encodeURIComponent(t); },
    link: function (u) { location.href = u; },
    sito: nuovoLinkSito,
    home: function () {
      chiudiAbbina();
      if (settingsOpen) closeSettings();
      if (moving) endMove();
      focus(0, 0);
    }
  });
  if (DEMO) {
    setTimeout(function () {
      UI.toast('Anteprima con app di esempio: frecce e Invio, tasto destro per le opzioni', 6000);
    }, 700);
  }
  // dopo qualche secondo il servizio ha letto il TV (API, TizenBrew, porte): se manca qualcosa di importante lo si dice
  setTimeout(autodiagnosi, 4000);
  // sei nella home: le pagine che apri da qui (il tuo sito, Continua a guardare...) non cambiano le schede del browser
  if (!DEMO) UI.service('/api/browser/scheda', { azione: 'fuori' })['catch'](function () {});
})();
