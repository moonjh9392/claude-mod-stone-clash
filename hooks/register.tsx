import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Game } from '../types'

const PANE = 'stone-clash'
const N = 6
// 대각선은 4칸부터 줄로 친다(가로·세로는 3칸)
const DIAGONAL_MIN = 4
const KINDS = 5
const PLAYER_HP = 100
// 0 물 · 1 불 · 2 땅 · 3 나무 · 4 전기
const STONE = ['🔵', '🔴', '🟤', '🟢', '🟡']
const NAME = ['물', '불', '땅', '나무', '전기']
const MONSTER = ['물안개 해파리', '화산 도롱뇽', '바위 거북', '넝쿨 사마귀', '번개 족제비']
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

// 연쇄: n 번째 연쇄는 ×(1 + 0.5 × (n − 1)). frames = 반짝임 → 사라짐 → 한 칸씩 낙하 를 연쇄마다
export function resolve(start: number[], monEl: number) {
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
    const hit = Math.round(damageOf(runs, monEl) * (1 + 0.5 * (chain - 1)))
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

// 느리게 때리는 몬스터일수록 한 방이 세다(턴당 피해는 비슷)
function startStage(stage: number, best: number, php = PLAYER_HP): Game {
  const maxHp = Math.round(300 * Math.pow(1.25, stage - 1))
  const atkEvery = 2 + rnd(3)

  return {
    board: newBoard(),
    sel: null,
    stage,
    hp: maxHp,
    maxHp,
    monEl: rnd(KINDS),
    php,
    pmaxHp: PLAYER_HP,
    atk: Math.round((5 + stage) * atkEvery),
    atkEvery,
    atkIn: atkEvery,
    log: '돌을 누르고, 바로 옆 돌을 눌러 자리를 바꾸세요.',
    best,
    over: false,
    flash: [],
    busy: false,
  }
}

const isNext = (a: number, b: number) =>
  (Math.abs(a - b) === 1 && Math.floor(a / N) === Math.floor(b / N)) || Math.abs(a - b) === N

export type Plan = { frames: Frame[]; final: Game }

// 한 번 누른 결과: 재생할 프레임들과 최종 상태. 고르기만 한 경우 frames 는 비어 있다
export function plan(game: Game, i: number): Plan {
  const still = (final: Game): Plan => ({ frames: [], final })
  if (game.over || game.busy) return still(game)
  if (game.sel === null) return still({ ...game, sel: i })
  if (game.sel === i) return still({ ...game, sel: null })
  if (!isNext(game.sel, i)) return still({ ...game, sel: i })

  const tried = swapped(game.board, game.sel, i)
  if (findRuns(tried).length === 0) {
    // 바꿨다가 되돌아오는 모습만 보여 준다. 턴은 쓰지 않는다
    return {
      frames: [{ board: tried, flash: [], hit: 0, hurt: 0, chain: 0, ms: 220 }],
      final: { ...game, sel: null, log: '맞는 줄이 없어요. 가로·세로 3칸, 대각선 4칸 이상 이어지게 바꾸세요.' },
    }
  }

  const done = resolve(tried, game.monEl)
  const frames: Frame[] = [{ board: tried, flash: [], hit: 0, hurt: 0, chain: 0, ms: 160 }, ...done.frames]
  const hp = Math.max(0, game.hp - done.total)
  const notes = [
    done.longest >= 4 ? `${done.longest}칸` : '',
    done.hadCross ? '교차' : '',
    done.chain > 1 ? `${done.chain}연쇄` : '',
  ].filter(Boolean)
  const hit = `${done.total} 데미지${notes.length ? ` (${notes.join(' · ')})` : ''}`

  // 몬스터를 잡으면 공격받지 않고 다음 스테이지. 체력은 조금 회복한다
  if (hp === 0) {
    const best = Math.max(game.best, game.stage)
    const php = Math.min(game.pmaxHp, game.php + 20)
    const next = startStage(game.stage + 1, best, php)

    return { frames, final: { ...next, log: `${hit} — 스테이지 ${game.stage} 클리어! 체력 +${php - game.php}` } }
  }

  // 돌을 한 번 맞출 때마다 몬스터 공격이 한 턴 가까워진다
  const board = hasMove(done.board) ? done.board : newBoard()
  const rest = { ...game, board, sel: null, hp, flash: [], busy: false }
  if (game.atkIn > 1) {
    return { frames, final: { ...rest, atkIn: game.atkIn - 1, log: hit } }
  }

  const php = Math.max(0, game.php - game.atk)
  frames.push({ board: done.board, flash: [], hit: 0, hurt: game.php - php, chain: -1, ms: 520 })
  const struck = `${hit} → ${MONSTER[game.monEl]}의 공격! −${game.php - php}`
  if (php === 0) {
    return { frames, final: { ...rest, php, atkIn: 0, over: true, log: `${struck} — 쓰러졌습니다.` } }
  }

  return { frames, final: { ...rest, php, atkIn: game.atkEvery, log: struck } }
}

export const press = (game: Game, i: number): Game => plan(game, i).final

const game = atom({ plugin: 'stone-clash', key: 'game' } as const, startStage(1, 0), {
  shape: 'game-5',
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'stone-clash',
      description: '돌 맞추기 퍼즐 패널 열기',
    })
    const best = Number((await $.store.get('best')) ?? 0)
    // 재생 도중 다시 로드되면 타이머가 사라지므로 잠금을 푼다
    await update($, game, g => ({ ...g, best: Math.max(g.best, best), busy: false, flash: [] }))
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
    const filled = Math.round((g.hp / g.maxHp) * 20)

    const onCell = async (i: number) => {
      const before = await read($, game)
      const { frames, final } = plan(before, i)
      if (frames.length === 0) {
        await update($, game, () => final)

        return
      }

      // 프레임을 타이머로 하나씩 그린다. 그동안 busy 로 입력을 막는다
      let hp = before.hp
      let php = before.php
      const play = async (n: number) => {
        const frame = frames[n]
        if (!frame) {
          await update($, game, () => final)
          if (final.best > before.best) await $.store.set('best', final.best)

          return
        }
        hp = Math.max(0, hp - frame.hit)
        php = Math.max(0, php - frame.hurt)
        const shown = { hp, php }
        const log =
          frame.hurt > 0
            ? `${MONSTER[before.monEl]}의 공격! −${frame.hurt}`
            : frame.chain <= 0
              ? '…'
              : frame.chain > 1
                ? `${frame.chain}연쇄! −${before.hp - hp}`
                : `−${before.hp - hp}`
        await update($, game, cur => ({
          ...cur,
          board: frame.board,
          flash: frame.flash,
          hp: shown.hp,
          php: shown.php,
          sel: null,
          busy: true,
          log,
        }))
        $.clock.after(frame.ms, () => void play(n + 1))
      }
      await play(0)
    }
    const retry = () => update($, game, cur => startStage(1, cur.best))
    const mine = Math.round((g.php / g.pmaxHp) * 20)

    const rows: number[] = []
    for (let r = 0; r < N; r++) rows.push(r)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>
            스테이지 {g.stage} · {MONSTER[g.monEl]} {STONE[g.monEl]}
          </Text>
          <Text>
            <Text color="error">{'█'.repeat(filled)}</Text>
            <Text dimColor>{'░'.repeat(20 - filled)}</Text> {g.hp} / {g.maxHp}
          </Text>
          <Text color={g.atkIn <= 1 ? 'warning' : undefined} bold={g.atkIn <= 1}>
            {g.over ? '공격함' : g.atkIn <= 1 ? '다음 턴에 공격!' : `${g.atkIn}턴 뒤 공격`} · 공격력 {g.atk} ·{' '}
            {g.atkEvery}턴마다
          </Text>
          <Text dimColor>약점 {NAME[BEATS.indexOf(g.monEl)]} · 최고 스테이지 {g.best}</Text>
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
        {g.over && <Button key="retry" variant="primary" label="처음부터 다시" onPress={retry} />}
        <Text dimColor>
          가로·세로 3칸 · 대각선 4칸부터 · 4칸 ×2 · 5칸 ×3 · 교차 ×2 · 연쇄마다 +50% · 약점 ×1.5{'\n'}
          물🔵 › 불🔴 › 나무🟢 › 땅🟤 › 전기🟡 › 물
        </Text>
      </Box>
    )
  })
}
