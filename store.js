/*
 * Home TV - lo STORE (store.html): la vetrina delle app per Home TV, fatta come la home. In alto il titolo, lo stato del
 * catalogo e Cerca; l'app scelta in grande, con la sua icona da cui arriva la luce; sotto le file: In evidenza,
 * Aggiornamenti, Le tue app, una per categoria, Le mie app. OK apre la pagina dell'app (Installa / Apri / Aggiorna /
 * Disinstalla); l'app gira nel riquadro isolato.
 *
 * Leggero sui TV vecchi: le file si ridisegnano solo quando cambia quello che mostrano; le frecce spostano soltanto
 * (classi e transform, niente da ricostruire e niente letture della memoria); le icone si caricano solo vicino a dove
 * guardi; la luce si disegna in piccolo (192 x 108) e il TV la allarga, come nella home.
 *
 * Il riquadro e' un iframe con la sandbox senza "allow-same-origin": l'app ha un indirizzo anonimo, quindi non vede i
 * dati della home e il servizio del TV la rifiuta. I tasti li tiene sempre questa pagina e li passa all'app
 * (tv-app.js): Indietro esce sempre (l'app lo puo' usare al massimo 3 volte di fila), Verde torna alla home, Blu o OK
 * tenuto aprono il menu dell'app.
 * Questa pagina non scrive mai le scelte della home (tvh-prefs): solo le liste dello store (store-dati.js).
 *
 * Indirizzi: store.html | #app=<id> (la pagina dell'app) | #apri=<riquadro> (apre l'app) | #aggiungi | #fonti | #mie;
 * con &da=home, uscendo dall'app (o dalla pagina aperta con #app) si torna alla home.
 * Solo JavaScript ES5: il browser del TV e' datato.
 */
