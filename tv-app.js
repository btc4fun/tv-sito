/*
 * Home TV - LIBRERIA PER LE APP DELLO STORE (tv-app.js).
 *
 * Un'app web la mette come primo script: <script src="/tv-sito/tv-app.js"></script> se sta sullo stesso account della
 * home, oppure una copia. Dentro Home TV l'app gira in un riquadro isolato (store.html): i tasti del telecomando e del
 * telefono li riceve la home e li passa all'app da qui. Fuori dal TV (sul computer) usa i tasti veri e la memoria del
 * browser, cosi' l'app si prova anche li'.
 *
 *   HomeTV.pronto(function (info) {})   l'app parte qui. info: piattaforma ('tizen' o 'browser'), lingua, tema, capacita
 *   HomeTV.tasti(function (azione) {})  up down left right ok play red yellow rew ff stop; true = l'ho usato io
 *                                       (Verde e Blu sono della home: tornare alla home e il menu dell'app)
 *   HomeTV.indietro(function () {})     true = Indietro l'ho usato io (per esempio per chiudere un mio menu)
 *   HomeTV.memoria.leggi(k) / scrivi(k, v) / togli(k)   testi salvati sul TV (al massimo 64 KB per app)
 *   HomeTV.chiediTesto({ titolo, valore }).then(function (testo) {})   tastiera del TV o del telefono (null = annullato)
 *   HomeTV.esci()      HomeTV.avviso(testo)      HomeTV.scegli(elemento)
 *   HomeTV.permesso('video').then(function (p) {}, function (e) {})   solo le app ufficiali che lo dichiarano nel
 *                                       catalogo: p = { servizio, gettone } per le domande /api/video/g/<gettone>/... al
 *                                       servizio del TV; null = fuori da Home TV; e.codice 'negato' (l'app non ce l'ha),
 *                                       'vecchio' (il servizio del TV non lo conosce: riavviare il TV o aggiornare Home TV)
 *                                       o 'servizio' (non risponde)
 *   HomeTV.video(function (c) {})       la barra del video sul telefono: c.azione 'vai' (c.secondi = il punto), 'salta'
 *                                       (c.secondi avanti, o indietro se negativi), 'play', 'pausa'
 * Aperta da Continua a guardare della home: l'indirizzo che l'app ha dato al servizio (con "#/..."), con in piu' "t=<secondi>"
 * (il punto della scheda) oppure "dacapo=1" (Ricomincia dall'inizio).
 *
 * Senza fare niente: le frecce muovono la scelta (un anello colorato, classe "tv-scelto") tra gli elementi [data-tv],
 * i link, i pulsanti e le caselle; OK clicca (su una casella apre la tastiera); il puntatore del telefono clicca dove
 * indica; localStorage e document.cookie funzionano lo stesso (li tiene la home, divisi per app; i cookie solo finche'
 * l'app e' aperta). [data-tv-inizio] = scelto per primo, data-tv="no" = mai scelto. La memoria arriva con
 * HomeTV.pronto: le letture fatte prima tornano vuote, le scritture fatte prima non si perdono.
 * Solo JavaScript ES5 e solo ASCII: gira dal Chromium 47 dei TV 2017.
 */
