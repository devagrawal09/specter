import type { ColonyBenchPosition } from '../simulation/state'
import type { ColonyBenchCellEntity, ColonyBenchGameModel } from './model'

const DEFAULT_TILE_SIZE = 64
const DEFAULT_TILE_GAP = 8
const DEFAULT_PADDING = 24
const OBJECT_LAYER: Record<ColonyBenchCellEntity['kind'], number> = {
  terrain: 0,
  road: 1,
  constructionSite: 2,
  source: 3,
  controller: 4,
  base: 5,
  worker: 6,
  intent: 7,
}
const BOARD_LABEL_PRIORITY: Partial<
  Record<ColonyBenchCellEntity['kind'], number>
> = {
  base: 2,
  source: 3,
  controller: 4,
  worker: 5,
}

export type ColonyBenchSvgBoardTile = {
  key: string
  position: ColonyBenchPosition
  x: number
  y: number
  width: number
  height: number
  coordLabel: string
  selected: boolean
  ariaLabel: string
  tooltip: string
}

export type ColonyBenchSvgObjectPrimitive = ColonyBenchCellEntity & {
  tileKey: string
  cx: number
  cy: number
  labelY: number
  boardLabel: string
  labelVisible: boolean
  meterVisible: boolean
}

export type ColonyBenchSvgIntentLink = {
  key: string
  sourceObjectId: string
  targetObjectId: string
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
}

export type ColonyBenchSvgBoardModel = {
  viewBox: string
  width: number
  height: number
  columns: number
  rows: number
  tiles: ColonyBenchSvgBoardTile[]
  objects: ColonyBenchSvgObjectPrimitive[]
  intentLinks: ColonyBenchSvgIntentLink[]
}

function cellKey(position: ColonyBenchPosition) {
  return `${position.x},${position.y}`
}

function samePosition(
  left: ColonyBenchPosition | null | undefined,
  right: ColonyBenchPosition,
) {
  return Boolean(left && left.x === right.x && left.y === right.y)
}

