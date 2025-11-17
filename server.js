// server.js (drop-in)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// --- Paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Env validation ---
const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = requiredEnv.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("❌ Saknar miljövariabler:", missing.join(", "));
  console.error("   Lägg dem i .env i projektroten och starta om.");
  process.exit(1);
}

// --- App ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Supabase client (server-side; service role) ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ---------- Geocoding (Nominatim) ----------
const placeCache = new Map();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const GEOCODE_DELAY_MS = Number(process.env.GEOCODE_DELAY_MS || 800);

async function geocodePlace(place) {
  const key = String(place || "").trim().toLowerCase();
  if (!key) return null;
  if (placeCache.has(key)) return placeCache.get(key);

  const q = `${place}, Sweden`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    q
  )}`;

  // artig paus
  await delay(GEOCODE_DELAY_MS);

  const res = await fetch(url, {
    headers: { "User-Agent": "reports-admin/1.0 (contact: admin@example.com)" },
  });
  if (!res.ok) return null;

  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const lat = parseFloat(arr[0].lat);
  const lon = parseFloat(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const out = { latitude: lat, longitude: lon };
  placeCache.set(key, out);
  return out;
}

async function ensureCoordsForRows(rows) {
  for (const r of rows || []) {
    if ((Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) || !r.place) continue;
    try {
      const geo = await geocodePlace(r.place);
      if (!geo) continue;
      await supabase.from("reports").update({
        latitude: geo.latitude,
        longitude: geo.longitude,
      }).eq("id", r.id);

      // uppdatera i svaret
      r.latitude = geo.latitude;
      r.longitude = geo.longitude;
    } catch (e) {
      console.error("[geocode] misslyckades för id", r.id, r.place, e.message);
    }
  }
}

// ---------- HEALTH ----------
app.get("/api/health", async (_req, res) => {
  try {
    // Räknar rader utan att hämta dem
    const { error, count } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true });

    if (error) throw error;

    res.json({
      ok: true,
      supabaseUrl: process.env.SUPABASE_URL,
      rows: count ?? 0,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- API: kategorier ----------
app.get("/api/categories", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("reports")
      .select("category")
      .not("category", "is", null);

    if (error) throw error;

    const names = [...new Set((data || [])
      .map(x => (x.category || "").trim())
      .filter(Boolean))].sort();

    res.json(names.map(n => ({ name: n })));
  } catch (err) {
    console.error("[/api/categories] error:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// ---------- API: tips (listning + filtrering + auto-geokod) ----------
app.get("/api/tips", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const categoriesCsv = String(req.query.categories || "").trim();
    const from = String(req.query.from || "");
    const to   = String(req.query.to   || "");

    let query = supabase
      .from("reports")
      .select(
        "id,text,place,event_time,category,threat_level,threat_reason,summary,created_at,latitude,longitude,contact,image_url",
        { count: "exact" }
      );

    if (q) {
      query = query.or([
        `text.ilike.%${q}%`,
        `summary.ilike.%${q}%`,
        `threat_reason.ilike.%${q}%`,
        `place.ilike.%${q}%`,
        `category.ilike.%${q}%`
      ].join(","));
    }

    if (categoriesCsv) {
      const list = categoriesCsv.split(",").map(s => s.trim()).filter(Boolean);
      if (list.length === 1) query = query.eq("category", list[0]);
      else query = query.in("category", list);
    }

    if (from) query = query.gte("event_time", `${from}T00:00:00Z`);
    if (to)   query = query.lte("event_time", `${to}T23:59:59.999Z`);

    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    await ensureCoordsForRows(data);

    res.json({ items: data ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    console.error("[/api/tips] error:", err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// ---------- favicon (tystar 404 i konsolen) ----------
app.get("/favicon.ico", (_req, res) => {
  // 1x1 transparent GIF
  const buf = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    "base64"
  );
  res.setHeader("Content-Type", "image/gif");
  res.send(buf);
});

// ---------- Start / statiska filer ----------
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log("✅ Server up");
  console.log("   URL:        http://localhost:" + port);
  console.log("   Supabase:   " + process.env.SUPABASE_URL);
  console.log("   Health:     http://localhost:" + port + "/api/health");
});
