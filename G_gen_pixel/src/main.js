import HP from '../hyperparams.json'
import {
  TilesRenderer,
  WGS84_ELLIPSOID,
  GlobeControls,
  CameraTransitionManager,
  CAMERA_FRAME,
} from '3d-tiles-renderer'
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
  TileCompressionPlugin,
} from '3d-tiles-renderer/plugins'
import {
  Matrix4,
  Scene,
  WebGLRenderer,
  PerspectiveCamera,
  OrthographicCamera,
  MathUtils,
} from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

// ---- Hyperparameters (edit hyperparams.json, not here) ----
const { CANVAS_SIZE, CAMERA_AZIMUTH, CAMERA_ELEVATION, TARGET_HEIGHT } = HP
const VIEW_HEIGHT_METERS = HP.GRID_CELLS * HP.METERS_PER_CELL

// ---- Proxy all tile.googleapis.com fetches through Flask backend ----
const _origFetch = window.fetch
window.fetch = function (url, options) {
  const urlStr = url instanceof URL ? url.toString() : (typeof url === 'string' ? url : null)
  if (urlStr && urlStr.includes('tile.googleapis.com')) {
    return _origFetch(`/api/tile-proxy?url=${encodeURIComponent(urlStr)}`, options)
  }
  return _origFetch(url, options)
}

// ---- App state ----
let scene, renderer, controls, tiles, transition
let apiKey = ''
let currentLat = null
let currentLon = null
let currentLocationName = ''
let tilesStableStart = 0
let tilesLoaded = false
let cameraInitialized = false
let animFrameId = null
let currentPixelArtDataUrl = null   // stored after successful pixel art generation
let geopixelJobId = null              // current GeoPixel job ID for polling
let generatedWorldId = null           // worldId of the last completed generation
let satelliteLoaded = false         // fast satellite path
let satelliteDataUrl = null         // stored data URL for captureCanvas
let satelliteZoom = 1.0             // CSS zoom level for satellite image
let satellitePanX = 0               // CSS pixel pan offset (translate)
let satellitePanY = 0
let satelliteDisplaySize = 0        // CSS pixel size of the displayed image (set when loaded)
// Drag state
let isDraggingSatellite = false
let dragStartMouseX = 0
let dragStartMouseY = 0
let dragStartPanX = 0
let dragStartPanY = 0

// ---- Local image upload (skip 3D tiles) ----
let localCapturedImage = null   // data URL set when user uploads a local image
let localImageType = null       // 'photo3d' | 'pixel'

// ---- DOM refs ----
const locationInput = document.getElementById('location-input')
const styleInput = document.getElementById('style-input')
const btnLoad = document.getElementById('btn-load')
const btnGenerate = document.getElementById('btn-generate')
const btnGeopixel = document.getElementById('btn-geopixel')
const geopixelStatus = document.getElementById('geopixel-status')

const statusText = document.getElementById('status-text')
const viewerPanel = document.getElementById('viewer-panel')
const viewerPlaceholder = document.getElementById('viewer-placeholder')
const viewerContainer = document.getElementById('viewer-container')
const viewerLoading = document.getElementById('viewer-loading')
const viewerLoadingText = document.getElementById('viewer-loading-text')
const tilesStatus = document.getElementById('tiles-status')
const zoomControls = document.getElementById('zoom-controls')
const btnZoomIn = document.getElementById('btn-zoom-in')
const btnZoomOut = document.getElementById('btn-zoom-out')
const btnUpload = document.getElementById('btn-upload')
const btnGenerateGlobal = document.getElementById('btn-generate-global')
const satelliteView = document.getElementById('satellite-view')
const satelliteImg = document.getElementById('satellite-img')
const crosshairOverlay = document.getElementById('satellite-crosshair')
const btnResetPan = document.getElementById('btn-reset-pan')
const wbPlaceholder = document.getElementById('wb-placeholder')
const wbImg = document.getElementById('wb-img')
const wbLoading = document.getElementById('wb-loading')
const globalResultPlaceholder = document.getElementById('global-result-placeholder')
const globalResultImg = document.getElementById('global-result-img')
const globalResultLoading = document.getElementById('global-result-loading')

// Refresh buttons
const btnRefreshView = document.getElementById('btn-refresh-view')
const btnRefreshPixel = document.getElementById('btn-refresh-pixel')
const btnRefreshWb = document.getElementById('btn-refresh-wb')
const btnRefreshGlobal = document.getElementById('btn-refresh-global')

const GLOBAL_API = 'http://localhost:5002'
const uploadMenu = document.getElementById('upload-menu')
const uploadOptionPhoto3d = document.getElementById('upload-option-photo3d')
const gameFrame = document.getElementById('game-frame')
const btnRefreshGame = document.getElementById('btn-refresh-game')
const worldSelect = document.getElementById('world-select')
const btnSwitchWorld = document.getElementById('btn-switch-world')

function reloadGame() {
  if (gameFrame) gameFrame.src = gameFrame.src
}
btnRefreshGame?.addEventListener('click', reloadGame)

