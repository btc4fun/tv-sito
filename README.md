# Home TV (tv-sito)

Una schermata principale per i **TV Samsung** con **TizenBrew**: in alto le app che usi di più e i tuoi siti, sotto
tutte le altre app installate, un browser con il blocco della pubblicità, il telefono come telecomando
e la home che si riapre da sola all'accensione. Si comanda tutto dal telecomando; la home non cambia il sistema del TV.

## Metterla sul tuo TV

Ti serve un **Mac** o un **PC con Windows 10 o 11** sulla stessa Wi-Fi del TV. Scarica l'app **Installa Home TV** dalla
pagina [**Release**](../../releases/latest) (`Installa-Home-TV.zip` per Mac, `Installa-Home-TV-Windows.zip` per Windows),
aprila e segui i passi: fa quasi tutto lei e ti mostra cosa premere sul telecomando, anche quello senza tasti numerici.
Non serve un account GitHub.

Sul Mac:

1. Apri lo zip e trascina **Installa Home TV** nella cartella **Applicazioni**.
2. La prima volta: tasto destro sull'app, **Apri**, poi **Apri**. Se macOS non la apre: **Impostazioni di Sistema**,
   **Privacy e sicurezza**, in fondo **Apri comunque** (l'app non è firmata da uno sviluppatore Apple a pagamento).
3. Se macOS chiede di trovare dispositivi sulla rete locale, scegli **Consenti**.
4. Accendi il TV e segui l'app (circa 20 minuti, una volta sola).

Su Windows (64 bit; prima versione, provata solo in simulazione):

1. Tasto destro su `Installa-Home-TV-Windows.zip`, **Estrai tutto...** (non aprirla da dentro lo zip).
2. Nella cartella estratta, doppio clic su **Installa Home TV**. Se Windows dice **PC protetto da Windows**:
   **Ulteriori informazioni**, poi **Esegui comunque** (l'app non è firmata con un certificato a pagamento).
3. Se Windows chiede il permesso del **Firewall**, va bene sia Consenti sia Annulla.
4. Accendi il TV e segui l'app, come sul Mac.

La guida completa, con l'uso di tutti i giorni, è in [LEGGIMI.md](LEGGIMI.md).

## Una tua copia del modulo (facoltativo)

Questa cartella è il **modulo** da mettere su GitHub (repository pubblico `tv-sito`, con GitHub Pages attivo). Serve
solo se vuoi una copia tutta tua invece di usare quella già pronta.

1. Crea un repository **pubblico** chiamato `tv-sito` e caricaci **tutti i file** di questa cartella.
2. **Settings → Pages**: branch **main**, cartella **/(root)** → **Save**.
3. In `package.json`, nella riga `websiteURL`, sostituisci `TUO-UTENTE` con il tuo nome utente GitHub, tutto
   minuscolo. È l'**unica modifica a mano**: il link del tuo sito e tutto il resto si scelgono dal TV.
4. Sul TV, con TizenBrew: aggiungi il modulo GitHub `tuonomeutente/tv-sito` e mettilo in avvio automatico (e nei
   servizi in avvio automatico). Con l'app **Installa Home TV** (Mac o Windows) lo fa lei.

## Quali TV

| Anno del TV (lettera nel codice modello) | Home TV |
|---|---|
| 2015-2016 (J, K) | No (TizenBrew funziona da Tizen 3.0) |
| 2017 (M) | In parte: il tuo sito, il browser e il blocco della pubblicità sì; app del TV, telefono e riapertura no |
| 2018-2022 (N, R, T, A, B) | Sì |
| 2023 (C) | Sì (l'installazione di TizenBrew chiede l'accesso Samsung) |
| 2024-2026 (D, F, H) | Sì, ma TizenBrew è a rischio su questi TV (problemi noti con Tizen 8 e 9) |

In **Impostazioni → Questo TV** la home dice cosa funziona sul tuo TV e cosa fare se manca qualcosa.

## Come è fatto

Un solo modulo per tutti i TV: le differenze tra un TV e l'altro (anno, versione di Tizen, motore web, cosa c'è e cosa
manca) stanno solo in `profilo.js`; `main.js` e `service.js` ne contengono una copia uguale.

| File | A cosa serve |
|---|---|
| `index.html`, `home.css`, `home.js` | La home |
| `browser.html`, `browser.js` | Il browser |
| `ui.js` | Pezzi comuni a home e browser |
| `profilo.js` | Il profilo del TV (le differenze tra i TV) |
| `main.js` | Dentro i siti: blocco della pubblicità, schermo intero, frecce del telecomando, cronologia |
| `service.js` | Il servizio sul TV: app, icone, riapertura all'accensione, telefono |
| `qrcode.js` | Il codice QR per collegare il telefono (libreria libera di Kazuhiko Arase) |
| `config.json` | Le impostazioni di partenza (di solito non serve toccarle) |
| `package.json` | La carta d'identità del modulo per TizenBrew |
| `LICENSE` | La licenza (MIT) |
| `TERZE-PARTI.md` | Il codice e le liste di altri che la home usa, con le loro licenze |

Solo JavaScript ES5 (i TV hanno motori web vecchi, dal Chromium 47 dei TV 2017).

## Licenza e marchi

Progetto indipendente, gratuito e open source, con licenza **MIT** (vedi [LICENSE](LICENSE)). È un modulo per
TizenBrew, software libero di altri (GPL-3.0): non contiene e non cambia il suo codice. Il codice e le liste di altri
che la home usa sono in [TERZE-PARTI.md](TERZE-PARTI.md).

Non è affiliato, sponsorizzato né approvato da Samsung, dal progetto Tizen o da The Linux Foundation, dagli autori di
TizenBrew né dai servizi e dalle app che si aprono dalla home: i loro nomi sono marchi dei rispettivi titolari e servono
solo a dire con cosa funziona (Tizen è un marchio di The Linux Foundation).

Da sapere: la modalità sviluppatore del TV e TizenBrew sono una scelta di chi li usa e a suo rischio (Samsung non le
approva e potrebbero incidere sulla garanzia). Usa la home con siti leciti, rispettando le condizioni d'uso dei siti.
