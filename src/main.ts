import './styles.css'

type Mode = 'point' | 'link' | 'select' | 'camera'

interface Point {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  anchored: boolean
}

interface Spring {
  id: number
  a: number
  b: number
  restLength: number
  stiffness: number
}

type Selection = { type: 'point'; id: number } | { type: 'spring'; id: number } | null

interface Camera {
  x: number
  y: number
  zoom: number
}

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
const ctx = canvas.getContext('2d')!
const app = document.querySelector<HTMLElement>('#app')!
const toolbar = document.querySelector<HTMLElement>('.toolbar')!
const hint = document.querySelector<HTMLElement>('#hint')!
const inspector = document.querySelector<HTMLElement>('#inspector')!
const selectionType = document.querySelector<HTMLElement>('#selection-type')!
const selectionName = document.querySelector<HTMLElement>('#selection-name')!
const springControls = document.querySelector<HTMLElement>('#spring-controls')!
const pointControls = document.querySelector<HTMLElement>('#point-controls')!
const restInput = document.querySelector<HTMLInputElement>('#rest-length')!
const stiffnessInput = document.querySelector<HTMLInputElement>('#stiffness')!
const restOutput = document.querySelector<HTMLOutputElement>('#rest-output')!
const stiffnessOutput = document.querySelector<HTMLOutputElement>('#stiffness-output')!
const anchorToggle = document.querySelector<HTMLButtonElement>('#anchor-toggle')!
const playButton = document.querySelector<HTMLButtonElement>('#play-button')!
const welcome = document.querySelector<HTMLElement>('#welcome')!
const helpDialog = document.querySelector<HTMLDialogElement>('#help-dialog')!
const zoomOutput = document.querySelector<HTMLOutputElement>('#zoom-output')!

let width = window.innerWidth
let height = window.innerHeight
let dpr = Math.min(window.devicePixelRatio || 1, 2)
let mode: Mode = 'point'
let running = false
let selection: Selection = null
let pendingLinkPoint: number | null = null
let nextPointId = 1
let nextSpringId = 1
let draggedPoint: Point | null = null
let dragMoved = false
let pointerStart = { x: 0, y: 0 }
let lastTime = performance.now()
const camera: Camera = { x: 0, y: 0, zoom: 1 }
const cameraTarget: Camera = { x: 0, y: 0, zoom: 1 }
const activeCameraPointers = new Map<number, { x: number; y: number }>()
let panStart: { x: number; y: number; cameraX: number; cameraY: number } | null = null
let pinchStart: { distance: number; zoom: number; worldX: number; worldY: number } | null = null

const points: Point[] = []
const springs: Spring[] = []

function addPoint(x: number, y: number, anchored = false): Point {
  const point = { id: nextPointId++, x, y, vx: 0, vy: 0, anchored }
  points.push(point)
  return point
}

function addSpring(a: Point, b: Point, restLength?: number, stiffness = 0.018): Spring | null {
  if (a.id === b.id || springs.some((spring) =>
    (spring.a === a.id && spring.b === b.id) || (spring.a === b.id && spring.b === a.id))) {
    return null
  }
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  const spring = {
    id: nextSpringId++,
    a: a.id,
    b: b.id,
    restLength: restLength ?? Math.max(60, Math.min(180, distance)),
    stiffness,
  }
  springs.push(spring)
  return spring
}

function makeStarterNetwork(): void {
  const cx = width / 2
  const cy = height / 2 - (width < 700 ? 70 : 10)
  const radius = Math.min(width * 0.25, 160)
  const top = addPoint(cx, cy - radius * 0.8, true)
  const left = addPoint(cx - radius, cy + radius * 0.15)
  const right = addPoint(cx + radius, cy + radius * 0.15)
  const lower = addPoint(cx, cy + radius)
  const middle = addPoint(cx, cy + radius * 0.12)
  addSpring(top, left, radius * 0.9, 0.015)
  addSpring(top, right, radius * 0.9, 0.015)
  addSpring(left, lower, radius, 0.021)
  addSpring(right, lower, radius, 0.021)
  addSpring(top, middle, radius * 0.7, 0.026)
  addSpring(left, middle, radius * 0.7, 0.018)
  addSpring(right, middle, radius * 0.7, 0.018)
  addSpring(lower, middle, radius * 0.7, 0.026)
}