async function loadWorldList() {
  try {
    const res = await fetch('/api/worlds')
    if (!res.ok) return
    const data = await res.json()
    const worlds = data.worlds || []
    if (worlds.length === 0) return

    worldSelect.innerHTML = '<option value="">Select GeoPixel...</option>'
    for (const w of worlds) {
      const sel = w.isCurrent ? ' selected' : ''
      const promptAbbr = w.prompt
        ? (w.prompt.length > 24 ? w.prompt.slice(0, 24) + '…' : w.prompt)
        : ''
      const promptTitle = w.prompt ? ` title="${w.prompt.replace(/"/g, '&quot;')}"` : ''
      const label = promptAbbr
        ? `${w.worldName} — ${promptAbbr} (${w.id.slice(0, 8)})`
        : `${w.worldName} (${w.id.slice(0, 8)})`
      worldSelect.innerHTML += `<option value="${w.id}"${sel}${promptTitle}>${label}</option>`
    }
    worldSelect.style.display = 'inline-block'
    btnSwitchWorld.style.display = 'inline-block'
  } catch {}
}

async function switchWorld(worldId) {
  try {
    await fetch('/api/world/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId }),
    })
    reloadGame()
  } catch {}
}

btnSwitchWorld?.addEventListener('click', () => {
  const id = worldSelect?.value
  if (id) switchWorld(id)
})

worldSelect?.addEventListener('change', () => {
  const id = worldSelect?.value
  if (id) switchWorld(id)
})
const uploadOptionPixel = document.getElementById('upload-option-pixel')
const localImgInput = document.getElementById('local-img-input')
const localImgPreview = document.getElementById('local-img-preview')
const resultPlaceholder = document.getElementById('result-placeholder')
const resultImg = document.getElementById('result-img')
const resultLoading = document.getElementById('result-loading')

function setStatus(msg) {
  statusText.textContent = msg
}

// ---- Zoom helpers ----
const MAX_ZOOM = 8.0

function applyZoom(factor) {
  if (satelliteLoaded) {
    applySatelliteZoom(factor)
    return
  }
  if (!transition) return
  const ortho = transition.orthographicCamera
  ortho.zoom = Math.max(1.0, Math.min(MAX_ZOOM, ortho.zoom * factor))
  ortho.updateProjectionMatrix()
}

// Intercept wheel events on all viewer panels in capture phase to prevent
// GlobeControls from seeing them — this keeps zoom bounded.
function handleWheel(e) {
  if (!transition && !satelliteLoaded) return
  e.preventDefault()
  e.stopImmediatePropagation()
  applyZoom(e.deltaY < 0 ? 1.15 : 0.87)
}
viewerContainer.addEventListener('wheel', handleWheel, { passive: false, capture: true })
satelliteView.addEventListener('wheel', handleWheel, { passive: false, capture: true })

// ---- Satellite drag-to-pan ----
let _satDragMoved = false

satelliteView.addEventListener('mousedown', (e) => {
  if (!satelliteLoaded) return
  if (e.button !== 0) return // left button only
  // Don't start drag if clicking zoom buttons
  if (e.target.closest('.btn-zoom')) return
  e.preventDefault()
  isDraggingSatellite = true
  _satDragMoved = false
  dragStartMouseX = e.clientX
  dragStartMouseY = e.clientY
  dragStartPanX = satellitePanX
  dragStartPanY = satellitePanY
  satelliteView.style.cursor = 'grabbing'
})

window.addEventListener('mousemove', (e) => {
  if (!isDraggingSatellite) return
  const dx = e.clientX - dragStartMouseX
  const dy = e.clientY - dragStartMouseY
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) _satDragMoved = true
  satellitePanX = dragStartPanX + dx
  satellitePanY = dragStartPanY + dy
  clampPanToBounds()
  updateSatelliteTransform()
  updatePanUI()
})

window.addEventListener('mouseup', () => {
  if (!isDraggingSatellite) return
  isDraggingSatellite = false
  satelliteView.style.cursor = _satDragMoved ? 'grab' : 'default'
})

// Touch support
satelliteView.addEventListener('touchstart', (e) => {
  if (!satelliteLoaded || e.touches.length !== 1) return
  if (e.target.closest('.btn-zoom')) return
  isDraggingSatellite = true
  _satDragMoved = false
  dragStartMouseX = e.touches[0].clientX
  dragStartMouseY = e.touches[0].clientY
  dragStartPanX = satellitePanX
  dragStartPanY = satellitePanY
}, { passive: false })

window.addEventListener('touchmove', (e) => {
  if (!isDraggingSatellite) return
  if (e.touches.length !== 1) return
  e.preventDefault()
  const dx = e.touches[0].clientX - dragStartMouseX
  const dy = e.touches[0].clientY - dragStartMouseY
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) _satDragMoved = true
  satellitePanX = dragStartPanX + dx
  satellitePanY = dragStartPanY + dy
  clampPanToBounds()
  updateSatelliteTransform()
  updatePanUI()
}, { passive: false })

window.addEventListener('touchend', () => {
  if (!isDraggingSatellite) return
  isDraggingSatellite = false
})

function updatePanUI() {
  if (!satelliteLoaded) return
  const hasPan = Math.abs(satellitePanX) > 0.5 || Math.abs(satellitePanY) > 0.5
  if (btnResetPan) btnResetPan.style.display = hasPan ? '' : 'none'
  if (crosshairOverlay) crosshairOverlay.style.display = ''
  // Show effective coordinates
  const eff = getEffectiveLatLon()
  if (eff && currentLat !== null && (eff.lat !== currentLat || eff.lon !== currentLon)) {
    setStatus(`📍 ${currentLocationName}  [aligned: ${eff.lat.toFixed(5)}, ${eff.lon.toFixed(5)}]`)
  }
}

// Keep satellite display correct on window resize
window.addEventListener('resize', () => {
  if (!satelliteLoaded) return
  _setupSatelliteDisplay()
  clampPanToBounds()
  updateSatelliteTransform()
})

