import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Game } from '../types'

const PANE = 'stone-clash'
const N = 6
// 대각선은 4칸부터 줄로 친다(가로·세로는 3칸)
const DIAGONAL_MIN = 4
const KINDS = 5
// 0 물 · 1 불 · 2 땅 · 3 나무 · 4 전기
const STONE = ['🔵', '🔴', '🟤', '🟢', '🟡']
const NAME = ['물', '불', '땅', '나무', '전기']
// 속성별 몬스터 7마리. 마지막이 보스
const MONSTER = [
  ['물방울 새우', '이슬 달팽이', '물안개 해파리', '여울 수달', '소용돌이 가오리', '심해 아귀', '해일 고래'],
  ['불씨 나방', '숯 도마뱀', '화산 도롱뇽', '화염 여우', '용암 멧돼지', '잿불 독수리', '홍염 사자'],
  ['조약돌 쥐', '진흙 두더지', '바위 거북', '모래 전갈', '암석 코뿔소', '협곡 곰', '대지 거인'],
  ['새싹 다람쥐', '이끼 두꺼비', '넝쿨 사마귀', '가시 고슴도치', '고목 사슴', '덩굴 구렁이', '천년 수호목'],
  ['정전기 참새', '스파크 생쥐', '번개 족제비', '뇌운 매', '전류 뱀장어', '천둥 늑대', '뇌신 호랑이'],
]
// BEATS[a] = a 가 이기는 속성: 물>불>나무>땅>전기>물
const BEATS = [1, 3, 4, 2, 0]

const rnd = (n: number) => Math.floor(Math.random() * n)

type Run = { cells: number[]; kind: number }

export function findRuns(board: number[]): Run[] {
  const runs: Run[] = []
  const scan = (at: (a: number, b: number) => number) => {
    for (let a = 0; a < N; a++) {
      let start = 0
      for (let b = 1; b <= N; b++) {
        if (b < N && board[at(a, b)] === board[at(a, start)]) continue
        if (b - start >= 3) {
          const cells: number[] = []
          for (let k = start; k < b; k++) cells.push(at(a, k))
          runs.push({ cells, kind: board[at(a, start)] as number })
        }
        start = b
      }
    }
  }
  scan((r, c) => r * N + c)
  scan((c, r) => r * N + c)

  // 대각선 두 방향(↘ ↙): 시작 칸에서 한 칸씩 가며 같은 돌이 DIAGONAL_MIN 칸 이상 이어진 구간
  for (const dc of [1, -1]) {
    for (let r0 = 0; r0 < N; r0++) {
      for (let c0 = 0; c0 < N; c0++) {
        // 대각선의 첫 칸에서만 시작(윗줄이거나 진행 반대쪽 끝 열)
        if (r0 !== 0 && c0 !== (dc === 1 ? 0 : N - 1)) continue
        const line: number[] = []
        for (let r = r0, c = c0; r < N && c >= 0 && c < N; r++, c += dc) line.push(r * N + c)
        let start = 0
        for (let b = 1; b <= line.length; b++) {
          if (b < line.length && board[line[b] as number] === board[line[start] as number]) continue
          if (b - start >= DIAGONAL_MIN) {
            runs.push({ cells: line.slice(start, b), kind: board[line[start] as number] as number })
          }
          start = b
        }
      }
    }
  }

  return runs
}

// 가로·세로·대각선 모두 같은 계산. 3칸 = 칸당 10. 4칸 ×2, 5칸 이상 ×3. 두 줄이 교차하면 그 두 줄을 한 번 더 더함(×2). 약점 속성 ×1.5.
export function damageOf(runs: Run[], monEl: number): number {
  const base = runs.map(run => {
    const len = run.cells.length
    const mult = len >= 5 ? 3 : len === 4 ? 2 : 1
    const weak = BEATS[run.kind] === monEl ? 1.5 : 1

    return len * 10 * mult * weak
  })
  let total = base.reduce((a, b) => a + b, 0)
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i] as Run
      const b = runs[j] as Run
      if (a.cells.some(cell => b.cells.includes(cell))) {
        total += (base[i] as number) + (base[j] as number)
      }
    }
  }

  return Math.round(total)
}

const EMPTY = -1

