# MDentic

Strona wizytówka gabinetu stomatologicznego MDentic.

Statyczna strona (HTML + CSS + JS, bez kroku budowania) z efektem WebGL:
~18 000 świecących cząsteczek rysuje liniami kolejne kształty, a przy
przewijaniu rozwiewa się i składa w następne:

| Sekcja | Kształt z cząsteczek |
| --- | --- |
| Start | ząb z warstwowych konturów + błysk |
| O gabinecie | diament z logo |
| Usługi | pole falujących linii pod kartami |
| Wizyta | napis „MDentic” |
| Kontakt | pinezka z kręgami na mapie |

Do tego: logo rysujące się liniami na starcie, napisy wysuwające się z masek,
ramki kart rysowane linią, oś czasu rosnąca ze scrollem, odpychanie cząsteczek
kursorem. Strona szanuje `prefers-reduced-motion`, a bez WebGL pokazuje
statyczne tło.

## Uruchomienie lokalne

```bash
python3 -m http.server 8080
# http://localhost:8080
```

(Moduły ES wymagają serwera, samo otwarcie pliku `index.html` nie wystarczy.)

## Publikacja na GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`.

## Co podmienić

Dane kontaktowe w sekcji `#kontakt` w `index.html` (adres, telefon, e-mail,
godziny) są **tymczasowe**. Numer telefonu występuje też w przyciskach
„Umów wizytę” (`tel:+48000000000`).

## Struktura

- `index.html` treść strony
- `css/style.css` wygląd i animacje CSS
- `js/main.js` interfejs i scena WebGL (kształty w funkcjach `*Shape`)
- `assets/` logo i favicon (SVG odtworzone z logo)
- `vendor/three.module.min.js` Three.js r160 (licencja MIT, `vendor/three.LICENSE`)
