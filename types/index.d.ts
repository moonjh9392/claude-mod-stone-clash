export type Screen = 'menu' | 'themes' | 'stages' | 'battle' | 'gacha' | 'bag'

export type Game = {
  screen: Screen
  /** 테마 번호 0~9 (0~4 기본, 5~9 심화. 각각 물·불·나무·땅·전기 순) */
  theme: number
  /** 테마 안 스테이지 1~7 */
  stage: number
  board: number[]
  sel: number | null
  /** 먼저 때릴 몬스터 번호 */
  target: number
  /** 몬스터별 체력·최대 체력·속성·공격력·공격 주기·공격까지 남은 턴 (1~3마리) */
  mHp: number[]
  mMax: number[]
  mEl: number[]
  mAtk: number[]
  mEvery: number[]
  mIn: number[]
  /** 내 체력: 스테이지마다 가득 찬 채로 시작 */
  php: number
  pmaxHp: number
  log: string
  /** 사망 */
  over: boolean
  /** 클리어 */
  won: boolean
  /** 반짝이는 칸(맞춰진 줄) */
  flash: number[]
  /** 애니메이션 재생 중: 입력을 받지 않는다 */
  busy: boolean
  coins: number
  /** 테마별로 깬 스테이지 수 */
  cleared: number[]
  /** 가진 아이템 번호 */
  owned: number[]
  /** 장착한 아이템 번호(최대 5) */
  equip: number[]
  /** 가방 쪽 번호 */
  page: number
  /** 방금 뽑은 아이템 */
  pulled: number[]
  /** 메뉴 화면 안내 문구 */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'stone-clash': { game: Shaped<Game> }
  }
}
