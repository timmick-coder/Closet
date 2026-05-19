// ai.js — StyleSync KI-Features (Gemini + @imgly/background-removal)

// ── API Keys ──────────────────────────────────────────────────────────────────
function getGeminiKey() {
  return (window.__ENV && window.__ENV.EXPO_PUBLIC_GEMINI_API_KEY) || '';
}

// ── Bild komprimieren (max 1024px, JPEG 0.82) ─────────────────────────────────
function _compressImage(base64, mimeType) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var maxSize = 1600; // Höhere Auflösung für bessere KI-Erkennung
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (w <= maxSize && h <= maxSize) {
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve({ base64: c.toDataURL('image/jpeg', 0.92).split(',')[1], mimeType: 'image/jpeg' });
        return;
      }
      var scale = Math.min(maxSize / w, maxSize / h);
      var c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve({ base64: c.toDataURL('image/jpeg', 0.92).split(',')[1], mimeType: 'image/jpeg' });
    };
    img.onerror = function() { resolve({ base64: base64, mimeType: mimeType }); };
    img.src = 'data:' + mimeType + ';base64,' + base64;
  });
}

// ── Garderobe (LocalStorage) ──────────────────────────────────────────────────
function loadWardrobe() {
  try { return JSON.parse(localStorage.getItem('stylesync_wardrobe') || '[]'); }
  catch { return []; }
}
function saveWardrobe(items) {
  localStorage.setItem('stylesync_wardrobe', JSON.stringify(items));
}
function addToWardrobe(item) {
  var items = loadWardrobe();
  items.unshift(item);
  saveWardrobe(items);
}

// ── Gemini: Kleidungsstück analysieren ───────────────────────────────────────
async function _callGeminiAPI(body) {
  const key = getGeminiKey();
  // Lokal: direkt mit Key aufrufen
  if (key && key !== 'your_gemini_api_key_here') {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error?.message || 'Gemini Fehler: ' + res.status);
    }
    return res.json();
  }
  // Produktion: über Vercel Proxy aufrufen (Key bleibt sicher auf Server)
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: body, model: 'gemini-2.5-flash' })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error || 'Gemini Proxy Fehler: ' + res.status);
  }
  return res.json();
}

async function analyzeClothingWithGemini(base64, mimeType) {
  const prompt = 'Du bist ein Mode-Experte. Analysiere das Kleidungsstück auf diesem Bild und antworte NUR mit einem validen JSON-Objekt (kein Markdown, keine Erklärung, kein Text außerhalb des JSON):\n{\n  "name": "Name des Kleidungsstücks auf Deutsch",\n  "brand": "Marke falls erkennbar, sonst leerer String",\n  "type": "Kategorie auf Deutsch (z.B. Top, Hose, Kleid, Schuh, Accessoire, Jacke)",\n  "color": "Hauptfarbe auf Deutsch",\n  "colorHex": "Hex-Farbcode der Hauptfarbe",\n  "season": "Saison auf Deutsch (Sommer | Winter | Frühling | Ganzjährig)",\n  "seasonClass": "s-sommer | s-winter | s-fruhjahr | s-ganzjahrig",\n  "style": "Stil auf Deutsch (z.B. Casual, Business, Sportlich, Elegant)",\n  "emoji": "Ein einzelnes passendes Emoji"\n}';
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }]
  };
  const data = await _callGeminiAPI(body);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(jsonStr); }
  catch { throw new Error('KI hat keine verwertbare Antwort geliefert. Bitte erneut versuchen.'); }
}

// ── @imgly/background-removal: Hintergrund entfernen (kostenlos, im Browser) ──
var _rembgModule = null;
var _rembgModelLoaded = false;
var _REMBG_CDN = 'https://esm.sh/@imgly/background-removal';

async function _loadRembgModule() {
  if (!_rembgModule) {
    _rembgModule = await import(_REMBG_CDN);
  }
  return _rembgModule;
}

async function removeBackground(base64, mimeType) {
  try {
    // Beim ersten Aufruf lädt das Modell (~40 MB, wird vom Browser gecacht)
    if (!_rembgModelLoaded) {
      showScanOverlay('loading', { text: '⏳ KI-Modell wird geladen… (nur einmalig, ~40 MB)' });
    } else {
      showScanOverlay('loading', { text: '✂️ Hintergrund wird entfernt…' });
    }

    var lib = await _loadRembgModule();

    // base64 → Blob
    var byteStr = atob(base64);
    var bytes = new Uint8Array(byteStr.length);
    for (var i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    var inputBlob = new Blob([bytes], { type: mimeType || 'image/jpeg' });

    // Hintergrund entfernen — Library holt Modell-Dateien selbst von ihrem CDN
    var resultBlob = await lib.removeBackground(inputBlob);

    _rembgModelLoaded = true;

    // Blob → data URL
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function(e) { resolve(e.target.result); };
      reader.readAsDataURL(resultBlob);
    });
  } catch (e) {
    console.error('[rembg] Fehler:', e.message, e);
    var errMsg = (e && e.message) ? e.message.slice(0, 80) : 'Unbekannter Fehler';
    showScanOverlay('loading', { text: '⚠️ rembg Fehler: ' + errMsg });
    await new Promise(function(r) { setTimeout(r, 2500); });
    return 'data:' + (mimeType || 'image/jpeg') + ';base64,' + base64;
  }
}

// ── Gemini: Outfits generieren ────────────────────────────────────────────────
async function generateOutfitsWithGemini(description, inspoContext, inspoImageBase64, inspoImageMime) {
  const staticItems = [
    { name: 'Weißes T-Shirt', type: 'Top', emoji: '👕', color: 'Weiß', season: 'Sommer' },
    { name: 'Jeans', type: 'Hose', emoji: '👖', color: 'Blau', season: 'Ganzjährig' },
    { name: 'Sneaker', type: 'Schuh', emoji: '👟', color: 'Weiß', season: 'Ganzjährig' },
    { name: 'Sommerkleid', type: 'Kleid', emoji: '👗', color: 'Rosa', season: 'Sommer' },
    { name: 'Lederjacke', type: 'Jacke', emoji: '🧥', color: 'Schwarz', season: 'Winter' },
    { name: 'Chino-Hose', type: 'Hose', emoji: '👖', color: 'Beige', season: 'Sommer' },
    { name: 'Stiefel', type: 'Schuh', emoji: '👢', color: 'Braun', season: 'Winter' },
    { name: 'Sonnenbrille', type: 'Accessoire', emoji: '🕶️', color: 'Schwarz', season: 'Sommer' },
    { name: 'Strickpullover', type: 'Top', emoji: '🧶', color: 'Grau', season: 'Winter' },
    { name: 'Jogginghose', type: 'Hose', emoji: '👖', color: 'Schwarz', season: 'Ganzjährig' },
    { name: 'Sandalen', type: 'Schuh', emoji: '🩴', color: 'Braun', season: 'Sommer' },
    { name: 'Schal', type: 'Accessoire', emoji: '🧣', color: 'Rot', season: 'Winter' },
  ];
  const saved = loadWardrobe().map(function(w) { return { name: w.name, type: w.type, emoji: w.emoji, color: w.color, season: w.season }; });
  const allItems = saved.concat(staticItems);
  const wardrobeText = allItems.map(function(it, i) {
    return (i + 1) + '. ' + it.emoji + ' ' + it.name + ' (' + it.type + ', ' + it.color + ', ' + it.season + ')';
  }).join('\n');
  const prompt = 'Du bist ein professioneller Mode-Stylist. Erstelle genau 3 komplette Outfit-Vorschlaege ausschliesslich aus den folgenden Kleidungsstuecken.\n\nSCHRANK DES NUTZERS:\n' + wardrobeText + '\n\nWUNSCH: ' + (description || 'Ein stylisches, passendes Outfit') + (inspoContext ? '\nINSPIRATION: ' + inspoContext : '') + (inspoImageBase64 ? '\n\nNutze das hochgeladene Bild als Stil-Inspiration.' : '') + '\n\nAntworte NUR mit einem validen JSON-Array (kein Text, kein Markdown):\n[\n  {\n    "name": "Outfit-Name auf Deutsch",\n    "style": "Stil-Kategorie auf Deutsch",\n    "match": 90,\n    "items": [{"emoji":"👕","name":"Artikelname"}],\n    "weather": "Wetterbeschreibung mit Temperatur auf Deutsch"\n  }\n]';
  const parts = [{ text: prompt }];
  if (inspoImageBase64 && inspoImageMime) parts.push({ inline_data: { mime_type: inspoImageMime, data: inspoImageBase64 } });
  const body = { contents: [{ parts: parts }] };
  const data = await _callGeminiAPI(body);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(jsonStr); }
  catch { throw new Error('KI hat keine verwertbaren Outfits geliefert. Bitte erneut versuchen.'); }
}

// ── Crop Screen ───────────────────────────────────────────────────────────────
var _cropState = null;
var _cropDragState = null;
var _cropMoveListenersAdded = false;

function _openCropScreen(imageDataUrl, mimeType) {
  _cropState = {
    imageDataUrl: imageDataUrl,
    mimeType: mimeType || 'image/jpeg',
    rotation: 0,
    mirrored: false,
    cropRect: null
  };
  var screen = document.getElementById('crop-screen');
  if (screen) screen.classList.add('active');
  // Wait for DOM to render before sizing canvas
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      _initCropCanvas();
    });
  });
}

function _closeCropScreen() {
  var screen = document.getElementById('crop-screen');
  if (screen) screen.classList.remove('active');
  _cropDragState = null;
}

function _initCropCanvas() {
  if (!_cropState) return;
  var img = new Image();
  img.onload = function() {
    _cropState.img = img;
    _cropDrawAll();
    _initCropDrag();
  };
  img.src = _cropState.imageDataUrl;
}

function _cropSizeCanvas() {
  var canvas = document.getElementById('crop-canvas');
  var wrap = document.getElementById('crop-canvas-wrap');
  if (!canvas || !wrap || !_cropState || !_cropState.img) return;
  var img = _cropState.img;
  var rot = _cropState.rotation;
  var isRotated = rot % 180 !== 0;
  var imgW = isRotated ? img.naturalHeight : img.naturalWidth;
  var imgH = isRotated ? img.naturalWidth : img.naturalHeight;
  var maxW = wrap.clientWidth - 20;
  var maxH = wrap.clientHeight - 20;
  var scale = Math.min(maxW / imgW, maxH / imgH, 1);
  canvas.width = Math.round(imgW * scale);
  canvas.height = Math.round(imgH * scale);
  _cropState.dispScale = scale;
}

function _cropDrawAll() {
  var canvas = document.getElementById('crop-canvas');
  if (!canvas || !_cropState || !_cropState.img) return;
  _cropSizeCanvas();
  var ctx = canvas.getContext('2d');
  var cw = canvas.width;
  var ch = canvas.height;
  var img = _cropState.img;
  var rot = _cropState.rotation;
  var isRotated = rot % 180 !== 0;

  ctx.clearRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rot * Math.PI / 180);
  if (_cropState.mirrored) ctx.scale(-1, 1);
  var dw = isRotated ? ch : cw;
  var dh = isRotated ? cw : ch;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // Init crop rect
  if (!_cropState.cropRect) {
    var pad = Math.round(Math.min(cw, ch) * 0.08);
    _cropState.cropRect = { x: pad, y: pad, w: cw - pad * 2, h: ch - pad * 2 };
  }
  var cr = _cropState.cropRect;

  // Dark overlay outside crop rect
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, cw, cr.y);
  ctx.fillRect(0, cr.y + cr.h, cw, ch - cr.y - cr.h);
  ctx.fillRect(0, cr.y, cr.x, cr.h);
  ctx.fillRect(cr.x + cr.w, cr.y, cw - cr.x - cr.w, cr.h);

  // Crop border
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);

  // Rule of thirds grid
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cr.x + cr.w / 3, cr.y); ctx.lineTo(cr.x + cr.w / 3, cr.y + cr.h);
  ctx.moveTo(cr.x + cr.w * 2 / 3, cr.y); ctx.lineTo(cr.x + cr.w * 2 / 3, cr.y + cr.h);
  ctx.moveTo(cr.x, cr.y + cr.h / 3); ctx.lineTo(cr.x + cr.w, cr.y + cr.h / 3);
  ctx.moveTo(cr.x, cr.y + cr.h * 2 / 3); ctx.lineTo(cr.x + cr.w, cr.y + cr.h * 2 / 3);
  ctx.stroke();

  // Corner handles
  var hs = 12;
  ctx.fillStyle = 'white';
  [[cr.x, cr.y], [cr.x + cr.w, cr.y], [cr.x, cr.y + cr.h], [cr.x + cr.w, cr.y + cr.h]].forEach(function(c) {
    ctx.fillRect(c[0] - hs / 2, c[1] - hs / 2, hs, hs);
  });

  // Corner L-shapes (stylistic)
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  var ls = 18;
  [[cr.x, cr.y, 1, 1], [cr.x + cr.w, cr.y, -1, 1], [cr.x, cr.y + cr.h, 1, -1], [cr.x + cr.w, cr.y + cr.h, -1, -1]].forEach(function(c) {
    ctx.beginPath();
    ctx.moveTo(c[0] + c[2] * ls, c[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(c[0], c[1] + c[3] * ls);
    ctx.stroke();
  });
}

function _cropGetCanvasPos(e) {
  var canvas = document.getElementById('crop-canvas');
  var rect = canvas.getBoundingClientRect();
  var clientX = e.touches ? e.touches[0].clientX : e.clientX;
  var clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height)
  };
}

function _cropHitTest(pos) {
  if (!_cropState || !_cropState.cropRect) return null;
  var cr = _cropState.cropRect;
  var hit = 24;
  var corners = [
    { name: 'tl', x: cr.x, y: cr.y },
    { name: 'tr', x: cr.x + cr.w, y: cr.y },
    { name: 'bl', x: cr.x, y: cr.y + cr.h },
    { name: 'br', x: cr.x + cr.w, y: cr.y + cr.h }
  ];
  for (var i = 0; i < corners.length; i++) {
    if (Math.abs(pos.x - corners[i].x) < hit && Math.abs(pos.y - corners[i].y) < hit) {
      return corners[i].name;
    }
  }
  if (pos.x > cr.x + hit && pos.x < cr.x + cr.w - hit && pos.y > cr.y + hit && pos.y < cr.y + cr.h - hit) {
    return 'move';
  }
  return null;
}

function _initCropDrag() {
  var canvas = document.getElementById('crop-canvas');
  if (!canvas) return;

  function onStart(e) {
    e.preventDefault();
    var pos = _cropGetCanvasPos(e);
    var handle = _cropHitTest(pos);
    if (!handle) return;
    _cropDragState = { handle: handle, startX: pos.x, startY: pos.y, startRect: Object.assign({}, _cropState.cropRect) };
  }

  function onMove(e) {
    if (!_cropDragState || !_cropState) return;
    e.preventDefault();
    var pos = _cropGetCanvasPos(e);
    var dx = pos.x - _cropDragState.startX;
    var dy = pos.y - _cropDragState.startY;
    var sr = _cropDragState.startRect;
    var cr = _cropState.cropRect;
    var cw = document.getElementById('crop-canvas').width;
    var ch = document.getElementById('crop-canvas').height;
    var min = 50;
    if (_cropDragState.handle === 'move') {
      cr.x = Math.max(0, Math.min(cw - cr.w, sr.x + dx));
      cr.y = Math.max(0, Math.min(ch - cr.h, sr.y + dy));
    } else {
      var nx = sr.x, ny = sr.y, nw = sr.w, nh = sr.h;
      if (_cropDragState.handle === 'tl') {
        nx = Math.max(0, Math.min(sr.x + sr.w - min, sr.x + dx));
        ny = Math.max(0, Math.min(sr.y + sr.h - min, sr.y + dy));
        nw = sr.w - (nx - sr.x); nh = sr.h - (ny - sr.y);
      } else if (_cropDragState.handle === 'tr') {
        ny = Math.max(0, Math.min(sr.y + sr.h - min, sr.y + dy));
        nw = Math.max(min, Math.min(cw - sr.x, sr.w + dx));
        nh = sr.h - (ny - sr.y);
      } else if (_cropDragState.handle === 'bl') {
        nx = Math.max(0, Math.min(sr.x + sr.w - min, sr.x + dx));
        nw = sr.w - (nx - sr.x);
        nh = Math.max(min, Math.min(ch - sr.y, sr.h + dy));
      } else if (_cropDragState.handle === 'br') {
        nw = Math.max(min, Math.min(cw - sr.x, sr.w + dx));
        nh = Math.max(min, Math.min(ch - sr.y, sr.h + dy));
      }
      cr.x = nx; cr.y = ny; cr.w = nw; cr.h = nh;
    }
    _cropDrawAll();
  }

  function onEnd() { _cropDragState = null; }

  // Clean up old listeners by cloning
  var newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, canvas);
  newCanvas.addEventListener('mousedown', onStart);
  newCanvas.addEventListener('touchstart', onStart, { passive: false });

  if (!_cropMoveListenersAdded) {
    _cropMoveListenersAdded = true;
    document.addEventListener('mousemove', function(e) { if (_cropDragState) onMove(e); });
    document.addEventListener('touchmove', function(e) { if (_cropDragState) onMove(e); }, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
  }
}

function _cropRotate() {
  if (!_cropState) return;
  _cropState.rotation = (_cropState.rotation + 90) % 360;
  _cropState.cropRect = null;
  _cropDrawAll();
  _initCropDrag();
}

function _cropMirror() {
  if (!_cropState) return;
  _cropState.mirrored = !_cropState.mirrored;
  _cropDrawAll();
}

async function _cropAndContinue() {
  if (!_cropState || !_cropState.img) return;
  var displayCanvas = document.getElementById('crop-canvas');
  if (!displayCanvas) return;

  var cr = _cropState.cropRect || { x: 0, y: 0, w: displayCanvas.width, h: displayCanvas.height };
  var img = _cropState.img;
  var rot = _cropState.rotation;
  var isRotated = rot % 180 !== 0;

  // 1. Original-Auflösung des rotierten Bildes
  var fullW = isRotated ? img.naturalHeight : img.naturalWidth;
  var fullH = isRotated ? img.naturalWidth : img.naturalHeight;

  // 2. Vollbild-Canvas bei Original-Auflösung (mit Rotation + Mirror)
  var fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullW;
  fullCanvas.height = fullH;
  var fullCtx = fullCanvas.getContext('2d');
  fullCtx.save();
  fullCtx.translate(fullW / 2, fullH / 2);
  fullCtx.rotate(rot * Math.PI / 180);
  if (_cropState.mirrored) fullCtx.scale(-1, 1);
  fullCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  fullCtx.restore();

  // 3. Crop-Koordinaten vom Display-Canvas auf Original skalieren
  var scaleX = fullW / displayCanvas.width;
  var scaleY = fullH / displayCanvas.height;
  var cropX = Math.round(cr.x * scaleX);
  var cropY = Math.round(cr.y * scaleY);
  var cropW = Math.max(1, Math.round(cr.w * scaleX));
  var cropH = Math.max(1, Math.round(cr.h * scaleY));

  // 4. Ausschnitt aus dem Full-Res-Canvas
  var out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  out.getContext('2d').drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  var dataUrl = out.toDataURL('image/jpeg', 0.95);
  var base64 = dataUrl.split(',')[1];

  _cropState._lastOriginalDataUrl = _cropState.imageDataUrl;
  _cropState._lastMimeType = _cropState.mimeType;
  _closeCropScreen();
  await _processCroppedImage(base64, 'image/jpeg');
}

function _recropImage() {
  // Re-open crop screen with original image
  var origUrl = (_cropState && _cropState._lastOriginalDataUrl) || (_scanResult && _scanResult._origDataUrl);
  var origMime = (_cropState && _cropState._lastMimeType) || 'image/jpeg';
  if (!origUrl) return;
  hideScanOverlay();
  _openCropScreen(origUrl, origMime);
}

async function _processCroppedImage(base64, mimeType) {
  var origDataUrl = (_cropState && _cropState._lastOriginalDataUrl) || ('data:' + mimeType + ';base64,' + base64);
  try {
    showScanOverlay('loading', { text: '📸 Foto wird hochgeladen…' });
    var compressed = await _compressImage(base64, mimeType);
    base64 = compressed.base64;
    mimeType = compressed.mimeType;

    // removeBackground zeigt eigene Lade-Meldung (Modell-Download vs. normaler Lauf)
    var imageDataUrl = await removeBackground(base64, mimeType);

    // If this is an item image update (from item detail), save directly
    if (_cropState && _cropState._isItemImageUpdate) {
      var updateId = _cropState._itemIdToUpdate;
      var updateItems = loadWardrobe();
      var updateIdx = updateItems.findIndex(function(i) { return i.id === updateId; });
      if (updateIdx >= 0) {
        updateItems[updateIdx].imageDataUrl = imageDataUrl;
        saveWardrobe(updateItems);
        renderWardrobeGrid();
        _showToast('✅ Bild aktualisiert!');
        _openItemDetail(updateId);
      }
      return;
    }

    showScanOverlay('loading', { text: '🔍 KI erkennt Kleidungsstück…' });
    // KI analysiert das Originalbild (bessere Erkennung durch Farb-/Texturinfos)
    var analysis = await analyzeClothingWithGemini(base64, mimeType);
    showScanOverlay('loading', { text: '✅ Fertig!' });
    _scanResult = Object.assign({}, analysis, {
      imageDataUrl: imageDataUrl,
      _origDataUrl: origDataUrl
    });
    // Kurze Pause damit "Fertig!" sichtbar ist
    await new Promise(function(r) { setTimeout(r, 600); });
    showScanOverlay('result', _scanResult);
  } catch (err) {
    showScanOverlay('error', { text: err.message || 'KI-Analyse fehlgeschlagen.' });
  }
}

// ── Scan-Overlay ──────────────────────────────────────────────────────────────
var _scanResult = null;

function showScanOverlay(state, data) {
  var overlay = document.getElementById('scan-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  ['scan-loading', 'scan-result', 'scan-error'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (state === 'loading') {
    var el = document.getElementById('scan-loading');
    if (el) {
      el.style.display = 'flex';
      var txt = document.getElementById('scan-loading-text');
      if (txt) txt.textContent = data && data.text ? data.text : 'KI analysiert…';
    }
  }
  if (state === 'result' && data) {
    var el = document.getElementById('scan-result');
    if (el) {
      el.style.display = 'flex';
      var img = document.getElementById('scan-result-img');
      if (img) img.src = data.imageDataUrl || '';
      var set = function(id, val) { var e = document.getElementById(id); if (e) e.value = val || ''; };
      set('scan-edit-name', data.name);
      set('scan-edit-brand', data.brand);
      set('scan-edit-type', data.type);
      set('scan-edit-color', data.color);
      set('scan-edit-style', data.style);
      var dot = document.getElementById('scan-result-color-dot');
      if (dot) dot.style.background = data.colorHex || '#888';
      var seasonSelect = document.getElementById('scan-edit-season');
      if (seasonSelect) {
        var seasonMap = { 'Sommer': 'Sommer|s-sommer', 'Winter': 'Winter|s-winter', 'Frühling': 'Frühling|s-fruhjahr', 'Ganzjährig': 'Ganzjährig|s-ganzjahrig' };
        seasonSelect.value = seasonMap[data.season] || 'Ganzjährig|s-ganzjahrig';
      }
    }
  }
  if (state === 'error') {
    var el = document.getElementById('scan-error');
    if (el) {
      el.style.display = 'flex';
      var txt = document.getElementById('scan-error-text');
      if (txt) txt.textContent = data && data.text ? data.text : 'Ein Fehler ist aufgetreten.';
    }
  }
}
function hideScanOverlay() {
  var overlay = document.getElementById('scan-overlay');
  if (overlay) overlay.style.display = 'none';
}
async function processScanFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var imageDataUrl = e.target.result;
    var mimeType = file.type || 'image/jpeg';
    _openCropScreen(imageDataUrl, mimeType);
  };
  reader.readAsDataURL(file);
}
function confirmScanItem() {
  if (!_scanResult) return;
  try {
    var name = (document.getElementById('scan-edit-name').value || '').trim() || _scanResult.name;
    var brand = (document.getElementById('scan-edit-brand').value || '').trim();
    var type = (document.getElementById('scan-edit-type').value || '').trim() || _scanResult.type;
    var color = (document.getElementById('scan-edit-color').value || '').trim() || _scanResult.color;
    var style = (document.getElementById('scan-edit-style').value || '').trim() || _scanResult.style;
    var seasonRaw = document.getElementById('scan-edit-season').value || 'Ganzjährig|s-ganzjahrig';
    var seasonParts = seasonRaw.split('|');
    // Große base64-Felder nicht in localStorage speichern
    var item = {
      id: _scanResult.id || ('item_' + Date.now()),
      name: name,
      brand: brand,
      type: type,
      color: color,
      colorHex: _scanResult.colorHex || '#888',
      season: seasonParts[0],
      seasonClass: seasonParts[1] || 's-ganzjahrig',
      style: style,
      emoji: _scanResult.emoji || '👕',
      imageDataUrl: _scanResult.imageDataUrl || ''
    };
    addToWardrobe(item);
    renderWardrobeGrid();
    hideScanOverlay();
    _scanResult = null;
    _showToast('✅ Kleidungsstück gespeichert!');
    navigate('schrank', document.getElementById('nav-schrank'));
  } catch (err) {
    console.error('[confirmScanItem] Fehler:', err);
    _showToast('❌ Speichern fehlgeschlagen: ' + err.message);
  }
}
function cancelScan() { hideScanOverlay(); _scanResult = null; }

