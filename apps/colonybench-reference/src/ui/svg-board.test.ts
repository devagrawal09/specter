import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import type { ColonyBenchGameModel } from './model'
import {
  buildColonyBenchSvgBoardModel,
  renderColonyBenchSvgBoard,
} from './svg-board'

function gameModelFixture(): ColonyBenchGameModel {
  return {
    status: 'running',
    frameCount: 4,
    tick: 12,
    score: 99,
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 1 },
    cells: [
      {
        x: -1,
        y: -1,
        entities: [
          {
            kind: 'constructionSite',
            id: 'road-site-1',
            label: 'road site',
            detail: '0/10 built',
            meter: {
              kind: 'progress',
              label: 'road site progress 0/10',
              value: 0,
              max: 10,
            },
          },
        ],
      },
      {
        x: 0,
        y: 0,
        entities: [
          {
            kind: 'base',
            id: 'base-1',
            label: 'Base L2',
            detail: '18 energy',
            meter: {
              kind: 'progress',
              label: 'Base upgrade 5/10',
              value: 5,
              max: 10,
            },
          },
          {
            kind: 'worker',
            id: 'worker-1',
            label: 'worker-1',
            detail: 'harvester · 4/10',
            meter: {
              kind: 'energy',
              label: 'worker-1 energy 4/10',
              value: 4,
              max: 10,
            },
          },
        ],
      },
      {
        x: 2,
        y: 1,
        entities: [
          {
            kind: 'source',
            id: 'source-1',
            label: 'source-1',
            detail: '95 energy',
            meter: {
              kind: 'energy',
              label: 'source-1 energy 95/100',
              value: 95,
              max: 100,
            },
          },
          {
            kind: 'intent',
            id: 'move-target-worker-1',
            label: 'move target',
            detail: 'worker-1 is moving here',
            relatedEntityId: 'worker-1',
          },
        ],
      },
      {
        x: 1,
        y: -1,
        entities: [
          {
            kind: 'terrain',
            id: 'wall-1',
            label: 'wall',
            detail: 'impassable terrain',
          },
        ],
      },
    ],
    metrics: [],
    recentCommands: [],
    recentApiIntents: [],
    recentEvents: [],
    activityHistory: [],
    baseDetails: [],
    workerDetails: [],
    sourceDetails: [],
    constructionDetails: [],
    selectedCellDetails: null,
  }
}