function resizeCanvas(): void {
  const oldWidth = width
  const oldHeight = height
  width = window.innerWidth
  height = window.innerHeight
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  if (oldWidth && oldHeight) {
    const dx = (width - oldWidth) / 2
    const dy = (height - oldHeight) / 2
    camera.x += dx
    camera.y += dy
    cameraTarget.x += dx
    cameraTarget.y += dy
  }
}

function pointById(id: number): Point | undefined {
  return points.find((point) => point.id === id)
}

function springById(id: number): Spring | undefined {
  return springs.find((spring) => spring.id === id)
}

function getCanvasPosition(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function screenToWorld(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: (position.x - camera.x) / camera.zoom,
    y: (position.y - camera.y) / camera.zoom,
  }
}

function worldToScreen(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: position.x * camera.zoom + camera.x,
    y: position.y * camera.zoom + camera.y,
  }
}

function hitPoint(x: number, y: number): Point | null {
  for (let index = points.length - 1; index >= 0; index--) {
    if (Math.hypot(points[index].x - x, points[index].y - y) <= 22 / camera.zoom) return points[index]
  }
  return null
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(x - a.x, y - a.y)
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared))
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy))
}

function hitSpring(x: number, y: number): Spring | null {
  let closest: Spring | null = null
  let distance = 12 / camera.zoom
  springs.forEach((spring) => {
    const a = pointById(spring.a)
    const b = pointById(spring.b)
    if (!a || !b) return
    const candidate = distanceToSegment(x, y, a, b)
    if (candidate < distance) {
      distance = candidate
      closest = spring
    }
  })
  return closest
}