// ── Kategorie aus Kleidungstyp ableiten ───────────────────────────────────────
function _wardrobeCategory(item) {
  var type = (item.type || '').toLowerCase().trim();
  var name = (item.name || '').toLowerCase();
  if (type === 'hose' || /\b(hose|jeans|chino|joggin|short|shorts|rock|röcke|legging)\b/.test(name)) return 'hosen';
  if (type === 'kleid' || /\b(kleid|kleider|dress)\b/.test(name)) return 'kleider';
  if (type === 'schuh' || /\b(schuh|sneaker|stiefel|sandal|boot|pumps|slipper|loafer)\b/.test(name)) return 'schuhe';
  if (type === 'accessoire' || /\b(sonnenbrille|brille|uhr|tasche|schal|schmuck|gürtel|handschuh|hut|mütze|kappe|kette|ring|armband)\b/.test(name)) return 'accessoires';
  // Default: Tops (T-Shirts, Hemden, Hoodies, Jacken, Pullover …)
  return 'tops';
}

// ── Item Detail Panel ─────────────────────────────────────────────────────────
var _currentItemId = null;
var _itemEditMode = false;

function _openItemDetail(itemId) {
  var items = loadWardrobe();
  var item = items.find(function(i) { return i.id === itemId; });
  if (!item) return;
  _currentItemId = itemId;
  _itemEditMode = false;
  _populateItemView(item);
  document.getElementById('idp-header-view').style.display = '';
  document.getElementById('idp-header-edit').style.display = 'none';
  document.getElementById('idp-view-content').style.display = '';
  document.getElementById('idp-edit-content').style.display = 'none';
  document.getElementById('idp-change-img-btn').classList.remove('visible');
  var panel = document.getElementById('item-detail-panel');
  if (panel) panel.classList.add('active');
}

function _closeItemDetail() {
  var panel = document.getElementById('item-detail-panel');
  if (panel) panel.classList.remove('active');
  _hideDeleteConfirm();
  _currentItemId = null;
  _itemEditMode = false;
}

function _populateItemView(item) {
  // Image
  var img = document.getElementById('idp-image');
  var emojiEl = document.getElementById('idp-emoji');
  if (item.imageDataUrl && item.imageDataUrl.length > 20) {
    img.src = item.imageDataUrl;
    img.style.display = '';
    emojiEl.style.display = 'none';
  } else {
    img.style.display = 'none';
    emojiEl.textContent = item.emoji || '👕';
    emojiEl.style.display = '';
  }
  // Title
  var titleEl = document.getElementById('idp-view-title');
  if (titleEl) titleEl.textContent = item.name || 'Artikel';
  // Fields
  var set = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val || '—'; };
  set('idp-v-name', item.name);
  set('idp-v-type', item.type);
  set('idp-v-color', item.color);
  set('idp-v-season', item.season);
  set('idp-v-style', item.style);
  set('idp-v-brand', item.brand);
  // Color dot
  var dot = document.getElementById('idp-v-colordot');
  if (dot) dot.style.background = item.colorHex || '#888';
  // Brand row visibility
  var brandRow = document.getElementById('idp-v-brand-row');
  if (brandRow) brandRow.style.display = item.brand ? '' : 'none';
  // Date
  var dateEl = document.getElementById('idp-v-date');
  if (dateEl) {
    if (item.id && item.id.startsWith('item_')) {
      var ts = parseInt(item.id.replace('item_', ''));
      if (!isNaN(ts)) {
        dateEl.textContent = new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
      } else { dateEl.textContent = '—'; }
    } else { dateEl.textContent = '—'; }
  }
  // Favorit
  var favBtn = document.getElementById('idp-fav-btn');
  var favIcon = document.getElementById('idp-fav-icon');
  if (favBtn && favIcon) {
    var isFav = item.isFav || false;
    favIcon.textContent = isFav ? '❤️' : '🤍';
    favBtn.classList.toggle('active-fav', isFav);
  }
}

function _enterItemEditMode() {
  var items = loadWardrobe();
  var item = items.find(function(i) { return i.id === _currentItemId; });
  if (!item) return;
  _itemEditMode = true;
  document.getElementById('idp-header-view').style.display = 'none';
  document.getElementById('idp-header-edit').style.display = '';
  document.getElementById('idp-view-content').style.display = 'none';
  document.getElementById('idp-edit-content').style.display = '';
  document.getElementById('idp-change-img-btn').classList.add('visible');
  // Fill edit fields
  var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('idp-e-name', item.name);
  setVal('idp-e-color', item.color);
  setVal('idp-e-colorhex', item.colorHex || '#888888');
  setVal('idp-e-brand', item.brand);
  // Type select
  var typeSelect = document.getElementById('idp-e-type');
  if (typeSelect) typeSelect.value = item.type || 'Top';
  // Season select
  var seasonSelect = document.getElementById('idp-e-season');
  if (seasonSelect) {
    var seasonMap = { 'Sommer':'Sommer|s-sommer','Winter':'Winter|s-winter','Frühling':'Frühling|s-fruhjahr','Ganzjährig':'Ganzjährig|s-ganzjahrig' };
    seasonSelect.value = seasonMap[item.season] || 'Ganzjährig|s-ganzjahrig';
  }
  // Style select
  var styleSelect = document.getElementById('idp-e-style');
  if (styleSelect) styleSelect.value = item.style || 'Casual';
  // Scroll to top
  var scroll = document.getElementById('idp-scroll');
  if (scroll) scroll.scrollTop = 0;
}

function _cancelItemEdit() {
  var items = loadWardrobe();
  var item = items.find(function(i) { return i.id === _currentItemId; });
  if (!item) { _closeItemDetail(); return; }
  _itemEditMode = false;
  document.getElementById('idp-header-view').style.display = '';
  document.getElementById('idp-header-edit').style.display = 'none';
  document.getElementById('idp-view-content').style.display = '';
  document.getElementById('idp-edit-content').style.display = 'none';
  document.getElementById('idp-change-img-btn').classList.remove('visible');
}

function _saveItemEdit() {
  if (!_currentItemId) return;
  try {
    var items = loadWardrobe();
    var idx = items.findIndex(function(i) { return i.id === _currentItemId; });
    if (idx < 0) return;
    var seasonRaw = document.getElementById('idp-e-season').value || 'Ganzjährig|s-ganzjahrig';
    var seasonParts = seasonRaw.split('|');
    items[idx] = Object.assign({}, items[idx], {
      name: document.getElementById('idp-e-name').value.trim() || items[idx].name,
      type: document.getElementById('idp-e-type').value || items[idx].type,
      color: document.getElementById('idp-e-color').value.trim() || items[idx].color,
      colorHex: document.getElementById('idp-e-colorhex').value || items[idx].colorHex,
      brand: document.getElementById('idp-e-brand').value.trim(),
      season: seasonParts[0],
      seasonClass: seasonParts[1] || 's-ganzjahrig',
      style: document.getElementById('idp-e-style').value || items[idx].style
    });
    saveWardrobe(items);
    renderWardrobeGrid();
    _showToast('✅ Artikel aktualisiert!');
    // Back to view mode
    _populateItemView(items[idx]);
    _cancelItemEdit();
  } catch (err) {
    _showToast('❌ Fehler: ' + err.message);
  }
}

function _toggleItemFav() {
  if (!_currentItemId) return;
  var items = loadWardrobe();
  var idx = items.findIndex(function(i) { return i.id === _currentItemId; });
  if (idx < 0) return;
  items[idx].isFav = !items[idx].isFav;
  saveWardrobe(items);
  renderWardrobeGrid();
  _populateItemView(items[idx]);
  _showToast(items[idx].isFav ? '❤️ Als Favorit gespeichert' : '🤍 Aus Favoriten entfernt');
}

function _postItemToFeed() {
  _showToast('📤 Post-Funktion kommt bald!');
}

function _syncColorName(hexVal) {
  // Just sync the hex picker with the color dot in the image wrap
  var img = document.getElementById('idp-image');
  var wrap = img && img.parentElement;
  // No-op for now, color name stays manual
}

function _showDeleteConfirm() {
  var overlay = document.getElementById('idp-confirm-overlay');
  if (overlay) overlay.classList.add('show');
}

function _hideDeleteConfirm() {
  var overlay = document.getElementById('idp-confirm-overlay');
  if (overlay) overlay.classList.remove('show');
}

function _deleteItem() {
  if (!_currentItemId) return;
  var items = loadWardrobe();
  var filtered = items.filter(function(i) { return i.id !== _currentItemId; });
  saveWardrobe(filtered);
  renderWardrobeGrid();
  _closeItemDetail();
  _showToast('🗑️ Artikel gelöscht');
}

function _changeItemImage() {
  var input = document.getElementById('idp-img-input');
  if (input) input.click();
}

async function _onItemImageSelected(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  input.value = '';
  // Read file
  var reader = new FileReader();
  reader.onload = async function(e) {
    var dataUrl = e.target.result;
    var mimeType = file.type || 'image/jpeg';
    // Open crop screen for the new image, then on continue update item
    _cropState = {
      imageDataUrl: dataUrl,
      mimeType: mimeType,
      rotation: 0,
      mirrored: false,
      cropRect: null,
      _isItemImageUpdate: true,
      _itemIdToUpdate: _currentItemId
    };
    _closeItemDetail();
    var screen = document.getElementById('crop-screen');
    if (screen) screen.classList.add('active');
    requestAnimationFrame(function() { requestAnimationFrame(function() { _initCropCanvas(); }); });
  };
  reader.readAsDataURL(file);
}

// ── Garderobe-Grid rendern ────────────────────────────────────────────────────
function renderWardrobeGrid() {
  var grid = document.getElementById('clothes-grid');
  if (!grid) return;
  grid.querySelectorAll('.ai-wardrobe-item').forEach(function(el) { el.remove(); });
  var items = loadWardrobe();
  if (items.length === 0) return;
  [].concat(items).reverse().forEach(function(item) {
    var hasImg = item.imageDataUrl && item.imageDataUrl.length > 20;
    var card = document.createElement('div');
    card.className = 'cloth-card ai-wardrobe-item';
    card.style.cursor = 'pointer';
    card.onclick = (function(id) { return function() { _openItemDetail(id); }; })(item.id);
    card.setAttribute('data-category', _wardrobeCategory(item));
    var brandLine = item.brand
      ? '<div class="cloth-color-name" style="font-size:10px;color:var(--purple);font-weight:700;margin-bottom:3px;">' + item.brand + '</div>'
      : '';
    var iconStyle = hasImg
      ? 'background-image:url(\'' + item.imageDataUrl + '\');background-size:cover;background-position:center;font-size:0;'
      : '';
    card.innerHTML = '<div class="cloth-icon" style="' + iconStyle + '">' + (hasImg ? '' : (item.emoji || '👕')) + '</div>'
      + brandLine
      + '<div class="cloth-name">' + (item.name || 'Unbekannt') + '</div>'
      + '<div class="cloth-color-row"><div class="color-dot" style="background:' + (item.colorHex || '#888') + ';"></div>'
      + '<span class="cloth-color-name">' + (item.color || '') + '</span></div>'
      + '<span class="season-tag ' + (item.seasonClass || 's-ganzjahrig') + '">' + (item.season || 'Ganzjährig') + '</span>';
    grid.insertBefore(card, grid.firstChild);
  });

  // Aktiven Filter neu anwenden + Anzahl aktualisieren
  if (typeof _updateWardrobeSubtitle === 'function') _updateWardrobeSubtitle();
}

// ── KI Styling: manuell generieren ───────────────────────────────────────────
async function confirmKiGenerate() {
  var description = (document.getElementById('ki-description')?.value || '').trim();
  var inspoContext = '';
  document.querySelectorAll('.ki-ordner-chip.selected').forEach(function(chip) {
    inspoContext += (chip.querySelector('.ki-ordner-chip-name')?.textContent || '') + ' ';
  });
  var inspoImageBase64 = null, inspoImageMime = null;
  var kiPreviewImg = document.getElementById('ki-preview-img');
  if (kiPreviewImg && kiPreviewImg.src && kiPreviewImg.src.startsWith('data:')) {
    var parts = kiPreviewImg.src.split(',');
    inspoImageBase64 = parts[1];
    inspoImageMime = kiPreviewImg.src.split(':')[1].split(';')[0];
  }
  closeKiModal();
  var outfitCards = document.getElementById('ki-ai-suggestions') || document.querySelector('.outfit-cards');
  if (outfitCards) {
    outfitCards.innerHTML = '<div style="text-align:center;padding:40px 16px;">'
      + '<div style="font-size:44px;display:inline-block;animation:aiPulse 1.2s ease-in-out infinite;">✨</div>'
      + '<div style="font-size:16px;font-weight:800;color:var(--text);margin-top:14px;">KI erstellt deine Outfits…</div>'
      + '<div style="font-size:13px;color:var(--text2);margin-top:6px;">Einen Moment bitte</div></div>';
    _ensureAiStyles();
  }
  try {
    var outfits = await generateOutfitsWithGemini(description, inspoContext.trim(), inspoImageBase64, inspoImageMime);
    renderKiOutfits(outfits);
  } catch (err) {
    if (outfitCards) {
      outfitCards.innerHTML = '<div style="text-align:center;padding:40px 16px;">'
        + '<div style="font-size:44px;">❌</div>'
        + '<div style="font-size:16px;font-weight:800;color:var(--text);margin-top:14px;">Fehler beim Generieren</div>'
        + '<div style="font-size:13px;color:var(--text2);margin-top:6px;line-height:1.5;">' + (err.message || 'Bitte versuche es erneut.') + '</div>'
        + '<button onclick="openKiModal()" style="margin-top:18px;background:var(--purple);color:white;border:none;border-radius:14px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer;">Erneut versuchen</button></div>';
    }
  }
}

// ── Outfit Registry (in-memory, für aktuelle Session) ─────────────────────────
var _kiOutfitRegistry = {};

function _outfitId(outfit) {
  // Stabiler Hash aus Outfit-Inhalt (unabhängig von gespeicherten Feldern)
  if (outfit.id) return outfit.id;
  try {
    return btoa(encodeURIComponent((outfit.name || '') + (outfit.items || []).map(function(i) { return i.name; }).join(''))).slice(0, 20);
  } catch (e) { return Math.random().toString(36).slice(2, 12); }
}

function _regOutfit(outfit) {
  var id = _outfitId(outfit);
  _kiOutfitRegistry[id] = outfit;
  return id;
}

// ── Wardrobe Foto-Suche ───────────────────────────────────────────────────────
function _findWardrobePhoto(itemName) {
  var wardrobe = loadWardrobe();
  var name = (itemName || '').toLowerCase();
  var match = wardrobe.find(function(w) {
    var wn = (w.name || '').toLowerCase();
    return wn.includes(name) || name.includes(wn);
  });
  return (match && match.imageDataUrl) ? match.imageDataUrl : null;
}

// ── Kleidungs-Sortierung (Kopf → Füße) ───────────────────────────────────────
function _clothingOrder(item) {
  var name = (item.name || '').toLowerCase();
  var emoji = item.emoji || '';
  if (['🎩','🧢','👒','⛑️','🪖'].indexOf(emoji) >= 0 || /mütze|hut|beanie|cap/.test(name)) return 0;
  if (['👕','👚','👔','🧶','🎽'].indexOf(emoji) >= 0 || /t-shirt|shirt|bluse|hemd|top|pullover|sweater|strick/.test(name)) return 1;
  if (/jacke|mantel|blazer|hoodie|parka/.test(name)) return 2;
  if (['👖','🩳','👗','🥻'].indexOf(emoji) >= 0 || /hose|jeans|chino|rock|kleid|legging/.test(name)) return 3;
  if (['👟','👠','👡','👢','🥿','🩴','👞'].indexOf(emoji) >= 0 || /schuh|sneaker|stiefel|sandal|boot/.test(name)) return 4;
  return 5;
}

// ── HTML-Attribut-Kodierung ───────────────────────────────────────────────────
function _escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════════════════════
// NEUES DATENMODELL: stylesync_outfits — flache Liste mit kollektionen-Array
// ══════════════════════════════════════════════════════════════════════════════
// Jedes Outfit: { id, name, style, match, items, kollektionen: ['☀️ Sommer', '__favoriten__'] }
//
// Kollektions-Namen: beliebige Strings
// Favoriten:         kollektionen enthält '__favoriten__'

function _loadOutfits() {
  try { return JSON.parse(localStorage.getItem('stylesync_outfits') || '[]'); } catch (e) { return []; }
}
function _storeOutfits(list) {
  localStorage.setItem('stylesync_outfits', JSON.stringify(list));
}

// Einmalige Migration aus altem Format (stylesync_saved + stylesync_favs)
function _migrateOldData() {
  if (localStorage.getItem('stylesync_outfits') !== null) return; // schon migriert
  var migrated = [];
  var seenIds = {};

  function mergeOutfit(o, colName) {
    var id = o._id || o.id || _outfitId(o);
    if (seenIds[id]) {
      var existing = migrated.find(function(m) { return m.id === id; });
      if (existing && existing.kollektionen.indexOf(colName) < 0) existing.kollektionen.push(colName);
    } else {
      seenIds[id] = true;
      migrated.push(Object.assign({}, o, { id: id, kollektionen: [colName] }));
    }
  }

  try {
    var saved = JSON.parse(localStorage.getItem('stylesync_saved') || '{}');
    Object.keys(saved).forEach(function(colName) {
      (saved[colName] || []).forEach(function(o) { mergeOutfit(o, colName); });
    });
  } catch (e) {}

  try {
    var favs = JSON.parse(localStorage.getItem('stylesync_favs') || '[]');
    favs.forEach(function(o) { mergeOutfit(o, '__favoriten__'); });
  } catch (e) {}

  _storeOutfits(migrated);
}

// ── Favoriten (abgeleitet aus kollektionen) ───────────────────────────────────
function _loadFavs() {
  return _loadOutfits().filter(function(o) {
    return (o.kollektionen || []).indexOf('__favoriten__') >= 0;
  });
}

function _isFav(id) {
  return _loadOutfits().some(function(o) {
    return o.id === id && (o.kollektionen || []).indexOf('__favoriten__') >= 0;
  });
}

function _toggleFav(id, btn) {
  var outfits = _loadOutfits();
  var existing = outfits.find(function(o) { return o.id === id; });

  if (existing) {
    var idx = existing.kollektionen.indexOf('__favoriten__');
    if (idx >= 0) {
      existing.kollektionen.splice(idx, 1);
      if (btn) btn.textContent = '🤍';
    } else {
      existing.kollektionen.push('__favoriten__');
      if (btn) btn.textContent = '🩷';
      _showToast('❤️ Zu Favoriten hinzugefügt');
    }
  } else {
    // Outfit noch nicht gespeichert → mit Favorit anlegen
    var outfit = _kiOutfitRegistry[id];
    if (!outfit) return;
    outfits.unshift(Object.assign({}, outfit, { id: id, kollektionen: ['__favoriten__'] }));
    if (btn) btn.textContent = '🩷';
    _showToast('❤️ Zu Favoriten hinzugefügt');
  }
  _storeOutfits(outfits);

  // Alle Herz-Buttons für diese ID synchronisieren
  var nowFav = _isFav(id);
  document.querySelectorAll('[data-heart-id="' + _escAttr(id) + '"]').forEach(function(b) {
    b.textContent = nowFav ? '🩷' : '🤍';
  });

  _updateFavoritenCard();
  _renderKiPills();
  _renderKiSavedSection();
}

function _updateFavoritenCard() {
  var favs = _loadFavs();
  var countEl = document.getElementById('favoriten-count');
  if (countEl) countEl.textContent = favs.length + ' Outfits';
  var preview = document.getElementById('favoriten-preview');
  if (!preview) return;
  var firstItem = favs[0] && favs[0].items && favs[0].items[0];
  var photo = firstItem ? _findWardrobePhoto(firstItem.name) : null;
  if (photo) {
    preview.innerHTML = '<div class="ordner-preview-cell" style="grid-column:1/-1;grid-row:1/-1;background-image:url(\'' + photo + '\');background-size:cover;background-position:center;"></div>';
  } else {
    preview.innerHTML = '<div class="ordner-preview-cell" style="grid-column:1/-1;grid-row:1/-1;font-size:36px;background:var(--purple-light);">❤️</div>';
  }
}

// ── Kollektionen (abgeleitet aus kollektionen-Arrays) ─────────────────────────
function _getCollections() {
  // Liefert alle Kollektions-Namen (ohne __favoriten__), dedupliziert, stabil sortiert
  var outfits = _loadOutfits();
  var seen = {};
  outfits.forEach(function(o) {
    (o.kollektionen || []).forEach(function(c) {
      if (c !== '__favoriten__') seen[c] = true;
    });
  });
  return Object.keys(seen);
}

function _getCollectionCount(name) {
  return _loadOutfits().filter(function(o) {
    return (o.kollektionen || []).indexOf(name) >= 0;
  }).length;
}

function _saveOutfitToCollection(collectionName, outfit) {
  var id = outfit.id || _outfitId(outfit);
  var outfits = _loadOutfits();
  var existing = outfits.find(function(o) { return o.id === id; });
  if (existing) {
    if ((existing.kollektionen || []).indexOf(collectionName) < 0) {
      existing.kollektionen = existing.kollektionen || [];
      existing.kollektionen.push(collectionName);
    }
  } else {
    outfits.unshift(Object.assign({}, outfit, { id: id, kollektionen: [collectionName] }));
  }
  _storeOutfits(outfits);
  // Sofort UI aktualisieren
  _renderKiPills();
  _renderKiSavedSection();
  _updateFavoritenCard();
}

function _updateOrdnerCounts() {
  // Legacy-Funktion (ordner-grid ist hidden, aber zur Sicherheit leer lassen)
}

// ── Save Modal ────────────────────────────────────────────────────────────────
var _pendingSaveId = null;

function _openSaveModal(id) {
  _pendingSaveId = id;
  var wrap = document.getElementById('save-new-input-wrap');
  var btn = document.getElementById('save-new-toggle-btn');
  if (wrap) wrap.style.display = 'none';
  if (btn) btn.style.display = 'flex';
  var nameInput = document.getElementById('save-new-name');
  if (nameInput) nameInput.value = '';

  var list = document.getElementById('save-modal-list');
  if (!list) { document.getElementById('save-modal-overlay').classList.add('open'); return; }

  // Aktuelles Outfit (aus Registry oder gespeichert)
  var currentOutfit = _kiOutfitRegistry[id];
  var currentKollektionen = [];
  var stored = _loadOutfits().find(function(o) { return o.id === id; });
  if (stored) currentKollektionen = stored.kollektionen || [];

  // Feste Default-Kollektionen + nutzerdefinierte
  var defaults = ['☀️ Sommer Looks', '💼 Business', '🎉 Party Nights'];
  var userCols = _getCollections().filter(function(c) { return defaults.indexOf(c) < 0; });
  var allCols = defaults.concat(userCols);

  var colMeta = { '☀️ Sommer Looks': '☀️', '💼 Business': '💼', '🎉 Party Nights': '🎉' };

  list.innerHTML = allCols.map(function(name) {
    var count = _getCollectionCount(name);
    var emoji = colMeta[name] || '📁';
    var isSaved = currentKollektionen.indexOf(name) >= 0;
    var checkmark = isSaved ? ' <span style="color:var(--purple);font-size:14px;">✓</span>' : '';
    return '<div class="save-col-item" data-save-col="' + _escAttr(name) + '" style="' + (isSaved ? 'opacity:0.6;' : '') + '">'
      + '<div class="save-col-emoji">' + emoji + '</div>'
      + '<div class="save-col-info"><div class="save-col-name">' + name + checkmark + '</div>'
      + '<div class="save-col-count">' + count + ' Outfits</div></div></div>';
  }).join('');

  document.getElementById('save-modal-overlay').classList.add('open');
}

function _closeSaveModal() {
  var overlay = document.getElementById('save-modal-overlay');
  if (overlay) overlay.classList.remove('open');
  _pendingSaveId = null;
}
function _closeSaveModalOutside(e) {
  if (e.target === document.getElementById('save-modal-overlay')) _closeSaveModal();
}
function _selectSaveCollection(name) {
  if (!_pendingSaveId) return;
  var outfit = _kiOutfitRegistry[_pendingSaveId];
  // Fallback: aus gespeicherten Outfits
  if (!outfit) outfit = _loadOutfits().find(function(o) { return o.id === _pendingSaveId; });
  if (!outfit) return;
  _saveOutfitToCollection(name, outfit);
  _closeSaveModal();
  _showToast('✅ Outfit in ' + name + ' gespeichert!');
}
function _toggleNewCollectionInput() {
  var wrap = document.getElementById('save-new-input-wrap');
  var btn = document.getElementById('save-new-toggle-btn');
  var visible = wrap && wrap.style.display !== 'none';
  if (wrap) wrap.style.display = visible ? 'none' : 'block';
  if (btn) btn.style.display = visible ? 'flex' : 'none';
  if (!visible) setTimeout(function() { var n = document.getElementById('save-new-name'); if (n) n.focus(); }, 100);
}
function _confirmNewCollection() {
  var nameInput = document.getElementById('save-new-name');
  var name = nameInput ? nameInput.value.trim() : '';
  if (!name) { if (nameInput) nameInput.focus(); return; }
  if (!_pendingSaveId) return;
  var outfit = _kiOutfitRegistry[_pendingSaveId];
  if (!outfit) outfit = _loadOutfits().find(function(o) { return o.id === _pendingSaveId; });
  if (!outfit) return;
  _saveOutfitToCollection(name, outfit);
  _closeSaveModal();
  _showToast('✅ Outfit in „' + name + '" gespeichert!');
}

// ─────────────────────────────────────────────────────────────────────────────
// SWIPE-TO-DELETE
// ─────────────────────────────────────────────────────────────────────────────

var _swipeUndoTimer = null;
var _swipeUndoFn = null;

