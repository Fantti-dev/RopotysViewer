# CS2 Demo Review Tool — Täydellinen Asennusohje

## Mitä tarvitaan ennen aloittamista

| Ohjelma | Versio | Latauslinkki |
|---|---|---|
| Node.js | 20 LTS tai uudempi | https://nodejs.org |
| Python | 3.10 tai uudempi | https://www.python.org/downloads |
| SQL Server Express | 2019 tai 2022 | https://www.microsoft.com/en-us/sql-server/sql-server-downloads |
| SQL Server Management Studio (SSMS) | Uusin | https://aka.ms/ssmsfullsetup |
| Git | Uusin | https://git-scm.com |

---

## VAIHE 1: SQL Server asennus

### 1.1 Lataa ja asenna SQL Server Express

1. Mene: https://www.microsoft.com/en-us/sql-server/sql-server-downloads
2. Klikkaa **"Download now"** kohdassa **Express** (ilmainen versio)
3. Käynnistä asennus → valitse **"Basic"** asennustyyppi
4. Hyväksy lisenssi → klikkaa **Install**
5. Odota asennuksen valmistumista
6. **TÄRKEÄÄ:** Asennuksen lopussa näkyy **Connection String** — tallenna se muistiin!
   - Se näyttää tältä: `Server=localhost\SQLEXPRESS;...`

### 1.2 Asenna SQL Server Management Studio (SSMS)

1. Mene: https://aka.ms/ssmsfullsetup
2. Lataa ja asenna SSMS
3. Käynnistä SSMS asennuksen jälkeen

### 1.3 Yhdistä SQL Serveriin SSMS:llä

1. Avaa SSMS
2. Kirjautumisikkuna aukeaa automaattisesti
3. Täytä kentät:
   - **Server name:** `localhost\SQLEXPRESS`  
     *(jos ei toimi, kokeile vain `localhost` tai `.`)*
   - **Authentication:** `Windows Authentication`
   - *(Ei tarvitse käyttäjätunnusta/salasanaa — Windows-tilisi riittää)*
4. Klikkaa **Connect**
5. Vasemmalla näkyy **Object Explorer** — olet nyt yhdistetty ✅

### 1.4 Luo tietokanta ja taulut

1. SSMS:ssä klikkaa yläpalkissa **"New Query"**
2. Avaa Resurssienhallinnassa projektin kansio
3. Etsi tiedosto: `scripts/setup_database.sql`
4. Kopioi sen koko sisältö ja liitä SSMS:n kyselyikkunaan
5. Klikkaa **"Execute"** (F5)
6. Alarivissä näkyy viestejä:
   ```
   ✅ Tietokanta cs2demos luotu
   ✅ Taulu demos luotu
   ... (kaikki taulut)
   ✅ KAIKKI TAULUT LUOTU ONNISTUNEESTI!
   ```
7. Vasemmalla Object Explorerissa, päivitä (F5) → näet **cs2demos** tietokannan

> **Ongelma?** Jos saat virheen "Login failed", katso Vianetsintä-osio alla.

---

## VAIHE 2: Python-ympäristö

Avaa **komentokehote** (cmd) tai **PowerShell** projektin juurikansiossa.

```cmd
# Siirry projektin python-kansioon
cd cs2-review-tool\python

# Luo virtuaaliympäristö (eristetty Python-ympäristö)
python -m venv venv

# Aktivoi virtuaaliympäristö (Windows)
venv\Scripts\activate

# Asenna tarvittavat kirjastot
pip install -r requirements.txt
```

Onnistuneen asennuksen jälkeen näet esim.:
```
Successfully installed demoparser2-4.x.x pyodbc-4.x.x pandas-2.x.x
```

### 2.1 Testaa yhteys SQL Serveriin

```cmd
python -c "import pyodbc; conn = pyodbc.connect('DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=cs2demos;Trusted_Connection=yes;TrustServerCertificate=yes;'); print('✅ Yhteys toimii!')"
```

Jos tulee virhe `Data source name not found`:
- Asenna ODBC Driver 17: https://aka.ms/downloadmsodbcsql