var HomeTV = (function () {
  'use strict';

  var NEL_RIQUADRO = window.parent !== window;
  // nel riquadro dello Store (il nome glielo da' la home): qui ai tasti pensa questa libreria, il codice di Home TV per
  // i siti resta fermo. Altrove (una pagina normale, o l'app aperta "come sito") Home TV lavora come sempre
  var NELLO_STORE = NEL_RIQUADRO && window.name === 'hometv-app';
  if (NELLO_STORE) window.__hometvCasa = true;

  var MAX_MEMORIA = 64 * 1024, INVIO_MS = 300;
  var info = { piattaforma: 'browser', lingua: String(navigator.language || 'it').slice(0, 2), tema: '', capacita: {} };
  var dati = {}, peso = 2, partita = false, collegata = false, genitore = null;
  var prima = []; // le scritture fatte prima che la home passi la memoria: si rimettono sopra
  var suPronto = [], suTasti = [], suIndietro = [], suVideo = [], attese = {}, seq = 0, invioTimer = null;

  function posta(m) {
    if (!collegata || !genitore) return;
    m.hometvApp = 1;
    try { genitore.postMessage(m, '*'); } catch (e) {}
  }

  /* ------------------------------------------------------------ memoria (tenuta dalla home, una per app) */

  // quanto pesa una chiave nel testo che si salva (per il limite di 64 KB, senza rifare tutto il testo a ogni scrittura)
  function pesoDi(k, v) { return JSON.stringify(k).length + JSON.stringify(v).length + 2; }
  function invia() { invioTimer = null; posta({ tipo: 'scrivi', dati: dati }); }
  // le scritture vicine partono insieme, al massimo ogni 300 ms; prima di Indietro e all'uscita partono subito
  function salvaPresto() { if (!invioTimer) invioTimer = setTimeout(invia, INVIO_MS); }
  function svuota() { if (invioTimer) { clearTimeout(invioTimer); invia(); } }
  function scriviChiave(k, v) {
    var c = Object.prototype.hasOwnProperty.call(dati, k), nuovo = peso - (c ? pesoDi(k, dati[k]) : 0) + pesoDi(k, v);
    if (nuovo > MAX_MEMORIA) { var e = new Error('memoria piena (64 KB per app)'); e.name = 'QuotaExceededError'; throw e; }
    dati[k] = v;
    peso = nuovo;
    if (prima) prima.push({ k: k, v: v });
    salvaPresto();
  }
  function togliChiave(k) {
    if (prima) prima.push({ k: k, via: true });
    if (!Object.prototype.hasOwnProperty.call(dati, k)) return;
    peso -= pesoDi(k, dati[k]);
    delete dati[k];
    salvaPresto();
  }
  function tutto(nuovi) {
    dati = nuovi;
    peso = 2;
    for (var k in dati) if (Object.prototype.hasOwnProperty.call(dati, k)) peso += pesoDi(k, dati[k]);
  }
  var memoriaFinta = {
    getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(dati, k) ? dati[k] : null; },
    setItem: function (k, v) { scriviChiave(String(k), String(v)); },
    removeItem: function (k) { togliChiave(String(k)); },
    clear: function () { if (prima) prima.push({ tutto: true }); tutto({}); salvaPresto(); },
    key: function (i) { var l = Object.keys(dati); return i >= 0 && i < l.length ? l[i] : null; },
    get length() { return Object.keys(dati).length; }
  };
  if (NEL_RIQUADRO) {
    // nel riquadro la memoria del browser non c'e' (il riquadro e' isolato): localStorage diventa quella della home,
    // sessionStorage e i cookie restano solo finche' l'app e' aperta (molte librerie li toccano appena partono)
    try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return memoriaFinta; } }); } catch (e) {}
    var sessione = {}, biscotti = {};
    try {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () {
        return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(sessione, k) ? sessione[k] : null; },
          setItem: function (k, v) { sessione[String(k)] = String(v); }, removeItem: function (k) { delete sessione[k]; },
          clear: function () { sessione = {}; }, key: function (i) { return Object.keys(sessione)[i] || null; },
          get length() { return Object.keys(sessione).length; } };
      } });
    } catch (e) {}
    try {
      Object.defineProperty(document, 'cookie', { configurable: true,
        get: function () { return Object.keys(biscotti).map(function (k) { return k + '=' + biscotti[k]; }).join('; '); },
        set: function (v) {
          var m = /^\s*([^=;\s]+)\s*=\s*([^;]*)/.exec(String(v || ''));
          if (!m) return;
          if (/;\s*(max-age=0|expires=thu, 01 jan 1970)/i.test(String(v))) delete biscotti[m[1]]; else biscotti[m[1]] = m[2];
        } });
    } catch (e) {}
  } else {
    var vera = null;
    try { vera = window.localStorage; vera.getItem('x'); } catch (e) { vera = null; }
    if (vera) {
      try { var salvati = JSON.parse(vera.getItem('hometv-app') || '{}'); if (salvati && typeof salvati === 'object') tutto(salvati); } catch (e) {}
    }
    prima = null;
    // sul computer: la memoria vera, in una chiave sola (come sul TV)
    invia = function () { invioTimer = null; try { if (vera) vera.setItem('hometv-app', JSON.stringify(dati)); } catch (e) {} };
  }
  var memoria = {
    leggi: function (k) { return memoriaFinta.getItem(k); },
    scrivi: function (k, v) { try { scriviChiave(String(k), String(v)); return true; } catch (e) { return false; } },
    togli: function (k) { togliChiave(String(k)); }
  };

  /* ------------------------------------------------------------ partenza */

  function parti() {
    if (partita) return;
    partita = true;
    for (var i = 0; i < suPronto.length; i++) { try { suPronto[i](info); } catch (e) { lancia(e); } }
  }
  function lancia(e) { setTimeout(function () { throw e; }, 0); }
  function pronto(fn) {
    if (typeof fn !== 'function') return;
    if (partita) { try { fn(info); } catch (e) { lancia(e); } return; }
    suPronto.push(fn);
  }
  // la memoria della home, con sopra le scritture fatte prima (non si perdono)
  function benvenuto(d) {
    var base = {};
    if (d.dati && typeof d.dati === 'object') {
      for (var k in d.dati) if (Object.prototype.hasOwnProperty.call(d.dati, k) && typeof d.dati[k] === 'string') base[k] = d.dati[k];
    }
    var op = prima || [];
    prima = null;
    for (var i = 0; i < op.length; i++) {
      if (op[i].tutto) base = {};
      else if (op[i].via) delete base[op[i].k];
      else base[op[i].k] = op[i].v;
    }
    tutto(base);
    if (op.length) salvaPresto();
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!NEL_RIQUADRO || ev.source !== window.parent || !d || typeof d !== 'object' || d.hometvApp !== 1) return;
    if (d.tipo === 'benvenuto') {
      if (collegata) return; // la home risponde a ogni saluto: la prima risposta basta (le altre cancellerebbero le scritture)
      genitore = ev.source;
      collegata = true;
      if (d.info && typeof d.info === 'object') {
        info.piattaforma = d.info.piattaforma || 'tizen';
        info.lingua = d.info.lingua || info.lingua;
        info.tema = d.info.tema || '';
        info.capacita = d.info.capacita || {};
      }
      benvenuto(d);
      parti();
      if (!scelto) setTimeout(function () { if (!scelto) primo(); }, 0);
    } else if (!collegata) {
      return;
    } else if (d.tipo === 'tasto') {
      azione(String(d.azione || ''));
    } else if (d.tipo === 'indietro') {
      var usato = indietroApp();
      svuota(); // quello che l'app ha appena salvato arriva alla home prima che l'app si chiuda
      posta({ tipo: 'indietroFatto', id: d.id, usato: usato });
    } else if (d.tipo === 'testo') {
      var f = attese[d.id];
      delete attese[d.id];
      if (f) f(typeof d.testo === 'string' ? d.testo : null);
    } else if (d.tipo === 'testoTelefono') {
      scriviDalTelefono(String(d.testo || ''), d.invio !== false);
    } else if (d.tipo === 'puntatore') {
      puntatore(d);
    } else if (d.tipo === 'chiudi') {
      svuota();
    } else if (d.tipo === 'memoriaPiena') {
      try { window.dispatchEvent(new Event('hometvmemoriapiena')); } catch (e) {}
    } else if (d.tipo === 'video') {
      var az = String(d.azione || ''), sec = Number(d.secondi);
      if (az === 'vai' || az === 'salta' || az === 'play' || az === 'pausa') chiedi(suVideo, { azione: az, secondi: isFinite(sec) ? sec : 0 });
    } else if (d.tipo === 'permesso') {
      var p = permessi[d.id];
      delete permessi[d.id];
      if (!p) return;
      if (d.ok === true && typeof d.gettone === 'string') p.si({ servizio: String(d.servizio || ''), gettone: d.gettone });
      else p.no(erroreCodice(d.motivo === 'vecchio' || d.motivo === 'servizio' ? d.motivo : 'negato'));
    }
  });
  // l'app che si chiude (Indietro, Verde, il menu): quello che resta da salvare parte subito
  window.addEventListener('pagehide', svuota);
  window.addEventListener('beforeunload', svuota);
  // nel riquadro di Home TV: ci si presenta finche' la home risponde. Fuori (sul computer, o in una pagina qualsiasi)
  // si parte da soli con i tasti veri
  if (NEL_RIQUADRO) {
    var volte = 0;
    (function saluta() {
      if (collegata) return;
      try { window.parent.postMessage({ hometvApp: 1, tipo: 'pronto', sdk: 1 }, '*'); } catch (e) {}
      if (++volte < 6) setTimeout(saluta, 500); else setTimeout(function () { if (!collegata) { prima = null; parti(); } }, 500);
    })();
  } else {
    setTimeout(parti, 0);
  }

  /* ------------------------------------------------------------ tasti */

  var CODICI = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 10009: 'back', 461: 'back', 27: 'back', 8: 'back',
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 415: 'play', 19: 'play', 10252: 'play', 412: 'rew', 417: 'ff', 413: 'stop' };
  var VERSO_CODICE = { up: 38, down: 40, left: 37, right: 39, ok: 13, play: 10252, red: 403, yellow: 405, rew: 412, ff: 417, stop: 413 };
  var VERSO_NOME = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ok: 'Enter', play: 'MediaPlayPause',
    red: 'ColorF0Red', yellow: 'ColorF2Yellow', rew: 'MediaRewind', ff: 'MediaFastForward', stop: 'MediaStop' };

  // un tasto finto per le app che ascoltano i loro keydown (sui motori vecchi keyCode non si puo' dare alla creazione)
  function tastoFinto(tipo, codice, nome) {
    var ev;
    try { ev = new Event(tipo, { bubbles: true, cancelable: true }); } catch (e) { ev = document.createEvent('Event'); ev.initEvent(tipo, true, true); }
    try {
      Object.defineProperty(ev, 'keyCode', { get: function () { return codice; } });
      Object.defineProperty(ev, 'which', { get: function () { return codice; } });
      Object.defineProperty(ev, 'key', { get: function () { return nome; } });
    } catch (e) {}
    ev.hometv = true;
    var dove = scelto && document.documentElement.contains(scelto) ? scelto : (document.body || document.documentElement);
    dove.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  function tasti(fn) { if (typeof fn === 'function') suTasti.push(fn); }
  function indietro(fn) { if (typeof fn === 'function') suIndietro.push(fn); }
  function video(fn) { if (typeof fn === 'function') suVideo.push(fn); }
  function chiedi(lista, a) {
    for (var i = 0; i < lista.length; i++) { try { if (lista[i](a) === true) return true; } catch (e) { lancia(e); } }
    return false;
  }
  // un tasto dalla home: prima l'app (HomeTV.tasti, poi i suoi keydown), poi la navigazione di serie
  function azione(a) {
    if (!VERSO_CODICE[a]) return;
    if (chiedi(suTasti, a)) return;
    var usato = tastoFinto('keydown', VERSO_CODICE[a], VERSO_NOME[a]);
    tastoFinto('keyup', VERSO_CODICE[a], VERSO_NOME[a]);
    if (!usato) naviga(a);
  }
  function indietroApp() {
    if (chiedi(suIndietro, 'back')) return true;
    var usato = tastoFinto('keydown', 10009, 'GoBack');
    tastoFinto('keyup', 10009, 'GoBack');
    return usato;
  }
  // i tasti veri: sul computer, o se il riquadro ha preso lui la tastiera
  window.addEventListener('keydown', function (ev) {
    if (ev.hometv || ev.defaultPrevented) return;
    var a = CODICI[ev.keyCode];
    if (!a) return;
    var t = ev.target && ev.target.tagName, inCasella = t === 'INPUT' || t === 'TEXTAREA';
    if (inCasella && (ev.keyCode === 8 || a === 'left' || a === 'right' || a === 'ok')) return; // si sta scrivendo
    var fatto = a === 'back' ? chiedi(suIndietro, 'back') : (chiedi(suTasti, a) || naviga(a));
    if (fatto) ev.preventDefault();
    else if (a === 'back' && collegata) { ev.preventDefault(); esci(); }
  });

  /* ------------------------------------------------------------ navigazione di serie */

  var SEL = '[data-tv], a[href], button, input, select, textarea, [tabindex]';
  var scelto = null;
  (function stile() {
    var st = document.createElement('style');
    st.textContent = '.tv-scelto{outline:4px solid #3b82f6;outline-offset:3px;box-shadow:0 0 0 9px rgba(59,130,246,.3)}';
    (document.head || document.documentElement).insertBefore(st, (document.head || document.documentElement).firstChild);
  })();
  // il rettangolo di un elemento che si puo' scegliere (null se no): a ogni freccia si misura una volta sola
  function misura(el) {
    if (!el || el.disabled || el.getAttribute('data-tv') === 'no' || el.getAttribute('tabindex') === '-1') return null;
    var r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2 && window.getComputedStyle(el).visibility !== 'hidden' ? r : null;
  }
  function sceglibile(el) { return !!misura(el); }
  function candidati() {
    var l = document.querySelectorAll(SEL), out = [];
    for (var i = 0; i < l.length; i++) { var r = misura(l[i]); if (r) out.push({ el: l[i], r: r }); }
    return out;
  }
  function scegli(el) {
    if (scelto && scelto !== el && scelto.classList) scelto.classList.remove('tv-scelto');
    scelto = el || null;
    if (!scelto) return;
    scelto.classList.add('tv-scelto');
    try { if (scelto.scrollIntoViewIfNeeded) scelto.scrollIntoViewIfNeeded(false); else scelto.scrollIntoView(false); } catch (e) {}
    try { scelto.dispatchEvent(new Event('tvscelto', { bubbles: true })); } catch (e) {}
  }
  function primo() {
    var l = candidati();
    scegli(document.querySelector('[data-tv-inizio]') || (l[0] && l[0].el) || null);
    return !!scelto;
  }
  // nel riquadro la tastiera la tiene la home: focus() diventa "scegli questo" (le librerie che lo usano funzionano lo
  // stesso, e l'app non ruba il telecomando alla home)
  if (NELLO_STORE) {
    try {
      window.HTMLElement.prototype.focus = function () { if (sceglibile(this)) scegli(this); };
      window.focus = function () {};
    } catch (e) {}
  }
  function centro(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function naviga(a) {
    if (a === 'ok') return premi(scelto);
    if (a !== 'up' && a !== 'down' && a !== 'left' && a !== 'right') return false;
    if (!scelto || !document.documentElement.contains(scelto)) return primo();
    var l = candidati(), ca = centro(scelto.getBoundingClientRect()), meglio = null, punti = Infinity;
    for (var i = 0; i < l.length; i++) {
      if (l[i].el === scelto) continue;
      var c = centro(l[i].r), dx = c.x - ca.x, dy = c.y - ca.y, avanti, lato;
      if (a === 'down') { avanti = dy; lato = dx; } else if (a === 'up') { avanti = -dy; lato = dx; }
      else if (a === 'right') { avanti = dx; lato = dy; } else { avanti = -dx; lato = dy; }
      if (avanti < 1) continue;
      var p = avanti + Math.abs(lato) * 2.5;
      if (p < punti) { punti = p; meglio = l[i].el; }
    }
    if (meglio) { scegli(meglio); return true; }
    // niente in quella direzione: scorre la pagina un po'
    if (a === 'down' || a === 'up') { try { window.scrollBy(0, (a === 'down' ? 1 : -1) * Math.round(window.innerHeight * 0.4)); } catch (e) {} }
    return false;
  }
  function casella(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && /^(text|search|email|url|tel|number|password|)$/i.test(el.getAttribute('type') || '');
  }
  function evento(el, tipo) {
    var ev;
    try { ev = new Event(tipo, { bubbles: true }); } catch (e) { ev = document.createEvent('Event'); ev.initEvent(tipo, true, false); }
    el.dispatchEvent(ev);
  }
  function scriviIn(el) {
    var titolo = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || 'Scrivi';
    chiediTesto({ titolo: titolo, valore: el.getAttribute('type') === 'password' ? '' : el.value }).then(function (t) {
      if (t === null) return;
      el.value = t;
      evento(el, 'input');
      evento(el, 'change');
    });
  }
  function premi(el) {
    if (!el || !document.documentElement.contains(el)) return primo();
    if (casella(el)) { scriviIn(el); return true; }
    if (el.tagName === 'SELECT' && el.options.length) { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; evento(el, 'change'); return true; }
    try { el.click(); } catch (e) { return false; }
    return true;
  }
  function clicIn(el, x, y) {
    var tipi = ['mousedown', 'mouseup', 'click'];
    for (var i = 0; i < tipi.length; i++) {
      var ev;
      try { ev = new MouseEvent(tipi[i], { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, detail: 1 }); }
      catch (e) { ev = document.createEvent('MouseEvents'); ev.initMouseEvent(tipi[i], true, true, window, 1, x, y, x, y, false, false, false, false, 0, null); }
      el.dispatchEvent(ev);
    }
  }
  // il puntatore del telefono: un tocco e' un clic proprio li'
  function puntatore(d) {
    var x = +d.x, y = +d.y, el = null;
    if (!isFinite(x) || !isFinite(y)) return;
    try { el = document.elementFromPoint(x, y); } catch (e) {}
    if (!el) return;
    var su = el.closest ? el.closest(SEL) : null;
    if (su) scegli(su);
    if (d.azione !== 'clic') return;
    if (casella(su)) { scriviIn(su); return; }
    clicIn(el, x, y);
  }
  // testo scritto sul telefono senza una finestra aperta: va nella casella scelta
  function scriviDalTelefono(t, invio) {
    if (!casella(scelto)) return;
    scelto.value = t;
    evento(scelto, 'input');
    if (invio) { evento(scelto, 'change'); tastoFinto('keydown', 13, 'Enter'); }
  }

  /* ------------------------------------------------------------ scrivere, uscire, avvisi */

  function chiediTesto(o) {
    o = o || {};
    var titolo = String(o.titolo || 'Scrivi').slice(0, 80), valore = String(o.valore || '').slice(0, 500);
    if (!collegata) {
      var t = null;
      try { t = window.prompt(titolo, valore); } catch (e) {}
      return Promise.resolve(t === undefined ? null : t);
    }
    return new Promise(function (ok) {
      var id = ++seq;
      attese[id] = ok;
      posta({ tipo: 'chiediTesto', id: id, titolo: titolo, valore: valore });
    });
  }
  function esci() {
    if (collegata) { svuota(); posta({ tipo: 'esci' }); return; }
    try { history.back(); } catch (e) {}
  }
  function avviso(t) {
    t = String(t || '').slice(0, 160);
    if (collegata) { posta({ tipo: 'avviso', testo: t }); return; }
    try { console.log('[HomeTV] ' + t); } catch (e) {}
  }
  // un permesso dichiarato nel catalogo (per ora "video": le chiavette attaccate al TV). Lo da' la home, solo alle app
  // ufficiali dello Store; fuori da Home TV (sul computer) non c'e'
  var permessi = {};
  function erroreCodice(c) { var e = new Error(c); e.codice = c; return e; }
  function permesso(nome) {
    if (!collegata) return Promise.resolve(null);
    return new Promise(function (si, no) {
      var id = ++seq;
      permessi[id] = { si: si, no: no };
      posta({ tipo: 'permesso', id: id, nome: String(nome || '').slice(0, 24) });
      // la home non risponde (il servizio del TV e' lento o fermo)
      setTimeout(function () { if (permessi[id]) { delete permessi[id]; no(erroreCodice('servizio')); } }, 10000);
    });
  }

  return {
    pronto: pronto, tasti: tasti, indietro: indietro, memoria: memoria, chiediTesto: chiediTesto, esci: esci, avviso: avviso,
    permesso: permesso, video: video, scegli: function (el) { scegli(el); }, info: function () { return info; }
  };
})();
