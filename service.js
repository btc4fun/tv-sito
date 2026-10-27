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
 *   POST /api/visti/cerca            "eri gia' a questo punto?" (le pagine, quando parte un video)
 *   GET  /api/visti                  Continua a guardare (la home)
 *   POST /api/visti/riprendi         { id, daCapo }  la home apre una scheda: la pagina riprende da sola
 *   POST /api/visti/togli|rinomina|visto|svuota   le modifiche dalla home
 *   GET  /api/adblock?host=          liste di filtri pronte per quel sito (lette da main.js)
 *   GET  /api/adblock/ver            versione delle liste
 *   GET  /api/adblock/stato          stato delle liste (per le impostazioni della home)
 *   POST /api/adblock/aggiorna       scarica di nuovo le liste
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
      return { suTv: /Tizen|SMART-TV|SmartTV/i.test(s), tizen: tizen, chromium: chromium };
    }
    // siamo sul TV? Lo dice lo user agent; ma TizenBrew permette di cambiarlo (sue impostazioni, User Agent): allora
    // vale anche l'oggetto tizen nella pagina, o l'averlo gia' visto dal servizio del TV che risponde (ricordato)
    function suTv(w, ricordato) {
      return daUserAgent(w.navigator.userAgent).suTv || typeof w.tizen !== 'undefined' || !!ricordato;
    }
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
    function chromiumPagina(f) {
      var p = f.pagina || {};
      return p.chromium || (p.ua ? daUserAgent(p.ua).chromium : 0);
    }

    function haServizio(f) {
      if (f.servizio) return r(true, 'Il servizio del TV risponde');
      if (f.nonAutorizzata) {
        return r(false, 'Il servizio del TV non riconosce questa pagina',
          'In TizenBrew aggiungi il modulo tuonome/tv-sito (tuonome = il tuo nome su GitHub)', true);
      }
      var c = chromiumPagina(f);
      if (c && c < CHROMIUM_LOCALE) {
        return r(false, 'Su questo TV (motore web ' + c + ') la home non pu\u00f2 parlare con il servizio del TV',
          'Funzionano il tuo sito e il browser; le app del TV, il telefono e la riaccensione no. Serve un TV del 2018 o pi\u00f9 nuovo. ' +
          'Se il TV \u00e8 pi\u00f9 nuovo: chiudi TizenBrew e riaprilo', true);
      }
      return r(false, 'Il servizio del TV non risponde',
        'Chiudi TizenBrew e riaprilo. Se continua: nelle impostazioni di TizenBrew (pulsanti tondi in alto) controlla l\'autoavvio e che Host PC IP sia 127.0.0.1; ' +
        'se TizenBrew \u00e8 vecchio, aggiornalo');
    }
    function haAppTv(f) {
      if (!f.servizio) return r(null, 'Non si sa (servizio del TV non raggiungibile)');
      if (!f.tizen) return r(false, 'Il servizio non vede le app del TV', 'Riapri TizenBrew; se continua aggiorna TizenBrew');
      if (f.appTv && f.appTv.errore) return r(false, 'Elenco delle app non letto: ' + f.appTv.errore, 'Riapri TizenBrew');
      return r(true, 'Collegate' + (f.appTv && f.appTv.n ? ' (' + f.appTv.n + ' app)' : ''));
    }
    function haRiaccensione(f) {
      if (!f.servizio) return r(null, 'Non si sa (servizio del TV non raggiungibile)');
      if (f.apriAllAccensione === false) return r(false, 'Spenta nelle impostazioni');
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
        'Senza tasti colorati: nella home OK tenuto premuto e l\'ingranaggio in alto; nei siti OK tenuto premuto apre il menu rapido (il Blu). ' +
        'Sui telecomandi SolarCell i colori compaiono premendo 123');
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
        'Aggiorna TizenBrew; la home tiene comunque una sua copia delle impostazioni');
    }
    function haCasa(f) {
      if (!f.servizio || f.casa === undefined) return r(null, '');
      if (f.casa) return r(true, 'S\u00ec');
      return r(false, 'Il servizio non trova la home tra i moduli di TizenBrew', 'In TizenBrew il modulo deve essere tuonome/tv-sito');
    }
    // versione di Tizen e TizenBrew: solo per dire cosa fare, mai per spegnere una funzione
    function haTizenSupportato(f) {
      var t = numero(f.tizenVer || daUserAgent((f.pagina || {}).ua).tizen);
      if (!t) return r(null, 'Versione di Tizen non letta');
      if (t < TIZEN_MINIMO) return r(false, 'Tizen ' + t.toFixed(1) + ': TizenBrew funziona da Tizen 3.0 (TV del 2017 o pi\u00f9 nuovi)',
        'Su questo TV TizenBrew e Home TV non si possono usare');
      if (t >= 8) return r(true, 'Tizen ' + t.toFixed(1) + ' (sui TV nuovi TizenBrew va tenuto aggiornato)');
      return r(true, 'Tizen ' + t.toFixed(1));
    }

    // riassunto per "Questo TV" (impostazioni) e per l'autodiagnosi all'avvio: le voci in ordine, con lo stato
    var VOCI = [
      ['servizio', 'Servizio del TV', haServizio], ['tizen', 'Sistema', haTizenSupportato], ['casa', 'Home riconosciuta', haCasa],
      ['app', 'App del TV', haAppTv], ['riaccensione', 'Riapertura della home', haRiaccensione],
      ['telefono', 'Telefono (porta 8091)', haPortaTelefono], ['tastiVeri', 'Comando completo dal telefono', haTastiVeri],
      ['colori', 'Tasti colorati', haTastiColorati], ['liste', 'Liste di filtri', haListe], ['salvataggio', 'Salvataggio', haSalvataggio]
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
      var ua = daUserAgent((f.pagina || {}).ua);
      var anno = annoDaPiattaforma(f.modelloPiattaforma) || annoDaModello(f.modello) || 0;
      var tizen = f.tizenVer || ua.tizen || (perAnno(anno) ? perAnno(anno).tizen : '');
      var chromium = chromiumPagina(f) || (perTizen(tizen) ? perTizen(tizen).chromium : 0);
      var d = diagnosi(f), capacita = {}; // true = c'e', false = manca, null = non si sa ancora
      for (var i = 0; i < d.length; i++) capacita[d[i].id] = d[i].stato === 'ok' ? true : d[i].stato === 'manca' ? false : null;
      return {
        nome: f.nome || '', modello: f.modello || '', anno: anno, tizen: tizen, chromium: chromium,
        risoluzione: f.risoluzione || ((f.pagina || {}).larghezza ? f.pagina.larghezza + 'x' + f.pagina.altezza : ''),
        tizenbrew: f.tizenbrew || '', servizio: f.versioneServizio || '', capacita: capacita, diagnosi: d
      };
    }

    return {
      ANNI: ANNI, OK_TENUTO_MS: OK_TENUTO_MS, annoDaModello: annoDaModello, annoDaPiattaforma: annoDaPiattaforma,
      daUserAgent: daUserAgent, perTizen: perTizen, perAnno: perAnno, tizenbrewPerAnno: tizenbrewPerAnno,
      serveCertificato: serveCertificato, suTv: suTv, daChiedereAlServizio: daChiedereAlServizio,
      motore: motore, ripara: ripara, selettore: selettore, variabiliCss: variabiliCss, scorriPagina: scorriPagina, mostra: mostra,
      haServizio: haServizio, haAppTv: haAppTv, haRiaccensione: haRiaccensione, haTastiVeri: haTastiVeri, haPortaTelefono: haPortaTelefono,
      haTastiColorati: haTastiColorati, riapriDopoSonno: riapriDopoSonno, haListe: haListe, haSalvataggio: haSalvataggio, haCasa: haCasa, haTizenSupportato: haTizenSupportato,
      diagnosi: diagnosi, componi: componi
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
  var VERSION = '1.0.0';
  var HAS_TIZEN = typeof tizen !== 'undefined' && !!tizen && !!tizen.application;

  var SHARE = '/home/owner/share';
  var CACHE_DIR = fs.existsSync(SHARE) ? SHARE : require('os').tmpdir();
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
  var ICON_TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif'
  };

  // Dov'e' la tua home? Lo si legge dall'elenco dei moduli di TizenBrew
  // (il modulo GitHub "tuonome/tv-sito" -> https://tuonome.github.io/tv-sito/),
  // cosi' il nome utente non va scritto a mano in nessun file.
  var PROVE = typeof HOMETV_PROVE !== 'undefined' && HOMETV_PROVE === true; // solo nelle prove sul computer
  var FILE_TIZENBREW = typeof HOMETV_PROVE_TIZENBREW === 'string' ? HOMETV_PROVE_TIZENBREW : '/home/owner/share/tizenbrewConfig.json';
  var casa = { origin: '', base: '', letto: 0, utenti: [] };

  function trovaCasa() {
    if (PROVE && typeof HOMETV_PROVE_CASA === 'string') { // prove sul computer: home su localhost
      casa.base = HOMETV_PROVE_CASA;
      casa.origin = HOMETV_PROVE_CASA.replace(/^(https?:\/\/[^\/]+).*$/, '$1').toLowerCase();
      return casa;
    }
    // il file di TizenBrew si rilegge ogni minuto (ogni 5 secondi se la home non si e' ancora trovata), non a ogni richiesta
    if (Date.now() - casa.letto < (casa.origin ? 60000 : 5000)) return casa;
    casa.letto = Date.now();
    var conf = leggiJson(FILE_TIZENBREW, null);
    var moduli = conf && Array.isArray(conf.modules) ? conf.modules : [];
    var gh = [];
    for (var i = 0; i < moduli.length; i++) {
      var m = /^gh\/([A-Za-z0-9\-]+)\/([A-Za-z0-9._\-]+?)(@[^\/]*)?$/.exec(String(moduli[i]).trim());
      if (m) gh.push({ utente: m[1], repo: m[2] });
    }
    casa.utenti = gh.map(function (g) { return 'https://' + g.utente.toLowerCase() + '.github.io'; });
    var scelto = null;
    for (var j = 0; j < gh.length; j++) if (gh[j].repo.toLowerCase() === 'tv-sito') { scelto = gh[j]; break; }
    if (!scelto && gh.length === 1) scelto = gh[0];
    if (scelto) {
      casa.origin = 'https://' + scelto.utente.toLowerCase() + '.github.io';
      casa.base = casa.origin + '/' + scelto.repo + '/';
    }
    return casa;
  }

  // Pagine che possono comandare il servizio: solo la tua home. Gli altri
  // siti possono solo leggere le impostazioni per i siti e registrare visite
  // e preferiti. Se tra i moduli la home non si riconosce: le pagine degli utenti
  // GitHub dei moduli installati; se il file di TizenBrew non si legge proprio
  // (spostato da un aggiornamento), qualsiasi pagina github.io, come prima:
  // meglio una home che funziona.
  function originFidata(origin) {
    if (!origin) return false;
    var o = String(origin).toLowerCase();
    var c = trovaCasa();
    if (c.origin) { if (o === c.origin) return true; }
    else if (c.utenti.length) { if (c.utenti.indexOf(o) !== -1) return true; }
    else if (/^https:\/\/[a-z0-9\-]+\.github\.io$/.test(o)) return true;
    return PROVE && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  }
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

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      var size = 0;
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > 64 * 1024) { reject(new Error('richiesta troppo grande')); req.destroy(); return; }
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
    if (intentoContinua && Date.now() < intentoContinua.scade) {
      out.continua = { url: intentoContinua.url, posizione: intentoContinua.posizione, fresco: Date.now() - intentoContinua.creato < 30000,
        riproduci: !!intentoContinua.riproduci };
    }
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

    if (!HOST_OK.test(String(req.headers.host || ''))) {
      sendJson(req, res, 403, { error: 'indirizzo non autorizzato' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers(req, 'text/plain', null, true));
      res.end();
      return;
    }
    var fidata = !origin || originFidata(origin);
    if (!aperta && !fidata) {
      // leggibile dalla pagina, cosi' la home puo' spiegare cosa non va
      sendJson(req, res, 403, { error: 'pagina non autorizzata' }, true);
      return;
    }

    if (route === 'GET /api/icon') { serveIcon(req, res, url.query.path); return; }

    if (route === 'GET /api/status') {
      sendJson(req, res, 200, { ok: true, version: VERSION, tizen: HAS_TIZEN, apps: cache.apps ? cache.apps.length : 0, casa: trovaCasa().base });
      return;
    }
    // profilo del TV (impostazioni "Questo TV" e autodiagnosi della home)
    if (route === 'GET /api/tv') { sendJson(req, res, 200, profiloTv()); return; }
    if (route === 'POST /api/tv/pagina') {
      readBody(req).then(function (body) { salvaPagina(body || {}); sendJson(req, res, 200, profiloTv()); })['catch'](fail(req, res));
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
    if (route === 'POST /api/adblock/aggiorna') {
      adbAggiorna(true);
      sendJson(req, res, 200, statoAdblock());
      return;
    }
    if (route === 'GET /api/telefono/eventi') { attendiEventi(req, res, url.query); return; }
    if (route === 'POST /api/visti/cerca') {
      readBody(req).then(function (body) {
        sendJson(req, res, 200, cercaVisto(body), true);
      })['catch'](fail(req, res, 400, true));
      return;
    }
    if (route === 'GET /api/visti') { sendJson(req, res, 200, { visti: vistiPerHome(), totale: visti.length }); return; }
    if (route === 'POST /api/visti/riprendi' || route === 'POST /api/visti/togli' || route === 'POST /api/visti/rinomina' ||
      route === 'POST /api/visti/visto' || route === 'POST /api/visti/svuota') {
      readBody(req).then(function (body) {
        sendJson(req, res, 200, cambiaVisti(route.slice(16), body || {}));
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
    volSu: 'KEY_VOLUP', volGiu: 'KEY_VOLDOWN', muto: 'KEY_MUTE', spegni: 'KEY_POWER', sorgente: 'KEY_SOURCE', homeTv: 'KEY_HOME'
  };

  var remoto = leggiJson(FILE_REMOTO, {});
  if (!remoto || typeof remoto !== 'object') remoto = {};
  // stato: 'mai' (mai provato), 'attesa' (il TV sta chiedendo il permesso), 'ok', 'negato', 'assente'
  var rem = { stato: remoto.stato === 'ok' || remoto.stato === 'negato' ? remoto.stato : 'mai', token: remoto.token || '',
    sock: null, pronto: false, coda: [], tentativo: 0, ultimoErrore: '', indicePorta: 0, buffer: null, frammenti: null };

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
  var MAX_TELEFONI = 6;

  var tel = {
    attivo: false, errore: '',
    codice: '', codiceScade: 0, codiceErrori: 0,
    eventi: [], seq: 0,
    attese: [], ultimoAscolto: 0, dove: '',
    campo: null, ver: 1, attesaStato: [], video: null, ultimoLink: null, sotto: null
  };
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
  function statoPerTelefono() {
    return { ok: true, ascolta: inAscolto(), dove: tel.dove, tasti: rem.stato, campo: campoAttivo(), video: videoAttuale(), sotto: sottoAttuale(),
      ver: tel.ver };
  }

  // Il video nel lettore TV, per il telefono (titolo, barra del tempo, pausa). Le pagine lo dicono
  // quando cambia qualcosa e ogni 15 secondi; il telefono fa scorrere il tempo da solo e si sveglia
  // solo quando cambia qualcosa che si vede (pausa, titolo, un salto), non a ogni secondo.
  var VIDEO_SCADE = 45000, videoScade = null;
  function posizioneVideo(v) { return v.posizione + (v.inPausa ? 0 : (Date.now() - v.at) / 1000); }
  function cambiaVideo(body) {
    if (!body || typeof body !== 'object') return;
    if (body.pagina && (body.attivo === true || body.memo === true)) { try { registraVisto(body); } catch (e) { log('continua a guardare: ' + e.message); } }
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
   * Il TV ricorda cosa guardi nei siti (film, puntate delle serie) per riprendere da dove eri, anche
   * cambiando sito: una scheda per film o per serie (l'ultima puntata), la home ne mostra al massimo 10.
   * La stessa opera si riconosce dal nome (ripulito da nome del sito, "HD", "4K", accenti,
   * articoli), da stagione e puntata e dalla durata. Le regole, per non sbagliare mai:
   *  - si riprende da soli solo lo stesso video (stessa pagina e stessa durata) o una scheda scelta
   *    nella home; su un altro sito si propone e basta ("Eri a 22:15 su ...: OK per riprendere");
   *  - nel dubbio non si unisce e non si propone niente: meglio una scheda in piu' che una sbagliata;
   *  - un video si ricorda dopo un minuto che lo guardi, e solo se dura almeno 5 minuti (non trailer).
   */
  var FILE_VISTI = pathLib.join(CACHE_DIR, 'hometv-visti.json');
  var MAX_SCHEDE = 10, MAX_VISTI = 30, MIN_DURATA = 300, MIN_VISTO = 60;
  var visti = leggiJson(FILE_VISTI, []);
  if (!Array.isArray(visti)) visti = [];
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
  // stagione e puntata: S01E05, 1x05, Stagione 1 Episodio 5, Season 1 Episode 5, Stag. 1 Ep. 5...
  var RE_SE = [
    /\bs(\d{1,2})\s{0,3}[ .:\-_]?\s{0,3}e(?:p\.?)?\s{0,3}(\d{1,4})\b/i,
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
      prossimo: urlValido(p.prossimo) ? p.prossimo : '',
      ld: { nome: testo(ld.nome, 200), serie: testo(ld.serie, 200), episodio: n(ld.episodio), stagione: n(ld.stagione), anno: n(ld.anno) } };
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
    }
    for (i = 0; i < visti.length; i++) if (stessaOpera(visti[i], id)) return visti[i];
    return null;
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
    // stessa puntata di prima (anche su un altro sito): vale la puntata dopo saputa prima
    var stessaDiPrima = !!e.url && id.episodio != null && e.episodio === id.episodio && stessaStagione(e, id);
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
    // la puntata dopo (solo per le serie): se questa volta il sito non la mostra, vale quella saputa prima
    var prossimo = id.episodio != null && p.prossimo && urlNorm(p.prossimo) !== urlNorm(p.url) ? p.prossimo : '';
    if (prossimo || !stessaDiPrima) { e.prossimo = prossimo; e.prossimoSito = prossimo ? nomeSito(p) : ''; }
    if (visti.length > MAX_VISTI) visti.length = MAX_VISTI;
    scriviJson(FILE_VISTI, visti);
  }
  // quando parte un video: riprendere? (stesso video: da solo; stessa opera altrove: si propone)
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
      if (urlNorm(e.url) === u && stessoVideoDi(e, p) && Math.abs((e.durata || 0) - dur) <= 2 &&
        (id.episodio == null || (e.episodio === id.episodio && stessaStagione(e, id)))) {
        out.stesso = { posizione: e.posizione };
        return out;
      }
      if (id.episodio != null ? stessaPuntata(e, id) : stessaOpera(e, id)) buoni.push(e);
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
    if (hostLink(it.url).replace(/^www\./, '') !== hostLink(p.url).replace(/^www\./, '')) return false;
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
        immagine: e.immagine || '', posizione: e.posizione, durata: e.durata, url: e.url, quando: e.quando, rinominato: !!e.titoloMio };
      if (e.finito) {
        if (!e.prossimo) continue;
        // puntata finita: la scheda propone la prossima
        s.url = e.prossimo;
        s.posizione = 0;
        s.prossima = true;
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
    if (azione === 'svuota') { visti = []; intentoContinua = null; scriviJson(FILE_VISTI, visti, true); return { ok: true }; }
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
    scriviJson(FILE_VISTI, visti, true);
    return { ok: true };
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
  // link e "home" si eseguono una volta sola, anche se la pagina che li riceve poi cambia
  function consegna(lista) {
    for (var i = 0; i < lista.length; i++) {
      var tp = lista[i].tipo;
      if (tp === 'link' || tp === 'home' || tp === 'sito' || tp === 'puntatore') lista[i].consegnato = true;
    }
    return lista;
  }

  function rispondiAttese() {
    var attese = tel.attese;
    tel.attese = [];
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
    var da = parseInt(query.da, 10);
    if (isNaN(da) || da < 0 || da > tel.seq) {
      // pagina appena aperta: riceve solo link e "home" ancora freschi. I movimenti del puntatore rimasti indietro non
      // sono suoi: chiusi, cosi' quelli che arrivano adesso non si sommano a un evento che nessuno ricevera'
      for (var pi = 0; pi < tel.eventi.length; pi++) if (tel.eventi[pi].tipo === 'puntatore') tel.eventi[pi].consegnato = true;
      var freschi = eventiDopo(0).filter(function (e) { return (e.tipo === 'link' || e.tipo === 'home' || e.tipo === 'sito') && !e.consegnato; });
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
    if (!HAS_TIZEN) return;
    launchApp(tizenBrewAppId())['catch'](function (e) { log('home non aperta (' + motivo + '): ' + e.message); });
  }

  // Un tasto dal telefono: se l'ingresso del TV e' collegato e' un tasto vero
  // (arriva dove c'e' il fuoco, anche in Netflix o nei menu Samsung); se no va
  // alle pagine della home. Il primo tasto dopo una pausa parte subito dalle
  // pagine, mentre l'ingresso del TV si ricollega.
  function comandoDalTelefono(body) {
    var tipo = body.tipo;
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
      intentoContinua = { url: body.url, posizione: 0, id: '', durata: 0, video: '', prossima: false, riproduci: true,
        creato: Date.now(), scade: Date.now() + 120000 };
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
    if (route === 'GET /tv') { rispondiTel(res, 200, profiloTv()); return; }
    if (route === 'GET /stato') {
      if (!telefonoValido(u.query.t)) { rispondiTel(res, 401, { error: 'non collegato' }); return; }
      // con ?v= il telefono aspetta che cambi qualcosa (pagina, campo dove si scrive): lo sa subito
      if (u.query.v && parseInt(u.query.v, 10) === tel.ver) { attendiStato(req, res); return; }
      rispondiTel(res, 200, statoPerTelefono());
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
        rispondiTel(res, 200, { ok: true, ascolta: ascoltava, dove: tel.dove, tasti: rem.stato });
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
    return {
      servizio: true, versioneServizio: VERSION, tizen: HAS_TIZEN,
      appTv: { n: cache.apps ? cache.apps.length : 0, errore: cache.errore || '' },
      nome: String(d.name || ''), modello: String(d.modelName || ''), modelloPiattaforma: String(d.model || ''),
      tizenVer: versioneTizen(), tizenbrew: versioneTizenBrew(), risoluzione: String(d.resolution || ''),
      api8001: !!tvDalTv.device, statoAccensione: !!d.PowerState, apriAllAccensione: settings.apriAllAccensione !== false,
      remoto: rem.stato, telefono: { attivo: tel.attivo, errore: tel.errore },
      liste: { stato: D ? 'ok' : adb.stato === 'errore' ? 'errore' : 'mai', regole: D && D.conta ? D.conta.usate : 0 },
      // nelle prove e nella TV sul Mac i file restano (/tmp delle prove, cartella dei dati): valgono come quelli del TV
      salvataggio: (CACHE_DIR === SHARE || PROVE) && tvDalTv.scrittura ? 'tv' : 'temporaneo', casa: !!trovaCasa().origin,
      coloriVisti: tvDalTv.coloriVisti, pagina: tvDalTv.pagina
    };
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
    }
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
    '  .foglio { position: fixed; left: 0; right: 0; z-index: 9; max-width: 460px; margin: 0 auto; background: #15171d;',
    '    border: 1px solid var(--line); transition: transform .3s cubic-bezier(.2,.8,.2,1); }',
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
    '  .bilanciere { display: grid; grid-template-columns: 1fr 1fr 1fr; height: 54px; border-radius: 16px; overflow: hidden;',
    '    background: var(--surface-2); border: 1px solid var(--line); }',
    '  .bilanciere button { display: flex; align-items: center; justify-content: center; transition: background-color .08s ease; }',
    '  .bilanciere button + button { border-left: 1px solid var(--line); }',
    '  .bilanciere svg { width: 24px; height: 24px; fill: var(--text); }',
    '  .bilanciere .press { background: var(--surface-3); }',
    '  .coppia { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
    '  .pillola { height: 52px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line); display: flex; align-items: center;',
    '    justify-content: center; gap: 9px; font-size: 15px; font-weight: 600; transition: transform .08s ease, background-color .08s ease; }',
    '  .pillola svg { width: 20px; height: 20px; fill: var(--text); }',
    '  .pillola.press { background: var(--surface-3); transform: scale(.97); }',
    '  .colori { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }',
    '  .colori button { height: 46px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line);',
    '    display: flex; align-items: center; justify-content: center; transition: background-color .08s ease; }',
    '  .colori i { display: block; width: 20px; height: 20px; border-radius: 50%; }',
    '  .colori .press { background: var(--surface-3); }',
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
    '</div>',
    '',
    '<div id="velo" class="velo" hidden></div>',
    '',
    '<div id="foglio-altro" class="foglio giu" hidden role="dialog" aria-label="Altri tasti">',
    '  <div class="maniglia"></div>',
    '  <div class="gruppo">',
    '    <div class="etichetta">Volume</div>',
    '    <div class="bilanciere">',
    '      <button data-tasto="volGiu" aria-label="Volume gi&ugrave;"><svg viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3zm12.5 2h6v2h-6z"/></svg></button>',
    '      <button data-tasto="muto" aria-label="Muto"><svg viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3zm12.6.2L17 10.6l1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4-1.4-1.4z"/></svg></button>',
    '      <button data-tasto="volSu" aria-label="Volume su"><svg viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3zm14-1h2v3h3v2h-3v3h-2v-3h-3v-2h3z"/></svg></button>',
    '    </div>',
    '  </div>',
    '  <div class="gruppo">',
    '    <div class="etichetta">Avanti e indietro</div>',
    '    <div class="coppia">',
    '      <button class="pillola" data-tasto="indietroVeloce"><svg viewBox="0 0 24 24"><path d="M11 6v12l-8-6zm9 0v12l-8-6z"/></svg>&minus;30 s</button>',
    '      <button class="pillola" data-tasto="avanti">+30 s<svg viewBox="0 0 24 24"><path d="M13 6v12l8-6zM4 6v12l8-6z"/></svg></button>',
    '    </div>',
    '  </div>',
    '  <div class="gruppo">',
    '    <div class="etichetta">Televisore</div>',
    '    <div class="coppia">',
    '      <button class="pillola chiude" data-tasto="blu"><svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>Menu</button>',
    '      <button class="pillola chiude" data-tasto="homeTv" aria-label="Home del TV (Samsung)"><svg viewBox="0 0 24 24"><path d="M3 5h18v11H3zm2 2v7h14V7zm4 11h6v2H9z"/></svg>Home del TV</button>',
    '    </div>',
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
    '    if (DEMO) return Promise.resolve({ ok: true, ascolta: true, dove: \'Anteprima\', t: \'demo\' });',
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
    '  var SENZA_PERMESSO = \'Per volume, spegnimento e Home TV serve il permesso sul TV: tasto Blu \\u2192 Telefono \\u2192 Tasti del TV.\';',
    '  function invia(corpo) {',
    '    corpo.t = token;',
    '    return api(\'/comando\', corpo).then(function (j) {',
    '      if (j.__stato === 401) { perso(); return j; }',
    '      if (j.error === \'non-disponibile\') { avviso(SENZA_PERMESSO, 5000); return j; }',
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
    '  }',
    '',
    '  // pressione con ripetizione (frecce tenute premute)',
    '  function premibile(el) {',
    '    var ripeti = null, attesa = null;',
    '    var tasto = el.getAttribute(\'data-tasto\'), tipo = el.getAttribute(\'data-tipo\');',
    '    var freccia = /^(su|giu|sx|dx)$/.test(tasto || \'\');',
    '    function manda() { if (tipo) invia({ tipo: tipo }); else invia({ tipo: \'tasto\', tasto: tasto }); }',
    '    var ripetibile = freccia || tasto === \'volSu\' || tasto === \'volGiu\';',
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