function setMode(nextMode: Mode): void {
  mode = nextMode
  pendingLinkPoint = null
  document.querySelectorAll<HTMLButtonElement>('.tool').forEach((button) => {
    const active = button.dataset.mode === mode
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  const hints: Record<Mode, string> = {
    point: 'Tap anywhere to place a point',
    link: 'Select two points to connect them',
    select: 'Select or drag any point or spring',
    camera: 'Drag to pan · pinch or scroll to zoom',
  }
  hint.textContent = hints[mode]
  app.classList.toggle('camera-mode', mode === 'camera')
  canvas.style.cursor = mode === 'point' ? 'crosshair' : mode === 'camera' ? 'grab' : 'default'
}

function select(nextSelection: Selection): void {
  selection = nextSelection
  inspector.classList.toggle('visible', Boolean(selection))
  if (!selection) return

  if (selection.type === 'point') {
    const point = pointById(selection.id)
    if (!point) return
    const index = points.indexOf(point) + 1
    selectionType.textContent = 'Point selected'
    selectionName.textContent = `Point ${String(index).padStart(2, '0')}`
    springControls.hidden = true
    pointControls.hidden = false
    anchorToggle.setAttribute('aria-checked', String(point.anchored))
    anchorToggle.classList.toggle('active', point.anchored)
  } else {
    const spring = springById(selection.id)
    if (!spring) return
    const index = springs.indexOf(spring) + 1
    selectionType.textContent = 'Spring selected'
    selectionName.textContent = `Spring ${String(index).padStart(2, '0')}`
    springControls.hidden = false
    pointControls.hidden = true
    restInput.value = String(spring.restLength)
    stiffnessInput.value = String(spring.stiffness)
    updateInspectorOutputs()
  }
  requestAnimationFrame(revealSelection)
}

function selectionScreenBounds(): { left: number; right: number; top: number; bottom: number } | null {
  if (!selection) return null
  let selectedPoints: Point[] = []
  if (selection.type === 'point') {
    const point = pointById(selection.id)
    if (point) selectedPoints = [point]
  } else {
    const spring = springById(selection.id)
    const a = spring ? pointById(spring.a) : undefined
    const b = spring ? pointById(spring.b) : undefined
    if (a && b) selectedPoints = [a, b]
  }
  if (!selectedPoints.length) return null
  const screenPoints = selectedPoints.map(worldToScreen)
  const padding = selection.type === 'point' ? 22 : 14
  return {
    left: Math.min(...screenPoints.map((point) => point.x)) - padding,
    right: Math.max(...screenPoints.map((point) => point.x)) + padding,
    top: Math.min(...screenPoints.map((point) => point.y)) - padding,
    bottom: Math.max(...screenPoints.map((point) => point.y)) + padding,
  }
}

function revealSelection(): void {
  const bounds = selectionScreenBounds()
  if (!bounds || !inspector.classList.contains('visible')) return
  const inspectorRect = inspector.getBoundingClientRect()
  const toolbarRect = toolbar.getBoundingClientRect()
  const margin = 28
  const safe = {
    left: margin,
    right: width - margin,
    top: 82 + margin,
    bottom: toolbarRect.top - margin,
  }
  let dx = 0
  let dy = 0

  if (bounds.left < safe.left) dx += safe.left - bounds.left
  else if (bounds.right > safe.right) dx += safe.right - bounds.right
  if (bounds.top < safe.top) dy += safe.top - bounds.top
  else if (bounds.bottom > safe.bottom) dy += safe.bottom - bounds.bottom

  const shifted = {
    left: bounds.left + dx,
    right: bounds.right + dx,
    top: bounds.top + dy,
    bottom: bounds.bottom + dy,
  }
  const overlapsInspector =
    shifted.right > inspectorRect.left - margin &&
    shifted.left < inspectorRect.right + margin &&
    shifted.bottom > inspectorRect.top - margin &&
    shifted.top < inspectorRect.bottom + margin

  if (overlapsInspector) {
    if (width <= 700) {
      dy += inspectorRect.top - margin - shifted.bottom
    } else {
      dx += inspectorRect.left - margin - shifted.right
    }
  }

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    cameraTarget.x += dx
    cameraTarget.y += dy
  }
}

function updateInspectorOutputs(): void {
  restOutput.value = `${Math.round(Number(restInput.value))} px`
  stiffnessOutput.value = Number(stiffnessInput.value).toFixed(3)
}

function setRunning(nextRunning: boolean): void {
  running = nextRunning
  playButton.classList.toggle('running', running)
  playButton.querySelector('span')!.textContent = running ? 'Pause' : 'Start'
  app.classList.toggle('simulating', running)
  hint.textContent = running ? 'Drag a point and feel the network respond' : ({
    point: 'Tap anywhere to place a point',
    link: 'Select two points to connect them',
    select: 'Select or drag any point or spring',
    camera: 'Drag to pan · pinch or scroll to zoom',
  } as Record<Mode, string>)[mode]
}

function deleteSelection(): void {
  if (!selection) return
  if (selection.type === 'point') {
    const pointIndex = points.findIndex((point) => point.id === selection!.id)
    if (pointIndex >= 0) {
      const id = points[pointIndex].id
      points.splice(pointIndex, 1)
      for (let i = springs.length - 1; i >= 0; i--) {
        if (springs[i].a === id || springs[i].b === id) springs.splice(i, 1)
      }
    }
  } else {
    const springIndex = springs.findIndex((spring) => spring.id === selection!.id)
    if (springIndex >= 0) springs.splice(springIndex, 1)
  }
  select(null)
}

function handleCanvasTap(x: number, y: number, targetPoint: Point | null): void {
  if (mode === 'point') {
    if (targetPoint) {
      select({ type: 'point', id: targetPoint.id })
    } else {
      const point = addPoint(x, y)
      select({ type: 'point', id: point.id })
    }
    return
  }

  if (mode === 'link') {
    if (!targetPoint) {
      pendingLinkPoint = null
      return
    }
    if (pendingLinkPoint === null) {
      pendingLinkPoint = targetPoint.id
      select({ type: 'point', id: targetPoint.id })
      hint.textContent = 'Now choose another point'
    } else {
      const first = pointById(pendingLinkPoint)
      const spring = first ? addSpring(first, targetPoint) : null
      pendingLinkPoint = null
      if (spring) select({ type: 'spring', id: spring.id })
      hint.textContent = spring ? 'Spring added — select two more points' : 'Those points are already connected'
    }
    return
  }

  if (targetPoint) {
    select({ type: 'point', id: targetPoint.id })
  } else {
    const spring = hitSpring(x, y)
    select(spring ? { type: 'spring', id: spring.id } : null)
  }
}

function cameraPointerCenter(): { x: number; y: number } {
  const pointers = [...activeCameraPointers.values()]
  return {
    x: pointers.reduce((sum, pointer) => sum + pointer.x, 0) / pointers.length,
    y: pointers.reduce((sum, pointer) => sum + pointer.y, 0) / pointers.length,
  }
}

function cameraPointerDistance(): number {
  const pointers = [...activeCameraPointers.values()]
  return pointers.length < 2 ? 0 : Math.hypot(pointers[1].x - pointers[0].x, pointers[1].y - pointers[0].y)
}

function clampZoom(zoom: number): number {
  return Math.max(0.25, Math.min(3, zoom))
}

function setZoom(zoom: number, focal = { x: width / 2, y: height / 2 }, smooth = false): void {
  const nextZoom = clampZoom(zoom)
  const worldAtFocal = screenToWorld(focal)
  const nextX = focal.x - worldAtFocal.x * nextZoom
  const nextY = focal.y - worldAtFocal.y * nextZoom
  cameraTarget.x = nextX
  cameraTarget.y = nextY
  cameraTarget.zoom = nextZoom
  if (!smooth) {
    camera.x = nextX
    camera.y = nextY
    camera.zoom = nextZoom
  }
  zoomOutput.value = `${Math.round(nextZoom * 100)}%`
}

function fitNetwork(): void {
  if (!points.length) {
    cameraTarget.x = 0
    cameraTarget.y = 0
    cameraTarget.zoom = 1
    zoomOutput.value = '100%'
    return
  }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const usableWidth = width - (width > 700 && selection ? 370 : 80)
  const usableHeight = height - (width <= 700 && selection ? 390 : 190)
  const zoom = clampZoom(Math.min(1.25, usableWidth / Math.max(maxX - minX + 100, 1), usableHeight / Math.max(maxY - minY + 100, 1)))
  const centerX = width > 700 && selection ? (width - 330) / 2 : width / 2
  const centerY = width <= 700 && selection ? (height - 290) / 2 : height / 2
  cameraTarget.zoom = zoom
  cameraTarget.x = centerX - ((minX + maxX) / 2) * zoom
  cameraTarget.y = centerY - ((minY + maxY) / 2) * zoom
  zoomOutput.value = `${Math.round(zoom * 100)}%`
}

canvas.addEventListener('pointerdown', (event) => {
  welcome.classList.add('hidden')
  const screen = getCanvasPosition(event)
  pointerStart = screen
  dragMoved = false
  canvas.setPointerCapture(event.pointerId)

  if (mode === 'camera') {
    activeCameraPointers.set(event.pointerId, screen)
    if (activeCameraPointers.size === 1) {
      panStart = { x: screen.x, y: screen.y, cameraX: camera.x, cameraY: camera.y }
      canvas.style.cursor = 'grabbing'
    } else if (activeCameraPointers.size === 2) {
      const center = cameraPointerCenter()
      const worldCenter = screenToWorld(center)
      pinchStart = {
        distance: cameraPointerDistance(),
        zoom: camera.zoom,
        worldX: worldCenter.x,
        worldY: worldCenter.y,
      }
    }
    return
  }

  const world = screenToWorld(screen)
  const target = hitPoint(world.x, world.y)
  if (target) {
    draggedPoint = target
    target.vx = 0
    target.vy = 0
  }
})

canvas.addEventListener('pointermove', (event) => {
  const screen = getCanvasPosition(event)
  if (mode === 'camera' && activeCameraPointers.has(event.pointerId)) {
    activeCameraPointers.set(event.pointerId, screen)
    if (activeCameraPointers.size >= 2 && pinchStart) {
      const center = cameraPointerCenter()
      const zoom = clampZoom(pinchStart.zoom * cameraPointerDistance() / Math.max(pinchStart.distance, 1))
      camera.zoom = zoom
      camera.x = center.x - pinchStart.worldX * zoom
      camera.y = center.y - pinchStart.worldY * zoom
      Object.assign(cameraTarget, camera)
      zoomOutput.value = `${Math.round(zoom * 100)}%`
    } else if (panStart) {
      camera.x = panStart.cameraX + screen.x - panStart.x
      camera.y = panStart.cameraY + screen.y - panStart.y
      Object.assign(cameraTarget, camera)
    }
    return
  }

  const world = screenToWorld(screen)
  if (draggedPoint) {
    const distance = Math.hypot(screen.x - pointerStart.x, screen.y - pointerStart.y)
    if (distance > 3) dragMoved = true
    if (dragMoved) {
      draggedPoint.x = world.x
      draggedPoint.y = world.y
      draggedPoint.vx = 0
      draggedPoint.vy = 0
    }
  } else {
    canvas.style.cursor = hitPoint(world.x, world.y) ? 'grab' : mode === 'point' ? 'crosshair' : 'default'
  }
})

function endPointer(event: PointerEvent): void {
  const screen = getCanvasPosition(event)
  if (mode === 'camera') {
    activeCameraPointers.delete(event.pointerId)
    pinchStart = null
    const remaining = [...activeCameraPointers.values()][0]
    panStart = remaining ? { x: remaining.x, y: remaining.y, cameraX: camera.x, cameraY: camera.y } : null
    canvas.style.cursor = activeCameraPointers.size ? 'grabbing' : 'grab'
  } else {
    const world = screenToWorld(screen)
    const target = hitPoint(world.x, world.y)
    if (!dragMoved) handleCanvasTap(world.x, world.y, target)
    draggedPoint = null
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
}

canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)
canvas.addEventListener('wheel', (event) => {
  if (mode !== 'camera') return
  event.preventDefault()
  const focal = { x: event.clientX, y: event.clientY }
  setZoom(camera.zoom * Math.exp(-event.deltaY * 0.0015), focal)
}, { passive: false })

document.querySelectorAll<HTMLButtonElement>('.tool').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode as Mode))
})