// 빈칸 위의 돌을 한 칸 내리고, 맨 윗줄 빈칸에는 새 돌을 넣는다. 움직인 게 없으면 null
function fallStep(board: number[]): number[] | null {
  const out = board.slice()
  let moved = false
  for (let c = 0; c < N; c++) {
    for (let r = N - 1; r >= 0; r--) {
      const i = r * N + c
      if (out[i] !== EMPTY) continue
      moved = true
      if (r === 0) {
        out[i] = rnd(KINDS)
      } else {
        out[i] = out[i - N] as number
        out[i - N] = EMPTY
      }
    }
  }

  return moved ? out : null
}

// hit = 몬스터가 받는 데미지, hurt = 내가 받는 데미지(몬스터 공격 프레임)
export type Frame = { board: number[]; flash: number[]; hit: number; hurt: number; chain: number; ms: number }

// power = 장착 아이템의 공격 배수. 연쇄: n 번째 연쇄는 ×(1 + 0.5 × (n − 1)). frames = 반짝임 → 사라짐 → 한 칸씩 낙하 를 연쇄마다
export function resolve(start: number[], monEl: number, power = 1) {
  let board = start
  let total = 0
  let chain = 0
  let hadCross = false
  let longest = 0
  const frames: Frame[] = []
  for (;;) {
    const runs = findRuns(board)
    if (runs.length === 0) break
    chain += 1
    const hit = Math.round(damageOf(runs, monEl) * (1 + 0.5 * (chain - 1)) * power)
    total += hit
    const gone = new Set<number>()
    for (const run of runs) {
      longest = Math.max(longest, run.cells.length)
      for (const cell of run.cells) {
        if (gone.has(cell)) hadCross = true
        gone.add(cell)
      }
    }
    frames.push({ board, flash: [...gone], hit: 0, hurt: 0, chain, ms: 260 })
    board = board.map((kind, i) => (gone.has(i) ? EMPTY : kind))
    frames.push({ board, flash: [], hit, hurt: 0, chain, ms: 140 })
    for (let next = fallStep(board); next; next = fallStep(board)) {
      board = next
      frames.push({ board, flash: [], hit: 0, hurt: 0, chain, ms: 70 })
    }
  }

  return { board, total, chain, hadCross, longest, frames }
}

function swapped(board: number[], a: number, b: number): number[] {
  const out = board.slice()
  out[a] = board[b] as number
  out[b] = board[a] as number

  return out
}

export function hasMove(board: number[]): boolean {
  for (let i = 0; i < N * N; i++) {
    if (i % N < N - 1 && findRuns(swapped(board, i, i + 1)).length > 0) return true
    if (i + N < N * N && findRuns(swapped(board, i, i + N)).length > 0) return true
  }

  return false
}

function newBoard(): number[] {
  for (;;) {
    const board: number[] = []
    for (let i = 0; i < N * N; i++) {
      let kind = rnd(KINDS)
      // 처음부터 맞춰진 줄이 없게
      const col = i % N
      const made = (k: number) =>
        (col >= 2 && board[i - 1] === k && board[i - 2] === k) ||
        (i >= 2 * N && board[i - N] === k && board[i - 2 * N] === k) ||
        (i >= 2 * N && col >= 2 && board[i - N - 1] === k && board[i - 2 * N - 2] === k) ||
        (i >= 2 * N && col <= N - 3 && board[i - N + 1] === k && board[i - 2 * N + 2] === k)
      // 막는 조건이 넷이고 돌 종류가 다섯이라 하나는 반드시 남는다
      while (made(kind)) {
        kind = (kind + 1) % KINDS
      }
      board.push(kind)
    }
    if (findRuns(board).length === 0 && hasMove(board)) return board
  }
}

// ── 테마·스테이지 ─────────────────────────────────────────────
// 난이도 순서: 물 → 불 → 나무 → 땅 → 전기. 값은 속성 번호
export const THEMES = [0, 1, 3, 2, 4]
// 앞 5개는 기본(몬스터 1마리), 뒤 5개는 심화(몬스터 2~3마리, 속성이 서로 다름)
export const THEME_COUNT = THEMES.length * 2
export const STAGES = 7
const BASE_HP = 100
const BASIC_LEVELS = THEMES.length * STAGES

export const isDeep = (theme: number) => theme >= THEMES.length
export const themeEl = (theme: number) => THEMES[theme % THEMES.length] as number
const themeName = (theme: number) => `${isDeep(theme) ? '심연의 ' : ''}${NAME[themeEl(theme)]}의 땅`

// 1(물 1) ~ 35(전기 7) ~ 70(심연 전기 7)
const levelOf = (theme: number, stage: number) => theme * STAGES + stage

export const rewardOf = (theme: number, stage: number) => 10 + 3 * levelOf(theme, stage)

