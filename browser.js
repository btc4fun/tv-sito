/*
 * Home TV - browser.
 * Barra di ricerca, schede (con la galleria, come Safari), preferiti (con aggiunta, spostamento, rinomina) e
 * cronologia di tutti i siti visitati (registrata dal servizio del TV).
 * I siti si aprono con il blocco della pubblicita' e le frecce del telecomando (main.js).
 *
 * Solo JavaScript ES5: il browser del TV e' datato.
 */
(function () {
  'use strict';

  var $ = UI.$;
  var DEMO = UI.DEMO;
  var IN_ANTEPRIMA = DEMO && window.top !== window.self;

  var MOTORI = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q=',
    ecosia: 'https://www.ecosia.org/search?q='
  };
  var MAX_MOSTRATI = 60;
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

  var cfg = UI.load('tvh-config', {});
  var prefs = UI.load('tvh-prefs', {});
  var preferiti = null;   // [{ nome, url }]
  var cronologia = [];    // [{ url, titolo, t }]
  var schede = [];        // [{ id, url, titolo, t }]: le pagine ricordate, l'ultima usata per prima
  var schedaAttiva = '';

  var stage = $('stage'), searchEl = $('search'), input = $('q'), homeBtn = $('homebtn');
  var favsEl = $('favs'), histEl = $('history'), countEl = $('hist-count');
  var tabsEl = $('tabs'), tabsBlocco = $('tabs-blocco'), tabsCount = $('tabs-count');
  var btnSchede = $('btn-schede'), btnNuova = $('btn-nuova'), nSchede = $('n-schede');
  var galEl = $('galleria'), galGriglia = $('g-griglia'), galConta = $('g-conta'), galVista = $('g-vista');

  /* ============================================================ dati */

  function motore() {
    var k = prefs.ricerca;
    if (k && MOTORI[k]) return MOTORI[k];
    if (cfg.browser && cfg.browser.ricerca) return cfg.browser.ricerca;
    return MOTORI.google;
  }

  function iniziali() { return UI.preferitiIniziali(cfg); }

  function carica(primo) {
    var cache = UI.load('tvb-cache', null);
    if (DEMO) {
      preferiti = UI.load('tvb-preferiti', null);
      cronologia = UI.load('tvb-cronologia', []);
      schede = UI.load('tvb-schede', []);
      if (!preferiti) { preferiti = iniziali(); UI.save('tvb-preferiti', preferiti); }
      draw(primo);
      return;
    }
    if (cache) { preferiti = cache.preferiti; cronologia = cache.cronologia || []; schede = cache.schede || []; schedaAttiva = cache.schedaAttiva || ''; }
    if (!preferiti) preferiti = iniziali();
    draw(primo);
    UI.service('/api/browser').then(function (d) {
      cronologia = d.cronologia || [];
      prendiSchede(d);
      // primo avvio: preferiti iniziali piu' quelli aggiunti dai siti nel frattempo (e si salvano)
      var primoAvvio = d.preferiti === null || d.preferiti === undefined;
      preferiti = UI.preferitiBrowser(cfg, d);
      if (primoAvvio) salvaPreferiti();
      salvaCache();
      draw(false);
    }, function (e) {
      UI.toast(e && e.message === 'pagina non autorizzata' ?
        'Il servizio del TV non riconosce questa pagina: in TizenBrew aggiungi il modulo tuonome/tv-sito' :
        'Cronologia del TV non raggiungibile: riapri TizenBrew', 5000);
    });
  }

  function salvaCache() {
    UI.save('tvb-cache', { preferiti: preferiti, cronologia: cronologia.slice(0, MAX_MOSTRATI), schede: schede, schedaAttiva: schedaAttiva });
  }
  // le schede dal servizio (o dalla copia qui, se il servizio non risponde): l'ultima usata per prima
  function prendiSchede(d) {
    if (!d || !Array.isArray(d.schede)) return;
    schede = d.schede.filter(function (s) { return s && s.id && UI.validUrl(s.url); }).sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    schedaAttiva = typeof d.schedaAttiva === 'string' ? d.schedaAttiva : '';
  }
  // apri, chiudi... (sul servizio, che le ricorda anche a TV spento); nell'anteprima solo qui
  function cambiaScheda(corpo) {
    if (DEMO) {
      var l = schede, i, s = null;
      if (corpo.azione === 'apri') {
        for (i = 0; i < l.length; i++) if (l[i].id === corpo.id) s = l[i];
        if (!s) { s = { id: corpo.id, url: corpo.url, titolo: corpo.titolo, t: 0 }; l.unshift(s); }
        s.t = Date.now();
        schedaAttiva = s.id;
      } else if (corpo.azione === 'chiudi') {
        schede = l.filter(function (x) { return x.id !== corpo.id; });
        if (schedaAttiva === corpo.id) schedaAttiva = '';
      }
      else if (corpo.azione === 'chiudiAltre') schede = l.filter(function (x) { return x.id === corpo.id; });
      else if (corpo.azione === 'chiudiTutte') schede = [];
      UI.save('tvb-schede', schede);
      prendiSchede({ schede: schede, schedaAttiva: schedaAttiva });
      return Promise.resolve();
    }
    return UI.service('/api/browser/scheda', corpo).then(function (d) { prendiSchede(d); salvaCache(); }, function () {});
  }

  function salvaPreferiti() {
    if (DEMO) { UI.save('tvb-preferiti', preferiti); return; }
    UI.service('/api/browser', { preferiti: preferiti }).then(function (d) {
      cronologia = d.cronologia || cronologia;
      salvaCache();
    }, function () { UI.toast('Non riesco a salvare sul TV, riprova'); });
  }

  function registraVisita(url, titolo) {
    if (DEMO) {
      var lista = UI.load('tvb-cronologia', []).filter(function (v) { return v.url !== url; });
      lista.unshift({ url: url, titolo: titolo, t: Date.now() });
      UI.save('tvb-cronologia', lista.slice(0, 300));
      return Promise.resolve();
    }
    // la pagina visitata aggiornera' il titolo vero appena si apre
    return UI.service('/api/browser/visita', { url: url, titolo: titolo })['catch'](function () {});
  }

  /* ============================================================ disegno */

  var PALETTE = [
    ['59,76,202', '26,35,102'], ['142,63,184', '61,24,87'], ['15,155,142', '10,71,68'],
    ['217,98,43', '110,38,17'], ['86,96,107', '34,39,45'], ['47,158,90', '18,65,39'],
    ['194,59,78', '86,21,32'], ['43,123,191', '16,54,90']
  ];

  function tabHTML(s) {
    var host = UI.hostOf(s.url);
    var c = PALETTE[UI.hash(host || '') % PALETTE.length];
    return '<div class="tile' + (s.id === schedaAttiva ? ' attiva' : '') + '" data-url="' + UI.esc(s.url) + '"><div class="lift">' +
      '<div class="card"><div class="tab-ico" style="background:rgb(' + c[0] + ')">' + UI.esc((host || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div class="label">' + UI.esc(s.titolo || host) + '<small>' + UI.esc(host) + '</small></div>' +
      '</div><div class="arrows"><i>\u2039</i><i>\u203a</i></div></div></div>';
  }

  // la galleria: una scheda in grande, con l'anteprima della pagina (o, senza, l'icona del sito su un colore suo)
  var IMG_OK = /^https?:\/\/[^\s"'<>()\\]+$/i;
  function cardHTML(s) {
    var host = UI.hostOf(s.url), c = PALETTE[UI.hash(host || '') % PALETTE.length];
    var ico = host ? '<img alt="" src="https://www.google.com/s2/favicons?sz=64&amp;domain=' + UI.esc(host) + '">' : '';
    var img = IMG_OK.test(s.img || '') ? '<div class="g-img" style="background-image:url(&quot;' + UI.esc(s.img) + '&quot;)"></div>' :
      '<div class="g-img" style="background:linear-gradient(140deg, rgb(' + c[0] + ') 0%, rgb(' + c[1] + ') 100%)"><b>' +
      UI.esc((host || '?').charAt(0).toUpperCase()) + '</b>' + ico + '</div>';
    return '<div class="g-card' + (s.id === schedaAttiva ? ' attiva' : '') + '">' + img +
      '<div class="g-testo"><strong>' + UI.esc(s.titolo || host) + '</strong><span>' + ico + UI.esc(host) + '</span></div></div>';
  }
  var NUOVA_HTML = '<div class="g-card g-nuova"><div class="g-img">' +
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M22 10h4v12h12v4H26v12h-4V26H10v-4h12z"/></svg></div>' +
    '<div class="g-testo"><strong>Nuova scheda</strong><span>Cerca o scrivi un indirizzo</span></div></div>';

  function favHTML(p) {
    var host = UI.hostOf(p.url);
    var c = PALETTE[UI.hash(host || p.nome || '') % PALETTE.length];
    var lettera = UI.esc((p.nome || host || '?').charAt(0).toUpperCase());
    return '<div class="tile" data-url="' + UI.esc(p.url) + '"><div class="lift">' +
      '<div class="card" style="background:linear-gradient(140deg, rgb(' + c[0] + ') 0%, rgb(' + c[1] + ') 100%)">' +
      '<div class="fav-ico"><b>' + lettera + '</b>' +
      (host ? '<img alt="" src="https://www.google.com/s2/favicons?sz=128&amp;domain=' + UI.esc(host) + '">' : '') + '</div>' +
      '<div class="label">' + UI.esc(p.nome || host) + '<small>' + UI.esc(host) + '</small></div>' +
      '</div><div class="arrows"><i>‹</i><i>›</i></div></div></div>';
  }

  var ADD_HTML = '<div class="tile" data-add="1"><div class="lift"><div class="card add">' +
    '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M22 10h4v12h12v4H26v12h-4V26H10v-4h12z"/></svg>' +
    '<div class="label" style="color:var(--text-2)">Aggiungi un sito</div></div></div></div>';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function quando(t) {
    if (!t) return '';
    var d = new Date(t), oggi = new Date();
    var hm = d.getHours() + ':' + pad(d.getMinutes());
    var g = function (x) { return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); };
    if (g(d) === g(oggi)) return 'oggi ' + hm;
    var ieri = new Date(oggi.getTime() - 86400000);
    if (g(d) === g(ieri)) return 'ieri ' + hm;
    return d.getDate() + ' ' + MESI[d.getMonth()];
  }

  function histHTML(v, i) {
    var host = UI.hostOf(v.url);
    return '<li class="h-row" data-i="' + i + '"><strong>' + UI.esc(v.titolo || host) +
      '</strong><span>' + UI.esc(host) + '&ensp;&ensp;' + UI.esc(quando(v.t)) + '</span></li>';
  }

  function draw(primaVolta) {
    var html = '';
    for (var s = 0; s < schede.length; s++) html += tabHTML(schede[s]);
    tabsEl.innerHTML = html;
    tabsBlocco.hidden = !schede.length;
    tabsCount.textContent = schede.length ? schede.length + (schede.length === 1 ? ' scheda' : ' schede') + ' \u00b7 tieni premuto OK per chiuderle' : '';
    nSchede.textContent = schede.length ? String(schede.length) : '';
    if (gal) disegnaGalleria();
    html = '';
    for (var i = 0; i < preferiti.length; i++) html += favHTML(preferiti[i]);
    favsEl.innerHTML = html + ADD_HTML;

    var mostrati = cronologia.slice(0, MAX_MOSTRATI);
    html = '';
    for (var j = 0; j < mostrati.length; j++) html += histHTML(mostrati[j], j);
    histEl.innerHTML = html || '<li class="empty">I siti che apri compariranno qui, anche quelli raggiunti cliccando dentro le pagine.</li>';
    countEl.textContent = mostrati.length ? 'Tieni premuto OK su un sito per le opzioni' : '';

    // si ritrova l'elemento selezionato dopo il ridisegno
    if (primaVolta || !cur) { focusArea('search'); return; }
    var area = cur.area, i2 = cur.i, url = cur.url;
    cur = null;
    if (area === 'tab') {
      if (schede.length) focusArea('tab', Math.min(i2, schede.length - 1)); else focusArea('search');
    } else if (area === 'fav') {
      var t = favsEl.children, k = Math.min(i2, t.length - 1);
      for (var a = 0; a < t.length; a++) if (url && t[a].getAttribute('data-url') === url) { k = a; break; }
      focusArea('fav', k);
    } else if (area === 'hist') {
      if (mostrati.length) focusArea('hist', Math.min(i2, mostrati.length - 1)); else focusArea('search');
    } else focusArea(area);
  }

  // Favicon che non si carica: resta la lettera.
  function senzaIcona(ev) { if (ev.target && ev.target.tagName === 'IMG') ev.target.parentNode.removeChild(ev.target); }
  favsEl.addEventListener('error', senzaIcona, true);
  galGriglia.addEventListener('error', senzaIcona, true);

  /* ============================================================ selezione */

  var cur = null; // { area: 'top'|'search'|'schede'|'nuova'|'tab'|'fav'|'hist', i, el, url }
  var lastFav = 0;

  function elOf(area, i) {
    if (area === 'top') return homeBtn;
    if (area === 'search') return searchEl;
    if (area === 'schede') return btnSchede;
    if (area === 'nuova') return btnNuova;
    if (area === 'tab') return tabsEl.children[i];
    if (area === 'fav') return favsEl.children[i];
    var rows = histEl.querySelectorAll('.h-row');
    return rows[i];
  }

  function count(area) {
    if (area === 'tab') return tabsEl.children.length;
    if (area === 'fav') return favsEl.children.length;
    if (area === 'hist') return histEl.querySelectorAll('.h-row').length;
    return 1;
  }

  function focusArea(area, i) {
    i = i || 0;
    var n = count(area);
    if (!n) return false;
    i = Math.max(0, Math.min(n - 1, i));
    var el = elOf(area, i);
    if (!el) return false;
    if (cur && cur.el) cur.el.classList.remove('f');
    el.classList.add('f');
    cur = { area: area, i: i, el: el, url: el.getAttribute('data-url') };
    if (area === 'fav') lastFav = i;

    var r = UI.rem();
    if (area === 'fav' || area === 'tab') {
      var step = 32 * r, total = n * step - 3.2 * r, view = window.innerWidth - 19.2 * r;
      var off = Math.min(Math.max(0, (i - 1) * step), Math.max(0, total - view));
      UI.setTransform(area === 'fav' ? favsEl : tabsEl, 'translate3d(' + (-off) + 'px,0,0)');
    }
    var y = 0;
    if (area === 'hist') y = Math.max(0, el.offsetTop - 52 * r);
    UI.setTransform(stage, 'translate3d(0,' + (-y) + 'px,0)');
    return true;
  }

  function move(dir) {
    if (!cur) return;
    var a = cur.area, i = cur.i;
    if (a === 'top') { if (dir === 'down') focusArea('search'); return; }
    // la riga della ricerca: la casella, poi i pulsanti Schede e + (nuova scheda)
    if (a === 'search' || a === 'schede' || a === 'nuova') {
      var riga = ['search', 'schede', 'nuova'], k = riga.indexOf(a);
      if (dir === 'left' && k > 0) focusArea(riga[k - 1]);
      else if (dir === 'right' && k < riga.length - 1) focusArea(riga[k + 1]);
      else if (dir === 'up') focusArea('top');
      else if (dir === 'down') { if (!focusArea('tab', 0)) focusArea('fav', lastFav); }
      return;
    }
    if (a === 'tab') {
      if (dir === 'left') focusArea('tab', i - 1);
      else if (dir === 'right') focusArea('tab', i + 1);
      else if (dir === 'up') focusArea('search');
      else if (dir === 'down') focusArea('fav', lastFav);
      return;
    }
    if (a === 'fav') {
      if (dir === 'left') focusArea('fav', i - 1);
      else if (dir === 'right') focusArea('fav', i + 1);
      else if (dir === 'up') { if (!focusArea('tab', 0)) focusArea('search'); }
      else if (dir === 'down') focusArea('hist', 0);
      return;
    }
    if (a === 'hist') {
      if (dir === 'up') { if (i === 0) focusArea('fav', lastFav); else focusArea('hist', i - 1); }
      else if (dir === 'down') focusArea('hist', i + 1);
    }
  }

  /* ============================================================ azioni */

  function toSite(t) {
    t = String(t || '').replace(/^\s+|\s+$/g, '');
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return { url: t, titolo: UI.hostOf(t) };
    if (/^[^\s\/]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return { url: 'https://' + t, titolo: UI.hostOf('https://' + t) };
    return { url: motore() + encodeURIComponent(t), titolo: 'Ricerca: ' + t };
  }

  // ogni pagina aperta da qui e' una scheda (se una scheda e' gia' su quella pagina, si torna a quella)
  function go(url, titolo) {
    if (!url) return;
    var s = null;
    for (var i = 0; i < schede.length; i++) if (schede[i].url === url) s = schede[i];
    apri(s ? { azione: 'apri', id: s.id } : { azione: 'apri', id: 'k' + Date.now().toString(36), url: url, titolo: titolo || UI.hostOf(url) }, url, titolo);
  }
  function riapriScheda(s) { if (s) apri({ azione: 'apri', id: s.id }, s.url, s.titolo); }
  // una scheda nuova: si scrive l'indirizzo o la ricerca (anche dal telefono), e la pagina si apre in una scheda nuova
  function nuovaScheda() {
    if (gal) chiudiGalleria(true);
    focusArea('search');
    try { input.focus(); } catch (e) {}
    UI.toast('Scrivi un indirizzo o una ricerca: si apre in una scheda nuova', 3500);
  }

  /* ------------------------------------------------------------ galleria delle schede (come Safari) */

  var gal = null, COLONNE = 3; // gal: { i, y } mentre la galleria e' aperta
  function apriGalleria() {
    if (!gal) {
      gal = { i: 0, y: 0 };
      for (var k = 0; k < schede.length; k++) if (schede[k].id === schedaAttiva) gal.i = k;
    }
    galEl.hidden = false;
    disegnaGalleria();
    void galEl.offsetWidth; // cosi' compare sfumando
    galEl.className = 'aperta';
  }
  function chiudiGalleria(senzaFuoco) {
    if (!gal) return;
    gal = null;
    galEl.className = '';
    setTimeout(function () { if (!gal) galEl.hidden = true; }, 230);
    if (!senzaFuoco) focusArea('schede');
  }
  function disegnaGalleria() {
    var html = '';
    for (var i = 0; i < schede.length; i++) html += cardHTML(schede[i]);
    galGriglia.innerHTML = html + NUOVA_HTML;
    galConta.textContent = schede.length ? '\u00b7 ' + schede.length : '';
    selezionaCarta(gal.i);
  }
  function selezionaCarta(i) {
    var c = galGriglia.children;
    if (!c.length) return;
    i = Math.max(0, Math.min(c.length - 1, i));
    for (var k = 0; k < c.length; k++) if (k !== i) c[k].classList.remove('f');
    c[i].classList.add('f');
    gal.i = i;
    // la fila scelta sempre tutta in vista
    var r = UI.rem(), alt = 46.6 * r, top = Math.floor(i / COLONNE) * alt, vista = galVista.clientHeight || window.innerHeight;
    if (top + alt + 4 * r - gal.y > vista) gal.y = top + alt + 4 * r - vista;
    if (top < gal.y) gal.y = top;
    UI.setTransform(galGriglia, 'translate3d(0,' + (-gal.y) + 'px,0)');
  }
  function apriCarta(i) {
    if (i >= schede.length) { nuovaScheda(); return; }
    riapriScheda(schede[i]);
  }
  function tastoGalleria(a) {
    var n = galGriglia.children.length, i = gal.i;
    if (a === 'left') { if (i % COLONNE) selezionaCarta(i - 1); }
    else if (a === 'right') { if (i % COLONNE < COLONNE - 1 && i + 1 < n) selezionaCarta(i + 1); }
    else if (a === 'up') { if (i >= COLONNE) selezionaCarta(i - COLONNE); }
    else if (a === 'down') { if (i + COLONNE < n) selezionaCarta(i + COLONNE); else if (Math.floor(i / COLONNE) < Math.floor((n - 1) / COLONNE)) selezionaCarta(n - 1); }
    else if (a === 'ok') apriCarta(i);
    else if (a === 'hold' || a === 'yellow') { if (i < schede.length) opzioniScheda(i); }
    else if (a === 'back') chiudiGalleria();
    else if (a === 'green') goHome();
  }
  function apri(corpo, url, titolo) {
    UI.toast('Apro ' + (UI.hostOf(url) || url) + '\u2026');
    cambiaScheda(corpo).then(function () { return registraVisita(url, titolo || UI.hostOf(url)); }).then(function () {
      if (IN_ANTEPRIMA) { UI.toast('Anteprima: sul TV qui si apre ' + UI.hostOf(url), 3500); carica(false); return; }
      location.href = url;
    });
  }
  function opzioniScheda(i) {
    var s = schede[i];
    if (!s) return;
    function fatto(corpo, avviso) { return function () { cambiaScheda(corpo).then(function () { draw(false); UI.toast(avviso); }); }; }
    // (draw ridisegna anche la galleria, se e' aperta)
    var voci = [{ label: 'Apri', action: function () { riapriScheda(s); } },
      { label: 'Chiudi la scheda', action: fatto({ azione: 'chiudi', id: s.id }, 'Scheda chiusa') }];
    if (schede.length > 1) {
      voci.push({ label: 'Chiudi le altre schede', action: fatto({ azione: 'chiudiAltre', id: s.id }, 'Resta solo questa scheda') });
      voci.push({ label: 'Chiudi tutte le schede', action: fatto({ azione: 'chiudiTutte' }, 'Schede chiuse') });
    }
    if (indicePreferito(s.url) === -1) {
      voci.push({ label: 'Aggiungi ai preferiti', action: function () {
        preferiti.push({ nome: s.titolo || UI.hostOf(s.url), url: s.url });
        salvaPreferiti();
        draw(false);
        UI.toast('Aggiunto ai preferiti');
      } });
    }
    UI.openSheet({ title: s.titolo || UI.hostOf(s.url), subtitle: UI.hostOf(s.url), items: voci });
  }

  function goHome() { location.replace('./'); }

  var closing = false;
  function closeInput() { closing = true; input.blur(); closing = false; }
  function submit() {
    var s = toSite(input.value);
    closeInput();
    if (s) { input.value = ''; go(s.url, s.titolo); }
  }
  input.addEventListener('change', function () { if (!closing && input.value) submit(); });

  var MAX_PREFERITI = 60; // come sul servizio del TV
  function aggiungiSito() {
    if (preferiti.length >= MAX_PREFERITI) {
      UI.toast('Preferiti pieni (' + MAX_PREFERITI + '): togline qualcuno per aggiungerne altri', 4500);
      return;
    }
    UI.openEditor({
      title: 'Indirizzo del sito', placeholder: 'esempio: meteo.it',
      onSave: function (v) {
        if (!v) return;
        if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
        if (!UI.validUrl(v)) { UI.toast('Questo non sembra un indirizzo valido'); return; }
        var host = UI.hostOf(v);
        var nome = host.split('.')[0];
        nome = nome.charAt(0).toUpperCase() + nome.slice(1);
        setTimeout(function () {
          UI.openEditor({
            title: 'Nome del preferito', value: nome,
            onSave: function (n) {
              preferiti.push({ nome: n || nome, url: v });
              salvaPreferiti();
              draw(false);
              focusArea('fav', preferiti.length - 1);
              UI.toast('Aggiunto ai preferiti');
            }
          });
        }, 60);
      }
    });
  }

  function indicePreferito(url) {
    for (var i = 0; i < preferiti.length; i++) if (preferiti[i].url === url) return i;
    return -1;
  }

  function opzioniPreferito(i) {
    var p = preferiti[i];
    if (!p) return;
    UI.openSheet({
      title: p.nome || UI.hostOf(p.url), subtitle: UI.hostOf(p.url),
      items: [
        { label: 'Apri', action: function () { go(p.url, p.nome); } },
        { label: 'Sposta', action: function () { startMove(); } },
        { label: 'Rinomina', action: function () {
          setTimeout(function () {
            UI.openEditor({ title: 'Nome del preferito', value: p.nome, onSave: function (n) {
              if (!n) return;
              p.nome = n; salvaPreferiti(); draw(false); UI.toast('Nome salvato');
            } });
          }, 60);
        } },
        { label: 'Togli dai preferiti', action: function () {
          preferiti.splice(i, 1); salvaPreferiti(); draw(false); UI.toast('Tolto dai preferiti');
        } }
      ]
    });
  }

  function opzioniVisita(i) {
    var v = cronologia[i];
    if (!v) return;
    var gia = indicePreferito(v.url) !== -1;
    UI.openSheet({
      title: v.titolo || UI.hostOf(v.url), subtitle: UI.hostOf(v.url) + '  ' + quando(v.t),
      items: [
        { label: 'Apri', action: function () { go(v.url, v.titolo); } },
        { label: gia ? 'Già nei preferiti' : 'Aggiungi ai preferiti', disabled: gia, action: function () {
          if (preferiti.length >= MAX_PREFERITI) { UI.toast('Preferiti pieni (' + MAX_PREFERITI + '): togline qualcuno per aggiungerne altri', 4500); return; }
          preferiti.push({ nome: (v.titolo || UI.hostOf(v.url)).slice(0, 60), url: v.url });
          salvaPreferiti(); draw(false); UI.toast('Aggiunto ai preferiti');
        } },
        { label: 'Togli dalla cronologia', action: function () {
          cronologia.splice(i, 1);
          if (DEMO) UI.save('tvb-cronologia', cronologia);
          else UI.service('/api/browser', { rimuoviVisita: v.url })['catch'](function () {});
          draw(false);
        } },
        { label: 'Cancella tutta la cronologia', action: function () {
          cronologia = [];
          if (DEMO) UI.save('tvb-cronologia', []);
          else UI.service('/api/browser', { svuotaCronologia: true })['catch'](function () {});
          draw(false);
          UI.toast('Cronologia cancellata');
        } }
      ]
    });
  }

  /* ------------------------------------------------------------ spostamento dei preferiti */

  var moving = false;
  function startMove() {
    if (!cur || cur.area !== 'fav' || cur.i >= preferiti.length) return;
    moving = true;
    cur.el.classList.add('moving');
    UI.toast('Frecce per spostare, OK per finire', 3000);
  }
  function moveBy(d) {
    var i = cur.i, j = i + d;
    if (j < 0 || j >= preferiti.length) return;
    var t = preferiti[i]; preferiti[i] = preferiti[j]; preferiti[j] = t;
    draw(false);
    focusArea('fav', j);
    cur.el.classList.add('moving');
  }
  function endMove() {
    moving = false;
    if (cur && cur.el) cur.el.classList.remove('moving');
    salvaPreferiti();
    UI.toast('Preferiti salvati');
  }

  /* ============================================================ tasti e mouse */

  function activate() {
    if (!cur) return;
    if (cur.area === 'top') { goHome(); return; }
    if (cur.area === 'search') { try { input.focus(); } catch (e) {} return; }
    if (cur.area === 'schede') { apriGalleria(); return; }
    if (cur.area === 'nuova') { nuovaScheda(); return; }
    if (cur.area === 'tab') { riapriScheda(schede[cur.i]); return; }
    if (cur.area === 'fav') {
      if (cur.el.getAttribute('data-add')) { aggiungiSito(); return; }
      var p = preferiti[cur.i];
      if (p) go(p.url, p.nome);
      return;
    }
    if (cur.area === 'hist') { var v = cronologia[cur.i]; if (v) go(v.url, v.titolo); }
  }

  function optionsCur() {
    if (!cur) return;
    if (cur.area === 'tab') opzioniScheda(cur.i);
    else if (cur.area === 'fav' && !cur.el.getAttribute('data-add')) opzioniPreferito(cur.i);
    else if (cur.area === 'hist') opzioniVisita(cur.i);
  }

  UI.onKeys(function (a) {
    if (document.activeElement === input) {
      if (a === 'done') submit();
      else if (a === 'back' || a === 'cancel' || a === 'up' || a === 'down') { closeInput(); if (a === 'down') move('down'); }
      return;
    }
    if (gal) { tastoGalleria(a); return; }
    if (!cur) return;
    if (moving) {
      if (a === 'left') moveBy(-1);
      else if (a === 'right') moveBy(1);
      else if (a === 'ok' || a === 'back' || a === 'hold') endMove();
      return;
    }
    if (a === 'left' || a === 'right' || a === 'up' || a === 'down') move(a);
    else if (a === 'ok') activate();
    else if (a === 'hold' || a === 'yellow') optionsCur();
    else if (a === 'back' || a === 'green') goHome();
  });

  stage.addEventListener('click', function (ev) {
    if (moving || UI.sheetOpen() || UI.editorOpen()) return;
    var t = ev.target;
    while (t && t !== stage && t !== searchEl && !(t.classList && (t.classList.contains('tile') || t.classList.contains('h-row')))) t = t.parentNode;
    if (!t || t === stage) return;
    if (t === searchEl) { focusArea('search'); input.focus(); return; }
    var area = !t.classList.contains('tile') ? 'hist' : tabsEl.contains(t) ? 'tab' : 'fav';
    var list = area === 'hist' ? histEl.querySelectorAll('.h-row') : area === 'tab' ? tabsEl.children : favsEl.children;
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== t) continue;
      if (cur && cur.el === t) activate();
      else {
        focusArea(area, i);
        if (ev.hometvPuntatore && cur && cur.el === t) activate(); // col puntatore del telefono si apre subito
      }
      return;
    }
  });
  // trackpad: due dita in orizzontale sopra i preferiti fanno scorrere i preferiti
  stage.addEventListener('hometvscorri', function (ev) {
    var d = ev.detail || {}, t = ev.target;
    if (moving || UI.sheetOpen() || UI.editorOpen() || Math.abs(d.dx || 0) <= Math.abs(d.dy || 0)) return;
    while (t && t !== stage && !(t.classList && t.classList.contains('tile'))) t = t.parentNode;
    if (!t || t === stage || (cur && cur.el === t)) return;
    var list = favsEl.children;
    for (var i = 0; i < list.length; i++) if (list[i] === t) { focusArea('fav', i); return; }
  });
  stage.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    var t = ev.target;
    while (t && t !== stage && !(t.classList && (t.classList.contains('tile') || t.classList.contains('h-row')))) t = t.parentNode;
    if (!t || t === stage) return;
    var area = !t.classList.contains('tile') ? 'hist' : tabsEl.contains(t) ? 'tab' : 'fav';
    var list = area === 'hist' ? histEl.querySelectorAll('.h-row') : area === 'tab' ? tabsEl.children : favsEl.children;
    for (var i = 0; i < list.length; i++) if (list[i] === t) { focusArea(area, i); optionsCur(); return; }
  });
  homeBtn.addEventListener('click', goHome);
  btnSchede.addEventListener('click', function () { focusArea('schede'); apriGalleria(); });
  btnNuova.addEventListener('click', function () { nuovaScheda(); });
  // galleria: col mouse o col puntatore del telefono si sceglie e si apre; tasto destro (o tocco lungo) per le opzioni
  function cartaDi(t) {
    while (t && t !== galEl && !(t.classList && t.classList.contains('g-card'))) t = t.parentNode;
    if (!t || t === galEl) return -1;
    for (var i = 0; i < galGriglia.children.length; i++) if (galGriglia.children[i] === t) return i;
    return -1;
  }
  galEl.addEventListener('click', function (ev) {
    if (!gal || UI.sheetOpen()) return;
    var i = cartaDi(ev.target);
    if (i < 0) return;
    if (gal.i === i || ev.hometvPuntatore) apriCarta(i); else selezionaCarta(i);
  });
  galEl.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    var i = cartaDi(ev.target);
    if (gal && i >= 0 && i < schede.length) { selezionaCarta(i); opzioniScheda(i); }
  });

  /* ============================================================ avvio */

  UI.startClock(function (ora, data) {
    $('time').textContent = ora;
    $('date').textContent = data;
  });

  fetch('config.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (c) { cfg = c || {}; UI.save('tvh-config', cfg); })['catch'](function () {});

  carica(true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !moving) carica(false); });

  // browser.html#schede apre la galleria (dal menu Blu di un sito, dal telefono, tornando indietro da una scheda);
  // #nuova una scheda nuova
  function daIndirizzo() {
    if (location.hash === '#schede') apriGalleria();
    else if (location.hash === '#nuova') { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} nuovaScheda(); }
  }
  daIndirizzo();
  window.addEventListener('hashchange', daIndirizzo);

  // ricerca arrivata dalla home (per esempio scritta dal telefono): browser.html?q=...
  var cercata = /[?&]q=([^&]*)/.exec(location.search);
  if (cercata) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    var testoCercato = '';
    try { testoCercato = decodeURIComponent(cercata[1].replace(/\+/g, ' ')); } catch (e) {}
    if (testoCercato) setTimeout(function () { input.value = testoCercato; submit(); }, 150);
  }

  // telefono: il testo diventa una ricerca (o apre l'indirizzo), i link si aprono, Home torna alla home
  UI.campoPerTelefono(input, 'Cerca o scrivi un indirizzo');
  UI.ascoltaTelefono('Browser', {
    // mentre scrivi sul telefono la casella si riempie; con Invio si cerca
    testo: function (t, invio) { input.value = t; if (invio) submit(); },
    link: function (u) { go(u, UI.hostOf(u)); },
    schede: function (nuova) { if (nuova) nuovaScheda(); else apriGalleria(); },
    home: goHome
  });
})();