function _initSwipeToDelete(container) {
  if (!container) return;
  container.querySelectorAll('.swipe-inner').forEach(function(inner) {
    if (inner.getAttribute('data-swipe-init')) return; // already bound
    inner.setAttribute('data-swipe-init', '1');
    var wrapper = inner.closest('.swipe-wrapper');
    if (!wrapper) return;

    var startX = 0, startY = 0, currentX = 0, dragging = false, dirLocked = false, isHoriz = false;
    var THRESHOLD = 85; // px to trigger delete
    var MAX = 130;

    function onStart(x, y) {
      startX = x; startY = y; currentX = 0;
      dragging = true; dirLocked = false; isHoriz = false;
      inner.classList.add('dragging');
    }
    function onMove(x, y) {
      if (!dragging) return;
      var dx = x - startX, dy = y - startY;
      if (!dirLocked) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        isHoriz = Math.abs(dx) > Math.abs(dy);
        dirLocked = true;
      }
      if (!isHoriz || dx > 0) return; // only left swipe
      currentX = Math.max(dx, -MAX);
      inner.style.transform = 'translateX(' + currentX + 'px)';
      var pct = Math.abs(currentX) / MAX;
      inner.style.opacity = String(1 - pct * 0.25);
      var bg = wrapper.querySelector('.swipe-delete-bg');
      if (bg) {
        var r = Math.round(239 - pct * 20), g = Math.round(68 - pct * 30), b = Math.round(68 - pct * 30);
        bg.style.background = 'rgb(' + r + ',' + g + ',' + b + ')';
      }
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      inner.classList.remove('dragging');
      if (isHoriz && Math.abs(currentX) >= THRESHOLD) {
        _animateDeleteWrapper(wrapper);
      } else {
        inner.style.transform = '';
        inner.style.opacity = '';
        var bg = wrapper.querySelector('.swipe-delete-bg');
        if (bg) bg.style.background = '';
      }
    }

    // Touch
    inner.addEventListener('touchstart', function(e) { onStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    inner.addEventListener('touchmove',  function(e) {
      if (isHoriz && dirLocked) e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    inner.addEventListener('touchend',    function() { onEnd(); });
    inner.addEventListener('touchcancel', function() { onEnd(); });

    // Mouse (Desktop)
    inner.addEventListener('mousedown', function(e) { onStart(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function(e) { if (dragging) onMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup',   function()  { if (dragging) onEnd(); });
  });
}

function _animateDeleteWrapper(wrapper) {
  var inner = wrapper.querySelector('.swipe-inner');
  if (inner) { inner.style.transition = 'none'; inner.style.transform = 'translateX(-110%)'; inner.style.opacity = '0'; }
  var h = wrapper.offsetHeight;
  wrapper.style.height = h + 'px';
  wrapper.style.overflow = 'hidden';
  requestAnimationFrame(function() {
    wrapper.style.transition = 'height 0.28s ease, margin-bottom 0.28s ease, opacity 0.2s';
    wrapper.style.height = '0';
    wrapper.style.marginBottom = '0';
    wrapper.style.opacity = '0';
  });
  setTimeout(function() { _swipeDeleteOutfit(wrapper); }, 290);
}

function _swipeDeleteOutfit(wrapper) {
  var outfitId  = wrapper.getAttribute('data-swipe-id');
  var type      = wrapper.getAttribute('data-swipe-type');   // 'suggestion' | 'collection'
  var colName   = wrapper.getAttribute('data-swipe-col');
  var outfitName = wrapper.getAttribute('data-swipe-name') || 'Outfit';

  // Save state for undo
  var undoFn = null;
  if (type === 'collection' && outfitId && colName) {
    var snapshots = _loadOutfits();
    undoFn = function() {
      _storeOutfits(snapshots);
      var listEl = document.getElementById('ki-collection-list');
      if (listEl && _currentCollectionName) {
        var fits = snapshots.filter(function(o) { return o.kollektionen && o.kollektionen.indexOf(_currentCollectionName) >= 0 && !o.isInspo; });
        listEl.innerHTML = fits.map(function(o) { return _renderCollectionCard(o, _currentCollectionName); }).join('');
        _initSwipeToDelete(listEl);
      }
      _hideUndoToast();
    };
    // Commit delete after 3 seconds
    clearTimeout(_swipeUndoTimer);
    _swipeUndoTimer = setTimeout(function() {
      var outfits = _loadOutfits();
      var o = outfits.find(function(x) { return x.id === outfitId; });
      if (o) {
        o.kollektionen = o.kollektionen.filter(function(c) { return c !== colName; });
        if (o.kollektionen.length === 0) outfits = outfits.filter(function(x) { return x.id !== outfitId; });
      }
      _storeOutfits(outfits);
      _swipeUndoFn = null;
      _hideUndoToast();
    }, 3000);
  } else {
    // KI suggestion — just remove DOM, no undo needed
    clearTimeout(_swipeUndoTimer);
  }

  wrapper.remove();
  _swipeUndoFn = undoFn;
  _showUndoToast('🗑️ ' + outfitName + ' gelöscht', !!undoFn);
}

function _showUndoToast(msg, showUndo) {
  var t = document.getElementById('swipe-undo-toast');
  var txt = document.getElementById('swipe-undo-text');
  var btn = document.getElementById('swipe-undo-btn');
  if (!t) return;
  if (txt) txt.textContent = msg;
  if (btn) btn.style.display = showUndo ? '' : 'none';
  t.classList.add('show');
  clearTimeout(_swipeUndoTimer._hideTimer);
  _swipeUndoTimer._hideTimer = setTimeout(_hideUndoToast, showUndo ? 3200 : 1800);
}

function _hideUndoToast() {
  var t = document.getElementById('swipe-undo-toast');
  if (t) t.classList.remove('show');
}

function _swipeUndo() {
  clearTimeout(_swipeUndoTimer);
  _hideUndoToast();
  if (_swipeUndoFn) { _swipeUndoFn(); _swipeUndoFn = null; }
  _showToast('↩️ Wiederhergestellt!');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
var _toastTimer = null;
function _showToast(msg) {
  var t = document.getElementById('ki-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { t.classList.remove('show'); }, 2800);
}

// ══════════════════════════════════════════════════════════════════════════════
// OUTFIT / KOLLEKTION UMBENENNEN
// ══════════════════════════════════════════════════════════════════════════════

function _buildRenameHtml(name) {
  return name; // kein ✏️-Icon — Name direkt antippen zum Umbenennen
}

// Startet Inline-Editing auf einem beliebigen Name-Element
function _startOutfitRename(id, nameEl) {
  if (!nameEl || nameEl.querySelector('input')) return; // bereits im Edit-Modus
  var outfit = _kiOutfitRegistry[id] || _loadOutfits().find(function(o) { return o.id === id; });
  if (!outfit) return;
  var currentName = outfit.name || 'Outfit';

  var originalHTML = nameEl.innerHTML;

  // Input + Bestätigen-Button aufbauen
  var wrap = document.createElement('div');
  wrap.className = 'outfit-name-edit-wrap';

  var input = document.createElement('input');
  input.className = 'outfit-name-edit-input';
  input.value = currentName;
  input.type = 'text';
  input.maxLength = 60;

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'outfit-name-edit-confirm';
  confirmBtn.textContent = '✅';
  confirmBtn.type = 'button';

  wrap.appendChild(input);
  wrap.appendChild(confirmBtn);
  nameEl.innerHTML = '';
  nameEl.appendChild(wrap);

  // Verhindert, dass Klick auf das Wrap das Panel/Karte öffnet
  wrap.addEventListener('click', function(e) { e.stopPropagation(); });

  input.focus();
  try { input.setSelectionRange(0, input.value.length); } catch (e) {}

  var committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    var newName = input.value.trim();
    if (newName && newName !== currentName) {
      _doRenameOutfit(id, newName, nameEl);
    } else {
      nameEl.innerHTML = originalHTML;
    }
  }

  function discard() {
    if (committed) return;
    committed = true;
    nameEl.innerHTML = originalHTML;
  }

  confirmBtn.addEventListener('mousedown', function(e) { e.preventDefault(); commit(); });
  confirmBtn.addEventListener('touchend', function(e) { e.preventDefault(); commit(); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); discard(); }
  });
  input.addEventListener('blur', function() {
    setTimeout(function() { if (!committed) discard(); }, 200);
  });
}

// Speichert den neuen Outfit-Namen und aktualisiert alle sichtbaren Stellen
function _doRenameOutfit(id, newName, triggerEl) {
  var outfits = _loadOutfits();
  var idx = outfits.findIndex(function(o) { return o.id === id; });
  if (idx >= 0) {
    outfits[idx].name = newName;
    _storeOutfits(outfits);
  }
  if (_kiOutfitRegistry[id]) _kiOutfitRegistry[id].name = newName;

  // Alle anderen gerenderten Name-Elemente dieses Outfits in-place updaten
  document.querySelectorAll('[data-rename-id="' + id + '"]').forEach(function(el) {
    if (el !== triggerEl) el.innerHTML = _buildRenameHtml(newName);
  });

  // Trigger-Element wiederherstellen (mit Pencil-Icon)
  if (triggerEl) triggerEl.innerHTML = _buildRenameHtml(newName);

  // Detail-Panel-Titel updaten falls dieses Outfit gerade geöffnet ist
  if (_currentOutfitId === id) {
    var titleEl = document.getElementById('ki-outfit-panel-title');
    if (titleEl && titleEl !== triggerEl) titleEl.textContent = newName;
  }

  // Saved-Section neu rendern (im Hintergrund immer vorhanden)
  _renderKiSavedSection();

  _showToast('✅ Name geändert!');
}

// Umbenennen des Outfits vom Detail-Panel-Header aus (✏️-Button)
function _startOutfitPanelRename() {
  var titleEl = document.getElementById('ki-outfit-panel-title');
  if (!titleEl || !_currentOutfitId) return;
  var id = _currentOutfitId;
  var outfit = _kiOutfitRegistry[id] || _loadOutfits().find(function(o) { return o.id === id; });
  if (!outfit) return;
  var currentName = outfit.name || 'Outfit';

  if (titleEl.querySelector('input')) return;

  var originalText = titleEl.textContent;
  titleEl.innerHTML = '';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;width:100%;';

  var input = document.createElement('input');
  input.className = 'outfit-name-edit-input';
  input.value = currentName;
  input.type = 'text';
  input.maxLength = 60;
  input.style.fontSize = '17px';
  input.style.fontWeight = '800';

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'outfit-name-edit-confirm';
  confirmBtn.textContent = '✅';
  confirmBtn.type = 'button';
  confirmBtn.style.fontSize = '18px';

  wrap.appendChild(input);
  wrap.appendChild(confirmBtn);
  titleEl.appendChild(wrap);

  wrap.addEventListener('click', function(e) { e.stopPropagation(); });
  input.focus();
  try { input.setSelectionRange(0, input.value.length); } catch(e) {}

  var committed = false;

  function commit() {
    if (committed) return; committed = true;
    var newName = input.value.trim();
    if (newName && newName !== currentName) {
      _doRenameOutfit(id, newName, null);
      titleEl.textContent = newName;
    } else {
      titleEl.textContent = originalText;
    }
  }

  function discard() {
    if (committed) return; committed = true;
    titleEl.textContent = originalText;
  }

  confirmBtn.addEventListener('mousedown', function(e) { e.preventDefault(); commit(); });
  confirmBtn.addEventListener('touchend', function(e) { e.preventDefault(); commit(); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); discard(); }
  });
  input.addEventListener('blur', function() {
    setTimeout(function() { if (!committed) discard(); }, 200);
  });
}

// Kollektion umbenennen (langer Druck oder ✏️-Button)
function _startCollectionRename(colName) {
  if (!colName || colName === '__favoriten__') return; // Favoriten nicht umbenennbar
  var titleEl = document.getElementById('ki-col-title');
  if (!titleEl || titleEl.querySelector('input')) return;
  var currentDisplay = titleEl.textContent;

  titleEl.innerHTML = '';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;width:100%;';

  var input = document.createElement('input');
  input.className = 'outfit-name-edit-input';
  input.value = currentDisplay;
  input.type = 'text';
  input.maxLength = 40;
  input.style.fontSize = '18px';
  input.style.fontWeight = '800';

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'outfit-name-edit-confirm';
  confirmBtn.textContent = '✅';
  confirmBtn.type = 'button';
  confirmBtn.style.fontSize = '20px';

  wrap.appendChild(input);
  wrap.appendChild(confirmBtn);
  titleEl.appendChild(wrap);

  wrap.addEventListener('click', function(e) { e.stopPropagation(); });
  input.focus();
  try { input.setSelectionRange(0, input.value.length); } catch(e) {}

  var committed = false;

  function commit() {
    if (committed) return; committed = true;
    var newName = input.value.trim();
    if (newName && newName !== colName) {
      _doRenameCollection(colName, newName);
    } else {
      titleEl.textContent = currentDisplay;
    }
  }

  function discard() {
    if (committed) return; committed = true;
    titleEl.textContent = currentDisplay;
  }

  confirmBtn.addEventListener('mousedown', function(e) { e.preventDefault(); commit(); });
  confirmBtn.addEventListener('touchend', function(e) { e.preventDefault(); commit(); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); discard(); }
  });
  input.addEventListener('blur', function() {
    setTimeout(function() { if (!committed) discard(); }, 200);
  });
}

// Alle Outfits einer Kollektion umbenennen + UI aktualisieren
function _doRenameCollection(oldName, newName) {
  var outfits = _loadOutfits();
  outfits.forEach(function(o) {
    var idx = (o.kollektionen || []).indexOf(oldName);
    if (idx >= 0) o.kollektionen[idx] = newName;
  });
  _storeOutfits(outfits);
  _currentCollectionName = newName;

  // Collection-Panel-Titel
  var titleEl = document.getElementById('ki-col-title');
  if (titleEl) titleEl.textContent = newName;

  // Kollektions-Pills + Saved-Section neu rendern
  _renderKiPills();
  _renderKiSavedSection();

  _showToast('✅ Name geändert!');
}

// ── renderKiOutfits (KI-Vorschläge rendern) ───────────────────────────────────
function renderKiOutfits(outfits) {
  var container = document.getElementById('ki-ai-suggestions') || document.querySelector('.outfit-cards');
  if (!container || !Array.isArray(outfits)) return;

  container.innerHTML = outfits.map(function(outfit) {
    var id = _regOutfit(outfit);
    var fav = _isFav(id);
    var items = [].concat(outfit.items || []).sort(function(a, b) { return _clothingOrder(a) - _clothingOrder(b); });
    var itemsHtml = items.slice(0, 6).map(function(item) {
      var photo = _findWardrobePhoto(item.name);
      var photoStyle = photo ? 'background-image:url(\'' + photo + '\');background-size:cover;background-position:center;font-size:0;' : '';
      return '<div class="outfit-item-row">'
        + '<div class="outfit-item-photo" style="' + photoStyle + '">' + (photo ? '' : (item.emoji || '👕')) + '</div>'
        + '<div class="outfit-item-row-name">' + (item.name || '') + '</div>'
        + '</div>';
    }).join('');
    return '<div class="swipe-wrapper" data-swipe-id="' + _escAttr(id) + '" data-swipe-type="suggestion">'
      + '<div class="swipe-delete-bg"><div class="swipe-delete-bg-icon">🗑️</div><div class="swipe-delete-bg-label">Löschen</div></div>'
      + '<div class="swipe-inner outfit-card-ki">'
      + '<div class="outfit-card-header">'
      + '<div><div class="outfit-card-name">' + (outfit.name || 'Outfit') + '</div>'
      + '<div class="outfit-card-style">' + (outfit.style || '') + '</div></div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span class="match-badge">' + (outfit.match || 90) + '% ✅</span>'
      + '<button class="heart-btn" data-heart-id="' + _escAttr(id) + '" onclick="_toggleFav(\'' + id + '\', this)">' + (fav ? '🩷' : '🤍') + '</button>'
      + '</div></div>'
      + '<div class="outfit-items-vertical">' + itemsHtml + '</div>'
      + '<button class="outfit-save-btn" onclick="_openSaveModal(\'' + id + '\')">💾 Speichern</button>'
      + '</div></div>';
  }).join('');

  _initSwipeToDelete(container);
  _updateFavoritenCard();
}

// ── CSS Styles ────────────────────────────────────────────────────────────────
function _ensureAiStyles() {
  if (document.getElementById('ai-keyframes')) return;
  var style = document.createElement('style');
  style.id = 'ai-keyframes';
  style.textContent = [
    '@keyframes aiPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.65;transform:scale(0.92)} }',
    '@keyframes aiSpin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }',
    '#scan-overlay { position:absolute;inset:0;z-index:300;background:rgba(247,243,255,0.97);display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px; }',
    '#scan-loading { display:none;flex-direction:column;align-items:center;gap:16px;text-align:center; }',
    '#scan-loading .ai-spin { font-size:52px;animation:aiSpin 2s linear infinite;display:inline-block; }',
    '#scan-loading .ai-load-title { font-size:17px;font-weight:800;color:var(--text); }',
    '#scan-loading .ai-load-sub { font-size:13px;color:var(--text2); }',
    '#scan-result { display:none;flex-direction:column;align-items:center;gap:0;width:100%; }',
    '#scan-result-img { width:160px;height:160px;object-fit:contain;border-radius:20px;background:white;box-shadow:0 8px 24px rgba(107,71,255,0.15);margin-bottom:16px; }',
    '#scan-result-info { background:white;border-radius:20px;padding:14px 16px;width:100%;box-shadow:0 4px 16px rgba(107,71,255,0.08);margin-bottom:14px; }',
    '.scan-field-row { display:flex;align-items:center;gap:10px;margin-bottom:10px; }',
    '.scan-field-row:last-child { margin-bottom:0; }',
    '.scan-field-label { font-size:11px;font-weight:800;color:var(--text2);width:62px;flex-shrink:0;text-transform:uppercase;letter-spacing:0.03em; }',
    '.scan-field-input { flex:1;border:1.5px solid var(--purple-border);border-radius:10px;padding:8px 12px;font-size:13px;color:var(--text);background:var(--bg);outline:none;font-family:inherit;min-width:0; }',
    '.scan-field-input:focus { border-color:var(--purple); }',
    'select.scan-field-input { cursor:pointer; }',
    '.scan-result-btns { display:flex;gap:12px;width:100%; }',
    '.scan-confirm-btn { flex:1;height:52px;border-radius:16px;background:var(--purple);border:none;color:white;font-size:15px;font-weight:800;cursor:pointer; }',
    '.scan-cancel-btn { height:52px;padding:0 20px;border-radius:16px;background:var(--card);border:2px solid var(--purple-border);color:var(--text2);font-size:15px;font-weight:700;cursor:pointer; }',
    '#scan-error { display:none;flex-direction:column;align-items:center;gap:14px;text-align:center; }',
    '#scan-error-text { font-size:14px;color:var(--text2);line-height:1.6;max-width:280px; }',
    '.scan-retry-btn { background:var(--purple);color:white;border:none;border-radius:14px;padding:13px 28px;font-size:15px;font-weight:800;cursor:pointer; }',
    '.scan-cancel2-btn { background:var(--card);color:var(--text2);border:2px solid var(--purple-border);border-radius:14px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer; }'
  ].join('\n');
  document.head.appendChild(style);
}

// ── Kollektions-Detail Navigation ─────────────────────────────────────────────
var _currentCollectionName = null;
var _currentOutfitId = null;
var _currentOutfitCollection = null;
var _colActiveTab = 'fits';

function _openCollection(name) {
  _currentCollectionName = name;
  _colActiveTab = 'fits';

  var allOutfits = _loadOutfits().filter(function(o) {
    return (o.kollektionen || []).indexOf(name) >= 0;
  });
  allOutfits.forEach(function(o) { _regOutfit(o); });

  var displayName = (name === '__favoriten__') ? '❤️ Favoriten' : name;
  var titleEl = document.getElementById('ki-col-title');
  if (titleEl) titleEl.textContent = displayName;
  // ✏️-Button nur bei echten Kollektionen sichtbar (nicht bei Favoriten)
  var colRenameBtn = document.getElementById('ki-col-rename-btn');
  if (colRenameBtn) colRenameBtn.style.display = (name === '__favoriten__') ? 'none' : '';

  var fits = allOutfits.filter(function(o) { return !o.isInspo; });
  var inspos = allOutfits.filter(function(o) { return !!o.isInspo; });

  var subEl = document.getElementById('ki-col-sub');
  if (subEl) subEl.textContent = allOutfits.length + (allOutfits.length === 1 ? ' Outfit' : ' Outfits');

  _updateColTabCounts(fits.length, inspos.length);
  _renderColTabContent(name, 'fits', fits, inspos);

  var panel = document.getElementById('ki-collection-panel');
  if (panel) panel.classList.add('active');
  _hideOptionsMenu();
}

function _updateColTabCounts(fitsCount, inspoCount) {
  var tabRow = document.getElementById('ki-col-tabs');
  if (!tabRow) return;
  tabRow.querySelectorAll('[data-col-tab]').forEach(function(btn) {
    var t = btn.getAttribute('data-col-tab');
    if (t === 'fits') btn.textContent = '✨ Meine Fits (' + fitsCount + ')';
    if (t === 'inspo') btn.textContent = '💡 Inspo (' + inspoCount + ')';
    btn.classList.toggle('active', t === _colActiveTab);
  });
}

function _selectColTab(tab) {
  _colActiveTab = tab;
  var name = _currentCollectionName;
  if (!name) return;
  var allOutfits = _loadOutfits().filter(function(o) {
    return (o.kollektionen || []).indexOf(name) >= 0;
  });
  var fits = allOutfits.filter(function(o) { return !o.isInspo; });
  var inspos = allOutfits.filter(function(o) { return !!o.isInspo; });
  _updateColTabCounts(fits.length, inspos.length);
  _renderColTabContent(name, tab, fits, inspos);
}

function _renderColTabContent(name, tab, fits, inspos) {
  var list = document.getElementById('ki-col-list');
  if (!list) return;
  if (tab === 'fits') {
    if (fits.length === 0) {
      list.innerHTML = '<div class="ki-empty-state"><div class="ki-empty-icon">✨</div>'
        + '<div class="ki-empty-text">Noch keine eigenen Fits hier ✨</div>'
        + '<button onclick="_openGenerateModal()" style="margin-top:16px;background:var(--purple);color:white;border:none;border-radius:14px;padding:12px 24px;font-size:14px;font-weight:800;cursor:pointer;">Outfit generieren</button>'
        + '</div>';
    } else {
      list.innerHTML = fits.map(function(o) { return _renderCollectionCard(o, name); }).join('');
      _initSwipeToDelete(list);
    }
  } else {
    if (inspos.length === 0) {
      list.innerHTML = '<div class="ki-empty-state"><div class="ki-empty-icon">💡</div>'
        + '<div class="ki-empty-text">Noch keine Inspos hier 💡</div>'
        + '<button onclick="navigate(\'freunde\',document.getElementById(\'nav-freunde\'))" style="margin-top:16px;background:var(--purple);color:white;border:none;border-radius:14px;padding:12px 24px;font-size:14px;font-weight:800;cursor:pointer;">Im Feed stöbern</button>'
        + '</div>';
    } else {
      list.innerHTML = inspos.map(function(o) { return _renderInspoCard(o, name); }).join('');
    }
  }
}

function _renderInspoCard(outfit, collectionName) {
  var id = _regOutfit(outfit);
  var items = (outfit.items || []).slice(0, 5);
  var itemsHtml = items.map(function(item) {
    return '<div class="outfit-chip-item"><span>' + (item.emoji || '👕') + '</span> ' + (item.name || '') + '</div>';
  }).join('');
  return '<div class="inspo-card">'
    + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">'
    + '<span class="inspo-badge">💡 Inspo</span>'
    + '<span style="font-size:11px;color:#856404;font-weight:700;">von ' + (outfit.inspoFrom || '') + '</span>'
    + '</div>'
    + '<div class="inspo-card-head">'
    + '<div class="inspo-card-avatar" style="background:' + (outfit.inspoAvatarBg || '#eee') + ';">' + (outfit.inspoAvatar || '👤') + '</div>'
    + '<div><div class="inspo-card-from-label">Von</div>'
    + '<div class="inspo-card-from-name">' + (outfit.inspoFrom || '') + '</div></div>'
    + '</div>'
    + '<div class="inspo-card-title">"' + (outfit.name || 'Outfit') + '"</div>'
    + '<div class="outfit-chips" style="margin-bottom:2px;">' + itemsHtml + '</div>'
    + '<button class="inspo-version-btn" onclick="_createMyVersionInCol(\'' + _escAttr(id) + '\')">🤖 Meine Version erstellen</button>'
    + '</div>';
}

function _createMyVersionInCol(id) {
  var outfit = _kiOutfitRegistry[id] || _loadOutfits().find(function(o) { return o.id === id; });
  if (!outfit) return;
  var colName = _currentCollectionName;

  var list = document.getElementById('ki-col-list');
  if (list) {
    list.innerHTML = '<div class="ki-empty-state">'
      + '<div style="font-size:40px;animation:aiSpin 2s linear infinite;display:inline-block;">✨</div>'
      + '<div style="font-size:15px;font-weight:700;color:var(--text2);margin-top:14px;">KI erstellt deine Version…</div>'
      + '<div style="font-size:12px;color:var(--text2);margin-top:6px;">Einen Moment bitte</div>'
      + '</div>';
  }

  var inspoDesc = 'Erstelle meine eigene Version von diesem Inspo-Outfit'
    + (outfit.inspoFrom ? ' von ' + outfit.inspoFrom : '') + ': "'
    + (outfit.name || 'Outfit') + '". '
    + 'Original-Items: ' + (outfit.items || []).map(function(i) { return i.name; }).join(', ')
    + '. Kombiniere ähnliche Stücke NUR aus meinem eigenen Schrank.';

  generateOutfitsWithGemini(inspoDesc, null, null, null).then(function(outfits) {
    if (!outfits || outfits.length === 0) throw new Error('Keine Outfits generiert');
    var newOutfit = outfits[0];
    newOutfit.isInspo = false;
    newOutfit.id = _outfitId(newOutfit);
    if (colName) _saveOutfitToCollection(colName, newOutfit);
    _showToast('✨ Deine Version wurde erstellt und in Meine Fits gespeichert!');
    if (_currentCollectionName === colName) {
      _colActiveTab = 'fits';
      var allOutfits = _loadOutfits().filter(function(o) {
        return (o.kollektionen || []).indexOf(colName) >= 0;
      });
      allOutfits.forEach(function(o) { _regOutfit(o); });
      var fits = allOutfits.filter(function(o) { return !o.isInspo; });
      var inspos = allOutfits.filter(function(o) { return !!o.isInspo; });
      _updateColTabCounts(fits.length, inspos.length);
      _renderColTabContent(colName, 'fits', fits, inspos);
    }
  }).catch(function(err) {
    if (list) {
      list.innerHTML = '<div class="ki-empty-state"><div class="ki-empty-icon">⚠️</div>'
        + '<div class="ki-empty-text">' + (err.message || 'Fehler beim Generieren') + '</div>'
        + '<button onclick="_selectColTab(\'inspo\')" style="margin-top:16px;background:var(--purple);color:white;border:none;border-radius:14px;padding:12px 24px;font-size:14px;font-weight:800;cursor:pointer;">Zurück</button>'
        + '</div>';
    }
  });
}

function _closeCollection() {
  var panel = document.getElementById('ki-collection-panel');
  if (panel) panel.classList.remove('active');
  _currentCollectionName = null;
  // Zurück zu "Alle"-Ansicht
  _kiActivePill = null;
  _renderKiPills();
  _setKiSuggestionsVisible(true);
  _renderKiSavedSection();
}

function _renderCollectionCard(outfit, collectionName) {
  var id = _regOutfit(outfit);
  var fav = _isFav(id);
  var items = (outfit.items || []).slice(0, 3);

  var previewHtml = items.map(function(item) {
    var photo = _findWardrobePhoto(item.name);
    var style = photo ? 'background-image:url(\'' + photo + '\');background-size:cover;background-position:center;font-size:0;' : '';
    return '<div class="col-card-photo" style="' + style + '">' + (photo ? '' : (item.emoji || '👕')) + '</div>';
  }).join('');

  var inspoMeta = outfit.isInspo
    ? '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span class="inspo-badge">💡 Inspo</span><span style="font-size:11px;color:#856404;font-weight:700;">von ' + (outfit.inspoFrom || '') + '</span></div>'
    : '';
  return '<div class="swipe-wrapper col-wrap" data-swipe-id="' + _escAttr(id) + '" data-swipe-type="collection" data-swipe-col="' + _escAttr(collectionName) + '" data-swipe-name="' + _escAttr(outfit.name || 'Outfit') + '">'
    + '<div class="swipe-delete-bg"><div class="swipe-delete-bg-icon">🗑️</div><div class="swipe-delete-bg-label">Löschen</div></div>'
    + '<div class="swipe-inner col-outfit-card" data-col-id="' + _escAttr(id) + '" data-col-name="' + _escAttr(collectionName) + '">'
    + '<div class="col-outfit-header">'
    + '<div>' + inspoMeta + '<div class="col-outfit-name">' + (outfit.name || 'Outfit') + '</div>'
    + '<span class="match-badge">' + (outfit.match || 90) + '% ✅</span></div>'
    + '<button class="heart-btn" data-heart-id="' + _escAttr(id) + '">' + (fav ? '🩷' : '🤍') + '</button>'
    + '</div>'
    + '<div class="col-outfit-preview">' + previewHtml + '</div>'
    + '</div></div>';
}

// ── Outfit Detail Ansicht ─────────────────────────────────────────────────────
function _openOutfitDetail(id, collectionName) {
  _currentOutfitId = id;
  _currentOutfitCollection = collectionName;

  var outfit = _kiOutfitRegistry[id] || _loadOutfits().find(function(o) { return o.id === id; });
  if (!outfit) return;

  var fav = _isFav(id);
  var titleEl = document.getElementById('ki-outfit-panel-title');
  if (titleEl) titleEl.textContent = outfit.name || 'Outfit';

  var content = document.getElementById('ki-outfit-detail-content');
  if (content) {
    var items = [].concat(outfit.items || []).sort(function(a, b) { return _clothingOrder(a) - _clothingOrder(b); });
    var itemsHtml = items.map(function(item) {
      var photo = _findWardrobePhoto(item.name);
      var photoStyle = photo ? 'background-image:url(\'' + photo + '\');background-size:cover;background-position:center;font-size:0;' : '';
      return '<div class="outfit-item-row">'
        + '<div class="outfit-item-photo" style="' + photoStyle + '">' + (photo ? '' : (item.emoji || '👕')) + '</div>'
        + '<div class="outfit-item-row-name">' + (item.name || '') + '</div>'
        + '</div>';
    }).join('');
    var inspoBanner = '';
    if (outfit.isInspo) {
      inspoBanner = '<div class="inspo-detail-banner">'
        + '<div class="inspo-detail-avatar" style="background:' + (outfit.inspoAvatarBg || '#eee') + ';">' + (outfit.inspoAvatar || '👤') + '</div>'
        + '<div class="inspo-detail-info">'
        + '<div class="inspo-detail-from">💡 Inspo von</div>'
        + '<div class="inspo-detail-name">' + (outfit.inspoFrom || 'Freund') + '</div>'
        + '</div></div>';
    }
    var myVersionBtn = outfit.isInspo
      ? '<button class="inspo-my-version-btn" onclick="_createMyVersion(\'' + id + '\')">🤖 Meine Version erstellen</button>'
      : '';
    content.innerHTML = '<div style="padding:4px 0 0;">'
      + inspoBanner
      + '<div class="outfit-items-vertical" style="border-top:none;padding-top:0;">' + itemsHtml + '</div>'
      + '<div class="detail-action-row">'
      + '<button class="detail-fav-btn" data-heart-id="' + _escAttr(id) + '" onclick="_toggleFav(\'' + id + '\', this)">' + (fav ? '🩷' : '🤍') + '</button>'
      + '<button class="detail-save-btn" onclick="_openSaveModal(\'' + id + '\')">💾 Speichern</button>'
      + '</div>'
      + '<button class="detail-post-btn" onclick="_openNewPostModal(\'' + _escAttr(id) + '\')">📤 Posten</button>'
      + myVersionBtn
      + '</div>';
  }

  var panel = document.getElementById('ki-outfit-panel');
  if (panel) panel.classList.add('active');
  _hideOptionsMenu();
}

function _closeOutfitDetail() {
  var panel = document.getElementById('ki-outfit-panel');
  if (panel) panel.classList.remove('active');
  _hideOptionsMenu();
  _currentOutfitId = null;
  _currentOutfitCollection = null;
}

function _toggleFavDetail(btn) {
  if (!_currentOutfitId) return;
  _toggleFav(_currentOutfitId, btn);
}

// ── Optionen-Menü ─────────────────────────────────────────────────────────────
function _toggleOptionsMenu(e) {
  e.stopPropagation();
  var menu = document.getElementById('ki-options-menu');
  if (!menu) return;
  menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
}
function _hideOptionsMenu() {
  var menu = document.getElementById('ki-options-menu');
  if (menu) menu.style.display = 'none';
}

// ── Outfit aus Kollektion entfernen ───────────────────────────────────────────
function _removeCurrentOutfit() {
  if (!_currentOutfitId || !_currentOutfitCollection) return;
  _hideOptionsMenu();

  var id = _currentOutfitId;
  var colName = _currentOutfitCollection;

  // Kollektion aus outfit.kollektionen entfernen
  var outfits = _loadOutfits();
  var outfit = outfits.find(function(o) { return o.id === id; });
  if (outfit) {
    var idx = outfit.kollektionen.indexOf(colName);
    if (idx >= 0) outfit.kollektionen.splice(idx, 1);
    _storeOutfits(outfits);
  }

  var colDisplay = colName === '__favoriten__' ? 'Favoriten' : colName;
  _showToast('🗑️ Aus ' + colDisplay + ' entfernt');

  var panel = document.getElementById('ki-outfit-panel');
  if (panel) panel.classList.remove('active');
  _currentOutfitId = null;
  _currentOutfitCollection = null;

  setTimeout(function() {
    _openCollection(colName);
    _renderKiPills();
    _renderKiSavedSection();
    _updateFavoritenCard();
  }, 80);
}

// ══════════════════════════════════════════════════════════════════════════════
// KI STYLING SCREEN — Pills, Filter, Gespeicherte Outfits
// ══════════════════════════════════════════════════════════════════════════════
var _kiActivePill = null; // null = alle
var _savedCardRegistry = {}; // id → { collection }

function _renderKiPills() {
  var wrap = document.getElementById('ki-pills-wrap');
  if (!wrap) return;

  var pills = [{ label: '🌟 Alle', key: '__all__' }];

  var favCount = _loadFavs().length;
  if (favCount > 0) pills.push({ label: '❤️ Favoriten (' + favCount + ')', key: '__favoriten__' });

  _getCollections().forEach(function(name) {
    var count = _getCollectionCount(name);
    if (count > 0) pills.push({ label: name + ' (' + count + ')', key: name });
  });

  var activeKey = _kiActivePill === null ? '__all__' : _kiActivePill;
  wrap.innerHTML = pills.map(function(p) {
    return '<button class="ki-pill' + (activeKey === p.key ? ' active' : '') + '" data-pill-key="' + _escAttr(p.key) + '">' + p.label + '</button>';
  }).join('');
}

// KI-Vorschläge-Sektion ein-/ausblenden (nur die KI-generierten, nicht den Button)
function _setKiSuggestionsVisible(visible) {
  var label = document.getElementById('ki-suggestions-label');
  var section = document.getElementById('ki-ai-suggestions');
  if (label) label.style.display = visible ? 'flex' : 'none';
  if (section) section.style.display = visible ? '' : 'none';
}

function _selectKiPill(key) {
  if (key === '__all__') {
    _kiActivePill = null;
    _renderKiPills();
    _setKiSuggestionsVisible(true);
    _renderKiSavedSection();
  } else {
    // Kollektion-Pill → direkt Kollektion-Panel öffnen
    _kiActivePill = key;
    _renderKiPills();
    _setKiSuggestionsVisible(false);
    _openCollection(key);
  }
}

function _clearKiPillFilter() {
  _kiActivePill = null;
  _renderKiPills();
  _setKiSuggestionsVisible(true);
  _renderKiSavedSection();
}

function _renderKiSavedSection() {
  var savedContainer = document.getElementById('ki-saved-outfits');
  if (!savedContainer) return;
  _savedCardRegistry = {};

  // Alle gespeicherten Outfits (mit mind. einer Kollektion)
  var all = _loadOutfits().filter(function(o) { return (o.kollektionen || []).length > 0; });

  if (all.length === 0) {
    savedContainer.innerHTML = '<div style="text-align:center;padding:20px 0 10px;">'
      + '<div style="font-size:32px;">🧺</div>'
      + '<div style="font-size:14px;font-weight:700;color:var(--text2);margin-top:8px;">Noch keine Outfits gespeichert</div>'
      + '</div>';
    return;
  }

  savedContainer.innerHTML = all.map(function(outfit) {
    var id = _regOutfit(outfit);
    _savedCardRegistry[id] = { collection: (outfit.kollektionen || [])[0] || '__all__' };
    var fav = _isFav(id);
    var items = (outfit.items || []).slice(0, 3);
    var col = (outfit.kollektionen || []).filter(function(c) { return c !== '__favoriten__'; })[0]
      || (fav ? '❤️ Favoriten' : '');

    var photosHtml = items.map(function(item) {
      var photo = _findWardrobePhoto(item.name);
      var bgStyle = photo ? 'background-image:url(\'' + photo + '\');background-size:cover;background-position:center;font-size:0;' : '';
      return '<div class="ki-saved-photo" style="' + bgStyle + '">' + (photo ? '' : (item.emoji || '👕')) + '</div>';
    }).join('');

    var inspoBadge = outfit.isInspo ? '<span class="inspo-badge">💡 Inspo</span>' : '';
    var inspoFromLine = outfit.isInspo ? '<div class="inspo-from">von ' + (outfit.inspoFrom || '') + '</div>' : '';
    return '<div class="ki-saved-card" data-saved-id="' + _escAttr(id) + '">'
      + '<div class="ki-saved-photos">' + photosHtml + '</div>'
      + '<div class="ki-saved-meta">'
      + (col ? '<div class="ki-saved-from">' + col + '</div>' : '')
      + '<div class="ki-saved-name" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' + (outfit.name || 'Outfit') + inspoBadge + '</div>'
      + inspoFromLine
      + '<div class="ki-saved-match">' + (outfit.match || 90) + '% Passend · ' + (outfit.style || '') + '</div>'
      + '</div>'
      + '<button class="ki-saved-heart" data-heart-id="' + _escAttr(id) + '">' + (fav ? '🩷' : '🤍') + '</button>'
      + '</div>';
  }).join('');
}

// ── Generate Modal ────────────────────────────────────────────────────────────
var _genSelectedCollection = null;
var _genSelectedInspo = null;
var _genMode = 'browse'; // 'browse' = kein API Call | 'generate' = API Call

function _openGenerateModal(mode) {
  var modal = document.getElementById('ki-generate-modal');
  if (!modal) return;
  _genMode = mode || 'browse';
  _genSelectedCollection = null;
  _genSelectedInspo = null;
  var desc = document.getElementById('ki-gen-description');
  if (desc) desc.value = '';
  _renderGenCollections();
  _renderGenInspoOutfits();

  var title = document.getElementById('ki-gen-title');
  var confirmBtn = document.getElementById('ki-gen-confirm-btn');
  if (title) title.textContent = _genMode === 'generate' ? '⭐ Mehr Vorschläge generieren' : '✨ Outfit generieren';
  if (confirmBtn) confirmBtn.textContent = _genMode === 'generate' ? '✨ Generieren' : '✨ Anzeigen';

  modal.classList.add('active');
}

function _renderGenInspoOutfits() {
  var container = document.getElementById('ki-gen-inspo-outfits');
  var divider = document.getElementById('ki-gen-inspo-divider');
  var label = document.getElementById('ki-gen-inspo-label');
  if (!container) return;
  var inspos = _loadOutfits().filter(function(o) { return !!o.isInspo; });
  var hasInspos = inspos.length > 0;
  if (divider) divider.style.display = hasInspos ? 'flex' : 'none';
  if (label) label.style.display = hasInspos ? '' : 'none';
  if (!hasInspos) { container.innerHTML = ''; return; }
  container.innerHTML = inspos.slice(0, 5).map(function(o) {
    var id = o.id || _outfitId(o);
    var active = _genSelectedInspo === id ? ' active' : '';
    return '<div class="ki-gen-col-chip' + active + '" data-gen-inspo="' + _escAttr(id) + '">'
      + '💡 ' + (o.inspoFrom || 'Inspo') + ': ' + (o.name || 'Outfit')
      + '</div>';
  }).join('');
}

function _selectGenInspoOutfit(id) {
  _genSelectedInspo = (_genSelectedInspo === id) ? null : id;
  _genSelectedCollection = null; // Inspo und Kollektion schließen sich aus
  _renderGenInspoOutfits();
  _renderGenCollections();
}

function _closeGenerateModal() {
  var modal = document.getElementById('ki-generate-modal');
  if (modal) modal.classList.remove('active');
}

function _closeGenerateModalOutside(e) {
  if (e.target && e.target.id === 'ki-generate-modal') _closeGenerateModal();
}

function _renderGenCollections() {
  var container = document.getElementById('ki-gen-collections');
  if (!container) return;
  var chips = [];
  var favs = _loadFavs();
  if (favs.length > 0) chips.push({ key: '__favoriten__', label: '🩷 Favoriten', count: favs.length });
  _getCollections().forEach(function(c) {
    chips.push({ key: c, label: c, count: _getCollectionCount(c) });
  });
  if (chips.length === 0) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text2);padding:6px 0;">Noch keine Kollektionen vorhanden</div>';
    return;
  }
  container.innerHTML = chips.map(function(chip) {
    var active = _genSelectedCollection === chip.key ? ' active' : '';
    return '<div class="ki-gen-col-chip' + active + '" data-gen-col="' + _escAttr(chip.key) + '">'
      + chip.label + ' <span style="opacity:0.65;font-size:11px;">(' + chip.count + ')</span>'
      + '</div>';
  }).join('');
}

