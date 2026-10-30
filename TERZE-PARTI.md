# Codice e liste di altri

Home TV è scritta da zero (licenza MIT, file `LICENSE`), ma usa il lavoro di altri progetti liberi. Qui c'è cosa,
di chi è e con quale licenza. Grazie a tutti.

## Dentro il modulo

### qrcode.js – QR Code Generator for JavaScript

- Di **Kazuhiko Arase**: <https://github.com/kazuhikoarase/qrcode-generator> (<http://www.d-project.com/>).
- Licenza **MIT**: il testo è qui sotto. In testa al file ci sono l'avviso di copyright e il link alla licenza; il file è rimasto com'era.
- "QR Code" è un marchio registrato di DENSO WAVE INCORPORATED.

```
Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### audio-tv-codec.js – FFmpeg (il convertitore dell'audio DTS e TrueHD)

- Il file contiene, in base64, un programma WebAssembly costruito da **FFmpeg 9.0.2** (<https://ffmpeg.org/>): i
  decodificatori DTS (solo il nucleo) e TrueHD/MLP e l'encoder AC3, più le parti di libavcodec e libavutil che servono.
  `service.js` ne ha una copia uguale.
- FFmpeg è degli **sviluppatori di FFmpeg** (<https://ffmpeg.org/legal.html>). Le parti usate sono sotto la licenza
  **GNU LGPL 2.1 o successiva** (costruito senza le parti GPL: `--disable-everything` più quei tre codec). Il sorgente è
  quello ufficiale di FFmpeg 9.0.2 (<https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz>); la costruzione toglie due righe
  da una copia di `libavutil/tx.c` (le trasformate double e int32, che questi codec non usano) e mette `solo_nucleo.c` al
  posto di `dca_xll.c` e `dca_lbr.c` (le estensioni del DTS che non si decodificano). Tutto, con la piccola interfaccia
  `atv.c`, è nel progetto in `prove/audio-tv/codec/`: chiunque lo può rifare, anche con un FFmpeg cambiato, e mettere il
  suo al posto di questo (`costruisci.sh` riscrive `audio-tv-codec.js`).
- Dolby, Dolby Digital e TrueHD sono marchi di Dolby Laboratories; DTS è un marchio di DTS, Inc. Home TV non ha
  rapporti con loro.

## Scaricato dal TV (non è dentro il modulo)

Le liste di filtri per il blocco della pubblicità le scarica il TV da solo, dai loro siti ufficiali, e le usa così
come sono (le legge per prepararle al blocco, senza cambiarne il contenuto). Restano sotto le loro licenze.

| Lista | Di chi è | Licenza | Da dove |
|---|---|---|---|
| EasyList | gli autori di EasyList | a scelta GPLv3 (o successiva) oppure CC BY-SA 3.0 (o successiva) | <https://easylist.to/> (licenza: <https://easylist.to/pages/licence.html>) |
| EasyList Italy | gli autori di EasyList Italy | come EasyList | <https://easylist-downloads.adblockplus.org/easylistitaly.txt> |
| Lista contro gli anti-adblock (solo col blocco avanzato acceso) | eyeo GmbH | GPLv3 | <https://gitlab.com/eyeo/anti-cv/abp-filters-anti-cv> |

## Dove gira e cosa scarica l'installatore (non sono dentro il modulo)

- **TizenBrew** e **TizenBrew Installer**, di **Reis Can** (reisxd), software libero con licenza **GPL-3.0**:
  <https://github.com/reisxd/TizenBrew> e <https://github.com/reisxd/TizenBrewInstaller>. Home TV è un modulo per
  TizenBrew: non contiene e non cambia il suo codice. L'app per Mac scarica TizenBrew Installer dalla pagina ufficiale
  delle sue versioni.
- **sdb**, lo strumento ufficiale di Tizen: l'app per Mac lo scarica da <https://download.tizen.org/>, con la sua
  licenza.

## Idee prese da altri (nessun codice copiato)

- **Apps2Samsung** (Patrick Stel, licenza MIT): alcune idee per capire quando il TV è pronto, nell'app per Mac.
- Il blocco della pubblicità e l'interfaccia per la TV dei siti di video usano idee note di altri progetti liberi. Il
  codice di Home TV è scritto da zero.

## Marchi

Home TV non è affiliato, sponsorizzato né approvato da Samsung, dal progetto Tizen o da The Linux Foundation, dagli autori di TizenBrew né dai
servizi e dalle app che si aprono dalla home. I nomi di app e servizi citati sono marchi dei rispettivi titolari e
servono solo a dire con cosa funziona la home. Tizen è un marchio di The Linux Foundation.
