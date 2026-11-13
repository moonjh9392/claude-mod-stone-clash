export type Game = {
  board: number[]
  sel: number | null
  stage: number
  /** 몬스터 체력 */
  hp: number
  maxHp: number
  monEl: number
  /** 내 체력: 스테이지를 넘어가도 이어진다 */
  php: number
  pmaxHp: number
  /** 몬스터 공격력 */
  atk: number
  /** 몇 턴마다 공격하는가 */
  atkEvery: number
  /** 공격까지 남은 턴 */
  atkIn: number
  log: string
  best: number
  /** 사망 */
  over: boolean
  /** 반짝이는 칸(맞춰진 줄) */
  flash: number[]
  /** 애니메이션 재생 중: 입력을 받지 않는다 */
  busy: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'stone-clash': { game: Shaped<Game> }
  }
}