function escapeSvg(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function isBoardLabeledKind(object: ColonyBenchCellEntity) {
  return !['terrain', 'road', 'constructionSite', 'intent'].includes(
    object.kind,
  )
}

function selectPrimaryBoardLabel(labelableEntities: ColonyBenchCellEntity[]) {
  return labelableEntities.reduce<ColonyBenchCellEntity | null>(
    (selected, entity) => {
      if (!selected) return entity
      const selectedPriority = BOARD_LABEL_PRIORITY[selected.kind] ?? 0
      const entityPriority = BOARD_LABEL_PRIORITY[entity.kind] ?? 0
      return entityPriority > selectedPriority ? entity : selected
    },
    null,
  )
}

function trailingNumber(value: string) {
  return value.match(/(\d+)$/)?.[1] ?? ''
}

function levelNumber(value: string) {
  return value.match(/\bL(\d+)\b/i)?.[1] ?? trailingNumber(value)
}

function compactBoardLabel(object: ColonyBenchCellEntity) {
  switch (object.kind) {
    case 'base':
      return `B${levelNumber(object.label)}`
    case 'controller':
      return `C${levelNumber(object.label)}`
    case 'source':
      return `S${trailingNumber(object.label || object.id)}`
    case 'worker':
      return `W${trailingNumber(object.label || object.id)}`
    default:
      return object.label
  }
}

function isLinkedIntentObject(
  object: ColonyBenchSvgObjectPrimitive,
): object is ColonyBenchSvgObjectPrimitive & {
  kind: 'intent'
  relatedEntityId: string
} {
  return (
    object.kind === 'intent' &&
    typeof object.relatedEntityId === 'string' &&
    object.relatedEntityId.length > 0
  )
}

function buildIntentLinks(objects: ColonyBenchSvgObjectPrimitive[]) {
  const objectsById = new Map(objects.map((object) => [object.id, object]))

  return objects
    .filter(isLinkedIntentObject)
    .flatMap((target): ColonyBenchSvgIntentLink[] => {
      const source = objectsById.get(target.relatedEntityId)
      if (!source) return []

      return [
        {
          key: `${source.id}->${target.id}`,
          sourceObjectId: source.id,
          targetObjectId: target.id,
          x1: source.cx,
          y1: source.cy,
          x2: target.cx,
          y2: target.cy,
          label: `${source.label} → ${target.label}`,
        },
      ]
    })
}

function tileOrigin({
  position,
  minX,
  minY,
  tileSize,
  tileGap,
  padding,
}: {
  position: ColonyBenchPosition
  minX: number
  minY: number
  tileSize: number
  tileGap: number
  padding: number
}) {
  return {
    x: padding + (position.x - minX) * (tileSize + tileGap),
    y: padding + (position.y - minY) * (tileSize + tileGap),
  }
}

export function buildColonyBenchSvgBoardModel({
  model,
  selectedCell = null,
  tileSize = DEFAULT_TILE_SIZE,
  tileGap = DEFAULT_TILE_GAP,
  padding = DEFAULT_PADDING,
}: {
  model: ColonyBenchGameModel
  selectedCell?: ColonyBenchPosition | null
  tileSize?: number
  tileGap?: number
  padding?: number
}): ColonyBenchSvgBoardModel {
  const columns = model.bounds.maxX - model.bounds.minX + 1
  const rows = model.bounds.maxY - model.bounds.minY + 1
  const width =
    padding * 2 + columns * tileSize + Math.max(0, columns - 1) * tileGap
  const height = padding * 2 + rows * tileSize + Math.max(0, rows - 1) * tileGap
  const entitiesByCell = new Map(
    model.cells.map((cell) => [cellKey(cell), cell.entities] as const),
  )

  const tiles: ColonyBenchSvgBoardTile[] = []
  for (let y = model.bounds.minY; y <= model.bounds.maxY; y += 1) {
    for (let x = model.bounds.minX; x <= model.bounds.maxX; x += 1) {
      const position = { x, y }
      const key = cellKey(position)
      const origin = tileOrigin({
        position,
        minX: model.bounds.minX,
        minY: model.bounds.minY,
        tileSize,
        tileGap,
        padding,
      })
      const entities = entitiesByCell.get(key) ?? []
      const entityLabels = entities.map((entity) => entity.label)
      const entitySummaries = entities.map((entity) =>
        entity.detail.length > 0
          ? `${entity.label}: ${entity.detail}`
          : entity.label,
      )
      tiles.push({
        key,
        position,
        x: origin.x,
        y: origin.y,
        width: tileSize,
        height: tileSize,
        coordLabel: key,
        selected: samePosition(selectedCell, position),
        ariaLabel:
          entityLabels.length > 0
            ? `inspect cell ${key} containing ${entityLabels.join(', ')}`
            : `inspect cell ${key}`,
        tooltip:
          entitySummaries.length > 0
            ? `Cell ${key} · ${entitySummaries.join('; ')}`
            : `Cell ${key} · empty`,
      })
    }
  }

  const objects = model.cells
    .flatMap((cell) => {
      const origin = tileOrigin({
        position: cell,
        minX: model.bounds.minX,
        minY: model.bounds.minY,
        tileSize,
        tileGap,
        padding,
      })
      const cx = origin.x + tileSize / 2
      const cy = origin.y + tileSize / 2
      const labelableEntities = cell.entities.filter(isBoardLabeledKind)
      const labelCount = labelableEntities.length
      const primaryLabelId =
        selectPrimaryBoardLabel(labelableEntities)?.id ?? null
      return cell.entities.map((entity) => {
        const labelIndex = labelableEntities.findIndex(
          (candidate) => candidate.id === entity.id,
        )
        const labelLaneOffset =
          labelIndex >= 0 ? labelIndex - (labelCount - 1) / 2 : 0
        const labelVisible = entity.id === primaryLabelId
        return {
          ...entity,
          tileKey: cellKey(cell),
          cx,
          cy,
          labelY: labelVisible ? cy + 24 : cy + 24 + labelLaneOffset * 16,
          boardLabel: compactBoardLabel(entity),
          labelVisible,
          meterVisible: labelVisible,
        }
      })
    })
    .sort((left, right) => OBJECT_LAYER[left.kind] - OBJECT_LAYER[right.kind])

  return {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    columns,
    rows,
    tiles,
    objects,
    intentLinks: buildIntentLinks(objects),
  }
}

function renderTile(tile: ColonyBenchSvgBoardTile) {
  const className = `room-tile${tile.selected ? ' room-tile--selected' : ''}`
  return `<g class="${className}" data-cell-position="${escapeSvg(tile.key)}" role="gridcell" aria-label="${escapeSvg(tile.ariaLabel)}" tabindex="0">
    <title>${escapeSvg(tile.tooltip)}</title>
    <rect class="room-tile-frame" x="${tile.x}" y="${tile.y}" width="${tile.width}" height="${tile.height}" rx="16" ry="16"></rect>
    <text class="room-coordinate" x="${tile.x + 8}" y="${tile.y + 17}">${escapeSvg(tile.coordLabel)}</text>
  </g>`
}

function objectTitle(object: ColonyBenchSvgObjectPrimitive) {
  return `${object.label}: ${object.detail}`
}

function renderObjectShape(object: ColonyBenchSvgObjectPrimitive) {
  const className = `room-object room-object--${object.kind}`
  const title = `<title>${escapeSvg(objectTitle(object))}</title>`

  if (object.kind === 'intent') {
    return `<path class="${className}" d="M${object.cx} ${object.cy - 10} l10 10 l-10 10 l-10 -10 Z">${title}</path>`
  }

  if (object.kind === 'road') {
    return `<line class="${className}" x1="${object.cx - 20}" y1="${object.cy + 20}" x2="${object.cx + 20}" y2="${object.cy - 20}">${title}</line>`
  }

  if (object.kind === 'terrain') {
    return `<rect class="${className}" x="${object.cx - 20}" y="${object.cy - 20}" width="40" height="40" rx="10" ry="10">${title}</rect>`
  }

  if (object.kind === 'constructionSite') {
    return `<rect class="${className}" x="${object.cx - 17}" y="${object.cy - 17}" width="34" height="34" rx="8" ry="8">${title}</rect>`
  }

  const radiusByKind: Partial<Record<ColonyBenchCellEntity['kind'], number>> = {
    base: 14,
    controller: 13,
    worker: 10,
    source: 12,
  }
  return `<circle class="${className}" cx="${object.cx}" cy="${object.cy}" r="${radiusByKind[object.kind] ?? 11}">${title}</circle>`
}

function formatSvgNumber(value: number) {
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

function renderObjectMeter(object: ColonyBenchSvgObjectPrimitive) {
  const meter = object.meter
  if (!object.meterVisible || !meter || meter.max <= 0) return ''

  const width = 42
  const height = 5
  const x = object.cx - width / 2
  const y = object.labelY + 6
  const ratio = Math.min(1, Math.max(0, meter.value / meter.max))
  const fillWidth = width * ratio

  return `
  <g class="room-object-meter room-object-meter--${meter.kind}" aria-label="${escapeSvg(meter.label)}">
    <rect class="room-object-meter-track" x="${formatSvgNumber(x)}" y="${formatSvgNumber(y)}" width="${width}" height="${height}" rx="2.5" ry="2.5"></rect>
    <rect class="room-object-meter-fill" x="${formatSvgNumber(x)}" y="${formatSvgNumber(y)}" width="${formatSvgNumber(fillWidth)}" height="${height}" rx="2.5" ry="2.5"></rect>
  </g>`
}

function renderObjectLabelChip(object: ColonyBenchSvgObjectPrimitive) {
  if (!isBoardLabeledKind(object) || !object.labelVisible) return ''

  const width = Math.min(64, Math.max(34, object.boardLabel.length * 8.8 + 18))
  const height = 17
  const x = object.cx - width / 2
  const y = object.labelY - 12
  const ariaLabel =
    object.detail.length > 0
      ? `${object.label} details: ${object.detail}`
      : object.label

  return `
  <g class="room-object-label-chip room-object-label-chip--${object.kind}" aria-label="${escapeSvg(ariaLabel)}">
    <rect class="room-object-label-backing" x="${formatSvgNumber(x)}" y="${formatSvgNumber(y)}" width="${formatSvgNumber(width)}" height="${height}" rx="8.5" ry="8.5"></rect>
    <text class="room-object-label" x="${object.cx}" y="${formatSvgNumber(object.labelY)}">${escapeSvg(object.boardLabel)}</text>
  </g>`
}

function renderObject(object: ColonyBenchSvgObjectPrimitive) {
  return `${renderObjectShape(object)}${renderObjectLabelChip(object)}${renderObjectMeter(object)}`
}

function renderIntentLink(link: ColonyBenchSvgIntentLink) {
  return `<line class="room-intent-link" x1="${link.x1}" y1="${link.y1}" x2="${link.x2}" y2="${link.y2}" marker-end="url(#room-intent-arrow)"><title>${escapeSvg(link.label)}</title></line>`
}

export function renderColonyBenchSvgBoard({
  model,
  selectedCell = null,
}: {
  model: ColonyBenchGameModel
  selectedCell?: ColonyBenchPosition | null
}) {
  const board = buildColonyBenchSvgBoardModel({ model, selectedCell })
  return `<svg class="room-svg" role="grid" aria-label="ColonyBench room map" viewBox="${board.viewBox}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="room-intent-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path class="room-intent-arrow" d="M0 0 L10 5 L0 10 z"></path>
    </marker>
  </defs>
  <g class="room-grid">
    ${board.tiles.map(renderTile).join('\n    ')}
  </g>
  <g class="room-intent-links" aria-hidden="true">
    ${board.intentLinks.map(renderIntentLink).join('\n    ')}
  </g>
  <g class="room-objects" aria-hidden="true">
    ${board.objects.map(renderObject).join('\n    ')}
  </g>
</svg>`
}
