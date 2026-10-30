/*
 * Home TV - AUDIO DEL TV: le tracce DTS e TrueHD (che il TV non legge) diventano AC3 (Dolby Digital) mentre il film
 * passa, dentro lo stesso MKV e alla stessa lunghezza: la "strada A" di prove/audio-tv/PROGETTO.md.
 * Si modifica SOLO questo file; service.js ne ha una copia tra i segnaposto <audiotv:generato>, messa da
 * prove/incorpora_videoteca.py (le prove controllano che sia uguale).
 *
 * Per ogni Cluster con la traccia da convertire:
 *  - i frame della traccia (anche da blocchi con lacing) si decodificano e si ricodificano in AC3 640k, un frame ogni
 *    1536 campioni (32 ms) a partire dal primo campione della traccia;
 *  - i frame AC3 vanno nello spazio dei blocchi della traccia e delle tracce nascoste ("modo fila": una fila e' una
 *    serie di elementi liberi attaccati: blocchi della traccia, Void, CRC-32); quello che avanza diventa un Void (la sua
 *    testa sola: dentro restano i byte veri). Un frame che non entra si rifa' a un bitrate piu' basso: mai buttato;
 *  - il video non si tocca, i Cluster non si spostano: Range, Cues e salti restano quelli del file vero;
 *  - ogni Cluster si converte da capo con un po' di audio prima (dai Cluster precedenti: per il decodificatore DTS un
 *    frame, per il TrueHD fino all'ultima "major sync") e un po' dopo (l'inizio del Cluster seguente): da qualunque
 *    punto parta una richiesta, gli stessi byte. I Cluster convertiti restano in una piccola cache;
 *  - la TrackEntry in Tracks diventa A_AC3 nello stesso spazio (Void per il resto): solo i byte che cambiano.
 * Il codec sta dietro un'interfaccia (sotto, "IL CODEC"): codecWasm() carica il WebAssembly di prove/audio-tv/codec
 * (FFmpeg ridotto, senza SIMD); nelle prove ce n'e' uno finto. Si accende da solo quando la "Velocita' del TV" dice
 * che il TV regge; senza WebAssembly (Node 4 dei TV 2017-2019) resta spento e quelle tracce restano nascoste.
 *
 *   var at = AudioTv.crea({ codec: AudioTv.codecWasm(fnByte), misura: fn(cb), fs, file, log })
 *   Videoteca.crea({ ..., audioTv: at })      (la videoteca chiede: letti, attendi, pronta, prepara, fisse, servi)
 *
 * Solo ES5 e solo ASCII; si carica da Node 4.4.3 in su.
 */