// ---- Fetch API key from backend ----
async function fetchConfig() {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!text) throw new Error('Empty response — is the Flask server (python server.py) running on port 5001?')
    const cfg = JSON.parse(text)
    apiKey = cfg.google_maps_api_key || ''
    if (!apiKey) console.warn('No Google Maps API key from backend')
  } catch (e) {
    console.error('Config fetch failed:', e.message)
    setStatus('⚠️ Backend not started — run python server.py')
  }
}

// ---- Geocode ----
async function geocode(location) {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(location)}`)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Geocoding failed')
  }
  return res.json() // { lat, lon, address }
}

// ---- Fast satellite image loader (Google Static Maps API, ~1s vs 30s for 3D Tiles) ----
function _setupSatelliteDisplay() {
  // Use viewerPanel dimensions — it's always laid out (satelliteView may not be yet)
  const cw = viewerPanel.clientWidth
  const ch = viewerPanel.clientHeight
  satelliteDisplaySize = Math.min(cw, ch)
  if (satelliteDisplaySize <= 0) {
    satelliteDisplaySize = 400 // fallback before layout
  }
  const left = (cw - satelliteDisplaySize) / 2
  const top = (ch - satelliteDisplaySize) / 2
  satelliteImg.style.position = 'absolute'
  satelliteImg.style.left = left + 'px'
  satelliteImg.style.top = top + 'px'
  satelliteImg.style.width = satelliteDisplaySize + 'px'
  satelliteImg.style.height = satelliteDisplaySize + 'px'
  satelliteImg.style.objectFit = 'fill'
  satelliteImg.style.transformOrigin = 'center center'
}

async function loadSatelliteImage(lat, lon) {
  try {
    const res = await fetch(`/api/satellite?lat=${lat}&lon=${lon}&zoom=18&size=640&scale=2`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const blob = await res.blob()

    // Convert blob to data URL for captureCanvas
    satelliteDataUrl = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })

    // Show in viewer with explicit positioning for accurate pan-to-geo conversion
    satelliteImg.src = satelliteDataUrl
    satelliteView.style.display = 'block'
    _setupSatelliteDisplay()
    viewerPlaceholder.style.display = 'none'
    viewerContainer.style.display = 'none'
    viewerLoading.classList.remove('active')
    satelliteLoaded = true
    satelliteZoom = 1.0
    satellitePanX = 0
    satellitePanY = 0
    updateSatelliteTransform()

    btnGenerate.disabled = false
    btnGenerateGlobal.disabled = false
    zoomControls.style.display = 'flex'
    btnRefreshView.style.display = ''
    btnResetPan.style.display = 'none'
    crosshairOverlay.style.display = ''
    setStatus(`Loaded: ${currentLocationName}`)
    console.log('Satellite image loaded in ~1s')
  } catch (e) {
    console.error('Satellite load failed:', e)
    setStatus(`Satellite failed: ${e.message}. Trying 3D tiles...`)
    // Fall back to 3D tiles
    initViewer(lat, lon)
  }
}

function applySatelliteZoom(factor) {
  satelliteZoom = Math.max(0.5, Math.min(MAX_ZOOM, satelliteZoom * factor))
  updateSatelliteTransform()
}

// ---- Satellite pan-to-geo conversion ----
// Google Static Maps at zoom=18, size=640: total geo coverage in degrees
// Formula: MAP_SIZE_PX * ORIGIN_SHIFT / (2^zoom * METERS_PER_DEGREE)
// = 640 * 156543.03392 / (262144 * 111320) ≈ 0.003433 degrees (at equator, per full-image-width)
const SAT_ZOOM = 18
const SAT_MAP_SIZE = 640
const SAT_GEO_DEG_PER_FULL_IMAGE = SAT_MAP_SIZE * 156543.03392 / (Math.pow(2, SAT_ZOOM) * 111320)

function updateSatelliteTransform() {
  satelliteImg.style.transform = `translate(${satellitePanX}px, ${satellitePanY}px) scale(${satelliteZoom})`
}

function clampPanToBounds() {
  if (!satelliteDisplaySize) return
  const container = satelliteView
  const halfContainerW = container.clientWidth / 2
  const halfContainerH = container.clientHeight / 2
  const halfScaledImg = (satelliteDisplaySize * satelliteZoom) / 2
  // Max pan: keep at least 20% of the image visible
  const maxPanX = Math.max(0, halfScaledImg - halfContainerW + satelliteDisplaySize * 0.2)
  const maxPanY = Math.max(0, halfScaledImg - halfContainerH + satelliteDisplaySize * 0.2)
  satellitePanX = Math.max(-maxPanX, Math.min(maxPanX, satellitePanX))
  satellitePanY = Math.max(-maxPanY, Math.min(maxPanY, satellitePanY))
}

function getEffectiveLatLon() {
  if (!satelliteLoaded || !satelliteDisplaySize || currentLat === null) {
    return { lat: currentLat, lon: currentLon }
  }
  // Pixel offset → fraction of full image → degrees
  const fracX = satellitePanX / (satelliteZoom * satelliteDisplaySize)
  const fracY = satellitePanY / (satelliteZoom * satelliteDisplaySize)
  const deltaLat = fracY * SAT_GEO_DEG_PER_FULL_IMAGE * Math.cos(currentLat * Math.PI / 180)
  const deltaLon = -fracX * SAT_GEO_DEG_PER_FULL_IMAGE
  return {
    lat: currentLat + deltaLat,
    lon: currentLon + deltaLon,
  }
}

// ---- Init / destroy 3D tiles viewer ----
function destroyViewer() {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
  if (tiles) {
    scene.remove(tiles.group)
    tiles.dispose()
    tiles = null
  }
  if (renderer) {
    renderer.dispose()
    viewerContainer.innerHTML = ''
    renderer = null
  }
  scene = null
  controls = null
  transition = null
  tilesLoaded = false
  cameraInitialized = false
  tilesStableStart = 0
  satelliteLoaded = false
  satelliteDataUrl = null
  satelliteZoom = 1.0
  satellitePanX = 0
  satellitePanY = 0
  satelliteDisplaySize = 0
  isDraggingSatellite = false
  satelliteView.style.display = 'none'
  zoomControls.style.display = 'none'
  if (btnResetPan) btnResetPan.style.display = 'none'
  if (crosshairOverlay) crosshairOverlay.style.display = 'none'
}

let _globalViewHeight = null  // override set by generateGlobalMap

function initViewer(lat, lon, viewHeightMeters = null) {
  destroyViewer()

  _globalViewHeight = viewHeightMeters

  const aspect = 1 // square canvas

  // Renderer — preserveDrawingBuffer is required for canvas capture
  renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setClearColor(0xffffff)
  renderer.setPixelRatio(1)
  renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
  renderer.domElement.id = 'viewer-canvas'
  viewerContainer.appendChild(renderer.domElement)

  // Scene
  scene = new Scene()

  // Camera transition manager
  transition = new CameraTransitionManager(
    new PerspectiveCamera(60, aspect, 1, 160_000_000),
    new OrthographicCamera(-1, 1, 1, -1, 1, 160_000_000)
  )
  transition.autoSync = false
  transition.orthographicPositionalZoom = false

  transition.addEventListener('camera-change', ({ camera, prevCamera }) => {
    tiles.deleteCamera(prevCamera)
    tiles.setCamera(camera)
    controls.setCamera(camera)
  })

  // Tiles
  tiles = new TilesRenderer()
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey }))
  tiles.errorTarget = 40  // tolerate more errors for tile loading across proxy
  tiles.registerPlugin(new TileCompressionPlugin())
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({
      dracoLoader: new DRACOLoader().setDecoderPath(
        'https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/'
      ),
    })
  )
  tiles.group.rotation.x = -Math.PI / 2
  scene.add(tiles.group)

  // Controls
  controls = new GlobeControls(scene, transition.camera, renderer.domElement, null)
  controls.enableDamping = true

  tiles.addEventListener('load-tile-set', () => {
    controls.setEllipsoid(tiles.ellipsoid, tiles.group)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cameraInitialized) {
          positionCamera(lat, lon)
          cameraInitialized = true
        }
      })
    })
  })

  tiles.setCamera(transition.camera)
  tiles.setResolution(transition.camera, CANVAS_SIZE, CANVAS_SIZE)

  tiles.addEventListener('load-error', (e) => {
    console.error('Tile load error (full):', e)
    console.error('Error stack:', e.error?.stack)
    console.error('Tile:', e.tile)
    console.error('URL:', e.url)
    const msg = e.error?.message || e.error || 'unknown'
    const stackLines = (e.error?.stack || '').split('\n').slice(0,3).join(' ← ')
    setStatus(`❌ Tile error: ${msg} | url: ${String(e.url).slice(0,80)}${stackLines ? ' | ' + stackLines : ''}`)
  })

  animate()
}

function positionCamera(lat, lon) {
  const camera = transition.perspectiveCamera

  WGS84_ELLIPSOID.getObjectFrame(
    lat * MathUtils.DEG2RAD,
    lon * MathUtils.DEG2RAD,
    TARGET_HEIGHT,
    CAMERA_AZIMUTH * MathUtils.DEG2RAD,
    CAMERA_ELEVATION * MathUtils.DEG2RAD,
    0,
    camera.matrixWorld,
    CAMERA_FRAME
  )

  // Move camera 2000m back along its Z axis
  camera.matrixWorld.multiply(new Matrix4().makeTranslation(0, 0, 2000))
  camera.matrixWorld.premultiply(tiles.group.matrixWorld)
  camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale)

  transition.syncCameras()
  controls.adjustCamera(transition.perspectiveCamera)
  controls.adjustCamera(transition.orthographicCamera)

  // Switch to orthographic
  if (transition.mode === 'perspective') {
    controls.getPivotPoint(transition.fixedPoint)
    transition.toggle()
  }

  // Set orthographic frustum — use global override if set, else game grid size
  const ortho = transition.orthographicCamera
  const viewH = _globalViewHeight || VIEW_HEIGHT_METERS
  const halfH = viewH / 2
  const halfW = halfH * (CANVAS_SIZE / CANVAS_SIZE) // aspect = 1
  ortho.top = halfH
  ortho.bottom = -halfH
  ortho.left = -halfW
  ortho.right = halfW
  ortho.zoom = 1.0
  ortho.updateProjectionMatrix()
}

function animate() {
  animFrameId = requestAnimationFrame(animate)

  controls.enabled = !transition.animating
  controls.update()
  transition.update()

  const camera = transition.camera
  camera.updateMatrixWorld()
  tiles.setCamera(camera)
  tiles.setResolution(camera, CANVAS_SIZE, CANVAS_SIZE)
  try {
    tiles.update()
  } catch (err) {
    console.error('FATAL in tiles.update():', err)
    setStatus(`❌ CRASH in tiles.update: ${err.message}`)
    cancelAnimationFrame(animFrameId)
    animFrameId = null
    return
  }

  // Track when tiles are stable — only count as loaded if at least one tile was seen
  const dl = tiles.stats.downloading
  const pr = tiles.stats.parsing
  const hasSeenActivity = tiles.visibleTiles.size > 0 || tiles.stats.loaded > 0
  if (dl === 0 && pr === 0 && hasSeenActivity) {
    if (tilesStableStart === 0) tilesStableStart = performance.now()
    else if (performance.now() - tilesStableStart > 1500 && !tilesLoaded) {
      tilesLoaded = true
      onTilesLoaded()
    }
  } else if (dl > 0 || pr > 0) {
    tilesStableStart = 0
    if (tilesLoaded) tilesLoaded = false
  }

  tilesStatus.textContent = `Downloading: ${dl} | Parsing: ${pr}`

  renderer.render(scene, camera)
}

function onTilesLoaded() {
  viewerLoading.classList.remove('active')
  tilesStatus.style.display = 'block'
  btnGenerate.disabled = false
  btnGenerateGlobal.disabled = false
  zoomControls.style.display = 'flex'
  setStatus(`Loaded: ${currentLocationName}`)
}

// ---- Capture canvas as base64 ----
function captureSatelliteViewport() {
  const cw = satelliteView.clientWidth
  const ch = satelliteView.clientHeight
  if (cw <= 0 || ch <= 0) return satelliteDataUrl
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  // Draw the satellite image with current pan & zoom to match viewport
  const s = satelliteDisplaySize
  const z = satelliteZoom
  const imgCenterX = cw / 2 + satellitePanX
  const imgCenterY = ch / 2 + satellitePanY
  const drawW = s * z
  const drawH = s * z
  ctx.drawImage(satelliteImg, imgCenterX - drawW / 2, imgCenterY - drawH / 2, drawW, drawH)
  return canvas.toDataURL('image/png')
}

function captureCanvas(forceTiles = false) {
  if (localCapturedImage) return localCapturedImage
  if (!forceTiles && satelliteLoaded && satelliteDataUrl) {
    // If user has panned or zoomed, capture the visible viewport for alignment
    if (Math.abs(satellitePanX) > 1 || Math.abs(satellitePanY) > 1 || satelliteZoom !== 1.0) {
      return captureSatelliteViewport()
    }
    return satelliteDataUrl
  }
  if (!renderer) return null
  renderer.render(scene, transition.camera)
  return renderer.domElement.toDataURL('image/png')
}

// Ensure 3D tiles viewer is initialized and ready for isometric capture.
// Keeps the satellite image visible in the UI panel; 3D canvas renders behind it.
async function ensure3DTilesForCapture(lat, lon, viewHeightMeters = null) {
  // Already have a working 3D viewer with visible tiles
  if (renderer && tiles && tilesLoaded && tiles.visibleTiles && tiles.visibleTiles.size > 0) {
    return
  }

  // Save satellite state — initViewer calls destroyViewer which resets it
  const wasSatelliteLoaded = satelliteLoaded
  const savedDataUrl = satelliteDataUrl

  // Initialize 3D viewer (creates WebGL canvas, starts animate loop)
  initViewer(lat, lon, viewHeightMeters)

  // Restore satellite state so the UI panel keeps showing satellite
  if (wasSatelliteLoaded) {
    satelliteLoaded = true
    satelliteDataUrl = savedDataUrl

    // Layer satellite on top of 3D canvas so user still sees satellite
    viewerContainer.style.display = 'block'
    viewerContainer.style.position = 'absolute'
    viewerContainer.style.inset = '0'
    viewerContainer.style.zIndex = '1'

    satelliteView.style.display = 'block'
    satelliteView.style.position = 'absolute'
    satelliteView.style.inset = '0'
    satelliteView.style.zIndex = '2'

    zoomControls.style.display = 'flex'
    if (crosshairOverlay) crosshairOverlay.style.display = ''
    if (btnResetPan) btnResetPan.style.display = ''
  }

  viewerLoading.classList.add('active')
  tilesStatus.style.display = 'block'

  // Wait for first tiles to appear
  const pollStart = Date.now()
  await new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      const elapsed = Math.round((Date.now() - pollStart) / 1000)
      viewerLoadingText.textContent = `Loading 3D tiles for isometric capture... (${elapsed}s)`
      if (tiles && tiles.visibleTiles && tiles.visibleTiles.size > 0) {
        clearInterval(iv)
        resolve()
      } else if (elapsed > 60) {
        clearInterval(iv)
        reject(new Error(`3D Tiles timeout after ${elapsed}s`))
      }
    }, 500)
  })

  // Let tiles settle for a clean render
  await new Promise(r => setTimeout(r, 1500))

  viewerLoading.classList.remove('active')
}

// ---- Generate pixel art ----
async function generatePixelArt(skipCache = false) {
  // If user uploaded a local image, use it directly (no 3D tiles needed)
  if (!localCapturedImage) {
    // Ensure 3D tiles viewer is ready so we capture the isometric 45deg view, not satellite
    if (!renderer || !tilesLoaded || !tiles || !tiles.visibleTiles || tiles.visibleTiles.size === 0) {
      setStatus('Loading 3D view for isometric capture...')
      try {
        await ensure3DTilesForCapture(currentLat, currentLon)
      } catch (e) {
        setStatus(`3D tiles failed: ${e.message}`)
        btnGenerate.disabled = false
        return
      }
    }
  }
  const imageData = captureCanvas(true)
  if (!imageData) {
    setStatus('Cannot capture — load a map first')
    return
  }

  // Show result loading
  resultPlaceholder.style.display = 'none'
  resultImg.style.display = 'none'
  resultLoading.classList.add('active')
  btnGenerate.disabled = true
  btnLoad.disabled = true
  btnRefreshPixel.style.display = 'none'
  setStatus('Generating pixel map...')

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageData,
        location: currentLocationName,
        style_prompt: styleInput ? styleInput.value.trim() : '',
        image_type: localImageType || 'photo3d',
        lat: currentLat,
        lon: currentLon,
        skip_cache: skipCache,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Generation failed')
    }

    const imgSrc = data.image || data.image_url
    if (imgSrc) {
      resultImg.src = imgSrc
      resultImg.style.display = 'block'
      resultPlaceholder.style.display = 'none'
      btnRefreshPixel.style.display = ''
      setStatus('Pixel map ready! Click "Generate GeoPixel Game" to start')
      const a = document.createElement('a')
      a.href = imgSrc
      a.download = `pixel-map-${Date.now()}.png`
      a.click()
      // Store for GeoPixel export and enable the button
      currentPixelArtDataUrl = imgSrc
      generatedWorldId = null
      updateGeopixelButton()
      if (btnGeopixel) btnGeopixel.disabled = false
    } else {
      throw new Error('No image data received')
    }
  } catch (e) {
    setStatus(`Generation failed: ${e.message}`)
    resultPlaceholder.innerHTML = `<div class="placeholder-icon">❌</div><div class="error-msg">${e.message}</div>`
    resultPlaceholder.style.display = 'flex'
  } finally {
    resultLoading.classList.remove('active')
    btnGenerate.disabled = false
    btnLoad.disabled = false
  }
}

// ---- Event handlers ----
btnLoad.addEventListener('click', async () => {
  const location = locationInput.value.trim()
  if (!location) {
    setStatus('Please enter a location name')
    return
  }

  btnLoad.disabled = true
  btnGenerate.disabled = true
  setStatus('Locating...')

  try {
    const geo = await geocode(location)
    currentLat = geo.lat
    currentLon = geo.lon
    currentLocationName = geo.address || location

    setStatus(`Located: ${currentLocationName}`)

    // Show viewer
    viewerPlaceholder.style.display = 'none'
    viewerContainer.style.display = 'none'
    satelliteView.style.display = 'none'
    destroyViewer()
    satelliteLoaded = false
    satelliteDataUrl = null
    satelliteZoom = 1.0
    viewerLoading.classList.add('active')
    viewerLoadingText.textContent = `Loading satellite view of ${currentLocationName}...`
    tilesStatus.style.display = 'none'
    tilesLoaded = false
    btnGenerate.disabled = true
    btnGenerateGlobal.disabled = true

    // Fast path: load satellite image first (~1s)
    loadSatelliteImage(currentLat, currentLon)

  } catch (e) {
    setStatus(`Error: ${e.message}`)
    viewerPlaceholder.style.display = 'flex'
  } finally {
    btnLoad.disabled = false
  }
})

btnGenerate.addEventListener('click', generatePixelArt)

locationInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnLoad.click()
})

function updateGeopixelButton() {
  if (!btnGeopixel) return
  if (generatedWorldId) {
    btnGeopixel.textContent = 'Enter GeoPixel!'
    btnGeopixel.classList.add('enter-ready')
  } else {
    btnGeopixel.textContent = 'Generate GeoPixel Game'
    btnGeopixel.classList.remove('enter-ready')
  }
}

function handleGeopixelClick() {
  if (generatedWorldId) {
    switchWorld(generatedWorldId)
  } else {
    generateGeopixelGame()
  }
}

// ---- GeoPixel game generation ----
async function generateGeopixelGame() {
  if (!currentPixelArtDataUrl) {
    setStatus('Generate a pixel map first')
    return
  }

  btnGeopixel.disabled = true
  btnGenerate.disabled = true
  if (geopixelStatus) {
    geopixelStatus.style.display = 'block'
    geopixelStatus.textContent = 'Starting GeoPixel map pipeline...'
    geopixelStatus.className = 'geopixel-status running'
  }
  setStatus('Generating GeoPixel game map (~5–10 minutes)...')

  try {
    const res = await fetch('/api/run-geopixel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: currentPixelArtDataUrl,
        location: currentLocationName || 'city',
        prompt: styleInput ? styleInput.value.trim() : '',
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to start')

    geopixelJobId = data.jobId
    pollGeopixelStatus(geopixelJobId)
  } catch (e) {
    setStatus(`GeoPixel failed to start: ${e.message}`)
    if (geopixelStatus) {
      geopixelStatus.textContent = `❌ Failed to start: ${e.message}`
      geopixelStatus.className = 'geopixel-status error'
    }
    btnGeopixel.disabled = false
    btnGenerate.disabled = false
  }
}

function pollGeopixelStatus(jobId) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/geopixel-status/${jobId}`)
      const job = await res.json()

      if (job.status === 'done') {
        clearInterval(interval)
        const worldId = job.runDir ? job.runDir.split('/').pop() : 'unknown'
        generatedWorldId = worldId
        updateGeopixelButton()
        if (geopixelStatus) {
          geopixelStatus.textContent = job.cached
            ? `✅ GeoPixel: ${worldId} (cached) — click Enter GeoPixel!`
            : `✅ GeoPixel: ${worldId} generated — click Enter GeoPixel!`
          geopixelStatus.className = 'geopixel-status done'
        }
        setStatus(job.cached
          ? `GeoPixel: ${worldId} loaded from cache!`
          : `GeoPixel: ${worldId} has been generated!`)
        reloadGame()
        loadWorldList()
        btnGeopixel.disabled = false
        btnGenerate.disabled = false
      } else if (job.status === 'error') {
        clearInterval(interval)
        const msg = job.log ? job.log.slice(-300) : 'unknown error'
        if (geopixelStatus) {
          geopixelStatus.textContent = `❌ Generation failed: ${msg}`
          geopixelStatus.className = 'geopixel-status error'
        }
        setStatus('GeoPixel generation failed — check terminal logs')
        btnGeopixel.disabled = false
        btnGenerate.disabled = false
      } else {
        // still running
        const elapsed = Math.round((Date.now() - _pollStart) / 1000)
        if (geopixelStatus) {
          geopixelStatus.textContent = `⏳ GeoPixel AI pipeline running... (${elapsed}s) — steps 2–6 in progress`
        }
      }
    } catch (e) {
      // network hiccup — keep polling
    }
  }, 5000)

  // Track start time for elapsed display
  const _pollStart = Date.now()
}