// 맞은 데미지를 고른 몬스터부터 깎고, 쓰러뜨리고 남은 데미지는 다음 살아 있는 몬스터로 넘긴다
export function applyHit(hps: number[], target: number, damage: number): number[] {
  const out = hps.slice()
  const order = [target, ...out.map((_, k) => k).filter(k => k !== target)]
  let left = damage
  for (const k of order) {
    const take = Math.min(out[k] as number, left)
    out[k] = (out[k] as number) - take
    left -= take
  }

  return out
}

// 방어는 받는 피해를 깎되, 공격력의 40% 아래로는 못 내린다
export const hurtOf = (atk: number, def: number) => Math.max(Math.ceil(atk * 0.4), atk - def)

// ── 아이템 200종 = 수식어 40 × 종류 5 ─────────────────────────
export const GRADE = ['일반', '고급', '희귀', '전설']
// 뽑기 확률(%). 전설 10%
export const GRADE_RATE = [50, 28, 12, 10]
// 등급별 수식어 구간: 일반 16 · 고급 12 · 희귀 8 · 전설 4
const GRADE_FROM = [0, 16, 28, 36, 40]
const GRADE_POWER = [1, 2, 4, 8]
// 이미 가진 아이템이 나오면 돌려받는 코인
const REFUND = [10, 20, 40, 100]
const PREFIX = [
  '낡은', '무딘', '녹슨', '거친', '평범한', '가벼운', '단단한', '묵직한',
  '손때 묻은', '수수한', '닳은', '투박한', '작은', '마른', '흔한', '오래된',
  '잘 벼린', '윤나는', '튼튼한', '날렵한', '은빛', '푸른', '붉은', '정교한', '숙련자의', '맑은', '굳센', '빛나는',
  '폭풍의', '서리의', '불꽃의', '대지의', '숲의', '번개의', '달빛의', '새벽의',
  '용의', '별의', '태초의', '왕의',
]
// 검 = 공격, 방패 = 방어, 갑옷 = 체력, 반지 = 공격+체력, 부적 = 방어+체력
const BASE = ['검', '방패', '갑옷', '반지', '부적']
export const ITEM_COUNT = PREFIX.length * BASE.length
export const SLOTS = 5
export const PULL_COST = 60
const PAGE = 6

export type Item = { id: number; name: string; grade: number; atk: number; def: number; hp: number }

export function itemOf(id: number): Item {
  const p = Math.floor(id / BASE.length)
  const kind = id % BASE.length
  const grade = p < 16 ? 0 : p < 28 ? 1 : p < 36 ? 2 : 3
  // 같은 등급 안에서도 뒤쪽 수식어가 조금 더 좋다
  const m = (GRADE_POWER[grade] as number) * (1 + (p - (GRADE_FROM[grade] as number)) * 0.04)
  const a = Math.round(6 * m)
  const d = Math.max(1, Math.round(1.2 * m))
  const h = Math.round(20 * m)
  const part = (n: number) => Math.max(1, Math.round(n * 0.6))
  const stat = [
    { atk: a, def: 0, hp: 0 },
    { atk: 0, def: d, hp: 0 },
    { atk: 0, def: 0, hp: h },
    { atk: part(a), def: 0, hp: part(h) },
    { atk: 0, def: part(d), hp: part(h) },
  ][kind] as { atk: number; def: number; hp: number }

  return { id, name: `${PREFIX[p]} ${BASE[kind]}`, grade, ...stat }
}

// atk = 데미지 +%, def = 받는 피해 −, hp = 최대 체력 +
export function statsOf(equip: number[]) {
  const sum = { atk: 0, def: 0, hp: 0 }
  for (const id of equip) {
    const it = itemOf(id)
    sum.atk += it.atk
    sum.def += it.def
    sum.hp += it.hp
  }

  return sum
}

const effect = (it: { atk: number; def: number; hp: number }) =>
  [it.atk ? `공격 +${it.atk}%` : '', it.def ? `방어 +${it.def}` : '', it.hp ? `체력 +${it.hp}` : '']
    .filter(Boolean)
    .join(' · ')

