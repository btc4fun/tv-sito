/*
 * Home TV - DATI DELLO STORE: il catalogo ufficiale e "Le mie app".
 *
 * Due liste che non si toccano mai: sono due istanze diverse, ognuna con le sue chiavi del local storage. La lista
 * ufficiale legge solo il catalogo dell'account della home (<account>.github.io/tv-store/catalogo.json) e le sue app
 * stanno sullo stesso account; quella privata ("Le mie app") ha solo le fonti aggiunte da chi usa questo TV, che non
 * escono mai dal TV. Qui solo dati: niente pagina e niente tasti (li usano index.html e store.html).
 *
 * Ogni testo che arriva da un catalogo si controlla qui e poi si mostra solo come testo (UI.esc): un catalogo privato
 * lo puo' scrivere chiunque.
 * Leggero: le liste si leggono dalla memoria una volta per pagina e poi si usa la copia; il catalogo si riscrive solo se
 * e' cambiato (sui TV vecchi leggere e scrivere testi grandi costa).
 * Solo JavaScript ES5 e solo ASCII: gira dal Chromium 47 dei TV 2017.
 */
var StoreDati = (function () {
  'use strict';

  var FORMATO = 1; // il formato del catalogo che questa home sa leggere
  var CATEGORIE = ['film', 'video', 'sport', 'giochi', 'strumenti', 'altre']; // le file della home (home.js)
  // i permessi che un'app ufficiale puo' chiedere nel catalogo (store.js li da' con un gettone del servizio)
  var PERMESSI_NOTI = { video: true };
  // le funzioni del servizio del TV che un'app puo' chiedere nel catalogo ("richiede": { video: 1 }): nome e versione
  var FUNZIONE = /^[a-z][a-z0-9]{1,23}$/, MAX_RICHIEDE = 8;
  // cambia quando cambia come si legge una voce: il catalogo gia' salvato si rilegge anche se il testo e' lo stesso
  var LETTURA = 2;
  var TITOLI = { film: 'Film e serie', video: 'Video e musica', sport: 'Sport', giochi: 'Giochi', strumenti: 'Strumenti', altre: 'Altre app' };
  var MAX_APP = 200, MAX_MIE = 300, MAX_FONTI = 50, MAX_BYTE = 300000, TEMPO_MS = 8000;
  var VECCHIO_UFFICIALE = 10 * 60 * 1000;  // il catalogo ufficiale si riscarica dopo 10 minuti
  var VECCHIO_FONTI = 24 * 3600 * 1000;    // le fonti private una volta al giorno
  var RIPROVA_MS = 60 * 1000;              // dopo un tentativo fallito si aspetta un minuto
  var MAX_DATI_APP = 64 * 1024, MAX_DATI_TUTTE = 1024 * 1024; // memoria delle app (in comune con la home)
  var MAX_MIE_BYTE = 256 * 1024; // la lista privata intera: la memoria e' in comune con la home
  var PREFISSO_DATI = 'tvh-app-';
  var K_UFFICIALE = 'tvh-store', K_UFFICIALE_APP = 'tvh-store-app', K_MIE = 'tvh-mie';
  var ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

  // la pagina sul TV dice come scaricare tramite il servizio del TV (siti che non lo permettono, certificati nuovi)
  var ambiente = { servizio: null };
  function imposta(o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ambiente[k] = o[k]; }

  /* ------------------------------------------------------------ memoria */

  // ogni chiave si legge (e si decodifica) una volta per pagina, poi si usa la copia: le scritture passano tutte da qui
  var gia = {}, pesi = null;
  function leggi(k) {
    if (Object.prototype.hasOwnProperty.call(gia, k)) return gia[k];
    var v = null;
    try { var t = localStorage.getItem(k); v = t ? JSON.parse(t) : null; } catch (e) { v = null; }
    gia[k] = v;
    return v;
  }
  // false = non salvato (memoria piena o bloccata, o piu' di max caratteri): chi chiama lo dice, non lo nasconde; la
  // copia si dimentica, cosi' la prossima lettura e' quella vera
  var oltre = false; // l'ultima scrittura rifiutata perche' oltre il suo limite (non per la memoria piena)
  function scrivi(k, v, max) {
    oltre = false;
    try {
      var t = JSON.stringify(v);
      if (max && t.length > max) { oltre = true; delete gia[k]; return false; }
      localStorage.setItem(k, t);
      gia[k] = v;
      return true;
    } catch (e) { delete gia[k]; return false; }
  }
  function togli(k) {
    delete gia[k];
    if (pesi) delete pesi[k];
    try { localStorage.removeItem(k); } catch (e) {}
  }
  // un'altra pagina ha cambiato la memoria: le copie non valgono piu'
  try {
    window.addEventListener('storage', function (e) {
      if (e && e.key) delete gia[e.key]; else gia = {};
      pesi = null;
      if (!e || !e.key || e.key === K_SERVIZIO) funzioniOra = undefined;
    });
  } catch (e) {}
  function hash(s, seme) {
    var h = seme || 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  // una richiesta che non risponde in tempo vale come "offline" (il servizio del TV non ha un suo limite)
  function conTempo(p, ms) {
    return new Promise(function (ok, ko) {
      var t = setTimeout(function () { ko(new Error('offline')); }, ms);
      p.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); ko(e); });
    });
  }

  /* ------------------------------------------------------------ versioni e indirizzi */

  // '1.10.0' contro '1.9.0': 1 se a e' piu' nuova, -1 se piu' vecchia, 0 se uguali
  function confronta(a, b) {
    var x = String(a || '0').split('.'), y = String(b || '0').split('.');
    for (var i = 0; i < 3; i++) {
      var p = parseInt(x[i], 10) || 0, q = parseInt(y[i], 10) || 0;
      if (p !== q) return p > q ? 1 : -1;
    }
    return 0;
  }
  function assoluto(rel, base) { try { return new URL(rel, base).href; } catch (e) { return ''; } }
  // protocollo e sito di un indirizzo; null se ha "utente@" davanti al sito (un trucco per sembrare un altro sito)
  function parti(u) {
    var m = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]+)/i.exec(u || '');
    if (!m || m[2].indexOf('@') !== -1) return null;
    return { protocollo: m[1].toLowerCase(), host: m[2].toLowerCase() };
  }
  // indirizzi del TV o della rete di casa: mai (ne' come fonte ne' come app)
  function locale(h) {
    h = String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    return !h || h === 'localhost' || /\.(localhost|local|lan|home|internal|arpa)$/.test(h) || /^[0-9x.]+$/.test(h) ||
      h.indexOf(':') !== -1 || h.charAt(0) === '[' || h.indexOf('.') === -1;
  }
  function sitoHome() { try { return String(location.host || '').toLowerCase(); } catch (e) { return ''; } }
  // un indirizzo di un catalogo (anche relativo). Ufficiale: sullo stesso sito del catalogo (un catalogo non punta mai a
  // un altro account). Privato: qualsiasi https, tranne gli indirizzi locali e il sito della home (le app di quell'account
  // stanno nello Store ufficiale: sul sito della home un'app avrebbe accesso a tutto)
  function indirizzo(v, base, stessoSito) {
    if (typeof v !== 'string' || !v || v.length > 500) return '';
    var u = assoluto(v, base), p = parti(u), b = parti(base);
    if (!p || !b) return '';
    if (stessoSito) return p.protocollo === b.protocollo && p.host === b.host && /^https?$/.test(p.protocollo) ? u : '';
    return p.protocollo === 'https' && !locale(p.host) && p.host !== sitoHome() ? u : '';
  }

  /* ------------------------------------------------------------ controllo del catalogo */

  // solo testo, senza caratteri di controllo e non oltre max (i testi di un catalogo privato non sono fidati)
  function testo(v, max) {
    if (typeof v !== 'string') return '';
    v = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/^\s+|\s+$/g, '');
    return v.length > max ? v.slice(0, max - 1) + '\u2026' : v;
  }
  // una voce: tutto controllato, i campi in piu' ignorati. null = voce sbagliata (si salta, le altre restano)
  function controllaVoce(v, base, stessoSito) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var id = typeof v.id === 'string' && ID.test(v.id) ? v.id : '';
    var nome = testo(v.nome, 40);
    var ver = typeof v.versione === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v.versione) ? v.versione : '';
    var url = indirizzo(v.url, base, stessoSito);
    if (!id || !nome || !ver || !url) return null;
    var req = [];
    if (v.requisiti !== undefined) {
      if (!Array.isArray(v.requisiti) || v.requisiti.length > 10) return null;
      for (var i = 0; i < v.requisiti.length; i++) {
        if (typeof v.requisiti[i] !== 'string' || !/^[A-Za-z0-9]{1,24}$/.test(v.requisiti[i])) return null;
        req.push(v.requisiti[i]);
      }
    }
    // i permessi (per ora "video": le chiavette attaccate al TV): solo dal catalogo ufficiale e solo quelli che la home
    // conosce. Un catalogo privato non ne da' mai, qualunque cosa scriva
    var perm = [];
    if (stessoSito && Array.isArray(v.permessi)) {
      for (var k = 0; k < v.permessi.length && k < 8; k++) {
        if (PERMESSI_NOTI[v.permessi[k]] === true && perm.indexOf(v.permessi[k]) === -1) perm.push(v.permessi[k]);
      }
    }
    // cosa deve saper fare il servizio del TV: le sue "funzioni" (GET /api/status, docs/contratto-servizio.md), per
    // esempio { video: 1 }. Puo' solo spegnere l'app sui TV che non le hanno, mai dare qualcosa: vale anche per le private
    var ric = null;
    if (v.richiede !== undefined) {
      if (!v.richiede || typeof v.richiede !== 'object' || Array.isArray(v.richiede)) return null;
      ric = {};
      var nr = 0;
      for (var f in v.richiede) {
        if (!Object.prototype.hasOwnProperty.call(v.richiede, f)) continue;
        if (++nr > MAX_RICHIEDE || !FUNZIONE.test(f) || !versioneFunzione(v.richiede[f])) return null;
        ric[f] = v.richiede[f];
      }
    }
    var out = {
      id: id, nome: nome, descrizione: testo(v.descrizione, 400), novita: testo(v.novita, 200), autore: testo(v.autore, 40),
      versione: ver, categoria: CATEGORIE.indexOf(v.categoria) !== -1 ? v.categoria : 'altre', url: url,
      icona: indirizzo(v.icona, base, stessoSito), copertina: indirizzo(v.copertina, base, stessoSito), requisiti: req,
      ritirata: v.ritirata === true, evidenza: v.evidenza === true, permessi: perm
    };
    if (ric) out.richiede = ric; // solo se c'e': le liste salvate (Le mie app) non crescono per niente
    return out;
  }
  function versioneFunzione(x) { return typeof x === 'number' && x >= 1 && x <= 999 && x % 1 === 0; }
  // il catalogo intero: { esito: 'ok' | 'nonValido' | 'formatoNuovo', nome, app, scartate }
  function catalogoDa(d, base, stessoSito) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { esito: 'nonValido' };
    var f = d.formato === undefined ? 1 : d.formato;
    if (typeof f !== 'number' || f < 1 || f % 1) return { esito: 'nonValido' };
    if (f > FORMATO) return { esito: 'formatoNuovo' };
    if (!Array.isArray(d.app)) return { esito: 'nonValido' };
    var out = [], visti = {}, scartate = 0;
    for (var i = 0; i < d.app.length; i++) {
      var v = out.length < MAX_APP ? controllaVoce(d.app[i], base, stessoSito) : null;
      if (!v || visti[v.id]) { scartate++; continue; }
      visti[v.id] = 1;
      out.push(v);
    }
    return { esito: 'ok', nome: testo(d.nome, 40), app: out, scartate: scartate };
  }
  function leggiCatalogo(t, base, stessoSito) {
    var d;
    try { d = JSON.parse(t); } catch (e) { return { esito: 'nonValido' }; }
    return catalogoDa(d, base, stessoSito);
  }

  /* ------------------------------------------------------------ cosa sa fare il servizio di questo TV
   * GET /api/status dice le "funzioni" del servizio, con la loro versione (docs/contratto-servizio.md): { video: 1 } sui
   * Samsung, niente dove l'app Video non c'e' ancora (Android, Fire TV, LG). La pagina passa qui la risposta (servizio) e
   * la si ricorda per la prossima volta. Finche' non si sa (anteprima sul computer, prima volta, servizio che non
   * risponde) le app si mostrano come sempre: "richiede" spegne un'app solo quando il servizio ha detto che non c'e' */
  var K_SERVIZIO = 'tvh-servizio', funzioniOra; // undefined = da leggere dalla memoria; null = non si sa
  function funzioniDa(s) {
    // senza api: un servizio di prima del contratto (o una risposta strana), non si sa
    if (!s || typeof s !== 'object' || typeof s.api !== 'number') return null;
    var out = {}, f = s.funzioni;
    if (f && typeof f === 'object' && !Array.isArray(f)) {
      for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k) && FUNZIONE.test(k) && versioneFunzione(f[k])) out[k] = f[k];
    } else if (f === undefined && s.piattaforma === 'tizen' && s.api >= 3) out.video = 1; // api 3 senza "funzioni" (30/10/2026)
    if (versioneFunzione(s.api)) out.api = s.api; // la versione del contratto vale come una funzione: "richiede": { api: 3 }
    return out;
  }
  function funzioni() {
    if (funzioniOra === undefined) {
      var m = leggi(K_SERVIZIO);
      funzioniOra = m && m.v === 1 && m.funzioni && typeof m.funzioni === 'object' && !Array.isArray(m.funzioni) ? m.funzioni : null;
    }
    return funzioniOra;
  }
  // la risposta di GET /api/status: true = e' cambiato cosa va su questo TV (la pagina ridisegna)
  function servizio(s) {
    var f = funzioniDa(s);
    if (!f || JSON.stringify(f) === JSON.stringify(funzioni())) return false;
    funzioniOra = f;
    scrivi(K_SERVIZIO, { v: 1, funzioni: f });
    return true;
  }

  // l'app va su questo TV? '' = si'. Se no, perche': 'motore' = il motore web non ha quello che chiede ("requisiti":
  // capacita' del motore, profilo.js; mai l'anno o il modello; non cambiera'), 'servizio' = il servizio del TV non ha una
  // funzione che chiede ("richiede": su questo TV non c'e' ancora), 'vecchio' = ce l'ha, ma di una versione di prima (sui
  // Samsung il servizio nuovo parte riavviando il TV)
  var capacita = null;
  function perche(v) {
    if (!v) return 'motore';
    if (v.requisiti && v.requisiti.length) {
      if (!capacita) {
        try { capacita = typeof ProfiloTV !== 'undefined' ? ProfiloTV.motore(window) : {}; } catch (e) { capacita = {}; }
      }
      for (var i = 0; i < v.requisiti.length; i++) if (capacita[v.requisiti[i]] !== true) return 'motore';
    }
    var r = v.richiede, f = r ? funzioni() : null, vecchia = false;
    if (!f) return '';
    for (var k in r) {
      if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(f, k)) return 'servizio';
      if (f[k] < r[k]) vecchia = true;
    }
    return vecchia ? 'vecchio' : '';
  }
  function adatta(v) { return !perche(v); }

  /* ------------------------------------------------------------ cercare nello Store */

  // minuscole e senza accenti: "Citta'" trova "citta"
  function piano(s) {
    return String(s || '').toLowerCase().replace(/[\u00e0-\u00e5]/g, 'a').replace(/[\u00e8-\u00eb]/g, 'e')
      .replace(/[\u00ec-\u00ef]/g, 'i').replace(/[\u00f2-\u00f6]/g, 'o').replace(/[\u00f9-\u00fc]/g, 'u')
      .replace(/\u00e7/g, 'c').replace(/\u00f1/g, 'n').replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
  }
  // le voci che contengono tutte le parole cercate: prima chi ha il nome che comincia cosi', poi una parola del nome,
  // poi il nome che la contiene, poi la descrizione, l'autore o la categoria
  function cercaApp(domanda, voci) {
    var parole = piano(domanda).split(' ').filter(function (p) { return !!p; });
    if (!parole.length) return [];
    var trovate = [];
    for (var i = 0; i < voci.length; i++) {
      var v = voci[i], nome = piano(v.nome), resto = piano([v.descrizione, v.autore, TITOLI[v.categoria] || ''].join(' '));
      var punti = 0, ok = true;
      for (var j = 0; j < parole.length && ok; j++) {
        var p = parole[j];
        if (nome.indexOf(p) === 0) punti += 0;
        else if ((' ' + nome).indexOf(' ' + p) !== -1) punti += 1;
        else if (nome.indexOf(p) !== -1) punti += 2;
        else if (resto.indexOf(p) !== -1) punti += 4;
        else ok = false;
      }
      if (ok) trovate.push({ v: v, p: punti });
    }
    trovate.sort(function (a, b) { return a.p - b.p || (a.v.nome.toLowerCase() < b.v.nome.toLowerCase() ? -1 : 1); });
    return trovate.map(function (t) { return t.v; });
  }

  /* ------------------------------------------------------------ scaricare */

  // un testo da un indirizzo: si ferma da solo dopo 8 secondi e oltre 300 KB (XMLHttpRequest: c'e' su tutti i TV, anche
  // senza AbortController). Errori: 'offline' (rete, o un sito che non lo lascia leggere), 'nonTrovato', 'errore',
  // 'troppoGrande'
  function scarica(url) {
    return new Promise(function (ok, ko) {
      var x = null, finito = false;
      function fine(err, t) {
        if (finito) return;
        finito = true;
        if (err) ko(new Error(err)); else ok(t);
      }
      try { x = new XMLHttpRequest(); } catch (e) { fine('offline'); return; }
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        if (!x.status) { fine('offline'); return; }
        if (x.status === 404) { fine('nonTrovato'); return; }
        if (x.status < 200 || x.status >= 300) { fine('errore'); return; }
        var t = x.responseText || '';
        if (t.length > MAX_BYTE) { fine('troppoGrande'); return; }
        fine(null, t);
      };
      x.onprogress = function (e) {
        if (e && e.loaded > MAX_BYTE) { fine('troppoGrande'); try { x.abort(); } catch (er) {} }
      };
      x.ontimeout = function () { fine('offline'); };
      try {
        // come config.json: un indirizzo nuovo ogni volta, cosi' non arriva una copia vecchia
        x.open('GET', url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now(), true);
        x.timeout = TEMPO_MS;
        x.send();
      } catch (e) { fine('offline'); }
    });
  }
  // le fonti private: prima direttamente; se il sito non lo lascia leggere (CORS) o il TV non si fida del suo
  // certificato, tramite il servizio del TV (solo sul TV). Il catalogo ufficiale no: sta sullo stesso sito della home
  function scaricaFonte(url) {
    return scarica(url)['catch'](function (e) {
      if (!ambiente.servizio || !e || e.message !== 'offline') throw e;
      return conTempo(ambiente.servizio(url), TEMPO_MS + 4000).then(function (j) {
        if (!j || typeof j.testo !== 'string') throw new Error('errore');
        return j.testo;
      }, function (er) {
        throw new Error(er && er.message === 'nonTrovato' ? 'nonTrovato' : 'offline');
      });
    });
  }
  function vecchio(c, max) {
    var eta = Date.now() - ((c && c.scaricato) || 0);
    return !c || !c.scaricato || eta < 0 || eta > max; // eta' negativa: l'orologio del TV era indietro, vale come vecchia
  }
  function appenaProvato(c) {
    var d = Date.now() - ((c && c.provato) || 0);
    return !!(c && c.provato) && d >= 0 && d < RIPROVA_MS;
  }
  // l'impronta di un testo scaricato: se e' la stessa, il catalogo non e' cambiato (niente da ricontrollare e riscrivere).
  // Con dentro LETTURA: una home che legge le voci in un modo nuovo rilegge anche il catalogo salvato da quella di prima
  function impronta(t) { return 'h' + LETTURA + '.' + hash(t).toString(36) + hash(t, 7).toString(36) + '.' + t.length; }

  /* ------------------------------------------------------------ lista ufficiale */

  // l'indirizzo del catalogo ufficiale: lo stesso account della home (<account>.github.io/tv-store/catalogo.json),
  // quindi la home personale e quella pubblica hanno ognuna il suo store senza impostare niente
  function urlUfficiale() {
    var p = location.protocol;
    if (p !== 'http:' && p !== 'https:' && p !== 'chrome-extension:') return '';
    return p + '//' + location.host + '/tv-store/catalogo.json';
  }

  function creaUfficiale() {
    // tvh-store: { v, catalogo: { url, scaricato, provato, esito, nome, impronta }, installate: [...] } (piccola);
    // tvh-store-app: { impronta, app } (il catalogo vero, che si riscrive solo quando cambia)
    function stato() {
      var s = leggi(K_UFFICIALE);
      if (!s || typeof s !== 'object' || s.v !== 1) s = { v: 1, catalogo: null, installate: [] };
      if (!Array.isArray(s.installate)) s.installate = [];
      return s;
    }
    function salva(s) { return scrivi(K_UFFICIALE, s); }
    // la copia salvata del catalogo (null = mai provato da questo indirizzo; scaricato 0 = mai arrivato). Le due chiavi
    // vanno insieme solo se hanno la stessa impronta (se no il catalogo non e' arrivato tutto)
    function catalogo() {
      var m = stato().catalogo, a = leggi(K_UFFICIALE_APP);
      if (!m || m.url !== urlUfficiale()) return null;
      var buono = !!(a && m.impronta && a.impronta === m.impronta && Array.isArray(a.app));
      return { url: m.url, scaricato: buono ? m.scaricato : 0, provato: m.provato, esito: m.esito, nome: buono ? m.nome : '',
        app: buono ? a.app : [] };
    }
    function aggiorna(forza) {
      var url = urlUfficiale(), c = catalogo();
      if (!url) return Promise.resolve({ esito: 'nonDisponibile', catalogo: null });
      if (!forza && c && ((c.esito === 'ok' && !vecchio(c, VECCHIO_UFFICIALE)) || appenaProvato(c))) {
        return Promise.resolve({ esito: c.esito, catalogo: c });
      }
      function annota(esito, r, imp) {
        var s = stato();
        if (!s.catalogo || s.catalogo.url !== url) s.catalogo = { url: url, scaricato: 0, esito: '', nome: '', impronta: '' };
        if (r) {
          var a = leggi(K_UFFICIALE_APP);
          // il catalogo vero si riscrive solo se e' cambiato; un catalogo sbagliato non cancella l'ultimo valido
          if (!(a && a.impronta === imp) && !scrivi(K_UFFICIALE_APP, { impronta: imp, app: r.app })) { esito = 'memoriaPiena'; r = null; }
          if (r) { s.catalogo.scaricato = Date.now(); s.catalogo.nome = r.nome; s.catalogo.impronta = imp; }
        }
        s.catalogo.esito = esito;
        s.catalogo.provato = Date.now();
        salva(s);
        return { esito: esito, catalogo: catalogo() };
      }
      return scarica(url).then(function (t) {
        var imp = impronta(t), a = leggi(K_UFFICIALE_APP), s = stato();
        // lo stesso testo di prima: gia' controllato, si annota solo l'ora
        if (a && a.impronta === imp && s.catalogo && s.catalogo.url === url && s.catalogo.impronta === imp) {
          return annota('ok', { nome: s.catalogo.nome, app: a.app }, imp);
        }
        var r = leggiCatalogo(t, url, true);
        return annota(r.esito, r.esito === 'ok' ? r : null, imp);
      }, function (e) { return annota((e && e.message) || 'offline', null, ''); });
    }
    function voce(id) {
      var c = catalogo();
      if (!c) return null;
      for (var i = 0; i < c.app.length; i++) if (c.app[i].id === id) return c.app[i];
      return null;
    }
    function installate() { return stato().installate.slice(); }
    function installata(id) {
      var l = stato().installate;
      for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i];
      return null;
    }
    function installa(id) {
      var v = voce(id);
      if (!v || v.ritirata || !adatta(v)) return false;
      var s = stato();
      for (var i = 0; i < s.installate.length; i++) if (s.installate[i].id === id) return true;
      s.installate.push({ id: id, vista: v.versione, quando: Date.now(), nome: v.nome }); // il nome serve se l'app sparisce dallo store
      return salva(s);
    }
    function disinstalla(id) {
      var s = stato();
      s.installate = s.installate.filter(function (x) { return x && x.id !== id; });
      togli(chiaveDati('ws:' + id));
      return salva(s);
    }
    // c'e' una versione nuova dell'app installata (la vede chi la usa: pallino e novita'); mai su un'app ritirata
    function nuovaVersione(id) {
      var i = installata(id), v = voce(id);
      return !!(i && v && !v.ritirata && confronta(v.versione, i.vista) > 0);
    }
    function segnaVista(id) {
      var s = stato(), v = voce(id);
      if (!v) return false;
      for (var i = 0; i < s.installate.length; i++) if (s.installate[i].id === id) { s.installate[i].vista = v.versione; s.installate[i].nome = v.nome; }
      return salva(s);
    }
    // per la copia di riserva e il ripristino: solo cosa e' installato
    function perCopia() {
      return stato().installate.map(function (x) { return { id: x.id, vista: x.vista, quando: x.quando, nome: x.nome || '' }; });
    }
    function ripristina(l) {
      var s = stato(), ok = [];
      if (!Array.isArray(l)) return false;
      for (var i = 0; i < l.length && ok.length < MAX_APP; i++) {
        var x = l[i];
        if (x && typeof x.id === 'string' && ID.test(x.id)) {
          ok.push({ id: x.id, vista: typeof x.vista === 'string' ? x.vista : '0.0.0', quando: +x.quando || Date.now(), nome: testo(x.nome, 40) });
        }
      }
      if (!ok.length) return false;
      s.installate = ok;
      return salva(s);
    }
    function vuota() { return !stato().installate.length; }
    return {
      chiave: K_UFFICIALE, url: urlUfficiale, catalogo: catalogo, aggiorna: aggiorna, voce: voce, installate: installate,
      installata: installata, installa: installa, disinstalla: disinstalla, nuovaVersione: nuovaVersione, segnaVista: segnaVista,
      perCopia: perCopia, ripristina: ripristina, vuota: vuota,
      riquadro: function (id) { return 'ws:' + id; }
    };
  }

  /* ------------------------------------------------------------ Le mie app (fonti private) */

  function creaMie() {
    function stato() {
      var s = leggi(K_MIE);
      if (!s || typeof s !== 'object' || s.v !== 1) s = { v: 1, fonti: [] };
      if (!Array.isArray(s.fonti)) s.fonti = [];
      return s;
    }
    function salva(s) { return scrivi(K_MIE, s, MAX_MIE_BYTE); }
    // le app di una fonte da salvare: senza immagini (le private mostrano solo l'iniziale) e al massimo quante ne restano
    // delle 300 di tutte le fonti insieme (50 fonti da 200 app riempirebbero la memoria della home)
    function dentro(s, fid, l) {
      var altre = 0;
      s.fonti.forEach(function (f) { if (f.id !== fid) altre += (f.app || []).length; });
      return l.slice(0, Math.max(0, MAX_MIE - altre)).map(function (v) {
        var w = {};
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) w[k] = v[k];
        w.icona = '';
        w.copertina = '';
        return w;
      });
    }
    // ogni fonte ha un codice a caso (le fonti si riconoscono dall'indirizzo, mai dal codice: due indirizzi diversi non
    // possono prendersi le app e i dati l'uno dell'altro)
    function nuovoId(s) {
      var id, usato;
      do {
        id = 'f' + Math.floor(Math.random() * 2176782336).toString(36) + (Date.now() % 1679616).toString(36);
        usato = false;
        for (var i = 0; i < s.fonti.length; i++) if (s.fonti[i].id === id) usato = true;
      } while (usato);
      return id;
    }
    function fonti() { return stato().fonti.slice(); }
    function fonte(id) {
      var l = stato().fonti;
      for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i];
      return null;
    }

    // quello che si scrive (o si incolla dal telefono) -> dove cercare il catalogo. Va bene:
    // utente/repository, github.com/utente/repository, utente.github.io/repository, un indirizzo https qualsiasi
    // (cartella o file .json). { errore } se non va
    function normalizza(s) {
      s = String(s || '').replace(/^\s+|\s+$/g, '');
      if (!s) return { errore: 'Scrivi un indirizzo' };
      var m = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/?$/.exec(s);
      if (m && m[1].indexOf('.') === -1) s = 'https://' + m[1].toLowerCase() + '.github.io/' + m[2] + '/';
      m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})/i.exec(s);
      if (m) s = 'https://' + m[1].toLowerCase() + '.github.io/' + m[2] + '/';
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
      var p = parti(s);
      if (!p) return { errore: 'Questo non sembra un indirizzo' };
      if (p.protocollo !== 'https') return { errore: 'Serve un indirizzo che inizi con https' };
      if (locale(p.host)) return { errore: 'Questo indirizzo non e\' su internet' };
      if (p.host === sitoHome()) return { errore: 'Le app di questo account stanno nello Store: aprile da li\'' };
      var u = assoluto(s, s);
      if (!u) return { errore: 'Questo non sembra un indirizzo' };
      var senza = u.replace(/[?#].*$/, '');
      if (/\.json$/i.test(senza)) return { prove: [senza], sito: u };
      // una pagina (index.html) o una cartella: il catalogo sta nella cartella
      var cartella = /\/[^\/]*\.[a-z0-9]{2,5}$/i.test(senza.replace(/^https:\/\/[^\/]+/, '')) ? senza.replace(/[^\/]*$/, '') : senza.replace(/\/?$/, '/');
      return { prove: [cartella + 'catalogo.json'], sito: u };
    }
    // cerca il catalogo all'indirizzo scritto. Risolve { url, catalogo } se c'e', { sito } se e' un sito normale (da
    // aggiungere col +); rifiuta { message: 'offline' } se non si riesce a chiedere
    function cerca(indirizzoScritto) {
      var n = normalizza(indirizzoScritto);
      if (n.errore) return Promise.reject(new Error(n.errore));
      var i = 0, offline = false;
      function prossima() {
        if (i >= n.prove.length) {
          if (offline) throw new Error('offline');
          return { sito: n.sito };
        }
        var url = n.prove[i++];
        return scaricaFonte(url).then(function (t) {
          var r = leggiCatalogo(t, url, false);
          if (r.esito === 'ok') return { url: url, catalogo: r };
          if (r.esito === 'formatoNuovo') throw new Error('Questo catalogo e\' per una Home TV piu\' nuova: aggiorna Home TV');
          return prossima();
        }, function (e) {
          if (e && e.message === 'offline') offline = true;
          return prossima();
        });
      }
      return Promise.resolve().then(prossima);
    }
    // aggiunge (o rinnova) la fonte trovata da cerca(): tutte le sue app vanno subito in "Le mie app". Riaggiungerla
    // rimette anche le app tolte
    function aggiungi(url, r) {
      if (!r || r.esito !== 'ok' || !indirizzo(url, url, false)) return null;
      var s = stato(), f = null;
      for (var i = 0; i < s.fonti.length; i++) if (s.fonti[i].url === url) f = s.fonti[i];
      if (!f) {
        if (s.fonti.length >= MAX_FONTI) return null;
        f = { id: nuovoId(s), url: url, aggiunta: Date.now(), viste: {} };
        s.fonti.push(f);
      }
      f.tolte = [];
      f.nome = r.nome || parti(url).host;
      f.scaricato = Date.now();
      f.provato = Date.now();
      f.esito = 'ok';
      f.app = dentro(s, f.id, r.app);
      if (!f.viste || typeof f.viste !== 'object') f.viste = {};
      for (var j = 0; j < f.app.length; j++) if (!f.viste[f.app[j].id]) f.viste[f.app[j].id] = f.app[j].versione;
      return salva(s) ? f : null;
    }
    // riscarica le fonti vecchie (o tutte, con forza): una fonte che non risponde tiene le sue app
    function aggiornaTutte(forza) {
      var l = stato().fonti.filter(function (f) { return forza || ((!f.scaricato || vecchio(f, VECCHIO_FONTI)) && !appenaProvato(f)); });
      return Promise.all(l.map(function (f) {
        return scaricaFonte(f.url).then(function (t) {
          var r = leggiCatalogo(t, f.url, false);
          return annota(f.id, r.esito, r.esito === 'ok' ? r : null);
        }, function (e) { return annota(f.id, (e && e.message) || 'offline', null); });
      }));
    }
    function annota(id, esito, r) {
      var s = stato();
      for (var i = 0; i < s.fonti.length; i++) {
        var f = s.fonti[i];
        if (f.id !== id) continue;
        f.esito = esito;
        f.provato = Date.now();
        if (r) {
          f.scaricato = Date.now();
          f.nome = r.nome || f.nome;
          f.app = dentro(s, f.id, r.app);
          if (!f.viste || typeof f.viste !== 'object') f.viste = {};
          // dopo un ripristino (viste vuote) le versioni di oggi valgono come gia' viste: niente pallini per niente
          for (var j = 0; j < f.app.length; j++) if (!f.viste[f.app[j].id]) f.viste[f.app[j].id] = f.app[j].versione;
        }
      }
      salva(s);
      return esito;
    }
    // togliere una fonte toglie anche tutti i dati delle sue app, anche di quelle che il catalogo non ha piu'
    function togliFonte(id) {
      var s = stato(), pre = PREFISSO_DATI + 'mia-' + id + '-', via = [];
      s.fonti = s.fonti.filter(function (f) { return f.id !== id; });
      try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(pre) === 0) via.push(k); } } catch (e) {}
      via.forEach(togli);
      return salva(s);
    }
    // il sito vero della fonte (il nome lo scrive chi fa il catalogo: potrebbe dire "Home TV")
    function sitoDi(f) { var p = parti(f.url); return p ? p.host : ''; }
    // le app delle fonti (tranne quelle tolte), al massimo 300: { riquadro: 'mia:<fonte>:<id>', fonte, nomeFonte, sito, voce }
    function app() {
      var out = [];
      stato().fonti.forEach(function (f) {
        var sito = sitoDi(f);
        (f.app || []).forEach(function (v) {
          if (out.length < MAX_MIE && (f.tolte || []).indexOf(v.id) === -1) out.push({ riquadro: 'mia:' + f.id + ':' + v.id, fonte: f.id, nomeFonte: f.nome || '', sito: sito, voce: v });
        });
      });
      return out;
    }
    function appDi(fid, id) {
      var f = fonte(fid);
      if (!f || (f.tolte || []).indexOf(id) !== -1) return null;
      for (var i = 0; i < (f.app || []).length; i++) {
        if (f.app[i].id === id) return { riquadro: 'mia:' + fid + ':' + id, fonte: fid, nomeFonte: f.nome || '', sito: sitoDi(f), voce: f.app[i] };
      }
      return null;
    }
    // quante app private ci stanno ancora (delle 300), senza contare la fonte con questo indirizzo (si rinnova)
    function spazio(url) {
      var n = 0;
      stato().fonti.forEach(function (f) { if (f.url !== url) n += (f.app || []).length; });
      return Math.max(0, MAX_MIE - n);
    }
    function togliApp(fid, id) {
      var s = stato();
      for (var i = 0; i < s.fonti.length; i++) {
        if (s.fonti[i].id !== fid) continue;
        if (!Array.isArray(s.fonti[i].tolte)) s.fonti[i].tolte = [];
        if (s.fonti[i].tolte.indexOf(id) === -1) s.fonti[i].tolte.push(id);
      }
      togli(chiaveDati('mia:' + fid + ':' + id));
      return salva(s);
    }
    function nuovaVersione(fid, id) {
      var f = fonte(fid), a = appDi(fid, id);
      return !!(f && a && !a.voce.ritirata && confronta(a.voce.versione, (f.viste || {})[id]) > 0);
    }
    function segnaVista(fid, id) {
      var s = stato(), a = appDi(fid, id);
      if (!a) return false;
      for (var i = 0; i < s.fonti.length; i++) {
        if (s.fonti[i].id !== fid) continue;
        if (!s.fonti[i].viste || typeof s.fonti[i].viste !== 'object') s.fonti[i].viste = {};
        s.fonti[i].viste[id] = a.voce.versione;
      }
      return salva(s);
    }
    function perCopia() {
      return stato().fonti.map(function (f) { return { url: f.url, nome: f.nome || '', tolte: (f.tolte || []).slice() }; });
    }
    // le fonti tornano senza app (si riscaricano subito dopo con aggiornaTutte), con codici nuovi
    function ripristina(l) {
      if (!Array.isArray(l)) return false;
      var s = stato(), visti = {};
      s.fonti = [];
      for (var i = 0; i < l.length && s.fonti.length < MAX_FONTI; i++) {
        var x = l[i], url = x && typeof x.url === 'string' ? x.url : '';
        if (!url || !indirizzo(url, url, false) || visti[url]) continue;
        visti[url] = 1;
        s.fonti.push({ id: nuovoId(s), url: url, nome: testo(x.nome, 40), aggiunta: Date.now(), scaricato: 0, esito: 'attesa',
          app: [], viste: {}, tolte: Array.isArray(x.tolte) ? x.tolte.filter(function (t) { return typeof t === 'string' && ID.test(t); }) : [] });
      }
      return s.fonti.length ? salva(s) : false;
    }
    function vuota() { return !stato().fonti.length; }
    return {
      chiave: K_MIE, normalizza: normalizza, cerca: cerca, aggiungi: aggiungi, aggiornaTutte: aggiornaTutte, fonti: fonti,
      fonte: fonte, togliFonte: togliFonte, app: app, appDi: appDi, spazio: spazio, togliApp: togliApp, nuovaVersione: nuovaVersione,
      // la fonte non si e' salvata perche' Le mie app e' al limite (256 KB), non per la memoria del TV
      oltreIlLimite: function () { return oltre; },
      segnaVista: segnaVista, perCopia: perCopia, ripristina: ripristina, vuota: vuota
    };
  }

  var ufficiale = creaUfficiale(), mie = creaMie();

  /* ------------------------------------------------------------ dati delle app (tramite tv-app.js) */

  // ogni app ha la sua chiave: 'ws:<id>' -> tvh-app-ws-<id>, 'mia:<fonte>:<id>' -> tvh-app-mia-<fonte>-<id>
  var RE_WS = /^ws:([a-z0-9][a-z0-9-]{1,39})$/, RE_MIA = /^mia:(f[a-z0-9]{1,16}):([a-z0-9][a-z0-9-]{1,39})$/;
  function chiaveDati(riquadro) {
    var m = RE_WS.exec(riquadro || '');
    if (m) return PREFISSO_DATI + 'ws-' + m[1];
    m = RE_MIA.exec(riquadro || '');
    return m ? PREFISSO_DATI + 'mia-' + m[1] + '-' + m[2] : '';
  }
  function datiApp(riquadro) {
    var k = chiaveDati(riquadro), d = k ? leggi(k) : null;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  }
  // quanto pesa la memoria di ogni app: si conta una volta sola, poi si aggiorna a ogni scrittura
  function contaPesi() {
    if (pesi) return pesi;
    pesi = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFISSO_DATI) === 0) pesi[k] = (localStorage.getItem(k) || '').length;
      }
    } catch (e) {}
    return pesi;
  }
  // false = troppo (64 KB per app, 1 MB per tutte le app insieme) o memoria piena: la home deve poter salvare sempre
  function scriviDatiApp(riquadro, d) {
    var k = chiaveDati(riquadro), t;
    if (!k || !d || typeof d !== 'object') return false;
    try { t = JSON.stringify(d); } catch (e) { return false; }
    if (t.length > MAX_DATI_APP) return false;
    var p = contaPesi(), tot = 0;
    for (var x in p) if (x !== k && Object.prototype.hasOwnProperty.call(p, x)) tot += p[x];
    if (tot + t.length > MAX_DATI_TUTTE) return false;
    try { localStorage.setItem(k, t); } catch (e) { return false; }
    p[k] = t.length;
    gia[k] = d;
    return true;
  }

  // un riquadro della home -> cosa aprire. null = non installata. stato: 'ok', 'ritirata' (tolta dallo store o spenta
  // con "ritirata"), 'attesa' (catalogo non ancora scaricato), 'nonAdatta' (e perche': vedi perche())
  function perRiquadro(riquadro) {
    var m = RE_WS.exec(riquadro || ''), v, no;
    if (m) {
      if (!ufficiale.installata(m[1])) return null;
      v = ufficiale.voce(m[1]);
      no = v && !v.ritirata ? perche(v) : '';
      var c = ufficiale.catalogo();
      return { riquadro: riquadro, tipo: 'ws', id: m[1], privata: false, voce: v, nuova: ufficiale.nuovaVersione(m[1]),
        stato: v ? (v.ritirata ? 'ritirata' : no ? 'nonAdatta' : 'ok') : (c && c.scaricato ? 'ritirata' : 'attesa'), perche: no };
    }
    m = RE_MIA.exec(riquadro || '');
    if (!m) return null;
    var a = mie.appDi(m[1], m[2]);
    if (!a) return null;
    v = a.voce;
    no = v.ritirata ? '' : perche(v);
    return { riquadro: riquadro, tipo: 'mia', id: m[2], fonte: m[1], nomeFonte: a.nomeFonte, sito: a.sito, privata: true, voce: v,
      nuova: mie.nuovaVersione(m[1], m[2]), stato: v.ritirata ? 'ritirata' : no ? 'nonAdatta' : 'ok', perche: no };
  }
  function segnaVista(riquadro) {
    var r = perRiquadro(riquadro);
    if (!r) return false;
    return r.tipo === 'ws' ? ufficiale.segnaVista(r.id) : mie.segnaVista(r.fonte, r.id);
  }

  /* ------------------------------------------------------------ copia di riserva sul TV
   * Viaggia con la sincronizzazione della home (syncService): solo cosa e' installato e da quali fonti, il resto si
   * riscarica. Torna solo se sul TV tutte e due le liste sono vuote (TizenBrew reinstallato): mai sopra liste che ci sono.
   * La home la chiede solo quando all'avvio la sua memoria era vuota */
  function copia() { return { v: 1, ufficiale: ufficiale.perCopia(), mie: mie.perCopia() }; }
  function ripristina(c) {
    if (!c || c.v !== 1 || !ufficiale.vuota() || !mie.vuota()) return false;
    var a = ufficiale.ripristina(c.ufficiale), b = mie.ripristina(c.mie);
    return !!(a || b);
  }

  /* ------------------------------------------------------------ lo Store dal telefono
   * Il telefono mostra quello che vede questo TV (stati compresi: "non va su questo TV" lo sa solo il TV) e chiede le
   * azioni; le fa sempre la home (o lo Store), con gli stessi controlli di quando si usa il telecomando */
  function statoUfficiale(v) {
    var ins = !!ufficiale.installata(v.id);
    if (v.ritirata) return ins ? 'ritirata' : '';
    if (!adatta(v)) return 'nonAdatta';
    return ins ? (ufficiale.nuovaVersione(v.id) ? 'nuova' : 'installata') : 'installa';
  }
  function breve(t) { t = String(t || ''); var p = t.indexOf('. '); if (p > 0 && p < 120) t = t.slice(0, p); return t.length > 120 ? t.slice(0, 119) + '\u2026' : t; }
  // colore(chiave, nome, tag) -> [a, b]: i colori del riquadro, li sa la pagina (UI.coloriApp)
  function perTelefono(esito, colore) {
    var c = ufficiale.catalogo(), app = [], visti = {};
    function col(k, nome, tag) { return colore ? colore(k, nome, tag) : null; }
    (c ? c.app : []).forEach(function (v) {
      var st = statoUfficiale(v);
      if (!st) return;
      visti[v.id] = 1;
      // in evidenza, come sul TV, solo le app che vanno su questo TV
      app.push({ id: v.id, nome: v.nome, descrizione: v.descrizione, novita: v.novita, autore: v.autore, categoria: v.categoria,
        versione: v.versione, icona: v.icona, copertina: v.copertina, evidenza: v.evidenza && !v.ritirata && st !== 'nonAdatta', stato: st,
        colore: col('ws:' + v.id, v.nome, (v.copertina || v.icona || '') + '|' + v.versione) });
    });
    // installate ma tolte dallo store: si possono solo disinstallare
    if (c && c.scaricato) {
      ufficiale.installate().forEach(function (x) {
        if (!visti[x.id]) app.push({ id: x.id, nome: x.nome || x.id, stato: 'orfana', colore: col('ws:' + x.id, x.nome || x.id, '') });
      });
    }
    var mieL = mie.app().slice(0, 300).map(function (a) {
      var v = a.voce;
      return { riquadro: a.riquadro, nome: v.nome, descrizione: breve(v.descrizione), novita: v.novita, autore: v.autore, categoria: v.categoria,
        versione: v.versione, sito: a.sito, colore: col(a.riquadro, v.nome, ''),
        stato: v.ritirata ? 'ritirata' : !adatta(v) ? 'nonAdatta' : mie.nuovaVersione(a.fonte, v.id) ? 'nuova' : 'ok' };
    });
    return { v: 1, catalogo: c && c.scaricato ? (c.nome || 'Store') : '', app: app, mie: mieL, esito: esito || null };
  }
  // un'azione chiesta dal telefono: risolve { ok, testo, apri } (apri = il riquadro da aprire, lo fa la pagina)
  function azioneTelefono(e) {
    var v = e.id ? ufficiale.voce(e.id) : null, i = e.id ? ufficiale.installata(e.id) : null, nome = v ? v.nome : i ? (i.nome || e.id) : 'L\'app';
    if (e.azione === 'installa') {
      if (!v) return Promise.resolve({ ok: false, testo: 'Quest\'app non e\' nello Store' });
      if (ufficiale.installata(e.id)) return Promise.resolve({ ok: true, testo: nome + ' e\' gia\' installata' });
      var no = v.ritirata ? 'motore' : perche(v);
      if (no) return Promise.resolve({ ok: false, testo: nome + (no === 'motore' ? ' non va su questo TV' : ': su questo TV non funziona ancora') });
      return Promise.resolve(ufficiale.installa(e.id) ? { ok: true, testo: nome + ' installata dal telefono' } :
        { ok: false, testo: 'Non sono riuscito a installarla: la memoria del TV potrebbe essere piena' });
    }
    if (e.azione === 'aggiorna') {
      if (!i) return Promise.resolve({ ok: false, testo: nome + ' non e\' installata' });
      if (!v || !ufficiale.nuovaVersione(e.id)) return Promise.resolve({ ok: true, testo: nome + ' e\' gia\' aggiornata' });
      ufficiale.segnaVista(e.id);
      return Promise.resolve({ ok: true, testo: nome + ' aggiornata alla versione ' + v.versione + (v.novita ? ': ' + v.novita : '') });
    }
    if (e.azione === 'disinstalla') {
      if (!i) return Promise.resolve({ ok: true, testo: nome + ' non e\' installata' });
      ufficiale.disinstalla(e.id);
      return Promise.resolve({ ok: true, testo: nome + ' disinstallata dal telefono' });
    }
    if (e.azione === 'togli' || e.azione === 'apri') {
      var p = perRiquadro(e.riquadro);
      if (!p) return Promise.resolve({ ok: false, testo: 'Quest\'app non e\' installata' });
      if (e.azione === 'apri') return Promise.resolve({ ok: true, apri: e.riquadro });
      mie.togliApp(p.fonte, p.id);
      return Promise.resolve({ ok: true, testo: (p.voce ? p.voce.nome : 'L\'app') + ' tolta dal telefono' });
    }
    if (e.azione === 'aggiungi') {
      return mie.cerca(e.indirizzo).then(function (t) {
        if (!t.url) return { ok: false, testo: 'E\' un sito, non un\'app per Home TV: aggiungilo col + della home' };
        if (!mie.spazio(t.url)) return { ok: false, testo: 'Le mie app e\' piena (300 app): togli una fonte prima' };
        var f = mie.aggiungi(t.url, t.catalogo);
        if (!f) {
          return { ok: false, testo: oltre ? 'Le mie app e\' al limite: le app di questa fonte non ci stanno. Togli una fonte e riprova' :
            'Non sono riuscito a salvarla: la memoria del TV potrebbe essere piena' };
        }
        var n = (f.app || []).length;
        return { ok: true, testo: (f.nome || 'Fonte') + ': ' + (n === 1 ? '1 app' : n + ' app') + ' in Le mie app (dal telefono)' };
      }, function (er) {
        return { ok: false, testo: er && er.message === 'offline' ? 'Non riesco a raggiungere quell\'indirizzo' : ((er && er.message) || 'Non riesco ad aggiungerla') };
      });
    }
    return Promise.resolve({ ok: true });
  }

  return {
    FORMATO: FORMATO, CATEGORIE: CATEGORIE, TITOLI: TITOLI, imposta: imposta, confronta: confronta, leggiCatalogo: leggiCatalogo,
    catalogoDa: catalogoDa, adatta: adatta, perche: perche, servizio: servizio, funzioni: funzioni,
    scarica: scarica, urlUfficiale: urlUfficiale, cercaApp: cercaApp, piano: piano,
    ufficiale: ufficiale, mie: mie, perRiquadro: perRiquadro, segnaVista: segnaVista, chiaveDati: chiaveDati,
    datiApp: datiApp, scriviDatiApp: scriviDatiApp, copia: copia, ripristina: ripristina, perTelefono: perTelefono, azioneTelefono: azioneTelefono
  };
})();