describe('ColonyBench SVG board renderer', () => {
  test('maps game-model coordinates into continuous SVG tile and object primitives', () => {
    const board = buildColonyBenchSvgBoardModel({
      model: gameModelFixture(),
      selectedCell: { x: 0, y: 0 },
    })

    expect(board.viewBox).toBe('0 0 328 256')
    expect(board.columns).toBe(4)
    expect(board.rows).toBe(3)
    expect(board.tiles[0]).toMatchObject({
      key: '-1,-1',
      x: 24,
      y: 24,
      width: 64,
      height: 64,
      coordLabel: '-1,-1',
      selected: false,
    })
    expect(board.tiles.find((tile) => tile.key === '-1,-1')?.tooltip).toBe(
      'Cell -1,-1 · road site: 0/10 built',
    )
    expect(board.tiles.find((tile) => tile.key === '0,0')).toMatchObject({
      x: 96,
      y: 96,
      selected: true,
      ariaLabel: 'inspect cell 0,0 containing Base L2, worker-1',
      tooltip: 'Cell 0,0 · Base L2: 18 energy; worker-1: harvester · 4/10',
    })
    expect(board.objects.map((object) => object.id)).toEqual([
      'wall-1',
      'road-site-1',
      'source-1',
      'base-1',
      'worker-1',
      'move-target-worker-1',
    ])
    expect(
      board.objects.find((object) => object.id === 'road-site-1'),
    ).toMatchObject({
      kind: 'constructionSite',
      label: 'road site',
      detail: '0/10 built',
      labelVisible: false,
      meterVisible: false,
    })
    expect(
      board.objects.find((object) => object.id === 'base-1'),
    ).toMatchObject({
      labelY: 144,
      labelVisible: false,
      meterVisible: false,
    })
    expect(
      board.objects.find((object) => object.id === 'worker-1'),
    ).toMatchObject({
      kind: 'worker',
      cx: 128,
      cy: 128,
      labelY: 152,
      label: 'worker-1',
      boardLabel: 'W1',
      detail: 'harvester · 4/10',
      labelVisible: true,
      meterVisible: true,
    })
    expect(
      board.objects.find((object) => object.id === 'source-1'),
    ).toMatchObject({
      cx: 272,
      cy: 200,
      label: 'source-1',
      boardLabel: 'S1',
      detail: '95 energy',
      labelVisible: true,
      meterVisible: true,
    })
    expect(board.intentLinks).toEqual([
      {
        key: 'worker-1->move-target-worker-1',
        sourceObjectId: 'worker-1',
        targetObjectId: 'move-target-worker-1',
        x1: 128,
        y1: 128,
        x2: 272,
        y2: 200,
        label: 'worker-1 → move target',
      },
    ])
  })

  test('renders a readable SVG room map with compact board labels and inspector-owned details', () => {
    const svg = renderColonyBenchSvgBoard({
      model: gameModelFixture(),
      selectedCell: { x: 0, y: 0 },
    })

    expect(svg).toContain(
      '<svg class="room-svg" role="grid" aria-label="ColonyBench room map" viewBox="0 0 328 256"',
    )
    expect(svg).toContain(
      '<g class="room-tile room-tile--selected" data-cell-position="0,0" role="gridcell" aria-label="inspect cell 0,0 containing Base L2, worker-1" tabindex="0">',
    )
    expect(svg).toContain(
      '<title>Cell 0,0 · Base L2: 18 energy; worker-1: harvester · 4/10</title>',
    )
    expect(svg).toContain(
      '<circle class="room-object room-object--base" cx="128" cy="128" r="14">',
    )
    expect(svg).toContain('<title>Base L2: 18 energy</title>')
    expect(svg).toContain('<title>road site: 0/10 built</title>')
    expect(svg.match(/<g class="room-object-label-chip/g)?.length ?? 0).toBe(2)
    expect(svg).not.toContain('room-object-label-chip--constructionSite')
    expect(svg).not.toContain(
      '<g class="room-object-label-chip room-object-label-chip--base" aria-label="Base L2 details: 18 energy">',
    )
    expect(svg).toContain(
      '<g class="room-object-label-chip room-object-label-chip--worker" aria-label="worker-1 details: harvester · 4/10">',
    )
    expect(svg).toContain('<rect class="room-object-label-backing"')
    expect(svg).toContain(
      '<text class="room-object-label" x="128" y="152">W1</text>',
    )
    expect(svg).toContain(
      '<text class="room-object-label" x="272" y="224">S1</text>',
    )
    expect(svg).not.toContain(
      '<text class="room-object-label" x="128" y="152">worker-1</text>',
    )
    expect(svg).not.toContain('room-object-detail-label')
    expect(svg).not.toContain('harvester · 4/10</text>')
    expect(svg).not.toContain('95 energy</text>')
    expect(svg.match(/<g class="room-object-meter/g)?.length ?? 0).toBe(2)
    expect(svg).not.toContain('aria-label="road site progress 0/10"')
    expect(svg).not.toContain('aria-label="Base upgrade 5/10"')
    expect(svg).toContain(
      '<g class="room-object-meter room-object-meter--energy" aria-label="worker-1 energy 4/10">',
    )
    expect(svg).toContain(
      '<rect class="room-object-meter-fill" x="107" y="158" width="16.8" height="5" rx="2.5" ry="2.5"></rect>',
    )
    expect(svg).toContain(
      '<rect class="room-object-meter-fill" x="251" y="230" width="39.9" height="5" rx="2.5" ry="2.5"></rect>',
    )
    expect(svg).toContain(
      '<line class="room-intent-link" x1="128" y1="128" x2="272" y2="200" marker-end="url(#room-intent-arrow)">',
    )
    expect(svg).toContain('<title>worker-1 → move target</title>')
    expect(svg).toContain(
      '<path class="room-object room-object--intent" d="M272 190 l10 10 l-10 10 l-10 -10 Z">',
    )
  })

  test('styles board text with subtle coordinates and readable label chips', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

    expect(css).toContain('.room-object-label-chip')
    expect(css).toContain('.room-object-label-backing')
    expect(css).toMatch(
      /\.room-coordinate\s*{[^}]*fill:\s*rgba\(238, 248, 236, 0\.22\)/s,
    )
    expect(css).toMatch(/\.room-object-label\s*{[^}]*font-size:\s*0\.92rem/s)
    expect(css).toMatch(
      /\.room-object-label-chip--worker \.room-object-label-backing\s*{[^}]*stroke:\s*rgba\(143, 213, 255, 0\.72\)/s,
    )
    expect(css).not.toMatch(
      /\.room-object-detail-label\s*{[^}]*font-size:\s*0\.55rem/s,
    )
  })
})
