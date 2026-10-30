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

  // n byte da "pos" in b, dall'inizio di b: cb(err, la parte letta di b)
  function leggiIn(fs, fd, b, pos, n, cb) {
    var fatto = 0;
    (function giro() {
      fs.read(fd, b, fatto, n - fatto, pos + fatto, function (err, letti) {
        if (err) { cb(err); return; }
        fatto += letti;
        if (letti === 0 || fatto >= n) { cb(null, fatto === b.length ? b : b.slice(0, fatto)); return; }
        giro();
      });
    })();
  }
  function leggi(fs, fd, pos, n, cb) { leggiIn(fs, fd, nuovo(n), pos, n, cb); }
  // la vista v sta nella memoria di b (un pezzo di un blocco che si riusa)
  function nelBlocco(v, b) { return v.buffer === b.buffer && v.byteOffset >= b.byteOffset && v.byteOffset < b.byteOffset + b.length; }

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
      else if (id === 0x54B0) v.dl = uint(b, a, z - a); // DisplayWidth e DisplayHeight: la forma vera (DVD anamorfici)
      else if (id === 0x54BA) v.da = uint(b, a, z - a);
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
          for (i = 0; i < m.tracce.length && !m.ritmo; i++) {
            if (m.tracce[i].tipo === 1 && m.cues[m.tracce[i].num]) m.ritmo = ritmoDaCues(m.cues[m.tracce[i].num], m.scala, m.durata);
          }
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

  /* ============================================================ i picchi stimati dal TV
   * Quanti Mbps chiede il film secondo per secondo, senza leggerlo tutto: dalle Cues dell'MKV (dove sta ogni fotogramma
   * chiave e quando) o dalle tabelle dell'MP4 (misura e durata di ogni fotogramma). Serve per avvisare prima: i momenti
   * in cui il film supera quello che il TV (o la rete) regge, il tetto. Il Mac (limitatore) misura meglio, pacchetto per
   * pacchetto; questa e' la stima che il TV fa da solo, subito. */

  var MAX_SECONDI_RITMO = 6 * 3600;
  // dalle Cues di una traccia video: [{ t (in unita' della scala), cl, rel }] -> Mbps per secondo (interpolati nel GOP)
  function ritmoDaCues(l, scala, durata) {
    if (!l || l.length < 2 || !(durata > 1)) return null;
    var p = [], i, ultimo = -1;
    var q = l.slice().sort(function (x, y) { return x.t - y.t; });
    for (i = 0; i < q.length; i++) {
      var t = q[i].t * scala / 1e9, pos = q[i].cl + (q[i].rel > 0 ? q[i].rel : 0);
      if (pos <= ultimo || (p.length && t <= p[p.length - 1].t)) continue;
      p.push({ t: t, pos: pos });
      ultimo = pos;
    }
    if (p.length < 2) return null;
    var n = Math.min(MAX_SECONDI_RITMO, Math.ceil(Math.min(durata, p[p.length - 1].t))), out = [], k = 0;
    function posA(t) {
      while (k + 1 < p.length - 1 && p[k + 1].t <= t) k++;
      var a = p[k], b = p[k + 1];
      if (t <= a.t) return a.pos;
      if (t >= b.t) return b.pos;
      return a.pos + (b.pos - a.pos) * (t - a.t) / (b.t - a.t);
    }
    for (i = 0; i < n; i++) {
      var x = posA(i), y = posA(i + 1);
      out.push(Math.round(Math.max(0, y - x) * 8 / 1e5) / 10);
    }
    return { mbps: out, da: 'cues' };
  }
  // dalle tabelle dell'MP4: i fotogrammi del video secondo per secondo, piu' le altre tracce in media. I numeri scritti nel
  // file non si credono: i giri si fermano alla fine dei riquadri, con la misura fissa non si gira per fotogramma, e dopo
  // 50 ms di lavoro si rinuncia (niente stima: un MP4 fatto apposta non ferma il servizio)
  var MAX_FOTOGRAMMI_RITMO = MAX_SECONDI_RITMO * 240;
  function ritmoDaMp4(b, tracce, durata) {
    if (!(durata > 1)) return null;
    var fino = Date.now() + 50, v = null, altri = 0, i;
    for (i = 0; i < tracce.length; i++) {
      var t = tracce[i];
      if (!t._stsz) continue;
      if (t.tipo === 1 && !v) v = t;
      else { var x = totaleStsz(b, t._stsz, fino); if (x < 0) return null; altri += x; }
    }
    if (!v || !v._stts || !v.scala) return null;
    var n = Math.min(MAX_SECONDI_RITMO, Math.ceil(durata)), sec = [], s0 = v._stsz, t0 = v._stts;
    for (i = 0; i < n; i++) sec.push(0);
    var fisso = b.readUInt32BE(s0[0] + 4), quanti = b.readUInt32BE(s0[0] + 8);
    if (!fisso) quanti = Math.min(quanti, Math.floor((s0[1] - s0[0] - 12) / 4));
    quanti = Math.min(quanti, MAX_FOTOGRAMMI_RITMO);
    var voci = Math.min(b.readUInt32BE(t0[0] + 4), Math.floor((t0[1] - t0[0] - 8) / 8)), c = 0, tempo = 0;
    for (var e = 0; e < voci && c < quanti; e++) {
      var cnt = Math.min(b.readUInt32BE(t0[0] + 8 + e * 8), quanti - c), delta = b.readUInt32BE(t0[0] + 12 + e * 8);
      if (fisso) {
        // misura fissa: fisso x cnt sparso sui secondi di questa voce
        spargi(sec, tempo / v.scala, (tempo + cnt * delta) / v.scala, fisso * cnt);
        tempo += cnt * delta;
        c += cnt;
      } else {
        for (var k = 0; k < cnt; k++, c++) {
          var j = Math.floor(tempo / v.scala);
          if (j < n) sec[j] += b.readUInt32BE(s0[0] + 12 + c * 4);
          tempo += delta;
          if ((c & 0xffff) === 0xffff && Date.now() > fino) return null;
        }
      }
      if ((e & 0xff) === 0xff && Date.now() > fino) return null;
    }
    var resto = altri / durata;
    for (i = 0; i < n; i++) sec[i] = Math.round((sec[i] + resto) * 8 / 1e5) / 10;
    return { mbps: sec, da: 'mp4' };
  }
  // byte sparsi in modo uniforme sui secondi tra da e a
  function spargi(sec, da, a, byte) {
    if (!(a > da)) { var j0 = Math.floor(da); if (j0 >= 0 && j0 < sec.length) sec[j0] += byte; return; }
    var per = byte / (a - da), s1 = Math.max(0, Math.floor(da)), fine = Math.min(sec.length, Math.ceil(a));
    for (var s2 = s1; s2 < fine; s2++) {
      var x = Math.max(da, s2), y = Math.min(a, s2 + 1);
      if (y > x) sec[s2] += per * (y - x);
    }
  }
  // tutti i byte di una traccia (le altre, in media); -1 se ci vuole troppo
  function totaleStsz(b, s0, fino) {
    var fisso = b.readUInt32BE(s0[0] + 4), quanti = b.readUInt32BE(s0[0] + 8), tot = 0;
    if (fisso) return fisso * Math.min(quanti, MAX_FOTOGRAMMI_RITMO);
    quanti = Math.min(quanti, Math.floor((s0[1] - s0[0] - 12) / 4));
    for (var c = 0; c < quanti; c++) {
      tot += b.readUInt32BE(s0[0] + 12 + c * 4);
      if ((c & 0xffff) === 0xffff && Date.now() > fino) return -1;
    }
    return tot;
  }
  // i momenti oltre il tetto: tratti vicini (meno di 3 s tra l'uno e l'altro) uniti
  function picchiDi(r, tetto) {
    if (!r || !r.mbps || !r.mbps.length) return null;
    var l = r.mbps, mx = 0, al = 0, tot = 0, lista = [], cur = null, secondi = 0, i;
    for (i = 0; i < l.length; i++) {
      tot += l[i];
      if (l[i] > mx) { mx = l[i]; al = i; }
      if (l[i] > tetto) {
        secondi++;
        if (cur && i - cur.a <= 3) { cur.a = i + 1; if (l[i] > cur.mbps) cur.mbps = l[i]; }
        else { cur = { da: i, a: i + 1, mbps: l[i] }; lista.push(cur); }
      }
    }
    return { da: r.da, tetto: tetto, media: Math.round(tot / l.length * 10) / 10, massimo: mx, al: al, secondi: secondi,
      momenti: lista.length, lista: lista.slice(0, 40) };
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
      try { m.ritmo = ritmoDaMp4(moov, m.tracce, m.durata); } catch (e2) { m.ritmo = null; }
      for (var k = 0; k < m.tracce.length; k++) { delete m.tracce[k]._stsz; delete m.tracce[k]._stts; }
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
            t.scala = b.readUInt32BE(a2 + (v2 === 1 ? 20 : 12));
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
      // per la stima dei picchi: dove stanno le misure (stsz) e le durate (stts) dei fotogrammi, nel moov
      if (tipo === 'stsz' && z - a >= 12) { t._stsz = [a, z]; return; }
      if (tipo === 'stts' && z - a >= 8) { t._stts = [a, z]; return; }
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

  // se il TV legge una traccia audio: true, 'ultimo' (FLAC), 'tv' (DTS e TrueHD che il TV converte: audio-tv.js, solo
  // le tracce in letti.tv), o niente
  function leggibile(t, letti) {
    var l = letti.audio[famiglia(t.codec)];
    return l === 'tv' ? (letti.tv && letti.tv[t.num] ? 'tv' : false) : l;
  }
  // quale traccia audio far sentire: tra quelle che il TV legge, la lingua preferita, poi quella che il TV legge da se'
  // (meglio di una da convertire), poi quella predefinita, poi non commento, poi piu' canali, poi l'ordine del file
  function sceltaAudio(audio, lingue, letti) {
    var buoni = [];
    for (var i = 0; i < audio.length; i++) {
      var a = audio[i];
      var l = leggibile(a, letti);
      if (a.abilitata !== false && l && !a.cifrata) buoni.push({ t: a, i: i, ultimo: l === 'ultimo' ? 1 : 0, conv: l === 'tv' ? 1 : 0 });
    }
    if (!buoni.length) return null;
    function posto(x) { var k = lingue.indexOf(lingua(x.t)); return k === -1 ? 99 : k; }
    buoni.sort(function (x, y) {
      return (x.ultimo - y.ultimo) || (posto(x) - posto(y)) || (x.conv - y.conv) || ((y.t.predefinita ? 1 : 0) - (x.t.predefinita ? 1 : 0)) ||
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
      for (i = 0; i < audio.length; i++) if (audio[i].num === +scelte.audio && leggibile(audio[i], letti)) scelta = audio[i];
    }
    if (!scelta) scelta = sceltaAudio(audio, lingue, letti);
    var nascoste = {}, quante = 0;
    for (i = 0; i < m.tracce.length; i++) {
      var x = m.tracce[i];
      if (x !== video && x !== scelta) { nascoste[x.num] = true; quante++; }
    }
    // converti: la traccia DTS o TrueHD che il TV converte in AC3 (audio-tv.js), 0 se nessuna
    return { video: video ? video.num : 0, audio: scelta ? scelta.num : 0, nascoste: nascoste, quante: quante,
      senzaAudio: !scelta && audio.length > 0, converti: scelta && leggibile(scelta, letti) === 'tv' ? scelta.num : 0 };
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
    } else if (p.tracksNuove) {
      // l'audio convertito dal TV: Tracks rifatta da audio-tv.js (solo i byte che cambiano: comprende le TrackEntry
      // nascoste e il CRC)
      out = p.tracksNuove.slice();
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

  /* ============================================================ sottotitoli a immagini dei DVD (VobSub) e file .sup
   * Un sottotitolo dei DVD (SPU) e' un'immagine a 4 colori compressa a corse di 2 bit, in due semicampi (righe pari e
   * dispari), con una tabella di comandi (SP_DCSQ): quando comincia e quando finisce, quali 4 dei 16 colori della
   * palette (nell'.idx o nel CodecPrivate di S_VOBSUB) e quanto sono trasparenti. Qui diventa un "display set" PGS come
   * i blocchi PGS del MKV (composizione, finestra, palette, oggetto, fine): l'app lo disegna con lo stesso codice dei
   * PGS. Un .sup e' un flusso PGS in un file a parte: segmenti "PG" + PTS + DTS + tipo + lunghezza; tolti i 10 byte
   * davanti, un display set e' uguale a un blocco PGS del MKV. */

  // uno SPU al massimo grande come lo schermo di un DVD (720x576): pochi byte possono dichiarare un'immagine enorme, e
  // ricodificarla costerebbe troppo al TV
  var MAX_IDX = 4 << 20, MAX_PIXEL_SPU = 720 * 576;
  var TRE_LETTERE = {};
  (function () { for (var k in LINGUE2) if (Object.prototype.hasOwnProperty.call(LINGUE2, k)) TRE_LETTERE[LINGUE2[k]] = true; })();
  // la lingua dal nome di un file accanto al film: "Film.ita.sup", "Film.en.forced.idx", "Film.italiano.sup"
  function linguaDaNome(resto) {
    var parti = String(resto || '').toLowerCase().split(/[._\s\-]+/);
    for (var i = 0; i < parti.length; i++) {
      var p = parti[i];
      if (/^(italian|italiano)$/.test(p)) return 'ita';
      if (/^(english|inglese)$/.test(p)) return 'eng';
      if (LINGUE2[p]) return LINGUE2[p];
      if (/^[a-z]{3}$/.test(p) && (SINONIMI[p] || TRE_LETTERE[p])) return SINONIMI[p] || p;
    }
    return 'und';
  }
  // l'intestazione di un .idx (e il CodecPrivate di S_VOBSUB nel MKV): misura della tela, i 16 colori, lo scostamento
  function intestazioneIdx(testo) {
    var t = String(testo || '').slice(0, 65536), out = { w: 720, h: 576, palette: null, scostamento: 0 }, m;
    m = /(?:^|\n)[ \t]*size[ \t]*:[ \t]*(\d{1,4})[ \t]*x[ \t]*(\d{1,4})/i.exec(t);
    if (m && +m[1] >= 16 && +m[2] >= 16 && +m[1] <= 4096 && +m[2] <= 4096) { out.w = +m[1]; out.h = +m[2]; }
    m = /(?:^|\n)[ \t]*palette[ \t]*:([^\n]*)/i.exec(t);
    if (m) {
      var l = m[1].split(',').map(function (x) { return x.replace(/\s+/g, ''); }).filter(function (x) { return /^[0-9a-f]{1,6}$/i.test(x); });
      if (l.length) { out.palette = []; for (var i = 0; i < 16; i++) out.palette.push(i < l.length ? parseInt(l[i], 16) : 0); }
    }
    m = /(?:^|\n)[ \t]*time offset[ \t]*:[ \t]*(-?\d{1,9})/i.exec(t);
    if (m) out.scostamento = +m[1];
    return out;
  }
  function nibble(b, n) { return n & 1 ? b[n >> 1] & 15 : b[n >> 1] >> 4; }
  // le corse a 2 bit di un semicampo (righe y, y + 2, ...) dai byte [da, a): 4, 8, 12 o 16 bit per corsa, "0" = fino alla
  // fine della riga, ogni riga comincia a un byte intero
  function corseSpu(b, da, a, px, w, h, y) {
    var n = da * 2, fineN = a * 2, x = 0, v, l, c;
    while (y < h && n < fineN) {
      v = nibble(b, n++);
      if (v < 4) {
        v = (v << 4) | (n < fineN ? nibble(b, n) : 0); n++;
        if (v < 16) {
          v = (v << 4) | (n < fineN ? nibble(b, n) : 0); n++;
          if (v < 64) { v = (v << 4) | (n < fineN ? nibble(b, n) : 0); n++; }
        }
      }
      c = v & 3;
      l = v >> 2;
      if (l === 0 || l > w - x) l = w - x;
      if (c) px.fill(c, y * w + x, y * w + x + l);
      x += l;
      if (x >= w) { x = 0; y += 2; if (n & 1) n++; }
    }
  }
  // un SPU: { x, y, w, h, pixel (un byte per punto, 0-3; null = nessuna immagine), colori e alfa (i 4 valori), inizio e
  // fine in ms dal suo tempo (-1 = non detto), forzato }. null = rotto. Mai oltre MAX_PIXEL_SPU punti
  function spuDecodifica(b) {
    if (!b || b.length < 8) return null;
    var dim = Math.min(b.readUInt16BE(0), b.length), tab = b.readUInt16BE(2);
    if (dim < 8 || tab < 4 || tab + 4 > dim) return null; // (0 = SPU "HD" con indirizzi a 4 byte: non si legge)
    var out = { x: 0, y: 0, w: 0, h: 0, pixel: null, colori: [0, 1, 2, 3], alfa: [0, 15, 15, 15], inizio: -1, fine: -1, forzato: false };
    var o1 = -1, o2 = -1, x2 = -1, y2 = -1, pos = tab, giri = 0;
    while (pos + 4 <= dim && giri++ < 64) {
      var ms = Math.round(b.readUInt16BE(pos) * 1024 / 90), dopo = b.readUInt16BE(pos + 2), i = pos + 4, basta = false;
      while (i < dim && !basta) {
        var c = b[i++];
        if (c === 0x00 || c === 0x01) { if (c === 0) out.forzato = true; if (out.inizio < 0) out.inizio = ms; }
        else if (c === 0x02) { if (out.fine < 0) out.fine = ms; }
        else if (c === 0x03 || c === 0x04) {
          if (i + 2 > dim) return null;
          var q = [b[i + 1] & 15, b[i + 1] >> 4, b[i] & 15, b[i] >> 4];
          if (c === 0x03) out.colori = q; else out.alfa = q;
          i += 2;
        } else if (c === 0x05) {
          if (i + 6 > dim) return null;
          out.x = (b[i] << 4) | (b[i + 1] >> 4); x2 = ((b[i + 1] & 15) << 8) | b[i + 2];
          out.y = (b[i + 3] << 4) | (b[i + 4] >> 4); y2 = ((b[i + 4] & 15) << 8) | b[i + 5];
          i += 6;
        } else if (c === 0x06) {
          if (i + 4 > dim) return null;
          o1 = b.readUInt16BE(i); o2 = b.readUInt16BE(i + 2);
          i += 4;
        } else if (c === 0x07) { // cambi di colore a meta' (raro): si salta
          if (i + 2 > dim || b.readUInt16BE(i) < 2) return null;
          i += b.readUInt16BE(i);
        } else basta = true; // 0xff = fine dei comandi (o un comando sconosciuto)
      }
      if (dopo <= pos) break; // l'ultima sequenza punta a se stessa; all'indietro non si torna
      pos = dopo;
    }
    if (o1 >= 4 && o2 >= 4 && o1 < dim && o2 < dim && x2 >= out.x && y2 >= out.y) {
      out.w = x2 - out.x + 1;
      out.h = y2 - out.y + 1;
      if (out.w * out.h > MAX_PIXEL_SPU) return null;
      out.pixel = nuovo(out.w * out.h);
      out.pixel.fill(0);
      // i dati delle immagini stanno prima della tabella dei comandi
      corseSpu(b, o1, o1 < tab ? tab : dim, out.pixel, out.w, out.h, 0);
      corseSpu(b, o2, o2 < tab ? tab : dim, out.pixel, out.w, out.h, 1);
    }
    return out;
  }
  // un colore RGB nei valori della palette PGS: Y, Cr, Cb (BT.709, gamma TV), come li rilegge pgs.js
  function yccDi(rgb) {
    var r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
    function s(x, lo, hi) { x = Math.round(x); return x < lo ? lo : x > hi ? hi : x; }
    return [s(16 + 0.1826 * r + 0.6142 * g + 0.0620 * b, 16, 235), s(128 + 0.4392 * r - 0.3989 * g - 0.0403 * b, 16, 240),
      s(128 - 0.1006 * r - 0.3386 * g + 0.4392 * b, 16, 240)];
  }
  // le corse dei PGS (un byte per punto in entrata): colore 0 e le corse lunghe con lo 0 davanti, fine riga "0 0"
  function rlePgs(px, w, h) {
    var out = nuovo(w * h * 2 + h * 2 + 16), n = 0;
    for (var y = 0; y < h; y++) {
      var x = 0, r = y * w;
      while (x < w) {
        var c = px[r + x], k = x + 1;
        while (k < w && px[r + k] === c && k - x < 16383) k++;
        var l = k - x;
        if (c === 0) {
          if (l < 64) { out[n++] = 0; out[n++] = l; } else { out[n++] = 0; out[n++] = 0x40 | (l >> 8); out[n++] = l & 255; }
        } else if (l < 3) { out[n++] = c; if (l === 2) out[n++] = c; }
        else if (l < 64) { out[n++] = 0; out[n++] = 0x80 | l; out[n++] = c; }
        else { out[n++] = 0; out[n++] = 0xc0 | (l >> 8); out[n++] = l & 255; out[n++] = c; }
        x = k;
      }
      out[n++] = 0;
      out[n++] = 0;
    }
    return copia(out.slice(0, n));
  }
  // un display set PGS come i blocchi del MKV (tipo, lunghezza, dati): composizione, finestra, palette, oggetto (in pezzi
  // da 64 KB se serve), fine. o = null: una composizione vuota, che toglie il sottotitolo di prima
  function displaySetPgs(L, A, o) {
    var parti = [];
    function seg(tipo, dati) { var t = nuovo(3); t[0] = tipo; t.writeUInt16BE(dati.length, 1); parti.push(t, dati); }
    var pcs = nuovo(o ? 19 : 11);
    pcs.fill(0);
    pcs.writeUInt16BE(L, 0); pcs.writeUInt16BE(A, 2); pcs[4] = 0x10; pcs[7] = 0x80; pcs[10] = o ? 1 : 0;
    if (o) { pcs.writeUInt16BE(o.x, 15); pcs.writeUInt16BE(o.y, 17); }
    seg(0x16, pcs);
    if (o) {
      var wds = nuovo(10);
      wds[0] = 1; wds[1] = 0; wds.writeUInt16BE(o.x, 2); wds.writeUInt16BE(o.y, 4); wds.writeUInt16BE(o.w, 6); wds.writeUInt16BE(o.h, 8);
      seg(0x17, wds);
      var pds = nuovo(22), i;
      pds[0] = 0; pds[1] = 0;
      for (i = 0; i < 4; i++) {
        var ycc = yccDi(o.rgb[i]);
        pds[2 + i * 5] = i; pds[3 + i * 5] = ycc[0]; pds[4 + i * 5] = ycc[1]; pds[5 + i * 5] = ycc[2]; pds[6 + i * 5] = (o.alfa[i] & 15) * 17;
      }
      seg(0x14, pds);
      var at = 0, primo = true, tot = o.rle.length + 4;
      do {
        var q = Math.min(primo ? 65535 - 11 : 65535 - 4, o.rle.length - at), testa = nuovo(primo ? 11 : 4);
        testa[0] = 0; testa[1] = 0; testa[2] = 0; testa[3] = (primo ? 0x80 : 0) | (at + q >= o.rle.length ? 0x40 : 0);
        if (primo) { testa[4] = (tot >> 16) & 255; testa[5] = (tot >> 8) & 255; testa[6] = tot & 255; testa.writeUInt16BE(o.w, 7); testa.writeUInt16BE(o.h, 9); }
        seg(0x15, Buffer.concat([testa, o.rle.slice(at, at + q)]));
        at += q;
        primo = false;
      } while (at < o.rle.length);
    }
    seg(0x80, nuovo(0));
    return Buffer.concat(parti);
  }
  // senza palette: grigi dal piu' scuro al bianco nell'ordine dei colori usati (come guess_palette di ffmpeg)
  var GRIGI = [[255], [0, 255], [0, 128, 255], [0, 85, 170, 255]];
  // un SPU -> { inizio, durata (ms, -1 = fino al prossimo), pgs } per l'app, come un evento PGS. aspetto: larghezza/altezza
  // del video come si vede: per un DVD 4:3 la tela si allarga (sullo schermo 16:9 l'immagine sta al centro), cosi' i
  // sottotitoli non si stirano
  function vobsubInPgs(spu, intest, aspetto) {
    var s = spuDecodifica(spu), i;
    if (!s) return null;
    intest = intest || {};
    var W = intest.w || 720, H = intest.h || 576, L = W, dx = 0, o = null;
    if (aspetto > 0.5 && aspetto < 16 / 9 - 0.05) { L = Math.round(W * 16 / 9 / aspetto); dx = Math.round((L - W) / 2); }
    if (s.pixel) {
      var rgb = [0, 0, 0, 0];
      if (intest.palette) for (i = 0; i < 4; i++) rgb[i] = intest.palette[s.colori[i]] || 0;
      else {
        var usati = [];
        for (i = 0; i < 4; i++) if (s.alfa[i] && usati.indexOf(s.colori[i]) === -1) usati.push(s.colori[i]);
        for (i = 0; i < 4; i++) if (s.alfa[i]) rgb[i] = GRIGI[usati.length - 1][usati.indexOf(s.colori[i])] * 65793;
      }
      o = { x: s.x + dx, y: s.y, w: s.w, h: s.h, rgb: rgb, alfa: s.alfa, rle: rlePgs(s.pixel, s.w, s.h) };
      s.pixel = null;
    }
    var inizio = Math.max(0, s.inizio);
    return { inizio: inizio, durata: s.fine > inizio ? s.fine - inizio : -1, forzato: s.forzato,
      pgs: displaySetPgs(Math.min(4096, Math.max(L, o ? o.x + o.w : 0)), Math.min(4096, Math.max(H, o ? o.y + o.h : 0)), o) };
  }
  // un .idx di VobSub: l'intestazione e, per ogni lingua ("id: it, index: 1"), i tempi (ms) e le posizioni nel .sub. A fette
  // (15 ms, al massimo 2 s di lavoro), al massimo 32 lingue e MAX_EVENTI righe per lingua; le lingue senza righe si tolgono
  function leggiIdx(testo, cb) {
    var righe = String(testo || '').split('\n'), out = { intest: intestazioneIdx(testo), lingue: [] }, cur = null, k = 0, spesi = 0, ritardo = 0;
    var RE_ID = /^\s*id\s*:\s*([A-Za-z\-]{0,8})\s*,\s*index\s*:\s*(\d{1,2})/i;
    var RE_T = /^\s*(timestamp|delay)\s*:\s*(-?)(\d{1,3}):(\d{1,2}):(\d{1,2}):(\d{1,3})(?:\s*,\s*filepos\s*:\s*([0-9a-f]{1,12}))?/i;
    function riga(r) {
      var m = RE_ID.exec(r);
      if (m) {
        cur = out.lingue.length < 32 ? { id: m[1].toLowerCase(), indice: +m[2], t: [], pos: [] } : null;
        if (cur) out.lingue.push(cur);
        ritardo = 0;
        return;
      }
      if (!cur || !(m = RE_T.exec(r))) return;
      var t = (((+m[3]) * 60 + (+m[4])) * 60 + (+m[5])) * 1000 + (+m[6]);
      if (m[2]) t = -t;
      if (/^delay$/i.test(m[1])) { ritardo += t; return; }
      if (m[7] === undefined || cur.t.length >= MAX_EVENTI) return;
      cur.t.push(t + ritardo + out.intest.scostamento);
      cur.pos.push(parseInt(m[7], 16));
    }
    (function fetta() {
      var t0 = Date.now();
      while (k < righe.length && Date.now() - t0 < 15) for (var g = 0; g < 64 && k < righe.length; g++) riga(righe[k++].slice(0, 300));
      spesi += Date.now() - t0;
      if (k < righe.length && spesi < 2000) { setImmediate(fetta); return; }
      out.lingue = out.lingue.filter(function (l) { return l.t.length > 0; });
      out.lingue.forEach(function (l) {
        for (var i = 1; i < l.t.length; i++) {
          if (l.t[i] >= l.t[i - 1]) continue;
          // fuori ordine (raro): si ordinano le coppie
          var c = l.t.map(function (x, j) { return [x, l.pos[j]]; }).sort(function (a, b) { return a[0] - b[0]; });
          l.t = c.map(function (x) { return x[0]; });
          l.pos = c.map(function (x) { return x[1]; });
          break;
        }
      });
      cb(out);
    })();
  }
  // i pezzi di un SPU nei pacchetti MPEG-PS di un .sub (flusso privato 1, sottoflusso idSub = 0x20 + indice della lingua).
  // st = { parti, preso, dimSpu } si riempie; torna quanti byte di b sono pacchetti interi gia' guardati, -1 = non e' PS
  function pezziSpu(b, idSub, st) {
    var i = 0;
    while (i + 6 <= b.length && (st.dimSpu < 0 || st.preso < st.dimSpu)) {
      if (b[i] !== 0 || b[i + 1] !== 0 || b[i + 2] !== 1) return -1;
      var sid = b[i + 3];
      if (sid === 0xba) {
        if (i + 14 > b.length) break;
        i += (b[i + 4] & 0xc0) === 0x40 ? 14 + (b[i + 13] & 7) : 12;
        continue;
      }
      if (sid === 0xb9) { i += 4; continue; }
      if (sid < 0xbb) return -1;
      var fine = i + 6 + b.readUInt16BE(i + 4);
      if (fine > b.length) break;
      if (sid === 0xbd && fine > i + 9) {
        var h = i + 6;
        if ((b[h] & 0xc0) === 0x80) h += 3 + b[h + 2]; // PES di MPEG-2
        else { // PES di MPEG-1: riempimento, STD, PTS/DTS
          while (h < fine && b[h] === 0xff) h++;
          if (h < fine && (b[h] & 0xc0) === 0x40) h += 2;
          if (h < fine) h += (b[h] & 0xf0) === 0x20 ? 5 : (b[h] & 0xf0) === 0x30 ? 10 : 1;
        }
        if (h < fine && b[h] === idSub) {
          var pezzo = b.slice(h + 1, fine);
          if (st.dimSpu < 0) {
            if (pezzo.length < 2 || pezzo.readUInt16BE(0) < 8) return -1;
            st.dimSpu = pezzo.readUInt16BE(0);
          }
          st.parti.push(copia(pezzo));
          st.preso += pezzo.length;
        }
      }
      i = fine;
    }
    return i;
  }
  // un display set di un .sup (segmenti "PG" + PTS + DTS + tipo + lunghezza) come un blocco PGS del MKV: via i 10 byte davanti
  function supInBlocco(b) {
    var parti = [], i = 0;
    while (i + 13 <= b.length && b[i] === 0x50 && b[i + 1] === 0x47) {
      var n = b.readUInt16BE(i + 11);
      if (i + 13 + n > b.length) break;
      parti.push(b.slice(i + 10, i + 13 + n));
      i += 13 + n;
    }
    return parti.length ? Buffer.concat(parti) : null;
  }
  // l'intestazione di un AVI (RIFF > hdrl > avih): larghezza e altezza, per la forma dei sottotitoli dei DVD accanto
  function misureAvi(b) {
    if (!b || b.length < 72 || b.toString('binary', 0, 4) !== 'RIFF' || b.toString('binary', 8, 12) !== 'AVI ' || b.toString('binary', 24, 28) !== 'avih') return null;
    var w = b.readUInt32LE(64), h = b.readUInt32LE(68);
    return w > 0 && h > 0 && w < 10000 && h < 10000 ? { w: w, h: h } : null;
  }

  /* ============================================================ dischi copiati: Blu-ray (BDMV) e DVD (VIDEO_TS)
   * Le playlist dei Blu-ray (.mpls) dicono di quali clip .m2ts e' fatto un titolo, con entrata e uscita (45 kHz), capitoli
   * e flussi; gli IFO dei DVD (VTS_xx_0.IFO) dicono video, lingue, durata e capitoli del programma piu' lungo. Le parti di
   * un titolo si servono in fila come un file solo (fsUnito), senza copiare niente. */

  var BD_VIDEO = { 1: 'MPEG1', 2: 'MPEG2', 0x1b: 'AVC', 0x20: 'AVC', 0x24: 'HEVC', 0xea: 'VC1' };
  var BD_AUDIO = { 3: 'MP2', 4: 'MP2', 0x80: 'PCM', 0x81: 'AC3', 0x82: 'DTS', 0x83: 'TRUEHD', 0x84: 'EAC3', 0x85: 'DTS', 0x86: 'DTS', 0xa1: 'EAC3', 0xa2: 'DTS' };
  var BD_MISURE = { 1: [720, 480], 2: [720, 576], 3: [720, 480], 4: [1920, 1080], 5: [1280, 720], 6: [1920, 1080], 7: [720, 576], 8: [3840, 2160] };
  // i flussi (STN) di una voce della playlist: il primo video, gli audio e i sottotitoli PGS con le lingue
  function flussiStn(b, s, z, angoli, out) {
    var q = s + 32, g, k;
    if (angoli) { if (q + 2 > z) return; q += 2 + Math.max(0, b[q] - 1) * 10; }
    if (q + 16 > z) return;
    var conta = [b[q + 4], b[q + 5], b[q + 6]], i = q + 16;
    for (g = 0; g < 3; g++) {
      for (k = 0; k < conta[g]; k++) {
        if (i + 1 > z) return;
        i += 1 + b[i]; // stream_entry
        if (i + 1 > z) return;
        var la = b[i], a = i + 1, tipo = b[a];
        i = a + la; // stream_attributes
        if (la < 1 || i > z) return;
        if (g === 0) { if (!out.video) out.video = { codec: BD_VIDEO[tipo] || '?', misure: la > 1 ? BD_MISURE[b[a + 1] >> 4] || null : null, hdr: tipo === 0x24 && la > 2 && (b[a + 2] >> 4) > 0 }; }
        else if (g === 1) { if (out.audio.length < 32) out.audio.push({ codec: BD_AUDIO[tipo] || '?', lingua: la >= 5 ? b.toString('binary', a + 2, a + 5) : '' }); }
        else if ((tipo === 0x90 || tipo === 0x92) && out.pg.length < 32) {
          var dl = tipo === 0x92 ? 2 : 1;
          out.pg.push({ lingua: la >= dl + 3 ? b.toString('binary', a + dl, a + dl + 3) : '' });
        }
      }
    }
  }
  // una playlist dei Blu-ray (.mpls; .mpl negli AVCHD): le voci (clip, entrata e uscita a 45 kHz, giuntura cc: 1 = non
  // continua), la durata, i capitoli (segni di tipo 1) e i flussi della prima voce. null = non e' una playlist
  function leggiMpls(b) {
    if (!b || b.length < 40 || b.toString('binary', 0, 4) !== 'MPLS') return null;
    var pl = b.readUInt32BE(8), mk = b.readUInt32BE(12), out = { voci: [], capitoli: [], durata: 0, video: null, audio: [], pg: [] }, k;
    if (pl < 40 || pl + 10 > b.length) return null;
    var n = b.readUInt16BE(pl + 6), i = pl + 10;
    for (k = 0; k < n && k < 999; k++) {
      if (i + 2 > b.length) break;
      var s = i + 2, z = s + b.readUInt16BE(i);
      if (z - s < 20 || z > b.length) break;
      var v = { clip: b.toString('binary', s, s + 5), cc: b[s + 10] & 15, entra: b.readUInt32BE(s + 12), esce: b.readUInt32BE(s + 16) };
      out.voci.push(v);
      if (v.esce > v.entra) out.durata += v.esce - v.entra;
      if (k === 0) flussiStn(b, s, z, (b[s + 10] & 16) !== 0, out);
      i = z;
    }
    if (!out.voci.length) return null;
    if (mk >= 40 && mk + 6 <= b.length) {
      var nm = b.readUInt16BE(mk + 4), j = mk + 6, inizi = [], acc = 0, visti = {};
      for (k = 0; k < out.voci.length; k++) { inizi.push(acc); acc += Math.max(0, out.voci[k].esce - out.voci[k].entra); }
      for (k = 0; k < nm && k < 999 && j + 14 <= b.length; k++, j += 14) {
        var vi = b.readUInt16BE(j + 2);
        if (b[j + 1] !== 1 || vi >= out.voci.length) continue;
        var t = inizi[vi] + b.readUInt32BE(j + 4) - out.voci[vi].entra, sec = Math.round(t / 45) / 1000;
        if (t >= 0 && t <= acc && !visti[sec] && out.capitoli.length < 300) { visti[sec] = true; out.capitoli.push({ t: sec, nome: '' }); }
      }
      out.capitoli.sort(function (x, y) { return x.t - y.t; });
    }
    return out;
  }
  function bcd(x) { return (x >> 4) * 10 + (x & 15); }
  // un tempo dei DVD: ore, minuti, secondi, fotogrammi in BCD (gli ultimi 2 bit: 25 o 30 fotogrammi al secondo)
  function tempoBcd(b, i) {
    var f = b[i + 3] >> 6, fps = f === 3 ? 30 : f === 1 ? 25 : 0;
    return bcd(b[i]) * 3600 + bcd(b[i + 1]) * 60 + bcd(b[i + 2]) + (fps ? bcd(b[i + 3] & 0x3f) / fps : 0);
  }
  // i capitoli di un programma (PGC): l'inizio della cella d'entrata di ogni parte
  function capitoliPgc(b, pg) {
    var np = b[pg + 2], nc = b[pg + 3], om = b.readUInt16BE(pg + 0xe6), oc = b.readUInt16BE(pg + 0xe8), out = [];
    if (!np || !nc || !om || !oc || pg + om + np > b.length || pg + oc + nc * 24 > b.length) return out;
    var inizio = [], t = 0, c, p;
    for (c = 0; c < nc; c++) { inizio.push(t); t += tempoBcd(b, pg + oc + c * 24 + 4); }
    for (p = 0; p < np && out.length < 99; p++) {
      var e = b[pg + om + p] - 1;
      if (e >= 0 && e < nc && (!out.length || inizio[e] > out[out.length - 1].t)) out.push({ t: Math.round(inizio[e] * 1000) / 1000, nome: '' });
    }
    return out;
  }
  // un VTS_xx_0.IFO dei DVD: video (MPEG-1/2, PAL o NTSC, 4:3 o 16:9), lingue di audio e sottotitoli, durata e capitoli del
  // programma (PGC) piu' lungo. null = non e' un IFO
  var DVD_AUDIO = ['AC3', '?', 'MP2', 'MP2', 'PCM', '?', 'DTS', '?'];
  function leggiIfo(b) {
    if (!b || b.length < 0x400 || b.toString('binary', 0, 12) !== 'DVDVIDEO-VTS') return null;
    var va = b.readUInt16BE(0x200), ris = (va >> 2) & 3, pal = ((va >> 12) & 3) === 1, i, x;
    var out = { mpeg: (va >> 14) & 3, largh: [720, 704, 352, 352][ris], alt: (pal ? 576 : 480) / (ris === 3 ? 2 : 1),
      aspetto: ((va >> 10) & 3) === 3 ? 16 / 9 : 4 / 3, audio: [], sotto: [], durata: 0, capitoli: [] };
    var na = Math.min(8, b.readUInt16BE(0x202)), ns = Math.min(32, b.readUInt16BE(0x254));
    for (i = 0; i < na; i++) { x = 0x204 + i * 8; out.audio.push({ codec: DVD_AUDIO[b[x] >> 5], lingua: ((b[x] >> 2) & 3) === 1 ? b.toString('binary', x + 2, x + 4) : '', canali: (b[x + 1] & 7) + 1 }); }
    for (i = 0; i < ns; i++) { x = 0x256 + i * 6; out.sotto.push({ lingua: (b[x] & 3) === 1 ? b.toString('binary', x + 2, x + 4) : '' }); }
    var it = b.readUInt32BE(0xcc) * 2048;
    if (it > 0 && it + 8 <= b.length) {
      var n = b.readUInt16BE(it), meglio = -1, lunga = -1;
      for (i = 0; i < n && i < 512; i++) {
        var sp = it + 8 + i * 8;
        if (sp + 8 > b.length) break;
        var pg = it + b.readUInt32BE(sp + 4);
        if (pg + 0xec > b.length) continue;
        var d = tempoBcd(b, pg + 4);
        if (d > lunga) { lunga = d; meglio = pg; }
      }
      if (meglio >= 0) { out.durata = Math.round(lunga * 1000) / 1000; out.capitoli = capitoliPgc(b, meglio); }
    }
    return out;
  }
  // piu' file letti come uno solo (le clip di un Blu-ray, i VOB di un DVD), con open, read e close come quelli di Node.
  // Una lettura sta dentro un file (alla giuntura si ferma: leggi() continua dal file dopo); un file aperto per volta per
  // ogni lettura in corso (servi legge un pezzo alla volta)
  function fsUnito(fsVero, parti) {
    var inizi = [], tot = 0, aperti = {}, prossimo = 1, i;
    for (i = 0; i < parti.length; i++) { inizi.push(tot); tot += parti[i].dim; }
    function quale(pos) {
      var lo = 0, hi = parti.length - 1, r = 0;
      while (lo <= hi) { var m = (lo + hi) >> 1; if (inizi[m] <= pos) { r = m; lo = m + 1; } else hi = m - 1; }
      return r;
    }
    function chiudiParte(x) { if (x.fd !== null) { fsVero.close(x.fd, function () {}); x.fd = null; x.k = -1; } }
    function finita(x) { x.occ--; if (x.via && !x.occ) chiudiParte(x); }
    return {
      dim: tot,
      open: function (p, modo, cb) { var id = prossimo++; aperti[id] = { k: -1, fd: null, occ: 0, via: false }; setImmediate(function () { cb(null, id); }); },
      read: function (id, buf, off, len, pos, cb) {
        var x = aperti[id];
        if (!x) { setImmediate(function () { cb(errore('assente', 'file chiuso')); }); return; }
        if (pos >= tot || len <= 0) { setImmediate(function () { cb(null, 0, buf); }); return; }
        var k = quale(pos), dentro = pos - inizi[k], n = Math.min(len, parti[k].dim - dentro);
        if (x.k === k && x.fd !== null) { x.occ++; fsVero.read(x.fd, buf, off, n, dentro, function (e, l, b) { finita(x); cb(e, l, b); }); return; }
        if (x.occ) { // un'altra lettura e' in corso su un'altra parte: questa con un file suo
          fsVero.open(parti[k].percorso, 'r', function (e, fd) {
            if (e) { cb(e); return; }
            fsVero.read(fd, buf, off, n, dentro, function (e2, l, b) { fsVero.close(fd, function () {}); cb(e2, l, b); });
          });
          return;
        }
        chiudiParte(x);
        x.occ++;
        fsVero.open(parti[k].percorso, 'r', function (e, fd) {
          if (e) { finita(x); cb(e); return; }
          if (x.via) { fsVero.close(fd, function () {}); finita(x); cb(errore('assente', 'file chiuso')); return; }
          x.fd = fd;
          x.k = k;
          fsVero.read(fd, buf, off, n, dentro, function (e2, l, b) { finita(x); cb(e2, l, b); });
        });
      },
      close: function (id, cb) {
        var x = aperti[id];
        delete aperti[id];
        if (x) { x.via = true; if (!x.occ) chiudiParte(x); }
        if (cb) setImmediate(function () { cb(null); });
      }
    };
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
    // le letture dal file: 512 KB (le prove lo fanno piccolo, per avere tanti pezzi in viaggio sulla rete lenta)
    var bloccoFile = o.blocco > 0 ? o.blocco : BLOCCO;
    // i codec che il TV legge: dal profilo del TV (profilo.js), che il servizio conosce strada facendo
    function lettiOra() { var x = typeof o.letti === 'function' ? o.letti() : o.letti; return x && x.audio && x.video ? x : LETTI; }
    // l'audio DTS e TrueHD convertito dal TV (tv-sito/audio-tv.js): se c'e' e il TV regge, per questo file quelle tracce
    // si leggono ("tv")
    var audioTv = o.audioTv || null;
    function lettiDi(f) { var l = lettiOra(); return audioTv && f && f.m ? audioTv.letti(l, f) : l; }
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
              dischiInCartella(dove, out, function () { // le cartelle dei dischi copiati passano tra i video
                out.cartelle.sort(function (a, b) { return confrontaNomi(a.nome, b.nome); });
                out.video.sort(function (a, b) { return confrontaNomi(a.nome, b.nome); });
                out.sotto.sort(function (a, b) { return confrontaNomi(a.nome, b.nome); });
                unisciVersioniTv(out);
                cb(null, out);
              });
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

    // la "versione TV" che il limitatore del Mac scrive accanto al film ("<nome> [TV 80].mkv", senza i picchi oltre il
    // tetto): non e' un film in piu', e' un modo di guardare lo stesso. Va dentro la voce del film (l'app la sceglie da
    // sola); se il film vero non c'e', resta un video come gli altri
    var VERSIONE_TV = /^(.+) \[TV (\d{1,4})(?: [0-9a-f]{6})?\]\.mkv$/i;
    function unisciVersioniTv(out) {
      var per = Object.create(null), i, m, resto = []; // senza prototipo: un file "__proto__.mkv" e' un nome come gli altri
      for (i = 0; i < out.video.length; i++) if (!out.video[i].disco) per[out.video[i].nome.replace(/\.[^.]+$/, '').toLowerCase()] = out.video[i];
      for (i = 0; i < out.video.length; i++) {
        var v = out.video[i], o = (m = VERSIONE_TV.exec(v.nome)) ? per[m[1].toLowerCase()] : null;
        if (o && typeof o === 'object' && o !== v && !VERSIONE_TV.test(o.nome)) {
          if (!o.tv || +m[2] < o.tv.tetto) o.tv = { nome: v.nome, dim: v.dim, data: v.data, tetto: +m[2] };
        } else resto.push(v);
      }
      out.video = resto;
    }

    // un file della chiavetta: la struttura si legge una volta sola (finche' dimensione e data non cambiano)
    function apri(d, p, cb) {
      risolvi(d, p, function (err, dove, parti) {
        if (err) { cb(err); return; }
        // solo i video: il permesso non apre documenti e foto della chiavetta
        if (!EST_VIDEO.test(dove)) { apriDisco(dove, parti, cb); return; } // una cartella puo' essere un disco copiato
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
      apri(d, p, function (err, f) { if (err) cb(err); else infoDi(f, scelte, function (e2, out) { if (e2) cb(e2); else infoAccanto(f, out, cb); }); });
    }
    function infoDi(f, scelte, cb) {
      var m = f.m, out = { nome: f.nome, dim: f.dim, data: f.data, formato: m ? m.formato : f.est, durata: m ? m.durata : 0,
        titolo: m ? m.titolo : '', video: null, audio: [], sotto: [], capitoli: m ? m.capitoli : [], avvisi: [] };
      if (!m) {
        out.avvisi.push(f.guasto ? 'struttura' : 'sconosciuto');
        cb(null, out);
        return;
      }
      // DTS o TrueHD: prima la misura della velocita' del TV (una volta sola), poi la traccia scelta preparata
      if (audioTv && audioTv.attendi(f, lettiOra(), function () { infoDi(f, scelte, cb); })) return;
      var letti = lettiDi(f), pi = piano(m, scelte, letti);
      if (pi.converti && !audioTv.pronta(f, pi.converti)) { audioTv.prepara(f, pi, function () { infoDi(f, scelte, cb); }); return; }
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
          var lg = leggibile(t, letti);
          base.canali = (t.audio || {}).canali || 0;
          base.commento = !!t.commento;
          base.letto = !!lg && !t.cifrata;
          if (lg === 'tv') base.tv = true; // la converte il TV in Dolby Digital (AC3)
          out.audio.push(base);
        } else if (t.tipo === 17) {
          base.udito = !!t.udito;
          base.immagini = fam === 'PGS' || fam === 'VOBSUB';
          base.leggibile = fam === 'SRT' || fam === 'ASS' || fam === 'VTT' || fam === 'PGS' || fam === 'VOBSUB';
          out.sotto.push(base);
        }
      }
      out.scelta = { audio: pi.audio };
      var sa = audioTv ? audioTv.stato(f, lettiOra()) : null;
      if (sa) out.audioTv = sa; // DTS o TrueHD nel file: il TV li converte? { stato: pronto | lento | spento | misura | rotto }
      if (pi.senzaAudio) out.avvisi.push('audio');
      if (out.video && !out.video.letto) out.avvisi.push('video');
      // Dolby Vision senza una base che il TV legge (profilo 5: compatibilita' 0). I TV senza Dolby Vision (tutti i Samsung)
      // lo mostrerebbero coi colori sbagliati, viola e verdi. Con la base HDR10, HLG o SDR (profili 7, 8 e 4) usano quella
      if (out.video && out.video.dv && out.video.dv.compatibile === 0 && !letti.video.DV) out.avvisi.push('colori');
      if (out.durata > 0) out.mbps = Math.round(f.dim * 8 / out.durata / 1e5) / 10;
      out.picchi = picchiDi(m.ritmo, scelte && scelte.tetto >= 1 && scelte.tetto <= 1000 ? scelte.tetto : 80);
      cb(null, out);
    }

    function sottoTracce(f) {
      var out = {}, m = f.m;
      if (!m || m.formato === 'mp4') return out;
      for (var i = 0; i < m.tracce.length; i++) {
        var t = m.tracce[i], fam = famiglia(t.codec);
        if (t.tipo === 17 && (fam === 'SRT' || fam === 'ASS' || fam === 'VTT' || fam === 'PGS' || fam === 'VOBSUB') && !t.cifrata) out[t.num] = t;
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
    // i byte di un evento da soli: uno spezzone di un blocco letto piu' grande (4 KB per un "togli" PGS di 50 byte) lo terrebbe
    // in memoria tutto, fuori dal conto di pesoEv
    function soloSuoi(b) {
      if (!b.buffer || b.buffer.byteLength <= b.length + 1024) return b;
      var c = typeof Buffer.allocUnsafeSlow === 'function' ? Buffer.allocUnsafeSlow(b.length) : nuovo(b.length);
      b.copy(c);
      return c;
    }
    function pesoEv(e) { return e.pgs ? e.pgs.length + 64 : e.x.length * 2 + 64; }
    // un evento in ordine di tempo, senza doppioni; i PGS restano byte (in base64 solo quando si mandano)
    function aggiungiSotto(f, num, t, ev, dati) {
      if (!f.sottoAttive || f.sottoAttive[num] !== t || aperti[f.percorso] !== f) return; // nel frattempo cambiata o dimenticata
      var fam = famiglia(t.codec), s = f.sotto[num] || (f.sotto[num] = { eventi: [], chiavi: {}, byte: 0, ordinati: true });
      var chiave = ev.t + ':' + dati.length;
      if (s.chiavi[chiave]) return;
      var e;
      if (fam === 'PGS') e = { t: ev.t, d: ev.d, pgs: soloSuoi(dati) };
      else if (fam === 'VOBSUB') { e = eventoVobsub(f, t, ev, dati); if (!e) return; }
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
      if (sottoTot > MAX_SOTTO_TOT || s.eventi.length > MAX_EVENTI) sfoltisci(f, num, s, fam === 'PGS' || fam === 'VOBSUB' ? FINESTRA_PGS : FINESTRA_TESTO);
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
        if (fs.aSalti) fs.aSalti(fd);
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
      apri(d, p, function (err, f) { if (err) cb(err); else sottoOAccanto(f, num, da, cb, dopo); });
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
      var W = /^(PGS|VOBSUB)$/.test(famiglia(tr.codec)) ? FINESTRA_PGS : FINESTRA_TESTO, k = Math.floor(da / W);
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
      // i 60 s prima (un PGS iniziato prima resta sullo schermo) solo se la finestra di prima non e' gia' letta
      var prima = f.cuesFatte[num + ':' + (k - 1)] === true;
      daCues(f, num, prima ? k * W : Math.max(0, k * W - 60000), (k + 1) * W, function (fatto) {
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
      var pi = m ? piano(m, scelte, lettiDi(f)) : null;
      // l'audio da convertire: la prima volta la traccia si prepara (Tracks nuova, il primo frame), poi si ricomincia
      if (pi && pi.converti && !audioTv.pronta(f, pi.converti)) { audioTv.prepara(f, pi, function () { serviF(req, res, f, scelte); }); return; }
      if (pi && pi.converti) pi.tracksNuove = audioTv.fisse(f, pi.converti);
      var fisse = m && pi ? modificheFisse(m, pi) : [];
      var subT = m && m.formato !== 'mp4' ? sottoTracce(f) : {};
      var scansiona = !!(m && m.formato !== 'mp4' && m.cluster1 > 0 && !f.scansioneRotta && (pi.quante || Object.keys(subT).length));
      var testa = { 'Content-Type': f.tipo, 'Accept-Ranges': 'bytes', 'Content-Length': String(z - a + 1),
        'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
      if (r) testa['Content-Range'] = 'bytes ' + a + '-' + z + '/' + dim;
      res.writeHead(r ? 206 : 200, testa);
      if (req.method === 'HEAD') { res.end(); return; }
      f.usato = Date.now();
      if (pi && pi.converti) {
        // la traccia diventa AC3 mentre passa: legge, scansiona e manda audio-tv.js (stessa scansione, stessi confini)
        audioTv.servi(req, res, f, pi, { a: a, z: z, fisse: fisse, blocco: bloccoFile, confinePrima: confinePrima,
          scansione: function () {
            return new Scansione(m, pi.nascoste, attiveDi(f), function (num, ev) { nuovoSotto(f, num, ev); }, function (pos) { nuovoConfine(m, pos); });
          } });
        return;
      }

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
      // i blocchi di questa risposta si riusano: prima ogni lettura ne faceva uno nuovo, e durante un film restavano
      // +58-76 MB di Buffer morti finche' V8 non li raccoglieva. Un blocco torna libero solo quando la rete ha preso tutto
      // quello che e' partito da lui (il callback di res.write: sulla rete lenta i byte aspettano nella coda del socket,
      // senza copia) e nessun pezzo sospeso lo guarda. Di solito due; se sono tutti in viaggio uno in piu', fino a tre,
      // poi uno a perdere come prima
      var blocchi = [];
      function bloccoLibero(n) {
        for (var i = 0; i < blocchi.length; i++) {
          if (!blocchi[i].attese && !(sospeso && nelBlocco(sospeso, blocchi[i].b))) return blocchi[i].b;
        }
        // una lettura piccola (un file corto, l'ultimo pezzo) non fa un blocco intero
        if (n < bloccoFile) return nuovo(n);
        var b = nuovo(bloccoFile);
        if (blocchi.length < 3) blocchi.push({ b: b, attese: 0 });
        return b;
      }
      function bloccoDi(v) {
        for (var i = 0; i < blocchi.length; i++) if (nelBlocco(v, blocchi[i].b)) return blocchi[i];
        return null;
      }
      // il lettore chiude mentre si aspetta "drain": nessuno richiamerebbe giro() e il file resterebbe aperto. Un file remoto
      // (Jellyfin) si chiude subito anche con una lettura in corso: la domanda verso il server si interrompe e la lettura si
      // sveglia con un errore (un server fermo a meta' non lascia domande aperte); quello della chiavetta quando la lettura finisce
      function staccato() {
        chiuso = true;
        if (inAttesa) { inAttesa = false; res.removeListener('drain', riparti); finisci(); }
        else if (fs.remoto) finisci();
      }
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
        if (sospeso && (sospeso.length >= bloccoFile || fermataScan)) {
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
        var n = Math.min(bloccoFile, fine - lettura);
        if (n <= 0) { manda(sospeso, sospesoPos, true); sospeso = null; finisci(); return; }
        leggiIn(fs, fd, bloccoLibero(n), lettura, n, function (e3, b) {
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
        var x = bloccoDi(dati);
        if (!x) return res.write(dati.slice(da - pos, al - pos));
        x.attese++;
        return res.write(dati.slice(da - pos, al - pos), function () { x.attese--; });
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
          try { (dir ? schedaCartellaODisco : schedaVideo)(d, dove, parti, pieno, fatto); } catch (e2) { cb(errore('formato', 'scheda non leggibile')); }
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
    // "Questo TV" e il giro di prove: il servizio vede le chiavette, le elenca, e legge davvero un film (su Tizen elencare e
    // leggere sono permessi diversi)? Col codice dell'errore vero, per capire subito il perche'. Niente nomi di file nella
    // risposta: solo stato, numeri e codici
    function prova(cb) {
      if (!radici.length) { cb({ stato: 'nonPrevisto', dischi: 0 }); return; }
      dischi(function (err, l) {
        if (err) { cb({ stato: err.codice === 'permesso' || err.codice === 'assente' ? err.codice : 'errore', dischi: 0, codice: String(err.message || '').slice(0, 20) }); return; }
        if (!l.length) { cb({ stato: 'nessuna', dischi: 0 }); return; }
        var cartelleViste = 0;
        // un video nella chiavetta: al primo livello o in una sottocartella, al massimo 8 cartelle e 400 nomi. Solo file e
        // cartelle veri (lstat): un "a.mkv" che e' una FIFO, un dispositivo o un collegamento non si apre mai (fs.open
        // resterebbe in attesa per sempre e terrebbe fermo un thread dei file del servizio)
        function cerca(dove, prof, fine) {
          fs.readdir(dove, function (e2, nomi) {
            if (e2) { fine(e2); return; }
            nomi = nomi.filter(function (x) { return !NASCOSTE.test(x); }).slice(0, 400);
            var vid = nomi.filter(function (x) { return EST_VIDEO.test(x); }).slice(0, 8), iv = 0;
            (function unVideo() {
              if (iv >= vid.length) { sotto(); return; }
              var p0 = path.join(dove, vid[iv++]);
              fs.lstat(p0, function (e5, st0) { if (!e5 && st0.isFile()) fine(null, p0); else unVideo(); });
            })();
            function sotto() {
              if (prof >= 1) { fine(null, null); return; }
              var k = 0;
              (function prossima() {
                if (k >= nomi.length || cartelleViste >= 8) { fine(null, null); return; }
                var p = path.join(dove, nomi[k++]);
                fs.lstat(p, function (e3, st) {
                  if (e3 || !st.isDirectory()) { prossima(); return; }
                  cartelleViste++;
                  cerca(p, prof + 1, function (e4, f) { if (f) fine(null, f); else prossima(); });
                });
              })();
            }
          });
        }
        cerca(l[0].percorso, 0, function (e2, file) {
          var base = { dischi: l.length };
          if (e2) { base.stato = e2.code === 'EACCES' || e2.code === 'EPERM' ? 'permesso' : 'errore'; base.codice = String(e2.code || ''); cb(base); return; }
          if (!file) { base.stato = 'ok'; base.letto = false; cb(base); return; }
          // i primi 4 KB del film, come li chiedera' il lettore
          fs.open(file, 'r', function (e5, fd) {
            if (e5) { base.stato = 'lettura'; base.codice = String(e5.code || ''); cb(base); return; }
            fs.read(fd, nuovo(4096), 0, 4096, 0, function (e6, n) {
              fs.close(fd, function () {});
              if (e6 || !n) { base.stato = 'lettura'; base.codice = String(e6 ? e6.code || 'errore' : 'vuoto'); cb(base); return; }
              base.stato = 'ok';
              base.letto = true;
              cb(base);
            });
          });
        });
      });
    }

    /* ---------------------------------------------------------- dischi copiati: cartelle Blu-ray (BDMV) e DVD (VIDEO_TS)
     * Una cartella con BDMV/index.bdmv (o VIDEO_TS/VIDEO_TS.IFO) e' UN film: nell'elenco sta tra i video, col nome della
     * cartella. Blu-ray: la playlist piu' lunga (contando una volta sola le clip ripetute), le sue clip .m2ts in fila; DVD:
     * il titolo (VTS) coi VOB piu' grandi in tutto, VTS_xx_1..n.VOB in fila. In fila = un file solo per il <video>, letto
     * dai file veri a pezzi (Range compreso), senza copiare niente. Mai collegamenti (lstat): solo file e cartelle vere
     * dentro la cartella del disco, che e' gia' dentro la chiavetta. Riconoscimento e analisi si ricordano finche' la data
     * della cartella non cambia. */

    var MAX_PLAYLIST = 1000, MAX_PARTI = 200, discoCache = {}, analisiCache = {};
    // una cartella vera (non un collegamento): i suoi nomi, o null
    function cartellaVera(p, cb) {
      fs.lstat(p, function (e, st) {
        if (e || !st.isDirectory()) { cb(null); return; }
        fs.readdir(p, function (e2, nomi) { cb(e2 ? null : nomi.slice(0, 5000)); });
      });
    }
    // un file piccolo letto tutto (playlist, IFO, .idx): mai un collegamento, al massimo "max" byte
    function leggiPiccolo(p, max, cb) {
      if (!p) { cb(null); return; }
      fs.lstat(p, function (e, st) {
        if (e || !st.isFile() || st.size > max) { cb(null); return; }
        fs.readFile(p, function (e2, b) { cb(e2 ? null : b); });
      });
    }
    // e' un disco? { tipo: 'bdmv' | 'dvd', radice: la cartella con playlist e clip (o coi VOB) } o null. Una cartella che
    // ha anche dei video suoi (trailer e sample a parte) resta una cartella (dentro, BDMV o VIDEO_TS da sole sono il disco)
    function riconosciDisco(x, cb) {
      fs.readdir(x, function (e, nomi) {
        if (e) { cb(null); return; }
        for (var i = 0; i < nomi.length; i++) {
          if (EST_VIDEO.test(nomi[i]) && !/^(video_ts|vts_\d\d_\d)\.vob$/i.test(nomi[i]) && !/(^|[\s._-])(sample|trailer)([\s._-]|$)/i.test(nomi[i])) { cb(null); return; }
        }
        if ((trovaNome(nomi, 'index.bdmv') || trovaNome(nomi, 'index.bdm')) && trovaNome(nomi, 'PLAYLIST') && trovaNome(nomi, 'STREAM')) { cb({ tipo: 'bdmv', radice: x }); return; }
        if (trovaNome(nomi, 'VIDEO_TS.IFO')) { cb({ tipo: 'dvd', radice: x }); return; }
        var bd = trovaNome(nomi, 'BDMV'), dvd = trovaNome(nomi, 'VIDEO_TS');
        function provaDvd() {
          if (!dvd) { cb(null); return; }
          cartellaVera(path.join(x, dvd), function (l) { cb(l && trovaNome(l, 'VIDEO_TS.IFO') ? { tipo: 'dvd', radice: path.join(x, dvd) } : null); });
        }
        if (!bd) { provaDvd(); return; }
        cartellaVera(path.join(x, bd), function (l) {
          if (l && (trovaNome(l, 'index.bdmv') || trovaNome(l, 'index.bdm')) && trovaNome(l, 'PLAYLIST') && trovaNome(l, 'STREAM')) cb({ tipo: 'bdmv', radice: path.join(x, bd) });
          else provaDvd();
        });
      });
    }
    function discoDi(x, data, cb) {
      var c = discoCache[x];
      if (c && c.data === data) { cb(c.esito); return; }
      riconosciDisco(x, function (esito) {
        var l = Object.keys(discoCache);
        if (l.length >= 2000) delete discoCache[l[0]];
        discoCache[x] = { data: data, esito: esito };
        cb(esito);
      });
    }
    // Blu-ray: la playlist piu' lunga (le clip ripetute contano una volta: certe playlist girano in tondo), poi meno voci,
    // poi il nome; se mancano delle clip (o sono collegamenti) la playlist dopo
    function analizzaBd(radice, cb) {
      cartellaVera(radice, function (nomi) {
        var dPl = nomi && trovaNome(nomi, 'PLAYLIST'), dSt = nomi && trovaNome(nomi, 'STREAM');
        if (!dPl || !dSt) { cb(errore('formato', 'Blu-ray senza PLAYLIST o STREAM')); return; }
        var pPl = path.join(radice, dPl), pSt = path.join(radice, dSt);
        cartellaVera(pPl, function (pl) {
          cartellaVera(pSt, function (st) {
            if (!pl || !st) { cb(errore('formato', 'Blu-ray senza PLAYLIST o STREAM')); return; }
            var nomiPl = pl.filter(function (n) { return /\.mpls?$/i.test(n); }).sort().slice(0, MAX_PLAYLIST), lette = [], k = 0;
            (function una() {
              if (k >= nomiPl.length) { scegli(); return; }
              var nome = nomiPl[k++];
              leggiPiccolo(path.join(pPl, nome), 1 << 20, function (b) {
                var m = null;
                try { m = b ? leggiMpls(b) : null; } catch (e) { m = null; }
                if (m) {
                  m.nome = nome;
                  // la durata senza le clip ripetute, subito: una playlist per volta (tra l'una e l'altra il servizio risponde)
                  var visti = Object.create(null), d = 0;
                  m.voci.forEach(function (v) { if (!visti[v.clip]) { visti[v.clip] = true; d += Math.max(0, v.esce - v.entra); } });
                  m.unica = d;
                  lette.push(m);
                }
                una();
              });
            })();
            function scegli() {
              lette.sort(function (a, b) { return (b.unica - a.unica) || (a.voci.length - b.voci.length) || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0); });
              (function prova(j) {
                if (j >= lette.length || j >= 8) { cb(errore('formato', 'nessuna playlist con le sue clip')); return; }
                var m = lette[j], parti = [], i = 0;
                if (m.voci.length > MAX_PARTI) { prova(j + 1); return; }
                (function clip() {
                  if (i >= m.voci.length) { fatto(); return; }
                  var v = m.voci[i++], nome = /^\d{5}$/.test(v.clip) ? trovaNome(st, v.clip + '.m2ts') || trovaNome(st, v.clip + '.mts') : null;
                  if (!nome) { prova(j + 1); return; }
                  var p = path.join(pSt, nome);
                  fs.lstat(p, function (e, s2) {
                    if (e || !s2.isFile() || !(s2.size > 0)) { prova(j + 1); return; }
                    // la stessa clip due volte di fila (due tratti della stessa clip): una volta sola
                    if (!parti.length || parti[parti.length - 1].percorso !== p) parti.push({ percorso: p, dim: s2.size, nome: nome });
                    clip();
                  });
                })();
                function fatto() {
                  var dim = 0, giunture = 0, x, vv = m.video;
                  for (x = 0; x < parti.length; x++) dim += parti[x].dim;
                  for (x = 1; x < m.voci.length; x++) if (m.voci[x].cc === 1) giunture++;
                  cb(null, { tipo: 'bdmv', titolo: m.nome, parti: parti, dim: dim, durata: m.durata / 45000, capitoli: m.capitoli, giunture: giunture,
                    video: vv ? { codec: vv.codec, largh: vv.misure ? vv.misure[0] : 0, alt: vv.misure ? vv.misure[1] : 0, hdr: !!vv.hdr } : null,
                    audio: m.audio, sotto: m.pg });
                }
              })(0);
            }
          });
        });
      });
    }
    // DVD: il titolo coi VOB piu' grandi in tutto (VTS_xx_0.VOB e' il menu: no); dal suo IFO video, lingue, durata e capitoli
    function analizzaDvd(radice, cb) {
      cartellaVera(radice, function (nomi) {
        if (!nomi) { cb(errore('formato', 'DVD senza VIDEO_TS')); return; }
        var titoli = {}, chiavi = [], tutte = [], j = 0;
        nomi.forEach(function (n) {
          var m = /^VTS_(\d\d)_([1-9])\.VOB$/i.exec(n);
          if (!m) return;
          if (!titoli[m[1]]) { titoli[m[1]] = []; chiavi.push(m[1]); }
          var x = { nome: n, k: +m[2], percorso: path.join(radice, n), dim: -1 };
          titoli[m[1]].push(x);
          tutte.push(x);
        });
        (function una() {
          if (j >= tutte.length) { scegli(); return; }
          var x = tutte[j++];
          fs.lstat(x.percorso, function (e, st) { x.dim = !e && st.isFile() ? st.size : -1; una(); });
        })();
        function scegli() {
          var meglio = null, tot = 0;
          chiavi.forEach(function (c) {
            var s = 0, buoni = true;
            titoli[c].forEach(function (x) { if (x.dim <= 0) buoni = false; else s += x.dim; });
            if (buoni && s > tot) { tot = s; meglio = c; } // un VOB che non si legge (o un collegamento): il titolo non vale
          });
          if (!meglio) { cb(errore('formato', 'DVD senza VOB')); return; }
          var parti = titoli[meglio].sort(function (a, b) { return a.k - b.k; }).map(function (x) { return { percorso: x.percorso, dim: x.dim, nome: x.nome }; });
          var ifo = trovaNome(nomi, 'VTS_' + meglio + '_0.IFO');
          leggiPiccolo(ifo ? path.join(radice, ifo) : '', 1 << 20, function (b) {
            var i = null;
            try { i = b ? leggiIfo(b) : null; } catch (e) { i = null; }
            cb(null, { tipo: 'dvd', titolo: 'VTS_' + meglio, parti: parti, dim: tot, durata: i ? i.durata : 0, capitoli: i ? i.capitoli : [], giunture: 0,
              video: { codec: i && i.mpeg === 0 ? 'MPEG1' : 'MPEG2', largh: i ? i.largh : 720, alt: i ? i.alt : 576, aspetto: i ? i.aspetto : 0, hdr: false },
              audio: i ? i.audio : [], sotto: i ? i.sotto : [] });
          });
        }
      });
    }
    // l'analisi di un disco, una volta sola finche' la data della sua cartella non cambia (chi chiede intanto aspetta)
    function analisiDi(esito, cb) {
      fs.lstat(esito.radice, function (e, st) {
        if (e || !st.isDirectory()) { cb(errore('assente', 'disco non trovato')); return; }
        var c = analisiCache[esito.radice];
        // (un'analisi rimasta a meta', per un errore preso dalla rete, dopo 30 s si rifa': nessuno aspetta per sempre)
        if (c && c.data === +st.mtime && !(c.attese && Date.now() - c.at > 30000)) { if (c.attese) c.attese.push(cb); else cb(c.err, c.r); return; }
        var l = Object.keys(analisiCache);
        if (l.length >= 200) delete analisiCache[l[0]];
        c = analisiCache[esito.radice] = { data: +st.mtime, at: Date.now(), attese: [cb], err: null, r: null };
        (esito.tipo === 'bdmv' ? analizzaBd : analizzaDvd)(esito.radice, function (err, r) {
          if (r && !r.parti.length) { err = errore('formato', 'disco vuoto'); r = null; }
          if (r) { r.data = +st.mtime; r.fs = fsUnito(fs, r.parti); }
          c.err = err;
          c.r = r;
          var a = c.attese;
          c.attese = null;
          for (var i = 0; i < a.length; i++) { try { a[i](err, r); } catch (x) {} }
        });
      });
    }
    // apri() di una cartella: se e' un disco, il suo titolo come un file solo (f.disco = l'analisi)
    function apriDisco(dove, parti, cb) {
      fs.lstat(dove, function (e, st) {
        if (e || !st.isDirectory()) { cb(errore('assente', 'non e\' un video')); return; }
        discoDi(dove, +st.mtime, function (esito) {
          if (!esito) { cb(errore('assente', 'non e\' un video')); return; }
          analisiDi(esito, function (err, r) {
            if (err) { cb(err); return; }
            apriF({ percorso: dove, parti: parti, nome: parti.length ? parti[parti.length - 1] : '', dim: r.dim, data: r.data,
              est: r.tipo === 'dvd' ? 'vob' : 'm2ts', fs: r.fs }, function (e2, f) {
              if (!e2 && f) f.disco = r;
              cb(e2, f);
            });
          });
        });
      });
    }
    // nell'elenco di una cartella: le sottocartelle che sono dischi passano tra i video ({ nome, dim, data, disco }).
    // Quattro alla volta; il riconoscimento si ricorda (una lettura della cartella solo la prima volta)
    function dischiInCartella(dove, out, cb) {
      var l = out.cartelle.slice(), k = 0, attivi = 0, finito = false;
      function avanti() {
        while (attivi < 4 && k < l.length) uno(l[k++]);
        if (!attivi && k >= l.length && !finito) { finito = true; cb(); }
      }
      function uno(c) {
        attivi++;
        var x = path.join(dove, c.nome);
        function poi() { attivi--; avanti(); }
        fs.lstat(x, function (e, st) {
          if (e || !st.isDirectory()) { poi(); return; } // un collegamento non si guarda dentro
          discoDi(x, +st.mtime, function (esito) {
            if (!esito) { poi(); return; }
            analisiDi(esito, function (err, r) {
              if (!err && r) {
                var i = out.cartelle.indexOf(c);
                if (i !== -1) out.cartelle.splice(i, 1);
                out.video.push({ nome: c.nome, dim: r.dim, data: r.data, disco: r.tipo });
              }
              poi();
            });
          });
        });
      }
      avanti();
    }
    // la scheda di una cartella: quella di un disco (un film) o quella di sempre
    function schedaCartellaODisco(d, dove, parti, pieno, cb) {
      fs.lstat(dove, function (e, st) {
        if (e || !st.isDirectory()) { schedaCartella(d, dove, parti, pieno, cb); return; }
        discoDi(dove, +st.mtime, function (esito) {
          if (esito) schedaDisco(dove, parti, esito, cb); else schedaCartella(d, dove, parti, pieno, cb);
        });
      });
    }
    // un disco e' un film: movie.nfo (o <cartella>.nfo) accanto, se no VIDEO_TS.nfo o index.nfo dentro (Kodi); le immagini
    // della cartella; titolo e anno dal nome della cartella (BDMV o VIDEO_TS da sole: quella sopra)
    function schedaDisco(dove, parti, esito, cb) {
      var relC = parti.join('/'), nomeC = parti.length ? parti[parti.length - 1] : '';
      var nomeT = /^(bdmv|video_ts)$/i.test(nomeC) ? (parti.length > 1 ? parti[parti.length - 2] : esito.tipo === 'dvd' ? 'DVD' : 'Blu-ray') : nomeC;
      elenco(dove, function (e, nomi) {
        if (e) { cb(errore('assente', e.code)); return; }
        var s = nuovaScheda('film', '');
        s.disco = esito.tipo;
        function conNfo(n) {
          if (n) { s.fonti.push('nfo'); riempi(s, n); }
          var im = immaginiDi(nomi, '', true, false);
          s.img = refImg(relC, im);
          if (Object.keys(im).length) s.fonti.push('immagini');
          analisiDi(esito, function (err, r) {
            if (!err && r) s.secondi = Math.round(r.durata) || 0;
            fotoCast(s.cast, dove, relC, nomi, function () {
              var dn = dalNome(nomeT);
              if (!s.titolo) { s.titolo = dn.titolo || nomeT; if (!s.anno) s.anno = dn.anno; }
              cb(null, s);
            });
          });
        }
        var nfo = trovaNome(nomi, 'movie.nfo') || trovaNome(nomi, nomeC + '.nfo');
        if (nfo) { leggiNfoIn(dove, nfo, conNfo); return; }
        elenco(esito.radice, function (e2, dentro) {
          leggiNfoIn(esito.radice, e2 ? null : trovaNome(dentro, 'VIDEO_TS.nfo') || trovaNome(dentro, 'index.nfo'), conNfo);
        });
      });
    }
    // info di un disco: formato, durata e capitoli (dalla playlist o dall'IFO), il video (e se il TV lo legge), le lingue.
    // L'audio lo sceglie il lettore del TV ('sconosciuto', come per gli altri .m2ts e .vob)
    function infoDisco(f, out) {
      var r = f.disco, letti = lettiOra(), cont = letti.contenitori || {}, v = r.video;
      out.formato = r.tipo === 'dvd' ? 'dvd' : 'blu-ray';
      out.durata = r.durata > 0 ? Math.round(r.durata * 1000) / 1000 : 0;
      out.capitoli = r.capitoli || [];
      if (v) {
        var c = v.codec, letto = !!letti.video[c] || (c === 'MPEG1' && !!letti.video.MPEG2);
        // il contenitore: MPEG-PS (DVD) e MPEG-TS (Blu-ray). Il profilo del TV oggi non li elenca (= li legge); se un giorno
        // dicesse di no, il disco compare con l'avviso "il TV non legge questo video"
        if (cont[r.tipo === 'dvd' ? 'PS' : 'TS'] === false) letto = false;
        out.video = { num: 0, ordine: 0, codec: c, nomeCodec: (NOMI[c] || (c === 'MPEG1' ? 'MPEG-1' : c)) + (r.tipo === 'dvd' ? ' (DVD)' : ''),
          largh: v.largh || 0, alt: v.alt || 0, hdr: v.hdr ? 'HDR10' : '', dv: null, bit: 0, letto: letto };
        if (!letto) out.avvisi.push('video');
      }
      out.disco = { tipo: r.tipo, titolo: r.titolo, parti: r.parti.length, giunture: r.giunture || 0,
        file: String(f.nome || 'disco').replace(/[\/\\?#]/g, '_') + (r.tipo === 'dvd' ? '.vob' : '.m2ts'),
        audio: (r.audio || []).map(function (a) { return { codec: a.codec, nomeCodec: NOMI[a.codec] || a.codec, lingua: lingua({ lingua: a.lingua }), letto: !!letti.audio[a.codec] }; }),
        sotto: (r.sotto || []).map(function (x) { return { lingua: lingua({ lingua: x.lingua }) }; }) };
      if (out.durata > 0) out.mbps = Math.round(f.dim * 8 / out.durata / 1e5) / 10;
    }

    /* ---------------------------------------------------------- sottotitoli a immagini accanto al film (.sup, .idx + .sub)
     * Con lo stesso nome del film: "Film.sup", "Film.ita.forced.sup", "Film.idx" + "Film.sub" (ogni lingua dell'.idx e'
     * una traccia). Sono tracce in piu' di info.sotto (esterno: true), coi numeri da 1000 in su (sopra quelli del file):
     * l'app le chiede con sotto?t= come le altre e le disegna come i PGS. Stesse regole degli altri file: niente
     * collegamenti, l'.idx al massimo 4 MB, il .sup e il .sub mai interi (il .sup si indicizza a pezzi solo fin dove
     * serve, del .sub si leggono i pochi KB di ogni sottotitolo); gli eventi stanno con gli altri (16 MB per tutti). */

    function numeroBase(f) {
      var mx = 0;
      if (f.m) for (var i = 0; i < f.m.tracce.length; i++) if (f.m.tracce[i].num > mx) mx = f.m.tracce[i].num;
      return Math.max(1000, mx + 1);
    }
    // le tracce accanto al film (ricordate nel file aperto; fresco = si ricontrolla se sono passati 10 s)
    function accantoDi(f, cb, fresco) {
      if (f.disco || f.fs !== fs || !f.percorso) { cb([]); return; }
      if (f.accanto && (!fresco || Date.now() - f.accanto.at < 10000)) { cb(f.accanto.tracce); return; }
      if (f.accantoAttese && Date.now() - f.accantoDa < 30000) { f.accantoAttese.push(cb); return; }
      var mie = f.accantoAttese = [cb];
      f.accantoDa = Date.now();
      function fine(tracce, firma) {
        if (f.accanto && f.accanto.firma === firma) f.accanto.at = Date.now();
        else f.accanto = { at: Date.now(), firma: firma, tracce: tracce };
        if (f.accantoAttese === mie) f.accantoAttese = null;
        for (var i = 0; i < mie.length; i++) { try { mie[i](f.accanto.tracce); } catch (x) {} }
      }
      var dir = path.dirname(f.percorso), base = path.basename(f.percorso).replace(/\.[^.]+$/, '').toLowerCase() + '.';
      elenco(dir, function (e, nomi) {
        if (e) { fine([], ''); return; }
        var cand = [], k = 0, firma = [];
        nomi.forEach(function (n) {
          var nl = n.toLowerCase(), m = /\.(sup|idx)$/.exec(nl), sub = null;
          if (!m || nl.indexOf(base) !== 0) return;
          if (m[1] === 'idx' && !(sub = trovaNome(nomi, n.slice(0, -4) + '.sub'))) return;
          cand.push({ nome: n, tipo: m[1], sub: sub, resto: nl.slice(base.length - 1, nl.length - 4) });
        });
        cand.sort(function (a, b) { return confrontaNomi(a.nome, b.nome); });
        cand = cand.slice(0, 16);
        // prima le misure (lstat: mai collegamenti); se sono quelle di prima, le tracce di prima
        (function misura() {
          if (k >= cand.length) { costruisci(); return; }
          var c = cand[k++];
          fs.lstat(path.join(dir, c.nome), function (e1, st) {
            if (e1 || !st.isFile() || (c.tipo === 'idx' && st.size > MAX_IDX)) { c.no = true; misura(); return; }
            c.dim = st.size;
            firma.push(c.nome + ':' + st.size + ':' + (+st.mtime));
            if (c.tipo !== 'idx') { misura(); return; }
            fs.lstat(path.join(dir, c.sub), function (e2, st2) {
              if (e2 || !st2.isFile()) c.no = true;
              else { c.dimSub = st2.size; firma.push(c.sub + ':' + st2.size + ':' + (+st2.mtime)); }
              misura();
            });
          });
        })();
        function costruisci() {
          var f2 = firma.join('|'), tracce = [], num = numeroBase(f), j = 0;
          if (f.accanto && f.accanto.firma === f2) { fine(f.accanto.tracce, f2); return; }
          (function una() {
            if (j >= cand.length || tracce.length >= 32) { aspettoAvi(function () { fine(tracce, f2); }); return; } // al massimo 32 tracce accanto
            var c = cand[j++];
            if (c.no) { una(); return; }
            var lng = linguaDaNome(c.resto), forz = /forced|forzat/.test(c.resto);
            if (c.tipo === 'sup') {
              tracce.push({ num: num++, tipo: 17, codec: 'S_HDMV/PGS', lingua: lng, nome: c.nome, forzata: forz,
                esterno: { tipo: 'sup', percorso: path.join(dir, c.nome), dim: c.dim } });
              una();
              return;
            }
            leggiPiccolo(path.join(dir, c.nome), MAX_IDX, function (b) {
              if (!b) { una(); return; }
              leggiIdx(b.toString('binary'), function (idx) {
                idx.lingue.forEach(function (l) {
                  if (tracce.length >= 32) return;
                  tracce.push({ num: num++, tipo: 17, codec: 'S_VOBSUB', lingua: /^[a-z]{2,3}$/.test(l.id) ? lingua({ lingua: l.id }) : lng,
                    nome: c.nome + (idx.lingue.length > 1 ? ' (' + (l.id || l.indice) + ')' : ''), forzata: forz, vobsub: idx.intest,
                    esterno: { tipo: 'idx', percorso: path.join(dir, c.sub), dim: c.dimSub, idSub: 0x20 + (l.indice & 31), t: l.t, pos: l.pos } });
                });
                una();
              });
            });
          })();
          // un AVI coi sottotitoli dei DVD: la sua forma dall'intestazione (per un DVD 4:3)
          function aspettoAvi(poi) {
            if (f.est !== 'avi' || f.aspettoAvi !== undefined || !tracce.some(function (t) { return t.codec === 'S_VOBSUB'; })) { poi(); return; }
            f.aspettoAvi = 0;
            fs.open(f.percorso, 'r', function (e3, fd) {
              if (e3) { poi(); return; }
              leggi(fs, fd, 0, 512, function (e4, b) {
                fs.close(fd, function () {});
                var mi = !e4 ? misureAvi(b) : null;
                if (mi) f.aspettoAvi = mi.w / mi.h;
                poi();
              });
            });
          }
        }
      });
    }
    // info: un disco, o le tracce accanto aggiunte a quelle del file
    function infoAccanto(f, out, cb) {
      if (f.disco) { infoDisco(f, out); cb(null, out); return; }
      accantoDi(f, function (tracce) {
        for (var i = 0; i < tracce.length; i++) {
          var t = tracce[i], fam = famiglia(t.codec);
          out.sotto.push({ num: t.num, ordine: -1, codec: fam, nomeCodec: NOMI[fam] || fam, lingua: t.lingua, nome: t.nome, predefinita: false,
            forzata: !!t.forzata, udito: false, immagini: true, leggibile: true, esterno: true });
        }
        cb(null, out);
      }, true);
    }
    // la forma del video come si vede (larghezza/altezza): MKV (DisplayWidth/Height), MP4, AVI; 0 = non si sa
    function aspettoDi(f) {
      var m = f.m;
      if (m) for (var i = 0; i < m.tracce.length; i++) {
        var v = m.tracce[i].video;
        if (m.tracce[i].tipo === 1 && v) return v.dl > 0 && v.da > 0 ? v.dl / v.da : v.largh > 0 && v.alt > 0 ? v.largh / v.alt : 0;
      }
      return f.aspettoAvi || 0;
    }
    // un SPU (dal MKV o dal .sub) come evento PGS
    function eventoVobsub(f, t, ev, dati) {
      var intest = t.vobsub || (t.vobsub = intestazioneIdx(t.privato ? t.privato.toString('binary') : ''));
      var x = vobsubInPgs(dati, intest, aspettoDi(f));
      if (!x) return null;
      return { t: ev.t + x.inizio, d: x.durata >= 0 ? x.durata : ev.d, pgs: x.pgs };
    }
    function sottoOAccanto(f, num, da, cb, dopo) {
      if (!(+num >= 1000) || f.disco || f.fs !== fs) { sottoF(f, num, da, cb, dopo); return; }
      accantoDi(f, function (l) {
        for (var i = 0; i < l.length; i++) if (l[i].num === +num) { sottoAccanto(f, l[i], da, cb, dopo); return; }
        sottoF(f, num, da, cb, dopo);
      });
    }
    // come sottoF, per una traccia accanto: a finestre di 2 minuti, si risponde con quella di "da" e intanto si legge la
    // prossima; da ora si raccoglie solo questa traccia
    function sottoAccanto(f, tr, da, cb, dopo) {
      da = Math.max(0, +da || 0);
      dopo = dopo !== undefined && dopo !== null && dopo !== '' && isFinite(+dopo) ? +dopo : -1;
      f.dove = da;
      var attive = attiveDi(f), num = tr.num, W = FINESTRA_PGS, k = Math.floor(da / W);
      if (attive[num] !== tr) {
        for (var a0 in attive) if (Object.prototype.hasOwnProperty.call(attive, a0)) delete attive[a0];
        attive[num] = tr;
        dimenticaSotto(f, num);
      }
      finestraAccanto(f, tr, k, W, function (letta) {
        var s = f.sotto[num] || { eventi: [], ordinati: true }, a = da + W, out = [], primo = 0, lo = 0, hi, i;
        ordina(s);
        hi = s.eventi.length - 1;
        while (lo <= hi) { var mid = (lo + hi) >> 1; if (s.eventi[mid].t <= da) { primo = mid; lo = mid + 1; } else hi = mid - 1; }
        for (i = primo; i < s.eventi.length && out.length < 400; i++) {
          var e = s.eventi[i];
          if (e.t > a) break;
          if (dopo >= 0 && e.t <= dopo) continue;
          if (i === primo || e.t + Math.max(e.d, 0) >= da - 2000) out.push({ t: e.t, d: e.d, k: e.k, pgs: e.pgs.toString('base64') });
        }
        cb(null, { eventi: out, fino: letta ? (k + 1) * W : 0, completi: false });
        finestraAccanto(f, tr, k + 1, W, function () {});
      });
    }
    // una finestra letta una volta sola (con le stesse chiavi delle Cues: sfoltisci e dimenticaSotto le rimettono da leggere)
    function finestraAccanto(f, tr, k, W, cb) {
      f.cuesFatte = f.cuesFatte || {};
      var chiave = tr.num + ':' + k, stato = f.cuesFatte[chiave];
      if (stato === true || stato === 'no') { cb(stato === true); return; }
      if (stato && stato.attese) { stato.attese.push(cb); return; }
      var x = f.cuesFatte[chiave] = { attese: [cb] };
      daAccanto(f, tr, Math.max(0, k * W - 60000), (k + 1) * W, function (fatto) {
        if (f.cuesFatte && f.cuesFatte[chiave] === x) f.cuesFatte[chiave] = fatto ? true : 'no';
        for (var i = 0; i < x.attese.length; i++) { try { x.attese[i](fatto); } catch (e) {} }
      });
    }
    function primoDa(l, v) { var lo = 0, hi = l.length; while (lo < hi) { var m = (lo + hi) >> 1; if (l[m] < v) lo = m + 1; else hi = m; } return lo; }
    // i sottotitoli di una traccia accanto tra "da" e "a" (ms): al massimo 5000 e 32 MB letti per finestra
    function daAccanto(f, tr, da, a, cb) {
      var x = tr.esterno;
      function scelti(tempi) { var l = []; for (var i = primoDa(tempi, da); i < tempi.length && tempi[i] <= a && l.length < 5000; i++) l.push(i); return l; }
      function aggiungi(t, dati) {
        try { aggiungiSotto(f, tr.num, tr, { t: t, d: -1 }, dati); } catch (e) { /* un sottotitolo rotto (o fatto apposta): si salta */ }
      }
      if (x.tipo === 'sup') {
        indiceSup(x, a + 1, function () {
          var ix = x.ix;
          leggiElenco(x.percorso, ix ? scelti(ix.t) : [], function (fd, i, poi) {
            leggi(fs, fd, ix.a[i], ix.z[i] - ix.a[i], function (e, b) {
              var dati = !e && b ? supInBlocco(b) : null;
              if (dati) aggiungi(ix.t[i], dati);
              poi(ix.z[i] - ix.a[i]);
            });
          }, cb);
        });
        return;
      }
      leggiElenco(x.percorso, scelti(x.t), function (fd, i, poi) {
        spuDaSub(fd, x.pos[i], x.idSub, function (spu, letti) { if (spu) aggiungi(x.t[i], spu); poi(letti); });
      }, cb);
    }
    // apre il file, legge uno per volta gli elementi della lista (fino a 32 MB), chiude. fatto(true) = finestra letta
    function leggiElenco(percorso, l, uno, fatto) {
      if (!l.length) { fatto(true); return; }
      fs.open(percorso, 'r', function (e, fd) {
        if (e) { fatto(false); return; }
        var k = 0, letti = 0;
        (function giro() {
          if (k >= l.length || letti > (32 << 20)) { fs.close(fd, function () {}); quandoGonfiati(function () { fatto(true); }); return; }
          uno(fd, l[k++], function (n) { letti += n || 0; giro(); });
        })();
      });
    }
    // un SPU dal .sub: dal pacchetto all'indirizzo dell'.idx, i pezzi del sottoflusso della lingua finche' e' intero
    // (pacchetti da 2 KB di solito: si legge a 8 KB; al massimo 256 KB). cb(spu o null, byte letti)
    function spuDaSub(fd, pos, idSub, cb) {
      var st = { parti: [], preso: 0, dimSpu: -1 }, letti = 0, quanti = 8192;
      (function giro(p) {
        leggi(fs, fd, p, quanti, function (e, b) {
          if (e || !b || !b.length) { cb(null, letti); return; }
          letti += b.length;
          var usati = -1;
          try { usati = pezziSpu(b, idSub, st); } catch (x) { usati = -1; }
          if (usati < 0) { cb(null, letti); return; }
          if (st.dimSpu >= 0 && st.preso >= st.dimSpu) { var spu = Buffer.concat(st.parti, st.preso); cb(spu.slice(0, st.dimSpu), letti); return; }
          if (letti > (256 << 10) || (usati === 0 && quanti > 8192) || b.length < quanti) { cb(null, letti); return; }
          quanti = usati === 0 ? 73728 : 8192; // un pacchetto piu' lungo di 8 KB: si rilegge piu' grande
          giro(p + usati);
        });
      })(pos);
    }
    // l'indice di un .sup (dove comincia e finisce ogni display set, e quando), letto a pezzi da 256 KB e solo fino al tempo
    // che serve: si guardano le intestazioni dei segmenti (13 byte) e si salta il resto. Al massimo MAX_EVENTI display set
    // e 2 s di lavoro; un display set oltre 4 MB si salta
    function indiceSup(x, finoA, cb) {
      var ix = x.ix || (x.ix = { t: [], a: [], z: [], pos: 0, finito: false, aperto: -1, tAperto: 0, spesi: 0, attese: null, giro: 0, da: 0, fino: 0 });
      // si legge fino al tempo piu' lontano chiesto (anche da chi arriva mentre si legge)
      function basta() { return ix.finito || (ix.t.length && ix.t[ix.t.length - 1] > ix.fino); }
      if (ix.finito || (ix.t.length && ix.t[ix.t.length - 1] > finoA)) { cb(); return; }
      ix.fino = Math.max(ix.fino, finoA);
      if (ix.attese && Date.now() - ix.da < 30000) { ix.attese.push(cb); return; }
      var mie = ix.attese = [cb], mio = ++ix.giro;
      ix.da = Date.now();
      function chiudiSet(z) {
        if (z - ix.aperto <= MAX_GONFIO_PGS && ix.t.length < MAX_EVENTI) { ix.t.push(ix.tAperto); ix.a.push(ix.aperto); ix.z.push(z); }
        ix.aperto = -1;
      }
      function fine(fd) {
        if (fd >= 0) fs.close(fd, function () {});
        if (ix.attese === mie) ix.attese = null;
        else if (ix.giro !== mio && ix.attese) { ix.attese.push.apply(ix.attese, mie); return; } // li chiamera' il giro piu' nuovo
        for (var i = 0; i < mie.length; i++) { try { mie[i](); } catch (e) {} }
      }
      fs.open(x.percorso, 'r', function (e, fd) {
        if (e) { ix.finito = true; fine(-1); return; }
        (function giro() {
          if (basta() || ix.giro !== mio) { fine(fd); return; }
          if (ix.pos >= x.dim || ix.t.length >= MAX_EVENTI || ix.spesi > 2000) {
            if (ix.aperto >= 0 && ix.pos >= x.dim) chiudiSet(x.dim);
            ix.finito = true;
            fine(fd);
            return;
          }
          leggi(fs, fd, ix.pos, Math.min(262144, x.dim - ix.pos), function (e2, b) {
            if (ix.giro !== mio) { fine(fd); return; }
            if (e2 || !b || b.length < 13) { if (ix.aperto >= 0) chiudiSet(x.dim); ix.finito = true; fine(fd); return; }
            var t0 = Date.now(), i = 0;
            while (i + 13 <= b.length) {
              if (b[i] !== 0x50 || b[i + 1] !== 0x47) { ix.finito = true; break; } // non e' (piu') un .sup: ci si ferma qui
              var tipo = b[i + 10], qui = ix.pos + i, z = qui + 13 + b.readUInt16BE(i + 11);
              if (tipo === 0x16) {
                if (ix.aperto >= 0) chiudiSet(qui);
                ix.aperto = qui;
                ix.tAperto = Math.round(b.readUInt32BE(i + 2) / 90);
              } else if (tipo === 0x80 && ix.aperto >= 0) chiudiSet(z);
              i = z - ix.pos;
            }
            ix.spesi += Date.now() - t0;
            if (!i) ix.finito = true;
            ix.pos += i;
            giro();
          });
        })();
      });
    }

    // l'app Video e' chiusa (nessun gettone valido): via i film aperti (strutture, sottotitoli, Cues), le schede, gli elenchi
    // delle cartelle e le analisi dei dischi copiati, e il convertitore lascia i Cluster convertiti. Prima restava tutto fino
    // a sera (25-30 MB). Alla prossima apertura si rifanno; una risposta ancora in corso tiene il suo file
    function riposa() {
      for (var k in aperti) if (Object.prototype.hasOwnProperty.call(aperti, k)) dimenticaSotto(aperti[k], -1);
      aperti = {};
      sottoTot = 0;
      elenchi = {};
      schede = {};
      discoCache = {};
      analisiCache = {};
      if (audioTv && typeof audioTv.riposa === 'function') audioTv.riposa();
    }

    return {
      dischi: dischi, cartella: cartella, info: info, servi: servi, sotto: sotto, sottoEsterni: sottoEsterni, prova: prova,
      scheda: scheda, immagine: immagine, riposa: riposa,
      // quello che il servizio tiene adesso (8091/tv): film aperti, sottotitoli, schede e cartelle ricordate
      quanti: function () {
        return { film: Object.keys(aperti).length, sottotitoliKB: Math.round(sottoTot / 1024), schede: Object.keys(schede).length,
          cartelle: Object.keys(elenchi).length };
      },
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
      asyncHooks: o.asyncHooks && typeof o.asyncHooks.createHook === 'function' && typeof o.asyncHooks.executionAsyncId === 'function' ? o.asyncHooks : null,
      riposoSenzaDomande: o.riposoSenzaDomande > 0 ? o.riposoSenzaDomande : 15 * 60000,
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
  /* ============================================================ le isole delle domande dell'app
   * Ogni domanda dell'app Video gira in un'"isola": un errore in uno qualsiasi dei suoi callback (file, stream, zlib, timer)
   * chiude solo quella risposta e si annota; il servizio del TV (home, telefono, blocco della pubblicita') resta su. Prima
   * erano i "domini" di Node, che dalla prima domanda dell'app lasciano acceso per sempre il loro async hook: poi ogni
   * domanda del servizio costava il 12-20% di CPU in piu' (revisione del peso, punto 11; misurato col Node 12 dei TV). Qui
   * l'async hook e' nostro e resta acceso solo finche' un'isola e' viva: la sua risposta aperta, o qualcosa di suo che deve
   * ancora arrivare (una lettura, un timer, un socket). Ogni risorsa asincrona creata dentro un'isola la ricorda; un errore
   * che scappa da un suo callback arriva a process.on('uncaughtException') del servizio, che lo passa qui (prendiErrore).
   * Senza async_hooks (il Node 4 dei TV vecchi) restano i domini, che li' non accendono nessun hook */
  var isole = { ah: null, hook: null, di: null, corrente: null, fuori: false, vive: 0, accensioni: 0, attesa: 30000, spegnendo: false };
  function nuovaIsola(ah, errore, annota) {
    if (!isole.hook) {
      isole.ah = ah;
      // (un errore dentro un async hook ferma il processo: qui niente puo' fallire. Spento l'hook, Node puo' ancora
      // consegnare i "destroy" gia' in coda: la mappa non c'e' piu' e non si fa niente)
      isole.hook = ah.createHook({
        init: function (id) {
          if (!isole.di || isole.fuori) return;
          var x = isole.corrente || isole.di.get(isole.ah.executionAsyncId());
          if (x && x.viva) { isole.di.set(id, x); x.risorse++; }
        },
        destroy: function (id) {
          var x = isole.di ? isole.di.get(id) : null;
          if (!x) return;
          isole.di['delete'](id);
          x.risorse--;
          forseFinita(x);
        }
      });
      // prima di ogni altro ascoltatore (quello del servizio, di TizenBrew, di un'altra copia del servizio): l'errore di
      // un'isola si prende qui e si segna, cosi' nessuno lo conta come "sfuggito". Se non c'e' nessun altro ascoltatore, un
      // errore che non e' di un'isola ferma il processo come farebbe Node da solo
      if (typeof process.prependListener === 'function') {
        process.prependListener('uncaughtException', function (e) {
          if (!prendiErrore(e) && process.listenerCount('uncaughtException') === 1) throw e;
        });
      }
    }
    var x = { aperta: true, viva: true, risorse: 0, errore: errore, annota: annota };
    if (!isole.vive++) { if (!isole.di) isole.di = new Map(); isole.hook.enable(); isole.accensioni++; }
    return x;
  }
  // un'isola finisce quando la sua risposta e' chiusa e non ha piu' niente in arrivo; finite tutte, l'hook si spegne
  function forseFinita(x) {
    if (!x.viva || x.aperta || x.risorse > 0) return;
    x.viva = false;
    if (!--isole.vive) spegniDopo();
  }
  // l'hook si spegne al giro dopo, fuori dai suoi callback: nel Node 12 disable() chiamato dentro un hook (un destroy) lascia
  // acceso il PromiseHook di V8, e ogni Promise del processo costerebbe 10-20 volte tanto (revisione delle isole)
  function spegniDopo() {
    if (isole.spegnendo) return;
    isole.spegnendo = true;
    isole.fuori = true;
    try {
      setImmediate(function () {
        isole.spegnendo = false;
        if (isole.vive) return; // un'isola nuova intanto: resta acceso
        isole.hook.disable();
        isole.di = null;
      });
    } finally { isole.fuori = false; }
  }
  // chiusa la risposta, al piu' 30 secondi: qualcosa che vive per sempre (un socket tenuto aperto, lo stdout creato la
  // prima volta qui dentro) non deve tenere acceso l'hook. Un errore che arrivasse dopo va al servizio, come prima dei domini
  function chiusaIsola(x) {
    if (!x.aperta) return;
    x.aperta = false;
    // la risposta e' chiusa: un errore che arriva dopo si annota soltanto, e l'isola non tiene piu' req e res (con i loro
    // blocchi) per i secondi in cui resta viva
    x.errore = x.annota;
    forseFinita(x);
    if (!x.viva) return;
    // (il timer e' fuori dall'isola: se no la terrebbe viva lui)
    isole.fuori = true;
    try {
      var t = setTimeout(function () {
        if (!x.viva || !isole.di) return;
        isole.di.forEach(function (v, id) { if (v === x) isole.di['delete'](id); });
        x.risorse = 0;
        forseFinita(x);
      }, isole.attesa);
      if (t && t.unref) t.unref();
    } finally { isole.fuori = false; }
  }
  // fn dentro l'isola (anche gli errori subito, non solo quelli dei callback)
  function inIsola(x, fn) {
    var prima = isole.corrente;
    isole.corrente = x;
    try { fn(); } catch (e) { x.errore(e); } finally { isole.corrente = prima; }
  }
  // gli eventi di req e res arrivano dal socket (fuori dall'isola): girano dentro, come faceva dominio.add
  function legaIsola(em, x) {
    var emit = em.emit;
    em.emit = function () {
      var prima = isole.corrente;
      isole.corrente = x;
      try { return emit.apply(this, arguments); } catch (e) { x.errore(e); return true; } finally { isole.corrente = prima; }
    };
  }
  // dall'ascoltatore di 'uncaughtException': true = era un errore di una domanda dell'app (preso, risposta chiusa). Si
  // prende una volta sola (lo chiede anche il servizio), e niente qui puo' fallire: un errore dentro l'ascoltatore
  // fermerebbe tutto il processo di TizenBrew
  function prendiErrore(e) {
    try {
      if (e && (typeof e === 'object' || typeof e === 'function') && e.presoDaVideo === true) return true;
      if (!isole.vive || !isole.di) return false;
      var x = isole.corrente || isole.di.get(isole.ah.executionAsyncId());
      if (!x) return false;
      try { if (e && typeof e === 'object') e.presoDaVideo = true; } catch (e1) { /* congelato */ }
      x.errore(e);
      return true;
    } catch (e2) { return true; }
  }

  var RE_VIDEO = /^\/api\/video\/g\/([^\/]*)\/(.*)$/;
  // gli errori presi dalla rete (un file fatto in un modo che il codice non si aspettava): per le prove e per il registro
  var presi = { n: 0, ultimo: '' };
  // annota un errore preso (fuori da gestisci: cosi' non tiene req e res)
  function annotaErrori(log) {
    return function (e) {
      presi.n++;
      var testo = '';
      try { testo = String(e && e.stack || e); } catch (e1) { testo = 'errore senza testo'; } // (Object.create(null) non diventa testo)
      presi.ultimo = testo.slice(0, 400);
      if (log) { try { log('app Video: errore preso (' + testo.split('\n')[0].slice(0, 200) + ')'); } catch (x) {} }
    };
  }
  // un gettone rimasto (lo Store ricaricato o caduto senza "chiudi": vale 12 ore) non deve tenere film e schede fino a
  // sera: senza domande dell'app aperte per 15 minuti il servizio va a riposo lo stesso (durante un film la domanda del
  // <video> resta aperta)
  function domandaAperta(vt, req, res) {
    if (typeof vt.riposa !== 'function') return;
    vt.aperte = (vt.aperte || 0) + 1;
    if (vt.timerRiposo) { clearTimeout(vt.timerRiposo); vt.timerRiposo = null; }
    var chiusa = false;
    function fine() {
      if (chiusa) return;
      chiusa = true;
      if (--vt.aperte > 0) return;
      isole.fuori = true;
      try {
        vt.timerRiposo = setTimeout(function () { vt.timerRiposo = null; if (!vt.aperte) vt.riposa(); }, vt.riposoSenzaDomande);
        if (vt.timerRiposo.unref) vt.timerRiposo.unref();
      } finally { isole.fuori = false; }
    }
    res.on('finish', fine);
    res.on('close', fine);
    req.on('aborted', fine);
  }
  // true = era una domanda dell'app Video (la risposta e' data). Ogni domanda gira in un'isola (sul Node 4 in un "dominio"
  // di Node): un errore in uno qualsiasi dei suoi callback (file, stream, zlib, timer) chiude solo quella risposta e si
  // annota; il servizio del TV (home, telefono, blocco della pubblicita') resta su
  function gestisci(vt, g, req, res, u, opzioni) {
    var m = RE_VIDEO.exec(u.pathname || '');
    if (!m) return false;
    var annota = annotaErrori(vt.log);
    function preso(e) {
      annota(e);
      try { if (!res.headersSent) rispondi(res, 500, { error: 'file non leggibile', codice: 'formato' }); else res.destroy(); } catch (x) {}
    }
    domandaAperta(vt, req, res);
    if (vt.asyncHooks) {
      var isola = nuovaIsola(vt.asyncHooks, preso, annota);
      // la chiusura un giro dopo, dentro l'isola: prima girano gli altri 'close' (le pulizie della risposta), ancora dentro.
      // 'aborted': una domanda in coda su una connessione che cade non riceve ne' 'finish' ne' 'close'
      var finita = function () { process.nextTick(function () { chiusaIsola(isola); }); };
      legaIsola(req, isola);
      legaIsola(res, isola);
      res.on('finish', finita);
      res.on('close', finita);
      req.on('aborted', finita);
      inIsola(isola, function () { tratta(vt, g, req, res, u, opzioni || {}, m); });
      return true;
    }
    var dom = vt.domain ? vt.domain.create() : null;
    if (!dom) { tratta(vt, g, req, res, u, opzioni || {}, m); return true; }
    dom.add(req);
    dom.add(res);
    dom.on('error', preso);
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
      vt.info(d, p, { lingue: lingue.length ? lingue : null, tetto: +q.tetto || 0 }, function (e, r) { if (e) errore(e); else rispondi(res, 200, r); });
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
    prendiErrore: prendiErrore, isole: function () { return { vive: isole.vive, acceso: !!isole.di, accensioni: isole.accensioni }; },
    _attesaIsole: function (ms) { isole.attesa = ms; },
    // per le prove e per l'app (le stesse regole)
    _interni: { leggiId: leggiId, leggiVint: leggiVint, famiglia: famiglia, lingua: lingua, piano: piano,
      leggiSottotitoli: leggiSottotitoli, testoDi: testoDi, apriMkv: apriMkv, apriMp4: apriMp4, Scansione: Scansione,
      leggiNfo: leggiNfo, immaginiDi: immaginiDi, misureImg: misureImg, dalNome: dalNome, tagDi: tagDi,
      modificheFisse: modificheFisse, intervallo: null,
      spuDecodifica: spuDecodifica, vobsubInPgs: vobsubInPgs, intestazioneIdx: intestazioneIdx, leggiIdx: leggiIdx, pezziSpu: pezziSpu,
      supInBlocco: supInBlocco, leggiMpls: leggiMpls, leggiIfo: leggiIfo, fsUnito: fsUnito, linguaDaNome: linguaDaNome, misureAvi: misureAvi }
  };
})();
