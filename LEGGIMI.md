# Home TV – la tua home per i TV Samsung

Funziona sui Samsung con TizenBrew: i TV dal 2018 in poi del tutto, quelli del 2017 in parte (vedi *Quali TV* in fondo). È provata davvero su un QE55Q80B del 2022.

Una schermata principale pulita e semplice, che si modifica **direttamente dal telecomando**:

- **In alto i preferiti**: il tuo sito, il Browser e le app che usi di più (Netflix, Disney+, Prime Video, YouTube…). Si aprono le **app vere** del TV.
- **Sotto, le altre app installate**, divise per tipo: *Film e serie*, *Sport*, *Video e musica*, *Giochi*, *Altre app*.
- **Impostazioni sul TV** (tasto **Blu** o l'ingranaggio in alto a destra): tema, nome nel saluto, link del sito, motore di ricerca e altro. Non serve più GitHub per le modifiche di tutti i giorni.
- **Il tuo sito** con il **blocco della pubblicità**: le pubblicità spariscono senza rompere la pagina. Usa le **stesse liste di filtri degli adblocker più diffusi** (EasyList ed EasyList Italy), che il TV scarica da solo e aggiorna ogni giorno. Il **blocco avanzato**, per i siti che bloccano chi usa un adblock, è spento all'inizio: se accenderlo lo decidi tu (vedi *Le impostazioni*).
- **Un browser** con ricerca, **preferiti** (aggiungi, sposta, rinomina, togli) e **cronologia** automatica di tutte le pagine che apri. Anche qui senza pubblicità.
- **All'accensione** il TV riapre la home (vedi *Limiti* in fondo).
- **Telecomando sul telefono**: un'icona sull'iPhone che comanda **tutto il TV** (anche Netflix e i menu Samsung), con volume, spegnimento, una casella per scrivere e l'invio di link al TV. Gira sul TV stesso: niente computer acceso.
- **Leggera**: niente animazioni pesanti, si muove fluida anche sul processore del TV.

Tutto gira dentro **TizenBrew**: la home non cambia il sistema del TV e si toglie in qualsiasi momento (vedi *Voglio togliere tutto*).

---

## I file

| File | A cosa serve |
|---|---|
| `config.json` | Le impostazioni di partenza (link del sito, app preferite, preferiti del browser). Puoi cambiarle anche da qui, ma di solito basta il TV |
| `index.html`, `home.css`, `home.js` | La home |
| `browser.html`, `browser.js` | Il browser |
| `store.html`, `store.js` | Lo **Store**: le app per Home TV, il dettaglio, *Le mie app* e il riquadro isolato dove gira un'app |
| `store-dati.js` | Le due liste dello Store (ufficiale e *Le mie app*), ognuna per conto suo, con la copia dell'ultimo catalogo |
| `tv-app.js` | La libreria per chi fa le app dello Store: tasti del telecomando e del telefono, memoria, tastiera |
| `ui.js` | Pezzi comuni a home e browser (tasti, menu, finestra per scrivere, comandi dal telefono) |
| `qrcode.js` | Disegna il codice QR per collegare il telefono (libreria libera di Kazuhiko Arase) |
| `main.js` | Dentro i siti: blocco della pubblicità, schermo intero, frecce del telecomando, cronologia |
| `service.js` | Il "ponte" con il TV: elenco app, icone, avvio delle app, preferiti e cronologia, riapertura all'accensione, telecomando sul telefono |
| `package.json` | La carta d'identità del modulo per TizenBrew |
| `profilo.js` | Il "profilo del TV": l'unico posto dove stanno le differenze tra i TV Samsung (anno, Tizen, motore web, cosa c'è e cosa fare quando manca). `main.js` e `service.js` ne hanno una copia uguale |
| `visti.js` | *Continua a guardare*: riconosce cosa guardi e da dove riprendere. È la stessa logica su ogni TV: `service.js` ne ha una copia uguale, l'app per Android lo usa così com'è |
| `LICENSE` | La licenza (MIT): puoi usare, cambiare e condividere la home liberamente |
| `TERZE-PARTI.md` | Il codice e le liste di altri che la home usa, con le loro licenze |

---

> **Da sapere prima di cominciare.** La modalità sviluppatore del TV e TizenBrew sono una tua scelta e a tuo rischio:
> Samsung non le approva e potrebbero incidere sulla garanzia. Usa il tuo account Samsung, scarica i programmi dalle loro
> pagine ufficiali e usa la home con siti leciti, rispettando le condizioni d'uso dei siti che visiti.

## Fase A – Metti i file su GitHub (Mac, 10 minuti)

1. Crea un account gratuito su **github.com** (Sign up). Il **nome utente** che scegli ti serve dopo: qui lo chiamo `TUO-UTENTE`.
2. In alto a destra **+** → **New repository** → nome `tv-sito`, lascia **Public** → **Create repository**.
3. Clicca **uploading an existing file**, trascina **tutti i file** della cartella `tv-sito` (non la cartella) e premi **Commit changes**.
4. **Settings** → **Pages** → sotto *Branch* scegli **main** e **/(root)** → **Save**. Dopo 1–2 minuti, ricaricando, compare *"Your site is live at…"*.
5. Apri `package.json` → **matita** → nella riga `websiteURL` sostituisci `TUO-UTENTE` con il tuo nome utente, **tutto minuscolo** → **Commit changes** (due volte). È l'**unica modifica** da fare a mano: tutto il resto la home lo capisce da sola.
6. Il link del tuo sito si mette dal telefono o dal TV (vedi *Cambiare il link del sito*), non in questi file: così resta solo sul tuo TV.
7. **Prova sul Mac**: apri `https://tuonomeutente.github.io/tv-sito/?demo`. Vedi la home con app di esempio: frecce e Invio per muoverti, tasto destro del mouse per il menu. Sul TV comparirà con le tue app vere.

> **Con l'app per Mac "Installa Home TV"** (cartella `installatore`, vedi la *Guida per gli amici*) le fasi B, C, D ed E
> le fai seguendo l'app, con le figure di ogni passaggio e senza Terminale: l'app scrive anche le impostazioni di
> TizenBrew (modulo e avvio automatico). Qui sotto ci sono gli stessi passi fatti a mano.

## Fase B – Prepara il TV (5 minuti)