(function () {
  'use strict';

  // Aggiornamento a meta' (revisione "TV vecchi e aggiornamento", punto 1): come in home.js, se manca un pezzo che arriva da
  // un altro file (la cache di GitHub Pages puo' mescolare due versioni per qualche minuto) si dice cosa fare invece della
  // pagina nera. L'elenco: tutto quello che questo file usa degli altri (la prova test_aggiornamento.py controlla che ci sia)
  if (mancaUnPezzo('UI.$ UI.DEMO UI.ON_TV UI.SERVICE UI.ascoltaTelefono UI.guardiano UI.closeEditor UI.closeSheet UI.coloriApp UI.coloriImmagine ' +
    'UI.editorOpen UI.esc UI.fitScreen UI.hash UI.hostOf UI.load UI.onKeys UI.openEditor UI.openSheet UI.popKeys UI.pushKeys UI.rem ' +
    'UI.save UI.service UI.setTransform UI.sheetOpen UI.toast ProfiloTV.altraTv ProfiloTV.motore ProfiloTV.piattaforma StoreDati.TITOLI ' +
    'StoreDati.adatta StoreDati.azioneTelefono StoreDati.cercaApp StoreDati.datiApp StoreDati.imposta StoreDati.perRiquadro StoreDati.perTelefono ' +
    'StoreDati.perche StoreDati.scarica StoreDati.scriviDatiApp StoreDati.segnaVista StoreDati.servizio StoreDati.urlUfficiale ' +
    'StoreDati.mie.aggiornaTutte StoreDati.mie.aggiungi StoreDati.mie.app StoreDati.mie.cerca StoreDati.mie.fonti StoreDati.mie.normalizza ' +
    'StoreDati.mie.nuovaVersione StoreDati.mie.oltreIlLimite StoreDati.mie.spazio StoreDati.mie.togliApp StoreDati.mie.togliFonte ' +
    'StoreDati.ufficiale.aggiorna StoreDati.ufficiale.catalogo StoreDati.ufficiale.disinstalla StoreDati.ufficiale.installa ' +
    'StoreDati.ufficiale.installata StoreDati.ufficiale.installate StoreDati.ufficiale.nuovaVersione StoreDati.ufficiale.voce')) return;
  function mancaUnPezzo(elenco) {
    var l = elenco.split(' '), i, j, o, p;
    for (i = 0; i < l.length; i++) {
      for (p = l[i].split('.'), o = window, j = 0; j < p.length && o !== undefined && o !== null; j++) o = o[p[j]];
      if (o === undefined || o === null) {
        var d = document.createElement('div');
        d.id = 'aggiornamento';
        d.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483647;background:#0b0d12;color:#fff;' +
          'display:flex;align-items:center;justify-content:center;text-align:center;font:600 46px/1.4 sans-serif;padding:0 12%;box-sizing:border-box';
        var altra = false; // sulle altre TV (Android, LG) l'app si chiama Home TV: lo sa il profilo, se c'e'
        try { altra = ProfiloTV.altraTv({ piattaforma: ProfiloTV.piattaforma(window) }); } catch (e) {}
        d.textContent = 'Home TV si sta aggiornando: ' + (altra ? 'chiudi Home TV e riaprila' : 'esci da TizenBrew e riaprilo');
        (document.body || document.documentElement).appendChild(d);
        try { console.log('[HomeTV] manca ' + l[i] + ': file di due versioni (cache di GitHub Pages)'); } catch (e) {}
        return true;
      }
    }
    return false;
  }

  var $ = UI.$, DEMO = UI.DEMO;
  var Uff = StoreDati.ufficiale, Mie = StoreDati.mie, TITOLI = StoreDati.TITOLI;
  var ORDINE = ['film', 'video', 'sport', 'giochi', 'strumenti', 'altre'];
  var prefs = UI.load('tvh-prefs', {}) || {};
  if (prefs.tema) document.documentElement.setAttribute('data-tema', prefs.tema);
  UI.fitScreen();
  // sul TV i cataloghi dei siti che non li lasciano leggere (o con certificati che il TV non conosce) li scarica il servizio
  if (!DEMO) StoreDati.imposta({ servizio: function (u) { return UI.service('/api/store/scarica?url=' + encodeURIComponent(u)); } });

  function parametro(nome) {
    var m = new RegExp('[#&]' + nome + '=([^&]*)').exec(location.hash || '');
    try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
  }
  function ha(nome) { return new RegExp('[#&]' + nome + '(&|$)').test(location.hash || ''); }
  var DA_HOME = ha('da=home');
  function casa() { location.replace('./'); }
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function quando(t) {
    var d = new Date(t), oggi = new Date(), m = d.getMinutes(), ora = d.getHours() + ':' + (m < 10 ? '0' : '') + m;
    if (d.toDateString() === oggi.toDateString()) return 'oggi alle ' + ora;
    if (d.toDateString() === new Date(oggi.getTime() - 86400000).toDateString()) return 'ieri alle ' + ora;
    return d.getDate() + ' ' + MESI[d.getMonth()];
  }
  function primaFrase(t, max) {
    t = String(t || '');
    var p = t.indexOf('. ');
    if (p > 0 && p < max) t = t.slice(0, p);
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
  function pulito(t) { return String(t || '').replace(/^\s+|\s+$/g, ''); }
  // lo stesso sito della home, dal sito vero dell'indirizzo (store-dati.js rifiuta gia' "utente@" davanti)
  function stessoSito(u) {
    try { return new URL(u).host.toLowerCase() === location.host.toLowerCase(); } catch (e) { return false; }
  }
  // via il messaggio "Cerco..." quando arriva la risposta
  function tacci() { var t = $('toast'); if (t) t.className = ''; }

  // i colori sono quelli della home: la stessa app ha lo stesso colore nella home e nello Store (dal nome, come colorsFor
  // in home.js). Dal catalogo arrivano solo testi
  var PALETTE = [['59,76,202', '26,35,102'], ['142,63,184', '61,24,87'], ['15,155,142', '10,71,68'], ['217,98,43', '110,38,17'],
    ['86,96,107', '34,39,45'], ['47,158,90', '18,65,39'], ['194,59,78', '86,21,32'], ['43,123,191', '16,54,90']];
  var VIOLA = ['139,92,246', '59,31,122']; // lo Store, come il suo riquadro nella home
  function tinta(e) { return UI.hash(e.nome || '') % PALETTE.length; }
  // il colore vero di un'app dello Store: letto dalla sua copertina (o icona) e salvato in tvh-colors, come fa la home
  // con le app del TV (la stessa chiave della home: ws:<id>). tag = da quale immagine e versione: cambiano, si rilegge
  var COLORI = UI.load('tvh-colors', {}) || {};
  function tag(e) { return (e.voce.copertina || e.voce.icona || '') + '|' + (e.voce.versione || ''); }
  function coloreDi(e) {
    var c = e.tipo === 'ws' ? COLORI[e.chiave] : null;
    return c && c.a && c.b && c.tag === tag(e) ? [c.a, c.b] : PALETTE[tinta(e)];
  }
  function dim(rgb, f) { var p = rgb.split(','); return Math.round(p[0] * f) + ',' + Math.round(p[1] * f) + ',' + Math.round(p[2] * f); }
  // lo sfondo del riquadro, come cardBg in home.js
  function sfondo(c) { return 'linear-gradient(140deg, rgb(' + dim(c[0], 0.85) + ') 0%, rgb(' + dim(c[1], 0.85) + ') 100%)'; }

  var GLIFI = {
    aggiungi: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M22 10h4v12h12v4H26v12h-4V26H10v-4h12z"/></svg>',
    cerca: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M21 6a15 15 0 0 1 11.9 24.1l9.5 9.5-2.8 2.8-9.5-9.5A15 15 0 1 1 21 6zm0 4a11 11 0 1 0 0 22 11 11 0 0 0 0-22z"/></svg>',
    fonti: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M8 10h32v6H8zm0 11h32v6H8zm0 11h20v6H8z"/></svg>',
    riprova: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8a16 16 0 0 1 15.5 12h-4.2A12 12 0 1 0 36 28h4.1A16 16 0 1 1 24 8zm9 4h9v9z"/></svg>',
    store: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path fill-rule="evenodd" d="M17 16v-3a7 7 0 0 1 14 0v3h7.4l1.8 26H7.8l1.8-26zm3.5 0h7v-3a3.5 3.5 0 0 0-7 0z"/></svg>'
  };

  /* ============================================================ le file */

  // un elemento: { tipo: 'ws' | 'mia' | 'orfana' | 'azione', chiave, nome, voce, riquadro, nomeFonte, sotto, glifo, azione, eroe }
  // mosso: chi guarda ha gia' scelto qualcosa (se no, dopo l'arrivo del catalogo si torna all'inizio o alla fila chiesta)
  var file = [], ricerca = '', controllo = false, mosso = false, preferita = null;

  function elemWs(v) { return { tipo: 'ws', chiave: 'ws:' + v.id, voce: v, riquadro: 'ws:' + v.id, nome: v.nome }; }
  // sito: il sito vero della fonte (nome e autore li scrive chi fa il catalogo: potrebbero dire "Home TV")
  function elemMia(a) { return { tipo: 'mia', chiave: a.riquadro, voce: a.voce, riquadro: a.riquadro, nomeFonte: a.nomeFonte, sito: a.sito, nome: a.voce.nome }; }
  // eroe: cosa dice il titolo grande quando e' scelta, [sopra, titolo, sotto] (o una funzione che lo dice)
  function elemAzione(id, nome, sotto, glifo, fn, eroe) {
    return { tipo: 'azione', chiave: 'az:' + id, nome: nome, sotto: sotto, glifo: glifo, azione: fn, eroe: eroe };
  }
  // le app installate dallo Store; quelle tolte dallo store restano qui ("orfane"), per toglierle
  function installateOra(c) {
    var tue = [], arrivato = !!(c && c.scaricato);
    Uff.installate().forEach(function (x) {
      var v = Uff.voce(x.id);
      if (v) tue.push(elemWs(v));
      else if (arrivato) {
        tue.push({ tipo: 'orfana', chiave: 'ws:' + x.id, riquadro: 'ws:' + x.id, nome: x.nome || x.id,
          voce: { id: x.id, nome: x.nome || x.id, versione: '', descrizione: 'Quest\'app non è più nello Store: si può solo disinstallare.' } });
      }
    });
    return tue;
  }
  // tutto quello che si puo' cercare, una volta sola: le installate, quelle dello Store, le mie
  function cercabili(c, tue) {
    var tutte = [], viste = {};
    function metti(e) { if (!viste[e.chiave]) { viste[e.chiave] = 1; tutte.push(e); } }
    tue.forEach(metti);
    (c ? c.app : []).forEach(function (v) { if (!v.ritirata) metti(elemWs(v)); });
    Mie.app().forEach(function (a) { metti(elemMia(a)); });
    return tutte;
  }
  function trovaApp(domanda, elementi) {
    var voci = elementi.map(function (e, i) {
      var v = e.voce || {};
      return { nome: e.nome, descrizione: v.descrizione, autore: v.autore, categoria: v.categoria, i: i };
    });
    return StoreDati.cercaApp(domanda, voci).map(function (v) { return elementi[v.i]; });
  }

  function modello() {
    var out = [], c = Uff.catalogo(), app = c ? c.app : [], mie = Mie.app(), tue = installateOra(c);
    if (ricerca) {
      var trovate = trovaApp(ricerca, cercabili(c, tue)), q = '«' + ricerca + '»';
      out.push({ id: 'risultati', titolo: trovate.length ? (trovate.length === 1 ? '1 app' : trovate.length + ' app') + ' per ' + q : 'Nessuna app per ' + q,
        voci: trovate.concat([
          elemAzione('ancora', 'Cerca ancora', 'Un\'altra parola', 'cerca', chiediRicerca, trovate.length ?
            ['Cerca', 'Cerca ancora', 'Un nome, un tipo di app o un autore'] :
            ['Cerca', 'Nessuna app per ' + q, 'Prova con un\'altra parola, o con il tipo di app: giochi, film, strumenti']),
          elemAzione('tutte', 'Tutte le app', 'Torna allo Store', 'store', togliRicerca, ['Cerca', 'Tutte le app', 'Torna allo Store con tutte le file'])
        ]) });
      return out;
    }
    if (!(c && c.scaricato) && !controllo) {
      out.push({ id: 'riprova', titolo: 'Lo Store', voci: [elemAzione('riprova', 'Riprova', 'Scarica di nuovo lo Store', 'riprova', riprova, function () {
        var e = c ? c.esito : '';
        return ['Store', controllo ? 'Controllo lo Store…' : e === 'offline' ? 'Senza internet' : e === 'nonTrovato' ? 'Lo Store non c\'è ancora' :
          e === 'formatoNuovo' ? 'Aggiorna Home TV' : 'Lo Store ha un problema', testoStato() + (controllo ? '' : '. OK per riprovare')];
      })] });
    }
    // in evidenza solo le app che su questo TV vanno (le altre restano, spente, nella fila della loro categoria)
    var evidenza = app.filter(function (v) { return v.evidenza && !v.ritirata && StoreDati.adatta(v); });
    if (evidenza.length) out.push({ id: 'evidenza', titolo: 'In evidenza', voci: evidenza.map(elemWs) });
    var agg = tue.filter(function (e) { return e.tipo === 'ws' && Uff.nuovaVersione(e.voce.id); });
    mie.forEach(function (a) { if (Mie.nuovaVersione(a.fonte, a.voce.id)) agg.push(elemMia(a)); });
    if (agg.length) out.push({ id: 'aggiornamenti', titolo: 'Aggiornamenti', voci: agg });
    if (tue.length) out.push({ id: 'tue', titolo: 'Le tue app', voci: tue });
    ORDINE.forEach(function (cat) {
      var qui = app.filter(function (v) { return v.categoria === cat && !v.ritirata; });
      if (qui.length) out.push({ id: 'cat-' + cat, titolo: TITOLI[cat], voci: qui.map(elemWs) });
    });
    var nf = Mie.fonti().length, fonti = nf === 1 ? '1 fonte' : nf + ' fonti', mieVoci = mie.map(elemMia);
    mieVoci.push(elemAzione('aggiungi', 'Aggiungi', 'Un indirizzo qualsiasi', 'aggiungi', aggiungi,
      ['Le mie app', 'Aggiungi un\'app', 'Da GitHub (utente/repository) o da un indirizzo qualsiasi: resta solo su questo TV']));
    if (nf) mieVoci.push(elemAzione('fonti', 'Fonti private', fonti, 'fonti', fontiPrivate, ['Le mie app', 'Fonti private', fonti + ' su questo TV: aggiornale o toglile']));
    out.push({ id: 'mie', titolo: 'Le mie app', voci: mieVoci });
    return out;
  }

  // un'app che su questo TV non va, e perche' (StoreDati.perche): il motore web (non cambiera'), oppure il servizio del TV
  // che non ha ancora quello che l'app chiede (l'app Video dove chiavette e ponti non ci sono). Un servizio di prima: sui
  // Samsung il nuovo parte riavviando il TV; sulle altre TV arriva con l'installatore, quindi per chi guarda e' "non ancora"
  var SAMSUNG = ProfiloTV.piattaforma(window, UI.ON_TV) === 'tizen';
  function nonVa(perche, ins) {
    if (perche === 'vecchio' && SAMSUNG) return { breve: 'Riavvia il TV', chip: 'Riavvia il TV: Home TV si aggiorna', frase: 'riavvia il TV: Home TV si aggiorna', inst: ins, spenta: true };
    if (perche === 'servizio' || perche === 'vecchio') {
      return { breve: 'Non ancora su questo TV', chip: 'Su questo TV non funziona ancora', frase: 'su questo TV non funziona ancora', inst: ins, spenta: true };
    }
    return { breve: 'Non va su questo TV', chip: 'Non adatta a questo TV', frase: 'non va su questo TV', inst: ins, spenta: true };
  }
  // lo stato di un'app per i riquadri, il titolo grande e la sua pagina
  function stato(e) {
    if (e.tipo === 'orfana') return { breve: 'Non più disponibile', chip: 'Non più disponibile', inst: true, spenta: true };
    var v = e.voce;
    if (e.tipo === 'mia') {
      var p = StoreDati.perRiquadro(e.riquadro);
      if (!p) return { breve: '', chip: '' };
      if (p.stato === 'nonAdatta') return nonVa(p.perche);
      if (p.stato === 'ritirata') return { breve: 'Non più disponibile', chip: 'Non più disponibile', spenta: true };
      return p.nuova ? { breve: 'Versione nuova', chip: 'Aggiornamento pronto', nuova: true, apri: true } : { breve: 'Non verificata', chip: 'Non verificata', apri: true };
    }
    var ins = !!Uff.installata(v.id);
    if (v.ritirata) return { breve: 'Non più disponibile', chip: 'Non più disponibile', inst: ins, spenta: true };
    var no = StoreDati.perche(v);
    if (no) return nonVa(no, ins);
    if (ins) {
      return Uff.nuovaVersione(v.id) ? { breve: 'Versione nuova', chip: 'Aggiornamento pronto', nuova: true, apri: true, inst: true } :
        { breve: 'Installata', chip: 'Installata', apri: true, inst: true };
    }
    return { breve: TITOLI[v.categoria] || 'App', chip: 'Da installare', installa: true };
  }

  // l'icona: l'iniziale col colore della home, e sopra l'immagine (solo per le app dello Store: un'immagine da un sito
  // qualsiasi potrebbe essere enorme). pigra = l'immagine si carica solo quando il riquadro e' vicino; colore = e'
  // l'immagine da cui si legge il colore dell'app (quando non ha la copertina)
  function datiColore(e) { return ' data-ws="' + UI.esc(e.chiave) + '" data-tag="' + UI.esc(tag(e)) + '" data-colore="1"'; }
  function iconaHTML(e, pigra, colore) {
    var img = '';
    if (e.tipo === 'ws' && e.voce && e.voce.icona) {
      img = '<img class="app-ico-img" alt="" decoding="async"' + (colore ? datiColore(e) : '') + ' ' + (pigra ? 'data-src' : 'src') + '="' + UI.esc(e.voce.icona) + '">';
    }
    return '<b>' + UI.esc((e.nome || '?').charAt(0).toUpperCase()) + '</b>' + img;
  }
  function tileHTML(e, r, i, fila) {
    var inner, cls = 'card', stile = '';
    if (e.tipo === 'azione') {
      cls += e.glifo === 'aggiungi' || e.glifo === 'cerca' ? ' add' : ' store';
      inner = GLIFI[e.glifo] + '<div class="label">' + UI.esc(e.nome) + '<small>' + UI.esc(e.sotto || '') + '</small></div>';
    } else {
      var st = stato(e), v = e.voce, sotto = st.breve;
      // nella fila della sua categoria la categoria non serve: la prima frase della descrizione
      if (st.installa && fila.indexOf('cat-') === 0) sotto = primaFrase(v.descrizione, 60) || sotto;
      // la copertina (disegnata per il riquadro) copre icona e nome; l'icona serve solo se la copertina non arriva
      var cop = e.tipo === 'ws' && v.copertina && !st.spenta;
      cls += ' appweb' + (cop ? ' con-copertina' : '');
      stile = ' style="background:' + sfondo(coloreDi(e)) + '"';
      inner = '<span class="app-ico">' + iconaHTML(e, true, !cop) + '</span><div class="label">' + UI.esc(e.nome) + '<small>' + UI.esc(sotto) + '</small></div>' +
        (cop ? '<img class="copertina-img" alt="" decoding="async"' + datiColore(e) + ' data-src="' + UI.esc(v.copertina) + '">' : '') +
        // il pallino della versione nuova; fuori da "Le tue app", il segno delle installate
        (st.nuova ? '<i class="pallino"></i>' : st.inst && e.tipo === 'ws' && fila !== 'tue' ? '<i class="spunta"></i>' : '');
    }
    return '<div class="tile" data-r="' + r + '" data-i="' + i + '"><div class="lift"><div class="' + cls + '"' + stile + '>' + inner + '</div></div></div>';
  }

  /* ============================================================ disegno e selezione (come la home) */

  var rowsEl = $('rows'), cercaEl = $('cerca'), geo = {}, cur = null, offsets = [], ultimaPos = {}, htmlFatto = null;
  function misura() {
    var r = UI.rem();
    geo.rem = r; geo.rowH = 30 * r; geo.rowY = 52 * r; geo.step = 32 * r; geo.tileW = 28.8 * r; geo.view = window.innerWidth - 19.2 * r;
  }
  function rowEl(r) { return rowsEl.children[r]; }
  function trackEl(r) { var e = rowEl(r); return e ? e.children[1] : null; }
  function tileEl(r, i) { var t = trackEl(r); return t ? t.children[i] : null; }
  // dove sta un elemento: nella fila data (o in tutte); senza chiave, il primo della fila
  function posto(fila, chiave) {
    for (var a = 0; a < file.length; a++) {
      if (fila && file[a].id !== fila) continue;
      if (!chiave) return file[a].voci.length ? [a, 0] : null;
      for (var b = 0; b < file[a].voci.length; b++) if (file[a].voci[b].chiave === chiave) return [a, b];
    }
    return null;
  }

  // le file da capo solo se cambia quello che mostrano (catalogo, installazioni, ricerca): mai a ogni freccia
  function disegna(scegliFila) {
    var prima = cur && cur.area === 'rows' && file[cur.r] && file[cur.r].voci[cur.i] ?
      { fila: file[cur.r].id, chiave: file[cur.r].voci[cur.i].chiave, r: cur.r, i: cur.i } : null;
    if (scegliFila) { preferita = scegliFila; mosso = false; }
    file = modello();
    var html = '';
    for (var r = 0; r < file.length; r++) {
      html += '<section class="row" style="top:' + (r * 30) + 'rem"><div class="row-title">' + UI.esc(file[r].titolo) + '</div><div class="track">';
      for (var i = 0; i < file[r].voci.length; i++) html += tileHTML(file[r].voci[i], r, i, file[r].id);
      html += '</div></section>';
    }
    scriviStato();
    if (html === htmlFatto && cur) {
      // gli stessi riquadri: resta tutto com'e' (la selezione, le icone gia' caricate); si aggiorna solo il titolo
      if (!scegliFila) { titolo(true); return; }
    } else {
      rowsEl.innerHTML = html;
      htmlFatto = html;
      offsets = [];
      ultimaPos = {};
      if (cur && cur.area === 'rows') cur = null;
    }
    misura();
    if (cur && cur.area === 'top' && !scegliFila) { focusCerca(true); return; }
    var fila = scegliFila || (!mosso ? preferita : null), dove = fila ? posto(fila, null) : null;
    // si ritrova la stessa app (prima nella stessa fila, poi ovunque), se no lo stesso posto
    if (!dove && mosso && prima) {
      dove = posto(prima.fila, prima.chiave) || posto(null, prima.chiave);
      if (!dove) {
        var stessa = posto(prima.fila, null);
        dove = stessa ? [stessa[0], Math.min(prima.i, file[stessa[0]].voci.length - 1)] : [Math.min(prima.r, file.length - 1), 0];
      }
    }
    if (cur && cur.area === 'top') { cercaEl.classList.remove('f'); cur = null; }
    focus(dove ? dove[0] : 0, dove ? dove[1] : 0, true);
  }
  function trackOffset(r, i) {
    var n = file[r].voci.length, totale = n * geo.step - 3.2 * geo.rem;
    return Math.min(Math.max(0, (i - 1) * geo.step), Math.max(0, totale - geo.view));
  }
  function classiFile(attiva) {
    for (var r = 0; r < file.length; r++) {
      var e = rowEl(r);
      if (e) e.className = 'row' + (r < attiva ? ' past' : '') + (r === attiva ? ' active' : '');
    }
  }
  function togliScelta() { if (cur && cur.el) cur.el.classList.remove('f'); }
  function focus(r, i, subito) {
    if (!file[r] || !file[r].voci.length) return;
    i = Math.max(0, Math.min(file[r].voci.length - 1, i));
    var el = tileEl(r, i);
    if (!el || (cur && cur.el === el)) return;
    var nuovaFila = !cur || cur.area !== 'rows' || cur.r !== r;
    togliScelta();
    el.classList.add('f');
    cur = { area: 'rows', r: r, i: i, el: el };
    offsets[r] = trackOffset(r, i);
    UI.setTransform(trackEl(r), 'translate3d(' + (-offsets[r]) + 'px,0,0)');
    if (nuovaFila) {
      UI.setTransform(rowsEl, 'translate3d(0,' + (geo.rowY - r * geo.rowH) + 'px,0)');
      classiFile(r);
    }
    caricaIcone(r);
    titolo(subito);
  }
  function focusCerca(subito) {
    togliScelta();
    cercaEl.classList.add('f');
    cur = { area: 'top', r: 0, i: 0, el: cercaEl };
    if (file.length) { UI.setTransform(rowsEl, 'translate3d(0,' + geo.rowY + 'px,0)'); classiFile(0); }
    titolo(subito);
  }
  function xSchermo(r, i) { return i * geo.step - (offsets[r] || 0) + geo.tileW / 2; }
  function vicino(r, x) {
    var meglio = 0, d = Infinity;
    for (var i = 0; i < file[r].voci.length; i++) {
      var q = Math.abs(i * geo.step - trackOffset(r, i) + geo.tileW / 2 - x);
      if (q < d) { d = q; meglio = i; }
    }
    return meglio;
  }
  function muovi(dir) {
    if (!cur) return;
    if (cur.area === 'top') {
      if (dir === 'down' && file.length) { cercaEl.classList.remove('f'); cur = null; focus(0, ultimaPos[0] || 0); }
      return;
    }
    var r = cur.r, i = cur.i;
    if (dir === 'left') focus(r, i - 1);
    else if (dir === 'right') focus(r, i + 1);
    else if (dir === 'up') {
      ultimaPos[r] = i;
      if (r === 0) focusCerca(); else focus(r - 1, vicino(r - 1, xSchermo(r, i)));
    } else if (dir === 'down' && r < file.length - 1) {
      ultimaPos[r] = i;
      focus(r + 1, vicino(r + 1, xSchermo(r, i)));
    }
  }
  // le immagini si caricano solo per i riquadri vicini a dove guardi (sui TV vecchi ogni immagine costa memoria): la
  // copertina se c'e', se no l'icona
  function accendi(im) { im.src = im.getAttribute('data-src'); im.removeAttribute('data-src'); }
  function caricaIcone(r) {
    for (var k = r - 1; k <= r + 1; k++) {
      var t = trackEl(k);
      if (!t || !file[k]) continue;
      var da = Math.max(0, Math.floor((offsets[k] || 0) / geo.step) - 1), a = Math.min(file[k].voci.length, da + 9);
      for (var j = da; j < a; j++) {
        var c = t.children[j], im = c && (c.getElementsByClassName('copertina-img')[0] || c.getElementsByClassName('app-ico-img')[0]);
        if (im && im.getAttribute('data-src')) accendi(im);
      }
    }
  }
  // un'immagine che non arriva: la copertina lascia icona e nome, l'icona lascia l'iniziale (nei riquadri, nel titolo
  // grande, nella pagina dell'app)
  document.addEventListener('error', function (ev) {
    var im = ev.target;
    if (!im || im.tagName !== 'IMG' || !im.parentNode) return;
    if (/\bcopertina-img\b/.test(im.className)) {
      var ico = im.parentNode.getElementsByClassName('app-ico-img')[0];
      im.parentNode.removeChild(im);
      if (ico && ico.getAttribute('data-src')) accendi(ico);
    } else if (/\bapp-ico-img\b/.test(im.className)) im.parentNode.removeChild(im);
  }, true);
  // l'immagine che da' il colore a un'app e' arrivata: i colori si leggono una volta sola e si salvano (li usa anche la
  // home); il riquadro e la luce passano subito al colore vero
  function cartaDi(n) {
    while (n && !(n.className && /\bcard\b/.test(n.className))) n = n.parentNode;
    return n;
  }
  document.addEventListener('load', function (ev) {
    var im = ev.target;
    if (!im || im.tagName !== 'IMG' || !im.getAttribute('data-colore')) return;
    var id = im.getAttribute('data-ws'), t = im.getAttribute('data-tag');
    if (!id || (COLORI[id] && COLORI[id].tag === t)) return;
    var c = UI.coloriImmagine(im);
    if (!c) return;
    COLORI[id] = { a: c.a, b: c.b, tag: t };
    var tutti = UI.load('tvh-colors', {}) || {};
    tutti[id] = COLORI[id];
    UI.save('tvh-colors', tutti);
    var l = rowsEl.querySelectorAll('img[data-colore]'), x = [c.a, c.b];
    for (var i = 0; i < l.length; i++) {
      var carta = l[i].getAttribute('data-ws') === id ? cartaDi(l[i]) : null;
      if (carta) carta.style.background = sfondo(x);
    }
    var e = scelta();
    if (e && e.chiave === id) luce(x);
  }, true);

  /* ------------------------------------------------------------ l'app scelta in grande, e la sua luce */

  var heroText = $('hero-text'), heroCap = $('hero-cap'), heroTitle = $('hero-title'), heroSub = $('hero-sub'), heroChips = $('hero-chips');
  var heroIco = $('hero-ico'), titoloTimer = null, sfumaTimer = null, luceTimer = null, titoloFatto = '';
  function chip(tasto, testo) {
    return '<span class="chip' + (tasto ? '' : ' solo') + '">' + (tasto ? '<b>' + UI.esc(tasto) + '</b>' : '') + UI.esc(testo) + '</span>';
  }
  function scelta() { return cur && cur.area === 'rows' && file[cur.r] ? file[cur.r].voci[cur.i] : null; }
  // con le frecce tenute premute si aspetta che ci si fermi: il titolo dopo 90 ms, la luce dopo altri 220 (come la home)
  function titolo(subito) {
    clearTimeout(titoloTimer);
    if (subito) scriviTitolo(true); else titoloTimer = setTimeout(function () { scriviTitolo(false); }, 90);
  }
  // [sopra, titolo, sotto, pulsanti, l'app (per icona e luce)]
  function datiTitolo() {
    if (cur && cur.area === 'top') {
      return ['Store', ricerca ? 'Cerca: ' + ricerca : 'Cerca', ricerca ? 'OK per cambiare parola · Indietro per tornare a tutte le app' :
        'Un nome, un tipo di app o un autore: dal telecomando o dal telefono', chip('OK', 'Cerca'), null];
    }
    var e = scelta();
    if (!e) return null;
    if (e.tipo === 'azione') {
      var t = typeof e.eroe === 'function' ? e.eroe() : e.eroe || [file[cur.r].titolo, e.nome, e.sotto];
      return [t[0], t[1], t[2] || ' ', chip('OK', e.nome), null];
    }
    var st = stato(e), v = e.voce;
    var sopra = e.tipo === 'mia' ? 'Le mie app · non verificata, da ' + (e.sito || 'una fonte privata') :
      e.tipo === 'orfana' ? 'Non più nello Store' : (TITOLI[v.categoria] || 'App') + (v.autore ? ' · di ' + v.autore : '');
    return [sopra, e.nome, primaFrase(v.descrizione, 110) || ' ', chip('OK', 'Apri la pagina') + chip('', st.chip) +
      (v.versione ? chip('', 'Versione ' + v.versione) : ''), e];
  }
  function scriviTitolo(subito) {
    var d = datiTitolo();
    if (!d) return;
    var e = d[4], colore = e ? coloreDi(e) : VIOLA;
    clearTimeout(luceTimer);
    if (subito) luce(colore); else luceTimer = setTimeout(function () { luce(colore); }, 220);
    var chiave = d.slice(0, 4).join('|') + '|' + (e ? e.chiave : '');
    if (chiave === titoloFatto) return;
    titoloFatto = chiave;
    clearTimeout(sfumaTimer);
    // si cambia solo quello che cambia (le scritte uguali non si ridisegnano)
    function metti() {
      if (heroCap.textContent !== d[0]) heroCap.textContent = d[0];
      if (heroTitle.textContent !== d[1]) { heroTitle.textContent = d[1]; heroTitle.className = misuraTitolo(d[1], 24, 31); }
      if (heroSub.textContent !== d[2]) heroSub.textContent = d[2];
      if (heroChips.__html !== d[3]) { heroChips.__html = d[3]; heroChips.innerHTML = d[3]; }
      heroText.className = 'hero-text';
      mostraIcona(e);
    }
    if (subito) { metti(); return; }
    heroText.className = 'hero-text fade';
    if (heroIco.className.indexOf('via') === -1) heroIco.className += ' fade';
    sfumaTimer = setTimeout(metti, 140);
  }
  // un nome lungo si rimpicciolisce invece di tagliarsi (fino a 40 caratteri)
  function misuraTitolo(t, lungo, lunghissimo) { return t.length > lunghissimo ? 'lunghissimo' : t.length > lungo ? 'lungo' : ''; }
  function mostraIcona(e) {
    if (!e) { heroIco.className = 'st-ico via'; return; }
    var k = e.chiave + '|' + ((e.voce && e.voce.icona) || '');
    if (heroIco.__chiave !== k) { heroIco.__chiave = k; heroIco.innerHTML = iconaHTML(e, false, !(e.voce && e.voce.copertina)); }
    heroIco.className = 'st-ico st-c' + tinta(e);
  }

  // La luce come nella home (disegnaLuce in home.js): in piccolo (192 x 108) e il TV la allarga a tutto schermo. Due
  // strati che si scambiano: si anima solo l'opacita'
  var washA = $('wash-a'), washB = $('wash-b'), washSuA = true, luceFatta = '', LW = 192, LH = 108;
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
  function disegnaLuce(cv, c, bg) {
    var x = null;
    try { x = cv.getContext && cv.getContext('2d', { alpha: false }); } catch (e) { x = null; }
    if (!x) return false;
    var k = prefs.luce === 'tenue' ? 0.5 : 1;
    x.fillStyle = bg;
    x.fillRect(0, 0, LW, LH);
    if (prefs.luce !== 'spenta') {
      ellisse(x, 0, 0.6 * LH, 110 / 192 * LW, 70 / 108 * LH, c[1], 0.32 * k);
      ellisse(x, 0.84 * LW, 0, 140 / 192 * LW, 80 / 108 * LH, c[0], 0.55 * k);
    }
    var g = x.createLinearGradient(0, 0, 0, LH);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.38, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,.78)');
    x.fillStyle = g;
    x.fillRect(0, 0, LW, LH);
    return true;
  }
  function luce(c) {
    var bg = '';
    try { bg = getComputedStyle(document.body).backgroundColor || ''; } catch (e) {}
    var k = c.join(',') + '|' + bg + '|' + (prefs.luce || '');
    if (k === luceFatta) return;
    luceFatta = k;
    var dopo = washSuA ? washB : washA, ora = washSuA ? washA : washB;
    if (!disegnaLuce(dopo, c, bg || '#07080b')) {
      dopo.style.background = 'radial-gradient(140rem 80rem at 84% 0%, rgba(' + c[0] + ',.55) 0%, rgba(' + c[0] + ',0) 70%),var(--bg)';
    }
    dopo.className = 'wash on';
    ora.className = 'wash';
    washSuA = !washSuA;
  }

  function testoStato() {
    var c = Uff.catalogo(), n = 0, q = c && c.scaricato ? quando(c.scaricato) : '', e = c ? c.esito : '';
    if (c) for (var i = 0; i < c.app.length; i++) if (!c.app[i].ritirata) n++;
    if (controllo && !q) return 'Controllo lo Store…';
    if (e === 'ok') return (n === 1 ? '1 app' : n + ' app') + ' · catalogo di ' + q;
    if (e === 'offline') return q ? 'Senza internet: copia di ' + q : 'Non raggiungibile: controlla internet';
    if (e === 'nonTrovato') return q ? 'Catalogo non trovato: copia di ' + q : 'Lo Store di questo account non c\'è ancora';
    if (e === 'nonValido' || e === 'troppoGrande' || e === 'errore') return q ? 'Il catalogo ha un errore: copia di ' + q : 'Il catalogo ha un errore';
    if (e === 'memoriaPiena') return 'Memoria del TV piena' + (q ? ': copia di ' + q : '');
    if (e === 'formatoNuovo') return 'Aggiorna Home TV per il nuovo Store' + (q ? ' (copia di ' + q + ')' : '');
    if (!StoreDati.urlUfficiale()) return 'Non disponibile qui';
    return q ? 'Catalogo di ' + q : 'Controllo lo Store…';
  }
  function scriviStato() {
    $('store-stato').textContent = testoStato();
    $('cerca-testo').textContent = ricerca ? 'Cerca: ' + primaFrase(ricerca, 18) : 'Cerca';
  }

  /* ------------------------------------------------------------ tasti delle file */

  function apriScelta() {
    if (!cur) return;
    if (cur.area === 'top') { chiediRicerca(); return; }
    var e = scelta();
    if (!e) return;
    if (e.tipo === 'azione') e.azione(); else dettaglio(e);
  }
  function tastiLista(a) {
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') { mosso = true; muovi(a); }
    else if (a === 'ok' || a === 'hold' || a === 'yellow') { mosso = true; apriScelta(); }
    else if (a === 'back') { if (ricerca) togliRicerca(); else casa(); }
    else if (a === 'green') casa();
  }
  UI.onKeys(tastiLista);
  // il mouse o il puntatore del telefono: un clic apre subito quello che indichi
  rowsEl.addEventListener('click', function (ev) {
    var t = ev.target;
    while (t && t !== rowsEl && !(t.className && /\btile\b/.test(t.className))) t = t.parentNode;
    if (!t || t === rowsEl || app || detAperto) return;
    mosso = true;
    if (cur && cur.area === 'top') { cercaEl.classList.remove('f'); cur = null; }
    focus(+t.getAttribute('data-r'), +t.getAttribute('data-i'), true);
    apriScelta();
  });
  cercaEl.addEventListener('click', function () { if (!app && !detAperto) { mosso = true; focusCerca(true); chiediRicerca(); } });

  // la ricerca: mentre scrivi la finestra dice gia' quante app trova; OK le mostra in una fila
  function chiediRicerca(valore, subito) {
    function apri() {
      if (UI.editorOpen()) return;
      UI.openEditor({ title: 'Cerca nello Store', value: typeof valore === 'string' ? valore : ricerca, placeholder: 'un nome, un tipo di app o un autore',
        hint: 'Scrivi con la tastiera del TV o dal telefono. OK per cercare, Indietro per annullare.',
        onInput: suggerimento, onSave: function (t) { cerca(t); } });
    }
    if (subito) apri(); else setTimeout(apri, 120);
  }
  function suggerimento(t) {
    t = pulito(t);
    if (!t) return '';
    var c = Uff.catalogo(), r = trovaApp(t, cercabili(c, installateOra(c)));
    if (!r.length) return 'Nessuna app per «' + t + '»: prova con un\'altra parola';
    // i primi tre nomi, poi quante altre: "4 app: Meteo, Quiz, Scacchi e un'altra. OK per vederle"
    var nomi = r.slice(0, 3).map(function (e) { return e.nome; }), altre = r.length - nomi.length;
    var elenco = altre ? nomi.join(', ') + (altre === 1 ? ' e un\'altra' : ' e altre ' + altre) : nomi.slice(0, -1).join(', ') + (nomi.length > 1 ? ' e ' : '') + nomi[nomi.length - 1];
    return r.length === 1 ? '1 app: ' + elenco + '. OK per vederla' : r.length + ' app: ' + elenco + '. OK per vederle';
  }
  function cerca(t) {
    ricerca = pulito(t).slice(0, 60);
    if (!ricerca) preferita = null;
    disegna(ricerca ? 'risultati' : null);
  }
  function togliRicerca() { cerca(''); }

  function riprova() { aggiornaTutto(true); }
  function aggiornaTutto(forza) {
    controllo = true;
    scriviStato();
    titolo(true);
    function fine() { controllo = false; rinfresca(); }
    Promise.all([Uff.aggiorna(forza), Mie.aggiornaTutte(forza)]).then(fine, fine);
  }

  /* ============================================================ la pagina di un'app */

  var detEl = $('dettaglio'), detAperto = null, detSel = 0, detAzioni = [], detDaHome = false;
  function azioniDi(e) {
    var st = stato(e), l = [];
    if (e.tipo === 'orfana') return [{ testo: 'Disinstalla', fn: function () { conferma(e); } }];
    if (e.tipo === 'ws' && !st.inst) {
      l.push(st.installa ? { testo: 'Installa', fn: function () { installa(e); } } : { testo: st.chip, spenta: true });
      return l;
    }
    l.push(st.apri ? { testo: 'Apri', fn: function () { chiudiDettaglio(); apriApp(e.riquadro, 'store'); } } : { testo: st.chip, spenta: true });
    if (st.nuova) l.push({ testo: 'Aggiorna', fn: function () { aggiorna(e); } });
    l.push({ testo: e.tipo === 'mia' ? 'Togli' : 'Disinstalla', fn: function () { conferma(e); } });
    return l;
  }
  function dettaglio(e) {
    var stessa = detAperto && detAperto.chiave === e.chiave, primaSel = stessa && detAzioni[detSel] ? detAzioni[detSel].testo : null;
    detAperto = e;
    var v = e.voce, st = stato(e), info = [], mia = e.tipo === 'mia';
    if (v.versione) info.push('Versione ' + v.versione);
    // un'app privata: il sito vero da cui viene e l'autore come lo dichiara lei (in alto sempre "non verificata")
    if (mia) { info.push('da ' + (e.sito || 'una fonte privata')); if (v.autore) info.push('autore dichiarato: ' + v.autore); }
    else if (e.tipo === 'ws') info.push(TITOLI[v.categoria] || 'App');
    if (st.chip && !st.installa && st.chip !== 'Non verificata') info.push(st.chip);
    var ico = $('det-ico');
    ico.className = 'st-ico st-c' + tinta(e);
    ico.innerHTML = iconaHTML(e, false);
    var cap = $('det-cap'), nome = $('det-nome');
    cap.textContent = mia ? 'App privata · non verificata' : e.tipo === 'orfana' ? 'Non più nello Store' : v.autore ? 'di ' + v.autore : 'App per Home TV';
    cap.className = mia ? 'avviso' : '';
    nome.textContent = e.nome;
    nome.className = misuraTitolo(e.nome, 26, 34);
    $('det-info').textContent = info.join(' · ');
    $('det-descr').textContent = v.descrizione || '';
    var nov = $('det-novita');
    nov.textContent = v.novita ? 'Novità della versione ' + v.versione + ': ' + v.novita : '';
    nov.style.display = v.novita ? '' : 'none';
    detAzioni = azioniDi(e);
    detSel = -1;
    for (var k = 0; k < detAzioni.length && primaSel; k++) if (detAzioni[k].testo === primaSel && !detAzioni[k].spenta) detSel = k;
    if (detSel < 0) { detSel = 0; while (detSel < detAzioni.length - 1 && detAzioni[detSel].spenta) detSel++; }
    disegnaAzioni();
    if (detEl.hidden) {
      detEl.hidden = false;
      document.body.classList.add('con-dettaglio');
      UI.pushKeys(tastiDettaglio);
    }
  }
  function disegnaAzioni() {
    var html = '';
    for (var i = 0; i < detAzioni.length; i++) {
      html += '<span class="det-pill' + (i === detSel ? ' f' : '') + (detAzioni[i].spenta ? ' spenta' : '') + '" data-i="' + i + '">' + UI.esc(detAzioni[i].testo) + '</span>';
    }
    $('det-azioni').innerHTML = html;
  }
  function chiudiDettaglio() {
    if (detEl.hidden) return;
    detEl.hidden = true;
    document.body.classList.remove('con-dettaglio');
    detAperto = null;
    detDaHome = false;
    UI.popKeys(tastiDettaglio);
    titolo(true);
  }
  function tastiDettaglio(a) {
    if (a === 'left' || a === 'right') {
      var d = a === 'left' ? -1 : 1, n = detSel + d;
      while (n >= 0 && n < detAzioni.length && detAzioni[n].spenta) n += d;
      if (n >= 0 && n < detAzioni.length) { detSel = n; disegnaAzioni(); }
    } else if (a === 'ok') { var x = detAzioni[detSel]; if (x && !x.spenta && x.fn) x.fn(); }
    else if (a === 'back') { if (detDaHome) casa(); else chiudiDettaglio(); }
    else if (a === 'green') casa();
  }
  $('det-azioni').addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute || t.getAttribute('data-i') === null) return;
    detSel = +t.getAttribute('data-i');
    disegnaAzioni();
    var x = detAzioni[detSel];
    if (x && !x.spenta && x.fn) x.fn();
  });
  // dopo un'azione o un aggiornamento: le file (solo se cambiano) e la pagina aperta, sulla stessa app
  function rinfresca() {
    var aperta = detAperto;
    disegna();
    if (!aperta) return;
    var x = scelta(), p = x && x.chiave === aperta.chiave ? null : posto(null, aperta.chiave);
    if (x && x.chiave === aperta.chiave) dettaglio(x);
    else if (p) dettaglio(file[p[0]].voci[p[1]]);
    else chiudiDettaglio();
  }
  function installa(e) {
    if (Uff.installa(e.voce.id)) UI.toast(e.nome + ' installata: la trovi nei Preferiti e tra le app', 4000);
    else UI.toast('Non sono riuscito a installarla: la memoria del TV potrebbe essere piena', 5000);
    rinfresca();
  }
  function aggiorna(e) {
    var v = e.voce;
    StoreDati.segnaVista(e.riquadro);
    UI.toast(v.novita ? 'Novità di ' + e.nome + ' ' + v.versione + ': ' + v.novita : e.nome + ' aggiornata alla versione ' + v.versione, 6000, true);
    rinfresca();
  }
  function conferma(e) {
    var mia = e.tipo === 'mia';
    UI.openSheet({ title: (mia ? 'Togliere ' : 'Disinstallare ') + e.nome + '?', subtitle: 'Sparisce dalla home e i suoi dati su questo TV si cancellano.', items: [
      { label: mia ? 'Togli' : 'Disinstalla', action: function () {
        if (mia) { var p = StoreDati.perRiquadro(e.riquadro); if (p) Mie.togliApp(p.fonte, p.id); } else Uff.disinstalla(e.voce.id);
        UI.toast(e.nome + (mia ? ' tolta' : ' disinstallata'));
        setTimeout(rinfresca, 0);
      } },
      { label: 'Annulla', action: function () {} }
    ] });
  }

  /* ============================================================ Le mie app: aggiungere un indirizzo */

  var AVVISO = 'Questa fonte non è controllata da Home TV. Le sue app girano chiuse nel loro riquadro e non vedono la home ' +
    'né i tuoi dati, ma possono mostrarti qualsiasi cosa e usare internet. Aggiungila solo se ti fidi di chi l\'ha fatta.';
  function aggiungi() {
    if (!Mie.spazio('')) { UI.toast('Le mie app è piena (300 app): togli una fonte prima di aggiungerne un\'altra', 6000); return; }
    setTimeout(function () {
      UI.openEditor({
        title: 'Indirizzo dell\'app o del catalogo', placeholder: 'per esempio utente/repository',
        hint: 'Un indirizzo qualsiasi: scrivilo con la tastiera del TV o incollalo dal telefono. OK per andare avanti, Indietro per annullare.',
        onSave: function (testo) {
          if (!testo) return;
          var n = Mie.normalizza(testo);
          if (n.errore) { UI.toast(n.errore, 4000); return; }
          // l'avviso prima di chiedere qualsiasi cosa a quel sito
          setTimeout(function () {
            UI.openSheet({ title: 'Codice non verificato', subtitle: AVVISO, items: [
              { label: 'Aggiungi lo stesso', action: function () { cercaFonte(testo); } },
              { label: 'Annulla', action: function () {} }
            ] });
          }, 120);
        }
      });
    }, 120);
  }
  function cercaFonte(testo) {
    UI.toast('Cerco l\'app…', 12000);
    Mie.cerca(testo).then(function (t) {
      tacci();
      if (t.url) {
        // Le mie app tiene al massimo 300 app: se e' piena lo si dice, invece di aggiungere una fonte vuota
        if (!Mie.spazio(t.url)) { UI.toast('Le mie app è piena (300 app): togli una fonte prima di aggiungerne un\'altra', 6000); return; }
        var f = Mie.aggiungi(t.url, t.catalogo);
        if (!f) {
          UI.toast(Mie.oltreIlLimite() ? 'Le mie app è al limite: le app di questa fonte non ci stanno. Togli una fonte e riprova' :
            'Non sono riuscito a salvarla: la memoria del TV potrebbe essere piena', 6000, true);
          return;
        }
        var n = (f.app || []).length, fuori = t.catalogo.app.length - n;
        UI.toast((f.nome || 'Fonte') + ': ' + (n === 1 ? '1 app' : n + ' app') + ' in Le mie app' +
          (fuori > 0 ? ' (' + fuori + ' non ci stanno: al massimo 300 app private)' : ''), fuori > 0 ? 6000 : 4000, fuori > 0);
        disegna('mie');
        return;
      }
      // nessun catalogo: e' un sito normale. Lo aggiunge la home, come col + (il link passa da sessionStorage)
      setTimeout(function () {
        UI.openSheet({ title: 'È un sito, non un\'app per Home TV', subtitle: 'Lo aggiungo nei Preferiti come sito, come con il + della home?', items: [
          { label: 'Aggiungilo come sito', action: function () {
            try { sessionStorage.setItem('tvh-sito-dallo-store', t.sito); } catch (e) {}
            casa();
          } },
          { label: 'Annulla', action: function () {} }
        ] });
      }, 120);
    }, function (e) {
      UI.toast(e && e.message === 'offline' ? 'Non riesco a raggiungere questo indirizzo: controlla internet' : ((e && e.message) || 'Non riesco ad aggiungerla'), 5000);
    });
  }
  function fontiPrivate() {
    var l = Mie.fonti();
    if (!l.length) { UI.toast('Nessuna fonte privata'); return; }
    setTimeout(function () {
      UI.openSheet({ title: 'Fonti private', subtitle: 'Solo su questo TV. OK su una fonte per aggiornarla o toglierla.', items: l.map(function (f) {
        var n = (f.app || []).length, nota = f.esito && f.esito !== 'ok' && f.esito !== 'attesa' ? ' · non risponde' : '';
        return { label: f.nome || UI.hostOf(f.url), value: (n === 1 ? '1 app' : n + ' app') + nota, action: function () { setTimeout(function () { fonte(f); }, 120); } };
      }) });
    }, 120);
  }
  function fonte(f) {
    UI.openSheet({ title: f.nome || UI.hostOf(f.url), subtitle: UI.hostOf(f.url) + ' · non verificata', items: [
      { label: 'Aggiorna ora', action: function () { UI.toast('Aggiorno le fonti…'); Mie.aggiornaTutte(true).then(function () { UI.toast('Fonti aggiornate'); rinfresca(); }); } },
      { label: 'Togli la fonte e le sue app', action: function () { setTimeout(function () { togliFonte(f); }, 120); } },
      { label: 'Indietro', action: function () {} }
    ] });
  }
  function togliFonte(f) {
    UI.openSheet({ title: 'Togliere ' + (f.nome || UI.hostOf(f.url)) + '?', subtitle: 'Spariscono tutte le sue app da Le mie app, con i loro dati su questo TV.', items: [
      { label: 'Togli', action: function () { Mie.togliFonte(f.id); UI.toast('Fonte tolta'); setTimeout(function () { disegna('mie'); }, 0); } },
      { label: 'Annulla', action: function () {} }
    ] });
  }

  /* ============================================================ il riquadro isolato */

  var app = null, appEl = $('app-tv'), veloEl = $('app-velo'), attesaEl = $('app-attesa'), chiusa = null, listaFatta = false;

  function manda(m) {
    if (!app || !app.iframe) return;
    m.hometvApp = 1;
    try { app.iframe.contentWindow.postMessage(m, '*'); } catch (e) {}
  }
  // i messaggi di un'app si contano a finestre di 10 secondi: oltre 60 gli avvisi si ignorano; oltre 300 messaggi l'app
  // e' rotta (o vuole rallentare il TV) e si chiude
  function conta(x) {
    var ora = Date.now();
    if (ora - x.finestra > 10000 || ora < x.finestra) { x.finestra = ora; x.messaggi = 0; }
    x.messaggi++;
    if (x.messaggi > 300) { UI.toast('Questa app mandava troppi messaggi: l\'ho chiusa', 5000); chiudiApp(); return false; }
    return true;
  }
  function mostraAttesa(testo, e) {
    appEl.hidden = false;
    attesaEl.className = '';
    var ico = $('app-attesa-ico');
    ico.className = 'st-ico st-c' + tinta(e);
    ico.innerHTML = iconaHTML(e, false);
    $('app-attesa-testo').textContent = testo;
  }
  function nascondiAttesa() { attesaEl.className = 'via'; }
  function senzaApp(testo, da) {
    UI.toast(testo, 4000);
    if (da === 'home') setTimeout(casa, 1500); else fattaLista(null);
  }
  // aperta dalla home: le file dello Store (e il loro lavoro) si fanno solo se poi si torna nello Store
  function fattaLista(fila) {
    if (listaFatta) return;
    listaFatta = true;
    controllo = true;
    disegna(fila);
    aggiornaTutto(false);
  }

  // ancora: "#/..." per l'app (Continua a guardare dalla home: il video da riprendere), vedi ancoraBuona
  function apriApp(riquadro, da, riprovato, ancora) {
    var p = StoreDati.perRiquadro(riquadro);
    if (!p) { senzaApp('Questa app non è installata', da); return; }
    if (p.stato === 'attesa' && !riprovato) {
      UI.toast('Aspetto il catalogo dello Store…');
      var dopo = function () { apriApp(riquadro, da, true, ancora); };
      Uff.aggiorna(true).then(dopo, dopo);
      return;
    }
    if (p.stato !== 'ok') {
      senzaApp((p.voce ? p.voce.nome + ': ' : '') + (p.stato === 'ritirata' ? 'non è più disponibile' : p.stato === 'nonAdatta' ?
        nonVa(p.perche).frase : 'senza il catalogo dello Store non si apre'), da);
      return;
    }
    if (app) chiudiApp(true);
    var e = p.tipo === 'ws' ? elemWs(p.voce) : { tipo: 'mia', chiave: riquadro, voce: p.voce, nome: p.voce.nome, riquadro: riquadro, sito: p.sito };
    var x = app = { riquadro: riquadro, info: p, elem: e, da: da, pronta: false, seq: 0, attese: {}, backDiFila: 0, furti: [], finestra: 0,
      messaggi: 0, iframe: null, daScrivere: null, timerScrivi: null, annullato: 0, ancora: ancoraBuona(ancora) };
    // un'ancora che non va (troppo lunga, caratteri strani): l'app si apre dall'inizio, e lo si dice invece di tacere
    // (revisione d'insieme, punto 5)
    if (ancora && !x.ancora) UI.toast(p.voce.nome + ': non riesco a riprendere questo film, si apre dall\'inizio', 6000);
    mostraAttesa('Apro ' + p.voce.nome + '…', e);
    UI.pushKeys(tastiApp);
    carica(x);
    // le app dello Store stanno sullo stesso account: intanto si prova l'indirizzo, cosi' senza internet o con un 404
    // compare un messaggio e non una pagina d'errore (una pagina grande va bene lo stesso). Le private no: il loro sito
    // puo' non lasciarlo leggere
    if (!p.privata) {
      StoreDati.scarica(p.voce.url).then(null, function (err) {
        var m = err && err.message;
        if (app === x && !x.pronta && m !== 'troppoGrande') erroreApp(x, m);
      });
    }
  }
  // l'ancora che la home passa all'app: solo "#/..." con i caratteri di un indirizzo (cambia solo la parte dopo #: la
  // pagina dell'app e il suo indirizzo restano quelli del catalogo). Fino a 2100 caratteri: l'indirizzo di una scheda di
  // Continua a guardare arriva a 2000 (visti.js), piu' il punto da cui riprendere; prima 1500 tagliava i film in cartelle
  // con nomi lunghi
  function ancoraBuona(a) { return typeof a === 'string' && /^#\/[\x21-\x7e]{0,2100}$/.test(a) ? a : ''; }
  function carica(x) {
    var f = document.createElement('iframe');
    // niente allow-same-origin: indirizzo anonimo (niente dati della home, il servizio la rifiuta); niente popup, finestre
    // di avviso o cambio di pagina della home. Il nome fa stare fermo il codice di Home TV nei siti (main.js)
    f.setAttribute('sandbox', 'allow-scripts allow-forms');
    f.setAttribute('name', 'hometv-app');
    f.setAttribute('allow', 'autoplay');
    f.setAttribute('tabindex', '-1');
    f.setAttribute('title', x.info.voce.nome);
    f.addEventListener('load', function () {
      if (app !== x || x.pronta) return;
      clearTimeout(x.timerPronto);
      x.timerPronto = setTimeout(function () { if (app === x && !x.pronta) senzaLibreria(x); }, 3000);
    });
    f.src = x.info.voce.url + x.ancora;
    x.iframe = f;
    appEl.insertBefore(f, attesaEl);
    x.timerCarica = setTimeout(function () { if (app === x && !x.pronta && !x.senza) erroreApp(x, 'lenta'); }, 20000);
  }
  function erroreApp(x, motivo) {
    if (x.iframe) { try { x.iframe.src = 'about:blank'; } catch (e) {} if (x.iframe.parentNode) x.iframe.parentNode.removeChild(x.iframe); x.iframe = null; }
    var v = x.info.voce, perche = motivo === 'offline' ? 'Senza internet l\'app non si apre' : motivo === 'nonTrovato' ?
      'L\'app non si trova più al suo indirizzo' : 'L\'app non risponde';
    // sotto il menu resta l'icona col motivo: se lo chiudi con Indietro sai cos'e' successo (un altro Indietro esce)
    mostraAttesa(perche, x.elem);
    UI.openSheet({ title: v.nome, subtitle: perche + '.', items: [
      { label: 'Riprova', action: function () { var r = x.riquadro, da = x.da, an = x.ancora; chiudiApp(true); setTimeout(function () { apriApp(r, da, false, an); }, 120); } },
      { label: 'Esci', action: function () { chiudiApp(); } }
    ] });
  }
  function senzaLibreria(x) {
    x.senza = true;
    nascondiAttesa();
    var v = x.info.voce, items = [];
    if (x.info.privata && !stessoSito(v.url)) items.push({ label: 'Aprila come sito', value: 'a pagina intera', action: function () { comeSito(v.url); } });
    items.push({ label: 'Esci', action: function () { chiudiApp(); } });
    UI.openSheet({ title: 'Questa app non usa il telecomando di Home TV', subtitle: x.info.privata ?
      'Si può aprire a pagina intera, come un sito: Home TV la guida con le frecce e il telefono.' :
      'Manca la libreria di Home TV (tv-app.js): l\'app va corretta.', items: items });
  }
  function comeSito(u) { chiudiApp(true); location.href = u; }

  // l'ultima memoria mandata dall'app si salva subito la prima volta, poi al massimo una volta al secondo: mai persa,
  // nemmeno uscendo (per un momento si prendono ancora le scritture dell'app che si sta chiudendo)
  function scriviOra(x) {
    clearTimeout(x.timerScrivi);
    x.timerScrivi = null;
    if (!x.daScrivere) return;
    var d = x.daScrivere;
    x.daScrivere = null;
    x.ultimaScrittura = Date.now();
    if (!StoreDati.scriviDatiApp(x.riquadro, d) && app === x) manda({ tipo: 'memoriaPiena' });
  }
  function daScrivere(x, d) {
    x.daScrivere = d;
    var dopo = 1000 - (Date.now() - (x.ultimaScrittura || 0));
    if (dopo <= 0) scriviOra(x);
    else if (!x.timerScrivi) x.timerScrivi = setTimeout(function () { scriviOra(x); }, dopo);
  }
  function chiudiApp(perRiaprire, allaHome) {
    var x = app;
    if (!x) return;
    app = null;
    UI.popKeys(tastiApp);
    clearTimeout(x.timerPronto);
    clearTimeout(x.timerCarica);
    // i gettoni dei permessi valgono solo finche' l'app e' aperta: si tolgono quando il riquadro se ne va (200 ms dopo il
    // "chiudi"), cosi' l'app fa in tempo a salvare col suo gettone (Real4K: il punto del film, lo Stopped a Jellyfin)
    var gettoni = x.gettoni;
    x.gettoni = null;
    function togliGettoni() { if (gettoni) { gettoni.forEach(togliGettone); gettoni = null; } }
    if (x.iframe) {
      try { x.iframe.contentWindow.postMessage({ hometvApp: 1, tipo: 'chiudi' }, '*'); } catch (e) {}
      chiusa = { x: x, win: x.iframe.contentWindow, fino: Date.now() + 1500 };
    }
    scriviOra(x);
    if (UI.editorOpen()) UI.closeEditor();
    if (UI.sheetOpen()) UI.closeSheet();
    var f = x.iframe;
    x.iframe = null;
    appEl.hidden = true;
    // il riquadro si svuota dopo un attimo (l'app manda le ultime scritture), poi si toglie: la memoria si libera
    if (f) setTimeout(function () { togliGettoni(); try { f.src = 'about:blank'; } catch (e) {} if (f.parentNode) f.parentNode.removeChild(f); }, 200);
    else togliGettoni();
    if (perRiaprire) return;
    if (allaHome || x.da === 'home') { setTimeout(casa, 250); return; }
    if (listaFatta) rinfresca(); else fattaLista(null);
  }

  function tastiApp(a) {
    var x = app;
    if (!x) return;
    if (a === 'back') { indietro(x); return; }
    if (a === 'green') { chiudiApp(false, true); return; }
    if (a === 'blue' || a === 'hold') { menuApp(x); return; }
    x.backDiFila = 0;
    if (x.pronta && /^(up|down|left|right|ok|play|red|yellow|rew|ff|stop)$/.test(a)) manda({ tipo: 'tasto', azione: a });
  }
  // Indietro: lo puo' usare l'app (per chiudere un suo menu), ma al massimo 3 volte di fila: il quarto esce sempre. Le
  // app ufficiali (fidate) fino a 8: risalire le cartelle di una chiavetta, chiudere il lettore e i suoi pannelli
  function indietro(x) {
    if (!x.iframe || !x.pronta || x.backDiFila >= (x.info.privata ? 3 : 8)) { chiudiApp(); return; }
    var id = ++x.seq, fatto = false;
    x.attese[id] = function (usato) {
      if (fatto) return;
      fatto = true;
      delete x.attese[id];
      if (app !== x) return;
      if (usato) x.backDiFila++; else chiudiApp();
    };
    manda({ tipo: 'indietro', id: id });
    setTimeout(function () { if (x.attese[id]) x.attese[id](false); }, 400);
  }
  function menuApp(x) {
    var v = x.info.voce, items = [{ label: 'Torna all\'app', action: function () {} },
      { label: 'Ricarica', action: function () { var r = x.riquadro, da = x.da, an = x.ancora; chiudiApp(true); setTimeout(function () { apriApp(r, da, false, an); }, 120); } }];
    if (x.info.privata && !stessoSito(v.url)) items.push({ label: 'Aprila come sito', value: 'a pagina intera', action: function () { comeSito(v.url); } });
    items.push({ label: 'Esci', action: function () { chiudiApp(); } });
    UI.openSheet({ title: v.nome, subtitle: x.info.privata ? 'App non verificata, da ' + (x.info.sito || 'una fonte privata') :
      'Dallo Store · versione ' + v.versione, items: items });
  }
  // un permesso del catalogo (per ora "video": le chiavette attaccate al TV, con l'app Video). Solo alle app del catalogo
  // ufficiale che lo dichiarano: il servizio da' un gettone che vale solo per le domande di quel permesso, e la home lo
  // toglie quando l'app si chiude. Le app private (che puo' aggiungere chiunque) non lo ricevono mai
  var PERMESSI = { video: '/api/video/gettone' };
  function permessoApp(x, d) {
    var nome = String(d.nome || ''), v = x.info.voce || {};
    var ammesso = !x.info.privata && x.info.tipo === 'ws' && Object.prototype.hasOwnProperty.call(PERMESSI, nome) &&
      Array.isArray(v.permessi) && v.permessi.indexOf(nome) !== -1;
    if (!ammesso) { manda({ tipo: 'permesso', id: d.id, ok: false, motivo: 'negato' }); return; }
    UI.service(PERMESSI[nome], {}).then(function (r) {
      if (app !== x || !r || typeof r.gettone !== 'string') { if (r && r.gettone) togliGettone(r.gettone); return; }
      x.gettoni = (x.gettoni || []).concat([r.gettone]);
      manda({ tipo: 'permesso', id: d.id, ok: true, gettone: r.gettone, servizio: UI.SERVICE });
    }, function (e) {
      // 404: il servizio non conosce la domanda (e' di prima, o su questo TV non c'e' ancora); altrimenti non risponde
      if (app === x) manda({ tipo: 'permesso', id: d.id, ok: false, motivo: e && e.stato === 404 ? 'vecchio' : 'servizio' });
    });
  }
  function togliGettone(g) { UI.service('/api/video/gettone/via', { gettone: g })['catch'](function () {}); }

  // la tastiera per l'app. Dopo che l'hai chiusa con Indietro, per 5 secondi l'app non la puo' riaprire: un'app che la
  // chiede di continuo non ti tiene dentro (il prossimo Indietro esce)
  function chiediTesto(x, d) {
    if (UI.editorOpen() || Date.now() - x.annullato < 5000) { manda({ tipo: 'testo', id: d.id, testo: null }); return; }
    UI.openEditor({
      title: String(d.titolo || 'Scrivi').slice(0, 80), value: String(d.valore || '').slice(0, 500),
      onSave: function (t) { if (app === x) manda({ tipo: 'testo', id: d.id, testo: t }); },
      onCancel: function () { x.annullato = Date.now(); if (app === x) manda({ tipo: 'testo', id: d.id, testo: null }); }
    });
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data, x = app;
    if (!d || typeof d !== 'object' || d.hometvApp !== 1 || typeof d.tipo !== 'string') return;
    // l'app appena chiusa: si prendono ancora le sue ultime scritture
    if ((!x || !x.iframe || ev.source !== x.iframe.contentWindow) && chiusa && ev.source === chiusa.win && Date.now() < chiusa.fino) {
      if (d.tipo === 'scrivi' && d.dati && typeof d.dati === 'object') { chiusa.x.daScrivere = d.dati; scriviOra(chiusa.x); }
      return;
    }
    if (!x || !x.iframe || ev.source !== x.iframe.contentWindow || !conta(x)) return;
    if (d.tipo === 'pronto') {
      // anche piu' volte (l'app ricaricata, o la libreria che si ripresenta): sempre la stessa risposta
      manda({ tipo: 'benvenuto', info: { piattaforma: ProfiloTV.piattaforma(window, UI.ON_TV), lingua: 'it', tema: prefs.tema || 'notte',
        capacita: ProfiloTV.motore(window) }, dati: StoreDati.datiApp(x.riquadro) });
      if (x.pronta) return;
      x.pronta = true;
      clearTimeout(x.timerPronto);
      clearTimeout(x.timerCarica);
      if (x.senza && UI.sheetOpen()) UI.closeSheet();
      x.senza = false;
      nascondiAttesa();
      // la prima volta dopo una versione nuova: le novita'
      if (x.info.nuova) {
        var v = x.info.voce;
        StoreDati.segnaVista(x.riquadro);
        UI.toast(v.novita ? 'Novità di ' + v.nome + ' ' + v.versione + ': ' + v.novita : v.nome + ' è alla versione ' + v.versione, 6000, true);
      }
      return;
    }
    if (!x.pronta) return;
    if (d.tipo === 'indietroFatto') { var f = x.attese[d.id]; if (f) f(d.usato === true); }
    else if (d.tipo === 'scrivi') { if (d.dati && typeof d.dati === 'object') daScrivere(x, d.dati); }
    else if (d.tipo === 'chiediTesto') chiediTesto(x, d);
    else if (d.tipo === 'permesso') permessoApp(x, d);
    else if (d.tipo === 'esci') chiudiApp();
    else if (d.tipo === 'avviso') { if (x.messaggi <= 60) UI.toast(String(d.testo || '').slice(0, 160), 4000); }
  });

  // il riquadro non deve prendersi il telecomando: se ci prova la pagina se lo riprende (5 volte in 10 s: app chiusa)
  window.addEventListener('blur', function () {
    var x = app;
    if (!x || !x.iframe) return;
    setTimeout(function () {
      if (app !== x || !x.iframe || document.activeElement !== x.iframe) return;
      try { x.iframe.blur(); } catch (e) {}
      try { window.focus(); } catch (e) {}
      var ora = Date.now();
      x.furti = x.furti.filter(function (t) { return ora - t < 10000; });
      x.furti.push(ora);
      if (x.furti.length >= 5) { UI.toast('Questa app continuava a prendersi il telecomando: l\'ho chiusa', 5000); chiudiApp(); }
    }, 0);
  });
  // il puntatore del telefono (o il mouse): uno strato trasparente sopra l'app passa il punto alla libreria
  veloEl.addEventListener('click', function (ev) {
    var x = app;
    if (!x || !x.pronta || !x.iframe) return;
    var r = x.iframe.getBoundingClientRect();
    manda({ tipo: 'puntatore', azione: 'clic', x: ev.clientX - r.left, y: ev.clientY - r.top });
  });
  veloEl.addEventListener('contextmenu', function (ev) { ev.preventDefault(); if (app) menuApp(app); });

  /* ============================================================ telefono e partenza */

  // lo Store dal telefono: come nella home (l'azione la fa StoreDati), poi le file e la pagina aperta si aggiornano e il
  // telefono riceve l'elenco nuovo con l'esito
  function storeDalTelefono(e) {
    StoreDati.azioneTelefono(e).then(function (r) {
      if (r.apri) { chiudiDettaglio(); apriApp(r.apri, 'store'); return; }
      if (r.testo) UI.toast(r.testo, 4000);
      if (e.azione !== 'elenco' && listaFatta) rinfresca();
      UI.service('/api/telefono/store', StoreDati.perTelefono(e.azione === 'elenco' ? null : { azione: e.azione, ok: r.ok, testo: r.testo },
        UI.coloriApp()))['catch'](function () {});
    });
  }
  // anche con un'app aperta (Real4K): se il servizio si ferma, si riparte dalla pagina di TizenBrew (UI.guardiano)
  UI.guardiano({ altra: typeof ProfiloTV !== 'undefined' && ProfiloTV.altraTv({ piattaforma: ProfiloTV.piattaforma(window, UI.ON_TV) }),
    messaggio: function (t) { UI.toast(t, 4000); },
    // c'e' un'app aperta (Real4K con un film): dopo la caduta la home riprende il film da sola
    appAperta: function () { return !!app; } });
  UI.ascoltaTelefono('Store', {
    store: storeDalTelefono,
    // la barra del video sul telefono: all'app aperta (HomeTV.video)
    video: function (e) {
      if (app && app.pronta) manda({ tipo: 'video', azione: String(e.azione || ''), secondi: Number(e.secondi) || 0 });
    },
    // testo dal telefono senza una finestra aperta: nell'app va nella casella scelta; nello Store diventa una ricerca
    testo: function (t, invio) {
      if (app) { if (app.pronta) manda({ tipo: 'testoTelefono', testo: String(t).slice(0, 500), invio: invio }); return; }
      if (detAperto || UI.sheetOpen()) return;
      if (invio) cerca(t); else chiediRicerca(t, true);
    },
    // un link o Home dal telefono con un'app aperta: prima si chiude l'app (cosi' salva i suoi dati)
    link: function (u) {
      if (!app) { location.href = u; return; }
      chiudiApp(true);
      setTimeout(function () { location.href = u; }, 250);
    },
    home: function () { if (app) chiudiApp(false, true); else casa(); }
  });
  window.addEventListener('resize', function () {
    UI.fitScreen();
    misura();
    if (cur && cur.area === 'rows') { var c = cur; cur = null; c.el.classList.remove('f'); focus(c.r, c.i, true); }
  });

  // cosa sa fare il servizio di questo TV ("funzioni" di GET /api/status): le app che chiedono altro restano spente. Si
  // chiede a ogni apertura (risponde il TV stesso, costa poco); intanto vale quello che si sapeva
  if (!DEMO) UI.service('/api/status').then(function (s) { if (StoreDati.servizio(s) && listaFatta) rinfresca(); }, function () {});

  var daAprire = parametro('apri'), daVedere = parametro('app');
  if (daAprire) {
    // aperta dalla home: niente file (e niente lavoro dietro l'app) finche' non si torna nello Store
    apriApp(daAprire, DA_HOME ? 'home' : 'store', false, parametro('ancora'));
  } else {
    fattaLista(ha('aggiungi') || ha('fonti') || ha('mie') ? 'mie' : null);
    var dove = daVedere ? posto(null, 'ws:' + daVedere) : null;
    if (dove) {
      mosso = true;
      focus(dove[0], dove[1], true);
      dettaglio(file[dove[0]].voci[dove[1]]);
      detDaHome = DA_HOME; // "Informazioni" della home: Indietro torna li'
    } else if (ha('aggiungi')) aggiungi();
    else if (ha('fonti')) fontiPrivate();
  }
})();