function _selectGenCollection(key) {
  _genSelectedCollection = (_genSelectedCollection === key) ? null : key;
  _renderGenCollections();
}

function _confirmGenerate() {
  var desc = ((document.getElementById('ki-gen-description') || {}).value || '').trim();
  var colContext = '';

  if (_genSelectedCollection) {
    var colLabel = _genSelectedCollection === '__favoriten__' ? 'Favoriten' : _genSelectedCollection;
    var outfitsInCol = _loadOutfits().filter(function(o) {
      return (o.kollektionen || []).indexOf(_genSelectedCollection) >= 0;
    });
    if (outfitsInCol.length > 0) {
      colContext = 'Lass dich von Outfits aus der Kollektion "' + colLabel + '" inspirieren: '
        + outfitsInCol.slice(0, 5).map(function(o) { return o.name || 'Outfit'; }).join(', ');
    }
  } else if (_genSelectedInspo) {
    var inspoOutfit = _loadOutfits().find(function(o) { return o.id === _genSelectedInspo; });
    if (inspoOutfit) {
      colContext = 'Lass dich von diesem Inspo-Outfit von ' + (inspoOutfit.inspoFrom || 'einem Freund')
        + ' inspirieren: "' + (inspoOutfit.name || 'Outfit') + '" – Items: '
        + (inspoOutfit.items || []).map(function(i) { return i.name; }).join(', ');
    }
  }

  _closeGenerateModal();

  if (_genMode === 'browse') {
    // Kein API Call – Preview-Sektion mit passendem Filter aktualisieren
    _renderPreviewSuggestions(_genSelectedCollection);
  } else {
    // API Call via unterem Button
    _autoLoadKiSuggestions(true, desc, colContext);
  }
}

// ── Vorgeschlagene Outfits (kein API, aus gespeicherten) ──────────────────────
function _renderPreviewSuggestions(collectionFilter) {
  var container = document.getElementById('ki-preview-suggestions');
  if (!container) return;
  var all = _loadOutfits().filter(function(o) { return !o.isInspo; });
  var pool;
  if (collectionFilter) {
    pool = all.filter(function(o) { return (o.kollektionen || []).indexOf(collectionFilter) >= 0; });
    if (pool.length === 0) pool = all; // Fallback: alle zeigen
  } else {
    pool = all;
  }
  if (pool.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:24px 20px 12px;">'
      + '<div style="font-size:32px;">🧺</div>'
      + '<div style="font-size:14px;font-weight:700;color:var(--text2);margin-top:8px;line-height:1.5;">Noch keine Outfits gespeichert.<br>Generiere Outfits und speichere sie!</div>'
      + '</div>';
    return;
  }
  // Zufällige 2–3 Auswahl
  var shuffled = pool.slice().sort(function() { return Math.random() - 0.5; });
  var picks = shuffled.slice(0, 3);
  container.innerHTML = picks.map(function(outfit) {
    var id = _regOutfit(outfit);
    var isFav = (outfit.kollektionen || []).indexOf('__favoriten__') >= 0;
    var col = (outfit.kollektionen || []).filter(function(c) { return c !== '__favoriten__'; })[0];
    var source = isFav ? '❤️ Favorit' : (col ? '📁 aus ' + col : '📁 Gespeichert');
    var items = (outfit.items || []).slice(0, 3);
    var photosHtml = items.map(function(item) {
      var photo = _findWardrobePhoto(item.name);
      var bgStyle = photo ? 'background-image:url(\'' + photo + '\');background-size:cover;background-position:center;font-size:0;' : '';
      return '<div class="ki-saved-photo" style="' + bgStyle + '">' + (photo ? '' : (item.emoji || '👕')) + '</div>';
    }).join('');
    var fav = _isFav(id);
    return '<div class="ki-saved-card" data-saved-id="' + _escAttr(id) + '">'
      + '<div class="ki-saved-photos">' + photosHtml + '</div>'
      + '<div class="ki-saved-meta">'
      + '<div class="ki-saved-from">' + source + '</div>'
      + '<div class="ki-saved-name">' + (outfit.name || 'Outfit') + '</div>'
      + '<div class="ki-saved-match">' + (outfit.match || 90) + '% Passend · ' + (outfit.style || '') + '</div>'
      + '</div>'
      + '<button class="ki-saved-heart" data-heart-id="' + _escAttr(id) + '">' + (fav ? '🩷' : '🤍') + '</button>'
      + '</div>';
  }).join('');
}

// ── KI Vorschläge ─────────────────────────────────────────────────────────────
var _kiSuggestionsLoaded = false;
var _kiLoadingActive = false;

function _showKiIdlePlaceholder() {
  var suggestions = document.getElementById('ki-ai-suggestions');
  if (suggestions) {
    suggestions.innerHTML = '<div id="ki-ai-placeholder" style="text-align:center;padding:40px 20px 16px;">'
      + '<div style="font-size:48px;margin-bottom:12px;">✨</div>'
      + '<div style="font-size:15px;font-weight:700;color:var(--text2);line-height:1.6;">Tippe auf <strong style="color:var(--purple);">Outfit generieren</strong><br>für neue Vorschläge ✨</div>'
      + '</div>';
  }
}

function _autoLoadKiSuggestions(force, customDesc, colContext) {
  if (_kiLoadingActive) return;
  if (_kiSuggestionsLoaded && !force) return;

  var wardrobe = loadWardrobe();
  var placeholder = document.getElementById('ki-ai-placeholder');
  var suggestions = document.getElementById('ki-ai-suggestions');
  if (!suggestions) return;

  if (wardrobe.length === 0) {
    if (suggestions) suggestions.innerHTML = '<div style="text-align:center;padding:40px 20px 16px;">'
      + '<div style="font-size:40px;">👗</div>'
      + '<div style="font-size:15px;font-weight:700;color:var(--text2);margin-top:10px;">Füge zuerst Kleidung zu deinem Schrank hinzu!</div>'
      + '</div>';
    return;
  }

  _kiLoadingActive = true;
  _kiSuggestionsLoaded = false;

  // Immer Suggestions-Section zeigen beim Generieren
  _setKiSuggestionsVisible(true);

  // Spinner ins suggestions-div schreiben (placeholder könnte nach erstem Erfolg fehlen)
  var spinMsg = customDesc ? 'KI erstellt deinen Wunsch-Look…' : 'KI analysiert deinen Kleiderschrank…';
  var spinnerHtml = '<div id="ki-ai-placeholder" style="text-align:center;padding:32px 16px 8px;">'
    + '<div style="font-size:40px;animation:aiSpin 2s linear infinite;display:inline-block;">✨</div>'
    + '<div style="font-size:15px;font-weight:700;color:var(--text2);margin-top:14px;">' + spinMsg + '</div>'
    + '<div style="font-size:12px;color:var(--text2);margin-top:6px;">Einen Moment bitte</div>'
    + '</div>';
  if (suggestions) suggestions.innerHTML = spinnerHtml;
  // placeholder neu referenzieren
  placeholder = document.getElementById('ki-ai-placeholder');
  // Scroll to top of KI suggestions
  var kiScroll = document.getElementById('ki-scroll');
  if (kiScroll) kiScroll.scrollTop = 0;

  var wardrobeDesc = 'Mein Kleiderschrank: ' + wardrobe.slice(0, 12).map(function(item) {
    var parts = [item.name || item.type || 'Kleidungsstück'];
    if (item.brand) parts.push('(' + item.brand + ')');
    if (item.color) parts.push('in ' + item.color);
    return parts.join(' ');
  }).join(', ');
  var description = customDesc ? customDesc + '\n' + wardrobeDesc : wardrobeDesc;

  generateOutfitsWithGemini(description, colContext || null, null, null).then(function(outfits) {
    _kiSuggestionsLoaded = true;
    _kiLoadingActive = false;
    if (placeholder) placeholder.style.display = 'none';

    if (suggestions && Array.isArray(outfits)) {
      suggestions.innerHTML = outfits.map(function(outfit) {
        var id = _regOutfit(outfit);
        var fav = _isFav(id);
        var items = [].concat(outfit.items || []).sort(function(a, b) { return _clothingOrder(a) - _clothingOrder(b); });
        var itemsHtml = items.slice(0, 6).map(function(item) {
          var photo = _findWardrobePhoto(item.name);
          var photoStyle = photo ? 'background-image:url(\'' + photo + '\');background-size:cover;background-position:center;font-size:0;' : '';
          return '<div class="outfit-item-row">'
            + '<div class="outfit-item-photo" style="' + photoStyle + '">' + (photo ? '' : (item.emoji || '👕')) + '</div>'
            + '<div class="outfit-item-row-name">' + (item.name || '') + '</div>'
            + '</div>';
        }).join('');
        return '<div class="swipe-wrapper" data-swipe-id="' + _escAttr(id) + '" data-swipe-type="suggestion">'
          + '<div class="swipe-delete-bg"><div class="swipe-delete-bg-icon">🗑️</div><div class="swipe-delete-bg-label">Löschen</div></div>'
          + '<div class="swipe-inner outfit-card-ki">'
          + '<div class="outfit-card-header">'
          + '<div><div class="outfit-card-name">' + (outfit.name || 'Outfit') + '</div>'
          + '<div class="outfit-card-style">' + (outfit.style || '') + '</div></div>'
          + '<div style="display:flex;align-items:center;gap:8px;">'
          + '<span class="match-badge">' + (outfit.match || 90) + '% ✅</span>'
          + '<button class="heart-btn" data-heart-id="' + _escAttr(id) + '" onclick="_toggleFav(\'' + id + '\', this)">' + (fav ? '🩷' : '🤍') + '</button>'
          + '</div></div>'
          + '<div class="outfit-items-vertical">' + itemsHtml + '</div>'
          + '<button class="outfit-save-btn" onclick="_openSaveModal(\'' + id + '\')">💾 Speichern</button>'
          + '</div></div>';
      }).join('');
      var aiSug = document.getElementById('ki-ai-suggestions');
      if (aiSug) _initSwipeToDelete(aiSug);
    }
  }).catch(function(err) {
    _kiLoadingActive = false;
    if (placeholder) {
      placeholder.style.display = 'block';
      placeholder.innerHTML = '<div style="text-align:center;padding:32px 16px 8px;">'
        + '<div style="font-size:36px;">⚠️</div>'
        + '<div style="font-size:14px;font-weight:700;color:var(--text2);margin-top:10px;">' + (err.message || 'Fehler beim Laden') + '</div>'
        + '<button onclick="_autoLoadKiSuggestions(true)" style="margin-top:14px;background:var(--purple);color:white;border:none;border-radius:14px;padding:11px 24px;font-size:14px;font-weight:700;cursor:pointer;">Erneut versuchen</button>'
        + '</div>';
    }
  });
}


