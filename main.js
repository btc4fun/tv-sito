/*
 * Home TV - codice iniettato nei siti (il tuo sito e quelli aperti dal Browser)
 * TizenBrew lo inserisce in ogni pagina e riquadro aperto dal modulo.
 *
 * Fa: blocco della pubblicita' (liste di filtri EasyList; il blocco avanzato
 * solo se lo accende chi usa la home), blocco popup e reindirizzamenti,
 * video a schermo intero, navigazione con le frecce, pannello rapido (Blu).
 *
 * NOTA: solo caratteri ASCII e JavaScript ES5: il browser dei TV e' datato.
 */
(function () {
  'use strict';
  // le pagine senza un indirizzo vero (la pagina vuota da cui parte ogni riquadro, about:blank): niente, e senza segnale.
  // Un riquadro che poi apre una pagina dello stesso sito tiene la stessa finestra, e li' main.js deve poter partire
  if (!/^https?:$/.test(location.protocol)) return;
  // una sola volta per pagina (il segnale non compare tra le proprieta' della finestra)
  if (window.__hometvAttivo) return;
  try { Object.defineProperty(window, '__hometvAttivo', { value: true, enumerable: false }); } catch (e) { return; }
  /* <profilo:generato> copia di tv-sito/profilo.js (prove/incorpora_profilo.py): non modificare qui */
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
      if (c.stato === 'lettura') return r(false, 'Il servizio di Home TV vede le chiavette ma non apre i film' + (c.codice ? ' (' + c.codice + ')' : ''), fare, true);
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

    // il tetto di partenza dell'app Video: quanti Mbps il TV regge senza scatti, finche' una prova non dice altro. 150 dai TV
    // del 2020 (Tizen 5.5; il Q80B del 2022 ha retto 250 Mbps in tempo reale, prova del 30/10/2026), 80 sui piu' vecchi,
    // sulle altre TV e quando non si sa. Il decoder non si puo' provare dal servizio: qui vale la versione (o l'anno)
    function tettoVideo(f) {
      f = f || {};
      if (altraTv(f)) return '80';
      var tizen = numero(f.tizenVer || daUserAgent((f.pagina || {}).ua).tizen);
      if (!tizen) {
        var a = perAnno(annoDaPiattaforma(f.modelloPiattaforma) || annoDaModello(f.modello) || 0);
        if (a) tizen = numero(a.tizen);
      }
      return tizen >= 5.5 ? '150' : '80';
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
      haChiavette: haChiavette, videoLetti: videoLetti, tettoVideo: tettoVideo, diagnosi: diagnosi, componi: componi
    };
  })();
  /* </profilo:generato> */
  // i TV 2017 (Chromium 47) non hanno tutto quello che usa questo codice: il profilo del TV lo rimette (solo dove manca)
  ProfiloTV.ripara(window);
  var MOTORE = ProfiloTV.motore(window);

  var VERSIONE = '1.3.6';
  var SERVIZIO = 'http://127.0.0.1:8090';
  var IN_FRAME = false;
  try { IN_FRAME = window.top !== window.self; } catch (e) { IN_FRAME = true; }
  var HOST = location.hostname;

  // YouTube: sul TV si usa la sua interfaccia per la TV (youtube.com/tv), fatta per il telecomando. Li' i tasti li usa
  // YouTube (tranne Blu e Verde: il nostro menu rapido e la home); il nostro lettore e il blocco generico restano fuori.
  // Il sito per computer solo se lo scegli tu (menu rapido)
  var YT = /^(www\.|m\.)?youtube\.com$/i.test(HOST), YT_TV = YT && /^\/tv(\/|$)/.test(location.pathname);
  // Mai un giro senza fine: se YouTube non da' la pagina per la TV a questo apparecchio, la sua pagina "ti stiamo
  // reindirizzando" ci rimanda al sito normale. Tornati da li' da pochi secondi senza che l'app per la TV si sia mai
  // aperta, si resta sul sito normale finche' l'app resta aperta (dal menu rapido si puo' riprovare)
  var VERSO_TV = (function versoYoutubeTv() {
    if (!YT || IN_FRAME) return false;
    var ora = Date.now();
    try {
      if (YT_TV) {
        sessionStorage.setItem('hometv-yt-tv', String(ora));
        // l'app per la TV si e' aperta davvero (ha i suoi moduli): allora non e' un rimando indietro
        var giri = 0, t = setInterval(function () {
          if (window._yttv) { try { sessionStorage.removeItem('hometv-yt-tv'); } catch (e) {} clearInterval(t); }
          else if (++giri > 40) clearInterval(t);
        }, 250);
        return false;
      }
      if (/^\/(embed|api|youtubei|s\/|sw\.js|redirect|signin|logout|account)/i.test(location.pathname)) return false;
      if (localStorage.getItem('hometv-yt-computer') === '1' || sessionStorage.getItem('hometv-yt-no-tv') === '1') return false;
      if (ora - (+sessionStorage.getItem('hometv-yt-tv') || 0) < 15000) { sessionStorage.setItem('hometv-yt-no-tv', '1'); return false; }
    } catch (e) { return false; }
    // il video (anche uno Shorts o una diretta), il minuto e la playlist
    var v = /[?&]v=([\w-]{6,20})/.exec(location.search), s = /^\/(shorts|live)\/([\w-]{6,20})/.exec(location.pathname);
    var id = v ? v[1] : s ? s[2] : '', t = /[?&]t=(\d+)s?(&|$)/.exec(location.search), l = /[?&]list=([\w-]{6,64})/.exec(location.search);
    // la pagina per computer sta per sparire: non la si carica oltre (sui TV vecchi sarebbe lavoro buttato)
    try { window.stop(); } catch (e) {}
    try {
      location.replace('https://www.youtube.com/tv' + (id ? '#/watch?v=' + id + (t ? '&t=' + t[1] + 's' : '') + (l ? '&list=' + l[1] : '') : ''));
      return true;
    } catch (e) {}
    return false;
  })();
  if (VERSO_TV) return; // niente liste, agganci e osservatori su una pagina che se ne va

  // Indirizzo della home: lo sa il servizio del TV (lo legge da TizenBrew),
  // qui se ne tiene una copia. Niente da scrivere a mano.
  var BASE = '';
  try { BASE = localStorage.getItem('hometv-casa') || ''; } catch (e) {}
  if (!/^https?:\/\/[^\/]+\//i.test(BASE)) BASE = '';

  function hostOf(u) {
    try { return new URL(u, location.href).hostname.toLowerCase(); } catch (e) { return ''; }
  }
  // "www.sito.it" -> "sito.it", "news.bbc.co.uk" -> "bbc.co.uk" (indirizzi IP: interi)
  function dominioBase(h) {
    h = h || '';
    if (/^[\d.]+$/.test(h) || h.indexOf(':') !== -1) return h;
    var p = h.split('.');
    if (p.length > 2 && p[p.length - 1].length === 2 && /^(co|com|net|org|gov|edu|ac|or|ne|go)$/.test(p[p.length - 2])) return p.slice(-3).join('.');
    return p.length > 2 ? p.slice(-2).join('.') : h;
  }
  var LAUNCHER_HOST = BASE ? hostOf(BASE) : '';
  function impostaCasa(u) {
    if (typeof u !== 'string' || !/^https?:\/\/[^\/]+\//i.test(u)) return;
    BASE = u;
    LAUNCHER_HOST = hostOf(u);
    try { localStorage.setItem('hometv-casa', u); } catch (e) {}
  }
  // la home e il browser della home hanno gia' il loro codice (lo segnalano con questo)
  // vale solo sulle pagine della home (o di prova) e nel riquadro di un'app dello Store: un sito qualsiasi non puo'
  // spegnere Home TV su se stesso mettendo questo segno
  function paginaDiCasa() {
    if (window.__hometvCasa !== true) return false;
    return (LAUNCHER_HOST && HOST === LAUNCHER_HOST) || HOST === 'localhost' || HOST === '127.0.0.1' ||
      (IN_FRAME && window.name === 'hometv-app' && sopraUnaHome());
  }

  // Pagine con il loro codice o interne: qui non si fa nulla.
  if (!/^https?:$/.test(location.protocol)) return;
  if (LAUNCHER_HOST && HOST === LAUNCHER_HOST) return;
  if ((HOST === '127.0.0.1' || HOST === 'localhost') && location.port === '8090') return;
  if (/\.github\.io$/i.test(HOST) && /^\/tv-sito\//.test(location.pathname)) return;
  if ((HOST === '127.0.0.1' || HOST === 'localhost') && location.port === '8081') return;
  // dentro il riquadro di un'app dello store (store.html): l'app ha la sua libreria (tv-app.js) e i tasti glieli passa
  // la home. Qui niente blocco della pubblicita' ne' pulizie, che la potrebbero rompere. Vale solo se la pagina sopra e'
  // una home (github.io, o le pagine delle prove): un sito qualsiasi non puo' spegnere il blocco nei suoi riquadri
  function sopraUnaHome() {
    var a = null;
    // solo il riquadro diretto della pagina principale (lo Store), non un riquadro dentro un altro riquadro
    try { if (window.parent !== window.top) return false; } catch (e) { return false; }
    try { a = location.ancestorOrigins; } catch (e) {}
    if (!a || !a.length) return true;
    var cima = String(a[0]);
    return /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(cima) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cima) ||
      /^chrome-extension:\/\//i.test(cima);
  }
  if (IN_FRAME && window.name === 'hometv-app' && sopraUnaHome()) return;

  var bloccati = 0;
  var DEBUG = false;
  try { DEBUG = localStorage.getItem('hometv-debug') === '1'; } catch (e) {}
  function log() {
    try { console.log.apply(console, ['[HomeTV]'].concat([].slice.call(arguments))); } catch (e) {}
  }
  function conta(motivo, dettaglio) {
    bloccati++;
    if (DEBUG) log('bloccato', motivo, dettaglio || '');
  }
  // Le funzioni sostituite mantengono la forma di quelle originali, per non rompere i siti che le controllano.
  function comeOriginale(f, nome) {
    try {
      var t = function () { return 'function ' + nome + '() { [native code] }'; };
      Object.defineProperty(t, 'toString', { value: t, enumerable: false });
      Object.defineProperty(f, 'toString', { value: t, enumerable: false, configurable: true });
    } catch (e) {}
    return f;
  }

  // Blocco pubblicita' spento a mano per questo sito (pannello Blu)?
  var bloccoAttivo = true;
  var bloccoSpentoDallaPagina = false; // nei riquadri: spento dalla pagina che li contiene
  var SPENTO_QUI = false;
  // <solo-completa>
  // YouTube per la TV dal riquadro della home (che c'e' solo col blocco avanzato acceso): l'indirizzo ha il segno
  // "hometv=senza-spot", cosi' gli agganci ci sono gia' prima degli script di YouTube. Vale per la visita (anche dopo
  // l'accesso all'account o un ricaricamento), anche col blocco della pubblicita' spento per tutti i siti, e conta piu'
  // della scelta fatta prima nel menu Blu, ma solo col blocco avanzato acceso: spento nelle impostazioni non vale piu'
  // (vedi avanzatoTv). Quella scelta su YouTube per la TV ha una sua chiave (il sito per computer tiene la sua). Il segno
  // si toglie subito dall'indirizzo: ricaricando la pagina vale la scelta del menu Blu
  var YT_SENZA_SPOT = false, YT_SPOT_LASCIATI = false;
  if (YT_TV) {
    var segnoYt = /([?&])hometv=senza-spot(&|$)/;
    if (segnoYt.test(location.search)) {
      YT_SENZA_SPOT = true;
      try { sessionStorage.setItem('hometv-yt-senza-spot', '1'); localStorage.removeItem('hometv-yt-spot-off'); } catch (e) {}
      try {
        history.replaceState(history.state, '', location.pathname +
          location.search.replace(segnoYt, function (x, a, b) { return b ? a : ''; }) + location.hash);
      } catch (e) {}
    }
    try {
      YT_SENZA_SPOT = YT_SENZA_SPOT || sessionStorage.getItem('hometv-yt-senza-spot') === '1';
      YT_SPOT_LASCIATI = localStorage.getItem('hometv-yt-spot-off') === '1';
    } catch (e) {}
  }
  // </solo-completa>
  try { SPENTO_QUI = localStorage.getItem('hometv-adblock-off') === '1'; if (SPENTO_QUI) bloccoAttivo = false; } catch (e) {}
  // su YouTube per la TV niente blocco generico (ha la sua interfaccia)
  if (YT_TV) bloccoAttivo = false;
  // Blocco avanzato (impostazioni del TV, spento di base: lo accende chi usa la home). Serve prima degli script del
  // sito: se ne tiene una copia per sito, aggiornata dalle impostazioni
  var AVANZATO = false;
  try { AVANZATO = localStorage.getItem('hometv-avanzato') === '1'; } catch (e) {}

  /* ================================================================ adblock: elenco */

  var AD_PAROLE = [
    'doubleclick', 'googlesyndication', 'googleadservices', 'adservice.google', 'adnxs',
    'popads', 'popcash', 'propellerads', 'adsterra', 'exoclick', 'exosrv', 'juicyads',
    'hilltopads', 'clickadu', 'monetag', 'admaven', 'ad-maven', 'a-ads.com', 'adcash',
    'trafficjunky', 'trafficstars', 'realsrv', 'onclckds', 'onclickads', 'notix.io',
    'richpush', 'evadav', 'galaksion', 'mgid.com', 'taboola', 'outbrain', 'revcontent',
    'bidgear', 'adskeeper', 'rollerads', 'highperformanceformat', 'profitablecpmrate',
    'profitableratecpm', 'pushame', 'adspyglass', 'clickaine', 'zeydoo', 'amazon-adsystem',
    'pubmatic', 'rubiconproject', 'criteo', 'smartadserver', 'teads.tv', 'moatads', 'googletagservices'
  ];
  var adList = AD_PAROLE.slice();

  // tipo: 'script', 'frame', 'image', 'xhr' (risorse della pagina), 'pagina' (link e
  // indirizzi da aprire), 'popup' (nuove finestre). contesto: sito che fa la richiesta.
  function eAd(url, tipo, contesto) {
    if (!bloccoAttivo || !url) return false;
    var u = String(url).toLowerCase();
    if (u.indexOf('http') !== 0 && u.indexOf('//') !== 0) {
      // indirizzo dello stesso sito ("/ads/banner.js"): solo le regole delle liste
      if (!LISTE || tipo === 'pagina' || tipo === 'popup' || /^(data|blob|javascript|about|mailto|tel):/.test(u)) return false;
      try { u = new URL(String(url), location.href).href.toLowerCase(); } catch (e) { return false; }
      if (u.indexOf('http') !== 0) return false;
      return listeBloccano(u, tipo, contesto);
    }
    // pagine e finestre: le parole pubblicitarie solo nel dominio (un articolo che parla di "taboola" non e' una pubblicita')
    var dove = tipo === 'pagina' || tipo === 'popup' ? hostUrl(u) : u;
    for (var i = 0; i < adList.length; i++) {
      if (adList[i] && dove.indexOf(adList[i]) !== -1) return true;
    }
    return !!LISTE && listeBloccano(u, tipo, contesto);
  }

  /* ================================================================ adblock: liste della comunita'
   * Le liste della comunita' (EasyList, EasyList Italy; col blocco avanzato anche anti-adblock),
   * preparate dal servizio del TV. Si chiedono subito e si aspetta la risposta
   * (pochi millesimi: il servizio e' sul TV stesso), cosi' valgono gia' per i
   * primi script del sito. Servizio non raggiungibile: restano le liste interne
   * qui sopra e si riprova tra poco. I riquadri minuscoli (quasi sempre
   * pubblicita') non le caricano.
   */

  // (un riquadro ancora chiuso, alto o largo 0, non e' minuscolo: e' un pannello che si sta aprendo, come le app di Google)
  var MINUSCOLO = IN_FRAME && window.innerWidth > 0 && window.innerHeight > 0 && (window.innerWidth < 300 || window.innerHeight < 200);
  var SICURI = []; // il tuo sito e i domini consentiti (dal servizio): mai pubblicita' per le liste
  // nei riquadri piccoli (quasi sempre pubblicita' 300x250) le liste non si caricano: bastano quelle interne
  var PICCOLO = IN_FRAME && window.innerWidth > 0 && (window.innerWidth < 480 || window.innerHeight < 270);
  // ... e neanche in quelli che all'inizio non si vedono (larghi o alti 0: contatori, pubblicita' nascoste, un pannello che
  // deve ancora aprirsi): niente attesa del servizio in un riquadro che non mostra niente. Valgono le liste interne
  var NASCOSTO = IN_FRAME && (window.innerWidth === 0 || window.innerHeight === 0);
  var LISTE = null;
  var QUI = dominioBase(HOST);
  var origXHROpen = XMLHttpRequest.prototype.open, origXHRSend = XMLHttpRequest.prototype.send;
  var origAEL = EventTarget.prototype.addEventListener;
  // per gli ascolti aggiunti dopo l'avvio (uno snippet "prevent-listener" del sito non li deve toccare)
  function ascoltaSicuro(el, tipo, fn, cattura) { try { origAEL.call(el, tipo, fn, cattura); } catch (e) {} }

  // I nostri pannelli si costruiscono pezzo per pezzo, senza HTML scritto come testo: cosi' vanno
  // anche sui siti che accettano solo HTML "fidato" (Trusted Types, per esempio YouTube), senza
  // regole da chiedere e senza errori nella console. Solo il nostro HTML, mai quello del sito.
  function scriviHtml(el, html) {
    while (el.firstChild) el.removeChild(el.firstChild);
    costruisciHtml(el, String(html));
  }
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', middot: '\u00b7', ugrave: '\u00f9', egrave: '\u00e8', agrave: '\u00e0' };
  var VUOTI = { br: 1, hr: 1, img: 1, input: 1, wbr: 1 };
  function testoHtml(t) {
    return t.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function (tutto, e) {
      if (e.charAt(0) === '#') return String.fromCharCode(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ha(ENTITA, e) ? ENTITA[e] : tutto;
    });
  }
  // solo per il nostro HTML (tag, attributi tra virgolette doppie, testo con le entita')
  function costruisciHtml(radice, html) {
    var pila = [radice], re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=\/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g, m;
    while ((m = re.exec(html))) {
      var cima = pila[pila.length - 1];
      if (m[5] !== undefined) { cima.appendChild(document.createTextNode(testoHtml(m[5]))); continue; }
      if (m[1]) { if (pila.length > 1) pila.pop(); continue; }
      var tag = m[2], svg = tag.toLowerCase() === 'svg' || (cima !== radice && cima.namespaceURI === SVG_NS);
      var el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
      var ra = /([^\s=\/>]+)(?:="([^"]*)")?/g, a;
      while ((a = ra.exec(m[3]))) el.setAttribute(a[1], a[2] === undefined ? '' : testoHtml(a[2]));
      cima.appendChild(el);
      if (!m[4] && !VUOTI[tag.toLowerCase()]) pila.push(el);
    }
  }

  // Le cose su cui il sito ascolta i clic (anche <div> e <li> senza link ne' pulsanti): col
  // telecomando si scelgono come i pulsanti. Lo stesso per il passaggio del mouse (menu che
  // si aprono quando ci si passa sopra).
  var ASCOLTI_CLIC = { click: 1, mousedown: 1, mouseup: 1, pointerdown: 1, pointerup: 1, touchstart: 1, touchend: 1 };
  var ASCOLTI_SOPRA = { mouseenter: 1, mouseover: 1, pointerenter: 1, pointerover: 1 };
  var sopraGlobale = false; // il sito ascolta il passaggio del mouse su tutta la pagina (e poi guarda dove)
  var segnati = [];
  function segna(el, chiave) {
    if (!el || el.nodeType !== 1 || el[chiave] || el === document.documentElement || el === document.body) return;
    try { Object.defineProperty(el, chiave, { value: true, configurable: true }); } catch (e) { return; }
    if (chiave !== '__hometvClic') return;
    navSporca = true;
    segnati.push(el);
    if (segnati.length > 6000) {
      var tenuti = [];
      for (var i = 0; i < segnati.length; i++) if (segnati[i].isConnected) tenuti.push(segnati[i]);
      segnati = tenuti.slice(-5000);
    }
  }
  try {
    EventTarget.prototype.addEventListener = comeOriginale(function (tipo) {
      if (ASCOLTI_CLIC[tipo] === 1) segna(this, '__hometvClic');
      else if (ASCOLTI_SOPRA[tipo] === 1) {
        if (this === window || this === document || this === document.documentElement || this === document.body) sopraGlobale = true;
        else segna(this, '__hometvSopra');
      }
      return origAEL.apply(this, arguments);
    }, 'addEventListener');
  } catch (e) {}
  // Player fatti come componenti della pagina (il video sta in una parte "shadow", che il
  // resto della pagina non vede): si tiene nota dei loro video quando si caricano.
  var videiOmbra = [];
  try {
    var origOmbra = Element.prototype.attachShadow;
    if (typeof origOmbra === 'function') {
      Element.prototype.attachShadow = comeOriginale(function () {
        var r = origOmbra.apply(this, arguments);
        try { this.__hometvOmbra = true; } catch (e) {} // ha dentro una parte nascosta: non e' uno strato vuoto
        try {
          ascoltaSicuro(r, 'loadedmetadata', function (ev) {
            var v = ev.target;
            if (v && v.tagName === 'VIDEO' && videiOmbra.indexOf(v) === -1) videiOmbra.push(v);
          }, true);
          ascoltaSicuro(r, 'playing', function (ev) { try { suPlaying(ev); } catch (e) {} }, true);
          ascoltaSicuro(r, 'loadeddata', function (ev) { try { suCaricato(ev); } catch (e) {} }, true);
        } catch (e) {}
        return r;
      }, 'attachShadow');
    }
  } catch (e) {}
  // Il lettore del sito chiede play() subito dopo che hai chiesto di guardare (OK, Play, un clic col puntatore) e il
  // browser vieta l'audio (nella pagina non e' mai arrivato un tasto vero: per esempio solo comandi del telefono senza
  // i tasti veri del TV): invece di restare fermo il video parte senza audio e lo si dice. Le anteprime che partono da
  // sole non c'entrano (solo entro 10 s da una tua richiesta)
  var origPlay = null, chiestoPlayA = 0;
  try {
    origPlay = HTMLMediaElement.prototype.play;
    if (typeof origPlay === 'function') {
      HTMLMediaElement.prototype.play = comeOriginale(function () {
        var v = this, pr = origPlay.apply(this, arguments);
        if (pr && typeof pr.then === 'function' && v.tagName === 'VIDEO' && Date.now() - chiestoPlayA < 10000) {
          pr.then(null, function (err) { if (err && err.name === 'NotAllowedError' && !v.muted) partiSenzaAudio(v); });
        }
        return pr;
      }, 'play');
    } else origPlay = null;
  } catch (e) {}
  function tuttiIVideo() {
    var out = Array.prototype.slice.call(document.querySelectorAll('video'));
    for (var i = videiOmbra.length - 1; i >= 0; i--) {
      if (!videiOmbra[i].isConnected) videiOmbra.splice(i, 1);
      else out.push(videiOmbra[i]);
    }
    return out;
  }
  try {
    ['onclick', 'onmousedown', 'onpointerdown', 'onmouseup', 'onmouseenter', 'onmouseover'].forEach(function (p) {
      var d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, p);
      if (!d || !d.set || !d.configurable) return;
      var chiave = /enter|over/.test(p) ? '__hometvSopra' : '__hometvClic';
      Object.defineProperty(HTMLElement.prototype, p, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set: comeOriginale(function (f) { if (f) segna(this, chiave); return d.set.call(this, f); }, p)
      });
    });
  } catch (e) {}

  function ha(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function righe(s) { return typeof s === 'string' && s ? s.split('\n') : []; }

  // true = risposta letta (anche "niente liste"); false = da riprovare
  function leggiListe(testo) {
    var j;
    try { j = JSON.parse(testo); } catch (e) { return false; }
    if (!j || typeof j !== 'object') return false;
    if (j.blocco === false) { bloccoAttivo = false; return true; } // blocco spento nelle impostazioni del TV
    if (Array.isArray(j.sicuri)) SICURI = j.sicuri.map(function (d) { return dominioBase(String(d)); });
    if (!j.ver || j.off) return true; // liste non ancora pronte, oppure sito da lasciare stare (lo dicono le liste)
    var s = j.sito && typeof j.sito === 'object' ? j.sito : {};
    LISTE = {
      rete: typeof j.rete === 'string' ? j.rete : '', terze: righe(j.terze), popup: righe(j.popup), consentiHost: righe(j.consentiHost),
      schemi: j.schemi && typeof j.schemi === 'object' ? j.schemi : {},
      consenti: j.consenti && typeof j.consenti === 'object' ? j.consenti : {},
      noblock: !!j.noblock, css: typeof j.css === 'string' ? j.css : '',
      sito: {
        rete: righe(s.rete).sort(), terze: righe(s.terze).sort(), consentiHost: righe(s.consentiHost).sort(),
        schemi: Array.isArray(s.schemi) ? s.schemi : [], consenti: Array.isArray(s.consenti) ? s.consenti : [],
        css: typeof s.css === 'string' ? s.css : '', proc: Array.isArray(s.proc) ? s.proc : [],
        snip: Array.isArray(s.snip) ? s.snip : []
      }
    };
    esiti = {}; nEsiti = 0;
    return true;
  }

  function caricaListe() {
    if (!bloccoAttivo || PICCOLO || NASCOSTO || typeof XMLHttpRequest !== 'function') return false;
    try {
      var x = new XMLHttpRequest();
      origXHROpen.call(x, 'GET', SERVIZIO + '/api/adblock?host=' + encodeURIComponent(HOST), false); // attesa voluta
      origXHRSend.call(x, null);
      return x.status === 200 && leggiListe(x.responseText);
    } catch (e) { return false; }
  }
  var listePronte = false;

  // il servizio non c'era (TV appena acceso): si riprova piu' tardi, senza aspettare
  function riprovaListe(tentativo) {
    if (listePronte || !bloccoAttivo || PICCOLO || NASCOSTO || typeof window.fetch !== 'function') return;
    setTimeout(function () {
      origFetchListe(SERVIZIO + '/api/adblock?host=' + encodeURIComponent(HOST), { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          listePronte = leggiListe(t);
          if (LISTE) { applicaStili(); pianificaPulizia(); }
        })['catch'](function () { if (tentativo < 3) riprovaListe(tentativo + 1); });
    }, 4000 * tentativo);
  }
  // un riquadro nato nascosto che poi si apre (un lettore in un contenitore nascosto, un pannello): le liste del servizio
  // arrivano appena si vede, senza attesa. Se resta piccolo (una pubblicita' 300x250) valgono le interne, come per PICCOLO
  if (NASCOSTO) {
    ascoltaSicuro(window, 'resize', function () {
      if (!NASCOSTO || window.innerWidth === 0 || window.innerHeight === 0) return;
      NASCOSTO = false;
      if (window.innerWidth < 480 || window.innerHeight < 270) return;
      riprovaListe(0);
    });
  }
  var origFetchListe = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  // la stessa ricerca in un elenco ordinato tenuto come testo ("a.com\nb.com\n..."): niente decine di migliaia di stringhe
  function inTesto(t, h) {
    var lo = 0, hi = t.length;
    while (lo < hi) {
      var m = (lo + hi) >> 1, ini = t.lastIndexOf('\n', m - 1) + 1, fine = t.indexOf('\n', m);
      if (fine === -1) fine = t.length;
      if (ini < lo) ini = lo;
      var v = t.slice(ini, fine);
      if (v === h) return true;
      if (v < h) lo = fine + 1; else hi = ini;
    }
    return false;
  }

  // "www.ads.example.com": si cercano www.ads.example.com, ads.example.com, example.com (elenchi ordinati)
  function inElenco(a, h) {
    if (!a.length) return false;
    if (typeof a === 'string') {
      for (;;) {
        if (inTesto(a, h)) return true;
        var p = h.indexOf('.');
        if (p === -1) return false;
        h = h.slice(p + 1);
        if (h.indexOf('.') === -1) return false;
      }
    }
    for (;;) {
      var lo = 0, hi = a.length - 1;
      while (lo <= hi) {
        var m = (lo + hi) >> 1, v = a[m];
        if (v === h) return true;
        if (v < h) lo = m + 1; else hi = m - 1;
      }
      var k = h.indexOf('.');
      if (k === -1) return false;
      h = h.slice(k + 1);
      if (h.indexOf('.') === -1) return false;
    }
  }

  function hostUrl(u) {
    var i = u.indexOf('//');
    if (i === -1 || i > 8) return '';
    var fine = u.length;
    for (var k = i + 2; k < u.length; k++) {
      var c = u.charCodeAt(k);
      if (c === 47 || c === 63 || c === 35) { fine = k; break; } // / ? #
    }
    var h = u.slice(i + 2, fine), at = h.lastIndexOf('@');
    if (at !== -1) h = h.slice(at + 1);
    if (h.charAt(0) === '[') return h.slice(1, h.indexOf(']'));
    var dp = h.indexOf(':');
    if (dp !== -1) h = h.slice(0, dp);
    if (h.charAt(h.length - 1) === '.') h = h.slice(0, -1);
    return h;
  }

  // schema delle liste di filtri -> espressione regolare (solo quando serve)
  var reSchemi = {};
  function schemaRegExp(p) {
    try {
      var inizio = '', fine = '';
      if (p.slice(0, 2) === '||') { inizio = '^[a-z\\-]+:\\/+(?:[^\\/?#]+\\.)?'; p = p.slice(2); }
      else if (p.charAt(0) === '|') { inizio = '^'; p = p.slice(1); }
      if (p.charAt(p.length - 1) === '|') { fine = '$'; p = p.slice(0, -1); }
      var corpo = p.replace(/\*+/g, '*').replace(/[.+?${}()|[\]\\\/]/g, '\\$&')
        .replace(/\^/g, '(?:[\\x00-\\x24\\x26-\\x2c\\x2f\\x3a-\\x40\\x5b-\\x5e\\x60\\x7b-\\x7f]|$)').replace(/\*/g, '.*');
      return new RegExp(inizio + corpo + fine);
    } catch (e) { return null; }
  }
  function provaLista(lista, u, terza) {
    for (var i = 0; i < lista.length; i++) {
      var p = String(lista[i]), k = p.indexOf('\t'), solo = '';
      if (k !== -1) { solo = p.charAt(k + 1); p = p.slice(0, k); }
      if ((solo === '3' && !terza) || (solo === '1' && terza)) continue;
      var re = ha(reSchemi, p) ? reSchemi[p] : (reSchemi[p] = schemaRegExp(p));
      if (re && re.test(u)) return true;
    }
    return false;
  }
  // indice per parola: si provano solo gli schemi che contengono una parola dell'indirizzo
  function provaIndice(idx, u, terza) {
    var parole = u.match(/[a-z0-9%]{2,}/g);
    if (!parole) return false;
    for (var i = 0; i < parole.length; i++) {
      if (ha(idx, parole[i]) && Array.isArray(idx[parole[i]]) && provaLista(idx[parole[i]], u, terza)) return true;
    }
    return false;
  }

  var esiti = {}, nEsiti = 0;
  function listeBloccano(u, tipo, contesto) {
    // un link verso lo stesso sito non e' mai una pubblicita' (e le pagine ne hanno migliaia)
    if ((tipo === 'pagina' || tipo === 'popup') && !contesto && hostUrl(u) === HOST) return false;
    var chiave = (tipo || '') + '|' + (contesto || '') + '|' + u;
    if (ha(esiti, chiave)) return esiti[chiave];
    var r = valutaListe(u, tipo, contesto);
    if (nEsiti > 800) { esiti = {}; nEsiti = 0; }
    esiti[chiave] = r;
    nEsiti++;
    return r;
  }
  function valutaListe(u, tipo, contesto) {
    var L = LISTE, S = L.sito, h = hostUrl(u);
    if (!h || inElenco(L.consentiHost, h) || inElenco(S.consentiHost, h) || SICURI.indexOf(dominioBase(h)) !== -1) return false;
    var terza = dominioBase(h) !== (contesto ? dominioBase(contesto) : QUI);
    var pagina = tipo === 'pagina' || tipo === 'popup';
    // pagine e finestre: solo i domini bloccati ovunque (le regole "da altri siti" valgono per le risorse)
    var b = (!L.noblock && inElenco(L.rete, h)) || inElenco(S.rete, h) || (tipo === 'popup' && inElenco(L.popup, h));
    if (!b && !pagina) {
      b = (terza && ((!L.noblock && inElenco(L.terze, h)) || inElenco(S.terze, h))) ||
        (!L.noblock && provaIndice(L.schemi, u, terza)) || provaLista(S.schemi, u, terza);
    }
    if (!b) return false;
    return !(provaIndice(L.consenti, u, terza) || provaLista(S.consenti, u, terza));
  }

  // Questo riquadro e' esso stesso una pubblicita' (il sito l'ha messo nell'HTML e
  // ha cominciato a caricarsi prima che la pagina lo svuotasse): si ferma qui.
  function riquadroPubblicitario() {
    if (!IN_FRAME || !bloccoAttivo) return false;
    var su = '';
    try { su = location.ancestorOrigins && location.ancestorOrigins.length ? location.ancestorOrigins[0] : document.referrer; } catch (e) {}
    return eAd(location.href, 'frame', hostOf(su || ''));
  }
  function fermaRiquadro() {
    try { window.stop(); } catch (e) {}
    try { var d = document.documentElement; while (d && d.firstChild) d.removeChild(d.firstChild); } catch (e) {}
  }
  // prima con le liste interne (subito, senza chiedere niente), poi con quelle vere
  if (riquadroPubblicitario()) { fermaRiquadro(); return; }
  listePronte = caricaListe();
  if (LISTE && riquadroPubblicitario()) { fermaRiquadro(); return; }

  // Arrivati da un altro sito (pubblicita' al click, reindirizzamenti) su una pagina
  // che le liste conoscono come pubblicitaria: la si ferma subito e si torna indietro.
  function paginaPubblicitaria() {
    if (IN_FRAME || !bloccoAttivo || !LISTE) return false;
    var da = hostOf(document.referrer);
    if (!da || da === HOST || da === LAUNCHER_HOST) return false;
    return eAd(location.href, 'pagina', da);
  }
  if (paginaPubblicitaria()) {
    try { window.stop(); } catch (e) {}
    setTimeout(function () {
      try {
        if (!document.documentElement) document.appendChild(document.createElement('html'));
        if (!document.body) document.documentElement.appendChild(document.createElement('body'));
      } catch (e) {}
      applicaStili();
      tornaIndietroTra(3, 'Pagina pubblicitaria', '');
    }, 0);
  }

  function evento(el, tipo) {
    try {
      var ev = document.createEvent('Event');
      ev.initEvent(tipo, false, false);
      el.dispatchEvent(ev);
    } catch (e) {}
  }

  /* ================================================================ blocco della pubblicita'
   * Le pubblicita' non si caricano e i loro riquadri si nascondono senza
   * spostare la pagina. Col blocco avanzato (spento di base) gli oggetti delle
   * pubblicita' (adsbygoogle, googletag) ci sono ma non fanno niente, per i
   * siti che bloccano chi usa un adblock. Deve girare il prima possibile,
   * prima degli script del sito.
   */

  function definisci(nome, valore) {
    try {
      var d = Object.getOwnPropertyDescriptor(window, nome);
      if (d && !d.configurable) return;
      Object.defineProperty(window, nome, {
        get: function () { return valore; },
        set: function () { /* il sito non puo' sostituirlo */ },
        configurable: true
      });
    } catch (e) {}
  }

  // Oggetto "fai tutto e non fare niente": ogni metodo esiste e restituisce se stesso.
  function catena() {
    var p;
    var f = function () { return p; };
    if (!MOTORE.proxy) return f;
    p = new Proxy(f, {
      get: function (t, k) {
        if (k === 'then' || k === 'toJSON') return undefined;
        if (k === 'length') return 0;
        if (k === 'toString' || k === 'valueOf') return function () { return ''; };
        if (typeof k === 'symbol') return undefined;
        return p;
      },
      apply: function () { return p; }
    });
    return p;
  }

  function FintoRilevatore() {
    var self = this;
    function asinc(fn) { if (typeof fn === 'function') setTimeout(fn, 1); }
    this.onDetected = function () { return self; };
    this.onNotDetected = function (fn) { asinc(fn); return self; };
    this.on = function (trovato, fn) { if (!trovato) asinc(fn); return self; };
    this.check = function () { return false; };
    this.emitEvent = function () { return self; };
    this.clearEvent = function () { return self; };
    this.setOption = function () { return self; };
    this.options = {};
  }

  function travestimenti() {
    var nulla = function () {};
    var adsbygoogle = { loaded: true, length: 0, push: nulla };
    definisci('adsbygoogle', adsbygoogle);

    var gt = catena();
    var googletag = MOTORE.proxy ? new Proxy({}, {
      get: function (t, k) {
        if (k === 'cmd') return { push: function (fn) { try { if (typeof fn === 'function') fn.call(window); } catch (e) {} return 1; } };
        if (k === 'apiReady' || k === 'pubadsReady') return true;
        if (k === 'getSlots') return function () { return []; };
        if (typeof k === 'symbol' || k === 'then') return undefined;
        return gt;
      },
      set: function () { return true; }
    }) : { cmd: [], apiReady: true, pubadsReady: true };
    definisci('googletag', googletag);

    definisci('blockAdBlock', new FintoRilevatore());
    definisci('fuckAdBlock', new FintoRilevatore());
    definisci('sniffAdBlock', new FintoRilevatore());
    definisci('BlockAdBlock', FintoRilevatore);
    definisci('FuckAdBlock', FintoRilevatore);
    definisci('SniffAdBlock', FintoRilevatore);
    definisci('canRunAds', true);
    definisci('isAdBlockActive', false);

    // Amazon (apstag): chi aspetta le sue risposte le riceve subito, vuote.
    var richiamaVuoto = function (a, cb) {
      var f = typeof cb === 'function' ? cb : (typeof a === 'function' ? a : null);
      if (f) setTimeout(function () { try { f([]); } catch (e) {} }, 1);
    };
    definisci('apstag', {
      _Q: [], init: nulla, setDisplayBids: nulla, targetingKeys: function () { return []; },
      fetchBids: richiamaVuoto, renderImp: nulla, punt: nulla
    });
  }

  // Script, riquadri e immagini pubblicitari inseriti dagli script del sito:
  // non si caricano; lo script che le aspetta non resta in attesa.
  var PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  function srcDi(n) {
    if (!n || n.nodeType !== 1) return '';
    return n.__hometvAd || n.getAttribute('src') || '';
  }

  // true = l'elemento NON va inserito (script), false = inserirlo (gia' reso innocuo)
  function neutralizza(n) {
    if (n.nodeType === 11) { neutralizzaDentro(n); return null; }
    var t = n.tagName;
    var s = srcDi(n);
    if (!s || !bloccaSrc(t, s)) return null;
    conta('risorsa', s);
    if (t === 'SCRIPT') {
      setTimeout(function () { evento(n, 'load'); }, 0);
      return true;
    }
    if (t === 'IFRAME') {
      n.__hometvAd = s;
      origSetAttr.call(n, 'src', 'about:blank');
      return false;
    }
    if (t === 'IMG') {
      origSetAttr.call(n, 'src', PIXEL);
      return false;
    }
    return null;
  }

  var origSetAttr = Element.prototype.setAttribute;

  // Script pubblicitari dentro un "pacchetto" di elementi (DocumentFragment):
  // si tolgono prima che il pacchetto entri nella pagina.
  function neutralizzaDentro(frag) {
    try {
      var dentro = frag.querySelectorAll('script[src], iframe[src], img[src]');
      for (var i = 0; i < dentro.length; i++) {
        if (neutralizza(dentro[i]) === true && dentro[i].parentNode) dentro[i].parentNode.removeChild(dentro[i]);
      }
    } catch (e) {}
  }

  function daTenere(n) {
    return !(n && (n.nodeType === 1 || n.nodeType === 11) && neutralizza(n) === true);
  }

  // <solo-completa>
  // il blocco avanzato su YouTube per la TV: quello delle impostazioni, appena lette; prima di leggerle la copia di questo
  // sito, o il segno del riquadro della home (che c'e' solo col blocco avanzato acceso)
  function avanzatoTv() { return CFG && typeof CFG.bloccoAvanzato === 'boolean' ? CFG.bloccoAvanzato : (AVANZATO || YT_SENZA_SPOT); }
  // conta lo stato al momento: col blocco avanzato spento niente, neanche dal riquadro della home; acceso, dal riquadro
  // sempre e se no se il blocco della pubblicita' e' acceso; lasciata dal menu Blu (su YouTube per la TV), gli agganci
  // lasciano tutto com'e'
  function spotTvVia() { return !YT_SPOT_LASCIATI && avanzatoTv() && (YT_SENZA_SPOT || !(CFG && CFG.bloccoPubblicita === false)); }
  var spotTvFatto = false;

  // Interfaccia per la TV, solo col blocco avanzato (anche dal riquadro della home): le risposte arrivano senza spot
  // (adPlacements, adSlots, playerAds, riquadri adSlotRenderer, Shorts sponsorizzati) e il lettore chiede il video senza
  // spot (isInlinePlaybackNoAd), cosi' il video parte subito. Gli agganci valgono anche per i moduli interni (_yttv) che
  // hanno un loro JSON. Codice nostro (le idee sono quelle note di altri progetti liberi: vedi TERZE-PARTI.md)
  function senzaSpotTv() {
    if (spotTvFatto) return;
    spotTvFatto = true;
    function spot(x) {
      if (!x || typeof x !== 'object') return false;
      if (x.adSlotRenderer) return true;
      var r = x.command && x.command.reelWatchEndpoint;
      return !!(r && r.adClientParams && r.adClientParams.isAd);
    }
    function senzaSpot(lista) {
      if (!Array.isArray(lista) || !lista.length) return lista;
      var out = [];
      for (var i = 0; i < lista.length; i++) { if (!spot(lista[i])) out.push(lista[i]); else conta('youtube'); }
      return out;
    }
    function scaffali(lista) {
      for (var i = 0; lista && i < lista.length; i++) {
        var s = lista[i] && lista[i].shelfRenderer, h = s && s.content && s.content.horizontalListRenderer;
        if (h && h.items) h.items = senzaSpot(h.items);
      }
      return lista;
    }
    function lettore(o) {
      if (!o || typeof o !== 'object') return;
      if (o.adPlacements && o.adPlacements.length) conta('youtube');
      if (o.adPlacements) o.adPlacements = [];
      if (o.adSlots) o.adSlots = [];
      if (o.playerAds) o.playerAds = false;
    }
    function pulisci(o) {
      if (!o || typeof o !== 'object') return;
      lettore(o);
      lettore(o.playerResponse);
      var c = o.contents && o.contents.tvBrowseRenderer && o.contents.tvBrowseRenderer.content;
      var sl = c && c.tvSurfaceContentRenderer && c.tvSurfaceContentRenderer.content && c.tvSurfaceContentRenderer.content.sectionListRenderer;
      if (sl && sl.contents) sl.contents = scaffali(senzaSpot(sl.contents));
      var cc = o.continuationContents;
      if (cc && cc.sectionListContinuation && cc.sectionListContinuation.contents) {
        cc.sectionListContinuation.contents = scaffali(senzaSpot(cc.sectionListContinuation.contents));
      }
      if (cc && cc.horizontalListContinuation && cc.horizontalListContinuation.items) {
        cc.horizontalListContinuation.items = senzaSpot(cc.horizontalListContinuation.items);
      }
      if (o.entries && o.entries.length) o.entries = senzaSpot(o.entries);
    }
    // la richiesta del lettore: una copia con "senza spot" (gli oggetti di YouTube restano com'erano)
    function copia(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }
    function richiesta(v) {
      var pc = v && typeof v === 'object' && v.playbackContext, cpc = pc && pc.contentPlaybackContext;
      if (!cpc || typeof cpc !== 'object' || cpc.isInlinePlaybackNoAd === true) return v;
      var c = copia(v);
      c.playbackContext = copia(pc);
      c.playbackContext.contentPlaybackContext = copia(cpc);
      c.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd = true;
      return c;
    }
    var spotVia = spotTvVia;
    function aggancia(J) {
      if (!J || J.__hometvYt || typeof J.parse !== 'function' || typeof J.stringify !== 'function') return;
      var parse = J.parse, stringify = J.stringify;
      try {
        J.parse = function () { var r = parse.apply(this, arguments); if (spotVia()) { try { pulisci(r); } catch (e) {} } return r; };
        J.stringify = function (v, f, s) {
          if (spotVia()) { try { v = richiesta(v); } catch (e) {} }
          return stringify.call(this, v, f, s);
        };
        Object.defineProperty(J, '__hometvYt', { value: true });
      } catch (e) {}
    }
    aggancia(window.JSON);
    // i moduli interni di YouTube per la TV hanno il loro JSON: si agganciano per un minuto e dopo ogni cambio di pagina
    function interni() {
      var y = window._yttv;
      if (!y || typeof y !== 'object') return;
      for (var k in y) { try { if (y[k] && y[k].JSON) aggancia(y[k].JSON); } catch (e) {} }
    }
    var giri = 0, t = setInterval(function () { interni(); if (++giri > 200) clearInterval(t); }, 300);
    ascoltaSicuro(window, 'hashchange', function () {
      var n = 0, h = setInterval(function () { interni(); if (++n > 16) clearInterval(h); }, 300);
    });
  }
  // </solo-completa>

  function agganci() {
    var NP = Node.prototype;
    var origAppend = NP.appendChild, origInsert = NP.insertBefore, origReplace = NP.replaceChild;

    NP.appendChild = comeOriginale(function (n) {
      if (!daTenere(n)) return n;
      var r = origAppend.apply(this, arguments);
      if (n && n.tagName === 'IFRAME') proteggiFinestra(n.contentWindow);
      return r;
    }, 'appendChild');
    NP.insertBefore = comeOriginale(function (n) {
      if (!daTenere(n)) return n;
      var r = origInsert.apply(this, arguments);
      if (n && n.tagName === 'IFRAME') proteggiFinestra(n.contentWindow);
      return r;
    }, 'insertBefore');
    NP.replaceChild = comeOriginale(function (n) {
      if (!daTenere(n)) return n;
      return origReplace.apply(this, arguments);
    }, 'replaceChild');

    // append, prepend, after, before, replaceWith: stessi controlli
    ['append', 'prepend', 'after', 'before', 'replaceWith'].forEach(function (nome) {
      [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (proto) {
        var orig = proto[nome];
        if (typeof orig !== 'function' || !Object.prototype.hasOwnProperty.call(proto, nome)) return;
        proto[nome] = comeOriginale(function () {
          var tenuti = [];
          for (var i = 0; i < arguments.length; i++) if (daTenere(arguments[i])) tenuti.push(arguments[i]);
          if (nome === 'replaceWith' && !tenuti.length && arguments.length) return undefined;
          return orig.apply(this, tenuti);
        }, nome);
      });
    });
    var origAdj = Element.prototype.insertAdjacentElement;
    if (typeof origAdj === 'function') {
      Element.prototype.insertAdjacentElement = comeOriginale(function (dove, n) {
        if (!daTenere(n)) return n;
        return origAdj.apply(this, arguments);
      }, 'insertAdjacentElement');
    }

    // src impostato via codice: per gli script pubblicitari si ricorda e basta
    try {
      var dsrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      if (dsrc && dsrc.set) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
          get: function () { return this.__hometvAd || dsrc.get.call(this); },
          set: function (v) {
            if (bloccaSrc('SCRIPT', v)) { this.__hometvAd = String(v); return; }
            dsrc.set.call(this, v);
          },
          configurable: true,
          enumerable: true
        });
      }
    } catch (e) {}
    // riquadri e immagini a cui il sito cambia l'indirizzo dopo averli messi nella pagina
    ['HTMLIFrameElement', 'HTMLImageElement'].forEach(function (nome) {
      try {
        var proto = window[nome].prototype, d = Object.getOwnPropertyDescriptor(proto, 'src');
        if (!d || !d.set) return;
        Object.defineProperty(proto, 'src', {
          get: function () { return d.get.call(this); },
          set: function (v) {
            if (bloccaSrc(this.tagName, v)) {
              conta('risorsa', v);
              if (this.tagName === 'IFRAME') { this.__hometvAd = String(v); v = 'about:blank'; } else v = PIXEL;
            }
            d.set.call(this, v);
          },
          configurable: true,
          enumerable: true
        });
      } catch (e) {}
    });
    Element.prototype.setAttribute = comeOriginale(function (nome, valore) {
      var t = this.tagName;
      if ((t === 'SCRIPT' || t === 'IFRAME' || t === 'IMG') && String(nome).toLowerCase() === 'src' && bloccaSrc(t, valore)) {
        conta('risorsa', valore);
        if (t === 'SCRIPT') { this.__hometvAd = String(valore); return; }
        if (t === 'IFRAME') { this.__hometvAd = String(valore); return origSetAttr.call(this, 'src', 'about:blank'); }
        return origSetAttr.call(this, 'src', PIXEL);
      }
      return origSetAttr.apply(this, arguments);
    }, 'setAttribute');

    // richieste verso server pubblicitari: risposta vuota "200 OK"
    if (typeof window.fetch === 'function') {
      var origFetch = window.fetch;
      window.fetch = comeOriginale(function (input) {
        var u = typeof input === 'string' ? input : (input && (input.url || input.href)) || '';
        if (eAd(u, 'xhr')) {
          conta('richiesta', u);
          try { return Promise.resolve(new Response('', { status: 200, statusText: 'OK' })); } catch (e) {}
        }
        return origFetch.apply(this, arguments);
      }, 'fetch');
    }
    var XP = XMLHttpRequest.prototype;
    var oOpen = XP.open, oSend = XP.send, oHeader = XP.setRequestHeader;
    XP.open = comeOriginale(function (metodo, u) {
      this.__hometvFinto = eAd(u, 'xhr');
      if (this.__hometvFinto) { conta('richiesta', u); return; }
      return oOpen.apply(this, arguments);
    }, 'open');
    XP.setRequestHeader = comeOriginale(function () {
      if (this.__hometvFinto) return;
      return oHeader.apply(this, arguments);
    }, 'setRequestHeader');
    XP.send = comeOriginale(function () {
      if (!this.__hometvFinto) return oSend.apply(this, arguments);
      var x = this;
      setTimeout(function () {
        var campi = { readyState: 4, status: 200, statusText: 'OK', responseText: '', response: '' };
        for (var k in campi) {
          try { Object.defineProperty(x, k, { value: campi[k], configurable: true }); } catch (e) {}
        }
        evento(x, 'readystatechange');
        evento(x, 'load');
        evento(x, 'loadend');
      }, 15);
    }, 'send');
    var oGetAll = XP.getAllResponseHeaders, oGet = XP.getResponseHeader;
    XP.getAllResponseHeaders = comeOriginale(function () {
      if (this.__hometvFinto) return 'content-type: text/plain\r\n';
      return oGetAll.apply(this, arguments);
    }, 'getAllResponseHeaders');
    XP.getResponseHeader = comeOriginale(function (k) {
      if (this.__hometvFinto) return String(k).toLowerCase() === 'content-type' ? 'text/plain' : null;
      return oGet.apply(this, arguments);
    }, 'getResponseHeader');
  }

  /* ================================================================ regole speciali delle liste (snippet)
   * Dalle liste, solo per i siti indicati: piccole correzioni che sistemano
   * funzioni della pagina, nascondono quello che si riconosce solo dal testo,
   * tolgono le pubblicita' dai dati che il sito si scarica.
   */

  var MAGIA = 'hometv' + String(Math.random()).slice(2, 10);
  var srcVietati = {};      // prevent-element-src-loading: tag -> [regexp]
  var finestreVietate = []; // prevent-window-open
  var daNascondere = [];    // hide-if-...: funzioni da ripetere quando la pagina cambia

  function inRegExp(s) {
    s = String(s === undefined ? '' : s);
    var m = /^\/(.*)\/([gimsuy]*)$/.exec(s);
    if (m && m[1]) { try { return new RegExp(m[1], m[2].replace('g', '')); } catch (e) { return null; } }
    return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  function valoreSnippet(v) {
    var fissi = { 'undefined': undefined, 'false': false, 'true': true, 'null': null, "''": '', '': '' };
    if (ha(fissi, v)) return { ok: true, v: fissi[v] };
    if (v === 'noopFunc') return { ok: true, v: function () {} };
    if (v === 'trueFunc') return { ok: true, v: function () { return true; } };
    if (v === 'falseFunc') return { ok: true, v: function () { return false; } };
    if (v === 'emptyArray') return { ok: true, v: [] };
    if (v === 'emptyObj') return { ok: true, v: {} };
    if (/^-?\d+(\.\d+)?$/.test(v)) return { ok: true, v: parseFloat(v) };
    return { ok: false };
  }
  // proprieta' anche "a.b.c", anche se a o b arrivano dopo
  function avvolgi(obj, nome, desc) {
    var punto = nome.indexOf('.');
    if (punto === -1) {
      var d = Object.getOwnPropertyDescriptor(obj, nome);
      if (d && !d.configurable) return;
      var nuovo = { configurable: true, get: desc.get, set: desc.set };
      if (!nuovo.get) { var val = obj[nome]; nuovo.get = function () { return val; }; }
      if (!nuovo.set) nuovo.set = function () {};
      Object.defineProperty(obj, nome, nuovo);
      return;
    }
    var primo = nome.slice(0, punto), resto = nome.slice(punto + 1), v = obj[primo];
    if (v && (typeof v === 'object' || typeof v === 'function')) avvolgi(v, resto, desc);
    var d2 = Object.getOwnPropertyDescriptor(obj, primo);
    if (d2 && !d2.configurable) return;
    Object.defineProperty(obj, primo, {
      configurable: true,
      get: function () { return v; },
      set: function (nv) { v = nv; if (nv && (typeof nv === 'object' || typeof nv === 'function')) avvolgi(nv, resto, desc); }
    });
  }
  function interrompi() { throw new ReferenceError(MAGIA); }
  // gli errori voluti si fermano qui e non sporcano la console della pagina
  window.addEventListener('error', function (ev) {
    if (String(ev.message || '').indexOf(MAGIA) !== -1) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);

  function nascondi(el) { if (el && el.style) el.style.setProperty('display', 'none', 'important'); }
  function testoVisibile(el) { return el.innerText || ''; }
  function percorsoJson(o, p, fai) {
    var pezzi = p.split('.'), i = 0;
    (function giu(x) {
      if (!x || typeof x !== 'object') return;
      var k = pezzi[i];
      if (i === pezzi.length - 1) { if (k === '[]' || k === '[-]') { for (var a = 0; a < x.length; a++) fai(x, a); } else if (ha(x, k)) fai(x, k); return; }
      i++;
      if ((k === '[]' || k === '[-]') && Array.isArray(x)) for (var b = 0; b < x.length; b++) giu(x[b]);
      else giu(x[k]);
      i--;
    })(o);
  }
  function haPercorso(o, p) { var c = false; percorsoJson(o, p, function () { c = true; }); return c; }
  var modificheJson = []; // [{ percorsi, valore, togli, servono, filtro }]
  function sistemaJson(r, testoJson) {
    for (var i = 0; i < modificheJson.length; i++) {
      var m = modificheJson[i], ok = true;
      if (m.filtro && !(typeof testoJson === 'string' && m.filtro.test(testoJson))) continue;
      for (var s = 0; s < m.servono.length; s++) if (!haPercorso(r, m.servono[s])) ok = false;
      if (!ok) continue;
      for (var p = 0; p < m.percorsi.length; p++) {
        percorsoJson(r, m.percorsi[p], function (x, k) { if (m.togli) delete x[k]; else x[k] = m.valore; });
      }
    }
    return r;
  }
  function agganciaJson() {
    if (agganciaJson.fatto) return;
    agganciaJson.fatto = true;
    var origParse = JSON.parse;
    JSON.parse = comeOriginale(function (t) {
      var r = origParse.apply(this, arguments);
      try { sistemaJson(r, t); } catch (e) {}
      return r;
    }, 'parse');
    if (window.Response && Response.prototype.json) {
      var origJson = Response.prototype.json;
      Response.prototype.json = comeOriginale(function () {
        return origJson.apply(this, arguments).then(function (r) { try { sistemaJson(r, null); } catch (e) {} return r; });
      }, 'json');
    }
  }
  function parole(s) { return String(s || '').split(/\s+/).filter(function (x) { return !!x; }); }

  var SNIPPET = {
    'abort-on-property-read': function (prop) { avvolgi(window, prop, { get: interrompi }); },
    'abort-on-property-write': function (prop) { avvolgi(window, prop, { set: interrompi }); },
    'abort-current-inline-script': function (api, cerca) {
      var re = cerca ? inRegExp(cerca) : null, obj = window, pezzi = api.split('.'), nome = pezzi.pop();
      for (var i = 0; i < pezzi.length; i++) { obj = obj[pezzi[i]]; if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return; }
      var d = Object.getOwnPropertyDescriptor(obj, nome) || {}, valore = obj[nome];
      function forse() {
        var s = document.currentScript;
        if (s && s.tagName === 'SCRIPT' && !s.src && (!re || re.test(s.textContent || ''))) interrompi();
      }
      avvolgi(obj, nome, {
        get: function () { forse(); return d.get ? d.get.call(this) : valore; },
        set: function (v) { forse(); if (d.set) d.set.call(this, v); else valore = v; }
      });
    },
    'override-property-read': function (prop, v) {
      var x = valoreSnippet(v);
      if (x.ok) avvolgi(window, prop, { get: function () { return x.v; }, set: function () {} });
    },
    'json-prune': function (togli, servono) {
      modificheJson.push({ percorsi: parole(togli), togli: true, servono: parole(servono), filtro: null });
      agganciaJson();
    },
    'json-override': function (percorsi, v, servono, filtro) {
      var x = valoreSnippet(v);
      if (!x.ok || /jsonpath\(/.test(percorsi)) return;
      modificheJson.push({ percorsi: parole(percorsi), valore: x.v, togli: false, servono: parole(servono), filtro: filtro ? inRegExp(filtro) : null });
      agganciaJson();
    },
    'prevent-listener': function (tipo, gestore, sel) {
      var reTipo = inRegExp(tipo), reG = gestore ? inRegExp(gestore) : null;
      var orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = comeOriginale(function (t, fn) {
        try {
          if (reTipo.test(String(t)) && (!reG || (fn && (fn.name === gestore || reG.test(String(fn.handleEvent || fn))))) &&
            (!sel || (this.matches && this.matches(sel)))) return undefined;
        } catch (e) {}
        return orig.apply(this, arguments);
      }, 'addEventListener');
    },
    'cookie-remover': function (nome, sempre) {
      var re = inRegExp(nome);
      function togli() {
        var tutti = document.cookie ? document.cookie.split(';') : [];
        for (var i = 0; i < tutti.length; i++) {
          var n = tutti[i].split('=')[0].replace(/^\s+|\s+$/g, '');
          if (!re.test(n)) continue;
          var parti = location.hostname.split('.');
          for (var j = 0; j < parti.length - 1; j++) {
            var dom = parti.slice(j).join('.');
            document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + dom;
          }
          document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        }
      }
      togli();
      if (sempre === 'true') setInterval(togli, 2000);
      else window.addEventListener('load', togli);
    },
    'prevent-element-src-loading': function (tag, cerca) {
      var t = String(tag || '').toUpperCase();
      if (!/^(SCRIPT|IMG|IFRAME|LINK)$/.test(t)) return;
      (srcVietati[t] || (srcVietati[t] = [])).push(inRegExp(cerca));
    },
    'prevent-window-open': function (cerca) {
      var no = /^!/.test(String(cerca || ''));
      finestreVietate.push({ re: inRegExp(no ? String(cerca).slice(1) : (cerca || '/./')), no: no });
    },
    'hide-if-matches-xpath': function (xp) {
      daNascondere.push(function () {
        var r = document.evaluate(xp, document, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
        for (var i = 0; i < r.snapshotLength; i++) {
          var n = r.snapshotItem(i);
          nascondi(n.nodeType === 1 ? n : n.parentElement);
        }
      });
    },
    'hide-if-contains': function (cerca, sel, selTesto) {
      var re = inRegExp(cerca);
      daNascondere.push(function () { nascondiSeContiene(re, sel, selTesto, function (el) { return el.textContent || ''; }); });
    },
    'hide-if-contains-visible-text': function (cerca, sel, selTesto) {
      var re = inRegExp(cerca);
      daNascondere.push(function () { nascondiSeContiene(re, sel, selTesto, testoVisibile); });
    }
  };
  function nascondiSeContiene(re, sel, selTesto, testoDi) {
    var el = document.querySelectorAll(sel || '*');
    for (var i = 0; i < el.length && i < 3000; i++) {
      if (el[i].style && el[i].style.display === 'none') continue;
      var dove = selTesto ? el[i].querySelectorAll(selTesto) : [el[i]];
      for (var j = 0; j < dove.length; j++) if (re.test(testoDi(dove[j]))) { nascondi(el[i]); break; }
    }
  }
  function eseguiSnippet(lista) {
    for (var i = 0; i < lista.length; i++) {
      var s = lista[i];
      if (!Array.isArray(s) || !ha(SNIPPET, s[0])) continue;
      try { SNIPPET[s[0]].apply(null, s.slice(1).map(String)); } catch (e) { if (DEBUG) log('snippet', s[0], e); }
    }
  }
  function srcVietato(tag, u) {
    var l = srcVietati[tag];
    if (!l || !u) return false;
    for (var i = 0; i < l.length; i++) if (l[i] && l[i].test(String(u))) return true;
    return false;
  }
  /* ---------------------------------------------------------------- pop-under fatti "a mano"
   * Un link creato da uno script, mai messo nella pagina e cliccato (quel clic non passa
   * dalla pagina), oppure un riquadro vuoto (about:blank) usato per avere un window.open
   * "pulito": sono i modi con cui le pubblicita' aprono finestre nonostante i blocchi.
   */
  function agganciFinestre() {
    var origClic = HTMLElement.prototype.click;
    HTMLAnchorElement.prototype.click = comeOriginale(function () {
      if (bloccoAttivo && !this.isConnected && finestraNuova(this)) {
        if (linkDaBloccare(this)) { conta('pop-under', this.href); return; }
        if (/^https?:/i.test(this.href)) { location.href = this.href; return; } // sul TV non ci sono finestre nuove
      }
      return origClic.apply(this, arguments);
    }, 'click');
    var origInvia = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = comeOriginale(function (ev) {
      try {
        if (bloccoAttivo && ev && ev.type === 'click' && this.nodeType === 1 && !this.isConnected) {
          var a = this.closest('a[href], area[href]');
          if (a && linkDaBloccare(a)) { conta('pop-under', a.href); return false; }
        }
      } catch (e) {}
      return origInvia.apply(this, arguments);
    }, 'dispatchEvent');
    // i riquadri vuoti dello stesso sito ricevono le stesse regole appena qualcuno li usa
    var dw = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (dw && dw.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function () { var w = dw.get.call(this); if (!this.__hometvVisto) { this.__hometvVisto = true; proteggiFinestra(w); } return w; },
        configurable: true, enumerable: true
      });
    }
    var dd = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument');
    if (dd && dd.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
        get: function () { var d = dd.get.call(this); if (d && !this.__hometvVisto) { this.__hometvVisto = true; proteggiFinestra(d.defaultView); } return d; },
        configurable: true, enumerable: true
      });
    }
  }
  function proteggiFinestra(w) {
    try {
      // un riquadro di un altro sito da' errore qui; in una pagina vera (http) c'e' gia' questo codice
      if (!w || w === window || w.__hometvProtetta || /^https?:$/.test(w.location.protocol)) return;
      Object.defineProperty(w, '__hometvProtetta', { value: true });
      w.open = window.open;
      if (w.HTMLAnchorElement) w.HTMLAnchorElement.prototype.click = HTMLAnchorElement.prototype.click;
      if (w.EventTarget) w.EventTarget.prototype.dispatchEvent = EventTarget.prototype.dispatchEvent;
      w.addEventListener('click', suClicLink, true);
    } catch (e) {}
  }

  var TIPO_TAG = { SCRIPT: 'script', IFRAME: 'frame', IMG: 'image', EMBED: 'frame', OBJECT: 'frame' };
  function bloccaSrc(tag, u) { return eAd(u, TIPO_TAG[tag]) || srcVietato(tag, u); }

  if (bloccoAttivo) {
    if (AVANZATO) { try { travestimenti(); } catch (e) { log('travestimenti', e); } }
    try { agganci(); } catch (e) { log('agganci', e); }
    try { agganciFinestre(); } catch (e) { log('finestre', e); }
  }
  // <solo-completa>
  // prima degli script di YouTube (la copia del blocco avanzato o il segno del riquadro): se le impostazioni dicono
  // spento, gli agganci lasciano tutto com'e' (spotTvVia)
  if (YT_TV && (AVANZATO || YT_SENZA_SPOT)) { try { senzaSpotTv(); } catch (e) { log('spot tv', e); } }
  // </solo-completa>

  /* ================================================================ popup */

  function finestraFinta() {
    var noop = function () {};
    return {
      closed: true, close: noop, focus: noop, blur: noop, postMessage: noop,
      document: { write: noop, writeln: noop, close: noop, open: noop },
      location: { href: '', replace: noop, assign: noop }
    };
  }
  // ultimo gesto vero della persona (tasto o click): serve a distinguere i
  // popup voluti da quelli aperti da soli dalle pubblicita'
  var ultimaAzione = 0;
  window.addEventListener('keydown', function (ev) { if (ev.isTrusted !== false) ultimaAzione = Date.now(); }, true);
  window.addEventListener('click', function (ev) { if (ev.isTrusted) ultimaAzione = Date.now(); }, true);
  function gestoRecente() { return Date.now() - ultimaAzione < 1500; }

  function finestraVietata(u) {
    for (var i = 0; i < finestreVietate.length; i++) {
      var f = finestreVietate[i];
      if (f.re && f.re.test(u) !== f.no) return true;
    }
    return false;
  }
  // una finestra nuova verso un altro sito: sul TV non ci sono altre finestre, ed e' quasi
  // sempre il trucco delle pubblicita' "al click" (anche quando parte da un tuo clic vero)
  function estraneo(u) {
    var h = hostOf(u);
    return !!h && dominioBase(h) !== QUI && !hostConsentito(h);
  }
  // l'indirizzo di un link (i link dentro un SVG non hanno un indirizzo di testo: niente)
  function hrefDi(a) { return a && typeof a.href === 'string' ? a.href : ''; }
  // un link che si aprirebbe in una finestra nuova: da bloccare?
  function finestraNuova(a) { return !!a.target && !/^(_self|_top|_parent)$/i.test(a.target); }
  function linkDaBloccare(a) {
    var href = hrefDi(a);
    if (!/^https?:/i.test(href) || !finestraNuova(a)) return false;
    return eAd(href, 'popup') || finestraVietata(href) || estraneo(href);
  }
  // clic fatti da questo codice (telecomando dal telefono, pulsanti delle puntate): valgono come veri
  var clicDaNoi = 0;

  // Sul TV non ci sono altre finestre: i popup voluti si aprono qui, gli altri no.
  var origOpen = window.open;
  try {
    window.open = comeOriginale(function (u, nome) {
      if (!bloccoAttivo) return origOpen.apply(window, arguments);
      var dest = u ? String(u) : '';
      var dove = String(nome || '').toLowerCase();
      if (!dest || eAd(dest, 'popup') || finestraVietata(dest)) { conta('popup', dest); return finestraFinta(); }
      var qui = dove === '_self' || dove === '_top' || dove === '_parent';
      // verso un altro sito: niente finestra nuova, e un riquadro non porta via la pagina intera
      if ((!qui || (IN_FRAME && dove !== '_self')) && estraneo(dest)) {
        conta('popup', dest);
        toast('Finestra pubblicitaria bloccata');
        return finestraFinta();
      }
      if (qui || gestoRecente()) {
        var w = dove === '_self' ? window : (dove === '_parent' ? window.parent : window.top);
        try { w.location.href = new URL(dest, location.href).href; return w; } catch (e) { return finestraFinta(); }
      }
      conta('popup', dest);
      return finestraFinta();
    }, 'open');
  } catch (e) {}

  // Riquadri minuscoli (quasi sempre pubblicita'): basta quanto fatto finora.
  // Se per caso il telecomando finisce qui dentro, lo si restituisce alla pagina.
  if (MINUSCOLO) {
    window.addEventListener('keydown', function (ev) {
      if ([37, 38, 39, 40, 13, 10009, 461, 27, 403, 404, 405, 406].indexOf(ev.keyCode) === -1) return;
      ev.preventDefault();
      // era piccolo all'apertura ma ora e' grande (un pannello che si apriva): si ricarica col codice completo (una volta)
      if (window.innerWidth >= 300 && window.innerHeight >= 200) {
        var chiave = 'hometv-cresciuto:' + location.href.slice(0, 300), gia = 0;
        try { gia = +sessionStorage.getItem(chiave) || 0; sessionStorage.setItem(chiave, String(Date.now())); } catch (e) {}
        if (Date.now() - gia > 15000) { try { location.reload(); return; } catch (e) {} }
      }
      try { window.parent.postMessage({ hometv: 'esci' }, '*'); window.parent.focus(); } catch (e) {}
    }, true);
    return;
  }

  /* ================================================================ impostazioni */

  var DEFAULT = {
    url: '',
    dominiConsentiti: [],
    paroleBloccate: [],
    selettoriExtra: [],
    schermoInteroAutomatico: true,
    apriHomeAllAccensione: true
  };
  var daGithub = null, dalTV = null;
  var CFG = {};
  var cfgCaricata = false;

  function ricomponi() {
    var k;
    CFG = {};
    for (k in DEFAULT) CFG[k] = DEFAULT[k];
    if (daGithub) for (k in daGithub) if (Object.prototype.hasOwnProperty.call(daGithub, k)) CFG[k] = daGithub[k];
    if (dalTV) for (k in dalTV) if (Object.prototype.hasOwnProperty.call(dalTV, k)) CFG[k] = dalTV[k];
    if (CFG.bloccoPubblicita === false || bloccoSpentoDallaPagina) bloccoAttivo = false;
    // elenchi scritti male in config.json (per esempio una frase al posto di
    // ["parola"]) non devono rovinare tutti i siti
    var liste = ['dominiConsentiti', 'paroleBloccate', 'selettoriExtra', 'siti'];
    for (var l = 0; l < liste.length; l++) if (!Array.isArray(CFG[liste[l]])) CFG[liste[l]] = [];
    var extra = [];
    var parole = CFG.paroleBloccate;
    for (var i = 0; i < parole.length; i++) {
      var w = typeof parole[i] === 'string' ? parole[i].replace(/^\s+|\s+$/g, '').toLowerCase() : '';
      if (w.length >= 4) extra.push(w);
    }
    adList = AD_PAROLE.concat(extra);
    cfgCaricata = !!(daGithub || dalTV);
  }
  ricomponi();

  /* ================================================================ avvisi */

  var toastEl = null, toastTimer = null;
  function toast(testo, ms) {
    if (IN_FRAME || !document.body) return;
    if (lettoreVideo) { avvisoLettore(testo, ms || 3500); return; } // a schermo intero: dentro il lettore
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'hometv-toast';
    }
    if (toastEl.parentNode !== contenitore()) contenitore().appendChild(toastEl);
    toastEl.textContent = testo;
    toastEl.className = 'hometv-show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = ''; }, ms || 3500);
  }

  // le schede del browser (la pagina del browser, accanto alla home)
  // le schede del browser: la galleria (o, con nuova, il browser con la ricerca pronta per una scheda nuova)
  function vaiSchede(nuova) {
    if (IN_FRAME) { try { window.top.postMessage({ hometv: 'home' }, '*'); } catch (e) {} return; }
    if (BASE) location.href = BASE + 'browser.html#' + (nuova ? 'nuova' : 'schede');
    else vaiHome();
  }
  function vaiHome() {
    if (IN_FRAME) {
      // dentro un lettore incorporato: e' la pagina intera che torna alla home
      try { window.top.postMessage({ hometv: 'home' }, '*'); } catch (e) {}
      return;
    }
    // se l'indirizzo non e' ancora noto, il servizio del TV fa da ponte
    location.href = BASE || SERVIZIO + '/casa';
  }

  /* ================================================================ stili */

  // Selettori pubblicitari generici: l'elemento diventa trasparente ma resta al
  // suo posto con le sue misure, cosi' la pagina non si sposta.
  var CSS_ADS = [
    '.adsbygoogle', 'ins.adsbygoogle', '[id^="google_ads"]', '[id^="div-gpt-ad"]',
    '[id*="taboola"]', '[class*="taboola"]', '[id*="outbrain"]', '[class*="outbrain"]',
    '[class~="ad"]', '[class~="ads"]', '[class~="advert"]', '[class~="advertisement"]',
    '[id="ad"]', '[id="ads"]', '[id^="ad-"]', '[id^="ad_"]', '[class^="ad-"]', '[class^="ad_"]',
    '[class*="banner-ad"]', '[class*="ad-banner"]', '[class*="adsbox"]'
  ];
  var NASCOSTO_INVISIBILE = '{opacity:0!important;pointer-events:none!important}';

  // gli stili dello schermo intero (servono anche dentro i componenti "shadow" dei player)
  var CSS_FS =
    '.hometv-fs-hide{visibility:hidden!important}' +
    '.hometv-fs-anc{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;will-change:auto!important;overflow:visible!important;visibility:visible!important;clip-path:none!important;' +
    'zoom:1!important;backdrop-filter:none!important;-webkit-mask:none!important;mask:none!important}' +
    '.hometv-fs{position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;z-index:2147483646!important;background:#000!important;visibility:visible!important;opacity:1!important}' +
    'video.hometv-fs{object-fit:contain!important}' +
    'video.hometv-fs.hometv-fmt-riempi{object-fit:cover!important}video.hometv-fs.hometv-fmt-allarga{object-fit:fill!important}' +
    '.hometv-fs-cc{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;margin:0!important;' +
    'transform:none!important;z-index:2147483647!important;visibility:visible!important;pointer-events:none!important;background:transparent!important;' +
    'display:flex!important;flex-direction:column!important;justify-content:flex-end!important;align-items:center!important;padding:0 0 6vh!important;box-sizing:border-box!important}';

  var CSS_BASE =
    'html.hometv-fs-on, html.hometv-fs-on body{overflow:hidden!important;transform:none!important;filter:none!important;zoom:1!important;' +
    'perspective:none!important;contain:none!important;backdrop-filter:none!important}' + CSS_FS +
    '.hometv-trappola{opacity:0!important;pointer-events:none!important}' +
    // la cosa scelta col telecomando: un anello colorato che le scivola intorno
    '.hometv-focus{outline:none!important}' +
    '#hometv-anello{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none;opacity:0;border-radius:12px;' +
    'box-shadow:0 0 0 3px rgba(59,130,246,.38),0 0 0 7px rgba(139,92,246,.18),0 0 0 11px rgba(139,92,246,.07);transition:opacity .18s ease}' +
    '#hometv-anello.hometv-on{opacity:1}' +
    '#hometv-anello svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}' +
    // puntatore del trackpad del telefono, e il cerchio del clic
    '#hometv-puntatore{position:fixed;left:0;top:0;width:46px;height:56px;margin:-3px 0 0 -5px;z-index:2147483647;pointer-events:none;' +
    'opacity:0;transition:opacity .2s ease;will-change:transform}' +
    '#hometv-puntatore.hometv-on{opacity:1}' +
    '#hometv-puntatore svg{display:block;width:100%;height:100%;overflow:visible}' +
    '#hometv-puntatore .hp-ombra{fill:rgba(0,0,0,.4)}' +
    '#hometv-puntatore .hp-freccia{fill:#fff;stroke:#0b0c10;stroke-width:1.5;stroke-linejoin:round}' +
    '#hometv-puntatore.hometv-mano .hp-freccia{fill:url(#hometv-colori-p);stroke:#fff}' +
    'html.hometv-puntatore-on #hometv-anello{opacity:0!important}' +
    '#hometv-tocco{position:fixed;left:0;top:0;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:50%;z-index:2147483647;' +
    'pointer-events:none;box-sizing:border-box;border:4px solid #3b82f6;opacity:0}' +
    '#hometv-tocco.hometv-on{animation:hometv-tocco .4s ease-out}' +
    '@keyframes hometv-tocco{0%{opacity:.95;transform:scale(.25)}100%{opacity:0;transform:scale(1.3)}}' +
    // elenco grande per i <select> del sito
    '#hometv-tendina{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;min-width:560px;max-width:80vw;' +
    'max-height:84vh;padding:30px 30px 24px;border-radius:30px;background:#14161b;color:#f4f5f7;font:500 26px/1.3 sans-serif;' +
    'box-shadow:0 30px 90px rgba(0,0,0,.65),inset 0 0 0 2px rgba(255,255,255,.07);box-sizing:border-box}' +
    '#hometv-tendina h2{margin:0 0 16px 8px;font:700 30px/1.2 sans-serif}' +
    '#hometv-tendina .ht-voci{position:relative;max-height:calc(84vh - 170px);overflow:hidden}' +
    '#hometv-tendina .ht-voce{position:relative;padding:15px 26px 15px 62px;margin-top:6px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#hometv-tendina .ht-voce svg{position:absolute;left:22px;top:50%;width:26px;height:26px;margin-top:-13px;fill:none;stroke:currentColor;stroke-width:3;opacity:0}' +
    '#hometv-tendina .ht-attiva svg{opacity:1}' +
    '#hometv-tendina .ht-voce.hometv-sel{background:linear-gradient(120deg,#19d3b7,#3b82f6 55%,#8b5cf6);color:#fff;box-shadow:0 10px 30px rgba(59,130,246,.4)}' +
    '#hometv-tendina .ht-spenta{opacity:.38}' +
    '#hometv-tendina .ht-gruppo{padding:16px 26px 4px;font:700 19px/1.2 sans-serif;letter-spacing:.05em;text-transform:uppercase;color:rgba(232,235,242,.5)}' +
    '#hometv-tendina p{margin:16px 8px 0;color:rgba(232,235,242,.55);font-size:20px}' +
    '#hometv-toast{position:fixed;right:40px;bottom:40px;z-index:2147483647;max-width:60vw;padding:16px 26px;border-radius:999px;' +
    'background:rgba(22,24,29,.94);color:#f4f5f7;font:600 24px/1.35 sans-serif;opacity:0;transition:opacity .25s;pointer-events:none}' +
    '#hometv-toast.hometv-show{opacity:1}' +
    '#hometv-pannello{position:fixed;right:40px;bottom:40px;z-index:2147483647;width:620px;padding:28px;border-radius:28px;' +
    'background:#15171c;color:#f4f5f7;font:500 24px/1.3 sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.6)}' +
    '#hometv-pannello h2{margin:0 0 6px;font-size:30px;font-weight:700}' +
    '#hometv-pannello p{margin:0 0 18px;color:rgba(232,235,242,.62);font-size:21px}' +
    '#hometv-pannello div{padding:16px 22px;border-radius:999px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#hometv-pannello div.hometv-sel{background:linear-gradient(120deg,#19d3b7,#3b82f6 55%,#8b5cf6);color:#fff;box-shadow:0 10px 30px rgba(59,130,246,.4)}' +
    '#hometv-pannello span{float:right;opacity:.7}' +
    // lettore TV: comandi grandi sopra il video del sito
    '#hometv-lettore{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;color:#f4f5f7;' +
    'font-family:sans-serif;opacity:0;transition:opacity .25s ease}' +
    '#hometv-lettore.hometv-on{opacity:1}' +
    '#hometv-lettore .hl-su{position:absolute;left:0;right:0;top:0;height:24vh;background:linear-gradient(rgba(0,0,0,.72),rgba(0,0,0,0))}' +
    '#hometv-lettore .hl-giu{position:absolute;left:0;right:0;bottom:0;height:34vh;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.8))}' +
    '#hometv-lettore .hl-titolo{position:absolute;left:5vw;top:5vh;right:40vw;font:700 3.6vh/1.2 sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#hometv-lettore .hl-aiuto{position:absolute;right:5vw;top:5.6vh;font:500 2vh/1.2 sans-serif;color:rgba(244,245,247,.7)}' +
    '#hometv-lettore .hl-barra{position:absolute;left:5vw;right:5vw;bottom:12vh;height:.9vh;border-radius:1vh;background:rgba(255,255,255,.22);overflow:hidden}' +
    '#hometv-lettore .hl-car,#hometv-lettore .hl-fatto{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 0;transform:scaleX(0)}' +
    '#hometv-lettore .hl-car{background:rgba(255,255,255,.3)}#hometv-lettore .hl-fatto{background:#fff}' +
    '#hometv-lettore .hl-testa{position:absolute;left:5vw;bottom:11.45vh;width:2vh;height:2vh;margin-left:-1vh;border-radius:50%;background:#fff;box-shadow:0 0 0 .6vh rgba(255,255,255,.2)}' +
    '#hometv-lettore .hl-ora,#hometv-lettore .hl-resta{position:absolute;bottom:6.2vh;font:600 2.6vh/1 sans-serif}' +
    '#hometv-lettore .hl-ora{left:5vw}#hometv-lettore .hl-resta{right:5vw;color:rgba(244,245,247,.75)}' +
    '#hometv-lettore .hl-centro{position:absolute;left:50%;top:50%;width:15vh;height:15vh;margin:-7.5vh 0 0 -7.5vh;border-radius:50%;' +
    'background:rgba(0,0,0,.5);opacity:0;transform:scale(.85);transition:opacity .2s ease,transform .2s ease}' +
    '#hometv-lettore .hl-centro.hometv-on{opacity:1;transform:scale(1)}' +
    '#hometv-lettore .hl-centro svg{position:absolute;left:25%;top:25%;width:50%;height:50%;fill:#fff}' +
    '#hometv-lettore .hl-centro b{position:absolute;left:0;right:0;bottom:-5vh;text-align:center;font:700 2.6vh/1 sans-serif}' +
    '#hometv-lettore .hl-avviso{position:absolute;left:5vw;bottom:17vh;padding:1.5vh 2.6vh;border-radius:99px;background:rgba(20,22,27,.88);font:600 2.4vh/1.2 sans-serif;display:none}' +
    // Giu': pannello Audio, Sottotitoli, Schermo
    '#hometv-lettore .hl-lingue{position:absolute;right:5vw;bottom:17vh;padding:2.6vh 2vh 2vh;border-radius:2.8vh;background:rgba(14,16,21,.94);' +
    'box-shadow:0 2vh 6vh rgba(0,0,0,.55),inset 0 0 0 .2vh rgba(255,255,255,.07);display:none;white-space:nowrap;font-size:0}' +
    '#hometv-lettore .hl-col{display:inline-block;vertical-align:top;width:22vw;margin:0 .8vh;opacity:.5;transition:opacity .15s ease}' +
    '#hometv-lettore .hl-col.hometv-sel{opacity:1}' +
    '#hometv-lettore .hl-col h3{margin:0 0 1.4vh 1.6vh;font:700 1.9vh/1.2 sans-serif;letter-spacing:.08em;text-transform:uppercase;color:rgba(244,245,247,.62)}' +
    '#hometv-lettore .hl-elenco{position:relative;max-height:52vh;overflow:hidden}' +
    '#hometv-lettore .hl-voce{position:relative;padding:1.3vh 2vh 1.3vh 5.2vh;margin-bottom:.5vh;border-radius:99px;font:600 2.4vh/1.25 sans-serif;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#hometv-lettore .hl-voce svg{position:absolute;left:1.7vh;top:50%;width:2.4vh;height:2.4vh;margin-top:-1.2vh;fill:none;stroke:currentColor;stroke-width:3;opacity:0}' +
    '#hometv-lettore .hl-voce.hl-attiva svg{opacity:1}' +
    '#hometv-lettore .hl-voce.hometv-sel{background:rgba(255,255,255,.1)}' +
    '#hometv-lettore .hl-col.hometv-sel .hl-voce.hometv-sel{background:linear-gradient(120deg,#19d3b7,#3b82f6 55%,#8b5cf6);color:#fff;box-shadow:0 .8vh 2.6vh rgba(59,130,246,.45)}' +
    // pulsanti delle puntate
    '#hometv-lettore .hl-azioni{position:absolute;right:5vw;bottom:17vh;display:flex;align-items:center}' +
    '#hometv-lettore .hl-chip{display:none;align-items:center;margin-left:1.4vh;padding:1.5vh 2.8vh 1.5vh 2.2vh;border-radius:99px;' +
    'background:rgba(18,20,26,.74);color:#f4f5f7;font:700 2.4vh/1.2 sans-serif;box-shadow:inset 0 0 0 .22vh rgba(255,255,255,.2);' +
    'transition:transform .16s ease,box-shadow .16s ease}' +
    '#hometv-lettore .hl-chip svg{width:2.6vh;height:2.6vh;margin-right:1.1vh;fill:currentColor;flex:none}' +
    '#hometv-lettore .hl-chip.hometv-sel{background:linear-gradient(120deg,#19d3b7,#3b82f6 55%,#8b5cf6);color:#fff;transform:scale(1.07);' +
    'box-shadow:0 1vh 3.4vh rgba(59,130,246,.5),inset 0 0 0 .22vh rgba(255,255,255,.5)}' +
    // fine puntata: "Prossimo episodio tra 5..."
    '#hometv-lettore .hl-prossimo{position:absolute;right:5vw;bottom:17vh;display:none;align-items:center;padding:2.2vh 3.6vh 2.2vh 2.4vh;' +
    'border-radius:3vh;background:rgba(14,16,21,.92);box-shadow:0 2vh 6vh rgba(0,0,0,.55),inset 0 0 0 .22vh rgba(255,255,255,.1)}' +
    '#hometv-lettore .hl-giro{position:relative;width:10vh;height:10vh;margin-right:2.6vh;flex:none}' +
    '#hometv-lettore .hl-giro svg{position:absolute;left:0;top:0;width:100%;height:100%;transform:rotate(-90deg)}' +
    '#hometv-lettore .hl-giro circle{fill:none;stroke-width:3.4}' +
    '#hometv-lettore .hl-giro .hl-fondo{stroke:rgba(255,255,255,.16)}' +
    '#hometv-lettore .hl-giro .hl-avanza{stroke:url(#hometv-colori-l);stroke-linecap:round;transition:stroke-dashoffset 1s linear}' +
    '#hometv-lettore .hl-giro b{position:absolute;left:0;right:0;top:50%;margin-top:-2.6vh;text-align:center;font:800 5.2vh/5.2vh sans-serif}' +
    '#hometv-lettore .hl-prossimo strong{display:block;font:800 3.1vh/1.2 sans-serif}' +
    '#hometv-lettore .hl-prossimo span{display:block;margin-top:.5vh;font:600 2.4vh/1.3 sans-serif;color:rgba(244,245,247,.8)}' +
    '#hometv-lettore .hl-prossimo em{display:block;margin-top:1.3vh;font:500 1.9vh/1.3 sans-serif;font-style:normal;color:rgba(244,245,247,.55)}';

  var styleEl = null;
  function applicaStili() {
    var css = CSS_BASE;
    var i;
    if (bloccoAttivo) {
      for (i = 0; i < CSS_ADS.length; i++) css += CSS_ADS[i] + NASCOSTO_INVISIBILE;
      // i selettori scelti da te in config.json spariscono del tutto
      var extra = CFG.selettoriExtra || [];
      for (i = 0; i < extra.length; i++) {
        var sel = typeof extra[i] === 'string' ? extra[i] : '';
        if (!sel || /[{}<>]/.test(sel)) continue;
        try { document.querySelector(sel); } catch (e) { continue; } // selettore non valido
        css += sel + '{display:none!important}';
      }
    }
    var dove = document.head || document.documentElement;
    if (!dove) return;
    if (!styleEl || !styleEl.isConnected) {
      styleEl = styleEl || document.createElement('style');
      styleEl.id = 'hometv-style';
      dove.appendChild(styleEl);
    }
    styleEl.textContent = css;
    applicaListe();
  }

  // CSS delle liste: un foglio "adottato" (non sta nella pagina, il sito non lo
  // toglie per sbaglio); dove manca, un <style>.
  var foglioListe = null, styleListe = null;
  function applicaListe() {
    if (!bloccoAttivo || !LISTE) return;
    var css = LISTE.css + LISTE.sito.css;
    if (!css) return;
    try {
      if (!foglioListe && MOTORE.fogliAdottati) {
        var f = new CSSStyleSheet();
        f.replaceSync(css);
        foglioListe = f;
      }
      if (foglioListe) {
        var a = document.adoptedStyleSheets || [];
        if (a.indexOf(foglioListe) === -1) document.adoptedStyleSheets = a.concat([foglioListe]);
        return;
      }
    } catch (e) { foglioListe = null; }
    var dove = document.head || document.documentElement;
    if (!dove) return;
    if (!styleListe) { styleListe = document.createElement('style'); styleListe.id = 'hometv-liste'; styleListe.textContent = css; }
    if (!styleListe.isConnected) dove.appendChild(styleListe);
  }

  /* ---------------------------------------------------------------- selettori procedurali delle liste
   * ":has(...)", ":has-text(...)", ":xpath(...)", ":upward(...)": il CSS del TV
   * non li conosce, si cercano a mano (solo sui siti per cui sono scritti).
   */
  var PROC = /^:(-abp-has|has|-abp-contains|has-text|contains|xpath|upward)\(/;
  function dividiProcedurale(sel) {
    var passi = [], css = '', i = 0, j;
    while (i < sel.length) {
      var c = sel.charAt(i);
      if (c === '\\') { css += sel.substr(i, 2); i += 2; continue; }
      if (c === '"' || c === '\'') { j = sel.indexOf(c, i + 1); if (j === -1) return null; css += sel.slice(i, j + 1); i = j + 1; continue; }
      if (c === '[') { j = sel.indexOf(']', i); if (j === -1) return null; css += sel.slice(i, j + 1); i = j + 1; continue; }
      if (c === ':') {
        var m = PROC.exec(sel.slice(i));
        if (m) {
          var a = i + m[0].length, prof = 1;
          for (j = a; j < sel.length && prof; j++) {
            var d = sel.charAt(j);
            if (d === '\\') j++; else if (d === '(') prof++; else if (d === ')') prof--;
          }
          if (prof) return null;
          if (css) passi.push({ css: css });
          css = '';
          passi.push({ op: m[1], arg: sel.slice(a, j - 1) });
          i = j;
          continue;
        }
        if (/^:(-abp-|matches-|min-text|remove|style|watch-attr|nth-ancestor|others|if)/.test(sel.slice(i))) return null; // non supportati
      }
      css += c;
      i++;
    }
    if (css) passi.push({ css: css });
    return passi.length ? passi : null;
  }
  function inArray(l) { var a = []; for (var i = 0; i < l.length; i++) a.push(l[i]); return a; }
  function cercaDa(el, css, inizio) {
    var t = css.replace(/^\s+|\s+$/g, ''), c = t.charAt(0);
    if (!t) return [el];
    if (el === document) return inArray(document.querySelectorAll(t));
    if (c === '>') return inArray(el.querySelectorAll(':scope ' + t));
    if (c === '+' || c === '~') {
      var resto = t.slice(1).replace(/^\s+/, ''), s = el.nextElementSibling, out = [];
      for (; s; s = s.nextElementSibling) {
        if (s.matches(resto)) out.push(s);
        if (c === '+') break;
      }
      return out;
    }
    if (inizio || /^\s/.test(css)) return inArray(el.querySelectorAll(t));
    return el.matches(t) ? [el] : [];
  }
  var giroProc = 0;
  function valutaPassi(passi, radici) {
    var cur = radici;
    for (var i = 0; i < passi.length && cur.length; i++) {
      var p = passi[i], nuovi = [], j, k, r;
      giroProc++;
      if (p.op === undefined) {
        for (j = 0; j < cur.length; j++) {
          r = cercaDa(cur[j], p.css, i === 0);
          for (k = 0; k < r.length; k++) if (r[k].__hometvGiro !== giroProc) { r[k].__hometvGiro = giroProc; nuovi.push(r[k]); }
        }
      } else {
        if (i === 0) cur = inArray((cur[0] === document ? document : cur[0]).querySelectorAll('*'));
        var arg = p.arg, re = null, sotto = null;
        if (p.op === 'has' || p.op === '-abp-has') { sotto = dividiProcedurale(arg); if (!sotto) return []; }
        else if (p.op !== 'xpath' && p.op !== 'upward') re = inRegExp(arg);
        for (j = 0; j < cur.length && j < 4000; j++) {
          var el = cur[j];
          if (sotto) { if (valutaPassi(sotto, [el]).length) nuovi.push(el); }
          else if (re) { if (re.test(el.textContent || '')) nuovi.push(el); }
          else if (p.op === 'upward') {
            var su = null;
            if (/^\d+$/.test(arg)) { su = el; for (k = 0; k < +arg && su; k++) su = su.parentElement; }
            else if (el.parentElement) su = el.parentElement.closest(arg);
            if (su && su.__hometvGiro !== giroProc) { su.__hometvGiro = giroProc; nuovi.push(su); }
          } else {
            r = document.evaluate(arg, el, null, 7, null);
            for (k = 0; k < r.snapshotLength; k++) { var n = r.snapshotItem(k); if (n.nodeType === 1) nuovi.push(n); }
          }
        }
      }
      cur = nuovi;
    }
    return cur;
  }
  var procedurali = null;
  function nascondiDalleListe() {
    if (!bloccoAttivo || !LISTE || !document.body) return;
    if (procedurali === null) {
      procedurali = [];
      for (var i = 0; i < LISTE.sito.proc.length; i++) {
        var p = dividiProcedurale(String(LISTE.sito.proc[i]));
        if (p) procedurali.push(p);
      }
    }
    for (var j = 0; j < procedurali.length; j++) {
      try { var el = valutaPassi(procedurali[j], [document]); for (var k = 0; k < el.length; k++) nascondi(el[k]); } catch (e) {}
    }
    for (var n = 0; n < daNascondere.length; n++) { try { daNascondere[n](); } catch (e) {} }
  }

  /* ================================================================ link e reindirizzamenti */

  function hostConsentito(h, ancheQuestaPagina) {
    if (!h) return true;
    if (h === LAUNCHER_HOST) return true;
    if (h === HOST && !ancheQuestaPagina) return true;
    var miei = sitiMiei();
    for (var s = 0; s < miei.length; s++) { var sh = hostOf(miei[s]); if (sh && dominioBase(h) === dominioBase(sh)) return true; }
    return inConsentiti(h);
  }
  function inConsentiti(h) {
    var extra = CFG.dominiConsentiti || [];
    for (var i = 0; i < extra.length; i++) {
      var d = String(extra[i]).toLowerCase().replace(/^\*\./, '');
      if (d && (h === d || h.slice(-(d.length + 1)) === '.' + d)) return true;
    }
    return false;
  }

  // i tuoi siti: quello della home e quelli aggiunti col "+" (dal tuo sito ci si va senza blocchi). soloCompleti: quelli
  // col blocco completo, cioe' il tuo sito e quelli del "+" per cui hai scelto "Completo (come il tuo sito)"
  function sitiMiei(soloCompleti) {
    var out = CFG.url ? [CFG.url] : [], s = Array.isArray(CFG.siti) ? CFG.siti : [];
    for (var i = 0; i < s.length; i++) {
      if (s[i] && typeof s[i].url === 'string' && s[i].url && (!soloCompleti || s[i].blocco === 'completo')) out.push(s[i].url);
    }
    return out;
  }
  // La pagina e' una delle tue "app" (il tuo sito o un riquadro del "+")? Li' i video vanno a schermo intero da soli, come
  // in un'app del TV. Nel browser (tutti gli altri siti) un video che parte da solo (anteprime, autoplay, pubblicita')
  // resta nella pagina, come in un browser normale; uno che fai partire tu (OK, Play, un clic, Riproduci dal telefono,
  // Continua a guardare) va nel lettore TV. Per un riquadro conta la pagina che lo contiene
  function hostPagina() {
    try { var a = location.ancestorOrigins; if (IN_FRAME && a && a.length) return hostOf(a[a.length - 1]); } catch (e) {}
    return HOST;
  }
  // YouTube: ha il suo lettore (e sul TV la sua interfaccia per la TV): il nostro non lo prende da solo
  function suYoutube() { return /(^|\.)youtube(-nocookie)?\.com$/.test(hostPagina()); }
  function sitoApp() {
    var h = hostPagina(), miei = cfgCaricata ? sitiMiei() : [];
    for (var i = 0; h && i < miei.length; i++) { var sh = hostOf(miei[i]); if (sh && dominioBase(h) === dominioBase(sh)) return true; }
    return false;
  }

  // Il "tuo sito" (quello della home), i siti del "+" col blocco completo e i domini consentiti: protezioni piu' severe.
  // Altrove (siti aperti dal browser e quelli del "+" col blocco normale, che possono essere Google o YouTube: il blocco
  // severo dei link li romperebbe) si naviga liberamente, con il blocco della pubblicita' di sempre.
  function eSitoMio(h) {
    if (!h || h === LAUNCHER_HOST || !cfgCaricata) return false;
    var miei = sitiMiei(true);
    for (var i = 0; i < miei.length; i++) { var sh = hostOf(miei[i]); if (sh && dominioBase(h) === dominioBase(sh)) return true; }
    return inConsentiti(h);
  }

  function suClicLink(ev) {
    var t = ev.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    var href = hrefDi(a);
    if (!href || /^javascript:/i.test(href) || href.charAt(0) === '#') return;
    var h = hostOf(href);
    var nuovaFinestra = a.target && !/^(_self|_top|_parent)$/i.test(a.target);
    var sulMioSito = !IN_FRAME && bloccoAttivo && eSitoMio(HOST);
    if (eAd(href, nuovaFinestra ? 'popup' : 'pagina') || (sulMioSito && !hostConsentito(h))) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      conta('link', href);
      toast('Link pubblicitario bloccato');
      return;
    }
    if (nuovaFinestra) {
      // Sul TV non ci sono altre finestre: il link si apre qui. Ma un "click" fatto da uno
      // script verso un altro sito (anche subito dopo un tuo clic) e' il trucco dei pop-under,
      // e nel lettore incorporato un link verso un altro sito e' sempre una pubblicita'.
      var fidato = ev.isTrusted || Date.now() - clicDaNoi < 300;
      if (bloccoAttivo && estraneo(href) && (IN_FRAME || !fidato)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        conta('pop-under', href);
        return;
      }
      if (IN_FRAME) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      location.href = href;
    }
  }
  window.addEventListener('click', suClicLink, true);

  // Tra qualche secondo si torna indietro da soli (OK per restare su questo sito).
  var ritornoAvviato = false;
  function tornaIndietroTra(secondi, frase, altrimenti) {
    if (ritornoAvviato) return;
    ritornoAvviato = true;
    var chiave = 'hometv-resta-' + HOST;
    try { if (localStorage.getItem(chiave) === '1') return; } catch (e) {}
    var restante = secondi;
    var annullato = false;
    function tick() {
      if (annullato) return;
      if (restante <= 0) {
        conta('reindirizzamento', HOST);
        if (history.length > 1) history.back();
        else if (altrimenti) location.replace(altrimenti);
        return;
      }
      toast(frase + ' (' + HOST + '): torno indietro tra ' + restante + ' s. OK per restare.', 1500);
      restante--;
      setTimeout(tick, 1000);
    }
    ascoltaSicuro(window, 'keydown', function (ev) {
      if (ev.keyCode === 13 && !annullato && restante >= 0) {
        annullato = true;
        try { localStorage.setItem(chiave, '1'); } catch (e) {}
        toast('Ok, resto su ' + HOST);
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    }, true);
    tick();
  }

  function controllaReindirizzamento() {
    if (IN_FRAME || !bloccoAttivo || !cfgCaricata || !sitiMiei().length) return;
    if (hostConsentito(HOST, true)) return;
    // aperto con un link dal telefono: voluto (anche se il sito poi va su www. o su un sottodominio)
    if (CFG.linkDalTelefono && dominioBase(String(CFG.linkDalTelefono).toLowerCase()) === dominioBase(HOST)) return;
    // Solo se ci arriviamo dal tuo sito: dal browser si va dove si vuole.
    if (!eSitoMio(hostOf(document.referrer))) return;
    // si torna al tuo sito da cui si arrivava (uno dei tuoi siti)
    var da = dominioBase(hostOf(document.referrer)), miei = sitiMiei(), torna = miei[0];
    for (var i = 0; i < miei.length; i++) if (dominioBase(hostOf(miei[i])) === da) torna = miei[i];
    tornaIndietroTra(4, 'Pagina esterna', torna);
  }

  /* ================================================================ pulizia della pagina */

  function areaVisibile(el) {
    var r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  function eTrappola(el, schermo) {
    // Strato che copre gran parte dello schermo, senza testo e senza video:
    // tipico dei siti che aprono pubblicita' al primo click.
    if (el.offsetWidth * el.offsetHeight < schermo * 0.6) return false;
    if (el.id && el.id.indexOf('hometv-') === 0) return false;
    if (el.classList.contains('hometv-fs') || el.classList.contains('hometv-fs-anc')) return false;
    if (el.classList.contains('hometv-trappola')) return false;
    if (el.tagName === 'VIDEO' || el.tagName === 'IFRAME') return false;
    var s = window.getComputedStyle(el);
    if (s.position !== 'fixed' && (IN_FRAME || s.position !== 'absolute')) return false;
    if (s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
    if (!(parseInt(s.zIndex, 10) >= 1000)) return false;
    if (s.backgroundImage && s.backgroundImage !== 'none') return false;
    if (haContenuto(el)) return false;
    return true;
  }

  function haContenuto(el) {
    if (el.querySelector('video, iframe, canvas, img, svg, picture, object, embed, input, textarea, select')) return true;
    return (el.textContent || '').replace(/\s+/g, '').length > 2;
  }

  // Le trappole tolte tornano normali se poi si riempiono (per esempio il sito
  // ci mette dentro il lettore video qualche secondo dopo).
  function ricontrollaTrappole() {
    var t = document.querySelectorAll('.hometv-trappola');
    for (var i = 0; i < t.length; i++) if (haContenuto(t[i])) t[i].classList.remove('hometv-trappola');
  }

  // Finestre "disattiva l'adblock": si tolgono e si sblocca lo scorrimento.
  // Solo frasi che parlano proprio di blocco delle pubblicita' (non "download blocked",
  // "pop-up blocker" o "blocco schermo").
  var MURO_TESTO = /\bad ?-?block|\bblocco (degli |di |della |delle )?(annunci|pubblicit)|\bblocca ?(annunci|pubblicit)|\bblocchi (gli annunci|la pubblicit)|bloqueador de (anuncios|publicidad)|bloqueur de pub|werbeblocker|\bwhitelist|lista bianca|disattiva.{0,40}(adblock|estension.{0,20}(annunci|pubblicit))/i;
  var MURO_SEL = ProfiloTV.selettore('[class*="adblock" i], [id*="adblock" i], [class*="adb-" i], [id*="adb-" i], [class*="anti-ad" i], ' +
    '[class*="blocker" i], [role="dialog"], [aria-modal="true"]');
  var muriTolti = 0;

  function eMuro(el) {
    if (el.id && el.id.indexOf('hometv-') === 0) return false;
    var testo = el.innerText || '';
    if (testo.length < 12 || testo.length > 3000 || !MURO_TESTO.test(testo)) return false;
    if (el.querySelector('video')) return false;
    var s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    var z = parseInt(s.zIndex, 10);
    var sopra = (s.position === 'fixed' || s.position === 'absolute') && z >= 10;
    return sopra || el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';
  }

  function sbloccaPagina() {
    // si toccano solo i blocchi messi dal muro: scorrimento spento e pagina "inchiodata"
    var radici = [document.documentElement, document.body];
    for (var i = 0; i < radici.length; i++) {
      if (!radici[i]) continue;
      var st = window.getComputedStyle(radici[i]);
      if (st.overflow === 'hidden' || st.overflowY === 'hidden') radici[i].style.setProperty('overflow', 'auto', 'important');
      if (st.position === 'fixed') radici[i].style.setProperty('position', 'static', 'important');
    }
    var figli = document.body ? document.body.children : [];
    for (var j = 0; j < figli.length; j++) {
      var f = window.getComputedStyle(figli[j]).filter;
      if (f && f !== 'none') figli[j].style.setProperty('filter', 'none', 'important');
    }
  }

  function togliMuri() {
    if (!bloccoAttivo || !AVANZATO || IN_FRAME) return; // solo col blocco avanzato
    var nodi = document.querySelectorAll(MURO_SEL);
    var tolti = 0;
    for (var i = 0; i < nodi.length && i < 60; i++) {
      if (eMuro(nodi[i])) {
        nodi[i].style.setProperty('display', 'none', 'important');
        tolti++;
      }
    }
    if (tolti) {
      muriTolti += tolti;
      conta('avviso anti-adblock', tolti);
      sbloccaPagina();
      toast('Avviso anti-adblock nascosto', 2500);
    }
  }

  function controllaNodo(el) {
    if (!bloccoAttivo) return;
    var tag = el.tagName;
    if (tag === 'SCRIPT') {
      // script pubblicitari scritti direttamente nell'HTML della pagina: si
      // fermano prima che partano (lo script che li aspetta non resta in attesa)
      var ss = el.getAttribute('src');
      if (ss && el.type !== 'javascript/hometv' && bloccaSrc('SCRIPT', ss)) {
        el.type = 'javascript/hometv';
        conta('script', ss);
        setTimeout(function () { evento(el, 'load'); }, 0);
      }
      return;
    }
    if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
      var src = el.getAttribute('src') || el.getAttribute('data') || '';
      if (src && src !== 'about:blank' && bloccaSrc(tag, src)) {
        // resta nella pagina, ma vuoto (cosi' il resto della pagina non si rompe)
        if (tag === 'IFRAME') { el.__hometvAd = src; origSetAttr.call(el, 'src', 'about:blank'); }
        else if (el.parentNode) el.parentNode.removeChild(el);
        el.style && el.style.setProperty('opacity', '0', 'important');
        conta('elemento', src);
      }
      if (tag === 'IFRAME') proteggiFinestra(el.contentWindow);
    } else if (tag === 'A') {
      var href = el.href; // una lettura sola: ogni lettura ricostruisce l'indirizzo (le pagine hanno migliaia di link)
      if (el.__hometv === href) return;
      el.__hometv = href;
      if (eAd(href, 'pagina')) {
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        conta('banner', href);
      }
    }
  }

  // Uno strato che copre gran parte dello schermo passa per forza dal centro o
  // quasi: invece di esaminare tutta la pagina (migliaia di elementi sui siti
  // pesanti) si guarda solo cosa c'e' sotto pochi punti dello schermo.
  function candidatiTrappola() {
    if (typeof document.elementsFromPoint !== 'function') return document.querySelectorAll(TRAPPOLE_SEL);
    var w = window.innerWidth, h = window.innerHeight;
    var punti = [[0.5, 0.5], [0.3, 0.35], [0.7, 0.65]];
    var out = [], visti = [];
    for (var p = 0; p < punti.length; p++) {
      var lista = document.elementsFromPoint(w * punti[p][0], h * punti[p][1]) || [];
      for (var i = 0; i < lista.length; i++) {
        var el = lista[i];
        if (el === document.documentElement || el === document.body || visti.indexOf(el) !== -1) continue;
        visti.push(el);
        out.push(el);
      }
    }
    return out;
  }

  var ultimaPulizia = 0, puliziaTimer = null;
  var TRAPPOLE_SEL = 'body > div, body > a, body > span, body > section, body > ins, ' +
    'body > * > div, body > * > a, body > * > ins';

  function pulisciLeggera() {
    ultimaPulizia = Date.now();
    if (paginaDiCasa()) return;
    if (!document.body) return;
    if (!styleEl || !styleEl.isConnected) applicaStili();
    else applicaListe();
    if (fsEl) return;
    if (bloccoAttivo) {
      nascondiDalleListe();
      ricontrollaTrappole();
      var schermo = window.innerWidth * window.innerHeight;
      var nodi = candidatiTrappola();
      for (var i = 0; i < nodi.length; i++) {
        if (nodi[i].nodeType === 1 && eTrappola(nodi[i], schermo)) {
          nodi[i].classList.add('hometv-trappola');
          conta('trappola', nodi[i].className || nodi[i].tagName);
        }
      }
    }
    togliMuri();
  }

  // Le app che rifanno gli elenchi staccano migliaia di elementi: non si tengono in memoria. Se il sito
  // li rimette nella pagina, la scansione delle cose nuove li ritrova (rimetti).
  function lasciaStaccati() {
    var i, el, tenuti = [];
    for (i = 0; i < segnati.length; i++) {
      el = segnati[i];
      if (el.isConnected) tenuti.push(el);
      else { try { Object.defineProperty(el, '__hometvFuori', { value: true, configurable: true, writable: true }); } catch (e) {} }
    }
    segnati = tenuti;
    tenuti = [];
    for (i = 0; i < manine.length; i++) {
      el = manine[i];
      if (el.isConnected) tenuti.push(el);
      else { try { delete el.__hometvManina; } catch (e) {} }
    }
    manine = tenuti;
  }
  function rimetti(el) { el.__hometvFuori = false; segnati.push(el); navSporca = true; }
  function pulisciCompleta() {
    if (!document.body) return;
    lasciaStaccati();
    if (bloccoAttivo) {
      var nodi = document.querySelectorAll('iframe[src], embed[src], object[data], a[href]');
      for (var i = 0; i < nodi.length; i++) controllaNodo(nodi[i]);
    }
    pulisciLeggera();
  }

  function pianificaPulizia() {
    if (puliziaTimer) return;
    var attesa = Math.max(300, 2500 - (Date.now() - ultimaPulizia));
    puliziaTimer = setTimeout(function () {
      puliziaTimer = null;
      try { pulisciLeggera(); } catch (e) { log('errore pulizia', e); }
    }, attesa);
  }

  var cambiamenti = false;
  /* Pannelli pubblicitari sopra la pagina e sopra il video. Si tolgono appena nascono, prima che si vedano, in ogni
   * pagina e in ogni riquadro; se il sito li rimette si tolgono di nuovo:
   * - i pannelli truffa ("Confirm you're not a robot - Scan the qr-code with your phone", "premi Consenti"): pubblicita'
   *   finte che a schermo intero non si chiudono. I veri "non sono un robot" dei moduli non chiedono di inquadrare un
   *   codice QR, e le pagine di accesso col QR non parlano di robot: restano;
   * - i riquadri senza indirizzo che uno script riempie e allarga sopra tutto (e' cosi' che il pannello truffa arriva
   *   nel lettore di un sito): i riquadri veri (lettori, accessi, pagamenti, consensi) hanno un indirizzo loro, e uno con
   *   dentro un video o un modulo da compilare resta;
   * - gli strati vuoti e trasparenti a tutto schermo sopra tutto, che rubano il clic per aprire pubblicita'.
   * Lo stesso pannello rimesso dal sito (stesse classi) si toglie subito, anche prima che arrivi il testo */
  var TRUFFA_ROBOT = /robot|not human|sei umano|human verification|verifica umana/i;
  var TRUFFA_QR = /(scan|scansiona|inquadra)[\s\S]{0,40}q\s*r|q\s*r[\s-]*code[\s\S]{0,40}(phone|telefono|cellulare)|(click|press|tap|clicca|premi|tocca)[\s\S]{0,20}(allow|consenti)/i;
  var TRUFFA_PEZZO = /\brobot|\bhuman\b|\bumano\b|\bq\s?r\b|\ballow\b|\bconsenti\b/i;
  // a schermo intero: le domande del sito che vogliono una risposta ("sei ancora li'?") non si nascondono mai
  var ANCORA_LI = /ancora l[i\u00ec]|sei ancora|stai ancora|still watching|are you (still )?there|keep watching|continua(re)? a guardare/i;
  var SOTTOTITOLI_DISEGNATI = /libass|jassub|octopus|subtitles?-canvas/i;
  var Z_SOPRA = 1000000;
  var truffeTolte = 0, firme = [], lotta = { n: 0, t: 0 };
  function eTruffa(t) { return t.length < 1200 && TRUFFA_ROBOT.test(t) && TRUFFA_QR.test(t); }
  // il video a schermo intero e quello che lo tiene, e le cose nostre: mai toccati
  function intoccabile(el) {
    if (el === fsEl || (fsEl && el.contains(fsEl))) return true;
    if (el.id && el.id.indexOf('hometv-') === 0) return true;
    return /(^|\s)hometv-fs(-anc|-cc)?(\s|$)/.test(typeof el.className === 'string' ? el.className : '');
  }
  function firmaDi(el) {
    var c = typeof el.className === 'string' ? el.className.replace(/(^|\s)hometv-\S+/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '') : '';
    return c || el.id ? el.tagName + '|' + c + '|' + (el.id || '') : '';
  }
  function zDi(cs) { var z = parseInt(cs.zIndex, 10); return isFinite(z) ? z : 0; }
  function copreSchermo(el, quota) {
    var r = el.getBoundingClientRect();
    return r.width * r.height >= (window.innerWidth || 1) * (window.innerHeight || 1) * quota;
  }
  // fisso e sopra tutto (prima lo stile scritto nell'elemento, che non costa niente)
  function fissoSopra(el, z) {
    var st = el.style;
    if (st && st.position === 'fixed' && (parseInt(st.zIndex, 10) || 0) >= z) return true;
    var cs = window.getComputedStyle(el);
    return cs.position === 'fixed' && zDi(cs) >= z;
  }
  function riquadroPubblicita(el) {
    if (el.__hometvVideo) return '';
    var s = el.getAttribute('src');
    if (s && !/^\s*(about:|javascript:)/i.test(s)) return '';
    // (una pubblicita' fermata dalle liste resta un riquadro vuoto: se copre la pagina, via anche lei)
    if (!fissoSopra(el, el.__hometvAd ? 1000 : Z_SOPRA)) return '';
    var d = null;
    try { d = el.contentDocument; } catch (e) { d = null; }
    // il riquadro e' andato su un altro sito (un pagamento, un accesso): resta, salvo che sia una pubblicita' delle liste
    if ((!d || !d.body) && !el.__hometvAd) return '';
    if (d && d.body) {
      // ancora vuoto (lo script lo riempira' tra un attimo): lo si riguarda subito dopo, a contenuto arrivato
      if (!d.body.firstChild) {
        if (!el.__hometvRiprova) {
          el.__hometvRiprova = 1;
          [120, 700].forEach(function (t) { setTimeout(function () { var x = pannelloPubblicita(el); if (x) togliPannello(el, x); }, t); });
        }
        return '';
      }
      if (d.querySelector('video, audio, object, embed, input, textarea, select, form')) return '';
      var t = testoSenzaCodice(d.body).replace(/\s+/g, ' ');
      if (t.length < 4000 && eTruffa(t)) return 'truffa'; // (il codice QR puo' essere disegnato)
      // una finestra con qualcosa da leggere (consenso, eta', domanda) o con dentro un altro riquadro o un disegno: resta
      if (t.length >= 150 || d.querySelector('iframe, canvas')) return '';
    }
    // gia' a tutto schermo, o pronto per esserlo (largo il 100%, attaccato ai quattro lati)
    if (copreSchermo(el, el.__hometvAd ? 0.3 : 0.4) || /(^|;)\s*(width:\s*100%|inset:\s*0)/i.test(el.getAttribute('style') || '')) return 'riquadro';
    return '';
  }
  // strato vuoto e trasparente a tutto schermo sopra tutto: c'e' solo per rubare il clic
  function tappo(el) {
    var tag = el.tagName;
    if (el.firstElementChild || el.shadowRoot || el.__hometvOmbra || /^(IFRAME|VIDEO|CANVAS|IMG|svg|OBJECT|EMBED)$/.test(tag)) return false;
    if (!(el.style && el.style.position === 'fixed') && el.parentNode !== document.documentElement && el.parentNode !== document.body) return false;
    if ((el.textContent || '').replace(/\s+/g, '').length) return false;
    var cs = window.getComputedStyle(el);
    if (cs.position !== 'fixed' || zDi(cs) < Z_SOPRA || cs.pointerEvents === 'none' || cs.display === 'none') return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return false;
    var bg = cs.backgroundColor || '';
    if (bg !== 'transparent' && !/^rgba\(.*,\s*0(\.0*)?\)$/.test(bg)) return false;
    if (!copreSchermo(el, 0.8)) return false;
    // appena nato: si riguarda tra un attimo (se il sito ci mette dentro qualcosa, non e' piu' uno strato vuoto)
    if (!el.__hometvTappoVisto) {
      el.__hometvTappoVisto = Date.now();
      [150, 700].forEach(function (t) { setTimeout(function () { var x = pannelloPubblicita(el); if (x) togliPannello(el, x); }, t); });
      return false;
    }
    return Date.now() - el.__hometvTappoVisto >= 120;
  }
  // '' se va bene, altrimenti che pannello e'
  function pannelloPubblicita(el) {
    if (!bloccoAttivo || YT_TV || !el || el.nodeType !== 1 || !el.parentNode || el.__hometvLasciato) return '';
    if (el.__hometvTolto) return window.getComputedStyle(el).display === 'none' ? '' : 'di nuovo'; // rimostrato dal sito
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'BODY' || tag === 'HEAD' || tag === 'HTML') return '';
    if (intoccabile(el)) return '';
    if (tag === 'IFRAME') return riquadroPubblicita(el);
    if (firme.length && (el.parentNode === document.body || el.parentNode === document.documentElement)) {
      // lo stesso pannello rimesso (stessa firma, appeso alla pagina, fisso sopra tutto, senza niente di utile dentro)
      var f = firmaDi(el);
      if (f && firme.indexOf(f) !== -1 && !el.querySelector('video, audio, iframe, canvas, object, embed, input, textarea, select, form') &&
        fissoSopra(el, 1000)) return 'di nuovo';
    }
    return tappo(el) ? 'tappo' : '';
  }
  // il contenitore rimasto senza pubblicita' (lo sfondo scuro, la scritta, la X): via anche lui
  function togliGuscio(p) {
    for (var k = 0; p && p.nodeType === 1 && k < 3 && p !== document.body && p !== document.documentElement; k++) {
      if (intoccabile(p) || p.__hometvTolto) return;
      // quello che resta dentro e' tutto nascosto da noi? (il riquadro appena nascosto non conta)
      var resto = p.querySelectorAll('video, iframe, input, textarea, select, canvas');
      for (var i = 0; i < resto.length; i++) if (!resto[i].__hometvTolto) return;
      if ((p.textContent || '').replace(/\s+/g, ' ').length > 120 || !fissoSopra(p, 1000) || !copreSchermo(p, 0.3)) return;
      var su = p.parentNode;
      togliPannello(p, 'guscio');
      p = su;
    }
  }
  function nascondiPannello(el) {
    el.__hometvTolto = true;
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  }
  function togliPannello(el, tipo) {
    var ora = Date.now();
    if (ora - lotta.t > 3000) { lotta.n = 0; lotta.t = ora; }
    if (++lotta.n > 60) {
      // il sito lo rimette di continuo: per un po' resta solo nascosto (mai una lotta che blocca la pagina)
      el.__hometvLasciato = true;
      el.style.setProperty('display', 'none', 'important');
      return;
    }
    if ((tipo === 'truffa' || tipo === 'di nuovo') && el.tagName !== 'IFRAME') {
      var f = firmaDi(el);
      if (f && firme.indexOf(f) === -1 && firme.length < 30) firme.push(f);
    }
    if (fsEl === el) esciSchermoIntero(true);
    var padre = el.parentNode;
    nascondiPannello(el);
    conta('pannello', tipo + ' ' + ((typeof el.className === 'string' && el.className) || el.tagName));
    if (tipo === 'truffa' && ++truffeTolte === 1) toast('Tolto un pannello truffa (finto controllo "non sei un robot")', 3500);
    if (tipo !== 'tappo' && tipo !== 'guscio') togliGuscio(padre);
  }
  // il testo che si legge (senza il codice degli script e degli stili, che nel testo di un elemento ci finisce)
  function testoSenzaCodice(el) {
    var t = el.textContent || '';
    if (t.length > 20000) return t;
    var c = el.querySelectorAll('script, style, noscript, template');
    for (var i = 0; i < c.length && i < 30; i++) { var x = c[i].textContent; if (x) t = t.split(x).join(' '); }
    return t;
  }
  // sopra la pagina: fisso, o messo sopra con un livello (i pannelli truffa lo sono; una pagina di accesso no)
  function inPrimoPiano(el) {
    for (var a = el, k = 0; a && a.nodeType === 1 && k < 5 && a !== document.body && a !== document.documentElement; a = a.parentElement, k++) {
      var cs = window.getComputedStyle(a);
      if (cs.position === 'fixed' || (cs.position === 'absolute' && zDi(cs) >= 10)) return true;
    }
    return false;
  }
  var NON_PANNELLO = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|TITLE|META|LINK|BODY|HTML|VIDEO|AUDIO|IFRAME|svg)$/;
  function togliTruffa(n) {
    if (!bloccoAttivo || YT_TV || !n || n.nodeType !== 1 || !n.parentNode || NON_PANNELLO.test(n.tagName)) return false;
    if (n.__hometvTruffa) { if (!intoccabile(n)) togliPannello(n, 'di nuovo'); return true; } // rimesso dal sito
    var t = n.textContent || '';
    if (t.length > 4000 || !/robot|human|umano/i.test(t) || !/q\s*r|allow|consenti/i.test(t)) return false;
    // il pannello: il piu' piccolo che dice tutte e due le cose, poi su finche' il testo resta quello (lo sfondo scuro)
    var pan = null, l = [n].concat(Array.prototype.slice.call(n.querySelectorAll('div, section, aside, dialog, form, span, p')));
    for (var i = l.length - 1; i >= 0; i--) if (eTruffa(l[i].textContent || '')) { pan = l[i]; break; }
    // mai il video, mai un modulo da compilare (i veri "non sono un robot" stanno nei moduli), mai il codice della pagina
    if (!pan || pan.querySelector('video, input, textarea, select, form') || !eTruffa(testoSenzaCodice(pan).replace(/\s+/g, ' '))) return false;
    var cima = pan;
    for (var a = pan.parentElement, k = 0; a && k < 8 && a !== document.body && a !== document.documentElement; a = a.parentElement, k++) {
      if (a.querySelector('video, iframe, canvas') && !pan.contains(a.querySelector('video, iframe, canvas'))) break; // il lettore resta
      if ((a.textContent || '').replace(/\s+/g, '').length > (pan.textContent || '').replace(/\s+/g, '').length + 40) break;
      cima = a;
    }
    if (intoccabile(cima)) return false;
    var sopra = inPrimoPiano(cima);
    for (var b = pan; !sopra && b && b !== cima; b = b.parentElement) {
      var cb = window.getComputedStyle(b);
      if (cb.position === 'fixed' || (cb.position === 'absolute' && zDi(cb) >= 10)) sopra = true;
    }
    if (!sopra) return false;
    cima.__hometvTruffa = true;
    togliPannello(cima, 'truffa');
    return true;
  }
  // un riquadro che e' tutto un pannello truffa (la pagina dentro e' solo il pannello): lo toglie la pagina di sopra
  var riquadroDetto = false, riquadroPieno = false;
  function riquadroTruffa() {
    if (!IN_FRAME || riquadroDetto || riquadroPieno || !bloccoAttivo || YT_TV || !document.body) return false;
    var t = testoSenzaCodice(document.body).replace(/\s+/g, ' ');
    if (t.length > 5000) { riquadroPieno = true; return false; }
    if (!eTruffa(t) || tuttiIVideo().length || document.getElementsByTagName('*').length > 150 ||
      document.querySelector('video, audio, iframe, object, embed, input, textarea, select, form')) return false;
    riquadroDetto = true;
    try { window.parent.postMessage({ hometv: 'truffa' }, '*'); } catch (e) {}
    return true;
  }
  // un pezzo di testo nuovo che potrebbe essere di un pannello truffa (il testo arriva a pezzi): si guarda intorno
  function truffaDa(el) {
    for (var a = el, k = 0; a && a.nodeType === 1 && k < 6; a = a.parentElement, k++) {
      if (a === document.body || a === document.documentElement) return riquadroTruffa();
      if (a === document.head || NON_PANNELLO.test(a.tagName) || a.childElementCount > 80) return false;
      var t = a.textContent || '';
      if (t.length > 4000) return false;
      if (TRUFFA_ROBOT.test(t) && TRUFFA_QR.test(t)) return togliTruffa(a);
    }
    return false;
  }
  // ogni tanto (anche a schermo intero): quello che fosse scappato
  function pulisciPannelli() {
    if (fsEl) controllaTardivi();
    if (!bloccoAttivo || YT_TV || !document.body || paginaDiCasa()) return;
    var l = [], i, r, radici = [document.body, document.documentElement];
    for (r = 0; r < radici.length; r++) for (i = 0; i < radici[r].children.length && i < 80; i++) l.push(radici[r].children[i]);
    var fr = document.getElementsByTagName('iframe');
    for (i = 0; i < fr.length && i < 40; i++) l.push(fr[i]);
    for (i = 0; i < l.length; i++) {
      var el = l[i];
      if (!el.parentNode || el === document.body || el === document.head) continue;
      var tipo = pannelloPubblicita(el);
      if (tipo) { togliPannello(el, tipo); continue; }
      guardaStile(el);
      if (el.tagName !== 'IFRAME' && !el.__hometvGrande && el.childElementCount < 80) {
        // i contenitori di tutta la pagina non si rileggono ogni volta (un pannello nuovo li' dentro lo vede l'osservatore)
        if ((el.textContent || '').length > 20000) el.__hometvGrande = true;
        else togliTruffa(el);
      }
    }
    riquadroTruffa();
  }
  // stili cambiati: un riquadro vuoto che diventa grande e sopra tutto, uno strato che si allarga. Si guardano solo i
  // riquadri senza indirizzo e quello che sta appeso direttamente alla pagina (non tutta la pagina: costerebbe)
  var osservaStili = null;
  function guardaStile(el) {
    if (!osservaStili || el.__hometvGuardato || (el.id && el.id.indexOf('hometv-') === 0)) return;
    if (el.tagName === 'IFRAME') { var s = el.getAttribute('src'); if (s && !/^\s*(about:|javascript:)/i.test(s)) return; }
    else if (el.parentNode !== document.body && el.parentNode !== document.documentElement) return;
    el.__hometvGuardato = true;
    try { osservaStili.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] }); } catch (e) {}
  }
  function suStili(lista) {
    for (var i = 0; i < lista.length; i++) {
      var el = lista[i].target, tipo = pannelloPubblicita(el);
      if (tipo) togliPannello(el, tipo);
    }
  }
  // A schermo intero si vedono solo il video e il nostro lettore: quello che il sito aggiunge dopo accanto al video o
  // sopra la pagina (i suoi comandi, i suoi avvisi, le pubblicita') resta nascosto come il resto, tranne i sottotitoli
  function nuovoNelloSchermoIntero(n) {
    var tag = n.tagName;
    if (!fsEl || n === fsEl || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'META' || tag === 'HEAD' || tag === 'BODY') return;
    if (n.id && n.id.indexOf('hometv-') === 0) return;
    var p = n.parentNode;
    if (!p || n.contains(fsEl) || tag === 'VIDEO' || (n.querySelector && n.querySelector('video'))) return; // un video nuovo del sito: mai
    if (p !== document.body && p !== document.documentElement && !(p.classList && p.classList.contains('hometv-fs-anc'))) return;
    if (tag === 'CANVAS' || (n.querySelector && n.querySelector('canvas'))) return; // sottotitoli disegnati
    var nome = (typeof n.className === 'string' ? n.className : '') + ' ' + n.id;
    if (SOTTOTITOLI_DISEGNATI.test(nome)) return;
    if (n.childElementCount < 200 && domandaDelSito(n)) return; // "riprendi la visione?", "sei ancora li'?"
    if (fsEl.tagName === 'VIDEO' && SOTTOTITOLI.test(nome)) { classeFs(n, 'hometv-fs-cc'); return; }
    classeFs(n, 'hometv-fs-hide');
    tardivi.push(n);
    if (classati.length > 600) classati = classati.filter(function (c) { return c[0].isConnected; });
  }
  function domandaDelSito(n) { var t = n.textContent || ''; return t.length < 2000 && (CHIEDE_RIPRESA.test(t) || ANCORA_LI.test(t)); }
  // quelli nascosti a schermo intero: se ora sono una domanda del sito (il testo arriva dopo), si fanno vedere
  var tardivi = [];
  function controllaTardivi() {
    var tenuti = [];
    for (var i = 0; i < tardivi.length; i++) {
      var n = tardivi[i];
      if (!n.isConnected || !n.classList.contains('hometv-fs-hide')) continue;
      if (n.childElementCount < 200 && domandaDelSito(n)) {
        n.classList.remove('hometv-fs-hide');
        classati = classati.filter(function (c) { return c[0] !== n; }); // (se no la guardia la rinasconde)
      } else tenuti.push(n);
    }
    tardivi = tenuti;
  }

  function suMutazioni(lista) {
    if (paginaDiCasa()) return;
    if (bloccoAttivo && !YT_TV) {
      // pannelli pubblicitari e truffa: via appena nascono, prima che si vedano (anche col testo che arriva dopo, a pezzi)
      for (var q = 0; q < lista.length; q++) {
        var agg = lista[q].addedNodes;
        for (var r = 0; r < agg.length; r++) {
          try {
            var nodo = agg[r];
            if (nodo.nodeType === 3) {
              var pe = nodo.parentElement;
              if (pe && pe !== document.head && !NON_PANNELLO.test(pe.tagName) && TRUFFA_PEZZO.test(nodo.data || '')) truffaDa(pe);
              continue;
            }
            if (nodo.nodeType !== 1 || !nodo.parentNode) continue; // gia' tolto
            var tipo = pannelloPubblicita(nodo);
            if (tipo) { togliPannello(nodo, tipo); continue; }
            guardaStile(nodo);
            if (nodo.firstElementChild && nodo.tagName !== 'IFRAME') {
              // un blocco aggiunto tutto insieme: i riquadri che ha dentro
              var fr = Array.prototype.slice.call(nodo.getElementsByTagName('iframe'), 0, 20);
              for (var f = 0; f < fr.length; f++) {
                var tf = pannelloPubblicita(fr[f]);
                if (tf) togliPannello(fr[f], tf); else guardaStile(fr[f]);
              }
            }
            if (nodo.parentNode && !NON_PANNELLO.test(nodo.tagName) && nodo.parentNode !== document.head && nodo.childElementCount < 80) {
              var tn = nodo.textContent || '';
              if (tn.length <= 4000 && TRUFFA_PEZZO.test(tn) && !togliTruffa(nodo)) truffaDa(nodo.parentElement);
            }
          } catch (e) {}
        }
      }
    }
    // per il telecomando contano solo le cose nuove che si possono scegliere (non il testo che
    // cambia, ne' i riquadri che il sito aggiunge di continuo; quelle tolte si scartano da sole)
    for (var a = 0; a < lista.length; a++) {
      var nuovi = lista[a].addedNodes;
      for (var b = 0; b < nuovi.length; b++) {
        var n = nuovi[b];
        if (n.nodeType !== 1 || !n.parentNode) continue;
        modaliSporche = true;
        if (fsEl) nuovoNelloSchermoIntero(n);
        if (n.__hometvFuori) rimetti(n);
        if (!navSporca && (n.matches(SEL_NAV) || (n.firstElementChild && n.querySelector(SEL_NAV)))) navSporca = true;
        if (scansioneAvviata) daScansionare(n); // prima dell'avvio ci pensa la scansione di tutta la pagina
      }
    }
    if (bloccoAttivo) {
      for (var i = 0; i < lista.length; i++) {
        var aggiunti = lista[i].addedNodes;
        for (var j = 0; j < aggiunti.length; j++) {
          var n = aggiunti[j];
          if (n.nodeType !== 1) continue;
          controllaNodo(n);
          if (n.firstElementChild) {
            var dentro = n.querySelectorAll('script[src], iframe[src], a[href]');
            for (var k = 0; k < dentro.length && k < 200; k++) controllaNodo(dentro[k]);
          }
        }
      }
    }
    cambiamenti = true;
    pianificaPulizia();
  }

  /* ================================================================ schermo intero */

  var fsEl = null;
  var ultimoTasto = 0;
  var SOTTOTITOLI = /caption|subtit|sottotit|text-track|texttrack|vjs-text|cue/i;

  // Impostazioni passate ai riquadri (lettori video incorporati), che da soli
  // non le conoscono: blocco pubblicita' spento, schermo intero automatico...
  function inviaImpostazioni(frame) {
    try {
      // ok: da quanto hai premuto OK qui (un lettore che parte in un riquadro appena aperto sa che l'hai chiesto tu)
      frame.contentWindow.postMessage({ hometv: 'cfg', bloccoSpento: !bloccoAttivo, cfg: CFG, ok: Date.now() - ultimoOk }, '*');
    } catch (e) {}
  }
  // OK o un clic qui: lo sanno anche i riquadri (un lettore in un riquadro fatto partire da questa pagina)
  function premutoAiRiquadri() {
    var fr = document.querySelectorAll('iframe');
    for (var i = 0; i < fr.length; i++) if (fr[i].__hometvPronto) { try { fr[i].contentWindow.postMessage({ hometv: 'premuto' }, '*'); } catch (e) {} }
  }
  // Un riquadro e' un lettore se il nostro codice la' dentro ci ha visto un video; senza, se ne ha l'aspetto: largo,
  // orizzontale, coi permessi o l'indirizzo da lettore. Gli altri (il pannello delle app di un sito, un menu, i
  // commenti) non vanno mai a schermo intero
  function eLettore(fr) {
    if (fr.__hometvVideo) return true;
    var r = fr.getBoundingClientRect();
    if (r.width < 300 || r.width < r.height * 1.15) return false;
    if (fr.hasAttribute('allowfullscreen') || /fullscreen|autoplay|encrypted-media/i.test(fr.getAttribute('allow') || '')) return true;
    return /youtube(-nocookie)?\.com\/embed|player|video|\/embed\/|\/e\//i.test(fr.src || '');
  }
  // si entra in un riquadro che non e' un lettore: prende il fuoco (i tasti del telecomando vanno a lui, quelli del
  // telefono glieli passa eseguiAzione) e il nostro codice la' dentro sceglie la prima cosa. Indietro torna qui
  var entratoA = 0;
  function entraNelRiquadro(fr, dir, da) {
    entratoA = Date.now();
    if (corrente && corrente !== fr) corrente.classList.remove('hometv-focus');
    corrente = fr;
    fr.classList.remove('hometv-focus');
    // se il sito gli ha gia' dato il fuoco non lo si ridia (rifarlo a meta' della sua apertura lo farebbe richiudere)
    if (document.activeElement !== fr) { try { fr.focus(); } catch (e) {} }
    try { disegnaAnello(); } catch (e) {}
    if (!fr.__hometvPronto) return;
    var m = { hometv: 'entra' };
    // arrivati con una freccia: da che parte e da che punto (nelle misure del riquadro), per scegliere la cosa piu' vicina
    if (dir && da) {
      var r = fr.getBoundingClientRect();
      m.dir = dir; m.x = da.left + da.width / 2 - r.left - (fr.clientLeft || 0); m.y = da.top + da.height / 2 - r.top - (fr.clientTop || 0);
    }
    try { fr.contentWindow.postMessage(m, '*'); } catch (e) {}
  }
  // un riquadro in cui si entra con le frecce (come in una tendina): non un lettore (quello va a schermo intero con OK), con
  // il nostro codice dentro (sceglie la cosa piu' vicina alla parte da cui si arriva) e che si vede. Oltre l'ultima cosa la'
  // dentro si torna qui, nella stessa direzione
  function riquadroDaEntrare(fr) {
    return !!fr.__hometvPronto && !fr.__hometvVideo && !fr.__hometvAd && !fr.__hometvTruffa && !eLettore(fr) && siVede(fr) &&
      areaVisibile(fr) >= 60 * 40;
  }
  // il sito ha dato il fuoco a un suo riquadro subito dopo un tuo OK (un pannello come le app di Google): ci si entra, anche
  // se lo fa quando la selezione e' gia' andata altrove (sui TV lenti succede dopo)
  window.addEventListener('blur', function () {
    var giri = 0;
    function prova() {
      var af = document.activeElement;
      if (!af || af.tagName !== 'IFRAME' || fsEl || paginaDiCasa() || Date.now() - ultimoOk > 4000) return;
      if (af === corrente && Date.now() - entratoA < 1500) return; // ci si e' appena entrati da qui
      if (af.__hometvVideo || af.__hometvAd || eLettore(af) || !siVede(af)) return;
      var r = af.getBoundingClientRect();
      if (r.width < 120 || r.height < 120) { if (++giri < 8) setTimeout(prova, 150); return; } // si sta ancora aprendo
      ambito = null;
      entraNelRiquadro(af);
    }
    setTimeout(prova, 0);
  });
  // un pannello fatto da un riquadro: il riquadro grande che c'e' dentro
  function riquadroGrande(el) {
    var f = el.tagName === 'IFRAME' ? [el] : el.querySelectorAll('iframe');
    for (var i = 0; i < f.length; i++) {
      var r = f[i].getBoundingClientRect();
      if (r.width >= 120 && r.height >= 120) return f[i];
    }
    return null;
  }
  // nel riquadro: la pagina di sopra ci fa entrare (OK su questo riquadro, o il sito ci ha dato il fuoco): si sceglie la
  // cosa che il sito ha gia' scelto, se no la prima. Arrivati con una freccia: la cosa piu' vicina al punto da cui si
  // arriva, dalla parte da cui si arriva (scendendo, la prima in alto sotto quel punto)
  var dentroDaFuori = false;
  function entrataDaFuori(dir, x, y) {
    dentroDaFuori = true;
    var a = document.activeElement, lista = candidati(null), el = null;
    if (!dir && a && a !== document.body && a.matches && a.matches(SEL_NAV) && siVede(a)) { setFocus(a, true); return; }
    if (/^(su|giu|sx|dx)$/.test(dir) && isFinite(x) && isFinite(y)) {
      var W = window.innerWidth, H = window.innerHeight, px = Math.max(0, Math.min(W, x)), py = Math.max(0, Math.min(H, y));
      var rc = dir === 'giu' ? { left: px, right: px, top: -2, bottom: -1 } : dir === 'su' ? { left: px, right: px, top: H + 1, bottom: H + 2 } :
        dir === 'dx' ? { left: -2, right: -1, top: py, bottom: py } : { left: W + 1, right: W + 2, top: py, bottom: py };
      rc.width = rc.right - rc.left; rc.height = rc.bottom - rc.top;
      if (corrente) { corrente.classList.remove('hometv-focus'); corrente = null; }
      el = scegliVerso(lista, rc, dir);
    }
    el = el || primaVoce(lista, false);
    if (el) setFocus(el);
  }
  // nel riquadro in cui si e' entrati da fuori: oltre l'ultima cosa (e a fine pagina) si torna alla pagina di sopra, che
  // continua da li' nella stessa direzione
  function esciDalBordo(dir) {
    if (!IN_FRAME || !dentroDaFuori) return false;
    var se = document.scrollingElement || document.documentElement, y = window.pageYOffset || (se && se.scrollTop) || 0;
    if (dir === 'giu' && se && y + window.innerHeight < se.scrollHeight - 2) return false; // c'e' ancora pagina: si scorre
    if (dir === 'su' && y > 2) return false;
    dentroDaFuori = false;
    if (corrente) corrente.classList.remove('hometv-focus');
    try { window.parent.postMessage({ hometv: 'bordo', dir: dir }, '*'); window.parent.focus(); } catch (e) {}
    return true;
  }
  // nel riquadro: c'e' un video, quindi e' un lettore (con OK la pagina di sopra lo mette a schermo intero)
  var videoDetto = false;
  function diciVideo() {
    if (!IN_FRAME || videoDetto) return;
    videoDetto = true;
    try { window.parent.postMessage({ hometv: 'video' }, '*'); } catch (e) {}
  }
  if (IN_FRAME) {
    ascoltaSicuro(document, 'loadedmetadata', function (ev) { if (ev.target && ev.target.tagName === 'VIDEO') diciVideo(); }, true);
    ascoltaSicuro(document, 'play', function (ev) { if (ev.target && ev.target.tagName === 'VIDEO') diciVideo(); }, true);
    ascoltaSicuro(window, 'load', function () { if (tuttiIVideo().length) diciVideo(); });
  }

  // il lettore principale della pagina: quello col punteggio piu' alto (vedi punteggioPlayer)
  function trovaPlayer() {
    var lista = tuttiIVideo().concat(Array.prototype.slice.call(document.querySelectorAll('iframe')));
    var migliore = null, meglio = 0;
    for (var i = 0; i < lista.length; i++) {
      var p = punteggioPlayer(lista[i]);
      if (p > meglio) { meglio = p; migliore = lista[i]; }
    }
    return migliore;
  }
  // quanto un video (o un riquadro) sembra il video da guardare: grande e in vista, nel lettore del sito o coi comandi,
  // lungo, che sta andando con l'audio. Non lo sono i banner muti in ripetizione, le anteprime che si animano dentro un
  // link (le liste di film), i video brevissimi (spot) e le pubblicita'. Mai sotto i 200 x 150 punti
  var LETTORE_SITO = /player|plyr|jw|vjs|video-js|shaka|bmpui|clappr|mejs|fluid|vds|media-/i;
  // riquadri che non sono mai il video da guardare: commenti, social, mappe, accessi, pannelli dei siti
  var NON_LETTORE = /disqus|comments|commenti|facebook\.com\/plugins|platform\.twitter|instagram\.com|recaptcha|google\.[a-z.]+\/maps|accounts\.google|ogs\.google/i;
  function punteggioPlayer(el) {
    var a = areaVisibile(el);
    if (a <= 200 * 150) return 0;
    // un riquadro alto migliaia di punti (i commenti) non vale piu' di uno schermo; uno fuori dallo schermo vale meno
    var r = el.getBoundingClientRect(), H = window.innerHeight || 1;
    if (r.height > H) a = a / r.height * H;
    if (r.bottom < 0 || r.top > H) a *= 0.5;
    if (el.tagName === 'IFRAME') {
      if (el.__hometvAd || eAd(el.src, 'frame') || NON_LETTORE.test(el.src || '')) return 0;
      if (el.__hometvVideo) a *= 2;                              // il nostro codice la' dentro ci ha visto un video
      else if (el.__hometvPronto && !eLettore(el)) a *= 0.3;      // senza video e senza l'aspetto da lettore
      if (/youtube(-nocookie)?\.com\/embed|player\.vimeo|dailymotion\.com\/embed|player|video|embed/i.test(el.src || '')) a *= 2;
      if (el.hasAttribute('allowfullscreen') || /fullscreen/i.test(el.getAttribute('allow') || '')) a *= 1.5;
      return a;
    }
    var d = el.duration, sfondo = el.loop || (el.muted && el.autoplay && !el.controls);
    if (sfondo) a *= 0.1;                                    // banner e anteprime di sfondo
    if (isFinite(d) && d > 0 && d < 30) a *= 0.2;           // spot e clip brevissime
    if (el.closest && el.closest('a[href]')) a *= 0.2;       // copertina animata di una lista
    if (el.controls || dentroUnLettore(el)) a *= 2;
    if (!el.paused && !el.muted) a *= 4;                     // va con l'audio: e' quello che guardi
    else if (!el.paused && !sfondo) a *= 2;
    if (d === Infinity || (isFinite(d) && d >= 300)) a *= 1.5; // un film, una puntata, una diretta
    return a;
  }
  function dentroUnLettore(v) {
    for (var n = v.parentElement, i = 0; n && i < 7 && n !== document.body; n = n.parentElement, i++) {
      if (LETTORE_SITO.test((typeof n.className === 'string' ? n.className : '') + ' ' + n.id)) return true;
    }
    return false;
  }

  var classati = [];
  function classeFs(el, c) {
    if (el.classList.contains(c)) return;
    el.classList.add(c);
    classati.push([el, c]);
  }
  // i siti fatti con React o Vue riscrivono "className" (per esempio quando il video parte): le classi dello schermo
  // intero si rimettono subito, se no il video torna piccolo con il resto della pagina nascosto
  var guardiaFs = null;
  function rimettiClassiFs() {
    for (var i = 0; i < classati.length; i++) {
      var c = classati[i];
      try { if (c[0].isConnected && !c[0].classList.contains(c[1])) c[0].classList.add(c[1]); } catch (e) {}
    }
    if (!document.documentElement.classList.contains('hometv-fs-on')) document.documentElement.classList.add('hometv-fs-on');
  }
  function guardaClassiFs() {
    if (guardiaFs) { guardiaFs.disconnect(); guardiaFs = null; }
    if (typeof MutationObserver !== 'function') return;
    try {
      guardiaFs = new MutationObserver(function () { if (fsEl) rimettiClassiFs(); });
      for (var i = 0; i < classati.length && i < 400; i++) guardiaFs.observe(classati[i][0], { attributes: true, attributeFilter: ['class'] });
      guardiaFs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
  }
  // il contenitore di un elemento, anche quando l'elemento sta dentro un componente "shadow"
  function contenitoreDi(n) {
    if (n.parentElement) return n.parentElement;
    var r = n.parentNode;
    return r && r.nodeType === 11 && r.host ? r.host : null;
  }
  // dentro un componente gli stili della pagina non arrivano: ci vogliono anche li'
  function stiliNellOmbra(r) {
    if (r.__hometvStile) return;
    try {
      var st = document.createElement('style');
      st.textContent = CSS_FS;
      r.appendChild(st);
      Object.defineProperty(r, '__hometvStile', { value: st, configurable: true });
    } catch (e) {}
  }

  function entraSchermoIntero(el, manuale) {
    if (YT_TV) return false; // YouTube per la TV ha il suo lettore (e i tasti vanno a lui)
    el = el || trovaPlayer();
    if (!el) { toast('Nessun video trovato in questa pagina'); return false; }
    if (fsEl === el) return true;
    esciSchermoIntero(true);
    fsEl = el;
    classeFs(el, 'hometv-fs');
    var nodo = el, livello = 0;
    while (nodo && nodo !== document.body && nodo !== document.documentElement) {
      var radice = nodo.parentNode;
      if (!radice) break;
      if (radice.nodeType === 11) stiliNellOmbra(radice);
      var figli = radice.children || [];
      for (var i = 0; i < figli.length; i++) {
        var f = figli[i];
        if (f === nodo || f.id === 'hometv-toast' || f.id === 'hometv-style' || f.tagName === 'STYLE') continue;
        // i sottotitoli disegnati dal lettore restano visibili, sopra il video
        if (livello < 4 && el.tagName === 'VIDEO' && SOTTOTITOLI.test((typeof f.className === 'string' ? f.className : '') + ' ' + f.id)) {
          classeFs(f, 'hometv-fs-cc');
          continue;
        }
        classeFs(f, 'hometv-fs-hide');
      }
      var padre = contenitoreDi(nodo);
      if (!padre) break;
      if (padre !== document.body && padre !== document.documentElement) classeFs(padre, 'hometv-fs-anc');
      nodo = padre;
      livello++;
    }
    document.documentElement.classList.add('hometv-fs-on');
    guardaClassiFs();
    if (el.tagName === 'VIDEO') attaccaLettore(el);
    // nel riquadro del lettore si entra solo se c'e' anche li' questo codice,
    // che sa riportare il telecomando fuori (tasto Indietro)
    if (el.tagName === 'IFRAME' && el.__hometvPronto) {
      try { el.focus(); el.contentWindow.focus(); } catch (e) {}
    }
    if (IN_FRAME) {
      try { window.parent.postMessage({ hometv: 'playing', manuale: !!manuale, src: srcDi(el) }, '*'); } catch (e) {}
    } else if (el.tagName !== 'VIDEO') {
      toast('Schermo intero. Indietro per uscire', 2500);
    }
    return true;
  }

  function esciSchermoIntero(silenzioso) {
    if (!fsEl) return false;
    if (guardiaFs) { guardiaFs.disconnect(); guardiaFs = null; }
    for (var i = 0; i < classati.length; i++) {
      try { classati[i][0].classList.remove(classati[i][1]); } catch (e) {}
    }
    classati = [];
    var resti = document.querySelectorAll('.hometv-fs, .hometv-fs-anc, .hometv-fs-hide, .hometv-fs-cc');
    for (var j = 0; j < resti.length; j++) resti[j].classList.remove('hometv-fs', 'hometv-fs-anc', 'hometv-fs-hide', 'hometv-fs-cc');
    document.documentElement.classList.remove('hometv-fs-on');
    var prima = fsEl;
    staccaLettore();
    fsEl = null;
    if (!silenzioso) {
      esciDalloSchermoInteroDelSito();
      // uscito a mano: questo video non torna a schermo intero da solo (un video nuovo nello stesso lettore si')
      segnaUscito(prima);
      if (prima.tagName === 'IFRAME' && prima.__hometvPronto) {
        try { prima.contentWindow.postMessage({ hometv: 'chiudiLettore' }, '*'); } catch (e) {}
      }
      if (document.activeElement === prima) try { prima.blur(); } catch (e) {}
      try { window.focus(); } catch (e) {}
      setFocus(prima);
      if (IN_FRAME) {
        try { window.parent.postMessage({ hometv: 'esci' }, '*'); window.parent.focus(); } catch (e) {}
      }
    }
    return true;
  }

  // la sorgente di un video (o, per un riquadro col lettore, quella del video che c'e' dentro)
  function srcDi(el) {
    if (!el) return '';
    return el.tagName === 'VIDEO' ? (el.currentSrc || el.src || '') : (el.__hometvUltimoSrc || el.src || '');
  }
  function segnaUscito(el) { el.__hometvUscito = true; el.__hometvUscitoDa = srcDi(el); el.__hometvUscitoA = Date.now(); }
  // uscito a mano da questo video (Indietro): da solo non torna a schermo intero. Ma ci torna un video nuovo nello stesso
  // lettore (tanti siti usano lo stesso <video> per la puntata dopo o un altro film), e con ancheTasto anche lo stesso
  // video se lo fai ripartire tu (OK o Play premuti dopo l'uscita)
  function uscitoDa(el, ancheTasto) {
    if (!el.__hometvUscito) return false;
    if (srcDi(el) !== el.__hometvUscitoDa || (ancheTasto && ultimoOk > el.__hometvUscitoA)) { el.__hometvUscito = false; return false; }
    return true;
  }

  // Un video parte: schermo intero automatico, ma non per anteprime mute,
  // trailer di sfondo o video piccoli (salvo che tu abbia appena premuto un tasto).
  function suPlaying(ev) {
    var v = ev.target;
    if (!v || v.tagName !== 'VIDEO') return;
    if (fsEl && !fsEl.isConnected) esciSchermoIntero(true); // il sito ha tolto il video di prima
    var appenaPremuto = Date.now() - ultimoOk < 10000;
    // nel browser solo se l'hai fatto partire tu (come un browser normale); YouTube ha il suo lettore per la TV
    if (fsEl || !CFG.schermoInteroAutomatico || uscitoDa(v, true) || (!sitoApp() && !appenaPremuto) || suYoutube()) return;
    if (areaVisibile(v) < 200 * 150) return;
    // le anteprime mute partono anche solo passandoci sopra: serve un OK (o Play) appena
    // premuto, oppure che sia proprio il video della pagina (una puntata, un film)
    if (v.muted && !appenaPremuto && v !== videoZittito && !videoPrincipale(v)) return;
    entraSchermoIntero(v, appenaPremuto);
    if (v.muted && fsEl === v) offriAudio(v);
  }
  document.addEventListener('playing', suPlaying, true);
  // un clic vero (mouse o tocco) vale come un OK appena premuto
  ascoltaSicuro(document, 'click', function (ev) { if (ev.isTrusted) { ultimoOk = Date.now(); premutoAiRiquadri(); } }, true);

  // il video "vero" della pagina, non un'anteprima o uno sfondo: lungo, non in ripetizione, grande
  function videoPrincipale(v) {
    if (v.loop || !(v.duration >= 300)) return false;
    return areaVisibile(v) >= window.innerWidth * window.innerHeight * 0.2;
  }
  // partito senza audio (lo ha deciso il sito, per esempio per partire da solo): l'audio si rida' subito, come sul TV,
  // dove i video possono sempre avere l'audio. Se il browser non lo lascia fare (ferma il video), si torna muti e il
  // primo tasto lo riattiva
  var SENZA_AUDIO = "Il video e' partito senza audio: premi OK per sentirlo";
  function offriAudio(v) {
    videoZittito = v;
    if (v.__hometvAudioProvato) { avvisaSenzaAudio(v); return; }
    v.__hometvAudioProvato = true;
    var andava = !v.paused;
    try { v.muted = false; if (!(v.volume > 0)) v.volume = 1; } catch (e) {}
    setTimeout(function () {
      if (!v.muted && !(andava && v.paused)) { if (videoZittito === v) videoZittito = null; return; }
      try { v.muted = true; } catch (e) {}
      if (andava && v.paused) { try { var p = (origPlay || v.play).call(v); if (p && p['catch']) p['catch'](function () {}); } catch (e) {} }
      avvisaSenzaAudio(v);
    }, 400);
  }
  function avvisaSenzaAudio(v) {
    videoZittito = v;
    if (lettoreVideo === v) avvisoLettore(SENZA_AUDIO, 10000); else toast(SENZA_AUDIO, 10000);
  }

  // Ogni tanto: un video che va gia' (partito prima che arrivassimo, o mentre arrivavano le
  // impostazioni) va comunque a schermo intero; e se il sito mette la puntata nuova in un
  // video nuovo, a schermo intero va quello nuovo.
  function controllaVideo() {
    if (document.hidden || paginaDiCasa()) return;
    if (fsEl && !fsEl.isConnected) esciSchermoIntero(true);
    if (fsEl) rimettiClassiFs(); // anche senza MutationObserver
    var v = videoAttivo();
    if (!v || v === fsEl || v.paused || v.ended || v.readyState < 3 || uscitoDa(v, false) || areaVisibile(v) < 200 * 150) return;
    var appena = Date.now() - ultimoOk < 10000;
    if (fsEl) {
      if (fsEl.tagName !== 'VIDEO' || !(fsEl.paused || fsEl.ended)) return;
      esciSchermoIntero(true);
    } else if (!CFG.schermoInteroAutomatico || (!sitoApp() && !appena) || suYoutube() ||
      (v.muted && !appena && v !== videoZittito && !videoPrincipale(v))) return;
    entraSchermoIntero(v, appena);
    if (v.muted && fsEl === v && v !== videoZittito) offriAudio(v);
  }
  ascoltaSicuro(window, 'resize', function () { if (lettoreVideo) applicaFormato(lettoreVideo); });

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object' || !d.hometv) return;
    var frame = null;
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      try { if (frames[i].contentWindow === ev.source) { frame = frames[i]; break; } } catch (e) {}
    }
    // comandi per questa pagina: solo dal riquadro del lettore in uso (a schermo intero, scelto, sotto il puntatore,
    // o appena fatto partire da noi), non da un riquadro qualsiasi (una pubblicita')
    var usato = null, dalLettore = false;
    if (/^(serie\?|vaiEpisodio|home|pannello|esci|playing|statoVideo|cerca)$/.test(d.hometv)) {
      usato = frame || riquadroDi(ev.source);
      dalLettore = !!usato && (usato === fsEl || usato === document.activeElement || usato === pt.riquadro || usato === corrente ||
        Date.now() < avviaProssimoFinoA);
    }
    if (d.hometv === 'pronto' && frame) {
      // nel riquadro c'e' questo codice: gli si passano le impostazioni della pagina
      frame.__hometvPronto = true;
      inviaImpostazioni(frame);
      // puntata nuova appena aperta con il lettore in un riquadro: si fa partire
      if (Date.now() < avviaProssimoFinoA) try { frame.contentWindow.postMessage({ hometv: 'avvia' }, '*'); } catch (e) {}
    } else if (d.hometv === 'serie?' && !IN_FRAME && ev.source && (dalLettore || (usato && areaVisibile(usato) >= window.innerWidth * window.innerHeight * 0.25))) {
      // il lettore in un riquadro chiede se qui ci sono la puntata dopo e quella prima
      try {
        var succ = trovaEpisodio(1);
        // quello che si guarda, anche per Continua a guardare del lettore di quel riquadro (videoDelRiquadro)
        paginaRiquadro = raccogliPagina(succ || null);
        if (usato) usato.__hometvSerie = true;
        ev.source.postMessage({ hometv: 'serie', succ: !!succ, prec: !!trovaEpisodio(-1), titolo: titoloVideo(), pagina: paginaRiquadro }, '*');
      } catch (e) {}
    } else if (d.hometv === 'statoVideo' && !IN_FRAME && usato && usato.__hometvSerie && d.stato && typeof d.stato === 'object') {
      videoDelRiquadro(d.stato, d.tienimi === true);
    } else if (d.hometv === 'cerca' && !IN_FRAME && usato && usato.__hometvSerie && ev.source) {
      cercaPerRiquadro(d, ev.source);
    } else if (d.hometv === 'cercato' && IN_FRAME && ev.source === window.top) {
      // la risposta del servizio, chiesta dalla pagina di sopra per il lettore di qui
      if (cercaSopra && d.n === cercaSopra.n && d.j && typeof d.j === 'object') usaVisto(cercaSopra.v, d.j);
    } else if (d.hometv === 'serie' && IN_FRAME && ev.source === window.top) {
      serieSito.sopra = true; // la pagina di sopra ha Home TV: Continua a guardare e la barra del telefono passano da lei
      serieSito.succ = !!d.succ;
      serieSito.prec = !!d.prec;
      serieSito.titolo = typeof d.titolo === 'string' ? d.titolo.slice(0, 200) : '';
      serieSito.pagina = d.pagina && typeof d.pagina === 'object' && typeof d.pagina.url === 'string' ? d.pagina : null;
      if (!serie.succ || serie.succ.dalSito) serie.succ = serieSito.succ ? DAL_SITO_SUCC : null;
      if (!serie.prec || serie.prec.dalSito) serie.prec = serieSito.prec ? DAL_SITO_PREC : null;
      if (lettore && lettoreVideo) {
        if (serieSito.titolo) pezzo('hl-titolo').textContent = serieSito.titolo;
        disegnaChips();
        diciVideo();
      }
    } else if (d.hometv === 'vaiEpisodio' && !IN_FRAME && dalLettore) {
      vaiEpisodio(trovaEpisodio(d.dir < 0 ? -1 : 1), d.dir < 0 ? -1 : 1);
    } else if (d.hometv === 'azione' && IN_FRAME && ev.source === window.parent && typeof d.azione === 'string' && AL_LETTORE[d.azione] === 1) {
      // un tasto arrivato alla pagina che contiene questo lettore (per esempio dal telefono)
      if (!fsEl && !d.dentro && d.azione !== 'indietro' && d.azione !== 'stop') {
        var vv = videoAttivo();
        if (vv && areaVisibile(vv) >= 200 * 150) entraSchermoIntero(vv, true);
      }
      eseguiAzione(d.azione, !!d.telefono);
    } else if (d.hometv === 'puntatore' && IN_FRAME && ev.source === window.parent) {
      puntatoreDaFuori(d);
    } else if (d.hometv === 'scorriFuori' && frame && frame.__hometvPronto) {
      // il riquadro sotto il puntatore non scorre piu' (nelle sue coordinate: qui si ingrandiscono come lui)
      var sk = frame.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth : 1;
      var sdx = Number(d.dx) * (sk || 1), sdy = Number(d.dy) * (sk || 1);
      if (isFinite(sdx) && isFinite(sdy)) scorriDaRiquadro(frame, Math.max(-5000, Math.min(5000, sdx)), Math.max(-5000, Math.min(5000, sdy)));
    } else if (d.hometv === 'campoRiquadro' && frame) {
      // nel riquadro si scrive (o non piu'): il testo del telefono va a lui
      frame.__hometvCampo = !!d.si;
      if (IN_FRAME) { try { window.parent.postMessage({ hometv: 'campoRiquadro', si: !!d.si }, '*'); } catch (e) {} }
    } else if (d.hometv === 'testo' && IN_FRAME && ev.source === window.parent && typeof d.testo === 'string') {
      scriviTesto(d.testo.slice(0, 500), d.invio !== false);
    } else if (d.hometv === 'manoPuntatore' && frame) {
      // il riquadro dice se sotto il puntatore c'e' qualcosa da cliccare
      if (IN_FRAME) { try { window.parent.postMessage({ hometv: 'manoPuntatore', si: !!d.si }, '*'); } catch (e) {} }
      else impostaMano(!!d.si);
    } else if (d.hometv === 'video' && IN_FRAME && ev.source === window.parent) {
      // dalla sezione Video del telefono, per il lettore che sta qui dentro
      comandoVideo(d);
    } else if (d.hometv === 'chiudiLettore' && IN_FRAME && ev.source === window.parent) {
      // la pagina che contiene il lettore e' uscita dallo schermo intero: il video si ferma, il lettore si chiude
      if (fsEl) {
        var vf = lettoreVideo;
        if (vf) { try { vf.pause(); } catch (e) {} segnaUscito(vf); }
        esciSchermoIntero(true);
      }
    } else if (d.hometv === 'avvia' && IN_FRAME && ev.source === window.parent) {
      avviaDopoProssimo(true);
    } else if (d.hometv === 'cfg' && IN_FRAME && ev.source === window.parent) {
      if (d.bloccoSpento) bloccoSpentoDallaPagina = true;
      if (typeof d.ok === 'number' && d.ok >= 0 && d.ok < 10000) ultimoOk = Math.max(ultimoOk, Date.now() - d.ok);
      if (d.cfg && typeof d.cfg === 'object') { dalTV = d.cfg; daGithub = null; }
      dopoImpostazioni();
      // e si passano ai riquadri dentro questo riquadro
      var figli = document.querySelectorAll('iframe');
      for (var j = 0; j < figli.length; j++) if (figli[j].__hometvPronto) inviaImpostazioni(figli[j]);
    } else if (d.hometv === 'entra' && IN_FRAME && ev.source === window.parent) {
      entrataDaFuori(d.dir, Number(d.x), Number(d.y));
    } else if (d.hometv === 'bordo' && frame && (frame === corrente || frame === document.activeElement) && !fsEl &&
      /^(su|giu|sx|dx)$/.test(d.dir)) {
      // usciti dal bordo di un riquadro: si continua da qui nella stessa direzione (se non c'e' niente, resta scelto lui)
      try { if (document.activeElement === frame) frame.blur(); } catch (e) {}
      try { window.focus(); } catch (e) {}
      setFocus(frame, true);
      ultimoMovimento = 0;
      muovi(d.dir);
    } else if (d.hometv === 'premuto' && IN_FRAME && ev.source === window.parent) {
      ultimoOk = chiestoPlayA = Date.now();
      premutoAiRiquadri();
    } else if (d.hometv === 'truffa' && frame && bloccoAttivo) {
      // un riquadro che e' tutto un pannello truffa, messo sopra la pagina: via il riquadro (mai un lettore)
      if (!frame.__hometvVideo && !eLettore(frame) && !intoccabile(frame) && inPrimoPiano(frame)) {
        frame.__hometvTruffa = true;
        togliPannello(frame, 'truffa');
      }
    } else if (d.hometv === 'video' && frame) {
      frame.__hometvVideo = true;
    } else if (d.hometv === 'playing' && frame) {
      frame.__hometvVideo = true;
      frame.__hometvUltimoSrc = typeof d.src === 'string' ? d.src.slice(0, 2000) : '';
      if (fsEl === frame) return;
      if (d.manuale && !dalLettore) d.manuale = false; // "l'ho fatto partire io" vale solo per il lettore in uso
      if (!d.manuale) {
        if (fsEl || !CFG.schermoInteroAutomatico || (!sitoApp() && Date.now() - ultimoOk >= 10000) || frame.__hometvAd ||
          uscitoDa(frame, false) || eAd(frame.src, 'frame')) return;
        if (areaVisibile(frame) < window.innerWidth * window.innerHeight * 0.25) return;
      }
      entraSchermoIntero(frame, d.manuale);
    } else if (d.hometv === 'esci' && dalLettore) {
      // il telecomando torna a questa pagina
      if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
        try { document.activeElement.blur(); } catch (e) {}
      }
      try { window.focus(); } catch (e) {}
      esciSchermoIntero();
      // usciti da un riquadro in cui si era entrati: la selezione torna su di lui
      if (frame && frame === corrente && frame.isConnected && siVede(frame) && !fsEl) setFocus(frame, true);
    } else if (d.hometv === 'home' && !IN_FRAME && dalLettore) {
      vaiHome();
    } else if (d.hometv === 'pannello' && !IN_FRAME && dalLettore) {
      if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
        try { document.activeElement.blur(); } catch (e) {}
      }
      try { window.focus(); } catch (e) {}
      apriPannello();
    } else if (d.hometv === 'playpause' && IN_FRAME && ev.source === window.parent) {
      playPausa();
    } else if (d.hometv === 'salta' && IN_FRAME && ev.source === window.parent && isFinite(Number(d.secondi))) {
      salta(Math.max(-3600, Math.min(3600, Number(d.secondi))));
    }
  });
  // il riquadro di questa pagina da cui arriva un messaggio (anche da un riquadro dentro un riquadro)
  function riquadroDi(w) {
    var fr = document.querySelectorAll('iframe'), k, i;
    for (k = 0; w && k < 6; k++) {
      for (i = 0; i < fr.length; i++) { try { if (fr[i].contentWindow === w) return fr[i]; } catch (e) {} }
      try { if (!w.parent || w.parent === w) return null; w = w.parent; } catch (e) { return null; }
    }
    return null;
  }

  function videoAttivo() {
    var vs = tuttiIVideo();
    var best = null, area = 0;
    for (var i = 0; i < vs.length; i++) {
      var a = areaVisibile(vs[i]);
      if (!vs[i].paused) a *= 4;
      if (a > area) { area = a; best = vs[i]; }
    }
    return best;
  }

  function iframeLettore() {
    if (fsEl && fsEl.tagName === 'IFRAME') return fsEl;
    var p = trovaPlayer();
    return p && p.tagName === 'IFRAME' ? p : null;
  }

  // solo = 'play' (fa solo partire) o 'pausa' (solo fermare, anche i tentativi di partire): i tasti veri del
  // telecomando; senza, alterna (Play/pausa)
  function playPausa(solo) {
    var v = videoAttivo();
    if (v) {
      if (solo === 'play' || (solo !== 'pausa' && fermo(v))) { if (fermo(v)) partiDavvero(v); }
      else { fermaAvvio(); if (!v.paused) v.pause(); }
      return;
    }
    var f = iframeLettore();
    if (f) try { f.contentWindow.postMessage({ hometv: 'playpause' }, '*'); } catch (e) {}
  }

  function salta(secondi) {
    var v = videoAttivo();
    if (v && isFinite(v.duration)) {
      v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + secondi));
      toast((secondi > 0 ? '+' : '') + secondi + ' s', 1200);
      return;
    }
    var f = iframeLettore();
    if (f) try { f.contentWindow.postMessage({ hometv: 'salta', secondi: secondi }, '*'); } catch (e) {}
  }

  /* ================================================================ lettore TV
   * Il video resta quello del sito (cosi' funzionano qualita', sottotitoli e
   * tutto il resto), ma a schermo intero i comandi sono questi: grandi, da
   * divano, come nelle app dei TV. OK pausa, sinistra/destra 10 s (tenendo
   * premuto si scorre, il salto avviene quando lasci), giu' sottotitoli,
   * Indietro mette in pausa ed esce. Riprende da dove eri rimasto.
   */

  var lettore = null, lettoreVideo = null, lettoreTimer = null, lettoreAscolti = [];
  var scorrimento = { attivo: false, meta: 0, timer: null };
  var riprendiFinoA = 0, ultimoSalvataggio = 0, centroTimer = null, ultimoOk = 0;
  var passiNelSito = 0, ultimoIndietroRadice = 0;
  var ICONE = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
    pausa: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
    avanti: '<svg viewBox="0 0 24 24"><path d="M4 5l9 7-9 7zm9 0l9 7-9 7z"/></svg>',
    indietro: '<svg viewBox="0 0 24 24"><path d="M20 5v14l-9-7zm-9 0v14l-9-7z"/></svg>',
    spunta: '<svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>',
    prec: '<svg viewBox="0 0 24 24"><path d="M6 5h2.4v14H6zM20 5v14L9.6 12z"/></svg>',
    succ: '<svg viewBox="0 0 24 24"><path d="M15.6 5H18v14h-2.4zM4 5l10.4 7L4 19z"/></svg>',
    ricomincia: '<svg viewBox="0 0 24 24"><path d="M12 5V1.5L7 6l5 4.5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>'
  };
  var SVG_GIRO = '<svg viewBox="0 0 40 40"><defs><linearGradient id="hometv-colori-l" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#19d3b7"/><stop offset=".55" stop-color="#3b82f6"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>' +
    '<circle class="hl-fondo" cx="20" cy="20" r="17"/><circle class="hl-avanza" cx="20" cy="20" r="17" stroke-dasharray="106.8" stroke-dashoffset="106.8"/></svg>';

  // prima pagina del sito (arrivati dalla home o dal browser): Indietro va premuto due volte
  function allaPrimaPagina() {
    if (IN_FRAME || passiNelSito > 0) return false;
    var da = hostOf(document.referrer);
    return !document.referrer || (!!LAUNCHER_HOST && da === LAUNCHER_HOST) || (da !== HOST && history.length <= 2);
  }

  function formato(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }

  function titoloVideo() {
    var og = document.querySelector('meta[property="og:title"]');
    var t = og && og.getAttribute('content');
    if (!t) { var h = document.querySelector('h1'); t = h && h.textContent; }
    if (!t) t = document.title || '';
    return String(t).split(/\s+[|\-\u2013\u2014]\s+/)[0].replace(/^\s+|\s+$/g, '');
  }

  function costruisciLettore() {
    if (!lettore) {
      lettore = document.createElement('div');
      lettore.id = 'hometv-lettore';
      scriviHtml(lettore, '<div class="hl-su"></div><div class="hl-giu"></div><div class="hl-titolo"></div><div class="hl-aiuto"></div>' +
        '<div class="hl-centro"></div><div class="hl-avviso"></div><div class="hl-lingue"></div>' +
        '<div class="hl-barra"><div class="hl-car"></div><div class="hl-fatto"></div></div><div class="hl-testa"></div>' +
        '<div class="hl-ora"></div><div class="hl-resta"></div>' +
        '<div class="hl-azioni"><div class="hl-chip hl-prec"></div><div class="hl-chip hl-inizio"></div><div class="hl-chip hl-succ"></div></div>' +
        '<div class="hl-prossimo"><div class="hl-giro">' + SVG_GIRO + '<b></b></div>' +
        '<div><strong>Prossimo episodio</strong><span></span><em>OK guarda subito &middot; Indietro annulla</em></div></div>');
    }
    var dove = contenitore();
    if (dove && lettore.parentNode !== dove) dove.appendChild(lettore);
    return lettore;
  }

  // Dove mettere lettore e avvisi: nella pagina, oppure dentro l'elemento che il sito
  // ha messo a schermo intero da solo (fuori da li' non si vedrebbe niente).
  function schermoInteroDelSito() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function contenitore() {
    var fs = schermoInteroDelSito();
    if (fs && fs !== document.documentElement && !/^(VIDEO|IFRAME|IMG|CANVAS)$/.test(fs.tagName)) return fs;
    return document.body;
  }
  function esciDalloSchermoInteroDelSito() {
    if (!schermoInteroDelSito()) return;
    try { if (document.exitFullscreen) document.exitFullscreen()['catch'](function () {}); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) {}
  }
  // Il sito va a schermo intero da solo (il suo pulsante, o appena parte il video):
  // il lettore TV e i pulsanti delle puntate ci vanno dentro. Se a schermo intero
  // c'e' proprio il <video> (sopra non si puo' disegnare), si passa al nostro
  // schermo intero, che sul TV e' identico.
  function suSchermoInteroDelSito() {
    var fs = schermoInteroDelSito();
    if (fs && fs.tagName === 'VIDEO') {
      esciDalloSchermoInteroDelSito();
      if (fsEl !== fs) entraSchermoIntero(fs, true);
      return;
    }
    if (fs && !fsEl && fs.querySelector) {
      var v = fs.querySelector('video');
      if (v && areaVisibile(v) >= 200 * 150) entraSchermoIntero(v, true);
    }
    if (lettore && lettoreVideo) { costruisciLettore(); mostraLettore(); }
    if (toastEl && toastEl.parentNode && contenitore() && toastEl.parentNode !== contenitore()) contenitore().appendChild(toastEl);
    if (pannello && pannello.parentNode && contenitore() && pannello.parentNode !== contenitore()) contenitore().appendChild(pannello);
  }
  document.addEventListener('fullscreenchange', suSchermoInteroDelSito, true);
  document.addEventListener('webkitfullscreenchange', suSchermoInteroDelSito, true);
  function pezzo(c) { return lettore.querySelector('.' + c); }

  function mostraLettore() {
    if (!lettoreVideo) return;
    costruisciLettore();
    aggiornaLettore();
    aggiornaSerie();
    disegnaChips();
    lettore.className = 'hometv-on';
    clearTimeout(lettoreTimer);
    // si nasconde da solo mentre il video va (in pausa resta)
    lettoreTimer = setTimeout(function nascondi() {
      // "Eri a ...: OK per riprendere" resta in vista finche' vale (OK la accetta: deve vedersi)
      if (propostaAttiva()) { lettoreTimer = setTimeout(nascondi, propostaRipresa.fino - Date.now() + 50); return; }
      if (lettoreVideo && !lettoreVideo.paused && !pannelloLingue && !scorrimento.attivo && serie.fuoco === 'video' && serie.conto === 0 && lettore) lettore.className = '';
    }, 3500);
  }

  function aggiornaLettore() {
    var v = lettoreVideo;
    if (!v || !lettore) return;
    var d = v.duration, t = scorrimento.attivo ? scorrimento.meta : v.currentTime;
    var parte = isFinite(d) && d > 0 ? Math.max(0, Math.min(1, t / d)) : 0;
    var car = 0;
    try { if (v.buffered.length && isFinite(d) && d > 0) car = Math.min(1, v.buffered.end(v.buffered.length - 1) / d); } catch (e) {}
    pezzo('hl-fatto').style.transform = 'scaleX(' + parte + ')';
    pezzo('hl-car').style.transform = 'scaleX(' + car + ')';
    pezzo('hl-testa').style.transform = 'translateX(' + (parte * 90).toFixed(3) + 'vw)'; // la barra va da 5vw a 95vw
    pezzo('hl-ora').textContent = formato(t);
    pezzo('hl-resta').textContent = isFinite(d) && d > 0 ? '-' + formato(d - t) : '';
  }

  function centro(icona, testo) {
    if (!lettore) return;
    var c = pezzo('hl-centro');
    scriviHtml(c, ICONE[icona] + (testo ? '<b>' + testo + '</b>' : ''));
    c.className = 'hl-centro hometv-on';
    clearTimeout(centroTimer);
    centroTimer = setTimeout(function () { if (lettore) pezzo('hl-centro').className = 'hl-centro'; }, 700);
  }

  function avvisoLettore(testo, ms) {
    costruisciLettore();
    var a = pezzo('hl-avviso');
    a.textContent = testo;
    a.style.display = testo ? 'block' : 'none';
    if (testo) setTimeout(function () { if (lettore && a.textContent === testo) a.style.display = 'none'; }, ms || 4000);
  }

  // --- riprendi da dove eri rimasto (memoria di questo sito, sul TV)
  function chiavePosizione(v) {
    var src = v.currentSrc || v.src || '';
    if (/^(blob|data):/i.test(src)) src = '';
    return location.pathname + location.search + '|' + src.split('?')[0];
  }
  function leggiPosizioni() {
    try { var p = JSON.parse(localStorage.getItem('hometv-posizioni') || '{}'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
  }
  function salvaPosizione(v) {
    if (!v || !isFinite(v.duration) || v.duration < 120) return; // clip brevi: niente
    var p = leggiPosizioni(), k = chiavePosizione(v), t = v.currentTime;
    if (t < 30 || t > v.duration - 60) delete p[k];
    else p[k] = { t: Math.floor(t), at: Date.now() };
    var chiavi = Object.keys(p);
    if (chiavi.length > 150) {
      chiavi.sort(function (a, b) { return p[a].at - p[b].at; });
      for (var i = 0; i < chiavi.length - 150; i++) delete p[chiavi[i]];
    }
    try { localStorage.setItem('hometv-posizioni', JSON.stringify(p)); } catch (e) {}
  }
  function riprendi(v) {
    function prova() {
      if (v !== lettoreVideo || v.currentTime > 5) return; // il sito riprende gia' da se'
      var r = leggiPosizioni()[chiavePosizione(v)];
      if (!r || !isFinite(v.duration) || r.t > v.duration - 60) return;
      try { v.currentTime = r.t; } catch (e) { return; }
      riprendiFinoA = Date.now() + 8000;
      avvisoLettore('Ripreso da ' + formato(r.t) + '  \u00b7  Gi\u00f9 per ricominciare dall\'inizio', 8000);
    }
    if (v.readyState >= 1) prova();
    else ascolta(v, 'loadedmetadata', prova);
  }

  function ascolta(el, tipo, fn) {
    ascoltaSicuro(el, tipo, fn);
    lettoreAscolti.push([el, tipo, fn]);
  }

  /* ---------------------------------------------------------------- continua a guardare
   * Il TV ricorda cosa guardi (vedi il servizio): con il video nel lettore la pagina gli dice anche cos'e'
   * (titoli, dati strutturati del sito, indirizzo, immagine, la puntata dopo). Quando parte un video gli
   * chiede se c'eri gia': stesso video -> riprende da solo; la stessa cosa su un'altra pagina (su un altro sito solo
   * con "Riprendi anche su un altro sito", lo decide il servizio) -> lo propone ("Eri a 22:15 su ...: OK per
   * riprendere"); aperto da "Continua a guardare" -> riprende da solo.
   */
  var ldVisto = null, ldVistoChiave = '', propostaRipresa = null, continuaAvviato = false;
  // quale video e' (per non confondere due video della stessa pagina): la sorgente senza le domande
  function videoDi(v) {
    var src = v ? v.currentSrc || v.src || '' : '';
    return /^https?:/i.test(src) ? src.split('?')[0].slice(0, 500) : '';
  }
  function metaDi(sel) {
    var m = document.querySelector(sel);
    return m ? String(m.getAttribute('content') || '').replace(/^\s+|\s+$/g, '').slice(0, 400) : '';
  }
  // i dati che molti siti mettono per i motori di ricerca (schema.org): puntata, stagione, serie, film
  function datiStrutturati() {
    var l = document.querySelectorAll('script[type="application/ld+json"]'), i, chiave = location.href + '|' + l.length;
    if (ldVisto && ldVistoChiave === chiave) return ldVisto;
    var out = {};
    function guarda(o, prof) {
      if (!o || typeof o !== 'object' || prof > 5) return;
      if (Array.isArray(o)) { for (var k = 0; k < o.length && k < 30; k++) guarda(o[k], prof + 1); return; }
      if (o['@graph']) guarda(o['@graph'], prof + 1);
      var t = [].concat(o['@type'] || []).join(' ');
      if (/\b(TVEpisode|Episode)\b/.test(t) && !out.episodio) {
        out.episodio = parseInt(o.episodeNumber, 10) || 0;
        var stag = o.partOfSeason, ser = o.partOfSeries || (stag && stag.partOfSeries);
        out.stagione = stag ? parseInt(stag.seasonNumber, 10) || 0 : 0;
        if (ser && typeof ser.name === 'string') out.serie = ser.name.slice(0, 200);
      } else if (/\bMovie\b/.test(t) && !out.nome) {
        if (typeof o.name === 'string') out.nome = o.name.slice(0, 200);
        var d = String(o.datePublished || o.dateCreated || '');
        if (/^(19|20)\d\d/.test(d)) out.anno = parseInt(d.slice(0, 4), 10);
      }
      var img = o.thumbnailUrl || o.image;
      if (!out.immagine && img) {
        if (Array.isArray(img)) img = img[0];
        if (img && typeof img === 'object') img = img.url || img.contentUrl;
        if (typeof img === 'string' && /^https?:/i.test(img)) out.immagine = img.slice(0, 800);
      }
    }
    for (i = 0; i < l.length && i < 8; i++) {
      var testoLd = l[i].textContent || '';
      if (testoLd.length > 300000) continue;
      try { guarda(JSON.parse(testoLd), 0); } catch (e) {}
    }
    ldVisto = out;
    ldVistoChiave = chiave;
    return out;
  }
  // Stagione e puntata quando il sito non le scrive nei titoli ne' nell'indirizzo: dove altro le mostra. I dati del video
  // per il sistema (Media Session), le scritte del lettore attorno al video ("S1:E3 Il ritorno"), la puntata segnata
  // nell'elenco con la stagione scelta, il titolo del riquadro del video (spesso il nome del file, "Serie.S01E03").
  // Solo testi corti, rifatti al massimo ogni 15 secondi per pagina e video (il lettore li chiede spesso)
  var RE_PUNTATA_SCRITTA = /\bs\d{1,2}\s{0,3}[ .:\-_\u00b7\u2022]?\s{0,3}e(?:p\.?)?\s{0,3}\d{1,4}\b|\b(?:episodi[oa]|episode|puntata|ep\.?)\s*n?\.?\s*\d{1,4}\b/i;
  // la stessa cosa nei testi attaccati di un elenco ("S1:E2Il ritorno"): per riconoscere le voci delle puntate
  var RE_PUNTATA_IN_ELENCO = /s\d{1,2}\s{0,3}[ .:\-_\u00b7\u2022]?\s{0,3}e(?:p\.?)?\s{0,3}\d|(?:episodi[oa]|episode|puntata)\s*n?\.?\s*\d|\bep\.?\s*\d/i;
  var NON_QUESTA = /prossim|successiv|seguente|precedente|\bnext\b|\bprev/i;
  var RE_STAGIONE_SCELTA = /^(?:stagione|season|stag\.?)\s*0*(\d{1,2})(?!\d)/i;
  var altroVisto = null, altroVistoChiave = '', altroVistoQuando = 0;
  function sessioneMedia() {
    var m = navigator.mediaSession && navigator.mediaSession.metadata;
    var t = m ? [m.title, m.artist, m.album].filter(function (x) { return typeof x === 'string' && !!x; }).join(' - ') : '';
    return RE_PUNTATA_SCRITTA.test(t) && !NON_QUESTA.test(t) ? t : '';
  }
  // il testo coi pezzi separati da uno spazio ("3" e "Il ritorno" non diventano "3Il ritorno"), senza far ridisegnare la
  // pagina al TV (innerText lo farebbe)
  function testoLetto(el) {
    if (typeof document.createTreeWalker !== 'function') return testoBreve(el).slice(0, 200);
    var out = [], w = document.createTreeWalker(el, 4, null, false), n, k = 0, lung = 0, t;
    while ((n = w.nextNode()) && k++ < 60 && lung < 200) {
      t = String(n.nodeValue || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (t) { out.push(t); lung += t.length + 1; }
    }
    return out.join(' ').slice(0, 200);
  }
  // dentro un elenco di puntate? (almeno tre voci corte vicine, dello stesso tipo, che dicono una puntata: il titolo del
  // lettore con accanto "Prossimo episodio" sono due)
  function nellElencoPuntate(el) {
    for (var n = el, i = 0; n && n.parentElement && n !== document.body && i < 6; n = n.parentElement, i++) {
      var simili = 0, conta = 0;
      for (var c = n.parentElement.firstElementChild; c && simili < 3 && conta < 40; c = c.nextElementSibling, conta++) {
        var t = c.tagName === n.tagName ? String(c.textContent || '') : '';
        if (t && t.length <= 300 && RE_PUNTATA_IN_ELENCO.test(t) && !altraPuntata(c)) simili++;
      }
      if (simili >= 3) return true;
    }
    return false;
  }
  // "Prossimo episodio", "Episodio precedente": nel testo corto o nel nome della classe
  function altraPuntata(n) {
    var t = String(n.textContent || '');
    return (t.length <= 80 && NON_QUESTA.test(t)) ||
      /next|prossim|success|seguent|prev(?!iew)|preced/i.test((typeof n.className === 'string' ? n.className : '') + ' ' + (n.id || ''));
  }
  // fa parte di una di quelle? (lei o un contenitore vicino)
  function versoAltra(el) {
    for (var n = el, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) if (altraPuntata(n)) return true;
    return false;
  }
  // le scritte del lettore del sito attorno al video: la prima che dice la puntata (non "Prossimo episodio", non una
  // voce di un elenco di puntate)
  function scritteDelLettore(v) {
    if (!v || !v.parentElement || typeof document.createTreeWalker !== 'function') return '';
    var su = v.parentElement, i, n, t, el, conta = 0;
    for (i = 0; i < 6 && su.parentElement && su.parentElement !== document.body && su.parentElement !== document.documentElement; i++) {
      if (String(su.parentElement.textContent || '').length > 2000) break;
      su = su.parentElement;
    }
    var w = document.createTreeWalker(su, 4, null, false); // 4: solo i testi
    while ((n = w.nextNode()) && conta++ < 400) {
      t = String(n.nodeValue || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (t.length < 2 || t.length > 140 || !RE_PUNTATA_SCRITTA.test(t) || NON_QUESTA.test(t)) continue;
      el = n.parentElement;
      if (!el || (el.closest && el.closest('[id^="hometv-"]')) || versoAltra(el) || nellElencoPuntate(el)) continue;
      return t;
    }
    return '';
  }
  // la stagione scelta nel sito: la voce scelta di un menu, la linguetta segnata o il solo pulsante "Stagione 2" visibile
  function stagioneScelta() {
    var i, t, m, el, cur, quante = 0, trovata = '';
    var sel = document.querySelectorAll('select');
    for (i = 0; i < sel.length && i < 20; i++) {
      var o = sel[i].selectedIndex >= 0 && sel[i].options ? sel[i].options[sel[i].selectedIndex] : null;
      if (o && (m = RE_STAGIONE_SCELTA.exec(testoBreve(o)))) return 'Stagione ' + m[1];
    }
    var c = document.querySelectorAll('[aria-selected="true"], [aria-current], [aria-pressed="true"], [class*="active"], [class*="selected"], [class*="current"], [class*="attiv"]');
    for (i = 0; i < c.length && i < 300; i++) {
      el = c[i];
      cur = el.getAttribute('aria-current');
      if (cur === 'false' || (el.id && el.id.indexOf('hometv-') === 0)) continue;
      if (el.getAttribute('aria-selected') !== 'true' && el.getAttribute('aria-pressed') !== 'true' && cur === null &&
        !CORRENTE.test(typeof el.className === 'string' ? el.className : '')) continue;
      t = testoBreve(el);
      if (t.length <= 30 && (m = RE_STAGIONE_SCELTA.exec(t))) return 'Stagione ' + m[1];
    }
    var b = document.querySelectorAll('button, [role="button"], [role="combobox"], [aria-haspopup], summary');
    for (i = 0; i < b.length && i < 300; i++) {
      t = testoBreve(b[i]);
      if (t.length <= 30 && (m = RE_STAGIONE_SCELTA.exec(t)) && episodioVisibile(b[i])) { quante++; trovata = 'Stagione ' + m[1]; }
    }
    return quante === 1 ? trovata : '';
  }
  // il primo pezzo di testo di un elemento ("3" in <span>3</span><span>La casa</span>)
  function primoTesto(el) {
    if (typeof document.createTreeWalker !== 'function') return '';
    var w = document.createTreeWalker(el, 4, null, false), n, k = 0, t;
    while ((n = w.nextNode()) && k++ < 20) if ((t = String(n.nodeValue || '').replace(/^\s+|\s+$/g, ''))) return t;
    return '';
  }
  // il numero davanti a una voce: "E3 La casa", "3. La casa", "3 - La casa"; o un primo pezzo che e' solo il numero
  var RE_NUMERO_VOCE = /^(?:e(?:p\.?)?\s*0*(\d{1,3})\b|0*(\d{1,3})\s*[.:)\-\u2013])/i;
  var RE_SOLO_NUMERO = /^(?:e(?:p\.?)?)?\s*0*(\d{1,3})\s*[.:)\-\u2013]?$/i;
  // la puntata segnata nell'elenco del sito ("Episodio 3", "3. Il ritorno", "E3"), con la stagione scelta davanti
  function puntataSegnata() {
    var voce = puntataInCorso();
    if (!voce) return '';
    var t = testoLetto(voce), m, ep = '';
    if (RE_PUNTATA_SCRITTA.test(t)) ep = t.slice(0, 120);
    else if ((m = RE_NUMERO_VOCE.exec(t) || RE_SOLO_NUMERO.exec(primoTesto(voce)))) ep = 'Episodio ' + (m[1] || m[2]);
    if (!ep || NON_QUESTA.test(ep)) return '';
    if (/\bs\d{1,2}\s{0,3}[ .:\-_\u00b7\u2022]?\s{0,3}e|stagion|season/i.test(ep)) return ep;
    var st = stagioneScelta();
    return st ? st + ' ' + ep : ep;
  }
  function altroDiQui() {
    var chiave = location.href + '|' + videoDi(lettoreVideo);
    if (altroVisto && altroVistoChiave === chiave && Date.now() - altroVistoQuando < 15000) return altroVisto;
    function prova(fn) { try { return fn() || ''; } catch (e) { return ''; } }
    var out = [prova(sessioneMedia), prova(function () { return scritteDelLettore(lettoreVideo); }), prova(puntataSegnata),
      IN_FRAME ? [document.title, metaDi('meta[property="og:title"]')].filter(function (x) { return !!x; }).join(' - ') : ''];
    altroVisto = out.filter(function (x) { return !!x; }).map(function (x) { return String(x).slice(0, 300); });
    altroVistoChiave = chiave;
    altroVistoQuando = Date.now();
    return altroVisto;
  }
  // tutto quello che dice cosa si sta guardando
  function raccogliPagina(succ) {
    var p, k;
    if (IN_FRAME) {
      // nel riquadro: quella della pagina che lo contiene (con la copertina del video di qui, se manca)
      if (!serieSito.pagina) return null;
      p = {};
      for (k in serieSito.pagina) if (Object.prototype.hasOwnProperty.call(serieSito.pagina, k)) p[k] = serieSito.pagina[k];
      p.video = location.href.split('#')[0].slice(0, 500); // il video e' quello di questo riquadro
      if (!p.immagine && lettoreVideo && /^https?:/i.test(lettoreVideo.poster || '') && lettoreVideo.poster.length <= 2000) p.immagine = lettoreVideo.poster;
      // stagione e puntata dette qui dentro (il lettore), poi quelle della pagina che lo contiene
      p.altro = altroDiQui().concat(Array.isArray(p.altro) ? p.altro : []).slice(0, 6);
      return p;
    }
    var h = document.querySelector('h1'), ld = datiStrutturati(), qui = location.href;
    // indirizzi troppo lunghi: meglio niente che un link tagliato che non si apre
    p = { url: qui.length <= 2000 ? qui : '', titolo: String(document.title || '').slice(0, 300), og: metaDi('meta[property="og:title"]'),
      video: videoDi(lettoreVideo),
      ogSito: metaDi('meta[property="og:site_name"]'), ld: ld,
      h1: h ? String(h.textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 200) : '',
      lettore: lettore && lettoreVideo ? String(pezzo('hl-titolo').textContent || '').slice(0, 200) : '', altro: altroDiQui(),
      immagine:metaDi('meta[property="og:image"]') || ld.immagine || (lettoreVideo && lettoreVideo.poster) || '' };
    if (p.immagine && !/^https?:/i.test(p.immagine)) { try { p.immagine = new URL(p.immagine, location.href).href; } catch (e) { p.immagine = ''; } }
    if (p.immagine.length > 2000) p.immagine = '';
    var s = succ === undefined ? serie.succ : succ;
    if (s && s.tagName === 'A' && typeof s.href === 'string' && /^https?:/i.test(s.href) && s.href.length <= 2000) p.prossimo = s.href;
    return p;
  }
  function urlUguale(a, b) {
    function n(u) {
      u = String(u || '');
      var k = u.indexOf('#');
      if (k !== -1 && !/^#!?\//.test(u.slice(k))) u = u.slice(0, k); // i siti fatti a "#/percorso" tengono l'ancora
      return u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase();
    }
    return !!a && n(a) === n(b);
  }
  function riprendiA(v, s, prima) {
    if (v !== lettoreVideo || !(s > 0) || !isFinite(v.duration) || s > v.duration - 30) return;
    try { v.currentTime = s; } catch (e) { return; }
    riprendiFinoA = Date.now() + 8000; // intanto Giu' ricomincia dall'inizio
    avvisoLettore(prima + formato(s) + '  \u00b7  Gi\u00f9 per ricominciare dall\'inizio', 8000);
    mostraLettore();
  }
  // quando parte un video (una volta per video): il TV l'ha gia' visto?
  function cercaVisto(v) {
    var giri = 0;
    function prova() {
      if (v !== lettoreVideo || typeof fetch !== 'function') return;
      if (!isFinite(v.duration)) { if (++giri < 8) setTimeout(prova, 700); return; } // la durata arriva dopo
      var src = v.currentSrc || v.src || '';
      if (v.duration < 300 || v.__hometvCercato === src) return; // pubblicita' e trailer no; gia' chiesto
      var p = raccogliPagina();
      if (!p) { if (IN_FRAME && ++giri < 8) setTimeout(prova, 700); return; } // nel riquadro: si aspetta la pagina di sopra
      v.__hometvCercato = src;
      // nel riquadro chiede la pagina di sopra, col suo indirizzo (risponde con "cercato")
      if (IN_FRAME && serieSito.sopra) {
        cercaSopra = { n: (cercaSopra ? cercaSopra.n : 0) + 1, v: v };
        try { window.top.postMessage({ hometv: 'cerca', n: cercaSopra.n, pagina: p, durata: v.duration }, '*'); } catch (e) {}
        return;
      }
      try {
        fetch(SERVIZIO + '/api/visti/cerca', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ pagina: p, durata: v.duration }) })
          .then(function (r) { return r.json(); }).then(function (j) { usaVisto(v, j || {}); })['catch'](function () {});
      } catch (e) {}
    }
    // dopo la ripresa del sito e della memoria di questo sito (se ci sono)
    function dopo() { setTimeout(prova, 700); }
    if (v.readyState >= 1) dopo();
    else ascolta(v, 'loadedmetadata', dopo);
  }
  function usaVisto(v, j) {
    if (v !== lettoreVideo) return;
    if (j.continua) {
      // aperto da "Continua a guardare": dal punto della scheda (0: dall'inizio, anche se il sito riprende da se').
      // L'hai scelto tu: la scheda segue questo video da subito
      v.__hometvScelto = true;
      if (j.continua.posizione > 0) riprendiA(v, j.continua.posizione, 'Ripreso da ');
      else if (v.currentTime > 5 && !(ultimoTasto > v.__hometvAgganciato)) { // se intanto sei andato avanti tu, resta li'
        riprendiFinoA = 0;
        try { v.currentTime = 0; } catch (e) {}
        avvisoLettore('Dall\'inizio', 2500);
        mostraLettore();
      }
      return;
    }
    if (j.stesso) { if (v.currentTime < 5 && !(Date.now() < riprendiFinoA)) riprendiA(v, j.stesso.posizione, 'Ripreso da '); return; }
    // anche se questo sito ha gia' ripreso da solo: dal suo punto, che puo' essere piu' indietro (se e' lo stesso, niente)
    var p = j.proposta;
    if (!p || Math.abs(v.currentTime - p.posizione) < 60) return;
    var frase = 'Eri a ' + formato(p.posizione) + ' su ' + p.sito + ' (' + p.titolo + ')  \u00b7  OK per riprendere';
    propostaRipresa = { secondi: p.posizione, fino: Date.now() + 15000, testo: frase };
    avvisoLettore(frase, 15000);
    mostraLettore();
  }
  // vale finche' si vede: se un altro avviso ha preso il suo posto, OK torna a fare il solito
  function propostaAttiva() {
    if (propostaRipresa && (Date.now() > propostaRipresa.fino || !lettore || pezzo('hl-avviso').textContent !== propostaRipresa.testo)) propostaRipresa = null;
    return !!propostaRipresa;
  }
  function accettaProposta() {
    var v = lettoreVideo, p = propostaRipresa;
    propostaRipresa = null;
    if (v && p) { v.__hometvScelto = true; riprendiA(v, p.secondi, 'Ripreso da '); }
  }
  // il punto esatto in cui lasci il video (Indietro, un altro video, un'altra pagina)
  function ricordaPunto(v, tienimi) {
    if (!v || !videoDetto || !isFinite(v.duration) || v.duration < 300) return;
    var p = null;
    try { p = raccogliPagina(); } catch (e) {}
    if (p) mandaVideo({ memo: true, durata: v.duration, posizione: v.currentTime, pagina: p, guardato: Math.round(v.__hometvGuardato || 0),
      scelto: !!v.__hometvScelto }, tienimi);
  }

  /* ---------------------------------------------------------------- il video, per il telefono
   * Mentre un video e' nel lettore TV il telefono collegato lo sa (titolo, durata, a che punto e',
   * pausa) e mostra la barra del tempo da spostare col dito. Da li' arrivano "vai a", i salti e
   * play/pausa, anche per il lettore dentro un riquadro.
   */
  var videoDetto = '', videoBattito = null, videoTimer = null;
  var VIDEO_CHI = Math.random().toString(36).slice(2, 10);
  function mandaVideo(stato, tienimi) {
    stato.chi = VIDEO_CHI;
    // nel riquadro, se la pagina di sopra ha Home TV: lo dice a lei (vedi "il lettore in un riquadro")
    if (IN_FRAME && serieSito.sopra) {
      try { window.top.postMessage({ hometv: 'statoVideo', stato: stato, tienimi: !!tienimi }, '*'); } catch (e) {}
      return;
    }
    inviaVideo(stato, tienimi);
  }
  function inviaVideo(stato, tienimi) {
    try {
      var opz = { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(stato) };
      if (tienimi) opz.keepalive = true; // la pagina se ne sta andando: la richiesta parte lo stesso
      fetch(SERVIZIO + '/api/telefono/video', opz)['catch'](function () {});
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- il lettore in un riquadro
   * Un lettore dentro un riquadro (di un altro sito, o anonimo, con sandbox: Origin null) non parla da solo col servizio
   * per Continua a guardare e la barra del telefono: lo dice a questa pagina, che manda col suo indirizzo. Il servizio da'
   * a ogni pagina solo le schede del suo sito, e niente a un riquadro anonimo. Cosa si guarda lo dice questa pagina
   * (quello che ha dato al riquadro con "serie"); dal riquadro arrivano solo i numeri, il suo video, la sua copertina e le
   * scritte del lettore. Solo per i riquadri a cui si e' risposto "serie" (il lettore, non una pubblicita' piccola).
   */
  var paginaRiquadro = null, videoRiquadro = null, cercaSopra = null;
  function paginaPerRiquadro(q) {
    if (!paginaRiquadro) return null;
    var p = {}, k;
    for (k in paginaRiquadro) if (Object.prototype.hasOwnProperty.call(paginaRiquadro, k)) p[k] = paginaRiquadro[k];
    q = q && typeof q === 'object' ? q : {};
    p.video = typeof q.video === 'string' ? q.video.slice(0, 500) : '';
    if (!p.immagine && typeof q.immagine === 'string') p.immagine = q.immagine.slice(0, 2000);
    if (Array.isArray(q.altro)) p.altro = q.altro.filter(function (x) { return typeof x === 'string'; }).slice(0, 6);
    return p;
  }
  function numeroDa(x) { x = Number(x); return isFinite(x) ? x : 0; }
  function videoDelRiquadro(s, tienimi) {
    var c = { chi: String(s.chi || '').slice(0, 20), attivo: s.attivo === true, titolo: String(s.titolo || '').slice(0, 200),
      durata: numeroDa(s.durata), posizione: numeroDa(s.posizione), inPausa: s.inPausa === true };
    if (s.memo === true) c.memo = true;
    if (s.guardato !== undefined) { c.guardato = numeroDa(s.guardato); c.scelto = s.scelto === true; }
    if (s.pagina && (c.attivo || c.memo)) c.pagina = paginaPerRiquadro(s.pagina) || undefined;
    // l'ultimo stato del lettore: se questa pagina se ne va, il riquadro (che se ne va con lei) non fa in tempo a dirlo
    if (c.attivo) videoRiquadro = { c: c, at: Date.now() };
    else if (videoRiquadro && videoRiquadro.c.chi === c.chi) videoRiquadro = null;
    inviaVideo(c, tienimi);
  }
  function cercaPerRiquadro(d, fonte) {
    var p = paginaPerRiquadro(d.pagina), n = d.n;
    if (!p || typeof fetch !== 'function') return;
    try {
      fetch(SERVIZIO + '/api/visti/cerca', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ pagina: p, durata: numeroDa(d.durata) }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { try { fonte.postMessage({ hometv: 'cercato', n: n, j: j || {} }, '*'); } catch (e) {} })['catch'](function () {});
    } catch (e) {}
  }
  // questa pagina se ne va: il punto in cui si lascia il lettore del riquadro, e la barra del telefono si spegne
  function lasciaRiquadro() {
    if (!videoRiquadro) return;
    var c = videoRiquadro.c, dopo = c.inPausa ? 0 : Math.max(0, (Date.now() - videoRiquadro.at) / 1000);
    videoRiquadro = null;
    if (!c.pagina) { inviaVideo({ chi: c.chi, attivo: false }, true); return; } // un video corto: solo la barra
    c.posizione += dopo;
    if (c.durata && c.posizione > c.durata) c.posizione = c.durata;
    if (typeof c.guardato === 'number') c.guardato = Math.round(c.guardato + dopo);
    c.memo = true;
    c.attivo = false;
    inviaVideo(c, true);
  }
  function diciVideo(forza) {
    clearTimeout(videoTimer);
    videoTimer = null;
    var v = lettoreVideo, stato = { attivo: false };
    if (v && lettore) {
      var d = v.duration;
      stato = { attivo: true, titolo: pezzo('hl-titolo').textContent || titoloVideo(), durata: isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : 0,
        posizione: Math.round((v.currentTime || 0) * 10) / 10, inPausa: !!(v.paused || v.ended) };
      // per "Continua a guardare": cos'e' (solo i video lunghi, non trailer e pubblicita')
      if (stato.durata >= 300) {
        try { stato.pagina = raccogliPagina(); } catch (e) {}
        stato.guardato = Math.round(v.__hometvGuardato || 0);
        stato.scelto = !!v.__hometvScelto;
      }
    }
    var firma = stato.attivo ? [stato.titolo, Math.round(stato.durata), stato.inPausa, Math.round(stato.posizione)].join('|') : '';
    if (!firma && !videoDetto) return; // da qui non era partito nessun video: niente da dire
    if (firma === videoDetto && forza !== true) return;
    videoDetto = firma;
    mandaVideo(stato);
  }
  function pianificaVideo(ms) { clearTimeout(videoTimer); videoTimer = setTimeout(diciVideo, ms); }
  // dal telefono: vai a quel punto, salta, play, pausa (il lettore puo' stare in un riquadro)
  function comandoVideo(e) {
    var az = e && e.azione, sec = Number(e && e.secondi), i, riquadri;
    if (az !== 'vai' && az !== 'salta' && az !== 'play' && az !== 'pausa') return;
    if ((az === 'vai' || az === 'salta') && !isFinite(sec)) return;
    var msg = { hometv: 'video', azione: az, secondi: sec };
    if (fsEl && fsEl.tagName === 'IFRAME' && fsEl.__hometvPronto) {
      try { fsEl.contentWindow.postMessage(msg, '*'); } catch (x) {}
      return;
    }
    var v = lettoreVideo;
    if (!v) {
      riquadri = document.querySelectorAll('iframe');
      for (i = 0; i < riquadri.length; i++) {
        if (riquadri[i].__hometvPronto) { try { riquadri[i].contentWindow.postMessage(msg, '*'); } catch (x) {} }
      }
      return;
    }
    ultimoTasto = Date.now();
    if (az === 'play') { if (fermo(v) || v.ended) partiDavvero(v); centro('play'); mostraLettore(); return; }
    if (az === 'pausa') { fermaAvvio(); if (!v.paused) v.pause(); centro('pausa'); mostraLettore(); return; }
    if (!isFinite(v.duration) || v.duration <= 0) return;
    if (az === 'salta') { scorriDi(Math.max(-3600, Math.min(3600, sec))); return; }
    var prima = v.currentTime, s = Math.max(0, Math.min(v.duration - 1, sec));
    clearTimeout(scorrimento.timer);
    scorrimento.attivo = false;
    try { v.currentTime = s; } catch (x) { return; }
    riprendiFinoA = 0;
    centro(s >= prima ? 'avanti' : 'indietro', formato(s));
    mostraLettore();
  }

  function nuovaPuntata() {
    serie.succ = null; serie.prec = null; serie.fuoco = 'video'; serie.conto = 0; serie.contoDa = 0;
    serie.autoAnnullato = false; serie.dopoFine = false; serie.partito = false; serieScan = 0;
    clearTimeout(serie.timer);
  }
  function attaccaLettore(v) {
    staccaLettore();
    lettoreVideo = v;
    v.__hometvAgganciato = Date.now();
    nuovaPuntata();
    // i comandi del sito o del browser starebbero sopra ai nostri
    if (v.hasAttribute('controls')) { v.__hometvControlli = true; v.removeAttribute('controls'); }
    costruisciLettore();
    if (toastEl) toastEl.className = ''; // niente avvisi sopra il video
    pezzo('hl-titolo').textContent = (IN_FRAME && serieSito.titolo) || titoloVideo();
    aggiornaSerie(true);
    ultimoAiuto = '';
    aggiornaAiuto();
    disegnaPannelloLingue();
    avvisoLettore(v === videoZittito && v.muted ? SENZA_AUDIO : '', 10000);
    var src = v.currentSrc || v.src || '';
    ascolta(v, 'timeupdate', function () {
      if (lettore && lettore.className) aggiornaLettore();
      // quanto lo guardi davvero, senza i salti (Continua a guardare: un sito che riprende da solo non conta come visto)
      var tg = v.currentTime, dg = tg - v.__hometvTempoPrima;
      if (dg > 0 && dg < 2 * Math.max(1, v.playbackRate || 1)) v.__hometvGuardato = (v.__hometvGuardato || 0) + dg;
      v.__hometvTempoPrima = tg;
      if (Date.now() - ultimoSalvataggio > 10000) { ultimoSalvataggio = Date.now(); salvaPosizione(v); }
      contoFinale(v);
      // "Riempi": le bande nere dentro il video si cercano ogni tanto, nel primo minuto
      if (!v.__hometvNoTela && Date.now() - (v.__hometvUltimaMisura || 0) > 2000 && (!v.__hometvMisure || v.__hometvMisure.n < 24) &&
        formatoScelto() === 'riempi') {
        v.__hometvUltimaMisura = Date.now();
        misuraBande(v);
      }
    });
    ascolta(v, 'progress', function () { if (lettore && lettore.className) aggiornaLettore(); });
    ascolta(v, 'pause', function () { salvaPosizione(v); mostraLettore(); diciVideo(); });
    ascolta(v, 'play', function () { mostraLettore(); diciVideo(); });
    ascolta(v, 'ended', function () { finePuntata(v); diciVideo(); });
    ascolta(v, 'playing', diciVideo);
    ascolta(v, 'seeked', diciVideo);
    ascolta(v, 'durationchange', diciVideo);
    ascolta(v, 'loadedmetadata', function () { applicaFormato(v); });
    ascolta(v, 'resize', function () { applicaFormato(v); });
    // puntata nuova nello stesso video (siti che cambiano puntata senza cambiare pagina)
    ascolta(v, 'loadstart', function () {
      var ora = v.currentSrc || v.src || '';
      if (ora === src) return;
      src = ora;
      nuovaPuntata();
      v.__hometvMisure = null; v.__hometvBande = null; v.__hometvGiocatori = null; v.__hometvNoTela = false;
      v.__hometvGuardato = 0; v.__hometvTempoPrima = undefined; v.__hometvScelto = false;
      togliFormato(v);
      pezzo('hl-titolo').textContent = (IN_FRAME && serieSito.titolo) || titoloVideo();
      applicaLingue(v);
      mostraLettore();
      diciVideo();
      propostaRipresa = null;
      cercaVisto(v);
    });
    riprendi(v);
    propostaRipresa = null;
    cercaVisto(v);
    applicaFormato(v);
    applicaLingue(v);
    mostraLettore();
    diciVideo(true);
    // ogni tanto anche se non cambia niente: il telefono fa scorrere il tempo da solo e cosi' resta
    // preciso (e il servizio sa che il lettore c'e' ancora)
    clearInterval(videoBattito);
    videoBattito = setInterval(function () { if (lettoreVideo === v) diciVideo(true); }, 15000);
  }

  function staccaLettore() {
    var v = lettoreVideo;
    ricordaPunto(v);
    propostaRipresa = null;
    for (var i = 0; i < lettoreAscolti.length; i++) {
      try { lettoreAscolti[i][0].removeEventListener(lettoreAscolti[i][1], lettoreAscolti[i][2]); } catch (e) {}
    }
    lettoreAscolti = [];
    if (v) {
      salvaPosizione(v);
      togliFormato(v);
      if (v.__hometvControlli) { v.__hometvControlli = false; v.setAttribute('controls', ''); }
    }
    clearTimeout(lettoreTimer); clearTimeout(scorrimento.timer); clearTimeout(serie.timer);
    serie.fuoco = 'video'; serie.conto = 0; serie.dopoFine = false;
    scorrimento.attivo = false;
    pannelloLingue = null;
    lettoreVideo = null;
    clearInterval(videoBattito);
    pianificaVideo(400); // se subito dopo parte un altro video, il telefono non vede un buco
    if (lettore && lettore.parentNode) lettore.parentNode.removeChild(lettore);
  }

  // scorrere avanti/indietro: si vede subito dove si arriva, il salto vero avviene
  // quando smetti di premere (il TV non deve ricaricare il video a ogni pressione)
  function scorriDi(secondi) {
    var v = lettoreVideo;
    if (!v || !isFinite(v.duration)) return;
    if (!scorrimento.attivo) { scorrimento.attivo = true; scorrimento.meta = v.currentTime; }
    scorrimento.meta = Math.max(0, Math.min(v.duration - 1, scorrimento.meta + secondi));
    var diff = Math.round(scorrimento.meta - v.currentTime);
    centro(secondi > 0 ? 'avanti' : 'indietro', (diff > 0 ? '+' : '') + formato(Math.abs(diff)).replace(/^0:/, '') + (Math.abs(diff) < 60 ? ' s' : ''));
    mostraLettore();
    clearTimeout(scorrimento.timer);
    scorrimento.timer = setTimeout(function () {
      if (lettoreVideo === v) { try { v.currentTime = scorrimento.meta; } catch (e) {} }
      scorrimento.attivo = false;
      riprendiFinoA = 0;
      if (lettoreVideo === v) mostraLettore();
    }, 450);
  }

  /* ---------------------------------------------------------------- audio, sottotitoli e schermo
   * Giu' apre un pannello con le lingue dell'audio, i sottotitoli e il formato dello
   * schermo. Audio e sottotitoli sono quelli del player del sito, presi per tre strade,
   * dalla piu' affidabile:
   *  1. le funzioni dei player piu' diffusi (JW Player, Video.js, Shaka, dash.js,
   *     Bitmovin, hls.js, Plyr): le stesse che usa il loro menu;
   *  2. le tracce standard del video (i <track>, quelle che creano molti player);
   *  3. il menu del player del sito: se il player e' fatto in casa se ne leggono le voci
   *     (lingue, "Disattivati") e si premono come faresti tu.
   * Audio e sottotitoli si cercano ognuno per conto suo. Le scelte si ricordano per il
   * sito e valgono anche per le puntate dopo.
   */
  var NOMI_LINGUE = { it: 'Italiano', en: 'Inglese', es: 'Spagnolo', fr: 'Francese', de: 'Tedesco', pt: 'Portoghese',
    ru: 'Russo', ja: 'Giapponese', ko: 'Coreano', zh: 'Cinese', ar: 'Arabo', hi: 'Hindi', nl: 'Olandese', pl: 'Polacco',
    tr: 'Turco', sv: 'Svedese', da: 'Danese', no: 'Norvegese', fi: 'Finlandese', el: 'Greco', he: 'Ebraico', ro: 'Rumeno',
    hu: 'Ungherese', cs: 'Ceco', uk: 'Ucraino' };
  // come si chiama ogni lingua nelle etichette dei player (senza accenti, anche nella lingua stessa)
  var PAROLE_LINGUE = {
    it: 'ita italiano italiana italian', en: 'eng english inglese', es: 'spa espanol spanish spagnolo castellano latino',
    fr: 'fra fre francais french francese', de: 'deu ger deutsch german tedesco', pt: 'por portugues portuguese portoghese brasileiro',
    ru: 'rus russian russo \u0440\u0443\u0441\u0441\u043a\u0438\u0439', ja: 'jpn japanese giapponese \u65e5\u672c\u8a9e',
    ko: 'kor korean coreano \ud55c\uad6d\uc5b4', zh: 'chi zho chinese cinese mandarin \u4e2d\u6587', ar: 'ara arabic arabo',
    hi: 'hin hindi', nl: 'nld dut dutch olandese nederlands', pl: 'pol polish polacco polski', tr: 'tur turkish turco turkce',
    sv: 'swe swedish svedese svenska', da: 'dan danish danese dansk', no: 'nor norwegian norvegese norsk nob', fi: 'fin finnish finlandese suomi',
    el: 'gre ell greek greco', he: 'heb hebrew ebraico', ro: 'ron rum romanian rumeno romana', hu: 'hun hungarian ungherese magyar',
    cs: 'ces cze czech ceco cestina', uk: 'ukr ukrainian ucraino'
  };
  var indiceLingue = null;
  function senzaAccenti(s) {
    return s.replace(/[\u00e0-\u00e5]/g, 'a').replace(/[\u00e7\u010d]/g, 'c').replace(/[\u00e8-\u00eb]/g, 'e')
      .replace(/[\u00ec-\u00ef]/g, 'i').replace(/\u00f1/g, 'n').replace(/[\u00f2-\u00f6]/g, 'o').replace(/[\u00f9-\u00fc]/g, 'u').replace(/\u0161/g, 's');
  }
  // "it", "it-IT", "ita", "Italiano", "English (CC)", "Sottotitoli: Espanol" -> codice di due lettere
  function codiceLingua(s) {
    if (!s) return '';
    var t = senzaAccenti(String(s).toLowerCase()).replace(/^\s+|\s+$/g, '');
    var corto = /^([a-z]{2})([-_][a-z0-9]{2,4})?$/.exec(t);
    if (corto) return ha(NOMI_LINGUE, corto[1]) ? corto[1] : (corto[1] === 'nb' ? 'no' : '');
    if (!indiceLingue) {
      indiceLingue = {};
      for (var c in PAROLE_LINGUE) {
        if (!ha(PAROLE_LINGUE, c)) continue;
        var p = PAROLE_LINGUE[c].split(' ');
        for (var i = 0; i < p.length; i++) indiceLingue[p[i]] = c;
      }
    }
    var parti = t.split(/[^a-z\u0370-\uffff]+/);
    for (var j = 0; j < parti.length; j++) if (parti[j].length > 2 && ha(indiceLingue, parti[j])) return indiceLingue[parti[j]];
    return '';
  }
  function voce(id, etichetta, lingua, attivo) {
    var e = String(etichetta || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var codice = codiceLingua(lingua) || codiceLingua(e);
    var nome = e && !/^[a-z]{2,3}([-_][a-z0-9]{2,4})?$/i.test(e) ? e : (NOMI_LINGUE[codice] || e || String(lingua || ''));
    return { id: id, nome: nome || ('Traccia ' + (typeof id === 'number' ? id + 1 : '')), lingua: codice, attivo: !!attivo };
  }
  function ogni(lista, fai) {
    var out = [];
    for (var i = 0; lista && i < lista.length; i++) out.push(fai(lista[i], i));
    return out;
  }
  function lanciaEvento(el, tipo) {
    try { el.dispatchEvent(new Event(tipo, { bubbles: true })); } catch (e) {
      try { var ev = document.createEvent('Event'); ev.initEvent(tipo, true, false); el.dispatchEvent(ev); } catch (e2) {}
    }
  }

  // Gli oggetti dei player (hls.js, Shaka, dash.js, Bitmovin) usati dalla pagina: si cercano
  // tra le proprieta' del video e dei suoi contenitori e tra le variabili globali (solo
  // valori semplici: niente "getter", che potrebbero fare qualcosa).
  function proprieta(el) {
    var out = {};
    try {
      var k = Object.keys(el);
      for (var i = 0; i < k.length && i < 40; i++) {
        if (k[i].indexOf('__hometv') === 0) continue;
        var d = Object.getOwnPropertyDescriptor(el, k[i]);
        if (d && 'value' in d) out[k[i]] = d.value;
      }
    } catch (e) {}
    return out;
  }
  function cercaOggetti(v, prova) {
    var visti = typeof WeakSet === 'function' ? new WeakSet() : null, conta = 0;
    function guarda(o, prof) {
      try {
        if (!o || (typeof o !== 'object' && typeof o !== 'function') || conta > 3000) return;
        if (o === window || o === document || o.nodeType || Array.isArray(o) || (typeof ArrayBuffer === 'function' && ArrayBuffer.isView(o))) return;
        if (visti) { if (visti.has(o)) return; visti.add(o); }
        conta++;
        prova(o);
        if (prof <= 0 || typeof o === 'function') return;
        var chiavi = Object.keys(o);
        for (var i = 0; i < chiavi.length && i < 80; i++) {
          if (chiavi[i].indexOf('__hometv') === 0) continue;
          var d = Object.getOwnPropertyDescriptor(o, chiavi[i]);
          if (d && 'value' in d) guarda(d.value, prof - 1);
        }
      } catch (e) {}
    }
    for (var n = v, i = 0; n && i < 6; n = n.parentElement, i++) guarda(proprieta(n), 2);
    var g = [];
    try { g = Object.keys(window); } catch (e) {}
    for (var j = 0; j < g.length; j++) {
      try {
        var d2 = Object.getOwnPropertyDescriptor(window, g[j]);
        if (d2 && 'value' in d2) guarda(d2.value, 2);
      } catch (e) {}
    }
  }
  // I player che il sito tiene nel suo codice (non in una variabile globale): quando la
  // libreria arriva nella pagina, si annota sul video quale player lo usa.
  function annotaSuVideo(chiave) {
    return function (orig) {
      return function (m) {
        try { if (m && m.tagName === 'VIDEO') Object.defineProperty(m, chiave, { value: this, configurable: true, writable: true }); } catch (e) {}
        return orig.apply(this, arguments);
      };
    };
  }
  function avvolgiMetodo(o, nome, fai) {
    try {
      if (!o || typeof o[nome] !== 'function' || o[nome].__hometv) return;
      var f = fai(o[nome]);
      f.__hometv = true;
      o[nome] = f;
    } catch (e) {}
  }
  var LIBRERIE_PLAYER = {
    Hls: function (H) { if (typeof H === 'function') avvolgiMetodo(H.prototype, 'attachMedia', annotaSuVideo('__hometvHls')); },
    shaka: function (sk) { if (sk && typeof sk.Player === 'function') avvolgiMetodo(sk.Player.prototype, 'attach', annotaSuVideo('__hometvShaka')); },
    dashjs: function (d) {
      if (!d || typeof d.MediaPlayer !== 'function' || d.MediaPlayer.__hometv) return;
      var orig = d.MediaPlayer;
      var nuovo = function () {
        var fabbrica = orig.apply(this, arguments);
        avvolgiMetodo(fabbrica, 'create', function (crea) {
          return function () {
            var pl = crea.apply(this, arguments);
            avvolgiMetodo(pl, 'initialize', annotaSuVideo('__hometvDash'));
            avvolgiMetodo(pl, 'attachView', annotaSuVideo('__hometvDash'));
            return pl;
          };
        });
        return fabbrica;
      };
      for (var k in orig) if (ha(orig, k)) nuovo[k] = orig[k];
      nuovo.__hometv = true;
      try { d.MediaPlayer = nuovo; } catch (e) {}
    }
  };
  function agganciaLibrerie() {
    for (var nome in LIBRERIE_PLAYER) {
      if (!ha(LIBRERIE_PLAYER, nome)) continue;
      try {
        var d = Object.getOwnPropertyDescriptor(window, nome);
        if (d && 'value' in d && d.value) LIBRERIE_PLAYER[nome](d.value);
      } catch (e) {}
    }
  }
  agganciaLibrerie();
  ascoltaSicuro(document, 'load', function (ev) { if (ev.target && ev.target.tagName === 'SCRIPT') agganciaLibrerie(); }, true);

  function trovaGiocatori(v) {
    agganciaLibrerie();
    var c = v.__hometvGiocatori;
    // trovato qualcosa: vale finche' il video non cambia; niente: si riprova ogni tanto
    if (c && (c.trovato || Date.now() - c.quando < 4000)) return c;
    c = { quando: Date.now(), trovato: false, hls: v.__hometvHls || null, shaka: v.__hometvShaka || null, dash: v.__hometvDash || null, bitmovin: null };
    if (!c.hls && !c.shaka && !c.dash) cercaOggetti(v, function (o) {
      try {
        if (!c.hls && Array.isArray(o.audioTracks) && 'subtitleTrack' in o && 'audioTrack' in o && o.media === v) c.hls = o;
        else if (!c.shaka && typeof o.getAudioLanguagesAndRoles === 'function' && typeof o.getMediaElement === 'function' && o.getMediaElement() === v) c.shaka = o;
        else if (!c.dash && typeof o.getTracksFor === 'function' && typeof o.getVideoElement === 'function' && o.getVideoElement() === v) c.dash = o;
        else if (!c.bitmovin && typeof o.getAvailableAudio === 'function' && typeof o.getVideoElement === 'function' && o.getVideoElement() === v) c.bitmovin = o;
      } catch (e) {}
    });
    try { if (!c.shaka && v.ui && typeof v.ui.getControls === 'function') c.shaka = v.ui.getControls().getPlayer(); } catch (e) {}
    c.trovato = !!(c.hls || c.shaka || c.dash || c.bitmovin);
    try { Object.defineProperty(v, '__hometvGiocatori', { value: c, configurable: true, writable: true }); } catch (e) {}
    return c;
  }

  function conJW(v) {
    var jw = window.jwplayer;
    if (typeof jw !== 'function') return null;
    var p = null, el = document.querySelectorAll('.jwplayer, [id^="jwplayer"]');
    for (var i = 0; i < el.length && !p; i++) {
      try { var x = jw(el[i].id || el[i]); if (x && x.getContainer && x.getContainer().contains(v)) p = x; } catch (e) {}
    }
    if (!p) { try { var y = jw(); if (y && y.getContainer && y.getContainer().contains(v)) p = y; } catch (e) {} }
    if (!p) return null;
    var out = {}, cap = p.getCaptionsList ? p.getCaptionsList() || [] : [], cc = p.getCurrentCaptions ? p.getCurrentCaptions() : 0;
    var voci = [];
    for (var k = 1; k < cap.length; k++) voci.push(voce(k, cap[k].label || cap[k].name, cap[k].language || cap[k].srclang, k === cc));
    if (voci.length) out.sott = { fonte: 'JW Player', voci: voci, scegli: function (x) { p.setCurrentCaptions(x ? x.id : 0); } };
    var aud = p.getAudioTracks ? p.getAudioTracks() || [] : [], ca = p.getCurrentAudioTrack ? p.getCurrentAudioTrack() : -1;
    if (aud.length > 1) {
      out.audio = { fonte: 'JW Player', voci: ogni(aud, function (a, k2) { return voce(k2, a.name || a.label, a.language, k2 === ca); }),
        scegli: function (x) { p.setCurrentAudioTrack(x.id); } };
    }
    return out;
  }

  function conVideojs(v) {
    var p = null, vjs = window.videojs;
    if (vjs && typeof vjs.getPlayers === 'function') {
      var tutti = vjs.getPlayers();
      for (var k in tutti) if (ha(tutti, k) && tutti[k] && typeof tutti[k].el === 'function' && tutti[k].el() && tutti[k].el().contains(v)) p = tutti[k];
    }
    if (!p) { var c = v.closest && v.closest('.video-js'); if (c && c.player && typeof c.player.textTracks === 'function') p = c.player; }
    if (!p) return null;
    var out = {}, tt = p.textTracks(), tracce = [], voci = [];
    for (var i = 0; i < tt.length; i++) {
      if (tt[i].kind !== 'subtitles' && tt[i].kind !== 'captions') continue;
      tracce.push(tt[i]);
      voci.push(voce(tracce.length - 1, tt[i].label, tt[i].language, tt[i].mode === 'showing'));
    }
    if (voci.length) {
      out.sott = { fonte: 'Video.js', voci: voci, scegli: function (x) {
        for (var j = 0; j < tracce.length; j++) tracce[j].mode = x && j === x.id ? 'showing' : 'disabled';
      } };
    }
    var at = typeof p.audioTracks === 'function' ? p.audioTracks() : null, ta = [];
    for (var a = 0; at && a < at.length; a++) ta.push(at[a]);
    if (ta.length > 1) {
      out.audio = { fonte: 'Video.js', voci: ogni(ta, function (t, k2) { return voce(k2, t.label, t.language, t.enabled); }),
        scegli: function (x) { ta[x.id].enabled = true; } }; // Video.js spegne da solo le altre
    }
    return out;
  }

  function conShaka(v) {
    var p = trovaGiocatori(v).shaka;
    if (!p) return null;
    var out = {}, tt = p.getTextTracks ? p.getTextTracks() || [] : [], vis = p.isTextTrackVisible ? p.isTextTrackVisible() : true;
    if (tt.length) {
      out.sott = { fonte: 'Shaka', voci: ogni(tt, function (t, k) { return voce(k, t.label, t.language, vis && t.active); }), scegli: function (x) {
        if (!x) { p.setTextTrackVisibility(false); return; }
        p.selectTextTrack(tt[x.id]);
        p.setTextTrackVisibility(true);
      } };
    }
    var lr = p.getAudioLanguagesAndRoles ? p.getAudioLanguagesAndRoles() || [] : [], att = null, vt = p.getVariantTracks ? p.getVariantTracks() || [] : [];
    for (var i = 0; i < vt.length; i++) if (vt[i].active) att = vt[i];
    if (lr.length > 1) {
      out.audio = { fonte: 'Shaka', voci: ogni(lr, function (l, k) { return voce(k, l.label, l.language, !!att && att.language === l.language); }),
        scegli: function (x) { p.selectAudioLanguage(lr[x.id].language, lr[x.id].role || undefined); } };
    }
    return out;
  }

  function etichettaDash(t) {
    var l = t && t.labels && t.labels[0];
    return (l && (l.text || (typeof l === 'string' ? l : ''))) || '';
  }
  function conDashjs(v) {
    var p = trovaGiocatori(v).dash;
    if (!p) return null;
    var out = {}, tt = p.getTracksFor('text') || [];
    if (tt.length) {
      var acceso = typeof p.isTextEnabled === 'function' ? p.isTextEnabled() : true;
      var idx = typeof p.getCurrentTextTrackIndex === 'function' ? p.getCurrentTextTrackIndex() : -1;
      out.sott = { fonte: 'dash.js', voci: ogni(tt, function (t, k) { return voce(k, etichettaDash(t), t.lang, acceso && idx === k); }), scegli: function (x) {
        if (!x) { if (p.enableText) p.enableText(false); p.setTextTrack(-1); return; }
        if (p.enableText) p.enableText(true);
        p.setTextTrack(x.id);
      } };
    }
    var at = p.getTracksFor('audio') || [], ca = p.getCurrentTrackFor('audio');
    if (at.length > 1) {
      out.audio = { fonte: 'dash.js', voci: ogni(at, function (t, k) { return voce(k, etichettaDash(t), t.lang, t === ca || (!!ca && ca.id === t.id && ca.lang === t.lang)); }),
        scegli: function (x) { p.setCurrentTrack(at[x.id]); } };
    }
    return out;
  }

  function conBitmovin(v) {
    var p = trovaGiocatori(v).bitmovin;
    if (!p) return null;
    var out = {}, au = p.getAvailableAudio() || [], ca = p.getAudio ? p.getAudio() : null;
    if (au.length > 1) {
      out.audio = { fonte: 'Bitmovin', voci: ogni(au, function (a, k) { return voce(k, a.label, a.lang, !!ca && ca.id === a.id); }),
        scegli: function (x) { p.setAudio(au[x.id].id); } };
    }
    var st = p.subtitles && p.subtitles.list ? p.subtitles.list() || [] : [];
    if (st.length) {
      out.sott = { fonte: 'Bitmovin', voci: ogni(st, function (s, k) { return voce(k, s.label, s.lang, s.enabled); }), scegli: function (x) {
        for (var i = 0; i < st.length; i++) if (st[i].enabled && (!x || i !== x.id)) p.subtitles.disable(st[i].id);
        if (x) p.subtitles.enable(st[x.id].id, true);
      } };
    }
    return out;
  }

  function conHls(v) {
    var h = trovaGiocatori(v).hls;
    if (!h || h.media !== v) return null;
    var out = {}, st = h.subtitleTracks || [], on = h.subtitleTrack >= 0 && h.subtitleDisplay !== false;
    if (st.length) {
      out.sott = { fonte: 'hls.js', voci: ogni(st, function (t, k) { return voce(k, t.name, t.lang, on && h.subtitleTrack === k); }), scegli: function (x) {
        if (!x) { h.subtitleTrack = -1; return; }
        h.subtitleDisplay = true;
        h.subtitleTrack = x.id;
      } };
    }
    var at = h.audioTracks || [];
    if (at.length > 1) {
      out.audio = { fonte: 'hls.js', voci: ogni(at, function (t, k) { return voce(k, t.name, t.lang, h.audioTrack === k); }),
        scegli: function (x) { h.audioTrack = x.id; } };
    }
    return out;
  }

  function sottotitoliDelVideo(v) {
    var out = [], tt = v.textTracks || [];
    for (var i = 0; i < tt.length; i++) if (tt[i].kind === 'subtitles' || tt[i].kind === 'captions') out.push(tt[i]);
    return out;
  }
  function conPlyr(v) {
    var p = v.plyr, c = !p && v.closest ? v.closest('.plyr') : null;
    if (!p && c && c.plyr) p = c.plyr;
    if (!p || typeof p.toggleCaptions !== 'function') return null;
    // i sottotitoli li disegna Plyr: si comandano con le sue funzioni
    var tt = sottotitoliDelVideo(v), on = !!(p.captions && p.captions.active), cur = p.currentTrack;
    if (!tt.length) return null;
    return { sott: { fonte: 'Plyr', voci: ogni(tt, function (t, k) { return voce(k, t.label, t.language, on && cur === k); }), scegli: function (x) {
      if (!x) { p.toggleCaptions(false); return; }
      p.currentTrack = x.id;
      p.toggleCaptions(true);
    } } };
  }

  function conNativo(v) {
    var out = {}, tt = sottotitoliDelVideo(v);
    if (tt.length) {
      out.sott = { fonte: 'video', voci: ogni(tt, function (t, k) { return voce(k, t.label, t.language, t.mode === 'showing'); }), scegli: function (x) {
        for (var j = 0; j < tt.length; j++) tt[j].mode = x && j === x.id ? 'showing' : 'disabled';
      } };
    }
    var at = v.audioTracks, ta = [];
    for (var a = 0; at && a < at.length; a++) ta.push(at[a]);
    if (ta.length > 1) {
      out.audio = { fonte: 'video', voci: ogni(ta, function (t, k) { return voce(k, t.label, t.language, t.enabled); }), scegli: function (x) {
        ta[x.id].enabled = true;
        for (var j = 0; j < ta.length; j++) if (j !== x.id) ta[j].enabled = false;
      } };
    }
    return out;
  }

  // --- il menu del player del sito (player fatti in casa)
  var RE_SOTT = /sottotit|subtit|caption|\bcc\b|closed.?capt/i;
  var RE_AUDIO = /audio|lingu|language|doppiag|dubb|voce|voice/i;
  var RE_SPENTO = /^(off|disattivat[io]|disabilitat[io]|nessuno|spent[oi]|none|disabled|no|sottotitoli disattivati|subtitles off|captions off)$/i;
  function contenitorePlayer(v) {
    var n = v, migliore = v.parentElement || document.body;
    for (var i = 0; i < 7 && n && n.parentElement && n !== document.body; i++) {
      n = n.parentElement;
      var nome = (typeof n.className === 'string' ? n.className : '') + ' ' + n.id;
      if (LETTORE_SITO.test(nome)) return n;
      if (i < 4) migliore = n;
    }
    return migliore;
  }
  function voceAttiva(el) {
    if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || (el.tagName === 'OPTION' && el.selected)) return true;
    return /(^|[\s_-])(active|selected|checked|current|is-active|vjs-selected|jw-active-option|attiv[oa]|selezionat[oa]|scelt[oa]|corrente)([\s_-]|$)/i.test(typeof el.className === 'string' ? el.className : '');
  }
  function nomeGruppo(el) {
    var t = testoBreve(el).slice(0, 80);
    for (var n = el, i = 0; n && i < 4; n = n.parentElement, i++) {
      t += ' ' + (typeof n.className === 'string' ? n.className : '') + ' ' + n.id + ' ' + (n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('data-plyr') || '');
      var h = n.querySelector && n.querySelector(ProfiloTV.selettore('h1, h2, h3, h4, legend, [class*="title" i], [class*="header" i]'));
      if (h && !h.contains(el)) t += ' ' + testoBreve(h).slice(0, 60);
      var prima = n.previousElementSibling;
      if (prima && testoBreve(prima).length < 40) t += ' ' + testoBreve(prima);
    }
    return t;
  }
  function conMenuSito(v) {
    var radice = contenitorePlayer(v), tutti;
    try { tutti = radice.getElementsByTagName('*'); } catch (e) { return null; }
    // le voci: testo corto con una lingua (o "Disattivati"); se il contenitore ha lo
    // stesso testo (voce con un'icona dentro) la voce e' il contenitore
    var gruppi = [], viste = [];
    for (var i = 0; i < tutti.length && i < 1500; i++) {
      var el = tutti[i];
      if (/^(SCRIPT|STYLE|VIDEO|AUDIO|SOURCE|TRACK|svg|path)$/.test(el.tagName) || (el.id && el.id.indexOf('hometv-') === 0)) continue;
      if (el.children.length > 3) continue;
      var t = testoBreve(el) || el.getAttribute('aria-label') || '';
      if (!t || t.length > 40) continue;
      var spento = RE_SPENTO.test(t), lingua = spento ? '' : codiceLingua(t);
      if (!spento && !lingua) continue;
      while (el.parentElement && el.parentElement !== radice && testoBreve(el.parentElement) === t) el = el.parentElement;
      if (viste.indexOf(el) !== -1) continue;
      viste.push(el);
      var padre = el.parentElement, g = null;
      for (var k = 0; k < gruppi.length; k++) if (gruppi[k].el === padre) g = gruppi[k];
      if (!g) { g = { el: padre, voci: [] }; gruppi.push(g); }
      g.voci.push({ el: el, nome: t, lingua: lingua, spento: spento, attivo: voceAttiva(el) });
    }
    var out = {};
    for (var j = 0; j < gruppi.length; j++) {
      var gr = gruppi[j], lingue = 0, haSpento = false;
      for (var x = 0; x < gr.voci.length; x++) { if (gr.voci[x].spento) haSpento = true; else lingue++; }
      if (gr.voci.length < 2 || !lingue) continue;
      var nome = nomeGruppo(gr.el), sott = RE_SOTT.test(nome) || (haSpento && !RE_AUDIO.test(nome));
      if (!sott && !RE_AUDIO.test(nome) && lingue < 2) continue;
      var tipo = sott ? 'sott' : 'audio';
      if (out[tipo] && out[tipo].voci.length >= lingue) continue;
      out[tipo] = menuDelSito(gr, tipo);
    }
    return out;
  }
  function premiVoce(el) {
    if (el.tagName === 'OPTION') {
      var s = el.parentElement;
      while (s && s.tagName !== 'SELECT') s = s.parentElement;
      if (s) { s.value = el.value; lanciaEvento(s, 'input'); lanciaEvento(s, 'change'); }
      return;
    }
    cliccaDavvero(el);
  }
  function menuDelSito(gr, tipo) {
    var voci = [], spenta = null;
    for (var i = 0; i < gr.voci.length; i++) {
      var g = gr.voci[i];
      if (g.spento) { spenta = g; continue; }
      var x = voce(voci.length, g.nome, g.lingua, g.attivo);
      x.el = g.el;
      voci.push(x);
    }
    return { fonte: 'menu del sito', voci: voci, scegli: function (x) {
      if (x) premiVoce(x.el);
      else if (spenta) premiVoce(spenta.el);
    }, senzaSpento: tipo === 'sott' && !spenta };
  }

  // Audio e sottotitoli di questo video: per ognuno la prima strada che li conosce.
  var ADATTATORI = [conJW, conVideojs, conShaka, conDashjs, conBitmovin, conHls, conPlyr, conNativo, conMenuSito];
  function fonteTracce(v) {
    var out = { sott: null, audio: null };
    for (var i = 0; i < ADATTATORI.length && (!out.sott || !out.audio); i++) {
      var r = null;
      try { r = ADATTATORI[i](v); } catch (e) { r = null; }
      if (!r) continue;
      if (!out.sott && r.sott && r.sott.voci.length) out.sott = r.sott;
      if (!out.audio && r.audio && r.audio.voci.length > 1) out.audio = r.audio;
    }
    return out;
  }

  // --- le scelte si ricordano (per sito) e valgono anche per le puntate dopo
  function leggiScelte() {
    try { var p = JSON.parse(localStorage.getItem('hometv-lingue') || '{}'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
  }
  function salvaScelta(tipo, valore) {
    formatoMemo = null;
    var p = leggiScelte();
    p[tipo] = valore;
    try { localStorage.setItem('hometv-lingue', JSON.stringify(p)); } catch (e) {}
  }
  function vocePreferita(voci, pref) {
    var c = codiceLingua(pref);
    for (var i = 0; i < voci.length; i++) if ((c && voci[i].lingua === c) || voci[i].nome === pref) return voci[i];
    return null;
  }
  // Le tracce arrivano anche dopo qualche secondo (prima l'elenco, poi i sottotitoli):
  // si riprova per un po'. Spenti per scelta: si controlla che il player non li riaccenda.
  function applicaLingue(v) {
    var pref = leggiScelte(), fatto = { audio: !pref.audio, sott: !pref.sott }, giri = 0;
    if (fatto.audio && fatto.sott) return;
    (function prova() {
      if (v !== lettoreVideo || giri++ > 25) return;
      var f = fonteTracce(v);
      if (!fatto.audio && f.audio) {
        var a = vocePreferita(f.audio.voci, pref.audio);
        if (a && !a.attivo) { try { f.audio.scegli(a); } catch (e) {} }
        fatto.audio = true;
      }
      if (!fatto.sott && f.sott) {
        var accesa = null;
        for (var i = 0; i < f.sott.voci.length; i++) if (f.sott.voci[i].attivo) accesa = f.sott.voci[i];
        if (pref.sott === 'off') {
          if (accesa) { try { f.sott.scegli(null); } catch (e) {} }
          if (giri > 6) fatto.sott = true;
        } else {
          var s = vocePreferita(f.sott.voci, pref.sott);
          if (s && s !== accesa) { try { f.sott.scegli(s); } catch (e) {} }
          fatto.sott = true;
        }
      }
      if (!fatto.audio || !fatto.sott) setTimeout(prova, 1000);
    })();
  }

  // --- formato dello schermo: normalmente il video si vede intero (con le bande nere se
  // la sua forma non e' quella dello schermo); "Riempi" taglia i bordi (anche le bande
  // nere che il video ha dentro di se'), "Allarga" lo deforma un poco.
  var FORMATI = [
    { id: 'adatta', nome: 'Intero' },
    { id: 'riempi', nome: 'Riempi (taglia i bordi)' },
    { id: 'allarga', nome: 'Allarga' }
  ];
  var PROP_FORMATO = ['left', 'top', 'width', 'height', 'object-fit'];
  var formatoMemo = null; // si rilegge se cambia (qui o in un'altra pagina dello stesso sito)
  function formatoScelto() {
    if (formatoMemo !== null) return formatoMemo;
    var f = leggiScelte().formato;
    formatoMemo = 'adatta';
    for (var i = 0; i < FORMATI.length; i++) if (FORMATI[i].id === f) formatoMemo = f;
    return formatoMemo;
  }
  ascoltaSicuro(window, 'storage', function (ev) { if (!ev.key || ev.key === 'hometv-lingue') formatoMemo = null; });
  function togliFormato(v) {
    if (!v) return;
    v.classList.remove('hometv-fmt-riempi', 'hometv-fmt-allarga');
    if (!v.__hometvRitaglio) return;
    for (var i = 0; i < PROP_FORMATO.length; i++) v.style.removeProperty(PROP_FORMATO[i]);
    v.__hometvRitaglio = false;
  }
  function applicaFormato(v) {
    v = v || lettoreVideo;
    if (!v || fsEl !== v) return;
    var f = formatoScelto(), W = window.innerWidth, H = window.innerHeight, w = v.videoWidth, h = v.videoHeight;
    togliFormato(v);
    if (!w || !h || !W || !H) return;
    // "Riempi": il quadro vero, senza le bande nere che il video ha dentro di se'
    var b = f === 'riempi' ? v.__hometvBande : null;
    var c = b ? { x: w * b.l, y: h * b.t, w: w * (1 - b.l - b.r), h: h * (1 - b.t - b.b) } : { x: 0, y: 0, w: w, h: h };
    var A = W / H, a = c.w / c.h, modo = f;
    if (!b) {
      if (modo === 'riempi') v.classList.add('hometv-fmt-riempi');
      else if (modo === 'allarga') v.classList.add('hometv-fmt-allarga');
      return;
    }
    // bande dentro il video: si allarga il riquadro del video oltre lo schermo
    var tw, th;
    if (modo === 'allarga') { tw = W; th = H; }
    else if ((modo === 'riempi') === (a > A)) { th = H; tw = H * a; } else { tw = W; th = W / a; }
    var sx = tw / c.w, sy = th / c.h;
    var stile = { left: (W - tw) / 2 - c.x * sx, top: (H - th) / 2 - c.y * sy, width: w * sx, height: h * sy };
    for (var k in stile) if (ha(stile, k)) v.style.setProperty(k, Math.round(stile[k]) + 'px', 'important');
    v.style.setProperty('object-fit', 'fill', 'important');
    v.__hometvRitaglio = true;
  }
  // Bande nere dentro il video (film "cinemascope" messi in un quadro 16:9): si guardano
  // poche righe del video in piccolo, su piu' scene. Se il video non si lascia leggere
  // (protetto, o il TV non lo permette) non si fa niente.
  var tela = null;
  function misuraBande(v) {
    if (v.__hometvNoTela || v.paused || v.readyState < 2 || !v.videoWidth || v !== lettoreVideo) return;
    var cw = 96, ch = Math.max(24, Math.min(96, Math.round(96 * v.videoHeight / v.videoWidth)));
    var d;
    try {
      tela = tela || document.createElement('canvas');
      tela.width = cw; tela.height = ch;
      var cx = tela.getContext('2d');
      cx.drawImage(v, 0, 0, cw, ch);
      d = cx.getImageData(0, 0, cw, ch).data;
    } catch (e) { v.__hometvNoTela = true; return; }
    var righe = [], colonne = [], x, y, i, l;
    for (y = 0; y < ch; y++) righe[y] = 0;
    for (x = 0; x < cw; x++) colonne[x] = 0;
    for (y = 0; y < ch; y++) {
      for (x = 0; x < cw; x++) {
        i = (y * cw + x) * 4;
        l = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
        if (l > righe[y]) righe[y] = l;
        if (l > colonne[x]) colonne[x] = l;
      }
    }
    var NERO = 30;
    function conta(arr, da, passo) { var n = 0; for (var j = da; j >= 0 && j < arr.length && arr[j] < NERO; j += passo) n++; return n; }
    var t = conta(righe, 0, 1), bb = conta(righe, ch - 1, -1), sx = conta(colonne, 0, 1), dx = conta(colonne, cw - 1, -1);
    if (t + bb >= ch * 0.6 || sx + dx >= cw * 0.6) return; // quasi tutto nero: scena buia, non dice niente
    // il bordo del quadro vero deve essere netto (non una sfumatura di una scena scura)
    if ((t && righe[t] < 70) || (bb && righe[ch - 1 - bb] < 70)) t = bb = 0;
    if ((sx && colonne[sx] < 70) || (dx && colonne[cw - 1 - dx] < 70)) sx = dx = 0;
    if (Math.abs(t - bb) > 1) t = bb = Math.min(t, bb);
    if (Math.abs(sx - dx) > 1) sx = dx = Math.min(sx, dx);
    var m = v.__hometvMisure || (v.__hometvMisure = { n: 0, uguali: 0, t: t, b: bb, l: sx, r: dx });
    if (m.n && Math.abs(m.t - t) <= 1 && Math.abs(m.l - sx) <= 1) m.uguali++;
    m.n++;
    m.t = Math.min(m.t, t); m.b = Math.min(m.b, bb); m.l = Math.min(m.l, sx); m.r = Math.min(m.r, dx);
    // almeno tre scene che dicono la stessa cosa; bande piccole o nulle: niente
    if (m.uguali < 2) return;
    var nuove = { t: m.t / ch, b: m.b / ch, l: m.l / cw, r: m.r / cw };
    if (nuove.t + nuove.b < 0.02 && nuove.l + nuove.r < 0.02) nuove = null;
    if (nuove && (nuove.t + nuove.b > 0.3 || nuove.l + nuove.r > 0.3)) nuove = null;
    var prima = v.__hometvBande;
    if (!nuove && !prima) return;
    if (prima && nuove && Math.abs(prima.t - nuove.t) < 0.005 && Math.abs(prima.l - nuove.l) < 0.005) return;
    v.__hometvBande = nuove;
    applicaFormato(v);
  }

  // --- il pannello (Giu'): Audio, Sottotitoli, Schermo
  var pannelloLingue = null; // { colonne: [{ tipo, titolo, voci, sel, fonte }], col }
  var ultimaColonna = 'sott';
  function indiceAttivo(voci) {
    for (var i = 0; i < voci.length; i++) if (voci[i].attivo) return i;
    return 0;
  }
  function colonneLingue(v) {
    var f = fonteTracce(v), colonne = [];
    if (f.audio) colonne.push({ tipo: 'audio', titolo: 'Audio', voci: f.audio.voci, fonte: f.audio });
    if (f.sott) {
      var nessuna = true;
      for (var i = 0; i < f.sott.voci.length; i++) if (f.sott.voci[i].attivo) nessuna = false;
      var voci = f.sott.senzaSpento ? f.sott.voci : [{ id: null, nome: 'Disattivati', lingua: '', attivo: nessuna, spento: true }].concat(f.sott.voci);
      colonne.push({ tipo: 'sott', titolo: 'Sottotitoli', voci: voci, fonte: f.sott });
    }
    var fs = formatoScelto();
    colonne.push({ tipo: 'schermo', titolo: 'Schermo', voci: ogni(FORMATI, function (x) { return { id: x.id, nome: x.nome, attivo: x.id === fs }; }),
      fonte: { scegli: function (x) { salvaScelta('formato', x.id); applicaFormato(v); } } });
    for (var c = 0; c < colonne.length; c++) colonne[c].sel = indiceAttivo(colonne[c].voci);
    return colonne;
  }
  function apriPannelloLingue(v) {
    var colonne = colonneLingue(v), col = 0;
    for (var c = 0; c < colonne.length; c++) if (colonne[c].tipo === ultimaColonna) col = c;
    if (colonne.length > 1 && colonne[col].tipo === 'schermo' && ultimaColonna !== 'schermo') col = 0;
    pannelloLingue = { colonne: colonne, col: col };
    serie.fuoco = 'video';
    disegnaPannelloLingue();
    disegnaChips();
    mostraLettore();
  }
  function disegnaPannelloLingue() {
    if (!lettore) return;
    var box = pezzo('hl-lingue');
    if (!pannelloLingue) { box.style.display = 'none'; scriviHtml(box, ''); return; }
    var html = '';
    for (var c = 0; c < pannelloLingue.colonne.length; c++) {
      var col = pannelloLingue.colonne[c];
      html += '<div class="hl-col' + (c === pannelloLingue.col ? ' hometv-sel' : '') + '"><h3>' + col.titolo + '</h3><div class="hl-elenco">';
      for (var i = 0; i < col.voci.length; i++) {
        html += '<div class="hl-voce' + (i === col.sel ? ' hometv-sel' : '') + (col.voci[i].attivo ? ' hl-attiva' : '') + '">' +
          ICONE.spunta + String(col.voci[i].nome).replace(/[<>&"]/g, '') + '</div>';
      }
      html += '</div></div>';
    }
    scriviHtml(box, html);
    box.style.display = 'block';
    // elenchi lunghi: la voce scelta resta sempre in vista
    var el = box.querySelectorAll('.hl-elenco');
    for (var k = 0; k < el.length; k++) {
      var s = el[k].querySelector('.hl-voce.hometv-sel');
      if (!s) continue;
      if (s.offsetTop < el[k].scrollTop) el[k].scrollTop = s.offsetTop;
      else if (s.offsetTop + s.offsetHeight > el[k].scrollTop + el[k].clientHeight) el[k].scrollTop = s.offsetTop + s.offsetHeight - el[k].clientHeight;
    }
  }
  function chiudiPannelloLingue() {
    pannelloLingue = null;
    disegnaPannelloLingue();
    disegnaChips();
    mostraLettore();
  }
  function sceltaLingua() {
    var col = pannelloLingue.colonne[pannelloLingue.col], x = col.voci[col.sel];
    ultimaColonna = col.tipo;
    if (col.tipo !== 'schermo' && lettoreVideo) lettoreVideo.__hometvSceltaLingue = Date.now();
    try { col.fonte.scegli(x.spento ? null : x); } catch (e) { log('lingua', e); }
    if (col.tipo === 'audio') salvaScelta('audio', x.lingua || x.nome);
    else if (col.tipo === 'sott') salvaScelta('sott', x.spento ? 'off' : (x.lingua || x.nome));
    chiudiPannelloLingue();
    avvisoLettore((col.tipo === 'audio' ? 'Audio: ' : col.tipo === 'sott' ? 'Sottotitoli: ' : 'Schermo: ') + x.nome, 2000);
  }
  function tastoPannelloLingue(azione) {
    var col = pannelloLingue.colonne[pannelloLingue.col];
    if (azione === 'su') col.sel = Math.max(0, col.sel - 1);
    else if (azione === 'giu') col.sel = Math.min(col.voci.length - 1, col.sel + 1);
    else if (azione === 'sx') pannelloLingue.col = Math.max(0, pannelloLingue.col - 1);
    else if (azione === 'dx') pannelloLingue.col = Math.min(pannelloLingue.colonne.length - 1, pannelloLingue.col + 1);
    else if (azione === 'ok') { sceltaLingua(); return true; }
    else if (azione === 'indietro' || azione === 'stop') { chiudiPannelloLingue(); return true; }
    else return false;
    disegnaPannelloLingue();
    mostraLettore();
    return true;
  }

  // --- serie: episodio prossimo / precedente (solo se esistono davvero sul sito)
  // fuoco: 'video', oppure uno dei pulsanti in basso a destra: 'prec', 'inizio', 'succ'
  var serie = { succ: null, prec: null, fuoco: 'video', conto: 0, contoDa: 0, timer: null, autoAnnullato: false, dopoFine: false, partito: false };
  var serieScan = 0;
  var PULSANTI = ['prec', 'inizio', 'succ'];
  // Come i siti chiamano i pulsanti delle puntate (italiano, inglese e qualche altra lingua).
  var EP = '(episodi[oa]|puntata|ep\\.?|epis\\.?|parte|capitolo|episode|folge|episodio)';
  var DOPO_TESTO = new RegExp(
    'prossim[oa]\\s+' + EP + '|' + EP + '\\s+(successiv[oa]|seguente|dopo|prossim[oa])|' +
    '(vai|passa|guarda|riproduci|continua|avanti)\\s+(al(la|l\')?|il|la|l\'|con\\s+(il|la|l\'))?\\s*(prossim[oa]|successiv[oa])(?!\\s+film)|' +
    'successiv[oa]\\s+' + EP + '|next\\s+(episode|ep\\b|part|chapter)|play\\s+next\\s+episode|' +
    'continue\\s+to\\s+next|siguiente\\s+episodio|episodio\\s+siguiente|' +
    '(\\u00e9pisode|episode)\\s+suivant|n(\\u00e4|ae)chste\\s+folge|' +
    // lettori come Jellyfin/Emby: "Traccia successiva" = puntata dopo
    'next\\s+track|traccia\\s+successiva|prossima\\s+traccia', 'i');
  var PRIMA_TESTO = new RegExp(
    EP + '\\s+(precedente|prima|anteriore|scors[oa])|(precedente|scors[oa])\\s+' + EP + '|' +
    '(torna|vai|passa)\\s+al(la|l\')?\\s*' + EP + '?\\s*precedente|' +
    '(previous|prev\\.?|last)\\s+(episode|ep\\b|part|chapter)|episodio\\s+anterior|anterior\\s+episodio|' +
    '(\\u00e9pisode|episode)\\s+pr(\\u00e9|e)c(\\u00e9|e)dent|vorherige\\s+folge|' +
    '(previous|prev\\.?)\\s+track|traccia\\s+precedente', 'i');
  // nelle classi e negli id: next-episode, btnNextEp, ep_prev, episodio-successivo, btnNextTrack...
  var DOPO_ATTR = /(next|prossim|success|seguent)[-_\s]?(ep|episod|puntat|part)|(ep|episod|puntat)[a-z0-9]*[-_\s]?(next|prossim|success|seguent)|next[-_]?track/i;
  var PRIMA_ATTR = /(prev(?!iew)|preced|scors)[a-z]*[-_\s]?(ep|episod|puntat|part)|(ep|episod|puntat)[a-z0-9]*[-_\s]?(prev(?!iew)|preced|scors)|prev(ious)?[-_]?track/i;
  var CLICCABILI = 'a[href], button, [role="button"], [onclick]';

  function episodioVisibile(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false; // nascosto dal sito (display:none)
    return window.getComputedStyle(el).display !== 'none';
  }
  function testoBreve(el) { return (el.textContent || '').slice(0, 400).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
  function spento(el) { return el.disabled || el.getAttribute('aria-disabled') === 'true' || /(^|\s)(disabled|is-disabled)(\s|$)/i.test(typeof el.className === 'string' ? el.className : ''); }
  // un contenitore con la classe giusta: si clicca il pulsante che ha dentro
  function cliccabileIn(el) {
    if (!el) return null;
    if (el.matches(CLICCABILI)) return el;
    return el.querySelector(CLICCABILI) || el;
  }

  function cercaPerNome(dir) {
    var tTesto = dir > 0 ? DOPO_TESTO : PRIMA_TESTO, tAttr = dir > 0 ? DOPO_ATTR : PRIMA_ATTR;
    // pulsanti e link, piu' gli elementi che dalla classe o dall'id sembrano "avanti/indietro"
    // (i siti fatti con React spesso usano un <div> cliccabile)
    var c;
    try {
      c = document.querySelectorAll(ProfiloTV.selettore(CLICCABILI + ', [class*="next" i], [class*="prev" i], [id*="next" i], [id*="prev" i], ' +
        '[class*="success" i], [class*="preced" i], [class*="prossim" i], [data-testid]'));
    } catch (e) { c = document.querySelectorAll(CLICCABILI); }
    for (var i = 0; i < c.length; i++) {
      var el = c[i];
      if (el.id && el.id.indexOf('hometv-') === 0) continue;
      var attr = [typeof el.className === 'string' ? el.className : '', el.id, el.getAttribute('data-action'), el.getAttribute('rel'),
        el.getAttribute('data-testid'), el.getAttribute('name')].join(' ');
      var perAttr = tAttr.test(attr);
      if (!perAttr && !el.matches(CLICCABILI)) continue; // per il testo servono veri pulsanti o link
      var testo = testoBreve(el);
      if (testo.length > 80) continue; // contenitori grandi: no
      if (!perAttr && !tTesto.test([testo, el.getAttribute('aria-label'), el.getAttribute('title')].join(' '))) continue;
      if (spento(el) || !episodioVisibile(el)) continue; // pulsante spento o nascosto = non c'e'
      return perAttr ? cliccabileIn(el) : el;
    }
    return null;
  }

  // Elenco delle puntate con quella in corso segnata (classe "active", aria-current,
  // o il link alla pagina stessa): la voce prima e quella dopo sono le vicine.
  var CORRENTE = /(^|[\s_-])(active|current|selected|playing|now-?playing|attiv[oa]|corrente|in-?riproduzione)([\s_-]|$)/i;
  var PUNTATA = /episod|puntat|\bep\.?\s*\d|\be\d{1,3}\b|\bs\d{1,2}\s*e\d{1,3}|^\d{1,3}([\s.:)\-]|$)/i;
  function voceDiElenco(el) {
    // la voce: il primo antenato che ha fratelli dello stesso tipo
    for (var n = el, i = 0; n && n !== document.body && i < 5; n = n.parentElement, i++) {
      var p = n.parentElement;
      if (!p) return null;
      var simili = 0;
      for (var c = p.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === n.tagName) simili++;
      if (simili >= 2) return n;
    }
    return null;
  }
  function vocePuntata(v) {
    var a = v.querySelector('a[href]') || (v.matches('a[href]') ? v : null);
    return PUNTATA.test(testoBreve(v).slice(0, 80)) || (!!a && /episod|puntat|[?&\/_-]e(p(isode)?)?[-_=]?\d/i.test(a.getAttribute('href') || ''));
  }
  // niente numeri di pagina: un elenco "1 2 3" di pagine non e' un elenco di puntate
  var PAGINE = ProfiloTV.selettore('[class*="pagin" i], [id*="pagin" i], [aria-label*="pagin" i], [class*="pager" i]');
  function traLePagine(el) { try { return !!el.closest(PAGINE); } catch (e) { return false; } }
  function puntataInCorso() {
    var qui = location.href.split('#')[0], i, voce;
    var a = document.querySelectorAll('a[href]');
    for (i = 0; i < a.length; i++) {
      if (hrefDi(a[i]).split('#')[0] !== qui || !vocePuntata(a[i]) || traLePagine(a[i])) continue;
      voce = voceDiElenco(a[i]);
      if (voce) return voce;
    }
    var m = document.querySelectorAll('[aria-current], [class*="active"], [class*="current"], [class*="selected"], [class*="playing"], [class*="attiv"], [class*="corrente"]');
    for (i = 0; i < m.length; i++) {
      var el = m[i], cur = el.getAttribute('aria-current');
      if (cur === 'false' || (cur === null && !CORRENTE.test(typeof el.className === 'string' ? el.className : ''))) continue;
      if ((el.id && el.id.indexOf('hometv-') === 0) || /^(HTML|BODY|MAIN)$/.test(el.tagName) || traLePagine(el)) continue;
      if (!vocePuntata(el)) continue;
      voce = voceDiElenco(el);
      if (voce) return voce;
    }
    return null;
  }
  function cercaInElenco(dir) {
    var voce = puntataInCorso();
    if (!voce) return null;
    var puntate = 0;
    for (var c = voce.parentElement.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === voce.tagName && vocePuntata(c)) puntate++;
    if (puntate < 2) return null;
    var v = dir > 0 ? voce.nextElementSibling : voce.previousElementSibling;
    while (v && v.tagName !== voce.tagName) v = dir > 0 ? v.nextElementSibling : v.previousElementSibling;
    if (!v || !vocePuntata(v)) return null;
    var el = cliccabileIn(v);
    if (!el || spento(el) || !(episodioVisibile(el) || episodioVisibile(v))) return null;
    return el;
  }

  // numero della puntata in corso: "Episodio 3", "Ep. 3", "Puntata 3", "S1E3", ".../episodio-3", "?ep=3"
  var NUM_TESTO = /(?:episodi[oa]|puntata|ep\.?|episode|folge)\s*n?\.?\s*0*(\d{1,3})(?!\d)|\bs\d{1,2}\s*e0*(\d{1,3})(?!\d)/i;
  function numeroEpisodio() {
    var og = document.querySelector('meta[property="og:title"]'), h1 = document.querySelector('h1');
    var fonti = [og && og.getAttribute('content'), h1 && h1.textContent, document.title];
    for (var i = 0; i < fonti.length; i++) {
      var m = fonti[i] && NUM_TESTO.exec(fonti[i]);
      if (m) return +(m[1] || m[2]);
    }
    var via = location.pathname;
    try { via = decodeURIComponent(via); } catch (e) {} // indirizzi scritti in Latin-1 ("/perch%E8")
    var u = /(?:episodi[oa]|puntata|episode|ep)[-_]?0*(\d{1,3})(?!\d)/i.exec(via) ||
      /[?&](?:ep|episode|episodio|e)=0*(\d{1,3})(?!\d)/i.exec(location.search);
    return u ? +u[1] : 0;
  }
  function cercaPerNumero(dir) {
    var n = numeroEpisodio();
    if (!n || n + dir < 1) return null;
    var voluto = n + dir;
    var reTesto = new RegExp('(?:episodi[oa]|puntata|ep\\.?|episode|folge)\\s*n?\\.?\\s*0*' + voluto + '(?!\\d)|\\bs\\d{1,2}\\s*e0*' + voluto + '(?!\\d)', 'i');
    var reLink = new RegExp('(?:episodi[oa]|puntata|episode|ep)[-_]?0*' + voluto + '(?!\\d)|[?&](?:ep|episode|episodio|e)=0*' + voluto + '(?!\\d)', 'i');
    var qui = location.href.split('#')[0];
    var a = document.querySelectorAll('a[href]');
    for (var i = 0; i < a.length; i++) {
      if (!hrefDi(a[i]) || hrefDi(a[i]).split('#')[0] === qui || !episodioVisibile(a[i])) continue;
      var t = testoBreve(a[i]);
      if (t.length <= 80 && reTesto.test(t + ' ' + (a[i].getAttribute('title') || ''))) return a[i];
    }
    for (var j = 0; j < a.length; j++) {
      var h = a[j].getAttribute('href') || '';
      try { h = decodeURIComponent(h); } catch (e) {}
      if (hrefDi(a[j]) && hrefDi(a[j]).split('#')[0] !== qui && episodioVisibile(a[j]) && reLink.test(h)) return a[j];
    }
    return null;
  }

  // dir: +1 prossimo, -1 precedente. Ritorna il pulsante/link solo se esiste davvero.
  // una pagina fatta in modo strano non deve mai fermare il lettore: nel dubbio, niente pulsante
  function trovaEpisodio(dir) {
    try { return cercaPerNome(dir) || cercaInElenco(dir) || cercaPerNumero(dir); } catch (e) { log('puntate', e); return null; }
  }

  // Lettore dentro un riquadro (il video arriva da un altro sito): i pulsanti delle
  // puntate stanno nella pagina che lo contiene, che risponde per lui.
  var serieSito = { succ: false, prec: false, titolo: '', chiesto: 0 };
  var DAL_SITO_SUCC = { dalSito: 1 }, DAL_SITO_PREC = { dalSito: -1 };
  function chiediSerieAlSito() {
    if (!IN_FRAME || Date.now() - serieSito.chiesto < 1500) return;
    serieSito.chiesto = Date.now();
    try { window.top.postMessage({ hometv: 'serie?' }, '*'); } catch (e) {}
  }

  function aggiornaSerie(forza) {
    if (!forza && Date.now() - serieScan < 3000) return !!(serie.succ || serie.prec);
    serieScan = Date.now();
    serie.succ = trovaEpisodio(1);
    serie.prec = trovaEpisodio(-1);
    if (IN_FRAME) {
      chiediSerieAlSito();
      if (!serie.succ && serieSito.succ) serie.succ = DAL_SITO_SUCC;
      if (!serie.prec && serieSito.prec) serie.prec = DAL_SITO_PREC;
    }
    if (serie.fuoco !== 'video' && !pulsanteDisponibile(serie.fuoco)) serie.fuoco = pulsantiDisponibili()[0] || 'video';
    return !!(serie.succ || serie.prec);
  }

  // "Ricomincia da capo": quando si e' gia' dentro il video (non nei primi secondi)
  function puoRicominciare() { return !!lettoreVideo && lettoreVideo.currentTime >= 20 && serie.conto === 0; }
  function pulsanteDisponibile(k) {
    if (k === 'succ') return !!serie.succ;
    if (k === 'prec') return !!serie.prec && serie.conto === 0;
    if (k === 'inizio') return puoRicominciare();
    return false;
  }
  function pulsantiDisponibili() {
    var out = [];
    for (var i = 0; i < PULSANTI.length; i++) if (pulsanteDisponibile(PULSANTI[i])) out.push(PULSANTI[i]);
    return out;
  }

  var ultimoAiuto = '';
  function aggiornaAiuto() {
    if (!lettore) return;
    var ep = !!(serie.succ || serie.prec), ric = puoRicominciare();
    var t = 'OK pausa &middot; &#9664; &#9654; 10 s &middot; ' +
      (ep ? 'Su episodi &middot; ' : (ric ? 'Su ricomincia &middot; ' : '')) + 'Gi&ugrave; audio e sottotitoli &middot; Indietro esci';
    if (t !== ultimoAiuto) { ultimoAiuto = t; scriviHtml(pezzo('hl-aiuto'), t); }
  }

  var GIRO = 106.8; // lunghezza del cerchio del conto alla rovescia (raggio 17)
  function mettiChip(k, si, html) {
    var el = pezzo('hl-' + k);
    if (!si) { el.style.display = 'none'; el.className = 'hl-chip hl-' + k; return; }
    if (el.__hometvHtml !== html) { scriviHtml(el, html); el.__hometvHtml = html; }
    el.className = 'hl-chip hl-' + k + (serie.fuoco === k ? ' hometv-sel' : '');
    el.style.display = 'flex';
  }
  function disegnaChips() {
    if (!lettore) return;
    var nascosti = !!pannelloLingue, conto = serie.conto > 0 && !!serie.succ;
    mettiChip('prec', !nascosti && !conto && pulsanteDisponibile('prec'), ICONE.prec + 'Episodio precedente');
    mettiChip('inizio', !nascosti && !conto && pulsanteDisponibile('inizio'), ICONE.ricomincia + 'Ricomincia da capo');
    mettiChip('succ', !nascosti && !conto && !!serie.succ, ICONE.succ + 'Prossimo episodio');
    // fine della puntata: "Prossimo episodio tra 5, 4, 3..." grande, con il cerchio che si riempie
    var card = pezzo('hl-prossimo');
    if (conto && !nascosti) {
      var tot = serie.contoDa || 10;
      card.querySelector('b').textContent = String(serie.conto);
      card.querySelector('span').textContent = 'Parte tra ' + serie.conto + (serie.conto === 1 ? ' secondo' : ' secondi');
      card.querySelector('.hl-avanza').style.strokeDashoffset = String(GIRO * Math.max(0, serie.conto - 1) / tot);
      card.style.display = 'flex';
    } else card.style.display = 'none';
    aggiornaAiuto();
  }

  function ricominciaDaCapo() {
    var v = lettoreVideo;
    if (!v) return;
    riprendiFinoA = 0;
    serie.fuoco = 'video';
    try { v.currentTime = 0; } catch (e) {}
    partiDavvero(v);
    avvisoLettore('Dall\'inizio', 1500);
    centro('play');
    mostraLettore();
  }

  // Fine della puntata: negli ultimi 10 secondi compare "Prossimo episodio tra 10, 9...",
  // al passo col video (se lo metti in pausa si ferma anche il conto); finito il video si
  // va alla puntata dopo. Se il video finisce senza il conto (un salto in avanti) si
  // contano 5 secondi. OK va subito, Indietro annulla.
  var CONTO_FINALE = 10;
  function contoFinale(v) {
    if (serie.dopoFine || serie.autoAnnullato || serie.partito) return;
    var d = v.duration;
    if (!isFinite(d) || d < 120) return;
    var resta = d - v.currentTime;
    if (resta > CONTO_FINALE + 0.3 || resta <= 0) {
      if (serie.conto > 0) { annullaConto(true); disegnaChips(); mostraLettore(); }
      return;
    }
    if (serie.conto === 0) {
      aggiornaSerie(true);
      if (!serie.succ) return;
      serie.contoDa = CONTO_FINALE;
    }
    var n = Math.max(1, Math.ceil(resta - 0.05));
    if (n === serie.conto) return;
    serie.conto = n;
    disegnaChips();
    mostraLettore();
    if (n === 1) attendiFine(v);
  }
  // ultimo secondo: se il video si ferma senza dire "finito" (capita), si va avanti lo stesso
  function attendiFine(v) {
    clearTimeout(serie.timer);
    var visto = v.currentTime, fermo = 0;
    (function guarda() {
      serie.timer = setTimeout(function () {
        if (lettoreVideo !== v || serie.conto !== 1 || serie.dopoFine || serie.partito) return;
        if (v.paused && !v.ended) { guarda(); return; } // messo in pausa: si aspetta
        fermo = v.currentTime === visto ? fermo + 1 : 0;
        visto = v.currentTime;
        if (v.ended || v.duration - v.currentTime < 0.4 || fermo >= 2) { finePuntata(v); return; }
        guarda();
      }, 800);
    })();
  }
  function finePuntata(v) {
    if (lettoreVideo !== v || serie.partito) return;
    salvaPosizione(v);
    if (serie.autoAnnullato) { esciSchermoIntero(); return; }
    aggiornaSerie(true);
    if (!serie.succ) { esciSchermoIntero(); return; } // film o ultima puntata: si torna alla pagina
    if (serie.conto > 0 && serie.conto <= 2 && !serie.dopoFine) { vaiProssimo(); return; }
    clearTimeout(serie.timer);
    serie.dopoFine = true;
    serie.contoDa = 5;
    serie.conto = 5;
    disegnaChips();
    mostraLettore();
    (function passo() {
      serie.timer = setTimeout(function () {
        if (!serie.dopoFine || serie.autoAnnullato || lettoreVideo !== v) return;
        serie.conto--;
        if (serie.conto <= 0) { vaiProssimo(); return; }
        disegnaChips();
        passo();
      }, 1000);
    })();
  }
  function vaiProssimo() {
    clearTimeout(serie.timer);
    var s = serie.succ;
    serie.partito = true;
    serie.conto = 0;
    serie.dopoFine = false;
    disegnaChips();
    vaiEpisodio(s, 1);
  }
  // annullato a mano (Indietro) o perche' si e' tornati indietro nel video
  function annullaConto(daSolo) {
    clearTimeout(serie.timer);
    if (serie.conto > 0 && !daSolo) serie.autoAnnullato = true;
    serie.conto = 0;
    serie.dopoFine = false;
  }

  // Un clic come quello di una persona (pressione, rilascio, clic) sul pulsante vero: molti
  // siti ascoltano "mousedown" o "pointerup", oppure il pulsante e' un <div> dentro un contenitore.
  function bersaglioClic(el) {
    if (el.tagName === 'LABEL' && el.control) return el.control; // "accetto la privacy": la casella, non il link
    if (el.matches(CLICCABILI + ', input')) return el;
    var l = el.querySelectorAll(CLICCABILI), i, r;
    for (i = 0; i < l.length && i < 20; i++) { r = l[i].getBoundingClientRect(); if (r.width >= 4 && r.height >= 4) return l[i]; }
    var tutti = el.querySelectorAll('*');
    for (i = 0; i < tutti.length && i < 40; i++) {
      if (window.getComputedStyle(tutti[i]).cursor !== 'pointer') continue;
      r = tutti[i].getBoundingClientRect();
      if (r.width >= 4 && r.height >= 4) return tutti[i];
    }
    return el;
  }
  function cliccaDavvero(el) {
    var t = bersaglioClic(el), r = t.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    // come col mouse: arriva all'elemento proprio sotto il dito (se fa parte del pulsante;
    // se sopra c'e' altro, per esempio uno strato pubblicitario, si salta)
    var sotto = null;
    try { sotto = document.elementFromPoint(x, y); } catch (e) {}
    if (sotto && sotto !== t && t.contains(sotto)) t = sotto;
    var giu = ['pointerdown', 'mousedown'], su = ['pointerup', 'mouseup'];
    clicDaNoi = Date.now();
    function lancia(tipo, premuto) {
      var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: premuto ? 1 : 0 };
      try {
        var e;
        if (tipo.indexOf('pointer') === 0 && MOTORE.puntatore) {
          o.pointerType = 'mouse'; o.isPrimary = true; o.pointerId = 1;
          e = new PointerEvent(tipo, o);
        } else e = new MouseEvent(tipo, o);
        t.dispatchEvent(e);
      } catch (x2) {}
    }
    for (var i = 0; i < giu.length; i++) lancia(giu[i], true);
    for (var j = 0; j < su.length; j++) lancia(su[j], false);
    // il clic vero e proprio, nel punto: anche sulle icone disegnate (SVG), che il clic "da script" non lo hanno
    var cliccato = false;
    try {
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y,
        screenX: x, screenY: y, button: 0, buttons: 0, detail: 1 }));
      cliccato = true;
    } catch (e) {}
    if (!cliccato) { try { t.click(); } catch (e) {} }
    return t;
  }
  function descriviPulsante(el) {
    var cl = typeof el.className === 'string' ? el.className.replace(/\s+/g, '.').replace(/^\.|\.$/g, '') : '';
    var t = testoBreve(el).slice(0, 30) || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cl ? '.' + cl.slice(0, 40) : '') + (t ? ' "' + t + '"' : '');
  }

  // dir: +1 prossimo, -1 precedente (serve per cercare un'altra strada se il sito non risponde)
  function vaiEpisodio(el, dir) {
    if (!el) return;
    if (el.dalSito) { // i pulsanti sono nella pagina che contiene il lettore: ci pensa lei
      try { window.top.postMessage({ hometv: 'vaiEpisodio', dir: el.dalSito }, '*'); } catch (e) {}
      return;
    }
    // la pagina della puntata nuova fara' partire il video da sola
    segnaProssimo();
    avviaProssimoFinoA = Date.now() + 30000;
    var stessaPagina = el.tagName === 'A' && el.href.split('#')[0] === location.href.split('#')[0];
    if (el.tagName === 'A' && /^https?:/i.test(el.href) && !stessaPagina) { location.href = el.href; return; }
    var prima = location.href, v = videoAttivo(), src = v ? (v.currentSrc || v.src) : '', t0 = v ? v.currentTime : 0;
    cliccaDavvero(el);
    // puntata nuova nella stessa pagina (o la pagina cambia da sola): si controlla che parta
    setTimeout(function () { avviaDopoProssimo(true, { v: v, src: src, t: t0 }); }, 700);
    if (!dir) return;
    // dopo un paio di secondi: se non e' cambiato niente (pagina, video), si prova un'altra strada
    setTimeout(function () {
      var v2 = videoAttivo();
      if (location.href !== prima || v2 !== v || (v2 && ((v2.currentSrc || v2.src) !== src || v2.currentTime < t0 - 5))) return;
      var altri = [cercaInElenco(dir), cercaPerNumero(dir)];
      for (var i = 0; i < altri.length; i++) {
        var a = altri[i];
        if (!a || a === el || a.contains(el) || el.contains(a)) continue;
        if (a.tagName === 'A' && /^https?:/i.test(a.href) && a.href.split('#')[0] !== prima.split('#')[0]) location.href = a.href;
        else cliccaDavvero(a);
        return;
      }
      var msg = 'Il sito non apre la puntata ' + (dir > 0 ? 'dopo' : 'prima') + ' (pulsante ' + descriviPulsante(el) + ')';
      log(msg);
      if (lettoreVideo) avvisoLettore(msg, 6000); else toast(msg, 6000);
    }, 2500);
  }

  /* ---------------------------------------------------------------- la puntata nuova parte davvero
   * Appena aperta la puntata dopo si controlla per una trentina di secondi che il video
   * vada davvero (il tempo deve avanzare), provando nell'ordine: play del video; se il
   * browser non lascia partire con l'audio, si parte senza e il primo tasto lo riattiva;
   * il pulsante "Play" grande del player del sito; un clic sul video. Il lettore in un
   * riquadro di un altro sito ci pensa da solo (glielo si chiede).
   */
  var avviaProssimoFinoA = 0, avvioInCorso = 0, videoZittito = null;
  var MARCA_PROSSIMO = 'hometv-prossimo:';
  function segnaProssimo() {
    try { sessionStorage.setItem('hometv-prossimo', String(Date.now())); } catch (e) {}
    // anche se la puntata dopo sta su un altro indirizzo del sito
    try { if (!window.name || window.name.indexOf(MARCA_PROSSIMO) === 0) window.name = MARCA_PROSSIMO + Date.now(); } catch (e) {}
  }
  function leggiProssimo() {
    var da = 0;
    try { da = +sessionStorage.getItem('hometv-prossimo') || 0; sessionStorage.removeItem('hometv-prossimo'); } catch (e) {}
    try {
      if (window.name.indexOf(MARCA_PROSSIMO) === 0) {
        da = Math.max(da, +window.name.slice(MARCA_PROSSIMO.length) || 0);
        window.name = '';
      }
    } catch (e) {}
    return da;
  }
  function faiPartire(v) {
    var pr = null;
    try { pr = v.play(); } catch (e) {}
    if (!pr || typeof pr.then !== 'function') return;
    pr.then(null, function (err) {
      if (err && err.name === 'NotAllowedError' && !v.muted) partiSenzaAudio(v);
    });
  }
  // il browser non lascia partire il video con l'audio: si parte senza (il primo tasto del telecomando lo riattiva)
  function partiSenzaAudio(v) {
    v.muted = true;
    v.__hometvAudioProvato = true; // il browser l'ha appena vietato: niente nuovo tentativo, solo l'avviso
    videoZittito = v;
    try { var p2 = (origPlay || v.play).call(v); if (p2 && p2['catch']) p2['catch'](function () {}); } catch (e) {}
    offriAudio(v);
  }
  var SEL_PLAY = '.vjs-big-play-button, .jw-display-icon-display, .jw-icon-display, .plyr__control--overlaid, .shaka-play-button, ' +
    '.bmpui-ui-hugeplaybacktogglebutton, .mejs__overlay-play, .mejs-overlay-play, .fp-play, .play-wrapper, .vds-play-button, ' +
    'media-play-button, .dplayer-mobile-play, .xgplayer-start, .ytp-large-play-button, [class*="big-play" i], [class*="play-button" i], ' +
    '[class*="playbutton" i], [class*="btn-play" i], [class*="play-btn" i], [class*="play-icon" i], [aria-label*="play" i], ' +
    '[aria-label*="riproduci" i], [title*="play" i], [title*="riproduci" i]';
  SEL_PLAY = ProfiloTV.selettore(SEL_PLAY);
  function pulsantePlay(v) {
    var radice = v ? contenitorePlayer(v) : document.body, lista;
    if (!radice) return null;
    try { lista = radice.querySelectorAll(SEL_PLAY); } catch (e) { return null; }
    var migliore = null, area = 0;
    for (var i = 0; i < lista.length; i++) {
      var el = lista[i];
      var nome = ((typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
      if (/pause|pausa|playlist|autoplay|playback|speed|velocit|display-?name|replay|trailer/.test(nome + ' ' + testoBreve(el).slice(0, 60).toLowerCase())) continue;
      if (el.id && el.id.indexOf('hometv-') === 0) continue;
      var r = el.getBoundingClientRect(), a = r.width * r.height;
      if (r.width < 16 || r.height < 16 || !siVede(el)) continue;
      if (a > area) { area = a; migliore = el; }
    }
    return migliore;
  }
  // un video che non sta andando davvero: in pausa, oppure vuoto (play() su un video ancora senza niente da mostrare
  // toglie la pausa ma non parte: il sito lo riempie col suo pulsante Play)
  function vuoto(v) { return !(v.currentSrc || v.src || v.querySelector('source[src]')) && v.readyState === 0; }
  function fermo(v) { return v.paused || vuoto(v); }
  // il video (o il suo lettore) sta caricando: dati in arrivo, o la rotellina del lettore
  function staCaricando(v) {
    if (v.networkState === 2 && v.readyState < 3) return true; // NETWORK_LOADING
    var c = contenitorePlayer(v);
    return !!c && typeof c.className === 'string' && /loading|waiting|buffering|spinner|caricamento/i.test(c.className);
  }
  // OK, Play o un clic sul video: deve partire davvero (come la puntata dopo, vedi qui sotto)
  function partiDavvero(v) { avviaDopoProssimo(true, null, v); }
  // l'hai fermato tu (pausa, Indietro, Stop, uscita dallo schermo intero): niente piu' tentativi di farlo partire
  function fermaAvvio() { avvioInCorso++; avviaProssimoFinoA = 0; avvioDaTe = null; }
  // hai fatto altro (frecce fuori dal video, un clic su un'altra cosa) mentre partiva il video che avevi chiesto tu: hai
  // cambiato idea. La puntata dopo che parte da sola non si ferma per questo (solo con pausa, Indietro, Stop)
  function altroDaTe(el) {
    if (!avvioDaTe) return;
    var c = el && avvioDaTe.isConnected ? contenitorePlayer(avvioDaTe) : null;
    if (!(c && (c === el || c.contains(el)))) fermaAvvio();
  }
  var avvioDaTe = null; // il video che hai chiesto tu (OK, Play, clic) e che si sta facendo partire
  // quando si e' premuto il Play del sito, e per quale video (quello che hai chiesto tu): vale anche per i tentativi dopo
  // sullo stesso video (OK o Play di nuovo), perche' due pressioni vicine spengono i lettori che fanno da interruttore
  var premutoA = 0, premutoPer = null;
  // La finestrella del sito "Vuoi riprendere la visione? Hai interrotto a 2:36" (Riprendi / Dall'inizio) mentre la home
  // fa partire il video: risponde la home come hai chiesto (Continua a guardare: Riprendi; "Ricomincia dall'inizio" o la
  // puntata dopo: Dall'inizio). Si cerca il testo che chiede di riprendere e, nel suo riquadro, il pulsante giusto
  var CHIEDE_RIPRESA = /riprendere la visione|riprendi(re)? (la )?visione|vuoi riprendere|vuoi continuare|hai interrotto|interrotto (a|al)|continuare a guardare|resume (watching|playback|the video)|continue watching|you (stopped|left off)|pick up where/i;
  var PULS_DA_CAPO = /dall'?\s*inizio|ricomincia|da capo|start over|from (the )?(start|beginning)|restart/i;
  var PULS_RIPRENDI = /riprendi|continua|resume|continue|^s[i\u00ec]$|^yes$/i;
  var ripreseRisposte = [];
  function testoDi(el) { return String(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
  function boxRipresa() {
    var b = document.body;
    if (!b || !CHIEDE_RIPRESA.test(b.textContent || '')) return null; // quasi sempre si esce qui
    var w, t;
    try { w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, null, false); } catch (e) { return null; }
    while ((t = w.nextNode())) {
      if (!CHIEDE_RIPRESA.test(t.nodeValue || '')) continue;
      for (var n = t.parentElement, k = 0; n && k < 7 && n !== b; n = n.parentElement, k++) {
        if ((n.textContent || '').length > 600) break;
        if (ripreseRisposte.indexOf(n) === -1 && siVede(n) && pulsantiRipresa(n).length >= 1) return n;
      }
    }
    return null;
  }
  // i pulsanti del riquadro: le cose cliccabili, o le foglie con un testo corto (pulsanti fatti di <div>)
  function pulsantiRipresa(box) {
    var out = [], l = box.querySelectorAll('*');
    for (var i = 0; i < l.length && i < 300; i++) {
      var e = l[i], cl = e.tagName === 'BUTTON' || e.tagName === 'A' || e.getAttribute('role') === 'button' || e.hasAttribute('tabindex') ||
        e.hasAttribute('onclick') || (!e.firstElementChild && testoDi(e).length && testoDi(e).length <= 30);
      if (!cl || !siVede(e)) continue;
      var dentro = false;
      for (var j = 0; j < out.length; j++) if (out[j].contains(e) || e.contains(out[j])) dentro = true;
      if (!dentro) out.push(e);
    }
    return out;
  }
  function rispondiRipresa() {
    var box = boxRipresa();
    if (!box) return false;
    var c = CFG.continua, daCapo = !!(c && c.fresco === true && c.posizione === 0 && !c.riproduci);
    var p = pulsantiRipresa(box), scelto = null, altro = null;
    for (var i = 0; i < p.length; i++) {
      var t = testoDi(p[i]);
      if (PULS_DA_CAPO.test(t)) { if (daCapo) scelto = p[i]; }
      else if (PULS_RIPRENDI.test(t)) { if (!daCapo && !scelto) scelto = p[i]; }
      else if (!altro && !CHIEDE_RIPRESA.test(t)) altro = p[i];
    }
    if (!scelto && !daCapo) scelto = altro; // "Riprendi" fatto con un'icona: l'altro pulsante
    if (!scelto) return false;
    ripreseRisposte.push(box);
    cliccaDavvero(scelto);
    log('il sito chiedeva se riprendere:', daCapo ? "dall'inizio" : 'riprendi');
    return true;
  }

  function avviaDopoProssimo(subito, prima, voluto) {
    if (YT_TV) return; // YouTube per la TV fa partire da solo il video di #/watch
    if (!subito && Date.now() - leggiProssimo() > 30000) return;
    var mio = ++avvioInCorso, partenza = Date.now(), visto = -1, prove = 0, ultimaProva = 0, chiesto = false;
    // (la puntata dopo che parte da sola non dice quale video: vale come lo stesso)
    if (Date.now() - premutoA >= 7000 || (voluto && premutoPer && voluto !== premutoPer)) premutoA = 0;
    premutoPer = voluto || (premutoA ? premutoPer : null);
    avvioDaTe = voluto || null;
    avviaProssimoFinoA = Date.now() + 30000;
    ultimoOk = chiestoPlayA = Date.now(); // vale come se avessi premuto Play
    // il Play del sito (o il video) si preme di nuovo solo dopo 7 s, e solo se il video ha gia' una sorgente e non sta
    // caricando: tanti lettori sono interruttori, e una seconda pressione mentre caricano li fermerebbe
    function premi(el) { cliccaDavvero(el); premutoA = Date.now(); }
    function ripremere(v) {
      if (!premutoA) return true;
      if (Date.now() - premutoA < 7000) return false;
      return !v || (!vuoto(v) && !staCaricando(v));
    }
    (function giro() {
      if (mio !== avvioInCorso || Date.now() > avviaProssimoFinoA) return;
      // il sito chiede se riprendere: si risponde e si lascia al sito il tempo di partire
      var risposto = false;
      try { risposto = rispondiRipresa(); } catch (e) {}
      if (risposto) { setTimeout(giro, 900); return; }
      // il video che hai scelto tu (OK su un video), se c'e' ancora; se no il lettore principale della pagina
      var p = voluto && voluto.isConnected ? voluto : trovaPlayer(), v = p && p.tagName === 'VIDEO' ? p : null;
      // da solo non si prende un'anteprima in ripetizione o dentro un link: si preme il Play del sito (piu' sotto)
      if (!voluto && v && (v.loop || (v.closest && v.closest('a[href]')))) { p = null; v = null; }
      // nella stessa pagina: finche' c'e' ancora la puntata di prima si aspetta
      if (v && prima && v === prima.v && (v.currentSrc || v.src) === prima.src && !(v.currentTime < prima.t - 5)) {
        if (Date.now() - partenza > 8000) return; // il sito non ha cambiato puntata (ci pensa vaiEpisodio)
        v = null;
        p = null;
      }
      if (p && p.tagName === 'IFRAME') {
        // il lettore e' in un riquadro con questo codice: gli si chiede di partire (fa tutto lui)
        if (p.__hometvPronto && !chiesto) { chiesto = true; try { p.contentWindow.postMessage({ hometv: 'avvia' }, '*'); } catch (e) {} }
        if (fsEl === p) return;
      } else if (v) {
        if (!v.paused && v.readyState >= 3) {
          if (visto < 0) visto = v.currentTime;
          else if (v.currentTime - visto >= 0.5) { // va davvero
            if (fsEl !== v) entraSchermoIntero(v, true);
            avviaProssimoFinoA = 0;
            return;
          }
        } else if (fermo(v) && Date.now() - ultimaProva > 1800) {
          ultimaProva = Date.now();
          var fase = prove++ % 4, b;
          if (vuoto(v)) {
            // ancora vuoto: lo riempie il Play del sito, premuto una volta (play() su un video vuoto non serve, e su
            // certi lettori gira l'interruttore); senza un Play del sito si prova play(). Premuto, si aspetta il sito
            if (!premutoA) {
              b = pulsantePlay(v);
              if (b) premi(b);
              else faiPartire(v);
            }
          } else if (fase === 2 && ripremere(v) && (b = pulsantePlay(v))) premi(b);
          else if (fase === 3 && prove > 4 && ripremere(v)) premi(v); // ultima strada: un clic sul video, come col mouse
          else faiPartire(v);
        }
        // dopo un po' a schermo intero comunque (non da vuoto: coprirebbe il Play del sito): si vede il video e OK lo
        // fa partire
        if (fsEl !== v && !vuoto(v) && Date.now() - partenza > 10000) entraSchermoIntero(v, true);
      } else if (Date.now() - partenza > 2500 && Date.now() - ultimaProva > 3000 && prove < 3) {
        // niente video ancora: si preme il "Play" grande della pagina (copertina del film), di nuovo solo dopo 7 s
        ultimaProva = Date.now();
        prove++;
        var bb = ripremere(null) ? pulsantePlay(null) : null;
        if (bb) premi(bb);
      }
      setTimeout(giro, 600);
    })();
  }
  function suCaricato(ev) {
    var v = ev.target;
    if (!v || v.tagName !== 'VIDEO' || Date.now() > avviaProssimoFinoA) return;
    if (v.paused && trovaPlayer() === v) faiPartire(v);
  }
  document.addEventListener('loadeddata', suCaricato, true);

  // true = tasto usato dal lettore
  function tastoLettore(azione) {
    var v = lettoreVideo;
    if (!v) return false;
    // "Eri a 22:15 su ...: OK per riprendere" (Indietro la chiude, gli altri tasti fanno il solito; nel pannello
    // delle lingue e sui pulsanti delle puntate OK resta loro)
    if (!pannelloLingue && serie.fuoco === 'video' && serie.conto === 0 && propostaAttiva()) {
      if (azione === 'ok') { accettaProposta(); return true; }
      if (azione === 'indietro') { propostaRipresa = null; avvisoLettore('', 0); mostraLettore(); return true; }
    }
    if (pannelloLingue && tastoPannelloLingue(azione)) return true;
    // conto alla rovescia di fine puntata: OK va subito, Indietro lo annulla (e si resta nel video)
    if (serie.conto > 0) {
      if (azione === 'ok') { vaiProssimo(); return true; }
      if (azione === 'indietro') { annullaConto(); disegnaChips(); mostraLettore(); return true; }
      // a video finito qualsiasi altro tasto lo annulla (e poi fa il suo lavoro)
      if (serie.dopoFine) { annullaConto(); disegnaChips(); }
    }

    // fuoco su un pulsante (dopo aver premuto Su): OK lo usa, sinistra/destra sceglie, giu'/Indietro torna al video
    if (serie.fuoco !== 'video') {
      if (azione === 'ok') {
        if (serie.fuoco === 'inizio') ricominciaDaCapo();
        else if (serie.fuoco === 'prec') vaiEpisodio(serie.prec, -1);
        else vaiEpisodio(serie.succ, 1);
        return true;
      }
      if (azione === 'sx' || azione === 'dx') {
        var ci = pulsantiDisponibili(), k = ci.indexOf(serie.fuoco) + (azione === 'sx' ? -1 : 1);
        if (k >= 0 && k < ci.length) serie.fuoco = ci[k];
        disegnaChips();
        mostraLettore();
        return true;
      }
      if (azione === 'giu' || azione === 'indietro' || azione === 'su') { serie.fuoco = 'video'; disegnaChips(); mostraLettore(); return true; }
      // play/pausa e gli altri: gestiti sotto
    }

    switch (azione) {
      case 'ok': case 'playpausa': case 'play': case 'pausa':
        // Play fa solo partire e Pausa solo fermare (i tasti veri del telecomando); OK e Play/pausa alternano
        if (azione === 'play' || (azione !== 'pausa' && fermo(v))) { partiDavvero(v); centro('play'); }
        else { fermaAvvio(); if (!v.paused) v.pause(); centro('pausa'); } // la pausa ferma anche i tentativi di partire
        mostraLettore();
        return true;
      case 'sx': scorriDi(-10); return true;
      case 'dx': scorriDi(10); return true;
      case 'indietroVeloce': scorriDi(-30); return true;
      case 'avanti': scorriDi(30); return true;
      case 'su':
        // evidenzia "Prossimo episodio" (o "Ricomincia da capo", o "Precedente")
        aggiornaSerie(true);
        var disp = pulsantiDisponibili();
        if (disp.length) {
          serie.fuoco = disp.indexOf('succ') !== -1 ? 'succ' : disp[disp.length - 1];
          disegnaChips();
        }
        mostraLettore();
        return true;
      case 'giu':
        if (Date.now() < riprendiFinoA) ricominciaDaCapo();
        else apriPannelloLingue(v);
        return true;
      case 'indietro': case 'stop':
        annullaConto();
        // come nelle app dei TV: si esce dal video e si ferma (e non si prova piu' a farlo partire)
        fermaAvvio();
        try { v.pause(); } catch (e) {}
        esciSchermoIntero();
        return true;
    }
    return false;
  }

  window.addEventListener('pagehide', function () {
    if (lettoreVideo) { salvaPosizione(lettoreVideo); ricordaPunto(lettoreVideo, true); }
    if (!IN_FRAME && pt.sottoDetto) {
      pt.sottoDetto = '';
      try {
        fetch(SERVIZIO + '/api/telefono/sotto', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"campo":false}', keepalive: true })['catch'](function () {});
      } catch (e) {}
    }
    // la pagina se ne va: sul telefono la sezione del video sparisce subito
    if (videoDetto) { videoDetto = ''; mandaVideo({ attivo: false }, true); }
    if (!IN_FRAME) lasciaRiquadro();
    // il puntatore resta dov'era anche nella pagina dopo (se ci si va cliccando)
    if (!IN_FRAME && pt.x >= 0) {
      try {
        sessionStorage.setItem('hometv-puntatore', JSON.stringify({ x: pt.x / Math.max(1, window.innerWidth - 1),
          y: pt.y / Math.max(1, window.innerHeight - 1), at: Date.now(), on: pt.on }));
      } catch (e) {}
    }
  });
  if (!IN_FRAME) {
    try {
      var ptPrima = JSON.parse(sessionStorage.getItem('hometv-puntatore') || 'null');
      if (ptPrima && ptPrima.on && Date.now() - ptPrima.at < 20000) {
        setTimeout(function () { if (!pt.on && mostraPuntatore()) avviaPuntatore(); }, 400);
      }
    } catch (e) {}
  }
  // pagina rimessa dalla cache del browser, o di nuovo in vista: il telefono lo risa
  window.addEventListener('pageshow', function (ev) { if (ev.persisted && lettoreVideo) diciVideo(true); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && lettoreVideo) diciVideo(true); });

  /* ================================================================ navigazione con le frecce
   * Si puo' scegliere tutto quello che col mouse si potrebbe cliccare: link, pulsanti e
   * campi, ma anche le voci fatte con <div> o <li> (il sito ci ascolta i clic, o ci mette
   * la "manina" del mouse). Conta quello che si vede davvero: una tendina aperta copre
   * quello che le sta sotto. Quando OK apre una tendina (stagioni, server, lingue...) o
   * una finestra, la selezione ci entra subito e le frecce restano li' dentro finche'
   * non si chiude; Indietro la chiude. I <select> si scelgono in un elenco grande.
   */

  var FOCUSABILI = 'a[href], button, input:not([type=hidden]), select, textarea, summary, ' +
    '[tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], video, iframe';
  var SEL_NAV = FOCUSABILI + ', [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="treeitem"], ' +
    '[role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [aria-haspopup]:not([aria-haspopup="false"]), ' +
    '[aria-expanded], [data-toggle], [data-bs-toggle], label[for], [contenteditable="true"], [contenteditable=""]';
  var CONTROLLI = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL|VIDEO|IFRAME)$/;
  // titoli e paragrafi che il sito rende raggiungibili col tasto Tab solo per chi usa la sintesi vocale (tabindex, come
  // nelle finestre dei cookie): non si cliccano, quindi non sono tappe; lo restano se il sito ci ascolta i clic, ci
  // mette la manina del mouse o li fa da pulsante (ruolo, tendina)
  var SEL_ATTIVI = SEL_NAV.replace('[tabindex]:not([tabindex="-1"]), ', '');
  function soloDaLeggere(el) {
    return /^(H[1-6]|P)$/.test(el.tagName) && !el.__hometvClic && !el.__hometvManina && !el.matches(SEL_ATTIVI);
  }
  var RUOLI = /^(button|link|tab|menuitem|menuitemradio|menuitemcheckbox|option|checkbox|radio|switch|treeitem|combobox)$/;

  var corrente = null, ultimoRett = null, ambito = null, sottoIlMouse = null;

  function controlloVero(el) { return CONTROLLI.test(el.tagName) || RUOLI.test(el.getAttribute('role') || ''); }

  // il riquadro di un elemento; un link "in linea" che contiene una copertina conta per il contenuto
  function rettangolo(el) {
    var r = el.getBoundingClientRect();
    if ((r.width >= 6 && r.height >= 6) || !el.firstElementChild) return r;
    var l = Infinity, t = Infinity, d = -Infinity, b = -Infinity, n = 0;
    for (var c = el.firstElementChild; c && n < 8; c = c.nextElementSibling, n++) {
      var x = c.getBoundingClientRect();
      if (x.width < 1 || x.height < 1) continue;
      if (x.left < l) l = x.left;
      if (x.top < t) t = x.top;
      if (x.right > d) d = x.right;
      if (x.bottom > b) b = x.bottom;
    }
    if (l === Infinity) return r;
    return { left: l, top: t, right: d, bottom: b, width: d - l, height: b - t };
  }

  function siVede(el) {
    if (el.closest && el.closest('.hometv-fs-hide')) return false;
    if (el.id && el.id.indexOf('hometv-') === 0) return false;
    if (el.disabled) return false;
    if (el.tagName === 'IFRAME' && (el.__hometvAd || eAd(el.src, 'frame'))) return false;
    if (!el.getClientRects().length) return false; // lui o un contenitore non si vede (display: none)
    var s = window.getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.05) return false;
    // tendine chiuse "trasparenti": e' il contenitore a essere invisibile
    for (var n = el.parentElement, i = 0; n && i < 10 && n !== document.body; n = n.parentElement, i++) {
      if (parseFloat(window.getComputedStyle(n).opacity) < 0.05) return false;
    }
    return true;
  }
  var visibile = siVede;

  // elemento fermo sullo schermo (o dentro una barra fissa): non arriva scorrendo la pagina
  function fisso(el) {
    for (var n = el, i = 0; n && n.nodeType === 1 && i < 14; n = n.parentElement, i++) {
      if (window.getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  }
  // nascosto perche' esce da un elenco che scorre (file di copertine, tendine lunghe):
  // ci si arriva facendo scorrere l'elenco
  function tagliato(el, r) {
    for (var n = el.parentElement, i = 0; n && i < 15 && n !== document.body && n !== document.documentElement; n = n.parentElement, i++) {
      if (n.scrollHeight <= n.clientHeight + 2 && n.scrollWidth <= n.clientWidth + 2) continue;
      var o = window.getComputedStyle(n);
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
      var b = n.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) return false;
      if (r.bottom <= b.top + 2 || r.top >= b.bottom - 2 || r.right <= b.left + 2 || r.left >= b.right - 2) return true;
      // dentro questo elenco: puo' essere fuori da quello che lo contiene (file dentro un riquadro che scorre)
    }
    return false;
  }
  // coperto da una barra fissa del sito (l'intestazione): ci si arriva scorrendo
  function sottoUnaBarra(t) {
    for (var n = t, i = 0; n && n.nodeType === 1 && i < 12; n = n.parentElement, i++) {
      var p = window.getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') return n.getBoundingClientRect().height < window.innerHeight * 0.4;
    }
    return false;
  }
  var PUNTI = [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]];
  function raggiungibile(el, r, ignora) {
    if (!siVede(el)) return false;
    var W = window.innerWidth, H = window.innerHeight;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > W || cy > H) {
      // fuori dallo schermo: ci si arriva scorrendo la pagina o un elenco
      if (tagliato(el, r)) return true;
      if (fisso(el)) return false;
      var de = document.documentElement, x = r.left + (window.pageXOffset || 0), y = r.top + (window.pageYOffset || 0);
      if (x + r.width <= 0 || y + r.height <= 0) return false;
      if ((cx < 0 || cx > W) && de.scrollWidth <= W + 4) return false; // la pagina non scorre di lato
      return y < Math.max(de.scrollHeight, H) && x < Math.max(de.scrollWidth, W);
    }
    var coperto = null;
    for (var i = 0; i < PUNTI.length; i++) {
      var px = r.left + r.width * PUNTI[i][0], py = r.top + r.height * PUNTI[i][1];
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      var t = document.elementFromPoint(px, py);
      if (!t) continue;
      if (t === el || el.contains(t) || t.contains(el)) return true;
      if (ignora && ignora.contains(t)) return true; // coperta solo dall'anteprima della cosa scelta, che si chiudera'
      if (!coperto) coperto = t;
    }
    if (tagliato(el, r)) return true;
    return !!coperto && sottoUnaBarra(coperto);
  }

  /* ---------------------------------------------------------------- "manine"
   * Cose cliccabili che non sono link ne' pulsanti: il sito le fa riconoscere solo
   * col mouse (la manina). Si cercano un po' alla volta, senza rallentare la pagina,
   * anche nelle tendine ancora chiuse.
   */
  var manine = [], codaManine = [], manineTimer = null, scansioneAvviata = false;
  var SALTA_MANINE = /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|HEAD|TITLE|BR|HR|WBR|SOURCE|TRACK|OPTION|OPTGROUP|PARAM|A|BUTTON|INPUT|SELECT|TEXTAREA|IFRAME|VIDEO|path|g|use|defs|stop|circle|rect|line|polygon|polyline|ellipse|linearGradient|radialGradient|clipPath|mask|symbol|tspan)$/;
  function daScansionare(radice) {
    if (!radice || radice.nodeType !== 1) return;
    if (codaManine.length > 400) return; // pagina che cambia di continuo: basta la prossima scansione completa
    codaManine.push({ lista: radice.getElementsByTagName('*'), i: -1, radice: radice, prima: manine.length });
    if (!manineTimer) manineTimer = setTimeout(scansionaManine, 300);
  }
  function mettiManina(el) {
    try { Object.defineProperty(el, '__hometvManina', { value: true, configurable: true }); } catch (e) { return; }
    manine.push(el);
    if (manine.length > 6000) {
      var tenute = [];
      for (var i = 0; i < manine.length; i++) if (manine[i].isConnected) tenute.push(manine[i]);
      manine = tenute.slice(-5000);
    }
  }
  function provaManina(el) {
    if (window.getComputedStyle(el).cursor !== 'pointer') return;
    var p = el.parentElement;
    if (p && p !== document.body && window.getComputedStyle(p).cursor === 'pointer') return; // la manina viene dal contenitore
    if (el.id && el.id.indexOf('hometv-') === 0) return;
    // un elenco intero con la manina: le voci sono i suoi figli
    var figli = el.children;
    if (figli.length >= 2 && vociDiElenco(figli)) {
      for (var j = 0; j < figli.length && j < 300; j++) if (!figli[j].__hometvManina) mettiManina(figli[j]);
      return;
    }
    mettiManina(el);
  }
  // un elenco (voci tutte dello stesso tipo, con la stessa prima classe e, se si vedono, della stessa forma lungo
  // l'elenco) e non una scheda fatta di pezzi diversi, come l'immagine e il titolo di una locandina
  function primaClasse(e) { var c = typeof e.className === 'string' ? e.className : ''; return c.replace(/^\s+/, '').split(/\s+/)[0] || ''; }
  function vociDiElenco(figli) {
    var t = figli[0].tagName, c = primaClasse(figli[0]), i;
    if (!/^(LI|DIV|A|SPAN|BUTTON|P)$/.test(t)) return false;
    for (i = 0; i < figli.length && i < 60; i++) if (figli[i].tagName !== t || primaClasse(figli[i]) !== c) return false;
    if (figli.length > 60) return false;
    var a = figli[0].getBoundingClientRect(), b = figli[1].getBoundingClientRect();
    if (a.width < 4 || a.height < 4 || b.width < 4 || b.height < 4) return true; // tendina chiusa: non si misura
    function simili(x, y, k) { return Math.max(x, y) <= Math.min(x, y) * k; }
    if (b.top >= a.bottom - 2 || a.top >= b.bottom - 2) return simili(a.height, b.height, 2); // in colonna
    return simili(a.height, b.height, 1.5) && simili(a.width, b.width, 3); // in fila
  }
  // subito, senza aspettare il giro lento (tendina appena aperta)
  function scansionaOra(radici) {
    var fatti = 0;
    for (var r = 0; r < radici.length && fatti < 1500; r++) {
      var radice = radici[r];
      if (!radice || !radice.isConnected || radice.nodeType !== 1) continue;
      var lista = radice.getElementsByTagName('*');
      for (var i = -1; i < lista.length && fatti < 1500; i++, fatti++) {
        var el = i < 0 ? radice : lista[i];
        if (el && el.__hometvFuori) rimetti(el);
        if (!el || el.__hometvManina || SALTA_MANINE.test(el.tagName)) continue;
        try { provaManina(el); } catch (e) {}
      }
    }
    navSporca = true;
  }
  function scansionaManine() {
    manineTimer = null;
    var fine = Date.now() + 8;
    while (codaManine.length) {
      var c = codaManine[0];
      for (; c.i < c.lista.length; c.i++) {
        if ((c.i & 31) === 0 && Date.now() > fine) { manineTimer = setTimeout(scansionaManine, 40); return; }
        var el = c.i < 0 ? c.radice : c.lista[c.i];
        if (el && el.__hometvFuori) rimetti(el);
        if (!el || el.__hometvManina || SALTA_MANINE.test(el.tagName)) continue;
        try { provaManina(el); } catch (e) {}
      }
      codaManine.shift();
      if (manine.length !== c.prima) navSporca = true;
    }
    // finita la scansione: l'elenco delle cose da scegliere si prepara subito (a pagina ferma),
    // cosi' anche la prima freccia e' immediata
    setTimeout(function () { try { if (!paginaDiCasa() && !fsEl) candidati(null); } catch (e) {} }, 150);
  }

  /* ---------------------------------------------------------------- le cose da scegliere */

  var navCache = null, navSporca = true;
  function candidati(dentro) {
    if (!dentro && navCache && !navSporca && Date.now() - navCache.quando < 6000) return navCache.lista;
    var visti = new Map(), tutti = [], i;
    function metti(e) {
      if (visti.has(e) || (dentro && !dentro.contains(e))) return;
      visti.set(e, tutti.length);
      tutti.push(e);
    }
    var q = (dentro || document).querySelectorAll(SEL_NAV);
    for (i = 0; i < q.length; i++) if (!soloDaLeggere(q[i])) metti(q[i]);
    for (i = 0; i < segnati.length; i++) if (segnati[i].isConnected) metti(segnati[i]);
    for (i = 0; i < manine.length; i++) if (manine[i].isConnected) metti(manine[i]);
    var lista = snella(tutti, visti);
    if (!dentro) { navCache = { quando: Date.now(), lista: lista }; navSporca = false; }
    return lista;
  }
  // Una cosa dentro un'altra che si sceglie: ne resta una sola. Dentro un link o un
  // pulsante conta il link; un contenitore con dentro link o pulsanti lascia il posto a
  // quelli; mezza pagina che ascolta i clic non e' una cosa da scegliere.
  function snella(tutti, visti) {
    var n = tutti.length, vero = [], via = [], i, k, p, idx, grande;
    for (i = 0; i < n; i++) { vero[i] = controlloVero(tutti[i]); via[i] = false; }
    for (i = 0; i < n; i++) {
      grande = null;
      for (p = tutti[i].parentElement, k = 0; p && k < 12 && p !== document.body; p = p.parentElement, k++) {
        idx = visti.get(p);
        if (idx === undefined) continue;
        if (vero[idx]) { via[i] = true; break; }
        if (!vero[i]) continue;
        if (grande === null) { var ri = tutti[i].getBoundingClientRect(); grande = ri.width >= 4 && ri.height >= 4; }
        if (grande) via[idx] = true;
      }
    }
    var out = [], schermo = window.innerWidth * window.innerHeight;
    for (i = 0; i < n; i++) {
      if (via[i]) continue;
      var el = tutti[i];
      if (!vero[i]) {
        var r = el.getBoundingClientRect();
        if (r.width * r.height > schermo * 0.5) continue;
      }
      out.push(el);
    }
    return out;
  }

  // la cosa migliore in quella direzione (vicina, allineata, e che si vede davvero)
  function scegliVerso(lista, rc, dir, salta) {
    var cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2, cand = [];
    // l'anteprima "col mouse sopra" della cosa scelta fa parte di lei: i suoi pulsanti non sono tappe, e le
    // locandine vicine che copre si raggiungono lo stesso (spostandosi, l'anteprima si chiude)
    var pop = anteprimaDi(corrente);
    for (var i = 0; i < lista.length; i++) {
      var el = lista[i];
      if (el === corrente || (corrente && (corrente.contains(el) || el.contains(corrente)))) continue;
      if (pop && pop.contains(el)) continue;
      var r = rettangolo(el);
      if (r.width < 4 || r.height < 4) continue;
      var dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      var gapX = Math.max(0, r.left - rc.right, rc.left - r.right);
      var gapY = Math.max(0, r.top - rc.bottom, rc.top - r.bottom);
      if (!nellaDirezione(r, rc, dir)) continue;
      var princ, lat;
      if (dir === 'su') { princ = -dy; lat = gapX + Math.abs(dx) * 0.15; }
      else if (dir === 'giu') { princ = dy; lat = gapX + Math.abs(dx) * 0.15; }
      else if (dir === 'sx') { princ = -dx; lat = gapY + Math.abs(dy) * 0.15; }
      else { princ = dx; lat = gapY + Math.abs(dy) * 0.15; }
      // si tengono solo le 80 migliori, gia' in ordine (niente ordinamento di tutta la pagina a ogni tasto)
      var s = princ + lat * 2.5;
      // a destra e a sinistra vince la stessa riga (la barra in alto di un sito, da un capo all'altro: non la casella di
      // ricerca al centro, piu' in basso), salvo una cosa fuori riga molto piu' vicina
      if ((dir === 'sx' || dir === 'dx') && r.top < rc.bottom - 2 && r.bottom > rc.top + 2) s *= 0.65;
      if (cand.length >= 80 && s >= cand[79].s) continue;
      var lo = 0, hi = cand.length;
      while (lo < hi) { var mezzo = (lo + hi) >> 1; if (cand[mezzo].s <= s) lo = mezzo + 1; else hi = mezzo; }
      cand.splice(lo, 0, { el: el, r: r, s: s });
      if (cand.length > 80) cand.pop();
    }
    for (var j = 0; j < cand.length; j++) {
      if (salta && salta(cand[j].el)) continue;
      if (raggiungibile(cand[j].el, cand[j].r, pop)) return locandinaDelPulsantino(cand[j], cand, rc, pop, dir) || cand[j].el;
    }
    return null;
  }
  /* Un pulsantino della locandina vicina (aggiungi, info, play sopra l'immagine): spostandosi tra locandine dello stesso
   * tipo ci si ferma sulla locandina, non su di lui. Andando a sinistra o in su il suo centro e' piu' vicino di quello
   * della locandina (i pulsantini stanno in basso a destra), a destra o in giu' no: senza questo le direzioni non
   * sarebbero simmetriche. Un pulsantino e' piccolo rispetto alla cosa scelta (ne' largo ne' alto la meta': un titolo
   * largo come la locandina, un tasto, un pulsante alto come gli altri della sua fila non lo sono) e mai la freccia di
   * una fila; la locandina e' grande come la cosa scelta (non un'intera copertina in alto) e lui le sta sopra, oppure
   * nella sua stessa scheda ma non prima di lei dalla parte da cui si arriva (le icone sotto l'immagine, venendo da
   * sotto, restano una tappa come venendo da sopra). Cosi' i pulsantini sopra l'immagine col telecomando non si
   * raggiungono (come quelli dell'anteprima): si usano col puntatore. */
  function locandinaDelPulsantino(c, cand, rc, pop, dir) {
    if (c.r.width * c.r.height >= rc.width * rc.height * 0.3) return null;
    if (c.r.width >= rc.width * 0.5 || c.r.height >= rc.height * 0.5 || versoFreccia(c.el)) return null;
    var cx = c.r.left + c.r.width / 2, cy = c.r.top + c.r.height / 2;
    for (var k = 0; k < cand.length && k < 12; k++) {
      var g = cand[k], r = g.r;
      if (g === c || r.width * r.height < c.r.width * c.r.height * 3) continue;
      if (r.width < rc.width * 0.5 || r.height < rc.height * 0.5 || r.width > rc.width * 2 || r.height > rc.height * 2) continue;
      var sopra = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      if ((sopra || (stessaScheda(c.el, g) && !nellaDirezione(c.r, r, INVERSO[dir]))) && raggiungibile(g.el, r, pop)) return g.el;
    }
    return null;
  }
  // la scheda della locandina: un contenitore poco piu' grande di lei, che non contiene la cosa scelta adesso
  function stessaScheda(el, g) {
    var limite = g.r.width * g.r.height * 2.5;
    for (var n = el.parentElement, k = 0; n && n !== document.body && k < 5; n = n.parentElement, k++) {
      if (corrente && n.contains(corrente)) return false;
      var r = n.getBoundingClientRect();
      if (r.width * r.height > limite) return false;
      if (n.contains(g.el)) return true;
    }
    return false;
  }
  // senza un punto di partenza: la voce scelta (nelle tendine) o la prima in alto a sinistra
  function primaVoce(lista, preferisciAttiva) {
    var cand = [], H = window.innerHeight;
    for (var i = 0; i < lista.length; i++) {
      var r = rettangolo(lista[i]);
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > H) continue;
      cand.push({ el: lista[i], r: r, s: r.top * 2 + r.left - (preferisciAttiva && voceAttiva(lista[i]) ? 1e6 : 0) });
    }
    cand.sort(function (a, b) { return a.s - b.s; });
    for (var j = 0; j < cand.length && j < 80; j++) if (raggiungibile(cand[j].el, cand[j].r)) return cand[j].el;
    return null;
  }
  // ingrandita da se' (scale, spesso dal nostro "col mouse sopra"): coprirebbe le vicine e le frecce le salterebbero;
  // si usa la misura che ha senza ingrandimento, attorno allo stesso centro
  function misuraNormale(el, r) {
    var w0 = el.offsetWidth, h0 = el.offsetHeight, p = el.offsetParent || el.parentElement;
    if (!w0 || !h0 || !p) return r;
    var rp = p.getBoundingClientRect(), kp = p.offsetWidth ? rp.width / p.offsetWidth : 1; // ingrandimento di chi la contiene
    var w = w0 * (kp || 1), h = h0 * (kp || 1);
    if (r.width <= w * 1.04 || r.height <= h * 1.04) return r;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2, width: w, height: h };
  }
  function puntoDiPartenza(sc) {
    if (corrente && corrente.isConnected && siVede(corrente) && (!sc || sc.el.contains(corrente) || corrente === sc.da)) {
      var r = misuraNormale(corrente, rettangolo(corrente));
      if (r.width >= 2 && r.height >= 2) return r;
    }
    if (sc || !ultimoRett) return null;
    // la cosa scelta e' sparita (il sito ha rifatto la pagina): si riparte da dov'era
    var x = ultimoRett.x - (window.pageXOffset || 0), y = ultimoRett.y - (window.pageYOffset || 0);
    if (y + ultimoRett.h < 0 || y > window.innerHeight) return null;
    return { left: x, top: y, right: x + ultimoRett.w, bottom: y + ultimoRett.h, width: ultimoRett.w, height: ultimoRett.h };
  }
  function vociDi(sc) {
    var lista = candidati(sc.el), i;
    if (!sc.voci) return lista;
    // tendina fatta di voci "simili": contano quelle (non il contenitore che le ascolta)
    var out = [];
    for (i = 0; i < lista.length; i++) {
      var dentro = false;
      for (var j = 0; j < sc.voci.length && !dentro; j++) if (lista[i] !== sc.voci[j] && lista[i].contains(sc.voci[j])) dentro = true;
      if (!dentro) out.push(lista[i]);
    }
    for (i = 0; i < sc.voci.length; i++) if (sc.voci[i].isConnected && out.indexOf(sc.voci[i]) === -1) out.push(sc.voci[i]);
    return out;
  }

  function muovi(dir) {
    ultimoOk = 0; // spostata la selezione: un video che parte adesso (un'anteprima) non e' per l'OK di prima
    // il sito ha spostato lui la selezione (per esempio chiudendo una sua finestra): si parte da li'
    var at = document.activeElement;
    if (at && at !== corrente && at !== document.body && at.tagName !== 'IFRAME' && at.matches && at.matches(SEL_NAV) &&
      !(corrente && corrente.contains(at)) && siVede(at) && areaVisibile(at) < window.innerWidth * window.innerHeight * 0.5) setFocus(at, true);
    var sc = ambitoAttivo();
    // mentre una fila sfoglia, destra e sinistra aspettano: tenendo premuto non si rifa' tutto il lavoro a ogni ripetizione
    if (!sc && (dir === 'dx' || dir === 'sx') && sfoglio && corrente === sfoglio.prima && adesso() < sfoglio.fino) return;
    var lista = sc ? vociDi(sc) : candidati(null);
    if (sc && sc.da && sc.da.isConnected) lista = lista.concat([sc.da]);
    var rc = puntoDiPartenza(sc), el;
    if (!rc) {
      el = primaVoce(lista, !!sc);
      if (el) setFocus(el); else if (!sc && !esciDalBordo(dir)) scorri(dir);
      return;
    }
    // tornando indietro (giu' e poi su) si torna proprio da dove si era partiti
    var m = ultimaMossa, da = corrente;
    if (m && m.a === corrente && m.dir === INVERSO[dir] && m.da.isConnected && (!sc || sc.el.contains(m.da) || m.da === sc.da)) {
      var rd = rettangolo(m.da);
      if (nellaDirezione(rd, rc, dir) && raggiungibile(m.da, rd)) el = m.da;
    }
    el = el || scegliVerso(lista, rc, dir);
    // file di film che scorrono solo con le loro frecce (come Netflix): si preme la freccia del sito
    if (!sc && (dir === 'dx' || dir === 'sx')) {
      var esito = sfogliaCarosello(dir, el);
      if (esito === true) return;
      if (esito) {
        // la fila e' finita da quella parte: le sue frecce non sono tappe; si va oltre solo alla stessa altezza (il menu
        // di lato), se no si resta sull'ultima
        el = scegliVerso(lista, rc, dir, function (x) {
          var r = rettangolo(x);
          return !(r.top < rc.bottom && r.bottom > rc.top) || frecciaDiFila(esito, x);
        });
        if (!el) return;
      }
    }
    if (el && el.tagName === 'IFRAME' && riquadroDaEntrare(el)) { entraNelRiquadro(el, dir, rc); ultimaMossa = { da: da, a: el, dir: dir }; return; }
    if (el) { setFocus(el); ultimaMossa = { da: da, a: el, dir: dir }; return; }
    if (sc) scorriDentro(sc.el, dir); else if (!esciDalBordo(dir)) scorri(dir);
  }
  var ultimaMossa = null, INVERSO = { su: 'giu', giu: 'su', sx: 'dx', dx: 'sx' };

  /* File di film che scorrono solo con le loro frecce (Netflix e simili: la fila si sposta da sola, non ha la barra per
   * scorrere). Andando a destra o a sinistra, se la locandina dopo non si vede tutta (e' sotto la freccia, fuori dallo
   * schermo) o non c'e' ancora, si preme la freccia del sito, come col mouse: la fila va avanti come vuole lui e si
   * sceglie la locandina che arriva. Le file che scorrono da se' (con la barra) si scorrono e basta, e se la
   * locandina dopo si vede tutta ci si va e basta.
   */
  var sfoglio = null;
  function sfogliaCarosello(dir, el) {
    if (!corrente || !corrente.isConnected) return false;
    if (sfoglio) {
      if (corrente === sfoglio.prima && adesso() < sfoglio.fino) return true; // la fila sta ancora scorrendo: si aspetta
      sfoglio = null; // ci si e' spostati altrove (giu', su): si riparte da li'
    }
    var verso = dir === 'dx' ? 1 : -1, car = trovaCarosello(corrente), rc = rettangolo(corrente);
    if (!car || !filaDiLocandine(car, rc)) return false;
    var freccia = frecciaDellaFila(car, verso, rc, corrente);
    // la fila e' finita da quella parte (niente freccia, spenta, o premuta da poco senza effetto): le sue frecce non sono
    // tappe. Se la mossa andava su una di loro, muovi va oltre (il menu di lato) o si resta sull'ultima
    if (!freccia) return el && frecciaDiFila(car, el) ? car : false;
    if (freccia === corrente || freccia.contains(corrente) || corrente.contains(freccia)) return false;
    var nellaFila = !!el && car.contains(el) && el !== freccia && !freccia.contains(el);
    if (nellaFila && visibileTutta(el, freccia)) return false; // la prossima si vede: ci si va e basta
    // altrimenti (sotto la freccia, fuori dallo schermo, la freccia stessa, un'altra fila, niente): una pagina della fila
    var prima = corrente, inizio = adesso(), misura = rc, prima0 = posizioneFila(car, prima);
    var mio = sfoglio = { fino: inizio + 1600, prima: prima };
    cliccaDavvero(freccia);
    dopoClicFreccia(verso);
    var ultima = null, ferma = 0;
    // il primo sguardo dopo 80 ms: prima il sito non ha ancora spostato niente (e si forzerebbe un ricalcolo per niente)
    setTimeout(function guarda() {
      if (sfoglio !== mio) return;
      if (!car.isConnected) {
        // il sito ha rifatto tutta la fila: la si ritrova dov'era la locandina di prima
        var qui = elementoAlPunto(misura.left + misura.width / 2, misura.top + misura.height / 2);
        car = qui ? trovaCarosello(qui) : null;
        if (!car) { sfoglio = null; return; }
      }
      var segno = posizioneFila(car, prima), ora = adesso();
      ferma = segno === ultima ? ferma + 1 : 0;
      ultima = segno;
      if ((ora - inizio < 250 || ferma < 2) && ora - inizio < 1500) { setTimeout(guarda, 80); return; }
      sfoglio = null;
      // la freccia premuta non ha mosso niente (spenta senza dirlo, o il sito non sente i clic): per un po' non si preme
      if (segno === prima0) frecciaMorta(car, verso);
      if (corrente !== prima) return; // intanto ci si e' spostati altrove (giu', su): vince l'ultimo tasto
      var scelta = arrivataNellaFila(car, verso, prima, nellaFila ? el : null, misura);
      if (scelta) { setFocus(scelta); ultimaMossa = { da: prima, a: scelta, dir: dir }; }
      // la lista di tutta la pagina si rifa' dopo, a selezione gia' spostata
      if (navSporca) setTimeout(function () { if (navSporca && !sfoglio) candidati(null); }, 150);
    }, 80);
    return true;
  }
  // una fila vera: bassa come le sue locandine, non mezza pagina (un grande riquadro in alto non si sfoglia da solo)
  function filaDiLocandine(car, rc) {
    var rb = car.getBoundingClientRect();
    return rb.height <= window.innerHeight * 0.6 && !(rc && rc.height && rb.height > rc.height * 3);
  }
  // una delle frecce della fila (anche spenta, anche solo un'icona): col telecomando non ci si va, si premono da sole
  function frecciaDiFila(car, el) {
    var rb = areaFila(car), r = el.getBoundingClientRect();
    if (r.top > rb.bottom || r.bottom < rb.top - 90) return false;
    if (!versoFreccia(el) && !frecciaMuta(el, r, rb, 1, true) && !frecciaMuta(el, r, rb, -1, true)) return false;
    for (var n = car, k = 0; n && n !== document.body && k < 4; n = n.parentElement, k++) if (n.contains(el)) return true;
    return false;
  }
  // la freccia di una fila vera e dalla parte giusta (a destra per andare avanti, a sinistra per tornare): mai un
  // "Avanti" qualsiasi della pagina. da: da dove si comincia a cercarla (la locandina scelta, la cosa sotto il dito).
  // ancheAlta: anche in un grande riquadro (le strisce del trackpad lo sfogliano, il telecomando no)
  function frecciaDellaFila(car, verso, rc, da, ancheAlta) {
    if (!ancheAlta && !filaDiLocandine(car, rc)) return null;
    var ora = adesso(), f;
    if (frecceMorte.car === car && frecceMorte.verso === verso && ora < frecceMorte.fino) return null; // non fa niente
    // la si cerca al massimo una volta al secondo per fila (le frecce del telecomando restano leggere sul TV)
    if (frecceViste.car !== car || ora - frecceViste.t > 1000) frecceViste = { car: car, t: ora, f: {} };
    f = frecceViste.f[verso];
    // da destra a sinistra (arabo, ebraico) la freccia a destra si chiama "precedente"
    if (f === undefined || (f && !frecciaBuona(f))) f = frecceViste.f[verso] = frecciaDel(car, scritturaRtl(car) ? -verso : verso, da);
    if (!f) return null;
    var rb = areaFila(car), rf = f.getBoundingClientRect(), cx = rf.left + rf.width / 2;
    // accanto alle locandine (a meta' altezza della fila) dev'essere dalla parte giusta; nel titolo o sotto la fila sta
    // dove vuole il sito
    var banda = Math.abs(rf.top + rf.height / 2 - (rb.top + rb.height / 2)) <= rb.height * 0.3;
    if (banda && (verso > 0 ? cx < rb.left + rb.width * 0.6 : cx > rb.left + rb.width * 0.4)) return null;
    return f;
  }
  var frecceViste = { car: null, t: 0, f: {} }, frecceMorte = { car: null, verso: 0, fino: 0 };
  // ancora li' e ancora accesa (a fine fila molti siti la spengono)
  function frecciaBuona(f) { return f.isConnected && !f.disabled && f.getAttribute('aria-disabled') !== 'true' && frecciaAccesa(f); }
  function frecciaMorta(car, verso) { frecceMorte = { car: car, verso: verso, fino: adesso() + 3000 }; }
  // dopo una pagina la freccia premuta di solito resta (si ricontrolla se e' ancora accesa); quella per tornare compare
  // adesso: si cerca di nuovo
  function dopoClicFreccia(verso) { delete frecceViste.f[-verso]; frecceViste.t = adesso(); }
  function scritturaRtl(el) {
    var s = null;
    try { s = window.getComputedStyle(el); } catch (e) {}
    return !!s && s.direction === 'rtl';
  }
  // dove sta la fila adesso (per capire quando ha smesso di muoversi): la locandina di prima e i contenitori tra lei e
  // la fila (quello che il sito sposta), non il primo figlio (spesso e' la freccia, che sta ferma)
  function posizioneFila(car, rif) {
    var s = '' + car.scrollLeft, n = rif && rif.isConnected && car.contains(rif) ? rif : null, k;
    for (k = 0; n && n !== car && k < 6; n = n.parentElement, k++) s += '|' + Math.round(n.getBoundingClientRect().left);
    if (!k) {
      // la locandina di prima non c'e' piu' (il sito rifa' la fila): la prima immagine (o link) della fila, che si muove
      // col nastro
      n = car.querySelector('img') || car.querySelector('a[href]');
      if (n) s += '/' + Math.round(n.getBoundingClientRect().left);
    }
    return s;
  }
  // si vede tutta: dentro lo schermo, non tagliata dal suo contenitore, non sotto la freccia (o le frecce)
  function visibileTutta(el, freccia, altra) {
    var r = rettangolo(el), W = window.innerWidth;
    if (r.width < 4 || r.height < 4 || r.left < -2 || r.right > W + 2) return false;
    var z = ritagliato(el, r);
    if (z.width < r.width * 0.9) return false;
    return !sottoLaFreccia(r, freccia) && !sottoLaFreccia(r, altra);
  }
  function sottoLaFreccia(r, freccia) {
    if (!freccia) return false;
    var f = freccia.getBoundingClientRect();
    var copre = Math.max(0, Math.min(f.right, r.right) - Math.max(f.left, r.left));
    return f.width >= 4 && f.top < r.bottom && f.bottom > r.top && copre > r.width * 0.2;
  }
  // dopo la pagina: la locandina che si voleva (se ora si vede), se no quella dopo la scelta di prima, se no la prima
  // che si vede da quella parte. Mai una freccia della fila (dopo la prima pagina compare anche quella per tornare) e,
  // potendo, una locandina grande come quella di prima (non i pulsantini dentro la fila)
  function arrivataNellaFila(car, verso, prima, voluta, misura) {
    var avanti = frecciaDellaFila(car, 1, null, prima), indietro = frecciaDellaFila(car, -1, null, prima), dentro = [], simili = [], i, c, r;
    function libera(el) {
      return !(avanti && avanti.contains(el)) && !(indietro && indietro.contains(el)) && visibileTutta(el, avanti, indietro);
    }
    if (voluta && voluta.isConnected && libera(voluta)) return voluta;
    // la lista di tutta la pagina e' da rifare (il sito ha messo le locandine nuove): intanto basta quella della fila
    var lista = navSporca ? candidati(car) : candidati(null);
    for (i = 0; i < lista.length; i++) {
      c = lista[i];
      if (!car.contains(c) || !libera(c)) continue;
      r = rettangolo(c);
      dentro.push({ el: c, r: r });
      if (misura && r.width > misura.width * 0.5 && r.width < misura.width * 2 && r.height > misura.height * 0.5 &&
          r.height < misura.height * 2) simili.push(dentro[dentro.length - 1]);
    }
    if (simili.length) dentro = simili;
    if (!dentro.length) return null;
    if (prima && prima.isConnected && visibileTutta(prima, null)) {
      var rp = rettangolo(prima), meglio = null;
      for (i = 0; i < dentro.length; i++) {
        r = dentro[i].r;
        if (dentro[i].el === prima || (verso > 0 ? r.left < rp.right - 2 : r.right > rp.left + 2)) continue;
        if (!meglio || (verso > 0 ? r.left < meglio.r.left : r.right > meglio.r.right)) meglio = dentro[i];
      }
      if (meglio) return meglio.el;
      return prima; // la fila non e' andata avanti (era alla fine): si resta li'
    }
    dentro.sort(function (a, b) { return verso > 0 ? a.r.left - b.r.left : b.r.right - a.r.right; });
    return dentro[0].el;
  }
  function nellaDirezione(r, rc, dir) {
    if (dir === 'su') return r.bottom <= rc.top + 2;
    if (dir === 'giu') return r.top >= rc.bottom - 2;
    if (dir === 'sx') return r.right <= rc.left + 2;
    return r.left >= rc.right - 2;
  }

  // (lo scorrimento passa dal profilo del TV: sui motori vecchi senza animazione)
  function scorri(dir) {
    var passo = window.innerHeight * 0.6;
    if (dir === 'su' || dir === 'giu') try { ProfiloTV.scorriPagina(null, dir === 'su' ? -passo : passo); } catch (e) {}
  }
  function scorriDentro(el, dir) {
    if (dir !== 'su' && dir !== 'giu') return;
    for (var n = el, i = 0; n && i < 4; n = n.firstElementChild, i++) {
      if (n.scrollHeight > n.clientHeight + 4) { try { ProfiloTV.scorriPagina(n, (dir === 'su' ? -0.6 : 0.6) * n.clientHeight); } catch (e) {} return; }
    }
  }

  // la cosa scelta deve vedersi: si scorre solo se serve (vicino ai bordi o fuori)
  function mostraElemento(el) {
    var r = rettangolo(el), W = window.innerWidth, H = window.innerHeight;
    if (r.top >= H * 0.1 && r.bottom <= H * 0.9 && r.left >= 0 && r.right <= W && !tagliato(el, r)) return;
    try { ProfiloTV.mostra(el, !!ambito); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
  }

  // Menu che si aprono passandoci sopra col mouse: per le cose su cui il sito ascolta il
  // "passaggio del mouse" si fa come il mouse (entra, esce), con gli stessi eventi.
  function vuoleIlMouse(el) {
    if (sopraGlobale) return true;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement || (n.parentNode && n.parentNode.host) || null) if (n.__hometvSopra) return true;
    return false;
  }
  function eventoMouse(el, tipo, altro, bolle, x, y) {
    var o = { bubbles: bolle, cancelable: true, view: window, clientX: x, clientY: y, relatedTarget: altro || null };
    try {
      if (tipo.indexOf('pointer') === 0 && MOTORE.puntatore) {
        o.pointerType = 'mouse'; o.isPrimary = true; o.pointerId = 1;
        el.dispatchEvent(new PointerEvent(tipo, o));
      } else el.dispatchEvent(new MouseEvent(tipo, o));
    } catch (e) {}
  }
  function passaggioMouse(a) {
    var da = sottoIlMouse && sottoIlMouse.isConnected ? sottoIlMouse : null;
    var entra = !!a && vuoleIlMouse(a);
    if (!da && !entra) return;
    var r = a ? rettangolo(a) : { left: 0, top: 0, width: 0, height: 0 }, x = r.left + r.width / 2, y = r.top + r.height / 2, n;
    if (da) {
      eventoMouse(da, 'pointerout', a, true, x, y); eventoMouse(da, 'mouseout', a, true, x, y);
      for (n = da; n && n.nodeType === 1 && !(a && n.contains(a)); n = n.parentElement) {
        eventoMouse(n, 'pointerleave', a, false, x, y); eventoMouse(n, 'mouseleave', a, false, x, y);
      }
    }
    sottoIlMouse = entra ? a : null;
    if (!entra) return;
    eventoMouse(a, 'pointerover', da, true, x, y); eventoMouse(a, 'mouseover', da, true, x, y);
    var catena = [];
    for (n = a; n && n.nodeType === 1 && !(da && n.contains(da)); n = n.parentElement) catena.unshift(n);
    for (var i = 0; i < catena.length; i++) { eventoMouse(catena[i], 'pointerenter', da, false, x, y); eventoMouse(catena[i], 'mouseenter', da, false, x, y); }
    eventoMouse(a, 'pointermove', null, true, x, y); eventoMouse(a, 'mousemove', null, true, x, y);
  }

  /* ---------------------------------------------------------------- come col mouse sopra
   * Con le frecce (e col puntatore del telefono) quello che scegli reagisce come col mouse sopra:
   * copertine che si ingrandiscono, pulsanti e caselle che compaiono. Gli effetti che il sito ha
   * scritto per il mouse (":hover" nei suoi stili) si copiano su un segno (la classe hometv-sopra)
   * che si mette alla cosa scelta e a quelle che la contengono, come fa il browser col mouse vero.
   * Gli stili si leggono a pezzi (niente scatti) e di nuovo se il sito ne aggiunge.
   */
  var stileSopra = null, catenaSopra = [], scanSopra = null, firmaSopra = -1, fogliLontani = {};
  function assoluti(css, base) {
    if (!base) return css;
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (m, q, u) {
      if (/^(data:|https?:|blob:|#)/i.test(u)) return m;
      try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return m; }
    });
  }
  // Di un elenco di selettori ("a:hover, a.attivo") si copiano solo quelli col mouse sopra: gli altri (e ":not(:hover)",
  // che senza mouse vale gia' ovunque) ricopiati in fondo alla pagina vincerebbero sulle regole del sito che vengono dopo
  function soloSopra(s) {
    var parti = [], prof = 0, da = 0, q = '', i, c, out = [];
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if (c === '\\') { i++; continue; }
      if (q) { if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '(' || c === '[') prof++;
      else if (c === ')' || c === ']') prof--;
      else if (c === ',' && !prof) { parti.push(s.slice(da, i)); da = i + 1; }
    }
    parti.push(s.slice(da));
    for (i = 0; i < parti.length; i++) {
      if (/:hover(?![\w-])/.test(parti[i].replace(/:not\([^()]*\)/g, ''))) out.push(parti[i].replace(/:hover(?![\w-])/g, '.hometv-sopra'));
    }
    return out.join(',');
  }
  // "@media (hover: hover)" (Tailwind e tanti altri): un TV senza mouse risponde di no, ma il mouse qui lo facciamo noi
  function mediaSopra(t) { return String(t || '').replace(/\(\s*(any-)?hover\s*:\s*hover\s*\)/gi, '(min-width: 0px)'); }
  var copiaRegola = typeof WeakMap === 'function' ? new WeakMap() : null; // regola del sito -> la sua copia ('' = niente)
  function regoleSopra(lista, out, base) {
    for (var i = 0; i < lista.length && out.n < 3000; i++) {
      var r = lista[i];
      if (r.type === 1) {
        var c = copiaRegola ? copiaRegola.get(r) : undefined;
        if (c === undefined) {
          var s = r.selectorText, sel = s && s.indexOf(':hover') !== -1 ? soloSopra(s) : '';
          c = sel ? sel + '{' + assoluti(r.style.cssText, base) + '}' : '';
          if (copiaRegola) copiaRegola.set(r, c);
        }
        if (c) { out.css.push(c); out.n++; }
      } else if ((r.type === 4 || r.type === 12) && r.cssRules) {
        var dentro = { css: [], n: out.n };
        regoleSopra(r.cssRules, dentro, base);
        if (dentro.css.length) {
          out.css.push((r.type === 4 ? '@media ' + mediaSopra(r.media.mediaText) : '@supports ' + r.conditionText) + '{' + dentro.css.join('') + '}');
          out.n = dentro.n;
        }
      }
    }
  }
  // stili da un altro indirizzo: si leggono se quel server lo permette
  function leggiFoglioLontano(f) {
    var h = f.href;
    if (!h || Object.prototype.hasOwnProperty.call(fogliLontani, h) || typeof fetch !== 'function') return;
    fogliLontani[h] = '';
    fetch(h, { mode: 'cors', credentials: 'omit' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      // sui motori senza fogli costruiti (prima di Chromium 73) si saltano, come prima: leggerli tutti d'un colpo, senza
      // le fette di pezzoSopra, fermerebbe il TV
      if (!t || t.indexOf(':hover') === -1 || !MOTORE.fogliAdottati) return;
      var foglio = new CSSStyleSheet();
      foglio.replaceSync(t.replace(/@import[^;]*;/g, ''));
      var out = { css: [], n: 0 };
      regoleSopra(foglio.cssRules, out, h);
      fogliLontani[h] = out.css.join('\n');
      aggiornaStileSopra();
    })['catch'](function () {});
  }
  function aggiornaStileSopra() {
    if (scanSopra) { scanSopra.ancora = true; return; }
    scanSopra = { fogli: [], i: 0, j: 0, out: { css: [], n: 0 }, ancora: false };
    for (var k = 0; k < document.styleSheets.length; k++) scanSopra.fogli.push(document.styleSheets[k]);
    pezzoSopra();
  }
  function pezzoSopra() {
    var s = scanSopra, fine = Date.now() + 6, regole, foglio;
    if (!s) return;
    while (s.i < s.fogli.length && s.out.n < 3000) {
      foglio = s.fogli[s.i];
      regole = null;
      var o = foglio.ownerNode, salta = !!foglio.disabled || !!(o && o.id && o.id.indexOf('hometv-') === 0);
      try { if (!salta && foglio.media && foglio.media.mediaText && !window.matchMedia(mediaSopra(foglio.media.mediaText)).matches) salta = true; } catch (e) {}
      if (!salta) {
        try { regole = foglio.cssRules; } catch (e) {
          // foglio di un altro sito: le sue regole (lette a parte) vanno qui, nel suo ordine
          leggiFoglioLontano(foglio);
          if (foglio.href && Object.prototype.hasOwnProperty.call(fogliLontani, foglio.href) && fogliLontani[foglio.href]) s.out.css.push(fogliLontani[foglio.href]);
        }
      }
      if (!regole) { s.i++; s.j = 0; continue; }
      while (s.j < regole.length && s.out.n < 3000) {
        try { regoleSopra([regole[s.j]], s.out, foglio.href || ''); } catch (e) {}
        s.j++;
        if ((s.j & 63) === 0 && Date.now() > fine) { setTimeout(pezzoSopra, 16); return; }
      }
      s.i++; s.j = 0;
    }
    scanSopra = null;
    var testo = s.out.css.join('\n');
    if (!stileSopra) { stileSopra = document.createElement('style'); stileSopra.id = 'hometv-sopra-stili'; }
    if (stileSopra.textContent !== testo) stileSopra.textContent = testo;
    var dove = document.head || document.documentElement;
    if (dove && stileSopra.parentNode !== dove) dove.appendChild(stileSopra);
    if (s.ancora) aggiornaStileSopra();
  }
  // il sito aggiunge stili (pagine che si caricano a pezzi): si rileggono
  function controllaStileSopra() {
    if (document.hidden) return;
    var f = document.styleSheets, x = f.length;
    for (var i = 0; i < f.length; i++) {
      var o = f[i].ownerNode;
      if (o && o.id && o.id.indexOf('hometv-') === 0) continue;
      try { x += f[i].cssRules.length * 7; } catch (e) { x += 1000; }
    }
    if (x === firmaSopra) return;
    firmaSopra = x;
    aggiornaStileSopra();
  }
  // il segno va alla cosa scelta e a tutte quelle che la contengono (come il mouse vero)
  function segnaSopra(el) {
    var nuova = [], n, k, i;
    for (n = el, k = 0; n && n.nodeType === 1 && k < 40; n = n.parentElement || (n.parentNode && n.parentNode.host) || null, k++) {
      if (n === document.documentElement) break;
      nuova.push(n);
    }
    for (i = 0; i < catenaSopra.length; i++) if (nuova.indexOf(catenaSopra[i]) === -1) { try { catenaSopra[i].classList.remove('hometv-sopra'); } catch (e) {} }
    for (i = 0; i < nuova.length; i++) if (!nuova[i].classList.contains('hometv-sopra')) nuova[i].classList.add('hometv-sopra');
    catenaSopra = nuova;
  }

  function setFocus(el, senzaScorrere) {
    if (!el) return;
    if (corrente && corrente !== el) corrente.classList.remove('hometv-focus');
    var cambia = corrente !== el;
    corrente = el;
    if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/.test(el.tagName)) {
      origSetAttr.call(el, 'tabindex', '-1');
    }
    // un riquadro si evidenzia soltanto: se prendesse il fuoco si porterebbe via
    // il telecomando (si entra con OK, vedi entraSchermoIntero)
    if (el.tagName !== 'IFRAME') {
      try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    } else if (document.activeElement && document.activeElement !== document.body && document.activeElement !== el) {
      try { document.activeElement.blur(); } catch (e) {}
    }
    el.classList.add('hometv-focus');
    if (cambia) { passaggioMouse(el); segnaSopra(el); nuoviIngranditi(el); }
    if (!senzaScorrere) mostraElemento(el);
    var r = rettangolo(el);
    ultimoRett = { x: r.left + (window.pageXOffset || 0), y: r.top + (window.pageYOffset || 0), w: r.width, h: r.height };
    seguiAnello(cambia);
  }

  // La cosa scelta e' sparita (scelta una voce, la tendina si e' chiusa; il sito ha rifatto
  // l'elenco): si sceglie quella che sta li' vicino, senza che tu debba premere niente.
  // il fuoco e' dentro un riquadro (ci si e' entrati, o il sito gliel'ha dato, come il pannello delle app di Google):
  // i tasti vanno a lui e qui non si sposta niente (se no il pannello si richiude)
  function fuocoNelRiquadro() {
    var a = document.activeElement;
    return !!a && a.tagName === 'IFRAME' && a.isConnected;
  }
  function riprendiFuoco() {
    // appena entrati in un riquadro: il sito lo sta ancora aprendo (puo' essere nascosto per un attimo e passare il fuoco
    // dal suo pulsante al riquadro): non si tocca niente
    if (fuocoNelRiquadro() || (corrente && corrente.tagName === 'IFRAME' && Date.now() - entratoA < 2500)) return;
    if (corrente && corrente.isConnected && siVede(corrente) && rettangolo(corrente).width >= 2) return;
    if (!ultimoRett || fsEl || paginaDiCasa()) return;
    var x = ultimoRett.x - (window.pageXOffset || 0) + ultimoRett.w / 2, y = ultimoRett.y - (window.pageYOffset || 0) + ultimoRett.h / 2;
    var sc = ambitoAttivo(), lista = sc ? vociDi(sc) : candidati(null), cand = [];
    for (var i = 0; i < lista.length; i++) {
      var r = rettangolo(lista[i]);
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) continue;
      var dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
      cand.push({ el: lista[i], r: r, s: dx * dx + dy * dy });
    }
    cand.sort(function (a, b) { return a.s - b.s; });
    for (var j = 0; j < cand.length && j < 30; j++) if (raggiungibile(cand[j].el, cand[j].r)) { setFocus(cand[j].el, true); return; }
  }

  /* ---------------------------------------------------------------- tendine, menu e finestre del sito */

  // le cose che si vedono adesso sullo schermo (prima e dopo un OK, per capire cosa si e' aperto)
  function suLoSchermo() {
    var c = candidati(null), out = [], W = window.innerWidth, H = window.innerHeight;
    for (var i = 0; i < c.length; i++) {
      var r = rettangolo(c[i]);
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) continue;
      var t = document.elementFromPoint(Math.min(W - 1, Math.max(0, r.left + r.width / 2)), Math.min(H - 1, Math.max(0, r.top + r.height / 2)));
      if (t && (t === c[i] || c[i].contains(t))) out.push(c[i]);
    }
    return out;
  }
  function distanza(a, b) {
    var dx = Math.max(0, b.left - a.right, a.left - b.right), dy = Math.max(0, b.top - a.bottom, a.top - b.bottom);
    return Math.sqrt(dx * dx + dy * dy);
  }
  // lo "strato" sopra la pagina in cui sta una voce: tendina, menu, finestra
  function strato(el, da) {
    for (var n = el.parentElement, i = 0; n && n !== document.body && n !== document.documentElement && i < 14; n = n.parentElement, i++) {
      var ruolo = n.getAttribute('role') || '', pos = window.getComputedStyle(n).position;
      if (/^(menu|listbox|dialog|alertdialog|tree|grid)$/.test(ruolo) || n.getAttribute('aria-modal') === 'true' || pos === 'absolute' || pos === 'fixed') {
        return n.contains(da) ? null : n;
      }
    }
    return null;
  }
  // voci "simili" (stesso tipo, una sotto l'altra) dentro una tendina fatta senza link ne' pulsanti
  function vociSimili(c) {
    var meglio = [], coda = [c], giri = 0;
    while (coda.length && giri++ < 80) {
      var n = coda.shift(), gruppi = {}, figli = n.children;
      for (var i = 0; i < figli.length && i < 300; i++) {
        var f = figli[i];
        coda.push(f);
        var r = f.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || !testoBreve(f)) continue;
        var k = f.tagName + '.' + (typeof f.className === 'string' ? f.className.split(' ')[0] : '');
        (gruppi[k] = gruppi[k] || []).push(f);
      }
      for (var g in gruppi) if (ha(gruppi, g) && gruppi[g].length > meglio.length) meglio = gruppi[g];
    }
    return meglio.length >= 2 ? meglio : [];
  }
  function trovaPopup(prima, da, cambiati) {
    var dopo = suLoSchermo(), nuovi = [], i, k, W = window.innerWidth, H = window.innerHeight;
    var rd = da.isConnected ? da.getBoundingClientRect() : (ultimoRett ? { left: ultimoRett.x - window.pageXOffset, top: ultimoRett.y - window.pageYOffset, right: ultimoRett.x - window.pageXOffset + ultimoRett.w, bottom: ultimoRett.y - window.pageYOffset + ultimoRett.h } : null);
    if (!rd) return null;
    for (i = 0; i < dopo.length; i++) {
      var e = dopo[i];
      if (prima.indexOf(e) !== -1 || e === da || e.contains(da) || da.contains(e)) continue;
      nuovi.push(e);
    }
    var strati = [];
    function aggiungi(s, voce) {
      var g = null;
      for (var j = 0; j < strati.length; j++) if (strati[j].el === s) g = strati[j];
      if (!g) { g = { el: s, voci: [], dist: Infinity }; strati.push(g); }
      if (voce) {
        g.voci.push(voce);
        g.dist = Math.min(g.dist, distanza(rettangolo(voce), rd));
      } else g.dist = Math.min(g.dist, distanza(s.getBoundingClientRect(), rd));
      return g;
    }
    for (i = 0; i < nuovi.length; i++) { var s = strato(nuovi[i], da); if (s) aggiungi(s, nuovi[i]); }
    // tendina fatta solo di <div> o <li> (nessuna voce riconosciuta): si guarda cosa e' comparso
    if (!strati.length && cambiati) {
      for (i = 0; i < cambiati.length && i < 300; i++) {
        var c = cambiati[i];
        if (!c.isConnected || c === document.body || c.contains(da) || !siVede(c)) continue;
        var rc = c.getBoundingClientRect();
        if (rc.width < 20 || rc.height < 20 || distanza(rc, rd) > Math.max(220, H * 0.25)) continue;
        var st = strato(c.firstElementChild || c, da) || null;
        if (!st) continue;
        var simili = vociSimili(st);
        if (simili.length >= 2) { var g2 = aggiungi(st, null); g2.voci = simili; g2.simili = true; }
      }
    }
    strati.sort(function (a, b) { return a.dist - b.dist; });
    var aperta = da.getAttribute && (da.getAttribute('aria-expanded') === 'true' || da.hasAttribute('aria-haspopup'));
    for (k = 0; k < strati.length; k++) {
      var x = strati[k], r = x.el.getBoundingClientRect();
      var modale = r.width * r.height > W * H * 0.25 || /dialog/.test(x.el.getAttribute('role') || '') || x.el.getAttribute('aria-modal') === 'true';
      if (!modale && x.dist > Math.max(220, H * 0.25)) continue;
      // un solo pulsante comparso (un avviso "fatto!"): non e' una tendina
      if (!modale && x.voci.length < 2 && !aperta) continue;
      return x;
    }
    return null;
  }
  // Un OK (fai): se nel giro di un attimo si apre una tendina o una finestra, ci si entra.
  // Si guarda la pagina gia' da prima del clic: molte tendine si aprono subito.
  function dopoAttivazione(prima, da, fai) {
    var cambiati = [], mo = null, mosso = true, giri = [80, 250, 500, 900, 1500], k = 0, riqPannello = null;
    try {
      mo = new MutationObserver(function (lista) {
        mosso = true;
        for (var i = 0; i < lista.length && cambiati.length < 300; i++) {
          var m = lista[i];
          if (m.type === 'attributes') cambiati.push(m.target);
          else for (var j = 0; j < m.addedNodes.length; j++) if (m.addedNodes[j].nodeType === 1) cambiati.push(m.addedNodes[j]);
        }
      });
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'aria-hidden', 'open'] });
    } catch (e) { mo = null; }
    var indirizzo = location.href;
    if (fai) fai();
    function fine() { if (mo) { mo.disconnect(); mo = null; } }
    function controlla() {
      if (!document.documentElement || paginaDiCasa()) { fine(); return; }
      // pagina nuova (siti fatti di una pagina sola): non e' una tendina, si riparte dalla pagina (le finestre vere le
      // trova comunque finestraModale)
      if (location.href !== indirizzo) { fine(); riprendiFuoco(); return; }
      // il sito ha aperto un suo pannello fatto da un riquadro e gli ha dato il fuoco (come le app di Google): ci si
      // entra senza toccare la selezione di qui (se no il pannello si richiude)
      var af = document.activeElement;
      if (af && af.tagName === 'IFRAME' && af !== da && !fsEl && siVede(af) && af.getBoundingClientRect().width >= 120 && !eLettore(af)) {
        fine(); entraNelRiquadro(af); return;
      }
      if (mosso) {
        mosso = false;
        var p = null;
        try { scansionaOra(cambiati.slice(0, 60)); p = trovaPopup(prima, da, cambiati); } catch (e) { p = null; }
        // un pannello fatto da un riquadro: si aspetta che il sito gli dia il fuoco (qui sopra); alla fine ci si entra
        if (p && !riqPannello) riqPannello = riquadroGrande(p.el);
        if (p && !riqPannello) { fine(); entraInAmbito(p, da); return; }
        if (corrente && (!corrente.isConnected || !siVede(corrente))) { try { riprendiFuoco(); } catch (e) {} }
      }
      if (++k < giri.length) setTimeout(controlla, giri[k] - giri[k - 1]);
      else {
        fine();
        if (riqPannello && riqPannello.isConnected && siVede(riqPannello) && !fsEl) entraNelRiquadro(riqPannello);
        else riprendiFuoco();
      }
    }
    setTimeout(controlla, giri[0]);
  }
  function entraInAmbito(p, da) {
    // il fuoco e' gia' nel riquadro del pannello (il sito gliel'ha dato): si entra li', non lo si porta via
    var af = document.activeElement;
    if (af && af.tagName === 'IFRAME' && p.el.contains(af) && !fsEl && !eLettore(af)) { entraNelRiquadro(af); return; }
    ambito = { el: p.el, da: da, voci: p.simili ? p.voci : null, modale: !!p.modale };
    var lista = vociDi(ambito), scelta = null;
    for (var i = 0; i < lista.length; i++) if (voceAttiva(lista[i]) && raggiungibile(lista[i], rettangolo(lista[i]))) { scelta = lista[i]; break; }
    if (!scelta) scelta = primaVoce(p.voci && p.voci.length ? p.voci : lista, true) || primaVoce(lista, true);
    if (scelta) setFocus(scelta);
  }
  function aperto(el) {
    if (!el.isConnected || !siVede(el)) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  }
  // finestra del sito aperta sopra la pagina (anche da sola: "hai piu' di 18 anni?", i cookie)
  // l'elenco delle possibili finestre si rifa' quando la pagina aggiunge qualcosa o dopo un secondo (non a ogni tasto:
  // su una pagina grande costa); chi e' aperta davvero si guarda ogni volta
  var modali = { lista: null, t: 0 }, modaliSporche = true;
  function finestraModale() {
    var ora = adesso();
    if (!modali.lista || modaliSporche || ora - modali.t > 1000) {
      modali = { lista: document.querySelectorAll('dialog, [aria-modal], [role="dialog"], [role="alertdialog"]'), t: ora };
      modaliSporche = false;
    }
    var l = modali.lista, W = window.innerWidth, H = window.innerHeight;
    for (var i = l.length - 1; i >= 0; i--) {
      var el = l[i];
      if (!el.isConnected || !(el.tagName === 'DIALOG' ? el.open : el.getAttribute('aria-modal') === 'true' ||
        /^(dialog|alertdialog)$/.test(el.getAttribute('role') || ''))) continue;
      if (el.__hometvIgnora || (el.id && el.id.indexOf('hometv-') === 0)) continue;
      var r = el.getBoundingClientRect();
      if (r.width * r.height < W * H * 0.03 || r.bottom <= 0 || r.top >= H || !siVede(el)) continue;
      if (el.getAttribute('aria-modal') !== 'true' && el.tagName !== 'DIALOG' && r.width * r.height < W * H * 0.25) continue;
      var t = document.elementFromPoint(Math.min(W - 1, Math.max(0, r.left + r.width / 2)), Math.min(H - 1, Math.max(0, r.top + r.height / 2)));
      if (!t || !(t === el || el.contains(t))) continue; // c'e' qualcos'altro davanti: non e' lei
      if (!candidati(el).length) continue;
      return { el: el, da: null, voci: null, modale: true, sola: true };
    }
    return null;
  }
  function ambitoAttivo() {
    if (ambito) {
      if (ambito.ignorato || !aperto(ambito.el)) {
        var finito = ambito;
        ambito = null;
        // la tendina si e' chiusa: si torna al pulsante che l'aveva aperta
        if (!finito.ignorato && !fuocoNelRiquadro() && (!corrente || !corrente.isConnected || finito.el.contains(corrente) || !siVede(corrente)) &&
          finito.da && finito.da.isConnected && raggiungibile(finito.da, rettangolo(finito.da))) setFocus(finito.da, true);
      } else return ambito;
    }
    return finestraModale();
  }
  var tastoNostro = false;
  function tastoEsc(el) {
    tastoNostro = true;
    try {
      ['keydown', 'keyup'].forEach(function (tipo) {
        var e = new KeyboardEvent(tipo, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
        try {
          Object.defineProperty(e, 'keyCode', { get: function () { return 27; } });
          Object.defineProperty(e, 'which', { get: function () { return 27; } });
        } catch (x) {}
        el.dispatchEvent(e);
      });
    } catch (e) {}
    tastoNostro = false;
  }
  var SEL_CHIUDI = '[aria-label*="chiud" i], [aria-label*="close" i], [title*="chiud" i], [title*="close" i], [data-dismiss], ' +
    '[data-bs-dismiss], .close, .btn-close, [class*="close" i], [class*="chiudi" i]';
  SEL_CHIUDI = ProfiloTV.selettore(SEL_CHIUDI);
  function pulsanteChiudi(c) {
    var l = [], i;
    try { l = c.querySelectorAll(SEL_CHIUDI); } catch (e) {}
    for (i = 0; i < l.length; i++) { var r = l[i].getBoundingClientRect(); if (r.width >= 8 && r.height >= 8 && siVede(l[i])) return l[i]; }
    var b = c.querySelectorAll('button, [role="button"], a');
    for (i = 0; i < b.length; i++) if (/^\s*(\u00d7|\u2715|\u2716|x|chiudi|close|annulla|cancel)\s*$/i.test(b[i].textContent || '') && siVede(b[i])) return b[i];
    return null;
  }
  // Indietro dentro una tendina o una finestra: si chiude (Esc, poi il pulsante che l'ha
  // aperta o la X). Se proprio non si chiude, almeno non ci si resta chiusi dentro.
  function chiudiAmbito(sc) {
    var su = corrente && sc.el.contains(corrente) ? corrente : sc.el;
    tastoEsc(su);
    setTimeout(function () {
      if (!aperto(sc.el)) { fineAmbito(sc); return; }
      var x = sc.da && sc.da.isConnected && !sc.sola ? sc.da : pulsanteChiudi(sc.el);
      if (x) cliccaDavvero(x);
      setTimeout(function () {
        if (aperto(sc.el)) sc.el.__hometvIgnora = true;
        fineAmbito(sc);
      }, 300);
    }, 160);
  }
  function fineAmbito(sc) {
    sc.ignorato = true;
    if (ambito === sc) ambito = null;
    if (sc.da && sc.da.isConnected && raggiungibile(sc.da, rettangolo(sc.da))) setFocus(sc.da, true);
    else riprendiFuoco();
  }

  /* ---------------------------------------------------------------- l'evidenziazione
   * Un anello colorato che segue la cosa scelta e scivola da una all'altra. E' un
   * elemento a parte, sopra la pagina: non cambia i colori ne' la forma del sito e non
   * viene tagliato dai riquadri. L'alone e' fatto a fasce, senza sfocatura: sul TV una
   * sfocatura grande intorno a una riga larga quanto lo schermo rallenta le frecce.
   */
  var anello = null, anelloRaf = 0, anelloFino = 0, anelloDa = null, anelloVia = 0, anelloOra = null, anelloFermo = 0;
  var SVG_ANELLO = '<svg><defs><linearGradient id="hometv-colori" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#19d3b7"/><stop offset=".55" stop-color="#3b82f6"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>' +
    '<rect x="0" y="0" width="100%" height="100%" rx="12" ry="12" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="7"/>' +
    '<rect x="0" y="0" width="100%" height="100%" rx="12" ry="12" fill="none" stroke="url(#hometv-colori)" stroke-width="4"/></svg>';
  function disegnaAnello() {
    var el = corrente;
    // dentro un riquadro col nostro codice la scelta la mostra lui: un anello qui attorno a tutto il riquadro confonderebbe
    var dentroLui = !!el && el.tagName === 'IFRAME' && !!el.__hometvPronto && document.activeElement === el;
    if (!el || !el.isConnected || fsEl || pannelloAperto() || tendina || paginaDiCasa() || !document.body || dentroLui) {
      if (anello && anello.className) anello.className = '';
      anelloOra = null;
      return;
    }
    if (!anello) { anello = document.createElement('div'); anello.id = 'hometv-anello'; scriviHtml(anello, SVG_ANELLO); }
    var dove = contenitore();
    if (dove && anello.parentNode !== dove) dove.appendChild(anello);
    var r = rettangoloAnello(el), m = 5;
    if (r.width < 2 || r.height < 2 || !siVede(el)) { if (anello.className) anello.className = ''; anelloOra = null; return; }
    var meta = { l: r.left - m, t: r.top - m, w: r.width + m * 2, h: r.height + m * 2 }, q = meta;
    // scivola dalla cosa di prima a questa
    var k = anelloDa ? (Date.now() - anelloVia) / 150 : 1;
    if (k < 1) {
      k = 1 - (1 - k) * (1 - k);
      q = { l: anelloDa.l + (meta.l - anelloDa.l) * k, t: anelloDa.t + (meta.t - anelloDa.t) * k,
        w: anelloDa.w + (meta.w - anelloDa.w) * k, h: anelloDa.h + (meta.h - anelloDa.h) * k };
    } else anelloDa = null;
    var s = anello.style;
    s.left = Math.round(q.l) + 'px'; s.top = Math.round(q.t) + 'px';
    s.width = Math.round(q.w) + 'px'; s.height = Math.round(q.h) + 'px';
    var rx = Math.max(4, Math.min(14, Math.round(Math.min(q.w, q.h) / 4)));
    if (anello.__rx !== rx) {
      anello.__rx = rx;
      s.borderRadius = rx + 'px';
      var rr = anello.querySelectorAll('rect');
      for (var i = 0; i < rr.length; i++) { rr[i].setAttribute('rx', rx); rr[i].setAttribute('ry', rx); }
    }
    if (anello.className !== 'hometv-on') anello.className = 'hometv-on';
    anelloOra = q;
  }
  // Quello che si ingrandisce "col mouse sopra" e' spesso l'immagine dentro la cosa scelta, non la cosa
  // stessa: la cornice comprende anche quella (tagliata dove il sito la taglia).
  var anelloExtra = { el: null, lista: [] };
  function cercaIngranditi(el) {
    if (corrente !== el || anelloExtra.el !== el) return;
    var tutti = el.querySelectorAll('*');
    for (var i = 0; i < tutti.length && i < 80 && anelloExtra.lista.length < 6; i++) {
      var c = tutti[i], s;
      if (anelloExtra.lista.some(function (x) { return x.c === c; })) continue;
      try { s = window.getComputedStyle(c); } catch (e) { continue; }
      if ((!s.transform || s.transform === 'none') && (!s.scale || s.scale === 'none')) continue;
      var tagli = [];
      for (var p = c.parentElement; p && p !== el.parentElement; p = p.parentElement) {
        var sp = window.getComputedStyle(p);
        if (sp.overflowX !== 'visible' || sp.overflowY !== 'visible') tagli.push(p);
      }
      anelloExtra.lista.push({ c: c, tagli: tagli });
    }
  }
  function nuoviIngranditi(el) {
    anelloExtra = { el: el, lista: [] };
    [80, 400, 900].forEach(function (t) {
      setTimeout(function () { try { cercaIngranditi(el); } catch (e) {} if (corrente === el) seguiAnello(false); }, t);
    });
  }
  function rettangoloAnello(el) {
    var r = rettangolo(el);
    if (anelloExtra.el !== el || !anelloExtra.lista.length) return conAnteprima(el, r);
    var l = r.left, t = r.top, d = r.left + r.width, b = r.top + r.height;
    for (var i = 0; i < anelloExtra.lista.length; i++) {
      var x = anelloExtra.lista[i], q = x.c.getBoundingClientRect();
      if (!x.c.isConnected || q.width < 2 || q.height < 2 || invisibileFino(x.c, el)) continue;
      var ql = q.left, qt = q.top, qd = q.right, qb = q.bottom;
      for (var k = 0; k < x.tagli.length; k++) {
        var z = x.tagli[k].getBoundingClientRect();
        ql = Math.max(ql, z.left); qt = Math.max(qt, z.top); qd = Math.min(qd, z.right); qb = Math.min(qb, z.bottom);
      }
      if (qd - ql < 2 || qb - qt < 2) continue;
      l = Math.min(l, ql); t = Math.min(t, qt); d = Math.max(d, qd); b = Math.max(b, qb);
    }
    return conAnteprima(el, { left: l, top: t, right: d, bottom: b, width: d - l, height: b - t });
  }
  // "Col mouse sopra" tanti siti aprono un'anteprima piu' grande (video, pulsanti, voto) messa sopra la locandina,
  // spesso aggiunta altrove nella pagina: la cornice va attorno a lei, non alla locandina che c'e' sotto
  function conAnteprima(el, r) {
    var a = anteprimaSopra(el, r);
    if (!a) return r;
    var l = Math.min(r.left, a.left), t = Math.min(r.top, a.top), d = Math.max(r.right, a.right), b = Math.max(r.bottom, a.bottom);
    return { left: l, top: t, right: d, bottom: b, width: d - l, height: b - t };
  }
  // l'anteprima trovata per la cosa scelta: conta come parte di lei (cornice, frecce, OK)
  var anteprima = { di: null, el: null };
  function anteprimaSopra(el, r) {
    if (anteprima.di === el) anteprima.el = null;
    if (r.width < 8 || r.height < 8) return null;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2, W = window.innerWidth, H = window.innerHeight, sopra = null;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
    try { sopra = document.elementFromPoint(cx, cy); } catch (e) {}
    if (!sopra || sopra === el || sopra.contains(el)) return null; // niente sopra: e' lei che si vede
    // l'anteprima puo' essere dentro la locandina (creata quando ci passa "il mouse") o altrove nella pagina
    var fino = el.contains(sopra) ? el : document.body, area = r.width * r.height, meglio = null, megliEl = null;
    // si sale fino all'anteprima intera (video, pulsanti, voto): il riquadro piu' grande che e' ancora un'anteprima
    for (var n = sopra, k = 0; n && n.nodeType === 1 && n !== fino && n !== document.documentElement && k < 14; n = n.parentElement, k++) {
      if (n.id && n.id.indexOf('hometv-') === 0) return null;
      var q = n.getBoundingClientRect();
      if (q.width > W * 0.7 || q.height > H * 0.85) break; // grande come la pagina: non e' piu' l'anteprima
      var st = window.getComputedStyle(n);
      if (st.position !== 'absolute' && st.position !== 'fixed' && (!st.transform || st.transform === 'none')) continue;
      // deve coprire quasi tutta la locandina ed essere piu' grande di lei, per la parte che si vede davvero
      // (un'immagine ingrandita ma tagliata dalla sua scheda non e' piu' grande)
      if (sovrapposto(q, r) < area * 0.7 || q.width * q.height < area * 1.2) continue;
      q = ritagliato(n, q);
      if (sovrapposto(q, r) >= area * 0.7 && q.width * q.height >= area * 1.2 && (!meglio || q.width * q.height > meglio.width * meglio.height)) {
        meglio = q;
        megliEl = n;
      }
    }
    if (meglio) { anteprima.di = el; anteprima.el = megliEl; }
    return meglio;
  }
  function sovrapposto(q, r) {
    return Math.max(0, Math.min(q.right, r.right) - Math.max(q.left, r.left)) * Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top));
  }
  // la parte che si vede: tagliata dai contenitori che non lasciano uscire niente (overflow)
  function ritagliato(n, q) {
    var l = q.left, t = q.top, d = q.right, b = q.bottom;
    for (var a = n.parentElement, k = 0; a && a !== document.body && a !== document.documentElement && k < 15; a = a.parentElement, k++) {
      var st = window.getComputedStyle(a);
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
      var z = a.getBoundingClientRect();
      l = Math.max(l, z.left); t = Math.max(t, z.top); d = Math.min(d, z.right); b = Math.min(b, z.bottom);
    }
    return { left: l, top: t, right: d, bottom: b, width: Math.max(0, d - l), height: Math.max(0, b - t) };
  }
  // l'anteprima aperta adesso sulla cosa scelta (se c'e')
  function anteprimaDi(el) {
    if (!el || !el.isConnected) return null;
    try { anteprimaSopra(el, rettangolo(el)); } catch (e) { return null; }
    return anteprima.di === el && anteprima.el && anteprima.el.isConnected ? anteprima.el : null;
  }
  // trasparente o nascosto (lui o un contenitore fino alla cosa scelta): non si vede, la cornice non lo comprende
  function invisibileFino(n, fino) {
    for (var k = 0; n && n !== fino && k < 8; n = n.parentElement, k++) {
      var st = window.getComputedStyle(n);
      if (st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return true;
    }
    return false;
  }
  function seguiAnello(cambia) {
    if (cambia) { anelloDa = anelloOra; anelloVia = Date.now(); }
    // anche mentre la pagina scorre per portarla in vista, e mentre il sito la ingrandisce (spesso dopo un attimo)
    anelloFino = Date.now() + (cambia ? 1700 : 900);
    anelloFermo = 0;
    if (anelloRaf) return;
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    (function passo() {
      var prima = anelloOra;
      try { disegnaAnello(); } catch (e) {}
      // ferma da una dozzina di fotogrammi: non serve piu' ridisegnarla a ogni fotogramma (sul TV e' lavoro tolto alla
      // pagina). Se la pagina scorre o il sito la ingrandisce dopo, si riparte (scorrimento e controlli qui sotto)
      var q = anelloOra;
      anelloFermo = prima && q && !anelloDa && prima.l === q.l && prima.t === q.t && prima.w === q.w && prima.h === q.h ? anelloFermo + 1 : 0;
      anelloRaf = Date.now() < anelloFino && anelloFermo < 12 ? raf(passo) : 0;
    })();
  }

  /* ---------------------------------------------------------------- tendine <select>
   * Le scelte di un <select> in un elenco grande, come un menu del TV: Su/Giu', OK,
   * Indietro. Il sito riceve la scelta come se l'avessi fatta col mouse.
   */
  var tendina = null;
  function pulito(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'; });
  }
  function nomeCampo(s) {
    var t = '';
    try { if (s.id) { var l = document.querySelector('label[for="' + s.id.replace(/["\\]/g, '') + '"]'); if (l) t = l.textContent; } } catch (e) {}
    if (!t && s.closest) { var l2 = s.closest('label'); if (l2) t = l2.textContent; }
    t = t || s.getAttribute('aria-label') || s.getAttribute('title') || 'Scegli';
    return String(t).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 60);
  }
  function apriTendina(s) {
    var voci = [], ops = s.options || [], i;
    for (i = 0; i < ops.length; i++) {
      var o = ops[i], g = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement : null;
      if (o.hidden) continue;
      voci.push({ o: o, testo: (o.label || o.textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''), gruppo: g ? g.label : '', spenta: o.disabled || (!!g && g.disabled) });
    }
    if (!voci.length) return;
    var sel = 0;
    for (i = 0; i < voci.length; i++) if (voci[i].o.selected) { sel = i; break; }
    tendina = { s: s, voci: voci, i: sel };
    disegnaTendina();
  }
  function disegnaTendina() {
    var box = document.getElementById('hometv-tendina');
    if (!tendina) { if (box && box.parentNode) box.parentNode.removeChild(box); disegnaAnello(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'hometv-tendina'; }
    var dove = contenitore();
    if (dove && box.parentNode !== dove) dove.appendChild(box);
    var html = '<h2>' + pulito(nomeCampo(tendina.s)) + '</h2><div class="ht-voci">', gruppo = '';
    for (var i = 0; i < tendina.voci.length; i++) {
      var x = tendina.voci[i];
      if (x.gruppo && x.gruppo !== gruppo) { gruppo = x.gruppo; html += '<div class="ht-gruppo">' + pulito(gruppo) + '</div>'; }
      html += '<div class="ht-voce' + (i === tendina.i ? ' hometv-sel' : '') + (x.o.selected ? ' ht-attiva' : '') + (x.spenta ? ' ht-spenta' : '') + '">' +
        ICONE.spunta + pulito(x.testo || ' ') + '</div>';
    }
    html += '</div><p>' + (tendina.s.multiple ? 'OK seleziona o toglie &middot; Indietro chiude' : 'OK sceglie &middot; Indietro annulla') + '</p>';
    scriviHtml(box, html);
    var scelta = box.querySelector('.ht-voce.hometv-sel'), elenco = box.querySelector('.ht-voci');
    if (scelta && elenco) {
      if (scelta.offsetTop < elenco.scrollTop + 8) elenco.scrollTop = Math.max(0, scelta.offsetTop - 8);
      else if (scelta.offsetTop + scelta.offsetHeight > elenco.scrollTop + elenco.clientHeight - 8) elenco.scrollTop = scelta.offsetTop + scelta.offsetHeight - elenco.clientHeight + 8;
    }
    disegnaAnello();
  }
  function tastoTendina(azione) {
    var t = tendina, i;
    if (azione === 'su' || azione === 'giu') {
      var passo = azione === 'su' ? -1 : 1;
      for (i = t.i + passo; i >= 0 && i < t.voci.length; i += passo) if (!t.voci[i].spenta) { t.i = i; break; }
    } else if (azione === 'ok') {
      var x = t.voci[t.i];
      if (!x || x.spenta) return true;
      if (t.s.multiple) x.o.selected = !x.o.selected;
      else {
        var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
        try { d.set.call(t.s, x.o.index); } catch (e) { t.s.selectedIndex = x.o.index; }
      }
      lanciaEvento(t.s, 'input');
      lanciaEvento(t.s, 'change');
      if (!t.s.multiple) tendina = null;
    } else if (azione === 'indietro' || azione === 'stop' || azione === 'blu') {
      tendina = null;
    }
    disegnaTendina();
    return true;
  }

  // cursori (volume, luminosita'...): sinistra/destra li spostano
  function spostaCursore(el, verso) {
    try { if (verso > 0) el.stepUp(); else el.stepDown(); } catch (e) { return; }
    lanciaEvento(el, 'input');
    lanciaEvento(el, 'change');
  }

  function attiva(el, daTelefono) {
    if (!el) return false;
    if (el.tagName === 'VIDEO') {
      if (fsEl) { playPausa(); return true; }
      // un video ancora vuoto si riempie col Play del sito, che a schermo intero sarebbe coperto: prima si preme quello,
      // a schermo intero si va quando il video parte (partiDavvero)
      if (!vuoto(el)) entraSchermoIntero(el, true);
      partiDavvero(el);
      return true;
    }
    if (el.tagName === 'IFRAME') {
      // un lettore va a schermo intero; un altro riquadro (un menu, il pannello delle app di un sito): ci si entra
      if (eLettore(el)) entraSchermoIntero(el, true); else entraNelRiquadro(el);
      return true;
    }
    if (el.tagName === 'SELECT') { apriTendina(el); return true; }
    if (campoDiTesto(el) || el.isContentEditable) {
      // col telecomando scrive la tastiera del TV; dal telefono si scrive dal telefono
      if (!daTelefono) return false;
      el.focus();
      return true;
    }
    if (el.tagName === 'INPUT' && el.type === 'range') return true;
    // tutto il resto: un clic come col mouse, poi si guarda se si e' aperta una tendina
    var naviga = el.tagName === 'A' && /^https?:/i.test(el.href || '') && el.href.split('#')[0] !== location.href.split('#')[0] &&
      !el.hasAttribute('aria-haspopup') && !el.hasAttribute('aria-expanded');
    if (naviga) cliccaDavvero(el);
    else dopoAttivazione(suLoSchermo(), el, function () { cliccaDavvero(el); });
    return true;
  }

  /* ================================================================ puntatore (trackpad del telefono)
   * In modalita' Trackpad il telefono manda gli spostamenti del dito: qui un puntatore si muove
   * sullo schermo, liscio anche quando i movimenti arrivano a scatti (insegue la meta con una
   * piccola scia). Passandoci sopra fa come il mouse (menu che si aprono, comandi dei lettori), il
   * tocco e' un clic vero in quel punto, due dita scorrono quello che c'e' sotto (spinto oltre il
   * bordo scorre la pagina). Sopra un riquadro col nostro codice passa tutto a lui. Le frecce lo
   * nascondono; OK, mentre si vede, clicca dove indica.
   */
  var PT_RIF = 1920; // il telefono misura i movimenti per uno schermo largo 1920: qui si scala
  var pt = { x: -1, y: -1, mx: 0, my: 0, el: null, tocco: null, raf: 0, t: 0, on: false, mano: false, nascondi: null,
    sopra: null, sopraAt: 0, lettoreAt: 0, sottoDetto: '', riquadro: null, catena: null, catenaDi: null, rx: 0, ry: 0 };
  var SVG_PUNTATORE = '<svg viewBox="0 0 28 34"><defs><linearGradient id="hometv-colori-p" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#19d3b7"/><stop offset=".55" stop-color="#3b82f6"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>' +
    '<path class="hp-ombra" d="M4.6 3.6v23l6-5.5 4.2 9.5 4.4-2-4.1-9.2h8z"/><path class="hp-freccia" d="M3 2v23l6-5.5 4.2 9.5 4.4-2-4.1-9.2h8z"/></svg>';
  var SEL_MANO = 'a[href],button,select,summary,label,input,textarea,[role="button"],[role="link"],[role="menuitem"],[role="tab"],' +
    '[role="option"],[onclick]';
  var SEL_FUOCO = 'a[href],area[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]';
  function adesso() { return window.performance && performance.now ? performance.now() : Date.now(); }

  function mostraPuntatore() {
    if (IN_FRAME) return false; // nei riquadri lo disegna la pagina di sopra
    var dove = contenitore();
    if (!dove) return false;
    if (!pt.el) {
      pt.el = document.createElement('div');
      pt.el.id = 'hometv-puntatore';
      scriviHtml(pt.el, SVG_PUNTATORE);
    }
    if (pt.el.parentNode !== dove || pt.el.nextElementSibling) dove.appendChild(pt.el);
    if (pt.x < 0) {
      // pagina nuova: dov'era nella pagina di prima (se ci si e' arrivati cliccando), se no al centro
      var w = window.innerWidth, h = window.innerHeight, s = null;
      try { s = JSON.parse(sessionStorage.getItem('hometv-puntatore') || 'null'); } catch (e) {}
      if (s && Date.now() - s.at < 30000 && s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1) { pt.x = s.x * (w - 1); pt.y = s.y * (h - 1); }
      else { pt.x = Math.round(w / 2); pt.y = Math.round(h / 2); }
      pt.mx = pt.x; pt.my = pt.y;
    }
    if (!pt.on) {
      pt.on = true;
      document.documentElement.classList.add('hometv-puntatore-on');
      disegnaPuntatore();
    }
    var cl = 'hometv-on' + (pt.mano ? ' hometv-mano' : '');
    if (pt.el.className !== cl) pt.el.className = cl;
    clearTimeout(pt.nascondi);
    // fermo per un po' sparisce (sopra un video prima); torna al primo movimento
    pt.nascondi = setTimeout(nascondiPuntatore, fsEl ? 3500 : 20000);
    return true;
  }
  function nascondiPuntatore() {
    clearTimeout(pt.nascondi);
    if (!pt.on) return;
    pt.on = false;
    if (pt.el) pt.el.className = '';
    document.documentElement.classList.remove('hometv-puntatore-on');
    segnaSopra(corrente && corrente.isConnected ? corrente : null); // torna "sopra" la cosa scelta con le frecce
    diciSotto(null);
  }
  function disegnaPuntatore() {
    if (pt.el) pt.el.style.transform = 'translate3d(' + pt.mx.toFixed(1) + 'px,' + pt.my.toFixed(1) + 'px,0)';
  }
  function muoviPuntatore(dx, dy) {
    if (!mostraPuntatore()) return;
    var w = window.innerWidth, h = window.innerHeight, k = w / PT_RIF, x0 = pt.x, y0 = pt.y;
    var nx = pt.x + dx * k, ny = pt.y + dy * k;
    // spinto oltre il bordo in alto o in basso (quanto si sarebbe spostato): la pagina scorre, come col mouse sul bordo.
    // Contro il bordo destro o sinistro invece non scorre niente (prova sul simulatore del 26/10: nei siti una fila che
    // va avanti da sola non si controlla bene): le file si scorrono con la striscia in basso del telefono o cliccando
    // le frecce del sito col puntatore. Nella home e nel browser il bordo di lato resta (ui.js)
    var oltre = ny < 0 ? ny : (ny > h - 1 ? ny - (h - 1) : 0);
    pt.x = Math.max(0, Math.min(w - 1, nx));
    pt.y = Math.max(0, Math.min(h - 1, ny));
    if (oltre && !fsEl) scorriAlPunto(0, oltre, true);
    // fermo contro il bordo il puntatore non si muove: basta guardare cosa c'e' sotto ogni tanto
    if (pt.x !== x0 || pt.y !== y0) avviaPuntatore(); else sopraAlPunto(false);
  }
  // il puntatore insegue la meta: ci arriva in pochi fotogrammi anche se i movimenti arrivano a scatti
  function avviaPuntatore() {
    if (pt.raf) return;
    pt.t = 0;
    var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    (function passo() {
      var ora = adesso(), dt = pt.t ? Math.max(1, Math.min(64, ora - pt.t)) : 16;
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

  // cosa c'e' sotto il puntatore (anche dentro i componenti dei siti con le parti "nascoste")
  function elementoAlPunto(x, y) {
    var el = null, d, i;
    try { el = document.elementFromPoint(x, y); } catch (e) {}
    for (i = 0; el && el.shadowRoot && i < 8; i++) {
      d = null;
      try { d = el.shadowRoot.elementFromPoint(x, y); } catch (e) {}
      if (!d || d === el) break;
      el = d;
    }
    return el;
  }
  function sopraAlPunto(forza) {
    var ora = Date.now();
    if (!forza && ora - pt.sopraAt < 60) return;
    pt.sopraAt = ora;
    passaggioPuntatore(elementoAlPunto(pt.mx, pt.my), pt.mx, pt.my);
  }
  function uscitaMouse(da, a, x, y) {
    eventoMouse(da, 'pointerout', a, true, x, y); eventoMouse(da, 'mouseout', a, true, x, y);
    for (var n = da; n && n.nodeType === 1 && !(a && n.contains(a)); n = n.parentElement) {
      eventoMouse(n, 'pointerleave', a, false, x, y); eventoMouse(n, 'mouseleave', a, false, x, y);
    }
  }
  function entrataMouse(a, da, x, y) {
    eventoMouse(a, 'pointerover', da, true, x, y); eventoMouse(a, 'mouseover', da, true, x, y);
    var catena = [], n, i;
    for (n = a; n && n.nodeType === 1 && !(da && n.contains(da)); n = n.parentElement) catena.unshift(n);
    for (i = 0; i < catena.length; i++) { eventoMouse(catena[i], 'pointerenter', da, false, x, y); eventoMouse(catena[i], 'mouseenter', da, false, x, y); }
  }
  function passaggioPuntatore(el, x, y) {
    var prima = pt.sopra && pt.sopra.isConnected ? pt.sopra : null;
    if (el && el.tagName === 'IFRAME' && el.__hometvPronto) {
      // dentro un riquadro col nostro codice: il passaggio del mouse lo fa lui
      if (prima !== el) {
        if (prima) uscitaMouse(prima, el, x, y);
        pt.sopra = el;
        sottoIlMouse = null;
        segnaSopra(el);
        diciSotto(null);
        pt.sottoDetto = '#riquadro';
      }
      pt.riquadro = el;
      inoltraPuntatore(el, 'sopra', x, y);
    } else {
      if (pt.riquadro) { inoltraPuntatore(pt.riquadro, 'via', -1, -1); pt.riquadro = null; }
      if (el !== prima) {
        if (prima) uscitaMouse(prima, el, x, y);
        if (el) entrataMouse(el, prima, x, y);
        pt.sopra = el;
        sottoIlMouse = el;
        segnaSopra(el);
        aggiornaMano(el);
        diciSotto(el);
      }
      if (el) { eventoMouse(el, 'pointermove', null, true, x, y); eventoMouse(el, 'mousemove', null, true, x, y); }
    }
    // lettore TV: muovendo il puntatore si vedono i comandi
    if (lettoreVideo && lettore && (!lettore.className || Date.now() - pt.lettoreAt > 1500)) { pt.lettoreAt = Date.now(); mostraLettore(); }
  }
  // sopra le cose che si cliccano il puntatore si colora
  function aggiornaMano(el) {
    var mano = false;
    if (el && el.nodeType === 1) {
      try { mano = !!(el.closest && el.closest(SEL_MANO)); } catch (e) {}
      if (!mano) { try { var c = window.getComputedStyle(el).cursor; mano = c === 'pointer' || c === 'text'; } catch (e) {} }
      if (!mano) mano = !!(el.__hometvClic || (el.parentElement && el.parentElement.__hometvClic));
    }
    if (IN_FRAME) { try { window.parent.postMessage({ hometv: 'manoPuntatore', si: mano }, '*'); } catch (e) {} return; }
    impostaMano(mano);
  }
  function impostaMano(mano) {
    pt.mano = !!mano;
    if (!pt.el || !pt.on) return;
    var cl = 'hometv-on' + (pt.mano ? ' hometv-mano' : '');
    if (pt.el.className !== cl) pt.el.className = cl;
  }
  // il telefono sa se il puntatore e' sopra un campo dove si scrive: al tocco apre la sua tastiera
  function diciSotto(el) {
    var c = null, stato = { campo: false };
    if (el && el.nodeType === 1) {
      if (campoDiTesto(el)) c = el;
      else if (el.tagName === 'LABEL' && el.control && campoDiTesto(el.control)) c = el.control;
    }
    if (c) stato = { campo: true, etichetta: etichettaCampo(c), tipo: c.tagName === 'TEXTAREA' || c.isContentEditable ? 'testo' : String(c.type || 'text').toLowerCase() };
    var firma = c ? stato.etichetta + '|' + stato.tipo : '';
    if (firma === pt.sottoDetto) return;
    pt.sottoDetto = firma;
    try {
      fetch(SERVIZIO + '/api/telefono/sotto', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(stato) })['catch'](function () {});
    } catch (e) {}
  }

  function clicPuntatore() {
    if (!mostraPuntatore()) return;
    // il clic va dove il puntatore sta arrivando, non a meta' della scia
    pt.mx = pt.x; pt.my = pt.y;
    disegnaPuntatore();
    toccoVisibile(pt.x, pt.y);
    clicQui(pt.x, pt.y);
  }
  function clicQui(x, y) {
    if (clicNostro(x, y)) return;
    var el = elementoAlPunto(x, y);
    if (!el) return;
    passaggioPuntatore(el, x, y);
    if (el.tagName === 'IFRAME') {
      if (el.__hometvPronto) inoltraPuntatore(el, 'clic', x, y);
      else attiva(el, true); // riquadro senza il nostro codice: come OK, va a schermo intero
      return;
    }
    clicAlPunto(el, x, y);
  }
  function lanciaMouse(el, tipo, x, y, premuto) {
    var o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: premuto ? 1 : 0, detail: tipo === 'click' ? 1 : 0 };
    try {
      var e;
      if (tipo.indexOf('pointer') === 0 && MOTORE.puntatore) {
        o.pointerType = 'mouse'; o.isPrimary = true; o.pointerId = 1;
        e = new PointerEvent(tipo, o);
      } else e = new MouseEvent(tipo, o);
      return el.dispatchEvent(e);
    } catch (x2) { return true; }
  }
  // un clic vero in quel punto: premuto, (il fuoco, come col mouse), rilasciato, clic
  function clicAlPunto(el, x, y) {
    var sel = el.tagName === 'SELECT' ? el : (el.closest ? el.closest('select') : null);
    altroDaTe(el); // un clic su un'altra cosa mentre partiva il video che avevi chiesto: hai cambiato idea
    if (sel) { if (!sel.disabled) { setFocus(sel, true); apriTendina(sel); } return; }
    if (el.tagName === 'VIDEO' && !fsEl) { attiva(el, true); return; }
    clicDaNoi = Date.now();
    ultimoTasto = chiestoPlayA = ultimoOk = Date.now(); // il clic puo' essere sul Play del sito: l'hai fatto partire tu
    premutoAiRiquadri();
    var libero = lanciaMouse(el, 'pointerdown', x, y, true);
    if (libero) libero = lanciaMouse(el, 'mousedown', x, y, true);
    if (libero) fuocoDalClic(el);
    lanciaMouse(el, 'pointerup', x, y, false);
    lanciaMouse(el, 'mouseup', x, y, false);
    lanciaMouse(el, 'click', x, y, false);
  }
  function fuocoDalClic(el) {
    var f = null;
    try { f = el.closest ? el.closest(SEL_FUOCO) : null; } catch (e) {}
    if (f && f.disabled) f = null;
    // in un riquadro prende il fuoco solo un campo dove si scrive: i tasti del telecomando restano alla pagina
    if (f && IN_FRAME && !campoDiTesto(f) && !f.isContentEditable) f = null;
    if (f) {
      setFocus(f, true); // anche le frecce ripartono da qui
      if (campoDiTesto(f)) { try { var n = String(f.value || '').length; f.setSelectionRange(n, n); } catch (e) {} }
      return;
    }
    // clic fuori dal campo dove si scriveva (anche dentro un riquadro): si smette di scrivere, come col mouse
    var a = document.activeElement;
    if (a && a !== document.body && (campoDiTesto(a) || a.isContentEditable || a.tagName === 'IFRAME')) { try { a.blur(); } catch (e) {} }
    if (a && a.tagName === 'IFRAME') { try { window.focus(); } catch (e) {} }
  }
  function toccoVisibile(x, y) {
    var dove = contenitore();
    if (!dove) return;
    if (!pt.tocco) { pt.tocco = document.createElement('div'); pt.tocco.id = 'hometv-tocco'; }
    if (pt.tocco.parentNode !== dove) dove.appendChild(pt.tocco);
    pt.tocco.style.left = x + 'px';
    pt.tocco.style.top = y + 'px';
    pt.tocco.className = '';
    void pt.tocco.offsetWidth; // l'animazione riparte
    pt.tocco.className = 'hometv-on';
  }
  function dentroRett(el, x, y) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  // i nostri pannelli (tendina, pannello rapido, lettore TV) si usano anche col puntatore
  function clicNostro(x, y) {
    var i, l, box, c;
    if (tendina) {
      box = document.getElementById('hometv-tendina');
      l = box ? box.querySelectorAll('.ht-voce') : [];
      for (i = 0; i < l.length; i++) if (dentroRett(l[i], x, y)) { tendina.i = i; tastoTendina('ok'); return true; }
      if (!dentroRett(box, x, y)) tastoTendina('indietro'); // clic fuori: si chiude
      return true;
    }
    if (pannelloAperto()) {
      l = pannello.querySelectorAll('div');
      for (i = 0; i < l.length && i < voci.length; i++) {
        if (dentroRett(l[i], x, y)) { pannelloSel = i; disegnaPannello(); voci[i].fai(); return true; }
      }
      if (!dentroRett(pannello, x, y)) chiudiPannello();
      return true;
    }
    if (!lettoreVideo || !lettore || !lettore.parentNode || !fsEl) return false;
    var v = lettoreVideo;
    if (pannelloLingue) {
      var cols = lettore.querySelectorAll('.hl-col');
      for (c = 0; c < cols.length && c < pannelloLingue.colonne.length; c++) {
        l = cols[c].querySelectorAll('.hl-voce');
        for (i = 0; i < l.length; i++) {
          if (dentroRett(l[i], x, y)) { pannelloLingue.col = c; pannelloLingue.colonne[c].sel = i; sceltaLingua(); return true; }
        }
      }
      if (!dentroRett(pezzo('hl-lingue'), x, y)) chiudiPannelloLingue();
      return true;
    }
    if (propostaAttiva() && dentroRett(pezzo('hl-avviso'), x, y)) { accettaProposta(); return true; }
    if (serie.conto > 0 && dentroRett(pezzo('hl-prossimo'), x, y)) { vaiProssimo(); return true; }
    for (i = 0; i < PULSANTI.length; i++) {
      var chip = pezzo('hl-' + PULSANTI[i]);
      if (chip.style.display !== 'none' && dentroRett(chip, x, y)) { serie.fuoco = PULSANTI[i]; tastoLettore('ok'); return true; }
    }
    // sulla barra del tempo: il video va in quel punto
    var b = pezzo('hl-barra').getBoundingClientRect();
    if (b.width > 0 && x >= b.left - 12 && x <= b.right + 12 && Math.abs(y - (b.top + b.height / 2)) <= Math.max(26, window.innerHeight * 0.035)) {
      if (isFinite(v.duration) && v.duration > 0) comandoVideo({ azione: 'vai', secondi: Math.max(0, Math.min(1, (x - b.left) / b.width)) * v.duration });
      return true;
    }
    // in un altro punto del video: pausa o play, come un clic sul lettore
    tastoLettore('playpausa');
    return true;
  }

  function scorriPuntatore(dx, dy) {
    if (!mostraPuntatore()) return;
    var k = window.innerWidth / PT_RIF;
    scorriAlPunto(dx * k, dy * k, false);
  }
  // bordo: spinto oltre il bordo in alto o in basso (scorre in verticale quello che c'e' sotto o la pagina, senza
  // rotella finta e senza passare ai riquadri)
  function scorriAlPunto(dx, dy, bordo) {
    var x = pt.x, y = pt.y, i, l;
    if (tendina) { l = document.querySelector('#hometv-tendina .ht-voci'); if (l) l.scrollTop += dy; return; }
    if (pannelloLingue && lettore) {
      l = lettore.querySelectorAll('.hl-elenco');
      for (i = 0; i < l.length; i++) if (dentroRett(l[i], x, y)) l[i].scrollTop += dy;
      return;
    }
    var el = elementoAlPunto(x, y);
    if (!bordo && el && el.tagName === 'IFRAME' && el.__hometvPronto) { inoltraPuntatore(el, 'scorri', x, y, dx, dy); return; }
    if (!bordo && el) {
      var w = null;
      try { w = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, deltaX: dx, deltaY: dy, deltaMode: 0 }); } catch (e) {}
      if (w && !el.dispatchEvent(w)) return; // il sito scorre da se' (caroselli, mappe)
    }
    // ogni direzione va a chi scorre in quella direzione: una fila che scorre di lato non ferma la pagina
    var vx = 0, vy = 0, n;
    if (dy) { n = scorrevoleAsse(el, 'y', dy); if (n) scorriElemento(n, 0, dy); else vy = dy; }
    if (dx) {
      n = scorrevoleAsse(el, 'x', dx);
      if (n) scorriElemento(n, dx, 0);
      else if (Math.abs(dx) < Math.abs(dy) || !el || !scorriCarosello(el, dx, x, y)) vx = dx; // se no, la pagina di lato
    }
    if (vx || vy) scorriPagina(vx, vy);
  }
  // la pagina scorre; un riquadro che non puo' piu' scorrere passa lo scorrimento a chi lo contiene (come la rotella)
  function scorriPagina(vx, vy) {
    var px = window.pageXOffset, py = window.pageYOffset;
    scorriElemento(null, vx, vy);
    if (IN_FRAME && px === window.pageXOffset && py === window.pageYOffset && (Math.abs(vx) >= 1 || Math.abs(vy) >= 1)) {
      try { window.parent.postMessage({ hometv: 'scorriFuori', dx: vx, dy: vy }, '*'); } catch (e) {}
    }
  }
  // arriva da un riquadro di questa pagina che non scorre piu': scorre chi lo contiene, se no la pagina
  function scorriDaRiquadro(fr, dx, dy) {
    var n, vx = 0, vy = 0;
    if (dy) { n = scorrevoleAsse(fr, 'y', dy); if (n) scorriElemento(n, 0, dy); else vy = dy; }
    if (dx) { n = scorrevoleAsse(fr, 'x', dx); if (n) scorriElemento(n, dx, 0); else vx = dx; }
    if (vx || vy) scorriPagina(vx, vy);
  }

  /* caroselli che non scorrono da soli (file di film, slider): si usano le loro frecce, come col mouse;
   * se non ne hanno si trascinano, come col dito o col mouse */
  var giroCar = null;
  var PAROLE_SUCC = { next: 1, successivo: 1, successiva: 1, successivi: 1, avanti: 1, seguente: 1, right: 1, destra: 1, forward: 1, prossimo: 1 };
  var PAROLE_PREC = { prev: 1, previous: 1, precedente: 1, precedenti: 1, indietro: 1, left: 1, sinistra: 1, backward: 1 };
  // le parole di direzione in un testo: 1 = avanti, 2 = indietro, 3 = tutte e due
  function paroleVerso(t) {
    var p = String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z\u00e0-\u00f9]+/), v = 0;
    for (var i = 0; i < p.length; i++) { if (PAROLE_SUCC[p[i]] === 1) v |= 1; if (PAROLE_PREC[p[i]] === 1) v |= 2; }
    return v;
  }
  // un nome di classe "da freccia" (swiper-button-next, handleNext, slick-next, arrow-right, carousel-control-prev...)
  var CLASSE_FRECCIA = /arrow|btn|button|control|handle|chevron|caret|slide|swiper|slick|splide|glide|owl|flickity|carousel|scroll|paddle|pager|pagination/i;
  function versoFreccia(c) {
    // i nomi per le persone e gli attributi delle librerie (Bootstrap, tiny-slider...)
    var v = paroleVerso([c.getAttribute('aria-label'), c.getAttribute('title'), c.getAttribute('data-direction'), c.getAttribute('data-slide'),
      c.getAttribute('data-bs-slide'), c.getAttribute('data-controls'), c.getAttribute('data-action')].join(' '));
    // classi e id: contano solo dentro un nome da freccia o se sono proprio "next"/"prev" (float-right, text-left,
    // header-right sono impaginazione); un nome con tutte e due le direzioni (flickity-prev-next-button) non dice niente
    var nomi = (classeDi(c) + ' ' + (c.id || '')).split(/\s+/);
    for (var i = 0; i < nomi.length; i++) {
      var nome = nomi[i];
      if (!nome) continue;
      if (/^(next|prev|previous|successivo|precedente)$/i.test(nome)) { v |= /^(next|successivo)$/i.test(nome) ? 1 : 2; continue; }
      if (!CLASSE_FRECCIA.test(nome)) continue;
      var w = paroleVerso(nome);
      if (w !== 3) v |= w;
    }
    if (v === 1) return 1;
    if (v === 2) return -1;
    if (v) return 0;
    // il testo: un simbolo (">", freccia) o una parola sola
    var tx = (c.textContent || '').replace(/\s+/g, '');
    if (/^(\u203a|\u00bb|\u2192|>|\u276f)$/.test(tx)) return 1;
    if (/^(\u2039|\u00ab|\u2190|<|\u276e)$/.test(tx)) return -1;
    if (/^(next|successivo|avanti)$/i.test(tx)) return 1;
    if (/^(prev|previous|precedente)$/i.test(tx)) return -1;
    return 0;
  }
  function trovaCarosello(el) {
    // una fila e' ben piu' larga della locandina (una locandina con l'immagine ingrandita col mouse sopra sborda, ma non
    // e' una fila)
    var largo = null, re = el.getBoundingClientRect(), minimo = Math.max(120, Math.min(re.width * 1.6, window.innerWidth * 0.5));
    for (var n = el, figlio = null, k = 0; n && n.nodeType === 1 && n !== document.body && k < 12; figlio = n, n = n.parentElement, k++) {
      if (n.clientWidth < minimo) continue;
      var s = null;
      if (n.scrollWidth > n.clientWidth + 24) {
        if (n.clientWidth < 600 && n.scrollWidth < n.clientWidth * 1.3) continue; // stretta e sborda di poco: un'immagine ingrandita
        try { s = window.getComputedStyle(n); } catch (e) { continue; }
        if (/(auto|scroll|overlay)/.test(s.overflowX)) continue;
        // nascosto: lo fa scorrere il sito. Se sborda e basta (il nastro che il sito sposta) la fila e' chi lo taglia,
        // piu' su; se lo taglia solo la pagina intera, la fila e' lui
        if (/(hidden|clip)/.test(s.overflowX)) return !largo || n.getBoundingClientRect().height <= window.innerHeight * 0.6 ? n : largo;
        if (!largo) largo = n;
      } else if (figlio) {
        // spostato tutto a sinistra (l'ultima pagina di una fila col transform): per il browser non sborda piu', ma il
        // nastro sporge dalla fila che lo taglia
        var rn = n.getBoundingClientRect(), rf = figlio.getBoundingClientRect();
        if (rn.height <= window.innerHeight * 0.6 && (rf.left < rn.left - 24 || rf.right > rn.right + 24)) {
          try { s = window.getComputedStyle(n); } catch (e) { continue; }
          if (/(hidden|clip)/.test(s.overflowX)) return n;
        }
      }
    }
    return largo;
  }
  /* La freccia della fila: accanto alla fila; se no nel suo titolo, appena sopra e a destra (le due frecce insieme);
   * se no un pulsante senza nome (solo un'icona) proprio sul bordo della fila, a meta' altezza. Si cerca partendo dalla
   * fila e salendo fino a 3 livelli: a ogni livello le parti accanto, ognuna per conto suo (di solito le frecce sono
   * sorelle del nastro, spesso dopo centinaia di locandine), e dentro di loro solo cio' che sta all'altezza della fila e
   * sullo schermo; poi, dentro la fila, dalla locandina in su (frecce accanto al nastro, dentro la "maschera"). */
  var SEL_FRECCE = 'button, a, [role="button"], [aria-label], [class*="arrow"], [class*="Arrow"], [class*="next"], [class*="Next"], ' +
    '[class*="prev"], [class*="Prev"], [class*="handle"]';
  function frecciaDel(box, dir, da) {
    var rb = areaFila(box), trovate = { sopra: null, muta: null, giri: 0, radiceTop: 0 }, f, n, via, k, fila = null;
    // il pezzo della fila che contiene la cosa da cui si parte: le frecce stanno accanto a lui
    if (da && da !== box && box.contains(da)) for (fila = da; fila.parentElement && fila.parentElement !== box; fila = fila.parentElement) {}
    for (n = box, via = fila, k = 0; n && n !== document.body && k < 4; via = n, n = n.parentElement, k++) {
      if ((f = frecciaAccanto(n, via, rb, dir, trovate))) return f;
    }
    for (n = fila ? da.parentElement : null, via = da; n && n !== box; via = n, n = n.parentElement) {
      if ((f = frecciaAccanto(n, via, rb, dir, trovate))) return f;
    }
    return trovate.sopra || trovate.muta;
  }
  // i figli di n (anche quelli nello shadow DOM), tranne via: quelli all'altezza della fila e sullo schermo
  function frecciaAccanto(n, via, rb, dir, trovate) {
    var W = window.innerWidth, gruppi = [n.firstElementChild, n.shadowRoot ? n.shadowRoot.firstElementChild : null], c, rr, f, g;
    for (g = 0; g < 2; g++) {
      for (c = gruppi[g]; c; c = c.nextElementSibling) {
        if (c === via) continue;
        rr = c.getBoundingClientRect();
        if ((rr.width || rr.height) && (rr.top > rb.bottom || rr.bottom < rb.top - 90 || rr.right < 0 || rr.left > W)) continue;
        trovate.radiceTop = rr.width || rr.height ? rr.top : rb.top;
        if ((f = frecciaSotto(c, rb, dir, trovate))) return f;
      }
    }
    return null;
  }
  // dentro una parte della pagina: solo cio' che sta all'altezza della fila e sullo schermo (al massimo 400 elementi per
  // ricerca, anche dentro i componenti con lo shadow DOM)
  function frecciaSotto(radice, rb, dir, trovate) {
    var pila = [radice], W = window.innerWidth, el, r, f, c, vuoto;
    while (pila.length) {
      el = pila.pop();
      if (++trovate.giri > 400) return null;
      r = el.getBoundingClientRect();
      vuoto = !r.width && !r.height; // display:contents o un contenitore senza misura: si guarda dentro
      if (!vuoto && (r.top > rb.bottom || r.bottom < rb.top - 90 || r.right < 0 || r.left > W)) continue;
      if (!vuoto && el.matches && el.matches(SEL_FRECCE) && (f = provaFreccia(el, r, rb, dir, trovate))) return f;
      if (el.shadowRoot) for (c = el.shadowRoot.lastElementChild; c; c = c.previousElementSibling) pila.push(c);
      for (c = el.lastElementChild; c; c = c.previousElementSibling) pila.push(c);
    }
    return null;
  }
  function provaFreccia(c, r, rb, dir, trovate) {
    if (r.width < 8 || r.height < 8 || c.disabled || c.getAttribute('aria-disabled') === 'true') return null;
    var v = versoFreccia(c);
    if (v === dir) {
      if (!frecciaAccesa(c) || !fattaDaFreccia(c, r, rb)) return null;
      if (r.bottom >= rb.top) return c; // accanto alla fila
      // nel titolo della fila, appena sopra e a destra: solo se il pezzo che la contiene comincia li' (non la fila sopra)
      if (!trovate.sopra && trovate.radiceTop >= rb.top - 130 && r.left + r.width / 2 > rb.left + rb.width * 0.5) trovate.sopra = c;
    } else if (!v && !trovate.muta && r.bottom >= rb.top && frecciaMuta(c, r, rb, dir)) trovate.muta = c;
    return null;
  }
  // una freccia e' piccola, sullo schermo, senza immagini e non porta a un'altra pagina (mai "Vedi tutti \u203a" o una
  // locandina che si chiama "Next in Fashion")
  function fattaDaFreccia(c, r, rb) {
    if (r.width > Math.max(160, rb.width * 0.12) || r.right < 0 || r.left > window.innerWidth) return false;
    if (c.querySelector && c.querySelector('img, picture, video')) return false;
    var a = c.closest ? c.closest('a[href]') : null;
    return !(a && linkAltrove(a));
  }
  // un link a un'altra pagina (non "#" o un'ancora di questa)
  function linkAltrove(a) {
    var h = hrefDi(a);
    return /^https?:/i.test(h) && h.split('#')[0] !== location.href.split('#')[0];
  }
  // la parte della fila che si vede (un nastro spostato col transform puo' avere il suo riquadro fuori schermo)
  function areaFila(car) {
    var r = car.getBoundingClientRect(), W = window.innerWidth, a = Math.max(r.left, 0), b = Math.min(r.right, W);
    if (b - a < 300) { a = 0; b = W; }
    return { left: a, right: b, width: b - a, top: r.top, bottom: r.bottom, height: r.height };
  }
  // spenta (a fine fila molti siti la lasciano li', grigia o nascosta): non si preme. Trasparente invece si' (tante
  // si vedono solo col mouse sopra la fila)
  function frecciaAccesa(c) {
    var s = null;
    if (/disabled|inactive|is-end\b/i.test(classeDi(c)) || c.getAttribute('aria-hidden') === 'true') return false;
    try { s = window.getComputedStyle(c); } catch (e) {}
    return !s || (s.visibility !== 'hidden' && s.pointerEvents !== 'none');
  }
  function classeDi(c) { return typeof c.className === 'string' ? c.className : (c.className && c.className.baseVal) || ''; }
  // un pulsante senza nome ne' testo (solo un'icona), stretto, sopra la fila (posizionato), sul suo bordo e a meta'
  // altezza: e' la sua freccia. Mai un link vero o una locandina (un'immagine, un nome). ancheSpenta: per riconoscerla
  // (non per premerla)
  function frecciaMuta(c, r, rb, dir, ancheSpenta) {
    if (c.tagName === 'A') { if (linkAltrove(c)) return false; }
    else if (c.tagName !== 'BUTTON' && c.getAttribute('role') !== 'button' && !/arrow|handle|chevron|caret/i.test(classeDi(c))) return false;
    var a = c.closest ? c.closest('a[href]') : null;
    if (a && a !== c && linkAltrove(a)) return false;
    if (c.getAttribute('aria-label') || c.getAttribute('title') || (c.textContent || '').replace(/\s+/g, '').length > 1) return false;
    if (r.width > Math.min(120, rb.width * 0.12) || r.height < 20 || c.querySelector('img, picture, video')) return false;
    var meta = rb.top + rb.height / 2, bordo = Math.max(rb.width * 0.05, 40);
    if (Math.abs(r.top + r.height / 2 - meta) > rb.height * 0.2) return false;
    if (dir > 0 ? r.right < Math.min(rb.right, window.innerWidth) - bordo : r.left > Math.max(rb.left, 0) + bordo) return false;
    var s = null, p = null;
    try { s = window.getComputedStyle(c); p = c.parentElement ? window.getComputedStyle(c.parentElement) : null; } catch (e) { return false; }
    if (!/(absolute|fixed|sticky)/.test(s.position) && !(p && /(absolute|fixed|sticky)/.test(p.position))) return false;
    return ancheSpenta || frecciaAccesa(c);
  }
  function scorriCarosello(el, dx, x, y) {
    var box = trovaCarosello(el);
    if (!box) return false;
    if (!giroCar || giroCar.box !== box) {
      fineGiroCar();
      giroCar = { box: box, el: el, somma: 0, x: x, y: y, premuto: false, clic: 0, ultimoClic: 0, frecce: {}, timer: null };
    }
    var g = giroCar;
    g.somma += dx;
    clearTimeout(g.timer);
    g.timer = setTimeout(fineGiroCar, 220);
    var dir = g.somma > 0 ? 1 : -1;
    if (!Object.prototype.hasOwnProperty.call(g.frecce, dir)) g.frecce[dir] = frecciaDellaFila(box, dir, null, null, true);
    if (g.frecce[dir] && !g.premuto) {
      // una "pagina" del carosello ogni tanto (al massimo 3 per gesto), come premendo le sue frecce
      if (Math.abs(g.somma) >= 200 && g.clic < 3 && Date.now() - g.ultimoClic > 300) {
        g.somma -= dir * 200;
        g.clic++;
        g.ultimoClic = Date.now();
        cliccaDavvero(g.frecce[dir]);
      }
      return true;
    }
    // senza frecce: si trascina col "mouse" premuto
    if (!g.premuto) {
      g.premuto = true;
      lanciaMouse(g.el, 'pointerdown', g.x, g.y, true);
      lanciaMouse(g.el, 'mousedown', g.x, g.y, true);
    }
    g.x -= dx;
    lanciaMouse(g.el, 'pointermove', g.x, g.y, true);
    lanciaMouse(g.el, 'mousemove', g.x, g.y, true);
    return true;
  }
  function fineGiroCar() {
    var g = giroCar;
    giroCar = null;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.premuto) {
      lanciaMouse(g.el, 'pointerup', g.x, g.y, false);
      lanciaMouse(g.el, 'mouseup', g.x, g.y, false);
    }
  }
  // i riquadri che scorrono sotto il puntatore (dal piu' vicino); si ricalcolano solo se cambia la cosa sotto
  function catenaScorrevole(el) {
    if (pt.catenaDi === el && pt.catena) return pt.catena;
    var c = [], n, i, s;
    for (n = el, i = 0; n && n.nodeType === 1 && i < 30; n = n.parentElement || (n.parentNode && n.parentNode.host) || null, i++) {
      if (n === document.body || n === document.documentElement) break;
      try { s = window.getComputedStyle(n); } catch (e) { continue; }
      var ox = /(auto|scroll|overlay)/.test(s.overflowX), oy = /(auto|scroll|overlay)/.test(s.overflowY);
      if ((ox && n.scrollWidth > n.clientWidth + 1) || (oy && n.scrollHeight > n.clientHeight + 1)) c.push({ n: n, x: ox, y: oy });
    }
    pt.catena = c;
    pt.catenaDi = el;
    return c;
  }
  // il piu' vicino che scorre ancora in quella direzione (y: su e giu', x: destra e sinistra)
  function scorrevoleAsse(el, asse, d) {
    var c = el ? catenaScorrevole(el) : [];
    for (var i = 0; i < c.length; i++) {
      var n = c[i].n;
      if (asse === 'y' && c[i].y && ((d > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) || (d < 0 && n.scrollTop > 0))) return n;
      if (asse === 'x' && c[i].x && ((d > 0 && n.scrollLeft + n.clientWidth < n.scrollWidth - 1) || (d < 0 && n.scrollLeft > 0))) return n;
    }
    return null;
  }
  function scorriElemento(n, dx, dy) {
    // i pezzi di pixel si tengono da parte: anche lo scorrimento lento si muove
    var tx = dx + pt.rx, ty = dy + pt.ry;
    var ix = tx < 0 ? Math.ceil(tx) : Math.floor(tx), iy = ty < 0 ? Math.ceil(ty) : Math.floor(ty);
    pt.rx = tx - ix; pt.ry = ty - iy;
    if (!ix && !iy) return;
    // niente scorrimento "morbido" del sito (va gia' liscio cosi'): lo stile si tocca solo dove c'e' (a ogni passo costa)
    var radice = n || document.documentElement, liscio = scorreLiscio(radice), st = radice.style, prima = st.scrollBehavior;
    if (liscio) st.scrollBehavior = 'auto';
    if (n) { if (ix) n.scrollLeft += ix; if (iy) n.scrollTop += iy; }
    else window.scrollBy(ix, iy);
    if (liscio) st.scrollBehavior = prima;
  }
  function scorreLiscio(el) {
    if (el.__hometvLiscio === undefined) {
      var s = null;
      try { s = window.getComputedStyle(el); } catch (e) {}
      el.__hometvLiscio = !!s && s.scrollBehavior === 'smooth';
    }
    return el.__hometvLiscio;
  }
  // dentro un riquadro: le coordinate del riquadro
  function inoltraPuntatore(fr, azione, x, y, dx, dy) {
    var r = fr.getBoundingClientRect(), k = fr.offsetWidth ? r.width / fr.offsetWidth : 1;
    if (!k) k = 1;
    var msg = { hometv: 'puntatore', azione: azione, x: (x - r.left) / k - fr.clientLeft, y: (y - r.top) / k - fr.clientTop,
      dx: (dx || 0) / k, dy: (dy || 0) / k };
    try { fr.contentWindow.postMessage(msg, '*'); } catch (e) {}
  }
  // nel riquadro: quello che il puntatore fa qui dentro (il puntatore lo disegna la pagina di sopra)
  function puntatoreDaFuori(d) {
    if (d.azione === 'via') {
      var prima = pt.sopra && pt.sopra.isConnected ? pt.sopra : null;
      if (prima) uscitaMouse(prima, null, 0, 0);
      if (pt.riquadro) { inoltraPuntatore(pt.riquadro, 'via', -1, -1); pt.riquadro = null; }
      pt.sopra = null;
      sottoIlMouse = null;
      pt.sottoDetto = '';
      return;
    }
    var x = Number(d.x), y = Number(d.y);
    if (!isFinite(x) || !isFinite(y)) return;
    pt.x = pt.mx = x; pt.y = pt.my = y;
    if (d.azione === 'sopra') passaggioPuntatore(elementoAlPunto(x, y), x, y);
    else if (d.azione === 'clic') clicQui(x, y);
    else if (d.azione === 'tieni') menuPuntatore();
    else if (d.azione === 'scorri') scorriAlPunto(Number(d.dx) || 0, Number(d.dy) || 0, false);
  }
  function comandoPuntatore(e) {
    var az = e && e.azione;
    if (az === 'muovi') muoviPuntatore(Number(e.dx) || 0, Number(e.dy) || 0);
    else if (az === 'scorri') scorriPuntatore(Number(e.dx) || 0, Number(e.dy) || 0);
    else if (az === 'clic') clicPuntatore();
    else if (az === 'tieni') menuPuntatore();
    // 'fine' e 'vivo' (dito alzato, dito ancora giu') servono solo alla home e al browser (ui.js): nei siti il bordo di
    // lato non scorre
    else if (az === 'mostra') { if (mostraPuntatore()) avviaPuntatore(); }
    else if (az === 'nascondi') nascondiPuntatore();
  }
  // tocco lungo sul trackpad: il "tasto destro" proprio li' (i siti che hanno un loro menu lo aprono)
  function menuPuntatore() {
    if (!IN_FRAME && !mostraPuntatore()) return; // nel riquadro il puntatore lo disegna la pagina di sopra
    var el = elementoAlPunto(pt.x, pt.y);
    if (!el) return;
    if (el.tagName === 'IFRAME' && el.__hometvPronto) { inoltraPuntatore(el, 'tieni', pt.x, pt.y); return; }
    if (!IN_FRAME) toccoVisibile(pt.x, pt.y);
    try { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, view: window, clientX: pt.x, clientY: pt.y, button: 2, buttons: 2 })); } catch (e) {}
  }

  /* ================================================================ testo dal telefono */

  function campoDiTesto(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|range|reset|image|file|hidden|color)$/i.test(el.type || '');
  }
  // il cursore del testo e' all'inizio (sinistra) o alla fine (destra) del campo, o il campo e' vuoto
  function alBordoDelTesto(el, dir) {
    var v = String(el.value || '');
    if (!v) return true;
    var s, e;
    try { s = el.selectionStart; e = el.selectionEnd; } catch (x) { return false; }
    if (typeof s !== 'number' || s !== e) return false;
    return dir === 'sx' ? s === 0 : s === v.length;
  }

  // nessun campo selezionato: si cerca la casella di ricerca del sito
  function trovaCampoRicerca() {
    var c = document.querySelectorAll('input[type="search"], input[type="text"], input:not([type])');
    for (var i = 0; i < c.length; i++) {
      var el = c[i];
      var r = el.getBoundingClientRect();
      if (!campoDiTesto(el) || r.width < 20 || r.height < 10 || !visibile(el)) continue;
      var nomi = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.className].join(' ');
      if (el.type === 'search' || /cerca|search|ricerca|query|keyword|^q$|^s$/i.test(nomi)) return el;
    }
    return null;
  }

  function tastoFinto(el, tipo) {
    var e, ok;
    try { e = new KeyboardEvent(tipo, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }); }
    catch (x) { e = document.createEvent('Event'); e.initEvent(tipo, true, true); }
    try {
      Object.defineProperty(e, 'keyCode', { get: function () { return 13; } });
      Object.defineProperty(e, 'which', { get: function () { return 13; } });
    } catch (x) {}
    tastoNostro = true;
    try { ok = el.dispatchEvent(e); } catch (x) { ok = true; }
    tastoNostro = false;
    return ok;
  }

  // come premere Invio: prima il sito puo' gestirlo da se', altrimenti si invia il modulo
  function premiInvio(el) {
    if (el.tagName === 'TEXTAREA') return;
    var libero = tastoFinto(el, 'keydown');
    tastoFinto(el, 'keypress');
    tastoFinto(el, 'keyup');
    if (libero && el.form) {
      try { if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit(); else el.form.submit(); } catch (e) {}
    }
    try { el.blur(); } catch (e) {}
  }

  function scriviTesto(t, invio) {
    var a = document.activeElement;
    // si scrive in un campo dentro un riquadro (scelto col puntatore): il testo va a lui
    if (a && a.tagName === 'IFRAME' && a.__hometvPronto && a.__hometvCampo) {
      try { a.contentWindow.postMessage({ hometv: 'testo', testo: t, invio: !!invio }, '*'); } catch (e) {}
      return;
    }
    var el = campoDiTesto(document.activeElement) ? document.activeElement :
      (campoDiTesto(corrente) ? corrente : (invio ? trovaCampoRicerca() : null));
    if (!el) {
      if (invio) toast('Seleziona prima un campo di testo sul TV (o apri la ricerca del sito)', 4000);
      return;
    }
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    // cosi' se ne accorgono anche i siti fatti con React e simili
    try { d.set.call(el, t); } catch (e) { el.value = t; }
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    if (!invio) return; // mentre scrivi sul telefono: il campo resta aperto (e il sito puo' suggerire)
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    premiInvio(el);
  }

  /* ---------------------------------------------------------------- il campo dove si scrive, per il telefono
   * Quando sul TV si sceglie un campo dove si scrive, il telefono collegato lo sa subito e
   * propone di scrivere da li': il testo compare nel campo mentre lo scrivi.
   */
  var campoDetto = null, campoTimer = null;
  function etichettaCampo(el) {
    var t = '';
    try { if (el.id) { var l = document.querySelector('label[for="' + el.id.replace(/["\\]/g, '') + '"]'); if (l) t = l.textContent; } } catch (e) {}
    if (!t && el.closest) { var l2 = el.closest('label'); if (l2) t = l2.textContent; }
    t = t || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '';
    if (!t && (el.type === 'search' || /cerca|search|ricerca|query/i.test((el.name || '') + ' ' + (el.id || '')))) t = 'Cerca';
    return String(t).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 60) || HOST.replace(/^www\./, '');
  }
  function diciCampo(dopo) {
    campoTimer = null;
    var el = document.activeElement, stato = { attivo: false };
    // il fuoco e' in un riquadro col nostro codice: se li' si scrive lo dice lui (si aspetta un attimo la sua notizia)
    if (el && el.tagName === 'IFRAME' && el.__hometvPronto) {
      if (el.__hometvCampo) return;
      if (dopo !== true) { campoTimer = setTimeout(function () { diciCampo(true); }, 350); return; }
    }
    if (campoDiTesto(el)) {
      var tipo = el.tagName === 'TEXTAREA' ? 'testo' : String(el.type || 'text').toLowerCase();
      stato = { attivo: true, etichetta: etichettaCampo(el), tipo: tipo, valore: tipo === 'password' ? '' : String(el.value || '').slice(0, 500) };
    }
    var firma = stato.attivo ? stato.etichetta + '|' + stato.tipo : '';
    if (firma === campoDetto) return;
    campoDetto = firma;
    if (IN_FRAME) { try { window.parent.postMessage({ hometv: 'campoRiquadro', si: !!stato.attivo }, '*'); } catch (e) {} }
    try {
      fetch(SERVIZIO + '/api/telefono/campo', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(stato) })['catch'](function () {});
    } catch (e) {}
  }
  function pianificaCampo() { clearTimeout(campoTimer); campoTimer = setTimeout(diciCampo, 150); }

  /* ================================================================ comandi dal telefono */

  // un tasto del telefono come se fosse del telecomando, per YouTube per la TV (che ascolta i tasti da solo)
  var TASTI_YT = { su: [38, 'ArrowUp'], giu: [40, 'ArrowDown'], sx: [37, 'ArrowLeft'], dx: [39, 'ArrowRight'], ok: [13, 'Enter'],
    indietro: [27, 'Escape'], playpausa: [10252, 'MediaPlayPause'], play: [415, 'MediaPlay'], pausa: [19, 'MediaPause'],
    stop: [413, 'MediaStop'], avanti: [417, 'MediaFastForward'], indietroVeloce: [412, 'MediaRewind'] };
  function tastoYoutube(t) {
    var k = TASTI_YT[t], el = document.activeElement || document.body;
    if (!k) return false;
    ['keydown', 'keyup'].forEach(function (tipo) {
      var e;
      try { e = new KeyboardEvent(tipo, { key: k[1], bubbles: true, cancelable: true }); } catch (x) { e = document.createEvent('Event'); e.initEvent(tipo, true, true); }
      try {
        Object.defineProperty(e, 'keyCode', { get: function () { return k[0]; } });
        Object.defineProperty(e, 'which', { get: function () { return k[0]; } });
      } catch (x) {}
      tastoNostro = true;
      try { el.dispatchEvent(e); } catch (x) {}
      tastoNostro = false;
    });
    return true;
  }

  function ascoltaTelefono() {
    if (IN_FRAME || typeof fetch !== 'function') return;
    var seq = -1, inCorso = false, giroN = 0, partito = 0, richiesta = null;
    var dove = HOST.replace(/^www\./, '');
    function esegui(e) {
      if (e.tipo === 'tasto') {
        if (YT_TV && !pannelloAperto() && tastoYoutube(e.tasto)) return;
        if (pt.on && /^(su|giu|sx|dx)$/.test(e.tasto)) nascondiPuntatore();
        // OK tenuto premuto: nei siti apre il menu rapido (come il Blu), nel lettore TV e nei riquadri vale come OK
        eseguiAzione(e.tasto === 'tieni' ? (fsEl || IN_FRAME ? 'ok' : 'blu') : e.tasto, true);
      } else if (e.tipo === 'puntatore') comandoPuntatore(e);
      else if (e.tipo === 'testo') scriviTesto(String(e.testo || ''), e.invio !== false);
      else if (e.tipo === 'link' && /^https?:\/\//i.test(e.url || '')) location.href = e.url;
      else if (e.tipo === 'video') comandoVideo(e);
      else if (e.tipo === 'home') vaiHome();
      else if (e.tipo === 'schede' || e.tipo === 'nuovaScheda') vaiSchede(e.tipo === 'nuovaScheda');
    }
    function giro() {
      if (document.hidden) { inCorso = false; return; }
      var mio = ++giroN;
      inCorso = true;
      partito = Date.now();
      richiesta = MOTORE.abort ? new AbortController() : null;
      // la fetch vera, presa prima degli agganci del blocco della pubblicita': un indirizzo nuovo a ogni giro non va valutato
      (origFetchListe || fetch)(SERVIZIO + '/api/telefono/eventi?da=' + seq + '&dove=' + encodeURIComponent(dove),
        richiesta ? { cache: 'no-store', signal: richiesta.signal } : { cache: 'no-store' })
        .then(function (r) {
          // il servizio dice di no (403, pagina non riconosciuta): si riprova tra 5 secondi, non subito
          if (!r.ok) throw new Error('servizio ' + r.status);
          return r.json();
        })
        .then(function (j) {
          if (mio !== giroN) return; // richiesta superata da una nuova (vedi riparti)
          if (j && typeof j.seq === 'number') seq = j.seq;
          var ev = (j && j.eventi) || [], veloce = false;
          for (var i = 0; i < ev.length; i++) {
            if (ev[i] && ev[i].tipo === 'puntatore') veloce = true;
            try { esegui(ev[i]); } catch (x) { log('comando dal telefono', x); }
          }
          // col trackpad si richiede subito: il puntatore segue il dito senza attese
          setTimeout(giro, veloce ? 0 : 30);
        })['catch'](function () { if (mio === giroN) setTimeout(giro, 5000); });
    }
    // Il telefono non deve mai smettere di funzionare: una richiesta rimasta appesa (pagina rimessa
    // dalla cache avanti/indietro del browser, rete, estensione del simulatore) si sostituisce con una nuova.
    function riparti() { if (!document.hidden && (!inCorso || Date.now() - partito > 40000)) giro(); }
    // TV in un'altra app: la richiesta si chiude subito (se no per mezzo minuto link, testo e tasti del telefono
    // arriverebbero qui, a una pagina che non si vede, invece che all'app davanti)
    ascoltaSicuro(document, 'visibilitychange', function () {
      if (!document.hidden) { riparti(); return; }
      giroN++;
      inCorso = false;
      if (richiesta) { try { richiesta.abort(); } catch (e) {} richiesta = null; }
    });
    ascoltaSicuro(window, 'pageshow', function (ev) { if (ev.persisted) { inCorso = false; riparti(); } });
    setInterval(riparti, 10000);
    giro();
  }

  /* ================================================================ pannello rapido (tasto Blu) */

  var pannello = null, pannelloSel = 0, voci = [];

  function aggiungiPreferito() {
    chiudiPannello();
    fetch(SERVIZIO + '/api/browser/preferito', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ url: location.href, titolo: document.title || HOST })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.error === 'pieno') toast('Preferiti pieni (' + j.max + '): togline qualcuno dal Browser', 5000);
      else if (j && j.error) toast('Questa pagina non si puo\' aggiungere');
      else toast(j && j.gia ? 'Questa pagina e\' gia\' nei preferiti' : 'Aggiunta ai preferiti del browser');
    })['catch'](function () { toast('Non riesco a raggiungere il TV: riprova tra poco'); });
  }

  function vociPannello() {
    return [
      { testo: 'Aggiungi ai preferiti del browser', valore: '', fai: aggiungiPreferito },
      // <solo-completa>
      // su YouTube per la TV vale la pubblicita' di YouTube (il blocco generico li' non c'e', e il sito per computer ha la
      // sua scelta) e segue il blocco avanzato: spento, qui resta spento (niente ricarica, si dice dove si accende);
      // acceso, riaccesa vale per la visita come dal riquadro della home
      { testo: 'Blocco pubblicita\' su questo sito', valore: (YT_TV ? spotTvVia() : bloccoAttivo) ? 'Attivo' : 'Spento', fai: function () {
        if (YT_TV && !avanzatoTv()) { chiudiPannello(); toast('Si accende dalla home: Impostazioni > Blocco avanzato', 5000); return; }
        try {
          if (YT_TV) {
            if (spotTvVia()) localStorage.setItem('hometv-yt-spot-off', '1');
            else { localStorage.removeItem('hometv-yt-spot-off'); sessionStorage.setItem('hometv-yt-senza-spot', '1'); }
          } else if (bloccoAttivo) localStorage.setItem('hometv-adblock-off', '1');
          else localStorage.removeItem('hometv-adblock-off');
        } catch (e) {}
        location.reload();
      } },
      // </solo-completa>
      /* <solo-pubblica>
      YT_TV ? null : { testo: 'Blocco pubblicita\' su questo sito', valore: bloccoAttivo ? 'Attivo' : 'Spento', fai: function () {
        try {
          if (bloccoAttivo) localStorage.setItem('hometv-adblock-off', '1');
          else localStorage.removeItem('hometv-adblock-off');
        } catch (e) {}
        location.reload();
      } },
      </solo-pubblica> */
      YT_TV ? null : { testo: 'Schermo intero', valore: '', fai: function () { chiudiPannello(); entraSchermoIntero(null, true); } },
      { testo: 'Pagina precedente', valore: '', fai: function () { chiudiPannello(); history.back(); } },
      { testo: 'Pagina successiva', valore: '', fai: function () { chiudiPannello(); history.forward(); } },
      { testo: 'Ricarica la pagina', valore: '', fai: function () { location.reload(); } },
      YT ? { testo: 'YouTube', valore: YT_TV ? 'Per la TV' : 'Per computer', fai: function () { cambiaYoutube(); } } : null,
      { testo: 'Schede del browser', valore: '', fai: function () { vaiSchede(); } },
      { testo: 'Torna alla home', valore: '', fai: function () { vaiHome(); } }
    ].filter(function (v) { return !!v; });
  }
  function cambiaYoutube() {
    try {
      if (YT_TV) localStorage.setItem('hometv-yt-computer', '1');
      else { localStorage.removeItem('hometv-yt-computer'); sessionStorage.removeItem('hometv-yt-no-tv'); }
    } catch (e) {}
    location.href = YT_TV ? 'https://www.youtube.com/' : 'https://www.youtube.com/tv';
  }

  function disegnaPannello() {
    var html = '<h2>' + HOST.replace(/^www\./, '') + '</h2><p>Pubblicita\' bloccate: ' + bloccati +
      (muriTolti ? ', avvisi anti-adblock nascosti: ' + muriTolti : '') +
      (bloccoAttivo ? (LISTE ? ' &middot; liste EasyList attive' : ' &middot; solo liste interne') : '') + '</p>';
    for (var i = 0; i < voci.length; i++) {
      html += '<div' + (i === pannelloSel ? ' class="hometv-sel"' : '') + '>' + voci[i].testo +
        (voci[i].valore ? '<span>' + voci[i].valore + '</span>' : '') + '</div>';
    }
    scriviHtml(pannello, html);
  }

  function apriPannello() {
    if (IN_FRAME || !document.body) return;
    voci = vociPannello();
    pannelloSel = 0;
    if (!pannello) {
      pannello = document.createElement('div');
      pannello.id = 'hometv-pannello';
    }
    var dove = contenitore(); // dentro lo schermo intero del sito, se c'e' (se no resterebbe sotto, invisibile)
    if (!dove) return;
    dove.appendChild(pannello);
    disegnaPannello();
  }

  function chiudiPannello() {
    if (pannello && pannello.parentNode) pannello.parentNode.removeChild(pannello);
  }

  function pannelloAperto() { return !!(pannello && pannello.parentNode); }

  /* ================================================================ tasti */

  // la tabella dei tasti e' quella di tutte le pagine (profilo: Samsung, LG con Indietro 461, l'app per Android)
  var TASTI = ProfiloTV.TASTI;
  var ultimoMovimento = 0;
  var AL_LETTORE = { ok: 1, playpausa: 1, play: 1, pausa: 1, sx: 1, dx: 1, su: 1, giu: 1, indietro: 1, stop: 1, avanti: 1, indietroVeloce: 1 };

  // Stesse azioni per il telecomando e per il telefono. Restituisce true se
  // l'azione e' stata gestita qui (e il tasto non deve arrivare al sito).
  function eseguiAzione(azione, daTelefono) {
    if (azione !== 'indietro' && azione !== 'stop') ultimoTasto = Date.now();
    if (azione === 'ok' || azione === 'play' || azione === 'playpausa') { ultimoOk = chiestoPlayA = Date.now(); premutoAiRiquadri(); }

    // video partito senza audio (il browser non lo lasciava partire con l'audio): il primo
    // tasto del telecomando lo riattiva (dal telefono non si puo', il browser non lo permette)
    if (videoZittito && !daTelefono && azione !== 'indietro' && azione !== 'stop') {
      var vz = videoZittito;
      videoZittito = null;
      try { vz.muted = false; } catch (e) {}
      if (lettoreVideo === vz) avvisoLettore('Audio attivo', 1500);
      if (azione === 'ok') return true;
    }

    if (tendina) return tastoTendina(azione);

    if (pannelloAperto()) {
      if (azione === 'su') pannelloSel = Math.max(0, pannelloSel - 1);
      else if (azione === 'giu') pannelloSel = Math.min(voci.length - 1, pannelloSel + 1);
      else if (azione === 'ok') voci[pannelloSel].fai();
      else if (azione === 'indietro' || azione === 'blu') chiudiPannello();
      if (pannelloAperto()) disegnaPannello();
      return true;
    }

    // dentro un riquadro in cui si e' entrati (un pannello, un menu: non un lettore a schermo intero) i tasti del
    // telefono vanno a lui, come quelli del telecomando, che ci arrivano da soli
    var dentro = document.activeElement;
    if (daTelefono && !fsEl && dentro && dentro.tagName === 'IFRAME' && dentro.__hometvPronto && AL_LETTORE[azione] === 1 && siVede(dentro)) {
      try { dentro.contentWindow.postMessage({ hometv: 'azione', azione: azione, telefono: true, dentro: true }, '*'); return true; } catch (e) {}
    }
    var a = document.activeElement;
    var staScrivendo = campoDiTesto(a);
    // in un campo destra e sinistra muovono il cursore del testo; all'inizio (o alla fine) del testo, o nel campo vuoto, si
    // passa alla cosa accanto, come sui TV (dalla casella di Google ai pulsanti di fianco)
    if (staScrivendo && (azione === 'sx' || azione === 'dx') && alBordoDelTesto(a, azione)) staScrivendo = false;
    if (staScrivendo && (azione === 'sx' || azione === 'dx' || azione === 'ok')) {
      if (!daTelefono) return false; // la tastiera del TV fa il suo lavoro
      if (azione === 'ok') premiInvio(a);
      return true;
    }

    // video a schermo intero: comanda il lettore TV
    if (fsEl && fsEl.tagName === 'VIDEO' && tastoLettore(azione)) return true;
    // lettore in un riquadro a schermo intero: i tasti arrivati qui (dal telefono, o se il riquadro non ha
    // il fuoco) vanno a lui, come quelli del telecomando: pausa, avanti, pulsanti, Indietro che ferma e chiude
    if (fsEl && fsEl.tagName === 'IFRAME' && fsEl.__hometvPronto && AL_LETTORE[azione] === 1) {
      try { fsEl.contentWindow.postMessage({ hometv: 'azione', azione: azione, telefono: !!daTelefono }, '*'); return true; } catch (e) {}
    }

    var gestito = true;
    switch (azione) {
      case 'su': case 'giu': case 'sx': case 'dx':
        if (fsEl) {
          // video (o lettore in un riquadro) a schermo intero: sinistra/destra = -10/+10 s
          if (azione === 'sx') salta(-10);
          else if (azione === 'dx') salta(10);
        } else if (a && a.tagName === 'INPUT' && a.type === 'range' && (azione === 'sx' || azione === 'dx')) {
          spostaCursore(a, azione === 'dx' ? 1 : -1);
        } else if (Date.now() - ultimoMovimento >= 85) {
          ultimoMovimento = Date.now();
          altroDaTe(null); // ti sposti altrove: il video che avevi chiesto non si fa piu' partire da solo
          muovi(azione);
        }
        break;
      case 'ok':
        if (fsEl) { playPausa(); break; } // a schermo intero (lettore in un riquadro): play/pausa
        // la cosa evidenziata; ma se il sito ha spostato lui la selezione su un suo pulsante, quello
        var scelto = corrente && corrente.isConnected ? corrente : null;
        if (a && a !== document.body && a !== document.documentElement && a !== scelto && a.tagName !== 'IFRAME' &&
          !(scelto && a.contains(scelto)) && a.matches && a.matches(SEL_NAV) &&
          areaVisibile(a) < window.innerWidth * window.innerHeight * 0.5) {
          scelto = a;
          setFocus(a, true);
        }
        if (IN_FRAME && !scelto) playPausa(); // dentro il lettore: OK = play/pausa
        else gestito = attiva(scelto, daTelefono);
        break;
      case 'indietro':
        if (staScrivendo) { a.blur(); break; }
        if (esciSchermoIntero()) { fermaAvvio(); break; }
        altroDaTe(null);
        var sc = ambitoAttivo();
        if (sc) { chiudiAmbito(sc); break; } // tendina o finestra del sito aperta: si chiude
        if (IN_FRAME) {
          try { window.parent.postMessage({ hometv: 'esci' }, '*'); window.parent.focus(); } catch (e) {}
          break;
        }
        if (allaPrimaPagina()) {
          if (Date.now() - ultimoIndietroRadice > 2500) {
            ultimoIndietroRadice = Date.now();
            toast('Premi di nuovo Indietro per uscire dal sito', 2500);
            break;
          }
        }
        if (passiNelSito > 0) passiNelSito--;
        if (history.length > 1) history.back();
        else vaiHome();
        break;
      case 'playpausa': case 'play': case 'pausa':
        playPausa(azione === 'playpausa' ? '' : azione);
        break;
      case 'stop':
        fermaAvvio();
        esciSchermoIntero();
        break;
      case 'avanti': salta(30); break;
      case 'indietroVeloce': salta(-30); break;
      case 'rosso':
        if (fsEl) esciSchermoIntero(); else entraSchermoIntero(null, true);
        break;
      case 'verde':
        vaiHome();
        break;
      case 'giallo':
        location.reload();
        break;
      case 'blu':
        if (IN_FRAME) {
          try { window.top.postMessage({ hometv: 'pannello' }, '*'); } catch (e) {}
          break;
        }
        apriPannello();
        break;
      default:
        gestito = false;
    }
    return gestito;
  }

  // OK tenuto premuto = menu rapido (come il Blu), per i telecomandi senza tasti colorati. Come nella home: vale se il
  // telecomando manda anche il rilascio del tasto (lo si impara una volta per sito); finche' non lo si e' visto, OK agisce
  // subito alla pressione. Nel lettore TV, nei riquadri, nelle caselle e nei nostri elenchi OK resta subito
  var okGiu = 0, okTimer = null, keyupOk = false;
  try { keyupOk = localStorage.getItem('hometv-keyup-ok') === '1'; } catch (e) {}
  function okAlRilascio() { return keyupOk && !IN_FRAME && !fsEl && !tendina && !pannelloAperto() && !campoDiTesto(document.activeElement); }
  function okSu() { okGiu = 0; clearTimeout(okTimer); okTimer = null; }

  window.addEventListener('keydown', function (ev) {
    if (tastoNostro) return;
    var azione = TASTI[ev.keyCode];
    if (!azione || paginaDiCasa()) return;
    // YouTube per la TV: i tasti li usa lui (il nostro menu rapido e la home restano: Blu e Verde)
    if (YT_TV && !pannelloAperto() && azione !== 'blu' && azione !== 'verde') return;
    // le ripetizioni del tasto OK tenuto premuto (quando il TV le segna) non contano mai: ne' come altri clic del
    // puntatore, ne' come play/pausa a raffica nel lettore
    if (azione === 'ok' && ev.repeat && !campoDiTesto(document.activeElement)) {
      if (okGiu) okGiu = Date.now();
      ev.preventDefault(); ev.stopImmediatePropagation(); return;
    }
    // puntatore del telefono in vista: OK clicca dove indica, le frecce lo nascondono (si torna alla selezione)
    if (pt.on) {
      if (azione === 'ok' && !tendina && !pannelloAperto() && !campoDiTesto(document.activeElement)) {
        clicPuntatore(); ev.preventDefault(); ev.stopImmediatePropagation(); return;
      }
      if (azione === 'su' || azione === 'giu' || azione === 'sx' || azione === 'dx') nascondiPuntatore();
    }
    if (azione === 'ok' && (okTimer || (okGiu && (ev.repeat || Date.now() - okGiu < 700)))) {
      // il tasto tenuto premuto si ripete: non conta, e il tempo riparte. Una pressione nuova (piu' di 0,7 s dopo, se il
      // rilascio si e' perso) vale come pressione
      if (okGiu) okGiu = Date.now();
      ev.preventDefault(); ev.stopImmediatePropagation(); return;
    }
    if (azione === 'ok' && okAlRilascio()) {
      okGiu = Date.now();
      ev.preventDefault(); ev.stopImmediatePropagation();
      okTimer = setTimeout(function () { okTimer = null; eseguiAzione('blu', false); }, ProfiloTV.OK_TENUTO_MS);
      return;
    }
    if (eseguiAzione(azione, false)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('keyup', function (ev) {
    if (tastoNostro || TASTI[ev.keyCode] !== 'ok' || paginaDiCasa() || YT_TV) return;
    if (!keyupOk) { keyupOk = true; try { localStorage.setItem('hometv-keyup-ok', '1'); } catch (e) {} return; }
    var breve = !!okTimer;
    okSu();
    // lasciato prima del tempo: e' un OK normale (il tasto vero appena premuto vale ancora come tuo gesto). Se per noi
    // non c'era niente da fare (nessuna cosa scelta), l'Invio va al sito, come se non ci fossimo
    if (breve) {
      if (eseguiAzione('ok', false)) { ev.preventDefault(); ev.stopImmediatePropagation(); }
      else tastoFinto(document.activeElement || document.body, 'keydown');
    }
  }, true);
  window.addEventListener('blur', okSu);

  // Tornando al TV dopo tanto tempo (standby, altre app) si riparte dalla home.
  if (!IN_FRAME) {
    var nascostoDa = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { nascostoDa = Date.now(); return; }
      if (nascostoDa && Date.now() - nascostoDa > 10 * 60 * 1000 && CFG.apriHomeAllAccensione !== false && !paginaDiCasa()) {
        location.href = BASE || SERVIZIO + '/casa';
      }
      nascostoDa = 0;
    });
  }

  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) {}
      });
    }
  } catch (e) {}

  /* ================================================================ cronologia del browser */

  // Ogni pagina aperta (dal tuo sito o dal browser) finisce nella cronologia del TV. Con l'anteprima: l'immagine che la
  // pagina dichiara per se' (quella dei link condivisi), per la galleria delle schede
  var ultimaVisita = '';
  function anteprimaPagina() {
    var u = metaDi('meta[property="og:image"]') || metaDi('meta[name="twitter:image"]') || metaDi('meta[property="og:image:url"]');
    if (!u) { var l = document.querySelector('link[rel="image_src"]'); u = l ? String(l.getAttribute('href') || '') : ''; }
    if (!u) return '';
    try { var a = document.createElement('a'); a.href = u; u = a.href; } catch (e) { return ''; }
    return /^https?:\/\/[^\s"'<>()\\]+$/i.test(u) && u.length <= 1000 ? u : '';
  }
  function registraVisita() {
    if (IN_FRAME || typeof fetch !== 'function' || paginaDiCasa()) return;
    var url = location.href;
    if (url === ultimaVisita) return;
    ultimaVisita = url;
    try {
      fetch(SERVIZIO + '/api/browser/visita', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ url: url, titolo: document.title || HOST, img: anteprimaPagina() })
      })['catch'](function () {});
    } catch (e) {}
  }
  function registraPresto() { setTimeout(registraVisita, 1200); }
  if (!IN_FRAME) {
    if (document.readyState === 'complete') registraPresto();
    else window.addEventListener('load', registraPresto);
    // siti che cambiano pagina senza ricaricarsi
    try {
      var origPush = history.pushState;
      history.pushState = function () {
        var r = origPush.apply(this, arguments);
        passiNelSito++;
        registraPresto();
        return r;
      };
      window.addEventListener('popstate', registraPresto);
    } catch (e) {}
  }

  /* ================================================================ caricamento impostazioni e avvio */

  // le impostazioni dicono se il blocco avanzato e' acceso: la copia di questo sito si aggiorna (dalla pagina dopo parte
  // prima degli script del sito). Appena acceso parte subito anche qui, senza riaprire la pagina: riaprirla rifarebbe
  // i moduli appena inviati e disturberebbe l'avviso e il ritorno indietro dalle pagine esterne. Spento: su YouTube per la
  // TV anche il segno del riquadro della home non vale piu' (neanche per le prossime pagine della visita)
  function aggiornaAvanzato() {
    // <solo-completa>
    if (CFG.bloccoAvanzato === false && YT_SENZA_SPOT) {
      YT_SENZA_SPOT = false;
      try { sessionStorage.removeItem('hometv-yt-senza-spot'); } catch (e) {}
    }
    // </solo-completa>
    if (typeof CFG.bloccoAvanzato !== 'boolean' || CFG.bloccoAvanzato === AVANZATO) return;
    AVANZATO = CFG.bloccoAvanzato;
    try { localStorage.setItem('hometv-avanzato', AVANZATO ? '1' : '0'); } catch (e) {}
    if (!AVANZATO) return;
    if (bloccoAttivo) { try { travestimenti(); } catch (e) { log('travestimenti', e); } }
    // <solo-completa>
    if (YT_TV) { try { senzaSpotTv(); } catch (e) { log('spot tv', e); } }
    // </solo-completa>
  }

  function dopoImpostazioni() {
    ricomponi();
    aggiornaAvanzato();
    // aperta da "Continua a guardare": il video parte da solo (e riprende dal punto della scheda).
    // Anche se il sito ha cambiato indirizzo strada facendo (stesso sito, appena scelta)
    var c = CFG.continua;
    if (!IN_FRAME && !continuaAvviato && c && typeof c.url === 'string' &&
        (urlUguale(c.url, location.href) || (c.fresco === true && dominioBase(hostOf(c.url)) === dominioBase(location.hostname.toLowerCase())))) {
      continuaAvviato = true;
      if (!YT_TV) {
        setTimeout(function () { avviaDopoProssimo(true); }, 800);
        if (c.riproduci) avvisaRiproduci();
      }
    }
    applicaStili();
    pianificaPulizia();
    controllaReindirizzamento();
    var fr = document.querySelectorAll('iframe');
    for (var i = 0; i < fr.length; i++) if (fr[i].__hometvPronto) inviaImpostazioni(fr[i]);
  }

  // video mandato dal telefono ("Riproduci sul TV"): lo si dice; se dopo 30 s non sta andando, come sceglierlo a mano
  function avvisaRiproduci() {
    toast('Video dal telefono: lo faccio partire', 3000);
    setTimeout(function () {
      var p = trovaPlayer();
      if (fsEl || (p && p.tagName === 'VIDEO' && !p.paused)) return;
      toast('Non trovo il video da far partire: sceglilo con le frecce e premi OK', 7000);
    }, 32000);
  }

  function caricaImpostazioni() {
    if (IN_FRAME || typeof fetch !== 'function') return;
    // 1) quelle scelte sul TV (servizio locale, che sa anche dov'e' la home),
    // 2) config.json accanto alla home su GitHub
    var githubChiesto = false;
    function daGitHub() {
      if (githubChiesto || !BASE) return;
      githubChiesto = true;
      fetch(BASE + 'config.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (c) { daGithub = c || {}; dopoImpostazioni(); })['catch'](function (e) { if (DEBUG) log('config non raggiungibile', e); });
    }
    fetch(SERVIZIO + '/api/prefs', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (p) {
        if (p && typeof p === 'object') {
          impostaCasa(p.casa);
          delete p.casa;
          dalTV = p;
          dopoImpostazioni();
        }
        daGitHub();
      })['catch'](function () { daGitHub(); });
  }

  // Si guarda la pagina fin da subito, mentre si sta ancora caricando: cosi'
  // anche gli script pubblicitari scritti nell'HTML vengono fermati in tempo.
  var osservatore = null;
  function osserva() {
    if (osservatore) return;
    try {
      osservatore = new MutationObserver(suMutazioni);
      osservatore.observe(document.documentElement || document, { childList: true, subtree: true });
      osservaStili = new MutationObserver(suStili);
    } catch (e) { osservatore = null; }
  }
  osserva();

  // Un riquadro avvisa la pagina che lo contiene che qui c'e' questo codice.
  function annuncia() {
    if (!IN_FRAME) return;
    try { window.parent.postMessage({ hometv: 'pronto' }, '*'); } catch (e) {}
  }
  annuncia();

  function avvia() {
    if (paginaDiCasa()) { // home e browser fanno da se'
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      if (osservatore) { try { osservatore.disconnect(); } catch (e) {} }
      return;
    }
    applicaStili();
    // il controllo completo subito dopo gli ascolti "DOMContentLoaded" del sito: la sua pagina parte prima e la prima
    // impaginazione (elementsFromPoint) si fa una volta sola, sulla pagina gia' pronta
    setTimeout(function () { try { pulisciCompleta(); } catch (e) { log('errore pulizia', e); } }, 0);
    osserva();
    annuncia();
    setInterval(function () {
      if (!cambiamenti) return;
      cambiamenti = false;
      try { pulisciCompleta(); } catch (e) { log('errore pulizia', e); }
    }, 10000);
    caricaImpostazioni();
    if (!listePronte) riprovaListe(1);
    ascoltaTelefono();
    // telefono: quando sul TV si sceglie un campo dove si scrive, lo sa subito
    // gli effetti "mouse sopra" del sito: si leggono appena ci sono gli stili, e poi se ne arrivano altri
    setTimeout(controllaStileSopra, 500);
    ascoltaSicuro(window, 'load', function () { setTimeout(controllaStileSopra, 300); });
    setInterval(controllaStileSopra, 3000);
    ascoltaSicuro(document, 'focusin', pianificaCampo, true);
    ascoltaSicuro(document, 'focusout', pianificaCampo, true);
    if (!IN_FRAME) diciCampo();
    // telecomando: le cose cliccabili "col mouse", l'anello che segue la scelta
    scansioneAvviata = true;
    daScansionare(document.body);
    ascoltaSicuro(window, 'load', function () { setTimeout(function () { daScansionare(document.body); }, 1500); });
    ascoltaSicuro(window, 'scroll', function () { if (corrente) seguiAnello(false); }, { capture: true, passive: true });
    var riquadroNascosto = 0;
    setInterval(function () {
      if (document.hidden || !corrente) return;
      if (!anelloRaf) { try { disegnaAnello(); } catch (e) {} }
      // fuoco in un riquadro: resta li'; se pero' il riquadro e' nascosto da un paio di secondi (un pannello che si e'
      // chiuso senza ridare il fuoco) lo si riprende
      var af = document.activeElement;
      if (af && af.tagName === 'IFRAME') {
        riquadroNascosto = af.isConnected && siVede(af) ? 0 : riquadroNascosto + 1;
        if (riquadroNascosto < 3) return;
        try { af.blur(); } catch (e) {}
        try { window.focus(); } catch (e) {}
      }
      riquadroNascosto = 0;
      if (!corrente.isConnected || !siVede(corrente)) { try { riprendiFuoco(); } catch (e) {} }
    }, 700);
    setInterval(function () { try { controllaVideo(); } catch (e) {} try { pulisciPannelli(); } catch (e) {} }, 1500);
    if (!IN_FRAME) avviaDopoProssimo();
    if (!IN_FRAME) {
      // il promemoria dei tasti: una volta sola per sito, non a ogni pagina
      var giaVisto = false;
      try { giaVisto = sessionStorage.getItem('hometv-aiuto') === '1'; sessionStorage.setItem('hometv-aiuto', '1'); } catch (e) {}
      if (!giaVisto) setTimeout(function () { toast('Frecce per muoverti, OK per scegliere, Blu (o OK tenuto premuto) per il menu rapido.'); }, 800);
    }
    log('attivo', VERSIONE, IN_FRAME ? '(riquadro)' : '(pagina)', HOST, bloccoAttivo ? 'adblock attivo' : 'adblock spento');
  }

  // snippet delle liste per questo sito: dopo i nostri ascolti, ma prima degli script del sito
  if (bloccoAttivo && LISTE) eseguiSnippet(LISTE.sito.snip);

  if (document.readyState === 'loading') {
    applicaStili();
    document.addEventListener('DOMContentLoaded', avvia);
  } else {
    avvia();
  }
})();