// ---- Event handlers ----
if (btnGeopixel) {
  btnGeopixel.addEventListener('click', handleGeopixelClick)
}

// ---- Zoom buttons ----
btnZoomIn.addEventListener('click', () => applyZoom(1.5))
btnZoomOut.addEventListener('click', () => applyZoom(1 / 1.5))

// ---- Local image upload ----
btnUpload.addEventListener('click', (e) => {
  e.stopPropagation()
  uploadMenu.classList.toggle('open')
})

document.addEventListener('click', () => uploadMenu.classList.remove('open'))

function triggerUpload(type) {
  localImageType = type
  uploadMenu.classList.remove('open')
  localImgInput.value = ''
  localImgInput.click()
}

uploadOptionPhoto3d.addEventListener('click', () => triggerUpload('photo3d'))
uploadOptionPixel.addEventListener('click', () => triggerUpload('pixel'))

localImgInput.addEventListener('change', () => {
  const file = localImgInput.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    currentLocationName = locationInput.value.trim() || 'local'
    if (localImageType === 'pixel') {
      // Pixel map: show directly in result panel, unlock GeoPixel immediately
      currentPixelArtDataUrl = e.target.result
      resultPlaceholder.style.display = 'none'
      resultLoading.classList.remove('active')
      resultImg.src = currentPixelArtDataUrl
      resultImg.style.display = 'block'
      generatedWorldId = null
      updateGeopixelButton()
      btnGeopixel.disabled = false
      setStatus(`Pixel map loaded: ${file.name} — click "Generate GeoPixel Game"`)
    } else {
      // 3D photo: show in left viewer panel for capture + generate
      localCapturedImage = e.target.result
      destroyViewer()
      viewerPlaceholder.style.display = 'none'
      viewerContainer.style.display = 'none'
      localImgPreview.src = localCapturedImage
      localImgPreview.style.display = 'block'
      viewerLoading.classList.remove('active')
      zoomControls.style.display = 'none'
      btnGenerate.disabled = false
      btnGenerateGlobal.disabled = false
      setStatus(`3D image loaded: ${file.name} — click "Generate Pixel Map"`)
    }
  }
  reader.readAsDataURL(file)
})

