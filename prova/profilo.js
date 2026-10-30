/*
 * Home TV - PROFILO DEL TV.
 *
 * L'unico posto dove stanno le differenze tra i TV Samsung (gli "adattatori"): anno, versione di Tizen, motore web,
 * cosa c'e' e cosa manca su quel TV, e cosa fare quando manca. Il resto del codice chiede solo a ProfiloTV: mai
 * controlli su modello, anno o versione sparsi nel codice. Un TV nuovo o un comportamento diverso = si cambia solo qui.
 *
 * Lo usano le pagine della home (index.html e browser.html lo caricano prima di ui.js), main.js (dentro i siti) e
 * service.js (sul TV): in quei due file c'e' una copia di questo file, messa da prove/incorpora_profilo.py. Si modifica
 * SOLO questo file, poi si lancia lo script; le prove controllano che le copie siano uguali.
 *
 * Si decide sempre provando se una cosa c'e' (capacita'), mai solo dal numero di versione: la tabella per anno serve
 * a riconoscere il TV e come ripiego quando non si puo' provare.
 * Solo JavaScript ES5 e solo ASCII: gira dal Chromium 47 dei TV 2017 al Node 4 dei servizi.
 */
var ProfiloTV = (function () {
  'use strict';

  /* ------------------------------------------------------------ i TV Samsung per anno (docs/compatibilita.md)
   * lettera dell'anno nel codice modello (inFondo: dal 2025 nei modelli Crystal e HD la lettera va in fondo, U8000F),
   * Tizen alla vendita, motore web (Chromium) delle app, e se ci va TizenBrew: stato 'ok', 'rischio' o 'no', con il
   * perche' (lo usa anche l'installatore del Mac). Dal 2023 i TV si aggiornano (7.0 -> 8.0 -> 9.0): la versione vera
   * si legge dal TV, l'anno vale solo come ripiego. */
  var ANNI = [
    { anno: 2015, lettera: 'J', tizen: '2.3', chromium: 0,
      tizenbrew: { stato: 'no', perche: 'Tizen 2.3: TizenBrew funziona da Tizen 3.0 (TV del 2017 o pi\u00f9 nuovi)' } },
    { anno: 2016, lettera: 'K', tizen: '2.4', chromium: 0,
      tizenbrew: { stato: 'no', perche: 'Tizen 2.4: TizenBrew funziona da Tizen 3.0 (TV del 2017 o pi\u00f9 nuovi)' } },
    { anno: 2017, lettera: 'M', tizen: '3.0', chromium: 47,
      tizenbrew: { stato: 'ok', perche: 'Home TV in parte: funzionano il tuo sito e il browser, non le app del TV, il telefono e la riaccensione (il motore web non lascia parlare la home con il servizio del TV)' } },
    { anno: 2018, lettera: 'N', tizen: '4.0', chromium: 56, tizenbrew: { stato: 'ok', perche: '' } },
    { anno: 2019, lettera: 'R', tizen: '5.0', chromium: 63, tizenbrew: { stato: 'ok', perche: '' } },
    { anno: 2020, lettera: 'T', tizen: '5.5', chromium: 69, tizenbrew: { stato: 'ok', perche: '' } },
    { anno: 2021, lettera: 'A', tizen: '6.0', chromium: 76, tizenbrew: { stato: 'ok', perche: '' } },
    { anno: 2022, lettera: 'B', tizen: '6.5', chromium: 85, tizenbrew: { stato: 'ok', perche: '' } },
    { anno: 2023, lettera: 'C', tizen: '7.0', chromium: 94,
      tizenbrew: { stato: 'ok', perche: 'Da Tizen 7 l\'installazione chiede l\'accesso Samsung (per il certificato)' } },
    { anno: 2024, lettera: 'D', tizen: '8.0', chromium: 108,
      tizenbrew: { stato: 'rischio', perche: 'Da Tizen 8 l\'installazione pu\u00f2 non riuscire; con Tizen 9 le impostazioni di TizenBrew possono non aprirsi' } },
    { anno: 2025, lettera: 'F', tizen: '9.0', chromium: 120, inFondo: true,
      tizenbrew: { stato: 'rischio', perche: 'Con Tizen 9 le impostazioni di TizenBrew possono non aprirsi e il suo servizio pu\u00f2 ripartire di continuo' } },
    { anno: 2026, lettera: 'H', tizen: '10.0', chromium: 130, inFondo: true,
      tizenbrew: { stato: 'rischio', perche: 'Una sola prova finora: il servizio di TizenBrew \u00e8 partito dopo qualche riavvio del TV' } }
  ];
  var TIZEN_MINIMO = 3; // TizenBrew funziona da Tizen 3.0 (2017)
  var CHROMIUM_LOCALE = 53; // da Chromium 53 una pagina https puo' chiamare http://127.0.0.1 (prima: contenuto misto)
  // OK tenuto premuto (menu e menu rapido), uguale nella home e nei siti. Vale solo se il telecomando manda anche il
  // rilascio del tasto: non lo si puo' chiedere al TV, lo si impara la prima volta che arriva
  var OK_TENUTO_MS = 600;

  function numero(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function perLettera(l) {
    for (var i = 0; i < ANNI.length; i++) if (ANNI[i].lettera === l) return ANNI[i];
    return null;
  }
  function perAnno(a) {
    for (var i = 0; i < ANNI.length; i++) if (ANNI[i].anno === a) return ANNI[i];
    return null;
  }
  // TizenBrew su un TV di quell'anno, anche fuori tabella (per l'installatore del Mac): null se l'anno non si sa
  function tizenbrewPerAnno(anno) {
    var a = anno ? perAnno(anno) : null;
    if (!anno) return null;
    if (a) return a.tizenbrew;
    if (anno < ANNI[0].anno) return { stato: 'no', perche: 'TV del ' + anno + ': TizenBrew funziona da Tizen 3.0 (TV del 2017 o pi\u00f9 nuovi)' };
    return { stato: 'rischio', perche: 'TV del ' + anno + ', pi\u00f9 nuovo di quelli conosciuti: TizenBrew non \u00e8 mai stato provato' };
  }
  // da Tizen 7 l'installazione di TizenBrew chiede l'accesso Samsung (per il certificato). Senza la versione vale l'anno:
  // il Tizen di quell'anno, e per i TV piu' nuovi di quelli in tabella si' (i TV non tornano indietro)
  var TIZEN_CERTIFICATO = 7;
  function serveCertificato(tizen, anno) {
    if (numero(tizen)) return numero(tizen) >= TIZEN_CERTIFICATO;
    var a = anno ? perAnno(anno) : null;
    if (a) return numero(a.tizen) >= TIZEN_CERTIFICATO;
    return !!anno && anno > ANNI[ANNI.length - 1].anno;
  }
  // il motore web di una versione di Tizen (anche di un TV aggiornato: 9.0 = Chromium 120 qualunque sia l'anno)
  function perTizen(t) {
    var n = numero(t), r = null;
    for (var i = 0; i < ANNI.length; i++) if (ANNI[i].chromium && numero(ANNI[i].tizen) <= n) r = ANNI[i];
    return n ? r : null;
  }

  /* ------------------------------------------------------------ riconoscimento */

  // anno dal codice modello: QE55Q80B (B = 2022), UE43NU7400 (N = 2018), QE55QN90D (D = 2024), QE65S95B, UE32T4300,
  // UE55U8000F... Prima il paese (QE, UE, QN, UN, GQ, GU, UA...) e i pollici, poi la serie con la lettera dell'anno
  function annoDaModello(m) {
    var s = String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), x, a;
    var c = /^[A-Z]{2}\d{2}([A-Z0-9]+)$/.exec(s);
    if (!c) return 0;
    var r = c[1];
    var prove = [
      [/^([A-Z])U\d{4}/],            // Crystal UHD: NU7400, RU7100, TU7000, AU7100, BU8000, CU7100, DU7100
      [/^[A-Z]{1,3}\d{2,3}([A-Z])/], // QLED, Neo QLED, OLED, The Frame: Q80B, QN90D, S95B, LS03B, Q60T
      // QLED del 2025 a una cifra: Q7F seguito da AA (o niente). I Q7F, Q8C, Q9F del 2017 (Q7FAM...) e i Q7FN del 2018
      // hanno un'altra lettera dopo: anno non letto dal modello (c'e' la piattaforma)
      [/^[A-Z]{1,2}\d([A-Z])(?:AA|$)/, true],
      // dal 2025 l'anno va in fondo: U8000F, H4500F (la prima lettera e' la risoluzione). Solo le lettere di quegli
      // anni: in UE32T4300AKXXU la A dopo il numero e' la variante, l'anno e' la T (2020)
      [/^[A-Z]\d{4}([A-Z])/, true],
      [/^([A-Z])\d{4}/]              // HD fino al 2024: T4300, N5300
    ];
    for (var i = 0; i < prove.length; i++) {
      x = prove[i][0].exec(r);
      a = x ? perLettera(x[1]) : null;
      if (a && (!prove[i][1] || a.inFondo)) return a.anno;
    }
    return 0;
  }
  // anno dal campo "model" dell'API del TV (porta 8001): "22_PONTUSM_QTV" = 2022. Anche fuori tabella (14_ = 2014): vale
  // piu' della lettera del modello, che si ripete ogni 13 anni (H = 2014 e 2026)
  function annoDaPiattaforma(m) {
    var x = /^(\d{2})_/.exec(String(m || '')), a = x ? 2000 + (+x[1]) : 0;
    return a >= 2010 && a <= 2040 ? a : 0;
  }
  // dallo user agent (puo' essere cambiato da TizenBrew: vale come ripiego). Fino a Tizen 5.0 non c'e' il Chromium
  function daUserAgent(ua) {
    var s = String(ua || ''), t = /Tizen\s*([\d.]+)/i.exec(s), c = /Chrome\/(\d+)/.exec(s);
    var tizen = t ? t[1] : '', chromium = c ? +c[1] : 0;
    if (!chromium && tizen && perTizen(tizen)) chromium = perTizen(tizen).chromium;
    // sul TV: Samsung (Tizen), LG (webOS: "Web0S ... SmartTV") e l'app Home TV per Android (che si presenta cosi')
    return { suTv: /Tizen|SMART-TV|SmartTV|Web0S|HomeTV-Android/i.test(s), tizen: tizen, chromium: chromium };
  }
  // siamo sul TV? Lo dice lo user agent; ma TizenBrew permette di cambiarlo (sue impostazioni, User Agent): allora
  // vale anche l'oggetto tizen nella pagina, o l'averlo gia' visto dal servizio del TV che risponde (ricordato)
  function suTv(w, ricordato) {
    return daUserAgent(w.navigator.userAgent).suTv || typeof w.tizen !== 'undefined' || !!ricordato;
  }
  // la piattaforma (docs/piano-altre-tv.md): 'tizen' (Samsung, anche il simulatore sul Mac che si crede un Samsung),
  // 'android' e 'firetv' (l'app Home TV per Android, che lo dice nello user agent; le Fire TV hanno i modelli AFT...),
  // 'webos' (LG), 'browser' (un computer). La usano le app dello Store (info.piattaforma) e il servizio (/api/status)
  function piattaforma(w, suTvGia) {
    var ua = String((w && w.navigator && w.navigator.userAgent) || '');
    if (/HomeTV-Android/.test(ua)) return /\bAFT/.test(ua) ? 'firetv' : 'android';
    if (/Web0S|webOS/.test(ua) || (w && typeof w.PalmSystem !== 'undefined')) return 'webos';
    return suTvGia || suTv(w) ? 'tizen' : 'browser';
  }
  // I tasti del telecomando, uguali per tutte le pagine (ui.js nella home, main.js nei siti): codice -> tasto. Samsung e LG
  // hanno gli stessi codici per i colori e i tasti video; Indietro e' 10009 su Samsung e 461 su LG; l'app per Android
  // passa alla pagina i suoi tasti con questi codici (Indietro come Esc, 27). La libreria delle app (tv-app.js) ha i suoi
  var TASTI = {
    37: 'sx', 38: 'su', 39: 'dx', 40: 'giu', 13: 'ok',
    10009: 'indietro', 461: 'indietro', 27: 'indietro',
    403: 'rosso', 404: 'verde', 405: 'giallo', 406: 'blu',
    10252: 'playpausa', 415: 'play', 19: 'pausa', 413: 'stop', 417: 'avanti', 412: 'indietroVeloce'
  };
  // con lo user agent che non dice TV si chiede al servizio del TV, ma non sui computer e sui telefoni Apple:
  // l'anteprima della home sul computer resta un'anteprima
  function daChiedereAlServizio(w) {
    return !/^(Mac|Win|iP)/.test(String(w.navigator.platform || ''));
  }

  /* ------------------------------------------------------------ motore web della pagina (solo nelle pagine) */

  // cosa c'e' davvero in questo motore (si prova, non si guarda la versione)
  function motore(w) {
    var out = {};
    out.variabiliCss = !!(w.CSS && w.CSS.supports && w.CSS.supports('--x', '0')); // Chromium 49
    // fogli costruiti (new CSSStyleSheet) e adottati, Chromium 73: prima CSSStyleSheet c'e' ma non si costruisce
    out.fogliAdottati = !!(w.Document && 'adoptedStyleSheets' in w.Document.prototype) && typeof w.CSSStyleSheet === 'function';
    out.abort = typeof w.AbortController === 'function'; // Chromium 66
    out.puntatore = typeof w.PointerEvent === 'function'; // Chromium 55
    out.proxy = typeof w.Proxy === 'function'; // Chromium 49
    // JavaScript moderno (classi, frecce, let, Map, Promise): Chromium 49, i TV dal 2018. Lo chiedono le app dello store
    // nei loro requisiti. Si prova dalle funzioni che ci sono, senza eval (i siti con CSP la vietano)
    out.es6 = typeof w.Symbol === 'function' && typeof w.Map === 'function' && typeof w.Promise === 'function' &&
      typeof w.Proxy === 'function' && typeof w.Reflect === 'object' && w.Reflect !== null;
    return out;
  }
  // rimette quello che manca e serve al nostro codice (TV 2017, Chromium 47); dove c'e' gia' non cambia niente
  function ripara(w) {
    try {
      if (w.Node && !('isConnected' in w.Node.prototype)) {
        Object.defineProperty(w.Node.prototype, 'isConnected', { configurable: true, get: function () {
          var d = this.ownerDocument;
          if (!d) return this.nodeType === 9;
          return !!d.documentElement && (this === d.documentElement || d.documentElement.contains(this));
        } });
      }
    } catch (e) {}
    try { if (w.NodeList && !w.NodeList.prototype.forEach) w.NodeList.prototype.forEach = Array.prototype.forEach; } catch (e) {}
  }
  // selettore con "[... i]" (maiuscole o minuscole, Chromium 49): dove non c'e' si toglie la "i" invece di sbagliare
  var conI = null;
  function selettore(s) {
    if (conI === null) {
      try { document.querySelector('[data-x="y" i]'); conI = true; } catch (e) { conI = false; }
    }
    return conI ? s : s.replace(/\s+i\]/g, ']');
  }
  // scorrere con l'animazione: le opzioni ({ behavior: 'smooth' }) ci sono da Chromium 61 (TV 2019), insieme alla
  // proprieta' CSS scroll-behavior. Prima un motore vecchio darebbe errore (scrollBy) o le leggerebbe come "in alto"
  // (scrollIntoView): si scorre senza animazione
  var liscio = null;
  function conAnimazione() {
    if (liscio === null) liscio = !!(window.CSS && window.CSS.supports && window.CSS.supports('scroll-behavior', 'smooth'));
    return liscio;
  }
  // scorre di dy pixel la pagina (el vuoto) o un riquadro
  function scorriPagina(el, dy) {
    if (!el) { if (conAnimazione()) window.scrollBy({ top: dy, behavior: 'smooth' }); else window.scrollBy(0, dy); return; }
    if (conAnimazione() && el.scrollBy) el.scrollBy({ top: dy, behavior: 'smooth' }); else el.scrollTop += dy;
  }
  // porta un elemento in vista: al centro, o il minimo indispensabile (vicino: dentro un riquadro che scorre)
  function mostra(el, vicino) {
    if (conAnimazione()) el.scrollIntoView({ block: vicino ? 'nearest' : 'center', inline: 'nearest', behavior: 'smooth' });
    else if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(!vicino);
    else el.scrollIntoView(false);
  }
  // variabili CSS (Chromium 49): dove mancano si riscrive il foglio con i valori del tema in uso, e lo si rifa' quando
  // cambia il tema (attributo data-tema di <html>). Solo per le nostre pagine (home e browser)
  function variabiliCss(d) {
    var testi = [], stile = null, scritto = null;
    function leggi(fatto) {
      var fogli = d.querySelectorAll('link[rel="stylesheet"], style'), da = fogli.length;
      function uno() { if (--da === 0) fatto(); }
      // ogni foglio al suo posto (le risposte arrivano in ordine sparso): l'ordine decide chi vince
      Array.prototype.forEach.call(fogli, function (el, i) {
        testi[i] = '';
        if (el.tagName === 'STYLE') { if (el.id !== 'hometv-senza-variabili') testi[i] = el.textContent; uno(); return; }
        var href = el.getAttribute('href') || '';
        if (/^(https?:)?\/\//i.test(href) && href.indexOf(location.host) === -1) { uno(); return; } // altri siti (caratteri)
        var x = new XMLHttpRequest();
        x.onreadystatechange = function () {
          if (x.readyState !== 4) return;
          if (x.status >= 200 && x.status < 300) testi[i] = x.responseText;
          uno();
        };
        x.open('GET', href, true);
        x.send();
      });
      if (!fogli.length) fatto();
    }
    function valori() {
      var v = {}, tema = d.documentElement.getAttribute('data-tema') || '', re = /([^{}]+)\{([^{}]*)\}/g, m;
      testi.forEach(function (t) {
        while ((m = re.exec(t))) {
          var sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
          var vale = sel === ':root' || sel === 'html' || (tema && sel.replace(/['"]/g, '') === 'html[data-tema=' + tema + ']');
          if (!vale) continue;
          m[2].replace(/(--[\w-]+)\s*:\s*([^;]+)/g, function (_, k, val) { v[k] = val.trim(); return ''; });
        }
      });
      return v;
    }
    function scrivi() {
      var tema = d.documentElement.getAttribute('data-tema') || '';
      if (tema === scritto) return; // stesso tema (le impostazioni si riapplicano spesso): niente da rifare
      scritto = tema;
      var v = valori(), css = testi.join('\n').replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, function (_, k, ripiego) {
        return v[k] !== undefined ? v[k] : (ripiego || '');
      });
      if (!stile) { stile = d.createElement('style'); stile.id = 'hometv-senza-variabili'; (d.head || d.documentElement).appendChild(stile); }
      stile.textContent = css;
    }
    leggi(function () {
      scrivi();
      try { new MutationObserver(scrivi).observe(d.documentElement, { attributes: true, attributeFilter: ['data-tema'] }); } catch (e) {}
    });
  }

  /* ------------------------------------------------------------ capacita' del TV
   * f = i fatti raccolti dal servizio (e dalla pagina della home):
   *   servizio, tizen, appTv {n, errore}, modello, modelloPiattaforma, nome, tizenVer, tizenbrew, risoluzione,
   *   api8001, statoAccensione, apriAllAccensione, remoto ('ok'|'negato'|'assente'|'mai'|'attesa'),
   *   telefono {attivo, errore}, liste {stato, regole}, salvataggio ('tv'|'temporaneo'), casa, coloriVisti,
   *   pagina {ua, larghezza, altezza, chromium, variabiliCss}
   * Ogni domanda risponde { si: true | false | null (non si sa ancora), testo, fare } in italiano semplice. */

  // fisso: riprovare non cambia niente (per esempio il motore web del TV), quindi lo si dice subito
  function r(si, testo, fare, fisso) { return { si: si, testo: testo || '', fare: fare || '', fisso: !!fisso }; }
  // le altre TV (f.piattaforma: Android, Fire TV, LG): la stessa home, ma il servizio e' quello dell'app Home TV, non di
  // TizenBrew. f.sistema = "Android 12", "Fire OS 7", "webOS 6"; f.puoAprirsi = l'app puo' riaprire la home da sola;
  // f.riaccensione = false: su questo TV la riapertura all'accensione non c'e' proprio (LG)
  function altraTv(f) { return f.piattaforma === 'android' || f.piattaforma === 'firetv' || f.piattaforma === 'webos'; }
  var RIAPRI_APP = 'Chiudi Home TV e riaprila';
  var REINSTALLA = 'Rifai l\'installazione col programma Installa Home TV: scrive sul TV l\'indirizzo della tua home';
  function chromiumPagina(f) {
    var p = f.pagina || {};
    return p.chromium || (p.ua ? daUserAgent(p.ua).chromium : 0);
  }

  function haServizio(f) {
    if (f.servizio) return r(true, 'Il servizio del TV risponde');
    // la home ha perso la sua chiave del servizio (ui.js): la riprende all'avvio dell'app o del servizio
    if (f.senzaChiave) {
      return r(false, 'Il servizio del TV non riconosce pi\u00f9 questa pagina', altraTv(f) ? RIAPRI_APP :
        'Riavvia il TV: tieni premuto il tasto di accensione del telecomando finch\u00e9 compare il logo Samsung', true);
    }
    if (f.nonAutorizzata) {
      if (altraTv(f)) return r(false, 'Il servizio del TV non riconosce questa pagina', REINSTALLA, true);
      return r(false, 'Il servizio del TV non riconosce questa pagina',
        'In TizenBrew aggiungi il modulo tuonome/tv-sito (tuonome = il tuo nome su GitHub)', true);
    }
    var c = chromiumPagina(f);
    if (c && c < CHROMIUM_LOCALE) {
      if (altraTv(f)) return r(false, 'Su questo TV (motore web ' + c + ') la home non pu\u00f2 parlare con il servizio del TV',
        'Funzionano il tuo sito e il browser; le app del TV e il telefono no', true);
      return r(false, 'Su questo TV (motore web ' + c + ') la home non pu\u00f2 parlare con il servizio del TV',
        'Funzionano il tuo sito e il browser; le app del TV, il telefono e la riaccensione no. Serve un TV del 2018 o pi\u00f9 nuovo. ' +
        'Se il TV \u00e8 pi\u00f9 nuovo: chiudi TizenBrew e riaprilo', true);
    }
    if (altraTv(f)) return r(false, 'Il servizio del TV non risponde', RIAPRI_APP + '; se continua, spegni e riaccendi il TV');
    return r(false, 'Il servizio del TV non risponde',
      'Chiudi TizenBrew e riaprilo. Se continua: nelle impostazioni di TizenBrew (pulsanti tondi in alto) controlla l\'autoavvio e che Host PC IP sia 127.0.0.1; ' +
      'se TizenBrew \u00e8 vecchio, aggiornalo');
  }
  function haAppTv(f) {
    if (!f.servizio) return r(null, 'Non si sa (servizio del TV non raggiungibile)');
    if (!f.tizen && !altraTv(f)) return r(false, 'Il servizio non vede le app del TV', 'Riapri TizenBrew; se continua aggiorna TizenBrew');
    if (f.appTv && f.appTv.errore) return r(false, 'Elenco delle app non letto: ' + f.appTv.errore, altraTv(f) ? RIAPRI_APP : 'Riapri TizenBrew');
    return r(true, 'Collegate' + (f.appTv && f.appTv.n ? ' (' + f.appTv.n + ' app)' : ''));
  }
  function haRiaccensione(f) {
    if (!f.servizio) return r(null, 'Non si sa (servizio del TV non raggiungibile)');
    if (f.apriAllAccensione === false) return r(false, 'Spenta nelle impostazioni');
    if (altraTv(f)) {
      if (f.riaccensione === false) return r(false, 'Su questo TV la home non si riapre da sola all\'accensione',
        'Aprila dal menu delle app del TV (puoi metterla per prima)', true);
      if (f.puoAprirsi === false) return r(false, 'Il TV non lascia riaprire la home da sola',
        'Rifai l\'installazione col programma Installa Home TV: d\u00e0 a Home TV il permesso di aprirsi sopra le altre app');
      return r(true, 'S\u00ec, quando il TV si riaccende');
    }
    if (!f.tizen) return r(false, 'Il servizio non pu\u00f2 aprire app su questo TV', 'Riapri TizenBrew; se continua aggiorna TizenBrew');
    if (f.statoAccensione) return r(true, 'S\u00ec (il TV dice quando si accende)');
    return r(true, 'S\u00ec, ma solo quando il TV si risveglia dallo standby (questo TV non dice se \u00e8 acceso)');
  }
  function haTastiVeri(f) {
    var s = f.remoto;
    if (!f.servizio) return r(null, 'Non si sa (servizio del TV non raggiungibile)');
    if (s === 'ok') return r(true, 'S\u00ec: il telefono comanda tutto il TV');
    if (s === 'negato') return r(false, 'Permesso negato sul TV', 'Blu, Telefono, Tasti del TV dal telefono, poi Consenti sul TV');
    if (s === 'assente') return r(false, 'Questo TV non offre l\'ingresso per i telecomandi', 'Il telefono funziona lo stesso nella home, nel browser e nei siti');
    if (s === 'attesa') return r(null, 'Il TV sta chiedendo il permesso: scegli Consenti');
    // provato, ma il TV non ha mai mostrato la richiesta: si dice cosa ha risposto e dove si sblocca
    if (f.remotoErrore) {
      return r(null, 'Provato ' + (f.remotoTentativi || 1) + ' volte, il TV non ha chiesto il permesso (' + f.remotoErrore + ')',
        'Sul TV: Impostazioni, Tutte le impostazioni, Connessione, Gestione dispositivi esterni, Gestione connessione ' +
        'dispositivi: Notifica di accesso su "Solo la prima volta", e in Elenco dispositivi Home TV su Consenti. Poi premi ' +
        'un tasto sul telefono');
    }
    return r(null, 'Non ancora provato (si prova col primo telefono collegato)');
  }
  function haPortaTelefono(f) {
    if (!f.servizio) return r(null, 'Non si sa (servizio del TV non raggiungibile)');
    var t = f.telefono || {};
    if (t.attivo) return r(true, 'S\u00ec (porta 8091)');
    if (altraTv(f)) return r(false, 'Il TV non ha lasciato aprire la porta del telefono' + (t.errore ? ' (' + t.errore + ')' : ''),
      RIAPRI_APP + '; se continua, un\'altra app usa la porta 8091');
    return r(false, 'Il TV non ha lasciato aprire la porta del telefono' + (t.errore ? ' (' + t.errore + ')' : ''),
      'Tutto il resto funziona; per il telefono usa SmartThings. Se TizenBrew Installer \u00e8 rimasto aperto sul TV, chiudilo e riavvia il TV');
  }
  // riaprire la home dopo che il sistema ha dormito (standby)? Si', se il TV dice "acceso". Se non dice niente: si' solo
  // sui TV che lo stato non l'hanno mai detto (basta il salto dell'orologio); quelli che lo dicono a volte tacciono
  // appena spenti (S90C, S90F): li' niente, se no TizenBrew si aprirebbe col TV spento
  function riapriDopoSonno(stato, haStato) { return stato === 'on' || (!stato && !haStato); }
  // i tasti colorati non si possono chiedere al TV: si sanno quando ne arriva uno. Le alternative ci sono sempre
  function haTastiColorati(f) {
    if (f.coloriVisti) return r(true, 'S\u00ec (gi\u00e0 usati)');
    return r(null, 'Non ancora visti',
      'Senza tasti colorati: nella home OK tenuto premuto e l\'ingranaggio in alto; nei siti OK tenuto premuto apre il menu rapido (il Blu)' +
      (altraTv(f) ? '' : '. Sui telecomandi SolarCell i colori compaiono premendo 123'));
  }
  function haListe(f) {
    var l = f.liste || {};
    if (!f.servizio) return r(null, 'Non si sa (servizio del TV non raggiungibile)');
    if (l.stato === 'ok') return r(true, 'Aggiornate' + (l.regole ? ' (' + l.regole + ' regole)' : ''));
    if (l.stato === 'errore') return r(false, 'Non scaricate', 'Il TV non raggiunge i siti delle liste: riprova pi\u00f9 tardi (vale il blocco interno)');
    return r(null, 'Non ancora scaricate (vale il blocco interno)');
  }
  function haSalvataggio(f) {
    if (!f.servizio) return r(null, 'Non si sa (servizio del TV non raggiungibile)');
    if (f.salvataggio === 'tv') return r(true, 'Sulla memoria del TV');
    return r(false, 'Solo temporaneo: spegnendo il TV si perdono cronologia e impostazioni del servizio',
      (altraTv(f) ? '' : 'Aggiorna TizenBrew; ') + 'la home tiene comunque una sua copia delle impostazioni');
  }
  function haCasa(f) {
    if (!f.servizio || f.casa === undefined) return r(null, '');
    if (f.casa) return r(true, 'S\u00ec');
    if (altraTv(f)) return r(false, 'Il servizio non sa qual \u00e8 la tua home', REINSTALLA);
    return r(false, 'Il servizio non trova la home tra i moduli di TizenBrew', 'In TizenBrew il modulo deve essere tuonome/tv-sito');
  }
  // versione di Tizen e TizenBrew: solo per dire cosa fare, mai per spegnere una funzione
  function haTizenSupportato(f) {
    if (altraTv(f)) return f.sistema ? r(true, String(f.sistema)) : r(null, 'Versione del sistema non letta');
    var t = numero(f.tizenVer || daUserAgent((f.pagina || {}).ua).tizen);
    if (!t) return r(null, 'Versione di Tizen non letta');
    if (t < TIZEN_MINIMO) return r(false, 'Tizen ' + t.toFixed(1) + ': TizenBrew funziona da Tizen 3.0 (TV del 2017 o pi\u00f9 nuovi)',
      'Su questo TV TizenBrew e Home TV non si possono usare');
    if (t >= 8) return r(true, 'Tizen ' + t.toFixed(1) + ' (sui TV nuovi TizenBrew va tenuto aggiornato)');
    return r(true, 'Tizen ' + t.toFixed(1));
  }

  // l'app Video: le chiavette attaccate al TV si leggono? (nel servizio videoteca.prova: si apre la prima chiavetta)
  function haChiavette(f) {
    var c = f.chiavette;
    if (!f.servizio || !c || c.stato === 'nonPrevisto') return r(null, '');
    if (c.stato === 'ok') return r(true, c.dischi === 1 ? 'S\u00ec, il servizio legge la chiavetta attaccata' :
      'S\u00ec, il servizio legge le ' + c.dischi + ' chiavette o dischi attaccati');
    if (c.stato === 'nessuna') return r(null, 'Nessuna chiavetta attaccata', 'Attacca una chiavetta o un disco USB per provarle');
    var fare = 'I film delle chiavette si vedono col lettore del TV (Sorgente, USB); con il server sul computer si vedono anche nell\'app Video';
    if (c.stato === 'permesso') return r(false, 'Il TV non lascia leggere le chiavette al servizio di Home TV', fare, true);
    if (c.stato === 'assente') return r(false, 'Il TV non mostra le chiavette al servizio di Home TV', fare, true);
    return r(null, 'Non si sa: errore leggendo le chiavette', 'Stacca e riattacca la chiavetta');
  }

  /* ------------------------------------------------------------ l'app Video: cosa legge il <video> di questo TV
   * I codec dentro i file (MKV, MP4) che il lettore del TV decodifica da solo; quelli che non legge l'app li toglie dal
   * file servito (videoteca.js) e sceglie un'altra traccia. Samsung, dalle tabelle "TV Video Specifications": DTS tolto
   * dal 2018 (Tizen 4), TrueHD mai nelle tabelle, AV1 dal 2020 (Tizen 5.5). FLAC nei video parte in ritardo (jellyfin-web
   * lo converte): 'ultimo' = si usa solo se non c'e' altro. Le altre TV per ora come i Samsung recenti. */
  function videoLetti(f) {
    f = f || {};
    var altra = altraTv(f), tizen = altra ? 0 : numero(f.tizenVer || daUserAgent((f.pagina || {}).ua).tizen);
    return {
      audio: { AC3: true, EAC3: true, AAC: true, MP3: true, MP2: true, PCM: true, OPUS: true, VORBIS: true, FLAC: 'ultimo',
        DTS: !altra && tizen > 0 && tizen < 4, TRUEHD: false },
      video: { HEVC: true, AVC: true, AV1: altra || !tizen || tizen >= 5.5, VP9: true, VP8: true, MPEG2: true, MPEG4: true, VC1: true }
    };
  }

  // riassunto per "Questo TV" (impostazioni) e per l'autodiagnosi all'avvio: le voci in ordine, con lo stato
  var VOCI = [
    ['servizio', 'Servizio del TV', haServizio], ['tizen', 'Sistema', haTizenSupportato], ['casa', 'Home riconosciuta', haCasa],
    ['app', 'App del TV', haAppTv], ['riaccensione', 'Riapertura della home', haRiaccensione],
    ['telefono', 'Telefono (porta 8091)', haPortaTelefono], ['tastiVeri', 'Comando completo dal telefono', haTastiVeri],
    ['colori', 'Tasti colorati', haTastiColorati], ['liste', 'Liste di filtri', haListe], ['salvataggio', 'Salvataggio', haSalvataggio],
    ['chiavette', 'Chiavette USB (app Video)', haChiavette]
  ];
  function diagnosi(f) {
    var out = [];
    for (var i = 0; i < VOCI.length; i++) {
      var x = VOCI[i][2](f);
      if (!x.testo) continue;
      out.push({ id: VOCI[i][0], nome: VOCI[i][1], stato: x.si === true ? 'ok' : x.si === false ? 'manca' : 'forse', testo: x.testo, fare: x.fare,
        fisso: x.fisso });
    }
    return out;
  }
  // il profilo completo: chi e' il TV (riconosciuto con le API, lo user agent come ripiego) e cosa sa fare
  function componi(f) {
    var ua = daUserAgent((f.pagina || {}).ua), altra = altraTv(f);
    // l'anno si legge solo dai modelli Samsung
    var anno = altra ? 0 : annoDaPiattaforma(f.modelloPiattaforma) || annoDaModello(f.modello) || 0;
    var tizen = altra ? '' : f.tizenVer || ua.tizen || (perAnno(anno) ? perAnno(anno).tizen : '');
    var chromium = chromiumPagina(f) || (perTizen(tizen) ? perTizen(tizen).chromium : 0);
    var d = diagnosi(f), capacita = {}; // true = c'e', false = manca, null = non si sa ancora
    for (var i = 0; i < d.length; i++) capacita[d[i].id] = d[i].stato === 'ok' ? true : d[i].stato === 'manca' ? false : null;
    return {
      nome: f.nome || '', modello: f.modello || '', anno: anno, tizen: tizen, chromium: chromium,
      risoluzione: f.risoluzione || ((f.pagina || {}).larghezza ? f.pagina.larghezza + 'x' + f.pagina.altezza : ''),
      tizenbrew: f.tizenbrew || '', servizio: f.versioneServizio || '', capacita: capacita, diagnosi: d,
      piattaforma: altra ? f.piattaforma : 'tizen', sistema: altra ? String(f.sistema || '') : tizen ? 'Tizen ' + tizen : ''
    };
  }

  return {
    ANNI: ANNI, OK_TENUTO_MS: OK_TENUTO_MS, annoDaModello: annoDaModello, annoDaPiattaforma: annoDaPiattaforma,
    daUserAgent: daUserAgent, perTizen: perTizen, perAnno: perAnno, tizenbrewPerAnno: tizenbrewPerAnno,
    serveCertificato: serveCertificato, suTv: suTv, piattaforma: piattaforma, TASTI: TASTI, daChiedereAlServizio: daChiedereAlServizio,
    motore: motore, ripara: ripara, selettore: selettore, variabiliCss: variabiliCss, scorriPagina: scorriPagina, mostra: mostra,
    haServizio: haServizio, haAppTv: haAppTv, haRiaccensione: haRiaccensione, haTastiVeri: haTastiVeri, haPortaTelefono: haPortaTelefono,
    haTastiColorati: haTastiColorati, altraTv: altraTv, riapriDopoSonno: riapriDopoSonno, haListe: haListe, haSalvataggio: haSalvataggio, haCasa: haCasa, haTizenSupportato: haTizenSupportato,
    haChiavette: haChiavette, videoLetti: videoLetti, diagnosi: diagnosi, componi: componi
  };
})();