// n 번 뽑는다. 코인이 모자라면 아무 일도 없다. 이미 가진 아이템은 코인으로 돌려받는다
export function gacha(game: Game, n: number, rand: () => number = Math.random): Game {
  if (game.coins < PULL_COST * n) return { ...game, pulled: [], note: '코인이 부족합니다.' }
  let coins = game.coins - PULL_COST * n
  const owned = game.owned.slice()
  const pulled: number[] = []
  let back = 0
  for (let k = 0; k < n; k++) {
    let roll = rand() * 100
    let grade = 0
    while (grade < 3 && roll >= (GRADE_RATE[grade] as number)) {
      roll -= GRADE_RATE[grade] as number
      grade += 1
    }
    const from = (GRADE_FROM[grade] as number) * BASE.length
    const count = ((GRADE_FROM[grade + 1] as number) - (GRADE_FROM[grade] as number)) * BASE.length
    const id = from + Math.min(count - 1, Math.floor(rand() * count))
    pulled.push(id)
    if (owned.includes(id)) {
      back += REFUND[grade] as number
    } else {
      owned.push(id)
    }
  }
  coins += back

  return { ...game, coins, owned, pulled, note: back ? `이미 가진 아이템은 코인 ${back} 으로 돌려받았습니다.` : '' }
}

export function toggleEquip(game: Game, id: number): Game {
  if (game.equip.includes(id)) return { ...game, equip: game.equip.filter(e => e !== id), note: '' }
  if (game.equip.length >= SLOTS) return { ...game, note: `장착은 ${SLOTS}개까지입니다. 먼저 하나를 빼세요.` }

  return { ...game, equip: [...game.equip, id], note: '' }
}

// 가진 아이템: 등급 높은 순, 같은 등급은 번호 순
const sortedOwned = (owned: number[]) =>
  owned.slice().sort((a, b) => itemOf(b).grade - itemOf(a).grade || a - b)

export function fresh(): Game {
  return {
    screen: 'menu', theme: 0, stage: 1,
    board: [], sel: null, target: 0,
    mHp: [0], mMax: [1], mEl: [0], mAtk: [0], mEvery: [3], mIn: [3],
    php: BASE_HP, pmaxHp: BASE_HP,
    log: '', over: false, won: false, flash: [], busy: false,
    coins: 120, cleared: Array.from({ length: THEME_COUNT }, () => 0), owned: [], equip: [], page: 0, pulled: [], note: '',
  }
}

// 전투 시작. 체력은 매 스테이지 가득 찬 채로 시작한다. 7번째는 보스
export function startBattle(game: Game, theme: number, stage: number): Game {
  const level = levelOf(theme, stage)
  const boss = stage === STAGES ? 1.5 : 1
  const pmaxHp = BASE_HP + statsOf(game.equip).hp
  const main = themeEl(theme)
  // 심화: 1~2 스테이지는 2마리, 그 뒤는 3마리. 속성은 서로 다르게
  const count = !isDeep(theme) ? 1 : stage <= 2 ? 2 : 3
  const step = 1 + (stage % 2)
  const mEl: number[] = []
  for (let k = 0; k < count; k++) mEl.push(THEMES[(THEMES.indexOf(main) + k * step) % THEMES.length] as number)
  // 기본은 레벨마다 8.5% 씩, 심화는 기본 끝에서 3% 씩 오른다. 여러 마리면 나눠 갖는다
  const deep = Math.max(0, level - BASIC_LEVELS)
  const pool = 110 * Math.pow(1.085, Math.min(level, BASIC_LEVELS) - 1) * Math.pow(1.03, deep) * boss
  const perTurn = 1.5 + 0.45 * Math.min(level, BASIC_LEVELS) + 0.5 * deep
  const each = Math.round(pool / count)
  // 느리게 때리는 몬스터일수록 한 방이 세다(턴당 피해는 비슷)
  const mEvery = mEl.map(() => 3 + rnd(3))

  return {
    ...game,
    screen: 'battle', theme, stage,
    board: newBoard(), sel: null, target: 0,
    mHp: mEl.map(() => each), mMax: mEl.map(() => each), mEl,
    mAtk: mEvery.map(every => Math.round((perTurn / count) * every)), mEvery, mIn: mEvery.slice(),
    php: pmaxHp, pmaxHp,
    log: count > 1
      ? '먼저 때릴 몬스터를 눌러 고르세요. 약점은 몬스터마다 다릅니다.'
      : '돌을 누르고, 바로 옆 돌을 눌러 자리를 바꾸세요. 안 맞아도 그대로 남습니다.',
    over: false, won: false, flash: [], busy: false, note: '',
  }
}

// 때릴 몬스터 고르기. 턴을 쓰지 않는다
export function aim(game: Game, k: number): Game {
  if (game.over || game.won || game.busy || (game.mHp[k] ?? 0) <= 0) return game

  return { ...game, target: k }
}