document.querySelector<HTMLButtonElement>('#zoom-out')!.addEventListener('click', () => {
  setZoom(cameraTarget.zoom / 1.25, undefined, true)
})
document.querySelector<HTMLButtonElement>('#zoom-in')!.addEventListener('click', () => {
  setZoom(cameraTarget.zoom * 1.25, undefined, true)
})
document.querySelector<HTMLButtonElement>('#reset-camera')!.addEventListener('click', fitNetwork)

playButton.addEventListener('click', () => {
  welcome.classList.add('hidden')
  setRunning(!running)
})

document.querySelector<HTMLButtonElement>('#welcome-button')!.addEventListener('click', () => {
  welcome.classList.add('hidden')
})

document.querySelector<HTMLButtonElement>('#close-inspector')!.addEventListener('click', () => select(null))
document.querySelector<HTMLButtonElement>('#delete-selection')!.addEventListener('click', deleteSelection)

document.querySelector<HTMLButtonElement>('#clear-button')!.addEventListener('click', () => {
  points.splice(0)
  springs.splice(0)
  pendingLinkPoint = null
  setRunning(false)
  select(null)
  setMode('point')
  cameraTarget.x = 0
  cameraTarget.y = 0
  cameraTarget.zoom = 1
  zoomOutput.value = '100%'
})