// ── Inspo Modal ─────────────────────────────────────────────────────────────
var _inspoData = null;
var _inspoSelectedCollection = null;

function _openInspoModal(btn) {
  var card = btn.closest('.post-card-new');
  if (!card) return;
  _inspoData = {
    name: card.getAttribute('data-post-name') || '',
    avatarEmoji: card.getAttribute('data-post-avatar') || '👤',
    avatarBg: card.getAttribute('data-post-bg') || '#eee',
    outfitName: card.getAttribute('data-post-title') || 'Outfit',
    items: (function() { try { return JSON.parse(card.getAttribute('data-post-items') || '[]'); } catch(e) { return []; } })(),
    btn: btn
  };
  _inspoSelectedCollection = null;
  _renderInspoHeader();
  _renderInspoCollections();
  var wrap = document.getElementById('inspo-new-input-wrap');
  var newBtn = document.getElementById('inspo-new-toggle-btn');
  if (wrap) wrap.style.display = 'none';
  if (newBtn) newBtn.style.display = 'flex';
  var inp = document.getElementById('inspo-new-name');
  if (inp) inp.value = '';
  var overlay = document.getElementById('inspo-modal-overlay');
  if (overlay) overlay.classList.add('open');
}

function _closeInspoModal() {
  var overlay = document.getElementById('inspo-modal-overlay');
  if (overlay) overlay.classList.remove('open');
}

function _closeInspoModalOutside(e) {
  if (e.target === document.getElementById('inspo-modal-overlay')) _closeInspoModal();
}

function _renderInspoHeader() {
  var header = document.getElementById('inspo-modal-header');
  if (!header || !_inspoData) return;
  var d = _inspoData;
  var itemsHtml = d.items.slice(0, 5).map(function(it) {
    return '<div class="outfit-chip-item"><span>' + (it.emoji || '👕') + '</span> ' + (it.name || '') + '</div>';
  }).join('');
  header.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
    + '<div style="width:38px;height:38px;border-radius:50%;background:' + d.avatarBg + ';display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">' + d.avatarEmoji + '</div>'
    + '<div><div style="font-size:13px;font-weight:700;color:var(--text2);">Von</div>'
    + '<div style="font-size:15px;font-weight:800;color:var(--text);">' + d.name + '</div></div>'
    + '</div>'
    + '<div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:6px;">"' + d.outfitName + '"</div>'
    + '<div class="outfit-chips" style="margin-bottom:14px;">' + itemsHtml + '</div>'
    + '<div style="height:1px;background:var(--purple-border);margin-bottom:14px;"></div>'
    + '<div style="font-size:12px;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">In welchem Ordner speichern?</div>';
}

function _renderInspoCollections() {
  var list = document.getElementById('inspo-modal-list');
  if (!list) return;
  var defaults = ['☀️ Sommer Looks', '💼 Business', '🎉 Party Nights'];
  var userCols = _getCollections().filter(function(c) { return defaults.indexOf(c) < 0; });
  var cols = [{ key: '__favoriten__', label: '❤️ Favoriten' }]
    .concat(defaults.concat(userCols).map(function(c) { return { key: c, label: c }; }));
  list.innerHTML = cols.map(function(col) {
    var sel = _inspoSelectedCollection === col.key;
    return '<div class="inspo-col-item' + (sel ? ' selected' : '') + '" data-inspo-col="' + _escAttr(col.key) + '">'
      + '<div class="inspo-col-name">' + col.label + '</div>'
      + (sel ? '<span class="inspo-col-check">✓</span>' : '')
      + '</div>';
  }).join('');
}

function _selectInspoCollection(key) {
  _inspoSelectedCollection = (_inspoSelectedCollection === key) ? null : key;
  _renderInspoCollections();
}

function _toggleInspoNewFolder() {
  var wrap = document.getElementById('inspo-new-input-wrap');
  var btn = document.getElementById('inspo-new-toggle-btn');
  var visible = wrap && wrap.style.display !== 'none';
  if (wrap) wrap.style.display = visible ? 'none' : 'block';
  if (btn) btn.style.display = visible ? 'flex' : 'none';
  if (!visible) setTimeout(function() { var n = document.getElementById('inspo-new-name'); if (n) n.focus(); }, 80);
}

function _confirmInspoNewFolder() {
  var input = document.getElementById('inspo-new-name');
  var name = input ? input.value.trim() : '';
  if (!name) { if (input) input.focus(); return; }
  _doSaveInspo(name);
}

function _confirmInspoSave() {
  // Check if new folder input is visible and has content
  var wrap = document.getElementById('inspo-new-input-wrap');
  if (wrap && wrap.style.display !== 'none') {
    _confirmInspoNewFolder();
    return;
  }
  if (!_inspoSelectedCollection) {
    _showToast('Bitte einen Ordner auswählen');
    return;
  }
  _doSaveInspo(_inspoSelectedCollection);
}

function _doSaveInspo(collectionName) {
  if (!_inspoData) return;
  var outfit = {
    name: _inspoData.outfitName,
    style: 'Inspo',
    match: 95,
    items: _inspoData.items,
    isInspo: true,
    inspoFrom: _inspoData.name,
    inspoAvatar: _inspoData.avatarEmoji,
    inspoAvatarBg: _inspoData.avatarBg,
    kollektionen: []
  };
  outfit.id = 'inspo_' + _outfitId(outfit) + '_' + Date.now().toString(36).slice(-4);
  _saveOutfitToCollection(collectionName, outfit);
  if (_inspoData.btn) {
    _inspoData.btn.classList.add('saved');
    _inspoData.btn.textContent = '💡 Gespeichert ✓';
  }
  var displayName = collectionName === '__favoriten__' ? 'Favoriten' : collectionName;
  _closeInspoModal();
  _showToast('✅ Inspo in ' + displayName + ' gespeichert!');
}

function _createMyVersion(id) {
  var outfit = _kiOutfitRegistry[id] || _loadOutfits().find(function(o) { return o.id === id; });
  if (!outfit) return;
  var inspoDesc = 'Erstelle meine eigene Version von diesem Inspo-Outfit'
    + (outfit.inspoFrom ? ' von ' + outfit.inspoFrom : '') + ': "'
    + (outfit.name || 'Outfit') + '". '
    + 'Die Original-Items: ' + (outfit.items || []).map(function(i) { return i.name; }).join(', ')
    + '. Kombiniere es aus meinem eigenen Schrank.';
  // Close outfit panel
  _closeOutfitDetail();
  // Navigate to KI Styling
  var kiNav = document.getElementById('nav-ki');
  if (kiNav) kiNav.click();
  // Short delay then trigger generation
  setTimeout(function() {
    _autoLoadKiSuggestions(true, inspoDesc, null);
  }, 300);
}

// ══════════════════════════════════════════════════════════════════════════════
// NEUER BEITRAG — Modal, Wardrobe Pills, Feed-Insertion, Item-Detail
// ══════════════════════════════════════════════════════════════════════════════

var _newPostSelectedItems = [];
var _newPostImageDataUrl = null;
var _newPostVisibility = 'friends';

function _openNewPostModal(outfitId) {
  _newPostSelectedItems = [];
  _newPostImageDataUrl = null;
  _newPostVisibility = 'friends';

  // Outfit vorausfüllen (optional)
  var preOutfit = null;
  if (outfitId) {
    preOutfit = _kiOutfitRegistry[outfitId] || _loadOutfits().find(function(o) { return o.id === outfitId; });
  }

  var caption = document.getElementById('new-post-caption');
  if (caption) caption.value = (preOutfit && preOutfit.name) ? preOutfit.name : '';

  var imgPreview = document.getElementById('new-post-img-preview');
  if (imgPreview) { imgPreview.src = ''; imgPreview.style.display = 'none'; }
  var imgRemoveBtn = document.getElementById('new-post-img-remove-btn');
  if (imgRemoveBtn) imgRemoveBtn.style.display = 'none';
  var imgPlaceholder = document.getElementById('new-post-img-placeholder');
  if (imgPlaceholder) imgPlaceholder.style.display = 'flex';
  var camInput = document.getElementById('new-post-camera-input');
  if (camInput) camInput.value = '';
  var galInput = document.getElementById('new-post-gallery-input');
  if (galInput) galInput.value = '';

  _selectNewPostVis('friends');
  _renderNewPostWardrobePills(preOutfit);

  var overlay = document.getElementById('new-post-modal-overlay');
  if (overlay) overlay.classList.add('open');
}

function _closeNewPostModal() {
  var overlay = document.getElementById('new-post-modal-overlay');
  if (overlay) overlay.classList.remove('open');
}

function _closeNewPostModalOutside(e) {
  if (e.target && e.target.id === 'new-post-modal-overlay') _closeNewPostModal();
}

function _handleNewPostImg(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    _newPostImageDataUrl = ev.target.result;
    var imgPreview = document.getElementById('new-post-img-preview');
    if (imgPreview) { imgPreview.src = _newPostImageDataUrl; imgPreview.style.display = 'block'; }
    var imgPlaceholder = document.getElementById('new-post-img-placeholder');
    if (imgPlaceholder) imgPlaceholder.style.display = 'none';
    var imgRemoveBtn = document.getElementById('new-post-img-remove-btn');
    if (imgRemoveBtn) imgRemoveBtn.style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

function _removeNewPostImg() {
  _newPostImageDataUrl = null;
  var imgPreview = document.getElementById('new-post-img-preview');
  if (imgPreview) { imgPreview.src = ''; imgPreview.style.display = 'none'; }
  var imgPlaceholder = document.getElementById('new-post-img-placeholder');
  if (imgPlaceholder) imgPlaceholder.style.display = 'flex';
  var imgRemoveBtn = document.getElementById('new-post-img-remove-btn');
  if (imgRemoveBtn) imgRemoveBtn.style.display = 'none';
}

function _selectNewPostVis(vis) {
  _newPostVisibility = vis;
  var fb = document.getElementById('new-post-vis-friends');
  var pb = document.getElementById('new-post-vis-public');
  if (fb) fb.classList.toggle('active', vis === 'friends');
  if (pb) pb.classList.toggle('active', vis === 'public');
}

function _renderNewPostWardrobePills(preOutfit) {
  var wrap = document.getElementById('new-post-wardrobe-pills');
  if (!wrap) return;
  var wardrobe = loadWardrobe();
  if (wardrobe.length === 0) {
    wrap.innerHTML = '<div class="wardrobe-pills-empty">Noch keine Kleidungsstücke im Schrank.<br>Füge zuerst Items über "Scannen" hinzu!</div>';
    return;
  }
  // Outfit-Items nach Namen matchen und vorauswählen
  var preNames = [];
  if (preOutfit && preOutfit.items) {
    preNames = preOutfit.items.map(function(it) { return (it.name || '').toLowerCase().trim(); });
  }
  // _newPostSelectedItems mit passenden Wardrobe-Items vorausfüllen
  _newPostSelectedItems = [];
  wardrobe.forEach(function(item, idx) {
    var key = idx + '_' + (item.name || '');
    var itemName = (item.name || '').toLowerCase().trim();
    if (preNames.length > 0 && preNames.indexOf(itemName) !== -1) {
      item._key = key;
      _newPostSelectedItems.push(item);
    }
  });
  wrap.innerHTML = wardrobe.map(function(item, idx) {
    var key = idx + '_' + (item.name || '');
    var selected = _newPostSelectedItems.some(function(s) { return s._key === key; });
    return '<div class="wardrobe-pill' + (selected ? ' selected' : '') + '" data-wpi="' + _escAttr(key) + '" data-wpi-idx="' + idx + '">'
      + (item.emoji || '👕') + ' ' + (item.name || 'Item')
      + '</div>';
  }).join('');
}

function _submitNewPost() {
  var caption = ((document.getElementById('new-post-caption') || {}).value || '').trim();
  var outfitItems = _newPostSelectedItems.map(function(item) {
    return { emoji: item.emoji || '👕', name: item.name || 'Item', color: item.color || '', type: item.type || '', season: item.season || '', colorHex: item.colorHex || '' };
  });

  var posts = _loadMyPosts();
  var newPost = {
    id: 'post_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    outfitId: null,
    outfitName: caption || 'Mein Look',
    outfitItems: outfitItems,
    caption: caption,
    visibility: _newPostVisibility,
    imageDataUrl: _newPostImageDataUrl || null,
    likes: 0,
    timestamp: Date.now()
  };
  posts.unshift(newPost);
  _storeMyPosts(posts);

  _closeNewPostModal();
  _showToast('✅ Beitrag wurde gepostet!');
  _renderProfilePosts();
  _insertOwnPostIntoFeed(newPost);
  _incrementStreak();

  var profilBtn = document.getElementById('nav-profil');
  if (profilBtn) profilBtn.click();
}

// ── Build & insert own posts into feed ───────────────────────────────────────
function _buildOotdBadge(post) {
  var s = _loadStreak();
  var today = _getTodayKey();
  if (post.timestamp && s.current >= 1 && s.lastPostDate === today) {
    var postDate = new Date(post.timestamp).toISOString().slice(0,10);
    if (postDate === today) {
      return '<div class="ootd-badge">📅 OOTD · Tag ' + s.current + '</div>';
    }
  }
  return '';
}

function _buildOwnFeedPostCard(post) {
  var feedId = post.id;
  var visIcon = post.visibility === 'public' ? '🌍' : '🔒';
  var imgHtml = post.imageDataUrl
    ? '<img class="own-post-feed-img" src="' + _escAttr(post.imageDataUrl) + '" alt="" />'
    : '<div class="own-post-feed-emoji">' + ((post.outfitItems && post.outfitItems[0]) ? (post.outfitItems[0].emoji || '✨') : '✨') + '</div>';
  var timeStr = _formatCommentTime(post.timestamp);
  var itemsHtml = (post.outfitItems || []).slice(0, 5).map(function(it) {
    var itemJson = _escAttr(JSON.stringify({ name: it.name, emoji: it.emoji, color: it.color, type: it.type, season: it.season }));
    return '<div class="outfit-chip-item" data-feed-item="' + itemJson + '"><span>' + (it.emoji || '👕') + '</span> ' + (it.name || '') + '</div>';
  }).join('');
  return '<div class="post-card-new" data-feed-id="' + _escAttr(feedId) + '" data-own-post-id="' + _escAttr(feedId) + '" data-post-name="Anna Müller" data-post-avatar="👩‍🦱" data-post-bg="#D8CFFF" data-post-title="' + _escAttr(post.outfitName || 'Mein Look') + '" data-post-items="' + _escAttr(JSON.stringify(post.outfitItems || [])) + '">'
    + '<div class="post-head">'
    + '<div class="post-avatar-wrap"><div class="post-avatar-new" style="background:#D8CFFF;">👩‍🦱</div><div class="avatar-badge">' + visIcon + '</div></div>'
    + '<div class="post-meta"><div class="post-name-new">Anna</div><div class="post-time-new">' + timeStr + '</div></div>'
    + '<button class="post-more-btn" data-more-post="' + _escAttr(feedId) + '">···</button>'
    + '</div>'
    + '<div class="post-more-menu" id="more-menu-' + _escAttr(feedId) + '">'
    + '<button class="post-more-item" onclick="_editPost(\'' + _escAttr(feedId) + '\');_closePostMoreMenu()">✏️ Bearbeiten</button>'
    + '<button class="post-more-item" onclick="_togglePostVisibilityFromFeed(\'' + _escAttr(feedId) + '\')">🔒 Sichtbarkeit ändern</button>'
    + '<button class="post-more-item danger" onclick="_deletePostFromFeed(\'' + _escAttr(feedId) + '\')">🗑️ Löschen</button>'
    + '</div>'
    + imgHtml
    + _buildOotdBadge(post)
    + (post.caption ? '<div class="post-title-new">' + post.caption.replace(/</g, '&lt;') + '</div>' : '')
    + (itemsHtml ? '<div class="outfit-chips">' + itemsHtml + '</div>' : '')
    + '<div class="post-actions-new">'
    + '<button class="post-act-like" data-feed-like="' + _escAttr(feedId) + '"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span class="like-cnt">0</span></button>'
    + '<button class="post-act-comment" data-feed-comment="' + _escAttr(feedId) + '"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="comment-cnt">0</span></button>'
    + '<button class="post-act-share"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>'
    + '<button class="inspo-btn" onclick="_openInspoModal(this)">💡 Inspo ✨</button>'
    + '</div>'
    + '</div>';
}

// ── Feed Follow Button ────────────────────────────────────────────────────────
function _restoreFeedFollowStates() {
  var states = _loadFollowStates();
  var defaults = { sophie: 'friends', lara: 'following', lena: 'friends', marie: 'not-following' };
  document.querySelectorAll('[data-feed-follow]').forEach(function(btn) {
    var id = btn.getAttribute('data-feed-follow');
    var state = states[id] || defaults[id] || 'not-following';
    _applyFeedFollowBtn(btn, state);
  });
}

function _applyFeedFollowBtn(btn, state) {
  btn.className = 'feed-follow-btn ' + state;
  if (state === 'friends')      { btn.textContent = '👥 Freunde'; }
  else if (state === 'following') { btn.textContent = '✓ Gefolgt'; }
  else                           { btn.textContent = '➕ Folgen'; }
}

function _toggleFeedFollow(friendId, btn) {
  var states = _loadFollowStates();
  var defaults = { sophie: 'friends', lara: 'following', lena: 'friends', marie: 'not-following' };
  var cur = states[friendId] || defaults[friendId] || 'not-following';
  var next = cur === 'not-following' ? 'following' : cur === 'following' ? 'not-following' : 'following';
  states[friendId] = next;
  _saveFollowStates(states);
  // Update all follow buttons for this friend (feed + search)
  document.querySelectorAll('[data-feed-follow="' + friendId + '"]').forEach(function(b) {
    _applyFeedFollowBtn(b, next);
  });
  _showToast(next === 'following'
    ? '✅ Du folgst jetzt ' + (_friendProfilesData[friendId] ? _friendProfilesData[friendId].name : friendId)
    : '❌ Entfolgt');
}

// ── Own post "···" Menu ───────────────────────────────────────────────────────
var _activeMoreMenu = null;

function _closePostMoreMenu() {
  if (_activeMoreMenu) {
    _activeMoreMenu.classList.remove('show');
    _activeMoreMenu = null;
  }
}

function _togglePostMoreMenu(postId, btn) {
  var menu = document.getElementById('more-menu-' + postId);
  if (!menu) return;
  if (_activeMoreMenu && _activeMoreMenu !== menu) _closePostMoreMenu();
  menu.classList.toggle('show');
  _activeMoreMenu = menu.classList.contains('show') ? menu : null;
}

function _togglePostVisibilityFromFeed(postId) {
  _closePostMoreMenu();
  var posts = _loadMyPosts();
  var post = posts.find(function(p) { return p.id === postId; });
  if (!post) return;
  post.visibility = post.visibility === 'public' ? 'friends' : 'public';
  _storeMyPosts(posts);
  _insertAllOwnPostsIntoFeed();
  _renderProfilePosts();
  _showToast(post.visibility === 'public' ? '🌍 Jetzt öffentlich' : '🔒 Nur für Freunde');
}

function _deletePostFromFeed(postId) {
  _closePostMoreMenu();
  var posts = _loadMyPosts();
  var filtered = posts.filter(function(p) { return p.id !== postId; });
  _storeMyPosts(filtered);
  var card = document.querySelector('[data-own-post-id="' + postId + '"]');
  if (card) card.remove();
  _renderProfilePosts();
  _showToast('🗑️ Post gelöscht');
}

function _insertOwnPostIntoFeed(post) {
  var panelId = post.visibility === 'public' ? 'panel-entdecken' : 'panel-freunde-feed';
  var panel = document.getElementById(panelId);
  if (!panel) return;
  var existing = panel.querySelector('[data-own-post-id="' + post.id + '"]');
  if (existing) existing.remove();
  var temp = document.createElement('div');
  temp.innerHTML = _buildOwnFeedPostCard(post);
  var card = temp.firstElementChild;
  if (card) panel.insertBefore(card, panel.firstChild);
}

function _insertAllOwnPostsIntoFeed() {
  document.querySelectorAll('[data-own-post-id]').forEach(function(el) { el.remove(); });
  var posts = _loadMyPosts();
  posts.slice().reverse().forEach(function(post) { _insertOwnPostIntoFeed(post); });
  _restoreFeedLikeStates();
  _restoreFeedCommentCounts();
}

// ── Item Detail Popup ─────────────────────────────────────────────────────────
function _showItemDetailPopup(itemData, showShop) {
  var iconEl = document.getElementById('item-detail-icon');
  var nameEl = document.getElementById('item-detail-name');
  var subEl = document.getElementById('item-detail-sub');
  var chipsEl = document.getElementById('item-detail-chips');
  var shopBtn = document.getElementById('item-shop-btn');

  if (iconEl) iconEl.textContent = itemData.emoji || '👕';
  if (nameEl) nameEl.textContent = itemData.name || 'Item';
  var subParts = [];
  if (itemData.type) subParts.push(itemData.type);
  if (itemData.color) subParts.push(itemData.color);
  if (subEl) subEl.textContent = subParts.join(' · ') || '';

  var chips = [];
  if (itemData.season) chips.push(itemData.season);
  if (itemData.color) chips.push(itemData.color);
  if (itemData.type) chips.push(itemData.type);
  if (chipsEl) chipsEl.innerHTML = chips.map(function(t) { return '<span class="item-detail-chip">' + t + '</span>'; }).join('');
  if (shopBtn) shopBtn.style.display = showShop ? 'block' : 'none';

  var overlay = document.getElementById('item-detail-overlay');
  if (overlay) overlay.classList.add('open');
}

function _closeItemDetailPopup() {
  var overlay = document.getElementById('item-detail-overlay');
  if (overlay) overlay.classList.remove('open');
}

// ══════════════════════════════════════════════════════════════════════════════
// KOMMENTAR SYSTEM — stylesync_comments, stylesync_post_likes, stylesync_comment_likes
// ══════════════════════════════════════════════════════════════════════════════

// ── Storage ───────────────────────────────────────────────────────────────────
function _loadAllComments() {
  try { return JSON.parse(localStorage.getItem('stylesync_comments') || '{}'); } catch(e) { return {}; }
}
function _storeAllComments(data) {
  localStorage.setItem('stylesync_comments', JSON.stringify(data));
}
function _loadPostLikes() {
  try { return JSON.parse(localStorage.getItem('stylesync_post_likes') || '{}'); } catch(e) { return {}; }
}
function _storePostLikes(data) {
  localStorage.setItem('stylesync_post_likes', JSON.stringify(data));
}
function _loadCommentLikes() {
  try { return JSON.parse(localStorage.getItem('stylesync_comment_likes') || '{}'); } catch(e) { return {}; }
}
function _storeCommentLikes(data) {
  localStorage.setItem('stylesync_comment_likes', JSON.stringify(data));
}

// ── Seed comments (only once) ─────────────────────────────────────────────────
function _initSeedComments() {
  if (localStorage.getItem('stylesync_comments_seeded')) return;
  var now = Date.now();
  var seed = {
    'feed_sophie_fruehlings_chic': [
      { id:'sc_1a', text:'So ein toller Look! 🌸', author:'Lena M.', authorEmoji:'🧒', authorBg:'#FFE0B2', timestamp: now - 7200000, likes:3, isOwn:false },
      { id:'sc_1b', text:'Das Seidentop ist perfekt dazu ✨', author:'Marie K.', authorEmoji:'👩', authorBg:'#FFF9C4', timestamp: now - 5400000, likes:1, isOwn:false },
      { id:'sc_1c', text:'Wow, wo hast du die Mules her? 😍', author:'Lara D.', authorEmoji:'👩‍🦳', authorBg:'#FFF9C4', timestamp: now - 3600000, likes:2, isOwn:false }
    ],
    'feed_lara_festival_ready': [
      { id:'sc_2a', text:'Absolute Festival Queen! 🎪', author:'Sophie K.', authorEmoji:'👩‍🦰', authorBg:'#FFE0B2', timestamp: now - 86400000, likes:8, isOwn:false },
      { id:'sc_2b', text:'Die Cowboy-Stiefel machen alles!!! 🤠', author:'Lena M.', authorEmoji:'🧒', authorBg:'#FFE0B2', timestamp: now - 72000000, likes:5, isOwn:false },
      { id:'sc_2c', text:'Liebe diesen Look so sehr 🔥', author:'Marie K.', authorEmoji:'👩', authorBg:'#FFF9C4', timestamp: now - 50000000, likes:4, isOwn:false }
    ],
    'feed_lena_herbst_layering': [
      { id:'sc_3a', text:'Perfekter Herbst-Vibe! 🍂', author:'Sophie K.', authorEmoji:'👩‍🦰', authorBg:'#FFE0B2', timestamp: now - 7200000, likes:2, isOwn:false },
      { id:'sc_3b', text:'Die Lederjacke ist ein Traum 🧥', author:'Lara D.', authorEmoji:'👩‍🦳', authorBg:'#FFF9C4', timestamp: now - 5400000, likes:1, isOwn:false }
    ],
    'feed_marie_sommer_chic': [
      { id:'sc_4a', text:'Sommertraum! ☀️', author:'Lena M.', authorEmoji:'🧒', authorBg:'#FFE0B2', timestamp: now - 18000000, likes:6, isOwn:false },
      { id:'sc_4b', text:'Das Kleid ist wunderschön! 👗', author:'Sophie K.', authorEmoji:'👩‍🦰', authorBg:'#FFE0B2', timestamp: now - 14400000, likes:3, isOwn:false },
      { id:'sc_4c', text:'Wo kaufst du sowas? 😍', author:'Lara D.', authorEmoji:'👩‍🦳', authorBg:'#FFF9C4', timestamp: now - 10800000, likes:2, isOwn:false }
    ]
  };
  _storeAllComments(seed);
  localStorage.setItem('stylesync_comments_seeded', '1');
}

// ── Comment Sheet State ───────────────────────────────────────────────────────
var _commentPostId = null;
var _commentIsOwner = false;
var _longPressTimer = null;
var _activeDeletePopup = null;

// ── Open / Close ──────────────────────────────────────────────────────────────
function _openCommentSheet(postId, isOwner) {
  _commentPostId = postId;
  _commentIsOwner = !!isOwner;
  _renderCommentList();
  var overlay = document.getElementById('comment-sheet-overlay');
  if (overlay) overlay.classList.add('open');
  setTimeout(function() {
    var input = document.getElementById('comment-input');
    if (input) input.focus();
  }, 350);
}

function _closeCommentSheet() {
  var overlay = document.getElementById('comment-sheet-overlay');
  if (overlay) overlay.classList.remove('open');
  _commentPostId = null;
  _hideActiveDeletePopup();
}

function _closeCommentSheetOutside(e) {
  if (e.target && e.target.id === 'comment-sheet-overlay') _closeCommentSheet();
}

// ── Render comment list ───────────────────────────────────────────────────────
function _renderCommentList() {
  var list = document.getElementById('comment-list');
  var titleEl = document.getElementById('comment-sheet-title');
  if (!list || !_commentPostId) return;

  var all = _loadAllComments();
  var comments = all[_commentPostId] || [];
  var commentLikes = _loadCommentLikes();

  if (titleEl) titleEl.textContent = '💬 Kommentare (' + comments.length + ')';

  if (comments.length === 0) {
    list.innerHTML = '<div class="comment-empty">Noch keine Kommentare.<br>Sei der Erste! 💬</div>';
    return;
  }

  list.innerHTML = comments.map(function(c) {
    var liked = !!commentLikes[c.id];
    var likeCount = (c.likes || 0) + (liked ? 1 : 0);
    var canDelete = c.isOwn || _commentIsOwner;
    return '<div class="comment-item" data-comment-id="' + _escAttr(c.id) + '">'
      + '<div class="comment-avatar" style="background:' + (c.authorBg || '#EDE9FF') + ';">' + (c.authorEmoji || '👤') + '</div>'
      + '<div class="comment-body">'
      + '<div class="comment-name">' + (c.author || 'Nutzer') + '</div>'
      + '<div class="comment-text">' + (c.text || '').replace(/</g, '&lt;') + '</div>'
      + '<div class="comment-meta">'
      + '<span class="comment-time">' + _formatCommentTime(c.timestamp) + '</span>'
      + '<button class="comment-like-btn' + (liked ? ' liked' : '') + '" data-clid="' + _escAttr(c.id) + '">❤️ ' + likeCount + '</button>'
      + '</div>'
      + '</div>'
      + (canDelete ? '<div class="comment-delete-popup" id="cdp_' + _escAttr(c.id) + '"><div class="comment-delete-item" data-del-comment="' + _escAttr(c.id) + '">🗑️ Löschen</div></div>' : '')
      + '</div>';
  }).join('');
}

// ── Send comment ──────────────────────────────────────────────────────────────
function _sendComment() {
  var input = document.getElementById('comment-input');
  var text = input ? input.value.trim() : '';
  if (!text || !_commentPostId) return;

  var all = _loadAllComments();
  if (!all[_commentPostId]) all[_commentPostId] = [];

  var newComment = {
    id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
    text: text,
    author: 'Anna Müller',
    authorEmoji: '👩‍🦱',
    authorBg: '#D8CFFF',
    timestamp: Date.now(),
    likes: 0,
    isOwn: true
  };
  all[_commentPostId].push(newComment);
  _storeAllComments(all);

  if (input) input.value = '';
  _renderCommentList();
  _updateCommentCountInFeed(_commentPostId, all[_commentPostId].length);

  // Scroll to bottom
  setTimeout(function() {
    var list = document.getElementById('comment-list');
    if (list) list.scrollTop = list.scrollHeight;
  }, 50);
}

// ── Like comment ──────────────────────────────────────────────────────────────
function _toggleCommentLike(commentId, btn) {
  var commentLikes = _loadCommentLikes();
  var wasLiked = !!commentLikes[commentId];
  if (wasLiked) {
    delete commentLikes[commentId];
  } else {
    commentLikes[commentId] = true;
  }
  _storeCommentLikes(commentLikes);

  // Update the button
  var all = _loadAllComments();
  var comments = _commentPostId ? (all[_commentPostId] || []) : [];
  var comment = comments.find(function(c) { return c.id === commentId; });
  var baseLikes = comment ? (comment.likes || 0) : 0;
  var liked = !!commentLikes[commentId];
  if (btn) {
    btn.textContent = '❤️ ' + (baseLikes + (liked ? 1 : 0));
    btn.classList.toggle('liked', liked);
  }
}

// ── Delete comment ────────────────────────────────────────────────────────────
function _deleteCommentById(commentId) {
  if (!_commentPostId) return;
  var all = _loadAllComments();
  if (!all[_commentPostId]) return;
  all[_commentPostId] = all[_commentPostId].filter(function(c) { return c.id !== commentId; });
  _storeAllComments(all);
  _hideActiveDeletePopup();
  _renderCommentList();
  _updateCommentCountInFeed(_commentPostId, all[_commentPostId].length);
  _showToast('🗑️ Kommentar gelöscht');
}

// ── Toggle post like in feed ──────────────────────────────────────────────────
function _toggleFeedPostLike(postId, btn) {
  var likes = _loadPostLikes();
  var wasLiked = !!likes[postId];
  likes[postId] = !wasLiked;
  _storePostLikes(likes);

  var isNowLiked = likes[postId];
  if (btn) btn.classList.toggle('liked', isNowLiked);

  // Update counter in button
  var cntSpan = btn ? btn.querySelector('.like-cnt') : null;
  if (cntSpan) {
    var current = parseInt(cntSpan.textContent, 10) || 0;
    cntSpan.textContent = isNowLiked ? current + 1 : Math.max(0, current - 1);
  }
}

// ── Restore like state on page ────────────────────────────────────────────────
function _restoreFeedLikeStates() {
  var likes = _loadPostLikes();
  document.querySelectorAll('[data-feed-like]').forEach(function(btn) {
    var pid = btn.getAttribute('data-feed-like');
    if (likes[pid]) btn.classList.add('liked');
  });
}

// ── Update comment counter in feed ───────────────────────────────────────────
function _updateCommentCountInFeed(postId, count) {
  var btn = document.querySelector('[data-feed-comment="' + postId + '"]');
  if (btn) {
    var span = btn.querySelector('.comment-cnt');
    if (span) span.textContent = count;
  }
  // Also update in post detail if open
  var detailCntEl = document.getElementById('post-detail-comment-count');
  if (detailCntEl) detailCntEl.textContent = count;
}

// ── Share ────────────────────────────────────────────────────────────────────
var _feedPostMeta = {
  'feed_sophie_fruehlings_chic': { title: 'Frühlings-Chic', author: 'Sophie K.' },
  'feed_lara_festival_ready':    { title: 'Festival Ready',  author: 'Lara D.'   },
  'feed_lena_herbst_layering':   { title: 'Herbst-Layering', author: 'Lena M.'   },
  'feed_marie_sommer_chic':      { title: 'Sommer-Chic',     author: 'Marie K.'  }
};

function _loadShareCounts() {
  try { return JSON.parse(localStorage.getItem('stylesync_share_counts') || '{}'); } catch(e) { return {}; }
}
function _saveShareCounts(c) { localStorage.setItem('stylesync_share_counts', JSON.stringify(c)); }

function _restoreShareCounts() {
  var counts = _loadShareCounts();
  document.querySelectorAll('[data-feed-share]').forEach(function(btn) {
    var pid = btn.getAttribute('data-feed-share');
    var span = btn.querySelector('.share-cnt');
    if (span && counts[pid]) span.textContent = counts[pid];
  });
}

function _shareFeedPost(postId, btn) {
  var meta = _feedPostMeta[postId] || {};
  var title = meta.title || 'Outfit';
  var author = meta.author || '';
  var text = '✨ ' + title + ' von ' + author + '\nEntdeckt auf Closet App 👗';
  var url = window.location.href;

  function _afterShare() {
    var counts = _loadShareCounts();
    counts[postId] = (counts[postId] || 0) + 1;
    _saveShareCounts(counts);
    var span = btn.querySelector('.share-cnt');
    if (span) span.textContent = counts[postId];
    btn.classList.add('shared');
    setTimeout(function() { btn.classList.remove('shared'); }, 1200);
  }

  if (navigator.share) {
    navigator.share({ title: title, text: text, url: url })
      .then(_afterShare)
      .catch(function() {}); // Nutzer hat abgebrochen
  } else {
    // Fallback: in Zwischenablage kopieren
    var copyText = text + '\n' + url;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(copyText).then(function() {
        _showToast('📋 Link kopiert!');
        _afterShare();
      });
    } else {
      _showToast('📤 Teilen auf diesem Gerät nicht verfügbar');
    }
  }
}