const isNext = (a: number, b: number) =>
  (Math.abs(a - b) === 1 && Math.floor(a / N) === Math.floor(b / N)) || Math.abs(a - b) === N

export type Plan = { frames: Frame[]; final: Game }

// 한 번 누른 결과: 재생할 프레임들과 최종 상태. 고르기만 한 경우 frames 는 비어 있다
export function plan(game: Game, i: number): Plan {
  const still = (final: Game): Plan => ({ frames: [], final })
  if (game.screen !== 'battle' || game.over || game.won || game.busy) return still(game)
  if (game.sel === null) return still({ ...game, sel: i })
  if (game.sel === i) return still({ ...game, sel: null })
  if (!isNext(game.sel, i)) return still({ ...game, sel: i })

  const gear = statsOf(game.equip)
  const t = game.target
  // 줄이 안 맞아도 바꾼 자리는 그대로 둔다. 다음 수를 위한 준비도 한 턴이다
  const tried = swapped(game.board, game.sel, i)
  const done = resolve(tried, game.mEl[t] as number, 1 + gear.atk / 100)
  const frames: Frame[] = [{ board: tried, flash: [], hit: 0, hurt: 0, chain: 0, ms: 160 }, ...done.frames]
  const mHp = applyHit(game.mHp, t, done.total)
  const notes = [
    done.longest >= 4 ? `${done.longest}칸` : '',
    done.hadCross ? '교차' : '',
    done.chain > 1 ? `${done.chain}연쇄` : '',
  ].filter(Boolean)
  const hit =
    done.total === 0
      ? '자리만 바꿨어요'
      : `${done.total} 데미지${notes.length ? ` (${notes.join(' · ')})` : ''}`
  // 고른 몬스터가 쓰러지면 살아 있는 다음 몬스터로 넘어간다
  const target = (mHp[t] as number) > 0 ? t : Math.max(0, mHp.findIndex(h => h > 0))
  const rest = { ...game, board: done.board, sel: null, mHp, target, flash: [], busy: false }

  // 모두 잡으면 공격받지 않는다. 처음 깬 스테이지는 보상 2배
  if (mHp.every(h => h === 0)) {
    const isFirst = (game.cleared[game.theme] ?? 0) < game.stage
    const coins = rewardOf(game.theme, game.stage) * (isFirst ? 2 : 1)
    const cleared = game.cleared.map((n, th) => (th === game.theme ? Math.max(n, game.stage) : n))

    return {
      frames,
      final: {
        ...rest, won: true, cleared, coins: game.coins + coins,
        log: `${hit} — 클리어! 코인 +${coins}${isFirst ? ' (첫 클리어 2배)' : ''}`,
      },
    }
  }

  // 돌을 한 번 옮길 때마다 살아 있는 몬스터 모두의 공격이 한 턴 가까워진다
  const due = mHp.map((h, k) => h > 0 && (game.mIn[k] as number) <= 1)
  const mIn = game.mIn.map((n, k) =>
    (mHp[k] as number) <= 0 ? n : due[k] ? (game.mEvery[k] as number) : n - 1,
  )
  if (!due.includes(true)) {
    return { frames, final: { ...rest, mIn, log: hit } }
  }

  const blow = due.reduce((sum, d, k) => sum + (d ? hurtOf(game.mAtk[k] as number, gear.def) : 0), 0)
  const hurt = Math.min(game.php, blow)
  const php = game.php - hurt
  frames.push({ board: done.board, flash: [], hit: 0, hurt, chain: -1, ms: 520 })
  const who = due.map((d, k) => (d ? monsterOf(game, k) : '')).filter(Boolean).join(' · ')
  const struck = `${hit} → ${who}의 공격! −${hurt}`
  if (php === 0) {
    return { frames, final: { ...rest, mIn, php, over: true, log: `${struck} — 쓰러졌습니다.` } }
  }

  return { frames, final: { ...rest, mIn, php, log: struck } }
}

export const press = (game: Game, i: number): Game => plan(game, i).final

const monsterOf = (g: Game, k: number) =>
  `${isDeep(g.theme) ? '심연 ' : ''}${(MONSTER[g.mEl[k] as number] as string[])[g.stage - 1]}`

const game = atom({ plugin: 'stone-clash', key: 'game' } as const, fresh(), {
  shape: 'game-7',
})

// 세션이 바뀌어도 남는 것: 코인·진행도·아이템·장착
type Save = { coins: number; cleared: number[]; owned: number[]; equip: number[] }

