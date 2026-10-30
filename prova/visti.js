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