// ---- Global Map (three-image pipeline via global_server.py on port 5002) ----
async function generateGlobalMap(skipCache = false) {
  if (currentLat === null || currentLon === null) {
    setStatus('Load a map location first')
    return
  }

  // Use effective lat/lon (after satellite pan) for whitebox and 3D tiles
  const eff = getEffectiveLatLon()
  const effLat = eff.lat
  const effLon = eff.lon
  if (effLat !== currentLat || effLon !== currentLon) {
    setStatus(`Aligned to ${effLat.toFixed(5)}, ${effLon.toFixed(5)} — generating...`)
  }

  // 1. Check pixel map cache first — if hit, skip 3D Tiles + OSM entirely
  const styleVal = styleInput ? styleInput.value.trim() : ''
  if (!skipCache) {
    try {
      const checkRes = await fetch(
        `${GLOBAL_API}/api/check-pixel-cache?lat=${currentLat}&lon=${currentLon}&style=${encodeURIComponent(styleVal)}`
      )
      const check = await checkRes.json()
      if (check.cached && check.image) {
        globalResultImg.src = check.image
        globalResultImg.style.display = 'block'
        globalResultPlaceholder.style.display = 'none'
        globalResultLoading.classList.remove('active')
        btnRefreshGlobal.style.display = ''
        currentPixelArtDataUrl = check.image
        generatedWorldId = null
        updateGeopixelButton()
        if (btnGeopixel) btnGeopixel.disabled = false
        setStatus('Global pixel map loaded from cache!')
        btnGenerateGlobal.disabled = false
        btnGenerate.disabled = false
        return
      }
    } catch {}
  }

  // Ensure 3D tiles viewer is ready for isometric capture (satellite stays visible in UI)
  if (!renderer || !transition || !tilesLoaded || !tiles || !tiles.visibleTiles || tiles.visibleTiles.size === 0) {
    setStatus('Loading 3D view for isometric capture...')
    try {
      await ensure3DTilesForCapture(effLat, effLon, 200)
    } catch (e) {
      setStatus(`Global pixel map failed: ${e.message}`)
      btnGenerateGlobal.disabled = false
      btnGenerate.disabled = false
      return
    }
  }

  // Reset panels
  wbPlaceholder.style.display = 'none'
  wbImg.style.display = 'none'
  wbLoading.classList.add('active')
  globalResultPlaceholder.style.display = 'flex'
  globalResultImg.style.display = 'none'
  globalResultLoading.classList.remove('active')
  btnGenerateGlobal.disabled = true
  btnGenerate.disabled = true
  btnRefreshWb.style.display = 'none'
  btnRefreshGlobal.style.display = 'none'
  setStatus('Fetching OSM whitebox...')

  try {
    // Step 1: generate OSM whitebox for this location
    const wbRes = await fetch(`${GLOBAL_API}/api/whitebox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: effLat, lon: effLon, radius: 400, skip_cache: skipCache }),
    })
    if (!wbRes.ok) {
      const err = await wbRes.json()
      throw new Error(err.error || 'Whitebox generation failed')
    }
    const { image: whiteboxDataUrl } = await wbRes.json()

    wbLoading.classList.remove('active')
    wbImg.src = whiteboxDataUrl
    wbImg.style.display = 'block'
    btnRefreshWb.style.display = ''

    // Step 2: capture 3D tiles isometric view as color reference
    const renderDataUrl = captureCanvas(true)
    if (!renderDataUrl) throw new Error('Cannot capture view — load a map first')

    // Step 3: Gemini 3.1 multi-image pipeline (whitebox + render + style → pixel art)
    globalResultPlaceholder.style.display = 'none'
    globalResultLoading.classList.add('active')
    setStatus('Generating global pixel map...')

    const genRes = await fetch(`${GLOBAL_API}/api/generate-three`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        whitebox_image: whiteboxDataUrl,
        render_image: renderDataUrl,
        style_prompt: styleInput ? styleInput.value.trim() : '',
        location: currentLocationName,
        lat: effLat,
        lon: effLon,
        skip_cache: skipCache,
      }),
    })
    if (!genRes.ok) {
      const err = await genRes.json()
      throw new Error(err.error || 'Generation failed')
    }
    const { image: globalPixelDataUrl } = await genRes.json()

    globalResultImg.src = globalPixelDataUrl
    globalResultImg.style.display = 'block'
    globalResultPlaceholder.style.display = 'none'
    btnRefreshGlobal.style.display = ''
    setStatus('Global pixel map ready! Click "Generate GeoPixel Game" to import.')

    // Store result so GeoPixel button works
    currentPixelArtDataUrl = globalPixelDataUrl
    generatedWorldId = null
    updateGeopixelButton()
    if (btnGeopixel) btnGeopixel.disabled = false

  } catch (e) {
    wbLoading.classList.remove('active')
    globalResultLoading.classList.remove('active')
    setStatus(`Global map failed: ${e.message}`)
    wbPlaceholder.innerHTML = `<div class="placeholder-icon" style="font-size:28px;">❌</div><div class="error-msg" style="font-size:11px;padding:4px 8px;">${e.message}</div>`
    wbPlaceholder.style.display = 'flex'
    globalResultPlaceholder.style.display = 'flex'
  } finally {
    globalResultLoading.classList.remove('active')
    btnGenerateGlobal.disabled = false
    btnGenerate.disabled = false
  }
}

btnGenerateGlobal.addEventListener('click', generateGlobalMap)

// ---- Reset pan button ----
if (btnResetPan) {
  btnResetPan.addEventListener('click', () => {
    satellitePanX = 0
    satellitePanY = 0
    updateSatelliteTransform()
    if (btnResetPan) btnResetPan.style.display = 'none'
    setStatus(`Loaded: ${currentLocationName}`)
  })
}

// ---- Refresh button handlers ----
btnRefreshView.addEventListener('click', async () => {
  if (currentLat === null || currentLon === null) return
  btnRefreshView.style.display = 'none'
  viewerLoading.classList.add('active')
  viewerLoadingText.textContent = 'Refreshing satellite view...'
  satelliteLoaded = false
  satelliteDataUrl = null
  satellitePanX = 0
  satellitePanY = 0
  if (btnResetPan) btnResetPan.style.display = 'none'
  // Fetch with refresh=1 to bypass cache
  try {
    const res = await fetch(`/api/satellite?lat=${currentLat}&lon=${currentLon}&zoom=18&size=640&scale=2&refresh=1`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    satelliteDataUrl = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
    satelliteImg.src = satelliteDataUrl
    viewerLoading.classList.remove('active')
    satelliteLoaded = true
    btnRefreshView.style.display = ''
    setStatus(`Satellite refreshed: ${currentLocationName}`)
  } catch (e) {
    viewerLoading.classList.remove('active')
    btnRefreshView.style.display = ''
    setStatus(`Refresh failed: ${e.message}`)
  }
})

btnRefreshPixel.addEventListener('click', () => {
  if (currentLat === null || currentLon === null) return
  generatePixelArt(true)  // skipCache = true
})

btnRefreshWb.addEventListener('click', () => {
  if (currentLat === null || currentLon === null) return
  generateGlobalMap(true)  // skipCache = true
})

btnRefreshGlobal.addEventListener('click', () => {
  if (currentLat === null || currentLon === null) return
  generateGlobalMap(true)  // skipCache = true
})

// ---- Global error traps for debugging 3D Tiles ----
window.addEventListener('error', (e) => {
  console.error('GLOBAL ERROR:', e.message, 'at', e.filename, ':', e.lineno, ':', e.colno)
  console.error('Error object:', e.error)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('UNHANDLED REJECTION:', e.reason)
  console.error('Stack:', e.reason?.stack)
})

// ---- Init ----
async function init() {
  await fetchConfig()
  loadWorldList()
  setStatus('Ready — enter a location')
}

init()