document.querySelector<HTMLButtonElement>('#info-button')!.addEventListener('click', () => helpDialog.showModal())
document.querySelector<HTMLButtonElement>('#close-help')!.addEventListener('click', () => helpDialog.close())
helpDialog.addEventListener('click', (event) => {
  if (event.target === helpDialog) helpDialog.close()
})

restInput.addEventListener('input', () => {
  if (selection?.type === 'spring') {
    const spring = springById(selection.id)
    if (spring) spring.restLength = Number(restInput.value)
  }
  updateInspectorOutputs()
})

stiffnessInput.addEventListener('input', () => {
  if (selection?.type === 'spring') {
    const spring = springById(selection.id)
    if (spring) spring.stiffness = Number(stiffnessInput.value)
  }
  updateInspectorOutputs()
})

anchorToggle.addEventListener('click', () => {
  if (selection?.type !== 'point') return
  const point = pointById(selection.id)
  if (!point) return
  point.anchored = !point.anchored
  point.vx = 0
  point.vy = 0
  anchorToggle.setAttribute('aria-checked', String(point.anchored))
  anchorToggle.classList.toggle('active', point.anchored)
})

function updatePhysics(delta: number): void {
  const step = Math.min(delta / 16.667, 2)
  const forces = new Map<number, { x: number; y: number }>()
  points.forEach((point) => forces.set(point.id, { x: 0, y: 0.1 }))

  springs.forEach((spring) => {
    const a = pointById(spring.a)
    const b = pointById(spring.b)
    if (!a || !b) return
    const dx = b.x - a.x
    const dy = b.y - a.y
    const distance = Math.max(Math.hypot(dx, dy), 0.001)
    const magnitude = (distance - spring.restLength) * spring.stiffness
    const fx = (dx / distance) * magnitude
    const fy = (dy / distance) * magnitude
    forces.get(a.id)!.x += fx
    forces.get(a.id)!.y += fy
    forces.get(b.id)!.x -= fx
    forces.get(b.id)!.y -= fy
  })

  points.forEach((point) => {
    if (point.anchored || point === draggedPoint) {
      point.vx = 0
      point.vy = 0
      return
    }
    const force = forces.get(point.id)!
    point.vx = (point.vx + force.x * step) * Math.pow(0.987, step)
    point.vy = (point.vy + force.y * step) * Math.pow(0.987, step)
    const speed = Math.hypot(point.vx, point.vy)
    if (speed > 22) {
      point.vx = (point.vx / speed) * 22
      point.vy = (point.vy / speed) * 22
    }
    point.x += point.vx * step
    point.y += point.vy * step
  })
}