export function loaded(game: Game, raw: unknown): Game {
  const s = raw as Partial<Save> | null | undefined
  if (!s || typeof s.coins !== 'number' || !Array.isArray(s.cleared) || !Array.isArray(s.owned)) return game
  const ids = (list: unknown) =>
    (Array.isArray(list) ? list : []).filter(
      (id): id is number => Number.isInteger(id) && id >= 0 && id < ITEM_COUNT,
    )
  const owned = ids(s.owned)

  return {
    ...game,
    coins: Math.max(0, Math.floor(s.coins)),
    cleared: game.cleared.map((_, t) => Math.min(STAGES, Math.max(0, Number(s.cleared?.[t]) || 0))),
    owned,
    equip: ids(s.equip).filter(id => owned.includes(id)).slice(0, SLOTS),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'stone-clash',
      description: '돌 맞추기 퍼즐 패널 열기',
    })
    const saved = await $.store.get('save')
    // 재생 도중 다시 로드되면 타이머가 사라지므로 잠금을 푼다
    await update($, game, g => ({ ...loaded(g, saved), busy: false, flash: [] }))
    void $.ui.open({ id: PANE, title: '돌 맞추기' })

    return next(e)
  })

  on('command.run', { command: 'stone-clash' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: '돌 맞추기' })

    return {
      text: opened.isPlaced
        ? '돌 맞추기 패널을 열었습니다.'
        : `패널을 그릴 화면이 없습니다 (${opened.reason}).`,
    }
  })

  on('turn.complete', ($, e, next) => {
    $.ui.toast('Claude 작업이 끝났어요')

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const g = await read($, game)

    // 상태를 바꾸고, 남겨야 하는 값은 저장소에도 쓴다
    const act = async (fn: (cur: Game) => Game) => {
      await update($, game, fn)
      const now = await read($, game)
      await $.store.set('save', { coins: now.coins, cleared: now.cleared, owned: now.owned, equip: now.equip })
    }
    const go = (screen: Game['screen']) => act(cur => ({ ...cur, screen, note: '', pulled: [], page: 0 }))
    const gear = statsOf(g.equip)
    const gearLine = `공격 +${gear.atk}% · 방어 +${gear.def} · 체력 ${BASE_HP + gear.hp}`
    const back = (screen: Game['screen'], label = '← 뒤로') => (
      <Button key="back" label={label} onPress={() => go(screen)} />
    )

    if (g.screen === 'menu') {
      const done = g.cleared.reduce((a, b) => a + b, 0)

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>돌 맞추기</Text>
            <Text>
              🪙 {g.coins} · 클리어 {done} / {THEME_COUNT * STAGES}
            </Text>
            <Text dimColor>{gearLine}</Text>
          </Box>
          <Box flexDirection="column">
            <Button key="play" variant="primary" label="모험 (테마 선택)" onPress={() => go('themes')} />
            <Button key="gacha" label={`뽑기 (1회 ${PULL_COST} 코인)`} onPress={() => go('gacha')} />
            <Button key="bag" label={`가방 · 장착 ${g.equip.length}/${SLOTS} · 보유 ${g.owned.length}/${ITEM_COUNT}`} onPress={() => go('bag')} />
          </Box>
          <Text dimColor>스테이지를 깨면 코인을 받고, 코인으로 아이템을 뽑아 강해집니다. 진행은 자동 저장됩니다.</Text>
        </Box>
      )
    }

    if (g.screen === 'themes') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>테마 선택 · 아래로 갈수록 어렵습니다</Text>
          <Box flexDirection="column">
            {g.cleared.map((n, t) => (
              <Button
                key={`theme-${t}`}
                label={`${STONE[themeEl(t)]} ${themeName(t)}${isDeep(t) ? ' · 몬스터 2~3' : ''} · ${n}/${STAGES} · 🪙 ${rewardOf(t, 1)}~${rewardOf(t, STAGES)}`}
                onPress={() => act(cur => ({ ...cur, screen: 'stages', theme: t }))}
              />
            ))}
          </Box>
          {back('menu')}
        </Box>
      )
    }

    if (g.screen === 'stages') {
      const el = themeEl(g.theme)
      const open = (g.cleared[g.theme] ?? 0) + 1
      const list: number[] = []
      for (let s = 1; s <= STAGES; s++) list.push(s)

      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>
            {STONE[el]} {themeName(g.theme)}
            {isDeep(g.theme)
              ? ' · 몬스터마다 속성이 다릅니다'
              : ` · 약점 ${STONE[BEATS.indexOf(el)]} ${NAME[BEATS.indexOf(el)]} (×1.5)`}
          </Text>
          <Box flexDirection="column">
            {list.map(s => {
              const name = `${s}. ${isDeep(g.theme) ? '심연 ' : ''}${(MONSTER[el] as string[])[s - 1]}${isDeep(g.theme) ? (s <= 2 ? ' 외 1' : ' 외 2') : ''}${s === STAGES ? ' (보스)' : ''}`
              if (s > open) return <Text dimColor>🔒 {name}</Text>

              return (
                <Button
                  key={`stage-${s}`}
                  label={`${s < open ? '✓' : '▶'} ${name} · 🪙 ${rewardOf(g.theme, s) * (s < open ? 1 : 2)}`}
                  onPress={() => act(cur => startBattle(cur, cur.theme, s))}
                />
              )
            })}
          </Box>
          {back('themes')}
        </Box>
      )
    }

    if (g.screen === 'gacha') {
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>뽑기 · 🪙 {g.coins}</Text>
            <Text dimColor>
              {GRADE.map((name, k) => `${name} ${GRADE_RATE[k]}%`).join(' · ')} · 전체 {ITEM_COUNT}종
            </Text>
          </Box>
          <Box flexDirection="column">
            <Button key="pull-1" variant="primary" label={`1회 뽑기 (${PULL_COST})`} onPress={() => act(cur => gacha(cur, 1))} />
            <Button key="pull-10" label={`10회 뽑기 (${PULL_COST * 10})`} onPress={() => act(cur => gacha(cur, 10))} />
          </Box>
          {g.pulled.length > 0 && (
            <Box flexDirection="column">
              {g.pulled.map(id => {
                const it = itemOf(id)

                return (
                  <Text color={it.grade === 3 ? 'warning' : it.grade === 2 ? 'success' : undefined} bold={it.grade === 3}>
                    [{GRADE[it.grade]}] {it.name} · {effect(it)}
                  </Text>
                )
              })}
            </Box>
          )}
          {g.note !== '' && <Text>{g.note}</Text>}
          <Box flexDirection="column">
            <Button key="to-bag" label="가방에서 장착하기" onPress={() => go('bag')} />
            {back('menu')}
          </Box>
        </Box>
      )
    }

    if (g.screen === 'bag') {
      const all = sortedOwned(g.owned)
      const pages = Math.max(1, Math.ceil(all.length / PAGE))
      const page = Math.min(g.page, pages - 1)

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>
              가방 · 장착 {g.equip.length}/{SLOTS}
            </Text>
            <Text dimColor>{gearLine}</Text>
          </Box>
          {all.length === 0 ? (
            <Text dimColor>아직 아이템이 없습니다. 뽑기에서 얻을 수 있습니다.</Text>
          ) : (
            <Box flexDirection="column">
              {all.slice(page * PAGE, page * PAGE + PAGE).map(id => {
                const it = itemOf(id)

                return (
                  <Button
                    key={`item-${id}`}
                    label={`${g.equip.includes(id) ? '● ' : '○ '}[${GRADE[it.grade]}] ${it.name} · ${effect(it)}`}
                    onPress={() => act(cur => toggleEquip(cur, id))}
                  />
                )
              })}
            </Box>
          )}
          <Text dimColor>누르면 장착 ● / 해제 ○ · {page + 1}/{pages} 쪽</Text>
          {g.note !== '' && <Text color="warning">{g.note}</Text>}
          <Box flexDirection="column">
            {pages > 1 && (
              <Button key="page-next" label="다음 쪽" onPress={() => act(cur => ({ ...cur, page: (page + 1) % pages }))} />
            )}
            {back('menu')}
          </Box>
        </Box>
      )
    }

    // ── 전투 ──
    const onCell = async (i: number) => {
      const before = await read($, game)
      const { frames, final } = plan(before, i)
      if (frames.length === 0) {
        await update($, game, () => final)

        return
      }

      // 프레임을 타이머로 하나씩 그린다. 그동안 busy 로 입력을 막는다
      let hps = before.mHp
      let php = before.php
      const total = (list: number[]) => list.reduce((a, b) => a + b, 0)
      const play = async (n: number) => {
        const frame = frames[n]
        if (!frame) {
          await act(() => final)

          return
        }
        hps = applyHit(hps, before.target, frame.hit)
        php = Math.max(0, php - frame.hurt)
        const shown = { hps, php }
        const dealt = total(before.mHp) - total(hps)
        const log =
          frame.hurt > 0
            ? `몬스터의 공격! −${frame.hurt}`
            : frame.chain <= 0
              ? '…'
              : frame.chain > 1
                ? `${frame.chain}연쇄! −${dealt}`
                : `−${dealt}`
        await update($, game, cur => ({
          ...cur,
          board: frame.board,
          flash: frame.flash,
          mHp: shown.hps,
          php: shown.php,
          sel: null,
          busy: true,
          log,
        }))
        $.clock.after(frame.ms, () => void play(n + 1))
      }
      await play(0)
    }
    const mine = Math.round((g.php / g.pmaxHp) * 20)
    // 고른 몬스터를 이기는 속성
    const weak = BEATS.indexOf(g.mEl[g.target] as number)
    const hasNext = g.stage < STAGES

    const rows: number[] = []
    for (let r = 0; r < N; r++) rows.push(r)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>
            {themeName(g.theme)} {g.stage}/{STAGES}
            {g.mHp.length > 1 ? ' · 때릴 몬스터를 누르세요' : ''}
          </Text>
          {g.mHp.map((hp, k) => {
            const el = g.mEl[k] as number
            const bar = Math.round((hp / (g.mMax[k] as number)) * 10)
            const soon = (g.mIn[k] as number) <= 1
            if (hp <= 0) return <Text dimColor>✗ {STONE[el]} {monsterOf(g, k)} · 쓰러짐</Text>

            return (
              <Box flexDirection="column">
                <Button key={`mon-${k}`} plain onPress={() => update($, game, cur => aim(cur, k))}>
                  <Text bold={g.target === k} inverse={g.target === k && g.mHp.length > 1}>
                    {g.target === k ? '▶' : ' '} {STONE[el]} {monsterOf(g, k)}{' '}
                  </Text>
                  <Text color="error">{'█'.repeat(bar)}</Text>
                  <Text dimColor>{'░'.repeat(10 - bar)}</Text>
                  <Text> {hp}/{g.mMax[k]}</Text>
                </Button>
                <Text color={soon && !g.won ? 'warning' : undefined} bold={soon && !g.won}>
                  {'   '}
                  {soon ? '다음 턴에 공격!' : `${g.mIn[k]}턴 뒤 공격`} · 공격력 {g.mAtk[k]} · 약점{' '}
                  {STONE[BEATS.indexOf(el)]}
                </Text>
              </Box>
            )
          })}
          <Text color="success" bold>
            ▶ 약점 {STONE[weak]} {NAME[weak]} — {STONE[weak]} 돌을 맞추면 데미지 ×1.5
          </Text>
          <Text dimColor>{gearLine}</Text>
        </Box>
        <Box flexDirection="column">
          {rows.map(r => (
            <Box flexDirection="row">
              {rows.map(c => {
                const i = r * N + c
                const kind = g.board[i] as number
                const isFlash = g.flash.includes(i)

                return (
                  <Button key={`cell-${i}`} plain onPress={() => onCell(i)}>
                    {kind < 0 ? (
                      <Text dimColor>{'· '} </Text>
                    ) : (
                      <Text inverse={g.sel === i} backgroundColor={isFlash ? 'warning' : undefined} bold={isFlash}>
                        {STONE[kind]}{' '}
                      </Text>
                    )}
                  </Button>
                )
              })}
            </Box>
          ))}
        </Box>
        <Text>
          나 <Text color="success">{'█'.repeat(mine)}</Text>
          <Text dimColor>{'░'.repeat(20 - mine)}</Text> {g.php} / {g.pmaxHp}
        </Text>
        <Text>{g.log}</Text>
        <Box flexDirection="column">
          {g.won && hasNext && (
            <Button key="next" variant="primary" label="다음 스테이지" onPress={() => act(cur => startBattle(cur, cur.theme, cur.stage + 1))} />
          )}
          {g.over && (
            <Button key="retry" variant="primary" label="다시 도전" onPress={() => act(cur => startBattle(cur, cur.theme, cur.stage))} />
          )}
          {!g.busy && back('stages', g.won || g.over ? '스테이지 목록' : '포기하고 나가기')}
          {(g.won || g.over) && <Button key="menu" label="메인 메뉴" onPress={() => go('menu')} />}
        </Box>
        <Text dimColor>
          가로·세로 3칸 · 대각선 4칸부터 · 4칸 ×2 · 5칸 ×3 · 교차 ×2 · 연쇄마다 +50% · 약점 ×1.5{'\n'}
          물🔵 › 불🔴 › 나무🟢 › 땅🟤 › 전기🟡 › 물
        </Text>
      </Box>
    )
  })
}
