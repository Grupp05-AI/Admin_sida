# Sverige Hotbildskarta

En interaktiv kartapplikation för att visualisera hotbilder och säkerhetsrapporter över Sverige.

## Funktioner

- 🗺️ **Interaktiv karta** över Sverige med Leaflet.js
- 🔴 **Hotnivå-färgkodning** (Kritisk, Hög, Medel, Låg, Info)
- 🌲 **Regionsindikatorer** med emojis (Norra, Mellersta, Västra, Södra, Gotland)
- 📍 **Marker clustering** - grupperar närliggande tips (2km radie)
- 💫 **Pulserende markörer** med threat-level färger
- 📋 **Detaljerad tipsvy** med expansion och all metadata
- 🔍 **Sök och filterfunktioner** för tips
- 📄 **Paginering** (7 tips per sida)
- 🎯 **Kartsync** - klicka på tips för att zooma på kartan

## Installation

1. Klona repot:
```bash
git clone [repo-url]
cd test2
```

2. Installera dependencies:
```bash
npm install
```

3. Skapa `.env` fil med dina Supabase-credentials:
```
SUPABASE_URL=din-supabase-url
SUPABASE_ANON_KEY=din-supabase-key
```

4. Starta servern:
```bash
node server.js
```

5. Öppna http://localhost:3000

## Teknisk stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla JavaScript + Leaflet.js
- **Database:** Supabase
- **Styling:** CSS med mörkt tema
- **Clustering:** Leaflet.markercluster

## API Endpoints

- `GET /api/tips` - Hämta tips med paginering och filter
- `GET /api/categories` - Hämta tillgängliga kategorier
- `GET /api/health` - Hälsokontroll

## Deployment

Servern kan enkelt deployeras till Heroku, Vercel, eller liknande plattformar.