var AudioTv = (function () {
  'use strict';

  /* ============================================================ IL CODEC
   * Un codec e' un oggetto { nome, pronto(cb), apri(o) -> conv }:
   *   pronto(cb)        cb(null) quando si puo' usare (il WebAssembly si compila la prima volta), cb(errore) se no
   *   apri(o)           un convertitore nuovo, da zero: o = { tipo: 'DTS' | 'TRUEHD' | 'MLP', freq, canali }
   *   conv.decodifica(dati, s, attesi)   un frame sorgente intero (Buffer), che comincia al campione s della traccia
   *                     e ne vale "attesi" (quelli che il decodificatore non da' sono silenzio). -> campioni dati
   *   conv.codifica(s, kbps)  il frame AC3 a kbps che suona i campioni [s, s + 1536) -> Buffer (null se non riesce)
   *   conv.chiudi()
   * Il tempo e' sempre in campioni della traccia (0 = il suo primo campione): il codec non sa niente di Cluster e MKV.
   * Il codec vero si riscalda da solo (l'encoder parte un frame prima, il suo ritardo di 256 campioni e' dentro);
   * a chi lo usa tocca dargli i frame sorgente da un punto da cui il decodificatore riparte uguale (vedi inizioDec). */

  // le funzioni che il WebAssembly chiede (WASI ed Emscripten): niente file, niente orologio, niente variabili
  function importiWasm(stato) {
    function zero() { return 0; }
    var w = {
      fd_write: function (fd, iov, n, scritti) {
        var mem = new DataView(stato.memoria.buffer), tot = 0;
        for (var i = 0; i < n; i++) tot += mem.getUint32(iov + i * 8 + 4, true);
        mem.setUint32(scritti, tot, true);
        return 0;
      },
      fd_read: function () { return 8; }, fd_close: zero, fd_seek: function () { return 70; }, fd_fdstat_get: function () { return 8; },
      environ_sizes_get: function (n, dim) { var mem = new DataView(stato.memoria.buffer); mem.setUint32(n, 0, true); mem.setUint32(dim, 0, true); return 0; },
      environ_get: zero,
      clock_time_get: function (id, p1, p2, p3) {
        // (id, precisione i64 -> due i32 o un BigInt, puntatore): il puntatore e' l'ultimo argomento
        var ptr = arguments[arguments.length - 1], mem = new DataView(stato.memoria.buffer), ns = Date.now() * 1e6;
        mem.setUint32(ptr, ns % 4294967296, true);
        mem.setUint32(ptr + 4, Math.floor(ns / 4294967296), true);
        return 0;
      },
      proc_exit: function () { throw new Error('codec: uscita'); }
    };
    return { wasi_snapshot_preview1: w, env: { emscripten_notify_memory_growth: function () {} } };
  }

  // il codec vero: il WebAssembly di prove/audio-tv/codec/atv.c (dammiByte() -> Buffer, chiamata a ogni compilazione).
  // null se questo Node non ha WebAssembly (TV 2017-2019). Dopo qualche minuto senza conversioni si lascia andare l'istanza,
  // con la sua memoria (cresce mentre si converte); il modulo compilato resta: col Node 12 del TV la memoria del codice non
  // torna indietro, e ogni ricompilazione ne aggiungerebbe altra (misurato: +8-15 MB a giro). Alla conversione dopo
  // un'istanza nuova si fa subito. opz.riposoMs: quanto aspettare (3 minuti; le prove ne usano meno)
  function codecWasm(dammiByte, opz) {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.Module !== 'function') return null;
    var stato = { es: null, modulo: null, errore: null, attese: null, liberi: {}, rifatte: 0, aperti: 0, usato: 0, timer: null, lasciato: 0 };
    var RIPOSO = opz && opz.riposoMs > 0 ? opz.riposoMs : 180000, alRiposo = [];
    // il controllo del riposo: si rimanda finche' c'e' un convertitore aperto o una conversione recente
    function riposa() {
      if (stato.timer) return;
      stato.timer = setTimeout(function () {
        stato.timer = null;
        if (!stato.es) return;
        if (stato.aperti > 0 || stato.attese || Date.now() - stato.usato < RIPOSO) { riposa(); return; }
        stato.es = null;
        stato.liberi = {};
        stato.lasciato++;
        for (var i = 0; i < alRiposo.length; i++) { try { alRiposo[i](); } catch (e) {} }
      }, Math.max(20, RIPOSO - (Date.now() - stato.usato)));
      if (typeof stato.timer.unref === 'function') stato.timer.unref();
    }
    // un'istanza nuova dal modulo gia' compilato (subito, senza ricompilare)
    function istanza() {
      var cas = { memoria: null }, es = new WebAssembly.Instance(stato.modulo, importiWasm(cas)).exports;
      cas.memoria = es.memory;
      if (typeof es._initialize === 'function') es._initialize();
      if (typeof es.atv_versione !== 'function' || es.atv_versione() !== 1) throw new Error('codec: versione sconosciuta');
      stato.es = es;
      stato.liberi = {};
    }
    function pronto(cb) {
      if (stato.es) { cb(null); return; }
      if (stato.errore) { cb(stato.errore); return; }
      // dopo il riposo o un guasto il modulo resta: basta un'istanza nuova, senza ricompilare
      if (stato.modulo) {
        try { istanza(); } catch (e) { cb(e); return; }
        stato.usato = Date.now();
        riposa();
        cb(null);
        return;
      }
      if (stato.attese) { stato.attese.push(cb); return; }
      stato.attese = [cb];
      function fine(e) {
        if (e) stato.errore = e;
        var l = stato.attese;
        stato.attese = null;
        for (var i = 0; i < l.length; i++) { try { l[i](e || null); } catch (x) {} }
      }
      var b;
      try { b = dammiByte(); } catch (e0) { fine(e0); return; }
      if (!b || !b.length) { fine(new Error('codec: manca il WebAssembly')); return; }
      // la compilazione non ferma il servizio (asincrona)
      WebAssembly.compile(b).then(function (mod) {
        stato.modulo = mod;
        istanza();
        stato.usato = Date.now();
        riposa();
        fine(null);
      }).then(null, function (e) { fine(e instanceof Error ? e : new Error(String(e))); });
    }
    var TIPI = { DTS: 1, TRUEHD: 2, MLP: 3 };
    function apri(o) {
      // dopo un errore dentro il WebAssembly quell'istanza non si usa piu': se ne fa una nuova
      if (!stato.es && stato.modulo && !stato.errore) istanza();
      var es = stato.es, chiave = o.tipo + ':' + o.freq + ':' + o.canali, l = stato.liberi[chiave], h;
      if (!es) throw new Error('codec non pronto');
      var mem = es.memory;
      // le maniglie si riusano (aprire i codec costa): azzerate, sono come nuove
      if (l && l.length) { h = l.pop(); es.atv_azzera(h); } else h = es.atv_apri(TIPI[o.tipo] || 1, 0, o.freq || 48000, o.canali || 6);
      if (!h) throw new Error('codec: non si apre');
      var ent = 0, entN = 0, usc = es.atv_memoria(4096), chiuso = false;
      stato.aperti++;
      stato.usato = Date.now();
      // chiuso (o guasto): il riposo riparte da qui
      function fatto() {
        if (chiuso) return;
        chiuso = true;
        stato.aperti--;
        stato.usato = Date.now();
        riposa();
      }
      function scrivi(dati) {
        if (dati.length + 64 > entN) {
          if (ent) es.atv_libera(ent);
          entN = Math.max(65536, dati.length + 64);
          ent = es.atv_memoria(entN);
        }
        var m8 = new Uint8Array(mem.buffer, ent, dati.length + 64);
        m8.set(dati);
        for (var i = dati.length; i < dati.length + 64; i++) m8[i] = 0;
      }
      function guasto(e) { if (stato.es === es) { stato.es = null; stato.rifatte++; } fatto(); throw e; }
      return {
        decodifica: function (dati, s, attesi) {
          if (chiuso) throw new Error('codec chiuso');
          try { scrivi(dati); return es.atv_decodifica(h, ent, dati.length, s, attesi); } catch (e) { return guasto(e); }
        },
        codifica: function (s, kbps) {
          if (chiuso) throw new Error('codec chiuso');
          var n;
          try { n = es.atv_codifica(h, s, kbps, usc, 4096); } catch (e) { return guasto(e); }
          if (n <= 0) return null;
          var out = nuovo(n), m8 = new Uint8Array(mem.buffer, usc, n);
          for (var i = 0; i < n; i++) out[i] = m8[i];
          return out;
        },
        chiudi: function () {
          if (chiuso) return;
          fatto();
          if (stato.es !== es) return; // istanza buttata
          if (ent) es.atv_libera(ent);
          es.atv_libera(usc);
          var lista = stato.liberi[chiave] || (stato.liberi[chiave] = []);
          if (lista.length < 2) lista.push(h); else es.atv_chiudi(h);
        }
      };
    }
    // suRiposo(fn): fn quando il codec va a riposo (il convertitore svuota la sua cache dei Cluster)
    return { nome: 'wasm', pronto: pronto, apri: apri, suRiposo: function (fn) { alRiposo.push(fn); }, _stato: stato };
  }

  /* ============================================================ byte e numeri, EBML */

  function nuovo(n) { return typeof Buffer.allocUnsafe === 'function' ? Buffer.allocUnsafe(n) : new Buffer(n); }
  function copia(b) { var c = nuovo(b.length); b.copy(c); return c; }
  function unisci(l) { return l.length === 1 ? l[0] : Buffer.concat(l); }
  // la vista v sta nella memoria di b (un pezzo di un blocco che si riusa)
  function nelBlocco(v, b) { return v.buffer === b.buffer && v.byteOffset >= b.byteOffset && v.byteOffset < b.byteOffset + b.length; }
  function daTesto(s) { var b = nuovo(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }
  function byte(l) { var b = nuovo(l.length); for (var i = 0; i < l.length; i++) b[i] = l[i]; return b; }
  function uint(b, i, n) { var v = 0; for (var k = 0; k < n; k++) v = v * 256 + b[i + k]; return v; }
  function adesso() { var t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; }

  function leggiId(b, i, fine) {
    if (i >= fine) return null;
    var c = b[i], n = c & 0x80 ? 1 : c & 0x40 ? 2 : c & 0x20 ? 3 : c & 0x10 ? 4 : 0;
    if (!n) return { id: -1, n: 1 };
    if (i + n > fine) return null;
    return { id: uint(b, i, n), n: n };
  }
  function leggiVint(b, i, fine) {
    if (i >= fine) return null;
    var c = b[i], n = 1, m = 0x80;
    while (n <= 8 && !(c & m)) { n++; m >>= 1; }
    if (n > 8) return { v: -1, n: 1, rotto: true };
    if (i + n > fine) return null;
    var v = c & (m - 1), tutti = v === m - 1;
    for (var k = 1; k < n; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) tutti = false; }
    return { v: v, n: n, ignota: tutti };
  }
  function figli(b, da, a, fn) {
    var i = da;
    while (i < a) {
      var id = leggiId(b, i, a);
      if (!id || id.id < 0) return false;
      var d = leggiVint(b, i + id.n, a);
      if (!d || d.rotto || d.ignota) return false;
      var s = i + id.n + d.n, e = s + d.v;
      if (e > a) return false;
      if (fn(id.id, s, e, i) === false) return true;
      i = e;
    }
    return true;
  }
  function lunghezzaVint(v) { var n = 1; while (n < 8 && v >= Math.pow(2, 7 * n) - 1) n++; return n; }
  function vint(v, n) {
    var b = nuovo(n), x = v;
    for (var k = n - 1; k >= 0; k--) { b[k] = x % 256; x = Math.floor(x / 256); }
    b[0] |= 0x80 >> (n - 1);
    return b;
  }
  function idByte(id) {
    var n = id >= 0x10000000 ? 4 : id >= 0x200000 ? 3 : id >= 0x4000 ? 2 : 1, b = nuovo(n);
    for (var k = n - 1; k >= 0; k--) { b[k] = id & 0xff; id = Math.floor(id / 256); }
    return b;
  }
  function uintByte(v) {
    var l = [];
    do { l.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0);
    var b = nuovo(l.length);
    for (var i = 0; i < l.length; i++) b[i] = l[i];
    return b;
  }
  function elemento(id, dati) { return Buffer.concat([idByte(id), vint(dati.length, lunghezzaVint(dati.length)), dati]); }
  // la testa di un Void lungo n byte in tutto (n >= 2): dentro restano i byte che c'erano
  function testaVoid(n) {
    for (var k = 1; k <= 8; k++) {
      var dati = n - 1 - k;
      if (dati >= 0 && lunghezzaVint(dati) <= k) return Buffer.concat([byte([ID.VOID]), vint(dati, k)]);
    }
    throw new Error('Void impossibile: ' + n);
  }

  var ID = {
    CLUSTER: 0x1F43B675, TEMPO: 0xE7, SIMPLE: 0xA3, GRUPPO: 0xA0, BLOCCO: 0xA1, VOID: 0xEC, CRC: 0xBF, ENTRY: 0xAE,
    NUM: 0xD7, CODEC: 0x86, PRIVATO: 0x63A2, DURATA_PRED: 0x23E383, AUDIO: 0xE1, CANALI: 0x9F, BIT: 0x6264,
    FREQ_USCITA: 0x78B5, CODIFICHE: 0x6D80, CODEC_NOME: 0x258688, CODEC_RITARDO: 0x56AA, PREROLL: 0x56BB, MAPPA: 0x41E4,
    MAX_AGGIUNTE: 0x55EE, CUES: 0x1C53BB6B, TAGS: 0x1254C367, CHAPTERS: 0x1043A770, SEEKHEAD: 0x114D9B74,
    INFO: 0x1549A966, TRACKS: 0x1654AE6B, ALLEGATI: 0x1941A469
  };
  var PRIMO_LIVELLO = {};
  [ID.CLUSTER, ID.CUES, ID.TAGS, ID.CHAPTERS, ID.SEEKHEAD, ID.INFO, ID.TRACKS, ID.ALLEGATI].forEach(function (x) { PRIMO_LIVELLO[x] = true; });

  /* ============================================================ le regole */

  // i bitrate dell'AC3, dal piu' alto: 640k quando entra, se no il primo che entra (mai buttare un frame). Non sotto i
  // 64k: l'encoder AC3 di FFmpeg col 5.1 e un suono pieno (rumore) a 40k non ce la fa ("bit allocation failed")
  var KBPS = [640, 576, 512, 448, 384, 320, 256, 224, 192, 160, 128, 112, 96, 80, 64];
  var FRAME = 1536, RIT_ENC = 256;
  var ANTICIPO = 250e6, RITARDO = 100e6;   // un frame AC3 al massimo 250 ms prima o 100 ms dopo il suo posto (ns)
  var N_ANCORA = 48;                       // blocchi della traccia per l'ancora di un Cluster (e per guardare avanti)
  var MAX_CLUSTER = 16 << 20;              // un Cluster piu' grande non si converte (la traccia tace li')
  var AVANTI = 8 << 20;                    // quanto si guarda oltre un Cluster per trovare l'audio che segue
  var MAX_PRIMA = 4;                       // Cluster precedenti letti per l'audio prima
  var CERCA_INDIETRO = 16 << 20;           // quanto si cerca all'indietro l'inizio di un Cluster
  var FETTA = 12;                          // ms di lavoro prima di cedere il turno
  var CACHE_MAX = 6 << 20;                 // i Cluster convertiti tenuti (le sole parti cambiate), per tutti i file
  var SOGLIA = 0.5;                        // si converte se costa al massimo mezzo core (la "Velocita' del TV")
  var SOVRACCARICO = { DTS: 1.25, TRUEHD: 1.5, MLP: 1.5 }; // ogni Cluster riparte da capo: un po' di lavoro in piu'
  var FREQ_BUONE = { 48000: true, 44100: true, 32000: true };

  // la misura di un frame AC3 in byte (a 44,1 kHz la piu' grande delle due)
  function misuraAc3(kbps, freq) {
    if (freq === 44100) return 2 * (Math.floor(kbps * 1000 * FRAME / 44100 / 16) + 1);
    return Math.round(kbps * 1000 * FRAME / freq / 8);
  }
  function costoBlocco(n, numLen) { var d = numLen + 3 + n; return 1 + lunghezzaVint(d) + d; }

  // che traccia e' (null: non si converte)
  function tipoDi(t) {
    var c = String(t && t.codec || '');
    if (/^A_DTS(\/LOSSLESS)?$/.test(c)) return 'DTS';
    if (/^A_TRUEHD$/.test(c)) return 'TRUEHD';
    if (/^A_MLP$/.test(c)) return 'MLP';
    return null;
  }
  function famigliaDi(tipo) { return tipo === 'DTS' ? 'DTS' : 'TRUEHD'; }
  function convertibile(t) {
    var tipo = tipoDi(t), a = t.audio || {};
    if (!tipo || t.tipo !== 2 || t.cifrata || t.abilitata === false) return null;
    if (!FREQ_BUONE[a.freq]) return null;
    if (t.comp && !(t.comp.algo === 3 && t.comp.dati)) return null; // zlib sui frame audio: no
    return tipo;
  }

  // quanti campioni vale un frame sorgente
  function campioniDi(tipo, d) {
    if (tipo === 'DTS') {
      if (d.length >= 10 && d[0] === 0x7f && d[1] === 0xfe && d[2] === 0x80 && d[3] === 0x01) return ((((d[4] & 1) << 6) | (d[5] >> 2)) + 1) * 32;
      return 512;
    }
    return 40;
  }
  // un frame TrueHD/MLP con la "major sync": da li' il decodificatore riparte uguale
  function sincro(tipo, d) {
    if (tipo === 'DTS' || d.length < 8) return false;
    return d[4] === 0xf8 && d[5] === 0x72 && d[6] === 0x6f && (d[7] === 0xba || d[7] === 0xbb);
  }

  /* ============================================================ Tracks: la TrackEntry convertita */

  // il contenuto nuovo della TrackEntry: CodecID A_AC3, DefaultDuration 32 ms, Channels; via CodecPrivate, BitDepth,
  // compressione dei blocchi (le "header removal" di mkvmerge), CodecName, ritardi, BlockAdditionMapping
  function entryAc3(b, s, e, freq, canali) {
    var parti = [], durata = false, TOGLI = {};
    [ID.PRIVATO, ID.CODIFICHE, ID.CODEC_NOME, ID.CODEC_RITARDO, ID.PREROLL, ID.MAPPA, ID.MAX_AGGIUNTE].forEach(function (x) { TOGLI[x] = true; });
    figli(b, s, e, function (id, a, z, i0) {
      if (TOGLI[id]) return;
      if (id === ID.CODEC) { parti.push(elemento(ID.CODEC, daTesto('A_AC3'))); return; }
      if (id === ID.DURATA_PRED) { parti.push(elemento(ID.DURATA_PRED, uintByte(Math.round(FRAME * 1e9 / freq)))); durata = true; return; }
      if (id === ID.AUDIO) {
        var dentro = [], messi = false;
        figli(b, a, z, function (id2, a2, z2, i2) {
          if (id2 === ID.BIT || id2 === ID.FREQ_USCITA) return;
          if (id2 === ID.CANALI) { dentro.push(elemento(ID.CANALI, uintByte(canali))); messi = true; return; }
          dentro.push(b.slice(i2, z2));
        });
        if (!messi) dentro.push(elemento(ID.CANALI, uintByte(canali)));
        parti.push(elemento(ID.AUDIO, Buffer.concat(dentro)));
        return;
      }
      parti.push(b.slice(i0, z));
    });
    if (!durata) parti.push(elemento(ID.DURATA_PRED, uintByte(Math.round(FRAME * 1e9 / freq))));
    return Buffer.concat(parti);
  }

  // il contenuto nuovo di Tracks (b = i suoi dati, datiDa = dove stanno nel file): la TrackEntry del video dov'e', quella
  // convertita nello spazio libero (di preferenza dov'era), un Void per tutto il resto (anche il CRC-32). Le modifiche:
  // solo i byte che cambiano, [{ pos, byte }]. null se non entra
  function nuoveTracks(b, datiDa, numVideo, numAudio, freq, canali) {
    var el = [], video = null, audio = null;
    var ok = figli(b, 0, b.length, function (id, a, z, i0) {
      var x = { id: id, i0: i0, a: a, z: z, num: -1 };
      if (id === ID.ENTRY) figli(b, a, z, function (id2, a2, z2) { if (id2 === ID.NUM) x.num = uint(b, a2, z2 - a2); });
      if (id === ID.ENTRY && x.num === numVideo && numVideo > 0 && !video) video = x;
      if (id === ID.ENTRY && x.num === numAudio && !audio) audio = x;
      el.push(x);
    });
    if (!ok || !audio || !el.length || el[el.length - 1].z !== b.length) return null;
    var nuova = entryAc3(b, audio.a, audio.z, freq, canali);
    // gli spazi liberi: tutto tranne la TrackEntry del video
    var spazi = video ? [[0, video.i0], [video.z, b.length]] : [[0, b.length]];
    var lung = 1 + lunghezzaVint(nuova.length) + nuova.length, scelto = -1, i;
    for (i = 0; i < spazi.length; i++) if (spazi[i][0] <= audio.i0 && audio.i0 < spazi[i][1] && spazi[i][1] - spazi[i][0] >= lung) scelto = i;
    for (i = 0; i < spazi.length && scelto < 0; i++) if (spazi[i][1] - spazi[i][0] >= lung) scelto = i;
    if (scelto < 0) return null;
    var out = copia(b);
    for (i = 0; i < spazi.length; i++) {
      var da = spazi[i][0], a = spazi[i][1];
      if (a - da <= 0) continue;
      if (i === scelto) {
        var resto = a - da - lung, piu = resto === 1 ? 1 : 0;
        var x = Buffer.concat([idByte(ID.ENTRY), vint(nuova.length, lunghezzaVint(nuova.length) + piu), nuova]);
        x.copy(out, da);
        da += x.length;
        if (a - da >= 2) testaVoid(a - da).copy(out, da);
      } else testaVoid(a - da).copy(out, da);
    }
    var mod = [];
    for (i = 0; i < out.length; i++) if (out[i] !== b[i]) mod.push({ pos: datiDa + i, byte: out[i] });
    return mod;
  }

  /* ============================================================ i Cluster */

  // i frame di un blocco (SimpleBlock o Block) in b[i..fine): { num, rel, frame: [{ i, n }] } o null
  function bloccoDi(b, i, fine) {
    var tv = leggiVint(b, i, fine);
    if (!tv || tv.rotto || i + tv.n + 3 > fine) return null;
    var k = i + tv.n, rel = b.readInt16BE(k), flags = b[k + 2], lac = (flags >> 1) & 3, p = k + 3;
    var out = { num: tv.v, rel: rel, numLen: tv.n, frame: [] };
    if (!lac) { out.frame.push({ i: p, n: fine - p }); return out; }
    if (p >= fine) return null;
    var quanti = b[p] + 1, misure = [], j;
    p++;
    if (lac === 1) {
      for (j = 0; j < quanti - 1; j++) {
        var s = 0;
        while (p < fine && b[p] === 255) { s += 255; p++; }
        if (p >= fine) return null;
        s += b[p++];
        misure.push(s);
      }
    } else if (lac === 3) {
      var v0 = leggiVint(b, p, fine);
      if (!v0 || v0.rotto) return null;
      misure.push(v0.v);
      p += v0.n;
      for (j = 1; j < quanti - 1; j++) {
        var dv = leggiVint(b, p, fine);
        if (!dv || dv.rotto) return null;
        misure.push(misure[j - 1] + dv.v - (Math.pow(2, 7 * dv.n - 1) - 1));
        p += dv.n;
      }
    }
    var resto = fine - p, usati = 0;
    for (j = 0; j < misure.length; j++) { if (misure[j] < 0) return null; usati += misure[j]; }
    if (lac === 2) {
      if (resto % quanti) return null;
      misure = [];
      for (j = 0; j < quanti; j++) misure.push(resto / quanti);
    } else {
      if (resto - usati < 0) return null;
      misure.push(resto - usati);
    }
    for (j = 0; j < misure.length; j++) { out.frame.push({ i: p, n: misure[j] }); p += misure[j]; }
    return out;
  }

  // i figli di un Cluster in b (b[0] = posizione "base" nel file), fino a "fine" (o fin dove ci sono byte: parziale)
  // -> { pos, fine, tempo, el: [{ pos, fine, libero, crc, traccia }], blocchi: [{ el, ts, frame: [{ dati, d, sync }] }] }
  function leggiCluster(b, base, pos, fine, st, parziale) {
    var h = pos - base, hi = leggiId(b, h, b.length), hd = hi && hi.id === ID.CLUSTER ? leggiVint(b, h + hi.n, b.length) : null;
    if (!hd || hd.rotto) return null;
    var end = Math.min(b.length, fine - base), i = h + hi.n + hd.n;
    var c = { pos: pos, fine: fine, tempo: 0, el: [], blocchi: [], completo: false, rotto: false };
    while (i < end) {
      var id = leggiId(b, i, end);
      if (!id) break;
      if (id.id < 0) { c.rotto = true; break; }
      if (hd.ignota && PRIMO_LIVELLO[id.id]) break;
      var d = leggiVint(b, i + id.n, end);
      if (!d) break;
      if (d.rotto || d.ignota) { c.rotto = true; break; }
      var s = i + id.n + d.n, e = s + d.v;
      if (e > end) { if (!parziale) c.rotto = true; break; }
      var x = { pos: base + i, fine: base + e, libero: false, crc: false, traccia: false };
      if (id.id === ID.TEMPO) c.tempo = uint(b, s, d.v);
      else if (id.id === ID.VOID) x.libero = true;
      else if (id.id === ID.CRC) { x.libero = true; x.crc = true; }
      else if (id.id === ID.SIMPLE || id.id === ID.GRUPPO) {
        var bl = null;
        if (id.id === ID.SIMPLE) bl = bloccoDi(b, s, e);
        else figli(b, s, e, function (id2, a2, z2) { if (id2 === ID.BLOCCO) { bl = bloccoDi(b, a2, z2); return false; } });
        if (bl && bl.num === st.num) {
          x.libero = true;
          x.traccia = true;
          var fr = [];
          for (var k = 0; k < bl.frame.length; k++) {
            var q = b.slice(bl.frame[k].i, bl.frame[k].i + bl.frame[k].n);
            if (st.prefisso) q = Buffer.concat([st.prefisso, q]);
            fr.push({ dati: q, d: campioniDi(st.tipo, q), sync: sincro(st.tipo, q) });
          }
          c.blocchi.push({ el: c.el.length, ts: (c.tempo + bl.rel) * st.scala, frame: fr });
        }
      }
      c.el.push(x);
      i = e;
    }
    c.fine = hd.ignota ? base + i : fine;
    c.completo = !c.rotto && base + i === c.fine;
    return c;
  }

  // dove comincia ogni frame (in campioni della traccia): l'ancora di un Cluster sono i suoi primi blocchi (fino a 48),
  // coi tempi mediati e messi sulla griglia dei frame che parte dal primo frame della traccia (t0, in ns). Dopo un buco
  // nei tempi si riparte da quel blocco. I frame prendono g (il primo campione) e cl (il Cluster)
  function ancora(c, st) {
    var bl = c.blocchi, freq = st.freq, j, k, ns = 1e9 / freq;
    if (!bl.length) return;
    function griglia(u, d) { var g = Math.round((u - st.t0) / ns); return d > 0 ? Math.round(g / d) * d : g; }
    var somma = 0, o = 0, quanti = 0;
    for (j = 0; j < bl.length && j < N_ANCORA; j++) {
      somma += bl[j].ts - o * ns;
      quanti++;
      for (k = 0; k < bl[j].frame.length; k++) o += bl[j].frame[k].d;
    }
    var g = griglia(somma / quanti, bl[0].frame.length ? bl[0].frame[0].d : 0);
    var toll = Math.max(3e6, 2 * 512 * ns);
    for (j = 0; j < bl.length; j++) {
      if (j && Math.abs(bl[j].ts - (st.t0 + g * ns)) > toll) g = griglia(bl[j].ts, bl[j].frame.length ? bl[j].frame[0].d : 0);
      for (k = 0; k < bl[j].frame.length; k++) {
        var f = bl[j].frame[k];
        f.g = g;
        f.el = bl[j].el;
        f.cl = c.pos;
        g += f.d;
      }
    }
  }
  function frameDi(c) {
    var out = [];
    for (var j = 0; j < c.blocchi.length; j++) for (var k = 0; k < c.blocchi[j].frame.length; k++) out.push(c.blocchi[j].frame[k]);
    return out;
  }

  // da quale frame deve partire il decodificatore perche' esca uguale da qualunque punto: DTS un frame prima di quello
  // che serve, TrueHD l'ultima "major sync". -1 = servono frame piu' vecchi (dai Cluster prima)
  function inizioDec(tutti, gInizio, tipo) {
    if (!tutti.length) return -1;
    var j = 0;
    while (j + 1 < tutti.length && tutti[j + 1].g <= gInizio) j++;
    if (tutti[j].g > gInizio && tutti[0].g > 0) return -1;
    if (tipo === 'DTS') {
      if (j === 0) return tutti[0].g > 0 && tutti[0].g + tutti[0].d > gInizio ? -1 : 0;
      return j - 1;
    }
    for (var k = j; k >= 0; k--) if (tutti[k].sync) return k;
    return tutti[0].g > 0 ? -1 : 0;
  }

  // i frame AC3 di un Cluster nelle sue file. Si prova tutto a 640k: dal fondo, ognuno nella fila del suo primo
  // campione; se non entra in una prima (al massimo 250 ms prima) o dopo (100 ms). Se anche un frame solo resta fuori,
  // si riprova tutto al bitrate dopo (448k...), finche' entrano tutti; poi ogni fila alza i suoi frame finche' ha posto.
  // Cosi' nessun frame si butta. -> { file: [{ pos, fine, resto, frame: [{ n, kbps, tn }], cambia }], persi, kbps }
  function piazza(c, fr, nA, nB, st) {
    var file0 = [], fila = null, diEl = [], i, ns = 1e9 / st.freq;
    for (i = 0; i < c.el.length; i++) {
      var x = c.el[i];
      if (!x.libero) { fila = null; diEl.push(-1); continue; }
      if (!fila) { fila = { pos: x.pos, fine: x.fine, tempo: -1, cambia: false }; file0.push(fila); } else fila.fine = x.fine;
      if (x.traccia || x.crc) fila.cambia = true;
      diEl.push(file0.length - 1);
    }
    for (i = 0; i < fr.length; i++) { var fi = file0[diEl[fr[i].el]]; if (fi && fi.tempo < 0) fi.tempo = st.t0 + fr[i].g * ns; }
    var prima = c.tempo * st.scala;
    for (i = 0; i < file0.length; i++) { if (file0[i].tempo < 0) file0[i].tempo = prima; prima = file0[i].tempo; }
    var p = null;
    for (var k = 0; k < KBPS.length; k++) {
      p = prova(KBPS[k]);
      if (!p.persi) break;
    }
    // le file alzano i loro frame (dal primo) finche' lo spazio basta
    for (i = 0; i < p.file.length; i++) {
      var fl = p.file[i];
      for (var q = 0; q < fl.frame.length; q++) {
        var y = fl.frame[q], ora = costoBlocco(misuraAc3(y.kbps, st.freq), st.numLen);
        for (var h = 0; h < KBPS.length && KBPS[h] > y.kbps; h++) {
          var piu = costoBlocco(misuraAc3(KBPS[h], st.freq), st.numLen) - ora;
          if (piu <= fl.resto) { fl.resto -= piu; y.kbps = KBPS[h]; break; }
        }
      }
    }
    return p;
    function prova(kbps) {
      var file = [], r, j = fr.length - 1, persi = 0, costo = costoBlocco(misuraAc3(kbps, st.freq), st.numLen);
      for (var a = 0; a < file0.length; a++) {
        var f0 = file0[a];
        file.push({ pos: f0.pos, fine: f0.fine, tempo: f0.tempo, cambia: f0.cambia, resto: f0.fine - f0.pos, frame: [] });
      }
      r = file.length - 1;
      for (var n = nB; n >= nA; n--) {
        var s = FRAME * n, tn = st.t0 + s * ns, prove = [], b;
        while (j > 0 && fr[j].g > s) j--;
        var nat = diEl[fr[j].el];
        if (nat <= r) prove.push(nat);
        for (b = Math.min(nat, r + 1) - 1; b >= 0 && tn - file[b].tempo <= ANTICIPO; b--) prove.push(b);
        for (b = nat + 1; b <= r && file[b].tempo - tn <= RITARDO; b++) prove.push(b);
        var messo = false;
        for (b = 0; b < prove.length && !messo; b++) {
          if (file[prove[b]].resto < costo) continue;
          file[prove[b]].resto -= costo;
          file[prove[b]].frame.unshift({ n: n, kbps: kbps, tn: tn });
          file[prove[b]].cambia = true;
          r = prove[b];
          messo = true;
        }
        if (!messo) persi++;
      }
      return { file: file, persi: persi, kbps: kbps };
    }
  }

  // un SimpleBlock (chiave, senza lacing); piu = un byte in piu' nella misura (quando avanza un byte solo)
  function simpleBlock(num, numLen, rel, dati, piu) {
    var d = numLen + 3 + dati.length, t = nuovo(3);
    t.writeInt16BE(rel, 0);
    t[2] = 0x80;
    return Buffer.concat([byte([ID.SIMPLE]), vint(d, lunghezzaVint(d) + (piu || 0)), vint(num, numLen), t, dati]);
  }
  // le parti cambiate di un Cluster: [{ pos, dati }]. ac3 = { n: Buffer }; senza ac3 (Cluster che tace) solo Void
  function toppe(c, piano, ac3, st) {
    var out = [];
    for (var i = 0; i < piano.file.length; i++) {
      var fl = piano.file[i], parti = [], usato = 0, spazio = fl.fine - fl.pos, k;
      if (!fl.cambia) continue;
      for (k = 0; k < fl.frame.length; k++) {
        var x = fl.frame[k], dati = ac3 ? ac3[x.n] : null;
        if (!dati) continue;
        var rel = Math.round(x.tn / st.scala) - c.tempo;
        if (rel < -32768 || rel > 32767) continue;
        var bl = simpleBlock(st.num, st.numLen, rel, dati, 0);
        if (usato + bl.length > spazio) continue;
        parti.push(bl);
        usato += bl.length;
      }
      var resto = spazio - usato;
      if (resto === 1) {
        if (parti.length) {
          // un byte solo non fa un Void: si allunga di un byte la misura del primo blocco
          var p0 = parti[0], tv = leggiVint(p0, 1, p0.length);
          parti[0] = Buffer.concat([p0.slice(0, 1), vint(tv.v, tv.n + 1), p0.slice(1 + tv.n)]);
          resto = 0;
        } else continue; // (non succede: una fila e' lunga almeno 2)
      }
      if (resto >= 2) parti.push(testaVoid(resto));
      out.push({ pos: fl.pos, dati: unisci(parti) });
    }
    return out;
  }

  /* ============================================================ la cache dei Cluster convertiti (per tutti i file) */

  var cache = { voci: {}, peso: 0 };
  function cacheChiave(f, st, pos) { return f.percorso + '|' + f.dim + '|' + f.data + '|' + st.num + '|' + pos; }
  function cachePrendi(k) { var x = cache.voci[k]; if (x) x.usato = Date.now(); return x ? x.toppe : null; }
  function cacheMetti(k, t) {
    var peso = 64;
    for (var i = 0; i < t.length; i++) peso += t[i].dati.length + 32;
    if (cache.voci[k]) { cache.peso -= cache.voci[k].peso; delete cache.voci[k]; }
    cache.voci[k] = { toppe: t, peso: peso, usato: Date.now() };
    cache.peso += peso;
    if (cache.peso <= CACHE_MAX) return;
    var l = Object.keys(cache.voci).sort(function (a, b) { return cache.voci[a].usato - cache.voci[b].usato; });
    for (var j = 0; j < l.length && cache.peso > CACHE_MAX; j++) { cache.peso -= cache.voci[l[j]].peso; delete cache.voci[l[j]]; }
  }

  /* ============================================================ il convertitore */

  function crea(o) {
    o = o || {};
    var codec = o.codec || null, log = typeof o.log === 'function' ? o.log : function () {};
    // a riposo anche i Cluster convertiti tenuti in memoria (fino a 6 MB) se ne vanno
    if (codec && typeof codec.suRiposo === 'function') codec.suRiposo(function () { cache.voci = {}; cache.peso = 0; });
    var soglia = o.soglia > 0 ? o.soglia : SOGLIA, maxCluster = o.maxCluster > 0 ? o.maxCluster : MAX_CLUSTER;
    // la velocita' del TV: { dtsAc3, truehdAc3 (quota di un core), vera: { DTS, TRUEHD } (ms per secondo d'audio
    // misurati convertendo davvero) }, salvata in o.file; o data dalle prove
    var vel = null, misurando = null, conti = { cluster: 0, frame: 0, persi: 0, ms: 0, secondi: 0, cache: 0, errori: 0, senzaPrima: 0 };
    if (o.velocita) vel = o.velocita;
    else if (o.fs && o.file) {
      try {
        var v0 = JSON.parse(o.fs.readFileSync(o.file, 'utf8'));
        if (v0 && v0.node === process.version && v0.arch === process.arch && v0.dtsAc3 > 0) vel = v0;
      } catch (e) { vel = null; }
    }
    function salva() {
      if (!o.fs || !o.file || o.velocita) return;
      try { o.fs.writeFileSync(o.file, JSON.stringify(vel)); } catch (e) {}
    }
    // la quota di un core che servirebbe per una traccia di questo tipo (null: non si sa)
    function quota(tipo) {
      if (!vel) return null;
      var fam = famigliaDi(tipo), vera = vel.vera && vel.vera[fam];
      if (vera > 0) return vera / 1000;
      var q = fam === 'DTS' ? vel.dtsAc3 : vel.truehdAc3;
      return q > 0 ? q * SOVRACCARICO[tipo] : null;
    }
    function regge(tipo) { var q = quota(tipo); return q !== null && q <= soglia; }

    // ---- per la videoteca

    function statoTraccia(f, num) {
      var t = f.audioTv || (f.audioTv = {});
      return t[num] || (t[num] = { num: num, pronta: false, rotta: false, attese: null });
    }
    // i codec che il TV legge per questo file: DTS e TrueHD "tv" (li converte il TV), con le tracce che si possono
    // (letti.tv[num] = true). Se il TV non regge o manca il codec, quelli di prima
    function letti(base, f) {
      var m = f && f.m;
      if (!codec || (codec._stato && codec._stato.errore) || !m || m.formato !== 'mkv' || !vel) return base;
      var tv = {}, quante = 0;
      for (var i = 0; i < m.tracce.length; i++) {
        var t = m.tracce[i], tipo = convertibile(t), fam = tipo ? famigliaDi(tipo) : null;
        if (!tipo || (base.audio && base.audio[fam])) continue;
        if (!regge(tipo) || (f.audioTv && f.audioTv[t.num] && f.audioTv[t.num].rotta)) continue;
        tv[t.num] = true;
        quante++;
      }
      if (!quante) return base;
      var l = { audio: {}, video: base.video, tv: tv };
      for (var k in base.audio) if (Object.prototype.hasOwnProperty.call(base.audio, k)) l.audio[k] = base.audio[k];
      if (!l.audio.DTS) l.audio.DTS = 'tv';
      if (!l.audio.TRUEHD) l.audio.TRUEHD = 'tv';
      return l;
    }
    // ci sono tracce DTS o TrueHD da convertire (e il TV non le legge da se')?
    function tracceDa(m, base) {
      if (!m || m.formato !== 'mkv') return 0;
      var n = 0;
      for (var i = 0; i < m.tracce.length; i++) { var tipo = convertibile(m.tracce[i]); if (tipo && !(base && base.audio && base.audio[famigliaDi(tipo)])) n++; }
      return n;
    }
    // per l'app: perche' il TV converte o no (null se il file non ha tracce da convertire)
    function stato(f, base) {
      var m = f && f.m;
      if (!m || !tracceDa(m, base)) return null;
      if (!codec) return { stato: 'spento' };
      if (codec._stato && codec._stato.errore) return { stato: 'spento' };
      if (!vel) return { stato: 'misura' };
      var tipi = {}, out = { stato: 'pronto' };
      for (var i = 0; i < m.tracce.length; i++) { var tipo = convertibile(m.tracce[i]); if (tipo) tipi[tipo] = true; }
      for (var t in tipi) {
        if (!Object.prototype.hasOwnProperty.call(tipi, t)) continue;
        var q = quota(t);
        if (q !== null) out.quota = Math.max(out.quota || 0, Math.round(q * 100) / 100);
        if (!regge(t)) out.stato = 'lento';
      }
      var rotte = 0;
      for (var k in f.audioTv || {}) if (Object.prototype.hasOwnProperty.call(f.audioTv, k) && f.audioTv[k].rotta) rotte++;
      if (rotte && out.stato === 'pronto') out.stato = 'rotto';
      return out;
    }
    // prima delle informazioni di un film con DTS o TrueHD: la misura della velocita', una volta sola (true = si
    // aspetta: fn verra' chiamata dopo)
    function attendi(f, base, fn) {
      if (!codec || vel || !o.misura || !tracceDa(f && f.m, base)) return false;
      if (misurando) { misurando.push(fn); return true; }
      if (misurando === false) return false; // gia' provata e non riuscita
      misurando = [fn];
      log('Audio del TV: misuro la velocita\' del TV (una volta sola)');
      var finito = false;
      function fatto(r) {
        if (finito) return;
        finito = true;
        if (r && r.wasm && r.dtsAc3 > 0) velocita(r);
        var l = misurando;
        misurando = vel ? null : false;
        for (var i = 0; i < l.length; i++) { try { l[i](); } catch (e) {} }
      }
      try { o.misura(fatto); } catch (e) { fatto(null); }
      return true;
    }
    // una misura nuova (anche dall'app, "Velocita' del TV"): da qui conta lei, finche' le conversioni vere non ne fanno
    // una loro
    function velocita(r) {
      if (!r || !r.wasm || !(r.dtsAc3 > 0)) return;
      vel = { node: process.version, arch: process.arch, quando: Date.now(), rapporto: r.rapporto, dtsAc3: r.dtsAc3, truehdAc3: r.truehdAc3, vera: {}, somme: {} };
      salva();
    }
    function pronta(f, num) { var st = f.audioTv && f.audioTv[num]; return !!(st && st.pronta); }

    // la preparazione di una traccia, una volta per file: Tracks rifatta e il primo frame (t0). Il codec qui non serve: si
    // compila alla prima fetta di conversione (aprire la scheda di un film DTS non deve costare ~66 MB al TV)
    function prepara(f, pi, cb) {
      var num = pi.converti, st = statoTraccia(f, num), m = f.m;
      if (st.pronta || st.rotta) { cb(); return; }
      if (st.attese) { st.attese.push(cb); return; }
      st.attese = [cb];
      function fine(err) {
        if (err) { st.rotta = true; conti.errori++; log('Audio del TV: la traccia ' + num + ' non si converte (' + String(err.message || err).slice(0, 120) + ')'); }
        else st.pronta = true;
        var l = st.attese;
        st.attese = null;
        for (var i = 0; i < l.length; i++) { try { l[i](); } catch (e) {} }
      }
      var t = null;
      for (var i = 0; i < m.tracce.length; i++) if (m.tracce[i].num === num) t = m.tracce[i];
      var tipo = t ? convertibile(t) : null;
      if (!tipo || !codec || (codec._stato && codec._stato.errore) || !(m.tracksDati >= 0) || !(m.cluster1 > 0)) { fine(new Error('traccia non adatta')); return; }
      st.tipo = tipo;
      st.freq = t.audio.freq;
      st.canali = Math.min(6, t.audio.canali > 0 ? t.audio.canali : 6);
      st.numLen = lunghezzaVint(num);
      st.scala = m.scala;
      st.prefisso = t.comp && t.comp.algo === 3 ? t.comp.dati : null;
      var fs = f.fs;
      fs.open(f.percorso, 'r', function (e1, fd) {
        if (e1) { fine(e1); return; }
        function chiudi(e) { fs.close(fd, function () {}); fine(e); }
        leggiTutto(fs, fd, m.tracksDati, m.tracksFine - m.tracksDati, function (e2, b) {
          if (e2 || !b || b.length !== m.tracksFine - m.tracksDati) { chiudi(e2 || new Error('Tracks non letto')); return; }
          var mod = null;
          try { mod = nuoveTracks(b, m.tracksDati, pi.video, num, st.freq, st.canali); } catch (e3) { mod = null; }
          if (!mod) { chiudi(new Error('la TrackEntry nuova non entra')); return; }
          st.fisse = mod;
          // il primo Cluster con la traccia: il tempo del suo primo frame e' lo zero della griglia AC3
          primoAudio(fs, fd, m, st, function (e4, c) {
            if (e4 || !c) { chiudi(e4 || new Error('nessun blocco della traccia')); return; }
            var bl = c.blocchi, somma = 0, o2 = 0, q = 0;
            for (var j = 0; j < bl.length && j < N_ANCORA; j++) {
              somma += bl[j].ts - o2 * 1e9 / st.freq;
              q++;
              for (var k = 0; k < bl[j].frame.length; k++) o2 += bl[j].frame[k].d;
            }
            st.t0 = somma / q;
            chiudi(null);
          });
        });
      });
    }
    function fisse(f, num) { var st = f.audioTv && f.audioTv[num]; return st && st.pronta ? st.fisse : null; }

    /* ---- letture dal file */

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
    function leggiTutto(fs, fd, pos, n, cb) { leggiIn(fs, fd, nuovo(n), pos, n, cb); }
    // un Cluster intero letto dal file (al massimo maxCluster): cb(err, cluster, byte)
    function clusterDa(fs, fd, pos, st, cb) {
      leggiTutto(fs, fd, pos, 16, function (e, h) {
        if (e || !h || h.length < 8) { cb(e || null, null); return; }
        var hi = leggiId(h, 0, h.length), hd = hi && hi.id === ID.CLUSTER ? leggiVint(h, hi.n, h.length) : null;
        if (!hd || hd.rotto) { cb(null, null); return; }
        var n = hd.ignota ? 4 << 20 : hi.n + hd.n + hd.v;
        if (n > maxCluster) { cb(null, { pos: pos, fine: pos + n, troppo: true, el: [], blocchi: [] }); return; }
        leggiTutto(fs, fd, pos, n, function (e2, b) {
          if (e2) { cb(e2); return; }
          var c = null;
          try { c = leggiCluster(b, pos, pos, hd.ignota ? pos + b.length : pos + n, st, false); } catch (e3) { c = null; }
          cb(null, c, b);
        });
      });
    }
    // dal primo Cluster in avanti fino al primo con la traccia (al massimo 64 MB e 400 Cluster)
    function primoAudio(fs, fd, m, st, cb) {
      var pos = m.cluster1, giri = 0;
      (function giro() {
        if (pos <= 0 || pos >= m.dim || pos - m.cluster1 > (64 << 20) || ++giri > 400) { cb(null, null); return; }
        clusterDa(fs, fd, pos, st, function (e, c) {
          if (e) { cb(e); return; }
          if (!c) { cb(null, null); return; }
          if (c.blocchi && c.blocchi.length) { cb(null, c); return; }
          pos = c.fine;
          setImmediate(giro);
        });
      })();
    }
    // il Cluster che finisce proprio in "pos": dai confini noti, se no cercando all'indietro 1F 43 B6 75 con la misura
    // che porta a "pos". cb(err, cluster) (null se non trovato)
    function precedente(fs, fd, m, st, pos, confinePrima, cb) {
      var c0 = confinePrima ? confinePrima(m.confini || [], pos - 1) : -1;
      // un pezzo da 1 MB alla volta, dal fondo, con 16 byte del pezzo dopo (l'intestazione di un Cluster a cavallo); il
      // Cluster con la misura giusta si rilegge intero. Prima i pezzi si univano tutti a ogni giro: per un salto fino a
      // 136 MB copiati e 32 MB in un colpo
      function cerca() {
        var da = pos, letti = 0;
        (function giro() {
          if (da <= m.cluster1 || letti >= CERCA_INDIETRO) { cb(null, null); return; }
          var n = Math.min(1 << 20, da - m.cluster1);
          leggiTutto(fs, fd, da - n, n + 16, function (e, b) {
            if (e || !b || b.length < n) { cb(e || null, null); return; }
            da -= n;
            letti += n;
            var base = da, i = n;
            (function prossimo() {
              // dal fondo: l'inizio di Cluster piu' vicino a "pos" con la misura giusta
              while (i > 0) {
                i = b.lastIndexOf ? b.lastIndexOf(SINCRO_CLUSTER, i - 1) : -1;
                if (i < 0) break;
                var d = leggiVint(b, i + 4, b.length);
                if (d && !d.rotto && !d.ignota && base + i + 4 + d.n + d.v === pos) {
                  clusterDa(fs, fd, base + i, st, function (e2, c) {
                    if (e2) { cb(e2, null); return; }
                    if (c && c.completo && c.fine === pos) { cb(null, c); return; }
                    prossimo();
                  });
                  return;
                }
              }
              setImmediate(giro);
            })();
          });
        })();
      }
      if (c0 >= m.cluster1 && c0 < pos && pos - c0 <= maxCluster) {
        clusterDa(fs, fd, c0, st, function (e, c) {
          if (!e && c && c.completo && c.fine === pos) { cb(null, c); return; }
          cerca();
        });
      } else cerca();
    }

    /* ---- il film servito: la lettura dal file, la scansione della videoteca (tracce nascoste, sottotitoli), e i
     * Cluster con la traccia tenuti finche' non sono convertiti */

    // x = { a, z, fisse, scansione: fn() -> Scansione, confinePrima: fn, blocco }
    function servi(req, res, f, pi, x) {
      var st = f.audioTv[pi.audio], m = f.m, fs = f.fs, dim = f.dim, a = x.a, z = x.z, BLOCCO = x.blocco || (512 * 1024);
      var chiuso = false, fd = -1, lettura = 0, eof = false, lavoro = false, aspettaDrain = false, finito = false;
      var scan = x.scansione(), daScansione = -1, sospeso = null, sospesoPos = 0, nf = 0, fermataScan = false, fisseL = x.fisse || [];
      var pezzi = [];          // i byte decisi (scansione e modifiche fatte), in ordine: [{ pos, b }]
      var emesso = 0;          // tutto prima di "emesso" e' gia' mandato (o saltato)
      var p = 0;               // il prossimo elemento di primo livello da guardare
      var voce = null;         // { tipo: 'passa' | 'cluster', pos, fine, c, seg }
      var storia = [];         // i frame della traccia prima del Cluster di adesso (contigui)
      var blocchi = [];        // i blocchi letti, che si riusano: [{ b, attese }]
      var tele = [], telaSeg = null; // le copie dei Cluster in piu' pezzi, che si riusano: [{ b, attese }] e la testa del seguito
      var cercaCluster = false; // la richiesta comincia dove non si conosce un confine: si cerca il prossimo Cluster
      var trovato = -1;        // ... e qui e' stato trovato

      function staccato() {
        chiuso = true;
        if (aspettaDrain) { aspettaDrain = false; res.removeListener('drain', dopoDrain); }
        if (!lavoro) chiudiFd();
      }
      function chiudiFd() { if (fd >= 0) { fs.close(fd, function () {}); fd = -1; } }
      req.on('close', staccato);
      res.on('close', staccato);
      try { if (req.socket && req.socket.setTimeout) req.socket.setTimeout(0); } catch (e0) {}
      function finisci(rotta) {
        if (finito) return;
        finito = true;
        chiudiFd();
        if (chiuso) return;
        if (rotta) { chiuso = true; try { res.destroy(); } catch (e) {} } else res.end();
      }
      function rotto(e) {
        conti.errori++;
        log('Audio del TV: risposta chiusa (' + String(e && e.message || e).slice(0, 160) + ')');
        finisci(true);
      }
      function dopoDrain() { aspettaDrain = false; giro(); }

      // da dove si comincia: un confine noto prima di "a" (il Cluster dove cade, o uno prima)
      function inizia() {
        if (a < m.cluster1) { lettura = a; emesso = a; p = a; daScansione = m.cluster1; parti(); return; }
        var c = x.confinePrima(m.confini, a);
        if (c >= 0 && a - c <= (8 << 20)) { lettura = c; emesso = c; p = c; daScansione = c; parti(); return; }
        // troppo lontano: si cerca all'indietro il Cluster dove cade "a"
        cercaInizio(a, function (pos) {
          if (pos >= 0) { lettura = pos; emesso = pos; p = pos; daScansione = pos; }
          else { lettura = a; emesso = a; p = a; daScansione = -2; cercaCluster = true; }
          parti();
        });
      }
      function cercaInizio(pos0, cb) {
        var da = pos0 + 1, letti = 0;
        (function giro2() {
          if (chiuso || da <= m.cluster1 || letti >= CERCA_INDIETRO) { cb(-1); return; }
          var n = Math.min(1 << 20, da - m.cluster1);
          leggiTutto(fs, fd, da - n, n + 16, function (e, b) {
            if (e || !b) { cb(-1); return; }
            da -= n;
            letti += n;
            var i = n;
            while (i > 0) {
              i = b.lastIndexOf(SINCRO_CLUSTER, i - 1);
              if (i < 0) break;
              var d = leggiVint(b, i + 4, b.length);
              if (d && !d.rotto && !d.ignota && da + i + 4 + d.n + d.v > pos0 && (b[i + 4 + d.n] === 0xe7 || b[i + 4 + d.n] === 0xbf)) { cb(da + i); return; }
            }
            setImmediate(giro2);
          });
        })();
      }
      function parti() { if (!chiuso) giro(); else finisci(); }
      fs.open(f.percorso, 'r', function (e2, x2) {
        if (e2) { chiuso = true; try { res.destroy(); } catch (e) {} return; }
        fd = x2;
        if (chiuso) { chiudiFd(); return; }
        try { inizia(); } catch (e3) { rotto(e3); }
      });

      // i blocchi letti si riusano, come nella videoteca (prima ogni lettura ne faceva uno nuovo: col DTS convertito fino a
      // +76 MB di Buffer morti). Un blocco torna libero quando la rete ha preso tutto quello che e' partito da lui (il
      // callback di res.write) e nessuno lo guarda piu': i pezzi da mandare, il pezzo sospeso, il Cluster di adesso (anche
      // mentre si converte: intanto non si legge). Un Cluster grande ne tiene tanti finche' non e' convertito: dopo, quelli
      // liberi oltre quattro si lasciano andare
      function usato(x) {
        if (x.attese || (sospeso && nelBlocco(sospeso, x.b)) || (voce && voce.byte && nelBlocco(voce.byte, x.b))) return true;
        for (var i = 0; i < pezzi.length; i++) if (nelBlocco(pezzi[i].b, x.b)) return true;
        return false;
      }
      function bloccoLibero() {
        var libero = null, liberi = 0;
        blocchi = blocchi.filter(function (x) {
          if (usato(x)) return true;
          if (!libero) libero = x;
          return ++liberi <= 4;
        });
        if (libero) return libero.b;
        var b = nuovo(BLOCCO);
        if (blocchi.length < 48) blocchi.push({ b: b, attese: 0 });
        return b;
      }
      function bloccoDi(v) {
        for (var i = 0; i < blocchi.length; i++) if (nelBlocco(v, blocchi[i].b)) return blocchi[i];
        for (var j = 0; j < tele.length; j++) if (nelBlocco(v, tele[j].b)) return tele[j];
        return null;
      }
      // un Cluster che sta in piu' pezzi si copia in una "tela" che si riusa, invece che in un Buffer nuovo ogni volta (col
      // DTS erano due copie di ogni Cluster: il Cluster e la testa del seguito). Due tele per il Cluster di adesso: mentre una
      // parte verso la rete, l'altra si riempie; libera come i blocchi (callback di res.write). Il seguito si legge soltanto
      // (l'ancora e i primi frame, finche' il Cluster di adesso non e' convertito): una tela sola
      // con un quarto in piu' (a 64 KB), cosi' i Cluster di misura vicina non la rifanno ogni volta
      function misuraTela(n) { return Math.max(n, Math.min(maxCluster, Math.ceil(n * 1.25 / 65536) * 65536)); }
      function telaCluster(n) {
        for (var i = 0; i < tele.length; i++) {
          if (tele[i].attese || (voce && voce.byte && nelBlocco(voce.byte, tele[i].b))) continue;
          if (tele[i].b.length < n) tele[i] = { b: nuovo(misuraTela(n)), attese: 0 };
          return tele[i].b;
        }
        if (tele.length >= 2) return nuovo(n);
        tele.push({ b: nuovo(misuraTela(n)), attese: 0 });
        return tele[tele.length - 1].b;
      }
      function telaSeguito(n) {
        if (!telaSeg || telaSeg.length < n) telaSeg = nuovo(misuraTela(n));
        return telaSeg;
      }

      // il giro: prima si lavora quello che c'e', poi si legge
      function giro() {
        if (finito) return;
        if (chiuso) { finisci(); return; }
        if (lavoro || aspettaDrain) return;
        var r;
        try { r = avanza(); } catch (e) { rotto(e); return; }
        if (r === 'fine') { finisci(); return; }
        if (r !== 'dati') return; // lavoro in corso o "drain": richiamano giro
        if (sospeso && (sospeso.length >= BLOCCO || fermataScan)) {
          setImmediate(function () { if (chiuso) { finisci(); return; } try { pezzo(null); } catch (e) { rotto(e); return; } giro(); });
          return;
        }
        if (eof) {
          if (sospeso) { try { pezzo(null); } catch (e4) { rotto(e4); return; } giro(); return; }
          // finito il file: quello che resta si chiude com'e'
          try { r = avanza(); } catch (e5) { rotto(e5); return; }
          if (r === 'dati') finisci(emesso <= z);
          else if (r === 'fine') finisci();
          return;
        }
        var n = Math.min(BLOCCO, dim - lettura);
        if (n <= 0) { eof = true; giro(); return; }
        leggiIn(fs, fd, bloccoLibero(), lettura, n, function (e3, b) {
          if (finito) return;
          if (chiuso) { finisci(); return; }
          if (e3 || !b || !b.length) { eof = true; giro(); return; }
          try { pezzo(b); } catch (e) { rotto(e); return; }
          giro();
        });
      }

      // un pezzo letto (o null: si ridanno i byte sospesi): scansione della videoteca, modifiche, e nei "pezzi"
      function pezzo(b) {
        var pos = sospeso ? sospesoPos : lettura, dati = sospeso ? (b ? Buffer.concat([sospeso, b]) : sospeso) : b;
        if (b) lettura += b.length;
        if (lettura >= dim) eof = true;
        sospeso = null;
        if (!dati || !dati.length) return;
        var finale = dati.length, mod = [];
        fermataScan = false;
        if (daScansione === -2) {
          // come la videoteca: il prossimo Cluster (1F 43 B6 75 seguito da un Tempo o da un CRC); prima, i byte com'erano
          for (var i = 0; i + 13 < dati.length; i++) {
            if (dati[i] === 0x1f && dati[i + 1] === 0x43 && dati[i + 2] === 0xb6 && dati[i + 3] === 0x75) {
              var vd = leggiVint(dati, i + 4, dati.length);
              if (vd && !vd.rotto && (dati[i + 4 + vd.n] === 0xe7 || dati[i + 4 + vd.n] === 0xbf)) { daScansione = pos + i; trovato = pos + i; break; }
            }
          }
          if (daScansione === -2) finale = eof ? dati.length : Math.max(0, dati.length - 13);
        }
        if (daScansione >= 0 && pos + dati.length > daScansione) {
          var da = Math.max(0, daScansione - pos);
          var r2 = scan.mangia(da ? dati.slice(da) : dati, pos + da);
          finale = da + r2.usati;
          mod = r2.modifiche;
          fermataScan = r2.fermata;
          if (eof && finale < dati.length && !r2.fermata) finale = dati.length;
          daScansione = pos;
        }
        if (finale < dati.length) { sospeso = dati.slice(finale); sospesoPos = pos + finale; dati = dati.slice(0, finale); }
        for (var k = nf; k < fisseL.length && fisseL[k].pos < pos + dati.length; k++) if (fisseL[k].pos >= pos) dati[fisseL[k].pos - pos] = fisseL[k].byte;
        while (nf < fisseL.length && fisseL[nf].pos < pos + dati.length) nf++;
        for (var j = 0; j < mod.length; j++) if (mod[j] >= pos && mod[j] < pos + dati.length) dati[mod[j] - pos] = ID.VOID;
        if (dati.length) pezzi.push({ pos: pos, b: dati });
      }
      function fineDati() { return pezzi.length ? pezzi[pezzi.length - 1].pos + pezzi[pezzi.length - 1].b.length : emesso; }
      // i byte [da, al) dai pezzi (una copia se stanno in piu' pezzi: in tela(n) se c'e', se no in un Buffer nuovo)
      function prendi(da, al, tela) {
        var parti = [], n = 0;
        for (var i = 0; i < pezzi.length; i++) {
          var q = pezzi[i], qa = q.pos + q.b.length;
          if (qa <= da || q.pos >= al) continue;
          parti.push(q.b.slice(Math.max(0, da - q.pos), Math.min(q.b.length, al - q.pos)));
          n += parti[parti.length - 1].length;
        }
        if (parti.length < 2 || !tela) return unisci(parti.length ? parti : [nuovo(0)]);
        var t = tela(n), k = 0;
        for (var j = 0; j < parti.length; j++) { parti[j].copy(t, k); k += parti[j].length; }
        return t.length === n ? t : t.slice(0, n);
      }
      // via i pezzi prima di "fino"
      function scarta(fino) {
        while (pezzi.length && pezzi[0].pos + pezzi[0].b.length <= fino) pezzi.shift();
        if (pezzi.length && pezzi[0].pos < fino) { pezzi[0].b = pezzi[0].b.slice(fino - pezzi[0].pos); pezzi[0].pos = fino; }
      }
      // manda [pos, pos + b.length) per la parte che cade in [a, z]; false = aspettare "drain"
      function manda(b, pos) {
        var da = Math.max(a, pos), al = Math.min(z + 1, pos + b.length), ok = true, x = al > da && !chiuso ? bloccoDi(b) : null;
        if (x) { x.attese++; ok = res.write(b.slice(da - pos, al - pos), function () { x.attese--; }); }
        else if (al > da && !chiuso) ok = res.write(b.slice(da - pos, al - pos));
        emesso = Math.max(emesso, pos + b.length);
        if (!ok) { aspettaDrain = true; res.once('drain', dopoDrain); }
        return ok;
      }

      // quanto si puo' fare con i byte che ci sono: 'dati' (servono altri byte), 'fine', 'lavoro' (asincrono), 'drain'
      function avanza() {
        for (var giri = 0; giri < 100000; giri++) {
          if (emesso > z) return 'fine';
          if (!voce) {
            var r = prossimaVoce();
            if (r !== 'ok') return r;
          }
          if (voce.tipo === 'passa') {
            // fine: -1 = fino in fondo al file, -2 = fino al Cluster che si sta cercando
            if (voce.fine === -2 && trovato >= 0) { voce.fine = trovato; p = trovato; cercaCluster = false; }
            var lim = voce.fine, al = lim >= 0 ? Math.min(lim, fineDati()) : fineDati();
            if (al > emesso) {
              var da0 = emesso, b = prendi(da0, al);
              scarta(al);
              if (!manda(b, da0)) { if (lim >= 0 && emesso >= lim) voce = null; return 'drain'; }
            }
            if (lim >= 0 && emesso >= lim) { voce = null; continue; }
            return 'dati';
          }
          // un Cluster
          var rc = trattaCluster();
          if (rc !== 'ok') return rc;
        }
        return 'dati';
      }

      // il prossimo elemento di primo livello in "p": 'ok' (voce pronta), 'dati'
      function prossimaVoce() {
        if (p < m.cluster1) { voce = { tipo: 'passa', pos: p, fine: m.cluster1 }; p = m.cluster1; return 'ok'; }
        var fd2 = fineDati();
        if (cercaCluster) {
          // si manda com'e' fino al prossimo Cluster (lo cerca pezzo())
          if (trovato < 0) { voce = { tipo: 'passa', pos: p, fine: -2 }; return 'ok'; }
          cercaCluster = false;
          if (trovato > p) { voce = { tipo: 'passa', pos: p, fine: trovato }; p = trovato; return 'ok'; }
        }
        var h = prendi(p, Math.min(fd2, p + 16));
        var hi = leggiId(h, 0, h.length), hd = hi && hi.id > 0 ? leggiVint(h, hi.n, h.length) : null;
        if (!hi || (!hd && hi.id > 0)) {
          if (eof && !sospeso) { voce = { tipo: 'passa', pos: p, fine: -1 }; return 'ok'; }
          return 'dati';
        }
        if (hi.id < 0 || hd.rotto) { voce = { tipo: 'passa', pos: p, fine: -1 }; return 'ok'; } // rovinato: il resto com'e'
        if (hi.id === ID.CLUSTER) {
          voce = { tipo: 'cluster', pos: p, fine: hd.ignota ? -1 : p + hi.n + hd.n + hd.v, testa: hi.n + hd.n };
          if (voce.fine > 0) p = voce.fine;
          return 'ok';
        }
        if (hd.ignota) { voce = { tipo: 'passa', pos: p, fine: -1 }; return 'ok'; }
        voce = { tipo: 'passa', pos: p, fine: p + hi.n + hd.n + hd.v };
        p = voce.fine;
        return 'ok';
      }

      // il Cluster di adesso: 'ok' (mandato), 'dati', 'lavoro', 'drain'
      function trattaCluster() {
        var v = voce, fd2 = fineDati();
        if (v.fine < 0) {
          // misura ignota: finisce al prossimo elemento di primo livello
          var b0 = prendi(v.pos, fd2), c0 = null;
          try { c0 = leggiCluster(b0, v.pos, v.pos, v.pos + b0.length, st, true); } catch (e) { c0 = null; }
          if (c0 && c0.fine < v.pos + b0.length) { v.fine = c0.fine; p = v.fine; }
          else if (eof && !sospeso) { v.fine = fd2; p = v.fine; }
          else if (b0.length > maxCluster) { v.tipo = 'passa'; v.fine = -1; return 'ok'; }
          else return 'dati';
        }
        if (v.fine - v.pos > maxCluster) {
          // troppo grande per tenerlo: passa com'e', con i blocchi della traccia fatti Void (la traccia tace li')
          if (!v.muto) { v.muto = true; conti.errori++; }
          return mutoAPezzi(v);
        }
        if (fd2 < v.fine) {
          if (eof && !sospeso) { v.tipo = 'passa'; return 'ok'; } // file finito a meta' Cluster: com'e'
          return 'dati';
        }
        if (!v.c) {
          v.byte = prendi(v.pos, v.fine, telaCluster);
          try { v.c = leggiCluster(v.byte, v.pos, v.pos, v.fine, st, false); } catch (e1) { v.c = null; }
          if (v.c) ancoraSicura(v.c);
        }
        var c = v.c;
        if (!c || !c.blocchi.length) {
          // niente traccia qui: com'e'
          return chiudiCluster(v, null);
        }
        // tutto prima di "a": serve solo come audio prima
        if (v.fine <= a) { aggiungiStoria(c); scarta(v.fine); emesso = v.fine; voce = null; return 'ok'; }
        var chiave = cacheChiave(f, st, v.pos), t = cachePrendi(chiave);
        if (t) { conti.cache++; return chiudiCluster(v, t); }
        // il seguito: l'ancora del prossimo Cluster con la traccia e i suoi primi frame
        if (!v.seg) {
          var sg = seguente(v.fine);
          if (sg === 'dati') {
            if (eof && !sospeso) v.seg = { g0: null, frame: [] };
            else return 'dati';
          } else v.seg = sg;
        }
        // l'audio prima: dalla storia, o dai Cluster precedenti letti dal file
        lavoro = true;
        conAudioPrima(v, function (errPrima) {
          if (chiuso) { lavoro = false; chiudiFd(); finisci(); return; }
          converti(v, function (err, toppe2) {
            lavoro = false;
            if (chiuso) { chiudiFd(); finisci(); return; }
            if (err) { rotto(err); return; }
            if (!errPrima && toppe2) cacheMetti(chiave, toppe2);
            var r;
            try { r = chiudiCluster(v, toppe2 || []); } catch (e) { rotto(e); return; }
            if (r === 'drain') return;
            giro();
          });
        });
        return 'lavoro';
      }
      function ancoraSicura(c) {
        try { ancora(c, st); } catch (e) { c.blocchi = []; }
      }
      // il Cluster con le sue toppe: mandato, e i suoi frame nella storia
      function chiudiCluster(v, t) {
        var b = v.byte || prendi(v.pos, v.fine);
        // prima la storia (i frame sorgente stanno in b), poi le toppe sopra
        if (v.c && v.c.blocchi.length) aggiungiStoria(v.c);
        if (t) for (var i = 0; i < t.length; i++) t[i].dati.copy(b, t[i].pos - v.pos);
        scarta(v.fine);
        voce = null;
        return manda(b, v.pos) ? 'ok' : 'drain';
      }
      // un Cluster troppo grande: a pezzi, coi blocchi della traccia fatti Void
      function mutoAPezzi(v) {
        var al = Math.min(v.fine, fineDati());
        if (al <= emesso) return 'dati'; // (file finito a meta': giro() chiude la risposta come rotta)
        var b = prendi(emesso, al), base = emesso, fino = al;
        // i blocchi che cominciano qui: quelli della traccia diventano Void. Una testa che non c'e' ancora tutta (in fondo
        // ai byte letti) si manda solo al giro dopo, dopo averla vista
        if (v.dentro === undefined) v.dentro = v.pos + v.testa;
        while (v.dentro < al) {
          var i = v.dentro - base;
          var id = leggiId(b, i, b.length), d = id && id.id > 0 ? leggiVint(b, i + id.n, b.length) : null;
          if (id && (id.id < 0 || (d && (d.rotto || d.ignota)))) { v.dentro = v.fine; break; }
          if (!id || !d) { fino = v.dentro; break; }
          if (id.id === ID.SIMPLE || id.id === ID.GRUPPO) {
            var s = i + id.n + d.n, tv = id.id === ID.SIMPLE ? leggiVint(b, s, b.length) : null;
            if (id.id === ID.GRUPPO) { var gi = leggiId(b, s, b.length), gd = gi && gi.id === ID.BLOCCO ? leggiVint(b, s + gi.n, b.length) : null; tv = gd ? leggiVint(b, s + gi.n + gd.n, b.length) : null; }
            if (!tv) { fino = v.dentro; break; }
            if (tv.v === st.num) b[i] = ID.VOID;
          }
          v.dentro += id.n + d.n + d.v;
        }
        if (fino <= base) return 'dati';
        if (fino < al) b = b.slice(0, fino - base);
        scarta(fino);
        if (fino >= v.fine) voce = null;
        return manda(b, base) ? 'ok' : 'drain';
      }

      // il prossimo Cluster con la traccia dopo "pos": { g0, frame } (g0 null: non c'e' entro AVANTI), o 'dati'
      function seguente(pos) {
        var q = pos, fd2 = fineDati();
        while (true) {
          if (q - pos > AVANTI) return { g0: null, frame: [] };
          if (q + 16 > fd2) return eof && !sospeso && q >= fd2 ? { g0: null, frame: [] } : 'dati';
          var h = prendi(q, q + 16), hi = leggiId(h, 0, h.length), hd = hi && hi.id > 0 ? leggiVint(h, hi.n, h.length) : null;
          if (!hd || hd.rotto) return { g0: null, frame: [] };
          if (hi.id !== ID.CLUSTER) {
            if (hd.ignota) return { g0: null, frame: [] };
            q += hi.n + hd.n + hd.v;
            continue;
          }
          var fine = hd.ignota ? -1 : q + hi.n + hd.n + hd.v, al = fine < 0 ? fd2 : Math.min(fine, fd2);
          var b = prendi(q, al, telaSeguito), c = null;
          try { c = leggiCluster(b, q, q, fine < 0 ? q + b.length : fine, st, true); } catch (e) { c = null; }
          if (!c) return { g0: null, frame: [] };
          var completo = c.completo || (fine >= 0 && al >= fine);
          if (c.blocchi.length >= N_ANCORA || (completo && c.blocchi.length)) {
            // l'ancora come la fara' quel Cluster: dai suoi primi blocchi (se ne ha meno di 48, tutti)
            var cc = { pos: q, blocchi: c.blocchi.slice(0, N_ANCORA), tempo: c.tempo };
            ancoraSicura(cc);
            if (!cc.blocchi.length) return { g0: null, frame: [] };
            return { g0: cc.blocchi[0].frame[0].g, frame: frameDi(cc), pos: q };
          }
          if (!completo) return eof && !sospeso ? { g0: null, frame: [] } : 'dati';
          if (fine < 0) return { g0: null, frame: [] };
          q = fine; // un Cluster senza la traccia: si guarda il prossimo
        }
      }

      function aggiungiStoria(c) {
        var fr = frameDi(c);
        if (!fr.length) return;
        if (storia.length && storia[storia.length - 1].cl === c.pos) return;
        for (var i = 0; i < fr.length; i++) storia.push({ g: fr[i].g, d: fr[i].d, sync: fr[i].sync, dati: copia(fr[i].dati), cl: fr[i].cl });
        // si tiene l'ultimo mezzo secondo (basta per la "major sync" del TrueHD e il riscaldamento)
        var limite = fr[fr.length - 1].g - st.freq / 2, k = 0;
        while (k < storia.length && storia[k].g < limite) k++;
        if (k) storia = storia.slice(k);
      }

      // la storia deve arrivare fino al Cluster di adesso e abbastanza indietro: se no si leggono i Cluster prima
      function conAudioPrima(v, cb) {
        var c = v.c, fr = frameDi(c), G = fr[0].g, nA = Math.ceil(G / FRAME), gInizio = FRAME * nA - FRAME + RIT_ENC;
        // la storia vale solo se finisce dove comincia questo Cluster (il Cluster subito prima)
        if (storia.length && storia[storia.length - 1].cl !== c.pos) {
          var ult = storia[storia.length - 1];
          if (Math.abs(ult.g + ult.d - G) > 2 * ult.d + 2048) storia = [];
        }
        function basta() { return inizioDec(storia.concat(fr), gInizio, st.tipo) >= 0; }
        if (G <= 0 || basta()) { cb(null); return; }
        var giri = 0, prima = storia.length ? storia[0].cl : c.pos;
        (function giro3() {
          if (chiuso) { cb(null); return; }
          if (++giri > MAX_PRIMA) { conti.senzaPrima++; cb(new Error('audio prima non trovato')); return; }
          precedente(fs, fd, m, st, prima, x.confinePrima, function (e, cp) {
            if (e || !cp || !cp.completo) { conti.senzaPrima++; cb(e || new Error('Cluster prima non trovato')); return; }
            ancoraSicura(cp);
            var fp = frameDi(cp), nuovi = [];
            for (var i = 0; i < fp.length; i++) nuovi.push({ g: fp[i].g, d: fp[i].d, sync: fp[i].sync, dati: fp[i].dati, cl: cp.pos });
            storia = nuovi.concat(storia);
            prima = cp.pos;
            if (basta() || (fp.length && fp[0].g <= 0)) { cb(null); return; }
            setImmediate(giro3);
          });
        })();
      }

      // la conversione del Cluster: piano, decodifica e codifica a fette, toppe
      function converti(v, cb) {
        var c = v.c, fr = frameDi(c), G = fr[0].g, ultimo = fr[fr.length - 1];
        var nA = Math.ceil(G / FRAME), nB = v.seg.g0 !== null ? Math.ceil(v.seg.g0 / FRAME) - 1 : Math.ceil((ultimo.g + ultimo.d) / FRAME) - 1;
        var piano = piazza(c, fr, nA, nB, st), kbps = {};
        for (var i = 0; i < piano.file.length; i++) for (var k = 0; k < piano.file[i].frame.length; k++) kbps[piano.file[i].frame[k].n] = piano.file[i].frame[k].kbps;
        conti.cluster++;
        conti.persi += piano.persi;
        if (piano.persi) log('Audio del TV: ' + piano.persi + ' frame AC3 non entrano nel Cluster a ' + c.pos);
        if (nB < nA) { cb(null, toppe(c, piano, {}, st)); return; }
        var tutti = storia.concat(fr, v.seg.frame), j0 = inizioDec(tutti, FRAME * nA - FRAME + RIT_ENC, st.tipo);
        if (j0 < 0) j0 = 0;
        var conv, n = nA, iDec = j0, ac3 = {}, ms = 0;
        // un errore del codec (un frame rovinato o fatto apposta): il Cluster tace (i blocchi della traccia diventano Void),
        // sempre allo stesso modo; il codec rifa' la sua istanza. La risposta continua
        function muto(e) {
          conti.errori++;
          log('Audio del TV: il Cluster a ' + c.pos + ' resta muto (' + String(e && e.message || e).slice(0, 120) + ')');
          var t0m;
          try { t0m = toppe(c, piano, {}, st); } catch (e4) { cb(e4); return; }
          cb(null, t0m);
        }
        // l'istanza del codec puo' essersi lasciata andare (riposo): "pronto" ne fa una nuova, e se c'e' gia' risponde subito
        codec.pronto(function (e0) {
          if (e0) { muto(e0); return; }
          try { conv = codec.apri({ tipo: st.tipo, freq: st.freq, canali: st.canali }); } catch (e) { muto(e); return; }
          fetta();
        });
        function fetta() {
          if (chiuso) { conv.chiudi(); cb(null, null); return; }
          var t0 = adesso();
          try {
            while (n <= nB) {
              var s = FRAME * n, serve = s + FRAME + RIT_ENC;
              while (iDec < tutti.length && tutti[iDec].g < serve) { conv.decodifica(tutti[iDec].dati, tutti[iDec].g, tutti[iDec].d); iDec++; }
              if (kbps[n]) {
                var b = conv.codifica(s, kbps[n]);
                if (b && b.length > misuraAc3(kbps[n], st.freq)) b = null;
                ac3[n] = b;
                conti.frame++;
              }
              n++;
              if (adesso() - t0 > FETTA) break;
            }
          } catch (e2) { conv.chiudi(); muto(e2); return; }
          ms += adesso() - t0;
          if (n <= nB) { setImmediate(fetta); return; }
          conv.chiudi();
          misuraVera(st.tipo, ms, (nB - nA + 1) * FRAME / st.freq);
          var t;
          try { t = toppe(c, piano, ac3, st); } catch (e3) { cb(e3); return; }
          cb(null, t);
        }
      }
    }

    // la velocita' vera, convertendo: ms di CPU per secondo d'audio in media su quello convertito, contata solo dopo
    // 30 s d'audio (la prima apertura del codec pesa); oltre i 10 minuti la storia vecchia vale la meta'
    var ultimoSalvo = 0;
    function misuraVera(tipo, ms, secondi) {
      if (!(secondi > 0)) return;
      conti.ms += ms;
      conti.secondi += secondi;
      if (!vel) return;
      var fam = famigliaDi(tipo), v = vel.vera || (vel.vera = {}), sm = vel.somme || (vel.somme = {}), x = sm[fam] || (sm[fam] = { ms: 0, s: 0 });
      x.ms += ms;
      x.s += secondi;
      if (x.s > 600) { x.ms /= 2; x.s /= 2; }
      if (x.s >= 30) v[fam] = Math.round(x.ms / x.s * 10) / 10;
      if (Date.now() - ultimoSalvo > 60000) { ultimoSalvo = Date.now(); salva(); }
    }

    return {
      letti: letti, stato: stato, attendi: attendi, pronta: pronta, prepara: prepara, fisse: fisse, servi: servi,
      velocita: velocita, convertibile: convertibile,
      // per "Questo TV" e per le prove
      statoPubblico: function () {
        return { codec: codec ? codec.nome : null, velocita: vel, soglia: soglia, conti: conti, cache: Math.round(cache.peso / 1024) };
      },
      // l'app Video e' chiusa: i Cluster convertiti tenuti (fino a 6 MB) se ne vanno, come al riposo del codec
      riposa: function () { cache.voci = {}; cache.peso = 0; },
      _svuotaCache: function () { cache.voci = {}; cache.peso = 0; }
    };
  }

  var SINCRO_CLUSTER = byte([0x1f, 0x43, 0xb6, 0x75]);

  return {
    crea: crea, codecWasm: codecWasm,
    _interni: { nuoveTracks: nuoveTracks, entryAc3: entryAc3, bloccoDi: bloccoDi, leggiCluster: leggiCluster, ancora: ancora,
      piazza: piazza, toppe: toppe, inizioDec: inizioDec, misuraAc3: misuraAc3, campioniDi: campioniDi, convertibile: convertibile,
      KBPS: KBPS }
  };
})();