// ── Also update all feed comment counts on load ───────────────────────────────
function _restoreFeedCommentCounts() {
  var all = _loadAllComments();
  document.querySelectorAll('[data-feed-comment]').forEach(function(btn) {
    var pid = btn.getAttribute('data-feed-comment');
    var comments = all[pid] || [];
    if (comments.length > 0) {
      var span = btn.querySelector('.comment-cnt');
      if (span) span.textContent = comments.length;
    }
  });
}

// ── Long press for delete popup ───────────────────────────────────────────────
function _hideActiveDeletePopup() {
  if (_activeDeletePopup) {
    _activeDeletePopup.classList.remove('show');
    _activeDeletePopup = null;
  }
}

function _showDeletePopupForComment(commentId) {
  _hideActiveDeletePopup();
  var popup = document.getElementById('cdp_' + commentId);
  if (popup) {
    popup.classList.add('show');
    _activeDeletePopup = popup;
  }
}

// ── Format timestamp ──────────────────────────────────────────────────────────
function _formatCommentTime(ts) {
  if (!ts) return '';
  var diff = Date.now() - ts;
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Gerade eben';
  if (mins < 60) return 'vor ' + mins + ' Min.';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return 'vor ' + hours + ' Std.';
  var days = Math.floor(hours / 24);
  return 'vor ' + days + ' Tag' + (days > 1 ? 'en' : '');
}

// ══════════════════════════════════════════════════════════════════════════════
// EIGENE POSTS — stylesync_my_posts
// Modell: { id, outfitId, outfitName, outfitItems, caption, visibility,
//           imageDataUrl, likes, timestamp }
// ══════════════════════════════════════════════════════════════════════════════

function _loadMyPosts() {
  try { return JSON.parse(localStorage.getItem('stylesync_my_posts') || '[]'); } catch (e) { return []; }
}
function _storeMyPosts(list) {
  localStorage.setItem('stylesync_my_posts', JSON.stringify(list));
}

// ── Post Modal State ──────────────────────────────────────────────────────────
var _postModalOutfitId = null;
var _postModalImageDataUrl = null;
var _postModalVisibility = 'friends'; // 'friends' | 'public'
var _postEditId = null; // wenn null → neuer Post, sonst Edit-Modus

function _openPostModal(outfitId) {
  _postModalOutfitId = outfitId;
  _postModalImageDataUrl = null;
  _postModalVisibility = 'friends';
  _postEditId = null;

  // Outfit aus Registry laden
  var outfit = _kiOutfitRegistry[outfitId] || _loadOutfits().find(function(o) { return o.id === outfitId; });

  // Felder zurücksetzen
  var caption = document.getElementById('post-caption');
  if (caption) caption.value = '';
  var previewWrap = document.getElementById('post-img-preview-wrap');
  if (previewWrap) previewWrap.style.display = 'none';
  var imgRow = document.getElementById('post-img-btn-row');
  if (imgRow) imgRow.style.display = 'flex';
  var camInput = document.getElementById('post-camera-input');
  if (camInput) camInput.value = '';
  var galInput = document.getElementById('post-gallery-input');
  if (galInput) galInput.value = '';

  var title = document.getElementById('post-modal-title');
  if (title) title.textContent = '📤 Outfit posten';
  var confirmBtn = document.getElementById('post-modal-confirm-btn');
  if (confirmBtn) confirmBtn.textContent = '📤 Posten';

  // Sichtbarkeit
  _selectPostVis('friends');

  // Tags aus Outfit
  var tagsWrap = document.getElementById('post-modal-tags');
  if (tagsWrap) {
    var items = (outfit && outfit.items) ? outfit.items.slice(0, 6) : [];
    tagsWrap.innerHTML = items.length > 0
      ? items.map(function(it) { return '<div class="post-tag-chip">' + (it.emoji || '👕') + ' ' + (it.name || '') + '</div>'; }).join('')
      : '<div style="font-size:13px;color:var(--text2);">Keine Tags vorhanden</div>';
  }

  var overlay = document.getElementById('post-modal-overlay');
  if (overlay) overlay.classList.add('open');
}

function _openPostModalEdit(postId) {
  var posts = _loadMyPosts();
  var post = posts.find(function(p) { return p.id === postId; });
  if (!post) return;

  _postModalOutfitId = post.outfitId || null;
  _postModalImageDataUrl = post.imageDataUrl || null;
  _postModalVisibility = post.visibility || 'friends';
  _postEditId = postId;

  var caption = document.getElementById('post-caption');
  if (caption) caption.value = post.caption || '';

  // Bild
  var previewWrap = document.getElementById('post-img-preview-wrap');
  var imgRow = document.getElementById('post-img-btn-row');
  if (_postModalImageDataUrl) {
    var imgEl = document.getElementById('post-img-preview');
    if (imgEl) imgEl.src = _postModalImageDataUrl;
    if (previewWrap) previewWrap.style.display = 'block';
    if (imgRow) imgRow.style.display = 'none';
  } else {
    if (previewWrap) previewWrap.style.display = 'none';
    if (imgRow) imgRow.style.display = 'flex';
  }

  var title = document.getElementById('post-modal-title');
  if (title) title.textContent = '✏️ Post bearbeiten';
  var confirmBtn = document.getElementById('post-modal-confirm-btn');
  if (confirmBtn) confirmBtn.textContent = '💾 Speichern';

  _selectPostVis(post.visibility || 'friends');

  var tagsWrap = document.getElementById('post-modal-tags');
  if (tagsWrap) {
    var items = post.outfitItems || [];
    tagsWrap.innerHTML = items.length > 0
      ? items.map(function(it) { return '<div class="post-tag-chip">' + (it.emoji || '👕') + ' ' + (it.name || '') + '</div>'; }).join('')
      : '<div style="font-size:13px;color:var(--text2);">Keine Tags vorhanden</div>';
  }

  var overlay = document.getElementById('post-modal-overlay');
  if (overlay) overlay.classList.add('open');
}

function _closePostModal() {
  var overlay = document.getElementById('post-modal-overlay');
  if (overlay) overlay.classList.remove('open');
}
function _closePostModalOutside(e) {
  if (e.target && e.target.id === 'post-modal-overlay') _closePostModal();
}

function _selectPostVis(vis) {
  _postModalVisibility = vis;
  var fBtn = document.getElementById('post-vis-friends');
  var pBtn = document.getElementById('post-vis-public');
  if (fBtn) fBtn.classList.toggle('active', vis === 'friends');
  if (pBtn) pBtn.classList.toggle('active', vis === 'public');
}