1. **IP del Mac**: menu  → **Impostazioni di Sistema** → **Wi-Fi** → **Dettagli…** → *Indirizzo IP*. Segnatelo.
2. Sul TV premi **Home** → **App** e apri **Impostazioni app** (l'ingranaggio della schermata App). Lì premi il tasto **123** del telecomando e digita **1 2 3 4 5** (su alcuni TV basta la schermata App; se non succede niente, è perché non sei in *Impostazioni app*).
3. *Developer mode* → **On**, in *Host PC IP* scrivi l'IP del Mac → **OK**.
4. Tieni premuto il **tasto di accensione** finché il TV si riavvia.
5. **IP del TV**: **Impostazioni** → **Tutte le impostazioni** → **Generali e privacy** → **Rete** → **Stato rete** → **Impostazioni IP**. Segnatelo.

## Fase C – Installa TizenBrew (Mac, 10 minuti)

1. Menu  → **Informazioni su questo Mac**: *Apple M…* → serve la versione **arm64**, *Intel* → la versione **x64**.
2. Vai su **github.com/reisxd/TizenBrewInstaller/releases/latest** → *Assets* → scarica il file per **macOS** giusto.
3. Apri il **Terminale** (⌘ + Spazio → "Terminale"). Scrivi `chmod +x ` (con lo spazio), trascina dentro il file scaricato, **Invio**.
4. Trascina di nuovo il file nel Terminale e premi **Invio** per avviarlo. Se macOS lo blocca: **Impostazioni di Sistema** → **Privacy e sicurezza** → **Apri comunque**, poi ripeti.
5. Inserisci l'IP del TV e scegli **Install TizenBrew**. Se il TV chiede un permesso, accetta col telecomando. Fino ai TV del 2022 non serve il certificato Samsung; dal 2023 (Tizen 7) TizenBrew Installer chiede di accedere con l'account Samsung per crearlo (l'app per Mac ti guida).

## Fase D – Rimetti il TV in modalità "solo TV" (2 minuti, importante)

TizenBrew, per far funzionare blocco pubblicità, schermo intero e cronologia, ha bisogno che la modalità sviluppatore punti al TV stesso:

1. **App** → **Impostazioni app** → **1 2 3 4 5** → *Host PC IP*: scrivi **`127.0.0.1`** → **OK**.
2. Riavvia il TV tenendo premuto il tasto di accensione.

Da qui in poi il Mac non serve più.

## Fase E – Aggiungi la Home a TizenBrew (TV, 3 minuti)

1. **App** → apri **TizenBrew** (è in fondo alla lista).
2. Nella fila di **pulsanti tondi in alto** di TizenBrew scegli con le frecce il **gestore dei moduli** (Module Manager) e premi **OK** → **Aggiungi modulo GitHub** (Add GitHub Module) → scrivi `tuonomeutente/tv-sito`, chiudi la tastiera e premi la **freccia giù**: il modulo si aggiunge quando esci dalla casella (Invio da solo non basta) e compare *Home TV* tra i moduli (il repository deve chiamarsi proprio `tv-sito`). Per scrivere comodo usa l'app **SmartThings** sul telefono: telecomando del TV → tastiera. (Solo nel vecchio TizenBrew 1.x il gestore si apriva col tasto **Verde**: dalla 2.0 il Verde non fa niente.)
3. Sempre tra i pulsanti tondi in alto scegli le **impostazioni** di TizenBrew (Settings; nel vecchio 1.x era il tasto **Blu**):
   - **Impostazioni Autoavvio** → scegli **Home**: aprendo TizenBrew parte subito la tua home;
   - **Impostazioni di Autoavvio per i servizi** → scegli **Home**: il "ponte" con il TV parte sempre insieme a TizenBrew (serve per la riaccensione e per il telefono). Attenzione: in TizenBrew 2.0.5 questa voce, scelta dal telecomando, si salva male e non ha effetto (il ponte parte comunque appena si apre la Home); l'app per Mac la scrive giusta.
4. Torna indietro e apri **Home**.

## Fase F – Fai partire la home da sola (TV, 3 minuti)

1. **Impostazioni** → **Tutte le impostazioni** → **Generali e privacy** → **Opzioni schermata iniziale** → attiva **Esecuzione automatica ultima app**.
2. Nella barra delle app di Samsung (tasto **Home**), porta **TizenBrew** al primo posto: selezionalo, premi **giù** (o tieni premuto **OK**) → **Sposta** → spostalo tutto a sinistra. Così **Home → OK** ti riporta sempre alla tua home.

---

## Usare la Home

| Tasto | Cosa fa |
|---|---|
| Frecce | Si muovono tra i riquadri. La fila scelta resta sempre alla stessa altezza, è il resto che scorre |
| OK | Apre l'app, il tuo sito o il browser; su *Continua a guardare* riprende il video da dove eri |
| **OK tenuto premuto** (o **Giallo**) | Menu del riquadro: *Aggiungi/Togli dai preferiti*, *Sposta*, *Nascondi questa app*, *Rinomina* (le app: lasciando il nome vuoto torna quello dell'app); sul tuo sito e sui siti aggiunti anche *Cambia link* e *Cambia nome* (e sui siti aggiunti *Blocco della pubblicità* e *Togli questo sito*); su *Continua a guardare* vedi sotto |
| **+** (l'ultimo riquadro dei preferiti) | Aggiungi: *Un sito come app* (indirizzo, nome e blocco della pubblicità, normale o completo; quanti ne vuoi, ognuno col suo link), *Un preferito del browser* (diventa un riquadro), *Un'app del TV nei preferiti*, *Un'app dallo Store*, *Un'app da un indirizzo* |
| Blu | Impostazioni (oppure vai **su** fino all'ingranaggio e premi OK: serve sui telecomandi senza tasti colorati) |
| Indietro | Torna al primo riquadro in alto |

I **siti aggiunti col +** sono copie del riquadro del tuo sito: si aprono, si spostano e si rinominano allo stesso modo. Quando ne aggiungi uno scegli il **blocco della pubblicità**:

- **Normale (come il browser)**: la pubblicità sparisce e tutti i link funzionano. Va bene per quasi tutti i siti.
- **Completo (come il tuo sito)**: in più ogni link verso un altro sito viene bloccato e dalle pagine esterne si torna indietro da soli. Per i siti pieni di pubblicità che aprono altre pagine.

Si cambia quando vuoi: **OK tenuto premuto** sul riquadro → *Blocco della pubblicità*. Il titolo grande della home dice quale blocco ha il sito scelto. Dal tuo sito ai siti aggiunti ci vai sempre senza blocchi.

**Spostare un preferito**: menu → *Sposta* → **sinistra/destra** → **OK** per fermarlo. L'ordine resta salvato.

I tasti colorati sul telecomando SolarCell compaiono premendo **123** (una o due volte).

### Lo Store e Le mie app

Il riquadro **Store** (in fondo ai preferiti, prima del **+**) apre le **app per Home TV**: piccole app fatte apposta per il
TV, gratuite, che si usano col telecomando. Lo Store è fatto come la home: in alto l'app scelta in grande, con la sua
icona e la luce del suo colore; sotto le file **In evidenza**, **Aggiornamenti**, **Le tue app**, una per categoria e
**Le mie app**.

| Cosa | Come |
| --- | --- |
| **Cercare** | **Su** dalla prima fila → **Cerca**, **OK** e scrivi un nome, un tipo di app (*giochi*, *strumenti*) o un autore. Mentre scrivi, la finestra dice già quante app trova. **Indietro** torna a tutte le file. Si può cercare anche scrivendo dal telefono |
| **Vedere un'app** | **OK** sul suo riquadro: la sua pagina, con descrizione, versione, novità e i pulsanti |
| **Installare** | Nella sua pagina, *Installa*. Va nei **Preferiti** (una volta sola: se la togli non torna) e tra le app, nella sua categoria. Nello Store le installate hanno un segno bianco |
| **Aprire** | *Apri* nella sua pagina, oppure **OK** sul suo riquadro nella home. L'app gira chiusa nel suo riquadro: non vede le tue scelte e i tuoi dati |
| **Uscire** | **Indietro** (sempre, anche se l'app si blocca) o **Verde**. **Blu** o **OK tenuto premuto**: il menu dell'app (*Ricarica*, *Esci*) |
| **Aggiornamenti** | Le app si aggiornano da sole. Quando c'è una versione nuova compare un **pallino** sul riquadro e la fila **Aggiornamenti** nello Store; aprendola leggi le novità |
| **Disinstallare** | *Disinstalla* nella sua pagina, oppure **OK tenuto premuto** sul riquadro nella home (i suoi dati su questo TV si cancellano) |
| **Senza internet** | Le app installate restano; lo Store mostra la copia salvata del catalogo e lo dice. Se non l'ha mai scaricato, in cima c'è **Riprova** |

**Le mie app** sono le app che aggiungi tu, da un indirizzo qualsiasi: nello Store, fila *Le mie app* → *Aggiungi*;
oppure **+** → *Un'app da un indirizzo*, o *Impostazioni* → *Le mie app* → *Aggiungi un indirizzo*.
- Va bene `utente/repository` di GitHub, oppure un indirizzo **https** qualsiasi. Puoi anche incollarlo dal telefono.
- Prima di aggiungerla la home ti avvisa: **è codice non verificato**. Le app di quella fonte girano chiuse nel loro
  riquadro, ma possono mostrarti qualsiasi cosa e usare internet: aggiungi solo fonti di cui ti fidi.
- Le sue app vanno nella fila **Le mie app**, solo su questo TV: non arrivano mai nello Store né su altri TV. Hanno
  l'iniziale colorata al posto dell'icona: Home TV non scarica immagini da siti che non conosce.
- Se l'indirizzo è un sito normale, la home te lo aggiunge come sito, come col **+**.

Le app installate e le fonti private stanno nella memoria del TV, con una copia nel servizio del TV: se TizenBrew viene
reinstallato, tornano da sole.

**Lo Store sul telefono.** Nel telecomando del telefono, il pulsante con la **borsa** in alto apre lo Store, fatto come
quello del TV.

| Sul telefono | Cosa fa |
| --- | --- |
| **Le file** | *In evidenza* con le copertine, *Le tue app*, una fila per categoria e *Le mie app*, con gli stessi colori del TV |
| **Cerca** | La casella in alto: nome, tipo di app o autore |
| **La pagina dell'app** | Tocca un'app: copertina, descrizione, novità e il pulsante grande **Installa sul TV** (poi **Apri sul TV** e **Disinstalla**, che chiede un secondo tocco) |
| **Aggiungere un'app privata** | In fondo allo Store: incolli l'indirizzo, leggi l'avviso del codice non verificato, poi *Aggiungi lo stesso* |

Lo fa sempre il TV, con gli stessi controlli del telecomando: il telefono mostra quello che vede il TV. Se sul TV c'è un
sito o un'altra app, installare e disinstallare si fanno appena torni alla home; *Apri sul TV* ci porta subito.

### Continua a guardare

Sotto i preferiti c'è la fila **Continua a guardare**: i film e le serie che hai lasciato a metà, l'ultimo per primo (al massimo 10). Ogni scheda ha l'immagine che il sito mostra per quel film o quella serie, sopra il nome **stagione e puntata** scritte per esteso (*Stagione 1 · Episodio 3*; senza stagione e puntata, il titolo della pagina o l'anno) e una barra con quanto ne hai visto. Stagione e puntata il TV le legge dove il sito le scrive: nel titolo o nell'indirizzo della pagina, nel titolo sopra il video, nella puntata evidenziata nell'elenco delle puntate (con la stagione scelta nel menu), nei dati del lettore; un sito che non le scrive da nessuna parte mostra il titolo della pagina. Finita una puntata, la scheda propone la **prossima puntata**.

- **OK** apre la pagina dove lo stavi guardando: il video parte da solo e riprende da dove eri.
- **OK tenuto premuto**: *Riprendi*, *Ricomincia dall'inizio*, *Segna come visto* (la serie passa alla puntata dopo, il film sparisce), *Rinomina*, *Togli da Continua a guardare*.
- **Una scheda sola** per ogni film o serie sullo stesso sito: la scheda segue la serie alla puntata nuova invece di raddoppiare. All'inizio ogni sito tiene la sua scheda; solo con *Riprendi anche su un altro sito* acceso (in *Impostazioni*), se riprendi la stessa serie da un altro sito, la scheda passa a quel sito. Una scheda nasce, o cambia, solo dopo un minuto che guardi davvero (saltare avanti non conta): un video aperto per sbaglio non conta, e nemmeno pubblicità e trailer (sotto i 5 minuti). Con l'opzione accesa, se un sito riprende da solo da un suo punto più indietro, la scheda tiene quello più avanti visto altrove e il TV te lo propone.
- **Su un altro sito**: è un'opzione di *Impostazioni*, *Riprendi anche su un altro sito*, spenta all'inizio. Accesa, se apri la stessa puntata (o lo stesso film) su un altro sito, sul video compare *Eri a 22:15 su AltroSito · OK per riprendere*: **OK** riprende da lì, **Indietro** no. Spenta, la proposta compare solo sullo stesso sito (per esempio la stessa puntata su un'altra pagina).
- **Mai confuso**: i titoli si riconoscono anche scritti in modo diverso (*S01E03*, *1x03*, *Stagione 1 Episodio 3*, accenti, maiuscole, parole aggiunte come «HD» o «4K», il nome del sito, numeri romani), ma nel dubbio il TV non propone niente. Un'altra puntata, un'altra stagione, il seguito (*Il Gladiatore II*), un remake o la versione estesa non si scambiano mai. Un titolo tradotto (*Money Heist* invece di *La casa di carta*) non si può riconoscere: se ti serve, **Rinomina** la scheda col nome che usa l'altro sito.
- Tutto resta sul TV, senza servizi esterni. In Impostazioni → *Continua a guardare* lo svuoti.

### Le impostazioni

| Voce | Cosa fa |
|---|---|
| **Home** → Riapri la home all'accensione | **Avvio automatico**: Sì = quando accendi il TV torna la home (ovunque fossi) e, nei siti, anche quando torni al TV dopo più di 10 minuti; No = il TV resta dove lo lasci. Vedi *Limiti* |
| Tema | Notte, Grafite, Blu notte, Nero (sinistra/destra per cambiare) |
| Luce dell'app selezionata | Quanto lo sfondo prende il colore dell'app: Vivace, Tenue, Spenta |
| Decorazioni delle feste | Accese (di base) o Spente. Nei giorni delle feste la home si addobba da sola (a Halloween: luna, zucche con le candele, ragnatele, un teschio che sbuca dalle schede); spente, la home torna leggera come sempre |
| Raggruppa le app per tipo | Sì: file per tipo. No: un'unica fila *Tutte le app* |
| Il tuo nome nel saluto | "Buonasera, Anna" |
| App nascoste / Ripristina i preferiti | Rimostra le app nascoste, rimette i preferiti di partenza |
| Continua a guardare | Quanti video ricorda; **OK** per svuotarlo (chiede conferma) |
| Riprendi anche su un altro sito | **No** all'inizio: la proposta *Eri a …* e le schede di *Continua a guardare* restano del sito dove guardi. Sì: la stessa puntata o lo stesso film si riprende anche da un altro sito, con una scheda sola |
| **Il mio sito** → Nome, Link | Il riquadro del tuo sito e il suo indirizzo. **Quando il sito cambia indirizzo, lo cambi qui** |
| Blocco pubblicità | Acceso o spento per tutti i siti |
| Blocco avanzato | **Spento** all'inizio, e va bene così quasi sempre. Acceso: toglie anche gli avvisi «disattiva l'adblock» di alcuni siti e la pubblicità che il blocco normale lascia passare. Alcuni siti lo vietano nelle loro condizioni d'uso: se accenderlo lo decidi tu |
| Liste di filtri (EasyList) | Quando il TV le ha aggiornate e quante regole ha; **OK** per scaricarle di nuovo subito |
| Schermo intero automatico | Sul tuo sito e sui siti del **+** il video va a schermo intero appena parte. Nel browser solo quando lo fai partire tu (**OK** o Play); un video che parte da solo (anteprime, autoplay) resta nella pagina, come in un browser normale |
| **Browser** → Motore di ricerca | Google (all'inizio), DuckDuckGo, Bing, Ecosia |
| Cancella la cronologia | Svuota la cronologia del browser |
| **Telefono** → Collega un telefono | Mostra il codice QR per il telecomando sul telefono (vedi sotto) |
| Telefoni collegati | Quanti sono; OK per scollegarli tutti |
| Tasti del TV dal telefono | Se il telefono può comandare tutto il TV (anche Netflix e i menu Samsung); OK per chiedere il permesso al TV |
| **Store** → Catalogo dello Store | Quando è stato scaricato e quante app ha; **OK** per scaricarlo di nuovo subito |
| Apri lo Store | Le app per Home TV |
| **Le mie app** → Aggiungi un indirizzo | Un'app o un catalogo privato, da un indirizzo qualsiasi (prima l'avviso del codice non verificato) |
| Fonti private | Quante fonti e quante app; **OK** per aggiornarle o toglierle |
| **Questo TV** → Modello, Sistema, TizenBrew, Schermo | Chi è il tuo TV: modello e anno, versione di Tizen e del motore web, versione di TizenBrew, risoluzione |
| Servizio del TV, Home riconosciuta, App del TV, Riapertura della home, Telefono (porta 8091), Comando completo dal telefono, Tasti colorati, Liste di filtri, Salvataggio, Versione di Home TV | Cosa funziona su questo TV (✕ se manca). **OK** su una voce spiega cosa fare. Se all'accensione della home manca qualcosa di importante, la home lo dice da sola una volta |

Per scrivere si apre una finestra con la tastiera del TV; puoi anche dettare col microfono o scrivere dal telefono (col telecomando qui sotto, o con l'app **SmartThings**). **Fine** (o OK sulla tastiera) salva, **Indietro** annulla.

## Cambiare il link del sito (quando cambia indirizzo)

Il modo più comodo è dal telefono:

1. Copia il link nuovo (da Safari, da un messaggio, da dove vuoi).
2. Apri l'icona **Telecomando**, incollalo nella casella in basso e tocca **Usa come link del mio sito**.

Fatto: da quel momento il riquadro del tuo sito apre l'indirizzo nuovo. Funziona anche se sul TV in quel momento c'è Netflix o un'altra app.

In alternativa, dal TV: tasto **Blu** → **Il mio sito** → **Link** (puoi anche scriverci dal telefono: con quella finestra aperta, quello che mandi dal telefono finisce lì dentro).

**Il link resta salvato finché non lo cambi tu**: anche se spegni il TV, se salta internet o se va via la corrente. È tenuto in due copie sulla memoria del TV (quella della home e quella del servizio) e ognuna rimette a posto l'altra se si perde; il salvataggio è fatto in modo che uno stacco di corrente a metà non lo rovini. Senza internet, ovviamente, il sito non si apre, ma il link resta lì.

Si perde solo se disinstalli TizenBrew o riporti il TV alle impostazioni di fabbrica. (Se un giorno scrivessi un link anche in `config.json` su GitHub, vale l'ultima modifica fatta, da qualunque parte.)

## Cosa si vede su GitHub (privacy)

Il repository su GitHub **deve essere pubblico**: TizenBrew scarica la home attraverso jsDelivr, che legge solo i repository pubblici, e GitHub Pages su un repository privato richiede un abbonamento a pagamento (e anche così il sito resterebbe raggiungibile). Pubblico vuol dire che chi lo trova può **leggere** i file, non cambiarli: modificarli puoi solo tu.

Su GitHub c'è solo il codice della home, uguale per tutti. Le cose tue restano sul TV: il link del tuo sito (se lo metti dal telefono o dal TV), cronologia, preferiti del browser, app nascoste, nome nel saluto, telefoni collegati e *Continua a guardare*. Cose da sapere: le icone dei preferiti e delle schede del browser si chiedono al servizio di icone di Google (che così vede i nomi di quei siti); il carattere della home (Instrument Sans) si scarica da Google Fonts; le liste di filtri si scaricano dai loro siti; e i siti che apri sul TV possono leggere le impostazioni pensate per loro (il blocco della pubblicità, lo schermo intero, il link del tuo sito).

**Chi può comandare il servizio del TV.** Solo la tua home. Il servizio guarda da quale sito arriva ogni domanda, e in più vuole una **chiave segreta** che la home riceve da sola la prima volta e tiene nella sua memoria: non devi scrivere niente, mai.

| Chi prova | Cosa ottiene |
| --- | --- |
| **Un sito** aperto sul TV | Solo le cose per i siti: blocco della pubblicità, telefono, cronologia del browser |
| **Un'app dello Store** | Solo le liste di filtri: gira chiusa nel suo riquadro |
| **Un programma sul TV** che finge di essere la home | Niente, senza la chiave |

Il limite, detto chiaramente: la home riprende la chiave da sola nei primi 2 minuti dopo l'avvio del servizio (per esempio dopo aver reinstallato TizenBrew). Un programma già installato sul TV che in quei 2 minuti chiede la chiave prima della home potrebbe averla. È un caso molto difficile da costruire, e sui Samsung non c'è modo di evitarlo senza farti scrivere una password.

## Il telecomando sul telefono

È una pagina web che il **TV stesso** offre al telefono sulla rete di casa. Non gira su internet né sul Mac: basta che il TV sia acceso e che il telefono sia sulla **stessa Wi-Fi**.

**Collegarlo (una volta sola, 1 minuto):**

1. Sul TV: tasto **Blu** → **Telefono** → **Collega un telefono**. Compaiono un codice QR, un indirizzo (tipo `192.168.1.23:8091`) e un codice di 6 cifre.
2. Sull'iPhone apri la **Fotocamera**, inquadra il QR e tocca il link. Si collega da solo e sul TV la finestra si chiude. (Senza QR: scrivi l'indirizzo in Safari e poi il codice.)
3. Subito dopo il TV chiede se **consentire** a *Home TV* di collegarsi: scegli **Consenti** col telecomando. È il permesso che fa funzionare il telefono **dappertutto** (anche in Netflix) e con volume e spegnimento. Lo chiede una volta sola.
4. In Safari tocca **Condividi** → **Aggiungi alla schermata Home**. Da lì in poi è un'icona *Telecomando* come un'app, già collegata.

**Cosa fa:**

| Sul telefono | Sul TV |
|---|---|
| In alto | Dove sei sul TV (*Home*, *Browser*, il nome del sito o *Un'altra app*), aggiornato subito. A destra le **schede**, la **tastiera** (scrivere o mandare un link) e lo **spegnimento** (tieni premuto) |
| In alto **Schede** | Le schede del browser sul telefono, l'ultima per prima: toccane una e il TV la apre. **Mostra sul TV** apre la galleria delle schede sul TV, **Nuova scheda** apre il browser sul TV e la casella per scrivere qui l'indirizzo |
| **Frecce** / **Trackpad** | Scegli come comandare: la croce con OK, oppure il trackpad col puntatore (vedi sotto) |
| Croce e OK (tenendo premuta una freccia si ripete) | Come il telecomando vero, **ovunque**: home, siti, Netflix, YouTube, menu Samsung. **OK tenuto premuto** apre il menu della scheda scelta (*Apri*, *Sposta*, *Nascondi*…), come sul telecomando o col tasto destro del mouse |
| In basso **Indietro**, **Home**, **Play/pausa** | Indietro e Play/pausa come il telecomando. **Home** torna alla **tua** home, anche da Netflix e dalle altre app |
| In alto **Riproduci un video** (il TV con il triangolo) | Incolli il link di una pagina con un video (dal browser del telefono: Condividi → Copia): il TV apre la pagina e fa partire **da solo il video principale**, a schermo intero e con l'audio. Non è lo schermo del telefono: il video lo prende il TV, il telefono resta il telecomando. Banner, anteprime mute e pubblicità non partono. Lo stesso dalla tastiera in alto: incolli un link e scegli *Riproduci il video sul TV* |
| In basso **Altro** | Il **telecomando del TV**, disposto come quello vero: **Volume** a sinistra (+, muto, −; tenendo premuto si ripete), **Numeri** al centro (0-9, *Lista canali*, *Guida*), **Canali** a destra (CH +, il canale di prima, CH −); sotto **−30 s / +30 s**, poi **Menu** (= tasto Blu), **Home del TV** (la barra con le app di Samsung), **Sorgente** (HDMI, antenna), **Impostazioni TV**, **Info**, **Esci** e i **tasti colorati**. Su un telefono piccolo il pannello si scorre col dito; la **✕** in alto lo chiude. Col permesso il telefono sostituisce il telecomando in tutto, tranne l'accensione: volume, canali, numeri e i tasti del televisore vogliono il permesso del TV, e finché manca in cima al pannello c'è il pulsante **Chiedi il permesso al TV** (vedi sotto) |
| **Tastiera** in alto | Scende una casella: il testo va nel campo selezionato sul TV. Nella home e nel browser, senza un campo, diventa una ricerca; in un sito va nella sua casella di ricerca; nelle altre app va nella tastiera di Samsung, quando è aperta |
| Un link nella casella + **Apri** | Il TV apre quel sito **dentro Home TV**, come il tuo sito (frecce, blocco della pubblicità, lettore TV), anche se c'era un'altra app aperta. Non apre il browser di Samsung né le app del TV. Un sito aperto così non è trattato come una pagina esterna: resta aperto anche se prima eri sul tuo sito |
| Un link nella casella + **Usa come link del mio sito** | Il riquadro del tuo sito apre da ora quel link (resta salvato) |
| Riquadro **Sul TV si scrive qui** (compare da solo) | Appena sul TV scegli un campo dove si scrive (la ricerca di un sito, il tuo nome, un indirizzo…), sul telefono compare in alto un riquadro col nome del campo: tocca e scrivi. Quello che scrivi compare **sul TV mentre lo scrivi**; **Invio** lo conferma (per esempio fa partire la ricerca). Le **password** invece partono solo con **Invio**, mai lettera per lettera, e solo verso la pagina del campo |
| Sezione **Video sul TV** (compare da sola) | Mentre guardi un video nel lettore del TV: titolo, **barra del tempo** (tocca un punto o trascina il pallino: il video va lì), minuti passati e mancanti, **play/pausa** e salti di 10 e 30 secondi. Funziona anche col lettore dentro un riquadro di un altro sito. Tocca il titolo per chiuderla (resta una riga col tempo e play/pausa) o riaprirla. Sparisce da sola quando esci dal video |

In alto il telefono dice cosa c'è sul TV (*Home*, *Browser*, il nome del sito, o *un'altra app*), e lo aggiorna subito quando cambia.

Con un lettore di un altro sito a schermo intero (il video "incorporato"), i tasti del telefono vanno al lettore come quelli del telecomando: OK pausa, sinistra/destra avanti e indietro, Su e Giù per i pulsanti e le lingue, Indietro ferma il video e torna alla pagina.

**Il trackpad (il puntatore sul TV):**

Tocca **Trackpad** in alto: al posto della croce c'è una superficie grande e sul TV compare un puntatore, una freccia che segue il dito senza scatti.

- **Un dito** sposta il puntatore: piano per la precisione, veloce per attraversare lo schermo con un gesto solo. In basso a destra sulla superficie scegli la **velocità** (lenta, normale, veloce).
- **Un tocco lungo** (dito fermo per mezzo secondo) è il **tasto destro**: nella home e nel browser apre il menu della scheda indicata.
- **Un tocco** è un clic proprio lì: link, pulsanti, menu, i comandi dei lettori, anche dentro i riquadri di altri siti. Sopra le cose che si cliccano il puntatore si colora; passandoci sopra si aprono i menu che il sito apre "al passaggio del mouse".
- **Per scorrere** ci sono due strisce sulla superficie: quella **a destra** per su e giù, quella **in basso** per destra e sinistra. Fai scorrere il dito sulla striscia come su una rotellina (dito in giù, la pagina va in giù; dito a destra, la fila va avanti): scorre la pagina, l'elenco o la fila di film che c'è sotto il puntatore, e se lasci andare veloce continua un po' da sola. Un tocco sulle estremità di una striscia fa un passo. Le file di film (come su Netflix) scorrono da sole, senza muovere la pagina: metti il puntatore sulla fila e usa la striscia in basso.
- **Col puntatore da solo**: spingilo oltre il bordo in alto o in basso e scorre la pagina. Nei siti il bordo a destra e a sinistra non fa scorrere niente: per le file di film usa la **striscia in basso**, oppure **clicca le frecce del sito** col puntatore, come col mouse. Nella home e nel browser invece la fila va avanti da sola contro il bordo (vedi sotto).
- **Un campo dove si scrive**: toccalo col puntatore e sul telefono si apre subito la tastiera; quello che scrivi compare sul TV mentre lo scrivi, Invio conferma. Toccando fuori dal campo si smette di scrivere.
- **Indietro** è subito sotto il trackpad.
- Nel lettore TV: muovendo il puntatore compaiono i comandi, un clic sulla barra del tempo porta il video lì, un clic sul video mette in pausa o fa ripartire.
- Nella **home** e nel **browser** la scheda sotto il puntatore è quella scelta: si ingrandisce come con le frecce e il titolo grande dice cos'è; un clic la apre subito. Le strisce scorrono le file: in orizzontale quella dove sei, oppure quella che hai appena indicato col puntatore (se cambi fila con la striscia a destra, il puntatore fermo non ti riporta indietro); contro il bordo destro o sinistro la fila va avanti da sola finché il dito resta sul trackpad (prima piano, poi più svelta, anche se il dito si muove un po'): **alza il dito** (o riportalo indietro) e si ferma; se il telefono perde la Wi-Fi si ferma da sola dopo 3 secondi.
- Col telecomando vero: una **freccia** nasconde il puntatore (torna l'anello colorato, da dove hai cliccato); **OK**, mentre il puntatore si vede, clicca dove indica.
- Fermo per 20 secondi (3 sopra un video) il puntatore sparisce; torna al primo movimento, dov'era. Funziona in Home TV, nel browser e nei siti, non dentro le altre app (Netflix e simili).

**Da sapere:**

- Se al punto 3 hai scelto *Nega* (o il TV non l'ha chiesto), il telefono funziona lo stesso nella home, nel browser e nei siti, e il tasto **Home** ti riporta lì anche da Netflix. **Per dare il permesso dopo**: sul telefono apri **Altro** e tocca **Chiedi il permesso al TV** (oppure sul TV tasto **Blu** → **Telefono** → **Tasti del TV dal telefono**); sul TV compare la richiesta di *Home TV*: scegli **Consenti** col telecomando del TV, entro una trentina di secondi. Si fa una volta sola.
- Se il TV non chiede niente, ricorda il *Nega* di prima: sul TV **Impostazioni** → **Tutte le impostazioni** → **Connessione** → **Gestione dispositivi esterni** → **Gestione connessione dispositivi** → **Elenco dispositivi**, e su *Home TV* scegli **Consenti** (sui TV più vecchi *Gestione dispositivi esterni* è in **Generali**). Lì sotto, in **Notifica di accesso**, *Solo la prima volta* evita che lo chieda di nuovo.
- Nella ricerca dentro Netflix e in alcune altre app la tastiera è fatta da loro: lì il testo dal telefono non arriva, si scrive con le frecce.
- Il telefono **non accende** il TV dallo standby (a TV spento la pagina del telecomando non c'è: la offre il TV stesso). Accendilo col telecomando: la **tua home si riapre da sola** dopo qualche secondo (di solito da 3 a 10), anche se l'avevi spento dentro YouTube (*Riapri la home all'accensione*, tasto Blu → Home, la prima voce: già attiva).
- Fuori casa (in 4G) non funziona, ed è voluto: risponde solo sulla tua Wi-Fi e solo ai telefoni collegati col codice. Puoi collegarne fino a 6; da **Telefoni collegati** li scolleghi tutti.
- L'indirizzo è quello del TV sulla tua rete. Se un giorno il router gli dà un indirizzo diverso, l'icona non trova più il TV: rifai *Collega un telefono* e aggiungi di nuovo l'icona. Per evitarlo, fissa l'indirizzo del TV: **Impostazioni** → **Generali e privacy** → **Rete** → **Stato rete** → **Impostazioni IP** → *Impostazione IP*: **Inserisci manualmente** e riscrivi gli stessi valori che vedevi prima (indirizzo IP, maschera, gateway, DNS); oppure, più semplice, nel router con la "prenotazione DHCP" per il TV.

## Usare il Browser

- In alto la **barra di ricerca**: **OK** e scrivi. Un indirizzo (`meteo.it`) apre il sito, il resto diventa una ricerca.
- **Giù** porta ai **preferiti** e poi alla **cronologia** (le pagine aperte, le più recenti in alto, con l'ora).
- **Schede**: ogni pagina che apri dal browser diventa una scheda. Accanto alla ricerca il pulsante **Schede** (col numero) apre la **galleria**, come su Safari: tutte le schede in grande, con l'immagine della pagina, il titolo e il sito; **OK** ci torna, **OK tenuto premuto** → *Chiudi la scheda*, *Chiudi le altre*, *Chiudi tutte*; **Indietro** esce. Il pulsante **+** apre una scheda nuova (scrivi l'indirizzo o la ricerca, anche dal telefono). Le ultime schede sono anche nella fila *Schede aperte*. Mentre navighi la scheda segue la pagina in cui sei, e le schede restano finché non le chiudi, anche spegnendo il TV o chiudendo l'app. Dentro un sito: **Blu** → *Schede del browser* apre la galleria; dal telefono c'è il pulsante **Schede**. Sul TV c'è una finestra sola: passando da una scheda all'altra la pagina si ricarica (il punto dei video lo ricorda *Continua a guardare*).
- L'ultimo riquadro dei preferiti è **Aggiungi un sito**: scrivi l'indirizzo, poi il nome.
- **OK tenuto premuto** (o **Giallo**) su un preferito: *Sposta*, *Rinomina*, *Togli dai preferiti*. Su una pagina della cronologia: *Aggiungi ai preferiti*, *Togli dalla cronologia*, *Cancella tutta la cronologia*.
- **Indietro** (o **Verde**) torna alla home.
- I **pannelli dei siti fatti come riquadri** (per esempio quello delle app di Google, o la finestra dei cookie di alcuni siti): la selezione ci entra da sola, sia aprendoli con **OK** sia arrivandoci con le frecce; le frecce si muovono dentro e, oltre l'ultima voce, tornano alla pagina nella stessa direzione; **Indietro** esce. I riquadri con un video invece si scelgono e basta: con **OK** vanno a schermo intero.
- Nelle **caselle di testo** (per esempio la ricerca di Google): destra e sinistra muovono il cursore; all'inizio o alla fine del testo, o con la casella vuota, passano alla cosa accanto. Su e giù escono sempre. A destra e a sinistra la selezione resta sulla stessa riga (per esempio lungo la barra in alto di un sito), salvo una cosa molto più vicina.
- I siti di video che hanno una **versione per la TV** si aprono in quella, fatta per il telecomando; dal menu **Blu** puoi passare al sito per computer (e tornare indietro).

La cronologia si riempie da sola con **tutte** le pagine che apri, sia dal browser sia dal tuo sito, anche quando passi da una pagina all'altra dentro lo stesso sito. Tiene le ultime 300 pagine e fino a 60 preferiti, e resta salvata anche se spegni il TV.

## Dentro il tuo sito (e negli altri siti)

Il tuo sito si apre **come un'app**, a tutto schermo: niente barra degli indirizzi né pulsanti avanti/indietro da browser. Sul TV non servono, e il telecomando fa già tutto:

| Tasto | Cosa fa |
|---|---|
| Frecce | Spostano la selezione (un anello colorato che scivola da una cosa all'altra) tra film, menu e la ricerca in alto; se non c'è niente in quella direzione scorrono la pagina. Quello che scegli reagisce **come col mouse sopra**: la copertina si ingrandisce, compaiono i pulsanti o la casella di ricerca, come il sito fa col mouse. Nelle file di film che scorrono solo con le loro frecce (come su Netflix), dall'ultima locandina che si vede la freccia preme quella del sito e la selezione va sulla locandina che arriva; a fine fila resta sull'ultima. Tra locandine coi pulsantini (+, info) si va di locandina in locandina, a sinistra e in su come a destra e in giù (i pulsantini sopra l'immagine si usano col puntatore del telefono) |
| OK | Apre ciò che è selezionato; su un video (o sul Play del sito) fa partire il film a schermo intero |
| Indietro | Pagina precedente. Sulla prima pagina del sito chiede una seconda pressione, così non esci per sbaglio |
| Verde | Torna alla home |
| Giallo | Ricarica la pagina |
| **Blu** (o **OK tenuto premuto**) | **Pannello rapido**: aggiungi ai preferiti, pagina precedente/successiva, ricarica, home, blocco pubblicità su questo sito. Sui telecomandi senza tasti colorati tieni premuto OK per un attimo (anche dal telefono): da lì ci sono anche *Home* (il Verde) e *Ricarica* (il Giallo) |

Per cercare un film: freccia **su** fino alla ricerca del sito, **OK** e scrivi; oppure, più comodo, scrivi nella casella del **telefono** e premi Invia (il testo va da solo nella ricerca del sito).

**Tutto quello che col mouse si potrebbe cliccare si sceglie anche col telecomando**, non solo link e pulsanti: anche le voci fatte "a mano" dal sito.
- **Tendine e menu** (per esempio *Stagioni*, *Qualità*, *Lingua*): **OK** apre la tendina e la selezione ci entra subito, sulla voce già scelta. Le frecce restano dentro la tendina; **OK** sceglie, **Indietro** chiude, e in tutti e due i casi la selezione torna sul pulsante della tendina. Una tendina aperta copre quello che le sta sotto: la freccia giù va alla voce dopo, mai alle cose nascoste sotto.
- **Menu che col mouse si aprono passandoci sopra** (per esempio *Generi*): si aprono appena ci arrivi con le frecce.
- **Finestre del sito** (conferme, scelte, avvisi sui cookie): la selezione ci entra e le frecce restano lì finché non la chiudi; **Indietro** la chiude.
- **Elenchi di scelta** del sito: **OK** li apre in un elenco grande, leggibile dal divano. **Su/Giù** per scegliere, **OK** per confermare, **Indietro** per lasciare tutto com'era.
- **Caselle da spuntare** con **OK**, **cursori** (volume, ecc.) con **sinistra/destra**.
- Se il sito rifà la pagina mentre ci sei (per esempio cambi stagione e l'elenco delle puntate si ricarica), la selezione resta dov'era. Scendendo e poi risalendo torni proprio da dove eri partito.

### Quando guardi un film

Il video è quello del tuo sito (così qualità, sottotitoli e tutto il resto funzionano come li hai fatti), ma a schermo intero i comandi diventano quelli del TV, grandi e leggibili dal divano, come nelle app vere:

| Tasto | Cosa fa |
|---|---|
| OK, Play/Pausa | Pausa e ripresa (in pausa la barra resta a schermo) |
| Sinistra / Destra | −10 / +10 secondi. Premendo più volte (o tenendo premuto) vedi sulla barra dove arrivi e il film salta lì quando lasci |
| ⏪ / ⏩ | −30 / +30 secondi |
| Su | Porta sui pulsanti in basso a destra: **Episodio precedente**, **Ricomincia da capo**, **Prossimo episodio** (compaiono solo quelli che ci sono). **Sinistra/Destra** per scegliere, **OK** per usarlo, **Giù** o **Indietro** per tornare al video |
| Giù | Pannello **Audio, sottotitoli e schermo** (vedi sotto) |
| Indietro | Ferma il film ed esce dallo schermo intero |

- **Audio e sottotitoli** (tasto **Giù**): un pannello con tre colonne, che si sceglie con **sinistra/destra**, **su/giù** e **OK** (**Indietro** lo chiude).
  - **Audio**: le lingue del film, se ne ha più di una.
  - **Sottotitoli**: *Disattivati* e le lingue che ci sono.
  - **Schermo**: *Intero* (normale: il film si vede tutto, con le bande nere se la sua forma è diversa da quella del TV), *Riempi* (taglia i bordi, anche le bande nere che certi film hanno dentro di sé) e *Allarga*.

  Le lingue sono quelle del lettore del sito: la home le prende dai lettori più usati (JW Player, Video.js, hls.js, Shaka, dash.js, Bitmovin, Plyr), dai sottotitoli del video oppure dal menu del lettore stesso, come se lo usassi tu. Le scelte si **ricordano per ogni sito**: la puntata dopo parte già con la tua lingua e i tuoi sottotitoli.
- **Riprende da dove eri**: se esci a metà, la volta dopo il film riparte da lì e te lo dice (anche aprendolo da *Continua a guardare* nella home); se vuoi ricominciare, premi **Giù** in quei primi secondi, oppure in qualsiasi momento **Su** → **Ricomincia da capo** → **OK**. Se lo stesso film o la stessa puntata li avevi iniziati **su un altro sito**, compare *Eri a 22:15 su … · OK per riprendere*: **OK** riprende, **Indietro** no.
- **Serie**: negli ultimi 10 secondi di una puntata compare, grande, **Prossimo episodio tra 10, 9, 8…**, con un cerchio che si riempie. Il conto va al passo col film: se lo metti in pausa si ferma anche il conto. Finito il film parte da sola la puntata dopo. **OK** ci va subito, **Indietro** annulla e resti sul film. Se il film finisce senza il conto (per esempio dopo un salto in avanti) contano 5 secondi.
- **La puntata nuova parte davvero**: per una trentina di secondi la home controlla che il video vada, e se serve preme lei il *Play* grande del lettore del sito. Se il TV non lascia partire il video con l'audio, parte senza e lo dice: il primo tasto che premi riattiva l'audio.
- **Sempre a schermo intero davvero**: il video occupa tutto lo schermo, anche quando il sito fa partire il film da solo senza audio (l'audio torna da solo, come sul TV) e anche con i lettori fatti in modo particolare. Le anteprime mute che scorrono da sole nelle pagine restano invece al loro posto.
- **Film singoli**: alla fine si esce dal video e torni alla pagina del film.
- I comandi si nascondono da soli dopo qualche secondo e tornano appena premi un tasto.
- Tutto questo vale **anche quando il sito mette il video a schermo intero da solo** (col suo pulsante) e quando il video arriva da un **lettore incorporato da un altro sito**: i pulsanti delle puntate vengono dalla pagina del tuo sito.
- Se il sito non risponde al suo pulsante della puntata, la home prova da sola un'altra strada (l'elenco delle puntate); se non ci riesce compare un avviso con il nome del pulsante trovato, utile per farlo sistemare.

Se il video è dentro un lettore incorporato da un altro sito, la prima volta le frecce lo **selezionano** soltanto; con **OK** va a schermo intero e il telecomando passa al lettore, con **Indietro** torni alla pagina.

### Come funziona il blocco della pubblicità

Il blocco **normale** (acceso all'inizio) fa quello che fanno gli adblocker più diffusi: non carica le pubblicità, nasconde i riquadri pubblicitari senza spostare la pagina e blocca le finestre che si aprono da sole. Il blocco **avanzato** (spento all'inizio, si accende in *Impostazioni*) è per i siti che bloccano chi usa un adblock: toglie i loro avvisi «disattiva l'adblock» e la pubblicità che il blocco normale lascia passare. Alcuni siti lo vietano nelle loro condizioni d'uso: se accenderlo lo decidi tu.

**Le liste di filtri.** Per sapere cos'è pubblicità la home usa le liste della comunità, le stesse che usano gli adblocker più diffusi:

- **EasyList** (le reti pubblicitarie di tutto il mondo) ed **EasyList Italy** (i siti italiani); col blocco avanzato acceso anche la lista **contro gli anti-adblock** (i controlli dei siti che bloccano chi usa un adblock).
- Le scarica **il TV stesso** poco dopo l'accensione e poi **una volta al giorno**, e le tiene in memoria: se un giorno internet non va, restano quelle dell'ultima volta. Il lavoro pesante (sono circa 95 mila regole) lo fa una volta sola il servizio del TV; ogni sito riceve già pronto solo quello che gli serve, quindi la navigazione resta fluida.
- Bloccano i **domini pubblicitari** (anche quelli delle pubblicità che si aprono al click: la pagina viene fermata e si torna indietro da soli), nascondono i **riquadri pubblicitari** e applicano le regole scritte apposta per i singoli siti.
- **Finestre e schede nuove**: sul TV non esistono, e quelle verso un altro sito sono quasi sempre pubblicità "al click". Vengono bloccate tutte, anche quelle aperte con i trucchi (link nascosti cliccati dal codice, riquadri vuoti, link "nuova scheda" dentro il lettore incorporato). I link veri che scegli tu si aprono nella stessa pagina; sul tuo sito i link verso altri siti sono bloccati (se uno ti serve, aggiungi il suo indirizzo in `dominiConsentiti`).
- **Pannelli sopra la pagina e sopra il video**: i finti controlli «non sei un robot» che chiedono di inquadrare un codice QR, le pubblicità che uno script mette in un riquadro a tutto schermo sopra il video e gli strati trasparenti che rubano il clic si tolgono appena nascono, prima che si vedano, anche se il sito li rimette. Restano i pannelli che servono: accessi, consensi, pagamenti, i veri «non sono un robot» dei moduli. A schermo intero si vedono solo il video, i sottotitoli e i comandi della home.
- Le vedi in **Impostazioni** → *Liste di filtri*; nel pannello **Blu** di un sito c'è scritto *liste EasyList attive*. Prima del primo scaricamento (o se il TV non è mai riuscito a scaricarle) funziona lo stesso il blocco interno della home, un po' meno completo.

---

## config.json, voce per voce

Ti serve solo per le impostazioni di partenza o per cambiare qualcosa dal telefono senza essere davanti al TV.

```json
{
  "nomeSito": "Il mio sito",
  "url": "https://sito-attuale.example/",
  "preferite": ["Netflix", "Disney+", "Prime Video", "YouTube", "Apple TV", "DAZN", "RaiPlay", "Mediaset Infinity", "NOW", "Spotify"],
  "nascoste": [],
  "browser": {
    "ricerca": "https://www.google.com/search?q=",
    "preferiti": [ { "nome": "Google", "url": "https://www.google.com/" } ]
  },
  "dominiConsentiti": [],
  "paroleBloccate": [],
  "selettoriExtra": [],
  "schermoInteroAutomatico": true,
  "apriHomeAllAccensione": true
}
```

- **nomeSito / url**: nome del riquadro e indirizzo del tuo sito. Meglio lasciarli così e metterli dal telefono o dal TV: così restano solo sul tuo TV. Se li scrivi qui vale **l'ultima modifica**: se cambi il link dal TV vale quello del TV; se poi lo cambi su GitHub, entro un paio di minuti vale quello nuovo di GitHub.
- **preferite**: le app in alto alla prima accensione, scritte come si chiamano sul TV. Appena le cambi dal TV valgono le scelte del TV.
- **nascoste**: app da non mostrare per niente, per esempio `["SmartThings", "Galleria"]`.
- **browser → ricerca**: motore di ricerca di partenza (dal TV lo scegli in Impostazioni).
- **browser → preferiti**: i siti con cui parte il browser la prima volta; poi li gestisci dal TV.
- **dominiConsentiti**: altri indirizzi legittimi del tuo sito (per esempio quello del lettore video), da non trattare mai come pubblicità.
- **paroleBloccate**: pezzi di indirizzo pubblicitari da bloccare in più, se qualcosa sfugge.
- **selettoriExtra**: elementi della pagina da nascondere (selettori CSS), per esempio `[".banner-sopra"]`.
- **schermoInteroAutomatico**, **apriHomeAllAccensione**: come le voci omonime delle impostazioni.
- **listeFiltri** (facoltativo, di solito non serve): le liste di filtri da usare al posto di quelle predefinite, per esempio `[{ "nome": "EasyList", "url": "https://easylist-downloads.adblockplus.org/easylist.txt" }]`. Se manca, il TV usa EasyList ed EasyList Italy; col blocco avanzato acceso aggiunge la lista contro gli anti-adblock.

Rispetta virgolette e virgole come nell'esempio: un errore in `config.json` fa usare al TV l'ultima versione buona.

---

## Limiti, detti chiaramente

- **Prossimo e precedente episodio**: la home li riconosce dai pulsanti o link della pagina, scritti in tanti modi (*Prossimo episodio*, *Prossima puntata*, *Episodio successivo*, *Ep. successivo*, *Vai al prossimo*, *Episodio precedente*, *Puntata precedente*, *Next/Previous episode*, *Traccia successiva*… anche in spagnolo, francese e tedesco, e nei nomi interni dei pulsanti come `next-episode` o `btnNextTrack`). Se non ci sono pulsanti, guarda l'**elenco delle puntate** (quella in corso è evidenziata: prende quella prima e quella dopo) e poi i **numeri** (sulla pagina dell'*Episodio 2* cerca i link *Episodio 3* ed *Episodio 1*). I pulsanti compaiono **solo se la puntata esiste davvero**; se non la trova, alla fine della puntata torni semplicemente alla pagina.
- **Audio e sottotitoli**: nel pannello (tasto Giù) ci sono le lingue che il lettore del sito offre davvero. Se un lettore fatto in modo insolito non le lascia leggere, le cambi dal suo menu come prima.

- **Il tasto Home del telecomando non si può cambiare.** Samsung non lo lascia a nessuna app: apre sempre la barra di Samsung. Con TizenBrew al primo posto (Fase F) bastano **Home → OK**.
- **Riapertura all'accensione**: Samsung non avvisa le app quando il TV si accende. Il servizio della home controlla lo stato del TV ogni pochi secondi e, quando passa da standby ad acceso, riapre TizenBrew (e quindi la home) dopo qualche secondo (di solito da 3 a 10). Due conseguenze:
  - se accendi il TV premendo direttamente il tasto Netflix del telecomando, dopo un attimo torna la home. Se ti dà fastidio spegni *Riapri la home all'accensione* nelle impostazioni;
  - dopo che il TV è stato **staccato dalla corrente**, il servizio non gira finché TizenBrew non si apre una volta. Ci pensa *Esecuzione automatica ultima app* se l'ultima app era TizenBrew, altrimenti aprilo tu una volta.
- **Netflix, Disney+ e le altre app** si aprono nella loro versione vera, a tutto schermo, e lì dentro il blocco pubblicità di questa home non arriva (è il loro programma, non una pagina web). Quando le chiudi torni dove Samsung decide; con **Home → OK** sei di nuovo nella home.
- **Siti che cambiano pubblicità o controlli**: le liste vengono aggiornate ogni giorno dalla comunità, ma un sito può inventarsi qualcosa di nuovo prima che le liste lo conoscano. Se un sito ti blocca ancora: tasto **Blu** → *Blocco pubblicità su questo sito* → Spento, oppure aggiungi parole e selettori in `config.json`.
- **OK tenuto premuto**: funziona se il telecomando manda il segnale di "tasto rilasciato", come quelli Samsung (la home lo impara alla prima pressione: la primissima volta OK agisce subito). Nella home il tasto **Giallo** fa sempre la stessa cosa; nei siti il **Blu**.

## Problemi

- **TizenBrew apre una pagina che non esiste (errore 404)**: in `package.json` il nome utente nella riga `websiteURL` non è giusto (deve essere tutto minuscolo), oppure GitHub Pages non è attivo (Fase A, punto 4).
- **La home dice "Il servizio del TV non riconosce questa pagina"**: in TizenBrew il modulo dev'essere `tuonome/tv-sito`, con lo stesso nome del repository su GitHub.
- **La home dice "Il servizio del TV non riconosce più questa pagina: riavvia il TV"**: la home ha perso la sua memoria, e con lei la chiave del servizio, mentre il servizio era acceso da più di 2 minuti. Riavvia il TV: tieni premuto il tasto di accensione del telecomando finché compare il logo Samsung. Alla riapertura la home riprende la chiave da sola, e le tue scelte tornano dalla copia sul TV.
- **La home dice "Sto collegando le app del TV…" e restano solo il tuo sito e il Browser**: il servizio non è partito. Chiudi TizenBrew e riaprilo. Se continua, controlla nelle impostazioni di TizenBrew (pulsanti tondi in alto; nel vecchio 1.x il tasto **Blu**) che in *Impostazioni di Autoavvio per i servizi* ci sia **Home**, e che *Host PC IP* sia `127.0.0.1` (Fase D). In Impostazioni → *App del TV* vedi lo stato.
- **Il sito si apre ma pubblicità, schermo intero e cronologia non funzionano**: stessa causa, *Host PC IP* deve essere `127.0.0.1`.
- **In Impostazioni le liste di filtri dicono "Non ancora scaricate"**: il TV non è riuscito a raggiungere internet (o i siti delle liste). Riprova da solo ogni mezz'ora; **OK** su quella voce riprova subito. Nel frattempo vale il blocco interno.
- **Un'app non si apre dalla home**: aprila una volta dalla barra di Samsung e riprova; se non va, nascondila (OK tenuto premuto → *Nascondi questa app*).
- **Ho nascosto un'app per sbaglio**: Impostazioni → *App nascoste* → OK.
- **Ho cambiato un file di codice su GitHub ma il TV non vede la modifica**: i file di codice arrivano al TV tramite una cache che può metterci qualche ora; `config.json` invece si aggiorna in pochi minuti. Le modifiche fatte dal TV valgono subito.
- **In "Collega un telefono" il TV dice che non è disponibile**: il TV non ha lasciato aprire la porta 8091 al servizio. Tutto il resto funziona lo stesso; per il telefono usa SmartThings.
- **Volume e tasti dentro Netflix non vanno dal telefono**: manca il permesso del TV. Sul telefono **Altro** → **Chiedi il permesso al TV** (o tasto **Blu** → **Telefono** → **Tasti del TV dal telefono** → OK), poi **Consenti** sul TV. Se il TV non chiede niente, vedi sopra (*Elenco dispositivi*). Se dice *Non disponibili su questo TV*, il tuo TV non offre quell'ingresso: il resto del telefono funziona.
- **L'icona Telecomando dice "TV non raggiungibile"**: il TV è spento, il telefono non è sulla Wi-Fi di casa, oppure il TV ha cambiato indirizzo (vedi sopra: rifai *Collega un telefono*).
- **Voglio togliere tutto**: in TizenBrew togli il modulo dal Module Manager, disinstalla TizenBrew dalle App, spegni la modalità sviluppatore (App → Impostazioni app → 12345 → Off).

## Quali TV

| TV Samsung (anno del modello: la lettera nel codice, per esempio Q80**B** = 2022) | Home TV |
|---|---|
| 2015 e 2016 (J, K) | No: TizenBrew funziona da Tizen 3.0 |
| 2017 (M, Tizen 3.0) | In parte: il tuo sito, il browser e il blocco della pubblicità sì; le app del TV, il telefono e la riapertura all'accensione no (il motore web del 2017 non lascia alla home parlare con il servizio del TV). La home lo dice. Da provare su un TV vero |
| 2018-2022 (N, R, T, A, B, Tizen 4.0-6.5) | Sì |
| 2023-2026 (C, D, F, H, Tizen 7.0-10.0) | Sì, ma TizenBrew si installa con il certificato Samsung (lo fa da solo l'installatore) e su Tizen 9 TizenBrew ha qualche problema noto nelle sue impostazioni: tienilo aggiornato |

In **Impostazioni → Questo TV** vedi cosa funziona sul tuo TV e cosa fare se manca qualcosa.

---

## Licenza e marchi

Home TV è un progetto **indipendente, gratuito e open source**, con licenza **MIT** (file `LICENSE`): puoi usarlo, cambiarlo e condividerlo liberamente. È un modulo per TizenBrew, che è software libero di altri (GPL-3.0): questo modulo non contiene e non cambia il suo codice. Il codice e le liste di altri che la home usa, con le loro licenze, sono in `TERZE-PARTI.md`.

Home TV non è affiliato, sponsorizzato né approvato da Samsung, dal progetto Tizen o da The Linux Foundation, dagli autori di TizenBrew né dai servizi e dalle app che si aprono dalla home. I nomi di app e servizi citati sono marchi dei rispettivi titolari e servono solo a dire con cosa funziona la home (Tizen è un marchio di The Linux Foundation). Come usare il blocco della pubblicità (e se accendere quello avanzato) lo decide chi usa la home, rispettando le condizioni d'uso dei siti che visita.
