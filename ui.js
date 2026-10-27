/*
 * Home TV - pezzi condivisi tra home e browser:
 * memoria, servizio del TV, tasti del telecomando (con OK tenuto premuto),
 * avvisi, orologio, menu laterale delle opzioni, finestra per scrivere.
 *
 * Solo JavaScript ES5: il browser del TV e' datato.
 */
var UI = (function () {
  'use strict';
  // segnale per il codice che TizenBrew inserisce nelle pagine: qui c'e' gia' la home
  window.__hometvCasa = true;

  var SERVICE = 'http://127.0.0.1:8090';
  // profilo del TV (profilo.js): le differenze tra i TV stanno tutte li'. Qui si riparano i motori vecchi (TV 2017) e
  // si sa se siamo sul TV
  ProfiloTV.ripara(window);
  var MOTORE = ProfiloTV.motore(window);
  if (!MOTORE.variabiliCss) ProfiloTV.variabiliCss(document);
  var ON_TV = ProfiloTV.suTv(window, load('hometv-sul-tv', false));
  var DEMO = !ON_TV || /[?&]demo\b/.test(location.search);

  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------ memoria */

  function load(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* memoria piena o bloccata */ }
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hostOf(u) {
    var m = /^https?:\/\/([^\/:?#]+)/i.exec(u || '');
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  }
  function validUrl(u) {
    return typeof u === 'string' && /^https?:\/\/[^\s\/]+\.[^\s]+$/i.test(u) && u.indexOf('esempio') === -1;
  }
  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /* ------------------------------------------------------------ servizio del TV */

  function service(path, body) {
    if (DEMO) return Promise.reject(new Error('anteprima'));
    var opts = { cache: 'no-store' };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers = { 'Content-Type': 'text/plain' }; // niente richiesta preliminare CORS
      opts.body = JSON.stringify(body);
    }
    return fetch(SERVICE + path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : 'errore ' + r.status);
        return j;
      });
    });
  }
  // i preferiti del browser alla prima apertura (config.json, se no questi): li usano il browser e il "+" della home
  var PREFERITI_INIZIALI = [
    { nome: 'Google', url: 'https://www.google.com/' },
    { nome: 'Wikipedia', url: 'https://it.wikipedia.org/' },
    { nome: 'Meteo', url: 'https://www.ilmeteo.it/' }
  ];
  function preferitiIniziali(cfg) {
    var p = cfg && cfg.browser && cfg.browser.preferiti && cfg.browser.preferiti.length ? cfg.browser.preferiti : PREFERITI_INIZIALI;
    return p.filter(function (x) { return x && validUrl(x.url); }).map(function (x) { return { nome: x.nome || hostOf(x.url), url: x.url }; });
  }
  // quelli che il browser mostra, dai dati del servizio: mai aperto (null) = gli iniziali piu' quelli aggiunti dai siti
  function preferitiBrowser(cfg, d) {
    if (d && d.preferiti !== null && d.preferiti !== undefined) return d.preferiti;
    var out = [], visti = {};
    preferitiIniziali(cfg).concat((d && d.inAttesa) || []).forEach(function (p) {
      if (p && !visti[p.url]) { visti[p.url] = 1; out.push(p); }
    });
    return out;
  }
  function iconUrl(p) { return SERVICE + '/api/icon?path=' + encodeURIComponent(p); }
  // lo user agent non dice TV (TizenBrew permette di cambiarlo) ma il servizio del TV risponde: siamo sul TV. Lo si
  // ricorda e si riapre la pagina, una volta sola. Basta che risponda (anche "pagina non autorizzata"): per questo la
  // richiesta e' "no-cors", che non legge la risposta e fallisce solo se li' non c'e' nessuno. All'accensione il servizio
  // puo' partire dopo la home: 5 tentativi, ogni 3 s
  if (!ON_TV && !/[?&]demo\b/.test(location.search) && ProfiloTV.daChiedereAlServizio(window) && typeof fetch === 'function') {
    (function chiedi(volta) {
      fetch(SERVICE + '/api/tv', { mode: 'no-cors', cache: 'no-store' }).then(function () {
        save('hometv-sul-tv', true);
        if (load('hometv-sul-tv', false)) location.reload();
      }, function () { if (volta < 5) setTimeout(function () { chiedi(volta + 1); }, 3000); });
    })(1);
  }

  /* ------------------------------------------------------------ profilo del TV
   * Il servizio sa del TV (modello, TizenBrew, porte), la pagina sa del suo motore e dello schermo: la pagina gli manda
   * i suoi fatti e riceve il profilo intero. Se il servizio non risponde, il profilo con quello che sa la pagina (lo
   * stesso profilo.js dice cosa manca e cosa fare). */
  var coloriVisti = false;
  function datiPagina() {
    return { ua: navigator.userAgent, larghezza: window.innerWidth, altezza: window.innerHeight,
      chromium: ProfiloTV.daUserAgent(navigator.userAgent).chromium, variabiliCss: MOTORE.variabiliCss, coloriVisti: coloriVisti };
  }
  function profiloTv() {
    var locale = function (e) {
      return ProfiloTV.componi({ servizio: false, nonAutorizzata: !!(e && e.message === 'pagina non autorizzata'), pagina: datiPagina() });
    };
    if (DEMO) return Promise.resolve(locale());
    return service('/api/tv/pagina', datiPagina()).then(null, locale);
  }

  /* ------------------------------------------------------------ avvisi */

  var toastTimer = null;
  // lungo: su piu' righe (per esempio l'autodiagnosi, che dice anche cosa fare)
  function toast(text, ms, lungo) {
    var el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.className = lungo ? 'show lungo' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, ms || 2600);
  }

  /* ------------------------------------------------------------ orologio */

  var GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  var MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

  function saluto() {
    var h = new Date().getHours();
    return h >= 5 && h < 12 ? 'Buongiorno' : h >= 12 && h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  }

  function startClock(onTick) {
    function tick() {
      var d = new Date(), m = d.getMinutes();
      var ora = d.getHours() + ':' + (m < 10 ? '0' : '') + m;
      var data = GIORNI[d.getDay()] + ' ' + d.getDate() + ' ' + MESI[d.getMonth()];
      onTick(ora, data, saluto());
      setTimeout(tick, (60 - d.getSeconds()) * 1000 + 50);
    }
    tick();
  }

  /* ------------------------------------------------------------ tasti
   * Azioni: left right up down ok hold back yellow blue red green play.
   * "hold" = OK tenuto premuto. Funziona solo se il TV invia anche il rilascio
   * del tasto: finche' non lo si vede, OK agisce subito alla pressione.
   */

  var CODES = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok',
    10009: 'back', 27: 'back', 8: 'back',
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
    10252: 'play', 415: 'play', 19: 'play'
  };
  var keyupOk = load('ui-keyup-ok', false);
  var okTimer = null, okHeld = false, okDown = false, okDownAt = 0, lastMove = 0;
  var handlers = [];   // pila: l'ultimo (menu aperto) riceve i tasti
  var HOLD_MS = ProfiloTV.OK_TENUTO_MS; // uguale nei siti (main.js)

  function onKeys(fn) { handlers.push(fn); }
  function pushKeys(fn) { handlers.push(fn); }
  function popKeys(fn) {
    for (var i = handlers.length - 1; i >= 0; i--) if (handlers[i] === fn) { handlers.splice(i, 1); return; }
  }
  function emit(action, ev) {
    var h = handlers[handlers.length - 1];
    if (h) h(action, ev);
  }

  function editing() {
    var a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  document.addEventListener('keydown', function (ev) {
    var action = CODES[ev.keyCode];
    // il telecomando ha i tasti colorati (non lo si puo' chiedere al TV): il profilo lo sa da qui
    if (ev.keyCode >= 403 && ev.keyCode <= 406 && !coloriVisti) {
      coloriVisti = true;
      if (!DEMO) service('/api/tv/pagina', datiPagina()).then(null, function () {});
    }
    if (ev.keyCode === 65376) action = 'done';    // tastiera del TV: Fatto
    if (ev.keyCode === 65385) action = 'cancel';  // tastiera del TV: Annulla
    if (!action) return;
    // puntatore del telefono in vista: OK clicca dove indica, le frecce lo nascondono
    if (pt.on && !editing()) {
      if (action === 'ok') {
        ev.preventDefault();
        // OK tenuto premuto: un clic solo (le ripetizioni del tasto non cliccano di nuovo)
        if (!(okDown && Date.now() - okDownAt < 1500)) clicPuntatore();
        okDown = true;
        okDownAt = Date.now();
        return;
      }
      if (action === 'left' || action === 'right' || action === 'up' || action === 'down') nascondiPuntatore();
    }
    if (editing()) {
      // la ripetizione dell'OK che ha appena aperto la finestra per scrivere non la deve chiudere
      if (action === 'ok' && okDown && Date.now() - okDownAt < 1500) { ev.preventDefault(); okDownAt = Date.now(); return; }
      // mentre si scrive comanda la tastiera; Invio/Fatto/Indietro li gestisce la finestra
      if (action === 'ok' || action === 'done' || action === 'back' || action === 'cancel' || action === 'up' || action === 'down') {
        if (action !== 'back' || ev.keyCode !== 8) { ev.preventDefault(); emit(action === 'ok' ? 'done' : action, ev); }
      }
      return;
    }
    ev.preventDefault();
    if (action === 'ok') {
      // ripetizione del tasto tenuto premuto (come nei siti: una pressione nuova, piu' di 0,7 s dopo, vale anche se il
      // rilascio si e' perso)
      if (okDown && (ev.repeat || Date.now() - okDownAt < 700)) { okDownAt = Date.now(); return; }
      okDown = true;
      okDownAt = Date.now();
      if (!keyupOk) { emit('ok', ev); return; }
      okHeld = false;
      clearTimeout(okTimer);
      okTimer = setTimeout(function () { okTimer = null; okHeld = true; emit('hold', ev); }, HOLD_MS);
      return;
    }
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      var now = Date.now();
      if (now - lastMove < 85) return; // tasto tenuto premuto: niente code di movimenti
      lastMove = now;
    }
    emit(action, ev);
  });

  document.addEventListener('keyup', function (ev) {
    if (ev.keyCode !== 13) return;
    if (editing()) { okDown = false; return; }
    if (!keyupOk) { keyupOk = true; save('ui-keyup-ok', true); okDown = false; return; }
    okDown = false;
    if (okTimer) { clearTimeout(okTimer); okTimer = null; emit('ok', ev); }
  });
  function resetOk() { okDown = false; clearTimeout(okTimer); okTimer = null; }
  window.addEventListener('blur', resetOk);
  document.addEventListener('visibilitychange', resetOk);

  /* ------------------------------------------------------------ menu laterale */

  var sheetKeys = null;

  function closeSheet() {
    var el = $('sheet');
    if (!el) return;
    el.className = '';
    if (sheetKeys) { popKeys(sheetKeys); sheetKeys = null; }
  }

  // opts: { title, subtitle, items: [{ label, value, action, disabled }] }
  function openSheet(opts) {
    var el = $('sheet');
    if (!el) return;
    if (sheetKeys) popKeys(sheetKeys);
    var items = opts.items || [];
    var sel = 0, alto = 0;
    while (sel < items.length - 1 && items[sel].disabled) sel++;

    function draw() {
      var html = '<div class="sheet-head"><h2>' + esc(opts.title || '') + '</h2>' +
        (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '') + '</div><ul>';
      for (var i = 0; i < items.length; i++) {
        html += '<li data-i="' + i + '" class="' + (i === sel ? 'sel' : '') + (items[i].disabled ? ' off' : '') + '">' +
          '<span>' + esc(items[i].label) + '</span>' + (items[i].value ? '<em>' + esc(items[i].value) + '</em>' : '') + '</li>';
      }
      el.innerHTML = html + '</ul>';
      // la voce scelta sempre in vista: l'elenco scorre (le app del TV possono essere 30)
      var ul = el.getElementsByTagName('ul')[0], li = ul ? ul.querySelector('li.sel') : null;
      if (li) {
        var su = li.offsetTop - ul.offsetTop, giu = su + li.offsetHeight;
        if (su < alto) alto = su;
        else if (giu > alto + ul.clientHeight) alto = giu - ul.clientHeight;
        ul.scrollTop = alto;
      }
    }

    function run(i) {
      var it = items[i];
      if (!it || it.disabled) return;
      var keep = it.action ? it.action() : null;
      if (keep === 'keep') draw(); else closeSheet();
    }

    sheetKeys = function (a) {
      if (a === 'up' || a === 'down') {
        var d = a === 'up' ? -1 : 1, n = sel + d;
        while (n >= 0 && n < items.length && items[n].disabled) n += d;
        if (n >= 0 && n < items.length) { sel = n; draw(); }
      } else if (a === 'ok') run(sel);
      else if (a === 'back' || a === 'left' || a === 'hold' || a === 'yellow') closeSheet();
    };
    pushKeys(sheetKeys);
    el.onclick = function (ev) {
      var t = ev.target;
      while (t && t !== el && t.tagName !== 'LI') t = t.parentNode;
      if (t && t.tagName === 'LI') { sel = +t.getAttribute('data-i'); run(sel); }
    };
    draw();
    el.className = 'open';
    return { redraw: draw, close: closeSheet };
  }

  function sheetOpen() { return !!sheetKeys; }

  /* ------------------------------------------------------------ finestra per scrivere */

  var editorKeys = null, editorScrivi = null, editorChiudi = null;

  // opts: { title, value, placeholder, hint, onSave(value) }
  function openEditor(opts) {
    var box = $('editor');
    if (!box) return;
    box.innerHTML = '<div class="editor-card"><h2>' + esc(opts.title) + '</h2>' +
      '<input id="editor-input" type="text" autocomplete="off" spellcheck="false">' +
      '<p>' + esc(opts.hint || 'Scrivi con la tastiera del TV o dal telefono. OK o Fatto per salvare, Indietro per annullare.') + '</p></div>';
    var input = $('editor-input');
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    box.className = 'open';
    var closing = false;

    function close() {
      closing = true;
      editorScrivi = null;
      editorChiudi = null;
      diciCampo(null);
      input.blur();
      box.className = '';
      box.innerHTML = '';
      popKeys(editorKeys);
      editorKeys = null;
    }
    function saveIt() {
      var v = String(input.value || '').replace(/^\s+|\s+$/g, '');
      editorScrivi = null;
      close();
      if (opts.onSave) opts.onSave(v);
    }
    // testo arrivato dal telefono: va nella casella mentre lo scrivi; con Invio si salva
    editorScrivi = function (t, invio) { input.value = t; if (invio !== false) saveIt(); };
    diciCampo({ etichetta: opts.title, valore: input.value });
    editorKeys = function (a) {
      if (a === 'done' || a === 'ok') saveIt();
      else if (a === 'back' || a === 'cancel') close();
      else if (a === 'down' || a === 'up') { /* resta nella casella */ }
    };
    pushKeys(editorKeys);
    editorChiudi = close;
    input.addEventListener('change', function () { if (!closing && editorKeys) saveIt(); });
    setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 30);
  }

  function editorOpen() { return !!editorKeys; }

  // una casella della pagina: quando ci si scrive il telefono lo sa
  function campoPerTelefono(input, etichetta) {
    input.addEventListener('focus', function () { diciCampo({ etichetta: etichetta, valore: input.value }); });
    input.addEventListener('blur', function () { diciCampo(null); });
  }

  // il telefono collegato sa che sul TV si sta scrivendo (e cosa): propone di scrivere da li'
  function diciCampo(campo) {
    if (DEMO) return;
    var corpo = campo ? { attivo: true, etichetta: String(campo.etichetta || ''), valore: String(campo.valore || ''), tipo: 'text' } : { attivo: false };
    service('/api/telefono/campo', corpo).then(null, function () {});
  }

  /* ------------------------------------------------------------ comandi dal telefono
   * Il servizio del TV tiene aperta la richiesta finche' il telefono manda
   * qualcosa: i tasti arrivano come quelli del telecomando, il testo va nella
   * finestra per scrivere (se aperta) o alla pagina, link e "home" alla pagina.
   */

  /* ------------------------------------------------------------ puntatore (trackpad del telefono)
   * Come nei siti: il dito sul telefono muove un puntatore, il tocco clicca. Qui un clic apre
   * subito quello che indichi (col mouse il primo clic seleziona); due dita scorrono file ed
   * elenchi come le frecce. Le frecce lo nascondono; OK, mentre si vede, clicca dove indica.
   */
  var PT_RIF = 1920;
  var pt = { x: -1, y: -1, mx: 0, my: 0, el: null, tocco: null, raf: 0, t: 0, on: false, mano: false, nascondi: null,
    sopra: null, sopraAt: 0, sottoDetto: '', sx: 0, sy: 0 };
  var SEL_PT = '.tile, .set-row, .h-row, #sheet li, #gear, #homebtn, #search, button, a[href], input, textarea, [data-scrive]';
  var CSS_PT = '#ui-puntatore{position:fixed;left:0;top:0;width:46px;height:56px;margin:-3px 0 0 -5px;z-index:2147483647;' +
    'pointer-events:none;opacity:0;transition:opacity .2s ease;will-change:transform}#ui-puntatore.on{opacity:1}' +
    '#ui-puntatore svg{display:block;width:100%;height:100%;overflow:visible}#ui-puntatore .hp-ombra{fill:rgba(0,0,0,.4)}' +
    '#ui-puntatore .hp-freccia{fill:#fff;stroke:#0b0c10;stroke-width:1.5;stroke-linejoin:round}' +
    '#ui-puntatore.mano .hp-freccia{fill:url(#ui-colori-p);stroke:#fff}' +
    '.pt-sopra:not(.tile){box-shadow:0 0 0 .3rem #fff,0 0 0 .7rem rgba(59,130,246,.8)!important}' +
    '#ui-tocco{position:fixed;left:0;top:0;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:50%;z-index:2147483647;' +
    'pointer-events:none;box-sizing:border-box;border:4px solid #3b82f6;opacity:0}#ui-tocco.on{animation:ui-tocco .4s ease-out}' +
    '@keyframes ui-tocco{0%{opacity:.95;transform:scale(.25)}100%{opacity:0;transform:scale(1.3)}}';
  var SVG_PT = '<svg viewBox="0 0 28 34"><defs><linearGradient id="ui-colori-p" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#19d3b7"/><stop offset=".55" stop-color="#3b82f6"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>' +
    '<path class="hp-ombra" d="M4.6 3.6v23l6-5.5 4.2 9.5 4.4-2-4.1-9.2h8z"/><path class="hp-freccia" d="M3 2v23l6-5.5 4.2 9.5 4.4-2-4.1-9.2h8z"/></svg>';

  function mostraPuntatore() {
    if (!document.body) return false;
    if (!pt.el) {
      var st = document.createElement('style');
      st.textContent = CSS_PT;
      (document.head || document.body).appendChild(st);
      pt.el = document.createElement('div');
      pt.el.id = 'ui-puntatore';
      pt.el.innerHTML = SVG_PT;
      document.body.appendChild(pt.el);
    }
    if (pt.x < 0) { pt.x = pt.mx = Math.round(window.innerWidth / 2); pt.y = pt.my = Math.round(window.innerHeight / 2); }
    if (!pt.on) { pt.on = true; disegnaPuntatore(); document.documentElement.classList.add('ui-pt-on'); }
    var cl = 'on' + (pt.mano ? ' mano' : '');
    if (pt.el.className !== cl) pt.el.className = cl;
    clearTimeout(pt.nascondi);
    pt.nascondi = setTimeout(nascondiPuntatore, 20000);
    return true;
  }
  function nascondiPuntatore() {
    clearTimeout(pt.nascondi);
    if (!pt.on) return;
    pt.on = false;
    pt.el.className = '';
    fermaBordo();
    document.documentElement.classList.remove('ui-pt-on');
    sopraA(null);
  }
  function disegnaPuntatore() {
    if (pt.el) pt.el.style.transform = 'translate3d(' + pt.mx.toFixed(1) + 'px,' + pt.my.toFixed(1) + 'px,0)';
  }
  function muoviPuntatore(dx, dy) {
    if (!mostraPuntatore()) return;
    var w = window.innerWidth, h = window.innerHeight, k = w / PT_RIF;
    var nx = pt.x + dx * k, ny = pt.y + dy * k;
    var oltre = ny < 0 ? ny : (ny > h - 1 ? ny - (h - 1) : 0);
    var oltreX = nx < 0 ? nx : (nx > w - 1 ? nx - (w - 1) : 0);
    pt.x = Math.max(0, Math.min(w - 1, nx));
    pt.y = Math.max(0, Math.min(h - 1, ny));
    bordo.vivo = Date.now();
    // spinto oltre il bordo: in alto e in basso cambia fila (la fila che scorre dal lato continua), a destra e a sinistra
    // scorre la fila sotto il puntatore
    if (oltre) scorriPuntatore(0, oltre / k, true);
    if (oltreX) scorriAlBordo(oltreX > 0 ? 1 : -1);
    else if (lontanoDalBordo(nx, w)) fermaBordo(); // un dito che trema non la ferma: solo tornare indietro davvero
    avviaPuntatore();
  }
  // contro il bordo destro o sinistro: la fila sotto va subito avanti di una scheda e, finche' il dito resta sul trackpad
  // (anche fermo, anche se trema un po'), continua da sola (prima piano, poi un po' piu' svelta); si ferma alzando il
  // dito, tornando indietro davvero col puntatore o se il telefono non da' piu' segni per 3 s
  var bordo = { verso: 0, timer: null, passi: 0, vivo: 0, y: 0 };
  // tornato indietro davvero: piu' del 4% dello schermo (un dito fermo che spinge si muove sempre un po')
  function lontanoDalBordo(x, w) { return bordo.verso > 0 ? x < (w - 1) * 0.96 : bordo.verso < 0 ? x > (w - 1) * 0.04 : true; }
  function scorriAlBordo(verso) {
    if (bordo.verso === verso && bordo.timer) return; // sta gia' scorrendo da quella parte
    fermaBordo();
    bordo.verso = verso;
    bordo.passi = 0;
    (function passo() {
      var w = window.innerWidth;
      // 3 s senza segni dal telefono (col dito giu' ne arriva uno ogni 0,8 s): il "dito alzato" si e' perso
      if (!pt.on || lontanoDalBordo(pt.x, w) || Date.now() - bordo.vivo > 3000) { fermaBordo(); return; }
      // solo sopra una fila di schede, e mai con un menu o una finestra aperti (nelle Impostazioni destra e sinistra
      // cambierebbero la voce scelta): intanto si aspetta, il dito puo' arrivare su una fila
      var sotto = handlers.length > 1 ? null : sottoAllaFila(verso);
      if (!(sotto && sotto.closest && sotto.closest('.tile'))) { bordo.timer = setTimeout(passo, 280); return; }
      // la fila si sceglie al primo passo o se il puntatore e' passato a un'altra; poi resta quella (le file salgono e
      // scendono sotto il puntatore fermo: se no si salterebbe di fila)
      var nuova = !bordo.passi || Math.abs(pt.y - bordo.y) > 40;
      if (nuova) bordo.y = pt.y;
      scorriPuntatore(verso * PASSO_UI, 0, true, nuova);
      bordo.passi++;
      setTimeout(function () { try { sopraAlPunto(true); } catch (e) {} }, 260); // la scheda che ora e' sotto il puntatore
      bordo.timer = setTimeout(passo, bordo.passi < 3 ? 450 : 280);
    })();
  }
  function fermaBordo() { clearTimeout(bordo.timer); bordo.timer = null; bordo.verso = 0; }
  function avviaPuntatore() {
    if (pt.raf) return;
    pt.t = 0;
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    (function passo() {
      var ora = Date.now(), dt = pt.t ? Math.max(1, Math.min(64, ora - pt.t)) : 16;
      pt.t = ora;
      var a = 1 - Math.exp(-dt / 24);
      pt.mx += (pt.x - pt.mx) * a;
      pt.my += (pt.y - pt.my) * a;
      var fermo = Math.abs(pt.x - pt.mx) < 0.5 && Math.abs(pt.y - pt.my) < 0.5;
      if (fermo) { pt.mx = pt.x; pt.my = pt.y; }
      disegnaPuntatore();
      try { sopraAlPunto(fermo); } catch (e) {}
      pt.raf = fermo ? 0 : raf(passo);
    })();
  }
  function sopraAlPunto(forza) {
    var ora = Date.now();
    if (!forza && ora - pt.sopraAt < 60) return;
    pt.sopraAt = ora;
    var el = null;
    try { el = document.elementFromPoint(pt.mx, pt.my); } catch (e) {}
    var b = el && el.closest ? el.closest(SEL_PT) : null;
    if (b && b.tagName === 'INPUT' && b.parentNode && b.parentNode.id === 'search') b = b.parentNode;
    sopraA(b);
  }
  // quello che indichi si illumina
  function sopraA(b) {
    if (b === pt.sopra) return;
    if (pt.sopra) pt.sopra.classList.remove('pt-sopra');
    pt.sopra = b;
    if (b) b.classList.add('pt-sopra');
    pt.mano = !!b;
    if (pt.el && pt.on) pt.el.className = 'on' + (b ? ' mano' : '');
    diciSotto(b);
    // la pagina lo sa (la home mostra nel titolo grande la scheda indicata)
    try { (b || document).dispatchEvent(new CustomEvent('hometvsopra', { bubbles: true })); } catch (e) {}
  }
  // il telefono sa se il puntatore e' sopra un posto dove si scrive: al tocco apre la sua tastiera
  function diciSotto(b) {
    var stato = { campo: false };
    if (b) {
      var inp = b.tagName === 'INPUT' || b.tagName === 'TEXTAREA' ? b : (b.id === 'search' ? b.querySelector('input') : null);
      if (inp && !inp.readOnly && !inp.disabled) stato = { campo: true, etichetta: inp.getAttribute('aria-label') || inp.placeholder || 'Scrivi', tipo: 'text' };
      else if (b.getAttribute('data-scrive')) stato = { campo: true, etichetta: b.getAttribute('data-scrive'), tipo: 'text' };
    }
    var firma = stato.campo ? stato.etichetta : '';
    if (firma === pt.sottoDetto) return;
    pt.sottoDetto = firma;
    if (!DEMO) service('/api/telefono/sotto', stato).then(null, function () {});
  }
  function clicPuntatore() {
    if (!mostraPuntatore()) return;
    pt.mx = pt.x; pt.my = pt.y;
    disegnaPuntatore();
    var x = pt.x, y = pt.y, el = null, ev;
    toccoVisibile(x, y);
    try { el = document.elementFromPoint(x, y); } catch (e) {}
    if (!el) return;
    sopraAlPunto(true);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { try { el.focus(); } catch (e) {} }
    try { ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, detail: 1 }); }
    catch (e) { ev = document.createEvent('MouseEvents'); ev.initMouseEvent('click', true, true, window, 1, x, y, x, y, false, false, false, false, 0, null); }
    ev.hometvPuntatore = true; // la home apre subito quello che indichi
    el.dispatchEvent(ev);
  }
  // tocco lungo sul trackpad: come il tasto destro del mouse proprio li' (nella home: il menu della scheda)
  function menuPuntatore() {
    if (!mostraPuntatore()) return;
    var el = null;
    try { el = document.elementFromPoint(pt.x, pt.y); } catch (e) {}
    if (!el) return;
    toccoVisibile(pt.x, pt.y);
    try { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y, button: 2, buttons: 2 })); } catch (e) {}
  }
  function toccoVisibile(x, y) {
    if (!pt.tocco) { pt.tocco = document.createElement('div'); pt.tocco.id = 'ui-tocco'; document.body.appendChild(pt.tocco); }
    pt.tocco.style.left = x + 'px';
    pt.tocco.style.top = y + 'px';
    pt.tocco.className = '';
    void pt.tocco.offsetWidth;
    pt.tocco.className = 'on';
  }
  // due dita: come le frecce, un passo ogni tanto (file della home, impostazioni, elenchi)
  var PASSO_UI = 110; // una voce ogni ~9 cm di dito (come i telecomandi a sfioramento)
  // la scheda all'altezza del puntatore (sul bordo dello schermo spesso c'e' il vuoto tra le schede: si guarda verso il centro)
  function sottoAllaFila(dx) {
    var w = window.innerWidth, prove = [pt.x, dx > 0 ? w - 160 : 160, w / 2], primo = null;
    for (var i = 0; i < prove.length; i++) {
      var el = null;
      try { el = document.elementFromPoint(prove[i], pt.y); } catch (e) {}
      if (!primo) primo = el;
      if (el && el.closest && el.closest('.tile')) return el;
    }
    return primo;
  }
  function scorriPuntatore(dx, dy, dalBordo, filaNuova) {
    if (!mostraPuntatore()) return;
    var PASSO = PASSO_UI, ora = Date.now();
    if (!dalBordo) fermaBordo();
    // gesto nuovo: la pagina sa dove e' il puntatore (in orizzontale scorre la fila che c'e' sotto). Per il bordo che
    // scorre di lato lo dice lui (filaNuova)
    if (dalBordo && dx ? filaNuova : ora - (pt.scorriAt || 0) > 400) {
      pt.sx = 0; pt.sy = 0;
      var sotto = Math.abs(dx) > Math.abs(dy) ? sottoAllaFila(dx) : null;
      if (!sotto) { try { sotto = document.elementFromPoint(pt.x, pt.y); } catch (e) {} }
      if (sotto) { try { sotto.dispatchEvent(new CustomEvent('hometvscorri', { bubbles: true, detail: { dx: dx, dy: dy } })); } catch (e) {} }
    }
    // la spinta in alto o in basso si somma solo per poco: un resto vecchio piu' un tremolio non cambiano fila dopo
    if (dy && ora - (pt.syAt || 0) > 400) pt.sy = 0;
    if (dy) pt.syAt = ora;
    pt.scorriAt = ora;
    // un pezzo solo (un tocco sulla striscia, o tanti movimenti arrivati insieme) vale al massimo un passo
    pt.sx += Math.max(-PASSO, Math.min(PASSO, dx)); pt.sy += Math.max(-PASSO, Math.min(PASSO, dy));
    while (Math.abs(pt.sy) >= PASSO) { emit(pt.sy > 0 ? 'down' : 'up', null); pt.sy -= pt.sy > 0 ? PASSO : -PASSO; }
    while (Math.abs(pt.sx) >= PASSO) { emit(pt.sx > 0 ? 'right' : 'left', null); pt.sx -= pt.sx > 0 ? PASSO : -PASSO; }
  }
  function comandoPuntatore(e) {
    var az = e && e.azione;
    if (az === 'muovi') muoviPuntatore(Number(e.dx) || 0, Number(e.dy) || 0);
    else if (az === 'scorri') scorriPuntatore(Number(e.dx) || 0, Number(e.dy) || 0);
    else if (az === 'clic') clicPuntatore();
    else if (az === 'tieni') menuPuntatore();
    else if (az === 'fine') fermaBordo(); // il dito si e' alzato dal trackpad: la fila smette di scorrere dal bordo
    else if (az === 'vivo') bordo.vivo = Date.now(); // il dito e' ancora giu'
    else if (az === 'mostra') { if (mostraPuntatore()) avviaPuntatore(); }
    else if (az === 'nascondi') nascondiPuntatore();
  }

  var DAL_TELEFONO = { su: 'up', giu: 'down', sx: 'left', dx: 'right', ok: 'ok', tieni: 'hold', indietro: 'back',
    rosso: 'red', verde: 'green', giallo: 'yellow', blu: 'blue', playpausa: 'play' };

  // gestori: { testo(t), link(url), sito(url), home() }
  function ascoltaTelefono(dove, gestori) {
    if (DEMO || typeof fetch !== 'function') return;
    gestori = gestori || {};
    var seq = -1, inCorso = false, giroN = 0, partito = 0, richiesta = null;
    function esegui(e) {
      if (e.tipo === 'tasto') {
        var a = DAL_TELEFONO[e.tasto];
        if (!a) return;
        if (pt.on && (a === 'up' || a === 'down' || a === 'left' || a === 'right')) nascondiPuntatore();
        if (editing() && a === 'ok') a = 'done';
        emit(a, null);
      } else if (e.tipo === 'puntatore') {
        comandoPuntatore(e);
      } else if (e.tipo === 'testo') {
        if (editorScrivi) editorScrivi(String(e.testo || ''), e.invio !== false);
        else if (gestori.testo) gestori.testo(String(e.testo || ''), e.invio !== false);
      } else if (e.tipo === 'link') {
        if (!validUrl(e.url)) return;
        // con la finestra per scrivere aperta (per esempio "Link del sito") il link va li' dentro (un video si apre sempre)
        if (editorScrivi && !e.riproduci) editorScrivi(e.url);
        else if (gestori.link) gestori.link(e.url); else location.href = e.url;
      } else if (e.tipo === 'sito') {
        if (validUrl(e.url) && gestori.sito) gestori.sito(e.url);
      } else if (e.tipo === 'home') {
        if (sheetKeys) closeSheet();
        if (gestori.home) gestori.home();
      } else if (e.tipo === 'schede' || e.tipo === 'nuovaScheda') {
        // le schede del browser (dal telefono): la galleria, o una scheda nuova
        if (sheetKeys) closeSheet();
        if (gestori.schede) gestori.schede(e.tipo === 'nuovaScheda');
        else location.href = 'browser.html#' + (e.tipo === 'nuovaScheda' ? 'nuova' : 'schede');
      }
    }
    function giro() {
      if (document.hidden) { inCorso = false; return; }
      var mio = ++giroN;
      inCorso = true;
      partito = Date.now();
      richiesta = MOTORE.abort ? new AbortController() : null;
      fetch(SERVICE + '/api/telefono/eventi?da=' + seq + '&dove=' + encodeURIComponent(dove),
        richiesta ? { cache: 'no-store', signal: richiesta.signal } : { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (mio !== giroN) return;
          if (j && typeof j.seq === 'number') seq = j.seq;
          var ev = (j && j.eventi) || [], veloce = false;
          for (var i = 0; i < ev.length; i++) {
            if (ev[i] && ev[i].tipo === 'puntatore') veloce = true;
            try { esegui(ev[i]); } catch (x) {}
          }
          setTimeout(giro, veloce ? 0 : 30); // col trackpad si richiede subito
        })['catch'](function () { if (mio === giroN) setTimeout(giro, 5000); });
    }
    // una richiesta rimasta appesa (pagina rimessa dalla cache del browser, rete) si sostituisce
    function riparti() { if (!document.hidden && (!inCorso || Date.now() - partito > 40000)) giro(); }
    // TV in un'altra app: la richiesta si chiude subito, cosi' link, testo e tasti del telefono vanno all'app davanti
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { riparti(); return; }
      giroN++;
      inCorso = false;
      if (richiesta) { try { richiesta.abort(); } catch (e) {} richiesta = null; }
    });
    window.addEventListener('pageshow', function (ev) { if (ev.persisted) { inCorso = false; riparti(); } });
    setInterval(riparti, 10000);
    giro();
  }

  /* ------------------------------------------------------------ dimensione: 1rem = 10px a 1920 */

  function fitScreen() {
    var w = window.innerWidth || 1920, h = window.innerHeight || 1080;
    document.documentElement.style.fontSize = (10 * Math.min(w / 1920, h / 1080)) + 'px';
  }

  function rem() { return parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 10; }

  function setTransform(el, v) {
    el.style.webkitTransform = v;
    el.style.transform = v;
  }

  return {
    SERVICE: SERVICE, ON_TV: ON_TV, DEMO: DEMO, preferitiIniziali: preferitiIniziali, preferitiBrowser: preferitiBrowser,
    $: $, load: load, save: save, esc: esc, hostOf: hostOf, validUrl: validUrl, hash: hash,
    service: service, iconUrl: iconUrl, profiloTv: profiloTv, toast: toast, startClock: startClock, saluto: saluto, campoPerTelefono: campoPerTelefono,
    onKeys: onKeys, pushKeys: pushKeys, popKeys: popKeys,
    openSheet: openSheet, closeSheet: closeSheet, sheetOpen: sheetOpen,
    openEditor: openEditor, editorOpen: editorOpen, closeEditor: function () { if (editorChiudi) editorChiudi(); }, ascoltaTelefono: ascoltaTelefono,
    fitScreen: fitScreen, rem: rem, setTransform: setTransform
  };
})();
