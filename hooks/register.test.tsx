import { expect, test } from 'claude-code/testing'

import type { Game } from '../types'
import { damageOf, findRuns, hasMove, plan, press, resolve } from './register'

const PANE = {
  plugin: 'stone-clash',
  component: 'Pane',
  requestId: 'stone-clash',
  props: {
    title: '돌 맞추기',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const W = 6
const at = (r: number, c: number) => r * W + c

// 맞춰진 줄이 하나도 없는 판(행마다 두 칸씩 민 무늬)
const quiet = () => {
  const b: number[] = []
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) b.push((c + 2 * r) % 5)

  return b
}

test('줄 길이·교차·약점 배수', async () => {
  const b = quiet()
  expect(findRuns(b).length).toBe(0)

  const run = (cells: number[], kind = 0) => ({ cells, kind })
  // 몬스터 속성 2(땅): 물(0)은 약점 아님
  expect(damageOf([run([0, 1, 2])], 2)).toBe(30)
  expect(damageOf([run([0, 1, 2, 3])], 2)).toBe(80)
  expect(damageOf([run([0, 1, 2, 3, 4])], 2)).toBe(150)
  // 교차: 두 줄(30 + 30)을 한 번 더 더함
  expect(damageOf([run([0, 1, 2]), run([1, 9, 17])], 2)).toBe(120)
  // 약점: 물(0)은 불(1)을 이김 → ×1.5
  expect(damageOf([run([0, 1, 2])], 1)).toBe(45)
})

test('대각선은 4칸부터 맞춰진 줄이다', async () => {
  const set = (cells: number[][], kind: number) => {
    const b = quiet()
    for (const [r, c] of cells) b[at(r as number, c as number)] = kind

    return b
  }
  // ↘ 3칸은 줄이 아니다
  expect(findRuns(set([[0, 0], [1, 1], [2, 2]], 3)).length).toBe(0)
  // ↘ 4칸
  const down = findRuns(set([[0, 0], [1, 1], [2, 2], [3, 3]], 3))
  expect(down.length).toBe(1)
  expect(down[0]?.cells.join()).toBe([at(0, 0), at(1, 1), at(2, 2), at(3, 3)].join())
  expect(damageOf(down, 0)).toBe(80)
  // ↙ 4칸
  const up = findRuns(set([[0, 5], [1, 4], [2, 3], [3, 2]], 3))
  expect(up.length).toBe(1)
  expect(up[0]?.cells.length).toBe(4)
  // 대각선 4칸(80)과 가로 3칸(30)이 한 칸에서 만나면 교차: 둘을 한 번 더 더한다
  const cross = set([[0, 0], [1, 1], [2, 2], [3, 3], [3, 1]], 3)
  const c = findRuns(cross)
  expect(c.length).toBe(2)
  expect(damageOf(c, 0)).toBe(220)
  // 사라지고 떨어진 뒤에는 맞춰진 줄이 남지 않는다
  expect(findRuns(resolve(cross, 0).board).length).toBe(0)
})

// (0,2)·(1,2) 를 바꾸면 윗줄이 4·4·4 가 되는 판
const ready = () => {
  const b = quiet()
  b[at(0, 0)] = 4
  b[at(0, 1)] = 4

  return b
}
const base: Game = {
  board: ready(), sel: null, stage: 1, hp: 100000, maxHp: 100000, monEl: 2,
  php: 100, pmaxHp: 100, atk: 18, atkEvery: 3, atkIn: 3,
  log: '', best: 0, over: false, flash: [], busy: false,
}
const hitOnce = (g: Game) => plan(press({ ...g, board: ready() }, at(0, 2)), at(1, 2))

test('돌을 맞추면 데미지가 들어가고 공격 턴이 가까워진다', async () => {
  expect(findRuns(base.board).length).toBe(0)
  expect(hasMove(base.board)).toBe(true)
  const p = hitOnce(base)
  expect(p.final.atkIn).toBe(2)
  expect(p.final.php).toBe(100)
  expect(p.final.hp < 100000).toBe(true)
  // 프레임: 교환 → 반짝임 → 사라짐(데미지) → 낙하, 프레임 데미지 합 = 총 데미지
  expect(p.frames[1]?.flash.length).toBe(3)
  expect(p.frames.reduce((a, f) => a + f.hit, 0)).toBe(100000 - p.final.hp)
  expect(p.frames.reduce((a, f) => a + f.hurt, 0)).toBe(0)
  // 재생 중에는 입력을 받지 않는다
  expect(plan({ ...base, busy: true }, 2).final.sel).toBe(null)
  // 맞지 않는 교환은 되돌아오는 프레임 하나, 턴은 그대로
  const back = plan(press({ ...base, board: quiet() }, 0), 1)
  expect(back.frames.length).toBe(1)
  expect(back.final.atkIn).toBe(3)
  expect(resolve(quiet(), 2).total).toBe(0)
})

test('3턴 몬스터는 세 번째 맞춤 뒤에 공격한다', async () => {
  const one = hitOnce(base).final
  const two = hitOnce(one).final
  expect(two.atkIn).toBe(1)
  expect(two.php).toBe(100)
  const three = hitOnce(two)
  expect(three.final.php).toBe(82)
  expect(three.final.atkIn).toBe(3)
  expect(three.frames[three.frames.length - 1]?.hurt).toBe(18)
  // 체력이 다 깎이면 사망, 더 누를 수 없다
  const dead = hitOnce({ ...base, php: 10, atkIn: 1 }).final
  expect(dead.php).toBe(0)
  expect(dead.over).toBe(true)
  expect(press(dead, 5).sel).toBe(null)
  // 공격 턴에 몬스터를 잡으면 맞지 않고 다음 스테이지, 체력 회복
  const win = hitOnce({ ...base, hp: 1, php: 50, atkIn: 1 }).final
  expect(win.stage).toBe(2)
  expect(win.php).toBe(70)
  expect(win.best).toBe(1)
})

test('패널이 36칸과 몬스터를 그린다', async ($, on) => {
  on('command.register', () => ({ value: { command: 'stone-clash' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: 3 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /스테이지 1/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /최고 스테이지 3/ })) !== undefined).toBe(true)
  await ui.press({ key: 'cell-0' })
  await ui.press({ key: 'cell-35' })
  await ui.unmount()
})
