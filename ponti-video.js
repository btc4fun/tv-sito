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
 *   var p = PontiVideo.crea({ http, https, dgram, dns, url, crypto, fs, path, cartella, videoteca: vt, letti: fn, log: fn,
 *     leggiSottotitoli: Videoteca._interni.leggiSottotitoli, testoDi: Videoteca._interni.testoDi, locale: PROVE });
 *   (locale: solo nelle prove sul computer, un server su 127.0.0.1; dns: ogni nome si controlla prima di collegarsi;
 *   tempoLettura: quanto aspettare un server fermo a meta' film, 30 s se non c'e'; portaMac: dove cercare il limitatore
 *   del Mac accanto a Jellyfin, 8097 se non c'e'; radiceLE: una funzione che da' la radice di Let's Encrypt, per i server
 *   https sui TV col Node vecchio)
 *   Videoteca.gestisci(vt, g, req, res, u, { punto: fn, ponti: p.tratta })
 *
 * Solo ES5 e solo ASCII; va da Node 4.4.3 (TV 2017-2019) in su.
 */
var PontiVideo = (function () {
  'use strict';

  var VERSIONE = '1.0.0';
  // MAX_PLAYLIST: la lista dei pezzi di un film convertito ha un pezzo ogni 3 s, ognuno con un indirizzo lungo (tutte le scelte
  // della conversione): Iron Man (2 h 6 min) in 4K 25 supera i 2 MB, e con 2 MB il TV riceveva un errore e non partiva
  // nessun film (30/10/2026). 8 MB bastano per un film di 6-7 ore
  var MAX_CORPO = 64 << 10, MAX_JSON = 8 << 20, MAX_PLAYLIST = 8 << 20, MAX_SOTTO = 4 << 20;
  // gli id di Jellyfin: 32 cifre esadecimali, a volte coi trattini (negli indirizzi che crea lui: HLS, sottotitoli)
  var ID = '[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}';
  // i percorsi di Jellyfin che l'app puo' chiedere, con i metodi: il resto risponde 403
  var LISTA = [
    ['GET', 'Users/' + ID + '/Views'], ['GET', 'UserViews'],
    ['GET', 'Users/' + ID + '/Items'], ['GET', 'Users/' + ID + '/Items/Resume'], ['GET', 'Users/' + ID + '/Items/Latest'],
    ['GET', 'Users/' + ID + '/Items/' + ID], ['GET', 'Users/' + ID + '/Items/' + ID + '/(LocalTrailers|SpecialFeatures|Intros)'],
    ['GET', 'UserItems/Resume'], ['GET', 'UserItems/' + ID + '/UserData'], ['GET', 'Items'], ['GET', 'Items/Latest'], ['GET', 'Items/Filters2?'], ['GET', 'Items/' + ID],
    ['GET', 'Items/' + ID + '/(Similar|LocalTrailers|SpecialFeatures|Ancestors|ThemeMedia)'],
    ['GET|HEAD', 'Items/' + ID + '/Images/[A-Za-z]{2,20}(/[0-9]{1,4})?'],
    ['GET', 'Shows/NextUp'], ['GET', 'Shows/' + ID + '/(Seasons|Episodes)'], ['GET', 'Shows/Upcoming'],
    ['GET', 'Movies/Recommendations'], ['GET', 'Genres'], ['GET', 'Persons'],
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

  // (nessuna voce ha testo libero: solo id, numeri e nomi fissi. %2F, %5C, %2E, %25, %00 non passano mai: dietro un proxy
  // che decodifica il percorso diventerebbero altre strade, col token)
  var SCAPPA = /%2f|%5c|%2e|%25|%00/i;
  function inLista(metodo, percorso) {
    if (SCAPPA.test(percorso)) return false;
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
  // un indirizzo dentro una playlist HLS: si tiene solo se il lettore, risolvendolo, resta nel ponte su un percorso della lista
  // (GET). Assoluto verso il server salvato: diventa quello del ponte. Relativo: risolto accanto alla playlist ("cartella").
  // Mai: spazi, tab, controlli, barre rovesciate; "/..." o "//altro"; ":" prima della prima "/"; segmenti "." e "..";
  // %2E/%2F/%5C/%25/%00 nel percorso. null = da togliere
  function indirizzoPlaylist(u, server, ponte, cartella) {
    var x = String(u);
    if (!x || /[\u0000-\u0020\u007f\\]/.test(x)) return null;
    var assoluto = !!server && x.toLowerCase().indexOf(server.toLowerCase() + '/') === 0, rel = assoluto ? x.slice(server.length + 1) : x;
    if (/^\//.test(rel) || /^[^\/?#]*:/.test(rel) || rel.indexOf('#') >= 0) return null;
    var q = rel.indexOf('?'), per = q >= 0 ? rel.slice(0, q) : rel;
    if (/(^|\/)\.\.?(\/|$)/.test(per) || !inLista('GET', assoluto ? per : cartella + per)) return null;
    return (assoluto ? ponte : '') + senzaChiavi(rel);
  }
  // la playlist HLS di Jellyfin riscritta: i pezzi restano accanto (sempre dal ponte), senza chiavi; nel master solo la prima
  // variante (con l'HDR Jellyfin aggiunge una riserva H.264 SDR senza tonemapping: il TV potrebbe sceglierla) e niente
  // anteprime per il lettore (le chiede l'app a parte). percorso = quello Jellyfin della playlist (videos/<id>/main.m3u8)
  function riscriviPlaylist(testo, server, ponte, percorso) {
    var cartella = String(percorso || '').replace(/[^\/]*$/, '');
    var righe = String(testo).split(/\r?\n/), out = [], varianti = 0, salta = false;
    for (var i = 0; i < righe.length; i++) {
      var r = righe[i];
      if (/^#EXT-X-STREAM-INF:/.test(r)) { varianti++; if (varianti > 1) { salta = true; continue; } }
      else if (/^#EXT-X-IMAGE-STREAM-INF:/.test(r)) continue;
      else if (salta && r && r.charAt(0) !== '#') { salta = false; continue; }
      if (!r) { out.push(r); continue; }
      if (r.charAt(0) !== '#') {
        var buono = indirizzoPlaylist(r.trim(), server, ponte, cartella);
        if (buono !== null) { out.push(buono); continue; }
        // un pezzo (o una variante) tolto: via anche la sua riga di descrizione
        while (out.length && /^#(EXTINF|EXT-X-BYTERANGE|EXT-X-STREAM-INF)/.test(out[out.length - 1])) out.pop();
        continue;
      }
      var via = false, riga = r.replace(/URI="([^"]*)"/g, function (t, u) { var b = indirizzoPlaylist(u, server, ponte, cartella); if (b === null) via = true; return 'URI="' + (b || '') + '"'; });
      if (!via) out.push(riga);
    }
    return out.join('\n');
  }
  function bufDa(s) { return typeof Buffer.from === 'function' && Buffer.from !== Uint8Array.from ? Buffer.from(s, 'utf8') : new Buffer(s, 'utf8'); }
  function errore(codice, msg) { var e = new Error(msg); e.codice = codice; return e; }
  function erroreRete(msg) { var e = new Error(msg); e.codice = 'rete'; e.rete = true; e.code = 'ERETE'; return e; }
  // un errore della rete; quelli del certificato https (i TV 2017-2019 hanno autorita' vecchie) si dicono a parte
  function erroreDa(e) {
    var c = String(e && (e.code || e.message) || 'rete'), x = erroreRete(c);
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ERR_TLS|SSL/i.test(c)) x.codice = 'certificato';
    return x;
  }
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
  // un IPv6 in 16 numeri (null se non si legge)
  function ipv6Byte(s) {
    var m = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s), i;
    if (m) {
      var a = [+m[2], +m[3], +m[4], +m[5]];
      for (i = 0; i < 4; i++) if (a[i] > 255) return null;
      s = m[1] + ((a[0] << 8) | a[1]).toString(16) + ':' + ((a[2] << 8) | a[3]).toString(16);
    }
    var parti = s.split('::');
    if (parti.length > 2) return null;
    var sx = parti[0] ? parti[0].split(':') : [], dx = parti.length === 2 && parti[1] ? parti[1].split(':') : [], manca = 8 - sx.length - dx.length;
    if (parti.length === 1 ? manca !== 0 : manca < 1) return null;
    var g = sx.slice();
    for (i = 0; parti.length === 2 && i < manca; i++) g.push('0');
    g = g.concat(dx);
    var b = [];
    for (i = 0; i < 8; i++) {
      if (!/^[0-9a-f]{1,4}$/i.test(g[i])) return null;
      var v = parseInt(g[i], 16);
      b.push(v >> 8, v & 255);
    }
    return b;
  }
  // un indirizzo IP che e' il TV stesso (o "nessuno"): 127/8, 0/8, ::, ::1, e un IPv4 cosi' dentro un IPv6 (::ffff:127.x).
  // Nelle prove sul computer (locale) 127.0.0.1 va bene
  function ipVietato(ip, locale) {
    ip = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (locale && ip === '127.0.0.1') return false;
    var v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (v4) return +v4[1] === 127 || +v4[1] === 0;
    if (ip.indexOf(':') < 0) return false;
    var b = ipv6Byte(ip);
    if (!b) return true;
    for (var i = 0; i < 10; i++) if (b[i]) return false;
    if (b[10] === 255 && b[11] === 255) return b[12] === 127 || b[12] === 0;
    if (b[10] || b[11]) return false;
    return b[12] === 127 || b[12] === 0; // ::, ::1 e ::127.x (IPv4 "compatibile")
  }
  // indirizzo del server: http(s)://host[:porta][/base], mai il TV stesso (solo le prove sul computer usano 127.0.0.1). Solo
  // forme canoniche: niente numeri "da soli", esadecimali o ottali (2130706433, 0x7f000001, 0177.0.0.1), niente nomi col punto
  // finale (localhost.), IPv6 controllati dopo averli espansi. I nomi si controllano anche col DNS (guardiaDns)
  function indirizzoBuono(urlLib, s, locale) {
    s = String(s || '').trim();
    if (!s || s.length > 300 || !/^[A-Za-z0-9._~:\/\-\[\]]+$/.test(s)) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    var u = urlLib.parse(s);
    if (!u || !/^https?:$/.test(u.protocol || '') || !u.hostname || u.auth || u.search || u.hash) return '';
    var h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!/^[a-z0-9.\-:]+$/.test(h) || /\.$/.test(h) || h === 'localhost' || /\.localhost$/.test(h)) return '';
    if (h.indexOf(':') >= 0) { if (!ipv6Byte(h) || ipVietato(h, locale)) return ''; }
    else if (/^[0-9.x]+$/.test(h)) {
      // un IPv4: quattro numeri da 0 a 255, senza zeri davanti
      var q = h.split('.');
      if (q.length !== 4) return '';
      for (var i = 0; i < 4; i++) if (!/^(0|[1-9][0-9]{0,2})$/.test(q[i]) || +q[i] > 255) return '';
      if (ipVietato(h, locale)) return '';
    } else if (/^\d+$/.test(h.replace(/\./g, '')) || /(^|\.)0x/.test(h)) return '';
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
  // le qualita' del pannello: tetto in Mbps e larghezza massima (0 = nessuno). Il 4K resta fino a 15 Mbps: un 4K HEVC a
  // 15-25 Mbps e' quello degli streaming a pagamento (Jellyfin converte in HEVC col chip del Mac; l'HDR resta con jellyfin-ffmpeg)
  // Restano anche le scelte di prima, per le app di prima: 4K 80, 720p 8, e 1080p 20, che l'app usa ancora per le anteprime
  // nella scheda (un trailer 4K HDR accenderebbe l'HDR del TV sotto le scritte)
  var QUALITA = { orig: { mbps: 0, larg: 0 }, '4k40': { mbps: 40, larg: 3840 }, '4k25': { mbps: 25, larg: 3840 }, '4k15': { mbps: 15, larg: 3840 },
    '1080p8': { mbps: 8, larg: 1920 }, '4k': { mbps: 80, larg: 3840 }, '1080': { mbps: 20, larg: 1920 }, '720': { mbps: 8, larg: 1280 } };
  // la qualita' "Automatica", dal 70% della rete misurata: difende il 4K, che resta tale e cala solo di Mbps fino a 15;
  // sotto passa a 1080p, da 4 Mbps in giu' a 720p, da 2 in giu' a 854
  function qualitaAuto(mbps) {
    var m = Math.max(1, Math.floor((+mbps || 0) * 0.7));
    return { mbps: Math.min(m, 120), larg: m >= 15 ? 3840 : m > 4 ? 1920 : m > 2 ? 1280 : 854 };
  }
  // il profilo del TV per Jellyfin (come quello provato col Jellyfin 12.4 vero, prove/jellyfin/profilo-samsung-2022.json):
  // cosa legge diretto, e in cosa convertire (HLS a pezzi MPEG-TS: HEVC copiato funziona, e il TV lo legge da sempre)
  // DOVIWithHDR10Plus: Dolby Vision 8.1 con l'HDR10+ dentro (per esempio Spider-Man: Brand New Day). Il TV legge la base
  // HDR10 e l'HDR10+ (Samsung); senza questa voce Jellyfin ricodifica in SDR anche l'originale (VideoRangeTypeNotSupported)
  var GAMME = { h264: 'SDR', hevc: 'SDR|HDR10|HDR10Plus|HLG|DOVIWithHDR10|DOVIWithHDR10Plus|DOVIWithHLG|DOVIWithSDR', vp9: 'SDR|HDR10|HLG', av1: 'SDR|HDR10|HDR10Plus|HLG' };
  // gammaIn: un tipo di HDR in piu' per l'HEVC (il tipo esatto di un Dolby Vision che il profilo non elenca, vedi guarda)
  function profilo(letti, q, gammaIn) {
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
        c('LessThanEqual', 'VideoBitDepth', '10'), c('EqualsAny', 'VideoRangeType', GAMME.hevc + (gammaIn ? '|' + gammaIn : ''))] },
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
  function fsRemoto(chiedi, dim, tempo) {
    var aperti = {}, prossimo = 1;
    tempo = tempo || 30000;
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
      if (n >= (128 << 10) && !s.salti) {
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
          res.on('error', function (e) { f.err = erroreDa(e); sveglia(f); });
        });
        prendi(s, f, x);
        return;
      }
      var quanti = Math.min(dim - pos, s.salti ? n : Math.max(n, 64 << 10)), parti = [], tot = 0, fatto = false;
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
        res.on('error', function (e) { if (!fatto) { fatto = true; x.cb(erroreDa(e)); } });
      });
    }
    function sveglia(f) { if (f.timer) { clearTimeout(f.timer); f.timer = null; } var a = f.attesa; f.attesa = null; if (a) a(); }
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
        // si aspetta il server: se resta fermo (Wi-Fi caduto, NAS bloccato) dopo "tempo" la lettura finisce con un errore e la
        // domanda si chiude. In pausa nessuna lettura aspetta: questo tempo non la tocca
        f.attesa = prova;
        if (f.timer) clearTimeout(f.timer);
        f.timer = setTimeout(function () {
          f.timer = null;
          if (f.attesa !== prova) return;
          f.err = erroreRete('il server non manda piu\' dati');
          try { if (f.req) f.req.abort(); } catch (e) {}
          sveglia(f);
        }, tempo);
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
      remoto: true,
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
      aSalti: function (fd) { var s = aperti[fd]; if (s) s.salti = true; },
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
    function scriviPrivato(file, dati, chi) {
      var tmp = file + '.tmp';
      try {
        // un .tmp rimasto (servizio spento a meta') potrebbe avere altri permessi: si rifa' da capo
        try { fs.unlinkSync(tmp); } catch (e0) {}
        fs.writeFileSync(tmp, JSON.stringify(dati), { mode: 384 }); // 0600: solo il servizio
        fs.renameSync(tmp, file);
      } catch (e) { log(chi + ': non riesco a salvare (' + (e.code || e.message) + ')'); }
    }
    function salva() { scriviPrivato(FILE, cfg, 'Jellyfin'); }
    function dimentica() { cfg.token = ''; cfg.utente = null; salva(); sorgenti = {}; }
    function letti() { var x = typeof o.letti === 'function' ? o.letti() : o.letti; return x && x.audio && x.video ? x : { audio: {}, video: {} }; }

    /* ---------------------------------------------------------- le domande verso Jellyfin */

    var nomeTv = { at: 0, v: '' }; // il nome del TV (per Jellyfin e per il limitatore), ricalcolato al massimo ogni minuto
    function nomeDelTv() {
      if (!nomeTv.v || Date.now() - nomeTv.at > 60000) {
        var x = '';
        try { x = typeof o.nomeTv === 'function' ? o.nomeTv() : o.nomeTv; } catch (e) { x = ''; }
        nomeTv = { at: Date.now(), v: String(x || 'TV').replace(/[^A-Za-z0-9 ._\-]/g, '').slice(0, 60) || 'TV' };
      }
      return nomeTv.v;
    }
    function autorizzazione(conToken) {
      var s = 'MediaBrowser Client="Home TV", Device="' + nomeDelTv() + '", DeviceId="' + cfg.dispositivo + '", Version="' + VERSIONE + '"';
      return conToken && cfg.token ? s + ', Token="' + cfg.token + '"' : s;
    }
    // una domanda al server salvato (o a "dove", per il controllo prima di salvarlo). cb(err, res) con la risposta aperta
    // il DNS controllato: ogni collegamento al server passa da qui (opzione lookup di Node): un nome che porta al TV stesso
    // non si collega. Gli indirizzi IP scritti non passano dal DNS: li ha gia' controllati indirizzoBuono
    function guardiaDns(host, opz, cb) {
      if (typeof opz === 'function') { cb = opz; opz = {}; }
      o.dns.lookup(host, opz || {}, function (err, ind, fam) {
        if (err) { cb(err); return; }
        var l = Array.isArray(ind) ? ind : [{ address: ind }];
        for (var i = 0; i < l.length; i++) {
          if (ipVietato(l[i].address, o.locale)) { var e = new Error('il nome porta al TV stesso'); e.code = 'EVIETATO'; cb(e); return; }
        }
        cb(null, ind, fam);
      });
    }
    // x.mac: la domanda va al limitatore del Mac (con la sua chiave; 'senza' per il collegamento)
    function apriDomanda(x, cb) {
      var base = x.dove || (x.mac ? mac.indirizzo : cfg.indirizzo);
      if (!base) { cb(errore('server', x.mac ? 'nessun limitatore' : 'nessun server Jellyfin')); return null; }
      var u = urlLib.parse(base + '/' + x.percorso + (x.query ? '?' + x.query : ''));
      var mod = u.protocol === 'https:' ? https : http;
      if (!mod) { cb(errore('server', 'https non disponibile')); return null; }
      var testa = { 'Accept': x.accetta || 'application/json', 'Accept-Encoding': 'identity' };
      if (!x.mac) testa.Authorization = autorizzazione(x.token !== false);
      else if (x.mac !== 'senza' && mac.chiave) testa['X-Chiave'] = mac.chiave;
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
      var opz = { protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, method: x.metodo || 'GET',
        headers: testa, agent: x.lungo ? false : agenti[u.protocol] || undefined };
      if (o.dns) opz.lookup = guardiaDns;
      // i TV 2017-2019 (Node 4) hanno le autorita' del 2016: un server https con un certificato Let's Encrypt si riprova con
      // la sua radice (come le liste dei filtri e lo Store nel servizio); se va, per quel server la si usa subito
      var radice = u.protocol === 'https:' && typeof o.radiceLE === 'function' ? o.radiceLE() : '', req = null;
      function parti(conRadice) {
        if (conRadice) opz.ca = [radice];
        req = mod.request(opz, function (r) { if (conRadice) conRadiceLE[u.host] = true; fine(null, r); });
        req.on('error', function (e) {
          var cert = /CERT|ISSUER|SELF_SIGNED|UNABLE_TO/i.test(String(e && (e.code || e.message)));
          if (cert && !conRadice && radice && !finito) { parti(true); return; }
          if (cert && conRadice) delete conRadiceLE[u.host];
          ferma(); fine(erroreDa(e));
        });
        if (corpo) req.write(corpo);
        req.end();
      }
      // un tempo per la risposta (e per il corpo, nelle brevi); gli stream del video, una volta partiti, non hanno limite
      timer = setTimeout(function () { timer = null; try { req.abort(); } catch (e) {} fine(erroreRete('tempo scaduto')); }, x.tempo || 8000);
      parti(!!(radice && conRadiceLE[u.host]));
      // chi l'ha chiesta la puo' fermare (il TV chiude il video), anche quella ripartita con la radice
      return { abort: function () { try { req.abort(); } catch (e) {} } };
    }
    var conRadiceLE = {}; // i server https per cui serve la radice di Let's Encrypt
    // una domanda breve con la risposta in JSON (o in byte: x.byte)
    function chiedi(x, cb) {
      apriDomanda(x, function (err, r) {
        if (err) { cb(err); return; }
        var parti = [], n = 0, max = x.max || MAX_JSON, rotto = false;
        r.on('data', function (d) { if (rotto) return; n += d.length; if (n > max) { rotto = true; try { r.destroy(); } catch (e) {} cb(errore('server', 'risposta troppo grande')); } else parti.push(d); });
        r.on('end', function () {
          if (rotto) return;
          if (r.statusCode === 401 && x.mac && x.mac !== 'senza' && mac.chiave) { dimenticaMac(); cb(errore('accesso', 'il Mac non riconosce piu\' questo TV')); return; }
          if (r.statusCode === 401 && !x.mac && x.token !== false && cfg.token) { dimentica(); cb(errore('accesso', 'accesso scaduto')); return; }
          var b = Buffer.concat(parti, n), v = null;
          if (x.byte) { cb(null, r.statusCode, b, r); return; }
          if (b.length) { try { v = JSON.parse(b.toString('utf8')); } catch (e) { v = null; } }
          cb(null, r.statusCode, v, r);
        });
        r.on('aborted', function () { if (!rotto) { rotto = true; cb(erroreRete('interrotto')); } });
        r.on('error', function (e) { if (!rotto) { rotto = true; cb(erroreDa(e)); } });
      });
    }

    /* ---------------------------------------------------------- server, accesso */

    // quanta memoria usa il servizio, in MB. Sul TV vero (Tizen 6.5) leggere la memoria del processo e' vietato:
    // process.memoryUsage() da' "EACCES: permission denied, uv_resident_set_memory". Con la 1.3.0 quell'errore faceva
    // fallire lo stato di Jellyfin, e l'app nascondeva "Collega Jellyfin". Allora si prova l'heap di V8, che non legge
    // /proc; se manca anche quello, null
    function memoriaServizio() {
      try { return Math.round(process.memoryUsage().rss / 1e6); } catch (e) { /* vietata sul TV */ }
      try { return Math.round(require('v8').getHeapStatistics().total_heap_size / 1e6); } catch (e2) { return null; }
    }
    function statoPubblico() {
      // letti: i codec che questo TV legge (l'app mostra prima di partire cosa passa diretto e cosa converte il server)
      return { server: cfg.indirizzo ? { indirizzo: cfg.indirizzo, nome: cfg.nome || '', versione: cfg.versione || '', id: cfg.id || '' } : null,
        utente: cfg.token && cfg.utente ? { id: cfg.utente.id, nome: cfg.utente.nome } : null, letti: letti(),
        // per le prove sul TV (pannello Info del lettore): quanta memoria usa il servizio, e da quanto e' acceso
        servizio: { memoria: memoriaServizio(), node: process.version, acceso: Math.round(process.uptime()) } };
    }
    // i server Jellyfin nella rete di casa (rispondono al broadcast UDP 7359 con il loro indirizzo)
    var cercando = null;
    function cerca(cb0) {
      if (cercando) { cercando.push(cb0); return; }
      cercando = [cb0];
      var trovati = {}, s, fatto = false;
      function cb(l) { var a = cercando; cercando = null; for (var i = 0; i < a.length; i++) { try { a[i](l); } catch (e) {} } }
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
      controllaNome(ind, function (e0) { if (e0) cb(e0); else prova(); });
      function prova() {
      chiedi({ dove: ind, percorso: 'System/Info/Public', token: false, tempo: 5000, max: 65536 }, function (err, st, j) {
        if (err) { cb(err.codice === 'rete' ? errore('rete', 'il server non risponde') : err.codice === 'certificato' ? errore('certificato', 'certificato https non accettato da questo TV') : err); return; }
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
    }
    // un nome: prima il DNS (tutti gli indirizzi), cosi' l'errore e' chiaro; poi lo stesso controllo a ogni collegamento
    function controllaNome(ind, cb) {
      var host = urlLib.parse(ind).hostname.replace(/^\[|\]$/g, '');
      if (!o.dns || /^[0-9.]+$/.test(host) || host.indexOf(':') >= 0) { cb(null); return; }
      o.dns.lookup(host, { all: true }, function (e0, l) {
        if (e0) { cb(errore('rete', 'il nome del server non si trova')); return; }
        for (var i = 0; i < (l || []).length; i++) if (ipVietato(l[i].address, o.locale)) { cb(errore('indirizzo', 'indirizzo non valido')); return; }
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
    var misure = {}; // id:ms -> la misura vera del file (dal Content-Range), se Jellyfin ne ricorda un'altra
    function ricordaSorgente(id, msid, ms) {
      var est = estDi(ms), k0 = chiaveSorgente(id, msid), gia = sorgenti[k0];
      if (!est) return null;
      var dim = misure[k0] || +ms.Size || 0;
      if (gia && gia.x.dim === dim && gia.x.est === est) { gia.at = Date.now(); gia.ms = ms; return gia; }
      var x = { percorso: 'jf:' + cfg.id + ':' + id + ':' + msid, nome: testo(path.basename(String(ms.Path || ms.Name || id)), 200),
        dim: dim, data: 0, est: est, fs: null };
      x.fs = fsRemoto(function (a, z, cb) {
        return apriDomanda({ percorso: 'Videos/' + id + '/stream', query: 'static=true&mediaSourceId=' + msid, accetta: '*/*',
          range: 'bytes=' + a + '-' + z, tempo: 15000, lungo: z - a >= (1 << 20) }, function (err, r) {
          if (err) { cb(err.rete ? err : erroreRete(err.message)); return; }
          var cr = String(r.headers['content-range'] || ''), m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(cr);
          // il file e' cambiato sul server senza una nuova scansione (la misura di Jellyfin e' vecchia): si ricorda quella
          // vera e questa sorgente si butta; la prossima domanda del lettore riparte giusta
          if (r.statusCode === 206 && m && m[2] !== '*' && +m[2] !== dim) {
            try { r.destroy(); } catch (e) {}
            if (Object.keys(misure).length >= 50) misure = {};
            misure[k0] = +m[2];
            if (sorgenti[k0] && sorgenti[k0].x === x) delete sorgenti[k0];
            cb(erroreRete('il file e\' cambiato sul server'));
            return;
          }
          if (r.statusCode === 206 && m && +m[1] === a) { cb(null, r); return; }
          if (r.statusCode === 200 && a === 0) { cb(null, r); return; }
          try { r.destroy(); } catch (e) {}
          cb(erroreRete('il server ha risposto ' + r.statusCode));
        });
      }, dim, o.tempoLettura);
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
    // la misura vera del file la dice il server (il totale nel Content-Range di una domanda da un byte): quella della scheda
    // di Jellyfin puo' mancare o essere vecchia (file cambiato senza una nuova scansione), e il film si taglierebbe
    function sorgenteDaMs(id, msid, ms, cb) {
      if (!estDi(ms)) { cb(errore('formato', 'contenitore non adatto alla strada diretta')); return; }
      apriDomanda({ percorso: 'Videos/' + id + '/stream', query: 'static=true&mediaSourceId=' + msid, accetta: '*/*', range: 'bytes=0-0', tempo: 8000 }, function (e2, res) {
        if (e2) { cb(e2); return; }
        var m = /^bytes 0-0\/(\d+)$/.exec(String(res.headers['content-range'] || ''));
        if (res.statusCode !== 206 || !m || !(+m[1] > 0)) {
          // un server che non ascolta il Range manderebbe tutto il film: si chiude subito
          try { res.destroy(); } catch (e) {}
          if (res.statusCode === 401 && cfg.token) { dimentica(); cb(errore('accesso', 'accesso scaduto')); return; }
          cb(res.statusCode === 404 ? errore('assente', 'file non trovato') : errore('server', 'dimensione del file sconosciuta'));
          return;
        }
        res.resume();
        delete misure[chiaveSorgente(id, msid)];
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
      var L = letti(), qual = q.q === 'auto' ? qualitaAuto(q.mbps) : Object.prototype.hasOwnProperty.call(QUALITA, q.q) ? QUALITA[q.q] : QUALITA.orig;
      // l'originale da Jellyfin arriva gia' pronto dal server: HLS col video copiato bit per bit e l'audio scelto copiato o
      // convertito li'. Sul TV i pezzi passano e basta. La strada diretta (il file dentro il servizio, con le tracce nascoste
      // dalla Scansione) e' stata, sul TV vero, l'ultima cosa prima che il processo venisse chiuso, 2 volte su 2 (30/10/2026,
      // Iron Man 4K). Resta per le chiavette, e qui solo se chiesta: q.via 'file' (prove) o o.direttoJf
      var dalServer = !(q.via === 'file' || o.direttoJf === true);
      var corpo = { UserId: cfg.utente.id, DeviceProfile: profilo(L, qual), MaxStreamingBitrate: qual.mbps ? qual.mbps * 1e6 : 400e6,
        StartTimeTicks: Math.max(0, Math.floor(+q.t || 0)) * 10000, EnableDirectPlay: !dalServer, EnableDirectStream: true, EnableTranscoding: true,
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
      var gammaIn = '';
      chiediInfo();
      function chiediInfo() {
        corpo.DeviceProfile = profilo(L, qual, gammaIn);
        chiedi({ percorso: 'Items/' + id + '/PlaybackInfo', query: 'userId=' + cfg.utente.id, metodo: 'POST', corpo: corpo, tempo: 20000 }, risposta);
      }
      function risposta(err, st, j) {
        if (err) { cb(err); return; }
        if (st !== 200 || !j || !Array.isArray(j.MediaSources) || !j.MediaSources.length) { cb(errore('assente', 'il server non da\' il film')); return; }
        var ms = j.MediaSources[0];
        if (corpo.MediaSourceId) for (var i = 0; i < j.MediaSources.length; i++) if (String(j.MediaSources[i].Id).toLowerCase() === corpo.MediaSourceId) ms = j.MediaSources[i];
        var msid = String(ms.Id || '').toLowerCase();
        if (!idBuono(msid)) { cb(errore('assente', 'file non trovato')); return; }
        var video = flussi(ms, 'Video')[0] || null, audio = flussi(ms, 'Audio'), sub = flussi(ms, 'Subtitle');
        // un Dolby Vision che il profilo non elenca (cosi' il 30/10/2026 DOVIWithHDR10Plus: Spider-Man e Guardiani Vol. 2 sarebbero
        // stati rifatti in SDR anche in originale). Se la base e' HDR10, HLG o SDR il TV la legge: si chiede di nuovo, una volta,
        // col tipo esatto, e il video arriva com'e'. Mai per altri motivi
        var gammaVera = video ? String(video.VideoRangeType || '') : '';
        // DOVIInvalid: Jellyfin lo dice di un Dolby Vision 8.1 con le etichette dei colori fuori posto; con la curva PQ la base e'
        // comunque HDR10. Mai il profilo 5 ("DOVI"): li' la base non e' HDR10 e il TV non la saprebbe mostrare
        var baseNota = /^DOVIWith(HDR10|HLG|SDR|EL)[A-Za-z0-9]{0,20}$/.test(gammaVera) ||
          (gammaVera === 'DOVIInvalid' && video && String(video.ColorTransfer || '').toLowerCase() === 'smpte2084');
        if (!gammaIn && baseNota && motiviDi(ms).indexOf('VideoRangeTypeNotSupported') !== -1) {
          log('Jellyfin: il tipo ' + gammaVera + ' non era nel profilo del TV, aggiunto');
          gammaIn = gammaVera;
          chiediInfo();
          return;
        }
        var fv = video ? famigliaJf(video.Codec) : '', audioLetti = audio.filter(function (s) { return L.audio[famigliaJf(s.Codec)]; });
        var mbps = (+ms.Bitrate || 0) / 1e6, larg = video ? +video.Width || 0 : 0, vl = videoLeggibile(video, L);
        // dentro la qualita' scelta (un bitrate sconosciuto non obbliga a convertire)
        var dentro = !qual.mbps || ((!mbps || mbps <= qual.mbps) && (!qual.larg || larg <= qual.larg));
        var out = { ms: msid, sessione: testo(j.PlaySessionId, 64), durata: Math.round((+ms.RunTimeTicks || 0) / 1e4), mbps: Math.round(mbps * 10) / 10,
          contenitore: testo(ms.Container, 40), dim: +ms.Size || 0, qualita: qual.mbps ? { mbps: qual.mbps, larg: qual.larg } : null,
          video: video ? { codec: fv, largh: larg, alt: +video.Height || 0, hdr: testo(video.VideoRangeType || video.VideoRange, 20), letto: vl,
            bit: +video.BitDepth || 0, profilo: testo(video.Profile, 30) } : null,
          audio: audio.map(function (s) { return { indice: s.Index, codec: famigliaJf(s.Codec), lingua: testo(s.Language, 8), nome: testo(s.DisplayTitle || s.Title, 120),
            canali: +s.Channels || 0, predefinita: !!s.IsDefault, letto: !!L.audio[famigliaJf(s.Codec)] }; }),
          sotto: sub.map(function (s) { return { indice: s.Index, codec: famigliaJf(s.Codec), lingua: testo(s.Language, 8), nome: testo(s.DisplayTitle || s.Title, 120),
            forzata: !!s.IsForced, predefinita: !!s.IsDefault, esterno: !!s.IsExternal }; }),
          motivi: motiviDi(ms).slice(0, 10).map(function (x) { return testo(x, 60); }) };
        if (gammaIn) out.gammaAggiunta = testo(gammaIn, 40);
        // l'audio che si sente (indice di Jellyfin): quello chiesto, o quello che Jellyfin sceglie da solo
        out.audioScelto = corpo.AudioStreamIndex !== undefined ? corpo.AudioStreamIndex : typeof ms.DefaultAudioStreamIndex === 'number' ?
          ms.DefaultAudioStreamIndex : audio[0] ? audio[0].Index : -1;
        // l'audio scelto (indice di Jellyfin): se il TV non lo legge, lo converte il server
        var scelto = corpo.AudioStreamIndex !== undefined ? audio.filter(function (s) { return s.Index === corpo.AudioStreamIndex; })[0] : null;
        var diretto = !dalServer && estDi(ms) && vl && (audioLetti.length || !audio.length) && dentro &&
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
      }
    }

    // quanti Mbps arrivano dal server (per la qualita' "Automatica"): 8 MB, e altri 16 se e' veloce. I byte si contano e si
    // buttano: in memoria non resta niente. La misura vale 20 minuti per lo stesso server: la rete di casa non cambia da un
    // film all'altro, e prima ogni film ne scaricava 8-24 MB. "nuova" la rifa' (Automatica scelta dal pannello)
    var VALE_VELOCITA = 20 * 60000, velocita = null;
    function veloce(nuova, cb) {
      var dove = cfg.indirizzo, eta = velocita ? Date.now() - velocita.quando : -1;
      if (!nuova && velocita && velocita.dove === dove && eta >= 0 && eta < VALE_VELOCITA) { cb(null, { mbps: velocita.mbps }); return; }
      function fatta(m) {
        velocita = { dove: dove, mbps: Math.round(m), quando: Date.now() };
        cb(null, { mbps: velocita.mbps });
      }
      function prova(n, poi) {
        var t0 = Date.now(), tot = 0, fatto = false;
        function fine(e) { if (fatto) return; fatto = true; if (e) cb(e); else if (tot < n * 0.9) cb(errore('server', 'misura non riuscita')); else poi(tot * 8 / Math.max(1, Date.now() - t0) / 1000); }
        apriDomanda({ percorso: 'Playback/BitrateTest', query: 'size=' + n, accetta: '*/*', tempo: 20000 }, function (err, r) {
          if (err) { fine(err); return; }
          if (r.statusCode !== 200) { r.resume(); if (r.statusCode === 401 && cfg.token) { dimentica(); fine(errore('accesso', 'accesso scaduto')); } else fine(errore('server', 'misura non riuscita')); return; }
          r.on('data', function (d) { tot += d.length; if (tot > n + 65536) { try { r.destroy(); } catch (e) {} fine(errore('server', 'misura non riuscita')); } });
          r.on('end', function () { fine(null); });
          r.on('aborted', function () { fine(erroreRete('interrotto')); });
          r.on('error', function (e) { fine(erroreDa(e)); });
        });
      }
      prova(8 << 20, function (m) {
        if (m < 200) { fatta(m); return; }
        prova(16 << 20, fatta);
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
              var b = bufDa(riscriviPlaylist(Buffer.concat(parti, n).toString('utf8'), cfg.indirizzo, ponte, percorso));
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
        rispondi(res, c === 'accesso' ? 401 : c === 'rete' || c === 'certificato' ? 502 : c === 'assente' ? 404 : c === 'server' ? 409 :
          c === 'troppe' ? 429 : 400, { error: e.message, codice: c });
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
      if (resto === 'veloce' && get) { veloce(q.nuova === '1', function (e, r) { if (e) errore2(e); else rispondi(res, 200, r); }); return; }
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
            vt.remoto.info(s.x, { lingue: lingue.length ? lingue : null, tetto: +q.tetto || 0 }, function (e2, r) { if (e2) errore2(e2); else rispondi(res, 200, r); });
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
      // la quarta strada: lo stesso file dal limitatore del Mac
      if ((m = /^limita\/([0-9a-fA-F]{32})$/.exec(resto)) && get) {
        var msl = String(q.ms || '').toLowerCase(), tetto = +q.tetto || 0;
        if (!idBuono(msl)) { rispondi(res, 400, { error: 'manca il file', codice: 'corpo' }); return; }
        if (!mac.indirizzo || !mac.chiave) { rispondi(res, 409, { error: 'collega il limitatore del Mac', codice: 'mac' }); return; }
        var aJf = q.a !== undefined && q.a !== '' && isFinite(+q.a) ? Math.floor(+q.a) : -1;
        limita(m[1].toLowerCase(), msl, tetto >= 1 && tetto <= 1000 ? Math.round(tetto) : tettoTv(), aJf, function (e, r) {
          if (!e) { rispondi(res, 200, r); return; }
          if (e.codice === 'mac') rispondi(res, 409, { error: e.message, codice: 'mac' }); else errore2(e);
        });
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

    /* ---------------------------------------------------------- il limitatore del Mac (mac/)
     * Come per Jellyfin: un solo limitatore salvato, la chiave resta qui (limitatore.json, 600) e va solo nell'intestazione
     * X-Chiave; all'app arriva "collegato". Il collegamento: il Mac mostra un codice di 6 cifre (Terminale e notifica),
     * chi guarda lo scrive sul TV, il limitatore da' la chiave al ponte. */

    // il tetto del TV: quanti Mbps regge senza scatti (150; 80; o misurato dal TV col video a scalini del Mac). Lo usano la
    // stima dei picchi della chiavetta e il limitatore. Finche' non si sceglie, quello di partenza lo dice il profilo del TV
    // (o.tettoPartenza: funzione o valore, '150' o '80'; senza, 80), chiesto ogni volta: i fatti del TV arrivano dopo
    function partenza() {
      var p = '';
      try { p = String(typeof o.tettoPartenza === 'function' ? o.tettoPartenza() : o.tettoPartenza || ''); } catch (e) { p = ''; }
      return p === '150' ? '150' : '80';
    }
    var FILE_IMP = path.join(o.cartella, 'video-impostazioni.json'), imp = caricaImp();
    function caricaImp() {
      var c = null;
      try { c = JSON.parse(fs.readFileSync(FILE_IMP, 'utf8')); } catch (e) { c = null; }
      if (!c || typeof c !== 'object') c = {};
      var prova = c.prova && +c.prova.mbps >= 10 && +c.prova.mbps <= 1000 ? { mbps: Math.round(+c.prova.mbps), quando: +c.prova.quando || 0 } : null;
      var scelta = c.scelta === '150' || c.scelta === '80' || (c.scelta === 'prova' && prova) ? c.scelta : '';
      // quanto si uniscono i tratti da ricodificare (secondi): piu' si uniscono, meno giunture (se il TV scatta li')
      var unione = c.unione === 30 || c.unione === 60 ? c.unione : 10;
      return { scelta: scelta, prova: prova, unione: unione, misura: misuraDi(c.misura, +(c.misura && c.misura.quando) || 0) };
    }
    // l'ultima prova del tetto fatta dal TV col video a scalini: per ogni scalino Mbps, fermate, ms da fermo, ms veri e secondi
    // di video; "mbps" e' l'ultimo scalino senza scatti (0 se gia' il primo scatta). Solo numeri, controllati
    function misuraDi(m, quando) {
      if (!m || typeof m !== 'object' || !Array.isArray(m.scalini)) return null;
      function num(x, max) { x = +x; return x > 0 ? Math.min(max, Math.round(x)) : 0; }
      var sc = [];
      for (var i = 0; i < m.scalini.length && sc.length < 10; i++) {
        var s = m.scalini[i];
        if (!s || typeof s !== 'object' || !(+s.mbps >= 1 && +s.mbps <= 1000)) continue;
        sc.push({ mbps: Math.round(+s.mbps * 10) / 10, fermate: num(s.fermate, 10000), msFermo: num(s.msFermo, 3600000), ms: num(s.ms, 3600000),
          secondi: Math.round(Math.min(600, Math.max(0, +s.secondi || 0)) * 10) / 10 });
      }
      var motivo = String(m.motivo || '');
      return sc.length ? { mbps: num(m.mbps, 1000), scalini: sc, motivo: /^(fine|errore|bloccato)$/.test(motivo) ? motivo : '', errore: num(m.errore, 99),
        quando: quando } : null;
    }
    function sceltaTetto() { return imp.scelta || partenza(); }
    function tettoTv() { var sc = sceltaTetto(); return sc === '150' ? 150 : sc === 'prova' && imp.prova ? imp.prova.mbps : 80; }
    function statoTetto() { return { scelta: sceltaTetto(), scelto: !!imp.scelta, mbps: tettoTv(), prova: imp.prova, unione: imp.unione, misura: imp.misura }; }

    // il diario del lettore: le ultime 40 visioni, solo numeri tecnici (strada, codec, misure, fermate, errori; niente titoli
    // ne' percorsi). Serve al giro di prove sul TV: chi prova lo legge dal Mac (porta 8091, /tv), senza chiedere a nessuno
    var FILE_DIARIO = path.join(o.cartella, 'diario-video.json'), diario = caricaDiario();
    function caricaDiario() {
      try { var d = JSON.parse(fs.readFileSync(FILE_DIARIO, 'utf8')); return Array.isArray(d) ? d.slice(-40) : []; } catch (e) { return []; }
    }
    var PAROLE_DIARIO = { strada: ['chiavetta', 'versione-tv', 'disco', 'diretto', 'file', 'copia', 'converti', 'mac'],
      formato: ['mkv', 'webm', 'mp4', 'mov', 'm4v', 'ts', 'm2ts', 'avi', 'blu-ray', 'dvd', 'hls', 'altro'],
      codec: ['HEVC', 'AVC', 'AV1', 'VP9', 'VP8', 'MPEG2', 'MPEG4', 'VC1'], hdr: ['HDR10', 'HDR10+', 'DV', 'HLG'],
      audio: ['AC3', 'EAC3', 'AAC', 'MP3', 'MP2', 'OPUS', 'FLAC', 'PCM', 'DTS', 'TRUEHD', 'VORBIS'] };
    function voceDiario(b) {
      function num(x, max) { x = +x; return isFinite(x) ? Math.max(0, Math.min(max, Math.round(x * 10) / 10)) : 0; }
      var v = { quando: Date.now() }, k;
      for (k in PAROLE_DIARIO) if (Object.prototype.hasOwnProperty.call(PAROLE_DIARIO, k)) v[k] = PAROLE_DIARIO[k].indexOf(String(b[k] || '')) >= 0 ? String(b[k]) : '';
      v.larghezza = num(b.larghezza, 8192);
      v.altezza = num(b.altezza, 4320);
      v.mbps = num(b.mbps, 1000);
      v.picco = num(b.picco, 1000);
      v.secondi = num(b.secondi, 86400);
      v.msPrimo = num(b.msPrimo, 600000);
      v.fermate = num(b.fermate, 100000);
      v.msFermo = num(b.msFermo, 86400000);
      v.salti = num(b.salti, 100000);
      v.ritmo = num(b.ritmo, 10);
      v.errore = num(b.errore, 99);
      return v;
    }

    var FILE_MAC = path.join(o.cartella, 'limitatore.json');
    var mac = caricaMac(), abbinando = null, proveMac = [];
    function caricaMac() {
      var c = null;
      try { c = JSON.parse(fs.readFileSync(FILE_MAC, 'utf8')); } catch (e) { c = null; }
      if (!c || typeof c !== 'object') return { indirizzo: '', chiave: '' };
      var ind = indirizzoBuono(urlLib, c.indirizzo, o.locale);
      if (!ind || ind !== c.indirizzo) return { indirizzo: '', chiave: '' };
      return { indirizzo: ind, chiave: /^[0-9a-f]{32}$/.test(c.chiave || '') ? c.chiave : '' };
    }
    function salvaMac() { scriviPrivato(FILE_MAC, mac, 'Limitatore'); }
    function dimenticaMac() { mac.chiave = ''; salvaMac(); }
    function statoMac() {
      return { server: mac.indirizzo ? { indirizzo: mac.indirizzo } : null, collegato: !!(mac.indirizzo && mac.chiave),
        abbinando: !!(abbinando && Date.now() - abbinando.da < 300000) };
    }
    // dove cercarlo: di solito sul Mac di Jellyfin, porta 8097. Senza chiave risponde 401 e parla della chiave
    function cercaMac(cb) {
      var l = [], gia = {}, trovati = [];
      if (mac.indirizzo) l.push(mac.indirizzo);
      if (cfg.indirizzo) {
        var h = urlLib.parse(cfg.indirizzo).hostname || '';
        if (h) l.push('http://' + (h.indexOf(':') >= 0 ? '[' + h + ']' : h) + ':' + (o.portaMac || 8097));
      }
      l = l.map(function (x) { return indirizzoBuono(urlLib, x, o.locale); }).filter(function (x) { if (!x || gia[x]) return false; gia[x] = true; return true; });
      var resta = l.length;
      if (!resta) { cb([]); return; }
      l.forEach(function (ind) {
        chiedi({ mac: 'senza', dove: ind, percorso: 'stato', tempo: 2000, max: 4096 }, function (err, st, j) {
          if (!err && st === 401 && j && /chiave/.test(String(j.errore || ''))) trovati.push(ind);
          if (--resta === 0) cb(trovati);
        });
      });
    }
    function abbinaMac(dove, cb) {
      var ind = indirizzoBuono(urlLib, dove, o.locale), ora = Date.now();
      if (!ind) { cb(errore('indirizzo', 'indirizzo non valido')); return; }
      proveMac = proveMac.filter(function (t) { return ora - t < 600000; });
      if (proveMac.length >= 10) { cb(errore('troppe', 'troppi tentativi: aspetta qualche minuto')); return; }
      proveMac.push(ora);
      controllaNome(ind, function (e0) {
        if (e0) { cb(e0); return; }
        chiedi({ mac: 'senza', dove: ind, percorso: 'abbina', metodo: 'POST', corpo: { nome: nomeDelTv() }, tempo: 5000, max: 65536 }, function (err, st, j) {
          if (err) { cb(err.codice === 'rete' ? errore('rete', 'il Mac non risponde') : err); return; }
          if (st === 429) { cb(errore('troppe', 'troppe richieste: aspetta qualche minuto')); return; }
          if (st !== 200 || !j || !/^[0-9a-f]{16}$/.test(j.id || '')) { cb(errore('limitatore', 'a quell\'indirizzo non risponde il limitatore')); return; }
          abbinando = { indirizzo: ind, id: j.id, da: Date.now() };
          cb(null, { scade: 300 });
        });
      });
    }
    function codiceMac(codice, cb) {
      var a = abbinando, c = String(codice === undefined || codice === null ? '' : codice).replace(/\D/g, '');
      if (!a || Date.now() - a.da > 300000) { abbinando = null; cb(errore('scaduto', 'codice scaduto: ricomincia')); return; }
      if (c.length !== 6) { cb(errore('codice', 'servono le 6 cifre che mostra il Mac')); return; }
      chiedi({ mac: 'senza', dove: a.indirizzo, percorso: 'abbina/' + a.id, metodo: 'POST', corpo: { codice: c }, tempo: 5000, max: 65536 }, function (err, st, j) {
        if (err) { cb(err.codice === 'rete' ? errore('rete', 'il Mac non risponde') : err); return; }
        if (st === 404 || (st === 403 && j && /3 volte/.test(String(j.errore || '')))) {
          if (abbinando === a) abbinando = null;
          cb(errore('scaduto', st === 404 ? 'codice scaduto: ricomincia' : 'codice sbagliato 3 volte: ricomincia'));
          return;
        }
        if (st === 403) { cb(errore('codice', 'codice sbagliato')); return; }
        if (st !== 200 || !j || !/^[0-9a-f]{32}$/.test(j.chiave || '')) { cb(errore('limitatore', 'il Mac ha risposto in modo strano')); return; }
        if (abbinando === a) abbinando = null;
        mac = { indirizzo: a.indirizzo, chiave: j.chiave };
        salvaMac();
        log('Limitatore del Mac collegato');
        cb(null, statoMac());
      });
    }

    // i percorsi del limitatore che il ponte lascia passare (il resto: 403). Il video a scalini serve alla prova del tetto
    // fatta dal TV; la versione TV no: scrive accanto ai film, e la chiede solo chi sta al Mac
    var LISTA_MAC = [['GET', 'stato'], ['GET', 'elenco'], ['GET', 'risultato'], ['GET', 'lavori'], ['GET', 'lavori/(analisi|hls|prova)-[0-9]{1,9}'],
      ['POST', 'lavori/(analisi|hls|prova)-[0-9]{1,9}/ferma'], ['POST', 'analisi'], ['POST', 'hls'], ['GET', 'hls/[0-9a-f]{16}/(info|index\\.m3u8)'],
      ['GET', 'hls/[0-9a-f]{16}/p[0-9]{3,6}_[0-9]{5,9}\\.ts'], ['GET', 'prova-tetto'], ['POST', 'prova-tetto'],
      ['GET', 'prova-tetto/(index\\.m3u8|p[0-9]{3,6}_[0-9]{5,9}\\.ts)']].map(function (x) { return { metodo: x[0], re: new RegExp('^' + x[1] + '$') }; });
    function inListaMac(metodo, percorso) {
      if (SCAPPA.test(percorso)) return false;
      var m = metodo === 'HEAD' ? 'GET' : metodo;
      for (var i = 0; i < LISTA_MAC.length; i++) if (LISTA_MAC[i].metodo === m && LISTA_MAC[i].re.test(percorso)) return true;
      return false;
    }
    var PEZZO_MAC = /^p[0-9]{3,6}_[0-9]{5,9}\.ts$/;
    // la playlist del limitatore: solo i suoi pezzi, per nome (accanto alla playlist), senza chiave; il resto si toglie
    function riscriviPlaylistMac(t) {
      var righe = String(t).split(/\r?\n/), out = [];
      for (var i = 0; i < righe.length; i++) {
        var r = righe[i].replace(/^\s+|\s+$/g, '');
        if (!r) continue;
        if (r.charAt(0) === '#') { if (!/URI\s*=/i.test(r)) out.push(r); continue; }
        var nome = r.split('?')[0];
        if (PEZZO_MAC.test(nome)) { out.push(nome); continue; }
        while (out.length && /^#EXTINF/i.test(out[out.length - 1])) out.pop();
      }
      return out.join('\n') + '\n';
    }
    function inoltraMac(req, res, percorso, u) {
      var metodo = req.method;
      if (!inListaMac(metodo, percorso)) { rispondi(res, 403, { error: 'percorso non permesso', codice: 'lista' }); return; }
      if (!mac.indirizzo || !mac.chiave) { rispondi(res, 401, { error: 'collega il Mac', codice: 'accesso' }); return; }
      var query = String(u.search || '').replace(/^\?/, '').split('&').filter(function (x) { return x && !/^chiave=/i.test(x); }).join('&');
      var pezzo = /\.ts$/.test(percorso), lista = /\.m3u8$/.test(percorso), dr = null;
      function vai(corpo) {
        dr = apriDomanda({ mac: true, percorso: percorso, query: query, metodo: metodo, corpo: corpo, accetta: '*/*',
          range: pezzo ? req.headers.range : undefined, tempo: pezzo ? 30000 : 15000, lungo: pezzo }, function (err, r) {
          if (err) { rispondi(res, 502, { error: err.message, codice: 'rete' }); return; }
          if (r.statusCode === 401) { r.resume(); dimenticaMac(); rispondi(res, 401, { error: 'il Mac non riconosce piu\' questo TV', codice: 'accesso' }); return; }
          if (!pezzo) {
            // le risposte brevi (JSON, playlist) si leggono tutte: la chiave non deve mai uscire
            var parti = [], n = 0, rotto = false;
            r.on('data', function (d) { n += d.length; if (n > MAX_PLAYLIST) { rotto = true; try { r.destroy(); } catch (e) {} rispondi(res, 502, { error: 'risposta troppo grande', codice: 'server' }); } else parti.push(d); });
            r.on('end', function () {
              if (rotto) return;
              var t = Buffer.concat(parti, n).toString('utf8'), pl = lista && r.statusCode === 200;
              if (pl) t = riscriviPlaylistMac(t);
              if (mac.chiave) t = t.split(mac.chiave).join('***');
              var b = bufDa(t);
              res.writeHead(r.statusCode, { 'Content-Type': pl ? 'application/vnd.apple.mpegurl' : 'application/json; charset=utf-8', 'Content-Length': String(b.length),
                'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
              res.end(metodo === 'HEAD' ? undefined : b);
            });
            r.on('aborted', function () { if (!rotto) { rotto = true; rispondi(res, 502, { error: 'interrotto', codice: 'rete' }); } });
            r.on('error', function () { if (!rotto) { rotto = true; rispondi(res, 502, { error: 'interrotto', codice: 'rete' }); } });
            return;
          }
          var testa = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length', 'Cache-Control': 'no-store' };
          ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(function (k) { if (r.headers[k] !== undefined) testa[k] = r.headers[k]; });
          res.writeHead(r.statusCode, testa);
          if (metodo === 'HEAD') { r.resume(); res.end(); return; }
          r.pipe(res);
          r.on('aborted', function () { try { res.destroy(); } catch (e) {} });
          r.on('error', function () { try { res.destroy(); } catch (e) {} });
        });
        // il <video> chiude (salto, fine): si chiude anche la domanda verso il Mac
        res.on('close', function () { if (dr) { try { dr.abort(); } catch (e) {} } });
      }
      if (metodo === 'POST') corpoJson(req, function (b) { if (!b) rispondi(res, 400, { error: 'corpo non valido', codice: 'corpo' }); else vai(b); });
      else vai(undefined);
    }

    // la quarta strada dei film di Jellyfin: lo stesso file preparato dal limitatore (HLS "copia + picchi"). Il percorso vero
    // del file lo dice Jellyfin e lo usa solo il ponte. Si richiama finche' e' pronto: i lavori uguali il limitatore li riusa
    function lavoroPubblico(l) {
      if (!l || typeof l !== 'object') return null;
      var a = l.avanzamento && typeof l.avanzamento === 'object' ? l.avanzamento : {};
      return { id: testo(l.id, 40), stato: testo(l.stato, 20), fase: testo(a.fase, 60), percentuale: +a.percentuale || 0, stima: +a.stimaSecondi || 0,
        errore: l.errore ? testo(l.errore, 200) : '' };
    }
    function limita(id, msid, tetto, aJf, cb) {
      function daMac(e) { return e.codice === 'accesso' ? errore('mac', 'il Mac non riconosce piu\' questo TV: ricollegalo') : e; }
      if (!cfg.token || !cfg.utente) { cb(errore('accesso', 'serve l\'accesso a Jellyfin')); return; }
      chiedi({ percorso: 'Items/' + id, query: 'userId=' + cfg.utente.id }, function (err, st, j) {
        if (err) { cb(err); return; }
        var l = j && Array.isArray(j.MediaSources) ? j.MediaSources : [], ms = null;
        for (var i = 0; i < l.length; i++) if (String(l[i] && l[i].Id || '').toLowerCase() === msid) { ms = l[i]; break; }
        if (st !== 200 || !ms) { cb(errore('assente', 'film non trovato')); return; }
        var file = String(ms.Path || '');
        if (file.charAt(0) !== '/' || file.length > 4096 || /[\u0000-\u001f]/.test(file)) { cb(errore('cartella', 'il limitatore del Mac non vede questo file')); return; }
        var corpo = { file: file, unione: imp.unione };
        if (tetto) corpo.tetto = tetto;
        // l'audio scelto: Jellyfin conta tutte le tracce del file, il limitatore solo quelle audio (da 0)
        if (aJf >= 0) {
          var au = (Array.isArray(ms.MediaStreams) ? ms.MediaStreams : []).filter(function (x) { return x && x.Type === 'Audio'; })
            .sort(function (x, y) { return x.Index - y.Index; });
          for (var k = 0; k < au.length; k++) if (au[k].Index === aJf) corpo.audio = k;
        }
        chiedi({ mac: true, percorso: 'analisi', metodo: 'POST', corpo: corpo, tempo: 15000, max: 1 << 20 }, function (e2, st2, j2) {
          if (e2) { cb(daMac(e2)); return; }
          if (st2 === 403 || st2 === 404 || st2 === 415) { cb(errore('cartella', 'il limitatore del Mac non vede questo file: aggiungi la sua cartella sul Mac')); return; }
          if (st2 === 202) { cb(null, { pronto: false, fase: 'analisi', lavoro: lavoroPubblico(j2 && j2.lavoro) }); return; }
          var ris = st2 === 200 && j2 && j2.risultato;
          if (!ris || typeof ris !== 'object') { cb(errore('limitatore', 'il limitatore non risponde come dovrebbe')); return; }
          var out = { serve: !!ris.serve, tetto: +ris.tetto || 0, picco: +ris.piccoMbps || 0, media: +ris.mediaMbps || 0,
            ricodifica: +(ris.piano && ris.piano.ricodificaQuota) || 0 };
          // niente picchi oltre il tetto: va bene il file com'e' (la strada diretta)
          if (!out.serve) { out.pronto = true; cb(null, out); return; }
          chiedi({ mac: true, percorso: 'hls', metodo: 'POST', corpo: corpo, tempo: 15000, max: 1 << 20 }, function (e3, st3, j3) {
            if (e3) { cb(daMac(e3)); return; }
            var h = j3 && j3.hls;
            if ((st3 !== 202 && st3 !== 200) || !h || !/^[0-9a-f]{16}$/.test(h.id || '')) { cb(errore('limitatore', 'il limitatore non prepara il film')); return; }
            out.pronto = !!h.giocabile;
            out.fase = 'hls';
            out.url = 'mac/p/hls/' + h.id + '/index.m3u8';
            out.info = 'mac/p/hls/' + h.id + '/info';
            out.completo = !!h.completo;
            out.secondiPronti = +h.secondiPronti || 0;
            out.lavoro = lavoroPubblico(j3.lavoro);
            cb(null, out);
          });
        });
      });
    }

    function trattaMac(req, res, resto, q, u) {
      var get = req.method === 'GET', post = req.method === 'POST';
      function errore2(e) {
        var c = e.codice || 'errore';
        rispondi(res, c === 'accesso' ? 401 : c === 'rete' || c === 'certificato' ? 502 : c === 'troppe' ? 429 : c === 'codice' ? 403 :
          c === 'scaduto' ? 410 : 400, { error: e.message, codice: c });
      }
      if (resto === 'stato' && get) {
        var s = statoMac();
        if (q.vivo !== '1' || !s.collegato) { rispondi(res, 200, s); return; }
        chiedi({ mac: true, percorso: 'stato', tempo: 4000, max: 262144 }, function (err, st, j) {
          var s2 = statoMac();
          s2.acceso = !err && st === 200 && !!j;
          if (s2.acceso) {
            s2.mac = { versione: testo(j.versione, 20), videotoolbox: !!j.videotoolbox, tettoPredefinito: +j.tettoPredefinito || 80,
              cartelle: (Array.isArray(j.cartelle) ? j.cartelle : []).slice(0, 50).map(function (c) { return { nome: testo(c && c.nome, 100), esiste: !!(c && c.esiste) }; }) };
          }
          rispondi(res, 200, s2);
        });
        return;
      }
      if (resto === 'cerca' && get) { cercaMac(function (l) { rispondi(res, 200, { trovati: l }); }); return; }
      if ((resto === 'abbina' || resto === 'codice') && post) {
        corpoJson(req, function (b) {
          if (!b) { rispondi(res, 400, { error: 'corpo non valido', codice: 'corpo' }); return; }
          if (resto === 'abbina') abbinaMac(b.indirizzo, function (e, r) { if (e) errore2(e); else rispondi(res, 200, r); });
          else codiceMac(b.codice, function (e, r) { if (e) errore2(e); else rispondi(res, 200, r); });
        });
        return;
      }
      if (resto === 'esci' && post) { abbinando = null; dimenticaMac(); log('Limitatore del Mac scollegato'); rispondi(res, 200, statoMac()); return; }
      if (resto.indexOf('p/') === 0) {
        var percorso = resto.slice(2);
        if (/(^|\/)\.\.?(\/|$)|\/\/|\\/.test(percorso)) { rispondi(res, 403, { error: 'percorso non permesso', codice: 'lista' }); return; }
        inoltraMac(req, res, percorso, u);
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
          misuraCpu(function (r) {
            misurando = false;
            // la misura vale anche per il convertitore dell'audio DTS e TrueHD (audio-tv.js)
            if (typeof o.suVelocita === 'function') { try { o.suVelocita(r); } catch (e) {} }
            rispondi(res, 200, r);
          });
          return;
        }
        if (cosa.indexOf('mac/') === 0) { trattaMac(req, res, cosa.slice(4), q || {}, u); return; }
        if (cosa === 'tv/tetto' && req.method === 'GET') { rispondi(res, 200, statoTetto()); return; }
        if (cosa === 'tv/diario' && req.method === 'POST') {
          corpoJson(req, function (b) {
            if (!b) { rispondi(res, 400, { error: 'corpo non valido', codice: 'corpo' }); return; }
            diario.push(voceDiario(b));
            if (diario.length > 40) diario = diario.slice(-40);
            scriviPrivato(FILE_DIARIO, diario, 'Diario');
            rispondi(res, 200, { ok: true });
          });
          return;
        }
        if (cosa === 'tv/tetto' && req.method === 'POST') {
          corpoJson(req, function (b) {
            var sc = b && b.scelta !== undefined ? String(b.scelta) : '', mb = b ? Math.round(+b.mbps) : 0, un = b ? +b.unione : 0;
            var mi = b && b.misura !== undefined ? misuraDi(b.misura, Date.now()) : null;
            if (!b || (sc && sc !== '80' && sc !== '150' && !(sc === 'prova' && mb >= 10 && mb <= 1000)) || (b.unione !== undefined && un !== 10 && un !== 30 && un !== 60) ||
                (b.misura !== undefined && !mi) || (!sc && b.unione === undefined && !mi)) { rispondi(res, 400, { error: 'scelta non valida', codice: 'corpo' }); return; }
            if (sc) imp.scelta = sc;
            if (sc === 'prova') imp.prova = { mbps: mb, quando: Date.now() };
            if (b.unione !== undefined) imp.unione = un;
            if (mi) imp.misura = mi;
            scriviPrivato(FILE_IMP, imp, 'Tetto');
            rispondi(res, 200, statoTetto());
          });
          return;
        }
        rispondi(res, 404, { error: 'domanda sconosciuta', codice: 'assente' });
      },
      stato: statoPubblico,
      // per chi prova il TV dal Mac (8091/tv): il tetto e l'ultima prova del TV, senza le ore
      tetto: function () {
        var s = statoTetto(), m = s.misura;
        return { scelta: s.scelta, scelto: s.scelto, mbps: s.mbps, unione: s.unione, prova: s.prova ? { mbps: s.prova.mbps } : null,
          misura: m ? { mbps: m.mbps, scalini: m.scalini, motivo: m.motivo, errore: m.errore } : null };
      },
      // per chi prova il TV dal Mac (8091/tv, senza chiave): le ultime visioni, solo numeri tecnici e senza l'ora (l'ordine
      // basta per le prove; quando si guarda la TV in casa non e' affare di chi sta in rete)
      diario: function () {
        return diario.map(function (v) {
          var c = {};
          for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && k !== 'quando') c[k] = v[k];
          return c;
        });
      },
      // l'app Video e' chiusa: via le sorgenti di Jellyfin ricordate (i film aperti li lascia la videoteca). La misura della
      // rete resta: vale per i prossimi 20 minuti
      riposa: function () { sorgenti = {}; misure = {}; },
      // per le prove
      _cfg: function () { return cfg; }, _sorgenti: function () { return sorgenti; }, _mac: function () { return mac; }
    };
  }

  return {
    crea: crea, VERSIONE: VERSIONE,
    _interni: { misuraCpu: misuraCpu, inLista: inLista, senzaChiavi: senzaChiavi, riscriviPlaylist: riscriviPlaylist, indirizzoBuono: indirizzoBuono,
      famigliaJf: famigliaJf, profilo: profilo, qualitaAuto: qualitaAuto, fsRemoto: fsRemoto, QUALITA: QUALITA }
  };
})();
