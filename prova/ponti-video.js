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
