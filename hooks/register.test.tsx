import { expect, test } from 'claude-code/testing'

import type { Game } from '../types'
import {
  damageOf, findRuns, fresh, gacha, GRADE_RATE, hasMove, ITEM_COUNT, itemOf, loaded, plan, press, PULL_COST,
  resolve, rewardOf, startBattle, statsOf, toggleEquip,
} from './register'

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
  ...fresh(), screen: 'battle', theme: 3, stage: 2,
  board: ready(), hp: 100000, maxHp: 100000, monEl: 2,
  php: 100, pmaxHp: 100, atk: 18, atkEvery: 3, atkIn: 3,
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
  // 맞지 않는 교환도 바꾼 자리에 남고 턴을 쓴다
  const q = quiet()
  const kept = plan(press({ ...base, board: q }, 0), 1)
  expect(kept.final.board[0]).toBe(q[1])
  expect(kept.final.board[1]).toBe(q[0])
  expect(kept.final.hp).toBe(100000)
  expect(kept.final.atkIn).toBe(2)
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
  // 공격 턴에 몬스터를 잡으면 맞지 않고 클리어. 첫 클리어는 보상 2배, 다시 깨면 1배
  const win = hitOnce({ ...base, hp: 1, php: 50, atkIn: 1, cleared: [0, 0, 0, 1, 0] }).final
  expect(win.won).toBe(true)
  expect(win.php).toBe(50)
  expect(win.cleared.join()).toBe('0,0,0,2,0')
  expect(win.coins).toBe(base.coins + rewardOf(3, 2) * 2)
  expect(press(win, 5).sel).toBe(null)
  const again = hitOnce({ ...base, hp: 1, cleared: [0, 0, 0, 7, 0] }).final
  expect(again.coins).toBe(base.coins + rewardOf(3, 2))
})

test('아이템 200종·뽑기·장착·저장', async () => {
  expect(ITEM_COUNT).toBe(200)
  const grades = [0, 0, 0, 0]
  const names = new Set<string>()
  for (let id = 0; id < ITEM_COUNT; id++) {
    const it = itemOf(id)
    grades[it.grade] = (grades[it.grade] as number) + 1
    names.add(it.name)
    expect(it.atk + it.def + it.hp > 0).toBe(true)
  }
  expect(grades.join()).toBe('80,60,40,20')
  expect(names.size).toBe(200)
  expect(GRADE_RATE[3]).toBe(10)
  // 등급이 높을수록 좋다
  expect(itemOf(199 - 4).atk > itemOf(175).atk).toBe(true)
  expect(itemOf(175).atk > itemOf(135).atk).toBe(true)
  expect(itemOf(135).atk > itemOf(75).atk).toBe(true)

  // 굴림 0.95 → 전설, 0.1 → 일반. 코인이 모자라면 그대로
  const rolls = (list: number[]) => () => list.shift() ?? 0
  const rich = { ...fresh(), coins: 1000 }
  const one = gacha(rich, 1, rolls([0.95, 0]))
  expect(one.coins).toBe(1000 - PULL_COST)
  expect(itemOf(one.pulled[0] as number).grade).toBe(3)
  expect(one.owned.length).toBe(1)
  expect(itemOf(gacha(rich, 1, rolls([0.1, 0])).pulled[0] as number).grade).toBe(0)
  // 같은 아이템이 또 나오면 코인으로 돌려받는다
  const dup = gacha(one, 1, rolls([0.95, 0]))
  expect(dup.owned.length).toBe(1)
  expect(dup.coins).toBe(1000 - PULL_COST * 2 + 100)
  expect(gacha({ ...fresh(), coins: 10 }, 1).owned.length).toBe(0)
  expect(gacha(rich, 10).pulled.length).toBe(10)

  // 장착은 5개까지, 다시 누르면 해제
  let g = { ...fresh(), owned: [180, 181, 182, 183, 184, 185] }
  for (const id of g.owned) g = toggleEquip(g, id)
  expect(g.equip.length).toBe(5)
  expect(toggleEquip(g, 180).equip.length).toBe(4)
  const gear = statsOf(g.equip)
  expect(gear.atk > 0 && gear.def > 0 && gear.hp > 0).toBe(true)
  // 장착 효과: 체력이 늘고, 데미지가 늘고, 받는 피해가 준다
  const fight = startBattle(g, 0, 1)
  expect(fight.pmaxHp).toBe(100 + gear.hp)
  expect(fight.monEl).toBe(0)
  const plain = hitOnce(base)
  const strong = hitOnce({ ...base, equip: g.equip })
  expect(100000 - strong.final.hp > 100000 - plain.final.hp).toBe(true)
  const hurt = hitOnce({ ...base, equip: g.equip, atkIn: 1 }).final
  expect(100 - hurt.php).toBe(Math.max(1, 18 - gear.def))
  // 1스테이지는 쉽고, 뒤로 갈수록 세다
  expect(startBattle(fresh(), 0, 1).maxHp).toBe(110)
  expect(startBattle(fresh(), 4, 7).maxHp > 2000).toBe(true)

  // 저장한 값을 다시 읽는다. 이상한 값은 버린다
  const back = loaded(fresh(), { coins: 77, cleared: [7, 3, 0, 0, 0], owned: [1, 999, 5], equip: [5, 9] })
  expect(back.coins).toBe(77)
  expect(back.cleared.join()).toBe('7,3,0,0,0')
  expect(back.owned.join()).toBe('1,5')
  expect(back.equip.join()).toBe('5')
  expect(loaded(fresh(), 3).coins).toBe(fresh().coins)
})

test('메뉴에서 테마·스테이지를 골라 36칸 판에 들어간다', async ($, on) => {
  on('command.register', () => ({ value: { command: 'stone-clash' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: { coins: 500, cleared: [2, 0, 0, 0, 0], owned: [3], equip: [3] } }))
  on('store.set', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /🪙 500 · 클리어 2 \/ 35/ })) !== undefined).toBe(true)
  await ui.press({ key: 'gacha' })
  await ui.press({ key: 'pull-1' })
  expect((await ui.find({ type: 'Text', text: /🪙 440/ })) !== undefined).toBe(true)
  await ui.press({ key: 'back' })
  await ui.press({ key: 'bag' })
  await ui.press({ key: 'item-3' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'play' })
  await ui.press({ key: 'theme-0' })
  await ui.press({ key: 'stage-3' })
  expect((await ui.find({ type: 'Text', text: /물안개 해파리/ })) !== undefined).toBe(true)
  // 물 몬스터의 약점은 전기
  expect((await ui.find({ type: 'Text', text: /약점 🟡 전기/ })) !== undefined).toBe(true)
  await ui.press({ key: 'cell-0' })
  await ui.press({ key: 'cell-35' })
  await ui.unmount()
})
