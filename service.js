/*
 * Home TV - servizio sul televisore.
 *
 * TizenBrew esegue questo file con Node.js dentro una sandbox sul TV e gli da'
 * accesso all'oggetto `tizen`, che le pagine non hanno. Qui passano: elenco e
 * avvio delle app, icone, impostazioni, cronologia e preferiti del browser,
 * riapertura della home quando il TV si riaccende.
 *
 * Ascolta solo sul TV stesso: http://127.0.0.1:8090
 *   GET  /api/status                 stato del servizio
 *   GET  /api/apps                   app installate { apps: [{ id, name, icon }] }
 *   POST /api/launch                 { id }  avvia un'app
 *   GET  /api/icon?path=             icona di un'app
 *   GET  /api/settings               { apriAllAccensione }
 *   POST /api/settings               { apriAllAccensione: true|false }
 *   GET  /api/prefs                  impostazioni della home (lette anche dai siti)
 *   POST /api/prefs                  salva le impostazioni della home
 *   GET  /api/browser                { preferiti, cronologia }
 *   POST /api/browser                { preferiti } | { svuotaCronologia } | { rimuoviVisita }
 *   POST /api/browser/visita         { url, titolo, img }  (inviato dai siti visitati; img = l'anteprima della pagina)
 *   POST /api/browser/preferito      { url, titolo }  (dal menu rapido nei siti)
 *   GET  /api/telefono               stato del telecomando sul telefono
 *   POST /api/telefono/codice        nuovo codice per collegare un telefono
 *   POST /api/telefono/scollega      scollega tutti i telefoni
 *   GET  /api/telefono/eventi?da=    comandi arrivati dal telefono (attesa lunga)
 *   POST /api/telefono/campo         sul TV si sta scrivendo in un campo (lo dicono le pagine)
 *   POST /api/telefono/video         il video nel lettore TV: titolo, durata, a che punto e', pausa
 *   POST /api/telefono/sotto         il puntatore e' sopra un campo dove si scrive (per la tastiera del telefono)
 *   POST /api/telefono/store         l'elenco dello Store per il telefono (solo la home e lo Store)
 *   POST /api/visti/cerca            "eri gia' a questo punto?" (le pagine, quando parte un video)
 *   GET  /api/visti                  Continua a guardare (la home)
 *   POST /api/visti/riprendi         { id, daCapo }  la home apre una scheda: la pagina riprende da sola
 *   POST /api/visti/togli|rinomina|visto|svuota   le modifiche dalla home
 *   GET  /api/adblock?host=          liste di filtri pronte per quel sito (lette da main.js)
 *   GET  /api/adblock/ver            versione delle liste
 *   GET  /api/adblock/stato          stato delle liste (per le impostazioni della home)
 *   POST /api/adblock/aggiorna       scarica di nuovo le liste
 *   GET  /api/store/scarica?url=     il catalogo di una fonte privata dello Store, per la home { testo } (solo https,
 *                                    mai indirizzi locali, fino a 300 KB: per i siti che non lo lasciano leggere)
 *
 * Sulla rete di casa, solo per il telefono: http://<indirizzo del TV>:8091
 *   GET  /                           la pagina del telecomando
 *   POST /abbina                     { pin }  -> { t }  (codice mostrato sul TV)
 *   POST /comando                    { t, tipo: tasto|testo|link|sito|home|video|puntatore, ... }
 *   GET  /stato?t=                   cosa c'e' sul TV
 *
 * Il Node del TV puo' essere molto vecchio (v4): solo JavaScript ES5, solo
 * moduli interni di Node. Solo caratteri ASCII in questo file.
 */
(function () {
  'use strict';
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
  /* </profilo:generato> */

  // TizenBrew a volte avvia il servizio due volte: solo la copia che ottiene
  // la porta 8090 lavora (vedi "avvio" in fondo), l'altra resta ferma.

  var http = require('http');
  var fs = require('fs');
  var pathLib = require('path');
  var urlLib = require('url');

  var PORT = 8090;
  var VERSION = '1.3.0';
  var HAS_TIZEN = typeof tizen !== 'undefined' && !!tizen && !!tizen.application;
  // le altre TV con il servizio in Node.js (LG: lg/servizio/servizio-lg.js prepara HOMETV_PIATTAFORMA e poi carica questo
  // stesso file): le loro app, la loro home, la loro cartella dei dati. Sui Samsung non c'e' e tutto resta com'e'
  var ALTRA = typeof HOMETV_PIATTAFORMA === 'object' && HOMETV_PIATTAFORMA ? HOMETV_PIATTAFORMA : null;

  var SHARE = '/home/owner/share';
  var CACHE_DIR = ALTRA && ALTRA.dati ? ALTRA.dati : fs.existsSync(SHARE) ? SHARE : require('os').tmpdir();
  var FILE_APPS = pathLib.join(CACHE_DIR, 'hometv-apps.json');
  var FILE_SETTINGS = pathLib.join(CACHE_DIR, 'hometv-settings.json');
  var FILE_PREFS = pathLib.join(CACHE_DIR, 'hometv-prefs.json');
  var FILE_BROWSER = pathLib.join(CACHE_DIR, 'hometv-browser.json');
  var FILE_TELEFONI = pathLib.join(CACHE_DIR, 'hometv-telefoni.json');
  var FILE_REMOTO = pathLib.join(CACHE_DIR, 'hometv-remoto.json');
  var CACHE_MAX_AGE = 60 * 1000;
  var MAX_CRONOLOGIA = 300;
  var MAX_PREFERITI = 60;

  var ICON_ROOTS = ['/opt/', '/usr/'];
  if (typeof HOMETV_PROVE_ICONE === 'string') ICON_ROOTS.push(HOMETV_PROVE_ICONE); // solo nelle prove sul computer
  if (ALTRA && ALTRA.icone) ICON_ROOTS = ICON_ROOTS.concat(ALTRA.icone); // dove l'altra TV tiene le icone delle app
  var ICON_TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif'
  };

  // Dov'e' la tua home? Lo si legge dall'elenco dei moduli di TizenBrew
  // (il modulo GitHub "tuonome/tv-sito" -> https://tuonome.github.io/tv-sito/),
  // cosi' il nome utente non va scritto a mano in nessun file.
  var PROVE = typeof HOMETV_PROVE !== 'undefined' && HOMETV_PROVE === true; // solo nelle prove sul computer
  var FILE_TIZENBREW = typeof HOMETV_PROVE_TIZENBREW === 'string' ? HOMETV_PROVE_TIZENBREW : '/home/owner/share/tizenbrewConfig.json';
  // Canale di prova (docs/consegna/prepara-prova.sh lo mette a 'prova'): questo servizio e' quello del modulo
  // "tuonome/tv-sito@prova" e la sua home sta in https://tuonome.github.io/tv-sito/prova/. Vuoto = la home di tutti.
  var CANALE = 'prova';
  var casa = { origin: '', base: '', letto: 0, utenti: [] };

  function trovaCasa() {
    if (PROVE && typeof HOMETV_PROVE_CASA === 'string') { // prove sul computer: home su localhost
      casa.base = HOMETV_PROVE_CASA;
      casa.origin = HOMETV_PROVE_CASA.replace(/^(https?:\/\/[^\/]+).*$/, '$1').toLowerCase();
      return casa;
    }
    if (ALTRA) { // l'indirizzo della home lo scrive l'installatore nell'app dell'altra TV
      var b = String(ALTRA.casa() || '');
      casa.base = /^https:\/\/[^\/]+\//i.test(b) ? b : '';
      casa.origin = casa.base ? casa.base.replace(/^(https?:\/\/[^\/]+).*$/, '$1').toLowerCase() : '';
      return casa;
    }
    // il file di TizenBrew si rilegge ogni minuto (ogni 5 secondi se la home non si e' ancora trovata), non a ogni richiesta
    if (Date.now() - casa.letto < (casa.origin ? 60000 : 5000)) return casa;
    casa.letto = Date.now();
    var conf = leggiJson(FILE_TIZENBREW, null);
    var moduli = conf && Array.isArray(conf.modules) ? conf.modules : [];
    var gh = [];
    for (var i = 0; i < moduli.length; i++) {
      var m = /^gh\/([A-Za-z0-9\-]+)\/([A-Za-z0-9._\-]+?)(?:@([^\/]*))?$/.exec(String(moduli[i]).trim());
      if (m) gh.push({ utente: m[1], repo: m[2], canale: m[3] || '' });
    }
    casa.utenti = gh.map(function (g) { return 'https://' + g.utente.toLowerCase() + '.github.io'; });
    // prima il tv-sito del canale di questo servizio ("tv-sito" o "tv-sito@prova": sul TV ci possono essere tutti e due),
    // poi un tv-sito qualsiasi (anche "@v1.2.2"), poi l'unico modulo GitHub
    var scelto = null, j;
    for (j = 0; j < gh.length && !scelto; j++) if (gh[j].repo.toLowerCase() === 'tv-sito' && gh[j].canale === CANALE) scelto = gh[j];
    for (j = 0; j < gh.length && !scelto; j++) if (gh[j].repo.toLowerCase() === 'tv-sito') scelto = gh[j];
    if (!scelto && gh.length === 1) scelto = gh[0];
    if (scelto) {
      casa.origin = 'https://' + scelto.utente.toLowerCase() + '.github.io';
      casa.base = casa.origin + '/' + scelto.repo + '/' + (CANALE ? CANALE + '/' : '');
    }
    return casa;
  }

  // Pagine che possono comandare il servizio: solo la tua home. Gli altri
  // siti possono solo leggere le impostazioni per i siti e registrare visite
  // e preferiti. Se tra i moduli la home non si riconosce: le pagine degli utenti
  // GitHub dei moduli installati; se il file di TizenBrew non si legge proprio
  // (spostato da un aggiornamento), qualsiasi pagina github.io, come prima:
  // meglio una home che funziona.
  function originDellaHome(origin) {
    if (!origin) return false;
    var o = String(origin).toLowerCase();
    var c = trovaCasa();
    if (c.origin) return o === c.origin;
    if (c.utenti.length) return c.utenti.indexOf(o) !== -1;
    return /^https:\/\/[a-z0-9\-]+\.github\.io$/.test(o);
  }
  // solo nelle prove sul computer: anche le altre pagine su localhost (i siti di prova) sono fidate, senza chiave
  function paginaDiProva(origin) {
    return PROVE && !!origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(origin).toLowerCase());
  }
  function originFidata(origin) { return originDellaHome(origin) || paginaDiProva(origin); }
  // Risposte solo a chi chiama 127.0.0.1:8090 (niente trucchi con nomi di dominio che puntano qui).
  var HOST_OK = /^(127\.0\.0\.1|localhost):8090$/i;
  var OPEN_ROUTES = {
    'GET /api/prefs': true,
    'GET /api/telefono/eventi': true, // i siti aperti sul TV ricevono i comandi del telefono
    'POST /api/browser/visita': true,
    'POST /api/browser/preferito': true,
    'POST /api/telefono/campo': true,  // il campo dove si scrive sul TV, per il telefono
    'POST /api/telefono/video': true,  // il video nel lettore TV, per il telefono (barra del tempo)
    'POST /api/telefono/sotto': true,  // il puntatore e' sopra un campo dove si scrive (tastiera del telefono)
    'POST /api/visti/cerca': true,     // "eri gia' a questo punto?" quando parte un video (Continua a guardare)
    'GET /api/adblock': true,        // le liste di filtri, pronte per il sito che le chiede
    'GET /api/adblock/ver': true
  };
  // Quello che i siti hanno bisogno di sapere (niente nome, preferiti, app nascoste).
  var PREFS_PUBBLICHE = ['url', 'bloccoPubblicita', 'bloccoAvanzato', 'schermoInteroAutomatico', 'apriHomeAllAccensione',
    'dominiConsentiti', 'paroleBloccate', 'selettoriExtra'];

  // Le app scaricate dallo store hanno id del tipo "AbCdEfGhIj.Nome".
  var STORE_ID = /^[A-Za-z0-9]{10}\.[A-Za-z0-9_\-]+$/;
  // Poche app di sistema che le persone aprono davvero.
  var BUILT_IN = {
    'org.tizen.netflix-app': true,
    'org.tizen.primevideo': true,
    'org.tizen.browser': true,
    'com.samsung.tv.store': true,
    'com.samsung.tv.gallery': true
  };
  var NEVER = /tizenbrew/i;

  function log(msg) {
    try { console.log('[hometv] ' + msg); } catch (e) { /* niente console */ }
  }
  // l'ultima rete: un errore sfuggito da qualche parte non spegne il servizio, che sul TV resterebbe morto fino al
  // riavvio (niente home, telefono, blocco della pubblicita'). Si annota e si va avanti; le scritture dei file sono
  // "tutto o niente" (scriviJson), quindi non restano dati a meta'. Se pero' gli errori sono tanti (20 in 10 minuti)
  // qualcosa e' rotto a fondo, e girare a vuoto consuma il TV: allora il servizio si ferma davvero
  var erroriSfuggiti = [];
  if (typeof process !== 'undefined' && process.on) {
    process.on('uncaughtException', function (e) {
      log('errore sfuggito: ' + String(e && e.stack || e).slice(0, 1000));
      var ora = Date.now();
      erroriSfuggiti = erroriSfuggiti.filter(function (t) { return ora - t < 600000; });
      erroriSfuggiti.push(ora);
      if (erroriSfuggiti.length > 20) { log('troppi errori: il servizio si ferma'); process.exit(1); }
    });
    process.on('unhandledRejection', function (r) { log('promessa rifiutata senza risposta: ' + String(r && r.stack || r).slice(0, 500)); });
  }

  function leggiJson(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; }
  }
  // Scrittura in background, raggruppata, e "tutto o niente": si scrive un file
  // temporaneo e poi lo si rinomina, cosi' se manca la corrente a meta' resta
  // la versione precedente intera.
  var scritture = {};
  function scriviJson(file, valore, subito) {
    var s = scritture[file] || (scritture[file] = { timer: null, valore: null, occupato: false, ancora: false });
    s.valore = valore;
    if (s.timer && !subito) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(function () { s.timer = null; eseguiScrittura(file, s); }, subito ? 0 : 700);
  }
  function eseguiScrittura(file, s) {
    if (s.occupato) { s.ancora = true; return; }
    var dati;
    try { dati = JSON.stringify(s.valore); } catch (e) { log('dati non salvabili ' + file); return; }
    s.occupato = true;
    var tmp = file + '.tmp';
    function fine(err) {
      if (err) log('non riesco a salvare ' + file + ': ' + (err.code || err.message));
      tvDalTv.scrittura = !err; // per il profilo del TV: il salvataggio funziona?
      s.occupato = false;
      if (s.ancora) { s.ancora = false; eseguiScrittura(file, s); }
    }
    try {
      fs.writeFile(tmp, dati, function (err) {
        if (err) { fine(err); return; }
        fs.rename(tmp, file, fine);
      });
    } catch (e) { fine(e); }
  }
  function testo(s, max) {
    return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  }
  function urlValido(u) {
    return typeof u === 'string' && u.length <= 2000 && /^https?:\/\/[^\s\/]+\.[^\s]+$/i.test(u);
  }
  function senzaAncora(u) { return String(u).split('#')[0]; }

  /* ---------------------------------------------------------- dati salvati */

  var settings = { apriAllAccensione: true };
  var savedSettings = leggiJson(FILE_SETTINGS, {});
  if (savedSettings && typeof savedSettings.apriAllAccensione === 'boolean') settings.apriAllAccensione = savedSettings.apriAllAccensione;

  var prefs = leggiJson(FILE_PREFS, {});
  if (!prefs || typeof prefs !== 'object') prefs = {};

  var browserData = leggiJson(FILE_BROWSER, null);
  if (!browserData || typeof browserData !== 'object') browserData = {};
  if (!Array.isArray(browserData.cronologia)) browserData.cronologia = [];
  if (!Array.isArray(browserData.preferiti)) browserData.preferiti = null; // null = mai toccati
  // preferiti aggiunti dai siti prima che il browser abbia creato la lista iniziale
  if (!Array.isArray(browserData.inAttesa)) browserData.inAttesa = [];
  if (!Array.isArray(browserData.schede)) browserData.schede = [];
  if (typeof browserData.schedaAttiva !== 'string') browserData.schedaAttiva = '';

  function salvaBrowser() { scriviJson(FILE_BROWSER, browserData); }

  /* ---------------------------------------------------------- la chiave della home
   * Oltre all'Origin (che una pagina non puo' falsificare, ma un programma installato sul TV si'), la home presenta una
   * chiave segreta del servizio: ?chiave= in ogni domanda che non e' per i siti (UI.service). Il servizio la crea la prima
   * volta e la tiene nei suoi dati; chi si presenta con l'Origin della home ma senza chiave e' trattato come un sito.
   * La home la riceve senza che tu scriva niente:
   *  - sui Samsung con POST /api/chiave: la prima volta (anche una home nuova, cioe' un altro account), e poi dopo ogni
   *    avvio del servizio (all'accensione vera del TV, o quando TizenBrew lo fa ripartire), finche' la home non si
   *    presenta con la chiave giusta e al massimo per 2 minuti: se la home perde la sua memoria (TizenBrew
   *    reinstallato), la riprende da sola;
   *  - su LG dall'app stessa (lg/avvio.js la chiede al servizio dell'app e la passa nell'indirizzo); POST /api/chiave
   *    resta come riserva, ma solo nei primi 2 minuti dopo l'avvio (il servizio di LG parte quando si apre l'app).
   * Non serve alle domande aperte ai siti (liste di filtri, eventi del telefono...), alle icone e al ritorno alla home. */
  var FILE_CHIAVE = pathLib.join(CACHE_DIR, 'hometv-chiave.json');
  var AVVIO_SERVIZIO = process.hrtime(); // l'orologio monotono: l'ora del TV puo' saltare quando arriva dalla rete
  function msDallAvvio() { var d = process.hrtime(AVVIO_SERVIZIO); return d[0] * 1000 + d[1] / 1e6; }
  var FINESTRA_CHIAVE = typeof HOMETV_PROVE_FINESTRA_CHIAVE === 'number' ? HOMETV_PROVE_FINESTRA_CHIAVE : 120000;
  var chiaveDati = leggiJson(FILE_CHIAVE, null);
  if (!chiaveDati || typeof chiaveDati.chiave !== 'string' || !/^[0-9a-f]{64}$/.test(chiaveDati.chiave)) {
    chiaveDati = { chiave: require('crypto').randomBytes(32).toString('hex'), consegnata: '' };
    // subito, non in background: una seconda copia del servizio avviata subito dopo (TizenBrew lo fa) legge la stessa
    try { fs.writeFileSync(FILE_CHIAVE + '.tmp', JSON.stringify(chiaveDati)); fs.renameSync(FILE_CHIAVE + '.tmp', FILE_CHIAVE); }
    catch (e) { log('chiave non salvata: ' + (e.code || e.message)); }
  }
  var finestraChiave = true; // si chiude alla prima domanda con la chiave giusta: la home c'e' e ce l'ha
  if (ALTRA) ALTRA.chiave = chiaveDati.chiave; // le altre TV la danno alla loro app (LG: servizio-lg.js)
  // nelle prove con le pagine su localhost la chiave si da' sempre (ogni prova parte da una pagina nuova); le regole vere
  // valgono come sul TV (test_sicurezza.sh)
  var CHIAVE_SEMPRE = PROVE && typeof HOMETV_PROVE_CHIAVE_STRETTA === 'undefined';
  function chiaveGiusta(c) {
    var a = String(c || ''), b = chiaveDati.chiave, d = a.length ^ b.length;
    for (var i = 0; i < b.length; i++) d |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
    return d === 0;
  }
  // consegnata = l'origine della home che l'ha avuta: una home nuova (un altro account in TizenBrew) la riceve da sola.
  // Su LG la da' l'app (lg/avvio.js, nell'indirizzo) e la home non la chiede mai qui: resta solo la riserva nei primi
  // minuti dopo l'avvio. Se no, "mai consegnata" la darebbe sempre a chi scrive l'Origin della home (trovato dal revisore)
  // Con piu' home possibili (le riserve di originDellaHome: file di TizenBrew che non si legge, piu' moduli) la regola "una
  // volta a ogni home" la darebbe a ognuna in ogni momento: anche li' solo la finestra
  function chiaveDaDare(origin) {
    if (CHIAVE_SEMPRE) return true;
    var finestra = finestraChiave && msDallAvvio() < FINESTRA_CHIAVE;
    if (ALTRA || !trovaCasa().origin) return finestra;
    return chiaveDati.consegnata !== String(origin).toLowerCase() || finestra;
  }

  // Le schede del browser. Sul TV c'e' una finestra sola: una scheda e' una pagina ricordata, che resta finche' non la
  // chiudi (anche spegnendo il TV). Mentre navighi dal browser la scheda attiva segue le pagine che apri; tornando alla
  // home si smette, cosi' il tuo sito e le pagine aperte da li' non cambiano le schede
  var MAX_SCHEDE = 12, sessioneBrowser = false;
  function schedaAttiva() {
    for (var i = 0; i < browserData.schede.length; i++) if (browserData.schede[i].id === browserData.schedaAttiva) return browserData.schede[i];
    return null;
  }
  function cambiaSchede(b) {
    var az = b && b.azione, l = browserData.schede, s = null, i;
    if (az === 'fuori') { sessioneBrowser = false; return { ok: true }; }
    if (az === 'apri') {
      // una scheda gia' aperta (col suo id) o una nuova (con l'indirizzo)
      for (i = 0; i < l.length; i++) if (l[i].id === b.id) s = l[i];
      if (!s) {
        if (!urlValido(b.url)) return { ok: false, error: 'indirizzo non valido' };
        s = { id: testo(b.id, 40) || 'k' + Date.now().toString(36), url: b.url, titolo: testo(b.titolo, 200), t: Date.now() };
        l.unshift(s);
        // troppe: si chiude quella usata meno di recente
        if (l.length > MAX_SCHEDE) {
          l.sort(function (x, y) { return y.t - x.t; });
          l.length = MAX_SCHEDE;
        }
      }
      s.t = Date.now();
      browserData.schedaAttiva = s.id;
      sessioneBrowser = true;
    } else if (az === 'chiudi') {
      browserData.schede = l.filter(function (x) { return x.id !== b.id; });
      if (browserData.schedaAttiva === b.id) browserData.schedaAttiva = '';
    } else if (az === 'chiudiAltre') {
      browserData.schede = l.filter(function (x) { return x.id === b.id; });
      browserData.schedaAttiva = browserData.schede.length ? b.id : '';
    } else if (az === 'chiudiTutte') {
      browserData.schede = [];
      browserData.schedaAttiva = '';
    } else return { ok: false, error: 'azione sconosciuta' };
    salvaBrowser();
    return { ok: true, schede: browserData.schede, schedaAttiva: browserData.schedaAttiva };
  }
  // una pagina visitata mentre navighi dal browser: e' la pagina della scheda attiva (con la sua anteprima, l'immagine
  // che la pagina dichiara per se': la galleria delle schede la mostra)
  function seguiScheda(url, titolo, img) {
    var s = sessioneBrowser ? schedaAttiva() : null;
    if (!s) return;
    if (s.url !== url) s.img = ''; // pagina nuova: l'anteprima di prima non vale piu'
    s.url = url;
    s.titolo = testo(titolo, 200) || s.titolo;
    if (immagineValida(img)) s.img = img;
    s.t = Date.now();
  }
  function immagineValida(u) { return typeof u === 'string' && u.length <= 1000 && /^https?:\/\/[^\s"'<>()\\]+$/i.test(u); }

  function aggiungiVisita(url, titolo) {
    var chiave = senzaAncora(url);
    var lista = browserData.cronologia;
    for (var i = lista.length - 1; i >= 0; i--) if (senzaAncora(lista[i].url) === chiave) lista.splice(i, 1);
    lista.unshift({ url: url, titolo: testo(titolo, 200), t: Date.now() });
    if (lista.length > MAX_CRONOLOGIA) lista.length = MAX_CRONOLOGIA;
    salvaBrowser();
  }

  function pulisciPreferiti(lista) {
    var out = [], visti = {};
    for (var i = 0; i < lista.length && out.length < MAX_PREFERITI; i++) {
      var p = lista[i];
      if (!p || !urlValido(p.url) || visti[p.url]) continue;
      visti[p.url] = true;
      out.push({ url: p.url, nome: testo(p.nome, 80) });
    }
    return out;
  }

  /* ---------------------------------------------------------- app installate */

  function isUserApp(info) {
    if (!info || !info.id || !info.name) return false;
    if (info.show === false) return false;
    if (NEVER.test(info.id) || NEVER.test(info.name)) return false;
    return !!BUILT_IN[info.id] || STORE_ID.test(info.id);
  }

  // "Spotify - Musica e podcast" e "Spotify: musica" -> "Spotify"
  function shortName(name) {
    return String(name).split(/\s*[:|]\s+|\s+[\-\u2013]\s+/)[0].replace(/^\s+|\s+$/g, '');
  }

  function iconFile(p) {
    return String(p || '').replace(/^file:\/\//i, '');
  }

  var cache = { at: 0, apps: leggiJson(FILE_APPS, null), pending: null };

  function fetchApps() {
    if (ALTRA) return ALTRA.app();
    return new Promise(function (resolve, reject) {
      if (!HAS_TIZEN) { reject(new Error('API tizen non disponibile')); return; }
      var finito = false;
      var attesa = setTimeout(function () { if (!finito) { finito = true; reject(new Error('elenco delle app: il TV non risponde')); } }, 20000);
      tizen.application.getAppsInfo(function (infos) {
        if (finito) return;
        finito = true;
        clearTimeout(attesa);
        try {
          var seen = {};
          var out = [];
          for (var i = 0; i < infos.length; i++) {
            var info = infos[i];
            if (!isUserApp(info) || seen[info.id]) continue;
            seen[info.id] = true;
            out.push({ id: info.id, name: shortName(info.name), icon: iconFile(info.iconPath) });
          }
          out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
          resolve(out);
        } catch (e) { reject(e); }
      }, function (err) {
        if (finito) return;
        finito = true;
        clearTimeout(attesa);
        reject(new Error(err && err.message ? err.message : 'getAppsInfo non riuscito'));
      });
    });
  }

  // getAppsInfo sul TV impiega alcuni secondi: si risponde subito con la copia
  // salvata e si aggiorna in background.
  function refreshApps() {
    if (cache.pending) return cache.pending;
    cache.pending = fetchApps().then(function (apps) {
      cache.at = Date.now();
      cache.apps = apps;
      cache.pending = null;
      cache.errore = '';
      scriviJson(FILE_APPS, apps);
      return apps;
    }, function (err) {
      cache.pending = null;
      cache.errore = err && err.message ? err.message : String(err);
      throw err;
    });
    return cache.pending;
  }

  function listApps() {
    if (cache.apps) {
      if (Date.now() - cache.at > CACHE_MAX_AGE) refreshApps()['catch'](function () {});
      return Promise.resolve(cache.apps);
    }
    return refreshApps();
  }

  function launchApp(id) {
    if (ALTRA) return ALTRA.apri(id);
    return new Promise(function (resolve, reject) {
      if (!HAS_TIZEN) { reject(new Error('API tizen non disponibile')); return; }
      try {
        tizen.application.launch(id, function () { resolve(); }, function (err) {
          reject(new Error(err && err.message ? err.message : 'avvio non riuscito'));
        });
      } catch (e) { reject(e); }
    });
  }

  /* ---------------------------------------------------------- HTTP */

  function headers(req, type, cacheControl, aperta) {
    var h = {
      'Content-Type': type,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': cacheControl || 'no-store',
      'Vary': 'Origin'
    };
    var origin = req.headers.origin;
    if (origin && originFidata(origin)) h['Access-Control-Allow-Origin'] = origin;
    else if (aperta) h['Access-Control-Allow-Origin'] = '*';
    return h;
  }

  function sendJson(req, res, status, body, aperta) {
    res.writeHead(status, headers(req, 'application/json; charset=utf-8', null, aperta));
    res.end(JSON.stringify(body));
  }

  function readBody(req, max) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      var size = 0;
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > (max || 64 * 1024)) { reject(new Error('richiesta troppo grande')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', function () {
        try {
          var v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('x');
          resolve(v);
        } catch (e) { reject(new Error('JSON non valido')); }
      });
      req.on('error', reject);
    });
  }

  // Si servono solo le icone delle app dell'elenco, nessun altro file del TV.
  function iconaDiUnApp(p) {
    var apps = cache.apps || [];
    for (var i = 0; i < apps.length; i++) {
      if (apps[i].icon && pathLib.normalize(apps[i].icon) === p) return true;
    }
    return false;
  }

  function serveIcon(req, res, iconPath) {
    var p = pathLib.normalize(iconFile(iconPath));
    var type = ICON_TYPES[pathLib.extname(p).toLowerCase()];
    var allowed = false;
    for (var i = 0; i < ICON_ROOTS.length; i++) {
      if (p.indexOf(ICON_ROOTS[i]) === 0) allowed = true;
    }
    if (!type || !allowed || p.indexOf('..') !== -1 || !iconaDiUnApp(p)) { sendJson(req, res, 400, { error: 'non e\' un\'icona' }); return; }
    fs.readFile(p, function (err, data) {
      if (err) { sendJson(req, res, 404, { error: 'icona non trovata' }); return; }
      res.writeHead(200, headers(req, type, 'max-age=604800'));
      res.end(data);
    });
  }

  function prefsPubbliche() {
    var out = { casa: trovaCasa().base };
    for (var i = 0; i < PREFS_PUBBLICHE.length; i++) {
      var k = PREFS_PUBBLICHE[i];
      if (Object.prototype.hasOwnProperty.call(prefs, k)) out[k] = prefs[k];
    }
    // i siti aggiunti col "+": dal tuo sito ci si va senza blocchi, e su quelli col blocco completo valgono le protezioni
    // del tuo sito (solo indirizzo e blocco, niente nomi)
    out.siti = (Array.isArray(prefs.siti) ? prefs.siti : []).map(function (s) {
      return { url: s && typeof s.url === 'string' ? s.url : '', blocco: s && s.blocco === 'completo' ? 'completo' : 'normale' };
    });
    // aperto da "Continua a guardare": la pagina fa partire il video e riprende da li'
    var continua = visti.intento();
    if (continua) out.continua = continua;
    // sito appena aperto con un link dal telefono: e' voluto, non una pagina "esterna" da cui tornare indietro
    if (tel.ultimoLink && Date.now() - tel.ultimoLink.at < 60000) out.linkDalTelefono = tel.ultimoLink.host;
    return out;
  }

  function fail(req, res, status, aperta) {
    return function (err) {
      try { sendJson(req, res, status || 502, { error: err && err.message ? err.message : String(err) }, aperta); }
      catch (e) { /* risposta gia' inviata */ }
    };
  }

  function handle(req, res) {
    var url = urlLib.parse(req.url, true);
    var route = req.method + ' ' + url.pathname;
    var origin = req.headers.origin;
    var aperta = !!OPEN_ROUTES[route];
    // le pagine senza indirizzo (le app dello Store nel loro riquadro isolato): solo le liste di filtri, niente altro
    // (ne' le scelte della home, ne' i comandi del telefono, ne' la cronologia o Continua a guardare)
    if (origin === 'null' && route !== 'GET /api/adblock' && route !== 'GET /api/adblock/ver') aperta = false;
    // i comandi del telefono (anche il testo scritto) e i download dello Store: solo a pagine che dicono chi sono.
    // Senza Origin arriva anche una pagina caricata in un riquadro (un'app dello Store potrebbe aprirne uno per prendersi
    // i comandi del telefono): passa solo chi si presenta con X-HomeTV-Ponte, che una pagina non puo' mettere in una
    // richiesta senza Origin (il ponte del simulatore, TV sul Mac)
    if (!origin && !req.headers['x-hometv-ponte'] && (route === 'GET /api/telefono/eventi' || route === 'GET /api/store/scarica')) {
      sendJson(req, res, 403, { error: 'pagina non autorizzata' }, true);
      return;
    }

    if (!HOST_OK.test(String(req.headers.host || ''))) {
      sendJson(req, res, 403, { error: 'indirizzo non autorizzato' });
      return;
    }
    // l'app Video: il gettone nel percorso basta (il <video> non ha Origin, il riquadro dello Store ha "null")
    if (Videoteca.gestisci(videoteca, gettoniVideo, req, res, url, { punto: puntoVideo, ponti: pontiVideo.tratta })) return;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers(req, 'text/plain', null, true));
      res.end();
      return;
    }
    var comeLaHome = !origin || originDellaHome(origin);
    // l'Origin della home ma nessun parametro chiave (la home lo mette sempre, anche vuoto): un'altra pagina dello stesso
    // sito, per esempio un'altra cartella dello stesso account su GitHub, dove c'e' main.js. Vale come un sito
    if (origin && comeLaHome && url.query.chiave === undefined) comeLaHome = false;
    // la chiave alla home (solo a una pagina che si presenta come la home, e solo quando si puo': vedi chiaveDaDare)
    if (route === 'POST /api/chiave') {
      if (!origin || !originFidata(origin)) { sendJson(req, res, 403, { error: 'pagina non autorizzata' }, true); return; }
      if (!chiaveDaDare(origin)) { sendJson(req, res, 403, { error: 'chiave' }); return; }
      if (!ALTRA && chiaveDati.consegnata !== String(origin).toLowerCase()) {
        chiaveDati.consegnata = String(origin).toLowerCase();
        scriviJson(FILE_CHIAVE, chiaveDati, true);
      }
      sendJson(req, res, 200, { chiave: chiaveDati.chiave });
      return;
    }
    // le icone (immagini) e il ritorno alla home (una navigazione) non portano la chiave: non dicono niente di tuo
    var libera = route === 'GET /api/icon' || route === 'GET /casa';
    var conChiave = chiaveGiusta(url.query.chiave);
    if (conChiave) finestraChiave = false;
    var fidata = comeLaHome ? conChiave || libera : paginaDiProva(origin);
    // con l'Origin della home ma senza la chiave giusta niente, neanche le domande aperte ai siti: la home capisce che deve
    // chiedere la chiave, invece di prendere le risposte per i siti (le scelte senza la sua copia) e poi scriverci sopra
    if (origin && comeLaHome && !fidata) { sendJson(req, res, 403, { error: 'chiave' }); return; }
    if (!aperta && !fidata) {
      // leggibile dalla pagina, cosi' la home puo' spiegare cosa non va
      sendJson(req, res, 403, { error: comeLaHome ? 'chiave' : 'pagina non autorizzata' }, true);
      return;
    }

    if (route === 'GET /api/icon') { serveIcon(req, res, url.query.path); return; }

    if (route === 'GET /api/status') {
      // piattaforma e api: il contratto del servizio (docs/contratto-servizio.md), uguale per ogni TV
      sendJson(req, res, 200, { ok: true, version: VERSION, piattaforma: ALTRA ? ALTRA.nome : 'tizen', api: 3, tizen: HAS_TIZEN, apps: cache.apps ? cache.apps.length : 0,
        casa: trovaCasa().base });
      return;
    }
    // profilo del TV (impostazioni "Questo TV" e autodiagnosi della home)
    if (route === 'GET /api/tv') { conChiavette(function () { sendJson(req, res, 200, profiloTv()); }); return; }
    if (route === 'POST /api/tv/pagina') {
      readBody(req).then(function (body) { salvaPagina(body || {}); conChiavette(function () { sendJson(req, res, 200, profiloTv()); }); })['catch'](fail(req, res));
      return;
    }
    // "torna alla home" da qualsiasi pagina, anche senza sapere dov'e'
    if (route === 'GET /casa') {
      var dove = trovaCasa().base;
      if (dove) { res.writeHead(302, { Location: dove, 'Cache-Control': 'no-store' }); res.end(); return; }
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p style="font:32px sans-serif;padding:60px">Non trovo la home tra i moduli di TizenBrew. Apri TizenBrew e scegli Home.</p>');
      return;
    }
    if (route === 'GET /api/apps') {
      listApps().then(function (apps) { sendJson(req, res, 200, { apps: apps }); }, fail(req, res, 503));
      return;
    }
    if (route === 'POST /api/launch') {
      readBody(req).then(function (body) {
        var id = String(body.id || '');
        if (!/^[A-Za-z0-9._\-]{3,100}$/.test(id)) { sendJson(req, res, 400, { error: 'id non valido' }); return; }
        return launchApp(id).then(function () { sendJson(req, res, 200, { ok: true }); });
      })['catch'](fail(req, res));
      return;
    }
    if (route === 'GET /api/settings') { sendJson(req, res, 200, settings); return; }
    if (route === 'POST /api/settings') {
      readBody(req).then(function (body) {
        if (typeof body.apriAllAccensione === 'boolean') settings.apriAllAccensione = body.apriAllAccensione;
        scriviJson(FILE_SETTINGS, settings);
        sendJson(req, res, 200, settings);
      })['catch'](fail(req, res, 400));
      return;
    }
    // la home riceve tutto (anche la copia di riserva delle sue scelte), i siti solo il necessario
    if (route === 'GET /api/prefs') {
      var risposta = prefsPubbliche();
      if (fidata) { for (var kp in prefs) if (Object.prototype.hasOwnProperty.call(prefs, kp)) risposta[kp] = prefs[kp]; }
      sendJson(req, res, 200, risposta, true);
      return;
    }
    if (route === 'POST /api/prefs') {
      readBody(req).then(function (body) {
        prefs = body;
        scriviJson(FILE_PREFS, prefs);
        // liste di filtri cambiate in config.json: si scaricano le nuove
        if (adb.dati && adbFonti(listeScelte()) !== adb.fonti) adbPianifica(5000);
        sendJson(req, res, 200, { ok: true });
      })['catch'](fail(req, res, 400));
      return;
    }
    if (route === 'GET /api/browser') { sendJson(req, res, 200, browserData); return; }
    if (route === 'POST /api/browser') {
      readBody(req).then(function (body) {
        if (Array.isArray(body.preferiti)) {
          browserData.preferiti = pulisciPreferiti(body.preferiti);
          browserData.inAttesa = [];
        }
        if (body.svuotaCronologia === true) browserData.cronologia = [];
        if (typeof body.rimuoviVisita === 'string') {
          var k = senzaAncora(body.rimuoviVisita);
          browserData.cronologia = browserData.cronologia.filter(function (v) { return senzaAncora(v.url) !== k; });
        }
        salvaBrowser();
        sendJson(req, res, 200, browserData);
      })['catch'](fail(req, res, 400));
      return;
    }
    if (route === 'POST /api/browser/scheda') {
      readBody(req).then(function (body) {
        var r = cambiaSchede(body || {});
        sendJson(req, res, r.ok ? 200 : 400, r);
      })['catch'](fail(req, res, 400));
      return;
    }
    if (route === 'POST /api/browser/visita') {
      readBody(req).then(function (body) {
        if (!urlValido(body.url)) { sendJson(req, res, 400, { error: 'indirizzo non valido' }, true); return; }
        seguiScheda(body.url, body.titolo, body.img);
        aggiungiVisita(body.url, body.titolo);
        sendJson(req, res, 200, { ok: true }, true);
      })['catch'](fail(req, res, 400, true));
      return;
    }
    if (route === 'POST /api/browser/preferito') {
      readBody(req).then(function (body) {
        if (!urlValido(body.url)) { sendJson(req, res, 400, { error: 'indirizzo non valido' }, true); return; }
        var nuovo = { url: body.url, nome: testo(body.titolo, 80) };
        var lista = browserData.preferiti === null ? browserData.inAttesa : browserData.preferiti;
        var gia = false;
        for (var i = 0; i < lista.length; i++) if (lista[i].url === body.url) gia = true;
        if (!gia && lista.length >= MAX_PREFERITI) {
          sendJson(req, res, 409, { error: 'pieno', max: MAX_PREFERITI }, true);
          return;
        }
        if (!gia) lista.push(nuovo);
        if (browserData.preferiti === null) browserData.inAttesa = pulisciPreferiti(lista);
        else browserData.preferiti = pulisciPreferiti(lista);
        salvaBrowser();
        sendJson(req, res, 200, { ok: true, gia: gia }, true);
      })['catch'](fail(req, res, 400, true));
      return;
    }
    if (route === 'GET /api/adblock') { rispondiAdblock(req, res, url.query); return; }
    if (route === 'GET /api/adblock/ver') {
      sendJson(req, res, 200, { ver: adb.dati ? adb.dati.ver : '', blocco: prefs.bloccoPubblicita !== false }, true);
      return;
    }
    if (route === 'GET /api/adblock/stato') { sendJson(req, res, 200, statoAdblock()); return; }
    // l'app Video: il gettone per l'app ufficiale che la home apre (lo Store controlla il permesso nel catalogo), e via
    // quando la chiude
    if (route === 'POST /api/video/gettone') { sendJson(req, res, 200, gettoniVideo.nuovo()); return; }
    if (route === 'POST /api/video/gettone/via') {
      readBody(req).then(function (b) {
        gettoniVideo.togli(b.gettone);
        sendJson(req, res, 200, { ok: true });
      })['catch'](fail(req, res, 400));
      return;
    }
    // lo Store: il catalogo di una fonte privata che la pagina non riesce a leggere da sola
    if (route === 'GET /api/store/scarica') {
      storeScaricaFonte(String(url.query.url || ''), function (err, t) {
        if (err) { sendJson(req, res, err.stato === 404 ? 404 : 502, { error: err.stato === 404 ? 'nonTrovato' : 'offline' }); return; }
        sendJson(req, res, 200, { testo: t });
      });
      return;
    }
    if (route === 'POST /api/adblock/aggiorna') {
      adbAggiorna(true);
      sendJson(req, res, 200, statoAdblock());
      return;
    }
    if (route === 'GET /api/telefono/eventi') { attendiEventi(req, res, url.query); return; }
    if (route === 'POST /api/visti/cerca') {
      readBody(req).then(function (body) {
        sendJson(req, res, 200, visti.cerca(body), true);
      })['catch'](fail(req, res, 400, true));
      return;
    }
    if (route === 'GET /api/visti') { sendJson(req, res, 200, visti.perHome()); return; }
    if (route === 'POST /api/visti/riprendi' || route === 'POST /api/visti/togli' || route === 'POST /api/visti/rinomina' ||
      route === 'POST /api/visti/visto' || route === 'POST /api/visti/svuota') {
      readBody(req).then(function (body) {
        sendJson(req, res, 200, visti.cambia(route.slice(16), body || {}));
      })['catch'](fail(req, res, 400));
      return;
    }
    if (route === 'POST /api/telefono/sotto') {
      readBody(req).then(function (body) {
        cambiaSotto(body);
        sendJson(req, res, 200, { ok: true }, true);
      })['catch'](fail(req, res, 400, true));
      return;
    }
    if (route === 'POST /api/telefono/video') {
      readBody(req).then(function (body) {
        cambiaVideo(body);
        sendJson(req, res, 200, { ok: true }, true);
      })['catch'](fail(req, res, 400, true));
      return;
    }
    if (route === 'POST /api/telefono/store') {
      readBody(req, 512 * 1024).then(function (body) {
        tel.store = elencoStore(body);
        tel.storeVer++;
        tel.ultimoAscolto = Date.now(); // la home (o lo Store) c'e': l'ha appena mandato
        cambiaStato();
        sendJson(req, res, 200, { ok: true });
      })['catch'](fail(req, res, 400));
      return;
    }
    if (route === 'POST /api/telefono/campo') {
      readBody(req).then(function (body) {
        cambiaCampo(body, req.headers.origin);
        sendJson(req, res, 200, { ok: true }, true);
      })['catch'](fail(req, res, 400, true));
      return;
    }
    if (route === 'GET /api/telefono') { sendJson(req, res, 200, statoTelefono()); return; }
    if (route === 'POST /api/telefono/codice') {
      var st = statoTelefono();
      st.codice = nuovoCodice();
      st.scade = tel.codiceScade;
      sendJson(req, res, 200, st);
      return;
    }
    if (route === 'POST /api/telefono/permesso') {
      chiediPermessoRemoto();
      sendJson(req, res, 200, statoTelefono());
      return;
    }
    if (route === 'POST /api/telefono/scollega') {
      telefoni = [];
      tel.codice = '';
      salvaTelefoni();
      sendJson(req, res, 200, statoTelefono());
      return;
    }
    sendJson(req, res, 404, { error: 'non trovato' });
  }

  /* ---------------------------------------------------------- tasti veri del TV
   * Il TV ha un ingresso per i telecomandi "virtuali" (lo usano SmartThings e
   * le app di telecomando): porta 8002, la prima volta il TV chiede sullo
   * schermo se consentire l'accesso a "Home TV". Da li' in poi i tasti del
   * telefono sono tasti veri: funzionano ovunque (anche in Netflix), piu'
   * volume, muto e spegnimento. Se non e' disponibile si usa il canale verso
   * le pagine della home (vedi telefono qui sotto).
   */

  var tls = require('tls');
  var net = require('net');
  var PORTE_REMOTO = typeof HOMETV_PROVE_REMOTO === 'object' && HOMETV_PROVE_REMOTO ? HOMETV_PROVE_REMOTO :
    [{ porta: 8002, sicura: true }, { porta: 8001, sicura: false }];
  var NOME_REMOTO = 'Home TV';
  var TASTI_TV = {
    su: 'KEY_UP', giu: 'KEY_DOWN', sx: 'KEY_LEFT', dx: 'KEY_RIGHT', ok: 'KEY_ENTER', indietro: 'KEY_RETURN',
    rosso: 'KEY_RED', verde: 'KEY_GREEN', giallo: 'KEY_YELLOW', blu: 'KEY_CYAN',
    playpausa: 'KEY_PLAY', avanti: 'KEY_FF', indietroVeloce: 'KEY_REWIND',
    volSu: 'KEY_VOLUP', volGiu: 'KEY_VOLDOWN', muto: 'KEY_MUTE', spegni: 'KEY_POWER', sorgente: 'KEY_SOURCE', homeTv: 'KEY_HOME',
    // come il telecomando vero: canali, numeri e i menu del televisore
    canaleSu: 'KEY_CHUP', canaleGiu: 'KEY_CHDOWN', canalePrima: 'KEY_PRECH', listaCanali: 'KEY_CH_LIST', guida: 'KEY_GUIDE',
    menuTv: 'KEY_MENU', info: 'KEY_INFO', esci: 'KEY_EXIT',
    n0: 'KEY_0', n1: 'KEY_1', n2: 'KEY_2', n3: 'KEY_3', n4: 'KEY_4', n5: 'KEY_5', n6: 'KEY_6', n7: 'KEY_7', n8: 'KEY_8', n9: 'KEY_9'
  };

  var remoto = leggiJson(FILE_REMOTO, {});
  if (!remoto || typeof remoto !== 'object') remoto = {};
  // stato: 'mai' (mai provato), 'attesa' (il TV sta chiedendo il permesso), 'ok', 'negato', 'assente'
  var rem = { stato: remoto.stato === 'ok' || remoto.stato === 'negato' ? remoto.stato : 'mai', token: remoto.token || '',
    sock: null, pronto: false, coda: [], tentativo: 0, ultimoErrore: '', indicePorta: 0, buffer: null, frammenti: null };
  // le altre TV (LG) non hanno l'ingresso dei telecomandi di Samsung: niente tasti veri, il telefono comanda le pagine
  if (ALTRA) rem.stato = 'assente';

  function salvaRemoto() { scriviJson(FILE_REMOTO, { stato: rem.stato, token: rem.token }); }

  function frameWs(testo) {
    var dati = new Buffer(testo, 'utf8');
    var lung = dati.length, testa;
    if (lung < 126) { testa = new Buffer(2); testa[1] = 0x80 | lung; }
    else if (lung < 65536) { testa = new Buffer(4); testa[1] = 0x80 | 126; testa.writeUInt16BE(lung, 2); }
    else { testa = new Buffer(10); testa[1] = 0x80 | 127; testa.writeUInt32BE(0, 2); testa.writeUInt32BE(lung, 6); }
    testa[0] = 0x81; // testo, ultimo pezzo
    var maschera = crypto.randomBytes(4);
    for (var i = 0; i < lung; i++) dati[i] = dati[i] ^ maschera[i % 4];
    return Buffer.concat([testa, maschera, dati]);
  }

  function chiudiRemoto() {
    rem.pronto = false;
    if (rem.sock) { try { rem.sock.destroy(); } catch (e) {} }
    rem.sock = null;
  }

  function messaggioRemoto(testo) {
    var j;
    try { j = JSON.parse(testo); } catch (e) { return; }
    var ev = j && j.event;
    if (ev === 'ms.channel.connect') {
      if (j.data && j.data.token) rem.token = String(j.data.token);
      rem.pronto = true;
      rem.stato = 'ok';
      rem.tentativo = 0;
      salvaRemoto();
      // tasti premuti mentre ci si collegava: solo quelli di pochi secondi fa
      var coda = rem.coda, ora = Date.now(); rem.coda = [];
      for (var i = 0; i < coda.length; i++) if (ora - coda[i].at < 4000) inviaRemoto(coda[i].msg);
    } else if (ev === 'ms.channel.unauthorized') {
      rem.stato = 'negato';
      rem.coda = [];
      salvaRemoto();
      chiudiRemoto();
      log('il TV non ha dato il permesso ai tasti dal telefono');
    } else if (ev === 'ms.channel.timeOut') {
      rem.stato = rem.token ? 'ok' : 'mai';
      rem.coda = [];
      chiudiRemoto();
    }
  }

  // lettura dei pezzi (frame) che arrivano dal TV
  function datiRemoto(pezzo) {
    rem.buffer = rem.buffer ? Buffer.concat([rem.buffer, pezzo]) : pezzo;
    while (rem.buffer && rem.buffer.length >= 2) {
      var b = rem.buffer, op = b[0] & 0x0f, fin = (b[0] & 0x80) !== 0, mascherato = (b[1] & 0x80) !== 0;
      var lung = b[1] & 0x7f, pos = 2;
      if (lung === 126) { if (b.length < 4) return; lung = b.readUInt16BE(2); pos = 4; }
      else if (lung === 127) { if (b.length < 10) return; lung = b.readUInt32BE(6); pos = 10; }
      var m = null;
      if (mascherato) { if (b.length < pos + 4) return; m = b.slice(pos, pos + 4); pos += 4; }
      if (b.length < pos + lung) return;
      var dati = b.slice(pos, pos + lung);
      if (m) for (var i = 0; i < dati.length; i++) dati[i] = dati[i] ^ m[i % 4];
      rem.buffer = b.length > pos + lung ? b.slice(pos + lung) : null;
      if (op === 0x8) { chiudiRemoto(); return; }
      if (op === 0x9) { // ping -> pong
        try {
          var pong = frameWs(dati.toString('utf8'));
          pong[0] = 0x8a;
          rem.sock.write(pong);
        } catch (e) {}
        continue;
      }
      if (op === 0x1 || op === 0x0) {
        rem.frammenti = op === 0x1 ? [dati] : (rem.frammenti || []).concat([dati]);
        if (fin) { var tutto = Buffer.concat(rem.frammenti).toString('utf8'); rem.frammenti = null; messaggioRemoto(tutto); }
      }
    }
  }

  function apriRemoto() {
    if (rem.sock || !HAS_TIZEN && !PROVE) return;
    var p = PORTE_REMOTO[rem.indicePorta % PORTE_REMOTO.length];
    var nome = new Buffer(NOME_REMOTO, 'utf8').toString('base64');
    var percorso = '/api/v2/channels/samsung.remote.control?name=' + encodeURIComponent(nome) +
      (rem.token ? '&token=' + encodeURIComponent(rem.token) : '');
    var chiave = crypto.randomBytes(16).toString('base64');
    var intestazioneLetta = false, testa = '';
    var sock;
    if (rem.stato !== 'ok') rem.stato = 'attesa';
    function avvia() {
      sock.write('GET ' + percorso + ' HTTP/1.1\r\nHost: 127.0.0.1:' + p.porta + '\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Key: ' + chiave + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    }
    try {
      sock = p.sicura ? tls.connect({ host: '127.0.0.1', port: p.porta, rejectUnauthorized: false }, avvia)
        : net.connect({ host: '127.0.0.1', port: p.porta }, avvia);
    } catch (e) { rem.ultimoErrore = e.message; return; }
    rem.sock = sock;
    rem.buffer = null;
    sock.setTimeout(45000); // il TV aspetta fino a 30 s la risposta sullo schermo
    sock.on('timeout', function () { if (!rem.pronto) { rem.ultimoErrore = 'nessuna risposta'; chiudiRemoto(); } });
    sock.on('data', function (d) {
      if (rem.sock !== sock) return;
      if (!intestazioneLetta) {
        testa += d.toString('binary');
        var fine = testa.indexOf('\r\n\r\n');
        if (fine === -1) return;
        if (!/^HTTP\/1\.1 101/.test(testa)) { rem.ultimoErrore = testa.split('\r\n')[0]; chiudiRemoto(); return; }
        intestazioneLetta = true;
        sock.setTimeout(0);
        var resto = new Buffer(testa.slice(fine + 4), 'binary');
        if (resto.length) datiRemoto(resto);
        return;
      }
      datiRemoto(d);
    });
    sock.on('error', function (e) {
      if (rem.sock !== sock) return;
      rem.ultimoErrore = e.code || e.message;
      // porta chiusa: si prova l'altra la prossima volta; se nessuna risponde, il TV non lo offre
      if (!rem.pronto) {
        rem.indicePorta++;
        if (rem.indicePorta >= PORTE_REMOTO.length * 2 && rem.stato !== 'ok') rem.stato = 'assente';
      }
      chiudiRemoto();
    });
    sock.on('close', function () {
      if (rem.sock !== sock) return;
      rem.sock = null;
      rem.pronto = false;
      if (rem.stato === 'attesa') rem.stato = rem.token ? 'ok' : 'mai';
    });
  }

  function inviaRemoto(msg) {
    if (!rem.pronto || !rem.sock) {
      if (rem.stato === 'negato' || rem.stato === 'assente') return false;
      rem.coda.push({ msg: msg, at: Date.now() });
      if (rem.coda.length > 4) rem.coda.shift();
      apriRemoto();
      return true;
    }
    try { rem.sock.write(frameWs(JSON.stringify(msg))); return true; } catch (e) { chiudiRemoto(); return false; }
  }

  // tasti veri disponibili? (permesso dato e ingresso del TV raggiungibile)
  function remotoUsabile() { return rem.stato === 'ok'; }

  function tastoVero(nome) {
    var codice = TASTI_TV[nome];
    if (!codice) return false;
    return inviaRemoto({ method: 'ms.remote.control',
      params: { Cmd: 'Click', DataOfCmd: codice, Option: 'false', TypeOfRemote: 'SendRemoteKey' } });
  }

  // testo nella tastiera di Samsung (quando e' aperta sullo schermo)
  function testoVero(t) {
    inviaRemoto({ method: 'ms.remote.control', params: { Cmd: new Buffer(t, 'utf8').toString('base64'),
      DataOfCmd: 'base64', TypeOfRemote: 'SendInputString' } });
    return inviaRemoto({ method: 'ms.remote.control', params: { TypeOfRemote: 'SendInputEnd' } });
  }

  // chiedere il permesso sul TV (prima volta, o di nuovo dopo un "no")
  function chiediPermessoRemoto() {
    if (ALTRA) { rem.stato = 'assente'; return; }
    if (rem.stato === 'negato' || rem.stato === 'assente') rem.stato = 'mai';
    rem.indicePorta = 0;
    chiudiRemoto();
    apriRemoto();
  }

  /* ---------------------------------------------------------- telecomando sul telefono
   * Il telefono apre una pagina servita da qui (porta 8091, solo rete di casa)
   * e manda comandi. Le pagine del TV (home, browser, siti) li ricevono
   * chiedendo /api/telefono/eventi: la richiesta resta aperta finche' arriva
   * un comando (o per 25 secondi), cosi' la risposta e' immediata.
   * Per collegare un telefono serve il codice di 6 cifre mostrato sul TV.
   */

  var PORTA_TELEFONO = 8091;
  var crypto = require('crypto');
  var TASTI_TELEFONO = { su: 1, giu: 1, sx: 1, dx: 1, ok: 1, tieni: 1, indietro: 1, rosso: 1, verde: 1, giallo: 1, blu: 1,
    playpausa: 1, avanti: 1, indietroVeloce: 1, volSu: 1, volGiu: 1, muto: 1, spegni: 1, homeTv: 1 };
  // questi esistono solo come tasti veri del TV (homeTv: la home di Samsung, la barra con le app)
  var SOLO_TV = { volSu: 1, volGiu: 1, muto: 1, spegni: 1, homeTv: 1 };
  // canali, numeri e menu del televisore: anche loro solo come tasti veri
  ['sorgente', 'canaleSu', 'canaleGiu', 'canalePrima', 'listaCanali', 'guida', 'menuTv', 'info', 'esci',
    'n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'].forEach(function (k) { TASTI_TELEFONO[k] = 1; SOLO_TV[k] = 1; });
  var MAX_TELEFONI = 6;

  var tel = {
    attivo: false, errore: '',
    codice: '', codiceScade: 0, codiceErrori: 0,
    eventi: [], seq: 0,
    attese: [], ultimoAscolto: 0, dove: '',
    campo: null, ver: 1, attesaStato: [], video: null, ultimoLink: null, sotto: null,
    // lo Store dal telefono: l'ultimo elenco mandato dal TV, e le azioni che aspettano la home
    store: null, storeVer: 0, storeCoda: [], inCoda: false
  };
  var ID_STORE = /^[a-z0-9][a-z0-9-]{1,39}$/, RIQUADRO_STORE = /^(ws:[a-z0-9][a-z0-9-]{1,39}|mia:f[a-z0-9]{1,16}:[a-z0-9][a-z0-9-]{1,39})$/;
  var telefoni = leggiJson(FILE_TELEFONI, []);
  if (!Array.isArray(telefoni)) telefoni = [];

  function salvaTelefoni() { scriviJson(FILE_TELEFONI, telefoni); }

  function casuale(byte) { return crypto.randomBytes(byte).toString('hex'); }

  function nuovoCodice() {
    var n = parseInt(casuale(4), 16) % 1000000;
    tel.codice = ('000000' + n).slice(-6);
    tel.codiceScade = Date.now() + 10 * 60 * 1000;
    tel.codiceErrori = 0;
    return tel.codice;
  }

  function telefonoValido(t) {
    if (typeof t !== 'string' || t.length < 20) return null;
    for (var i = 0; i < telefoni.length; i++) if (telefoni[i].t === t) return telefoni[i];
    return null;
  }

  // indirizzi del TV sulla rete di casa (quelli da scrivere sul telefono)
  function indirizziRete() {
    var out = [];
    try {
      var ifs = require('os').networkInterfaces();
      for (var nome in ifs) {
        if (!Object.prototype.hasOwnProperty.call(ifs, nome)) continue;
        for (var i = 0; i < ifs[nome].length; i++) {
          var a = ifs[nome][i];
          if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
        }
      }
    } catch (e) {}
    // prima gli indirizzi tipici di casa
    out.sort(function (x, y) {
      var px = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(x) ? 0 : 1;
      var py = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(y) ? 0 : 1;
      return px - py;
    });
    // prove sul computer (TV sul Mac): prima l'indirizzo Wi-Fi del computer, quello che il telefono raggiunge
    if (PROVE && typeof HOMETV_PROVE_INDIRIZZO === 'string' && HOMETV_PROVE_INDIRIZZO) {
      var k = out.indexOf(HOMETV_PROVE_INDIRIZZO);
      if (k > 0) { out.splice(k, 1); out.unshift(HOMETV_PROVE_INDIRIZZO); }
    }
    return out;
  }

  function inAscolto() { return tel.attese.length > 0 || Date.now() - tel.ultimoAscolto < 3500; }

  // Sul TV si scrive in un campo: il telefono lo sa subito e propone di scrivere da li'.
  var TIPI_CAMPO = { text: 1, search: 1, email: 1, url: 1, tel: 1, number: 1, password: 1, testo: 1 };
  function cambiaCampo(body, origine) {
    var nuovo = null;
    if (body && body.attivo === true) {
      nuovo = { etichetta: testo(body.etichetta, 60), tipo: TIPI_CAMPO[body.tipo] === 1 ? body.tipo : 'text', at: Date.now() };
      nuovo.valore = nuovo.tipo === 'password' ? '' : testo(body.valore, 500);
      // chi puo' ricevere quello che scrivi in una password: la pagina del campo e quella che ascolta il telefono
      // (se ad ascoltare e' una sola: con piu' pagine in ascolto, solo quella del campo)
      nuovo.origini = [String(origine || '')];
      if (tel.attese.length === 1 && tel.attese[0].origine !== nuovo.origini[0]) nuovo.origini.push(tel.attese[0].origine);
    }
    var prima = JSON.stringify(tel.campo && { e: tel.campo.etichetta, t: tel.campo.tipo, v: tel.campo.valore });
    var dopo = JSON.stringify(nuovo && { e: nuovo.etichetta, t: nuovo.tipo, v: nuovo.valore });
    tel.campo = nuovo;
    if (prima !== dopo) cambiaStato();
  }
  function campoAttivo() {
    if (!tel.campo || Date.now() - tel.campo.at > 10 * 60 * 1000) return null;
    return { etichetta: tel.campo.etichetta, tipo: tel.campo.tipo, valore: tel.campo.valore };
  }
  // l'elenco dello Store per il telefono, come lo manda la home: solo campi conosciuti, testi corti, immagini http(s)
  var STATI_STORE = { installa: 1, installata: 1, nuova: 1, nonAdatta: 1, ritirata: 1, orfana: 1, ok: 1 };
  function elencoStore(b) {
    function una(x, mia) {
      if (!x || typeof x !== 'object') return null;
      var chiave = mia ? String(x.riquadro || '') : 'ws:' + String(x.id || '');
      if (!RIQUADRO_STORE.test(chiave)) return null;
      var img = function (u) { return !mia && /^https?:\/\/[^\s"'<>()]{1,500}$/i.test(String(u || '')) ? String(u) : ''; };
      var colore = Array.isArray(x.colore) && x.colore.length === 2 && /^\d{1,3},\d{1,3},\d{1,3}$/.test(x.colore[0]) &&
        /^\d{1,3},\d{1,3},\d{1,3}$/.test(x.colore[1]) ? [x.colore[0], x.colore[1]] : null;
      return { chiave: chiave, nome: testo(x.nome, 40), descrizione: testo(x.descrizione, mia ? 200 : 400), novita: testo(x.novita, 200),
        autore: testo(x.autore, 40), categoria: testo(x.categoria, 30), versione: testo(x.versione, 20), icona: img(x.icona),
        copertina: img(x.copertina), colore: colore, sito: mia ? testo(x.sito, 80) : '', evidenza: x.evidenza === true,
        stato: STATI_STORE[x.stato] === 1 ? x.stato : 'ok' };
    }
    var app = (Array.isArray(b.app) ? b.app.slice(0, 250) : []).map(function (x) { return una(x, false); }).filter(Boolean);
    var mie = (Array.isArray(b.mie) ? b.mie.slice(0, 300) : []).map(function (x) { return una(x, true); }).filter(Boolean);
    var e = b.esito && typeof b.esito === 'object' ? { azione: testo(b.esito.azione, 20), ok: b.esito.ok === true, testo: testo(b.esito.testo, 160), at: Date.now() } : null;
    return { at: Date.now(), catalogo: testo(b.catalogo, 120), app: app, mie: mie, esito: e || (tel.store && tel.store.esito) || null };
  }
  // la home o lo Store sono aperti sul TV (le azioni dello Store le fanno solo loro)
  function storeInAscolto() { return inAscolto() && (tel.dove === 'Home' || tel.dove === 'Store'); }
  function statoPerTelefono() {
    return { ok: true, ascolta: inAscolto(), dove: tel.dove, tasti: rem.stato, campo: campoAttivo(), video: videoAttuale(), sotto: sottoAttuale(),
      ver: tel.ver, storeVer: tel.storeVer };
  }

  // Il video nel lettore TV, per il telefono (titolo, barra del tempo, pausa). Le pagine lo dicono
  // quando cambia qualcosa e ogni 15 secondi; il telefono fa scorrere il tempo da solo e si sveglia
  // solo quando cambia qualcosa che si vede (pausa, titolo, un salto), non a ogni secondo.
  var VIDEO_SCADE = 45000, videoScade = null;
  function posizioneVideo(v) { return v.posizione + (v.inPausa ? 0 : (Date.now() - v.at) / 1000); }
  function cambiaVideo(body) {
    if (!body || typeof body !== 'object') return;
    if (body.pagina && (body.attivo === true || body.memo === true)) { try { visti.registra(body); } catch (e) { log('continua a guardare: ' + e.message); } }
    if (body.memo === true) return; // solo il punto in cui si lascia il video: il telefono non c'entra
    var chi = testo(body.chi, 20);
    var prima = tel.video && Date.now() - tel.video.at <= VIDEO_SCADE ? tel.video : null;
    if (body.attivo !== true) {
      // una pagina (o un riquadro) che chiude il suo lettore non spegne quello di un'altra
      if (!prima || (chi && prima.chi && chi !== prima.chi)) return;
      tel.video = null;
      cambiaStato();
      return;
    }
    var d = Number(body.durata), p = Number(body.posizione);
    var nuovo = { chi: chi, titolo: testo(body.titolo, 120), durata: isFinite(d) && d > 0 && d < 1e7 ? d : 0,
      posizione: isFinite(p) && p >= 0 && p < 1e7 ? p : 0, inPausa: body.inPausa === true, at: Date.now() };
    var cambiato = !prima || prima.titolo !== nuovo.titolo || prima.inPausa !== nuovo.inPausa ||
      Math.abs(prima.durata - nuovo.durata) > 1 || Math.abs(posizioneVideo(prima) - nuovo.posizione) > 2.5;
    tel.video = nuovo;
    // la pagina non dice piu' niente (chiusa, TV in un'altra app): sul telefono la barra sparisce
    clearTimeout(videoScade);
    videoScade = setTimeout(function () { if (tel.video === nuovo) { tel.video = null; cambiaStato(); } }, VIDEO_SCADE + 1000);
    if (cambiato) cambiaStato();
  }
  function videoAttuale() {
    var v = tel.video;
    if (!v || Date.now() - v.at > VIDEO_SCADE) return null;
    var pos = posizioneVideo(v);
    if (v.durata) pos = Math.min(pos, v.durata);
    // eta: da quanto il TV l'ha detto (il telefono non disfa quello che hai appena fatto con una notizia vecchia)
    return { titolo: v.titolo, durata: Math.round(v.durata * 10) / 10, posizione: Math.round(pos * 10) / 10, inPausa: v.inPausa,
      eta: Date.now() - v.at };
  }
  // Trackpad: il puntatore sul TV e' sopra un campo dove si scrive. Il telefono lo sa prima del
  // tocco, cosi' al tocco apre subito la sua tastiera (un telefono la apre solo dentro un tocco).
  function cambiaSotto(body) {
    var nuovo = body && body.campo === true ?
      { etichetta: testo(body.etichetta, 60), tipo: TIPI_CAMPO[body.tipo] === 1 ? body.tipo : 'text', at: Date.now() } : null;
    var prima = JSON.stringify(tel.sotto && [tel.sotto.etichetta, tel.sotto.tipo]);
    var dopo = JSON.stringify(nuovo && [nuovo.etichetta, nuovo.tipo]);
    tel.sotto = nuovo;
    if (prima !== dopo) cambiaStato();
  }
  function sottoAttuale() {
    var s = tel.sotto;
    return s && Date.now() - s.at < 10 * 60 * 1000 ? { etichetta: s.etichetta, tipo: s.tipo } : null;
  }
  /* ---------------------------------------------------------- continua a guardare
   * La logica e' in tv-sito/visti.js, la stessa su ogni TV (qui la sua copia): il servizio le da' i dati salvati e
   * le scelte della home, e la chiama dalle domande delle pagine. */
  /* <visti:generato> copia di tv-sito/visti.js (prove/incorpora_visti.py): non modificare qui */
  /*
   * Home TV - CONTINUA A GUARDARE: cosa guardi nei siti, per riprendere da dove eri. La stessa logica su ogni TV:
   * service.js (Samsung e LG) ne ha una copia, messa da prove/incorpora_visti.py tra i segnaposto <visti:generato>;
   * l'app Android fa girare questo file cosi' com'e' in un motore web nascosto (android/src/it/hometv/tv/Visti.java).
   * Si modifica SOLO questo file, poi si lancia lo script; le prove controllano che la copia sia uguale.
   * Solo ES5 e solo ASCII (\uXXXX per le lettere accentate).
   *
   *   var v = VistiTV.crea({ dati: [...], salva: function (elenco, subito) {}, prefs: function () { return prefs; },
   *                          casuale: function (byte) { return 'esadecimale'; } });
   *   v.registra(corpo)        un video che va avanti o si lascia (POST /api/telefono/video, con la pagina)
   *   v.cerca(corpo)           POST /api/visti/cerca: { ok, continua | stesso | proposta }
   *   v.perHome()              GET /api/visti: { visti, totale }
   *   v.cambia(azione, corpo)  POST /api/visti/riprendi | togli | rinomina | visto | svuota
   *   v.riproduci(url)         "Riproduci sul TV" dal telefono: la pagina fa partire il suo video
   *   v.intento()              per le scelte delle pagine (prefs.continua), oppure null
   */
  var VistiTV = (function () {
    'use strict';

    function crea(o) {
      o = o || {};
      function salva(subito) { if (o.salva) o.salva(visti, subito); }
      function casuale(byte) {
        if (o.casuale) return o.casuale(byte);
        for (var s = '', i = 0; i < byte * 2; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s;
      }
      /* ---------------------------------------------------------- continua a guardare
       * Il TV ricorda cosa guardi nei siti (film, puntate delle serie) per riprendere da dove eri: una scheda
       * per film o per serie (l'ultima puntata) su ogni sito, la home ne mostra al massimo 10. Anche cambiando
       * sito solo con "Riprendi anche su un altro sito" (Impostazioni della home, spenta all'inizio): allora la
       * scheda passa al sito nuovo e un altro sito propone il punto. Lo stesso sito lo decide solo stessoSito.
       * La stessa opera si riconosce dal nome (ripulito da nome del sito, "HD", "4K", accenti,
       * articoli), da stagione e puntata e dalla durata. Le regole, per non sbagliare mai:
       *  - si riprende da soli solo lo stesso video (stessa pagina e stessa durata) o una scheda scelta
       *    nella home; su un'altra pagina (o su un altro sito, con l'opzione) si propone e basta
       *    ("Eri a 22:15 su ...: OK per riprendere");
       *  - nel dubbio non si unisce e non si propone niente: meglio una scheda in piu' che una sbagliata;
       *  - un video si ricorda dopo un minuto che lo guardi, e solo se dura almeno 5 minuti (non trailer).
       */
      function testo(s, max) {
        return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
      }
      function urlValido(u) {
        return typeof u === 'string' && u.length <= 2000 && /^https?:\/\/[^\s\/]+\.[^\s]+$/i.test(u);
      }
      function hostLink(u) {
        var m = /^https?:\/\/(?:[^\/?#@]*@)?([^\/?#:]+)/i.exec(String(u));
        return m ? m[1].toLowerCase().replace(/\.$/, '') : '';
      }
      var MAX_SCHEDE = 10, MAX_VISTI = 30, MIN_DURATA = 300, MIN_VISTO = 60;
      // lo stesso sito? Per ora lo stesso nome, con o senza "www." davanti. E' l'unico posto che lo decide (proposta
      // "Eri a ...", schede, pagina riaperta dalla home)
      function stessoSito(a, b) {
        a = String(a || '').toLowerCase().replace(/^www\./, '');
        b = String(b || '').toLowerCase().replace(/^www\./, '');
        return !!a && a === b;
      }
      // "Riprendi anche su un altro sito" (spenta all'inizio): se no proposta e schede restano del loro sito
      function riprendiAltrove() { var p = o.prefs ? o.prefs() : null; return !!p && p.riprendiAltroSito === true; }
      function sitoBuono(e, p) { return riprendiAltrove() || stessoSito(hostLink(e.url), hostLink(p.url)); }
      var visti = Array.isArray(o.dati) ? o.dati : [];
      var intentoContinua = null;

      var ACCENTI = [[/[\u00e0-\u00e5]/g, 'a'], [/[\u00e8-\u00eb]/g, 'e'], [/[\u00ec-\u00ef]/g, 'i'], [/[\u00f2-\u00f6\u00f8]/g, 'o'],
        [/[\u00f9-\u00fc]/g, 'u'], [/\u00f1/g, 'n'], [/\u00e7/g, 'c'], [/[\u00fd\u00ff]/g, 'y'], [/\u00df/g, 'ss']];
      // parole che non dicono quale opera e' (articoli, preposizioni)
      var VUOTE = { il: 1, lo: 1, la: 1, i: 1, gli: 1, le: 1, l: 1, un: 1, uno: 1, una: 1, di: 1, da: 1, del: 1, della: 1, dello: 1, dei: 1,
        degli: 1, delle: 1, al: 1, allo: 1, alla: 1, ai: 1, agli: 1, alle: 1, su: 1, sul: 1, in: 1, nel: 1, nella: 1, con: 1, per: 1, e: 1, ed: 1,
        the: 1, a: 1, an: 1, of: 1, and: 1, on: 1, at: 1, to: 1 };
      // parole messe dai siti attorno al titolo
      var RUMORE = { streaming: 1, guarda: 1, guardare: 1, watch: 1, online: 1, gratis: 1, gratuito: 1, free: 1, hd: 1, fullhd: 1, uhd: 1,
        '4k': 1, '2160p': 1, '1080p': 1, '720p': 1, '480p': 1, ita: 1, italiano: 1, eng: 1, english: 1, sub: 1, subita: 1, subbed: 1,
        sottotitoli: 1, sottotitolato: 1, doppiato: 1, dubbed: 1, completo: 1, completa: 1, full: 1, download: 1 };
      // in testa o in coda al nome non dicono quale opera e' (Film Dune, La casa di carta serie tv)
      var GENERICHE = { film: 1, movie: 1, serie: 1, series: 1, tv: 1, show: 1, anime: 1, documentario: 1 };
      // numeri romani e scritti in lettere diventano cifre (Rocky II = Rocky 2, Dune parte due = Dune parte 2)
      var ROMANI = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12', xiii: '13',
        due: '2', tre: '3', quattro: '4', cinque: '5', sei: '6', sette: '7', otto: '8', nove: '9', dieci: '10',
        two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
      function parole(s) {
        s = String(s || '').toLowerCase();
        for (var i = 0; i < ACCENTI.length; i++) s = s.replace(ACCENTI[i][0], ACCENTI[i][1]);
        return s.replace(/&/g, ' e ').split(/[^a-z0-9]+/).filter(function (x) { return !!x; });
      }
      // il nome del sito: nel titolo non conta (si toglie come frase intera, non parola per parola)
      function frasiSito(p) {
        var f = [], h = hostLink(p.url).replace(/^www\./, '').split('.');
        if (h.length > 1) h.pop();
        var nome = parole(h.join(' '));
        if (nome.length) f.push(nome);
        var primo = parole(h[0] || '');
        if (primo.length && primo.join(' ') !== nome.join(' ')) f.push(primo);
        var og = parole(p.ogSito);
        if (og.length && og.length <= 4) f.push(og);
        return f;
      }
      function togliFrasi(lista, frasi) {
        for (var k = 0; k < frasi.length; k++) {
          var fr = frasi[k];
          for (var i = 0; i + fr.length <= lista.length; i++) {
            var uguale = true;
            for (var j = 0; j < fr.length; j++) if (lista[i + j] !== fr[j]) { uguale = false; break; }
            if (uguale) { lista.splice(i, fr.length); i--; }
          }
        }
        return lista;
      }
      // chiave per confrontare: niente rumore, articoli, nome del sito, anno; numeri romani in cifre
      function chiaveDi(nome, frasi) {
        var p = togliFrasi(parole(nome), frasi || []), out = [];
        for (var i = 0; i < p.length; i++) {
          var w = Object.prototype.hasOwnProperty.call(ROMANI, p[i]) ? ROMANI[p[i]] : p[i];
          if (VUOTE[w] === 1 || RUMORE[w] === 1 || /^(19[2-9]\d|20[0-4]\d)$/.test(w)) continue;
          out.push(w);
        }
        while (out.length > 1 && GENERICHE[out[0]] === 1) out.shift();
        while (out.length > 1 && GENERICHE[out[out.length - 1]] === 1) out.pop();
        // una parola generica da sola ("Film HD", "Serie TV") non dice quale opera e'
        if (out.length === 1 && GENERICHE[out[0]] === 1) return '';
        return out.join(' ');
      }
      // somiglianza tra due nomi (0..1): coppie di lettere in comune; regge errori di battitura e piccole differenze
      function coppie(s) {
        var m = {}, n = 0;
        s = ' ' + s + ' ';
        for (var i = 0; i < s.length - 1; i++) { var c = s.substr(i, 2); m[c] = (m[c] || 0) + 1; n++; }
        return { m: m, n: n };
      }
      function somiglianza(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1;
        var A = coppie(a), B = coppie(b), comuni = 0;
        for (var k in A.m) if (Object.prototype.hasOwnProperty.call(B.m, k)) comuni += Math.min(A.m[k], B.m[k]);
        return 2 * comuni / (A.n + B.n);
      }
      // stagione e puntata: S01E05, S1 \u00b7 E5, 1x05, Stagione 1 Episodio 5, Season 1 Episode 5, Stag. 1 Ep. 5...
      var RE_SE = [
        /\bs(\d{1,2})\s{0,3}[ .:\-_\u00b7\u2022]?\s{0,3}e(?:p\.?)?\s{0,3}(\d{1,4})\b/i,
        /\b(\d{1,2})\s{0,3}[x\u00d7]\s{0,3}(\d{1,4})\b/i,
        /\b(?:stagione|stag\.?|st\.?|season)\s*(\d{1,2})\b[^0-9]{0,24}?\b(?:episodio|episode|puntata|ep\.?|e)\s*(\d{1,4})\b/i
      ];
      var RE_EP = /\b(?:episodio|episode|puntata|ep\.?)\s*(\d{1,4})\b/i;
      var RE_STAG = /\b(?:stagione|stag\.?|season)\s*(\d{1,2})\b/i;
      function trovaSE(t) {
        t = String(t || '');
        for (var i = 0; i < RE_SE.length; i++) {
          var m = RE_SE[i].exec(t);
          if (m && +m[2] > 0) return { s: +m[1] || null, e: +m[2], prima: t.slice(0, m.index), dopo: t.slice(m.index + m[0].length) };
        }
        var e = RE_EP.exec(t);
        if (!e || !(+e[1] > 0)) return null;
        var s = RE_STAG.exec(t);
        var inizio = s && s.index < e.index ? s.index : e.index;
        return { s: s ? +s[1] || null : null, e: +e[1], prima: t.slice(0, inizio), dopo: t.slice(e.index + e[0].length) };
      }
      function togliSE(t) {
        t = String(t || '');
        for (var i = 0; i < RE_SE.length; i++) t = t.replace(RE_SE[i], ' ');
        return t.replace(RE_EP, ' ').replace(RE_STAG, ' ');
      }
      // il titolo da mostrare: senza i pezzi che sono il nome del sito o solo rumore ("Il mio film - NomeDelSito HD")
      var SEPARATORI = /\s+[|\u2013\u2014\-:\u00b7\u2022\u00bb~]+\s+|\s*[|\u2022\u00bb\u00b7]\s*/;
      function nomePulito(t, frasi) {
        var pezzi = String(t || '').replace(/\s+/g, ' ').split(SEPARATORI), tenuti = [];
        for (var i = 0; i < pezzi.length; i++) {
          var pz = pezzi[i].replace(/^\s+|\s+$/g, '');
          if (!pz || !chiaveDi(pz, frasi)) continue;
          // via le parole di rumore (sempre) e il nome del sito
          var w = pz.split(' '), resto = [];
          for (var j = 0; j < w.length; j++) {
            var n = parole(w[j]);
            if (n.length === 1 && RUMORE[n[0]] === 1) continue;
            resto.push(w[j]);
          }
          // via anche le parole rimaste appese ("Dune: Parte Due in", "Il Padrino film in")
          while (resto.length > 1) {
            var ult = parole(resto[resto.length - 1]);
            if (ult.length === 1 && (VUOTE[ult[0]] === 1 || GENERICHE[ult[0]] === 1)) resto.pop(); else break;
          }
          var testoPezzo = resto.join(' ').replace(/[\s(\[]+$/, '').replace(/^\s+|\s+$/g, '');
          if (testoPezzo && chiaveDi(testoPezzo, frasi)) tenuti.push(testoPezzo);
        }
        return tenuti.join(' - ').replace(/\s*[(\[]\s*(19[2-9]\d|20[0-4]\d)\s*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 80);
      }
      function annoDi(t) {
        var m = /[(\[]\s*(19[2-9]\d|20[0-4]\d)\s*[)\]]/.exec(String(t || ''));
        return m ? +m[1] : null;
      }
      // quello che una pagina dice di se': solo testi corti e numeri (nessuna pagina puo' rallentare o confondere il TV)
      function paginaPulita(p) {
        if (!p || typeof p !== 'object' || typeof p.url !== 'string' || !urlValido(p.url)) return null;
        var ld = p.ld && typeof p.ld === 'object' ? p.ld : {};
        function n(x) { x = Number(x); return isFinite(x) && x > 0 && x < 100000 ? Math.floor(x) : 0; }
        return { url: p.url, titolo: testo(p.titolo, 300), og: testo(p.og, 400), ogSito: testo(p.ogSito, 80), h1: testo(p.h1, 200),
          lettore: testo(p.lettore, 200), video: testo(p.video, 500), immagine: urlValido(p.immagine) ? p.immagine : '',
          prossimo: urlValido(p.prossimo) ? p.prossimo : '', altro: altroPulito(p.altro),
          ld: { nome: testo(ld.nome, 200), serie: testo(ld.serie, 200), episodio: n(ld.episodio), stagione: n(ld.stagione), anno: n(ld.anno) } };
      }
      // dove altro la pagina dice la puntata (le scritte del lettore, la puntata segnata nell'elenco, il riquadro del video):
      // al massimo 6 testi corti
      function altroPulito(a) {
        var out = [];
        if (Array.isArray(a)) for (var i = 0; i < a.length && out.length < 6; i++) if (typeof a[i] === 'string' && a[i]) out.push(testo(a[i], 300));
        return out;
      }
      // stagione e puntata nelle domande dell'indirizzo, solo coi nomi giusti: ?season=1&episode=5, ?stagione=1&episodio=5,
      // ?s=1&e=5 (tutti e due), ?episode=5 da solo. "e" o "ep" da soli sono spesso il codice della puntata, non il numero
      function domandeSE(u) {
        var q = senzaAncoraVera(u), k = q.indexOf('?');
        if (k === -1) return null;
        q = q.slice(k);
        var s = /[?&](?:season|stagione|s)=0*(\d{1,2})(?=&|#|$)/i.exec(q), e = /[?&](?:episode|episodio|ep|e)=0*(\d{1,3})(?=&|#|$)/i.exec(q);
        if (!e || !(+e[1] > 0) || (!s && !/[?&](?:episode|episodio)=/i.test(q))) return null;
        return { s: s ? +s[1] || null : null, e: +e[1] };
      }
      // l'indirizzo di quello che guardi: senza l'ancora, ma i siti fatti a "#/percorso" la tengono (e' la pagina)
      function senzaAncoraVera(u) {
        var s = String(u || ''), k = s.indexOf('#');
        return k === -1 || /^#!?\//.test(s.slice(k)) ? s : s.slice(0, k);
      }
      // il percorso dell'indirizzo (senza sito e domande), dove cercare stagione e puntata
      function percorsoDi(u) {
        var via = senzaAncoraVera(u).replace(/^https?:\/\/[^\/]+/i, '').replace(/\?[^#]*/, '');
        try { via = decodeURIComponent(via); } catch (e) {}
        return via;
      }
      // il nome trovato quando stagione e puntata sono solo nell'indirizzo: le sue parole ci devono essere tutte
      // (se no e' il titolo della puntata, come "Pilot", e non il nome della serie)
      function nelUrl(k, daUrl) {
        if (!k) return false;
        if (!daUrl) return true;
        var w = k.split(' ');
        for (var i = 0; i < w.length; i++) if (daUrl.indexOf(' ' + w[i] + ' ') === -1) return false;
        return true;
      }
      // chi e' questo video: { chiave, nome, stagione, episodio, anno, durata }
      function identita(p, durata) {
        var frasi = frasiSito(p), ld = p.ld && typeof p.ld === 'object' ? p.ld : {}, daUrl = '';
        var fonti = [ld.nome, p.og, p.h1, p.lettore, p.titolo], se = null, nome = '', i, x;
        for (i = 0; i < fonti.length; i++) fonti[i] = fonti[i] ? testo(fonti[i], 400).replace(/\s+/g, ' ') : '';
        // un h1 uguale al pezzo in fondo al titolo della pagina ("Oppenheimer | NomeDelSito") e' il logo del sito:
        // non dice cosa guardi (resta pero' nelle altre fonti, dove puo' essere anche il nome della serie)
        var pezzi = fonti[4].split(SEPARATORI), h1 = parole(fonti[2]).join(' ');
        for (i = 1; i < pezzi.length && h1; i++) if (parole(pezzi[i]).join(' ') === h1) fonti[2] = '';
        if (ld.episodio > 0) {
          se = { s: ld.stagione > 0 ? +ld.stagione : null, e: +ld.episodio };
          if (ld.serie) nome = testo(ld.serie, 200);
        }
        for (i = 0; i < fonti.length && !se; i++) {
          x = trovaSE(fonti[i]);
          // il nome della serie e' quello prima di "S01E05" (dopo c'e' di solito il titolo della puntata)
          if (x) { se = x; nome = chiaveDi(x.prima, frasi) ? x.prima : ''; }
        }
        if (!se) {
          var via = percorsoDi(p.url);
          x = trovaSE(via.replace(/[\/\-_+.#!]+/g, ' '));
          if (x) { se = { s: x.s, e: x.e }; daUrl = ' ' + parole(via).join(' ') + ' '; }
        }
        // poi le domande dell'indirizzo e quello che la pagina dice altrove: da li' solo i numeri, il nome resta dei titoli
        if (!se) se = domandeSE(p.url);
        for (i = 0; i < (p.altro || []).length && !se; i++) { x = trovaSE(p.altro[i]); if (x) se = { s: x.s, e: x.e }; }
        var anno = ld.anno > 1900 ? +ld.anno : null;
        if (se) {
          if (!nome || !chiaveDi(nome, frasi)) {
            nome = '';
            // prima il nome davanti a "S01E05" in un altro titolo; poi i titoli senza stagione e puntata (che pero' sono
            // spesso il titolo della puntata: se stagione e puntata sono solo nell'indirizzo, il nome deve esserci anche li')
            for (i = 0; i < fonti.length && !nome; i++) { x = trovaSE(fonti[i]); if (x && nelUrl(chiaveDi(x.prima, frasi), daUrl)) nome = x.prima; }
            for (i = 0; i < fonti.length && !nome; i++) if (fonti[i] && !trovaSE(fonti[i]) && nelUrl(chiaveDi(fonti[i], frasi), daUrl)) nome = fonti[i];
            for (i = 0; i < fonti.length && !nome; i++) if (fonti[i] && nelUrl(chiaveDi(togliSE(fonti[i]), frasi), daUrl)) nome = togliSE(fonti[i]);
          }
          // anche le serie hanno un anno: "Doctor Who (2005)" non e' "Doctor Who (2023)"
          anno = anno || annoDi(nome);
          nome = nomePulito(togliSE(nome), frasi);
        } else {
          for (i = 0; i < fonti.length; i++) {
            var n = nomePulito(fonti[i], frasi);
            if (n) { nome = n; anno = anno || annoDi(fonti[i]); break; }
          }
          // l'anno puo' essere in un'altra fonte ("Il Gladiatore" nell'h1, "(2000)" nel titolo)
          for (i = 0; i < fonti.length && !anno; i++) anno = annoDi(fonti[i]);
        }
        return { chiave: chiaveDi(nome, frasi), nome: nome, stagione: se ? se.s : null, episodio: se ? se.e : null, anno: anno || null,
          durata: durata };
      }
      function urlNorm(u) { return senzaAncoraVera(u).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase(); }
      // due video diversi della stessa pagina (la pagina dice quale: la sorgente, o il riquadro del lettore)
      function stessoVideoDi(e, p) { return !(e.video && p.video && e.video !== p.video); }
      function stessoPosto(e, p) { return urlNorm(e.url) === urlNorm(p.url) && stessoVideoDi(e, p); }
      function stessaStagione(a, b) {
        var x = a.stagione || null, y = b.stagione || null;
        return x === y || (x === null && y === 1) || (x === 1 && y === null);
      }
      function numeriDi(k) { return (String(k || '').match(/\d+/g) || []).join(' '); }
      // uno e' l'altro con parole intere in piu': "Dragon Ball" e "Dragon Ball Z", "Tokyo Ghoul" e "Tokyo Ghoul re" (gli errori
      // di battitura cambiano lettere, non aggiungono parole)
      function paroleInPiu(a, b) {
        var pa = String(a).split(' '), pb = String(b).split(' ');
        if (pa.length === pb.length) return false;
        var corta = pa.length < pb.length ? pa : pb, lunga = corta === pa ? pb : pa;
        for (var i = 0; i < corta.length; i++) if (lunga.indexOf(corta[i]) === -1) return false;
        return true;
      }
      // stessa opera (stesso film, stessa serie)? Nel dubbio: no
      function stessaOpera(e, id) {
        if (!e || !id.chiave) return false;
        if ((e.episodio != null) !== (id.episodio != null)) return false;
        var chiavi = (e.chiavi || []).concat([e.chiave]), s = 0, i;
        if (e.titoloMio) chiavi.push(chiaveDi(e.titoloMio));
        // i numeri devono essere gli stessi: "Rocky" non e' "Rocky II", "Toy Story" non e' "Toy Story 2"
        for (i = 0; i < chiavi.length; i++) {
          if (numeriDi(chiavi[i]) === numeriDi(id.chiave) && !paroleInPiu(chiavi[i], id.chiave)) s = Math.max(s, somiglianza(chiavi[i], id.chiave));
        }
        var diff = e.durata && id.durata ? Math.abs(e.durata - id.durata) / Math.max(e.durata, id.durata) : null;
        if (e.anno && id.anno && e.anno !== id.anno) return false; // remake, rifacimenti, serie nuove con lo stesso nome
        if (id.episodio != null) return s >= 0.86 && (diff === null || diff <= 0.3); // puntate della stessa serie: durata simile
        if (s < 0.9 || diff === null) return false;
        // un film: anche la durata deve tornare, cosi' non si confondono il trailer, il remake, la versione estesa.
        // Con l'anno da tutte e due le parti al massimo 6%; senza, quasi uguale (1,5%) o la versione europea a 25 fotogrammi
        // (il 4% piu' corta)
        if (e.anno && id.anno) return diff <= 0.06;
        return diff <= 0.015 || (diff >= 0.036 && diff <= 0.046);
      }
      // la stessa puntata su due siti dura quasi uguale (cambiano sigla e riassunto): massimo 15% di differenza
      function stessaPuntata(e, id) {
        if (!stessaOpera(e, id) || e.episodio !== id.episodio || !stessaStagione(e, id)) return false;
        return !(e.durata && id.durata) || Math.abs(e.durata - id.durata) / Math.max(e.durata, id.durata) <= 0.15;
      }
      function nomeSito(p) {
        var og = testo(p.ogSito, 40).replace(/^\s+|\s+$/g, '');
        return og || hostLink(p.url).replace(/^www\./, '');
      }
      function trovaVisto(id, p) {
        var i, e;
        for (i = 0; i < visti.length; i++) {
          e = visti[i];
          if (!stessoPosto(e, p)) continue;
          if (id.episodio == null ? Math.abs((e.durata || 0) - id.durata) <= 3 : (e.episodio === id.episodio && stessaStagione(e, id))) return e;
          // lo stesso video di una scheda fatta quando stagione e puntata non si leggevano: e' lei, adesso con la puntata
          if (e.episodio == null && Math.abs((e.durata || 0) - id.durata) <= 3) return e;
        }
        // la stessa opera su un'altra pagina: dello stesso sito (con l'opzione anche di un altro, e la scheda passa a lui)
        for (i = 0; i < visti.length; i++) if (sitoBuono(visti[i], p) && (stessaOpera(visti[i], id) || serieDiPrima(visti[i], id, p))) return visti[i];
        return null;
      }
      // una scheda fatta quando stagione e puntata di quel sito non si leggevano: un'altra puntata della stessa serie, sullo
      // stesso sito (stesso nome, durata simile), la aggiorna invece di farne una seconda
      function serieDiPrima(e, id, p) {
        if (e.episodio != null || id.episodio == null || !id.chiave || !stessoSito(hostLink(e.url), hostLink(p.url))) return false;
        if (e.anno && id.anno && e.anno !== id.anno) return false;
        var chiavi = (e.chiavi || []).concat([e.chiave]), s = 0;
        for (var i = 0; i < chiavi.length; i++) {
          if (chiavi[i] && numeriDi(chiavi[i]) === numeriDi(id.chiave) && !paroleInPiu(chiavi[i], id.chiave)) s = Math.max(s, somiglianza(chiavi[i], id.chiave));
        }
        return s >= 0.9 && !!(e.durata && id.durata) && Math.abs(e.durata - id.durata) / Math.max(e.durata, id.durata) <= 0.15;
      }
      function registraVisto(b) {
        var p = paginaPulita(b.pagina);
        if (!p) return;
        var dur = Number(b.durata), pos = Number(b.posizione);
        if (!isFinite(dur) || dur < MIN_DURATA || dur > 1e6 || !isFinite(pos) || pos < 0) return;
        var id = identita(p, dur);
        if (!id.chiave) return;
        var finito = pos >= dur - Math.max(90, dur * 0.05);
        // quanto e' stato guardato davvero (lo dicono le pagine): un sito che riprende da solo dal suo punto non e' "visto"
        var poco = typeof b.guardato === 'number' && b.guardato < MIN_VISTO && b.scelto !== true;
        var e = trovaVisto(id, p);
        if (!e) {
          if ((pos < MIN_VISTO && !finito) || poco) return; // un video aperto per sbaglio non diventa una scheda
          e = { id: casuale(6), titoloMio: '', chiavi: [] };
          visti.unshift(e);
        } else {
          // nel primo minuto la scheda non cambia (ne' il punto ne' il sito): il video riparte da 0 prima di
          // riprendere da dov'eri, e una puntata o un sito aperti per sbaglio non contano. Altrove conta anche quanto lo
          // guardi: il punto di un sito che riprende da solo non cancella quello, piu' avanti, visto su un altro
          if (pos < MIN_VISTO && !finito) return;
          if (poco && !stessoPosto(e, p)) return;
          visti.splice(visti.indexOf(e), 1);
          visti.unshift(e);
        }
        // lo stesso video di prima: stagione e puntata gia' sapute restano anche se questa volta la pagina non le dice
        if (id.episodio == null && e.episodio != null && stessoPosto(e, p) && Math.abs((e.durata || 0) - id.durata) <= 3) {
          id.stagione = e.stagione;
          id.episodio = e.episodio;
        }
        // stessa puntata di prima (anche su un altro sito, con l'opzione): vale la puntata dopo saputa prima
        var stessaDiPrima =!!e.url && id.episodio != null && e.episodio === id.episodio && stessaStagione(e, id);
        if (e.chiave && e.chiave !== id.chiave && (e.chiavi || []).indexOf(e.chiave) === -1) e.chiavi = (e.chiavi || []).concat([e.chiave]).slice(-4);
        e.chiave = id.chiave;
        e.nome = id.nome;
        e.stagione = id.stagione;
        e.episodio = id.episodio;
        if (id.anno) e.anno = id.anno;
        e.url = senzaAncoraVera(p.url);
        e.video = p.video;
        e.sito = nomeSito(p);
        e.posizione = Math.round(pos);
        e.durata = Math.round(dur);
        e.finito = finito;
        e.quando = Date.now();
        if (p.immagine) e.immagine = p.immagine;
        // il titolo della pagina senza il nome del sito: un riferimento scritto sulla scheda quando stagione e puntata non si
        // riconoscono (cambiando sito si sa almeno cosa cercare)
        e.rif = nomePulito(p.og || p.titolo, frasiSito(p)).slice(0, 90);
        // la puntata dopo (solo per le serie): se questa volta il sito non la mostra, vale quella saputa prima
        var prossimo = id.episodio != null && p.prossimo && urlNorm(p.prossimo) !== urlNorm(p.url) ? p.prossimo : '';
        if (prossimo || !stessaDiPrima) { e.prossimo = prossimo; e.prossimoSito = prossimo ? nomeSito(p) : ''; }
        if (visti.length > MAX_VISTI) visti.length = MAX_VISTI;
        salva(false);
      }
      // quando parte un video: riprendere? (stesso video: da solo; stessa opera su un'altra pagina dello stesso sito, o di un
      // altro sito con l'opzione: si propone)
      function cercaVisto(b) {
        var out = { ok: true }, p = b && typeof b === 'object' ? paginaPulita(b.pagina) : null;
        if (!p) return out;
        var dur = Number(b.durata), u = urlNorm(p.url);
        if (perIntento(p, dur)) {
          out.continua = { posizione: intentoContinua.posizione };
          intentoContinua = null;
          return out;
        }
        if (!isFinite(dur) || dur < MIN_DURATA) return out;
        var id = identita(p, dur), buoni = [], i, e;
        if (!id.chiave) return out;
        for (i = 0; i < visti.length; i++) {
          e = visti[i];
          if (e.finito || !(e.posizione >= MIN_VISTO) || e.posizione > dur - 60) continue;
          // lo stesso video (stessa pagina, stessa durata), anche se una delle due volte stagione e puntata non si leggevano
          if (urlNorm(e.url) === u && stessoVideoDi(e, p) && Math.abs((e.durata || 0) - dur) <= 2 &&
            (id.episodio == null || e.episodio == null || (e.episodio === id.episodio && stessaStagione(e, id)))) {
            out.stesso = { posizione: e.posizione };
            return out;
          }
          if (sitoBuono(e, p) && (id.episodio != null ? stessaPuntata(e, id) : stessaOpera(e, id))) buoni.push(e);
        }
        // una sola possibilita' (o tutte allo stesso punto): si propone; se no, niente
        if (buoni.length && buoni.every(function (x) { return Math.abs(x.posizione - buoni[0].posizione) < 30; })) {
          e = buoni[0];
          out.proposta = { posizione: e.posizione, sito: e.sito || hostLink(e.url), titolo: titoloScheda(e) };
        }
        return out;
      }
      // e' il video scelto in "Continua a guardare"? Stesso indirizzo; oppure, appena scelto, lo stesso sito con
      // un indirizzo cambiato strada facendo (un reindirizzamento), ma solo se e' proprio quella cosa
      function perIntento(p, dur) {
        var it = intentoContinua, e = null, i;
        if (!it || Date.now() >= it.scade) return false;
        if (urlNorm(it.url) === urlNorm(p.url)) {
          // la stessa pagina puo' far partire prima un altro video lungo (un trailer, un'altra puntata): deve essere quello
          return it.prossima || (Math.abs((it.durata || 0) - dur) <= 3 && !(it.video && p.video && it.video !== p.video));
        }
        if (Date.now() - it.creato > 60000 || !isFinite(dur) || dur < MIN_DURATA) return false;
        if (!stessoSito(hostLink(it.url), hostLink(p.url))) return false;
        for (i = 0; i < visti.length; i++) if (visti[i].id === it.id) e = visti[i];
        var id = identita(p, dur);
        if (!e || !id.chiave) return false;
        return it.prossima ? stessaOpera(e, id) : stessaPuntata(e, id);
      }
      function titoloScheda(e) {
        var n = e.titoloMio || e.nome || '';
        if (e.episodio != null) n += ' \u00b7 ' + (e.stagione ? 'S' + e.stagione + ' E' + e.episodio : 'Puntata ' + e.episodio);
        return n;
      }
      // stagione e puntata della puntata dopo (dopo la 10 puo' venire la 1 della stagione dopo): dal suo indirizzo; se no,
      // se il suo indirizzo e' quello di questa con un numero solo cresciuto di uno ("/2/5" -> "/2/6"), la puntata dopo nella
      // stessa stagione; se no non si sa e la scheda dice solo "Prossima puntata"
      function puntataDopo(e) {
        var x = trovaSE(percorsoDi(e.prossimo).replace(/[\/\-_+.#!]+/g, ' '));
        if (x) return { s: x.s, e: x.e };
        if (e.episodio == null) return null;
        var a = percorsoDi(e.url).match(/\d+/g) || [], b = percorsoDi(e.prossimo).match(/\d+/g) || [], diversi = 0, cresciuto = false;
        if (a.length !== b.length) return null;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { diversi++; cresciuto = +b[i] === +a[i] + 1; }
        return diversi === 1 && cresciuto ? { s: e.stagione, e: e.episodio + 1 } : null;
      }
      function vistiPerHome() {
        var out = [];
        for (var i = 0; i < visti.length && out.length < MAX_SCHEDE; i++) {
          var e = visti[i];
          var s = { id: e.id, nome: e.titoloMio || e.nome, stagione: e.stagione, episodio: e.episodio, anno: e.anno || null, sito: e.sito,
            immagine: e.immagine || '', posizione: e.posizione, durata: e.durata, url: e.url, quando: e.quando, rinominato: !!e.titoloMio,
            rif: e.rif || '' };
          if (e.finito) {
            if (!e.prossimo) continue;
            // puntata finita: la scheda propone la prossima
            s.url = e.prossimo;
            s.posizione = 0;
            s.prossima = true;
            s.rif = '';
            s.sito = e.prossimoSito || hostLink(e.prossimo).replace(/^www\./, '');
            var dopo = puntataDopo(e);
            s.stagione = dopo ? dopo.s : null;
            s.episodio = dopo ? dopo.e : null;
          }
          out.push(s);
        }
        return out;
      }
      function cambiaVisti(azione, b) {
        if (azione === 'svuota') { visti = []; intentoContinua = null; salva(true); return { ok: true }; }
        var e = null, i;
        for (i = 0; i < visti.length; i++) if (visti[i].id === b.id) { e = visti[i]; break; }
        if (!e) return { ok: false, error: 'non trovato' };
        if (azione === 'riprendi') {
          var url = e.finito && e.prossimo ? e.prossimo : e.url;
          intentoContinua = { url: url, posizione: b.daCapo || (e.finito && e.prossimo) ? 0 : e.posizione, id: e.id, durata: e.durata,
            video: e.video || '', prossima: !!(e.finito && e.prossimo), creato: Date.now(), scade: Date.now() + 120000 };
          return { ok: true, url: url };
        }
        if (azione === 'togli') visti.splice(i, 1);
        else if (azione === 'rinomina') e.titoloMio = testo(b.titolo, 80).replace(/^\s+|\s+$/g, '');
        else if (azione === 'visto') e.finito = true;
        salva(true);
        return { ok: true };
      }

      return {
        registra: function (b) { registraVisto(b); },
        cerca: cercaVisto,
        perHome: function () { return { visti: vistiPerHome(), totale: visti.length }; },
        cambia: cambiaVisti,
        riproduci: function (url) {
          intentoContinua = { url: url, posizione: 0, id: '', durata: 0, video: '', prossima: false, riproduci: true,
            creato: Date.now(), scade: Date.now() + 120000 };
        },
        intento: function () {
          var it = intentoContinua;
          if (!it || Date.now() >= it.scade) return null;
          return { url: it.url, posizione: it.posizione, fresco: Date.now() - it.creato < 30000, riproduci: !!it.riproduci };
        }
      };
    }

    return { crea: crea };
  })();
  /* </visti:generato> */
  var FILE_VISTI = pathLib.join(CACHE_DIR, 'hometv-visti.json');
  var visti = VistiTV.crea({ dati: leggiJson(FILE_VISTI, []), salva: function (l, subito) { scriviJson(FILE_VISTI, l, subito); },
    prefs: function () { return prefs; }, casuale: casuale });

  /* ---------------------------------------------------------- l'app Video: i film delle chiavette
   * La logica e' in tv-sito/videoteca.js (qui la sua copia). Le domande /api/video/g/<gettone>/... le fa solo l'app
   * ufficiale dello Store col permesso "video": il gettone lo chiede la home (con la sua chiave) quando la apre e lo
   * toglie quando la chiude. Sola lettura, mai fuori dai punti di montaggio delle chiavette. */
  /* <videoteca:generato> copia di tv-sito/videoteca.js (prove/incorpora_videoteca.py): non modificare qui */
  /*
   * Home TV - VIDEOTECA: i video delle chiavette e dei dischi USB attaccati al TV, per l'app Video dello Store.
   * Si modifica SOLO questo file; service.js (Samsung e LG) ne ha una copia tra i segnaposto <videoteca:generato>, messa da
   * prove/incorpora_videoteca.py (le prove controllano che sia uguale).
   *
   * Legge cartelle e file (solo lettura, mai fuori dai punti di montaggio), capisce com'e' fatto un video (MKV, WebM, MP4:
   * durata, tracce, capitoli, HDR) e lo serve al <video> del TV con le richieste Range. Le tracce che il TV non legge
   * (DTS, TrueHD) o che non servono (gli altri audio; i sottotitoli, che disegna l'app) spariscono senza copiare niente:
   * nel MKV un blocco diventa un elemento Void cambiando un solo byte (0xA3, 0xA0, 0xAE -> 0xEC: la dimensione resta e i
   * dati restano, il lettore li salta), nell'MP4 una traccia diventa un riquadro "free" (4 byte). Il file servito ha la
   * stessa lunghezza e gli stessi indirizzi del vero: Range, indici (Cues) e salti funzionano come col file vero.
   * I sottotitoli (testo e PGS) si raccolgono dai blocchi che passano e, se le Cues li indicano, si leggono tutti subito.
   *
   *   var vt = Videoteca.crea({ fs, path, zlib, radici: ['/opt/media'], letti: function () { return ProfiloTV.videoLetti(f); } });
   *   vt.dischi(cb)  vt.cartella(d, p, cb)  vt.info(d, p, scelte, cb)  vt.servi(req, res, d, p, scelte)
   *   vt.sotto(d, p, traccia, da, cb)  vt.sottoEsterni(d, p, cb)  vt.prova(cb) (per "Questo TV")
   *   var g = Videoteca.gettoni(crypto)     g.nuovo() -> { gettone, scade }; g.valido(x); g.togli(x)
   *   Videoteca.gestisci(vt, g, req, res, url, { punto: fn })   le domande /api/video/g/<gettone>/... (true = risposto)
   *
   * Gli errori hanno err.codice: 'disco' (chiavetta non trovata), 'percorso', 'permesso', 'formato', 'assente'.
   * Solo ES5 e solo ASCII; va da Node 4.4.3 (TV 2017-2019) in su.
   */
  var Videoteca = (function () {
    'use strict';

    /* ============================================================ byte e numeri */

    function nuovo(n) { return typeof Buffer.allocUnsafe === 'function' ? Buffer.allocUnsafe(n) : new Buffer(n); }
    function unisci(a, b) {
      if (!a || !a.length) return b;
      if (!b || !b.length) return a;
      return Buffer.concat([a, b], a.length + b.length);
    }
    function copia(b) { var c = nuovo(b.length); b.copy(c); return c; }
    function uint(b, i, n) { var v = 0; for (var k = 0; k < n; k++) v = v * 256 + b[i + k]; return v; }
    function float(b, i, n) { return n === 4 ? b.readFloatBE(i) : n === 8 ? b.readDoubleBE(i) : 0; }
    function stringa(b, i, n) {
      var s = b.toString('utf8', i, i + n), z = s.indexOf('\u0000');
      return z === -1 ? s : s.slice(0, z);
    }
    function errore(codice, testo) { var e = new Error(testo || codice); e.codice = codice; return e; }
    // tetti per i file fatti male (o apposta): nessun file deve fermare il servizio del TV o riempirgli la memoria.
    // Cues al massimo 8 MB e 100000 punti (un film vero: meno di 2 MB e 10000); sottotitoli compressi gonfiati al massimo
    // 256 KB (testo) o 4 MB (un'immagine PGS); sottotitoli tenuti al massimo 16 MB per tutti i file, 2 MB di testo a traccia
    var MAX_CUES = 8 << 20, MAX_PUNTI = 100000, MAX_CONFINI = 200000, MAX_GONFIO_TESTO = 256 << 10, MAX_GONFIO_PGS = 4 << 20;
    var MAX_SOTTO_TOT = 16 << 20, MAX_TESTO_TRACCIA = 2 << 20, MAX_CODA_GONFIO = 2000, FINESTRA_PGS = 120000, FINESTRA_TESTO = 600000;
    // al massimo 20000 eventi per traccia (un film vero ne ha meno di 5000): tanti sottotitoli minuscoli non fermano il servizio
    var MAX_EVENTI = 20000;

    /* ============================================================ EBML (Matroska, WebM) */

    // un ID (1-4 byte, col marcatore): { id, n }; null se mancano byte; id -1 se non e' un ID
    function leggiId(b, i) {
      if (i >= b.length) return null;
      var c = b[i], n = c & 0x80 ? 1 : c & 0x40 ? 2 : c & 0x20 ? 3 : c & 0x10 ? 4 : 0;
      if (!n) return { id: -1, n: 1 };
      if (i + n > b.length) return null;
      return { id: uint(b, i, n), n: n };
    }
    // un numero a lunghezza variabile (dimensioni, numero di traccia): { v, n, ignota }; null se mancano byte
    function leggiVint(b, i) {
      if (i >= b.length) return null;
      var c = b[i], n = 1, m = 0x80;
      while (n <= 8 && !(c & m)) { n++; m >>= 1; }
      if (n > 8) return { v: -1, n: 1, rotto: true };
      if (i + n > b.length) return null;
      var v = c & (m - 1), tutti = v === m - 1;
      for (var k = 1; k < n; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) tutti = false; }
      return { v: v, n: n, ignota: tutti };
    }
    // i figli di un elemento letto tutto in b[da..a): fn(id, inizioDati, fineDati, inizioElemento); false = basta
    function figli(b, da, a, fn) {
      var i = da;
      while (i < a) {
        var id = leggiId(b, i);
        if (!id || id.id < 0) return;
        var d = leggiVint(b, i + id.n);
        if (!d || d.rotto) return;
        var s = i + id.n + d.n, e = d.ignota ? a : s + d.v;
        if (e > a) e = a;
        if (fn(id.id, s, e, i) === false) return;
        i = e;
      }
    }

    var ID = {
      EBML: 0x1A45DFA3, DOCTYPE: 0x4282, SEGMENT: 0x18538067, SEEKHEAD: 0x114D9B74, SEEK: 0x4DBB, SEEKID: 0x53AB,
      SEEKPOS: 0x53AC, INFO: 0x1549A966, SCALA: 0x2AD7B1, DURATA: 0x4489, TITOLO: 0x7BA9, TRACKS: 0x1654AE6B, ENTRY: 0xAE,
      NUM: 0xD7, TIPO: 0x83, ABILITATA: 0xB9, PREDEF: 0x88, FORZATA: 0x55AA, UDITO: 0x55AB, COMMENTO: 0x55AF,
      LINGUA: 0x22B59C, BCP47: 0x22B59D, NOME: 0x536E, CODEC: 0x86, PRIVATO: 0x63A2, VIDEO: 0xE0, AUDIO: 0xE1,
      LARGH: 0xB0, ALT: 0xBA, COLORE: 0x55B0, TRASF: 0x55BA, PRIMARI: 0x55BB, MAXCLL: 0x55BC, BIT: 0x55B2, FREQ: 0xB5,
      CANALI: 0x9F, MAPPA: 0x41E4, MAPPA_TIPO: 0x41E7, MAPPA_DATI: 0x41ED, CODIFICHE: 0x6D80, CODIFICA: 0x6240,
      COD_TIPO: 0x5033, COMPRESSIONE: 0x5034, COMP_ALGO: 0x4254, COMP_DATI: 0x4255, CLUSTER: 0x1F43B675, TEMPO: 0xE7,
      SIMPLE: 0xA3, GRUPPO: 0xA0, BLOCCO: 0xA1, DURATA_BLOCCO: 0x9B, CUES: 0x1C53BB6B, CUEPOINT: 0xBB, CUETIME: 0xB3,
      CUEPOS: 0xB7, CUETRACK: 0xF7, CUECLUSTER: 0xF1, CUEREL: 0xF0, CUEDUR: 0xB2, CHAPTERS: 0x1043A770, EDITION: 0x45B9,
      ATOM: 0xB6, CH_INIZIO: 0x91, CH_NASCOSTO: 0x98, CH_ABILITATO: 0x4598, CH_DISPLAY: 0x80, CH_TESTO: 0x85,
      TAGS: 0x1254C367, ALLEGATI: 0x1941A469, VOID: 0xEC, CRC: 0xBF
    };
    // gli elementi di primo livello: in un Cluster di lunghezza ignota il prossimo di questi lo chiude
    var PRIMO_LIVELLO = {};
    [ID.CLUSTER, ID.CUES, ID.TAGS, ID.CHAPTERS, ID.SEEKHEAD, ID.INFO, ID.TRACKS, ID.ALLEGATI].forEach(function (x) { PRIMO_LIVELLO[x] = true; });
    var DOVI = { 0x64766343: true, 0x64767643: true, 0x64767743: true }; // dvcC dvvC dvwC: Dolby Vision

    /* ============================================================ lettura del file */

    function leggi(fs, fd, pos, n, cb) {
      var b = nuovo(n), fatto = 0;
      (function giro() {
        fs.read(fd, b, fatto, n - fatto, pos + fatto, function (err, letti) {
          if (err) { cb(err); return; }
          fatto += letti;
          if (letti === 0 || fatto >= n) { cb(null, fatto === n ? b : b.slice(0, fatto)); return; }
          giro();
        });
      })();
    }

    /* ============================================================ le tracce di un MKV */

    function traccia(b, s, f, inizio) {
      var t = { num: 0, tipo: 0, codec: '', lingua: 'eng', bcp47: '', nome: '', predefinita: true, forzata: false,
        abilitata: true, udito: false, commento: false, inizio: inizio, video: null, audio: null, privato: null, comp: null,
        cifrata: false };
      figli(b, s, f, function (id, a, z) {
        var n = z - a;
        if (id === ID.NUM) t.num = uint(b, a, n);
        else if (id === ID.TIPO) t.tipo = uint(b, a, n);
        else if (id === ID.CODEC) t.codec = stringa(b, a, n);
        else if (id === ID.LINGUA) t.lingua = stringa(b, a, n);
        else if (id === ID.BCP47) t.bcp47 = stringa(b, a, n);
        else if (id === ID.NOME) t.nome = stringa(b, a, n);
        else if (id === ID.PREDEF) t.predefinita = uint(b, a, n) !== 0;
        else if (id === ID.FORZATA) t.forzata = uint(b, a, n) !== 0;
        else if (id === ID.ABILITATA) t.abilitata = uint(b, a, n) !== 0;
        else if (id === ID.UDITO) t.udito = uint(b, a, n) !== 0;
        else if (id === ID.COMMENTO) t.commento = uint(b, a, n) !== 0;
        else if (id === ID.PRIVATO) { if (n <= 262144) t.privato = copia(b.slice(a, z)); }
        else if (id === ID.VIDEO) t.video = videoDi(b, a, z);
        else if (id === ID.AUDIO) t.audio = audioDi(b, a, z);
        else if (id === ID.MAPPA) mappaDi(b, a, z, t);
        else if (id === ID.CODIFICHE) codificheDi(b, a, z, t);
      });
      return t;
    }
    function videoDi(b, s, f) {
      var v = { largh: 0, alt: 0, trasf: 0, primari: 0, bit: 0, maxcll: 0 };
      figli(b, s, f, function (id, a, z) {
        if (id === ID.LARGH) v.largh = uint(b, a, z - a);
        else if (id === ID.ALT) v.alt = uint(b, a, z - a);
        else if (id === ID.COLORE) {
          figli(b, a, z, function (id2, a2, z2) {
            if (id2 === ID.TRASF) v.trasf = uint(b, a2, z2 - a2);
            else if (id2 === ID.PRIMARI) v.primari = uint(b, a2, z2 - a2);
            else if (id2 === ID.BIT) v.bit = uint(b, a2, z2 - a2);
            else if (id2 === ID.MAXCLL) v.maxcll = uint(b, a2, z2 - a2);
          });
        }
      });
      return v;
    }
    function audioDi(b, s, f) {
      var a = { canali: 0, freq: 0 };
      figli(b, s, f, function (id, x, z) {
        if (id === ID.CANALI) a.canali = uint(b, x, z - x);
        else if (id === ID.FREQ) a.freq = Math.round(float(b, x, z - x));
      });
      return a;
    }
    // BlockAdditionMapping: la configurazione del Dolby Vision (profilo, strato di miglioramento)
    function mappaDi(b, s, f, t) {
      var tipo = 0, da = -1, a = -1;
      figli(b, s, f, function (id, x, z) {
        if (id === ID.MAPPA_TIPO) tipo = uint(b, x, z - x);
        else if (id === ID.MAPPA_DATI) { da = x; a = z; }
      });
      if (DOVI[tipo] && da >= 0 && a - da >= 5) {
        t.dv = { profilo: b[da + 2] >> 1, strato: !!((b[da + 3] >> 1) & 1), compatibile: b[da + 4] >> 4 };
      }
    }
    // compressione dei blocchi (zlib o "header stripping"): serve per leggere i sottotitoli
    function codificheDi(b, s, f, t) {
      figli(b, s, f, function (id, a, z) {
        if (id !== ID.CODIFICA) return;
        var tipo = 0;
        figli(b, a, z, function (id2, a2, z2) {
          if (id2 === ID.COD_TIPO) tipo = uint(b, a2, z2 - a2);
          else if (id2 === ID.COMPRESSIONE) {
            var c = { algo: 0, dati: null };
            figli(b, a2, z2, function (id3, a3, z3) {
              if (id3 === ID.COMP_ALGO) c.algo = uint(b, a3, z3 - a3);
              else if (id3 === ID.COMP_DATI) c.dati = copia(b.slice(a3, z3));
            });
            t.comp = c;
          }
        });
        if (tipo === 1) t.cifrata = true;
      });
    }

    // un CuePoint: i suoi punti nelle tracce (perTraccia[traccia] = [{ t, cl, rel, dur }]); quanti ne ha aggiunti
    function cuePoint(b, a, z, segDati, perTraccia) {
      var t = -1, n = 0;
      figli(b, a, z, function (id2, a2, z2) {
        if (id2 === ID.CUETIME) t = uint(b, a2, z2 - a2);
        else if (id2 === ID.CUEPOS && t >= 0) {
          var p = { tr: 0, cl: -1, rel: -1, dur: -1 };
          figli(b, a2, z2, function (id3, a3, z3) {
            if (id3 === ID.CUETRACK) p.tr = uint(b, a3, z3 - a3);
            else if (id3 === ID.CUECLUSTER) p.cl = segDati + uint(b, a3, z3 - a3);
            else if (id3 === ID.CUEREL) p.rel = uint(b, a3, z3 - a3);
            else if (id3 === ID.CUEDUR) p.dur = uint(b, a3, z3 - a3);
          });
          if (p.cl < 0) return;
          (perTraccia[p.tr] = perTraccia[p.tr] || []).push({ t: t, cl: p.cl, rel: p.rel, dur: p.dur });
          n++;
        }
      });
      return n;
    }
    // le Cues a fette: dopo 15 ms si cede il turno (il servizio risponde anche mentre le legge), al massimo MAX_PUNTI
    // punti e 2 s di lavoro per file (oltre: quelle lette fin li')
    function cuesDiAFette(b, segDati, cb) {
      var perTraccia = {}, punti = 0, i = 0, a = b.length, spesi = 0;
      (function fetta() {
        var t0 = Date.now(), giri = 0;
        while (i < a && punti < MAX_PUNTI) {
          if (++giri % 256 === 0 && Date.now() - t0 > 15) break;
          var id = leggiId(b, i), d = id && id.id > 0 ? leggiVint(b, i + id.n) : null;
          if (!d || d.rotto) { i = a; break; }
          var s0 = i + id.n + d.n, e = d.ignota ? a : Math.min(a, s0 + d.v);
          if (id.id === ID.CUEPOINT) punti += cuePoint(b, s0, e, segDati, perTraccia);
          i = e;
        }
        spesi += Date.now() - t0;
        if (i < a && punti < MAX_PUNTI && spesi < 2000) { setImmediate(fetta); return; }
        cb(perTraccia);
      })();
    }
    function tagDi(b) {
      var out = { 50: {}, 60: {}, 70: {} }, quanti = 0;
      figli(b, 0, b.length, function (id, a, z) {
        if (id !== 0x7373) return; // Tag
        var tipo = 50, globale = true;
        figli(b, a, z, function (id2, a2, z2) {
          if (id2 !== 0x63C0) return; // Targets
          figli(b, a2, z2, function (id3, a3, z3) {
            if (id3 === 0x68CA) tipo = uint(b, a3, z3 - a3);
            else if ((id3 === 0x63C5 || id3 === 0x63C9 || id3 === 0x63C4 || id3 === 0x63C6) && uint(b, a3, z3 - a3)) globale = false;
          });
        });
        if (!globale) return;
        var liv = tipo >= 70 ? 70 : tipo >= 60 ? 60 : 50;
        figli(b, a, z, function (id2, a2, z2) {
          if (id2 !== 0x67C8 || quanti >= 80) return; // SimpleTag
          var nome = '', val = '';
          figli(b, a2, z2, function (id3, a3, z3) {
            if (id3 === 0x45A3) nome = stringa(b, a3, Math.min(z3 - a3, 60)).toUpperCase();
            else if (id3 === 0x4487) val = stringa(b, a3, Math.min(z3 - a3, 8000));
          });
          if (nome && val && out[liv][nome] === undefined) { out[liv][nome] = val; quanti++; }
        });
      });
      return out;
    }
    function capitoliDi(b, s, f, scala) {
      var out = [];
      figli(b, s, f, function (id, a, z) {
        if (id !== ID.EDITION || out.length) return; // la prima edizione
        figli(b, a, z, function (id2, a2, z2) {
          if (id2 !== ID.ATOM) return;
          var c = { t: 0, nome: '', nascosto: false, abilitato: true };
          figli(b, a2, z2, function (id3, a3, z3) {
            if (id3 === ID.CH_INIZIO) c.t = uint(b, a3, z3 - a3);
            else if (id3 === ID.CH_NASCOSTO) c.nascosto = uint(b, a3, z3 - a3) !== 0;
            else if (id3 === ID.CH_ABILITATO) c.abilitato = uint(b, a3, z3 - a3) !== 0;
            else if (id3 === ID.CH_DISPLAY && !c.nome) {
              figli(b, a3, z3, function (id4, a4, z4) { if (id4 === ID.CH_TESTO && !c.nome) c.nome = stringa(b, a4, z4 - a4); });
            }
          });
          if (!c.nascosto && c.abilitato && out.length < 300) out.push({ t: c.t / 1e9, nome: c.nome.slice(0, 120) });
        });
      });
      return out;
    }

    // la struttura di un MKV: si leggono gli elementi di primo livello fino al primo Cluster (piu' Cues e capitoli
    // indicati dal SeekHead, anche se stanno in fondo). Mai il file intero.
    function apriMkv(fs, fd, dim, cb0) {
      var finito = false;
      function cb(e, m) { if (!finito) { finito = true; cb0(e, m); } }
      // un file fatto male (o apposta) non deve mai fermare il servizio: un errore nella lettura diventa 'formato'
      function sicuro(fn) { return function (x, y) { try { fn(x, y); } catch (e) { cb(errore('formato', 'Matroska rovinato')); } }; }
      leggi(fs, fd, 0, Math.min(dim, 65536), sicuro(function (err, testa) {
        if (err) { cb(err); return; }
        var e = leggiId(testa, 0), d = e && e.id === ID.EBML ? leggiVint(testa, e.n) : null;
        if (!d || d.rotto) { cb(errore('formato', 'non e\' un file Matroska')); return; }
        var tipoDoc = 'matroska', fineEbml = e.n + d.n + d.v;
        figli(testa, e.n + d.n, Math.min(fineEbml, testa.length), function (id, s, f) { if (id === ID.DOCTYPE) tipoDoc = stringa(testa, s, f - s); });
        var se = leggiId(testa, fineEbml), sd = se && se.id === ID.SEGMENT ? leggiVint(testa, fineEbml + se.n) : null;
        if (!sd || sd.rotto) { cb(errore('formato', 'Matroska senza Segment')); return; }
        var m = { formato: tipoDoc === 'webm' ? 'webm' : 'mkv', dim: dim, segDati: fineEbml + se.n + sd.n, scala: 1000000,
          durata: 0, titolo: '', tracce: [], capitoli: [], cues: null, cluster1: -1, confini: [], tracksDati: -1,
          tracksFine: -1, crcTracks: -1, seek: {}, altri: [] };
        m.segFine = sd.ignota ? dim : Math.min(dim, m.segDati + sd.v);
        var pos = m.segDati, giri = 0;

        function elemento(id, inizio, datiDa, datiA, poi) {
          // si legge tutto solo cio' che serve, e con un limite (gli allegati, i font, si saltano)
          // (nei file veri SeekHead e Info sono di pochi byte, Tracks e capitoli di pochi KB, i Tags di decine di KB)
          var LIMITI = {}; LIMITI[ID.SEEKHEAD] = 64 << 10; LIMITI[ID.INFO] = 64 << 10; LIMITI[ID.TRACKS] = 1 << 20;
          LIMITI[ID.CHAPTERS] = 256 << 10; LIMITI[ID.CUES] = MAX_CUES; LIMITI[ID.TAGS] = 256 << 10;
          // gli allegati (font, copertine) non si leggono: si ricorda solo dove sono (le copertine le legge la scheda)
          if (id === ID.ALLEGATI) { if (!m.allegati) m.allegati = { da: datiDa, a: datiA }; poi(); return; }
          if (!LIMITI[id] || datiA - datiDa > LIMITI[id]) { poi(); return; }
          leggi(fs, fd, datiDa, datiA - datiDa, sicuro(function (err2, b) {
            if (err2) { poi(err2); return; }
            if (id === ID.SEEKHEAD) {
              figli(b, 0, b.length, function (id2, a2, z2) {
                if (id2 !== ID.SEEK) return;
                var sid = 0, sp = -1;
                figli(b, a2, z2, function (id3, a3, z3) {
                  if (id3 === ID.SEEKID) sid = uint(b, a3, z3 - a3);
                  else if (id3 === ID.SEEKPOS) sp = uint(b, a3, z3 - a3);
                });
                if (sid && sp >= 0 && m.seek[sid] === undefined) m.seek[sid] = m.segDati + sp;
                else if (sid === ID.SEEKHEAD && sp >= 0) m.seek2 = m.segDati + sp; // un secondo SeekHead (di solito in fondo)
              });
            } else if (id === ID.INFO) {
              figli(b, 0, b.length, function (id2, a2, z2) {
                if (id2 === ID.SCALA) m.scala = uint(b, a2, z2 - a2) || 1000000;
                else if (id2 === ID.DURATA) m.durataGrezza = float(b, a2, z2 - a2);
                else if (id2 === ID.TITOLO) m.titolo = stringa(b, a2, z2 - a2).slice(0, 200);
              });
            } else if (id === ID.TRACKS) {
              m.tracksDati = datiDa;
              m.tracksFine = datiA;
              figli(b, 0, b.length, function (id2, a2, z2, i2) {
                if (id2 === ID.ENTRY) { if (m.tracce.length >= 128) return false; m.tracce.push(traccia(b, a2, z2, datiDa + i2)); }
                else if (id2 === ID.CRC) m.crcTracks = datiDa + i2;
              });
            } else if (id === ID.CHAPTERS) {
              m.capitoliGrezzi = { b: b };
            } else if (id === ID.CUES) {
              cuesDiAFette(b, m.segDati, function (cues) { m.cues = cues; poi(); });
              return;
            } else if (id === ID.TAGS) {
              m.tag = tagDi(b);
            }
            poi();
          }));
        }

        function prossimo() {
          if (pos >= m.segFine || ++giri > 4000) { fine(); return; }
          leggi(fs, fd, pos, 16, sicuro(function (err2, h) {
            if (err2) { cb(err2); return; }
            var hi = leggiId(h, 0), hd = hi && hi.id > 0 ? leggiVint(h, hi.n) : null;
            if (!hd || hd.rotto) { fine(); return; }
            var datiDa = pos + hi.n + hd.n, datiA = hd.ignota ? m.segFine : datiDa + hd.v, inizio = pos;
            if (hi.id === ID.CLUSTER) { m.cluster1 = inizio; fine(); return; }
            if (hi.id !== ID.VOID && hi.id !== ID.CRC) m.altri.push(inizio);
            if (hd.ignota) { fine(); return; }
            pos = datiA;
            elemento(hi.id, inizio, datiDa, datiA, function (err3) { if (err3) { cb(err3); return; } prossimo(); });
          }));
        }

        // dopo il primo Cluster: un secondo SeekHead, poi Cues e capitoli se stanno in fondo
        function fine() {
          var da = [];
          if (m.seek2 && m.seek2 > pos) da.push(m.seek2);
          dopo(da, function () {
            var resto = [];
            if (!m.cues && m.seek[ID.CUES] > 0) resto.push(m.seek[ID.CUES]);
            if (!m.capitoliGrezzi && m.seek[ID.CHAPTERS] > 0) resto.push(m.seek[ID.CHAPTERS]);
            if (!m.tag && m.seek[ID.TAGS] > 0) resto.push(m.seek[ID.TAGS]);
            if (!m.allegati && m.seek[ID.ALLEGATI] > 0) resto.push(m.seek[ID.ALLEGATI]);
            dopo(resto, chiudi);
          });
        }
        function dopo(posizioni, poi) {
          if (!posizioni.length) { poi(); return; }
          var p = posizioni.shift();
          leggi(fs, fd, p, 16, sicuro(function (err2, h) {
            if (err2) { poi(); return; }
            var hi = leggiId(h, 0), hd = hi && hi.id > 0 ? leggiVint(h, hi.n) : null;
            if (!hd || hd.rotto || hd.ignota) { dopo(posizioni, poi); return; }
            if (m.altri.indexOf(p) === -1) m.altri.push(p);
            elemento(hi.id, p, p + hi.n + hd.n, p + hi.n + hd.n + hd.v, function () { dopo(posizioni, poi); });
          }));
        }
        function chiudi() {
          if (m.durataGrezza) m.durata = m.durataGrezza * m.scala / 1e9;
          if (m.capitoliGrezzi) {
            var cb2 = m.capitoliGrezzi.b;
            m.capitoli = capitoliDi(cb2, 0, cb2.length, m.scala);
            delete m.capitoliGrezzi;
          }
          // i confini da cui si puo' ripartire a leggere: i Cluster (dalle Cues) e gli altri elementi di primo livello
          var c = m.altri.slice(0, 1000), sott = {}, i, j;
          if (m.cluster1 > 0) c.push(m.cluster1);
          for (i = 0; i < m.tracce.length; i++) if (m.tracce[i].tipo === 17) sott[m.tracce[i].num] = true;
          if (m.cues) {
            for (var tr in m.cues) {
              if (!Object.prototype.hasOwnProperty.call(m.cues, tr)) continue;
              var l = m.cues[tr];
              for (i = 0; i < l.length; i++) c.push(l[i].cl);
              // nelle Cues restano solo le tracce di sottotitoli (le legge daCues): i Cluster sono gia' nei confini
              if (!sott[tr]) delete m.cues[tr];
            }
          }
          c.sort(function (x, y) { return x - y; });
          m.confini = [];
          for (j = 0; j < c.length && m.confini.length < MAX_CONFINI; j++) if (!j || c[j] !== c[j - 1]) m.confini.push(c[j]);
          cb(null, m);
        }

        prossimo();
      }));
    }

    /* ============================================================ MP4 e MOV */

    function apriMp4(fs, fd, dim, cb0) {
      var pos = 0, giri = 0, moov = null, moovPos = -1, finito = false;
      function cb(e, m) { if (!finito) { finito = true; cb0(e, m); } }
      (function giro() {
        if (pos + 8 > dim || ++giri > 1000) { fatto(); return; }
        leggi(fs, fd, pos, 16, function (err, h) {
          if (err) { cb(err); return; }
          if (h.length < 8) { fatto(); return; }
          var size = h.readUInt32BE(0), tipo = h.toString('binary', 4, 8), testa = 8;
          if (size === 1) { if (h.length < 16) { fatto(); return; } size = uint(h, 8, 8); testa = 16; } else if (size === 0) size = dim - pos;
          if (!(size >= testa)) { fatto(); return; }
          if (tipo === 'moov') {
            if (size > (64 << 20)) { cb(errore('formato', 'indice MP4 troppo grande')); return; }
            leggi(fs, fd, pos, size, function (err2, b) {
              if (err2) { cb(err2); return; }
              moov = b; moovPos = pos;
              fatto();
            });
            return;
          }
          pos += size;
          giro();
        });
      })();
      function fatto() {
        if (!moov) { cb(errore('formato', 'MP4 senza indice (moov)')); return; }
        var m = { formato: 'mp4', dim: dim, durata: 0, titolo: '', tracce: [], capitoli: [], fisse: [], ilst: {}, covr: [] };
        try {
          riquadri(moov, 8, moov.length, function (tipo, a, z, i) {
            if (tipo === 'mvhd' && z - a >= (moov[a] === 1 ? 32 : 20)) {
              var v = moov[a];
              var scala = v === 1 ? moov.readUInt32BE(a + 20) : moov.readUInt32BE(a + 12);
              var dur = v === 1 ? uint(moov, a + 24, 8) : moov.readUInt32BE(a + 16);
              if (scala) m.durata = dur / scala;
            } else if (tipo === 'trak' && m.tracce.length < 64) {
              var t = trakDi(moov, a, z);
              t.inizio = moovPos + i; // il riquadro "trak": 4 byte dopo c'e' il suo nome, che diventa "free"
              m.tracce.push(t);
            } else if (tipo === 'udta') {
              ilstDi(moov, a, z, moovPos, m);
            }
          });
        } catch (e) { cb(errore('formato', 'MP4 rovinato')); return; } // un file fatto male non ferma il servizio
        cb(null, m);
      }
    }
    // i tag di iTunes: udta > meta > ilst > voce > data (testo, numero o immagine)
    var ILST = { '\u00a9nam': 'titolo', '\u00a9day': 'data', desc: 'desc', ldes: 'ldes', '\u00a9gen': 'genere', tvsh: 'serie', tvsn: 'stagione',
      tves: 'episodio', stik: 'tipo', '\u00a9ART': 'artista' };
    function ilstDi(b, s, f, base, m) {
      riquadri(b, s, f, function (t2, a2, z2) {
        if (t2 !== 'meta' || z2 - a2 < 12) return;
        // "meta" ha versione e flag (ISO) oppure no (QuickTime, dove subito dopo c'e' "hdlr")
        var da = b.toString('binary', a2 + 4, a2 + 8) === 'hdlr' ? a2 : a2 + 4;
        riquadri(b, da, z2, function (t3, a3, z3) {
          if (t3 !== 'ilst') return;
          riquadri(b, a3, z3, function (nome, a4, z4) {
            riquadri(b, a4, z4, function (t5, a5, z5) {
              if (t5 !== 'data' || z5 - a5 < 8) return;
              var tipo = b.readUInt32BE(a5) & 0xffffff, v0 = a5 + 8;
              if (nome === 'covr') {
                if ((tipo === 13 || tipo === 14) && z5 > v0 && m.covr.length < 4) m.covr.push({ pos: base + v0, n: z5 - v0 });
              } else if (ILST[nome]) {
                if (tipo === 1) m.ilst[ILST[nome]] = b.toString('utf8', v0, Math.min(z5, v0 + 8000));
                else if ((tipo === 21 || tipo === 0) && z5 > v0) m.ilst[ILST[nome]] = uint(b, v0, Math.min(4, z5 - v0));
              }
            });
          });
        });
      });
    }
    function riquadri(b, da, a, fn) {
      var i = da;
      while (i + 8 <= a) {
        var size = b.readUInt32BE(i), tipo = b.toString('binary', i + 4, i + 8), testa = 8;
        if (size === 1) { if (i + 16 > a) return; size = uint(b, i + 8, 8); testa = 16; } else if (size === 0) size = a - i;
        if (size < testa || i + size > a) return;
        if (fn(tipo, i + testa, i + size, i) === false) return;
        i += size;
      }
    }
    var MP4_TIPO = { vide: 1, soun: 2, sbtl: 17, subt: 17, text: 17, clcp: 17 };
    function trakDi(b, s, f) {
      var t = { num: 0, tipo: 0, codec: '', lingua: 'und', nome: '', predefinita: true, forzata: false, abilitata: true,
        video: null, audio: null };
      riquadri(b, s, f, function (tipo, a, z) {
        if (tipo === 'tkhd' && z - a >= (b[a] === 1 ? 24 : 16)) {
          var v = b[a];
          t.abilitata = !!(b[a + 3] & 1);
          t.num = b.readUInt32BE(a + (v === 1 ? 20 : 12));
        } else if (tipo === 'mdia') {
          riquadri(b, a, z, function (t2, a2, z2) {
            if (t2 === 'mdhd' && z2 - a2 >= (b[a2] === 1 ? 34 : 22)) {
              var v2 = b[a2], l = b.readUInt16BE(a2 + (v2 === 1 ? 32 : 20));
              t.lingua = String.fromCharCode(((l >> 10) & 31) + 96, ((l >> 5) & 31) + 96, (l & 31) + 96);
            } else if (t2 === 'hdlr' && z2 - a2 >= 12) {
              t.tipo = MP4_TIPO[b.toString('binary', a2 + 8, a2 + 12)] || 0;
            } else if (t2 === 'minf') {
              trovaStsd(b, a2, z2, t);
            }
          });
        }
      });
      return t;
    }
    function trovaStsd(b, s, f, t) {
      riquadri(b, s, f, function (tipo, a, z) {
        if (tipo === 'stbl') { trovaStsd(b, a, z, t); return; }
        if (tipo !== 'stsd' || z - a < 16) return;
        var e = a + 8; // versione, flag, numero di voci
        if (e + 8 > z) return;
        t.codec = b.toString('binary', e + 4, e + 8);
        if (t.tipo === 1 && e + 36 <= z) t.video = { largh: b.readUInt16BE(e + 32), alt: b.readUInt16BE(e + 34), trasf: 0, bit: 0 };
        if (t.tipo === 2 && e + 34 <= z) t.audio = { canali: b.readUInt16BE(e + 24), freq: b.readUInt16BE(e + 32) };
      });
    }

    /* ============================================================ cosa legge il TV */

    // I codec che il <video> del TV legge. Il servizio li riceve dal profilo del TV (profilo.js); questi sono quelli dei
    // Samsung 2018-2022 (niente DTS, niente TrueHD; FLAC nel video parte in ritardo).
    var LETTI = {
      audio: { AC3: true, EAC3: true, AAC: true, MP3: true, MP2: true, PCM: true, OPUS: true, VORBIS: true, FLAC: 'ultimo' },
      video: { HEVC: true, AVC: true, AV1: true, VP9: true, VP8: true, MPEG2: true, MPEG4: true, VC1: true }
    };
    // il nome del codec per l'app e per decidere: da CodecID (MKV) o dal nome del riquadro (MP4)
    function famiglia(codec) {
      var c = String(codec || '');
      if (/^A_EAC3|^ec-3$/.test(c)) return 'EAC3';
      if (/^A_AC3|^ac-3$/.test(c)) return 'AC3';
      if (/^A_TRUEHD|^A_MLP|^mlpa$/.test(c)) return 'TRUEHD';
      if (/^A_DTS|^dts[chlex]$/.test(c)) return 'DTS';
      if (/^A_AAC|^mp4a$/.test(c)) return 'AAC';
      if (/^A_MPEG\/L3$/.test(c)) return 'MP3';
      if (/^A_MPEG\/L[12]$/.test(c)) return 'MP2';
      if (/^A_PCM|^(ipcm|lpcm|twos|sowt)$/.test(c)) return 'PCM';
      if (/^A_FLAC|^fLaC$/.test(c)) return 'FLAC';
      if (/^A_OPUS|^Opus$/.test(c)) return 'OPUS';
      if (/^A_VORBIS/.test(c)) return 'VORBIS';
      if (/^A_ALAC|^alac$/.test(c)) return 'ALAC';
      if (/^V_MPEGH\/ISO\/HEVC|^(hvc1|hev1|dvh1|dvhe)$/.test(c)) return 'HEVC';
      if (/^V_MPEG4\/ISO\/AVC|^(avc1|avc3|dva1|dvav)$/.test(c)) return 'AVC';
      if (/^V_AV1|^av01$/.test(c)) return 'AV1';
      if (/^V_VP9|^vp09$/.test(c)) return 'VP9';
      if (/^V_VP8|^vp08$/.test(c)) return 'VP8';
      if (/^V_MPEG2|^mp2v$/.test(c)) return 'MPEG2';
      if (/^V_MPEG4\/ISO\/(ASP|SP|AP)|^mp4v$/.test(c)) return 'MPEG4';
      if (/^V_MS\/VFW/.test(c)) return 'VFW';
      if (/^S_TEXT\/UTF8|^S_TEXT\/ASCII/.test(c)) return 'SRT';
      if (/^S_TEXT\/(ASS|SSA)|^S_(ASS|SSA)$/.test(c)) return 'ASS';
      if (/^S_TEXT\/WEBVTT|^wvtt$/.test(c)) return 'VTT';
      if (/^S_HDMV\/PGS/.test(c)) return 'PGS';
      if (/^S_VOBSUB/.test(c)) return 'VOBSUB';
      if (/^tx3g$/.test(c)) return 'TX3G';
      return c || '?';
    }
    var NOMI = { EAC3: 'Dolby Digital Plus', AC3: 'Dolby Digital', TRUEHD: 'Dolby TrueHD', DTS: 'DTS', AAC: 'AAC',
      MP3: 'MP3', MP2: 'MPEG audio', PCM: 'PCM', FLAC: 'FLAC', OPUS: 'Opus', VORBIS: 'Vorbis', ALAC: 'ALAC', HEVC: 'HEVC',
      AVC: 'H.264', AV1: 'AV1', VP9: 'VP9', VP8: 'VP8', MPEG2: 'MPEG-2', MPEG4: 'MPEG-4', VFW: 'Video per Windows',
      SRT: 'Testo', ASS: 'Testo (ASS)', VTT: 'Testo (WebVTT)', PGS: 'Immagini (PGS)', VOBSUB: 'Immagini (DVD)', TX3G: 'Testo' };

    // le lingue: codici ISO 639-2 (ita, eng, ger/deu...) o BCP 47 (it, en-US) -> tre lettere
    var LINGUE2 = { it: 'ita', en: 'eng', de: 'ger', fr: 'fre', es: 'spa', pt: 'por', ja: 'jpn', zh: 'chi', ru: 'rus',
      nl: 'dut', sv: 'swe', pl: 'pol', ko: 'kor', ar: 'ara', tr: 'tur', el: 'gre', da: 'dan', fi: 'fin', no: 'nor',
      nb: 'nor', cs: 'cze', hu: 'hun', ro: 'rum', he: 'heb', hi: 'hin', th: 'tha', uk: 'ukr' };
    var SINONIMI = { deu: 'ger', fra: 'fre', zho: 'chi', nld: 'dut', ces: 'cze', ron: 'rum', ell: 'gre', nob: 'nor' };
    function lingua(t) {
      var l = String(t.bcp47 || '').toLowerCase().split('-')[0];
      if (l && LINGUE2[l]) return LINGUE2[l];
      l = String(t.lingua || '').toLowerCase();
      if (LINGUE2[l]) return LINGUE2[l];
      return SINONIMI[l] || l || 'und';
    }

    // quale traccia audio far sentire: tra quelle che il TV legge, la lingua preferita, poi quella predefinita, poi
    // non commento, poi piu' canali, poi l'ordine del file
    function sceltaAudio(audio, lingue, letti) {
      var buoni = [];
      for (var i = 0; i < audio.length; i++) {
        var a = audio[i];
        var l = letti.audio[famiglia(a.codec)];
        if (a.abilitata !== false && l && !a.cifrata) buoni.push({ t: a, i: i, ultimo: l === 'ultimo' ? 1 : 0 });
      }
      if (!buoni.length) return null;
      function posto(x) { var k = lingue.indexOf(lingua(x.t)); return k === -1 ? 99 : k; }
      buoni.sort(function (x, y) {
        return (x.ultimo - y.ultimo) || (posto(x) - posto(y)) || ((y.t.predefinita ? 1 : 0) - (x.t.predefinita ? 1 : 0)) ||
          ((x.t.commento ? 1 : 0) - (y.t.commento ? 1 : 0)) || (((y.t.audio || {}).canali || 0) - ((x.t.audio || {}).canali || 0)) ||
          (x.i - y.i);
      });
      return buoni[0].t;
    }

    // le scelte per servire il file: il primo video, l'audio scelto (o il migliore), niente sottotitoli (li disegna
    // l'app). nascoste = numeri delle tracce da far sparire
    function piano(m, scelte, letti) {
      scelte = scelte || {};
      var lingue = Array.isArray(scelte.lingue) && scelte.lingue.length ? scelte.lingue : ['ita', 'eng'];
      var video = null, audio = [], i;
      for (i = 0; i < m.tracce.length; i++) {
        var t = m.tracce[i];
        if (t.tipo === 1 && !video && t.abilitata !== false) video = t;
        else if (t.tipo === 2) audio.push(t);
      }
      var scelta = null;
      if (scelte.audio) {
        for (i = 0; i < audio.length; i++) if (audio[i].num === +scelte.audio && letti.audio[famiglia(audio[i].codec)]) scelta = audio[i];
      }
      if (!scelta) scelta = sceltaAudio(audio, lingue, letti);
      var nascoste = {}, quante = 0;
      for (i = 0; i < m.tracce.length; i++) {
        var x = m.tracce[i];
        if (x !== video && x !== scelta) { nascoste[x.num] = true; quante++; }
      }
      return { video: video ? video.num : 0, audio: scelta ? scelta.num : 0, nascoste: nascoste, quante: quante,
        senzaAudio: !scelta && audio.length > 0 };
    }

    // le modifiche fisse (sempre agli stessi indirizzi): le TrackEntry nascoste (e il CRC dei Tracks) nel MKV, i "trak"
    // nascosti nell'MP4. [{ pos, byte }] in ordine
    function modificheFisse(m, p) {
      var out = [], i;
      if (m.formato === 'mp4') {
        for (i = 0; i < m.tracce.length; i++) {
          if (!p.nascoste[m.tracce[i].num] || m.tracce[i].inizio === undefined) continue;
          var q = m.tracce[i].inizio + 4; // "trak" -> "free"
          out.push({ pos: q, byte: 0x66 }, { pos: q + 1, byte: 0x72 }, { pos: q + 2, byte: 0x65 }, { pos: q + 3, byte: 0x65 });
        }
      } else {
        for (i = 0; i < m.tracce.length; i++) if (p.nascoste[m.tracce[i].num]) out.push({ pos: m.tracce[i].inizio, byte: ID.VOID });
        if (p.quante && m.crcTracks >= 0) out.push({ pos: m.crcTracks, byte: ID.VOID });
      }
      out.sort(function (x, y) { return x.pos - y.pos; });
      return out;
    }

    /* ============================================================ la lettura dei Cluster mentre il file passa
     * Una macchina a stati che riceve i byte in ordine dal primo Cluster in poi (o da un confine noto), riconosce i
     * blocchi, dice quali byte cambiare (l'ID dei blocchi delle tracce nascoste -> Void) e raccoglie i sottotitoli.
     * mangia(b, pos) -> { usati, modifiche: [pos] }: i byte dopo "usati" non sono ancora decisi (un'intestazione a meta')
     * e vanno ridati insieme ai prossimi. */
    function Scansione(m, nascoste, sottoTracce, suSotto, suConfine) {
      this.m = m;
      this.nascoste = nascoste || {};
      this.cambia = false;
      for (var k in this.nascoste) if (Object.prototype.hasOwnProperty.call(this.nascoste, k)) { this.cambia = true; break; }
      this.sotto = sottoTracce || {};
      this.suSotto = suSotto || null;
      this.suConfine = suConfine || null;
      this.stato = 'su'; // su = primo livello, cl = dentro un Cluster
      this.clFine = 0;
      this.clTempo = 0;
      this.salta = 0;
      this.presa = null;
      this.ferma = false;
    }
    Scansione.prototype.mangia = function (b, pos) {
      var mod = [], i = 0, n = b.length, id, d, ds, giri = 0, t0 = Date.now(), fermata = false;
      while (i < n) {
        // a fette: dopo 15 ms ci si ferma qui (un confine pulito); i byte da "i" in poi si ridanno al giro dopo
        if (++giri % 512 === 0 && Date.now() - t0 > 15) { fermata = true; break; }
        if (this.ferma) { i = n; break; }
        if (this.salta > 0) { var s = Math.min(this.salta, n - i); i += s; this.salta -= s; continue; }
        if (this.presa) {
          var q = Math.min(this.presa.manca, n - i);
          this.presa.parti.push(copia(b.slice(i, i + q)));
          this.presa.manca -= q;
          i += q;
          if (!this.presa.manca) this.finePresa();
          continue;
        }
        if (this.stato === 'cl' && pos + i >= this.clFine) { this.stato = 'su'; continue; }
        id = leggiId(b, i);
        if (!id) break;
        if (id.id < 0) { this.ferma = true; i = n; break; }
        d = leggiVint(b, i + id.n);
        if (!d) break;
        if (d.rotto) { this.ferma = true; i = n; break; }
        ds = i + id.n + d.n;
        if (this.stato === 'su') {
          if (id.id === ID.CLUSTER) {
            this.stato = 'cl';
            this.clFine = d.ignota ? Infinity : pos + ds + d.v;
            this.clTempo = 0;
            if (this.suConfine) this.suConfine(pos + i);
            i = ds;
            continue;
          }
          if (d.ignota) { this.ferma = true; i = n; break; }
          this.salta = d.v;
          i = ds;
          continue;
        }
        // dentro un Cluster
        if (this.clFine === Infinity && PRIMO_LIVELLO[id.id]) { this.stato = 'su'; continue; }
        if (d.ignota) { this.ferma = true; i = n; break; }
        if (id.id === ID.TEMPO) {
          if (ds + d.v > n) break;
          this.clTempo = uint(b, ds, d.v);
          i = ds + d.v;
          continue;
        }
        if (id.id === ID.SIMPLE || id.id === ID.GRUPPO) {
          // il numero della traccia: all'inizio del blocco (nel BlockGroup dentro il primo figlio, il Block)
          var num = -1, at = ds, attendi = false;
          if (id.id === ID.GRUPPO) {
            var gi = leggiId(b, ds), gd = gi && gi.id > 0 ? leggiVint(b, ds + gi.n) : null;
            if (!gi || !gd) { if (n - i < 64) attendi = true; at = -1; }
            else if (gi.id !== ID.BLOCCO) at = -1;
            else at = ds + gi.n + gd.n;
          }
          if (at >= 0 && !attendi) {
            var tv = leggiVint(b, at);
            if (tv && !tv.rotto && at + tv.n + 3 <= n) num = tv.v;
            else if (n - i < 64) attendi = true; // mancano pochi byte: si aspettano i prossimi
          }
          if (attendi) break;
          if (num > 0 && this.nascoste[num]) mod.push(pos + i);
          if (num > 0 && this.sotto[num] && this.suSotto && d.v <= (famiglia(this.sotto[num].codec) === 'PGS' ? MAX_GONFIO_PGS : MAX_GONFIO_TESTO)) {
            this.presa = { num: num, gruppo: id.id === ID.GRUPPO, manca: d.v, parti: [], tempo: this.clTempo };
            i = ds;
            continue;
          }
          this.salta = d.v;
          i = ds;
          continue;
        }
        if (id.id === ID.CRC && this.cambia) mod.push(pos + i);
        this.salta = d.v;
        i = ds;
      }
      return { usati: i, modifiche: mod, fermata: fermata };
    };
    // un blocco di sottotitoli intero: tempo, durata, dati (decompressi)
    Scansione.prototype.finePresa = function () {
      var p = this.presa;
      this.presa = null;
      var b = p.parti.length === 1 ? p.parti[0] : Buffer.concat(p.parti), blocco = b, durata = -1;
      if (p.gruppo) {
        blocco = null;
        figli(b, 0, b.length, function (id, a, z) {
          if (id === ID.BLOCCO) blocco = b.slice(a, z);
          else if (id === ID.DURATA_BLOCCO) durata = uint(b, a, z - a);
        });
        if (!blocco) return;
      }
      var tv = leggiVint(blocco, 0);
      if (!tv || tv.n + 3 > blocco.length) return;
      var rel = blocco.readInt16BE(tv.n), dati = blocco.slice(tv.n + 3);
      var scala = this.m.scala / 1e6;
      this.suSotto(p.num, { t: Math.round((p.tempo + rel) * scala), d: durata >= 0 ? Math.round(durata * scala) : -1, dati: dati });
    };

    /* ============================================================ sottotitoli: testo, ASS, SRT, WebVTT */

    // Windows-1252 (molti .srt italiani): i byte 0x80-0x9f hanno caratteri propri
    var CP1252 = [0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0, 0x17d, 0,
      0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178];
    function utf8Buono(b) {
      for (var i = 0; i < b.length; i++) {
        var c = b[i];
        if (c < 0x80) continue;
        var n = c >= 0xc2 && c < 0xe0 ? 1 : c >= 0xe0 && c < 0xf0 ? 2 : c >= 0xf0 && c < 0xf5 ? 3 : -1;
        if (n < 0 || i + n >= b.length) return false;
        for (var k = 1; k <= n; k++) if ((b[i + k] & 0xc0) !== 0x80) return false;
        i += n;
      }
      return true;
    }
    function testoDi(b) {
      if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.slice(3);
      if (utf8Buono(b)) return b.toString('utf8');
      var out = [], parte = [];
      for (var i = 0; i < b.length; i++) {
        var c = b[i];
        parte.push(c >= 0x80 && c < 0xa0 && CP1252[c - 0x80] ? CP1252[c - 0x80] : c);
        if (parte.length === 8192) { out.push(String.fromCharCode.apply(null, parte)); parte = []; }
      }
      if (parte.length) out.push(String.fromCharCode.apply(null, parte));
      return out.join('');
    }
    // un evento di testo per la pagina: righe senza i comandi di stile; in alto se l'ASS lo chiede (\an7-9); corsivo.
    // Un solo giro in avanti sui blocchi {...} con indexOf: un file fatto apposta, con tanti "{" senza "}", non ferma il
    // servizio (un "{" senza "}" chiude la ricerca)
    function testoAss(t) {
      t = String(t).slice(0, 4000);
      var out = '', i = 0, su = false, corsivo = false;
      while (i < t.length) {
        var a = t.indexOf('{', i);
        if (a === -1) { out += t.slice(i); break; }
        out += t.slice(i, a);
        var z = t.indexOf('}', a + 1);
        if (z === -1) break;
        var cmd = t.slice(a + 1, z);
        if (/\\an[789]/.test(cmd)) su = true;
        if (cmd.indexOf('\\i1') !== -1) corsivo = true;
        i = z + 1;
      }
      out = out.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
      return { x: pulisci(out), su: su, i: corsivo };
    }
    // SRT: i tag (<i>, <font ...>) via con lo stesso giro in avanti (un "<" senza ">" chiude la ricerca)
    function testoSrt(t) {
      t = String(t).slice(0, 4000);
      var corsivo = /^\s*<i>/i.test(t), su = /\{\\an[789]\}/.test(t), out = '', i = 0;
      while (i < t.length) {
        var a = t.indexOf('<', i);
        if (a === -1) { out += t.slice(i); break; }
        out += t.slice(i, a);
        var z = t.indexOf('>', a + 1);
        if (z === -1) break;
        i = z + 1;
      }
      return { x: pulisci(out.replace(/\{\\an\d\}/g, '')), su: su, i: corsivo };
    }
    function pulisci(t) {
      var righe = String(t).slice(0, 4000).replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').split('\n');
      for (var i = 0; i < righe.length; i++) {
        var k = righe[i].length;
        while (k > 0 && (righe[i].charCodeAt(k - 1) === 32 || righe[i].charCodeAt(k - 1) === 9)) k--;
        righe[i] = righe[i].slice(0, k);
      }
      return righe.join('\n').trim().slice(0, 600);
    }
    function tempoTesto(s) {
      var m = /(?:(\d{1,4}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(String(s).slice(0, 120));
      if (!m) return -1;
      var ms = m[4];
      while (ms.length < 3) ms += '0';
      return ((+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + +ms;
    }
    function tempoAss(s) {
      var m = /(\d{1,4}):(\d{1,2}):(\d{1,2})[.,](\d{1,2})/.exec(String(s).slice(0, 120));
      return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] * 10 : -1;
    }
    // un file di sottotitoli accanto al video (SRT, WebVTT, ASS): [{ t, d, x, su, i }]. Con cb a fette: dopo 15 ms si cede
    // il turno, al massimo 2 s di lavoro (oltre: cb(eventi, true) con quelli letti fin li')
    function leggiSottotitoli(testo, formato, cb) {
      var out = [], righe, i, pezzi, fai;
      testo = String(testo).replace(/\r\n?/g, '\n');
      if (formato === 'ass' || formato === 'ssa') {
        var campi = null;
        righe = pezzi = testo.split('\n');
        fai = function (r) {
          r = r.slice(0, 6000);
          if (/^\s*Format\s*:/i.test(r) && campi === null && /Text/i.test(r)) {
            campi = r.replace(/^\s*Format\s*:/i, '').split(',').map(function (x) { return x.trim().toLowerCase(); });
            return;
          }
          if (!/^\s*Dialogue\s*:/i.test(r)) return;
          var f = r.replace(/^\s*Dialogue\s*:\s*/i, '').split(','), c = campi || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
          var kt = c.indexOf('text'), ks = c.indexOf('start'), ke = c.indexOf('end');
          if (kt < 0 || f.length < c.length) return;
          var a = tempoAss(f[ks]), z = tempoAss(f[ke]);
          if (a < 0 || z < a) return;
          var ev = testoAss(f.slice(kt).join(','));
          if (!ev.x) return;
          ev.t = a; ev.d = z - a;
          out.push(ev);
        };
      } else {
        pezzi = testo.split(/\n\s*\n/);
        fai = function (blocco) {
          var l = blocco.split('\n'), k = 0;
          while (k < l.length && l[k].indexOf('-->') === -1) k++;
          if (k >= l.length) return;
          var tt = l[k].split('-->'), ta = tempoTesto(tt[0]), tz = tempoTesto(tt[1] || '');
          if (ta < 0 || tz < ta) return;
          var e2 = testoSrt(l.slice(k + 1).join('\n'));
          if (!e2.x) return;
          e2.t = ta; e2.d = tz - ta;
          out.push(e2);
        };
      }
      function finisci() { out.sort(function (x, y) { return x.t - y.t; }); return out; }
      if (!cb) { for (i = 0; i < pezzi.length && out.length < MAX_EVENTI; i++) fai(pezzi[i]); return finisci(); }
      var k0 = 0, spesi = 0;
      (function fetta() {
        var t0 = Date.now();
        while (k0 < pezzi.length && out.length < MAX_EVENTI && Date.now() - t0 < 15) for (var g = 0; g < 32 && k0 < pezzi.length; g++) fai(pezzi[k0++]);
        spesi += Date.now() - t0;
        if (k0 < pezzi.length && out.length < MAX_EVENTI && spesi < 2000) { setImmediate(fetta); return; }
        cb(finisci(), k0 < pezzi.length); // non letti tutti (troppi eventi o troppo lavoro): "complessi"
      })();
    }

    /* ============================================================ le schede: NFO di Kodi e Jellyfin, immagini accanto
     * I .nfo (XML) che scrivono Kodi, Jellyfin e tinyMediaManager e le immagini con i loro nomi (poster.jpg, fanart.jpg,
     * <film>-poster.jpg, clearlogo.png, season01-poster.jpg, .actors/Nome_Cognome.jpg). Niente internet. */

    var EST_IMG = /\.(jpe?g|png|tbn|webp)$/i;
    var MAX_NFO = 128 << 10, MAX_IMG = 8 << 20, MAX_PIXEL = 12000000, MAX_LATO = 4096;
    function entita(s) {
      return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, function (m, e) {
        var l = e.toLowerCase();
        if (l === 'amp') return '&';
        if (l === 'lt') return '<';
        if (l === 'gt') return '>';
        if (l === 'quot') return '"';
        if (l === 'apos') return '\'';
        if (l === 'nbsp') return ' ';
        var n = l.charAt(1) === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
        if (!(n > 0) || n >= 0x110000 || (n >= 0xd800 && n < 0xe000)) return '';
        return n > 0xffff ? String.fromCharCode(0xd800 + ((n - 0x10000) >> 10), 0xdc00 + ((n - 0x10000) & 1023)) : String.fromCharCode(n);
      });
    }
    // il testo di un pezzo di XML: i CDATA cosi' come sono, il resto senza tag e con le entita'. Si legge in avanti con
    // indexOf (tempo lineare): un .nfo fatto apposta, con tanti "<" o "<![CDATA[" senza chiusura, non ferma il servizio
    function testoXml(x) {
      var out = '', i = 0, n = x.length;
      while (i < n) {
        var lt = x.indexOf('<', i);
        if (lt === -1) { out += entita(x.slice(i)); break; }
        out += entita(x.slice(i, lt));
        if (x.substr(lt, 9) === '<![CDATA[') {
          var fine = x.indexOf(']]>', lt + 9);
          if (fine === -1) { out += x.slice(lt + 9); break; }
          out += x.slice(lt + 9, fine);
          i = fine + 3;
        } else {
          var gt = x.indexOf('>', lt + 1);
          if (gt === -1) break; // un tag senza chiusura: il resto non e' testo
          i = gt + 1;
        }
      }
      return out.trim();
    }
    // i <tag ...>...</tag> dentro x (anche <tag/>): [{ a: attributi, x: contenuto }]. In avanti con indexOf: un tag senza
    // chiusura ferma la ricerca (non si riprova da ogni "<")
    function tagXml(x, tag, max) {
      var out = [], apre = '<' + tag, chiude = '</' + tag, i = 0;
      max = max || 200;
      while (out.length < max) {
        var a = x.indexOf(apre, i);
        if (a === -1) break;
        var c = x.charAt(a + apre.length);
        if (c !== '>' && c !== '/' && c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') { i = a + apre.length; continue; }
        var gt = x.indexOf('>', a + apre.length);
        if (gt === -1) break;
        var attr = x.slice(a + apre.length, Math.min(gt, a + apre.length + 2000));
        if (x.charAt(gt - 1) === '/') { out.push({ a: attr.slice(0, -1), x: '' }); i = gt + 1; continue; }
        var z = x.indexOf(chiude, gt + 1);
        if (z === -1) break;
        out.push({ a: attr, x: x.slice(gt + 1, z) });
        var gz = x.indexOf('>', z + chiude.length);
        i = gz === -1 ? x.length : gz + 1;
      }
      return out;
    }
    function primoXml(x, tag, max) { var l = tagXml(x, tag, 1); return l.length ? testoXml(l[0].x).slice(0, max || 300) : ''; }
    function attrXml(a, nome) {
      var m = new RegExp('\\b' + nome + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(a);
      return m ? entita(m[1] !== undefined ? m[1] : m[2]) : '';
    }
    function elencoXml(x, tag, max, lung) {
      var out = [];
      tagXml(x, tag, max * 2).forEach(function (y) {
        testoXml(y.x).split(/[\/|]/).forEach(function (z) { z = z.trim(); if (z && out.length < max && out.indexOf(z) === -1) out.push(z.slice(0, lung)); });
      });
      return out;
    }
    // un .nfo: film (<movie>), serie (<tvshow>), puntata (<episodedetails>, la prima se sono piu' d'una). null = non e' un .nfo
    // vero (per esempio solo l'indirizzo di IMDb)
    function leggiNfo(t) {
      t = String(t || '');
      var r = /<(movie|tvshow|episodedetails|musicvideo)[\s>\/]/.exec(t);
      if (!r) return null;
      var dentro = tagXml(t, r[1], 1)[0], x = dentro ? dentro.x : t, tipo = r[1].toLowerCase();
      var n = { tipo: tipo === 'tvshow' ? 'serie' : tipo === 'episodedetails' ? 'puntata' : 'film',
        titolo: primoXml(x, 'title', 200), originale: primoXml(x, 'originaltitle', 200), serie: primoXml(x, 'showtitle', 200),
        anno: +primoXml(x, 'year', 8) || 0, trama: primoXml(x, 'plot', 4000) || primoXml(x, 'outline', 4000), slogan: primoXml(x, 'tagline', 300),
        durata: +primoXml(x, 'runtime', 8) || 0, classificazione: primoXml(x, 'mpaa', 40) || primoXml(x, 'certification', 40),
        generi: elencoXml(x, 'genre', 8, 50), studi: elencoXml(x, 'studio', 4, 80), registi: elencoXml(x, 'director', 4, 80),
        scrittori: elencoXml(x, 'credits', 4, 80), paesi: elencoXml(x, 'country', 3, 60),
        uscita: primoXml(x, 'premiered', 20) || primoXml(x, 'aired', 20) || primoXml(x, 'releasedate', 20),
        stagione: -1, episodio: -1, voto: 0, collezione: '', cast: [] };
      if (!n.anno && /^\d{4}/.test(n.uscita)) n.anno = +n.uscita.slice(0, 4);
      if (n.tipo === 'puntata') {
        var st = primoXml(x, 'season', 6), ep = primoXml(x, 'episode', 6);
        if (/^\d+$/.test(st)) n.stagione = +st;
        if (/^\d+$/.test(ep)) n.episodio = +ep;
      }
      // il voto: <ratings><rating default="true"><value>, oppure <rating> (i .nfo vecchi); sempre su 10
      var voti = tagXml(x, 'rating', 10), vv = 0;
      for (var i = 0; i < voti.length; i++) {
        var val = parseFloat(primoXml(voti[i].x, 'value', 10) || testoXml(voti[i].x)), mx = parseFloat(attrXml(voti[i].a, 'max')) || 10;
        if (val > 0 && mx > 0 && (!vv || /true/i.test(attrXml(voti[i].a, 'default')))) vv = Math.min(10, val * 10 / mx);
      }
      n.voto = Math.round(vv * 10) / 10;
      var set = tagXml(x, 'set', 1)[0];
      if (set) n.collezione = (primoXml(set.x, 'name', 120) || testoXml(set.x)).slice(0, 120);
      var attori = tagXml(x, 'actor', 60);
      for (var k = 0; k < attori.length && n.cast.length < 30; k++) {
        var nome = primoXml(attori[k].x, 'name', 80);
        if (nome) n.cast.push({ nome: nome, ruolo: primoXml(attori[k].x, 'role', 80), ordine: +primoXml(attori[k].x, 'order', 6) || k });
      }
      n.cast.sort(function (a, b) { return a.ordine - b.ordine; });
      n.cast.forEach(function (c) { delete c.ordine; });
      return n;
    }
    // le immagini accanto, coi nomi di Kodi, Jellyfin e tinyMediaManager. base: il nome del video senza estensione ('' per
    // quelle della cartella); cartella: la cartella e' tutta di questo video (o e' una serie); puntata: "Video.jpg" e'
    // la miniatura della puntata (16:9), non il poster
    var NOMI_IMG = { poster: ['poster', 'folder', 'cover', 'default', 'movie', 'show'], fanart: ['fanart', 'backdrop', 'background', 'art'],
      logo: ['clearlogo', 'logo'], landscape: ['landscape', 'thumb'], banner: ['banner'], disco: ['discart', 'disc'] };
    function immaginiDi(nomi, base, cartella, puntata) {
      var idx = {}, out = {}, b = String(base || '').toLowerCase(), i;
      for (i = 0; i < nomi.length; i++) if (EST_IMG.test(nomi[i])) idx[nomi[i].toLowerCase().replace(/\.[a-z0-9]+$/, '')] = nomi[i];
      for (var tipo in NOMI_IMG) {
        if (!Object.prototype.hasOwnProperty.call(NOMI_IMG, tipo)) continue;
        var l = NOMI_IMG[tipo];
        for (var k = 0; k < l.length && !out[tipo]; k++) {
          if (b && idx[b + '-' + l[k]]) out[tipo] = idx[b + '-' + l[k]];
          else if (b && idx[b + '.' + l[k]]) out[tipo] = idx[b + '.' + l[k]];
          else if (cartella && idx[l[k]]) out[tipo] = idx[l[k]];
        }
      }
      if (b && idx[b]) { if (puntata) out.landscape = out.landscape || idx[b]; else out.poster = out.poster || idx[b]; }
      return out;
    }
    // le misure di un'immagine dai primi byte, senza decodificarla: { w, h, tipo } o null
    function misureImg(b) {
      if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), tipo: 'image/png' };
      if (b.length >= 30 && b.toString('binary', 0, 4) === 'RIFF' && b.toString('binary', 8, 12) === 'WEBP') {
        var c = b.toString('binary', 12, 16);
        if (c === 'VP8X') return { w: 1 + (b[24] | b[25] << 8 | b[26] << 16), h: 1 + (b[27] | b[28] << 8 | b[29] << 16), tipo: 'image/webp' };
        if (c === 'VP8 ') return { w: (b[26] | b[27] << 8) & 0x3fff, h: (b[28] | b[29] << 8) & 0x3fff, tipo: 'image/webp' };
        if (c === 'VP8L') return { w: 1 + (b[21] | (b[22] & 0x3f) << 8), h: 1 + ((b[22] >> 6) | b[23] << 2 | (b[24] & 0x0f) << 10), tipo: 'image/webp' };
        return null;
      }
      if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
        var i = 2;
        while (i + 9 < b.length) {
          if (b[i] !== 0xff) { i++; continue; }
          var mk = b[i + 1];
          if (mk === 0xff) { i++; continue; }
          if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
          if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), tipo: 'image/jpeg' };
          i += 2 + b.readUInt16BE(i + 2);
        }
      }
      return null;
    }
    function buonaMisura(mi) { return !!mi && mi.w > 0 && mi.h > 0 && mi.w <= MAX_LATO && mi.h <= MAX_LATO && mi.w * mi.h <= MAX_PIXEL; }
    // dal nome del file: titolo, anno, stagione e puntata (lo stesso ordine dell'app)
    var TECNICI = /^(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hd|fhd|bluray|blu|ray|bdrip|brrip|bdremux|remux|webrip|webdl|web|dl|hdtv|dvdrip|hdrip|x264|x265|h264|h265|hevc|avc|av1|vp9|hdr|hdr10|hdr10plus|dv|dovi|sdr|truehd|atmos|dts|dtshd|ma|ddp|dd|dd5|ac3|eac3|aac|flac|lpcm|ita|eng|multi|sub|subs|subita|proper|repack|extended|uncut|imax|internal|limited|10bit|8bit)$/i;
    function dalNome(nome) {
      var base = String(nome || '').replace(/\.[a-z0-9]{2,4}$/i, ''), s = base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ');
      var out = { titolo: '', anno: 0, stagione: -1, episodio: -1 };
      var se = /^(.*?)[\s\-\[(]*\b[Ss](\d{1,2})[\s\-]*[Ee](\d{1,3})\b/.exec(s) || /^(.*?)[\s\-]*\b(\d{1,2})x(\d{2,3})\b/.exec(s);
      if (se) { out.stagione = +se[2]; out.episodio = +se[3]; s = se[1]; }
      else {
        var an = /^(.*?)[\s\-\[(]*\b(19[2-9]\d|20[0-4]\d)\b/.exec(s);
        if (an && an[1].replace(/\s+/g, '').length >= 2) { out.anno = +an[2]; s = an[1]; }
      }
      var parole = s.split(' '), tenute = [];
      for (var i = 0; i < parole.length; i++) { if (TECNICI.test(parole[i].replace(/[\[\]()\-]/g, ''))) break; tenute.push(parole[i]); }
      out.titolo = tenute.join(' ').replace(/[\s\-\[(]+$/, '').replace(/^\s+/, '') || base;
      return out;
    }
    var RE_STAGIONE = /^(?:season|stagione|staffel|saison|temporada|series|serie|s)[\s._-]*(\d{1,3})$|^(specials?|speciali|extra)$/i;

    /* ============================================================ la videoteca */

    var EST_VIDEO = /\.(mkv|webm|mk3d|mp4|m4v|mov|avi|ts|m2ts|mts|mpg|mpeg|wmv|asf|3gp|vob|flv|trp|tp)$/i;
    var EST_SOTTO = /\.(srt|ass|ssa|vtt)$/i;
    var NASCOSTE = /^(\.|\$recycle\.bin$|system volume information$|lost\.dir$|found\.\d+$|recycler$)/i;
    var TIPI = { mkv: 'video/x-matroska', mk3d: 'video/x-matroska', webm: 'video/webm', mp4: 'video/mp4', m4v: 'video/mp4',
      mov: 'video/quicktime', avi: 'video/x-msvideo', ts: 'video/mp2t', m2ts: 'video/mp2t', mts: 'video/mp2t', trp: 'video/mp2t',
      tp: 'video/mp2t', mpg: 'video/mpeg', mpeg: 'video/mpeg', vob: 'video/mpeg', wmv: 'video/x-ms-wmv', asf: 'video/x-ms-asf',
      '3gp': 'video/3gpp', flv: 'video/x-flv' };
    var BLOCCO = 512 * 1024, VUOTO = nuovo(0);

    function crea(o) {
      o = o || {};
      var fs = o.fs, path = o.path, zlib = o.zlib || null;
      // i codec che il TV legge: dal profilo del TV (profilo.js), che il servizio conosce strada facendo
      function lettiOra() { var x = typeof o.letti === 'function' ? o.letti() : o.letti; return x && x.audio && x.video ? x : LETTI; }
      var radici = Array.isArray(o.radici) ? o.radici : [];
      // percorso -> { dim, data, m (struttura), sotto: { num: { eventi, chiavi, byte } }, sottoAttive: { num: traccia }, usato }
      var aperti = {};
      var MAX_APERTI = 6, sottoTot = 0; // sottoTot: i byte dei sottotitoli tenuti, per tutti i file

      function radiceDi(d, cb) {
        dischi(function (err, l) {
          if (err) { cb(err); return; }
          for (var i = 0; i < l.length; i++) if (l[i].id === d) { cb(null, l[i].percorso); return; }
          cb(errore('disco', 'chiavetta non trovata'));
        });
      }
      // i dischi montati: le cartelle dentro le radici (/opt/media/USBDriveA1 sui Samsung)
      function dischi(cb) {
        var out = [], k = 0, primoErrore = null;
        (function giro() {
          if (k >= radici.length) { cb(out.length || !primoErrore ? null : primoErrore, out); return; }
          var r = radici[k++];
          fs.readdir(r, function (err, nomi) {
            if (err) { if (!primoErrore) primoErrore = errore(err.code === 'EACCES' || err.code === 'EPERM' ? 'permesso' : 'assente', err.code); giro(); return; }
            nomi = nomi.filter(function (x) { return !NASCOSTE.test(x); }).sort();
            var j = 0;
            (function stat() {
              if (j >= nomi.length) { giro(); return; }
              var nome = nomi[j++], p = path.join(r, nome);
              fs.stat(p, function (err2, st) {
                if (!err2 && st.isDirectory()) out.push({ id: nome, percorso: p });
                stat();
              });
            })();
          });
        })();
      }
      // un percorso dentro un disco, controllato: niente "..", niente vie di fuga coi collegamenti
      function risolvi(d, p, cb) {
        var parti = String(p || '').split('/').filter(function (x) { return x !== ''; });
        for (var i = 0; i < parti.length; i++) {
          if (parti[i] === '.' || parti[i] === '..' || parti[i].indexOf('\u0000') !== -1 || parti[i].indexOf('\\') !== -1) {
            cb(errore('percorso', 'percorso non valido'));
            return;
          }
        }
        radiceDi(d, function (err, radice) {
          if (err) { cb(err); return; }
          var pieno = path.join.apply(path, [radice].concat(parti));
          fs.realpath(radice, function (e1, vera) {
            if (e1) { cb(errore('disco', 'chiavetta non leggibile')); return; }
            fs.realpath(pieno, function (e2, veroP) {
              if (e2) { cb(errore(e2.code === 'EACCES' ? 'permesso' : 'assente', e2.code)); return; }
              if (veroP !== vera && veroP.indexOf(vera + path.sep) !== 0) { cb(errore('percorso', 'fuori dalla chiavetta')); return; }
              cb(null, veroP, parti);
            });
          });
        });
      }
      // ordine "naturale": E2 prima di E10
      function confrontaNomi(a, b) {
        var x = String(a).toLowerCase().match(/\d+|\D+/g) || [], y = String(b).toLowerCase().match(/\d+|\D+/g) || [];
        for (var i = 0; i < Math.min(x.length, y.length); i++) {
          if (x[i] === y[i]) continue;
          var nx = /^\d/.test(x[i]), ny = /^\d/.test(y[i]);
          if (nx && ny) return (+x[i] - +y[i]) || (x[i].length - y[i].length);
          return x[i] < y[i] ? -1 : 1;
        }
        return x.length - y.length;
      }
      function cartella(d, p, cb) {
        risolvi(d, p, function (err, dove) {
          if (err) { cb(err); return; }
          fs.readdir(dove, function (e2, nomi) {
            if (e2) { cb(errore(e2.code === 'EACCES' ? 'permesso' : 'assente', e2.code)); return; }
            nomi = nomi.filter(function (x) { return !NASCOSTE.test(x); }).slice(0, 3000);
            var out = { cartelle: [], video: [], sotto: [], troppi: nomi.length >= 3000 }, j = 0;
            (function stat() {
              if (j >= nomi.length) {
                out.cartelle.sort(function (a, b) { return confrontaNomi(a.nome, b.nome); });
                out.video.sort(function (a, b) { return confrontaNomi(a.nome, b.nome); });
                out.sotto.sort(function (a, b) { return confrontaNomi(a.nome, b.nome); });
                cb(null, out);
                return;
              }
              var nome = nomi[j++];
              fs.stat(path.join(dove, nome), function (e3, st) {
                if (!e3) {
                  if (st.isDirectory()) out.cartelle.push({ nome: nome });
                  else if (st.isFile() && EST_VIDEO.test(nome)) out.video.push({ nome: nome, dim: st.size, data: +st.mtime });
                  else if (st.isFile() && EST_SOTTO.test(nome) && st.size < (4 << 20)) out.sotto.push({ nome: nome, dim: st.size });
                }
                stat();
              });
            })();
          });
        });
      }

      // un file della chiavetta: la struttura si legge una volta sola (finche' dimensione e data non cambiano)
      function apri(d, p, cb) {
        risolvi(d, p, function (err, dove, parti) {
          if (err) { cb(err); return; }
          // solo i video: il permesso non apre documenti e foto della chiavetta
          if (!EST_VIDEO.test(dove)) { cb(errore('assente', 'non e\' un video')); return; }
          fs.stat(dove, function (e2, st) {
            if (e2 || !st.isFile()) { cb(errore('assente', 'file non trovato')); return; }
            apriF({ percorso: dove, parti: parti, nome: parti[parti.length - 1] || '', dim: st.size, data: +st.mtime }, cb);
          });
        });
      }
      // un file qualsiasi col suo "fs": quello della chiavetta, o uno remoto (il ponte verso Jellyfin legge il file vero con
      // le domande Range). x = { percorso (la chiave), nome, dim, data, est, fs }
      function apriF(x, cb) {
        var f = aperti[x.percorso];
        if (f && f.dim === x.dim && f.data === x.data && f.fs === (x.fs || fs)) { f.usato = Date.now(); cb(null, f); return; }
        var est = x.est || (/\.([a-z0-9]+)$/i.exec(x.percorso) || ['', ''])[1].toLowerCase();
        f = { percorso: x.percorso, parti: x.parti || [], nome: x.nome || '', est: est, dim: x.dim, data: x.data, fs: x.fs || fs,
          m: null, sotto: {}, usato: Date.now(), tipo: TIPI[est] || 'application/octet-stream' };
        var lettore = /^(mkv|webm|mk3d)$/.test(est) ? apriMkv : /^(mp4|m4v|mov)$/.test(est) ? apriMp4 : null;
        if (!lettore) { ricorda(f); cb(null, f); return; }
        f.fs.open(f.percorso, 'r', function (e3, fd) {
          if (e3) { cb(errore(e3.code === 'EACCES' ? 'permesso' : 'assente', e3.code)); return; }
          var finito = false;
          function letto(e4, m) {
            if (finito) return;
            finito = true;
            f.fs.close(fd, function () {});
            // la rete che si ferma (file remoto) non e' un file rovinato: non si ricorda, si riprova alla prossima domanda
            if (e4 && e4.rete) { cb(errore('rete', 'server non raggiungibile')); return; }
            if (!e4) f.m = m; else f.guasto = e4.message;
            ricorda(f);
            cb(null, f);
          }
          try { lettore(f.fs, fd, f.dim, letto); } catch (e5) { letto(errore('formato', 'file rovinato')); }
        });
      }
      function ricorda(f) {
        if (aperti[f.percorso] && aperti[f.percorso] !== f) dimenticaSotto(aperti[f.percorso], -1); // il file e' cambiato
        aperti[f.percorso] = f;
        var l = Object.keys(aperti);
        if (l.length <= MAX_APERTI) return;
        l.sort(function (a, b) { return aperti[a].usato - aperti[b].usato; });
        dimenticaSotto(aperti[l[0]], -1);
        delete aperti[l[0]];
      }

      // per l'app: tutto quello che serve per scegliere (tracce, cosa legge il TV, capitoli, avvisi)
      function info(d, p, scelte, cb) {
        apri(d, p, function (err, f) { if (err) cb(err); else infoDi(f, scelte, cb); });
      }
      function infoDi(f, scelte, cb) {
        var m = f.m, out = { nome: f.nome, dim: f.dim, data: f.data, formato: m ? m.formato : f.est, durata: m ? m.durata : 0,
          titolo: m ? m.titolo : '', video: null, audio: [], sotto: [], capitoli: m ? m.capitoli : [], avvisi: [] };
        if (!m) {
          out.avvisi.push(f.guasto ? 'struttura' : 'sconosciuto');
          cb(null, out);
          return;
        }
        var letti = lettiOra(), pi = piano(m, scelte, letti);
        for (var i = 0; i < m.tracce.length; i++) {
          // ordine: la posizione nel file (per Jellyfin, che conta le tracce cosi')
          var t = m.tracce[i], fam = famiglia(t.codec), base = { num: t.num, ordine: i, codec: fam, nomeCodec: NOMI[fam] || fam,
            lingua: lingua(t), nome: t.nome || '', predefinita: !!t.predefinita, forzata: !!t.forzata };
          if (t.tipo === 1 && t.num === pi.video) {
            var v = t.video || {};
            out.video = { num: t.num, ordine: i, codec: fam, nomeCodec: NOMI[fam] || fam, largh: v.largh || 0, alt: v.alt || 0,
              hdr: t.dv ? 'DV' : v.trasf === 16 ? 'HDR10' : v.trasf === 18 ? 'HLG' : '', dv: t.dv || null, bit: v.bit || 0,
              letto: !!letti.video[fam] };
          } else if (t.tipo === 2) {
            base.canali = (t.audio || {}).canali || 0;
            base.commento = !!t.commento;
            base.letto = !!letti.audio[fam] && !t.cifrata;
            out.audio.push(base);
          } else if (t.tipo === 17) {
            base.udito = !!t.udito;
            base.immagini = fam === 'PGS' || fam === 'VOBSUB';
            base.leggibile = fam === 'SRT' || fam === 'ASS' || fam === 'VTT' || fam === 'PGS';
            out.sotto.push(base);
          }
        }
        out.scelta = { audio: pi.audio };
        if (pi.senzaAudio) out.avvisi.push('audio');
        if (out.video && !out.video.letto) out.avvisi.push('video');
        if (out.durata > 0) out.mbps = Math.round(f.dim * 8 / out.durata / 1e5) / 10;
        cb(null, out);
      }

      function sottoTracce(f) {
        var out = {}, m = f.m;
        if (!m || m.formato === 'mp4') return out;
        for (var i = 0; i < m.tracce.length; i++) {
          var t = m.tracce[i], fam = famiglia(t.codec);
          if (t.tipo === 17 && (fam === 'SRT' || fam === 'ASS' || fam === 'VTT' || fam === 'PGS') && !t.cifrata) out[t.num] = t;
        }
        return out;
      }
      // zlib con un tetto (inflateSync non ne ha, nel Node dei TV): un blocco alla volta, cosi' mille blocchi non aprono
      // mille decompressori insieme; oltre il tetto il blocco si butta
      var coda = [], gonfiando = false, dopoGonfi = [];
      function gonfia(dati, max, cb) {
        if (!zlib || coda.length >= MAX_CODA_GONFIO) { cb(null); return; }
        coda.push({ dati: dati, max: max, cb: cb });
        if (!gonfiando) prossimoGonfio();
      }
      function prossimoGonfio() {
        var x = coda.shift();
        if (!x) {
          gonfiando = false;
          var l = dopoGonfi; dopoGonfi = [];
          for (var i = 0; i < l.length; i++) { try { l[i](); } catch (e) {} }
          return;
        }
        gonfiando = true;
        var z = null, parti = [], tot = 0, finito = false;
        function fine(r) {
          if (finito) return;
          finito = true;
          try { x.cb(r); } catch (e) {}
          setImmediate(prossimoGonfio);
        }
        try { z = zlib.createInflate(); } catch (e) { fine(null); return; }
        z.on('error', function () { fine(null); });
        z.on('data', function (c) {
          if (finito) return;
          tot += c.length;
          if (tot > x.max) { fine(null); try { z.close(); } catch (e) {} return; }
          parti.push(c);
        });
        z.on('end', function () { fine(Buffer.concat(parti, tot)); });
        z.end(x.dati);
      }
      // quando i blocchi in coda sono gonfiati (le Cues rispondono con tutti i sottotitoli letti)
      function quandoGonfiati(fn) { if (!gonfiando && !coda.length) fn(); else dopoGonfi.push(fn); }

      // un blocco di sottotitoli trovato (mentre il file passa o dalle Cues): solo per la traccia che l'app mostra
      function nuovoSotto(f, num, ev) {
        var t = f.sottoAttive ? f.sottoAttive[num] : null, c = t ? t.comp : null;
        if (!t) return;
        if (c && c.algo === 0) {
          gonfia(ev.dati, famiglia(t.codec) === 'PGS' ? MAX_GONFIO_PGS : MAX_GONFIO_TESTO, function (dati) { if (dati) aggiungiSotto(f, num, t, ev, dati); });
          return;
        }
        var dati = !c ? ev.dati : c.algo === 3 && c.dati ? unisci(c.dati, ev.dati) : null;
        if (dati) aggiungiSotto(f, num, t, ev, dati);
      }
      function pesoEv(e) { return e.pgs ? e.pgs.length + 64 : e.x.length * 2 + 64; }
      // un evento in ordine di tempo, senza doppioni; i PGS restano byte (in base64 solo quando si mandano)
      function aggiungiSotto(f, num, t, ev, dati) {
        if (!f.sottoAttive || f.sottoAttive[num] !== t || aperti[f.percorso] !== f) return; // nel frattempo cambiata o dimenticata
        var fam = famiglia(t.codec), s = f.sotto[num] || (f.sotto[num] = { eventi: [], chiavi: {}, byte: 0, ordinati: true });
        var chiave = ev.t + ':' + dati.length;
        if (s.chiavi[chiave]) return;
        var e;
        if (fam === 'PGS') e = { t: ev.t, d: ev.d, pgs: dati };
        else {
          if (s.byte > MAX_TESTO_TRACCIA || s.eventi.length >= MAX_EVENTI) return; // un file fatto apposta: il resto si lascia stare
          var testo = dati.toString('utf8', 0, Math.min(dati.length, 2000));
          if (fam === 'ASS') {
            var campi = testo.split(',');
            e = testoAss(campi.length >= 9 ? campi.slice(8).join(',') : testo);
          } else e = testoSrt(testo);
          if (!e.x) e.x = '';
          e.t = ev.t;
          e.d = ev.d >= 0 ? ev.d : 4000;
        }
        s.chiavi[chiave] = true;
        e.k = chiave;
        // in fondo: di solito arrivano gia' in ordine; se no si ordinano quando servono (mai uno spostamento per evento)
        if (s.eventi.length && s.eventi[s.eventi.length - 1].t > e.t) s.ordinati = false;
        s.eventi.push(e);
        var w = pesoEv(e);
        s.byte += w;
        sottoTot += w;
        // troppa memoria (i PGS pesano): prima i sottotitoli degli altri file, poi quelli di qui piu' lontani da dove si guarda
        while (sottoTot > MAX_SOTTO_TOT && togliAltri(f)) { /* uno alla volta */ }
        if (sottoTot > MAX_SOTTO_TOT || s.eventi.length > MAX_EVENTI) sfoltisci(f, num, s, fam === 'PGS' ? FINESTRA_PGS : FINESTRA_TESTO);
      }
      function ordina(s) { if (!s.ordinati) { s.eventi.sort(function (a, b) { return a.t - b.t; }); s.ordinati = true; } }
      // via un quarto degli eventi, i piu' lontani da dove si guarda, in una volta sola (costa un ordinamento, non uno
      // spostamento per evento); i tratti tolti si rileggono dalle Cues se servono
      function sfoltisci(f, num, s, finestra) {
        ordina(s);
        var qui = f.dove || 0, a = 0, z = s.eventi.length, quanti = Math.max(1, Math.floor(z / 4));
        while (quanti-- > 0 && z - a > 1) { if (Math.abs(s.eventi[a].t - qui) > Math.abs(s.eventi[z - 1].t - qui)) a++; else z--; }
        var via = s.eventi.slice(0, a).concat(s.eventi.slice(z));
        s.eventi = s.eventi.slice(a, z);
        for (var i = 0; i < via.length; i++) {
          delete s.chiavi[via[i].k];
          var w = pesoEv(via[i]);
          s.byte -= w;
          sottoTot -= w;
          if (f.cuesFatte) { delete f.cuesFatte[num + ':' + Math.floor(via[i].t / finestra)]; delete f.cuesFatte[num + ':' + (Math.floor(via[i].t / finestra) + 1)]; }
        }
        if (sottoTot > MAX_SOTTO_TOT && s.eventi.length > 1) sfoltisci(f, num, s, finestra);
      }
      // i sottotitoli tenuti per un file (tranne la traccia "tranne"): via, e i tratti letti dalle Cues da rileggere
      function dimenticaSotto(g, tranne) {
        var tolto = false;
        for (var k in g.sotto) {
          if (!Object.prototype.hasOwnProperty.call(g.sotto, k) || +k === tranne) continue;
          sottoTot -= g.sotto[k].byte;
          delete g.sotto[k];
          tolto = true;
        }
        if (tolto && g.cuesFatte) {
          for (var c in g.cuesFatte) if (Object.prototype.hasOwnProperty.call(g.cuesFatte, c) && +c.split(':')[0] !== tranne) delete g.cuesFatte[c];
        }
        return tolto;
      }
      // i sottotitoli del file usato meno di recente (non f): true = liberato qualcosa
      function togliAltri(f) {
        var l = Object.keys(aperti).map(function (k) { return aperti[k]; }).sort(function (a, b) { return a.usato - b.usato; });
        for (var i = 0; i < l.length; i++) if (l[i] !== f && dimenticaSotto(l[i], -1)) return true;
        return false;
      }
      // la traccia di sottotitoli che l'app mostra (lo stesso oggetto per tutte le letture in corso del file)
      function attiveDi(f) { return f.sottoAttive || (f.sottoAttive = {}); }

      // dalle Cues: i blocchi di una traccia di sottotitoli letti uno per uno (pochi KB ciascuno), in un intervallo di tempo
      function daCues(f, num, da, a, cb) {
        var m = f.m, l = m && m.cues ? m.cues[num] : null;
        if (!l || !l.length) { cb(false); return; }
        var scala = m.scala / 1e6, nella = l.filter(function (c) { var t = c.t * scala; return t >= da && t <= a; });
        var visti = {}, scelti = nella.filter(function (c) {
          var k = c.cl + ':' + c.rel;
          if (c.rel < 0 || visti[k]) return false;
          visti[k] = true;
          return true;
        }).slice(0, 5000);
        if (!scelti.length) { cb(!nella.length); return; } // nessun blocco qui: letta; blocchi senza posizione: no
        var t = m.tracce.filter(function (x) { return x.num === num; })[0], fs = f.fs;
        fs.open(f.percorso, 'r', function (err, fd) {
          if (err) { cb(false); return; }
          var k = 0, inVolo = 0, testate = f.testate || (f.testate = {}), finito = false, letti = 0;
          function chiudi() { if (finito) return; finito = true; fs.close(fd, function () {}); quandoGonfiati(function () { cb(true); }); }
          function testa(cl, poi) {
            if (testate[cl] !== undefined) { poi(testate[cl]); return; }
            leggi(fs, fd, cl, 16, function (e2, h) {
              var hi = !e2 && leggiId(h, 0), hd = hi && hi.id === ID.CLUSTER ? leggiVint(h, hi.n) : null;
              if (!e2 && Object.keys(testate).length < 20000) testate[cl] = hd ? cl + hi.n + hd.n : -1;
              poi(hd ? cl + hi.n + hd.n : -1);
            });
          }
          function uno() {
            if (letti > (32 << 20)) k = scelti.length; // basta: 32 MB per finestra
            if (k >= scelti.length) { if (!inVolo) chiudi(); return; }
            var c = scelti[k++];
            inVolo++;
            testa(c.cl, function (dati) {
              if (dati < 0) { inVolo--; uno(); return; }
              // prima 4 KB (il testo ci sta); se il blocco e' piu' grande (un'immagine PGS) si rilegge intero
              function blocco(quanti, poi) { letti += quanti; leggi(fs, fd, dati + c.rel, quanti, poi); }
              blocco(4096, function dopoTesta(e3, b) {
                var hi0 = !e3 && b ? leggiId(b, 0) : null, hd0 = hi0 && hi0.id > 0 ? leggiVint(b, hi0.n) : null;
                if (hd0 && !hd0.rotto && hi0.n + hd0.n + hd0.v > b.length && hi0.n + hd0.n + hd0.v <= (2 << 20) && !dopoTesta.gia) {
                  dopoTesta.gia = true;
                  blocco(hi0.n + hd0.n + hd0.v, dopoTesta);
                  return;
                }
                inVolo--;
                try {
                  if (!e3 && b) {
                    var hi = leggiId(b, 0), hd = hi && hi.id > 0 ? leggiVint(b, hi.n) : null;
                    if (hd && (hi.id === ID.SIMPLE || hi.id === ID.GRUPPO) && hi.n + hd.n + hd.v <= b.length) {
                      var s = new Scansione(m, {}, {}, null, null), contenuto = b.slice(hi.n + hd.n, hi.n + hd.n + hd.v);
                      s.presa = { num: num, gruppo: hi.id === ID.GRUPPO, manca: 0, parti: [contenuto], tempo: 0 };
                      // il tempo assoluto viene dalla Cue (il blocco ha il tempo relativo al suo Cluster)
                      s.suSotto = function (n, ev) {
                        ev.t = Math.round(c.t * scala);
                        if (ev.d < 0 && c.dur >= 0) ev.d = Math.round(c.dur * scala);
                        nuovoSotto(f, n, ev);
                      };
                      s.finePresa();
                    }
                  }
                } catch (e4) { /* un blocco rotto (o fatto apposta): si salta */ }
                uno();
              });
            });
            if (inVolo < 6) uno();
          }
          if (!t) { chiudi(); return; }
          uno();
        });
      }

      function sotto(d, p, num, da, cb, dopo) {
        apri(d, p, function (err, f) { if (err) cb(err); else sottoF(f, num, da, cb, dopo); });
      }
      function sottoF(f, num, da, cb, dopo) {
        num = +num;
        da = Math.max(0, +da || 0);
        dopo = dopo !== undefined && dopo !== null && dopo !== '' && isFinite(+dopo) ? +dopo : -1;
        f.dove = da;
        var tr = sottoTracce(f)[num];
        if (!tr) { cb(errore('assente', 'traccia di sottotitoli non trovata')); return; }
        // da ora si raccoglie solo questa traccia (anche nelle letture del file gia' in corso); le altre si dimenticano
        var attive = attiveDi(f);
        if (attive[num] !== tr) {
          for (var a0 in attive) if (Object.prototype.hasOwnProperty.call(attive, a0)) delete attive[a0];
          attive[num] = tr;
          dimenticaSotto(f, num);
        }
        // a finestre: 2 minuti per i PGS (pesano), 10 per il testo. Si risponde con la finestra di "da" e intanto si
        // legge la prossima
        var W = famiglia(tr.codec) === 'PGS' ? FINESTRA_PGS : FINESTRA_TESTO, k = Math.floor(da / W);
        function rispondi(letta) {
          var s = f.sotto[num] || { eventi: [], ordinati: true }, a = da + W, out = [], primo = 0, i;
          ordina(s);
          // l'ultimo iniziato prima di "da" resta sempre: un PGS non ha durata (lo toglie quello dopo). Ricerca a meta'
          var lo = 0, hi = s.eventi.length - 1;
          while (lo <= hi) { var mid = (lo + hi) >> 1; if (s.eventi[mid].t <= da) { primo = mid; lo = mid + 1; } else hi = mid - 1; }
          for (i = primo; i < s.eventi.length && out.length < 400; i++) {
            var e = s.eventi[i];
            if (e.t > a) break;
            if (dopo >= 0 && e.t <= dopo) continue; // l'app li ha gia'
            if (i === primo || e.t + Math.max(e.d, 0) >= da - 2000) out.push(e.pgs ? { t: e.t, d: e.d, k: e.k, pgs: e.pgs.toString('base64') } : e);
          }
          // "completi" solo per i file accanto (letti interi): le tracce del file si chiedono di nuovo andando avanti
          cb(null, { eventi: out, fino: letta ? (k + 1) * W : 0, completi: false });
        }
        leggiFinestra(f, num, k, W, function (letta) {
          rispondi(letta);
          leggiFinestra(f, num, k + 1, W, function () {});
        });
      }
      // una finestra di sottotitoli dalle Cues, una volta sola: chi chiede mentre si legge aspetta la stessa lettura
      function leggiFinestra(f, num, k, W, cb) {
        f.cuesFatte = f.cuesFatte || {};
        var chiave = num + ':' + k, stato = f.cuesFatte[chiave];
        if (stato === true || stato === 'no') { cb(stato === true); return; }
        if (stato && stato.attese) { stato.attese.push(cb); return; }
        var x = f.cuesFatte[chiave] = { attese: [cb] };
        daCues(f, num, Math.max(0, k * W - 60000), (k + 1) * W, function (fatto) {
          if (f.cuesFatte && f.cuesFatte[chiave] === x) f.cuesFatte[chiave] = fatto ? true : 'no';
          for (var i = 0; i < x.attese.length; i++) { try { x.attese[i](fatto); } catch (e) {} }
        });
      }

      function sottoEsterni(d, p, cb) {
        risolvi(d, p, function (err, dove) {
          if (err) { cb(err); return; }
          if (!EST_SOTTO.test(dove)) { cb(errore('assente', 'non sono sottotitoli')); return; }
          fs.stat(dove, function (e2, st) {
            if (e2 || !st.isFile() || st.size > (4 << 20)) { cb(errore('assente', 'sottotitoli non trovati')); return; }
            fs.readFile(dove, function (e3, b) {
              if (e3) { cb(errore('assente', e3.code)); return; }
              var formato = (/\.([a-z]+)$/i.exec(dove) || ['', 'srt'])[1].toLowerCase();
              leggiSottotitoli(testoDi(b), formato, function (eventi, troppi) {
                cb(null, { eventi: eventi, completi: true, complessi: !!troppi });
              });
            });
          });
        });
      }

      /* ---------------------------------------------------------- il file per il <video>, con Range */

      function intervallo(h, dim) {
        var m = /^bytes=(\d*)-(\d*)$/.exec(String(h || '').replace(/\s+/g, ''));
        if (!m || (m[1] === '' && m[2] === '')) return null;
        var a, z;
        if (m[1] === '') { a = Math.max(0, dim - +m[2]); z = dim - 1; } else { a = +m[1]; z = m[2] === '' ? dim - 1 : Math.min(+m[2], dim - 1); }
        if (a > z || a >= dim) return false;
        return { a: a, z: z };
      }
      // il confine noto piu' vicino prima di pos (ricerca binaria), da cui la scansione puo' partire
      function confinePrima(l, pos) {
        var lo = 0, hi = l.length - 1, r = -1;
        while (lo <= hi) { var mid = (lo + hi) >> 1; if (l[mid] <= pos) { r = l[mid]; lo = mid + 1; } else hi = mid - 1; }
        return r;
      }
      function nuovoConfine(m, pos) {
        var l = m.confini, k = l.length;
        if (k && l[k - 1] < pos) { if (k < MAX_CONFINI) l.push(pos); return; }
        var lo = 0, hi = k;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (l[mid] < pos) lo = mid + 1; else hi = mid; }
        if (l[lo] !== pos && k < MAX_CONFINI) l.splice(lo, 0, pos);
      }

      function servi(req, res, d, p, scelte) {
        apri(d, p, function (err, f) {
          if (err) {
            res.writeHead(err.codice === 'permesso' ? 403 : err.codice === 'rete' ? 502 : 404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end(err.codice || 'errore');
            return;
          }
          serviF(req, res, f, scelte);
        });
      }
      function serviF(req, res, f, scelte) {
        var fs = f.fs, dim = f.dim, r = intervallo(req.headers.range, dim);
        if (r === false) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + dim, 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
        var a = r ? r.a : 0, z = r ? r.z : dim - 1, m = f.m;
        var pi = m ? piano(m, scelte, lettiOra()) : null;
        var fisse = m && pi ? modificheFisse(m, pi) : [];
        var subT = m && m.formato !== 'mp4' ? sottoTracce(f) : {};
        var scansiona = !!(m && m.formato !== 'mp4' && m.cluster1 > 0 && !f.scansioneRotta && (pi.quante || Object.keys(subT).length));
        var testa = { 'Content-Type': f.tipo, 'Accept-Ranges': 'bytes', 'Content-Length': String(z - a + 1),
          'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
        if (r) testa['Content-Range'] = 'bytes ' + a + '-' + z + '/' + dim;
        res.writeHead(r ? 206 : 200, testa);
        if (req.method === 'HEAD') { res.end(); return; }
        f.usato = Date.now();

        // da dove si legge: per la scansione dal confine noto prima di "a" (il Cluster dove cade), se non e' troppo
        // lontano; nell'intestazione (prima del primo Cluster) solo le modifiche fisse
        var inizio = a, scan = null, daScansione = -1;
        if (scansiona) {
          if (a < m.cluster1) daScansione = m.cluster1;
          else {
            var c = confinePrima(m.confini, a);
            if (c >= 0 && a - c <= (8 << 20)) { daScansione = c; inizio = c; }
            else daScansione = -2; // troppo lontano: si cerca il prossimo Cluster
          }
          scan = new Scansione(m, pi.nascoste, attiveDi(f), function (num, ev) { nuovoSotto(f, num, ev); },
            function (pos) { nuovoConfine(m, pos); });
        }
        var fine = Math.min(dim, z + 1 + (scan ? 64 : 0)); // qualche byte in piu' per decidere l'ultimo blocco
        var lettura = inizio, sospeso = null, sospesoPos = 0, chiuso = false, fd = -1, nf = 0, inAttesa = false, fermataScan = false;
        // il lettore chiude mentre si aspetta "drain": nessuno richiamerebbe giro() e il file resterebbe aperto
        function staccato() { chiuso = true; if (inAttesa) { inAttesa = false; res.removeListener('drain', riparti); finisci(); } }
        function riparti() { inAttesa = false; giro(); }
        req.on('close', staccato);
        res.on('close', staccato);
        // una pausa lunga non chiude la connessione (in Node 12 il server la chiude dopo 2 minuti di silenzio)
        try { if (req.socket && req.socket.setTimeout) req.socket.setTimeout(0); } catch (e0) {}
        fs.open(f.percorso, 'r', function (e2, x) {
          if (e2) { chiuso = true; try { res.destroy(); } catch (e) {} return; }
          fd = x;
          giro();
        });
        function finisci(rotta) {
          if (fd >= 0) { fs.close(fd, function () {}); fd = -1; }
          if (chiuso) return;
          // meno byte di quelli promessi (file sparito, chiavetta staccata): si chiude la connessione, cosi' il lettore lo
          // sa subito invece di aspettare il resto
          if (rotta) { chiuso = true; try { res.destroy(); } catch (e) {} } else res.end();
        }
        function giro() {
          if (chiuso) { finisci(); return; }
          // la scansione e' rimasta indietro (fermata dopo 15 ms, o tanti blocchi minuscoli): prima si finisce cio' che
          // c'e', al giro dopo, senza leggere altro (la memoria non cresce) e senza mandare byte non controllati
          if (sospeso && (sospeso.length >= BLOCCO || fermataScan)) {
            setImmediate(function () {
              if (chiuso) { finisci(); return; }
              var avanti;
              try { avanti = pezzo(VUOTO); } catch (ex) { rotto(); return; }
              if (!avanti) { inAttesa = true; res.once('drain', riparti); return; }
              giro();
            });
            return;
          }
          if (lettura >= fine && !sospeso) { finisci(); return; }
          var n = Math.min(BLOCCO, fine - lettura);
          if (n <= 0) { manda(sospeso, sospesoPos, true); sospeso = null; finisci(); return; }
          leggi(fs, fd, lettura, n, function (e3, b) {
            if (e3 || !b.length) { if (sospeso) manda(sospeso, sospesoPos, true); finisci(lettura <= z); return; }
            var avanti;
            try { avanti = pezzo(b); } catch (ex) { rotto(); return; }
            if (!avanti) { inAttesa = true; res.once('drain', riparti); return; }
            giro();
          });
        }
        // un file fatto male (o apposta): questa risposta si chiude e il file si serve senza scansione (le modifiche
        // fisse restano); il servizio non si ferma
        function rotto() {
          f.scansioneRotta = true;
          chiuso = true;
          if (fd >= 0) { fs.close(fd, function () {}); fd = -1; }
          try { res.destroy(); } catch (e) {}
        }
        // un pezzo letto: scansione, modifiche, e la parte che cade nella richiesta. false = aspettare "drain"
        function pezzo(b) {
          var pos = sospeso ? sospesoPos : lettura, dati = sospeso ? unisci(sospeso, b) : b;
          lettura += b.length;
          sospeso = null;
          var finale = dati.length, mod = [];
          fermataScan = false;
          if (scan) {
            var da = 0;
            if (daScansione === -2) {
              // ricerca del prossimo Cluster (1F 43 B6 75) seguito da un Tempo o da un CRC
              for (var i = 0; i + 13 < dati.length; i++) {
                if (dati[i] === 0x1f && dati[i + 1] === 0x43 && dati[i + 2] === 0xb6 && dati[i + 3] === 0x75) {
                  var vd = leggiVint(dati, i + 4);
                  if (vd && !vd.rotto && (dati[i + 4 + vd.n] === 0xe7 || dati[i + 4 + vd.n] === 0xbf)) { daScansione = pos + i; break; }
                }
              }
              if (daScansione === -2) { da = -1; finale = Math.max(0, dati.length - 13); }
            }
            if (da >= 0 && daScansione >= 0 && pos + dati.length > daScansione) {
              da = Math.max(0, daScansione - pos);
              var r2 = scan.mangia(da ? dati.slice(da) : dati, pos + da);
              finale = da + r2.usati;
              mod = r2.modifiche;
              fermataScan = r2.fermata;
              // il file e' finito: si manda tutto (ma solo quando la scansione ha davvero guardato tutto quello che poteva)
              if (lettura >= fine && finale < dati.length && !r2.fermata) finale = dati.length;
              daScansione = pos; // da qui in poi la scansione segue i dati
            }
          }
          if (finale < dati.length) { sospeso = dati.slice(finale); sospesoPos = pos + finale; dati = dati.slice(0, finale); }
          // le modifiche fisse e quelle trovate, solo dentro questo pezzo
          for (var k = nf; k < fisse.length && fisse[k].pos < pos + dati.length; k++) {
            if (fisse[k].pos >= pos) dati[fisse[k].pos - pos] = fisse[k].byte;
          }
          while (nf < fisse.length && fisse[nf].pos < pos + dati.length) nf++;
          for (var j = 0; j < mod.length; j++) if (mod[j] >= pos && mod[j] < pos + dati.length) dati[mod[j] - pos] = ID.VOID;
          if (scan && pos + dati.length > (f.fineLetta || 0)) {
            f.fineLetta = pos + dati.length;
          }
          return manda(dati, pos, false);
        }
        // manda la parte che cade nella richiesta [a, z]; false = aspetta "drain"
        function manda(dati, pos, ultimo) {
          if (!dati || chiuso) return true;
          var da = Math.max(a, pos), al = Math.min(z + 1, pos + dati.length);
          if (al <= da) return true;
          return res.write(dati.slice(da - pos, al - pos));
        }
      }

      /* ---------------------------------------------------------- le schede (NFO, immagini, tag) e le immagini */

      // le cartelle lette di recente (le schede di tanti video della stessa cartella): 10 secondi, al massimo 60
      var elenchi = {}, schede = {};
      function elenco(dove, cb) {
        var e = elenchi[dove];
        if (e && Date.now() - e.at < 10000) { cb(null, e.nomi); return; }
        fs.readdir(dove, function (err, nomi) {
          if (err) { cb(err); return; }
          nomi = nomi.filter(function (x) { return !NASCOSTE.test(x) || x === '.actors'; }).slice(0, 3000);
          var l = Object.keys(elenchi);
          if (l.length >= 60) delete elenchi[l[0]];
          elenchi[dove] = { at: Date.now(), nomi: nomi };
          cb(null, nomi);
        });
      }
      function trovaNome(nomi, voluto) {
        var v = String(voluto).toLowerCase();
        for (var i = 0; i < nomi.length; i++) if (nomi[i].toLowerCase() === v) return nomi[i];
        return null;
      }
      function unisci2(a, b) { return a ? a + '/' + b : b; }
      function leggiNfoIn(dove, nome, cb) {
        if (!nome) { cb(null); return; }
        var pieno = path.join(dove, nome);
        // lstat: un .nfo che e' un collegamento (verso un file del TV) non si legge
        fs.lstat(pieno, function (e, st) {
          if (e || !st.isFile() || st.size > MAX_NFO) { cb(null); return; }
          fs.readFile(pieno, function (e2, b) { var n = null; try { n = e2 ? null : leggiNfo(testoDi(b)); } catch (e3) {} cb(n); });
        });
      }
      // le foto degli attori: .actors/Nome_Cognome.jpg (Kodi, tinyMediaManager)
      function fotoCast(cast, dove, relC, nomi, cb) {
        if (!cast.length || !trovaNome(nomi, '.actors')) { cb(); return; }
        var cartellaFoto = path.join(dove, trovaNome(nomi, '.actors'));
        fs.lstat(cartellaFoto, function (e0, st) {
          if (e0 || !st.isDirectory()) { cb(); return; } // un collegamento non si segue
          elenco(cartellaFoto, function (e, foto) {
          if (!e) {
            cast.forEach(function (c) {
              var f = trovaNome(foto, c.nome.replace(/\s+/g, '_') + '.jpg') || trovaNome(foto, c.nome.replace(/\s+/g, '_') + '.png');
              if (f) c.foto = { p: unisci2(unisci2(relC, '.actors'), f) };
            });
          }
          cb();
          });
        });
      }
      function refImg(relC, mappa) {
        var out = {};
        for (var k in mappa) if (Object.prototype.hasOwnProperty.call(mappa, k)) out[k] = { p: unisci2(relC, mappa[k]) };
        return out;
      }
      function riempi(s, n) {
        if (!n) return;
        ['titolo', 'originale', 'anno', 'trama', 'slogan', 'durata', 'classificazione', 'voto', 'collezione', 'uscita'].forEach(function (k) {
          if (n[k] && !s[k]) s[k] = n[k];
        });
        ['generi', 'studi', 'registi', 'scrittori', 'paesi', 'cast'].forEach(function (k) { if (n[k] && n[k].length && !(s[k] && s[k].length)) s[k] = n[k]; });
        if (n.stagione >= 0 && s.stagione < 0) s.stagione = n.stagione;
        if (n.episodio >= 0 && s.episodio < 0) s.episodio = n.episodio;
      }
      // le copertine dentro il file: gli allegati immagine del MKV (cover.jpg, cover_land.jpg...) o "covr" dell'MP4
      function allegatiDi(f, cb) {
        var m = f.m, fs = f.fs;
        if (!m || !m.allegati) { cb([]); return; }
        if (m.listaAllegati) { cb(m.listaAllegati); return; }
        fs.open(f.percorso, 'r', function (e, fd) {
          if (e) { cb([]); return; }
          var pos = m.allegati.da, out = [], giri = 0;
          function fine() { fs.close(fd, function () {}); m.listaAllegati = out; cb(out); }
          (function giro() {
            if (pos >= m.allegati.a || out.length >= 16 || ++giri > 200) { fine(); return; }
            leggi(fs, fd, pos, 4096, function (e2, b) {
              if (e2 || !b || !b.length) { fine(); return; }
              try {
                var hi = leggiId(b, 0), hd = hi && hi.id > 0 ? leggiVint(b, hi.n) : null;
                if (!hd || hd.rotto || hd.ignota) { fine(); return; }
                var s0 = hi.n + hd.n, z = Math.min(b.length, s0 + hd.v), x = { nome: '', tipo: '', pos: -1, n: 0 }, i = s0;
                if (hi.id !== 0x61A7) i = z; // un CRC-32 o un Void (ffmpeg mette il CRC per primo): si passa oltre
                // nome e tipo stanno prima dei dati (che non si leggono qui: solo dove sono e quanto sono lunghi)
                while (i < z) {
                  var ci = leggiId(b, i), cd = ci && ci.id > 0 ? leggiVint(b, i + ci.n) : null;
                  if (!cd || cd.rotto) break;
                  var ds = i + ci.n + cd.n;
                  if (ci.id === 0x466E) x.nome = stringa(b, ds, Math.max(0, Math.min(cd.v, z - ds))).slice(0, 120);
                  else if (ci.id === 0x4660) x.tipo = stringa(b, ds, Math.max(0, Math.min(cd.v, z - ds))).slice(0, 60);
                  else if (ci.id === 0x465C) { x.pos = pos + ds; x.n = cd.v; }
                  i = ds + cd.v;
                }
                if (x.pos >= 0 && x.n > 0 && x.n <= MAX_IMG && x.pos + x.n <= m.dim && (/^image\/(jpe?g|png)$/i.test(x.tipo) || /\.(jpe?g|png)$/i.test(x.nome))) out.push(x);
                pos += s0 + hd.v;
              } catch (ex) { fine(); return; }
              giro();
            });
          })();
        });
      }
      function immaginiFile(f, cb) {
        var m = f.m;
        if (!m) { cb([]); return; }
        if (m.formato === 'mp4') { cb((m.covr || []).filter(function (c) { return c.pos + c.n <= m.dim; }).map(function (c) { return { nome: 'cover', pos: c.pos, n: c.n }; })); return; }
        allegatiDi(f, cb);
      }
      // che copertina e' un allegato: i nomi di Matroska (cover, small_cover, cover_land), poi la prima immagine
      function tipoAllegato(nome) {
        var n = String(nome).toLowerCase();
        if (/land|wide|backdrop|fanart/.test(n)) return /fanart|backdrop/.test(n) ? 'fanart' : 'landscape';
        if (/^small_/.test(n)) return '';
        if (/logo/.test(n)) return 'logo';
        return 'poster';
      }

      // la scheda di un video (film o puntata) o di una cartella (film, serie, stagione, cartella qualsiasi), dai .nfo,
      // dalle immagini accanto e (pieno) dai tag e dalle copertine dentro il file. Senza niente: dal nome del file
      function scheda(d, p, pieno, cb) {
        risolvi(d, p, function (err, dove, parti) {
          if (err) { cb(err); return; }
          fs.stat(dove, function (e1, st) {
            if (e1) { cb(errore('assente', 'non trovato')); return; }
            var dir = st.isDirectory();
            if (!dir && !EST_VIDEO.test(dove)) { cb(errore('assente', 'non e\' un video')); return; }
            var chiave = d + '|' + parti.join('/') + '|' + (pieno ? 1 : 0), c = schede[chiave];
            if (c && Date.now() - c.at < 60000) { cb(null, c.s); return; }
            function fatto(e, s) {
              if (!e) {
                var l = Object.keys(schede);
                if (l.length >= 400) delete schede[l[0]];
                schede[chiave] = { at: Date.now(), s: s };
              }
              cb(e, s);
            }
            try { (dir ? schedaCartella : schedaVideo)(d, dove, parti, pieno, fatto); } catch (e2) { cb(errore('formato', 'scheda non leggibile')); }
          });
        });
      }
      function nuovaScheda(tipo, titolo) {
        return { tipo: tipo, titolo: titolo || '', originale: '', anno: 0, trama: '', slogan: '', durata: 0, secondi: 0, classificazione: '',
          voto: 0, generi: [], studi: [], registi: [], scrittori: [], paesi: [], collezione: '', uscita: '', cast: [], stagione: -1,
          episodio: -1, serie: null, img: {}, fonti: [] };
      }
      function schedaVideo(d, dove, parti, pieno, cb) {
        var cartellaVera = path.dirname(dove), relC = parti.slice(0, -1).join('/'), nome = parti[parti.length - 1];
        var base = nome.replace(/\.[^.]+$/, ''), dn = dalNome(nome);
        elenco(cartellaVera, function (e, nomi) {
          if (e) { cb(errore('assente', e.code)); return; }
          var video = nomi.filter(function (x) { return EST_VIDEO.test(x) && !/(^|[\s._-])(sample|trailer)([\s._-]|$)/i.test(x); });
          var solo = video.length === 1, s = nuovaScheda('film', '');
          leggiNfoIn(cartellaVera, trovaNome(nomi, base + '.nfo') || (solo ? trovaNome(nomi, 'movie.nfo') : null), function (n) {
            if (n) { s.fonti.push('nfo'); riempi(s, n); if (n.tipo === 'puntata') s.tipo = 'puntata'; if (n.serie) s.serieTitolo = n.serie; }
            if (s.stagione < 0) s.stagione = dn.stagione;
            if (s.episodio < 0) s.episodio = dn.episodio;
            if (s.episodio >= 0) s.tipo = 'puntata';
            var puntata = s.tipo === 'puntata', im = immaginiDi(nomi, base, solo && !puntata, puntata);
            s.img = refImg(relC, im);
            if (Object.keys(im).length) s.fonti.push('immagini');
            // per ultimo il nome del file: titolo e anno se nessuno li ha detti (una puntata senza titolo: "Puntata N")
            function finito() {
              if (!s.titolo) s.titolo = s.tipo === 'puntata' && s.episodio >= 0 ? 'Puntata ' + s.episodio : dn.titolo;
              if (!s.anno && s.tipo !== 'puntata') s.anno = dn.anno;
              if (s.tipo === 'puntata' && !s.serieTitolo && !(s.serie && s.serie.titolo)) s.serieTitolo = dn.titolo;
              cb(null, s);
            }
            function dopo() {
              if (!pieno) { finito(); return; }
              dentroFile(d, parti, s, finito);
            }
            if (!puntata) { fotoCast(s.cast, cartellaVera, relC, nomi, dopo); return; }
            // una puntata: la serie (tvshow.nfo e immagini) nella cartella sopra se questa e' una stagione
            var inStagione = RE_STAGIONE.test(parti.length > 1 ? parti[parti.length - 2] : '');
            var serieDove = inStagione ? path.dirname(cartellaVera) : cartellaVera, serieRel = inStagione ? parti.slice(0, -2).join('/') : relC;
            laSerie(serieDove, serieRel, s.stagione, s, function () {
              if (inStagione && !s.img.stagione) {
                var sp = immaginiDi(nomi, '', true, false).poster;
                if (sp) s.img.stagione = { p: unisci2(relC, sp) };
              }
              fotoCast(s.cast.length ? s.cast : (s.serie && s.serie.cast) || [], serieDove, serieRel, s.serieNomi || [], function () { delete s.serieNomi; dopo(); });
            });
          });
        });
      }
      // la serie di una puntata o di una stagione: tvshow.nfo e le immagini della cartella della serie
      function laSerie(dove, relC, stagione, s, cb) {
        elenco(dove, function (e, nomi) {
          if (e) { cb(); return; }
          s.serieNomi = nomi;
          leggiNfoIn(dove, trovaNome(nomi, 'tvshow.nfo'), function (n) {
            var im = immaginiDi(nomi, '', true, false), quale = stagione === 0 ? 'season-specials-poster' : 'season' + (stagione < 10 ? '0' : '') + stagione + '-poster';
            s.serie = { titolo: (n && n.titolo) || s.serieTitolo || '', anno: n ? n.anno : 0, generi: n ? n.generi : [], voto: n ? n.voto : 0,
              trama: n ? n.trama : '', classificazione: n ? n.classificazione : '', studi: n ? n.studi : [], cast: n ? n.cast : [], img: refImg(relC, im) };
            if (n) s.fonti.push('nfo serie');
            if (!s.serie.titolo) s.serie.titolo = dalNome(path.basename(dove)).titolo;
            var sp = stagione >= 0 ? trovaNome(nomi, quale + '.jpg') || trovaNome(nomi, quale + '.png') : null;
            if (sp) s.img.stagione = { p: unisci2(relC, sp) };
            // le immagini che la puntata non ha: quelle della serie
            ['fanart', 'logo', 'banner'].forEach(function (k) { if (!s.img[k] && s.serie.img[k]) s.img[k] = s.serie.img[k]; });
            if (!s.generi.length) s.generi = s.serie.generi;
            if (!s.classificazione) s.classificazione = s.serie.classificazione;
            cb();
          });
        });
      }
      // i tag e le copertine dentro il file (MKV, MP4): riempiono quello che manca
      function dentroFile(d, parti, s, cb) {
        apri(d, parti.join('/'), function (err, f) {
          if (err || !f.m) { cb(); return; }
          var m = f.m, n = null;
          s.secondi = m.durata || 0;
          if (m.formato === 'mp4' && m.ilst) {
            var t = m.ilst;
            n = { titolo: t.titolo || '', anno: /^\d{4}/.test(t.data || '') ? +String(t.data).slice(0, 4) : 0, trama: t.ldes || t.desc || '',
              generi: t.genere ? [String(t.genere).slice(0, 50)] : [], stagione: t.stagione > 0 ? t.stagione : -1, episodio: t.episodio > 0 ? t.episodio : -1 };
            if (t.serie && !s.serieTitolo) s.serieTitolo = String(t.serie).slice(0, 200);
            if (t.titolo || t.desc || t.ldes) s.fonti.push('mp4');
          } else if (m.tag) {
            var g = m.tag[50] || {}, alto = m.tag[70] || {};
            n = { titolo: g.TITLE || m.titolo || '', anno: /^\d{4}/.test(g.DATE_RELEASED || g.DATE_RECORDED || '') ? +String(g.DATE_RELEASED || g.DATE_RECORDED).slice(0, 4) : 0,
              trama: g.SYNOPSIS || g.SUMMARY || g.DESCRIPTION || g.COMMENT || '', generi: g.GENRE ? String(g.GENRE).split(/\s*[,;\/|]\s*/).slice(0, 8) : [],
              registi: g.DIRECTOR ? [String(g.DIRECTOR).slice(0, 80)] : [], studi: g.PRODUCTION_STUDIO ? [String(g.PRODUCTION_STUDIO).slice(0, 80)] : [],
              classificazione: String(g.LAW_RATING || '').slice(0, 40), stagione: -1, episodio: +g.PART_NUMBER > 0 ? +g.PART_NUMBER : -1 };
            if (alto.TITLE && !s.serieTitolo && s.tipo === 'puntata') s.serieTitolo = String(alto.TITLE).slice(0, 200);
            if (alto.TITLE && !s.collezione && s.tipo !== 'puntata') s.collezione = String(alto.TITLE).slice(0, 120);
            if (g.TITLE || g.SUMMARY || g.SYNOPSIS || g.DESCRIPTION) s.fonti.push('mkv');
          } else if (m.titolo && !s.fonti.length) n = { titolo: m.titolo };
          if (n) { ['titolo', 'trama'].forEach(function (k) { if (n[k]) n[k] = String(n[k]).slice(0, k === 'trama' ? 4000 : 200); }); riempi(s, n); }
          immaginiFile(f, function (l) {
            for (var i = 0; i < l.length; i++) {
              var tipo = f.m.formato === 'mp4' ? (i ? '' : 'poster') : tipoAllegato(l[i].nome);
              if (tipo && !s.img[tipo]) { s.img[tipo] = { p: parti.join('/'), k: i }; if (s.fonti.indexOf('copertina') === -1) s.fonti.push('copertina'); }
            }
            cb();
          });
        });
      }
      function schedaCartella(d, dove, parti, pieno, cb) {
        var relC = parti.join('/'), nomeC = parti.length ? parti[parti.length - 1] : '';
        elenco(dove, function (e, nomi) {
          if (e) { cb(errore(e.code === 'EACCES' ? 'permesso' : 'assente', e.code)); return; }
          var video = nomi.filter(function (x) { return EST_VIDEO.test(x) && !/(^|[\s._-])(sample|trailer)([\s._-]|$)/i.test(x); });
          var stg = RE_STAGIONE.exec(nomeC), tvshow = trovaNome(nomi, 'tvshow.nfo');
          var puntate = video.filter(function (x) { return dalNome(x).episodio >= 0; }).length;
          // la cartella di un solo film: la sua scheda (il nome del video in "video": l'app apre direttamente il film)
          if (!stg && !tvshow && (trovaNome(nomi, 'movie.nfo') || video.length === 1) && video.length >= 1 && puntate < video.length) {
            schedaVideo(d, path.join(dove, video[0]), parti.concat([video[0]]), pieno, function (err, s) {
              if (s) {
                s.video = video[0];
                s.cartellaFilm = true;
                // senza .nfo ne' tag: il nome della cartella ("Dune (2024)") e' di solito piu' pulito di quello del file
                if (s.fonti.indexOf('nfo') === -1 && s.fonti.indexOf('mkv') === -1 && s.fonti.indexOf('mp4') === -1) {
                  var dc = dalNome(nomeC);
                  if (dc.titolo) { s.titolo = dc.titolo; if (dc.anno) s.anno = dc.anno; }
                }
              }
              cb(err, s);
            });
            return;
          }
          var s = nuovaScheda(stg ? 'stagione' : tvshow || puntate >= 2 ? 'serie' : 'cartella', '');
          s.img = refImg(relC, immaginiDi(nomi, '', true, false));
          s.video = video.length;
          if (stg) {
            s.stagione = stg[1] !== undefined ? +stg[1] : 0;
            s.titolo = s.stagione ? 'Stagione ' + s.stagione : 'Speciali';
            laSerie(path.dirname(dove), parti.slice(0, -1).join('/'), s.stagione, s, function () {
              if (!s.img.poster && s.img.stagione) s.img.poster = s.img.stagione;
              delete s.serieNomi;
              cb(null, s);
            });
            return;
          }
          leggiNfoIn(dove, tvshow, function (n) {
            if (n) { s.fonti.push('nfo'); riempi(s, n); }
            var dn = dalNome(nomeC);
            if (!s.titolo) s.titolo = s.tipo === 'serie' && puntate ? dalNome(video.filter(function (x) { return dalNome(x).episodio >= 0; })[0]).titolo || dn.titolo : dn.titolo || nomeC;
            if (!s.anno && !n) s.anno = dn.anno;
            fotoCast(s.cast, dove, relC, nomi, function () { cb(null, s); });
          });
        });
      }
      // un'immagine per l'app: un file .jpg/.png/.webp della chiavetta, o una copertina dentro un video (k); al massimo 8 MB
      // e 12 milioni di pixel (una JPEG 4000x6000 decodificata nel TV occuperebbe 96 MB)
      function immagine(req, res, d, p, k) {
        function no(stato) { res.writeHead(stato, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end(String(stato)); }
        if (k === undefined || k === '') {
          if (!EST_IMG.test(String(p))) { no(404); return; }
          risolvi(d, p, function (err, dove) {
            if (err || !EST_IMG.test(dove)) { no(err && err.codice === 'percorso' ? 400 : 404); return; }
            fs.stat(dove, function (e2, st) {
              if (e2 || !st.isFile()) { no(404); return; }
              mandaImg(req, res, dove, 0, st.size);
            });
          });
          return;
        }
        if (!/^\d{1,2}$/.test(String(k))) { no(400); return; }
        apri(d, p, function (err, f) {
          if (err) { no(err.codice === 'percorso' ? 400 : 404); return; }
          immaginiFile(f, function (l) { var x = l[+k]; if (!x) no(404); else mandaImg(req, res, f.percorso, x.pos, x.n); });
        });
      }
      function mandaImg(req, res, percorso, pos, n) {
        function no(stato) { res.writeHead(stato, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end(String(stato)); }
        if (!(n > 0) || n > MAX_IMG) { no(413); return; }
        fs.open(percorso, 'r', function (e, fd) {
          if (e) { no(404); return; }
          leggi(fs, fd, pos, Math.min(n, 262144), function (e2, testa) {
            var mi = !e2 && testa ? misureImg(testa) : null;
            if (!buonaMisura(mi)) { fs.close(fd, function () {}); no(mi ? 413 : 415); return; }
            res.writeHead(200, { 'Content-Type': mi.tipo, 'Content-Length': String(n), 'Cache-Control': 'private, max-age=3600',
              'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Misure', 'X-Misure': mi.w + 'x' + mi.h });
            if (req.method === 'HEAD') { fs.close(fd, function () {}); res.end(); return; }
            var at = testa.length, chiuso = false, aspetta = false;
            function chiudi() { if (fd >= 0) { fs.close(fd, function () {}); fd = -1; } }
            function avanti() {
              aspetta = false;
              if (chiuso || at >= n) { chiudi(); if (!chiuso) res.end(); return; }
              leggi(fs, fd, pos + at, Math.min(262144, n - at), function (e3, b) {
                if (e3 || !b || !b.length || chiuso) { chiudi(); if (!chiuso) { chiuso = true; try { res.destroy(); } catch (e4) {} } return; }
                at += b.length;
                if (res.write(b)) avanti(); else { aspetta = true; res.once('drain', avanti); }
              });
            }
            res.on('close', function () { chiuso = true; if (aspetta) { aspetta = false; res.removeListener('drain', avanti); chiudi(); } });
            if (res.write(testa.length > n ? testa.slice(0, n) : testa)) avanti(); else { aspetta = true; res.once('drain', avanti); }
          });
        });
      }

      // per "Questo TV": le chiavette si vedono e si leggono? { stato: 'ok' | 'nessuna' | 'permesso' | 'assente' |
      // 'errore' | 'nonPrevisto', dischi }. Si apre la prima chiavetta, senza leggere i file
      function prova(cb) {
        if (!radici.length) { cb({ stato: 'nonPrevisto', dischi: 0 }); return; }
        dischi(function (err, l) {
          if (err) { cb({ stato: err.codice === 'permesso' || err.codice === 'assente' ? err.codice : 'errore', dischi: 0 }); return; }
          if (!l.length) { cb({ stato: 'nessuna', dischi: 0 }); return; }
          fs.readdir(l[0].percorso, function (e2) {
            cb({ stato: !e2 ? 'ok' : e2.code === 'EACCES' || e2.code === 'EPERM' ? 'permesso' : 'errore', dischi: l.length });
          });
        });
      }

      return {
        dischi: dischi, cartella: cartella, info: info, servi: servi, sotto: sotto, sottoEsterni: sottoEsterni, prova: prova,
        scheda: scheda, immagine: immagine,
        // un file che non sta sulla chiavetta (il ponte verso Jellyfin): x = { percorso (chiave unica), nome, dim, data, est,
        // fs (open, read, close come quelli di Node) }. Stesse regole, stesso "vuoto", stessi sottotitoli
        remoto: {
          info: function (x, scelte, cb) { apriF(x, function (e, f) { if (e) cb(e); else infoDi(f, scelte, cb); }); },
          servi: function (req, res, x, scelte) {
            apriF(x, function (e, f) {
              if (!e) { serviF(req, res, f, scelte); return; }
              res.writeHead(e.codice === 'rete' ? 502 : 404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
              res.end(e.codice || 'errore');
            });
          },
          sotto: function (x, num, da, cb, dopo) { apriF(x, function (e, f) { if (e) cb(e); else sottoF(f, num, da, cb, dopo); }); }
        },
        previsto: radici.length > 0, domain: o.domain || null, log: typeof o.log === 'function' ? o.log : null,
        // per le prove
        _apri: apri, _sottoTot: function () { return sottoTot; }
      };
    }

    /* ============================================================ le domande dell'app Video
     * /api/video/g/<gettone>/<cosa>: il gettone sta nel percorso, cosi' anche le richieste del <video> e degli HLS (che
     * chiedono i pezzi con indirizzi relativi, senza le domande "?...") lo portano con se'. Il gettone lo chiede la home
     * (POST /api/video/gettone, con la sua chiave) per un'app ufficiale dello Store col permesso "video". */

    var DURATA_GETTONE = 12 * 3600 * 1000, MAX_GETTONI = 8;
    function gettoni(crypto) {
      var tutti = {}; // gettone -> scadenza
      function pulisci() {
        var ora = Date.now(), l = Object.keys(tutti);
        for (var i = 0; i < l.length; i++) if (tutti[l[i]] <= ora) delete tutti[l[i]];
        l = Object.keys(tutti).sort(function (a, b) { return tutti[a] - tutti[b]; });
        while (l.length > MAX_GETTONI) delete tutti[l.shift()];
      }
      return {
        nuovo: function () {
          var g = crypto.randomBytes(32).toString('hex');
          tutti[g] = Date.now() + DURATA_GETTONE;
          pulisci();
          return { gettone: g, scade: tutti[g] };
        },
        valido: function (g) {
          if (typeof g !== 'string' || !/^[0-9a-f]{64}$/.test(g) || !Object.prototype.hasOwnProperty.call(tutti, g)) return false;
          if (tutti[g] <= Date.now()) { delete tutti[g]; return false; }
          return true;
        },
        togli: function (g) { if (typeof g === 'string') delete tutti[g]; },
        quanti: function () { pulisci(); return Object.keys(tutti).length; }
      };
    }
    function rispondi(res, stato, o) {
      res.writeHead(stato, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(o));
    }
    function statoDi(e) { return e.codice === 'permesso' ? 403 : e.codice === 'percorso' ? 400 : e.codice === 'rete' ? 502 : 404; }
    function corpoJson(req, max, cb) {
      var parti = [], n = 0, rotto = false;
      req.on('data', function (c) { n += c.length; if (n > max) { rotto = true; req.destroy(); } else parti.push(c); });
      req.on('end', function () {
        if (rotto) { cb(null); return; }
        try { var v = JSON.parse(Buffer.concat(parti).toString('utf8') || '{}'); cb(v && typeof v === 'object' && !Array.isArray(v) ? v : null); }
        catch (e) { cb(null); }
      });
    }
    var RE_VIDEO = /^\/api\/video\/g\/([^\/]*)\/(.*)$/;
    // gli errori presi dalla rete (un file fatto in un modo che il codice non si aspettava): per le prove e per il registro
    var presi = { n: 0, ultimo: '' };
    // true = era una domanda dell'app Video (la risposta e' data). Ogni domanda gira in un "dominio" di Node: un errore in
    // uno qualsiasi dei suoi callback (file, stream, zlib, timer) chiude solo quella risposta e si annota; il servizio
    // del TV (home, telefono, blocco della pubblicita') resta su
    function gestisci(vt, g, req, res, u, opzioni) {
      var m = RE_VIDEO.exec(u.pathname || '');
      if (!m) return false;
      var dom = vt.domain ? vt.domain.create() : null;
      if (!dom) { tratta(vt, g, req, res, u, opzioni || {}, m); return true; }
      dom.add(req);
      dom.add(res);
      dom.on('error', function (e) {
        presi.n++;
        presi.ultimo = String(e && e.stack || e).slice(0, 400);
        if (vt.log) { try { vt.log('app Video: errore preso (' + String(e && e.message || e).slice(0, 200) + ')'); } catch (x) {} }
        try { if (!res.headersSent) rispondi(res, 500, { error: 'file non leggibile', codice: 'formato' }); else res.destroy(); } catch (x) {}
      });
      dom.run(function () { tratta(vt, g, req, res, u, opzioni || {}, m); });
      return true;
    }
    function tratta(vt, g, req, res, u, opzioni, m) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, HEAD, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type, Range', 'Access-Control-Max-Age': '600' });
        res.end();
        return true;
      }
      if (!g.valido(m[1])) { rispondi(res, 403, { error: 'gettone non valido', codice: 'gettone' }); return true; }
      var cosa = m[2], q = u.query || {}, d = String(q.d || ''), p = String(q.p || ''), get = req.method === 'GET';
      function errore(e) { rispondi(res, statoDi(e), { error: e.message, codice: e.codice || 'errore' }); }
      if (cosa === 'dischi' && get) {
        vt.dischi(function (e, l) {
          if (e) errore(e);
          else rispondi(res, 200, { dischi: l.map(function (x) { return { id: x.id }; }), previsto: vt.previsto !== false });
        });
      } else if (cosa === 'cartella' && get) {
        vt.cartella(d, p, function (e, r) { if (e) errore(e); else rispondi(res, 200, r); });
      } else if (cosa === 'info' && get) {
        var lingue = String(q.lingue || '').split(',').filter(function (x) { return /^[a-z]{2,3}$/.test(x); }).slice(0, 6);
        vt.info(d, p, { lingue: lingue.length ? lingue : null }, function (e, r) { if (e) errore(e); else rispondi(res, 200, r); });
      } else if (cosa.indexOf('file/') === 0 && (get || req.method === 'HEAD')) {
        vt.servi(req, res, d, p, { audio: +q.a || 0 });
      } else if (cosa === 'scheda' && get) {
        vt.scheda(d, p, q.pieno === '1', function (e, r) { if (e) errore(e); else rispondi(res, 200, r); });
      } else if (cosa === 'immagine' && (get || req.method === 'HEAD')) {
        vt.immagine(req, res, d, p, q.k);
      } else if (cosa === 'sotto' && get) {
        if (q.e) vt.sottoEsterni(d, String(q.e), function (e, r) { if (e) errore(e); else rispondi(res, 200, r); });
        else vt.sotto(d, p, +q.t, +q.da || 0, function (e, r) { if (e) errore(e); else rispondi(res, 200, r); }, q.dopo);
      } else if (cosa === 'punto' && req.method === 'POST') {
        corpoJson(req, 16384, function (b) {
          if (!b) { rispondi(res, 400, { error: 'corpo non valido', codice: 'corpo' }); return; }
          if (opzioni.punto) { try { opzioni.punto(b); } catch (e) {} }
          rispondi(res, 200, { ok: true });
        });
      } else if (/^(jf|mac|tv)\//.test(cosa) && opzioni.ponti) {
        // i ponti verso Jellyfin e verso il limitatore del Mac, e la velocita' del TV (tv-sito/ponti-video.js): stesso
        // gettone, stesso dominio
        opzioni.ponti(req, res, cosa, q, u);
      } else {
        rispondi(res, 404, { error: 'domanda sconosciuta', codice: 'assente' });
      }
    }

    return {
      crea: crea, LETTI: LETTI, gettoni: gettoni, gestisci: gestisci, presi: function () { return { n: presi.n, ultimo: presi.ultimo }; },
      // per le prove e per l'app (le stesse regole)
      _interni: { leggiId: leggiId, leggiVint: leggiVint, famiglia: famiglia, lingua: lingua, piano: piano,
        leggiSottotitoli: leggiSottotitoli, testoDi: testoDi, apriMkv: apriMkv, apriMp4: apriMp4, Scansione: Scansione,
        leggiNfo: leggiNfo, immaginiDi: immaginiDi, misureImg: misureImg, dalNome: dalNome, tagDi: tagDi,
        modificheFisse: modificheFisse, intervallo: null }
    };
  })();
  /* </videoteca:generato> */
  // dove il TV monta chiavette e dischi: /opt/media/USBDriveA1... sui Samsung (da provare: "Questo TV" lo dice); le altre
  // TV lo dicono nel loro adattatore; nelle prove una cartella di file finti
  var RADICI_USB = typeof HOMETV_PROVE_USB === 'string' ? [HOMETV_PROVE_USB] :
    ALTRA ? (Array.isArray(ALTRA.chiavette) ? ALTRA.chiavette : []) : ['/opt/media'];
  // i codec che questo TV legge: dal profilo del TV (profilo.js), ricalcolati al massimo ogni minuto
  var lettiVideo = { at: 0, v: null };
  function lettiTv() {
    if (!lettiVideo.v || Date.now() - lettiVideo.at > 60000) lettiVideo = { at: Date.now(), v: ProfiloTV.videoLetti(fattiTv()) };
    return lettiVideo.v;
  }
  var videoteca = Videoteca.crea({ fs: fs, path: pathLib, zlib: require('zlib'), radici: RADICI_USB, domain: require('domain'), log: log,
    letti: lettiTv });
  var gettoniVideo = Videoteca.gettoni(require('crypto'));

  /* ---------------------------------------------------------- l'app Video: i ponti verso Jellyfin e verso il Mac
   * La logica e' in tv-sito/ponti-video.js (qui la sua copia). Un solo server Jellyfin, scelto dall'app e salvato qui col
   * suo token (che non esce mai dal servizio); verso di lui solo i percorsi della lista. */
  /* <ponti:generato> copia di tv-sito/ponti-video.js (prove/incorpora_videoteca.py): non modificare qui */
  /*
   * Home TV - PONTI dell'app Video: verso UN server Jellyfin salvato (jf/) e verso il limitatore del Mac (mac/).
   * Si modifica SOLO questo file; service.js ne ha una copia tra i segnaposto <ponti:generato>, messa da
   * prove/incorpora_videoteca.py (le prove controllano che sia uguale).
   *
   * Le domande arrivano da Videoteca.gestisci (stesso gettone, stesso "dominio" di Node): /api/video/g/<gettone>/jf/...
   * Regole (per il controllo dello Store):
   *  - un solo server, scelto dall'app e controllato (risponde come Jellyfin), salvato in <cartella>/jellyfin.json;
   *    mai localhost/127.x (la porta del servizio), solo http e https, niente redirect seguiti;
   *  - il token di Jellyfin resta qui: va solo nell'intestazione Authorization verso quel server. Da domande, risposte e
   *    playlist HLS si tolgono api_key/ApiKey; Set-Cookie non passa; il token non va mai nei registri;
   *  - verso Jellyfin solo i percorsi della LISTA (file, schede, immagini, ricerca, trickplay, segmenti, sottotitoli,
   *    HLS, avanzamento, visto e preferiti), con gli id controllati; corpi al massimo 64 KB.
   * La strada diretta: il file vero letto da Jellyfin con le domande Range (un "fs" remoto) e passato alla videoteca, che
   * ci mette il "vuoto" come per le chiavette (tracce che il TV non legge nascoste, sottotitoli nostri, anche PGS).
   *
   *   var p = PontiVideo.crea({ http, https, dgram, url, crypto, fs, path, cartella, videoteca: vt, letti: fn, log: fn,
   *     leggiSottotitoli: Videoteca._interni.leggiSottotitoli, testoDi: Videoteca._interni.testoDi, locale: PROVE });
   *   (locale: solo nelle prove sul computer, un server su 127.0.0.1)
   *   Videoteca.gestisci(vt, g, req, res, u, { punto: fn, ponti: p.tratta })
   *
   * Solo ES5 e solo ASCII; va da Node 4.4.3 (TV 2017-2019) in su.
   */
  var PontiVideo = (function () {
    'use strict';

    var VERSIONE = '1.0.0';
    var MAX_CORPO = 64 << 10, MAX_JSON = 8 << 20, MAX_PLAYLIST = 2 << 20, MAX_SOTTO = 4 << 20;
    // gli id di Jellyfin: 32 cifre esadecimali, a volte coi trattini (negli indirizzi che crea lui: HLS, sottotitoli)
    var ID = '[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}', NOME = '(?!\\.|%2[eE])[^/]{1,200}';
    // i percorsi di Jellyfin che l'app puo' chiedere, con i metodi: il resto risponde 403
    var LISTA = [
      ['GET', 'Users/' + ID + '/Views'], ['GET', 'UserViews'],
      ['GET', 'Users/' + ID + '/Items'], ['GET', 'Users/' + ID + '/Items/Resume'], ['GET', 'Users/' + ID + '/Items/Latest'],
      ['GET', 'Users/' + ID + '/Items/' + ID], ['GET', 'Users/' + ID + '/Items/' + ID + '/(LocalTrailers|SpecialFeatures|Intros)'],
      ['GET', 'UserItems/Resume'], ['GET', 'UserItems/' + ID + '/UserData'], ['GET', 'Items'], ['GET', 'Items/Latest'], ['GET', 'Items/Filters2?'], ['GET', 'Items/' + ID],
      ['GET', 'Items/' + ID + '/(Similar|LocalTrailers|SpecialFeatures|Ancestors|ThemeMedia)'],
      ['GET|HEAD', 'Items/' + ID + '/Images/[A-Za-z]{2,20}(/[0-9]{1,4})?'],
      ['GET', 'Shows/NextUp'], ['GET', 'Shows/' + ID + '/(Seasons|Episodes)'], ['GET', 'Shows/Upcoming'],
      ['GET', 'Movies/Recommendations'], ['GET', 'Genres'], ['GET', 'Genres/' + NOME], ['GET', 'Persons'], ['GET', 'Persons/' + NOME],
      ['GET', 'Studios'], ['GET', 'Search/Hints'], ['GET', 'MediaSegments/' + ID],
      ['GET', 'Videos/' + ID + '/Trickplay/[0-9]{1,5}/([0-9]{1,6}\\.jpg|tiles\\.m3u8)'],
      ['GET', 'Videos/' + ID + '/' + ID + '/Subtitles/[0-9]{1,4}(/[0-9]{1,12})?/Stream\\.(srt|vtt|ass|ssa|js|sup)'],
      ['GET', 'Videos/' + ID + '/(master|main|live)\\.m3u8'],
      ['GET', 'Videos/' + ID + '/hls1/[A-Za-z0-9_]{1,40}/-?[0-9]{1,7}\\.(ts|mp4|m4s|aac|mp3|vtt)'],
      ['GET|HEAD', 'Videos/' + ID + '/stream(\\.[a-z0-9]{2,5})?'],
      ['POST', 'Sessions/Playing(/Progress|/Stopped|/Ping)?'],
      ['POST|DELETE', 'Users/' + ID + '/(PlayedItems|FavoriteItems)/' + ID], ['POST|DELETE', 'User(PlayedItems|FavoriteItems)/' + ID],
      ['DELETE', 'Videos/ActiveEncodings']
    ].map(function (x) { return { metodi: x[0].split('|'), re: new RegExp('^' + x[1] + '$', 'i') }; });

    function inLista(metodo, percorso) {
      for (var i = 0; i < LISTA.length; i++) if (LISTA[i].metodi.indexOf(metodo) >= 0 && LISTA[i].re.test(percorso)) return true;
      return false;
    }
    // via le chiavi da un indirizzo o da una domanda, senza toccare il resto (niente ricodifica)
    function senzaChiavi(u) {
      var s = String(u), q = s.indexOf('?');
      if (q < 0) return s;
      var parti = s.slice(q + 1).split('&').filter(function (x) { return x && !/^(api_?key|x-emby-token|x-mediabrowser-token)(=|$)/i.test(x); });
      return s.slice(0, q) + (parti.length ? '?' + parti.join('&') : '');
    }
    // la playlist HLS di Jellyfin: gli indirizzi restano relativi (il lettore chiede i pezzi accanto, sempre dal ponte), senza
    // chiavi; quelli assoluti verso il server diventano quelli del ponte
    function riscriviPlaylist(testo, server, ponte) {
      function uno(u) {
        var x = String(u).trim();
        if (server && x.toLowerCase().indexOf(server.toLowerCase() + '/') === 0) x = ponte + x.slice(server.length + 1);
        else if (/^[a-z][a-z0-9+.\-]*:/i.test(x)) return '';
        return senzaChiavi(x);
      }
      var righe = String(testo).split(/\r?\n/), out = [], varianti = 0, salta = false;
      for (var i = 0; i < righe.length; i++) {
        var r = righe[i];
        // nel master: solo la prima variante (Jellyfin con l'HDR aggiunge una riserva H.264 SDR senza tonemapping: il TV
        // potrebbe sceglierla); niente anteprime per il lettore (le chiede l'app a parte)
        if (/^#EXT-X-STREAM-INF:/.test(r)) { varianti++; if (varianti > 1) { salta = true; continue; } }
        else if (/^#EXT-X-IMAGE-STREAM-INF:/.test(r)) continue;
        else if (salta && r && r.charAt(0) !== '#') { salta = false; continue; }
        if (!r) { out.push(r); continue; }
        if (r.charAt(0) !== '#') { out.push(uno(r)); continue; }
        out.push(r.replace(/URI="([^"]*)"/g, function (t, u) { return 'URI="' + uno(u) + '"'; }));
      }
      return out.join('\n');
    }
    function bufDa(s) { return typeof Buffer.from === 'function' && Buffer.from !== Uint8Array.from ? Buffer.from(s, 'utf8') : new Buffer(s, 'utf8'); }
    function errore(codice, msg) { var e = new Error(msg); e.codice = codice; return e; }
    function erroreRete(msg) { var e = new Error(msg); e.codice = 'rete'; e.rete = true; e.code = 'ERETE'; return e; }
    function rispondi(res, stato, o) {
      if (res.headersSent) { try { res.end(); } catch (e) {} return; }
      res.writeHead(stato, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(o));
    }
    function corpoJson(req, cb) {
      var parti = [], n = 0, rotto = false;
      req.on('data', function (c) { n += c.length; if (n > MAX_CORPO) { rotto = true; req.destroy(); } else parti.push(c); });
      req.on('end', function () {
        if (rotto) { cb(null); return; }
        try { var v = JSON.parse(Buffer.concat(parti).toString('utf8') || '{}'); cb(v && typeof v === 'object' && !Array.isArray(v) ? v : null); }
        catch (e) { cb(null); }
      });
    }
    function testo(s, max) { return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max); }
    function idBuono(x) { return typeof x === 'string' && new RegExp('^' + ID + '$').test(x); }
    // indirizzo del server: http(s)://host[:porta][/base], mai il TV stesso (solo le prove sul computer usano 127.0.0.1)
    function indirizzoBuono(urlLib, s, locale) {
      s = String(s || '').trim();
      if (!s || s.length > 300 || !/^[A-Za-z0-9._~:\/\-\[\]]+$/.test(s)) return '';
      if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
      var u = urlLib.parse(s);
      if (!u || !/^https?:$/.test(u.protocol || '') || !u.hostname || u.auth || u.search || u.hash) return '';
      var h = u.hostname.toLowerCase();
      if (!(locale && h === '127.0.0.1') && (h === 'localhost' || /^127\./.test(h) || h === '0.0.0.0' || h === '::1' || h === '[::1]' || /^0+(\.0+){3}$/.test(h))) return '';
      if (!/^[a-z0-9.\-\[\]:]+$/.test(h)) return '';
      var base = (u.pathname || '').replace(/\/+$/, '');
      if (!/^(\/[A-Za-z0-9._\-]+)*$/.test(base) || /\/\.\.?(\/|$)/.test(base)) return '';
      return u.protocol + '//' + u.host.toLowerCase() + base;
    }

    // i codec come li chiama Jellyfin (ffmpeg) -> le famiglie della videoteca
    var FAMIGLIE = { hevc: 'HEVC', h265: 'HEVC', h264: 'AVC', avc: 'AVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', mpeg2video: 'MPEG2',
      mpeg4: 'MPEG4', msmpeg4v3: 'VFW', vc1: 'VC1', eac3: 'EAC3', ac3: 'AC3', truehd: 'TRUEHD', mlp: 'TRUEHD', dts: 'DTS', dca: 'DTS',
      aac: 'AAC', mp3: 'MP3', mp2: 'MP2', flac: 'FLAC', opus: 'OPUS', vorbis: 'VORBIS', alac: 'ALAC', subrip: 'SRT', srt: 'SRT',
      ass: 'ASS', ssa: 'ASS', webvtt: 'VTT', vtt: 'VTT', pgssub: 'PGS', pgs: 'PGS', hdmv_pgs_subtitle: 'PGS', dvdsub: 'VOBSUB',
      dvd_subtitle: 'VOBSUB', mov_text: 'TX3G' };
    var JF_VIDEO = { HEVC: 'hevc', AVC: 'h264', AV1: 'av1', VP9: 'vp9', VP8: 'vp8', MPEG2: 'mpeg2video', MPEG4: 'mpeg4', VC1: 'vc1' };
    var JF_AUDIO = { EAC3: 'eac3', AC3: 'ac3', AAC: 'aac', MP3: 'mp3', MP2: 'mp2', OPUS: 'opus', VORBIS: 'vorbis', FLAC: 'flac',
      PCM: 'pcm_s16le,pcm_s24le', DTS: 'dts', TRUEHD: 'truehd' };
    function famigliaJf(c) {
      c = String(c || '').toLowerCase();
      return FAMIGLIE[c] || (/^pcm/.test(c) ? 'PCM' : c.toUpperCase());
    }
    // le qualita' del pannello: tetto in Mbps e larghezza massima (0 = nessuno)
    var QUALITA = { orig: { mbps: 0, larg: 0 }, '4k': { mbps: 80, larg: 3840 }, '1080': { mbps: 20, larg: 1920 }, '720': { mbps: 8, larg: 1280 } };
    // la qualita' "Automatica": dalla rete misurata (70%), con la larghezza che le va bene
    function qualitaAuto(mbps) {
      var m = Math.max(1, Math.floor((+mbps || 0) * 0.7));
      return { mbps: Math.min(m, 120), larg: m >= 40 ? 3840 : m >= 10 ? 1920 : m >= 4 ? 1280 : 854 };
    }
    // il profilo del TV per Jellyfin (come quello provato col Jellyfin 12.4 vero, prove/jellyfin/profilo-samsung-2022.json):
    // cosa legge diretto, e in cosa convertire (HLS a pezzi MPEG-TS: HEVC copiato funziona, e il TV lo legge da sempre)
    var GAMME = { h264: 'SDR', hevc: 'SDR|HDR10|HDR10Plus|HLG|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR', vp9: 'SDR|HDR10|HLG', av1: 'SDR|HDR10|HDR10Plus|HLG' };
    function profilo(letti, q) {
      var v = [], a = [], k;
      for (k in JF_VIDEO) if (letti.video[k]) v.push(JF_VIDEO[k]);
      for (k in JF_AUDIO) if (letti.audio[k] === true) a.push(JF_AUDIO[k]);
      var bps = q.mbps ? q.mbps * 1e6 : 400e6, cond = [];
      if (q.larg) cond.push({ Condition: 'LessThanEqual', Property: 'Width', Value: String(q.larg), IsRequired: true });
      var conv = ['eac3', 'ac3', 'aac'].filter(function (x) { return a.indexOf(x) >= 0; });
      function c(cond0, prop, val) { return { Condition: cond0, Property: prop, Value: val, IsRequired: false }; }
      var codec = [
        { Type: 'Video', Codec: 'h264', Conditions: [c('EqualsAny', 'VideoProfile', 'high|main|baseline|constrained baseline'), c('LessThanEqual', 'VideoLevel', '52'),
          c('LessThanEqual', 'VideoBitDepth', '8'), c('EqualsAny', 'VideoRangeType', GAMME.h264)] },
        { Type: 'Video', Codec: 'hevc', Conditions: [c('EqualsAny', 'VideoProfile', 'main|main 10'), c('LessThanEqual', 'VideoLevel', '183'),
          c('LessThanEqual', 'VideoBitDepth', '10'), c('EqualsAny', 'VideoRangeType', GAMME.hevc)] },
        { Type: 'Video', Codec: 'vp9', Conditions: [c('EqualsAny', 'VideoRangeType', GAMME.vp9)] },
        { Type: 'Video', Codec: 'av1', Conditions: [c('LessThanEqual', 'VideoBitDepth', '10'), c('EqualsAny', 'VideoRangeType', GAMME.av1)] }
      ];
      if (cond.length) codec.push({ Type: 'Video', Conditions: cond });
      return {
        Name: 'Home TV', MaxStreamingBitrate: bps, MaxStaticBitrate: bps, MusicStreamingTranscodingBitrate: 384000,
        DirectPlayProfiles: [{ Container: 'mkv,webm,mp4,m4v,mov,ts,m2ts', Type: 'Video', VideoCodec: v.join(','), AudioCodec: a.join(',') }],
        TranscodingProfiles: [{ Container: 'ts', Type: 'Video', Protocol: 'hls', Context: 'Streaming',
          VideoCodec: v.filter(function (x) { return x === 'hevc' || x === 'h264'; }).join(',') || 'h264',
          AudioCodec: conv.join(',') || 'aac', MaxAudioChannels: '6', MinSegments: 1, BreakOnNonKeyFrames: false }],
        ContainerProfiles: [], CodecProfiles: codec,
        // i sottotitoli li disegna l'app: Jellyfin non li brucia mai nel video
        SubtitleProfiles: ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'pgssub', 'dvdsub', 'mov_text'].map(function (f) { return { Format: f, Method: 'External' }; })
      };
    }

    /* ============================================================ il "fs" remoto: un file letto con le domande Range
     * open/read/close come quelli di Node, per la videoteca. Le letture grandi e di seguito (il film che passa) usano UNA
     * domanda tenuta aperta, con al massimo 4 MB in memoria; le piccole (struttura, Cues, sottotitoli) una domanda breve
     * di almeno 64 KB, tenuta per le letture vicine. Una lettura alla volta per file aperto. */
    function fsRemoto(chiedi, dim) {
      var aperti = {}, prossimo = 1;
      function chiudiFlusso(s) {
        var f = s.flusso;
        s.flusso = null;
        if (f) { f.morto = true; try { if (f.req) f.req.abort(); } catch (e) {} sveglia(f); }
      }
      function fai(s, x) {
        if (s.chiuso) { x.cb(erroreRete('file chiuso')); return; }
        var n = x.n, pos = x.pos, c = s.cache;
        if (pos >= dim || n <= 0) { x.cb(null, 0); return; }
        // dalla domanda breve tenuta
        if (c && pos >= c.a && pos < c.a + c.b.length) {
          var k = Math.min(n, c.a + c.b.length - pos);
          c.b.copy(x.b, x.off, pos - c.a, pos - c.a + k);
          x.cb(null, k);
          return;
        }
        var f = s.flusso;
        // dal flusso aperto: la posizione giusta, o poco piu' avanti (si saltano i byte in mezzo)
        if (f && !f.err && pos >= f.pos && pos - f.pos <= (1 << 20)) { prendi(s, f, x); return; }
        chiudiFlusso(s);
        if (n >= (128 << 10)) {
          f = s.flusso = { pos: pos, parti: [], len: 0, fine: false, err: null, attesa: null, pausa: false, morto: false, req: null, res: null };
          f.req = chiedi(pos, dim - 1, function (err, res) {
            if (f.morto) { if (res) { try { res.destroy(); } catch (e) {} } return; }
            if (err) { f.err = err; sveglia(f); return; }
            f.res = res;
            res.on('data', function (d) {
              if (f.morto) return;
              f.parti.push(d);
              f.len += d.length;
              if (f.len > (4 << 20) && !f.pausa) { f.pausa = true; res.pause(); }
              sveglia(f);
            });
            res.on('end', function () { f.fine = true; sveglia(f); });
            res.on('aborted', function () { if (!f.fine) { f.err = erroreRete('interrotto'); sveglia(f); } });
            res.on('error', function (e) { f.err = erroreRete(e.code || e.message); sveglia(f); });
          });
          prendi(s, f, x);
          return;
        }
        var quanti = Math.min(dim - pos, Math.max(n, 64 << 10)), parti = [], tot = 0, fatto = false;
        chiedi(pos, pos + quanti - 1, function (err, res) {
          if (err) { x.cb(err); return; }
          function fine() {
            if (fatto) return;
            fatto = true;
            var b = Buffer.concat(parti, tot);
            if (b.length > quanti) b = b.slice(0, quanti);
            s.cache = { a: pos, b: b };
            var k = Math.min(n, b.length);
            b.copy(x.b, x.off, 0, k);
            x.cb(null, k);
          }
          res.on('data', function (d) {
            if (fatto) return;
            parti.push(d);
            tot += d.length;
            if (tot < quanti) return;
            fine();
            // un server che non ascolta il Range manderebbe tutto il file: basta cosi'
            if (res.statusCode !== 206 || +res.headers['content-length'] > quanti) { try { res.destroy(); } catch (e) {} }
          });
          res.on('end', fine);
          res.on('aborted', function () { if (!fatto) { fatto = true; x.cb(erroreRete('interrotto')); } });
          res.on('error', function (e) { if (!fatto) { fatto = true; x.cb(erroreRete(e.code || e.message)); } });
        });
      }
      function sveglia(f) { var a = f.attesa; f.attesa = null; if (a) a(); }
      // dal flusso: prima si buttano i byte da saltare, poi si copia quello che c'e' (anche meno di n: leggi() richiede)
      function prendi(s, f, x) {
        function prova() {
          if (f.morto) { x.cb(erroreRete('file chiuso')); return; }
          while (f.pos < x.pos && f.len > 0) {
            var t = f.parti[0], via = Math.min(t.length, x.pos - f.pos);
            if (via === t.length) f.parti.shift(); else f.parti[0] = t.slice(via);
            f.len -= via;
            f.pos += via;
          }
          if (f.pos === x.pos && f.len > 0) {
            var k = 0;
            while (k < x.n && f.parti.length) {
              var p = f.parti[0], q = Math.min(p.length, x.n - k);
              p.copy(x.b, x.off + k, 0, q);
              if (q === p.length) f.parti.shift(); else f.parti[0] = p.slice(q);
              k += q;
            }
            f.len -= k;
            f.pos += k;
            if (f.pausa && f.len < (1 << 20) && f.res) { f.pausa = false; f.res.resume(); }
            x.cb(null, k);
            return;
          }
          if (f.err) { x.cb(f.err); return; }
          if (f.fine) { x.cb(null, 0); return; }
          f.attesa = prova;
        }
        prova();
      }
      function giro(s) {
        if (s.occupato || !s.coda.length) return;
        s.occupato = true;
        var x = s.coda.shift(), cb0 = x.cb, finito = false;
        x.cb = function (err, k) {
          if (finito) return;
          finito = true;
          s.occupato = false;
          setImmediate(function () { cb0(err, k || 0, x.b); giro(s); });
        };
        try { fai(s, x); } catch (e) { x.cb(erroreRete(e.message)); }
      }
      return {
        open: function (percorso, modo, cb) {
          var fd = prossimo++;
          aperti[fd] = { coda: [], occupato: false, cache: null, flusso: null, chiuso: false };
          setImmediate(function () { cb(null, fd); });
        },
        read: function (fd, b, off, n, pos, cb) {
          var s = aperti[fd];
          if (!s) { setImmediate(function () { cb(erroreRete('file non aperto')); }); return; }
          s.coda.push({ b: b, off: off, n: n, pos: pos, cb: cb });
          giro(s);
        },
        close: function (fd, cb) {
          var s = aperti[fd];
          delete aperti[fd];
          if (s) { s.chiuso = true; chiudiFlusso(s); s.cache = null; }
          if (cb) setImmediate(cb);
        },
        _aperti: function () { return Object.keys(aperti).length; }
      };
    }


    /* ============================================================ la velocita' del TV (per convertire l'audio DTS e TrueHD)
     * Due lavori tipici dei codec audio, in WebAssembly senza SIMD (come lo avrebbe il convertitore) e in JavaScript: da
     * prove/audio-tv/misura_tv.js. Il rapporto col Mac di riferimento stima quanto costerebbe la conversione sul TV
     * (prove/audio-tv/PROGETTO.md). A fette: tra un giro e l'altro il servizio risponde agli altri. */
    var NUCLEI = 'AGFzbQEAAAABEQJgBX9/f39/AGAEf399fwF/AwMCAAEFAwEAQAcVAwNtZW0CAANmaXIAAAVxdWFudAABCt0BAngDAn8BfQJ/AkADQCAFIANPDQFDAAAAACEHIAAgBUECdGohCCABIQlBACEGAkADQCAGIARPDQEgByAIKgIAIAkqAgCUkiEHIAhBBGohCCAJQQRqIQkgBkEBaiEGDAALCyACIAVBAnRqIAc4AgAgBUEBaiEFDAALCwtiAgN/AX0CQANAIAQgAU8NASAAIARBAnRqKgIAiyAClCEHIAdDl5DPPpKoIQUgBUEPSgRAQQ8hBQsgBiADIAVqLQAAaiEGIAVBAEcEQCAGQQFqIQYLIARBAWohBAwACwsgBgsAbQRuYW1lAkQCAAoAAXgBAWgCAW8DAW4EAXQFAWkGAWsHA2FjYwgCcHgJAnBoAQgAAWMBAW4CAXMDA3RhYgQBaQUBcQYEYml0cwcBdgMgAgAEAARmaW5lAQJsaQICZmsDAmxrAQIABGZpbmUBAWw=';
    var MC = { N: 48000, T: 64, NQ: 48000 * 6, GIRI: 20, X: 0, H: 200000, O: 400000, C: 600000, TAB: 2000000,
      // il Mac di riferimento (Apple M5, Node 22): ms per 20 giri; e i ms di WebAssembly per secondo d'audio delle conversioni
      RIF: { fir: 15.7, quant: 7.5 }, DTS_AC3: 8.7, TRUEHD_AC3: 17.8 };
    function misuraCpu(cb) {
      var x = new Float32Array(MC.N + MC.T), h = new Float32Array(MC.T), o = new Float32Array(MC.N), c = new Float32Array(MC.NQ);
      var tab = new Uint8Array(16), i, k, sm = 12345;
      function riempi(a) { for (var j = 0; j < a.length; j++) { sm = (sm * 1103515245 + 12345) & 0x7fffffff; a[j] = (sm / 0x7fffffff) * 2 - 1; } }
      riempi(x); riempi(h); riempi(c);
      for (i = 0; i < 16; i++) tab[i] = 1 + (i >> 1);
      function firJs() { for (var a = 0; a < MC.N; a++) { var acc = 0; for (var b = 0; b < MC.T; b++) acc += x[a + b] * h[b]; o[a] = acc; } }
      function quantJs() { var bits = 0; for (var a = 0; a < MC.NQ; a++) { var q = (Math.abs(c[a]) * 7.5 + 0.4054) | 0; if (q > 15) q = 15; bits += tab[q]; if (q) bits++; } return bits; }
      function adesso() { var t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; }
      var e = null, compilazione = 0;
      if (typeof WebAssembly === 'object') {
        try {
          var t0 = adesso(), b = bufDa64(NUCLEI);
          e = new WebAssembly.Instance(new WebAssembly.Module(b), {}).exports;
          compilazione = adesso() - t0;
          new Float32Array(e.mem.buffer, MC.X, MC.N + MC.T).set(x);
          new Float32Array(e.mem.buffer, MC.H, MC.T).set(h);
          new Float32Array(e.mem.buffer, MC.C, MC.NQ).set(c);
          new Uint8Array(e.mem.buffer, MC.TAB, 16).set(tab);
        } catch (err) { e = null; }
      }
      // i lavori, un giro alla volta (prima un giro di riscaldamento per il JIT)
      var lavori = [['js', 'fir', firJs], ['js', 'quant', quantJs]];
      if (e) lavori.push(['wasm', 'fir', function () { e.fir(MC.X, MC.H, MC.O, MC.N, MC.T); }], ['wasm', 'quant', function () { e.quant(MC.C, MC.NQ, 7.5, MC.TAB); }]);
      var out = { js: { fir: 0, quant: 0 }, wasm: e ? { fir: 0, quant: 0, compilazione: Math.round(compilazione * 10) / 10 } : null }, n = 0, g = -1;
      (function passo() {
        if (n >= lavori.length) { finisci(); return; }
        var l = lavori[n], t1 = adesso();
        l[2]();
        if (g >= 0) out[l[0]][l[1]] += adesso() - t1;
        if (++g >= MC.GIRI) { g = -1; n++; }
        setImmediate(passo);
      })();
      function finisci() {
        for (var a in out) if (out[a]) for (k in out[a]) out[a][k] = Math.round(out[a][k] * 10) / 10;
        var wt = false;
        try { wt = !!require('worker_threads'); } catch (err2) { wt = false; }
        out.node = process.version;
        out.arch = process.arch;
        out.workerThreads = wt;
        if (out.wasm) {
          var r = (out.wasm.fir / MC.RIF.fir + out.wasm.quant / MC.RIF.quant) / 2;
          out.rapporto = Math.round(r * 10) / 10;
          // la quota di un core per convertire in tempo reale (x1,15: WebAssembly senza SIMD)
          out.dtsAc3 = Math.round(MC.DTS_AC3 * r * 1.15 / 10) / 100;
          out.truehdAc3 = Math.round(MC.TRUEHD_AC3 * r * 1.15 / 10) / 100;
        }
        cb(out);
      }
    }
    function bufDa64(s) { return typeof Buffer.from === 'function' && Buffer.from !== Uint8Array.from ? Buffer.from(s, 'base64') : new Buffer(s, 'base64'); }

    function crea(o) {
      var http = o.http, https = o.https, urlLib = o.url, fs = o.fs, path = o.path, vt = o.videoteca;
      var log = typeof o.log === 'function' ? o.log : function () {};
      var FILE = path.join(o.cartella, 'jellyfin.json');
      var agenti = { 'http:': new http.Agent({ keepAlive: true, maxSockets: 8 }), 'https:': https ? new https.Agent({ keepAlive: true, maxSockets: 8 }) : null };
      var cfg = carica();
      function carica() {
        var c = null;
        try { c = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { c = null; }
        if (!c || typeof c !== 'object') c = {};
        if (!/^[0-9a-f]{32}$/.test(c.dispositivo || '')) c.dispositivo = o.crypto.randomBytes(16).toString('hex');
        if (!indirizzoBuono(urlLib, c.indirizzo, o.locale) || c.indirizzo !== indirizzoBuono(urlLib, c.indirizzo, o.locale)) { c.indirizzo = ''; c.token = ''; c.utente = null; }
        return c;
      }
      function salva() {
        var tmp = FILE + '.tmp';
        try {
          // un .tmp rimasto (servizio spento a meta') potrebbe avere altri permessi: si rifa' da capo
          try { fs.unlinkSync(tmp); } catch (e0) {}
          fs.writeFileSync(tmp, JSON.stringify(cfg), { mode: 384 }); // 0600: solo il servizio
          fs.renameSync(tmp, FILE);
        } catch (e) { log('Jellyfin: non riesco a salvare (' + (e.code || e.message) + ')'); }
      }
      function dimentica() { cfg.token = ''; cfg.utente = null; salva(); sorgenti = {}; }
      function letti() { var x = typeof o.letti === 'function' ? o.letti() : o.letti; return x && x.audio && x.video ? x : { audio: {}, video: {} }; }

      /* ---------------------------------------------------------- le domande verso Jellyfin */

      var nomeTv = { at: 0, v: '' }; // il nome del TV per Jellyfin, ricalcolato al massimo ogni minuto
      function autorizzazione(conToken) {
        if (!nomeTv.v || Date.now() - nomeTv.at > 60000) {
          var x = '';
          try { x = typeof o.nomeTv === 'function' ? o.nomeTv() : o.nomeTv; } catch (e) { x = ''; }
          nomeTv = { at: Date.now(), v: String(x || 'TV').replace(/[^A-Za-z0-9 ._\-]/g, '').slice(0, 60) || 'TV' };
        }
        var s = 'MediaBrowser Client="Home TV", Device="' + nomeTv.v + '", DeviceId="' + cfg.dispositivo + '", Version="' + VERSIONE + '"';
        return conToken && cfg.token ? s + ', Token="' + cfg.token + '"' : s;
      }
      // una domanda al server salvato (o a "dove", per il controllo prima di salvarlo). cb(err, res) con la risposta aperta
      function apriDomanda(x, cb) {
        var base = x.dove || cfg.indirizzo;
        if (!base) { cb(errore('server', 'nessun server Jellyfin')); return null; }
        var u = urlLib.parse(base + '/' + x.percorso + (x.query ? '?' + x.query : ''));
        var mod = u.protocol === 'https:' ? https : http;
        if (!mod) { cb(errore('server', 'https non disponibile')); return null; }
        var testa = { 'Accept': x.accetta || 'application/json', 'Accept-Encoding': 'identity', 'Authorization': autorizzazione(x.token !== false) };
        if (x.range) testa.Range = x.range;
        var corpo = x.corpo !== undefined ? bufDa(JSON.stringify(x.corpo)) : null;
        if (corpo) { testa['Content-Type'] = 'application/json'; testa['Content-Length'] = String(corpo.length); }
        var finito = false, timer = null;
        function ferma() { if (timer) { clearTimeout(timer); timer = null; } }
        function fine(e, r) {
          if (finito) { if (r) { try { r.destroy(); } catch (z) {} } return; }
          finito = true;
          if (e || x.lungo) ferma();
          if (r && !x.lungo) { r.on('end', ferma); r.on('aborted', ferma); r.on('error', ferma); r.on('close', ferma); }
          cb(e, r);
        }
        // le domande lunghe (il film, i pezzi HLS) su una connessione loro; le brevi riusano le connessioni aperte
        var req = mod.request({ protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, method: x.metodo || 'GET',
          headers: testa, agent: x.lungo ? false : agenti[u.protocol] || undefined }, function (r) { fine(null, r); });
        req.on('error', function (e) { ferma(); fine(erroreRete(e.code || e.message)); });
        // un tempo per la risposta (e per il corpo, nelle brevi); gli stream del video, una volta partiti, non hanno limite
        timer = setTimeout(function () { timer = null; try { req.abort(); } catch (e) {} fine(erroreRete('tempo scaduto')); }, x.tempo || 8000);
        if (corpo) req.write(corpo);
        req.end();
        return req;
      }
      // una domanda breve con la risposta in JSON (o in byte: x.byte)
      function chiedi(x, cb) {
        apriDomanda(x, function (err, r) {
          if (err) { cb(err); return; }
          var parti = [], n = 0, max = x.max || MAX_JSON, rotto = false;
          r.on('data', function (d) { if (rotto) return; n += d.length; if (n > max) { rotto = true; try { r.destroy(); } catch (e) {} cb(errore('server', 'risposta troppo grande')); } else parti.push(d); });
          r.on('end', function () {
            if (rotto) return;
            if (r.statusCode === 401 && x.token !== false && cfg.token) { dimentica(); cb(errore('accesso', 'accesso scaduto')); return; }
            var b = Buffer.concat(parti, n), v = null;
            if (x.byte) { cb(null, r.statusCode, b, r); return; }
            if (b.length) { try { v = JSON.parse(b.toString('utf8')); } catch (e) { v = null; } }
            cb(null, r.statusCode, v, r);
          });
          r.on('aborted', function () { if (!rotto) { rotto = true; cb(erroreRete('interrotto')); } });
          r.on('error', function (e) { if (!rotto) { rotto = true; cb(erroreRete(e.code || e.message)); } });
        });
      }

      /* ---------------------------------------------------------- server, accesso */

      function statoPubblico() {
        // letti: i codec che questo TV legge (l'app mostra prima di partire cosa passa diretto e cosa converte il server)
        return { server: cfg.indirizzo ? { indirizzo: cfg.indirizzo, nome: cfg.nome || '', versione: cfg.versione || '', id: cfg.id || '' } : null,
          utente: cfg.token && cfg.utente ? { id: cfg.utente.id, nome: cfg.utente.nome } : null, letti: letti(),
          // per le prove sul TV (pannello Info del lettore): quanta memoria usa il servizio, e da quanto e' acceso
          servizio: { memoria: Math.round(process.memoryUsage().rss / 1e6), node: process.version, acceso: Math.round(process.uptime()) } };
      }
      // i server Jellyfin nella rete di casa (rispondono al broadcast UDP 7359 con il loro indirizzo)
      function cerca(cb) {
        var trovati = {}, s, fatto = false;
        function fine() {
          if (fatto) return;
          fatto = true;
          try { s.close(); } catch (e) {}
          cb(Object.keys(trovati).map(function (k) { return trovati[k]; }));
        }
        try { s = o.dgram.createSocket('udp4'); } catch (e) { cb([]); return; }
        s.on('error', fine);
        s.on('message', function (msg) {
          var j = null;
          try { j = JSON.parse(msg.toString('utf8', 0, Math.min(msg.length, 4096))); } catch (e) { return; }
          var ind = j && indirizzoBuono(urlLib, j.Address, o.locale);
          if (ind && idBuono(String(j.Id || '').replace(/-/g, '')) && Object.keys(trovati).length < 10) {
            trovati[ind] = { indirizzo: ind, nome: testo(j.Name, 100), id: String(j.Id).replace(/-/g, '').toLowerCase() };
          }
        });
        s.bind(function () {
          try {
            s.setBroadcast(true);
            var m = bufDa('Who is JellyfinServer?');
            s.send(m, 0, m.length, 7359, '255.255.255.255');
          } catch (e) { fine(); }
        });
        setTimeout(fine, 2000);
      }
      // al massimo 20 indirizzi provati ogni 10 minuti: il ponte non deve diventare un modo per esplorare la rete di casa
      var prove = [];
      function scegliServer(dove, cb) {
        var ind = indirizzoBuono(urlLib, dove, o.locale), ora = Date.now();
        if (!ind) { cb(errore('indirizzo', 'indirizzo non valido')); return; }
        prove = prove.filter(function (t) { return ora - t < 600000; });
        if (prove.length >= 20) { cb(errore('troppe', 'troppi indirizzi provati: aspetta qualche minuto')); return; }
        prove.push(ora);
        chiedi({ dove: ind, percorso: 'System/Info/Public', token: false, tempo: 5000, max: 65536 }, function (err, st, j) {
          if (err) { cb(err.codice === 'rete' ? errore('rete', 'il server non risponde') : err); return; }
          var id = j && typeof j.Id === 'string' ? j.Id.replace(/-/g, '').toLowerCase() : '';
          if (st !== 200 || !idBuono(id) || typeof j.Version !== 'string') { cb(errore('jellyfin', 'non e\' un server Jellyfin')); return; }
          if (cfg.id !== id || cfg.indirizzo !== ind) { cfg.token = ''; cfg.utente = null; }
          cfg.indirizzo = ind;
          cfg.id = id;
          cfg.nome = testo(j.ServerName, 100);
          cfg.versione = testo(j.Version, 40);
          sorgenti = {};
          salva();
          cb(null);
        });
      }
      function accesso(j, cb) {
        var u = j && j.User, tok = j && j.AccessToken;
        if (!u || !idBuono(String(u.Id || '')) || typeof tok !== 'string' || !/^[A-Za-z0-9._\-]{16,200}$/.test(tok)) { cb(errore('accesso', 'risposta strana')); return; }
        cfg.token = tok;
        cfg.utente = { id: String(u.Id).toLowerCase(), nome: testo(u.Name, 100) };
        salva();
        log('Jellyfin: entrato come ' + cfg.utente.nome);
        cb(null);
      }
      var misurando = false;
      var qc = null; // Quick Connect in corso: { segreto, codice, da } (il segreto non esce dal servizio)
      function qcInizia(cb) {
        chiedi({ percorso: 'QuickConnect/Initiate', metodo: 'POST', token: false, tempo: 5000, max: 65536 }, function (err, st, j) {
          if (err) { cb(err); return; }
          if (st === 401 || st === 403 || st === 404 || !j || typeof j.Secret !== 'string' || typeof j.Code !== 'string') {
            cb(errore('quickconnect', 'Quick Connect spento sul server'));
            return;
          }
          qc = { segreto: j.Secret, codice: testo(j.Code, 20), da: Date.now() };
          cb(null, { codice: qc.codice });
        });
      }
      function qcControlla(cb) {
        if (!qc) { cb(null, { stato: 'nessuno' }); return; }
        if (Date.now() - qc.da > 10 * 60000) { qc = null; cb(null, { stato: 'scaduto' }); return; }
        var x = qc;
        chiedi({ percorso: 'QuickConnect/Connect', query: 'secret=' + encodeURIComponent(x.segreto), token: false, tempo: 5000, max: 65536 }, function (err, st, j) {
          if (err) { cb(err); return; }
          if (st === 404 || st === 400) { if (qc === x) qc = null; cb(null, { stato: 'scaduto' }); return; }
          if (!j || j.Authenticated !== true) { cb(null, { stato: 'attesa', codice: x.codice }); return; }
          chiedi({ percorso: 'Users/AuthenticateWithQuickConnect', metodo: 'POST', corpo: { Secret: x.segreto }, token: false, tempo: 8000, max: 262144 }, function (e2, st2, j2) {
            if (e2) { cb(e2); return; }
            if (qc === x) qc = null;
            if (st2 !== 200) { cb(null, { stato: 'scaduto' }); return; }
            accesso(j2, function (e3) { if (e3) cb(e3); else cb(null, { stato: 'fatto', utente: { nome: cfg.utente.nome } }); });
          });
        });
      }
      function accedi(nome, pw, cb) {
        chiedi({ percorso: 'Users/AuthenticateByName', metodo: 'POST', corpo: { Username: testo(nome, 200), Pw: String(pw || '').slice(0, 500) },
          token: false, tempo: 10000, max: 262144 }, function (err, st, j) {
          if (err) { cb(err); return; }
          if (st === 401 || st === 403) { cb(errore('password', 'nome o password sbagliati')); return; }
          if (st !== 200) { cb(errore('server', 'il server ha risposto ' + st)); return; }
          accesso(j, cb);
        });
      }

      /* ---------------------------------------------------------- le sorgenti (i file veri dei film) */

      var sorgenti = {}; // id:ms -> { x (per la videoteca), ms (MediaSource di Jellyfin), at }
      function chiaveSorgente(id, ms) { return String(id).toLowerCase() + ':' + String(ms || '').toLowerCase(); }
      function ricordaSorgente(id, msid, ms) {
        var est = estDi(ms), k0 = chiaveSorgente(id, msid), gia = sorgenti[k0];
        if (!est) return null;
        var dim = +ms.Size || 0;
        if (gia && gia.x.dim === dim && gia.x.est === est) { gia.at = Date.now(); gia.ms = ms; return gia; }
        var x = { percorso: 'jf:' + cfg.id + ':' + id + ':' + msid, nome: testo(path.basename(String(ms.Path || ms.Name || id)), 200),
          dim: dim, data: 0, est: est, fs: null };
        x.fs = fsRemoto(function (a, z, cb) {
          return apriDomanda({ percorso: 'Videos/' + id + '/stream', query: 'static=true&mediaSourceId=' + msid, accetta: '*/*',
            range: 'bytes=' + a + '-' + z, tempo: 15000, lungo: z - a >= (1 << 20) }, function (err, r) {
            if (err) { cb(err.rete ? err : erroreRete(err.message)); return; }
            var cr = String(r.headers['content-range'] || ''), m = /^bytes (\d+)-/.exec(cr);
            if (r.statusCode === 206 && m && +m[1] === a) { cb(null, r); return; }
            if (r.statusCode === 200 && a === 0) { cb(null, r); return; }
            try { r.destroy(); } catch (e) {}
            cb(erroreRete('il server ha risposto ' + r.statusCode));
          });
        }, dim);
        var k = chiaveSorgente(id, msid), l = Object.keys(sorgenti);
        sorgenti[k] = { x: x, ms: ms, at: Date.now() };
        if (l.length >= 20) {
          l.sort(function (p, q) { return sorgenti[p].at - sorgenti[q].at; });
          delete sorgenti[l[0]];
        }
        return sorgenti[k];
      }
      // il contenitore che la strada diretta sa leggere: MKV, WebM, MP4 (dal nome del file, o da quello di Jellyfin)
      function estDi(ms) {
        var e = (/\.([a-z0-9]{2,5})$/i.exec(String(ms.Path || '')) || ['', ''])[1].toLowerCase(), c = String(ms.Container || '').toLowerCase();
        if (/^(mkv|webm|mk3d|mp4|m4v|mov)$/.test(e)) return e === 'mk3d' ? 'mkv' : e;
        if (/^(mkv|matroska)/.test(c)) return 'mkv';
        if (/^webm/.test(c)) return 'webm';
        if (/(^|,)(mp4|mov|m4v)(,|$)/.test(c)) return 'mp4';
        return '';
      }
      function sorgenteDi(id, msid, cb) {
        var k = chiaveSorgente(id, msid), s = sorgenti[k];
        if (s && Date.now() - s.at < 6 * 3600000) { s.at = Date.now(); cb(null, s); return; }
        if (!cfg.token || !cfg.utente) { cb(errore('accesso', 'serve l\'accesso a Jellyfin')); return; }
        chiedi({ percorso: 'Items/' + id, query: 'userId=' + cfg.utente.id }, function (err, st, j) {
          if (err) { cb(err); return; }
          if (st !== 200 || !j) { cb(errore('assente', 'film non trovato')); return; }
          var l = Array.isArray(j.MediaSources) ? j.MediaSources : [], ms = null;
          for (var i = 0; i < l.length; i++) if (!msid || String(l[i].Id).toLowerCase() === msid) { ms = l[i]; break; }
          if (!ms || !idBuono(String(ms.Id || ''))) { cb(errore('assente', 'file non trovato')); return; }
          sorgenteDaMs(id, String(ms.Id).toLowerCase(), ms, cb);
        });
      }
      // la dimensione non c'e' nella scheda: la dice il server con la prima domanda Range
      function sorgenteDaMs(id, msid, ms, cb) {
        if (!estDi(ms)) { cb(errore('formato', 'contenitore non adatto alla strada diretta')); return; }
        if (+ms.Size > 0) { cb(null, ricordaSorgente(id, msid, ms)); return; }
        apriDomanda({ percorso: 'Videos/' + id + '/stream', query: 'static=true&mediaSourceId=' + msid, accetta: '*/*', range: 'bytes=0-0', tempo: 8000 }, function (e2, res) {
          if (e2) { cb(e2); return; }
          res.resume();
          var m = /\/(\d+)$/.exec(String(res.headers['content-range'] || ''));
          if (!m || !(+m[1] > 0)) { cb(errore('server', 'dimensione del file sconosciuta')); return; }
          ms.Size = +m[1];
          cb(null, ricordaSorgente(id, msid, ms));
        });
      }

      /* ---------------------------------------------------------- la strada per guardare */

      function flussi(ms, tipo) { return (Array.isArray(ms.MediaStreams) ? ms.MediaStreams : []).filter(function (s) { return s && s.Type === tipo; }); }
    // il decoder del TV legge questo video? La famiglia, e profilo, bit e HDR che i Samsung reggono (H.264 solo 8 bit, HEVC fino
    // a 10; il Dolby Vision senza la base HDR10, profilo 5, sui TV senza Dolby Vision ha i colori sbagliati)
    function videoLeggibile(v, L) {
      if (!v) return false;
      var f = famigliaJf(v.Codec), pr = String(v.Profile || '').toLowerCase(), b = +v.BitDepth || 8, r = String(v.VideoRangeType || '');
      if (!L.video[f]) return false;
      if (f === 'AVC' && (b > 8 || /10|422|444|4:2:2|4:4:4/.test(pr))) return false;
      if (f === 'HEVC' && (b > 10 || /rext|444|4:4:4|scc|12/.test(pr))) return false;
      if (f === 'AV1' && b > 10) return false;
      return r !== 'DOVI';
    }
    // i motivi della conversione: nel campo, o (Jellyfin 12.4) solo in fondo all'indirizzo
    function motiviDi(ms) {
      if (Array.isArray(ms.TranscodeReasons)) return ms.TranscodeReasons;
      var m = /[?&]TranscodeReasons=([^&]*)/i.exec(String(ms.TranscodingUrl || ''));
      return m ? decodeURIComponent(m[1]).split(',').filter(Boolean) : [];
    }
      function guarda(id, q, cb) {
        if (!cfg.token || !cfg.utente) { cb(errore('accesso', 'serve l\'accesso a Jellyfin')); return; }
        var L = letti(), qual = q.q === 'auto' ? qualitaAuto(q.mbps) : QUALITA[q.q] || QUALITA.orig;
        var corpo = { UserId: cfg.utente.id, DeviceProfile: profilo(L, qual), MaxStreamingBitrate: qual.mbps ? qual.mbps * 1e6 : 400e6,
          StartTimeTicks: Math.max(0, Math.floor(+q.t || 0)) * 10000, EnableDirectPlay: true, EnableDirectStream: true, EnableTranscoding: true,
          AllowVideoStreamCopy: true, AllowAudioStreamCopy: true, AutoOpenLiveStream: true, SubtitleStreamIndex: -1 };
        if (idBuono(String(q.ms || ''))) corpo.MediaSourceId = String(q.ms).toLowerCase();
        if (q.a !== undefined && q.a !== '' && isFinite(+q.a) && +q.a >= 0) corpo.AudioStreamIndex = +q.a;
        // l'audio scelto vale solo col MediaSourceId (senza, Jellyfin lo ignora in silenzio): se manca, prima la scheda
        if (corpo.AudioStreamIndex !== undefined && !corpo.MediaSourceId) {
          chiedi({ percorso: 'Items/' + id, query: 'userId=' + cfg.utente.id }, function (e0, st0, it) {
            var l = it && Array.isArray(it.MediaSources) ? it.MediaSources : [];
            if (e0 || st0 !== 200 || !l[0] || !idBuono(String(l[0].Id || ''))) { cb(e0 || errore('assente', 'film non trovato')); return; }
            q.ms = String(l[0].Id).toLowerCase();
            guarda(id, q, cb);
          });
          return;
        }
        chiedi({ percorso: 'Items/' + id + '/PlaybackInfo', query: 'userId=' + cfg.utente.id, metodo: 'POST', corpo: corpo, tempo: 20000 }, function (err, st, j) {
          if (err) { cb(err); return; }
          if (st !== 200 || !j || !Array.isArray(j.MediaSources) || !j.MediaSources.length) { cb(errore('assente', 'il server non da\' il film')); return; }
          var ms = j.MediaSources[0];
          if (corpo.MediaSourceId) for (var i = 0; i < j.MediaSources.length; i++) if (String(j.MediaSources[i].Id).toLowerCase() === corpo.MediaSourceId) ms = j.MediaSources[i];
          var msid = String(ms.Id || '').toLowerCase();
          if (!idBuono(msid)) { cb(errore('assente', 'file non trovato')); return; }
          var video = flussi(ms, 'Video')[0] || null, audio = flussi(ms, 'Audio'), sub = flussi(ms, 'Subtitle');
          var fv = video ? famigliaJf(video.Codec) : '', audioLetti = audio.filter(function (s) { return L.audio[famigliaJf(s.Codec)]; });
          var mbps = (+ms.Bitrate || 0) / 1e6, larg = video ? +video.Width || 0 : 0, vl = videoLeggibile(video, L);
          // dentro la qualita' scelta (un bitrate sconosciuto non obbliga a convertire)
          var dentro = !qual.mbps || ((!mbps || mbps <= qual.mbps) && (!qual.larg || larg <= qual.larg));
          var out = { ms: msid, sessione: testo(j.PlaySessionId, 64), durata: Math.round((+ms.RunTimeTicks || 0) / 1e4), mbps: Math.round(mbps * 10) / 10,
            contenitore: testo(ms.Container, 40), dim: +ms.Size || 0,
            video: video ? { codec: fv, largh: larg, alt: +video.Height || 0, hdr: testo(video.VideoRangeType || video.VideoRange, 20), letto: vl,
              bit: +video.BitDepth || 0, profilo: testo(video.Profile, 30) } : null,
            audio: audio.map(function (s) { return { indice: s.Index, codec: famigliaJf(s.Codec), lingua: testo(s.Language, 8), nome: testo(s.DisplayTitle || s.Title, 120),
              canali: +s.Channels || 0, predefinita: !!s.IsDefault, letto: !!L.audio[famigliaJf(s.Codec)] }; }),
            sotto: sub.map(function (s) { return { indice: s.Index, codec: famigliaJf(s.Codec), lingua: testo(s.Language, 8), nome: testo(s.DisplayTitle || s.Title, 120),
              forzata: !!s.IsForced, predefinita: !!s.IsDefault, esterno: !!s.IsExternal }; }),
            motivi: motiviDi(ms).slice(0, 10).map(function (x) { return testo(x, 60); }) };
          // l'audio che si sente (indice di Jellyfin): quello chiesto, o quello che Jellyfin sceglie da solo
          out.audioScelto = corpo.AudioStreamIndex !== undefined ? corpo.AudioStreamIndex : typeof ms.DefaultAudioStreamIndex === 'number' ?
            ms.DefaultAudioStreamIndex : audio[0] ? audio[0].Index : -1;
          // l'audio scelto (indice di Jellyfin): se il TV non lo legge, lo converte il server
          var scelto = corpo.AudioStreamIndex !== undefined ? audio.filter(function (s) { return s.Index === corpo.AudioStreamIndex; })[0] : null;
          var diretto = estDi(ms) && vl && (audioLetti.length || !audio.length) && dentro &&
            (!scelto || L.audio[famigliaJf(scelto.Codec)] === true) && String(ms.Protocol || 'File') === 'File' && !ms.IsRemote;
          if (diretto) {
            out.modo = 'diretto';
            out.url = 'jf/file/' + id + '?ms=' + msid;
            sorgenteDaMs(id, msid, ms, function (e2) { if (e2) cb(e2); else cb(null, out); });
            return;
          }
          // un contenitore che il "vuoto" non conosce (.ts, .m2ts) ma che va bene cosi' com'e': il file vero, dal server
          if (ms.SupportsDirectPlay === true && vl && dentro && !estDi(ms) && String(ms.Protocol || 'File') === 'File' && !ms.IsRemote &&
              (!scelto || L.audio[famigliaJf(scelto.Codec)] === true)) {
            var cont = (String(ms.Container || 'ts').split(',')[0] || 'ts').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'ts';
            out.modo = 'file';
            out.url = 'jf/p/Videos/' + id + '/stream.' + cont + '?Static=true&MediaSourceId=' + msid + (ms.ETag ? '&Tag=' + encodeURIComponent(String(ms.ETag).slice(0, 64)) : '');
            cb(null, out);
            return;
          }
          if (typeof ms.TranscodingUrl !== 'string' || !ms.TranscodingUrl) { cb(errore('formato', 'il server non sa convertire questo film per il TV')); return; }
          // "copia": il video resta quello vero (cambia l'audio o il contenitore); "converti": il server rifa' il video
          var videoRifatto = out.motivi.some(function (x) { return /^Video|^ContainerBitrate|^Refs|^Interlaced|^Anamorphic|^Unknown/.test(x); });
          out.modo = vl && dentro && !videoRifatto ? 'copia' : 'converti';
          out.url = 'jf/p/' + senzaChiavi(ms.TranscodingUrl.replace(/^\/+/, ''));
          // i sottotitoli dentro il file si leggono dal file vero, come nella strada diretta
          if (estDi(ms) === 'mkv' || estDi(ms) === 'webm') { sorgenteDaMs(id, msid, ms, function () { cb(null, out); }); return; }
          cb(null, out);
        });
      }

      // quanti Mbps arrivano dal server (per la qualita' "Automatica"): 8 MB, e 32 se e' veloce
      function veloce(cb) {
        function prova(n, poi) {
          var t0 = Date.now();
          chiedi({ percorso: 'Playback/BitrateTest', query: 'size=' + n, accetta: '*/*', byte: true, max: n + 1024, tempo: 20000 }, function (err, st, b) {
            if (err) { cb(err); return; }
            if (st !== 200 || !b || b.length < n * 0.9) { cb(errore('server', 'misura non riuscita')); return; }
            poi(b.length * 8 / Math.max(1, Date.now() - t0) / 1000);
          });
        }
        prova(8 << 20, function (m) {
          if (m < 200) { cb(null, { mbps: Math.round(m) }); return; }
          prova(32 << 20, function (m2) { cb(null, { mbps: Math.round(m2) }); });
        });
      }

      /* ---------------------------------------------------------- tutto il resto: i percorsi della lista */

      function inoltra(req, res, percorso, u, ponte) {
        var metodo = req.method;
        if (!inLista(metodo, percorso)) { rispondi(res, 403, { error: 'percorso non permesso', codice: 'lista' }); return; }
        if (!cfg.token || !cfg.utente) { rispondi(res, 401, { error: 'serve l\'accesso a Jellyfin', codice: 'accesso' }); return; }
        var query = senzaChiavi('?' + (String(u.search || '').replace(/^\?/, ''))).replace(/^\?/, '');
        if (/^Videos\/ActiveEncodings$/i.test(percorso)) query = query.replace(/(^|&)DeviceId=[^&]*/ig, '') + (query ? '&' : '') + 'DeviceId=' + cfg.dispositivo;
        function vai(corpo) {
          var lungo = /^Videos\/[^\/]+\/(stream|hls1\/)/i.test(percorso);
          var img = /\/Images\/|\/Trickplay\//i.test(percorso), acc = String(req.headers.accept || '');
          var dr = apriDomanda({ percorso: percorso, query: query.replace(/^&/, ''), metodo: metodo, corpo: corpo,
            accetta: img && /^[\w\/*+.,;=\s-]{1,200}$/.test(acc) ? acc : '*/*',
            range: req.headers.range, tempo: lungo || /\.m3u8$/i.test(percorso) ? 60000 : 15000, lungo: lungo }, function (err, r) {
            if (err) { rispondi(res, 502, { error: err.message, codice: 'rete' }); return; }
            if (r.statusCode === 401 && cfg.token) { r.resume(); dimentica(); rispondi(res, 401, { error: 'accesso scaduto', codice: 'accesso' }); return; }
            var tipo = String(r.headers['content-type'] || '');
            if (/mpegurl/i.test(tipo) || /\.m3u8$/i.test(percorso)) {
              var parti = [], n = 0, rotto = false;
              r.on('data', function (d) { n += d.length; if (n > MAX_PLAYLIST) { rotto = true; try { r.destroy(); } catch (e) {} } else parti.push(d); });
              r.on('end', function () {
                if (rotto) { rispondi(res, 502, { error: 'playlist troppo grande', codice: 'server' }); return; }
                var b = bufDa(riscriviPlaylist(Buffer.concat(parti, n).toString('utf8'), cfg.indirizzo, ponte));
                res.writeHead(r.statusCode, { 'Content-Type': tipo || 'application/vnd.apple.mpegurl', 'Content-Length': String(b.length),
                  'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
                res.end(b);
              });
              r.on('error', function () { try { res.destroy(); } catch (e) {} });
              return;
            }
            var testa = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length' };
            ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'].forEach(function (k) {
              if (r.headers[k] !== undefined) testa[k] = r.headers[k];
            });
            testa['Cache-Control'] = /\/Images\/|\/Trickplay\//i.test(percorso) && r.statusCode === 200 ? 'max-age=86400' : 'no-store';
            res.writeHead(r.statusCode, testa);
            if (metodo === 'HEAD') { r.resume(); res.end(); return; }
            r.pipe(res);
            r.on('aborted', function () { try { res.destroy(); } catch (e) {} });
            r.on('error', function () { try { res.destroy(); } catch (e) {} });
          });
          // il <video> chiude (salto, fine): si chiude anche la domanda verso il server
          res.on('close', function () { if (dr) { try { dr.abort(); } catch (e) {} } });
        }
        if (metodo === 'POST' || metodo === 'DELETE') {
          corpoJson(req, function (b) { if (!b) rispondi(res, 400, { error: 'corpo non valido', codice: 'corpo' }); else vai(metodo === 'POST' ? b : undefined); });
        } else vai(undefined);
      }

      function sottoEsterni(id, ms, indice, cb) {
        var formato = 'srt';
        chiedi({ percorso: 'Videos/' + id + '/' + ms + '/Subtitles/' + indice + '/0/Stream.' + formato, accetta: '*/*', byte: true, max: MAX_SOTTO, tempo: 30000 },
          function (err, st, b) {
            if (err) { cb(err); return; }
            if (st !== 200 || !b) { cb(errore('assente', 'sottotitoli non trovati')); return; }
            o.leggiSottotitoli(o.testoDi(b), formato, function (eventi, troppi) { cb(null, { eventi: eventi, completi: true, complessi: !!troppi }); });
          });
      }

      /* ---------------------------------------------------------- le domande dell'app */

      function trattaJf(req, res, resto, q, u) {
        var get = req.method === 'GET', post = req.method === 'POST', m;
        function errore2(e) {
          var c = e.codice || 'errore';
          rispondi(res, c === 'accesso' ? 401 : c === 'rete' ? 502 : c === 'assente' ? 404 : c === 'server' ? 409 : 400, { error: e.message, codice: c });
        }
        if (resto === 'stato' && get) { rispondi(res, 200, statoPubblico()); return; }
        if (resto === 'cerca' && get) { cerca(function (l) { rispondi(res, 200, { server: l }); }); return; }
        if (resto === 'server' && post) {
          corpoJson(req, function (b) {
            if (!b) { rispondi(res, 400, { error: 'corpo non valido', codice: 'corpo' }); return; }
            scegliServer(b.indirizzo, function (e) { if (e) errore2(e); else rispondi(res, 200, statoPubblico()); });
          });
          return;
        }
        if (resto === 'qc' && post) { qcInizia(function (e, r) { if (e) errore2(e); else rispondi(res, 200, r); }); return; }
        if (resto === 'qc' && get) { qcControlla(function (e, r) { if (e) errore2(e); else rispondi(res, 200, r); }); return; }
        if (resto === 'accedi' && post) {
          corpoJson(req, function (b) {
            if (!b || typeof b.nome !== 'string' || !b.nome) { rispondi(res, 400, { error: 'manca il nome', codice: 'corpo' }); return; }
            accedi(b.nome, b.password, function (e) { if (e) errore2(e); else rispondi(res, 200, statoPubblico()); });
          });
          return;
        }
        if (resto === 'esci' && post) {
          qc = null;
          if (!cfg.token) { dimentica(); rispondi(res, 200, statoPubblico()); return; }
          // il server chiude la sessione (al massimo 4 secondi), poi il token si dimentica comunque
          chiedi({ percorso: 'Sessions/Logout', metodo: 'POST', tempo: 4000 }, function () { dimentica(); rispondi(res, 200, statoPubblico()); });
          return;
        }
        if (resto === 'veloce' && get) { veloce(function (e, r) { if (e) errore2(e); else rispondi(res, 200, r); }); return; }
        if ((m = /^guarda\/([0-9a-fA-F]{32})$/.exec(resto)) && get) {
          guarda(m[1].toLowerCase(), q, function (e, r) { if (e) errore2(e); else rispondi(res, 200, r); });
          return;
        }
        // file/<id>[/<nome.mkv>]: il nome col suo tipo nell'indirizzo, come per le chiavette (alcuni lettori dei TV lo guardano)
        if ((m = /^(file|info|sotto)\/([0-9a-fA-F]{32})(\/[^\/]{1,200})?$/.exec(resto)) && (m[1] === 'file' || !m[3]) && (get || (m[1] === 'file' && req.method === 'HEAD'))) {
          var id = m[2].toLowerCase(), cosa = m[1], ms = String(q.ms || '').toLowerCase();
          if (!idBuono(ms)) { rispondi(res, 400, { error: 'manca il file', codice: 'corpo' }); return; }
          sorgenteDi(id, ms, function (e, s) {
            if (e) {
              if (cosa === 'file') { res.writeHead(e.codice === 'rete' ? 502 : 404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end(e.codice || 'errore'); }
              else errore2(e);
              return;
            }
            if (cosa === 'file') { vt.remoto.servi(req, res, s.x, { audio: +q.a || 0 }); return; }
            if (cosa === 'info') {
              var lingue = String(q.lingue || '').split(',').filter(function (x) { return /^[a-z]{2,3}$/.test(x); }).slice(0, 6);
              vt.remoto.info(s.x, { lingue: lingue.length ? lingue : null }, function (e2, r) { if (e2) errore2(e2); else rispondi(res, 200, r); });
              return;
            }
            vt.remoto.sotto(s.x, +q.t, +q.da || 0, function (e2, r) { if (e2) errore2(e2); else rispondi(res, 200, r); }, q.dopo);
          });
          return;
        }
        if ((m = /^sottoesterni\/([0-9a-fA-F]{32})$/.exec(resto)) && get) {
          var ms2 = String(q.ms || '').toLowerCase(), indice = +q.i;
          if (!idBuono(ms2) || !(indice >= 0 && indice < 10000 && Math.floor(indice) === indice)) { rispondi(res, 400, { error: 'domanda non valida', codice: 'corpo' }); return; }
          if (!cfg.token) { rispondi(res, 401, { error: 'serve l\'accesso a Jellyfin', codice: 'accesso' }); return; }
          sottoEsterni(m[1].toLowerCase(), ms2, indice, function (e, r) { if (e) errore2(e); else rispondi(res, 200, r); });
          return;
        }
        if (resto.indexOf('p/') === 0) {
          var percorso = resto.slice(2);
          if (/(^|\/)\.\.?(\/|$)|\/\/|\\/.test(percorso)) { rispondi(res, 403, { error: 'percorso non permesso', codice: 'lista' }); return; }
          var ponte = String(u.pathname || '').slice(0, String(u.pathname || '').length - percorso.length);
          inoltra(req, res, percorso, u, ponte);
          return;
        }
        rispondi(res, 404, { error: 'domanda sconosciuta', codice: 'assente' });
      }

      return {
        tratta: function (req, res, cosa, q, u) {
          if (cosa.indexOf('jf/') === 0) { trattaJf(req, res, cosa.slice(3), q || {}, u); return; }
          // la velocita' del TV (una alla volta: e' un lavoro di qualche secondo)
          if (cosa === 'tv/cpu' && req.method === 'GET') {
            if (misurando) { rispondi(res, 409, { error: 'misura gia\' in corso', codice: 'occupato' }); return; }
            misurando = true;
            misuraCpu(function (r) { misurando = false; rispondi(res, 200, r); });
            return;
          }
          // il ponte verso il limitatore del Mac: in arrivo
          rispondi(res, 404, { error: 'domanda sconosciuta', codice: 'assente' });
        },
        stato: statoPubblico,
        // per le prove
        _cfg: function () { return cfg; }, _sorgenti: function () { return sorgenti; }
      };
    }

    return {
      crea: crea, VERSIONE: VERSIONE,
      _interni: { misuraCpu: misuraCpu, inLista: inLista, senzaChiavi: senzaChiavi, riscriviPlaylist: riscriviPlaylist, indirizzoBuono: indirizzoBuono,
        famigliaJf: famigliaJf, profilo: profilo, qualitaAuto: qualitaAuto, fsRemoto: fsRemoto, QUALITA: QUALITA }
    };
  })();
  /* </ponti:generato> */
  var pontiVideo = PontiVideo.crea({ http: http, https: require('https'), dgram: require('dgram'), url: urlLib, crypto: require('crypto'),
    fs: fs, path: pathLib, cartella: CACHE_DIR, videoteca: videoteca, letti: lettiTv, log: log,
    // il nome del TV nel pannello di Jellyfin (Dispositivi): il modello, se il TV lo dice
    nomeTv: function () { var f = fattiTv() || {}; return f.modello ? (ALTRA ? '' : 'Samsung ') + f.modello : 'TV'; },
    leggiSottotitoli: Videoteca._interni.leggiSottotitoli, testoDi: Videoteca._interni.testoDi, locale: PROVE });
  // per "Questo TV": le chiavette si vedono e si leggono? Si guarda solo quando si chiede il profilo, al massimo ogni 30
  // secondi (cosi' un disco attaccato al TV puo' andare a riposo); una chiavetta lenta non ferma la risposta oltre 1,5 s
  var chiavette = null, chiavetteAt = 0;
  function conChiavette(poi) {
    if (Date.now() - chiavetteAt < 30000) { poi(); return; }
    chiavetteAt = Date.now();
    var fatto = false;
    function fine() { if (!fatto) { fatto = true; poi(); } }
    setTimeout(fine, 1500);
    try { videoteca.prova(function (r) { chiavette = r; fine(); }); } catch (e) { chiavette = { stato: 'errore', dischi: 0 }; fine(); }
  }
  // il punto del video dall'app: Continua a guardare (anche nella home) e il telefono (titolo, barra del tempo, pausa)
  function puntoVideo(b) {
    var app = typeof b.app === 'string' ? b.app : '', casa = trovaCasa();
    // la pagina e' l'app Video dello stesso account della home: la scheda di Continua a guardare la riapre li' (nelle prove
    // sul computer la home e le app stanno su localhost)
    var buona = (/^https:\/\/[a-z0-9\-]+\.github\.io\/[A-Za-z0-9._\-]+\/$/.test(app) || PROVE && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/[A-Za-z0-9._\-]+\/$/.test(app)) &&
      (!casa.origin || app.indexOf(casa.origin + '/') === 0);
    var titolo = testo(b.titolo, 120), stagione = Number(b.stagione) || 0, episodio = Number(b.episodio) || 0, anno = Number(b.anno) || 0;
    var corpo = { chi: 'video', titolo: titolo + (episodio ? ' \u00b7 S' + stagione + ' E' + episodio : anno ? ' (' + anno + ')' : ''),
      durata: Number(b.durata), posizione: Number(b.posizione), inPausa: b.inPausa === true, attivo: b.chiuso !== true,
      memo: b.chiuso === true, guardato: Number(b.guardato) || 0, scelto: true };
    // un film di Jellyfin: l'ancora porta il suo id (il punto lo tiene anche Jellyfin)
    var jf = typeof b.jf === 'string' && /^[0-9a-f]{32}$/.test(b.jf) ? b.jf : '';
    if (buona) {
      corpo.pagina = { url: app + (jf ? '#/jf/' + jf : '#/v/' + encodeURIComponent(String(b.p || '')) + '?d=' + encodeURIComponent(String(b.d || '')) +
        '&dim=' + (Number(b.dim) || 0)), titolo: corpo.titolo, video: jf ? 'jellyfin:' + jf : 'chiavetta:' + String(b.p || '').slice(0, 400),
        ld: { nome: episodio ? '' : titolo, serie: episodio ? titolo : '', stagione: stagione, episodio: episodio, anno: anno } };
    }
    cambiaVideo(corpo);
  }

  function hostLink(u) {
    var m = /^https?:\/\/(?:[^\/?#@]*@)?([^\/?#:]+)/i.exec(String(u));
    return m ? m[1].toLowerCase().replace(/\.$/, '') : '';
  }
  function cambiaStato() {
    tel.ver++;
    var attese = tel.attesaStato;
    tel.attesaStato = [];
    for (var i = 0; i < attese.length; i++) {
      clearTimeout(attese[i].timer);
      try { rispondiTel(attese[i].res, 200, statoPerTelefono()); } catch (e) {}
    }
  }
  function attendiStato(req, res) {
    var a = { res: res, timer: null };
    a.timer = setTimeout(function () {
      var k = tel.attesaStato.indexOf(a);
      if (k !== -1) tel.attesaStato.splice(k, 1);
      try { rispondiTel(res, 200, statoPerTelefono()); } catch (e) {}
    }, 20000);
    tel.attesaStato.push(a);
    if (tel.attesaStato.length > 12) { var v = tel.attesaStato.shift(); clearTimeout(v.timer); try { rispondiTel(v.res, 200, statoPerTelefono()); } catch (e) {} }
    req.on('close', function () {
      clearTimeout(a.timer);
      var k = tel.attesaStato.indexOf(a);
      if (k !== -1) tel.attesaStato.splice(k, 1);
    });
  }

  function statoTelefono() {
    // abbinamenti: cresce a ogni telefono collegato, anche quando i telefoni sono gia' 6 (il piu' vecchio lascia il posto)
    return { attivo: tel.attivo, errore: tel.errore, porta: PORTA_TELEFONO, indirizzi: indirizziRete(), collegati: telefoni.length,
      abbinamenti: tel.abbinamenti || 0, tasti: rem.stato };
  }

  // i tasti valgono solo per qualche secondo (non si "recuperano" dopo minuti
  // passati in un'altra app); link e "torna alla home" un po' di piu'
  function eventiDopo(da, origine) {
    var ora = Date.now(), out = [];
    for (var i = 0; i < tel.eventi.length; i++) {
      var e = tel.eventi[i];
      if (e.solo && e.solo.indexOf(String(origine || '')) === -1) continue; // una password: solo alla pagina del campo
      var vita = e.tipo === 'link' || e.tipo === 'home' || e.tipo === 'sito' ? 30000 : 4000;
      if (e.seq > da && ora - e.at < vita) out.push(e);
    }
    return out;
  }
  // link, "home" e le azioni dello Store si eseguono una volta sola, anche se la pagina che li riceve poi cambia (lo
  // Store che apre un'app chiesta dal telefono non deve riceverla di nuovo)
  function consegna(lista) {
    for (var i = 0; i < lista.length; i++) {
      var tp = lista[i].tipo;
      if (tp === 'link' || tp === 'home' || tp === 'sito' || tp === 'puntatore' || tp === 'store') lista[i].consegnato = true;
    }
    return lista;
  }

  function rispondiAttese() {
    var attese = tel.attese;
    tel.attese = [];
    // chi aspettava ha appena ricevuto: tra un attimo richiede (per qualche secondo vale ancora come "in ascolto")
    if (attese.length) tel.ultimoAscolto = Date.now();
    for (var i = 0; i < attese.length; i++) {
      var a = attese[i];
      clearTimeout(a.timer);
      try { sendJson(a.req, a.res, 200, { seq: tel.seq, eventi: consegna(eventiDopo(a.da, a.origine)) }, true); } catch (e) {}
    }
  }

  function aggiungiEvento(ev) {
    tel.seq++;
    ev.seq = tel.seq;
    ev.at = Date.now();
    tel.eventi.push(ev);
    if (tel.eventi.length > 40) tel.eventi.splice(0, tel.eventi.length - 40);
    rispondiAttese();
  }

  // richiesta lunga delle pagine del TV
  function attendiEventi(req, res, query) {
    tel.ultimoAscolto = Date.now();
    var origine = String(req.headers.origin || '');
    var dove = testo(query.dove, 80);
    if (dove !== tel.dove) {
      tel.dove = dove;
      tel.campo = null;
      tel.video = null;
      tel.sotto = null;
      cambiaStato();
    }
    // la home o lo Store: le azioni dello Store chieste dal telefono mentre sul TV c'era altro (al massimo 30 minuti fa)
    var casaTv = dove === 'Home' || dove === 'Store';
    if (casaTv && tel.storeCoda.length) {
      var coda = tel.storeCoda.filter(function (a) { return Date.now() - a.chiesta < 30 * 60 * 1000; });
      tel.storeCoda = [];
      coda.forEach(function (a) { delete a.chiesta; aggiungiEvento(a); });
    }
    var da = parseInt(query.da, 10);
    if (isNaN(da) || da < 0 || da > tel.seq) {
      // pagina appena aperta: riceve solo link e "home" ancora freschi (la home e lo Store anche le azioni dello Store).
      // I movimenti del puntatore rimasti indietro non sono suoi: chiusi, cosi' quelli che arrivano adesso non si
      // sommano a un evento che nessuno ricevera'
      for (var pi = 0; pi < tel.eventi.length; pi++) if (tel.eventi[pi].tipo === 'puntatore') tel.eventi[pi].consegnato = true;
      var freschi = eventiDopo(0).filter(function (e) {
        return (e.tipo === 'link' || e.tipo === 'home' || e.tipo === 'sito' || (e.tipo === 'store' && casaTv)) && !e.consegnato;
      });
      sendJson(req, res, 200, { seq: tel.seq, eventi: consegna(freschi) }, true);
      return;
    }
    var pronti = eventiDopo(da, origine);
    if (pronti.length) { sendJson(req, res, 200, { seq: tel.seq, eventi: consegna(pronti) }, true); return; }
    var attesa = { req: req, res: res, da: da, timer: null, origine: origine };
    attesa.timer = setTimeout(function () {
      var k = tel.attese.indexOf(attesa);
      if (k !== -1) tel.attese.splice(k, 1);
      tel.ultimoAscolto = Date.now();
      try { sendJson(req, res, 200, { seq: tel.seq, eventi: [] }, true); } catch (e) {}
    }, 25000);
    tel.attese.push(attesa);
    if (tel.attese.length > 8) { // pagine dimenticate aperte: si chiudono le piu' vecchie
      var vecchia = tel.attese.shift();
      clearTimeout(vecchia.timer);
      try { sendJson(vecchia.req, vecchia.res, 200, { seq: tel.seq, eventi: [] }, true); } catch (e) {}
    }
    req.on('close', function () {
      clearTimeout(attesa.timer);
      var k = tel.attese.indexOf(attesa);
      if (k !== -1) tel.attese.splice(k, 1);
    });
  }

  function apriHome(motivo) {
    if (ALTRA) { ALTRA.apriHome(motivo)['catch'](function (e) { log('home non aperta (' + motivo + '): ' + e.message); }); return; }
    if (!HAS_TIZEN) return;
    launchApp(tizenBrewAppId())['catch'](function (e) { log('home non aperta (' + motivo + '): ' + e.message); });
  }

  // Un tasto dal telefono: se l'ingresso del TV e' collegato e' un tasto vero
  // (arriva dove c'e' il fuoco, anche in Netflix o nei menu Samsung); se no va
  // alle pagine della home. Il primo tasto dopo una pausa parte subito dalle
  // pagine, mentre l'ingresso del TV si ricollega.
  function comandoDalTelefono(body) {
    var tipo = body.tipo;
    tel.inCoda = false;
    if (tipo === 'tasto') {
      var k = body.tasto;
      if (!TASTI_TELEFONO[k]) return 'tasto sconosciuto';
      if (SOLO_TV[k]) {
        if (rem.stato === 'negato' || rem.stato === 'assente') return 'non-disponibile';
        tastoVero(k);
        return '';
      }
      // play/pausa: nelle pagine della home lo alterna la pagina (il tasto vero del TV fa solo Play)
      if (k === 'playpausa' && inAscolto()) { aggiungiEvento({ tipo: 'tasto', tasto: k }); return ''; }
      // OK tenuto premuto: nelle pagine della home apre il menu della cosa scelta; nelle altre app e' un OK
      if (k === 'tieni') {
        if (inAscolto()) { aggiungiEvento({ tipo: 'tasto', tasto: k }); return ''; }
        k = 'ok';
      }
      if (rem.pronto && tastoVero(k)) return '';
      if (inAscolto()) {
        aggiungiEvento({ tipo: 'tasto', tasto: k });
        if (remotoUsabile()) apriRemoto();
        return '';
      }
      if (rem.stato === 'ok' || rem.stato === 'mai' || rem.stato === 'attesa') { tastoVero(k); return ''; }
      aggiungiEvento({ tipo: 'tasto', tasto: k });
    } else if (tipo === 'testo') {
      var t = testo(body.testo, 500), invio = body.invio !== false;
      if (invio && !t.replace(/\s+/g, '')) return 'testo vuoto';
      // una password va solo alla pagina dove c'e' il campo (non a ogni pagina o riquadro che ascolta)
      var solo = campoAttivo() && tel.campo.tipo === 'password' ? tel.campo.origini : null;
      if (!invio) { aggiungiEvento({ tipo: 'testo', testo: t, invio: false, solo: solo }); return ''; }
      // nelle pagine della home il testo va nel campo giusto (e fa la ricerca);
      // altrove si scrive nella tastiera di Samsung, se e' aperta
      if (!inAscolto() && remotoUsabile()) { testoVero(t); return ''; }
      aggiungiEvento({ tipo: 'testo', testo: t, solo: solo });
    } else if (tipo === 'link') {
      if (!urlValido(body.url)) return 'indirizzo non valido';
      // il sito aperto col telefono e' voluto: la pagina non lo tratta come una pagina "esterna"
      tel.ultimoLink = { host: hostLink(body.url), at: Date.now() };
      var ascoltava = inAscolto();
      aggiungiEvento({ tipo: 'link', url: body.url });
      if (!ascoltava) apriHome('link dal telefono'); // sul TV c'e' un'altra app: prima si torna qui
    } else if (tipo === 'riproduci') {
      // "Riproduci sul TV": la pagina si apre sul TV e il suo video principale parte da solo, come da Continua a guardare
      // (ma dal punto che decide il sito: un link puo' avere il suo minuto)
      if (!urlValido(body.url)) return 'indirizzo non valido';
      visti.riproduci(body.url);
      tel.ultimoLink = { host: hostLink(body.url), at: Date.now() };
      var ascoltavaVideo = inAscolto();
      aggiungiEvento({ tipo: 'link', url: body.url, riproduci: true });
      if (!ascoltavaVideo) apriHome('video dal telefono');
    } else if (tipo === 'schede' || tipo === 'nuovaScheda') {
      // le schede del browser sul TV (la galleria), o una scheda nuova (il browser con la ricerca pronta)
      var ascoltavaSchede = inAscolto();
      aggiungiEvento({ tipo: tipo });
      if (!ascoltavaSchede) apriHome('schede dal telefono');
    } else if (tipo === 'scheda') {
      // una scheda scelta sul telefono: il TV la apre, e da li' la scheda segue le pagine in cui navighi
      if (!cambiaSchede({ azione: 'apri', id: testo(body.id, 40) }).ok || !schedaAttiva()) return 'scheda non trovata';
      var sa = schedaAttiva();
      tel.ultimoLink = { host: hostLink(sa.url), at: Date.now() };
      var ascoltavaScheda = inAscolto();
      aggiungiEvento({ tipo: 'link', url: sa.url });
      if (!ascoltavaScheda) apriHome('scheda dal telefono');
    } else if (tipo === 'sito') {
      // nuovo link del "mio sito": si salva subito qui (vale anche a home chiusa,
      // da spento, senza internet); la home lo prende appena si apre
      if (!urlValido(body.url)) return 'indirizzo non valido';
      prefs.url = body.url;
      if (!prefs.home || typeof prefs.home !== 'object' || Array.isArray(prefs.home)) prefs.home = {};
      prefs.home.url = body.url;
      prefs.home.rev = Date.now();
      scriviJson(FILE_PREFS, prefs, true);
      aggiungiEvento({ tipo: 'sito', url: body.url });
    } else if (tipo === 'puntatore') {
      // trackpad del telefono: spostamenti, scorrimento, clic (li esegue la pagina aperta sul TV)
      var pa = body.azione;
      if (pa === 'muovi' || pa === 'scorri') {
        var pdx = Number(body.dx), pdy = Number(body.dy);
        if (!isFinite(pdx) || !isFinite(pdy)) return 'comando sconosciuto';
        pdx = Math.max(-5000, Math.min(5000, pdx));
        pdy = Math.max(-5000, Math.min(5000, pdy));
        var ult = tel.eventi[tel.eventi.length - 1];
        // la pagina non ha ancora preso il movimento di prima: si sommano (niente code di passettini)
        if (ult && ult.tipo === 'puntatore' && ult.azione === pa && !ult.consegnato && Date.now() - ult.at < 2000) {
          ult.dx = Math.round((ult.dx + pdx) * 10) / 10;
          ult.dy = Math.round((ult.dy + pdy) * 10) / 10;
        } else aggiungiEvento({ tipo: 'puntatore', azione: pa, dx: pdx, dy: pdy });
      } else if (pa === 'clic' || pa === 'tieni' || pa === 'fine' || pa === 'vivo' || pa === 'mostra' || pa === 'nascondi') aggiungiEvento({ tipo: 'puntatore', azione: pa });
      else return 'comando sconosciuto';
    } else if (tipo === 'video') {
      // dalla sezione Video del telefono: vai a quel punto, salta avanti o indietro, play, pausa
      var az = body.azione, sec = Number(body.secondi);
      if (az === 'vai') {
        if (!isFinite(sec) || sec < 0 || sec > 1e7) return 'comando sconosciuto';
      } else if (az === 'salta') {
        if (!isFinite(sec) || !sec || Math.abs(sec) > 3600) return 'comando sconosciuto';
      } else if (az !== 'play' && az !== 'pausa') return 'comando sconosciuto';
      var ev = { tipo: 'video', azione: az };
      if (az === 'vai' || az === 'salta') ev.secondi = Math.round(sec * 10) / 10;
      aggiungiEvento(ev);
    } else if (tipo === 'home') {
      aggiungiEvento({ tipo: 'home' });
      apriHome('tasto Home del telefono'); // funziona anche da Netflix e dalle altre app
    } else if (tipo === 'permesso') {
      // dal telecomando del telefono: il TV chiede di nuovo "Consenti" per i tasti veri (si sceglie col telecomando del TV)
      chiediPermessoRemoto();
    } else if (tipo === 'store') {
      // lo Store dal telefono: lo fa la home del TV (o lo Store), che ha le liste e i controlli. Con altro aperto sul TV
      // l'azione aspetta che si torni alla home; aprire un'app ci porta subito (da un sito come un link, da un'altra app
      // riaprendo la home)
      var az2 = body.azione, ev2 = { tipo: 'store', azione: az2 };
      if (az2 === 'installa' || az2 === 'disinstalla') {
        if (!ID_STORE.test(String(body.id || ''))) return 'app non valida';
        ev2.id = String(body.id);
      } else if (az2 === 'togli' || az2 === 'apri') {
        if (!RIQUADRO_STORE.test(String(body.riquadro || ''))) return 'app non valida';
        ev2.riquadro = String(body.riquadro);
      } else if (az2 === 'aggiungi') {
        ev2.indirizzo = testo(body.indirizzo, 500);
        if (!ev2.indirizzo) return 'indirizzo vuoto';
      } else if (az2 !== 'elenco') return 'comando sconosciuto';
      if (storeInAscolto()) { aggiungiEvento(ev2); return ''; }
      if (az2 === 'elenco') return ''; // il telefono mostra l'ultimo elenco che conosce
      var base = trovaCasa().base;
      if (az2 === 'apri' && inAscolto() && base) {
        aggiungiEvento({ tipo: 'link', url: base + 'store.html#apri=' + encodeURIComponent(ev2.riquadro) + '&da=home' });
        return '';
      }
      ev2.chiesta = Date.now();
      tel.storeCoda.push(ev2);
      if (tel.storeCoda.length > 10) tel.storeCoda.splice(0, tel.storeCoda.length - 10);
      tel.inCoda = true;
      if (az2 === 'apri') apriHome('app dal telefono');
    } else return 'comando sconosciuto';
    return '';
  }

  var PAGINA_TELEFONO = '';
  var ICONA_TELEFONO = null;
  function caricaRisorseTelefono() {
    if (PAGINA_TELEFONO) return;
    PAGINA_TELEFONO = TELEFONO_HTML.join('\n');
    try {
      // Buffer.from non c'e' nel Node 4.4 del TV
      ICONA_TELEFONO = typeof Buffer.alloc === 'function' ? Buffer.from(TELEFONO_ICONA, 'base64') : new Buffer(TELEFONO_ICONA, 'base64');
    } catch (e) { ICONA_TELEFONO = null; }
  }

  function rispondiTel(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function leggiCorpoTel(req, cb) {
    var chunks = [], size = 0, finito = false;
    req.on('data', function (c) {
      size += c.length;
      if (size > 8 * 1024 && !finito) { finito = true; cb(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (finito) return;
      finito = true;
      try {
        var v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        cb(v && typeof v === 'object' && !Array.isArray(v) ? v : null);
      } catch (e) { cb(null); }
    });
    req.on('error', function () { if (!finito) { finito = true; cb(null); } });
  }

  function gestisciTelefono(req, res) {
    var u = urlLib.parse(req.url, true);
    var route = req.method + ' ' + u.pathname;
    if (route === 'GET /' || route === 'GET /index.html') {
      caricaRisorseTelefono();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
      res.end(PAGINA_TELEFONO);
      return;
    }
    if (route === 'GET /icona.png' || route === 'GET /apple-touch-icon.png' || route === 'GET /favicon.ico') {
      caricaRisorseTelefono();
      if (!ICONA_TELEFONO) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=604800' });
      res.end(ICONA_TELEFONO);
      return;
    }
    // il profilo del TV per l'installatore sul Mac (solo cose del TV, niente dati tuoi: come l'API della porta 8001)
    if (route === 'GET /tv') { conChiavette(function () { rispondiTel(res, 200, profiloTv()); }); return; }
    if (route === 'GET /stato') {
      if (!telefonoValido(u.query.t)) { rispondiTel(res, 401, { error: 'non collegato' }); return; }
      // con ?v= il telefono aspetta che cambi qualcosa (pagina, campo dove si scrive): lo sa subito
      if (u.query.v && parseInt(u.query.v, 10) === tel.ver) { attendiStato(req, res); return; }
      rispondiTel(res, 200, statoPerTelefono());
      return;
    }
    // lo Store: l'ultimo elenco mandato dal TV, e dove si trova il TV (le azioni le fa la home)
    if (route === 'GET /store') {
      if (!telefonoValido(u.query.t)) { rispondiTel(res, 401, { error: 'non collegato' }); return; }
      rispondiTel(res, 200, { store: tel.store, dove: tel.dove, casa: storeInAscolto(), ver: tel.storeVer });
      return;
    }
    // le schede del browser, per l'elenco sul telefono (l'ultima usata per prima)
    if (route === 'GET /schede') {
      if (!telefonoValido(u.query.t)) { rispondiTel(res, 401, { error: 'non collegato' }); return; }
      rispondiTel(res, 200, { attiva: browserData.schedaAttiva, schede: browserData.schede.slice().sort(function (a, b) { return (b.t || 0) - (a.t || 0); })
        .map(function (s) { return { id: s.id, titolo: s.titolo || '', url: s.url, img: s.img || '' }; }) });
      return;
    }
    if (route === 'POST /abbina') {
      leggiCorpoTel(req, function (body) {
        if (!body) { rispondiTel(res, 400, { error: 'richiesta non valida' }); return; }
        if (!tel.codice) { rispondiTel(res, 403, { error: 'nessun-codice' }); return; }
        if (Date.now() > tel.codiceScade) { tel.codice = ''; rispondiTel(res, 403, { error: 'scaduto' }); return; }
        if (String(body.pin || '') !== tel.codice) {
          tel.codiceErrori++;
          if (tel.codiceErrori >= 5) tel.codice = ''; // troppi tentativi: serve un codice nuovo
          rispondiTel(res, 403, { error: 'sbagliato' });
          return;
        }
        tel.codice = ''; // un codice vale per un telefono solo
        var nuovo = { t: casuale(24), nome: testo(body.nome, 40) || 'Telefono', quando: Date.now() };
        telefoni.push(nuovo);
        tel.abbinamenti = (tel.abbinamenti || 0) + 1;
        if (telefoni.length > MAX_TELEFONI) telefoni.splice(0, telefoni.length - MAX_TELEFONI);
        salvaTelefoni();
        log('telefono collegato');
        rispondiTel(res, 200, { t: nuovo.t });
        // e' il momento giusto per il permesso dei tasti veri: sei davanti al TV col telecomando
        if (rem.stato !== 'ok') setTimeout(chiediPermessoRemoto, 1500);
      });
      return;
    }
    if (route === 'POST /comando') {
      leggiCorpoTel(req, function (body) {
        if (!body) { rispondiTel(res, 400, { error: 'richiesta non valida' }); return; }
        if (!telefonoValido(body.t)) { rispondiTel(res, 401, { error: 'non collegato' }); return; }
        var ascoltava = inAscolto();
        var errore = comandoDalTelefono(body);
        if (errore) { rispondiTel(res, 400, { error: errore, tasti: rem.stato }); return; }
        rispondiTel(res, 200, { ok: true, ascolta: ascoltava, dove: tel.dove, tasti: rem.stato, coda: tel.inCoda });
      });
      return;
    }
    rispondiTel(res, 404, { error: 'non trovato' });
  }

  function avviaServerTelefono() {
    var srv = http.createServer(function (req, res) {
      try { gestisciTelefono(req, res); } catch (e) { try { rispondiTel(res, 500, { error: 'errore' }); } catch (e2) {} }
    });
    srv.on('error', function (e) {
      tel.attivo = false;
      tel.errore = e && e.code ? e.code : String(e);
      log('telecomando sul telefono non disponibile: ' + tel.errore);
    });
    srv.listen(PORTA_TELEFONO, '0.0.0.0', function () {
      tel.attivo = true;
      tel.errore = '';
      log('telecomando sul telefono: porta ' + PORTA_TELEFONO + ' (' + indirizziRete().join(', ') + ')');
    });
  }

  /* ---------------------------------------------------------- adblock: liste di filtri della comunita'
   * Le liste della comunita' (EasyList ed EasyList Italy; col blocco avanzato anche quella
   * contro gli anti-adblock), scaricate dal TV all'avvio e poi ogni giorno.
   * Il lavoro pesante (leggere ~3 MB di regole) si fa qui, una volta sola e a
   * pezzi, per non fermare il resto del servizio; il risultato resta in un
   * file e sopravvive ai riavvii. Ogni pagina chiede /api/adblock?host=... e
   * riceve gia' pronto solo quello che serve a quel sito.
   * Finche' le liste non ci sono (prima accensione, niente internet) la
   * risposta e' vuota e main.js usa le sue liste interne.
   */

  var zlib = require('zlib');
  var FILE_ADBLOCK = pathLib.join(CACHE_DIR, 'hometv-adblock.json');
  var ADB_OGNI = 24 * 3600 * 1000;      // aggiornamento giornaliero
  var ADB_RIPROVA = 30 * 60 * 1000;     // non riuscito: di nuovo tra mezz'ora
  var ADB_MAX_LISTA = 10 * 1024 * 1024;
  var LISTE_PREDEFINITE = [
    { nome: 'EasyList', url: ['https://easylist-downloads.adblockplus.org/easylist.txt',
      'https://cdn.jsdelivr.net/gh/easylist/easylist@gh-pages/easylist.txt', 'https://easylist.to/easylist/easylist.txt'] },
    { nome: 'EasyList Italy', url: ['https://easylist-downloads.adblockplus.org/easylistitaly.txt'] },
    { nome: 'Anti-adblock', url: ['https://easylist-downloads.adblockplus.org/abp-filters-anti-cv.txt'] }
  ];
  // Il Node del TV ha i certificati del 2016: senza questo (Let's Encrypt,
  // valido fino al 2035) le liste su adblockplus.org non si scaricano.
  // Si usa solo se la verifica normale non riesce.
    var ADB_RADICE_LE = [
    '-----BEGIN CERTIFICATE-----',
    'MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw',
    'TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh',
    'cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4',
    'WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu',
    'ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY',
    'MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc',
    'h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+',
    '0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U',
    'A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW',
    'T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH',
    'B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC',
    'B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv',
    'KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn',
    'OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn',
    'jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw',
    'qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI',
    'rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV',
    'HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq',
    'hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL',
    'ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ',
    '3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK',
    'NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5',
    'ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur',
    'TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC',
    'jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc',
    'oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq',
    '4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA',
    'mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d',
    'emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=',
    '-----END CERTIFICATE-----'
  ].join('\n');

  /* <adblock:comune> compilatore e risposta per un sito (li usa anche prove/simulatore-tv/costruisci.js) */
  var ADB_FORMATO = 1;
  var ADB_CSS_MAX = 400000; // tetto del CSS generico (caratteri); oggi ~230 000, misurato con prove/perf_site2.py
  function ha(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  var ADB_SEP = /#@?(\$\??|\?|%)?#/;
  var ADB_DOMINI = /^[a-z0-9.*\-~,_]*$/;
  var ADB_PROC = /:-abp-|:has-text\(|:contains\(|:has\(|:xpath\(|:upward\(|:matches-|:remove\(|:style\(|:min-text-length|:watch-attr|:others\(|:if\(|:if-not\(|:nth-ancestor|:-ext-|:is\(|:where\(/;
  var ADB_TIPI = { script: 1, image: 1, stylesheet: 1, css: 1, object: 1, 'object-subrequest': 1, xmlhttprequest: 1, xhr: 1,
    subdocument: 1, frame: 1, ping: 1, beacon: 1, websocket: 1, webrtc: 1, font: 1, media: 1, other: 1, all: 1 };
  // eccezioni che valgono per la pagina intera (non per le singole richieste)
  var ADB_PAGINA = { elemhide: 'E', ehide: 'E', generichide: 'G', ghide: 'G', genericblock: 'B', specifichide: 'S', shide: 'S' };
  // opzioni che non cambiano il blocco (redirect/rewrite: si blocca e basta)
  var ADB_IGNORA = { 'match-case': 1, important: 1, collapse: 1, 'no-collapse': 1, rewrite: 1, redirect: 1, 'redirect-rule': 1,
    empty: 1, mp4: 1, _: 1 };
  var ADB_COMUNI = { http: 1, https: 1, www: 1, com: 1, net: 1, org: 1, html: 1, php: 1 };
  var ADB_PAROLA = /[^a-z0-9%*][a-z0-9%]{2,}(?=[^a-z0-9%*])/g;
  var ADB_INVISIBILE = '{opacity:0!important;pointer-events:none!important}'; // generici: l'elemento resta al suo posto, cosi' la pagina non si sposta
  var ADB_NASCOSTO = '{display:none!important}';                             // regole scritte per quel sito

  function adbNuovo() {
    return { rete: {}, terze: {}, popup: {}, consentiHost: {}, schemi: [], consenti: [], generici: {}, genericiNo: {}, sito: {},
      conta: { regole: 0, usate: 0 } };
  }

  function adbMetti(c, d, k, v) {
    var s = ha(c.sito, d) ? c.sito[d] : (c.sito[d] = {});
    if (k === 'f') { if (s.f) { if (s.f.indexOf(v) === -1) s.f += v; } else s.f = v; return; }
    (s[k] || (s[k] = [])).push(v);
  }

  function adbDomini(dom) {
    var incl = [], escl = [], p = dom ? dom.split(',') : [];
    for (var i = 0; i < p.length; i++) {
      var d = p[i].replace(/^\s+|\s+$/g, '');
      if (!d || d === '~') continue;
      if (d.charAt(0) === '~') escl.push(d.slice(1)); else incl.push(d);
    }
    return { incl: incl, escl: escl };
  }

  // Selettori che il browser del TV (Chromium 76) capisce e che non possono
  // uscire dalla regola CSS in cui vengono messi.
  function adbSelettoreOk(s) {
    return s.length < 1000 && !/[{}]|\/\*|\\$|:focus-visible|\ss\]/.test(s);
  }

  function adbRiga(r, c) {
    var m = ADB_SEP.exec(r);
    if (m) {
      var dom = r.slice(0, m.index).toLowerCase();
      if (ADB_DOMINI.test(dom)) return adbCosmetica(dom, m[0], r.slice(m.index + m[0].length), c);
    }
    return adbRete(r, c);
  }

  function adbCosmetica(dom, sep, corpo, c) {
    var ecc = sep.indexOf('@') !== -1, tipo = sep.replace(/[#@]/g, '');
    corpo = corpo.replace(/^\s+|\s+$/g, '');
    if (!corpo || tipo === '%' || tipo === '$?') return false; // codice e CSS con sintassi estesa: no
    var d = adbDomini(dom), i;
    if (tipo === '$') { // snippet delle liste (solo per i siti indicati)
      if (ecc || !d.incl.length || corpo.length > 5000) return false;
      for (i = 0; i < d.incl.length; i++) adbMetti(c, d.incl[i], 'j', corpo);
      for (i = 0; i < d.escl.length; i++) adbMetti(c, d.escl[i], 'jx', corpo);
      return true;
    }
    if (corpo.charAt(0) === '+' || corpo.charAt(0) === '^') return false; // scriptlet e filtri HTML (sintassi estesa): no
    if (tipo === '?' || ADB_PROC.test(corpo)) { // selettori "procedurali" (:has, :has-text...): solo per i siti indicati
      if (ecc || !d.incl.length || corpo.length > 1000 || /[{}]/.test(corpo)) return false;
      for (i = 0; i < d.incl.length; i++) adbMetti(c, d.incl[i], 'p', corpo);
      return true;
    }
    if (!adbSelettoreOk(corpo)) return false;
    if (ecc) {
      if (!d.incl.length) c.genericiNo[corpo] = 1;
      for (i = 0; i < d.incl.length; i++) adbMetti(c, d.incl[i], 'e', corpo);
      return true;
    }
    if (!d.incl.length) c.generici[corpo] = 1;
    for (i = 0; i < d.incl.length; i++) adbMetti(c, d.incl[i], 's', corpo);
    for (i = 0; i < d.escl.length; i++) adbMetti(c, d.escl[i], 'e', corpo);
    return true;
  }

  // null = regola da saltare (opzioni che qui non si possono fare: csp, header...)
  function adbOpzioni(opz, ecc) {
    var o = { incl: [], escl: [], terze: null, popupSolo: false, pagina: '', richieste: true };
    if (!opz) return o;
    var tipi = 0, popup = false, documento = false, pagina = '';
    var parti = opz.split(',');
    for (var i = 0; i < parti.length; i++) {
      var p = parti[i].replace(/^\s+|\s+$/g, '').toLowerCase(), val = '', neg = false;
      if (!p) continue;
      var u = p.indexOf('=');
      if (u !== -1) { val = p.slice(u + 1); p = p.slice(0, u); }
      if (p.charAt(0) === '~') { neg = true; p = p.slice(1); }
      if (p === 'domain' || p === 'from') { var d = adbDomini(val.replace(/\|/g, ',')); o.incl = d.incl; o.escl = d.escl; continue; }
      if (p === 'third-party' || p === '3p' || p === 'strict3p') { o.terze = !neg; continue; }
      if (p === 'first-party' || p === '1p' || p === 'strict1p') { o.terze = neg; continue; }
      if (ADB_PAGINA[p]) { if (!neg) pagina += ADB_PAGINA[p]; continue; }
      if (p === 'document' || p === 'doc') { if (!neg) { documento = true; tipi++; } continue; }
      if (p === 'popup' || p === 'popunder') { if (!neg) { popup = true; tipi++; } continue; }
      if (ADB_TIPI[p]) { if (!neg) tipi++; continue; }
      if (ADB_IGNORA[p]) continue;
      return null;
    }
    o.popupSolo = popup && tipi === 1;
    if (ecc) {
      if (documento) pagina += 'D';
      o.pagina = pagina;
      o.richieste = !pagina || tipi > (documento ? 1 : 0);
    } else if (pagina) return null;
    return o;
  }

  function adbRete(r, c) {
    var ecc = r.charAt(0) === '@' && r.charAt(1) === '@';
    if (ecc) r = r.slice(2);
    var schema = r, opz = '', k = r.lastIndexOf('$');
    if (k !== -1 && /^~?[a-z0-9_\-]+(=|,|$)/i.test(r.slice(k + 1))) { schema = r.slice(0, k); opz = r.slice(k + 1); }
    var o = adbOpzioni(opz, ecc);
    if (!o) return false;
    schema = schema.toLowerCase();
    var i, h = /^\|\|([a-z0-9][a-z0-9.\-]*[a-z0-9])\^\|?$/.exec(schema), host = h ? h[1] : '';
    if (ecc) {
      if (o.popupSolo) return false;
      if (o.pagina) {
        var ph = host || (/^\|\|([a-z0-9.\-]+)[\^\/]/.exec(schema) || [])[1] || (/^\|https?:\/\/([a-z0-9.\-]+)[\/\^]/.exec(schema) || [])[1];
        if (ph) adbMetti(c, ph, 'f', o.pagina);
        else if (!schema || schema === '*') for (i = 0; i < o.incl.length; i++) adbMetti(c, o.incl[i], 'f', o.pagina);
        if (!o.richieste) return !!ph || !!o.incl.length;
      }
      if (host) {
        if (o.incl.length) for (i = 0; i < o.incl.length; i++) adbMetti(c, o.incl[i], 'xh', host);
        else c.consentiHost[host] = 1;
        return true;
      }
      var pe = adbSchema(schema, o);
      if (!pe) return false;
      if (o.incl.length) for (i = 0; i < o.incl.length; i++) adbMetti(c, o.incl[i], 'x', pe);
      else c.consenti.push(pe);
      return true;
    }
    if (o.terze === false) return false; // solo dal sito stesso: rare, si lasciano stare
    if (o.popupSolo) {
      if (!host || o.incl.length) return false;
      c.popup[host] = 1;
      return true;
    }
    if (host) {
      if (o.incl.length) for (i = 0; i < o.incl.length; i++) adbMetti(c, o.incl[i], o.terze ? 't' : 'r', host);
      else (o.terze ? c.terze : c.rete)[host] = 1;
      for (i = 0; i < o.escl.length; i++) adbMetti(c, o.escl[i], 'xh', host);
      return true;
    }
    var p = adbSchema(schema, o);
    if (!p) return false;
    if (o.incl.length) for (i = 0; i < o.incl.length; i++) adbMetti(c, o.incl[i], 'c', p);
    else c.schemi.push(p);
    for (i = 0; i < o.escl.length; i++) adbMetti(c, o.escl[i], 'x', p);
    return true;
  }

  // schema di indirizzo come lo usa main.js ("\t3" = solo da altri siti)
  function adbSchema(s, o) {
    if (!s || s.length > 300) return '';
    if (s.charAt(0) === '/' && s.charAt(s.length - 1) === '/' && s.length > 2) return ''; // espressioni regolari: no
    if (s.replace(/[|*^]/g, '').length < 3) return '';
    return o.terze ? s + '\t3' : s;
  }

  // "a.b.com" non serve se c'e' gia' "b.com"
  function adbDominiPuliti(mappa, gia) {
    var tutti = Object.keys(mappa), out = [];
    for (var i = 0; i < tutti.length; i++) {
      var h = tutti[i], p = h, doppio = false;
      for (;;) {
        if ((gia && ha(gia, p)) || (p !== h && ha(mappa, p))) { doppio = true; break; }
        var k = p.indexOf('.');
        if (k === -1) break;
        p = p.slice(k + 1);
      }
      if (!doppio) out.push(h);
    }
    return out.sort();
  }

  // Indice per parola, come gli adblocker veri: per ogni indirizzo si guardano
  // solo gli schemi che contengono una delle sue parole.
  function adbIndice(lista) {
    var idx = {}, conta = {}, senza = 0;
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i], sch = p.split('\t')[0], cand = sch.match(ADB_PAROLA) || [], scelta = '', n = Infinity, comune = '';
      for (var j = 0; j < cand.length; j++) {
        var w = cand[j].slice(1);
        if (ADB_COMUNI[w]) { if (!comune) comune = w; continue; }
        var q = ha(conta, w) ? conta[w] : 0;
        if (q < n || (q === n && w.length > scelta.length)) { scelta = w; n = q; }
      }
      scelta = scelta || comune;
      if (!scelta) { senza++; continue; }
      conta[scelta] = (ha(conta, scelta) ? conta[scelta] : 0) + 1;
      if (ha(idx, scelta)) idx[scelta].push(p); else idx[scelta] = [p];
    }
    return { idx: idx, senza: senza };
  }

  // prima i selettori semplici (#id, .classe): sono quelli che costano meno al browser
  function adbPeso(s) { return /^[#.][\w\-]+$/.test(s) ? 0 : (/[\[:]/.test(s) ? 2 : 1); }

  function adbCss(sel, corpo, max) {
    var out = '', blocco = [], lung = 0;
    for (var i = 0; i < sel.length; i++) {
      if (max && out.length + lung + sel[i].length > max) break;
      blocco.push(sel[i]);
      lung += sel[i].length + 1;
      // a gruppi: un selettore che il browser non capisce fa perdere solo il suo gruppo
      if (blocco.length >= 50) { out += blocco.join(',') + corpo; blocco = []; lung = 0; }
    }
    if (blocco.length) out += blocco.join(',') + corpo;
    return out;
  }

  function adbUnici(a) {
    var visti = {}, out = [];
    for (var i = 0; i < a.length; i++) if (!ha(visti, a[i])) { visti[a[i]] = 1; out.push(a[i]); }
    return out;
  }

  function adbFinale(c) {
    var rete = adbDominiPuliti(c.rete, null), mappa = {};
    for (var i = 0; i < rete.length; i++) mappa[rete[i]] = 1;
    var gen = [];
    for (var s in c.generici) if (ha(c.generici, s) && !ha(c.genericiNo, s)) gen.push(s);
    gen.sort(function (a, b) { return adbPeso(a) - adbPeso(b) || (a < b ? -1 : 1); });
    for (var d in c.sito) {
      if (!ha(c.sito, d)) continue;
      var x = c.sito[d];
      for (var k in x) if (ha(x, k) && Array.isArray(x[k])) x[k] = adbUnici(x[k]);
    }
    var sch = adbIndice(c.schemi), con = adbIndice(c.consenti);
    return {
      formato: ADB_FORMATO, quando: Date.now(), ver: String(Date.now()),
      conta: { regole: c.conta.regole, usate: c.conta.usate, domini: rete.length, generici: gen.length, siti: Object.keys(c.sito).length,
        schemi: c.schemi.length - sch.senza },
      rete: rete.join('\n'), terze: adbDominiPuliti(c.terze, mappa).join('\n'), popup: adbDominiPuliti(c.popup, mappa).join('\n'),
      consentiHost: Object.keys(c.consentiHost).sort().join('\n'),
      schemi: sch.idx, consenti: con.idx, generici: gen, sito: c.sito
    };
  }

  // Liste di regole -> risultato pronto. A pezzi di 25 ms: intanto il servizio risponde.
  function adbCompila(testi, fine) {
    var c = adbNuovo(), t = 0, righe = null, pos = 0;
    function passo() {
      try {
        var limite = Date.now() + 25;
        while (Date.now() < limite) {
          if (!righe) {
            if (t >= testi.length) { fine(null, adbFinale(c)); return; }
            righe = String(testi[t].testo || '').split(/\r?\n/);
            pos = 0;
          }
          var fino = Math.min(righe.length, pos + 500);
          for (; pos < fino; pos++) {
            var r = righe[pos].replace(/^\s+|\s+$/g, '');
            if (!r || r.charAt(0) === '!' || r.charAt(0) === '[') continue;
            c.conta.regole++;
            if (adbRiga(r, c)) c.conta.usate++;
          }
          if (pos >= righe.length) { righe = null; testi[t].testo = ''; t++; }
        }
      } catch (e) { fine(e); return; }
      setTimeout(passo, 0);
    }
    passo();
  }

  // Snippet delle liste: "nome arg 'arg con spazi'; altro arg"
  function adbSnippet(testoSnippet) {
    var albero = [], chiamata = [], arg = '', esc = false, virgolette = false, chiuse = false, uni = null;
    var s = String(testoSnippet).replace(/^\s+|\s+$/g, '') + ';';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), dopoChiuse = chiuse;
      chiuse = false;
      if (uni !== null) {
        uni += ch;
        if (uni.length === 4) { var n = parseInt(uni, 16); if (!isNaN(n)) arg += String.fromCharCode(n); uni = null; }
      } else if (esc) {
        esc = false;
        if (ch === 'u') uni = '';
        else arg += ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch;
      } else if (ch === '\\') esc = true;
      else if (ch === '\'') { virgolette = !virgolette; if (!virgolette) chiuse = true; }
      else if (virgolette || (ch !== ';' && !/\s/.test(ch))) arg += ch;
      else {
        if (arg || dopoChiuse) chiamata.push(arg);
        arg = '';
        if (ch === ';' && chiamata.length) { albero.push(chiamata); chiamata = []; }
      }
    }
    return albero;
  }

  // gli snippet che main.js sa fare (gli altri non si mandano)
  var ADB_SNIPPET_NOTI = { 'abort-on-property-read': 1, 'abort-on-property-write': 1, 'abort-current-inline-script': 1,
    'override-property-read': 1, 'hide-if-matches-xpath': 1, 'hide-if-contains': 1, 'hide-if-contains-visible-text': 1,
    'json-prune': 1, 'json-override': 1, 'prevent-listener': 1, 'cookie-remover': 1, 'prevent-element-src-loading': 1,
    'prevent-window-open': 1 };

  // regole di un sito: quelle scritte per lui e per i domini che lo contengono (www.x.it -> x.it, x.*)
  function adbChiavi(h) {
    var out = [], p = h.split('.');
    for (var i = 0; i < p.length - 1; i++) {
      out.push(p.slice(i).join('.'));
      out.push(p.slice(i, p.length - 1).join('.') + '.*');
      if (p.length - i > 2) out.push(p.slice(i, p.length - 2).join('.') + '.*');
    }
    if (p.length === 1) out.push(h);
    return out;
  }

  function adbSito(D, h) {
    var S = { s: [], e: {}, p: [], j: [], jx: {}, r: [], t: [], c: [], x: [], xh: [], f: '' };
    var chiavi = adbChiavi(h), sito = D.sito;
    for (var i = 0; i < chiavi.length; i++) {
      if (!ha(sito, chiavi[i])) continue;
      var d = sito[chiavi[i]], k, j;
      for (k in d) {
        if (!ha(d, k)) continue;
        if (k === 'f') { S.f += d.f; continue; }
        if (k === 'e' || k === 'jx') { for (j = 0; j < d[k].length; j++) S[k][d[k][j]] = 1; continue; }
        if (S[k]) S[k] = S[k].concat(d[k]);
      }
    }
    return S;
  }

  // le parti uguali per tutti i siti, gia' pronte in JSON (si preparano una volta)
  function adbPronte(d) {
    return {
      rete: JSON.stringify(d.rete), terze: JSON.stringify(d.terze), popup: JSON.stringify(d.popup),
      consentiHost: JSON.stringify(d.consentiHost), schemi: JSON.stringify(d.schemi), consenti: JSON.stringify(d.consenti),
      css: JSON.stringify(adbCss(d.generici, ADB_INVISIBILE, ADB_CSS_MAX))
    };
  }

  // risposta di /api/adblock per un sito (senza la parentesi iniziale e "blocco"). Con "pezzi" la da' come
  // [prima, css, dopo] senza le parti uguali per tutti i siti (adbComuni; il CSS comune quando css e' null)
  function adbRispostaPer(D, J, h, pezzi) {
    var S = adbSito(D, h), i;
    var off = S.f.indexOf('D') !== -1, nienteCss = S.f.indexOf('E') !== -1;
    if (off) return '"ver":' + JSON.stringify(D.ver) + ',"off":1}';
    // CSS generico: quello comune, oppure senza i selettori che questo sito chiede di lasciare stare
    var css = J.css, togli = false;
    if (nienteCss || S.f.indexOf('G') !== -1) css = '""';
    else {
      for (var e in S.e) if (ha(S.e, e)) { togli = true; break; }
      if (togli) css = JSON.stringify(adbCss(D.generici.filter(function (x) { return !ha(S.e, x); }), ADB_INVISIBILE, ADB_CSS_MAX));
    }
    var propri = [];
    if (!nienteCss && S.f.indexOf('S') === -1) for (i = 0; i < S.s.length; i++) if (!ha(S.e, S.s[i])) propri.push(S.s[i]);
    var snip = [];
    for (i = 0; i < S.j.length && snip.length < 60; i++) {
      if (ha(S.jx, S.j[i])) continue;
      var albero = adbSnippet(S.j[i]);
      for (var a = 0; a < albero.length; a++) if (ha(ADB_SNIPPET_NOTI, albero[a][0])) snip.push(albero[a]);
    }
    var sito = { css: adbCss(adbUnici(propri), ADB_NASCOSTO, 0), proc: nienteCss ? [] : adbUnici(S.p).slice(0, 80), snip: snip,
      rete: adbUnici(S.r).join('\n'), terze: adbUnici(S.t).join('\n'), consentiHost: adbUnici(S.xh).join('\n'),
      schemi: adbUnici(S.c).slice(0, 300), consenti: adbUnici(S.x).slice(0, 300) };
    var prima = '"ver":' + JSON.stringify(D.ver) + ',"off":0,"noblock":' + (S.f.indexOf('B') !== -1 ? 1 : 0);
    var dopo = ',"sito":' + JSON.stringify(sito) + '}';
    if (pezzi) return [prima, css === J.css ? null : ',"css":' + css, dopo];
    return prima + adbComuni(J) + ',"css":' + css + dopo;
  }
  function adbComuni(J) {
    return ',"rete":' + J.rete + ',"terze":' + J.terze + ',"popup":' + J.popup +
      ',"consentiHost":' + J.consentiHost + ',"schemi":' + J.schemi + ',"consenti":' + J.consenti;
  }
  /* </adblock:comune> */


  var adb = { dati: null, json: null, stato: 'mai', errore: '', inCorso: false, timer: null, cache: {}, nCache: 0, fonti: '', comuni: null };

  function listeScelte() {
    if (typeof HOMETV_PROVE_LISTE === 'object' && Array.isArray(HOMETV_PROVE_LISTE)) return adbListeValide(HOMETV_PROVE_LISTE);
    var scelte = adbListeValide(prefs.listeFiltri);
    if (scelte.length) return scelte;
    // la lista contro i muri anti-adblock solo col blocco avanzato acceso (impostazioni del TV, spento di base)
    return prefs.bloccoAvanzato === true ? LISTE_PREDEFINITE : LISTE_PREDEFINITE.filter(function (l) { return l.nome !== 'Anti-adblock'; });
  }
  function adbListeValide(v) {
    var out = [];
    if (!Array.isArray(v)) return out;
    for (var i = 0; i < v.length && out.length < 8; i++) {
      var x = v[i], u = typeof x === 'string' ? [x] : (x && typeof x === 'object' ? (Array.isArray(x.url) ? x.url : [x.url]) : []);
      var buoni = [];
      for (var j = 0; j < u.length; j++) if (typeof u[j] === 'string' && /^https?:\/\/[^\s"']+$/i.test(u[j])) buoni.push(u[j]);
      if (buoni.length) out.push({ nome: testo((x && x.nome) || buoni[0].replace(/^.*\//, ''), 60), url: buoni });
    }
    return out;
  }
  function adbFonti(liste) {
    var u = [];
    for (var i = 0; i < liste.length; i++) u.push(liste[i].url[0]);
    return u.join(' ');
  }

  function adbScarica(indirizzo, conCa, fatto, salti) {
    var finito = false, req = null;
    function fine(err, t) { if (finito) return; finito = true; fatto(err, t); }
    var o = urlLib.parse(indirizzo);
    var mod = o.protocol === 'https:' ? require('https') : (o.protocol === 'http:' ? http : null);
    if (!mod) { fine(new Error('indirizzo non valido')); return; }
    var opz = { hostname: o.hostname, port: o.port, path: o.path,
      headers: { 'Accept-Encoding': 'gzip', 'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen) HomeTV/' + VERSION } };
    if (conCa) { opz.ca = [ADB_RADICE_LE]; opz.agent = false; }
    try {
      req = mod.get(opz, function (res) {
        var st = res.statusCode;
        if (st >= 300 && st < 400 && res.headers.location && (salti || 0) < 4) {
          res.resume();
          adbScarica(urlLib.resolve(indirizzo, res.headers.location), conCa, fine, (salti || 0) + 1);
          return;
        }
        if (st !== 200) { res.resume(); fine(new Error('HTTP ' + st)); return; }
        var flusso = res;
        if (/gzip/i.test(String(res.headers['content-encoding'] || ''))) { flusso = zlib.createGunzip(); res.pipe(flusso); }
        var pezzi = [], tot = 0;
        flusso.on('data', function (d) {
          tot += d.length;
          if (tot > ADB_MAX_LISTA) { fine(new Error('lista troppo grande')); try { req.abort(); } catch (e) {} return; }
          pezzi.push(d);
        });
        flusso.on('end', function () { fine(null, Buffer.concat(pezzi).toString('utf8')); });
        flusso.on('error', fine);
        res.on('error', fine);
      });
    } catch (e) { fine(e); return; }
    req.on('error', fine);
    req.setTimeout(60000, function () { fine(new Error('tempo scaduto')); try { req.abort(); } catch (e) {} });
  }

  // una lista: indirizzo principale e copie; certificati "vecchi" del TV: si riprova con quello di Let's Encrypt
  function adbScaricaLista(l, fatto) {
    var i = 0, conCa = false, ultimo = null;
    (function prova() {
      if (i >= l.url.length) { fatto(ultimo || new Error('non raggiungibile')); return; }
      adbScarica(l.url[i], conCa, function (err, t) {
        if (!err && /^\s*(\[(adblock|ublock|adguard)|!)/i.test(t)) { fatto(null, t); return; }
        ultimo = err || new Error('non e\' una lista di filtri');
        if (err && !conCa && /CERT|ISSUER|SELF_SIGNED|UNABLE_TO/i.test(String(err.code || err.message))) { conCa = true; prova(); return; }
        conCa = false;
        i++;
        prova();
      });
    })();
  }

  /* ------------------------------------------------------------ store: cataloghi delle fonti private
   * La home li scarica da sola; questo serve per i siti che non lo permettono alla pagina (CORS) e per i certificati
   * che il motore del TV non conosce. Solo https (anche dopo un rimando), mai indirizzi locali, solo fino a 300 KB. */
  var STORE_MAX = 300000, STORE_TEMPO = 8000;
  // nomi del TV o della rete di casa, anche scritti in modo strano (0x7f000001, 127.1, "localhost.")
  function storeLocale(h) {
    h = String(h || '').toLowerCase().replace(/\.$/, '');
    return !h || h === 'localhost' || /\.(localhost|local|lan|home|internal|arpa)$/.test(h) || /^[0-9x.]+$/.test(h) ||
      h.indexOf(':') !== -1 || h.charAt(0) === '[' || h.indexOf('.') === -1;
  }
  // il nome puo' puntare a un indirizzo di casa anche se non lo sembra (127.0.0.1.nip.io): si controlla l'indirizzo vero
  function storeIpPrivato(ip) {
    ip = String(ip || '').toLowerCase();
    if (ip.indexOf(':') !== -1) return ip === '::1' || ip === '::' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^::ffff:/.test(ip);
    return /^(0|10|127)\./.test(ip) || /^169\.254\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(ip);
  }
  // scade: l'ora entro cui deve finire tutto, rimandi e secondo tentativo compresi
  function storeScarica(indirizzo, conCa, fatto, salti, scade) {
    var finito = false, req = null, orologio = null;
    function fine(err, t) { if (finito) return; finito = true; clearTimeout(orologio); fatto(err, t); }
    var o = urlLib.parse(indirizzo);
    if (o.protocol !== 'https:' || storeLocale(o.hostname)) { fine(new Error('indirizzo non valido')); return; }
    var resto = scade - Date.now();
    if (resto <= 0) { fine(new Error('tempo scaduto')); return; }
    orologio = setTimeout(function () { fine(new Error('tempo scaduto')); try { if (req) req.abort(); } catch (e) {} }, resto);
    require('dns').lookup(o.hostname, function (err, ip) {
      if (finito) return;
      if (err || storeIpPrivato(ip)) { fine(err || new Error('indirizzo non valido')); return; }
      // ci si collega proprio a quell'indirizzo (non si richiede il nome di nuovo), col nome giusto per il certificato
      var opz = { host: ip, servername: o.hostname, port: o.port || 443, path: o.path, agent: false,
        headers: { Host: o.host, 'Accept-Encoding': 'gzip', 'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen) HomeTV/' + VERSION } };
      if (conCa) opz.ca = [ADB_RADICE_LE];
      storeRichiesta(opz, indirizzo, conCa, fine, salti, scade, function (r) { req = r; });
    });
  }
  function storeRichiesta(opz, indirizzo, conCa, fine, salti, scade, tieni) {
    var req = null;
    try {
      req = require('https').get(opz, function (res) {
        var st = res.statusCode;
        if (st >= 300 && st < 400 && res.headers.location && (salti || 0) < 3) {
          res.resume();
          storeScarica(urlLib.resolve(indirizzo, res.headers.location), conCa, fine, (salti || 0) + 1, scade);
          return;
        }
        if (st !== 200) { res.resume(); var e = new Error('HTTP ' + st); e.stato = st; fine(e); return; }
        var flusso = res;
        if (/gzip/i.test(String(res.headers['content-encoding'] || ''))) { flusso = zlib.createGunzip(); res.pipe(flusso); }
        var pezzi = [], tot = 0;
        flusso.on('data', function (d) {
          tot += d.length;
          if (tot > STORE_MAX) { fine(new Error('troppo grande')); try { req.abort(); } catch (er) {} return; }
          pezzi.push(d);
        });
        flusso.on('end', function () { fine(null, Buffer.concat(pezzi).toString('utf8')); });
        flusso.on('error', fine);
        res.on('error', fine);
      });
    } catch (e) { fine(e); return; }
    tieni(req);
    req.on('error', fine);
  }
  // un certificato che il TV non conosce: si riprova con quello di Let's Encrypt (come per le liste di filtri), sempre
  // dentro gli stessi 8 secondi
  function storeScaricaFonte(indirizzo, fatto) {
    var scade = Date.now() + STORE_TEMPO;
    storeScarica(indirizzo, false, function (err, t) {
      if (err && /CERT|ISSUER|SELF_SIGNED|UNABLE_TO/i.test(String(err.code || err.message))) { storeScarica(indirizzo, true, fatto, 0, scade); return; }
      fatto(err, t);
    }, 0, scade);
  }

  function adbPianifica(ms) {
    clearTimeout(adb.timer);
    adb.timer = setTimeout(function () { adbAggiorna(false); }, ms);
  }

  function adbUsa(d) {
    adb.dati = d;
    adb.json = adbPronte(d);
    adb.comuni = null;
    adb.cache = {};
    adb.nCache = 0;
    adb.fonti = d.fonti || '';
    adb.stato = 'ok';
  }

  function adbAggiorna(forza) {
    if (adb.inCorso) return;
    var liste = listeScelte(), fonti = adbFonti(liste);
    var fresche = adb.dati && fonti === adb.fonti && Date.now() - adb.dati.quando < ADB_OGNI && Date.now() >= adb.dati.quando;
    if (fresche && !forza) { adbPianifica(ADB_OGNI - (Date.now() - adb.dati.quando) + 1000); return; }
    adb.inCorso = true;
    adb.stato = adb.dati ? 'aggiorno' : 'scarico';
    var testi = [], errori = [], i = 0;
    function finito(ok, ms) {
      adb.inCorso = false;
      if (!ok) adb.stato = adb.dati ? 'ok' : 'errore';
      adbPianifica(ms);
    }
    (function prossima() {
      if (i < liste.length) {
        var l = liste[i++];
        adbScaricaLista(l, function (err, t) {
          if (err) errori.push(l.nome + ': ' + (err.code || err.message));
          else testi.push({ nome: l.nome, testo: t });
          prossima();
        });
        return;
      }
      adb.errore = errori.join('; ');
      if (errori.length) log('liste di filtri: ' + adb.errore);
      // una lista non scaricata: si tengono quelle di prima (se sono le stesse liste)
      if (!testi.length || (errori.length && adb.dati && fonti === adb.fonti)) { finito(false, ADB_RIPROVA); return; }
      var nomi = [];
      for (var k = 0; k < testi.length; k++) nomi.push(testi[k].nome);
      adbCompila(testi, function (err, d) {
        if (err) { adb.errore = 'liste non lette: ' + err.message; log(adb.errore); finito(false, ADB_RIPROVA); return; }
        d.liste = nomi;
        d.fonti = fonti;
        adbUsa(d);
        scriviJson(FILE_ADBLOCK, d, true);
        log('liste di filtri pronte: ' + nomi.join(', ') + ' (' + d.conta.usate + ' regole)');
        finito(true, errori.length ? ADB_RIPROVA : ADB_OGNI);
      });
    })();
  }

  function inByte(t) { return typeof Buffer.alloc === 'function' ? Buffer.from(t, 'utf8') : new Buffer(t, 'utf8'); }

  // risposta per un sito, gia' in byte (si prepara una volta, poi si manda e basta)
  // in cache solo i pezzi di ogni sito; le parti uguali per tutti sono una copia sola (adb.comuni)
  function adbRisposta(h) {
    if (ha(adb.cache, h)) return adb.cache[h];
    var p = adbRispostaPer(adb.dati, adb.json, h, true), r;
    if (typeof p === 'string') r = [inByte(p)];
    else {
      if (!adb.comuni) adb.comuni = { dati: inByte(adbComuni(adb.json)), css: inByte(',"css":' + adb.json.css) };
      r = [inByte(p[0]), adb.comuni.dati, p[1] === null ? adb.comuni.css : inByte(p[1]), inByte(p[2])];
    }
    if (adb.nCache >= 40) { adb.cache = {}; adb.nCache = 0; }
    adb.cache[h] = r;
    adb.nCache++;
    return r;
  }

  function statoAdblock() {
    var D = adb.dati;
    return { stato: adb.stato, errore: adb.errore, ver: D ? D.ver : '', quando: D ? D.quando : 0, liste: D ? D.liste : [],
      conta: D ? D.conta : null, scelte: listeScelte().map(function (l) { return l.nome; }) };
  }

  // il tuo sito e i domini consentiti: mai trattati come pubblicita', anche se una lista li nominasse
  function adbSicuri() {
    var out = [], d = Array.isArray(prefs.dominiConsentiti) ? prefs.dominiConsentiti : [];
    var m = typeof prefs.url === 'string' && /^https?:\/\/([^\/?#:]+)/i.exec(prefs.url);
    if (m) out.push(m[1].toLowerCase());
    // i siti aggiunti col "+" con il blocco completo valgono come il tuo sito (quelli col blocco normale no: possono essere
    // siti molto grandi come Google, e le liste smetterebbero di bloccare i loro annunci su tutti i siti)
    var siti = Array.isArray(prefs.siti) ? prefs.siti : [];
    for (var s = 0; s < siti.length && out.length < 30; s++) {
      m = siti[s] && siti[s].blocco === 'completo' && typeof siti[s].url === 'string' && /^https?:\/\/([^\/?#:]+)/i.exec(siti[s].url);
      if (m) out.push(m[1].toLowerCase());
    }
    for (var i = 0; i < d.length && out.length < 30; i++) {
      if (typeof d[i] === 'string' && /^[a-z0-9.\-*]{1,253}$/i.test(d[i])) out.push(d[i].toLowerCase().replace(/^\*\./, ''));
    }
    return out;
  }

  function rispondiAdblock(req, res, query) {
    var blocco = prefs.bloccoPubblicita !== false;
    var h = String(query.host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!/^[a-z0-9.\-:]{1,253}$/.test(h)) { sendJson(req, res, 400, { error: 'host non valido' }, true); return; }
    var testa = inByte('{"blocco":' + blocco + ',"sicuri":' + JSON.stringify(adbSicuri()) + (adb.dati && blocco ? ',' : ',"ver":""}'));
    var corpo = adb.dati && blocco ? adbRisposta(h) : [], lung = testa.length, i;
    for (i = 0; i < corpo.length; i++) lung += corpo[i].length;
    var h2 = headers(req, 'application/json; charset=utf-8', null, true);
    h2['Content-Length'] = lung;
    res.writeHead(200, h2);
    res.write(testa);
    for (i = 0; i < corpo.length; i++) res.write(corpo[i]);
    res.end();
  }

  function adbCarica() {
    var d = leggiJson(FILE_ADBLOCK, null);
    if (!d || d.formato !== ADB_FORMATO || !d.ver || !d.sito || !d.schemi || !Array.isArray(d.generici)) return;
    try { adbUsa(d); log('liste di filtri dal file: ' + (d.liste || []).join(', ')); }
    catch (e) { adb.dati = null; adb.json = null; adb.stato = 'mai'; log('liste dal file non valide: ' + e.message); }
  }

  /* ---------------------------------------------------------- riaccensione */

  // Quando il TV esce dallo standby riapre TizenBrew, che apre subito la home
  // (se in TizenBrew la home e' impostata come modulo ad avvio automatico).
  // Il TV non avvisa le app dell'accensione, quindi si guardano due segnali:
  //  1. lo stato letto dall'API locale del televisore (standby -> acceso);
  //  2. un "salto" dell'orologio: in un vero standby il sistema dorme, l'ora
  //     reale avanza ma l'orologio monotono (hrtime) no. Un processo solo
  //     rallentato o fermo non produce questa differenza, quindi niente falsi
  //     allarmi mentre guardi Netflix.

  function tizenBrewAppId() {
    try { return tizen.application.getAppInfo().packageId + '.TizenBrewStandalone'; }
    catch (e) { return 'xvvl3S1bvH.TizenBrewStandalone'; }
  }

  // l'API locale del TV (nelle prove sul computer un finto TV su un'altra porta)
  var PORTA_API_TV = typeof HOMETV_PROVE_API_TV === 'number' ? HOMETV_PROVE_API_TV : 8001;
  function powerState(cb) {
    var done = false;
    function finish(v) { if (!done) { done = true; cb(v); } }
    try {
      var req = http.get({ host: '127.0.0.1', port: PORTA_API_TV, path: '/api/v2/' }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          try {
            var j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (j && j.device && typeof j.device === 'object') tvDalTv.device = j.device; // per il profilo del TV
            if (j && j.device && j.device.PowerState) tvDalTv.haStato = true; // questo TV il suo stato lo dice
            finish(j && j.device && j.device.PowerState ? String(j.device.PowerState).toLowerCase() : '');
          } catch (e) { finish(''); }
        });
        res.on('error', function () { finish(''); });
      });
      req.on('error', function () { finish(''); });
      req.setTimeout(3000, function () { req.abort(); finish(''); });
    } catch (e) { finish(''); }
  }

  function monoMs() {
    var t = process.hrtime();
    return t[0] * 1000 + t[1] / 1e6;
  }

  var lastState = '', lastWall = Date.now(), lastMono = monoMs(), lastWake = 0;

  function wake(reason) {
    if (!settings.apriAllAccensione || !HAS_TIZEN) return;
    if (Date.now() - lastWake < 60000) return;
    lastWake = Date.now();
    log('riaccensione (' + reason + '): apro la home');
    // qualche secondo di attesa, altrimenti la schermata di Samsung la copre
    setTimeout(function () {
      launchApp(tizenBrewAppId())['catch'](function (e) { log('home non aperta: ' + e.message); });
    }, 2500);
  }

  function watchPower() {
    setTimeout(watchPower, 4000); // il prossimo controllo e' gia' programmato, qualunque cosa accada
    try {
      var wall = Date.now(), mono = monoMs();
      var dormito = (wall - lastWall) - (mono - lastMono);
      lastWall = wall;
      lastMono = mono;
      powerState(function (state) {
        try {
          if (state) {
            if (lastState && lastState !== 'on' && state === 'on') wake('standby -> acceso');
            lastState = state;
          } else if (dormito > 40000) lastState = 'sonno'; // tace appena risvegliato: il primo "on" vale come accensione
          // il TV che non dice il suo stato: decide il profilo del TV (basta il salto dell'orologio)
          if (dormito > 40000 && ProfiloTV.riapriDopoSonno(state, tvDalTv.haStato)) wake('il sistema ha dormito ' + Math.round(dormito / 1000) + ' s');
        } catch (e) { log('controllo accensione: ' + e.message); }
      });
    } catch (e) { log('controllo accensione: ' + e.message); }
  }

  /* ---------------------------------------------------------- profilo del TV
   * I fatti che sa solo il servizio (API del TV, TizenBrew, porte, salvataggio) vanno a ProfiloTV (profilo.js, copiato
   * qui sopra): li' si decide cosa c'e', cosa manca e cosa fare. La home lo legge da /api/tv (impostazioni "Questo TV"
   * e autodiagnosi all'avvio) e gli manda i fatti della pagina (motore web, schermo, tasti colorati visti);
   * l'installatore lo legge da http://<indirizzo del TV>:8091/tv. */
  var tvDalTv = { device: null, tizenbrew: '', tizen: '', scrittura: true, coloriVisti: false, pagina: null };

  function versioneTizen() {
    if (tvDalTv.tizen || !HAS_TIZEN) return tvDalTv.tizen;
    try { tvDalTv.tizen = String(tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version') || ''); } catch (e) {}
    return tvDalTv.tizen;
  }
  function versioneTizenBrew() {
    if (tvDalTv.tizenbrew || !HAS_TIZEN) return tvDalTv.tizenbrew;
    try { tvDalTv.tizenbrew = String(tizen.application.getAppInfo(tizenBrewAppId()).version || ''); } catch (e) {}
    return tvDalTv.tizenbrew;
  }
  function fattiTv() {
    var d = tvDalTv.device || {}, D = adb.dati;
    var f = {
      servizio: true, versioneServizio: VERSION, tizen: HAS_TIZEN,
      appTv: { n: cache.apps ? cache.apps.length : 0, errore: cache.errore || (ALTRA && ALTRA.appErrore) || '' },
      nome: String(d.name || ''), modello: String(d.modelName || ''), modelloPiattaforma: String(d.model || ''),
      tizenVer: versioneTizen(), tizenbrew: versioneTizenBrew(), risoluzione: String(d.resolution || ''),
      api8001: !!tvDalTv.device, statoAccensione: !!d.PowerState, apriAllAccensione: settings.apriAllAccensione !== false,
      remoto: rem.stato, telefono: { attivo: tel.attivo, errore: tel.errore },
      liste: { stato: D ? 'ok' : adb.stato === 'errore' ? 'errore' : 'mai', regole: D && D.conta ? D.conta.usate : 0 },
      // nelle prove e nella TV sul Mac i file restano (/tmp delle prove, cartella dei dati): valgono come quelli del TV
      salvataggio: (CACHE_DIR === SHARE || PROVE || (ALTRA && ALTRA.datiFissi)) && tvDalTv.scrittura ? 'tv' : 'temporaneo', casa: !!trovaCasa().origin,
      coloriVisti: tvDalTv.coloriVisti, pagina: tvDalTv.pagina,
      // l'app Video: le chiavette si vedono e si leggono? (videoteca.prova)
      chiavette: chiavette
    };
    // le altre TV: chi sono (sistema, modello) e cosa non sanno fare (la riapertura all'accensione)
    if (ALTRA) {
      f.piattaforma = ALTRA.nome;
      f.sistema = String(ALTRA.sistema || '');
      f.modello = String(ALTRA.modello || '');
      f.riaccensione = ALTRA.riaccensione !== false;
    }
    return f;
  }
  function profiloTv() { return ProfiloTV.componi(fattiTv()); }
  // i fatti della pagina della home (solo testi e numeri corti)
  function salvaPagina(b) {
    function t(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n); }
    function num(v) { var x = Number(v); return isFinite(x) ? Math.max(0, Math.min(100000, Math.round(x))) : 0; }
    tvDalTv.pagina = { ua: t(b.ua, 300), larghezza: num(b.larghezza), altezza: num(b.altezza), chromium: num(b.chromium),
      variabiliCss: !!b.variabiliCss };
    if (b.coloriVisti === true) tvDalTv.coloriVisti = true;
  }

  /* ---------------------------------------------------------- avvio */

  var server = http.createServer(function (req, res) {
    try { handle(req, res); } catch (e) { fail(req, res, 500)(e); }
  });
  server.on('error', function (e) {
    log('server non avviato: ' + (e && e.code ? e.code : e));
  });
  server.listen(PORT, '127.0.0.1', function () {
    log('in ascolto su 127.0.0.1:' + PORT + ' (tizen: ' + HAS_TIZEN + ')');
    // solo la copia che ha davvero la porta fa il resto del lavoro
    avviaServerTelefono();
    // liste di filtri: quelle salvate subito, poi (con calma) si guarda se aggiornarle
    adbCarica();
    adbPianifica(PROVE ? 300 : 20000);
    if (HAS_TIZEN) {
      refreshApps()['catch'](function (e) { log('elenco app: ' + e.message); });
      powerState(function () {}); // subito chi e' il TV (modello, risoluzione) per il profilo
      setTimeout(watchPower, 4000);
    } else if (ALTRA) refreshApps()['catch'](function (e) { log('elenco app: ' + e.message); });
  });

  /* <telefono:generato> pagina e icona del telecomando (create a parte: non modificare a mano) */
  var TELEFONO_HTML = [
    '<!DOCTYPE html>',
    '<html lang="it">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="Telecomando">',
    '<meta name="theme-color" content="#0b0c10">',
    '<link rel="apple-touch-icon" href="/icona.png">',
    '<link rel="icon" href="/icona.png">',
    '<title>Telecomando</title>',
    '<style>',
    '  :root {',
    '    --bg: #0a0b0f; --surface: #15171d; --surface-2: #1e2129; --surface-3: #282c35; --line: rgba(255,255,255,.07);',
    '    --text: #f4f5f7; --text-2: rgba(232,235,242,.6); --text-3: rgba(232,235,242,.36);',
    '    --accent: #34d3bd; --warn: #ffb45c; --danger: #ff6b6b;',
    '    --grad: linear-gradient(120deg, #19d3b7, #3b82f6 55%, #8b5cf6);',
    '    color-scheme: dark;',
    '  }',
    '  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }',
    '  html { background: var(--bg); }',
    '  html, body { margin: 0; min-height: 100%; color: var(--text); }',
    '  body {',
    '    font: 500 16px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;',
    '    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation;',
    '    padding: calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 22px);',
    '    overflow-x: hidden;',
    '    background: radial-gradient(120% 55% at 50% -12%, rgba(59,130,246,.13), rgba(139,92,246,.05) 45%, rgba(10,11,15,0) 72%) no-repeat, var(--bg);',
    '  }',
    '  button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; touch-action: manipulation; }',
    '  svg { display: block; }',
    '  .app { max-width: 430px; margin: 0 auto; }',
    '  [hidden] { display: none !important; }',
    '',
    '  /* in alto: dove sei sul TV, tastiera, spegnimento */',
    '  .testa { display: flex; align-items: center; gap: 10px; margin: 6px 2px 18px; }',
    '  .dove { flex: 1; min-width: 0; }',
    '  .dove-nota { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-2); letter-spacing: .02em; }',
    '  .dove strong { display: block; margin-top: 2px; font-size: 24px; font-weight: 700; letter-spacing: -.02em;',
    '    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); flex: none; }',
    '  .dot.ok { background: var(--accent); box-shadow: 0 0 0 3px rgba(52,211,189,.18); }',
    '  .dot.no { background: var(--warn); }',
    '  .icona { width: 46px; height: 46px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center;',
    '    background: var(--surface); border: 1px solid var(--line); transition: transform .08s ease, background-color .08s ease; }',
    '  .icona svg { width: 22px; height: 22px; fill: var(--text); }',
    '  .icona.press { transform: scale(.92); background: var(--surface-2); }',
    '  .spegni svg { fill: var(--danger); }',
    '',
    '  /* riquadri che compaiono da soli: si scrive sul TV, video sul TV */',
    '  .scheda { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; margin-bottom: 14px; }',
    '  .scrivi-tv { padding: 14px; border: 1.5px solid transparent;',
    '    background: linear-gradient(var(--surface), var(--surface)) padding-box, var(--grad) border-box; }',
    '  .scrivi-tv-testa { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 2px 10px; }',
    '  .scrivi-tv-testa b { font-size: 15px; flex: none; }',
    '  .scrivi-tv-testa span { font-size: 13px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .campo { display: flex; gap: 8px; }',
    '  input { -webkit-user-select: text; user-select: text; flex: 1; min-width: 0; height: 48px; border-radius: 14px;',
    '    border: 1px solid var(--line); background: var(--bg); color: var(--text); padding: 0 14px; font: inherit; font-size: 17px; outline: 0;',
    '    transition: border-color .15s ease, box-shadow .15s ease; }',
    '  input:focus { border-color: rgba(59,130,246,.7); box-shadow: 0 0 0 3px rgba(59,130,246,.18); }',
    '  .invia { height: 48px; padding: 0 18px; border-radius: 14px; background: var(--text); color: #0b0c10; font-weight: 700; flex: none; }',
    '  .invia:disabled { opacity: .3; }',
    '  .nota { font-size: 12px; color: var(--text-2); margin: 10px 2px 0; line-height: 1.4; }',
    '  .lista-schede { max-height: 56vh; overflow-y: auto; -webkit-overflow-scrolling: touch; font-size: 14px; color: var(--text-2); }',
    '  .riga-scheda { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px; margin-bottom: 8px; border-radius: 14px;',
    '    background: rgba(255, 255, 255, .06); text-align: left; color: var(--text); }',
    '  .riga-scheda.attiva { box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .35); }',
    '  .riga-scheda img, .riga-scheda i { width: 72px; height: 44px; flex: none; border-radius: 8px; object-fit: cover; background: rgba(255, 255, 255, .1); }',
    '  .riga-scheda i { display: flex; align-items: center; justify-content: center; font-style: normal; font-weight: 700; font-size: 18px; }',
    '  .riga-scheda div { min-width: 0; }',
    '  .riga-scheda b, .riga-scheda span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .riga-scheda b { font-size: 15px; }',
    '  .riga-scheda span { font-size: 12px; color: var(--text-2); margin-top: 2px; }',
    '  .vista-store, .vista-app { padding-bottom: 28px; }',
    '  .store-testa { display: flex; align-items: center; gap: 12px; margin: 6px 2px 14px; }',
    '  .store-testa .icona svg { fill: none; stroke: var(--text); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }',
    '  .store-titoli { flex: 1; min-width: 0; }',
    '  .store-titoli strong { display: block; font-size: 26px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; }',
    '  .store-titoli span { display: block; font-size: 12px; color: var(--text-2); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .cerca-box { position: relative; margin-bottom: 12px; }',
    '  .cerca-box svg { position: absolute; left: 14px; top: 13px; width: 18px; height: 18px; fill: var(--text-2); }',
    '  .cerca-store { display: block; width: 100%; height: 44px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface);',
    '    color: var(--text); padding: 0 14px 0 42px; font: inherit; font-size: 16px; outline: 0; -webkit-appearance: none; }',
    '  .store-nota { margin: 0 2px 10px; }',
    '  .store-nota.via { display: none; }',
    '  .vuoto-store { padding: 24px 4px; font-size: 14px; color: var(--text-2); text-align: center; }',
    '  .sezione-store { margin: 16px 0 6px; }',
    '  .sezione-store h3 { margin: 0 2px 10px; font-size: 18px; font-weight: 800; letter-spacing: -.01em; }',
    '  .scorri { display: flex; gap: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory;',
    '    padding: 2px 2px 8px; margin: 0 -2px; scrollbar-width: none; }',
    '  .scorri::-webkit-scrollbar { display: none; }',
    '  .carta-grande { position: relative; flex: none; width: 84%; max-width: 360px; aspect-ratio: 5 / 3; border-radius: 18px; overflow: hidden;',
    '    scroll-snap-align: start; color: #fff; text-align: left; box-shadow: 0 10px 26px rgba(0, 0, 0, .35); }',
    '  .carta-grande img.cop { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }',
    '  .carta-grande .ico-grande, .carta-grande .dentro { display: none; }',
    '  .carta-grande.senza .ico-grande { display: flex; position: absolute; left: 16px; top: 16px; width: 56px; height: 56px; border-radius: 15px;',
    '    overflow: hidden; align-items: center; justify-content: center; font-size: 26px; font-weight: 800; background: rgba(255, 255, 255, .16) !important; }',
    '  .carta-grande.senza .ico-grande img { width: 100%; height: 100%; object-fit: cover; }',
    '  .carta-grande.senza .dentro { display: block; position: absolute; left: 16px; right: 16px; bottom: 14px; }',
    '  .carta-grande .dentro b { display: block; font-size: 21px; font-weight: 800; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .carta-grande .dentro span { display: block; font-size: 13px; opacity: .82; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .carta-app { position: relative; flex: none; width: 92px; scroll-snap-align: start; text-align: left; color: var(--text); }',
    '  .carta-app .ico { position: relative; width: 92px; height: 92px; border-radius: 22px; overflow: hidden; display: flex; align-items: center;',
    '    justify-content: center; font-size: 36px; font-weight: 800; color: #fff; }',
    '  .carta-app .ico img { width: 100%; height: 100%; object-fit: cover; }',
    '  .carta-app b { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 8px; font-size: 13px;',
    '    font-weight: 700; line-height: 1.25; }',
    '  .carta-app span { display: block; margin-top: 2px; font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .carta-app span.privata, .riga-app span.privata { color: var(--warn); }',
    '  .spunta-app { position: absolute; right: 7px; top: 7px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, .4); }',
    '  .spunta-app:after { content: ""; position: absolute; left: 7px; top: 4px; width: 5px; height: 9px; border: solid #0b0c10; border-width: 0 2px 2px 0; transform: rotate(45deg); }',
    '  .pallino-app { position: absolute; right: 8px; top: 8px; width: 15px; height: 15px; border-radius: 50%; background: #3b82f6; box-shadow: 0 0 0 3px #fff; }',
    '  .riga-app { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px; margin-bottom: 8px; border-radius: 14px;',
    '    background: rgba(255, 255, 255, .06); color: var(--text); text-align: left; }',
    '  .riga-app .ico { width: 52px; height: 52px; flex: none; border-radius: 13px; overflow: hidden; display: flex; align-items: center; justify-content: center;',
    '    font-weight: 800; font-size: 22px; color: #fff; }',
    '  .riga-app .ico img { width: 100%; height: 100%; object-fit: cover; }',
    '  .riga-app .testi { flex: 1; min-width: 0; }',
    '  .riga-app b, .riga-app span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .riga-app b { font-size: 15px; }',
    '  .riga-app span { font-size: 12px; color: var(--text-2); margin-top: 2px; }',
    '  .riga-app svg { width: 20px; height: 20px; flex: none; fill: none; stroke: var(--text-3); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }',
    '  .aggiungi-app { margin-top: 18px; padding: 14px; border-radius: 18px; background: var(--surface); border: 1px solid var(--line); }',
    '  .aggiungi-app > b { display: block; font-size: 15px; margin: 0 2px 4px; }',
    '  .aggiungi-app > p { margin: 0 2px 10px; font-size: 12px; color: var(--text-2); line-height: 1.4; }',
    '  .avviso-app { margin-top: 10px; padding: 12px; border-radius: 14px; background: rgba(255, 180, 92, .12); font-size: 13px; line-height: 1.45; color: var(--text); }',
    '  .avviso-app b { color: var(--warn); }',
    '  .avviso-app .schede-azioni { margin-top: 10px; }',
    '  .app-copertina { aspect-ratio: 5 / 3; border-radius: 18px; overflow: hidden; margin-bottom: 16px; background: var(--surface); box-shadow: 0 10px 26px rgba(0, 0, 0, .35); }',
    '  .app-copertina img { display: block; width: 100%; height: 100%; object-fit: cover; }',
    '  .app-testa { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }',
    '  .app-icona { width: 84px; height: 84px; border-radius: 21px; overflow: hidden; flex: none; display: flex; align-items: center; justify-content: center;',
    '    font-size: 38px; font-weight: 800; color: #fff; }',
    '  .app-icona img { width: 100%; height: 100%; object-fit: cover; }',
    '  .app-nomi { min-width: 0; }',
    '  .app-nomi small { display: block; font-size: 12px; color: var(--text-2); }',
    '  .app-nomi small.privata { display: inline-block; padding: 3px 10px; border-radius: 99px; background: rgba(255, 180, 92, .16); color: var(--warn); font-weight: 700; }',
    '  .app-nomi b { display: block; font-size: 25px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; margin-top: 3px; }',
    '  .app-nomi span { display: block; font-size: 13px; color: var(--text-2); margin-top: 4px; }',
    '  .app-azioni { display: flex; gap: 10px; margin-bottom: 18px; }',
    '  .app-azioni button { flex: 1; height: 52px; border-radius: 15px; font-size: 16px; font-weight: 800; background: var(--surface-3); color: var(--text); }',
    '  .app-azioni button.primo { flex: 1.6; background: var(--text); color: #0b0c10; }',
    '  .app-azioni button.conferma { background: var(--danger); color: #fff; }',
    '  .app-azioni .spento { flex: 1; height: 52px; display: flex; align-items: center; justify-content: center; border-radius: 15px;',
    '    border: 1px solid var(--line); color: var(--text-2); font-size: 14px; font-weight: 700; }',
    '  .app-descr { margin: 0 2px 14px; font-size: 15px; line-height: 1.55; color: var(--text); }',
    '  .app-novita { padding: 12px 14px; border-radius: 14px; background: var(--surface); font-size: 13px; line-height: 1.45; color: var(--text-2); }',
    '  .app-novita b { color: var(--text); }',
    '  .schede-azioni { display: flex; gap: 10px; }',
    '  .schede-azioni .secondario { flex: 1; }',
    '  .video-tv { padding: 10px 14px 14px; }',
    '  .video-tv.chiuso { padding-bottom: 12px; }',
    '  .video-testa { display: flex; align-items: center; gap: 10px; }',
    '  .video-apri { flex: 1; min-width: 0; min-height: 44px; display: flex; align-items: center; gap: 10px; text-align: left; }',
    '  .video-nomi { flex: 1; min-width: 0; }',
    '  .video-nomi small { display: block; font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }',
    '  .video-nomi b { display: block; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '  .video-giro { width: 24px; height: 24px; fill: var(--text-2); flex: none; transition: transform .2s ease; }',
    '  .video-tv.chiuso .video-giro { transform: rotate(180deg); }',
    '  .video-mini { display: none; width: 44px; height: 44px; border-radius: 50%; background: var(--text); flex: none;',
    '    align-items: center; justify-content: center; transition: transform .08s ease; }',
    '  .video-mini svg { width: 20px; height: 20px; fill: #0b0c10; }',
    '  .video-tv.chiuso .video-mini { display: flex; }',
    '  .video-linea { display: none; height: 3px; margin-top: 10px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }',
    '  .video-linea i, .video-binario i { display: block; height: 100%; width: 0; background: var(--grad); }',
    '  .video-tv.chiuso .video-linea { display: block; }',
    '  .video-tv.chiuso .video-corpo { display: none; }',
    '  .video-barra { position: relative; height: 44px; margin-top: 4px; touch-action: none; cursor: pointer; }',
    '  .video-binario { position: absolute; left: 0; right: 0; top: 19px; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }',
    '  .video-pallino { position: absolute; top: 12px; left: 0; width: 20px; height: 20px; margin-left: -10px; border-radius: 50%;',
    '    background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.45); transition: transform .12s ease; }',
    '  .video-bolla { position: absolute; bottom: 38px; left: 0; transform: translateX(-50%); padding: 4px 9px; border-radius: 9px;',
    '    background: var(--text); color: #0b0c10; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;',
    '    opacity: 0; transition: opacity .12s ease; pointer-events: none; }',
    '  .video-barra.tocco .video-pallino { transform: scale(1.3); }',
    '  .video-barra.tocco .video-bolla { opacity: 1; }',
    '  .video-barra.spenta { opacity: .4; pointer-events: none; }',
    '  .video-tempi { display: flex; justify-content: space-between; margin: -2px 2px 12px; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }',
    '  .video-tasti { display: grid; grid-template-columns: 1fr 1fr 1.3fr 1fr 1fr; gap: 8px; align-items: center; }',
    '  .video-tasti button { height: 48px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line); font-size: 14px; font-weight: 600;',
    '    transition: transform .08s ease; }',
    '  .video-tasti .video-play { height: 56px; border-radius: 20px; background: var(--text); border: 0; display: flex; align-items: center; justify-content: center; }',
    '  .video-play svg { width: 26px; height: 26px; fill: #0b0c10; }',
    '  .video-tasti button.press, .video-mini.press { transform: scale(.94); }',
    '  .video-tasti button:disabled { opacity: .35; }',
    '',
    '  /* Frecce / Trackpad */',
    '  .modi { position: relative; display: grid; grid-template-columns: 1fr 1fr; padding: 4px; margin-bottom: 14px;',
    '    background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }',
    '  .modi::before { content: \'\'; position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 12px;',
    '    background: var(--text); box-shadow: 0 4px 14px rgba(0,0,0,.35); transition: transform .28s cubic-bezier(.3,.7,.2,1); }',
    '  .modi.tp::before { transform: translateX(100%); }',
    '  .modo { position: relative; z-index: 1; height: 40px; display: flex; align-items: center; justify-content: center; gap: 8px;',
    '    color: var(--text-2); font-size: 15px; font-weight: 600; transition: color .2s ease; }',
    '  .modo svg { width: 18px; height: 18px; fill: currentColor; }',
    '  .modo.on { color: #0b0c10; }',
    '',
    '  /* la croce o il trackpad: stessa misura, niente salti passando dall\'uno all\'altro */',
    '  /* la pagina riempie lo schermo: la fila dei tasti sta in fondo, la croce o il trackpad prendono lo spazio in mezzo */',
    '  #vista-comandi { display: flex; flex-direction: column;',
    '    min-height: calc(100vh - 34px - env(safe-area-inset-top) - env(safe-area-inset-bottom));',
    '    min-height: calc(100svh - 34px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); }',
    '  .area { position: relative; flex: 1 0 auto; min-height: 300px; max-height: 540px; margin-bottom: 22px; }',
    '  .pad { position: absolute; left: 50%; top: 50%; width: min(80vw, 300px); height: min(80vw, 300px); margin: calc(min(80vw, 300px) / -2) 0 0 calc(min(80vw, 300px) / -2);',
    '    border-radius: 50%; background: radial-gradient(circle at 50% 28%, #23272f, #15171c 72%); border: 1px solid var(--line);',
    '    box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 20px 50px rgba(0,0,0,.4); }',
    '  .pad .freccia { position: absolute; display: flex; align-items: center; justify-content: center; color: var(--text-3); transition: color .1s ease; }',
    '  .pad .freccia::before { content: \'\'; position: absolute; width: 70px; height: 70px; border-radius: 50%; opacity: 0; transition: opacity .12s ease;',
    '    background: radial-gradient(circle, rgba(59,130,246,.3), rgba(59,130,246,0) 70%); }',
    '  .pad .freccia svg { position: relative; width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 2.6;',
    '    stroke-linecap: round; stroke-linejoin: round; }',
    '  .pad .su, .pad .giu { left: 30%; width: 40%; height: 31%; }',
    '  .pad .su { top: 0; } .pad .giu { bottom: 0; }',
    '  .pad .sx, .pad .dx { top: 30%; height: 40%; width: 31%; }',
    '  .pad .sx { left: 0; } .pad .dx { right: 0; }',
    '  .pad .freccia.press { color: var(--text); }',
    '  .pad .freccia.press::before { opacity: 1; }',
    '  .pad .ok { position: absolute; left: 31%; top: 31%; width: 38%; height: 38%; border-radius: 50%; background: #f4f5f7; color: #0b0c10;',
    '    font-size: 19px; font-weight: 700; letter-spacing: .05em; transition: transform .08s ease;',
    '    box-shadow: 0 12px 30px rgba(0,0,0,.5), 0 0 0 7px rgba(255,255,255,.035); }',
    '  .pad .ok.press { transform: scale(.94); }',
    '  #trackpad { position: absolute; left: 0; top: 0; right: 0; bottom: 0; }',
    '  .superficie { position: absolute; left: 0; top: 0; right: 0; bottom: 0; border-radius: 28px; overflow: hidden; touch-action: none;',
    '    border: 1px solid var(--line); background: radial-gradient(130% 100% at 50% 0%, #1d2129 0%, #13151a 72%);',
    '    box-shadow: inset 0 1px 0 rgba(255,255,255,.04); }',
    '  .superficie::before { content: \'\'; position: absolute; left: 0; top: 0; right: 0; bottom: 0; pointer-events: none;',
    '    background-image: radial-gradient(rgba(255,255,255,.07) 1px, transparent 1.4px); background-size: 22px 22px; }',
    '  .superficie-aiuto { position: absolute; left: 24px; right: 74px; top: 50%; transform: translateY(-50%); text-align: center;',
    '    color: var(--text-2); font-size: 13px; pointer-events: none; transition: opacity .4s ease; }',
    '  .superficie-aiuto b { display: block; margin-bottom: 6px; color: var(--text); font-size: 16px; font-weight: 600; }',
    '  .superficie.usata .superficie-aiuto { opacity: 0; }',
    '  .dito { position: absolute; left: 0; top: 0; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%;',
    '    pointer-events: none; opacity: 0; transition: opacity .18s ease;',
    '    background: radial-gradient(circle, rgba(59,130,246,.42) 0%, rgba(139,92,246,.18) 45%, rgba(139,92,246,0) 70%); }',
    '  .dito.on { opacity: 1; }',
    '  .dito.clic { animation: clic .35s ease-out; }',
    '  @keyframes clic { from { opacity: 1; transform: scale(.6); } to { opacity: 0; transform: scale(1.7); } }',
    '  .velocita { position: absolute; left: 10px; top: 10px; z-index: 1; height: 30px; padding: 0 12px; border-radius: 99px;',
    '    background: rgba(255,255,255,.06); border: 1px solid var(--line); color: var(--text-2); font-size: 12px; font-weight: 600; }',
    '  /* strisce per scorrere con un dito: a destra su e giu\', in basso destra e sinistra */',
    '  .striscia { position: absolute; z-index: 1; display: flex; align-items: center; justify-content: space-between; border-radius: 18px;',
    '    background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.07); transition: background-color .15s ease, border-color .15s ease; }',
    '  .striscia.verticale { top: 10px; right: 10px; bottom: 64px; width: 48px; flex-direction: column; padding: 10px 0; }',
    '  .striscia.orizzontale { left: 10px; right: 64px; bottom: 10px; height: 48px; padding: 0 10px; }',
    '  .striscia svg { width: 20px; height: 20px; fill: none; stroke: var(--text-3); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }',
    '  .striscia b { display: block; border-radius: 2px; background: var(--text-3); opacity: .55; }',
    '  .striscia.verticale b { width: 4px; height: 38px; }',
    '  .striscia.orizzontale b { width: 38px; height: 4px; }',
    '  .striscia.attiva { background: rgba(59,130,246,.16); border-color: rgba(59,130,246,.5); }',
    '  .striscia.attiva svg { stroke: var(--text); }',
    '  .striscia.attiva b { background: var(--text); }',
    '',
    '  /* una fila sola: Indietro, Home, Play/pausa, Altro */',
    '  .barra { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: auto; }',
    '  .barra button { display: flex; flex-direction: column; align-items: center; gap: 7px; font-size: 12px; color: var(--text-2); }',
    '  .tondo { width: 60px; height: 60px; border-radius: 50%; background: var(--surface); border: 1px solid var(--line);',
    '    display: flex; align-items: center; justify-content: center; transition: transform .08s ease, background-color .08s ease; }',
    '  .tondo svg { width: 24px; height: 24px; fill: var(--text); }',
    '  .barra button.press .tondo { transform: scale(.92); background: var(--surface-2); }',
    '',
    '  /* pannelli: Altro (dal basso), Scrivi (dall\'alto, cosi\' la tastiera non lo copre) */',
    '  .velo { position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 8; background: rgba(0,0,0,.55); opacity: 0;',
    '    pointer-events: none; transition: opacity .25s ease; }',
    '  .velo.aperto { opacity: 1; pointer-events: auto; }',
    '  /* mai piu\' alti dello schermo: quello che non ci sta si scorre dentro */',
    '  .foglio { position: fixed; left: 0; right: 0; z-index: 9; max-width: 460px; margin: 0 auto; background: #15171d;',
    '    border: 1px solid var(--line); transition: transform .3s cubic-bezier(.2,.8,.2,1);',
    '    max-height: calc(100vh - 36px); max-height: calc(100dvh - 36px); overflow-y: auto; -webkit-overflow-scrolling: touch;',
    '    overscroll-behavior: contain; }',
    '  .foglio.giu { bottom: 0; border-radius: 26px 26px 0 0; padding: 10px 18px calc(env(safe-area-inset-bottom) + 20px);',
    '    transform: translateY(105%); box-shadow: 0 -20px 60px rgba(0,0,0,.55); }',
    '  .foglio.su { top: 0; border-radius: 0 0 26px 26px; padding: calc(env(safe-area-inset-top) + 18px) 18px 18px;',
    '    transform: translateY(-105%); box-shadow: 0 20px 60px rgba(0,0,0,.55); }',
    '  .foglio.aperto { transform: none; }',
    '  .maniglia { width: 38px; height: 5px; border-radius: 3px; background: var(--surface-3); margin: 0 auto 14px; }',
    '  .foglio-titolo { font-size: 17px; font-weight: 700; margin: 0 2px 14px; }',
    '  .gruppo { margin-bottom: 18px; }',
    '  .gruppo:last-child { margin-bottom: 0; }',
    '  .etichetta { font-size: 11px; font-weight: 600; color: var(--text-3); letter-spacing: .08em; text-transform: uppercase; margin: 0 4px 8px; }',
    '  .foglio-testa { display: flex; align-items: center; justify-content: space-between; margin: 0 0 12px; }',
    '  .foglio-testa .foglio-titolo { margin: 0 2px; }',
    '  .chiudi { width: 40px; height: 40px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--line);',
    '    color: var(--text-2); font-size: 22px; line-height: 1; display: flex; align-items: center; justify-content: center; }',
    '  /* il permesso del TV per i tasti veri: finche\' manca, in cima al telecomando */',
    '  .permesso { margin: 0 0 14px; padding: 12px 14px; border-radius: 16px; background: rgba(59,130,246,.12);',
    '    border: 1px solid rgba(59,130,246,.35); }',
    '  .permesso p { margin: 0; font-size: 14px; line-height: 1.35; }',
    '  .permesso p.permesso-aiuto { margin-top: 8px; font-size: 12.5px; color: var(--text-2); }',
    '  /* come un telecomando: volume a sinistra, numeri al centro, canali a destra */',
    '  .telecomando { display: grid; grid-template-columns: 62px minmax(0, 1fr) 62px; gap: 10px; }',
    '  .telecomando .etichetta { text-align: center; margin: 0 0 8px; }',
    '  .rocca { display: flex; flex-direction: column; height: 200px; border-radius: 31px; overflow: hidden;',
    '    background: var(--surface-2); border: 1px solid var(--line); }',
    '  .rocca button { flex: 1; display: flex; align-items: center; justify-content: center; transition: background-color .08s ease; }',
    '  .rocca button + button { border-top: 1px solid var(--line); }',
    '  .rocca svg { width: 24px; height: 24px; fill: var(--text); }',
    '  .rocca b { font-size: 13px; font-weight: 700; }',
    '  .rocca .press { background: var(--surface-3); }',
    '  .funzioni { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }',
    '  .funzioni button { min-height: 60px; padding: 8px 4px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line);',
    '    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 12px;',
    '    font-weight: 600; line-height: 1.15; text-align: center; transition: transform .08s ease, background-color .08s ease; }',
    '  .funzioni svg { width: 20px; height: 20px; fill: var(--text); }',
    '  .funzioni .press { background: var(--surface-3); transform: scale(.97); }',
    '  .coppia { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
    '  .coppia.video { margin: 14px 0 16px; }',
    '  .coppia.video .pillola { height: 46px; }',
    '  .pillola { height: 52px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line); display: flex; align-items: center;',
    '    justify-content: center; gap: 9px; font-size: 15px; font-weight: 600; transition: transform .08s ease, background-color .08s ease; }',
    '  .pillola svg { width: 20px; height: 20px; fill: var(--text); }',
    '  .pillola.press { background: var(--surface-3); transform: scale(.97); }',
    '  .colori { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }',
    '  .colori button { height: 40px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line);',
    '    display: flex; align-items: center; justify-content: center; transition: background-color .08s ease; }',
    '  .colori i { display: block; width: 20px; height: 20px; border-radius: 50%; }',
    '  .colori .press { background: var(--surface-3); }',
    '  .tastierino { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }',
    '  .tastierino button { height: 44px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line);',
    '    font-size: 21px; font-weight: 600; transition: background-color .08s ease; }',
    '  .tastierino button.piccolo { padding: 0 2px; font-size: 11.5px; line-height: 1.1; }',
    '  .tastierino .press { background: var(--surface-3); }',
    '  .coppia + .coppia { margin-top: 10px; }',
    '  .secondario { display: block; width: 100%; height: 46px; margin-top: 10px; border-radius: 14px; font-weight: 600; font-size: 15px;',
    '    border: 1.5px solid transparent; background: linear-gradient(var(--surface-2), var(--surface-2)) padding-box, var(--grad) border-box; }',
    '  .secondario.press, .secondario:active { opacity: .8; }',
    '',
    '  .avviso { position: fixed; left: 16px; right: 16px; bottom: calc(env(safe-area-inset-bottom) + 16px); z-index: 10;',
    '    max-width: 420px; margin: 0 auto; padding: 13px 16px; border-radius: 16px; background: #2a2d35; color: var(--text);',
    '    font-size: 14px; box-shadow: 0 16px 40px rgba(0,0,0,.5); opacity: 0; transform: translateY(10px);',
    '    transition: opacity .2s ease, transform .2s ease; pointer-events: none; }',
    '  .avviso.on { opacity: 1; transform: none; }',
    '',
    '  .abbina { margin-top: 8vh; text-align: center; }',
    '  .abbina h2 { font-size: 26px; margin: 18px 0 10px; letter-spacing: -.02em; }',
    '  .abbina p { color: var(--text-2); margin: 0 auto 22px; max-width: 320px; }',
    '  .abbina img { width: 72px; height: 72px; border-radius: 18px; }',
    '  .pin { width: 100%; max-width: 260px; height: 64px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: .3em; margin: 0 auto 14px; display: block; flex: none; }',
    '  .abbina .invia { width: 100%; max-width: 260px; height: 52px; }',
    '  .errore { color: var(--warn); min-height: 20px; font-size: 14px; margin-top: 12px; }',
    '',
    '  .consiglio { display: none; margin-top: 22px; padding: 12px 14px; border-radius: 16px; background: var(--surface);',
    '    border: 1px solid var(--line); font-size: 13px; color: var(--text-2); }',
    '  .consiglio.on { display: flex; gap: 12px; align-items: center; }',
    '  .consiglio p { margin: 0; flex: 1; }',
    '  .consiglio b { color: var(--text); }',
    '  .consiglio button { flex: none; padding: 7px 12px; border-radius: 10px; background: var(--surface-2); color: var(--text); font-size: 13px; font-weight: 600; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="app">',
    '',
    '  <section id="vista-abbina" class="abbina" hidden>',
    '    <img src="/icona.png" alt="">',
    '    <h2>Collega il telefono al TV</h2>',
    '    <p>Sul TV apri la home, premi il tasto Blu e scegli <b>Collega un telefono</b>. Poi scrivi qui il codice che compare.</p>',
    '    <input id="pin" class="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000">',
    '    <button id="collega" class="invia">Collega</button>',
    '    <div id="errore" class="errore"></div>',
    '  </section>',
    '',
    '  <section id="vista-comandi" hidden>',
    '    <header class="testa">',
    '      <div class="dove">',
    '        <span class="dove-nota"><i id="dot" class="dot"></i><span id="stato-nota">Sul TV</span></span>',
    '        <strong id="stato">Collegamento&hellip;</strong>',
    '      </div>',
    '      <button id="apri-store" class="icona" aria-label="Store di Home TV"><svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8h3.7l.9 13H3.9l.9-13zm1.8 0h3.4V6.5a1.7 1.7 0 0 0-3.4 0z"/></svg></button>',
    '      <button id="apri-schede" class="icona" aria-label="Schede del browser"><svg viewBox="0 0 24 24"><path d="M8 3h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1v-2h1V5H8v1H6V5a2 2 0 0 1 2-2zM4 8h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zm0 2v9h11v-9z"/></svg></button>',
    '      <button id="apri-video" class="icona" aria-label="Riproduci un video sul TV"><svg viewBox="0 0 24 24"><path d="M3 4h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6v2h3v2H6v-2h3v-2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v10h18V6zm7 1.8 5.5 3.2-5.5 3.2z"/></svg></button>',
    '      <button id="apri-scrivi" class="icona" aria-label="Scrivi sul TV o manda un link"><svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm1.5 3v2h2V8zm3.5 0v2h2V8zm3.5 0v2h2V8zm3.5 0v2h2V8zM5.5 11.5v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h2v-2zM8 15v1.6h8V15z"/></svg></button>',
    '      <button class="icona spegni" data-tasto="spegni" aria-label="Spegni il TV (tieni premuto)"><svg viewBox="0 0 24 24"><path d="M11 3h2v9h-2zM7.1 5.6l1.4 1.4A6 6 0 1 0 15.5 7l1.4-1.4A8 8 0 1 1 7.1 5.6z"/></svg></button>',
    '    </header>',
    '',
    '    <div id="scrivi-tv" class="scheda scrivi-tv" hidden>',
    '      <div class="scrivi-tv-testa"><b>Sul TV si scrive qui</b><span id="scrivi-tv-dove"></span></div>',
    '      <div class="campo">',
    '        <input id="testo-tv" type="text" enterkeyhint="go" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Tocca qui e scrivi">',
    '        <button id="invia-tv" class="invia">Invio</button>',
    '      </div>',
    '      <p class="nota">Compare sul TV mentre scrivi &middot; Invio conferma</p>',
    '    </div>',
    '',
    '    <div id="video-tv" class="scheda video-tv" hidden>',
    '      <div class="video-testa">',
    '        <button id="video-apri" class="video-apri" aria-expanded="true" aria-controls="video-corpo">',
    '          <span class="video-nomi"><small id="video-sopra">Video sul TV</small><b id="video-titolo">Video</b></span>',
    '          <svg class="video-giro" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14.5l5-5 5 5z"/></svg>',
    '        </button>',
    '        <button id="video-mini" class="video-mini" aria-label="Play o pausa"></button>',
    '      </div>',
    '      <div class="video-linea"><i id="video-linea"></i></div>',
    '      <div id="video-corpo" class="video-corpo">',
    '        <div id="video-barra" class="video-barra" role="slider" aria-label="A che punto del video" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">',
    '          <div class="video-binario"><i id="video-pieno"></i></div>',
    '          <span id="video-pallino" class="video-pallino"></span>',
    '          <span id="video-bolla" class="video-bolla"></span>',
    '        </div>',
    '        <div class="video-tempi"><span id="video-ora">0:00</span><span id="video-resta"></span></div>',
    '        <div class="video-tasti">',
    '          <button data-salto="-30" aria-label="Indietro di 30 secondi">&minus;30 s</button>',
    '          <button data-salto="-10" aria-label="Indietro di 10 secondi">&minus;10 s</button>',
    '          <button id="video-pausa" class="video-play" aria-label="Play o pausa"></button>',
    '          <button data-salto="10" aria-label="Avanti di 10 secondi">+10 s</button>',
    '          <button data-salto="30" aria-label="Avanti di 30 secondi">+30 s</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <div id="modi" class="modi">',
    '      <button id="modo-frecce" class="modo on" aria-pressed="true"><svg viewBox="0 0 24 24"><path d="M12 2l3.5 4h-7zM12 22l-3.5-4h7zM2 12l4-3.5v7zM22 12l-4 3.5v-7z"/><circle cx="12" cy="12" r="2.6"/></svg>Frecce</button>',
    '      <button id="modo-trackpad" class="modo" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M5 2.5v16.2l4.3-3.9 3 6.8 3.1-1.4-3-6.6h5.7z"/></svg>Trackpad</button>',
    '    </div>',
    '',
    '    <div class="area">',
    '      <div id="pad" class="pad">',
    '        <button class="freccia su" data-tasto="su" aria-label="Su"><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>',
    '        <button class="freccia giu" data-tasto="giu" aria-label="Gi&ugrave;"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>',
    '        <button class="freccia sx" data-tasto="sx" aria-label="Sinistra"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>',
    '        <button class="freccia dx" data-tasto="dx" aria-label="Destra"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>',
    '        <button class="ok" data-tasto="ok">OK</button>',
    '      </div>',
    '      <div id="trackpad" hidden>',
    '        <div id="superficie" class="superficie" aria-label="Trackpad: muovi il dito per spostare il puntatore sul TV">',
    '          <div class="superficie-aiuto"><b>Muovi il dito per spostare il puntatore</b>Tocca per cliccare &middot; strisce per scorrere</div>',
    '          <i id="dito" class="dito"></i>',
    '          <div id="scorri-v" class="striscia verticale" aria-label="Scorri su e gi&ugrave;"><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg><b></b><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div>',
    '          <div id="scorri-o" class="striscia orizzontale" aria-label="Scorri a sinistra e a destra"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg><b></b><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></div>',
    '          <button id="velocita" class="velocita">Velocit&agrave; normale</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <nav class="barra">',
    '      <button data-tasto="indietro" aria-label="Indietro"><span class="tondo"><svg viewBox="0 0 24 24"><path d="M10 6L4 12l6 6v-4h5a4 4 0 0 0 0-8h-1v2h1a2 2 0 0 1 0 4h-5V6z"/></svg></span>Indietro</button>',
    '      <button data-tipo="home" aria-label="La tua home"><span class="tondo"><svg viewBox="0 0 24 24"><path d="M12 4l9 8h-3v8h-4v-5h-4v5H6v-8H3z"/></svg></span>Home</button>',
    '      <button data-tasto="playpausa" aria-label="Play o pausa"><span class="tondo"><svg viewBox="0 0 24 24"><path d="M3.5 5.5l9 6.5-9 6.5zM15 5.5h2.6v13H15zm4.4 0H22v13h-2.6z"/></svg></span>Play/pausa</button>',
    '      <button id="apri-altro" aria-label="Altri tasti"><span class="tondo"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="19" cy="12" r="2.1"/></svg></span>Altro</button>',
    '    </nav>',
    '',
    '    <div id="consiglio" class="consiglio">',
    '      <p>Per averlo sempre a portata di mano: tocca <b>Condividi</b> in Safari e poi <b>Aggiungi alla schermata Home</b>.</p>',
    '      <button id="chiudi-consiglio">Ok</button>',
    '    </div>',
    '  </section>',
    '',
    '  <section id="vista-store" class="vista-store" hidden>',
    '    <header class="store-testa">',
    '      <button id="store-indietro" class="icona" aria-label="Torna al telecomando"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>',
    '      <div class="store-titoli"><strong>Store</strong><span id="store-sotto">Le app per il tuo TV</span></div>',
    '    </header>',
    '    <div class="cerca-box">',
    '      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.24 4.24-1.41 1.41-4.24-4.24A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>',
    '      <input id="cerca-store" class="cerca-store" type="search" placeholder="Cerca app, giochi, strumenti" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">',
    '    </div>',
    '    <p id="store-nota" class="nota store-nota via"></p>',
    '    <div id="store-corpo" class="store-corpo"></div>',
    '    <div class="aggiungi-app">',
    '      <b>Aggiungi un&rsquo;app privata</b>',
    '      <p>Un indirizzo qualsiasi o <b>utente/repository</b> di GitHub: resta solo su questo TV.</p>',
    '      <div class="campo">',
    '        <input id="indirizzo-app" type="url" enterkeyhint="go" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="utente/repository o un indirizzo">',
    '        <button id="aggiungi-app" class="invia">Aggiungi</button>',
    '      </div>',
    '      <div id="avviso-app" class="avviso-app" hidden>',
    '        <p><b>Codice non verificato.</b> Questa fonte non &egrave; controllata da Home TV. Le sue app girano chiuse nel loro riquadro e non vedono la home n&eacute; i tuoi dati, ma possono mostrarti qualsiasi cosa e usare internet. Aggiungila solo se ti fidi di chi l&rsquo;ha fatta.</p>',
    '        <div class="schede-azioni"><button id="conferma-app" class="secondario">Aggiungi lo stesso</button><button id="annulla-app" class="secondario">Annulla</button></div>',
    '      </div>',
    '    </div>',
    '  </section>',
    '',
    '  <section id="vista-app" class="vista-app" hidden>',
    '    <header class="store-testa">',
    '      <button id="app-indietro" class="icona" aria-label="Torna allo Store"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>',
    '      <div class="store-titoli"><strong>Store</strong><span>Si installa sul TV</span></div>',
    '    </header>',
    '    <div id="app-copertina" class="app-copertina" hidden></div>',
    '    <div class="app-testa"><div id="app-icona" class="app-icona"></div><div class="app-nomi"><small id="app-sopra"></small><b id="app-nome"></b><span id="app-info"></span></div></div>',
    '    <div id="app-azioni" class="app-azioni"></div>',
    '    <p id="app-descr" class="app-descr"></p>',
    '    <div id="app-novita" class="app-novita" hidden></div>',
    '  </section>',
    '',
    '</div>',
    '',
    '<div id="velo" class="velo" hidden></div>',
    '',
    '<div id="foglio-altro" class="foglio giu" hidden role="dialog" aria-label="Telecomando del TV">',
    '  <div class="maniglia"></div>',
    '  <div class="foglio-testa"><div class="foglio-titolo">Telecomando del TV</div><button class="chiudi chiude" aria-label="Chiudi">&times;</button></div>',
    '  <div id="permesso" class="permesso" hidden>',
    '    <p id="permesso-testo">Volume, canali, numeri e i tasti del televisore funzionano dopo il permesso del TV (una volta sola).</p>',
    '    <button id="chiedi-permesso" class="secondario">Chiedi il permesso al TV</button>',
    '    <p id="permesso-aiuto" class="permesso-aiuto" hidden>Se il TV non chiede niente: sul TV Impostazioni &rarr; Tutte le impostazioni &rarr; Connessione &rarr; Gestione dispositivi esterni &rarr; Gestione connessione dispositivi &rarr; Elenco dispositivi, e su <b>Home TV</b> scegli Consenti.</p>',
    '  </div>',
    '  <div class="telecomando">',
    '    <div>',
    '      <div class="etichetta">Volume</div>',
    '      <div class="rocca">',
    '        <button data-tasto="volSu" aria-label="Volume su"><svg viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3zm14-1h2v3h3v2h-3v3h-2v-3h-3v-2h3z"/></svg></button>',
    '        <button data-tasto="muto" aria-label="Muto"><svg viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3zm12.6.2L17 10.6l1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4-1.4-1.4z"/></svg></button>',
    '        <button data-tasto="volGiu" aria-label="Volume gi&ugrave;"><svg viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3zm12.5 2h6v2h-6z"/></svg></button>',
    '      </div>',
    '    </div>',
    '    <div>',
    '      <div class="etichetta">Numeri</div>',
    '      <div class="tastierino">',
    '        <button data-tasto="n1">1</button><button data-tasto="n2">2</button><button data-tasto="n3">3</button>',
    '        <button data-tasto="n4">4</button><button data-tasto="n5">5</button><button data-tasto="n6">6</button>',
    '        <button data-tasto="n7">7</button><button data-tasto="n8">8</button><button data-tasto="n9">9</button>',
    '        <button class="piccolo chiude" data-tasto="listaCanali">Lista canali</button><button data-tasto="n0">0</button>',
    '        <button class="piccolo chiude" data-tasto="guida">Guida</button>',
    '      </div>',
    '    </div>',
    '    <div>',
    '      <div class="etichetta">Canali</div>',
    '      <div class="rocca">',
    '        <button data-tasto="canaleSu" aria-label="Canale su"><svg viewBox="0 0 24 24"><path d="M6.4 15.6L12 10l5.6 5.6 1.4-1.4-7-7-7 7z"/></svg></button>',
    '        <button data-tasto="canalePrima" aria-label="Canale di prima"><b>Prima</b></button>',
    '        <button data-tasto="canaleGiu" aria-label="Canale gi&ugrave;"><svg viewBox="0 0 24 24"><path d="M6.4 8.4L12 14l5.6-5.6 1.4 1.4-7 7-7-7z"/></svg></button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="coppia video">',
    '    <button class="pillola" data-tasto="indietroVeloce"><svg viewBox="0 0 24 24"><path d="M11 6v12l-8-6zm9 0v12l-8-6z"/></svg>&minus;30 s</button>',
    '    <button class="pillola" data-tasto="avanti">+30 s<svg viewBox="0 0 24 24"><path d="M13 6v12l8-6zM4 6v12l8-6z"/></svg></button>',
    '  </div>',
    '  <div class="etichetta">Televisore</div>',
    '  <div class="funzioni">',
    '    <button class="chiude" data-tasto="blu"><svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>Menu</button>',
    '    <button class="chiude" data-tasto="homeTv" aria-label="Home del TV (Samsung)"><svg viewBox="0 0 24 24"><path d="M3 5h18v11H3zm2 2v7h14V7zm4 11h6v2H9z"/></svg>Home del TV</button>',
    '    <button class="chiude" data-tasto="sorgente" aria-label="Sorgente (HDMI, antenna)"><svg viewBox="0 0 24 24"><path d="M4 7h16v10H4zm2 2v6h12V9zM9 3l3 3 3-3z"/></svg>Sorgente</button>',
    '    <button class="chiude" data-tasto="menuTv" aria-label="Impostazioni del TV"><svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10.6 2h2.8l.5 2.6 1.8.8 2.2-1.5 2 2-1.5 2.2.8 1.8 2.6.5v2.8l-2.6.5-.8 1.8 1.5 2.2-2 2-2.2-1.5-1.8.8-.5 2.6h-2.8l-.5-2.6-1.8-.8-2.2 1.5-2-2 1.5-2.2-.8-1.8L2 13.4v-2.8l2.6-.5.8-1.8-1.5-2.2 2-2 2.2 1.5 1.8-.8z"/></svg>Impostazioni TV</button>',
    '    <button class="chiude" data-tasto="info" aria-label="Info"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8v7h2v-7zm0-4v2h2V6z"/></svg>Info</button>',
    '    <button class="chiude" data-tasto="esci" aria-label="Esci"><svg viewBox="0 0 24 24"><path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>Esci</button>',
    '  </div>',
    '  <div class="gruppo">',
    '    <div class="etichetta">Tasti colorati</div>',
    '    <div class="colori">',
    '      <button class="chiude" data-tasto="rosso" aria-label="Rosso"><i style="background:#e5484d"></i></button>',
    '      <button class="chiude" data-tasto="verde" aria-label="Verde"><i style="background:#30a46c"></i></button>',
    '      <button class="chiude" data-tasto="giallo" aria-label="Giallo"><i style="background:#f5d90a"></i></button>',
    '      <button class="chiude" data-tasto="blu" aria-label="Blu"><i style="background:#3e63dd"></i></button>',
    '    </div>',
    '  </div>',
    '</div>',
    '',
    '<div id="foglio-scrivi" class="foglio su" hidden role="dialog" aria-label="Scrivi sul TV o manda un link">',
    '  <div class="foglio-titolo">Scrivi sul TV o manda un link</div>',
    '  <div class="campo">',
    '    <input id="testo" type="text" enterkeyhint="send" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Scrivi o incolla un link">',
    '    <button id="invia" class="invia" disabled>Invia</button>',
    '  </div>',
    '  <button id="riproduci-testo" class="secondario" hidden>Riproduci il video sul TV</button>',
    '  <button id="usa-sito" class="secondario" hidden>Usa come link del mio sito</button>',
    '  <p id="nota" class="nota">Il testo va nel campo scelto sul TV (o diventa una ricerca). Un link si apre sul TV, dentro Home TV.</p>',
    '</div>',
    '',
    '<div id="foglio-schede" class="foglio su" hidden role="dialog" aria-label="Schede del browser">',
    '  <div class="foglio-titolo">Schede del browser</div>',
    '  <div id="lista-schede" class="lista-schede"></div>',
    '  <div class="schede-azioni">',
    '    <button id="schede-tv" class="secondario">Mostra sul TV</button>',
    '    <button id="nuova-scheda" class="secondario">Nuova scheda</button>',
    '  </div>',
    '</div>',
    '',
    '<div id="foglio-video" class="foglio su" hidden role="dialog" aria-label="Riproduci un video sul TV">',
    '  <div class="foglio-titolo">Riproduci un video sul TV</div>',
    '  <div class="campo">',
    '    <input id="link-video" type="url" enterkeyhint="go" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Incolla il link della pagina del video">',
    '    <button id="riproduci" class="invia" disabled>Riproduci</button>',
    '  </div>',
    '  <button id="incolla-video" class="secondario" hidden>Incolla il link copiato</button>',
    '  <p class="nota">Il TV apre la pagina e fa partire da solo il video principale, a schermo intero e con l&rsquo;audio (non le pubblicit&agrave; o le anteprime piccole). Non &egrave; lo schermo del telefono: il video lo prende il TV, e il telefono resta il telecomando.</p>',
    '</div>',
    '',
    '<div id="avviso" class="avviso"></div>',
    '',
    '<script>',
    '(function () {',
    '  \'use strict\';',
    '  // anteprima: la pagina vera arriva solo dal TV, in http sulla rete di casa',
    '  var DEMO = /[?&]demo\\b/.test(location.search) || location.protocol !== \'http:\';',
    '  function $(id) { return document.getElementById(id); }',
    '  function parametro(n) { var m = new RegExp(\'[?&]\' + n + \'=([^&]+)\').exec(location.search); return m ? decodeURIComponent(m[1]) : \'\'; }',
    '  function leggi(k) { try { return localStorage.getItem(k) || \'\'; } catch (e) { return \'\'; } }',
    '  function scrivi(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }',
    '',
    '  // il codice salvato e\' il piu\' recente (l\'icona sulla schermata Home puo\' averne uno vecchio, scollegato);',
    '  // quello del link vale la prima volta, o se quello salvato non va piu\'',
    '  var tokenLink = parametro(\'t\');',
    '  var token = leggi(\'hometv-token\') || tokenLink;',
    '  if (token && !leggi(\'hometv-token\')) scrivi(\'hometv-token\', token);',
    '',
    '  var avvisoTimer = null;',
    '  function avviso(testo, ms) {',
    '    var el = $(\'avviso\');',
    '    el.textContent = testo;',
    '    el.className = \'avviso on\';',
    '    clearTimeout(avvisoTimer);',
    '    avvisoTimer = setTimeout(function () { el.className = \'avviso\'; }, ms || 2600);',
    '  }',
    '',
    '  function api(percorso, corpo, segnale) {',
    '    // anteprima: "?demo&tasti=mai" fa vedere il telecomando senza il permesso del TV',
    '    if (DEMO) return Promise.resolve({ ok: true, ascolta: true, dove: \'Anteprima\', t: \'demo\',',
    '      tasti: (/[?&]tasti=([a-z]+)/.exec(location.search) || [])[1] || \'ok\' });',
    '    var opz = { cache: \'no-store\' };',
    '    if (segnale) opz.signal = segnale;',
    '    if (corpo) { opz.method = \'POST\'; opz.headers = { \'Content-Type\': \'text/plain\' }; opz.body = JSON.stringify(corpo); }',
    '    return fetch(percorso, opz).then(function (r) {',
    '      return r.json().then(function (j) { j.__stato = r.status; return j; }, function () { return { __stato: r.status }; });',
    '    });',
    '  }',
    '',
    '  /* ---------------------------------------------------- abbinamento */',
    '',
    '  function mostra(vista) {',
    '    $(\'vista-abbina\').hidden = vista !== \'abbina\';',
    '    $(\'vista-comandi\').hidden = vista !== \'comandi\';',
    '    $(\'vista-store\').hidden = vista !== \'store\';',
    '    $(\'vista-app\').hidden = vista !== \'app\';',
    '  }',
    '',
    '  function abbina(pin) {',
    '    $(\'errore\').textContent = \'\';',
    '    if (!/^\\d{6}$/.test(pin)) { $(\'errore\').textContent = \'Il codice ha 6 cifre.\'; return; }',
    '    $(\'collega\').disabled = true;',
    '    api(\'/abbina\', { pin: pin, nome: (navigator.platform || \'Telefono\') }).then(function (j) {',
    '      $(\'collega\').disabled = false;',
    '      if (j && j.t) {',
    '        token = j.t;',
    '        scrivi(\'hometv-token\', token);',
    '        // il link con il codice di accesso dentro: e\' quello che finisce sulla schermata Home',
    '        try { history.replaceState(null, \'\', \'/?t=\' + encodeURIComponent(token)); } catch (e) {}',
    '        avvio();',
    '        avviso(\'Collegato! Ora puoi comandare il TV.\');',
    '        return;',
    '      }',
    '      $(\'errore\').textContent = j && j.error === \'scaduto\' ? \'Codice scaduto: sul TV apri di nuovo "Collega un telefono".\' :',
    '        j && j.error === \'nessun-codice\' ? \'Sul TV non c\\u2019\\u00e8 un codice attivo: apri "Collega un telefono".\' :',
    '        \'Codice sbagliato, riprova.\';',
    '    }, function () {',
    '      $(\'collega\').disabled = false;',
    '      $(\'errore\').textContent = \'Non trovo il TV. Il telefono \\u00e8 sulla stessa Wi-Fi del TV?\';',
    '    });',
    '  }',
    '  $(\'collega\').addEventListener(\'click\', function () { abbina($(\'pin\').value.replace(/\\D/g, \'\')); });',
    '  $(\'pin\').addEventListener(\'input\', function () {',
    '    var v = this.value.replace(/\\D/g, \'\').slice(0, 6);',
    '    if (v !== this.value) this.value = v;',
    '    if (v.length === 6) abbina(v);',
    '  });',
    '',
    '  /* ---------------------------------------------------- comandi */',
    '',
    '  var ultimoAvvisoApp = 0;',
    '  var SENZA_PERMESSO = \'Per i tasti del TV serve il suo permesso: in Altro tocca Chiedi di nuovo, poi sul TV scegli Consenti.\';',
    '  function invia(corpo) {',
    '    corpo.t = token;',
    '    return api(\'/comando\', corpo).then(function (j) {',
    '      if (j.__stato === 401) { perso(); return j; }',
    '      if (j.error === \'non-disponibile\') {',
    '        avviso(SENZA_PERMESSO, 5000);',
    '        mostraPermesso(j.tasti);',
    '        if (foglioAperto && foglioAperto.id === \'foglio-altro\') foglioAperto.scrollTop = 0;',
    '        return j;',
    '      }',
    '      if (j.__stato && j.__stato >= 400) { avviso(\'Il TV non ha accettato il comando\'); return j; }',
    '      aggiornaStato(j);',
    '      if (corpo.tipo === \'link\' && j.ascolta === false) avviso(\'Apro la home sul TV e poi il link\\u2026\', 3000);',
    '      else if (corpo.tipo === \'riproduci\') { /* lo dice riproduciSulTv */ }',
    '      else if (j.ascolta === false && j.tasti !== \'ok\' && corpo.tipo !== \'home\' && Date.now() - ultimoAvvisoApp > 6000) {',
    '        ultimoAvvisoApp = Date.now();',
    '        avviso(j.tasti === \'attesa\' ? \'Sul TV scegli Consenti: cos\\u00ec il telefono funziona ovunque.\' :',
    '          \'Sul TV \\u00e8 aperta un\\u2019altra app: premi Home qui sotto per tornare alla tua home.\', 4500);',
    '      }',
    '      return j;',
    '    }, function () {',
    '      aggiornaStato(null);',
    '      avviso(\'TV non raggiungibile: \\u00e8 acceso e sulla stessa Wi-Fi?\');',
    '    });',
    '  }',
    '',
    '  function perso() {',
    '    if (tokenLink && token !== tokenLink) { token = tokenLink; scrivi(\'hometv-token\', token); avvio(); return; }',
    '    tokenLink = \'\';',
    '    codaP = [];',
    '    restoX = restoY = 0;',
    '    fermaInerzia();',
    '    token = \'\';',
    '    scrivi(\'hometv-token\', \'\');',
    '    try { history.replaceState(null, \'\', \'/\'); } catch (e) {}',
    '    mostra(\'abbina\');',
    '    $(\'errore\').textContent = \'Il TV non riconosce pi\\u00f9 questo telefono: collegalo di nuovo.\';',
    '  }',
    '',
    '  function aggiornaStato(j) {',
    '    var dot = $(\'dot\'), s = $(\'stato\'), n = $(\'stato-nota\');',
    '    if (!j) { dot.className = \'dot no\'; n.textContent = \'Non collegato\'; s.textContent = \'TV non raggiungibile\'; return; }',
    '    dot.className = \'dot \' + (j.ascolta || j.tasti === \'ok\' ? \'ok\' : \'no\');',
    '    n.textContent = \'Sul TV\';',
    '    s.textContent = j.ascolta ? (j.dove || \'Home\') : \'Un\\u2019altra app\';',
    '    if (j.tasti) mostraPermesso(j.tasti);',
    '  }',
    '  // i tasti veri del TV (volume, canali, numeri...) vogliono il permesso del TV: finche\' manca, il telecomando dice come darlo',
    '  function mostraPermesso(t) {',
    '    var box = $(\'permesso\'), p = $(\'permesso-testo\'), b = $(\'chiedi-permesso\');',
    '    if (!box || !t) return;',
    '    box.hidden = t === \'ok\';',
    '    b.hidden = t === \'attesa\';',
    '    $(\'permesso-aiuto\').hidden = t !== \'negato\';',
    '    p.textContent = t === \'attesa\' ? \'Sul TV \\u00e8 comparsa la richiesta di Home TV: scegli Consenti col telecomando del TV.\' :',
    '      t === \'negato\' ? \'Il TV ha negato il permesso ai tasti dal telefono.\' :',
    '      t === \'assente\' ? \'Il TV non risponde ai tasti dal telefono.\' :',
    '      \'Volume, canali, numeri e i tasti del televisore funzionano dopo il permesso del TV (una volta sola).\';',
    '    b.textContent = t === \'mai\' ? \'Chiedi il permesso al TV\' : \'Chiedi di nuovo\';',
    '  }',
    '  $(\'chiedi-permesso\').addEventListener(\'click\', function () {',
    '    invia({ tipo: \'permesso\' }).then(function (j) {',
    '      if (!j || j.error || j.__stato >= 400) return;',
    '      mostraPermesso(\'attesa\');',
    '      avviso(\'Sul TV scegli Consenti col telecomando del TV\', 5000);',
    '    });',
    '  });',
    '',
    '  // pressione con ripetizione (frecce tenute premute)',
    '  function premibile(el) {',
    '    var ripeti = null, attesa = null;',
    '    var tasto = el.getAttribute(\'data-tasto\'), tipo = el.getAttribute(\'data-tipo\');',
    '    var freccia = /^(su|giu|sx|dx)$/.test(tasto || \'\');',
    '    function manda() { if (tipo) invia({ tipo: tipo }); else invia({ tipo: \'tasto\', tasto: tasto }); }',
    '    var ripetibile = freccia || tasto === \'volSu\' || tasto === \'volGiu\' || tasto === \'canaleSu\' || tasto === \'canaleGiu\';',
    '    var lungo = tasto === \'spegni\', spento = false; // spegnere: solo tenendo premuto (niente tocchi per sbaglio)',
    '    // OK: un tocco e\' OK; tenuto premuto apre il menu della cosa scelta, come sul telecomando (o il tasto destro)',
    '    var conMenu = tasto === \'ok\', tenuto = false;',
    '    function giu(ev) {',
    '      ev.preventDefault();',
    '      el.classList.add(\'press\');',
    '      if (lungo) {',
    '        spento = false;',
    '        attesa = setTimeout(function () { spento = true; manda(); avviso(\'Spengo il TV\', 1500); }, 700);',
    '        return;',
    '      }',
    '      if (conMenu) {',
    '        tenuto = false;',
    '        attesa = setTimeout(function () {',
    '          attesa = null;',
    '          tenuto = true;',
    '          invia({ tipo: \'tasto\', tasto: \'tieni\' });',
    '          if (navigator.vibrate) { try { navigator.vibrate(15); } catch (x) {} }',
    '        }, 550);',
    '        return;',
    '      }',
    '      manda();',
    '      if (ripetibile) {',
    '        attesa = setTimeout(function () { ripeti = setInterval(manda, 160); }, 420);',
    '      }',
    '    }',
    '    function su(ev) {',
    '      if (lungo && attesa && !spento && el.classList.contains(\'press\')) avviso(\'Tieni premuto per spegnere il TV\', 1800);',
    '      // OK lasciato prima del menu: e\' un OK (non se il dito e\' scivolato via dal tasto)',
    '      if (conMenu && attesa && !tenuto && el.classList.contains(\'press\') && !(ev && /cancel|leave/.test(ev.type))) manda();',
    '      el.classList.remove(\'press\');',
    '      clearTimeout(attesa); clearInterval(ripeti); attesa = ripeti = null;',
    '    }',
    '    if (window.PointerEvent) {',
    '      el.addEventListener(\'pointerdown\', giu);',
    '      el.addEventListener(\'pointerup\', su);',
    '      el.addEventListener(\'pointercancel\', su);',
    '      el.addEventListener(\'pointerleave\', su);',
    '    } else {',
    '      el.addEventListener(\'touchstart\', giu, { passive: false });',
    '      el.addEventListener(\'touchend\', su);',
    '      el.addEventListener(\'touchcancel\', su);',
    '      el.addEventListener(\'mousedown\', giu);',
    '      el.addEventListener(\'mouseup\', su);',
    '    }',
    '    el.addEventListener(\'contextmenu\', function (ev) { ev.preventDefault(); });',
    '  }',
    '  var bottoni = document.querySelectorAll(\'[data-tasto], [data-tipo]\');',
    '  for (var i = 0; i < bottoni.length; i++) premibile(bottoni[i]);',
    '',
    '  /* ---------------------------------------------------- scrivere e link */',
    '',
    '  function sembraLink(v) {',
    '    return /^https?:\\/\\/\\S+$/i.test(v) || /^(www\\.)?[a-z0-9\\-]+(\\.[a-z0-9\\-]+)*\\.[a-z]{2,}(\\/\\S*)?$/i.test(v);',
    '  }',
    '  function aggiornaCampo() {',
    '    var v = $(\'testo\').value.replace(/^\\s+|\\s+$/g, \'\');',
    '    var link = !!v && sembraLink(v);',
    '    $(\'invia\').disabled = !v;',
    '    $(\'invia\').textContent = link ? \'Apri\' : \'Invia\';',
    '    $(\'usa-sito\').hidden = !link;',
    '    $(\'riproduci-testo\').hidden = !link;',
    '  }',
    '  function conHttps(v) { return /^https?:\\/\\//i.test(v) ? v : \'https://\' + v; }',
    '  // "Riproduci sul TV": il TV apre la pagina e fa partire il suo video principale',
    '  function riproduciSulTv(v, dopo) {',
    '    v = String(v || \'\').replace(/^\\s+|\\s+$/g, \'\');',
    '    if (!v || !sembraLink(v)) { avviso(\'Questo non sembra il link di una pagina\'); return; }',
    '    invia({ tipo: \'riproduci\', url: conHttps(v) }).then(function (j) {',
    '      if (!j || !j.ok) return;',
    '      if (dopo) dopo();',
    '      chiudiFogli();',
    '      avviso(j.ascolta === false ? \'Apro la home sul TV e poi il video\\u2026\' : \'Il video parte sul TV\\u2026\', 3000);',
    '    });',
    '  }',
    '  function aggiornaVideo() {',
    '    var v = $(\'link-video\').value.replace(/^\\s+|\\s+$/g, \'\');',
    '    $(\'riproduci\').disabled = !v || !sembraLink(v);',
    '  }',
    '  $(\'link-video\').addEventListener(\'input\', aggiornaVideo);',
    '  $(\'link-video\').addEventListener(\'keydown\', function (ev) {',
    '    if (ev.keyCode === 13) { ev.preventDefault(); $(\'link-video\').blur(); riproduciSulTv($(\'link-video\').value, function () { $(\'link-video\').value = \'\'; aggiornaVideo(); }); }',
    '  });',
    '  $(\'riproduci\').addEventListener(\'click\', function () {',
    '    riproduciSulTv($(\'link-video\').value, function () { $(\'link-video\').value = \'\'; aggiornaVideo(); });',
    '  });',
    '  $(\'riproduci-testo\').addEventListener(\'click\', function () {',
    '    riproduciSulTv($(\'testo\').value, function () { $(\'testo\').value = \'\'; aggiornaCampo(); });',
    '  });',
    '  // "Incolla": solo dove il telefono lo permette (pagine sicure); altrimenti si incolla tenendo premuto nel campo',
    '  if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {',
    '    $(\'incolla-video\').hidden = false;',
    '    $(\'incolla-video\').addEventListener(\'click\', function () {',
    '      navigator.clipboard.readText().then(function (t) { $(\'link-video\').value = String(t || \'\').replace(/^\\s+|\\s+$/g, \'\'); aggiornaVideo(); }, function () {});',
    '    });',
    '  }',
    '  // il link nuovo del tuo sito: resta salvato sul TV finche\' non lo cambi',
    '  $(\'usa-sito\').addEventListener(\'click\', function () {',
    '    var v = $(\'testo\').value.replace(/^\\s+|\\s+$/g, \'\');',
    '    if (!v || !sembraLink(v)) return;',
    '    var url = /^https?:\\/\\//i.test(v) ? v : \'https://\' + v;',
    '    invia({ tipo: \'sito\', url: url }).then(function (j) {',
    '      if (j && j.ok) { $(\'testo\').value = \'\'; aggiornaCampo(); chiudiFogli(); avviso(\'Fatto: il riquadro del tuo sito ora apre \' + url.replace(/^https?:\\/\\//, \'\').split(\'/\')[0], 3500); }',
    '    });',
    '  });',
    '  function mandaTesto() {',
    '    var v = $(\'testo\').value.replace(/^\\s+|\\s+$/g, \'\');',
    '    if (!v) return;',
    '    var corpo = sembraLink(v) ? { tipo: \'link\', url: /^https?:\\/\\//i.test(v) ? v : \'https://\' + v } : { tipo: \'testo\', testo: v };',
    '    invia(corpo).then(function (j) {',
    '      if (j && j.ok) { $(\'testo\').value = \'\'; aggiornaCampo(); chiudiFogli(); avviso(corpo.tipo === \'link\' ? \'Link aperto sul TV\' : \'Inviato al TV\', 1600); }',
    '    });',
    '  }',
    '  $(\'testo\').addEventListener(\'input\', aggiornaCampo);',
    '  $(\'testo\').addEventListener(\'keydown\', function (ev) { if (ev.keyCode === 13) { ev.preventDefault(); mandaTesto(); $(\'testo\').blur(); } });',
    '  $(\'invia\').addEventListener(\'click\', mandaTesto);',
    '',
    '  /* ---------------------------------------------------- scrivere nel campo scelto sul TV */',
    '',
    '  var campoTv = null, liveTimer = null, ultimoMandato = null, scrittoQui = false, liveInVolo = false, daConfermare = null;',
    '  function mostraCampo(c) {',
    '    var box = $(\'scrivi-tv\'), inp = $(\'testo-tv\');',
    '    if (!c) {',
    '      campoTv = null;',
    '      // se stai ancora scrivendo il riquadro resta finche\' non hai finito',
    '      if (document.activeElement !== inp) { box.hidden = true; inp.value = \'\'; ultimoMandato = null; }',
    '      return;',
    '    }',
    '    var nuovo = !campoTv || campoTv.etichetta !== c.etichetta || campoTv.tipo !== c.tipo;',
    '    campoTv = c;',
    '    $(\'scrivi-tv-dove\').textContent = c.etichetta || \'\';',
    '    inp.type = c.tipo === \'password\' ? \'password\' : \'text\';',
    '    // tastiera gia\' aperta dal trackpad ma non hai ancora scritto: arriva quello che c\'e\' nel campo del TV',
    '    if (nuovo && (document.activeElement !== inp || !scrittoQui)) { inp.value = c.valore || \'\'; ultimoMandato = inp.value; }',
    '    if (box.hidden) {',
    '      box.hidden = false;',
    '      try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) {}',
    '    }',
    '  }',
    '  // mentre scrivi: il testo va nel campo del TV (senza confermare)',
    '  // una richiesta alla volta, sempre col testo intero piu\' recente: arriva in ordine e subito',
    '  function mandaLive() {',
    '    scrittoQui = true;',
    '    clearTimeout(liveTimer);',
    '    if (campoTv && campoTv.tipo === \'password\') return; // la password va solo con Invio, mai lettera per lettera',
    '    liveTimer = setTimeout(spedisciLive, 60);',
    '  }',
    '  var liveN = 0;',
    '  function spedisciLive() {',
    '    if (liveInVolo) return;',
    '    var v = $(\'testo-tv\').value;',
    '    if (v === ultimoMandato) return;',
    '    ultimoMandato = v;',
    '    liveInVolo = true;',
    '    // una richiesta rimasta appesa (Wi-Fi) non deve fermare il testo che scrivi ne\' l\'Invio',
    '    var mio = ++liveN, guardia = null;',
    '    function fatto() { if (mio !== liveN) return; liveN++; clearTimeout(guardia); fineLive(); }',
    '    guardia = setTimeout(fatto, 2500);',
    '    invia({ tipo: \'testo\', testo: v, invio: false }).then(fatto, fatto);',
    '  }',
    '  function fineLive() {',
    '    liveInVolo = false;',
    '    if (daConfermare) { var f = daConfermare; daConfermare = null; f(); return; }',
    '    if (!$(\'scrivi-tv\').hidden && $(\'testo-tv\').value !== ultimoMandato) spedisciLive();',
    '  }',
    '  function confermaCampo() {',
    '    clearTimeout(liveTimer);',
    '    var v = $(\'testo-tv\').value;',
    '    ultimoMandato = v;',
    '    scrittoQui = false;',
    '    $(\'testo-tv\').blur();',
    '    $(\'scrivi-tv\').hidden = true;',
    '    if (!v.replace(/\\s+/g, \'\')) return;',
    '    var manda = function () { invia({ tipo: \'testo\', testo: v, invio: true }).then(function (j) { if (j && j.ok) avviso(\'Inviato al TV\', 1400); }); };',
    '    if (liveInVolo) daConfermare = manda; else manda(); // dopo l\'ultimo pezzo scritto, mai prima',
    '  }',
    '  $(\'testo-tv\').addEventListener(\'input\', mandaLive);',
    '  $(\'testo-tv\').addEventListener(\'keydown\', function (ev) { if (ev.keyCode === 13) { ev.preventDefault(); confermaCampo(); } });',
    '  $(\'invia-tv\').addEventListener(\'click\', confermaCampo);',
    '  $(\'testo-tv\').addEventListener(\'blur\', function () {',
    '    setTimeout(function () { if (!campoTv && document.activeElement !== $(\'testo-tv\')) $(\'scrivi-tv\').hidden = true; }, 300);',
    '  });',
    '',
    '  /* ---------------------------------------------------- il video sul TV: barra del tempo, pausa, salti */',
    '',
    '  var video = null, videoBase = 0, videoQuando = 0, videoTicker = null, ultimaAzione = 0;',
    '  var trascino = false, valoreTrascino = 0, videoChiuso = leggi(\'hometv-video-chiuso\') === \'1\';',
    '  var ICONA_PLAY = \'<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>\';',
    '  var ICONA_PAUSA = \'<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>\';',
    '  function tempo(s) {',
    '    s = Math.max(0, Math.floor(s || 0));',
    '    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;',
    '    return (h ? h + \':\' + (m < 10 ? \'0\' : \'\') : \'\') + m + \':\' + (x < 10 ? \'0\' : \'\') + x;',
    '  }',
    '  // il tempo scorre anche qui: il TV lo ridice solo quando cambia qualcosa',
    '  function posizioneOra() {',
    '    if (!video) return 0;',
    '    var p = videoBase + (video.inPausa ? 0 : (Date.now() - videoQuando) / 1000);',
    '    return Math.max(0, video.durata ? Math.min(p, video.durata) : p);',
    '  }',
    '  function disegnaVideo() {',
    '    if (!video || document.hidden) return;',
    '    var d = video.durata, p = trascino ? valoreTrascino : posizioneOra();',
    '    var quota = (d ? Math.max(0, Math.min(1, p / d)) * 100 : 0) + \'%\';',
    '    $(\'video-pieno\').style.width = quota;',
    '    $(\'video-linea\').style.width = quota;',
    '    $(\'video-pallino\').style.left = quota;',
    '    $(\'video-bolla\').style.left = quota;',
    '    $(\'video-bolla\').textContent = tempo(p);',
    '    $(\'video-ora\').textContent = tempo(p);',
    '    $(\'video-resta\').textContent = d ? \'\\u2212\' + tempo(d - p) : \'In diretta\';',
    '    $(\'video-sopra\').textContent = videoChiuso ? tempo(p) + (d ? \' di \' + tempo(d) : \'\') : \'Video sul TV\';',
    '    $(\'video-barra\').setAttribute(\'aria-valuenow\', String(Math.round(p)));',
    '    $(\'video-barra\').setAttribute(\'aria-valuetext\', tempo(p));',
    '  }',
    '  function disegnaPausa() {',
    '    var icona = video && !video.inPausa ? ICONA_PAUSA : ICONA_PLAY;',
    '    $(\'video-pausa\').innerHTML = icona;',
    '    $(\'video-mini\').innerHTML = icona;',
    '  }',
    '  function disegnaApertura() {',
    '    $(\'video-tv\').className = \'video-tv\' + (videoChiuso ? \' chiuso\' : \'\');',
    '    $(\'video-apri\').setAttribute(\'aria-expanded\', videoChiuso ? \'false\' : \'true\');',
    '  }',
    '  function mostraVideo(v) {',
    '    var box = $(\'video-tv\');',
    '    if (!v) {',
    '      video = null;',
    '      trascino = false;',
    '      box.hidden = true;',
    '      clearInterval(videoTicker);',
    '      videoTicker = null;',
    '      return;',
    '    }',
    '    var prima = video, titolo = String(v.titolo || \'\');',
    '    // una notizia del TV piu\' vecchia di quello che hai appena fatto qui (salto, pausa) non lo disfa',
    '    var vecchia = !!prima && prima.titolo === titolo && Date.now() - (Number(v.eta) || 0) < ultimaAzione;',
    '    video = { titolo: titolo, durata: Number(v.durata) || 0, inPausa: vecchia ? prima.inPausa : v.inPausa === true };',
    '    if (!vecchia) { videoBase = Number(v.posizione) || 0; videoQuando = Date.now(); }',
    '    $(\'video-titolo\').textContent = titolo || \'Video\';',
    '    $(\'video-barra\').className = \'video-barra\' + (video.durata ? \'\' : \' spenta\') + (trascino ? \' tocco\' : \'\');',
    '    $(\'video-barra\').setAttribute(\'aria-valuemax\', String(Math.round(video.durata)));',
    '    var salti = document.querySelectorAll(\'[data-salto]\');',
    '    for (var k = 0; k < salti.length; k++) salti[k].disabled = !video.durata;',
    '    disegnaPausa();',
    '    if (box.hidden) { disegnaApertura(); box.hidden = false; }',
    '    disegnaVideo();',
    '    if (!videoTicker) videoTicker = setInterval(disegnaVideo, 250);',
    '  }',
    '  function vaiA(s) {',
    '    if (!video || !video.durata) return;',
    '    s = Math.max(0, Math.min(video.durata - 1, s));',
    '    ultimaAzione = Date.now();',
    '    videoBase = s; videoQuando = Date.now();',
    '    disegnaVideo();',
    '    invia({ tipo: \'video\', azione: \'vai\', secondi: Math.round(s * 10) / 10 });',
    '  }',
    '  function saltaDi(sec) {',
    '    if (!video || !video.durata) return;',
    '    ultimaAzione = Date.now();',
    '    videoBase = Math.max(0, Math.min(video.durata - 1, posizioneOra() + sec)); videoQuando = Date.now();',
    '    disegnaVideo();',
    '    invia({ tipo: \'video\', azione: \'salta\', secondi: sec });',
    '  }',
    '  function pausaVideo() {',
    '    if (!video) return;',
    '    ultimaAzione = Date.now();',
    '    videoBase = posizioneOra(); videoQuando = Date.now();',
    '    video.inPausa = !video.inPausa;',
    '    disegnaPausa();',
    '    invia({ tipo: \'video\', azione: video.inPausa ? \'pausa\' : \'play\' });',
    '  }',
    '',
    '  // la barra: tocca un punto o trascina il pallino (il video va li\' quando alzi il dito)',
    '  var barra = $(\'video-barra\');',
    '  function frazione(ev) {',
    '    var r = barra.getBoundingClientRect(), x = ev.clientX;',
    '    if (ev.changedTouches && ev.changedTouches.length) x = ev.changedTouches[0].clientX;',
    '    return r.width > 0 ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0;',
    '  }',
    '  function inizioBarra(ev) {',
    '    if (!video || !video.durata) return;',
    '    if (ev.cancelable) ev.preventDefault();',
    '    trascino = true;',
    '    valoreTrascino = frazione(ev) * video.durata;',
    '    barra.className = \'video-barra tocco\';',
    '    disegnaVideo();',
    '  }',
    '  function muoviBarra(ev) {',
    '    if (!trascino || !video) return;',
    '    if (ev.cancelable) ev.preventDefault();',
    '    valoreTrascino = frazione(ev) * video.durata;',
    '    disegnaVideo();',
    '  }',
    '  function fineBarra(ev) {',
    '    if (!trascino) return;',
    '    trascino = false;',
    '    barra.className = \'video-barra\';',
    '    if (video && video.durata) vaiA(frazione(ev) * video.durata);',
    '  }',
    '  function annullaBarra() {',
    '    if (!trascino) return;',
    '    trascino = false;',
    '    barra.className = \'video-barra\';',
    '    disegnaVideo();',
    '  }',
    '  if (window.PointerEvent) {',
    '    barra.addEventListener(\'pointerdown\', function (ev) { try { barra.setPointerCapture(ev.pointerId); } catch (e) {} inizioBarra(ev); });',
    '    barra.addEventListener(\'pointermove\', muoviBarra);',
    '    barra.addEventListener(\'pointerup\', fineBarra);',
    '    barra.addEventListener(\'pointercancel\', annullaBarra);',
    '  } else {',
    '    barra.addEventListener(\'touchstart\', inizioBarra, { passive: false });',
    '    barra.addEventListener(\'touchmove\', muoviBarra, { passive: false });',
    '    barra.addEventListener(\'touchend\', fineBarra);',
    '    barra.addEventListener(\'touchcancel\', annullaBarra);',
    '  }',
    '  // i pulsanti della sezione: rispondono subito al tocco',
    '  function tocco(el, fn) {',
    '    function giu() { if (!el.disabled) el.classList.add(\'press\'); }',
    '    function su() { el.classList.remove(\'press\'); }',
    '    if (window.PointerEvent) {',
    '      el.addEventListener(\'pointerdown\', giu);',
    '      el.addEventListener(\'pointerup\', su);',
    '      el.addEventListener(\'pointercancel\', su);',
    '      el.addEventListener(\'pointerleave\', su);',
    '    }',
    '    el.addEventListener(\'click\', function () { if (!el.disabled) fn(el); });',
    '  }',
    '  tocco($(\'video-pausa\'), pausaVideo);',
    '  tocco($(\'video-mini\'), pausaVideo);',
    '  var bottoniSalto = document.querySelectorAll(\'[data-salto]\');',
    '  for (var bs = 0; bs < bottoniSalto.length; bs++) {',
    '    tocco(bottoniSalto[bs], function (el) { saltaDi(Number(el.getAttribute(\'data-salto\'))); });',
    '  }',
    '  // tocca il titolo: la sezione si chiude (resta una riga col tempo e play/pausa) o si riapre',
    '  $(\'video-apri\').addEventListener(\'click\', function () {',
    '    videoChiuso = !videoChiuso;',
    '    scrivi(\'hometv-video-chiuso\', videoChiuso ? \'1\' : \'\');',
    '    disegnaApertura();',
    '    disegnaVideo();',
    '  });',
    '',
    '  /* ---------------------------------------------------- trackpad: il dito muove il puntatore sul TV */',
    '',
    '  var modo = leggi(\'hometv-modo\') === \'trackpad\' ? \'trackpad\' : \'frecce\';',
    '  var VELOCITA = [{ g: 1.15, nome: \'lenta\' }, { g: 1.6, nome: \'normale\' }, { g: 2.3, nome: \'veloce\' }];',
    '  var velLetta = parseInt(leggi(\'hometv-velocita\'), 10);',
    '  var vel = isNaN(velLetta) ? 1 : Math.max(0, Math.min(VELOCITA.length - 1, velLetta));',
    '  var sotto = null;    // sul TV il puntatore e\' sopra un campo dove si scrive: { etichetta, tipo }',
    '  var tastieraDa = 0;  // quando la tastiera del telefono si e\' aperta per un campo del TV',
    '',
    '  function mostraModo() {',
    '    var tp = modo === \'trackpad\';',
    '    $(\'trackpad\').hidden = !tp;',
    '    $(\'pad\').hidden = tp;',
    '    $(\'modi\').className = \'modi\' + (tp ? \' tp\' : \'\');',
    '    $(\'modo-frecce\').className = \'modo\' + (tp ? \'\' : \' on\');',
    '    $(\'modo-trackpad\').className = \'modo\' + (tp ? \' on\' : \'\');',
    '    $(\'modo-frecce\').setAttribute(\'aria-pressed\', tp ? \'false\' : \'true\');',
    '    $(\'modo-trackpad\').setAttribute(\'aria-pressed\', tp ? \'true\' : \'false\');',
    '    $(\'velocita\').textContent = \'Velocit\\u00e0 \' + VELOCITA[vel].nome;',
    '  }',
    '  function scegliModo(m) {',
    '    // lo scorrimento che continuava da solo si ferma (se no farebbe ricomparire il puntatore sul TV)',
    '    fermaInerzia();',
    '    codaP = codaP.filter(function (x) { return x.azione !== \'muovi\' && x.azione !== \'scorri\' && x.azione !== \'vivo\'; });',
    '    if (m !== modo) { modo = m; scrivi(\'hometv-modo\', m === \'trackpad\' ? \'trackpad\' : \'\'); mostraModo(); }',
    '    // sul TV il puntatore compare (dov\'era) o sparisce e tornano le frecce',
    '    mandaPuntatore({ azione: m === \'trackpad\' ? \'mostra\' : \'nascondi\' });',
    '  }',
    '  $(\'modo-frecce\').addEventListener(\'click\', function () { scegliModo(\'frecce\'); });',
    '  $(\'modo-trackpad\').addEventListener(\'click\', function () { scegliModo(\'trackpad\'); });',
    '  $(\'velocita\').addEventListener(\'click\', function () {',
    '    vel = (vel + 1) % VELOCITA.length;',
    '    scrivi(\'hometv-velocita\', String(vel));',
    '    mostraModo();',
    '  });',
    '',
    '  // Una richiesta alla volta: i movimenti arrivati intanto si sommano, cosi\' il TV riceve sempre',
    '  // l\'ultimo punto senza code, con la Wi-Fi veloce o lenta.',
    '  var codaP = [], inVolo = false, voloN = 0, voloTimer = null, restoX = 0, restoY = 0, avvisoPuntatore = 0;',
    '  // movimenti: al massimo uno ogni 16 ms (un fotogramma del TV), intanto si sommano; tocchi e clic subito',
    '  var ultimoInvio = 0, invioTimer = null, PASSO_INVIO = 16;',
    '  function mandaPuntatore(c) {',
    '    var u = codaP[codaP.length - 1];',
    '    if ((c.azione === \'muovi\' || c.azione === \'scorri\') && u && u.azione === c.azione) { u.dx += c.dx; u.dy += c.dy; }',
    '    else codaP.push(c);',
    '    spedisci();',
    '  }',
    '  function spedisci() {',
    '    if (inVolo || !codaP.length || !token) return;',
    '    var resta = PASSO_INVIO - (Date.now() - ultimoInvio);',
    '    if (resta > 0 && (codaP[0].azione === \'muovi\' || codaP[0].azione === \'scorri\')) {',
    '      if (!invioTimer) invioTimer = setTimeout(function () { invioTimer = null; spedisci(); }, resta);',
    '      return;',
    '    }',
    '    var c = codaP.shift(), corpo = { t: token, tipo: \'puntatore\', azione: c.azione };',
    '    if (c.azione === \'muovi\' || c.azione === \'scorri\') {',
    '      var muovi = c.azione === \'muovi\', dx = c.dx + (muovi ? restoX : 0), dy = c.dy + (muovi ? restoY : 0);',
    '      corpo.dx = Math.round(dx * 10) / 10;',
    '      corpo.dy = Math.round(dy * 10) / 10;',
    '      if (muovi) { restoX = dx - corpo.dx; restoY = dy - corpo.dy; }',
    '      if (!corpo.dx && !corpo.dy) { spedisci(); return; }',
    '    }',
    '    inVolo = true;',
    '    ultimoInvio = Date.now();',
    '    var mio = ++voloN;',
    '    clearTimeout(voloTimer);',
    '    voloTimer = setTimeout(function () { if (mio === voloN) { inVolo = false; spedisci(); } }, 2500);',
    '    api(\'/comando\', corpo).then(function (j) {',
    '      if (mio !== voloN) return;',
    '      clearTimeout(voloTimer);',
    '      inVolo = false;',
    '      if (j.__stato === 401) { perso(); return; }',
    '      if (j.ascolta === false && Date.now() - avvisoPuntatore > 8000) {',
    '        avvisoPuntatore = Date.now();',
    '        avviso(\'Il puntatore funziona in Home TV, nel browser e nei siti: sul TV \\u00e8 aperta un\\u2019altra app.\', 4000);',
    '      }',
    '      spedisci();',
    '    }, function () {',
    '      if (mio !== voloN) return;',
    '      clearTimeout(voloTimer);',
    '      inVolo = false;',
    '      aggiornaStato(null);',
    '      // rete persa: i movimenti vecchi non servono piu\' (il puntatore non deve saltare dopo), i segni "dito giu\'"',
    '      // neanche; il "dito alzato" si rimanda (fermarsi due volte non fa niente)',
    '      codaP = codaP.filter(function (x) { return x.azione !== \'muovi\' && x.azione !== \'scorri\' && x.azione !== \'vivo\'; });',
    '      if (c.azione === \'fine\') codaP.unshift(c);',
    '      setTimeout(spedisci, 500);',
    '    });',
    '  }',
    '',
    '  var sup = $(\'superficie\'), dito = $(\'dito\'), striV = $(\'scorri-v\'), striO = $(\'scorri-o\');',
    '  var gesto = null, inerzia = 0, SOGLIA = 7, PASSO_V = 200, PASSO_O = 220;',
    '  // accelerazione: piano = preciso, veloce = attraversi lo schermo con un gesto solo',
    '  function guadagno(v) { return VELOCITA[vel].g * (1 + 1.45 * Math.min(Math.max(v - 0.06, 0), 2.6)); }',
    '  // strisce per scorrere: la pagina segue il dito (gesti corti prevedibili), i gesti veloci vanno un po\' piu\' lontano',
    '  function guadagnoScorri(v) { return 1.25 * (1 + 0.6 * Math.min(Math.max(v - 0.3, 0), 1.5)); }',
    '  function mostraDito(x, y, cl) {',
    '    var r = sup.getBoundingClientRect();',
    '    dito.style.left = (x - r.left) + \'px\';',
    '    dito.style.top = (y - r.top) + \'px\';',
    '    if (cl === \'clic\') { dito.className = \'dito\'; void dito.offsetWidth; }',
    '    dito.className = \'dito\' + (cl ? \' \' + cl : \'\');',
    '  }',
    '  function dentroDi(el, x, y) { var r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }',
    '  function accendiStriscia(z, si) {',
    '    if (z === \'v\') striV.className = \'striscia verticale\' + (si ? \' attiva\' : \'\');',
    '    else if (z === \'o\') striO.className = \'striscia orizzontale\' + (si ? \' attiva\' : \'\');',
    '  }',
    '  // dove comincia il tocco decide cosa fa: striscia a destra (su e giu\'), striscia in basso (destra e sinistra), puntatore',
    '  function inizioGesto(x, y, id) {',
    '    fermaInerzia();',
    '    var ora = Date.now(), z = dentroDi(striV, x, y) ? \'v\' : (dentroDi(striO, x, y) ? \'o\' : \'\');',
    '    gesto = { id: id, zona: z, mosso: false, t0: ora, x0: x, y0: y, cx: x, cy: y, tl: ora, v: 0, vx: 0, vy: 0, bx: 0, by: 0, tenuto: false };',
    '    accendiStriscia(z, true);',
    '    // dito fermo un po\' sulla superficie: tasto destro (nella home il menu della scheda indicata)',
    '    if (!z) {',
    '      var g = gesto;',
    '      g.attesaTieni = setTimeout(function () {',
    '        if (gesto !== g || g.mosso) return;',
    '        g.tenuto = true;',
    '        mandaPuntatore({ azione: \'tieni\' });',
    '        mostraDito(g.cx, g.cy, \'clic\');',
    '        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (x) {} }',
    '      }, 600);',
    '      // dito giu\' dopo aver mosso il puntatore: un segno ogni 0,8 s (se non sta gia\' partendo altro), cosi\' il TV sa che',
    '      // il dito c\'e\' ancora; se il "dito alzato" si perde, il TV si ferma da solo dopo 3 s senza segni',
    '      g.battito = setInterval(function () {',
    '        if (gesto !== g) { clearInterval(g.battito); return; }',
    '        if (g.mosso && !inVolo && !codaP.length && Date.now() - ultimoInvio > 700) mandaPuntatore({ azione: \'vivo\' });',
    '      }, 800);',
    '    }',
    '    if (sup.className.indexOf(\'usata\') === -1) sup.className = \'superficie usata\';',
    '  }',
    '  function muoviGesto(x, y) {',
    '    if (!gesto) return;',
    '    var ora = Date.now(), dx = x - gesto.cx, dy = y - gesto.cy, dt = Math.max(8, ora - gesto.tl);',
    '    gesto.cx = x; gesto.cy = y; gesto.tl = ora;',
    '    gesto.v = gesto.v * 0.55 + (Math.sqrt(dx * dx + dy * dy) / dt) * 0.45;',
    '    gesto.vx = gesto.vx * 0.55 + (dx / dt) * 0.45;',
    '    gesto.vy = gesto.vy * 0.55 + (dy / dt) * 0.45;',
    '    if (!gesto.mosso) {',
    '      // i primi millimetri si tengono da parte: se resta un tocco e\' un clic (o un passo), e niente trema',
    '      gesto.bx += dx; gesto.by += dy;',
    '      if (Math.abs(x - gesto.x0) + Math.abs(y - gesto.y0) < SOGLIA) return;',
    '      gesto.mosso = true;',
    '      dx = gesto.bx; dy = gesto.by;',
    '    }',
    '    if (gesto.zona === \'v\') {',
    '      // come una rotellina: dito in giu\' = la pagina va in giu\'',
    '      if (dy) mandaPuntatore({ azione: \'scorri\', dx: 0, dy: dy * guadagnoScorri(Math.abs(gesto.vy)) });',
    '    } else if (gesto.zona === \'o\') {',
    '      // dito a destra = si va avanti nella fila',
    '      if (dx) mandaPuntatore({ azione: \'scorri\', dx: dx * guadagnoScorri(Math.abs(gesto.vx)), dy: 0 });',
    '    } else {',
    '      var g = guadagno(gesto.v);',
    '      mandaPuntatore({ azione: \'muovi\', dx: dx * g, dy: dy * g });',
    '    }',
    '  }',
    '  function fineGesto() {',
    '    var g = gesto;',
    '    gesto = null;',
    '    if (!g) return;',
    '    clearTimeout(g.attesaTieni);',
    '    clearInterval(g.battito);',
    '    accendiStriscia(g.zona, false);',
    '    // il dito si alza dopo aver mosso il puntatore (anche dopo un tocco lungo): la fila che scorreva dal bordo si ferma',
    '    if (!g.zona && g.mosso) mandaPuntatore({ azione: \'fine\' });',
    '    if (g.tenuto) return; // e\' stato un tasto destro, non un clic',
    '    if (!g.mosso && Date.now() - g.t0 < 450) {',
    '      if (!g.zona) { cliccaTv(); return; }',
    '      // tocco su una striscia: un passo verso l\'estremita\' toccata',
    '      var r = (g.zona === \'v\' ? striV : striO).getBoundingClientRect();',
    '      if (g.zona === \'v\') mandaPuntatore({ azione: \'scorri\', dx: 0, dy: g.y0 < r.top + r.height / 2 ? -PASSO_V : PASSO_V });',
    '      else mandaPuntatore({ azione: \'scorri\', dx: g.x0 < r.left + r.width / 2 ? -PASSO_O : PASSO_O, dy: 0 });',
    '      return;',
    '    }',
    '    // lasciato andare mentre scorreva: continua un po\' e rallenta da solo',
    '    if (g.zona && g.mosso && Date.now() - g.tl < 80) {',
    '      if (g.zona === \'v\') avviaInerzia(0, g.vy * guadagnoScorri(Math.abs(g.vy)));',
    '      else avviaInerzia(g.vx * guadagnoScorri(Math.abs(g.vx)), 0);',
    '    }',
    '  }',
    '  // slancio dopo il gesto: rallenta da solo come su iPhone (frenata esponenziale, circa 1/3 di secondo)',
    '  function avviaInerzia(vx, vy) {',
    '    var MAX = 4;',
    '    vx = Math.max(-MAX, Math.min(MAX, vx)); vy = Math.max(-MAX, Math.min(MAX, vy));',
    '    if (Math.abs(vx) < 0.25 && Math.abs(vy) < 0.25) return;',
    '    var prima = Date.now(), raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };',
    '    (function giro() {',
    '      var ora = Date.now(), dt = Math.max(1, Math.min(48, ora - prima));',
    '      prima = ora;',
    '      var f = Math.exp(-dt / 325);',
    '      vx *= f; vy *= f;',
    '      if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) { inerzia = 0; return; }',
    '      mandaPuntatore({ azione: \'scorri\', dx: vx * dt, dy: vy * dt });',
    '      inerzia = raf(giro);',
    '    })();',
    '  }',
    '  function fermaInerzia() {',
    '    if (!inerzia) return;',
    '    if (window.cancelAnimationFrame) window.cancelAnimationFrame(inerzia); else clearTimeout(inerzia);',
    '    inerzia = 0;',
    '  }',
    '  function toccoCon(lista, id) {',
    '    for (var i = 0; i < lista.length; i++) if (lista[i].identifier === id) return lista[i];',
    '    return null;',
    '  }',
    '  // un dito solo: gli altri che toccano la superficie non contano',
    '  sup.addEventListener(\'touchstart\', function (ev) {',
    '    if (ev.target === $(\'velocita\')) return;',
    '    ev.preventDefault();',
    '    if (gesto) return;',
    '    var t = ev.changedTouches[0];',
    '    inizioGesto(t.clientX, t.clientY, t.identifier);',
    '    if (!gesto.zona) mostraDito(t.clientX, t.clientY, \'on\');',
    '  }, { passive: false });',
    '  sup.addEventListener(\'touchmove\', function (ev) {',
    '    if (!gesto) return;',
    '    ev.preventDefault();',
    '    var t = toccoCon(ev.touches, gesto.id);',
    '    if (!t) return;',
    '    if (!gesto.zona) mostraDito(t.clientX, t.clientY, \'on\');',
    '    muoviGesto(t.clientX, t.clientY);',
    '  }, { passive: false });',
    '  sup.addEventListener(\'touchend\', function (ev) {',
    '    if (!gesto) return;',
    '    ev.preventDefault();',
    '    var t = toccoCon(ev.changedTouches, gesto.id);',
    '    if (!t) return; // si e\' alzato un altro dito',
    '    mostraDito(t.clientX, t.clientY, !gesto.mosso && !gesto.zona ? \'clic\' : \'\');',
    '    fineGesto(); // dentro il tocco: se serve la tastiera si apre (il telefono lo permette solo qui)',
    '  }, { passive: false });',
    '  sup.addEventListener(\'touchcancel\', function () {',
    '    if (gesto) {',
    '      clearInterval(gesto.battito);',
    '      accendiStriscia(gesto.zona, false);',
    '      if (!gesto.zona && gesto.mosso) mandaPuntatore({ azione: \'fine\' });',
    '    }',
    '    gesto = null;',
    '    dito.className = \'dito\';',
    '  });',
    '  // col mouse (telecomando aperto sul computer): trascina per muovere o sulle strisce per scorrere, clic, rotella',
    '  if (window.PointerEvent) {',
    '    sup.addEventListener(\'pointerdown\', function (ev) {',
    '      if (ev.pointerType !== \'mouse\' || ev.target === $(\'velocita\') || gesto) return;',
    '      try { sup.setPointerCapture(ev.pointerId); } catch (e) {}',
    '      inizioGesto(ev.clientX, ev.clientY, \'mouse\');',
    '    });',
    '    sup.addEventListener(\'pointermove\', function (ev) { if (ev.pointerType === \'mouse\' && gesto) muoviGesto(ev.clientX, ev.clientY); });',
    '    sup.addEventListener(\'pointerup\', function (ev) { if (ev.pointerType === \'mouse\' && gesto) fineGesto(); });',
    '  }',
    '  sup.addEventListener(\'wheel\', function (ev) {',
    '    ev.preventDefault();',
    '    mandaPuntatore({ azione: \'scorri\', dx: ev.deltaX, dy: ev.deltaY });',
    '  }, { passive: false });',
    '',
    '  function cliccaTv() {',
    '    // il puntatore e\' sopra un campo dove si scrive: la tastiera si apre subito (serve proprio il tocco)',
    '    if (sotto) apriTastiera(sotto);',
    '    mandaPuntatore({ azione: \'clic\' });',
    '    try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}',
    '  }',
    '  function apriTastiera(c) {',
    '    var box = $(\'scrivi-tv\'), inp = $(\'testo-tv\');',
    '    if (!campoTv) {',
    '      $(\'scrivi-tv-dove\').textContent = c.etichetta || \'\';',
    '      inp.type = c.tipo === \'password\' ? \'password\' : \'text\';',
    '      inp.value = c.valore || \'\';',
    '      ultimoMandato = inp.value;',
    '    }',
    '    scrittoQui = false;',
    '    box.hidden = false;',
    '    try { inp.focus(); } catch (e) {}',
    '    tastieraDa = Date.now();',
    '    // se sul TV il clic non ha aperto un campo dove si scrive, la tastiera si richiude da sola',
    '    setTimeout(function () {',
    '      if (!campoTv && !scrittoQui && document.activeElement === inp && Date.now() - tastieraDa >= 2900) { inp.blur(); box.hidden = true; }',
    '    }, 3000);',
    '  }',
    '',
    '  /* ---------------------------------------------------- pannelli: Altri tasti (dal basso), Scrivi (dall\'alto) */',
    '',
    '  var foglioAperto = null;',
    '  function apriFoglio(id) {',
    '    if (foglioAperto) chiudiFogli(true);',
    '    var f = $(id), v = $(\'velo\');',
    '    foglioAperto = f;',
    '    v.hidden = false;',
    '    f.hidden = false;',
    '    void f.offsetWidth; // cosi\' scorre dentro',
    '    v.className = \'velo aperto\';',
    '    f.className = f.className.replace(/ aperto/g, \'\') + \' aperto\';',
    '  }',
    '  function chiudiFogli(subito) {',
    '    var f = foglioAperto, v = $(\'velo\');',
    '    if (!f) return;',
    '    foglioAperto = null;',
    '    try { if (document.activeElement && f.contains(document.activeElement)) document.activeElement.blur(); } catch (e) {}',
    '    v.className = \'velo\'; // da subito non ferma piu\' i tocchi',
    '    f.className = f.className.replace(/ aperto/g, \'\');',
    '    if (subito) { v.hidden = true; f.hidden = true; return; }',
    '    setTimeout(function () { if (foglioAperto !== f) f.hidden = true; if (!foglioAperto) v.hidden = true; }, 320);',
    '  }',
    '  $(\'velo\').addEventListener(\'click\', function () { chiudiFogli(); });',
    '  $(\'apri-altro\').addEventListener(\'click\', function () { apriFoglio(\'foglio-altro\'); });',
    '  // la tastiera si apre subito (il telefono la apre solo dentro un tocco)',
    '  $(\'apri-scrivi\').addEventListener(\'click\', function () { apriFoglio(\'foglio-scrivi\'); try { $(\'testo\').focus(); } catch (e) {} });',
    '  $(\'apri-video\').addEventListener(\'click\', function () { apriFoglio(\'foglio-video\'); try { $(\'link-video\').focus(); } catch (e) {} });',
    '',
    '  /* ---------------------------------------------------- schede del browser: l\'elenco qui, la galleria sul TV */',
    '',
    '  function ospite(u) { var m = /^https?:\\/\\/([^\\/?#]+)/i.exec(u || \'\'); return m ? m[1].replace(/^www\\./, \'\') : \'\'; }',
    '  function mostraSchede(j) {',
    '    var l = $(\'lista-schede\'), lista = (j && j.schede) || [];',
    '    while (l.firstChild) l.removeChild(l.firstChild);',
    '    if (!lista.length) { l.textContent = \'Nessuna scheda aperta: con "Nuova scheda" ne apri una.\'; return; }',
    '    lista.forEach(function (x) {',
    '      var r = document.createElement(\'button\'), testi = document.createElement(\'div\');',
    '      var b = document.createElement(\'b\'), sp = document.createElement(\'span\'), h = ospite(x.url);',
    '      r.className = \'riga-scheda\' + (x.id === j.attiva ? \' attiva\' : \'\');',
    '      if (/^https?:\\/\\//i.test(x.img || \'\')) {',
    '        var im = document.createElement(\'img\');',
    '        im.alt = \'\';',
    '        im.onerror = function () { var v = document.createElement(\'i\'); v.textContent = (h || \'?\').charAt(0).toUpperCase(); r.replaceChild(v, im); };',
    '        im.src = x.img;',
    '        r.appendChild(im);',
    '      } else {',
    '        var v = document.createElement(\'i\');',
    '        v.textContent = (h || \'?\').charAt(0).toUpperCase();',
    '        r.appendChild(v);',
    '      }',
    '      b.textContent = x.titolo || h;',
    '      sp.textContent = h;',
    '      testi.appendChild(b);',
    '      testi.appendChild(sp);',
    '      r.appendChild(testi);',
    '      r.addEventListener(\'click\', function () {',
    '        chiudiFogli();',
    '        invia({ tipo: \'scheda\', id: x.id }).then(function (k) { if (k && !k.error && !(k.__stato >= 400)) avviso(\'Apro la scheda sul TV\', 2000); });',
    '      });',
    '      l.appendChild(r);',
    '    });',
    '  }',
    '  $(\'apri-schede\').addEventListener(\'click\', function () {',
    '    apriFoglio(\'foglio-schede\');',
    '    $(\'lista-schede\').textContent = \'Carico le schede\\u2026\';',
    '    if (DEMO) {',
    '      mostraSchede({ attiva: \'a\', schede: [{ id: \'a\', titolo: \'Che tempo fa oggi\', url: \'https://meteo.example/oggi\' },',
    '        { id: \'b\', titolo: \'Pasta al pomodoro: la ricetta\', url: \'https://ricette.example/pasta\' }] });',
    '      return;',
    '    }',
    '    api(\'/schede?t=\' + encodeURIComponent(token)).then(function (j) {',
    '      if (j.__stato === 401) { perso(); return; }',
    '      mostraSchede(j);',
    '    }, function () { $(\'lista-schede\').textContent = \'Non trovo il TV: riprova.\'; });',
    '  });',
    '  $(\'schede-tv\').addEventListener(\'click\', function () { chiudiFogli(); invia({ tipo: \'schede\' }); });',
    '  /* ---------------------------------------------------- lo Store: come sul TV. L\'elenco (con gli stati e i colori) lo manda il',
    '     TV, che fa anche le azioni: installa, apri, disinstalla, togli, aggiungi */',
    '',
    '  var storeVer = -1, storeEsito = 0, storeDati = null, storeDove = \'\', storeInCasa = true, confermaTimer = null, appAperta = \'\';',
    '  var TITOLI_STORE = { film: \'Film e serie\', video: \'Video e musica\', sport: \'Sport\', giochi: \'Giochi\', strumenti: \'Strumenti\', altre: \'Altre app\' };',
    '  var ORDINE_STORE = [\'film\', \'video\', \'sport\', \'giochi\', \'strumenti\', \'altre\'];',
    '  var NOMI_AZIONI = { installa: \'Installa sul TV\', apri: \'Apri sul TV\', disinstalla: \'Disinstalla\', togli: \'Togli\' };',
    '  var FRECCIA_DX = \'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>\';',
    '  function piano(t) {',
    '    t = String(t || \'\').toLowerCase();',
    '    try { t = t.normalize(\'NFD\').replace(/[\\u0300-\\u036f]/g, \'\'); } catch (e) {}',
    '    return t;',
    '  }',
    '  function storeAperto() { return !$(\'vista-store\').hidden || !$(\'vista-app\').hidden; }',
    '  function privata(a) { return a.chiave.indexOf(\'mia:\') === 0; }',
    '  function installataApp(a) { return a.stato === \'installata\' || a.stato === \'nuova\' || a.stato === \'orfana\'; }',
    '  function sfondoApp(a) {',
    '    var c = a.colore || [\'59,76,202\', \'26,35,102\'];',
    '    return \'linear-gradient(140deg, rgb(\' + c[0] + \') 0%, rgb(\' + c[1] + \') 100%)\';',
    '  }',
    '  function iniziale(a) { return (a.nome || \'?\').charAt(0).toUpperCase(); }',
    '  // l\'icona: l\'immagine (solo le app dello Store) sopra l\'iniziale coi colori dell\'app, come sul TV',
    '  function iconaApp(a, cls) {',
    '    var d = document.createElement(\'div\');',
    '    d.className = cls;',
    '    d.style.background = sfondoApp(a);',
    '    if (a.icona) {',
    '      var im = document.createElement(\'img\');',
    '      im.alt = \'\';',
    '      im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); d.textContent = iniziale(a); };',
    '      im.src = a.icona;',
    '      d.appendChild(im);',
    '    } else d.textContent = iniziale(a);',
    '    return d;',
    '  }',
    '  function sottoApp(a) {',
    '    if (a.stato === \'nonAdatta\') return \'Non va su questo TV\';',
    '    if (a.stato === \'ritirata\') return \'Non pi\\u00f9 disponibile\';',
    '    if (a.stato === \'orfana\') return \'Non pi\\u00f9 nello Store\';',
    '    if (a.stato === \'nuova\') return \'Versione nuova\';',
    '    if (privata(a)) return \'Non verificata\';',
    '    if (a.stato === \'installata\') return \'Installata\';',
    '    return TITOLI_STORE[a.categoria] || \'App\';',
    '  }',
    '  function azioniApp(a) {',
    '    if (privata(a)) return a.stato === \'nonAdatta\' || a.stato === \'ritirata\' ? [\'togli\'] : [\'apri\', \'togli\'];',
    '    if (a.stato === \'installa\') return [\'installa\'];',
    '    if (a.stato === \'installata\' || a.stato === \'nuova\') return [\'apri\', \'disinstalla\'];',
    '    if (a.stato === \'orfana\' || a.stato === \'ritirata\') return [\'disinstalla\'];',
    '    return [];',
    '  }',
    '  function cartaApp(a) {',
    '    var c = document.createElement(\'button\'), ic = iconaApp(a, \'ico\'), b = document.createElement(\'b\'), sp = document.createElement(\'span\');',
    '    c.className = \'carta-app\';',
    '    c.setAttribute(\'data-id\', a.chiave);',
    '    c.setAttribute(\'data-stato\', a.stato);',
    '    if (a.stato === \'nuova\') { var p = document.createElement(\'i\'); p.className = \'pallino-app\'; ic.appendChild(p); }',
    '    else if (installataApp(a)) { var s = document.createElement(\'i\'); s.className = \'spunta-app\'; ic.appendChild(s); }',
    '    c.appendChild(ic);',
    '    b.textContent = a.nome;',
    '    sp.textContent = sottoApp(a);',
    '    if (privata(a)) sp.className = \'privata\';',
    '    c.appendChild(b);',
    '    c.appendChild(sp);',
    '    c.addEventListener(\'click\', function () { paginaApp(a.chiave); });',
    '    return c;',
    '  }',
    '  // In evidenza: la copertina disegnata per il riquadro, se no l\'icona, il nome e la prima frase sui colori dell\'app',
    '  function cartaGrande(a) {',
    '    var c = document.createElement(\'button\'), d = document.createElement(\'div\'), b = document.createElement(\'b\'), sp = document.createElement(\'span\');',
    '    c.className = a.copertina ? \'carta-grande\' : \'carta-grande senza\';',
    '    c.setAttribute(\'data-id\', a.chiave);',
    '    c.style.background = sfondoApp(a);',
    '    if (a.copertina) {',
    '      var im = document.createElement(\'img\');',
    '      im.className = \'cop\';',
    '      im.alt = a.nome;',
    '      im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); c.className = \'carta-grande senza\'; };',
    '      im.src = a.copertina;',
    '      c.appendChild(im);',
    '    }',
    '    c.appendChild(iconaApp(a, \'ico-grande\'));',
    '    d.className = \'dentro\';',
    '    b.textContent = a.nome;',
    '    sp.textContent = a.descrizione ? a.descrizione.split(\'. \')[0] : (TITOLI_STORE[a.categoria] || \'App\');',
    '    d.appendChild(b);',
    '    d.appendChild(sp);',
    '    c.appendChild(d);',
    '    c.addEventListener(\'click\', function () { paginaApp(a.chiave); });',
    '    return c;',
    '  }',
    '  function rigaApp(a) {',
    '    var r = document.createElement(\'button\'), t = document.createElement(\'div\'), b = document.createElement(\'b\'), sp = document.createElement(\'span\');',
    '    r.className = \'riga-app\';',
    '    r.setAttribute(\'data-id\', a.chiave);',
    '    r.setAttribute(\'data-stato\', a.stato);',
    '    r.appendChild(iconaApp(a, \'ico\'));',
    '    t.className = \'testi\';',
    '    b.textContent = a.nome;',
    '    sp.textContent = sottoApp(a) + (privata(a) && a.sito ? \' \\u00b7 \' + a.sito : \'\');',
    '    if (privata(a)) sp.className = \'privata\';',
    '    t.appendChild(b);',
    '    t.appendChild(sp);',
    '    r.appendChild(t);',
    '    r.insertAdjacentHTML(\'beforeend\', FRECCIA_DX);',
    '    r.addEventListener(\'click\', function () { paginaApp(a.chiave); });',
    '    return r;',
    '  }',
    '  function sezione(titolo, voci, grande) {',
    '    var s = document.createElement(\'div\'), h = document.createElement(\'h3\'), l = document.createElement(\'div\');',
    '    s.className = \'sezione-store\';',
    '    h.textContent = titolo;',
    '    l.className = \'scorri\';',
    '    voci.forEach(function (a) { l.appendChild(grande ? cartaGrande(a) : cartaApp(a)); });',
    '    s.appendChild(h);',
    '    s.appendChild(l);',
    '    return s;',
    '  }',
    '  function tutteApp() { return storeDati ? storeDati.app.concat(storeDati.mie) : []; }',
    '  function cercaQui(a, q) {',
    '    return piano([a.nome, a.descrizione, a.autore, TITOLI_STORE[a.categoria] || \'\', a.sito].join(\' \')).indexOf(q) !== -1;',
    '  }',
    '  function mostraStore() {',
    '    var corpo = $(\'store-corpo\'), testoQ = $(\'cerca-store\').value.replace(/^\\s+|\\s+$/g, \'\'), q = piano(testoQ), d = storeDati, nota = $(\'store-nota\');',
    '    nota.textContent = storeInCasa ? \'\' : \'Sul TV \\u00e8 aperto \' + (storeDove || \'altro\') + \': installa e disinstalla si fanno appena torni alla home.\';',
    '    nota.className = storeInCasa ? \'nota store-nota via\' : \'nota store-nota\';',
    '    while (corpo.firstChild) corpo.removeChild(corpo.firstChild);',
    '    if (!d) { corpo.innerHTML = \'<p class="vuoto-store">Apri la home sul TV: lo Store arriva da l\\u00ec.</p>\'; return; }',
    '    var n = d.app.filter(function (a) { return a.stato !== \'orfana\'; }).length;',
    '    $(\'store-sotto\').textContent = n === 1 ? \'1 app per il tuo TV\' : n + \' app per il tuo TV\';',
    '    if (q) {',
    '      var trovate = tutteApp().filter(function (a) { return cercaQui(a, q); });',
    '      var s = document.createElement(\'div\'), h = document.createElement(\'h3\');',
    '      s.className = \'sezione-store\';',
    '      h.textContent = trovate.length ? (trovate.length === 1 ? \'1 app\' : trovate.length + \' app\') + \' per \\u00ab\' + testoQ + \'\\u00bb\' : \'Nessuna app per \\u00ab\' + testoQ + \'\\u00bb\';',
    '      s.appendChild(h);',
    '      trovate.forEach(function (a) { s.appendChild(rigaApp(a)); });',
    '      corpo.appendChild(s);',
    '      return;',
    '    }',
    '    var evid = d.app.filter(function (a) { return a.evidenza && a.stato !== \'ritirata\' && a.stato !== \'orfana\'; });',
    '    if (evid.length) corpo.appendChild(sezione(\'In evidenza\', evid, true));',
    '    var tue = d.app.filter(installataApp);',
    '    if (tue.length) corpo.appendChild(sezione(\'Le tue app\', tue));',
    '    ORDINE_STORE.forEach(function (cat) {',
    '      var qui = d.app.filter(function (a) { return a.categoria === cat && a.stato !== \'ritirata\' && a.stato !== \'orfana\'; });',
    '      if (qui.length) corpo.appendChild(sezione(TITOLI_STORE[cat], qui));',
    '    });',
    '    if (d.mie.length) corpo.appendChild(sezione(\'Le mie app\', d.mie));',
    '    if (!d.app.length && !d.mie.length) corpo.innerHTML = \'<p class="vuoto-store">Lo Store \\u00e8 vuoto per ora.</p>\';',
    '  }',
    '  function trovaAppStore(chiave) {',
    '    var l = tutteApp();',
    '    for (var i = 0; i < l.length; i++) if (l[i].chiave === chiave) return l[i];',
    '    return null;',
    '  }',
    '  // la pagina di un\'app, come sul TV: copertina, icona, nome, e il pulsante grande "Installa sul TV"',
    '  function paginaApp(chiave, soloAggiorna) {',
    '    var a = trovaAppStore(chiave);',
    '    if (!a) { if (soloAggiorna && appAperta) { appAperta = \'\'; mostra(\'store\'); } return; }',
    '    appAperta = chiave;',
    '    var cop = $(\'app-copertina\');',
    '    while (cop.firstChild) cop.removeChild(cop.firstChild);',
    '    cop.hidden = !a.copertina;',
    '    if (a.copertina) {',
    '      var im = document.createElement(\'img\');',
    '      im.alt = a.nome;',
    '      im.onerror = function () { cop.hidden = true; };',
    '      im.src = a.copertina;',
    '      cop.appendChild(im);',
    '    }',
    '    var vecchia = $(\'app-icona\'), nuova = iconaApp(a, \'app-icona\');',
    '    nuova.id = \'app-icona\';',
    '    vecchia.parentNode.replaceChild(nuova, vecchia);',
    '    var sopra = $(\'app-sopra\'), info = [];',
    '    sopra.textContent = privata(a) ? \'App privata \\u00b7 non verificata\' : (TITOLI_STORE[a.categoria] || \'App\') + (a.autore ? \' \\u00b7 di \' + a.autore : \'\');',
    '    sopra.className = privata(a) ? \'privata\' : \'\';',
    '    $(\'app-nome\').textContent = a.nome;',
    '    if (a.versione) info.push(\'Versione \' + a.versione);',
    '    if (privata(a)) { info.push(\'da \' + (a.sito || \'una fonte privata\')); if (a.autore) info.push(\'autore dichiarato: \' + a.autore); }',
    '    else if (a.stato !== \'installa\') info.push(sottoApp(a));',
    '    $(\'app-info\').textContent = info.join(\' \\u00b7 \');',
    '    var az = $(\'app-azioni\'), l = azioniApp(a);',
    '    while (az.firstChild) az.removeChild(az.firstChild);',
    '    if (!l.length) {',
    '      var sp = document.createElement(\'div\');',
    '      sp.className = \'spento\';',
    '      sp.textContent = sottoApp(a);',
    '      az.appendChild(sp);',
    '    }',
    '    l.forEach(function (x, i) {',
    '      var p = document.createElement(\'button\');',
    '      p.textContent = NOMI_AZIONI[x];',
    '      p.setAttribute(\'data-azione\', x);',
    '      if (i === 0 && (x === \'installa\' || x === \'apri\')) p.className = \'primo\';',
    '      p.addEventListener(\'click\', function () { azioneStore(a, x, p); });',
    '      az.appendChild(p);',
    '    });',
    '    $(\'app-descr\').textContent = a.descrizione || \'\';',
    '    var nov = $(\'app-novita\');',
    '    nov.hidden = !a.novita;',
    '    nov.textContent = \'\';',
    '    if (a.novita) {',
    '      var bb = document.createElement(\'b\');',
    '      bb.textContent = \'Novit\\u00e0 della versione \' + a.versione + \': \';',
    '      nov.appendChild(bb);',
    '      nov.appendChild(document.createTextNode(a.novita));',
    '    }',
    '    if (!soloAggiorna) { mostra(\'app\'); try { window.scrollTo(0, 0); } catch (e) {} }',
    '  }',
    '  function caricaStore() {',
    '    if (DEMO) return;',
    '    api(\'/store?t=\' + encodeURIComponent(token)).then(function (j) {',
    '      if (j.__stato === 401) { perso(); return; }',
    '      storeDati = j.store || null;',
    '      storeDove = j.dove || \'\';',
    '      storeInCasa = !!j.casa;',
    '      // l\'esito dell\'ultima azione fatta dal TV (installata, non trovata...): il primo si guarda e basta, gli altri si dicono',
    '      var e = storeDati && storeDati.esito, at = (e && e.at) || 0;',
    '      if (storeEsito && at > storeEsito && e.testo) avviso(e.testo, 3500);',
    '      if (!storeEsito || at > storeEsito) storeEsito = Math.max(at, 1);',
    '      if (!$(\'vista-store\').hidden) mostraStore();',
    '      if (appAperta && !$(\'vista-app\').hidden) paginaApp(appAperta, true);',
    '    }, function () { if (!storeDati) $(\'store-corpo\').innerHTML = \'<p class="vuoto-store">Non trovo il TV: riprova.</p>\'; });',
    '  }',
    '  function azioneStore(a, x, p) {',
    '    // disinstallare o togliere: un secondo tocco per conferma',
    '    if ((x === \'disinstalla\' || x === \'togli\') && p.className !== \'conferma\') {',
    '      p.className = \'conferma\';',
    '      p.textContent = \'Sicuro?\';',
    '      clearTimeout(confermaTimer);',
    '      confermaTimer = setTimeout(function () { p.className = \'\'; p.textContent = NOMI_AZIONI[x]; }, 3000);',
    '      return;',
    '    }',
    '    clearTimeout(confermaTimer);',
    '    var c = { tipo: \'store\', azione: x };',
    '    if (!privata(a) && x !== \'apri\') c.id = a.chiave.slice(3); else c.riquadro = a.chiave;',
    '    invia(c).then(function (k) {',
    '      if (!k || k.error || k.__stato >= 400) return;',
    '      if (k.coda) avviso(x === \'apri\' ? \'Apro la home sul TV\' : \'Si far\\u00e0 sul TV appena torni alla home\', 3500);',
    '      else avviso(x === \'installa\' ? \'Installo sul TV\\u2026\' : x === \'apri\' ? \'Apro sul TV\' : x === \'disinstalla\' ? \'Disinstallo sul TV\\u2026\' : \'Tolgo dal TV\\u2026\', 2000);',
    '    });',
    '  }',
    '  $(\'apri-store\').addEventListener(\'click\', function () {',
    '    appAperta = \'\';',
    '    mostra(\'store\');',
    '    try { window.scrollTo(0, 0); } catch (e) {}',
    '    $(\'avviso-app\').hidden = true;',
    '    if (DEMO) {',
    '      storeDati = { catalogo: \'Store\', mie: [], app: [',
    '        { chiave: \'ws:orologio\', nome: \'Orologio\', descrizione: "L\'ora grande e la data, leggibili dal divano.", categoria: \'strumenti\', stato: \'installata\', evidenza: true, versione: \'1.0.0\' },',
    '        { chiave: \'ws:meteo\', nome: \'Meteo\', descrizione: \'Il tempo di oggi e della settimana.\', categoria: \'strumenti\', stato: \'installa\', versione: \'1.0.0\', colore: [\'15,155,142\', \'10,71,68\'] },',
    '        { chiave: \'ws:scacchi\', nome: \'Scacchi\', descrizione: \'Una partita col telecomando.\', categoria: \'giochi\', stato: \'installa\', versione: \'1.0.0\', colore: [\'142,63,184\', \'61,24,87\'] }] };',
    '      mostraStore();',
    '      return;',
    '    }',
    '    if (!storeDati) $(\'store-corpo\').innerHTML = \'<p class="vuoto-store">Chiedo lo Store al TV\\u2026</p>\';',
    '    else mostraStore();',
    '    caricaStore();',
    '    invia({ tipo: \'store\', azione: \'elenco\' });',
    '  });',
    '  $(\'store-indietro\').addEventListener(\'click\', function () { appAperta = \'\'; mostra(\'comandi\'); });',
    '  $(\'app-indietro\').addEventListener(\'click\', function () { appAperta = \'\'; mostra(\'store\'); mostraStore(); });',
    '  $(\'cerca-store\').addEventListener(\'input\', function () { if (storeDati) mostraStore(); });',
    '  $(\'aggiungi-app\').addEventListener(\'click\', function () {',
    '    if (!$(\'indirizzo-app\').value.replace(/\\s+/g, \'\')) { try { $(\'indirizzo-app\').focus(); } catch (e) {} return; }',
    '    if (storeDati && storeDati.mie.length >= 300) { avviso(\'Le mie app \\u00e8 piena (300 app): sul TV togli una fonte prima\', 4000); return; }',
    '    $(\'avviso-app\').hidden = false;',
    '  });',
    '  $(\'annulla-app\').addEventListener(\'click\', function () { $(\'avviso-app\').hidden = true; });',
    '  $(\'conferma-app\').addEventListener(\'click\', function () {',
    '    var t = $(\'indirizzo-app\').value.replace(/^\\s+|\\s+$/g, \'\');',
    '    $(\'avviso-app\').hidden = true;',
    '    invia({ tipo: \'store\', azione: \'aggiungi\', indirizzo: t }).then(function (k) {',
    '      if (!k || k.error || k.__stato >= 400) return;',
    '      if (k.coda) avviso(\'Si far\\u00e0 sul TV appena torni alla home\', 3500);',
    '      else { avviso(\'Il TV cerca l\\u2019app\\u2026\', 2500); $(\'indirizzo-app\').value = \'\'; }',
    '    });',
    '  });',
    '  // scheda nuova: sul TV il browser con la ricerca pronta; qui si apre subito la casella per scrivere l\'indirizzo',
    '  $(\'nuova-scheda\').addEventListener(\'click\', function () {',
    '    apriFoglio(\'foglio-scrivi\');',
    '    try { $(\'testo\').focus(); } catch (e) {}',
    '    invia({ tipo: \'nuovaScheda\' });',
    '  });',
    '  var chiudono = document.querySelectorAll(\'.foglio .chiude\');',
    '  for (var cf = 0; cf < chiudono.length; cf++) chiudono[cf].addEventListener(\'click\', function () { chiudiFogli(); });',
    '',
    '  /* ---------------------------------------------------- stato e avvio */',
    '',
    '  var statoTimer = null, statoVer = 0, statoGiro = 0, statoFerma = null;',
    '  // la richiesta lunga di prima si chiude davvero: se restasse appesa terrebbe occupata una delle poche connessioni',
    '  // del telefono verso il TV, e i tasti aspetterebbero dietro di lei',
    '  function fermaStato() {',
    '    statoGiro++;',
    '    if (statoFerma) { try { statoFerma.abort(); } catch (e) {} statoFerma = null; }',
    '  }',
    '  function controllaStato() {',
    '    clearTimeout(statoTimer);',
    '    fermaStato();',
    '    if (document.hidden || !token) return;',
    '    var mio = statoGiro; // una richiesta rimasta appesa (telefono in tasca, Wi-Fi) viene superata',
    '    statoFerma = typeof AbortController === \'function\' ? new AbortController() : null;',
    '    api(\'/stato?t=\' + encodeURIComponent(token) + (statoVer ? \'&v=\' + statoVer : \'\'), null, statoFerma && statoFerma.signal).then(function (j) {',
    '      if (mio !== statoGiro) return;',
    '      if (j.__stato === 401) { perso(); return; }',
    '      aggiornaStato(j);',
    '      mostraCampo(j.campo || null);',
    '      mostraVideo(j.video || null);',
    '      sotto = j.sotto || null;',
    '      statoVer = j.ver || 0;',
    '      if (typeof j.storeVer === \'number\' && j.storeVer !== storeVer) { storeVer = j.storeVer; if (storeAperto() || storeEsito) caricaStore(); }',
    '      statoTimer = setTimeout(controllaStato, j.ver ? 40 : 4000);',
    '    }, function () {',
    '      if (mio !== statoGiro) return;',
    '      aggiornaStato(null);',
    '      statoVer = 0;',
    '      statoTimer = setTimeout(controllaStato, 5000);',
    '    });',
    '  }',
    '  document.addEventListener(\'visibilitychange\', function () {',
    '    if (!document.hidden) { controllaStato(); return; }',
    '    clearTimeout(statoTimer);',
    '    fermaStato();',
    '  });',
    '',
    '  function avvio() {',
    '    mostra(\'comandi\');',
    '    mostraModo();',
    '    aggiornaCampo();',
    '    controllaStato();',
    '    var installata = window.navigator.standalone === true || (window.matchMedia && matchMedia(\'(display-mode: standalone)\').matches);',
    '    if (!installata && !leggi(\'hometv-consiglio-visto\')) $(\'consiglio\').className = \'consiglio on\';',
    '  }',
    '  $(\'chiudi-consiglio\').addEventListener(\'click\', function () {',
    '    $(\'consiglio\').className = \'consiglio\';',
    '    scrivi(\'hometv-consiglio-visto\', \'1\');',
    '  });',
    '',
    '  var pinDalLink = parametro(\'pin\');',
    '  if (DEMO) { token = \'demo\'; avvio(); }',
    '  else if (pinDalLink && /^\\d{6}$/.test(pinDalLink)) { mostra(\'abbina\'); $(\'pin\').value = pinDalLink; abbina(pinDalLink); }',
    '  else if (token) avvio();',
    '  else mostra(\'abbina\');',
    '})();',
    '</script>',
    '</body>',
    '</html>'
  ];
  var TELEFONO_ICONA = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAMAAAAKE/YAAAADAFBMVEUXGR8dHyYbHSQTFRoVFx0ZGyERExgWGB4YGiD09fceISgQERYaHCMUFhsdICcREhcSFBkcHiUPEBUfIikaHCIUFhwZGyIVFxweICcaHSMQEhcUFRsZHCIVFhwgIyoODxQSExgcHyYOEBQbHiQYGyETFBoWGB0WFx0YGiEgIioPERUfISkTFRsbHSMhJCwNDhINDhMhJCsgIysODxMLDBAcHyUSExkywr0fISgtjL8PERYXGB4XGiAsib8zxb0iJS0shr8xuL4ul74NDxMhIysiJCwxtr4yvL4MDRIyw70ti78tjr8ywL0vo74wq74tir8yxL0vqL4zyL0tkL8yvr0unL4QEhYeICgxsr4vob4zxr0siL8xur4ulL4tjb8ywb0bHiUzx70sh78umb4TFBkvn74wsb4vnr4wr74tj78yv70wrL4vpL4fIiotkr4tkb4yvb4tk74xub4ulb4zyb0xs74umL4um74umr4wrb4xtL4wrr4vpb4vpr4wqb4XJjEZKzcdMDYbKTAshL4WIizw8fMeNjsjJi7k5ecYISkjJS0bJSsbOkwupKAzNTovranq6+2ztbhqa3Aup7chWHIiW4EjV10xvbpQUlgfREwiUlYjYHQfTmYlaWoaNEQkZ40dRFkrjp4sirwfQEQXHyYoKjBvcHUkZYAiXmotl60jYILu7/EmcHUqioYVHiYcOEEoeaIrkaYpfqoqhLMwtbKwsbXz9PaGh4vGx8rJys0tlLYof4goc6AUHCMoe3gmbJctnZxERUorjo1kZWotLzSdn6KkpakwsrolbHAhSlAlbYcrhrclaXUupaseSmEphIMtnbExv7UslpQoeakZLz8TGB8phZmAgYW2uLsneIwriaoUGiIhVmYpg58tmbnX2dskX2IofoMfT28mdIRJTFA4OkCgoqUdQlIwuLUqfbUSFhwqgqYphIsncpkfOj8ws6wofpBaW2AskrssnaLa294qiYoyxrvMzc+MjZG7vL8fTW8wsbyNj5KMjpIriLAunr25tvnOAAAACXBIWXMAAAsTAAALEwEAmpwYAAANNElEQVR42tXcaXgURRoH8Frjkh0ukYVVIKArgXUFFl1BYFkQEAUFPEB2CYIGWQSFVeQSVDJHktkMM0mAXOQ+IQcJObkJhJsAObjCfd+nHOKusvs8W909E7q6eqqqp/tLvR+TL79nnp6uqvf914B/CbVo0euN9aZQf5LqFaGGDh36Z1idpPojrH/+1lPdunXr27epp/7+rFAtpfqVu34Pq3fvpz0V3BnWE+7q0aMdrOZitREqICDgd7B+7a7AwBdf/M3j+itwF49mwKMZ8GgGPJoBj2bAoxlwaO4PODT7Aw7NjWiezB40V2Y3mi+zhObMLKJ5Mwto7swQzZ/ZH3BoltCcmUU0b+augEMzRPNn/gPg0OxBc2V+EnBoltCcmUU0b2YBzZ0ZovkzPwk4NEtozswi2khz0ztJqXUHqyKjKxISKqIjqw6eT02yBxtrfgYYaLafK4ru8/bbffr0+eSTkSNHfvHFhx/OnDlz2LBhs2rq4q3GmSHaGLMzvuiHgQPff1/NPGzChAmzZtWcT3IaY34GGGFumVh3YPxAsnnw4Lfe2n2rurMBZgGt12zf/MOk8SxmWN/WFFp1mzsCvWZ73U+T2M2w5m606zR3BPrMd4p+Gq3N/O3cuY9uFesyi2ifzdZtk0ZrN48bN27aRpsOc1vgu7lp6oHRvpk/+2xaTF47n80Q7as5O3KO72ZYpdm+mtsCH81NN4/WZ5723YL9zX0ze9BazdbIOXrN3y1YkGnxyexGazUnHTDCPH16TLUv5hbAB3PLzXOMMU9/N2R/oHaziNZoblpEMic8eFgYn33H6gwOdlrt2fF7bj3Y7dX8bkjIxQDNZgGt0ew86NWcULU5yYnvnx2Je7Y98mIOCWlwaDVDtEazLdKbOTLVJt/zr1gh34s64zMfqZpDPsh0ajS3ABrN1mh187VCO3pO2bp45VZ0/2zfH6Nm/mBhqVObWURreTbUP+eKPTbF2Wr5WZPpxx2K/bMjr17FvHBhQ44mcweg7Tuo+jxfS3Uqz4NPHzPB+rm3cs/vyIvBzQsX3g3QYoZoLe861ffGNit+hl1rEmstfk6xXcTN339/EWgwdwBa1hS193N0tcq5e1m4hF5zT+WckpiPmWfMSNZg7gC0rIMq5m02FXNUhMldEZdVzimO45h5RtBVdnN3oGG/ga/dCanBKuZO602N9e9Oamer+BiFedSoehuzuRHNsK/D90gV2ao9mSsmWe1SPVsV1yvMQUENgaxmP8C8f96MmaPtvveRLKUKc1BQMqvZjWYwJ2L750irnt6XLVNhDppSzGiW0Cxnq2jMbNPXr3NkKsxTTgM2s4hmOcOmYs+GVW+P0ZaPmqdMOcVmFtBM527lGbbCrr8vaslHzVM2OJnMEM3U39imfNdlG9HLLQ5CzFOn7mUy+wEmc7ayv3HOmP7zKdQ8dayFxSygGXpf25TroFFZteOoeexeFnMXwGK+M16x37AZ1ed3lCLmsfMtDOYugKUvWqTY11UbN5twIeax3+QymCGabrYq+qIPjZynHEfM35wx081dAEPPfLNiz281cgZkPiM3z58fSzf/AzD0+RU981Rj51anEPPkE12p5laAPk+pVpwHncbO2nLy5ebJk9OoZg+aNAMqQs/de4yeD+Yh5nm5VLMbTZxboTOgazajZ5o5G+TmeRsqaWYJTZwPxqM9mULj57DJcvOQIVdpZhFNnmnWoX0kO4N5x4pd6yPCwyPW71qxg6GXa0HMQ3JpZgFNmcOiM80qunnZkvDHp63wJcvovdzTcvPsmzQzRNNmx2iP8RzNfPmYSVFLomh90RS5efZsM8XcCtBm9OfQvqiNYl662ITV4u2UvmjYZLl5dgbF3ArQcgVFSP+5imI+alKt/1L6oqfl5om5FPNrgJaFiEZ65oVk81qTl1pL7osmy80Tb1LMIpqY30CzENXkZ8PktbYT+6IuuXnifX+y+XlAycncQWcTTuJ3cLF39OIoUl+08r7M/PXXFrIZosnZniRkBhRJfNcdMxFqCbGXe1Nu/tJFNj8PKHmkPcjc6iHx/Wwi1iVSX3Sv3PxlCtnsQXvNUNUhs7ZCj7nvTnwdXEJGr8bNu571nFNi5eavcsnmJoCS+zqIzAfjPb3cdSZ87Q4no8OXY5+zaX2U+5ySITd/tYVsltCErFoVMtPMlsz3YP8Z2yOtMFFqKfZswP71PemckiY3j7lNNotoUr4uEpnD3hHITxxdAwnYvm4XDX0Fe56FWcF/+gv7Z4vcPKaEbBbQxExgNDI7tgpzK+klge1F19PQ67DvoPjnn5dDtFluHlNGNkM0OcdYgcy7bXA+eFYiYPvnCBo6AntvSH//cWvbtg65+fNysrkJoGQvE5AZfXDzxg0RtudfSUOvxN51nn+saHFEbv48i2xuRHvLiyYguQIUjZ5TGNDK97McLTOPyCKbPWivGdcKJAtha9PG83hgZyv644GtKZ7Ho0ULh9w8opxsfgpQcrnRSH5DCIwuXy2hledB+hcRWwel9f1NuBM1y80jyshmCU3IEkcimRO7sA62E1952BmW/srD+vziK6+rsOW3yM0fl5DNIpqUf65CcjLZ0jq4LKIR/fjcTV9csNkEfGSWSefBNLn549tks4AmZrYPItmeePc6CJdxrFdAX8ax2QRcxt1n2Ay5uV862QzR5Jx5HZJH2uNZB/tewfsbtA0TPk/Z2cNz7o6Vm/sVkM1PAUo2PhXJUN0i9WRoW1PSPCVdbu6XQjaLaFKePwnJfT0g9pGWsHzQ6j3zErn5HRfZ3B5Q7iDYkazabgep9xVFPG6RzJVZcvM7ZrIZosn3JoIHI/m6RGK/brtX85rtxFmbCzFn3SCb2wPaXY8aJBNYSO4xem0hHCXPB2Pl5vcOUcwQTbmfshHJMWZS+qJemjX/o8w0S+Tm9+Io5vaAdqcmHslePnJSernbVdtiFLNjhNw8IINi/hug3QOyonnRc7T+cxT2DlkdRZsd1yLmAWEUczNAvbtUg2RcM+k980ur5a3e1Zfo8+5NiPkQzexBE+5bnUdzuXaGPv/ypVfWRaxcGbHuytLlDLkCC2IeEEczu9GkO2JJaJZ4v657E6ozoFjE/JGLZpbQxHttzt1I/jnGabS5ch9iLj9CM4toyl2882hmO89gs98FxPxRHNUsoGn3BxPRzHaMw1jzyXLE/Gka1QzR1DuPzWvQnHmeoWa/FNR8qAvV3Aww3NMsRLPxMTYjzWH7EPOnF+jmZoDhbqlVkY3faKDZLx01h4bRzX8BLPdhzyvy/InGmdNQ86A4BrOApueRrI/QOwj5DqPMq8pQc6iZwfwSYLp3vFFxB+FuoDHmFumoeVABi/klwJT7sk9T3Js4ZYjZr1ZhDrWwmBvRlHn3RsW9iZhiI8yHs1Cz8EQzmFsDtmyPLUZx16Peqt9sLleYr69iMrvR9PxGnvKuR75Nr9lRpjAPymAzS2iGzEm7UuX9lEyHPvOqEqV5kx+bWUQz5WSKFyjvp5Ta9JjDNinNoYcZzQKaMduzH7ufkm/R8Txjz8agC6xmiGbNIzXPxO7U1BermnfKT4g71d8b5Zh5S3dWc2vAnqGy1WN3aoLygMrn3Hmd7MpIZ7U1pTYLM18PYzZDNHvuKzEEu1Mz6rhD5dnY8fhyTpSKuVK5DgoPtIvd3Bpoyartx8yjgkpdKs9z4zWoZSpmV5mK+RcN5heAlnxd4EXMDOu4Df8Oei6cqeyfC/qpmONaaTALaA2ZwIC7uDloyplTOcr3Rn+xZXOsv9JcmbJPzZx+Q4sZojXlGHMacLNwbSLZoXjXvQInd2cXKc/dKYrzoNu85Ygm8wtAY/bSWapihlniDcmKOwiX4XVVRU8mFu0VNJo3VWozu9Ea8qLOBjWzkMs9nRImX1OWLkV6jLVo70v+OWs1Pwc0Z1xz7qqbhbzoidyrOfg6eDItdhPaF0We55NazSJaYy434KI3s5BjnH1zb2xGmsWc4++/ymw5nBGbXjIC6fMr3xs3NJsFtPbfrE4O8mqeh2TVkDmsqvmXVtrNEO1L/jmx3hjz9bQmPpifA75lts0NRpi3hPlkltA+5MwDk3WbQy90980son3Lxh8+rc+8iXnPrzS/CnzP8/vXbvDdfL3Wz2czROu4g+Dc66M5NI7x3K1qfhXo+40yy94z2s2h6Ww9GW9mAa3vd9XMyWe0mUPjmPp1BPMbQP9vwZljT7CbD11g6eWSzW8AI36/rmta7gYW874CV/fX9JtFtP7fguvY8eTV3BNk86E4F31uxWR+GRhjFvd15ozcm/fVzFmHCjKos2N2M0QbZha3ov4WV0rBltslZeVZWeVlJbe3FKS4zLT8hkbzy8BYM+WuhzHmRjRPZg+aK3NPwKFZQnNmFtG8mQU0d2aI5s/cE3Bohmj+zD0Bh2aI5s88HHBolqO5McvQ/JgfozkyN6J5MnvQXJndaL7MEpozs4jmzSyguTNDNH/m4YBD83DAoXk4j+ZePJp78WjuxaO5F4/mXjyae/0fr92xQR3SnZMAAAAASUVORK5CYII=';
  /* </telefono:generato> */
})();
