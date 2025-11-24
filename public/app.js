// public/app.js

function getRegionFromCoordinates(lat, lon) {
  // Return region based on Swedish military regions
  if (!isFinite(lat) || !isFinite(lon)) return { name: 'Okänd' };
  
  // Gotland - island coordinates
  if (lat >= 56.9 && lat <= 58.0 && lon >= 18.0 && lon <= 19.5) {
    return { name: 'Gotland' };
  }
  
  // Norra - Northern Sweden (above ~60.5°N)
  if (lat >= 60.5) {
    return { name: 'Norra' };
  }
  
  // Västra - Western coast (longitude < ~12.5 and below 60.5°N)
  if (lon < 12.5 && lat < 60.5 && lat >= 55.3) {
    return { name: 'Västra' };
  }
  
  // Mellersta - Central Sweden (between Norra and Södra, east of Västra)
  if (lat >= 58.5 && lat < 60.5 && lon >= 12.5) {
    return { name: 'Mellersta' };
  }
  
  // Södra - Southern Sweden (below 58.5°N, excluding Västra region)
  if (lat < 58.5 || (lat < 60.5 && lat >= 55.3 && lon >= 12.5)) {
    return { name: 'Södra' };
  }
  
  return { name: 'Okänd' };
}

const state = {
  page: 1,
  limit: 7,
  q: "",
  from: "",
  to: "",
  cats: new Set(),
  region: "",
  threatLevel: "",
  allTips: [], // All tips from server
  tips: [], // Current page tips
  markersById: new Map(),
  expandedTipId: null,
};