function _handlePostImg(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    _postModalImageDataUrl = e.target.result;
    var imgEl = document.getElementById('post-img-preview');
    if (imgEl) imgEl.src = _postModalImageDataUrl;
    var previewWrap = document.getElementById('post-img-preview-wrap');
    if (previewWrap) previewWrap.style.display = 'block';
    var imgRow = document.getElementById('post-img-btn-row');
    if (imgRow) imgRow.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function _removePostImg() {
  _postModalImageDataUrl = null;
  var imgEl = document.getElementById('post-img-preview');
  if (imgEl) imgEl.src = '';
  var previewWrap = document.getElementById('post-img-preview-wrap');
  if (previewWrap) previewWrap.style.display = 'none';
  var imgRow = document.getElementById('post-img-btn-row');
  if (imgRow) imgRow.style.display = 'flex';
  var camInput = document.getElementById('post-camera-input');
  if (camInput) camInput.value = '';
  var galInput = document.getElementById('post-gallery-input');
  if (galInput) galInput.value = '';
}

function _confirmPost() {
  var caption = ((document.getElementById('post-caption') || {}).value || '').trim();
  var outfit = _kiOutfitRegistry[_postModalOutfitId] || _loadOutfits().find(function(o) { return o.id === _postModalOutfitId; });
  var posts = _loadMyPosts();

  if (_postEditId) {
    // Edit-Modus
    var existing = posts.find(function(p) { return p.id === _postEditId; });
    if (existing) {
      existing.caption = caption;
      existing.visibility = _postModalVisibility;
      if (_postModalImageDataUrl) existing.imageDataUrl = _postModalImageDataUrl;
    }
    _storeMyPosts(posts);
    _closePostModal();
    _showToast('✅ Post aktualisiert!');
    _renderProfilePosts();
    // Falls Post-Detail offen, aktualisieren
    if (_currentPostId === _postEditId) _openPostDetail(_postEditId);
  } else {
    // Neuer Post
    var newPost = {
      id: 'post_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      outfitId: _postModalOutfitId,
      outfitName: outfit ? (outfit.name || 'Outfit') : 'Outfit',
      outfitItems: outfit ? (outfit.items || []) : [],
      caption: caption,
      visibility: _postModalVisibility,
      imageDataUrl: _postModalImageDataUrl || null,
      likes: 0,
      timestamp: Date.now()
    };
    posts.unshift(newPost);
    _storeMyPosts(posts);
    _closePostModal();
    _showToast('📤 Post veröffentlicht!');
    _renderProfilePosts();
    // Zu Profil navigieren
    var profilBtn = document.getElementById('nav-profil');
    if (profilBtn) profilBtn.click();
  }
}

// ── Profil Posts rendern ──────────────────────────────────────────────────────
var _currentPostId = null;

function _renderProfilePosts() {
  var grid = document.getElementById('profil-posts-grid');
  var countEl = document.getElementById('profil-posts-count');
  var posts = _loadMyPosts();

  if (countEl) countEl.textContent = posts.length;

  if (!grid) return;

  if (posts.length === 0) {
    grid.innerHTML = '<div class="profil-posts-empty">'
      + '<div class="profil-posts-empty-icon">📤</div>'
      + '<div class="profil-posts-empty-title">Noch keine Posts</div>'
      + '<div class="profil-posts-empty-sub">Poste dein erstes Outfit!</div>'
      + '<button class="profil-posts-empty-btn" onclick="_openNewPostModal()">➕ Neuer Beitrag</button>'
      + '</div>';
    return;
  }

  grid.innerHTML = '<div class="profil-posts-grid">'
    + posts.map(function(post) {
        var visIcon = post.visibility === 'public' ? '🌍' : '🔒';
        var bgContent = post.imageDataUrl
          ? '<img class="profil-post-photo" src="' + _escAttr(post.imageDataUrl) + '" alt="" />'
          : '<div class="profil-post-bg">' + (post.outfitItems && post.outfitItems[0] ? (post.outfitItems[0].emoji || '✨') : '✨') + '</div>';
        return '<div class="profil-post-item" data-post-id="' + _escAttr(post.id) + '">'
          + bgContent
          + '<div class="profil-post-overlay">'
          + '<span class="profil-post-vis">' + visIcon + '</span>'
          + '<span class="profil-post-likes">❤️ ' + (post.likes || 0) + '</span>'
          + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}

function _openFirstPost() {
  // Kein konkretes Outfit — öffne leeres Post-Modal
  _postModalOutfitId = null;
  _postModalImageDataUrl = null;
  _postModalVisibility = 'friends';
  _postEditId = null;

  var caption = document.getElementById('post-caption');
  if (caption) caption.value = '';
  var previewWrap = document.getElementById('post-img-preview-wrap');
  if (previewWrap) previewWrap.style.display = 'none';
  var imgRow = document.getElementById('post-img-btn-row');
  if (imgRow) imgRow.style.display = 'flex';
  var title = document.getElementById('post-modal-title');
  if (title) title.textContent = '📤 Outfit posten';
  var confirmBtn = document.getElementById('post-modal-confirm-btn');
  if (confirmBtn) confirmBtn.textContent = '📤 Posten';
  var tagsWrap = document.getElementById('post-modal-tags');
  if (tagsWrap) tagsWrap.innerHTML = '<div style="font-size:13px;color:var(--text2);">Keine Outfit-Tags ausgewählt</div>';
  _selectPostVis('friends');

  var overlay = document.getElementById('post-modal-overlay');
  if (overlay) overlay.classList.add('open');
}

// ── Post Detail ───────────────────────────────────────────────────────────────
function _renderPostDetailComments(postId) {
  var all = _loadAllComments();
  var comments = all[postId] || [];
  var commentLikes = _loadCommentLikes();

  var commentsHtml = comments.length === 0
    ? '<div class="comment-empty" style="padding:24px 0 8px;">Noch keine Kommentare 💬</div>'
    : comments.map(function(c) {
        var liked = !!commentLikes[c.id];
        var likeCount = (c.likes || 0) + (liked ? 1 : 0);
        return '<div class="comment-item" style="padding:10px 0;" data-comment-id="' + _escAttr(c.id) + '">'
          + '<div class="comment-avatar" style="background:' + (c.authorBg || '#EDE9FF') + ';">' + (c.authorEmoji || '👤') + '</div>'
          + '<div class="comment-body">'
          + '<div class="comment-name">' + (c.author || 'Nutzer') + '</div>'
          + '<div class="comment-text">' + (c.text || '').replace(/</g, '&lt;') + '</div>'
          + '<div class="comment-meta">'
          + '<span class="comment-time">' + _formatCommentTime(c.timestamp) + '</span>'
          + '<button class="comment-like-btn' + (liked ? ' liked' : '') + '" data-clid="' + _escAttr(c.id) + '">❤️ ' + likeCount + '</button>'
          + '</div>'
          + '</div>'
          + '<div class="comment-delete-popup" id="cdp2_' + _escAttr(c.id) + '"><div class="comment-delete-item" data-del-comment2="' + _escAttr(c.id) + '" data-del-post="' + _escAttr(postId) + '">🗑️ Löschen</div></div>'
          + '</div>';
      }).join('');

  return '<div style="margin-top:20px;border-top:1px solid #F0EBFF;padding-top:14px;">'
    + '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:12px;">💬 Kommentare (<span id="post-detail-comment-count">' + comments.length + '</span>)</div>'
    + '<div id="post-detail-comment-list">' + commentsHtml + '</div>'
    + '<div class="comment-input-row" style="margin-top:14px;padding:0;">'
    + '<div class="comment-my-avatar">👩‍🦱</div>'
    + '<input class="comment-input" id="post-detail-comment-input" placeholder="Schreibe einen Kommentar…" maxlength="300" />'
    + '<button class="comment-send-btn" onclick="_sendDetailComment(\'' + _escAttr(postId) + '\')">📤</button>'
    + '</div>'
    + '</div>';
}

function _sendDetailComment(postId) {
  var input = document.getElementById('post-detail-comment-input');
  var text = input ? input.value.trim() : '';
  if (!text) return;

  var all = _loadAllComments();
  if (!all[postId]) all[postId] = [];

  var newComment = {
    id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
    text: text,
    author: 'Anna Müller',
    authorEmoji: '👩‍🦱',
    authorBg: '#D8CFFF',
    timestamp: Date.now(),
    likes: 0,
    isOwn: true
  };
  all[postId].push(newComment);
  _storeAllComments(all);

  if (input) input.value = '';

  // Re-render comment list in detail
  var listEl = document.getElementById('post-detail-comment-list');
  var countEl = document.getElementById('post-detail-comment-count');
  var comments = all[postId];
  if (countEl) countEl.textContent = comments.length;
  if (listEl) {
    var commentLikes = _loadCommentLikes();
    listEl.innerHTML = comments.map(function(c) {
      var liked = !!commentLikes[c.id];
      var likeCount = (c.likes || 0) + (liked ? 1 : 0);
      return '<div class="comment-item" style="padding:10px 0;" data-comment-id="' + _escAttr(c.id) + '">'
        + '<div class="comment-avatar" style="background:' + (c.authorBg || '#EDE9FF') + ';">' + (c.authorEmoji || '👤') + '</div>'
        + '<div class="comment-body">'
        + '<div class="comment-name">' + (c.author || 'Nutzer') + '</div>'
        + '<div class="comment-text">' + (c.text || '').replace(/</g, '&lt;') + '</div>'
        + '<div class="comment-meta">'
        + '<span class="comment-time">' + _formatCommentTime(c.timestamp) + '</span>'
        + '<button class="comment-like-btn' + (liked ? ' liked' : '') + '" data-clid="' + _escAttr(c.id) + '">❤️ ' + likeCount + '</button>'
        + '</div>'
        + '</div>'
        + '<div class="comment-delete-popup" id="cdp2_' + _escAttr(c.id) + '"><div class="comment-delete-item" data-del-comment2="' + _escAttr(c.id) + '" data-del-post="' + _escAttr(postId) + '">🗑️ Löschen</div></div>'
        + '</div>';
    }).join('');
    // scroll to bottom
    listEl.scrollTop = listEl.scrollHeight;
  }
  _showToast('💬 Kommentar gepostet!');
}

function _openPostDetail(postId) {
  _currentPostId = postId;
  var posts = _loadMyPosts();
  var post = posts.find(function(p) { return p.id === postId; });
  if (!post) return;

  var titleEl = document.getElementById('post-detail-title');
  if (titleEl) titleEl.textContent = post.outfitName || 'Post';

  var content = document.getElementById('post-detail-content');
  if (!content) return;

  var visLabel = post.visibility === 'public' ? '🌍 Öffentlich' : '🔒 Nur Freunde';
  var imgHtml = post.imageDataUrl
    ? '<img class="post-detail-photo" src="' + _escAttr(post.imageDataUrl) + '" alt="" />'
    : '<div class="post-detail-emoji-bg">' + (post.outfitItems && post.outfitItems[0] ? (post.outfitItems[0].emoji || '✨') : '✨') + '</div>';

  var tagsHtml = (post.outfitItems || []).slice(0, 6).map(function(it) {
    return '<div class="post-tag-chip">' + (it.emoji || '👕') + ' ' + (it.name || '') + '</div>';
  }).join('');

  var captionHtml = post.caption
    ? '<div class="post-detail-caption">' + post.caption.replace(/</g, '&lt;') + '</div>'
    : '<div class="post-detail-caption" style="color:var(--text2);font-style:italic;">Keine Caption</div>';

  var dateStr = post.timestamp ? new Date(post.timestamp).toLocaleDateString('de-DE', { day:'2-digit', month:'short', year:'numeric' }) : '';

  content.innerHTML = imgHtml
    + captionHtml
    + '<div class="post-detail-vis-badge" onclick="_togglePostVisibility(\'' + _escAttr(postId) + '\')" title="Tippen zum Wechseln">' + visLabel + '</div>'
    + (tagsHtml ? '<div class="post-detail-tags">' + tagsHtml + '</div>' : '')
    + '<div class="post-detail-stats">'
    + '<span class="post-detail-stat"><strong>' + (post.likes || 0) + '</strong> Likes</span>'
    + (dateStr ? '<span class="post-detail-stat">📅 ' + dateStr + '</span>' : '')
    + '</div>'
    + '<div class="post-detail-actions">'
    + '<button class="post-detail-edit-btn" onclick="_editPost(\'' + _escAttr(postId) + '\')">✏️ Bearbeiten</button>'
    + '<button class="post-detail-delete-btn" onclick="_deletePost(\'' + _escAttr(postId) + '\')">🗑️ Löschen</button>'
    + '</div>'
    + _renderPostDetailComments(postId);

  var panel = document.getElementById('post-detail-panel');
  if (panel) panel.classList.add('active');
}

function _closePostDetail() {
  var panel = document.getElementById('post-detail-panel');
  if (panel) panel.classList.remove('active');
  _currentPostId = null;
}

function _openSettings() {
  var panel = document.getElementById('settings-panel');
  if (panel) panel.classList.add('active');
}
function _closeSettings() {
  var panel = document.getElementById('settings-panel');
  if (panel) panel.classList.remove('active');
}

// ─────────────────────────────────────────────────────────────────────────────
// FREUNDES-PROFIL
// ─────────────────────────────────────────────────────────────────────────────

var _friendProfilesData = {
  'sophie': {
    name: 'Sophie K.', handle: '@sophiestyle',
    avatar: '👩‍🦰', avatarBg: '#FFE0B2',
    stats: { artikel: 24, outfits: 15, follower: 412, posts: 8 },
    streak: 18,
    isPublic: true, shareSchrank: true,
    wardrobe: [
      { emoji: '👗', name: 'Seidentop',       type: 'top',    typeLabel: 'Top' },
      { emoji: '👖', name: 'Weite Hose',      type: 'hose',   typeLabel: 'Hose' },
      { emoji: '👠', name: 'Mules',           type: 'schuhe', typeLabel: 'Schuhe' },
      { emoji: '🧥', name: 'Trenchcoat',      type: 'jacke',  typeLabel: 'Jacke' },
      { emoji: '👜', name: 'Lederhandtasche', type: 'top',    typeLabel: 'Accessoire' },
      { emoji: '🩱', name: 'Bikini-Top',      type: 'top',    typeLabel: 'Top' },
      { emoji: '🕶️', name: 'Sonnenbrille',   type: 'top',    typeLabel: 'Accessoire' },
      { emoji: '👒', name: 'Strohhut',        type: 'top',    typeLabel: 'Accessoire' },
      { emoji: '👟', name: 'Weiße Sneaker',   type: 'schuhe', typeLabel: 'Schuhe' },
    ],
    posts: [
      { id: 'sp1', caption: 'Frühlings-Chic', emoji: '🌸', likes: 34 },
      { id: 'sp2', caption: 'Monday Vibes',   emoji: '☕', likes: 21 },
      { id: 'sp3', caption: 'Weekend Look',   emoji: '🌿', likes: 18 },
      { id: 'sp4', caption: 'Strand-Day',     emoji: '🏖️', likes: 42 },
      { id: 'sp5', caption: 'Cocktail-Hour',  emoji: '🍹', likes: 29 },
      { id: 'sp6', caption: 'City-Walk',      emoji: '🏙️', likes: 15 },
    ],
    kiMatches: [
      { emoji: '🧥', name: 'Trenchcoat',      match: 'passt zu: Herbst-Layering ✨' },
      { emoji: '👟', name: 'Weiße Sneaker',   match: 'passt zu: Sommer Casual ✨' },
      { emoji: '🕶️', name: 'Sonnenbrille',   match: 'passt zu: Festival Ready ✨' },
    ]
  },
  'lara': {
    name: 'Lara D.', handle: '@lara.style',
    avatar: '👩‍🦳', avatarBg: '#FFF9C4',
    stats: { artikel: 31, outfits: 9, follower: 189, posts: 5 },
    streak: 5,
    isPublic: true, shareSchrank: true,
    wardrobe: [
      { emoji: '👕', name: 'Crop-Top',       type: 'top',    typeLabel: 'Top' },
      { emoji: '🩳', name: 'Hotpants',       type: 'hose',   typeLabel: 'Hose' },
      { emoji: '👢', name: 'Cowboy-Stiefel', type: 'schuhe', typeLabel: 'Schuhe' },
      { emoji: '👗', name: 'Maxi-Kleid',     type: 'kleid',  typeLabel: 'Kleid' },
      { emoji: '🧤', name: 'Lederhandschuhe',type: 'top',    typeLabel: 'Accessoire' },
      { emoji: '🪖', name: 'Bucket-Hat',     type: 'top',    typeLabel: 'Accessoire' },
    ],
    posts: [
      { id: 'lp1', caption: 'Festival Ready', emoji: '🎪', likes: 56 },
      { id: 'lp2', caption: 'Sunny Day',      emoji: '☀️', likes: 33 },
      { id: 'lp3', caption: 'Night-Out',      emoji: '🌙', likes: 48 },
    ],
    kiMatches: [
      { emoji: '👗', name: 'Maxi-Kleid',     match: 'passt zu: Sommer-Chic ✨' },
      { emoji: '👕', name: 'Crop-Top',        match: 'passt zu: Casual Look ✨' },
    ]
  },
  'lena': {
    name: 'Lena M.', handle: '@lena.mode',
    avatar: '🧒', avatarBg: '#FFE0B2',
    stats: { artikel: 18, outfits: 7, follower: 94, posts: 4 },
    streak: 24,
    isPublic: false, shareSchrank: false,
    wardrobe: [],
    posts: [
      { id: 'len1', caption: 'Herbst-Layering', emoji: '🍂', likes: 24 },
      { id: 'len2', caption: 'Cozy Vibes',      emoji: '🕯️', likes: 17 },
    ],
    kiMatches: []
  },
  'marie': {
    name: 'Marie K.', handle: '@marie.looks',
    avatar: '👩', avatarBg: '#FFF9C4',
    stats: { artikel: 22, outfits: 11, follower: 231, posts: 6 },
    streak: 3,
    isPublic: false, shareSchrank: true,
    wardrobe: [
      { emoji: '👗', name: 'Sommerkleid',  type: 'kleid',  typeLabel: 'Kleid' },
      { emoji: '🕶️', name: 'Sonnenbrille',type: 'top',    typeLabel: 'Accessoire' },
      { emoji: '🩴', name: 'Sandalen',     type: 'schuhe', typeLabel: 'Schuhe' },
      { emoji: '🧴', name: 'Sonnenhut',    type: 'top',    typeLabel: 'Accessoire' },
    ],
    posts: [
      { id: 'mp1', caption: 'Sommer-Chic',  emoji: '🌊', likes: 38 },
      { id: 'mp2', caption: 'Brunch-Look',  emoji: '🥂', likes: 22 },
    ],
    kiMatches: [
      { emoji: '👗', name: 'Sommerkleid', match: 'passt zu: Sommer-Chic ✨' },
    ]
  }
};

var _currentFriendId = null;
var _currentFriendTab = 'posts';
var _fpWardrobeFilter = 'alle';

function _loadFollowStates() {
  try { return JSON.parse(localStorage.getItem('stylesync_follow_states') || '{}'); } catch(e) { return {}; }
}
function _saveFollowStates(s) { localStorage.setItem('stylesync_follow_states', JSON.stringify(s)); }

function _openFriendProfile(friendId) {
  var profile = _friendProfilesData[friendId];
  if (!profile) return;
  _currentFriendId = friendId;
  _currentFriendTab = 'posts';
  _fpWardrobeFilter = 'alle';

  // Hero
  var av = document.getElementById('fp-avatar');
  if (av) { av.textContent = profile.avatar; av.style.background = profile.avatarBg; }
  var nm = document.getElementById('fp-name');    if (nm) nm.textContent = profile.name;
  var hd = document.getElementById('fp-handle');  if (hd) hd.textContent = profile.handle;

  // Streak
  var fpStreak = document.getElementById('fp-streak-pill');
  if (!fpStreak) {
    // Create and insert streak pill
    var handleEl = document.getElementById('fp-handle');
    if (handleEl) {
      var streakPill = document.createElement('div');
      streakPill.id = 'fp-streak-pill';
      streakPill.className = 'fp-streak-pill';
      handleEl.parentNode.insertBefore(streakPill, handleEl.nextSibling);
      fpStreak = streakPill;
    }
  }
  if (fpStreak) {
    fpStreak.textContent = '🔥 ' + (profile.streak || 0) + ' Tage Streak';
    fpStreak.style.display = profile.streak > 0 ? '' : 'none';
  }

  // Stats
  document.getElementById('fp-stat-artikel').textContent  = profile.stats.artikel;
  document.getElementById('fp-stat-outfits').textContent  = profile.stats.outfits;
  document.getElementById('fp-stat-follower').textContent = profile.stats.follower;
  document.getElementById('fp-stat-posts').textContent    = profile.stats.posts;

  // Follow button
  var states = _loadFollowStates();
  if (!states[friendId]) {
    // Seed default states
    var defaults = { sophie: 'friends', lara: 'following', lena: 'friends', marie: 'following' };
    states[friendId] = defaults[friendId] || 'not-following';
    _saveFollowStates(states);
  }
  _updateFollowBtn(states[friendId]);

  // Tabs
  _fpShowTab('posts');
  _renderFriendPosts(profile, states[friendId]);

  // Schrank tab locked indicator
  var schrankTab = document.getElementById('fp-tab-schrank');
  if (schrankTab) {
    schrankTab.classList.toggle('locked', !profile.shareSchrank);
  }

  // Show panel
  document.getElementById('friend-profile-panel').classList.add('active');
  _closeFriendKI();
}

function _closeFriendProfile() {
  document.getElementById('friend-profile-panel').classList.remove('active');
  _closeFriendKI();
  _currentFriendId = null;
}

function _fpShowTab(tab) {
  _currentFriendTab = tab;
  var postBtn   = document.getElementById('fp-tab-posts');
  var schrankBtn= document.getElementById('fp-tab-schrank');
  var postCont  = document.getElementById('fp-content-posts');
  var schrankCont = document.getElementById('fp-content-schrank');
  if (postBtn) postBtn.classList.toggle('active', tab === 'posts');
  if (schrankBtn) schrankBtn.classList.toggle('active', tab === 'schrank');
  if (postCont) postCont.style.display = tab === 'posts' ? '' : 'none';
  if (schrankCont) schrankCont.style.display = tab === 'schrank' ? '' : 'none';
}

function _switchFriendTab(tab) {
  var profile = _friendProfilesData[_currentFriendId];
  if (!profile) return;
  if (tab === 'schrank' && profile.shareSchrank === false) {
    _showToast('🔒 Schrank nicht freigegeben');
    return;
  }
  _fpShowTab(tab);
  if (tab === 'schrank') _renderFriendSchrank(profile);
}

function _renderFriendPosts(profile, followState) {
  var grid = document.getElementById('fp-posts-grid');
  var privateMsg = document.getElementById('fp-private-posts-msg');
  if (!grid || !privateMsg) return;

  var canSee = profile.isPublic || followState === 'friends' || followState === 'following';
  if (!canSee) {
    grid.innerHTML = '';
    privateMsg.innerHTML = '<div class="fp-private-msg"><div class="fp-private-icon">🔒</div><div class="fp-private-text">Dieses Profil ist privat.<br>Folge ' + profile.name + ', um Posts zu sehen.</div></div>';
    return;
  }
  privateMsg.innerHTML = '';
  grid.innerHTML = profile.posts.map(function(post) {
    return '<div class="fp-post-item" onclick="_showToast(\'💬 Post-Detail kommt bald!\')">'
      + post.emoji
      + '<div class="fp-post-overlay">'
      + '<div class="fp-post-likes">🤍 ' + post.likes + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function _renderFriendSchrank(profile) {
  var content = document.getElementById('fp-schrank-content');
  if (!content) return;

  if (!profile.shareSchrank) {
    content.innerHTML = '<div class="fp-private-msg"><div class="fp-private-icon">🔒</div><div class="fp-private-text">' + profile.name + ' hat seinen<br>Schrank nicht freigegeben.</div></div>';
    return;
  }

  // KI button
  var kiBtnHtml = '<button class="fp-ki-btn" onclick="_openFriendKI()">🤖 Was passt zu meinem Schrank?</button>';

  // Filter
  var filter = _fpWardrobeFilter;
  var items = profile.wardrobe.filter(function(it) {
    return filter === 'alle' || it.type === filter;
  });

  if (items.length === 0) {
    content.innerHTML = kiBtnHtml + '<div class="fp-private-msg"><div class="fp-private-icon">🧺</div><div class="fp-private-text">Keine Kleidungsstücke in dieser Kategorie.</div></div>';
    return;
  }

  content.innerHTML = kiBtnHtml
    + '<div class="fp-wardrobe-grid">'
    + items.map(function(it) {
        return '<div class="fp-wardrobe-item">'
          + '<div class="fp-wardrobe-emoji">' + it.emoji + '</div>'
          + '<div class="fp-wardrobe-name">' + it.name + '</div>'
          + '<div class="fp-wardrobe-type">' + it.typeLabel + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}

function _updateFollowBtn(state) {
  var btn = document.getElementById('fp-follow-btn');
  if (!btn) return;
  btn.className = 'fp-follow-btn';
  if (state === 'following') {
    btn.classList.add('following'); btn.textContent = '✓ Gefolgt';
  } else if (state === 'friends') {
    btn.classList.add('friends'); btn.textContent = '👥 Freunde';
  } else {
    btn.classList.add('not-following'); btn.textContent = '➕ Folgen';
  }
}

function _toggleFollow() {
  if (!_currentFriendId) return;
  var states = _loadFollowStates();
  var cur = states[_currentFriendId] || 'not-following';
  if (cur === 'not-following') {
    states[_currentFriendId] = 'following';
    _showToast('✅ Du folgst jetzt ' + _friendProfilesData[_currentFriendId].name);
  } else if (cur === 'following') {
    states[_currentFriendId] = 'not-following';
    _showToast('❌ Entfolgt');
  } else if (cur === 'friends') {
    states[_currentFriendId] = 'following';
    _showToast('👤 Freundschaft beendet');
  }
  _saveFollowStates(states);
  _updateFollowBtn(states[_currentFriendId]);
}

function _openFriendKI() {
  var profile = _friendProfilesData[_currentFriendId];
  if (!profile) return;
  var scroll = document.getElementById('fp-ki-scroll');
  if (!scroll) return;

  var matches = profile.kiMatches || [];
  var introName = profile.name.split(' ')[0];
  scroll.innerHTML = '<div class="fp-ki-intro">Diese Teile von ' + introName + ' passen zu deinen Outfits:</div>'
    + (matches.length === 0
      ? '<div class="fp-private-msg"><div class="fp-private-icon">🤔</div><div class="fp-private-text">Keine passenden Items gefunden.</div></div>'
      : matches.map(function(m) {
          return '<div class="fp-ki-item">'
            + '<div class="fp-ki-item-emoji">' + m.emoji + '</div>'
            + '<div class="fp-ki-item-info">'
            + '<div class="fp-ki-item-name">' + m.name + '</div>'
            + '<div class="fp-ki-item-match">' + m.match + '</div>'
            + '</div>'
            + '<button class="fp-ki-tausch-btn" onclick="_showToast(\'📩 Tausch-Anfrage gesendet!\')">Tauschen?</button>'
            + '</div>';
        }).join(''));

  document.getElementById('fp-ki-panel').classList.add('active');
}

function _closeFriendKI() {
  var panel = document.getElementById('fp-ki-panel');
  if (panel) panel.classList.remove('active');
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFIL-SUCHE
// ─────────────────────────────────────────────────────────────────────────────

function _openFriendSearch() {
  var panel = document.getElementById('friend-search-panel');
  if (panel) panel.classList.add('active');
  var input = document.getElementById('friend-search-input');
  if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 320); }
  var clear = document.getElementById('friend-search-clear');
  if (clear) clear.classList.remove('show');
  var results = document.getElementById('friend-search-results');
  if (results) results.innerHTML = '<div class="friend-search-placeholder">Tippe einen Namen oder @username ein</div>';
}

function _closeFriendSearch() {
  var panel = document.getElementById('friend-search-panel');
  if (panel) panel.classList.remove('active');
  var input = document.getElementById('friend-search-input');
  if (input) { input.value = ''; input.blur(); }
}

function _clearFriendSearch() {
  var input = document.getElementById('friend-search-input');
  if (input) { input.value = ''; input.focus(); }
  var clear = document.getElementById('friend-search-clear');
  if (clear) clear.classList.remove('show');
  var results = document.getElementById('friend-search-results');
  if (results) results.innerHTML = '<div class="friend-search-placeholder">Tippe einen Namen oder @username ein</div>';
}

function _onFriendSearch(input) {
  var q = (input.value || '').trim().toLowerCase();
  var clear = document.getElementById('friend-search-clear');
  if (clear) clear.classList.toggle('show', q.length > 0);
  var results = document.getElementById('friend-search-results');
  if (!results) return;
  if (!q) {
    results.innerHTML = '<div class="friend-search-placeholder">Tippe einen Namen oder @username ein</div>';
    return;
  }
  var matches = Object.keys(_friendProfilesData).filter(function(id) {
    var p = _friendProfilesData[id];
    return p.name.toLowerCase().indexOf(q) !== -1 ||
           p.handle.toLowerCase().indexOf(q) !== -1;
  });
  if (matches.length === 0) {
    results.innerHTML = '<div class="friend-search-empty">'
      + '<div class="friend-search-empty-icon">🔍</div>'
      + '<div class="friend-search-empty-title">Kein Profil gefunden</div>'
      + '<div class="friend-search-empty-sub">Versuche einen anderen Namen</div>'
      + '</div>';
    return;
  }
  var states = _loadFollowStates();
  results.innerHTML = matches.map(function(id) {
    var p = _friendProfilesData[id];
    var state = states[id] || (id === 'sophie' || id === 'lena' ? 'friends' : id === 'lara' ? 'following' : 'not-following');
    var btnClass = 'search-follow-btn ' + state;
    var btnLabel = state === 'friends' ? '👥 Freunde' : state === 'following' ? '✓ Gefolgt' : '➕ Folgen';
    return '<div class="search-result-card" data-open-friend="' + id + '">'
      + '<div class="search-result-avatar" style="background:' + p.avatarBg + ';">' + p.avatar + '</div>'
      + '<div class="search-result-info">'
      + '<div class="search-result-name">' + p.name + '</div>'
      + '<div class="search-result-handle">' + p.handle + '</div>'
      + '<div class="search-result-followers">' + p.stats.follower + ' Follower</div>'
      + '</div>'
      + '<button class="' + btnClass + '" data-search-follow="' + id + '" onclick="event.stopPropagation();_searchToggleFollow(\'' + id + '\',this)">' + btnLabel + '</button>'
      + '</div>';
  }).join('');
}

function _searchToggleFollow(friendId, btn) {
  var states = _loadFollowStates();
  var cur = states[friendId] || 'not-following';
  var next = cur === 'not-following' ? 'following' : cur === 'following' ? 'not-following' : 'following';
  states[friendId] = next;
  _saveFollowStates(states);
  btn.className = 'search-follow-btn ' + next;
  btn.textContent = next === 'friends' ? '👥 Freunde' : next === 'following' ? '✓ Gefolgt' : '➕ Folgen';
  _showToast(next === 'following'
    ? '✅ Du folgst jetzt ' + _friendProfilesData[friendId].name
    : '❌ Entfolgt');
}

function _deletePost(postId) {
  var posts = _loadMyPosts();
  var idx = posts.findIndex(function(p) { return p.id === postId; });
  if (idx >= 0) posts.splice(idx, 1);
  _storeMyPosts(posts);
  _closePostDetail();
  _showToast('🗑️ Post gelöscht');
  _renderProfilePosts();
}

function _togglePostVisibility(postId) {
  var posts = _loadMyPosts();
  var post = posts.find(function(p) { return p.id === postId; });
  if (!post) return;
  post.visibility = post.visibility === 'public' ? 'friends' : 'public';
  _storeMyPosts(posts);
  var newLabel = post.visibility === 'public' ? '🌍 Öffentlich' : '🔒 Nur Freunde';
  _showToast('Sichtbarkeit: ' + newLabel);
  _renderProfilePosts();
  // Direkt im Detail-Panel aktualisieren
  var badge = document.querySelector('#post-detail-content .post-detail-vis-badge');
  if (badge) badge.textContent = newLabel;
}

function _editPost(postId) {
  _closePostDetail();
  setTimeout(function() { _openPostModalEdit(postId); }, 200);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAK SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

function _getTodayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _getWeekKey() {
  var d = new Date();
  var jan1 = new Date(d.getFullYear(), 0, 1);
  var week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + week;
}

function _loadStreak() {
  try {
    var s = JSON.parse(localStorage.getItem('stylesync_streak') || 'null');
    if (!s) {
      // Demo: start with 7-day streak
      s = { current: 7, lastPostDate: _getTodayKey(), longest: 7, freezes: 1, lastFreezeWeek: '', milestonesSeen: [] };
      _saveStreak(s);
    }
    return s;
  } catch(e) {
    return { current: 0, lastPostDate: '', longest: 0, freezes: 1, lastFreezeWeek: '', milestonesSeen: [] };
  }
}

function _saveStreak(s) {
  localStorage.setItem('stylesync_streak', JSON.stringify(s));
}

function _getStreakColorClass(days) {
  if (days <= 0)  return 'streak-c0';
  if (days <= 2)  return 'streak-c1';
  if (days <= 6)  return 'streak-c2';
  if (days <= 13) return 'streak-c3';
  if (days <= 29) return 'streak-c4';
  return 'streak-c5';
}

function _getStreakLabel(days) {
  if (days <= 0)  return 'Noch kein Streak';
  if (days <= 2)  return 'Fang an!';
  if (days <= 6)  return 'Weiter so!';
  if (days <= 13) return 'Eine Woche!';
  if (days <= 29) return 'Auf Feuer!';
  return 'Legende!';
}

function _checkAndUpdateStreak() {
  var s = _loadStreak();
  var today = _getTodayKey();
  var yesterday = (function() {
    var d = new Date(); d.setDate(d.getDate()-1);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  })();

  if (s.lastPostDate === today) {
    // Already posted today — streak intact
  } else if (s.lastPostDate === yesterday) {
    // Posted yesterday — streak still alive, waiting for today's post
  } else if (s.lastPostDate) {
    // Missed a day — check freeze
    var weekKey = _getWeekKey();
    if (s.freezes > 0 && s.lastFreezeWeek !== weekKey) {
      // Auto-apply freeze
      s.freezes = 0;
      s.lastFreezeWeek = weekKey;
      s.lastPostDate = yesterday; // treat as if posted yesterday
      _showToast('❄️ Freeze automatisch verwendet! Streak gerettet!');
    } else {
      // Streak lost
      if (s.current > 0) {
        _showStreakLostToast(s.current);
      }
      s.current = 0;
    }
    _saveStreak(s);
  }

  // Reset freeze weekly
  var wk = _getWeekKey();
  if (s.lastFreezeWeek !== wk && s.freezes < 1) {
    // Give back freeze if new week (only if not already used this week)
  }
  if (!s.lastFreezeWeek || s.lastFreezeWeek !== wk) {
    // New week: restore freeze (but only if it wasn't used this week yet)
    if (s.lastFreezeWeek !== wk) {
      s.freezes = 1;
      _saveStreak(s);
    }
  }

  _updateProfileStreak();
  _checkStreakReminder();
}

function _incrementStreak() {
  var s = _loadStreak();
  var today = _getTodayKey();
  if (s.lastPostDate === today) return; // already posted today
  s.current = (s.current || 0) + 1;
  if (s.current > (s.longest || 0)) s.longest = s.current;
  s.lastPostDate = today;
  _saveStreak(s);
  _updateProfileStreak();
  _checkMilestone(s.current, s);
}

function _updateProfileStreak() {
  var s = _loadStreak();
  var pill = document.getElementById('profil-streak-pill');
  var freezePill = document.getElementById('profil-freeze-pill');
  if (pill) {
    pill.className = 'streak-badge-pill ' + _getStreakColorClass(s.current);
    if (s.current > 0) {
      pill.textContent = '🔥 ' + s.current + ' Tage Streak';
      pill.style.display = '';
    } else {
      pill.textContent = '🔥 Noch kein Streak – starte heute!';
      pill.style.display = '';
    }
  }
  if (freezePill) {
    freezePill.textContent = s.freezes > 0 ? '❄️ 1 Freeze verfügbar' : '❄️ Kein Freeze';
    freezePill.style.opacity = s.freezes > 0 ? '1' : '0.5';
  }
}

function _checkStreakReminder() {
  var s = _loadStreak();
  var today = _getTodayKey();
  if (s.lastPostDate === today) return; // already posted
  var h = new Date().getHours();
  if (h >= 20) {
    setTimeout(function() {
      var banner = document.getElementById('streak-reminder');
      if (banner) banner.classList.add('show');
    }, 1500);
  }
}

function _closeStreakReminder() {
  var banner = document.getElementById('streak-reminder');
  if (banner) banner.classList.remove('show');
}

function _showStreakLostToast(oldStreak) {
  setTimeout(function() {
    _showToast('💔 Streak vorbei! Du hattest ' + oldStreak + ' Tage – starte neu!');
  }, 500);
}

var _milestoneData = {
  7:   { emoji: '🔥', title: 'Eine Woche!',  sub: 'Du hast 7 Tage am Stück gepostet. Unglaublich!' },
  14:  { emoji: '🚀', title: 'Zwei Wochen!', sub: '14 Tage in Folge – du bist auf Feuer!' },
  30:  { emoji: '👑', title: 'Ein Monat!',   sub: 'Ein ganzer Monat! Du bist eine echte Style-Ikone!' },
  100: { emoji: '🏆', title: 'Legende!',     sub: '100 Tage! Du bist eine absolute Legende 🏆' }
};

function _checkMilestone(days, s) {
  var milestones = [7, 14, 30, 100];
  var seen = s.milestonesSeen || [];
  for (var i = 0; i < milestones.length; i++) {
    var m = milestones[i];
    if (days >= m && seen.indexOf(m) < 0) {
      seen.push(m);
      s.milestonesSeen = seen;
      _saveStreak(s);
      _showMilestone(m, days);
      break;
    }
  }
}

function _showMilestone(milestone, days) {
  var data = _milestoneData[milestone] || { emoji:'🔥', title:'Super!', sub:'Tolle Leistung!' };
  var el = document.getElementById('milestone-emoji'); if (el) el.textContent = data.emoji;
  var dl = document.getElementById('milestone-days'); if (dl) dl.textContent = days;
  var tl = document.getElementById('milestone-title'); if (tl) tl.textContent = data.title;
  var sl = document.getElementById('milestone-sub'); if (sl) sl.textContent = data.sub;
  var btn = document.querySelector('.milestone-btn'); if (btn) btn.textContent = data.emoji + ' Weiter so!';
  var ov = document.getElementById('milestone-overlay');
  if (ov) setTimeout(function() { ov.classList.add('show'); }, 400);
}

function _closeMilestone() {
  var ov = document.getElementById('milestone-overlay');
  if (ov) ov.classList.remove('show');
}

// ── Streak Detail Panel ───────────────────────────────────────────────────────
function _openStreakPanel() {
  _renderStreakPanel();
  var panel = document.getElementById('streak-detail-panel');
  if (panel) panel.classList.add('active');
}

function _closeStreakPanel() {
  var panel = document.getElementById('streak-detail-panel');
  if (panel) panel.classList.remove('active');
}

function _renderStreakPanel() {
  var scroll = document.getElementById('sdp-scroll');
  if (!scroll) return;
  var s = _loadStreak();
  var myStreak = s.current || 0;
  var freezes = typeof s.freezes === 'number' ? s.freezes : 1;
  var seen = s.milestonesSeen || [];

  var milestoneInfo = {
    7:   { label: '🔥 7 Tage',   desc: '"Eine Woche!"' },
    14:  { label: '🔥 14 Tage',  desc: '"Zwei Wochen!"' },
    30:  { label: '🔥 30 Tage',  desc: '"Ein Monat!"' },
    100: { label: '🔥 100 Tage', desc: '"Legende!"' }
  };

  // Build sorted list of all participants
  var allEntries = [
    { name:'Anna M.',   avatar:'👩‍🦱', bg:'#D8CFFF', streak: Math.max(30, myStreak + 23), me:false },
    { name:'Lena K.',   avatar:'🧒',   bg:'#FFE0B2', streak: Math.max(24, myStreak + 17), me:false },
    { name:'Sophie M.', avatar:'👩‍🦰', bg:'#FFD6D6', streak: Math.max(18, myStreak + 11), me:false },
    { name:'Marie K.',  avatar:'👩',   bg:'#FDE68A', streak: Math.max(12, myStreak + 5),  me:false },
    { name:'Du',        avatar:'👩‍🦱', bg:'#D8CFFF', streak: myStreak, me:true }
  ].sort(function(a, b) { return b.streak - a.streak; });

  var rankSymbols = ['🥇','🥈','🥉'];

  // Top 3 section + "Du" row if not already top 3
  var top3 = allEntries.slice(0, 3);
  var meIdx = allEntries.findIndex(function(e) { return e.me; });
  var meEntry = allEntries[meIdx];
  var meRankStr = meIdx < 3 ? rankSymbols[meIdx] : (meIdx + 1) + '.';

  var lbHTML = '<div class="sdp-lb-card">';
  top3.forEach(function(e, i) {
    lbHTML += '<div class="sdp-lb-row' + (e.me ? ' me' : '') + '">'
      + '<div class="sdp-lb-rank">' + rankSymbols[i] + '</div>'
      + '<div class="sdp-lb-avatar" style="background:' + e.bg + ';">' + e.avatar + '</div>'
      + '<div class="sdp-lb-name">' + (e.me ? '<strong>Du</strong>' : e.name) + '</div>'
      + '<div class="sdp-lb-streak">🔥 ' + e.streak + ' Tage</div>'
      + '</div>';
  });
  // Add "Du" row below top 3 if not already in top 3
  if (meIdx >= 3) {
    lbHTML += '<div class="sdp-lb-divider"></div>';
    lbHTML += '<div class="sdp-lb-row me">'
      + '<div class="sdp-lb-rank">' + meRankStr + '</div>'
      + '<div class="sdp-lb-avatar" style="background:' + meEntry.bg + ';">' + meEntry.avatar + '</div>'
      + '<div class="sdp-lb-name"><strong>Du</strong></div>'
      + '<div class="sdp-lb-streak">🔥 ' + meEntry.streak + ' Tage</div>'
      + '</div>';
  }
  lbHTML += '</div>';

  // All friends (exclude "Du")
  var friendsHTML = allEntries.filter(function(e) { return !e.me; }).map(function(e) {
    return '<div class="sdp-friend-row">'
      + '<div class="sdp-friend-avatar" style="background:' + e.bg + ';">' + e.avatar + '</div>'
      + '<div class="sdp-friend-name">' + e.name + '</div>'
      + '<div class="sdp-friend-streak">🔥 ' + e.streak + ' Tage</div>'
      + '</div>';
  }).join('');

  // Milestones
  var milestonesHTML = [7, 14, 30, 100].map(function(m) {
    var done = seen.indexOf(m) >= 0 || myStreak >= m;
    var info = milestoneInfo[m];
    return '<div class="sdp-milestone-row ' + (done ? 'done' : 'locked') + '">'
      + '<div class="sdp-milestone-check">' + (done ? '✅' : '⬜') + '</div>'
      + '<div class="sdp-milestone-info">'
      + '<div class="sdp-milestone-label">' + info.label + '</div>'
      + '<div class="sdp-milestone-desc">' + info.desc + '</div>'
      + '</div>'
      + '</div>';
  }).join('');

  scroll.innerHTML =
    '<div class="sdp-hero">'
    + '<div class="sdp-hero-flame">🔥</div>'
    + '<div class="sdp-hero-days">' + myStreak + ' Tage</div>'
    + '<div class="sdp-hero-label">Dein aktueller Streak</div>'
    + '<div class="sdp-hero-freeze">❄️ ' + freezes + ' Freeze' + (freezes !== 1 ? 's' : '') + ' verfügbar</div>'
    + '</div>'

    + '<div class="sdp-section">'
    + '<div class="sdp-section-title">🏆 Bestenliste</div>'
    + lbHTML
    + '</div>'

    + '<div class="sdp-section">'
    + '<div class="sdp-section-title">👤 Alle Freunde</div>'
    + friendsHTML
    + '</div>'

    + '<div class="sdp-section">'
    + '<div class="sdp-section-title">🎯 Meine Meilensteine</div>'
    + milestonesHTML
    + '</div>';
}

function _renderLeaderboard() {
  var lb = document.getElementById('streak-leaderboard');
  if (!lb) return;
  var s = _loadStreak();
  var myStreak = s.current || 0;

  var entries = [
    { rank:'🥇', name:'Anna M.',   avatar:'👩‍🦱', bg:'#D8CFFF', streak: Math.max(30, myStreak + 23), me: false },
    { rank:'🥈', name:'Lena K.',   avatar:'🧒',   bg:'#FFE0B2', streak: Math.max(24, myStreak + 17), me: false },
    { rank:'🥉', name:'Sophie M.', avatar:'👩‍🦰', bg:'#FFE0B2', streak: Math.max(18, myStreak + 11), me: false },
    { rank:'4.',  name:'Du',        avatar:'👩‍🦱', bg:'#D8CFFF', streak: myStreak, me: true },
  ].sort(function(a,b) { return b.streak - a.streak; });

  // Reassign ranks after sort
  var rankSymbols = ['🥇','🥈','🥉','4.','5.'];
  entries.forEach(function(e, i) { e.rank = rankSymbols[i] || (i+1)+'.'; });

  lb.innerHTML = entries.map(function(e) {
    return '<div class="leaderboard-row' + (e.me ? ' me' : '') + '">'
      + '<div class="lb-rank">' + e.rank + '</div>'
      + '<div class="lb-avatar" style="background:' + e.bg + ';">' + e.avatar + '</div>'
      + '<div class="lb-name">' + (e.me ? '<strong>Du</strong>' : e.name) + '</div>'
      + '<div class="lb-streak">🔥 ' + e.streak + ' Tage</div>'
      + '</div>';
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Einmalig: altes Datenformat migrieren
  _migrateOldData();

  _ensureAiStyles();
  renderWardrobeGrid();
  _updateFavoritenCard();

  // Scan-Buttons
  var cameraBtn = document.querySelector('.scan-btn-primary');
  if (cameraBtn) cameraBtn.onclick = function() { var el = document.getElementById('scan-camera-input'); if (el) el.click(); };
  var galleryBtn = document.querySelector('.scan-btn-secondary');
  if (galleryBtn) galleryBtn.onclick = function() { var el = document.getElementById('scan-gallery-input'); if (el) el.click(); };
  var dropZone = document.querySelector('.scan-drop-zone');
  if (dropZone) dropZone.onclick = function() { var el = document.getElementById('scan-gallery-input'); if (el) el.click(); };

  // Options-Menü schließen beim Tippen außerhalb
  var outfitPanel = document.getElementById('ki-outfit-panel');
  if (outfitPanel) outfitPanel.addEventListener('click', function(e) {
    if (!e.target.closest('#ki-options-menu') && !e.target.closest('.ki-options-btn')) _hideOptionsMenu();
  });

  // KI Styling: Pills + Saved Section initial rendern
  _renderKiPills();
  _setKiSuggestionsVisible(_kiActivePill === null);
  _renderKiSavedSection();

  // ── Event Delegation: Kollektions-Pills ──
  var pillsWrap = document.getElementById('ki-pills-wrap');
  if (pillsWrap) {
    pillsWrap.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-pill-key]');
      if (!btn) return;
      _selectKiPill(btn.getAttribute('data-pill-key'));
    });
  }

  // ── Outfit-Detail-Panel: Titel direkt antippbar zum Umbenennen ──
  var outfitPanelTitle = document.getElementById('ki-outfit-panel-title');
  if (outfitPanelTitle) {
    outfitPanelTitle.style.cursor = 'pointer';
    outfitPanelTitle.addEventListener('click', function() {
      _startOutfitPanelRename();
    });
  }

  // ── Event Delegation: Gespeicherte Outfit-Karten ──
  var savedContainer = document.getElementById('ki-saved-outfits');
  if (savedContainer) {
    savedContainer.addEventListener('click', function(e) {
      var heartBtn = e.target.closest('[data-heart-id]');
      if (heartBtn) {
        e.stopPropagation();
        _toggleFav(heartBtn.getAttribute('data-heart-id'), heartBtn);
        return;
      }
      var card = e.target.closest('[data-saved-id]');
      if (card) {
        var id = card.getAttribute('data-saved-id');
        var outfit = _loadOutfits().find(function(o) { return o.id === id; });
        if (outfit) {
          var col = (_kiActivePill !== null) ? _kiActivePill : ((outfit.kollektionen || [])[0] || '__all__');
          _openOutfitDetail(id, col);
        }
      }
    });
  }

  // ── Event Delegation: KI-Vorschlag Karten anklicken → Detail öffnen ──
  var aiSugContainer = document.getElementById('ki-ai-suggestions');
  if (aiSugContainer) {
    aiSugContainer.addEventListener('click', function(e) {
      if (e.target.closest('.heart-btn')) return;       // Herz → nur liken
      if (e.target.closest('.outfit-save-btn')) return; // Speichern → nur Modal
      var wrapper = e.target.closest('[data-swipe-id]');
      if (wrapper) _openOutfitDetail(wrapper.getAttribute('data-swipe-id'), null);
    });
  }

  // ── Event Delegation: Kollektion-Detail Karten ──
  var colList = document.getElementById('ki-col-list');
  if (colList) {
    colList.addEventListener('click', function(e) {
      // Inspo-Version-Button hat eigenen onclick — nicht weiter delegieren
      if (e.target.closest('.inspo-version-btn')) return;
      var heartBtn = e.target.closest('[data-heart-id]');
      if (heartBtn) {
        e.stopPropagation();
        _toggleFav(heartBtn.getAttribute('data-heart-id'), heartBtn);
        return;
      }
      var card = e.target.closest('[data-col-id]');
      if (card) {
        _openOutfitDetail(card.getAttribute('data-col-id'), card.getAttribute('data-col-name'));
      }
    });
  }

  // ── Event Delegation: Save Modal Kollektions-Liste ──
  var saveModalList = document.getElementById('save-modal-list');
  if (saveModalList) {
    saveModalList.addEventListener('click', function(e) {
      var item = e.target.closest('[data-save-col]');
      if (item) _selectSaveCollection(item.getAttribute('data-save-col'));
    });
  }

  // ── Event Delegation: Generate Modal Kollektion-Chips ──
  var genCols = document.getElementById('ki-gen-collections');
  if (genCols) {
    genCols.addEventListener('click', function(e) {
      var chip = e.target.closest('[data-gen-col]');
      if (chip) _selectGenCollection(chip.getAttribute('data-gen-col'));
    });
  }

  // ── Event Delegation: Inspo Modal Kollektion-Items ──
  var inspoList = document.getElementById('inspo-modal-list');
  if (inspoList) {
    inspoList.addEventListener('click', function(e) {
      var item = e.target.closest('[data-inspo-col]');
      if (item) _selectInspoCollection(item.getAttribute('data-inspo-col'));
    });
  }

  // ── Event Delegation: Generate Modal Inspo-Outfit-Chips ──
  var genInspoContainer = document.getElementById('ki-gen-inspo-outfits');
  if (genInspoContainer) {
    genInspoContainer.addEventListener('click', function(e) {
      var chip = e.target.closest('[data-gen-inspo]');
      if (chip) _selectGenInspoOutfit(chip.getAttribute('data-gen-inspo'));
    });
  }

  // ── Eigene Posts in Feed einfügen ──
  _insertAllOwnPostsIntoFeed();

  // ── Event Delegation: Wardrobe Pills im Neuer-Beitrag Modal ──
  var newPostPillsWrap = document.getElementById('new-post-wardrobe-pills');
  if (newPostPillsWrap) {
    newPostPillsWrap.addEventListener('click', function(e) {
      var pill = e.target.closest('[data-wpi]');
      if (!pill) return;
      var key = pill.getAttribute('data-wpi');
      var idx = parseInt(pill.getAttribute('data-wpi-idx'), 10);
      var wardrobe = loadWardrobe();
      var item = wardrobe[idx];
      if (!item) return;
      item._key = key;
      var existingIdx = _newPostSelectedItems.findIndex(function(s) { return s._key === key; });
      if (existingIdx >= 0) {
        _newPostSelectedItems.splice(existingIdx, 1);
      } else {
        _newPostSelectedItems.push(item);
      }
      pill.classList.toggle('selected', _newPostSelectedItems.some(function(s) { return s._key === key; }));
    });
  }

  // ── Event Delegation: Item Tags in Feed (data-feed-item) + Freundes-Profil ──
  var appEl = document.getElementById('app');
  if (appEl) {
    appEl.addEventListener('click', function(e) {
      // Item chip
      var chip = e.target.closest('[data-feed-item]');
      if (chip) {
        try {
          var itemData = JSON.parse(chip.getAttribute('data-feed-item'));
          var card = chip.closest('.post-card-new');
          var visIcon = card && card.querySelector('.avatar-badge') ? card.querySelector('.avatar-badge').textContent : '';
          _showItemDetailPopup(itemData, visIcon === '🌍');
        } catch (ex) {}
        return;
      }
      // Freundes-Profil öffnen
      var friendHead = e.target.closest('[data-open-friend]');
      if (friendHead) {
        _openFriendProfile(friendHead.getAttribute('data-open-friend'));
        return;
      }
    });
  }

  // ── Event Delegation: Freundes-Profil Schrank Filter ──
  var fpFilters = document.getElementById('fp-wardrobe-filters');
  if (fpFilters) {
    fpFilters.addEventListener('click', function(e) {
      var pill = e.target.closest('[data-fp-filter]');
      if (!pill) return;
      _fpWardrobeFilter = pill.getAttribute('data-fp-filter');
      fpFilters.querySelectorAll('[data-fp-filter]').forEach(function(p) {
        p.classList.toggle('active', p === pill);
      });
      var profile = _friendProfilesData[_currentFriendId];
      if (profile) _renderFriendSchrank(profile);
    });
  }

  // ── Event Delegation: Suche Ergebnisse → Freundes-Profil ──
  var searchResults = document.getElementById('friend-search-results');
  if (searchResults) {
    searchResults.addEventListener('click', function(e) {
      var card = e.target.closest('.search-result-card');
      if (!card) return;
      var friendId = card.getAttribute('data-open-friend');
      if (friendId) _openFriendProfile(friendId);
    });
  }

  // ── Kommentar-System initialisieren ──
  _initSeedComments();
  _restoreFeedLikeStates();
  _restoreFeedCommentCounts();
  _restoreShareCounts();
  _restoreFeedFollowStates();

  // ── Event Delegation: Feed Like/Comment Buttons ──
  var feedScroll = document.querySelector('#freunde .scroll-content');
  if (feedScroll) {
    feedScroll.addEventListener('click', function(e) {
      // Like button
      var likeBtn = e.target.closest('[data-feed-like]');
      if (likeBtn) {
        _toggleFeedPostLike(likeBtn.getAttribute('data-feed-like'), likeBtn);
        return;
      }
      // Comment button
      var commentBtn = e.target.closest('[data-feed-comment]');
      if (commentBtn) {
        _openCommentSheet(commentBtn.getAttribute('data-feed-comment'), false);
        return;
      }
      // Share button
      var shareBtn = e.target.closest('[data-feed-share]');
      if (shareBtn) {
        _shareFeedPost(shareBtn.getAttribute('data-feed-share'), shareBtn);
        return;
      }
      // Follow button
      var followBtn = e.target.closest('[data-feed-follow]');
      if (followBtn) {
        e.stopPropagation();
        _toggleFeedFollow(followBtn.getAttribute('data-feed-follow'), followBtn);
        return;
      }
      // Own post ··· menu button
      var moreBtn = e.target.closest('[data-more-post]');
      if (moreBtn) {
        e.stopPropagation();
        _togglePostMoreMenu(moreBtn.getAttribute('data-more-post'), moreBtn);
        return;
      }
      // Close open more-menu on outside click
      if (!e.target.closest('.post-more-menu')) _closePostMoreMenu();
    });
  }

  // ── Event Delegation: Comment Sheet ──
  var commentList = document.getElementById('comment-list');
  if (commentList) {
    // Click: like comment or delete
    commentList.addEventListener('click', function(e) {
      // Delete popup item
      var delItem = e.target.closest('[data-del-comment]');
      if (delItem) {
        _deleteCommentById(delItem.getAttribute('data-del-comment'));
        return;
      }
      // Like button
      var likeBtn = e.target.closest('[data-clid]');
      if (likeBtn) {
        _toggleCommentLike(likeBtn.getAttribute('data-clid'), likeBtn);
        return;
      }
      // Close any open delete popup on click elsewhere
      _hideActiveDeletePopup();
    });

    // Long press: show delete popup for own/owner comments
    commentList.addEventListener('touchstart', function(e) {
      var item = e.target.closest('.comment-item');
      if (!item) return;
      var commentId = item.getAttribute('data-comment-id');
      var popup = document.getElementById('cdp_' + commentId);
      if (!popup) return;
      _longPressTimer = setTimeout(function() {
        _showDeletePopupForComment(commentId);
      }, 500);
    }, { passive: true });

    commentList.addEventListener('touchend', function() {
      clearTimeout(_longPressTimer);
    }, { passive: true });

    commentList.addEventListener('touchmove', function() {
      clearTimeout(_longPressTimer);
    }, { passive: true });
  }

  // Comment input: send on Enter
  var commentInput = document.getElementById('comment-input');
  if (commentInput) {
    commentInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendComment(); }
    });
  }

  // ── Preview-Sektion + Saved initial befüllen ──
  _renderPreviewSuggestions(null);
  _renderKiSavedSection();

  // ── Event Delegation: Post Detail Kommentare ──
  var postDetailScroll = document.getElementById('post-detail-content');
  if (postDetailScroll) {
    postDetailScroll.addEventListener('click', function(e) {
      var delItem = e.target.closest('[data-del-comment2]');
      if (delItem) {
        var cid = delItem.getAttribute('data-del-comment2');
        var pid = delItem.getAttribute('data-del-post');
        var all = _loadAllComments();
        if (all[pid]) {
          all[pid] = all[pid].filter(function(c) { return c.id !== cid; });
          _storeAllComments(all);
        }
        // Re-render
        var detailContent = document.getElementById('post-detail-content');
        if (detailContent) {
          var listEl = document.getElementById('post-detail-comment-list');
          var countEl = document.getElementById('post-detail-comment-count');
          var comments = (all[pid] || []);
          if (countEl) countEl.textContent = comments.length;
          if (listEl) {
            var commentLikes = _loadCommentLikes();
            if (comments.length === 0) {
              listEl.innerHTML = '<div class="comment-empty" style="padding:24px 0 8px;">Noch keine Kommentare 💬</div>';
            } else {
              listEl.innerHTML = comments.map(function(c) {
                var liked = !!commentLikes[c.id];
                var likeCount = (c.likes || 0) + (liked ? 1 : 0);
                return '<div class="comment-item" style="padding:10px 0;" data-comment-id="' + _escAttr(c.id) + '">'
                  + '<div class="comment-avatar" style="background:' + (c.authorBg || '#EDE9FF') + ';">' + (c.authorEmoji || '👤') + '</div>'
                  + '<div class="comment-body"><div class="comment-name">' + (c.author || 'Nutzer') + '</div>'
                  + '<div class="comment-text">' + (c.text || '').replace(/</g, '&lt;') + '</div>'
                  + '<div class="comment-meta"><span class="comment-time">' + _formatCommentTime(c.timestamp) + '</span>'
                  + '<button class="comment-like-btn' + (liked ? ' liked' : '') + '" data-clid="' + _escAttr(c.id) + '">❤️ ' + likeCount + '</button>'
                  + '</div></div>'
                  + '<div class="comment-delete-popup" id="cdp2_' + _escAttr(c.id) + '"><div class="comment-delete-item" data-del-comment2="' + _escAttr(c.id) + '" data-del-post="' + _escAttr(pid) + '">🗑️ Löschen</div></div>'
                  + '</div>';
              }).join('');
            }
          }
        }
        _showToast('🗑️ Kommentar gelöscht');
        return;
      }
      // Like button
      var likeBtn2 = e.target.closest('[data-clid]');
      if (likeBtn2) {
        _toggleCommentLike(likeBtn2.getAttribute('data-clid'), likeBtn2);
        return;
      }
    });

    // Long press for delete in post detail
    postDetailScroll.addEventListener('touchstart', function(e) {
      var item = e.target.closest('.comment-item');
      if (!item) return;
      var commentId = item.getAttribute('data-comment-id');
      if (!commentId) return;
      var popup = document.getElementById('cdp2_' + commentId);
      if (!popup) return;
      _longPressTimer = setTimeout(function() {
        _hideActiveDeletePopup();
        popup.classList.add('show');
        _activeDeletePopup = popup;
      }, 500);
    }, { passive: true });
    postDetailScroll.addEventListener('touchend', function() { clearTimeout(_longPressTimer); }, { passive: true });
    postDetailScroll.addEventListener('touchmove', function() { clearTimeout(_longPressTimer); }, { passive: true });
  }

  // ── Streak System initialisieren ──
  _checkAndUpdateStreak();

  // ── Profil Posts: initial rendern ──
  _renderProfilePosts();

  // ── Event Delegation: Profil Post-Grid ──
  var profilGrid = document.getElementById('profil-posts-grid');
  if (profilGrid) {
    profilGrid.addEventListener('click', function(e) {
      var item = e.target.closest('[data-post-id]');
      if (item) _openPostDetail(item.getAttribute('data-post-id'));
    });
  }

  // ── MutationObserver: Profil Screen aktiviert → Posts neu rendern ──
  var profilScreen = document.getElementById('profil');
  if (profilScreen) {
    var profilObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.type === 'attributes' && m.attributeName === 'class' && profilScreen.classList.contains('active')) {
          _renderProfilePosts();
        }
      });
    });
    profilObserver.observe(profilScreen, { attributes: true });
  }

  // ── MutationObserver: KI Styling Screen aktiviert ──
  var kiScreen = document.getElementById('ki-styling');
  if (kiScreen) {
    var kiObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.type === 'attributes' && m.attributeName === 'class' && kiScreen.classList.contains('active')) {
          _renderKiPills();
          _renderPreviewSuggestions(null);
          _renderKiSavedSection();
          // KI-Sektion nur zeigen wenn schon generiert wurde
          _setKiSuggestionsVisible(_kiSuggestionsLoaded || _kiLoadingActive);
        }
      });
    });
    kiObserver.observe(kiScreen, { attributes: true });
  }
});