### 2.2 Testaa parseri käsin (valinnainen)

```cmd
# Aktivoi venv ensin (venv\Scripts\activate)
python parser.py "C:\polku\matsi.dem"
```

Pitäisi tulostaa:
```
[1/9] Avataan demo: matsi.dem
[2/9] Parsitaan metadata...
    Demo ID: 1, Kartta: de_mirage, Tickrate: 64
[3/9] Parsitaan pelaajat...
...
✅ Valmis! Demo ID: 1
```

---

## VAIHE 3: Node.js ja Electron

```cmd
# Palaa projektin juureen
cd cs2-review-tool

# Asenna kaikki Node.js-paketit
npm install
```

> Tämä kestää 1-3 minuuttia. Asentaa Electronin, Reactin, Pixi.js:n ym.

---

## VAIHE 4: Karttakuvat

Jokaisesta kartasta tarvitaan radar-kuva PNG-formaatissa.

### Vaihtoehto A: Lataa valmiit kuvat (SUOSITELTU)

Lataa kaikki karttakuvat yhdestä paikasta:
https://totalcsgo.com/radar

Tai yksitellen:
- `de_dust2.png`
- `de_mirage.png`  
- `de_inferno.png`
- `de_nuke_upper.png` + `de_nuke_lower.png`
- `de_ancient.png`
- `de_anubis.png`
- `de_vertigo_upper.png` + `de_vertigo_lower.png`
- `de_train.png`
- `de_overpass_upper.png` + `de_overpass_lower.png`
- `de_cache.png`

**Laita kuvat kansioon:** `cs2-review-tool/maps/`

### Vaihtoehto B: Ota suoraan CS2:sta

Jos CS2 on asennettuna, kuvat löytyvät polusta:
```
C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\resource\overviews\
```
Kopioi `de_*.png` tiedostot projektin `maps/`-kansioon.

---

## VAIHE 5: Käynnistä sovellus

```cmd
# Projektin juuressa
npm run dev
```

Electron-ikkuna aukeaa muutaman sekunnin kuluttua.

---

## VAIHE 6: Käyttö

1. Sovellus avautuu → klikkaa **"Avaa Demo"**
2. Valitse `.dem`-tiedosto
3. Parsinta alkaa → edistyminen näkyy ruudulla (kestää 10s–2min demon koosta riippuen)
4. Kun valmis → demo ilmestyy listaan vasemmalle
5. Klikkaa demoa → valitse round → paina Play ▶

---

## Vianetsintä

### "Login failed for user" SQL Serverissä
```
Ratkaisu:
1. Avaa SQL Server Configuration Manager
2. SQL Server Services → SQL Server (SQLEXPRESS) → käynnissä?
3. Jos ei, klikkaa hiiren oikealla → Start
```

### "ODBC Driver 17 not found"
```
Lataa: https://aka.ms/downloadmsodbcsql
Asenna ja yritä uudelleen.
```

### "demoparser2 not found" tai "No module named"
```cmd
cd python
venv\Scripts\activate      ← Muista aktivoida venv!
pip install demoparser2
```

### Electron ei käynnisty / valkoinen ruutu
```cmd
npm run dev
# Katso terminaalin virheilmoitukset
# Yleensä puuttuvat node_modules → npm install
```

### Parser kaatuu kesken parsimisen
```
- Tarkista että SQL Server on käynnissä
- Tarkista CONN_STRING tiedostossa python/parser.py
- SERVER=localhost toimii jos SQL Server Express asennettiin oletuksilla
- Jos ei toimi, kokeile SERVER=localhost\SQLEXPRESS
```

---

## Tiedostorakenne lyhyesti

```
cs2-review-tool/
├── electron/          ← Electron main + IPC
├── src/               ← React UI
├── python/            ← .dem parseri
│   └── venv/          ← Python virtuaaliympäristö (automaattisesti luotu)
├── maps/              ← Karttakuvat (lisää itse!)
├── scripts/
│   └── setup_database.sql  ← Aja SSMS:ssä kerran
└── package.json
```