function drawGrid(): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#f3f0e7'
  ctx.fillRect(0, 0, width, height)
  ctx.setTransform(
    dpr * camera.zoom,
    0,
    0,
    dpr * camera.zoom,
    dpr * camera.x,
    dpr * camera.y,
  )
  ctx.fillStyle = 'rgba(31, 42, 38, 0.09)'
  const spacing = 28
  const topLeft = screenToWorld({ x: 0, y: 0 })
  const bottomRight = screenToWorld({ x: width, y: height })
  const startX = Math.floor(topLeft.x / spacing) * spacing
  const startY = Math.floor(topLeft.y / spacing) * spacing
  for (let x = startX; x < bottomRight.x + spacing; x += spacing) {
    for (let y = startY; y < bottomRight.y + spacing; y += spacing) {
      ctx.beginPath()
      ctx.arc(x, y, 0.8 / Math.sqrt(camera.zoom), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawSpring(spring: Spring): void {
  const a = pointById(spring.a)
  const b = pointById(spring.b)
  if (!a || !b) return
  const selected = selection?.type === 'spring' && selection.id === spring.id
  const dx = b.x - a.x
  const dy = b.y - a.y
  const distance = Math.max(Math.hypot(dx, dy), 1)
  const normalX = -dy / distance
  const normalY = dx / distance
  const segments = Math.max(6, Math.round(distance / 20))
  const amplitude = Math.min(7, distance / 12)

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (selected) {
    ctx.strokeStyle = 'rgba(244, 123, 65, 0.18)'
    ctx.lineWidth = 12
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.strokeStyle = selected ? '#e9692c' : '#26362f'
  ctx.lineWidth = selected ? 2.7 : 2
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  for (let i = 1; i < segments; i++) {
    const t = i / segments
    const offset = (i % 2 === 0 ? -1 : 1) * amplitude
    ctx.lineTo(a.x + dx * t + normalX * offset, a.y + dy * t + normalY * offset)
  }
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.restore()
}

function drawPoint(point: Point): void {
  const selected = selection?.type === 'point' && selection.id === point.id
  const linking = pendingLinkPoint === point.id
  ctx.save()
  if (selected || linking) {
    ctx.strokeStyle = linking ? '#e9692c' : 'rgba(38, 54, 47, 0.35)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(point.x, point.y, 17, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.shadowColor = 'rgba(26, 36, 32, 0.18)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  ctx.fillStyle = point.anchored ? '#e9692c' : '#fefcf6'
  ctx.strokeStyle = point.anchored ? '#c85220' : '#25372f'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(point.x, point.y, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.shadowColor = 'transparent'
  if (point.anchored) {
    ctx.fillStyle = '#fff8ef'
    ctx.beginPath()
    ctx.arc(point.x, point.y, 2.3, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = '#25372f'
    ctx.beginPath()
    ctx.arc(point.x, point.y, 2.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function render(time: number): void {
  const delta = time - lastTime
  lastTime = time
  if (running) updatePhysics(delta)
  if (!activeCameraPointers.size) {
    const easing = 1 - Math.pow(0.82, Math.min(delta / 16.667, 2))
    camera.x += (cameraTarget.x - camera.x) * easing
    camera.y += (cameraTarget.y - camera.y) * easing
    camera.zoom += (cameraTarget.zoom - camera.zoom) * easing
  }
  drawGrid()
  springs.forEach(drawSpring)
  points.forEach(drawPoint)
  requestAnimationFrame(render)
}

window.addEventListener('resize', resizeCanvas)
toolbar.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false })

resizeCanvas()
makeStarterNetwork()
setMode('point')
requestAnimationFrame(render)