const els = {
  q: document.getElementById("q"),
  from: document.getElementById("from"),
  to: document.getElementById("to"),
  cats: document.getElementById("cats"),
  regions: document.getElementById("regions"),
  threatLevels: document.getElementById("threatLevels"),
  list: document.getElementById("list"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  firstPage: document.getElementById("firstPage"),
  pageInfo: document.getElementById("pageInfo"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
};

let map, markerLayer;

init();

async function init() {
  // Mörk bakgrundskarta med begränsning för Skandinavien
  map = L.map("map", { 
    preferCanvas: true,
    minZoom: 4,
    maxBounds: [[54, 5], [72, 32]],  // Skandinaviens gränser
    maxBoundsViscosity: 1.0,  // Håller kartan inom gränserna
    zoomControl: false  // Stäng av standard zoom-kontroller
  }).setView([62, 16], 4.6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OSM & Carto',
    maxZoom: 19
  }).addTo(map);
  
  // Add zoom control to top-right corner
  L.control.zoom({
    position: 'topright'
  }).addTo(map);
  markerLayer = L.markerClusterGroup({
    maxClusterRadius: 40, // Gruppa markörer inom 40 pixlar (mindre känslig)
    disableClusteringAtZoom: 10, // Visa individuella markörer från zoomnivå 10 (tidigare än förut)
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    spiderfyOnMaxZoom: true,
    removeOutsideVisibleBounds: false
  }).addTo(map);

  await loadCategories();
  await loadTips();

  els.q.addEventListener("input", debounce(() => { state.q = els.q.value.trim(); state.page = 1; loadTips(); }, 300));
  els.from.addEventListener("change", () => { state.from = els.from.value; state.page = 1; loadTips(); });
  els.to.addEventListener("change", () => { state.to = els.to.value; state.page = 1; loadTips(); });
  els.cats.addEventListener("change", () => { 
    state.cats = els.cats.value ? new Set([els.cats.value]) : new Set();
    state.page = 1;
    loadTips();
  });
  els.regions.addEventListener("change", () => { 
    state.region = els.regions.value;
    state.page = 1;
    filterAndPaginate();
  });
  els.threatLevels.addEventListener("change", () => { 
    state.threatLevel = els.threatLevels.value;
    state.page = 1;
    filterAndPaginate();
  });
  els.prev.onclick = () => { if (state.page > 1) { state.page--; filterAndPaginate(); } };
  els.next.onclick = () => { state.page++; filterAndPaginate(); };
  els.firstPage.onclick = () => { state.page = 1; filterAndPaginate(); };
  
  // Zoom out button to show all of Sweden
  els.zoomOutBtn.onclick = () => {
    map.flyTo([62, 16], 4.6, { duration: 1.0 });
  };
}

async function loadCategories() {
  const res = await fetch("/api/categories");
  if (!res.ok) return;
  const data = await res.json(); // [{name}]
  const select = els.cats;
  
  // Keep the default option
  while (select.options.length > 1) {
    select.remove(1);
  }
  
  data.forEach(c => {
    const option = document.createElement("option");
    option.value = c.name;
    option.textContent = c.name;
    select.appendChild(option);
  });
}

async function loadTips() {
  // Load ALL tips that match server-side filters (search, category, date)
  const params = new URLSearchParams();
  params.set("limit", "10000"); // Get all matching tips
  if (state.q) params.set("q", state.q);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.cats.size) params.set("categories", Array.from(state.cats).join(","));

  const res = await fetch(`/api/tips?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(()=>({error:`HTTP ${res.status}`}));
    els.list.innerHTML = `<div style="color:#f87171">Fel: ${err.error || 'Okänt fel'}</div>`;
    return;
  }
  const payload = await res.json();

  // Store all tips from server
  state.allTips = payload.items || [];
  
  // Filter by region and paginate
  filterAndPaginate();
  
  // Always render markers with all tips (respecting client-side filters)
  renderMarkers(state.allTips);
  
  // Force map to recalculate size and bounds
  setTimeout(() => map.invalidateSize(), 100);
}

function filterAndPaginate(shouldFitBounds = true) {
  // Filter by region and threat level if selected
  let filteredTips = state.allTips;
  
  if (state.region) {
    filteredTips = filteredTips.filter(t => {
      const region = getRegionFromCoordinates(Number(t.latitude), Number(t.longitude));
      return region.name === state.region;
    });
  }
  
  if (state.threatLevel) {
    filteredTips = filteredTips.filter(t => {
      const level = (t.threat_level || '').toLowerCase().trim();
      // Normalize threat level (remove "hotbild" suffix and handle variations)
      const normalizedLevel = level.replace(/\s*hotbild\s*$/i, '').trim();
      return normalizedLevel === state.threatLevel || level === state.threatLevel;
    });
  }

  // Calculate pagination
  const totalFiltered = filteredTips.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / state.limit));
  
  // Ensure page is within bounds
  if (state.page > totalPages) {
    state.page = 1;
  }
  
  // Get tips for current page
  const startIndex = (state.page - 1) * state.limit;
  const endIndex = startIndex + state.limit;
  state.tips = filteredTips.slice(startIndex, endIndex);
  
  // Render list and update pagination UI
  renderList();
  
  // Update map to show only filtered tips
  renderMarkers(filteredTips, shouldFitBounds);
  
  els.pageInfo.textContent = `Sida ${state.page} / ${totalPages}`;
  els.prev.disabled = (state.page <= 1);
  els.next.disabled = (state.page >= totalPages);
  
  // Show "First page" button only on last page (and not if there's only 1 page)
  if (state.page >= totalPages && totalPages > 1) {
    els.firstPage.style.display = 'inline-block';
  } else {
    els.firstPage.style.display = 'none';
  }
}



function renderList() {
  els.list.innerHTML = "";
  
  if (!state.tips.length) {
    els.list.innerHTML = `<div style="color:#94a3b8">Inga tips hittades.</div>`;
    return;
  }
  
  // If a tip is expanded, show it as an overlay
  if (state.expandedTipId) {
    const expandedTip = state.tips.find(t => t.id === state.expandedTipId);
    if (expandedTip) {
      renderExpandedTip(expandedTip);
      return;
    } else {
      state.expandedTipId = null;
    }
  }
  
  state.tips.forEach(t => {
    const card = document.createElement("div");
    card.className = "card";
    const when = t.event_time ? new Date(t.event_time).toLocaleString("sv-SE", { hour12: false }) :
                 t.created_at ? new Date(t.created_at).toLocaleString("sv-SE", { hour12: false }) : "";

    const coords = (isFinite(t.latitude) && isFinite(t.longitude))
      ? `📍 ${Number(t.latitude).toFixed(4)}, ${Number(t.longitude).toFixed(4)}`
      : (t.place ? `📍 ${escapeHtml(t.place)}` : "");

    // Get region info
    const region = getRegionFromCoordinates(Number(t.latitude), Number(t.longitude));

    // Map threat level to color
    const threatClass = {
      'kritisk hotbild': 'pulse-kritisk',
      'hög hotbild': 'pulse-hog',
      'hog hotbild': 'pulse-hog',
      'medel hotbild': 'pulse-medel',
      'låg hotbild': 'pulse-lag',
      'lag hotbild': 'pulse-lag',
      'info': 'pulse-info',
      'kritisk': 'pulse-kritisk',
      'hög': 'pulse-hog',
      'hog': 'pulse-hog',
      'medel': 'pulse-medel',
      'låg': 'pulse-lag',
      'lag': 'pulse-lag'
    };
    let level = (t.threat_level || '').toLowerCase().trim();
    let colorClass = threatClass[level] || 'pulse-medel';

    const threatDot = `<span class="pulse ${colorClass}" style="display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: middle;"></span>`;

    card.innerHTML = `
      <h4>${threatDot}${escapeHtml(t.text || "(utan text)")}</h4>
      <div class="meta">
        ${when ? `<span>${when}</span>` : ""}
        ${t.category ? `<span>${escapeHtml(t.category)}</span>` : ""}
        ${coords ? `<span>${coords}</span>` : ""}
        <span style="font-weight: bold;">${region.name}</span>
      </div>
      <div>${escapeHtml((t.summary || t.threat_reason || "").slice(0, 240))}${(t.summary || t.threat_reason || "").length>240 ? "…" : ""}</div>
    `;
    card.onclick = () => {
      state.expandedTipId = t.id;
      renderList();
      
      // Zoom in on the map when clicking tip in left list
      if (isFinite(t.latitude) && isFinite(t.longitude)) {
        const lat = Number(t.latitude);
        const lon = Number(t.longitude);
        map.flyTo([lat, lon], Math.max(map.getZoom(), 10), { duration: 0.8 });
        
        // Find and open the marker popup if it exists
        const marker = state.markersById.get(t.id);
        if (marker) {
          setTimeout(() => {
            marker.openPopup();
          }, 500); // Wait for zoom animation to mostly complete
        }
      }
    };
    els.list.appendChild(card);
  });
}

function renderExpandedTip(t) {
  // Log all fields to console for debugging
  console.log('Expanded tip data:', t);
  console.log('All keys:', Object.keys(t));

  // Get region info
  const region = getRegionFromCoordinates(Number(t.latitude), Number(t.longitude));

  const expandedCard = document.createElement("div");
  expandedCard.style.cssText = `background: #0f1521; border: 1px solid #2a3548; border-radius: 12px; padding: 12px; margin-bottom: 12px; max-height: 60vh; overflow-y: auto;`;
  
  // Back button
  const backBtn = document.createElement("button");
  backBtn.className = "btn";
  backBtn.textContent = "← Stäng detaljer";
  backBtn.style.cssText = "margin-bottom: 12px; width: 100%;";
  backBtn.onclick = () => {
    state.expandedTipId = null;
    renderList();
  };
  expandedCard.appendChild(backBtn);

  // Threat level and category
  const threatClass = {
    'kritisk hotbild': 'pulse-kritisk',
    'hög hotbild': 'pulse-hog',
    'hog hotbild': 'pulse-hog',
    'medel hotbild': 'pulse-medel',
    'låg hotbild': 'pulse-lag',
    'lag hotbild': 'pulse-lag',
    'info': 'pulse-info',
    'kritisk': 'pulse-kritisk',
    'hög': 'pulse-hog',
    'hog': 'pulse-hog',
    'medel': 'pulse-medel',
    'låg': 'pulse-lag',
    'lag': 'pulse-lag'
  };
  let level = (t.threat_level || '').toLowerCase().trim();
  let colorClass = threatClass[level] || 'pulse-medel';

  const threatDot = `<span class="pulse ${colorClass}" style="display: inline-block; width: 12px; height: 12px; margin-right: 8px; vertical-align: middle;"></span>`;

  let detailsHtml = `
    <h3 style="margin: 0 0 8px; font-size: 16px; color: #e5e7eb;">${threatDot}${escapeHtml(t.text || "(utan text)")}</h3>
    <div style="margin-bottom: 12px; padding: 8px; background: rgba(59, 130, 246, 0.1); border-radius: 6px; font-size: 13px;">
      <strong style="color: #e5e7eb;">Region:</strong> <span style="font-weight: bold;">${region.name}</span>
    </div>
    <div style="font-size: 13px; line-height: 1.6;">
  `;

  // Display ALL fields from the object dynamically
  const keysToSkip = ['id']; // Skip internal fields
  const priorityFields = ['event_time', 'place', 'threat_reason', 'category', 'summary', 'text', 'contact', 'threat_level', 'created_at', 'latitude', 'longitude'];
  const shownKeys = new Set();

  // First show priority fields
  priorityFields.forEach(key => {
    if (t.hasOwnProperty(key) && t[key] !== null && t[key] !== undefined && t[key] !== '') {
      shownKeys.add(key);
      const value = t[key];
      const label = formatLabel(key);

      if (key === 'image_url' && value && value.trim()) {
        // Convert Imgur album links to direct image links
        let imageUrl = value.trim();
        if (imageUrl.includes('imgur.com/a/')) {
          const albumId = imageUrl.split('/a/')[1];
          imageUrl = `https://i.imgur.com/${albumId}.jpg`;
        } else if (imageUrl.includes('imgur.com/') && !imageUrl.includes('i.imgur.com')) {
          const imageId = imageUrl.split('imgur.com/')[1];
          imageUrl = `https://i.imgur.com/${imageId}.jpg`;
        }
        
        detailsHtml += `<div style="margin-bottom: 12px;"><strong style="color: #e5e7eb;">${label}:</strong><br/><img src="${escapeHtml(imageUrl)}" style="max-width: 100%; margin-top: 8px; border-radius: 4px;" onerror="this.style.display='none'; this.nextSibling.style.display='block';" /><div style="display:none; color:#f87171; margin-top:8px;">Bilden kunde inte laddas: ${escapeHtml(value)}</div></div>`;
      } else if (key.includes('time') && value) {
        const date = new Date(value).toLocaleString("sv-SE", { hour12: false });
        detailsHtml += `<div style="margin-bottom: 8px;"><strong style="color: #e5e7eb;">${label}:</strong> <span style="color: #94a3b8;">${escapeHtml(date)}</span></div>`;
      } else {
        detailsHtml += `<div style="margin-bottom: 8px;"><strong style="color: #e5e7eb;">${label}:</strong> <span style="color: #94a3b8;">${escapeHtml(String(value))}</span></div>`;
      }
    }
  });

  // Then show all other fields
  Object.keys(t).forEach(key => {
    if (keysToSkip.includes(key) || shownKeys.has(key)) return;
    if (t[key] === null || t[key] === undefined || t[key] === '') return;

    shownKeys.add(key);
    const value = t[key];
    const label = formatLabel(key);

    if ((key.includes('image') || key.includes('url') || key.includes('photo') || key.includes('attachment')) && value) {
      // Try to detect if it's an image URL
      if (typeof value === 'string' && value.trim() && (value.startsWith('http') || value.endsWith('.jpg') || value.endsWith('.png') || value.endsWith('.gif') || value.endsWith('.webp'))) {
        detailsHtml += `<div style="margin-bottom: 12px;"><strong style="color: #e5e7eb;">${label}:</strong><br/><img src="${escapeHtml(value)}" style="max-width: 100%; margin-top: 8px; border-radius: 4px;" onerror="this.style.display='none'; this.nextSibling.style.display='block';" /><div style="display:none; color:#f87171; margin-top:8px;">Bilden kunde inte laddas: ${escapeHtml(value)}</div></div>`;
      } else {
        detailsHtml += `<div style="margin-bottom: 8px; word-break: break-all;"><strong style="color: #e5e7eb;">${label}:</strong> <span style="color: #94a3b8;">${escapeHtml(String(value))}</span></div>`;
      }
    } else if ((key.includes('time') || key.includes('date')) && typeof value === 'string') {
      try {
        const date = new Date(value).toLocaleString("sv-SE", { hour12: false });
        detailsHtml += `<div style="margin-bottom: 8px;"><strong style="color: #e5e7eb;">${label}:</strong> <span style="color: #94a3b8;">${escapeHtml(date)}</span></div>`;
      } catch (e) {
        detailsHtml += `<div style="margin-bottom: 8px;"><strong style="color: #e5e7eb;">${label}:</strong> <span style="color: #94a3b8;">${escapeHtml(String(value))}</span></div>`;
      }
    } else if (typeof value === 'object') {
      detailsHtml += `<div style="margin-bottom: 8px;"><strong style="color: #e5e7eb;">${label}:</strong> <span style="color: #94a3b8;">${escapeHtml(JSON.stringify(value))}</span></div>`;
    } else {
      detailsHtml += `<div style="margin-bottom: 8px;"><strong style="color: #e5e7eb;">${label}:</strong> <span style="color: #94a3b8;">${escapeHtml(String(value))}</span></div>`;
    }
  });

  detailsHtml += `</div>`;

  const detailsDiv = document.createElement("div");
  detailsDiv.innerHTML = detailsHtml;
  expandedCard.appendChild(detailsDiv);

  els.list.innerHTML = "";
  els.list.appendChild(expandedCard);
}

function formatLabel(key) {
  // Mapping from database fields to Swedish categories
  const labelMap = {
    'event_time': 'Stund',
    'place': 'Ställe',
    'threat_reason': 'Styrka', // antal drönare/personer/föremål
    'category': 'Slag', // fiende/objekt/osv
    'summary': 'Sysselsättning', // verksamhet, vad som sker
    'text': 'Symbol', // märkning, färg, siffror, märken
    'contact': 'Sagesman', // den som sett/gett tips
    'threat_level': 'Hotnivå',
    'created_at': 'Rapporterad',
    'latitude': 'Latitud',
    'longitude': 'Longitud',
    'image_url': 'Bild'
  };

  return labelMap[key] || key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function renderMarkers(tipsToRender = state.allTips, shouldFitBounds = true) {
  markerLayer.clearLayers();
  state.markersById = new Map();

  // Threat level to CSS class mapping (match full values from Supabase)
  const threatClass = {
    'kritisk hotbild': 'pulse-kritisk',
    'hög hotbild': 'pulse-hog',
    'hog hotbild': 'pulse-hog',
    'medel hotbild': 'pulse-medel',
    'låg hotbild': 'pulse-lag',
    'lag hotbild': 'pulse-lag',
    'info': 'pulse-info',
    // Also match without "hotbild"
    'kritisk': 'pulse-kritisk',
    'hög': 'pulse-hog',
    'hog': 'pulse-hog',
    'medel': 'pulse-medel',
    'låg': 'pulse-lag',
    'lag': 'pulse-lag'
  };

  // Filter tips by region and threat level if selected
  let filteredTips = tipsToRender;
  
  if (state.region) {
    filteredTips = filteredTips.filter(t => {
      const region = getRegionFromCoordinates(Number(t.latitude), Number(t.longitude));
      return region.name === state.region;
    });
  }
  
  if (state.threatLevel) {
    filteredTips = filteredTips.filter(t => {
      const level = (t.threat_level || '').toLowerCase().trim();
      const normalizedLevel = level.replace(/\s*hotbild\s*$/i, '').trim();
      return normalizedLevel === state.threatLevel || level === state.threatLevel;
    });
  }

  const pts = [];
  filteredTips.forEach(t => {
    const lat = Number(t.latitude);
    const lon = Number(t.longitude);
    if (!isFinite(lat) || !isFinite(lon)) return;

    // Pick color class based on threat_level
    let level = (t.threat_level || '').toLowerCase().trim();
    let colorClass = threatClass[level] || 'pulse-medel';

    // Debug: log threat_level and colorClass
    console.log('Marker:', { id: t.id, threat_level: t.threat_level, mappedLevel: level, colorClass });

    const icon = L.divIcon({
      className: 'pulse-icon',
      html: `<span class="pulse ${colorClass}"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const marker = L.marker([lat, lon], { icon }).addTo(markerLayer);
    marker.bindPopup(`
      <div style="max-width: 250px;">
        <strong>${escapeHtml(t.text || "(utan text)")}</strong><br/>
        ${escapeHtml(t.summary || t.threat_reason || "")}<br/>
        <button onclick="focusTip(${t.id})" style="margin-top: 8px; padding: 6px 10px; background: #60a5fa; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
          → Gå till tips
        </button>
      </div>
    `);
    state.markersById.set(t.id, marker);
    pts.push([lat, lon]);
  });

  if (shouldFitBounds) {
    if (pts.length) {
      const bounds = L.latLngBounds(pts);
      map.fitBounds(bounds.pad(0.2), { animate: false });
    } else {
      map.setView([62, 16], 4.6);
    }
  }
}

function focusTip(id) {
  const m = state.markersById.get(id);
  if (!m) return;
  const ll = m.getLatLng();
  // Pan to the tip without changing zoom level
  map.panTo(ll, { duration: 0.5 });
  m.openPopup();
  
  // Find the tip in all tips
  const tip = state.allTips.find(t => t.id === id);
  if (!tip) return;
  
  // Apply current filters to find which page the tip should be on
  let filteredTips = state.allTips;
  
  if (state.region) {
    filteredTips = filteredTips.filter(t => {
      const region = getRegionFromCoordinates(Number(t.latitude), Number(t.longitude));
      return region.name === state.region;
    });
  }
  
  if (state.threatLevel) {
    filteredTips = filteredTips.filter(t => {
      const level = (t.threat_level || '').toLowerCase().trim();
      const normalizedLevel = level.replace(/\s*hotbild\s*$/i, '').trim();
      return normalizedLevel === state.threatLevel || level === state.threatLevel;
    });
  }
  
  // Find which page the tip is on
  const tipIndex = filteredTips.findIndex(t => t.id === id);
  if (tipIndex === -1) {
    // Tip not found with current filters - clear filters and try again
    state.region = "";
    state.threatLevel = "";
    els.regions.value = "";
    els.threatLevels.value = "";
    filteredTips = state.allTips;
    const newTipIndex = filteredTips.findIndex(t => t.id === id);
    if (newTipIndex !== -1) {
      state.page = Math.floor(newTipIndex / state.limit) + 1;
    } else {
      state.page = 1;
    }
  } else {
    // Calculate which page the tip is on
    state.page = Math.floor(tipIndex / state.limit) + 1;
  }
  
  // Expand the tip in the left panel
  state.expandedTipId = id;
  filterAndPaginate(false);
}

// Make focusTip globally available
window.focusTip = focusTip;



function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
function escapeHtml(str){ return String(str||"").replace(/[&<>"']/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s])); }
