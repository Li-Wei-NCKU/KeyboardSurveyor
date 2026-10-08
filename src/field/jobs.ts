/**
 * 派工 (每天的工作內容) 與進度存檔
 *  - day1 gnss：一等衛星控制點 CKSV 靜態觀測
 *  - day2 level：縣道路肩一等水準 BM-1035 → BM-1036
 */
import type { ItemId } from './items';

export type JobId = 'gnss' | 'level';

export interface JobDef {
  id: JobId;
  day: number;
  title: string;
  menuName: string;
  menuDesc: string;
  tasks: string[];
  required: ItemId[];
  /** 現場中心 (判斷設備是否留在現場、是否抵達) */
  site: { x: number; z: number; r: number };
  /** 建議停車位置 */
  park: { x: number; z: number };
  route: 'toSite' | 'toLevel';
  back: 'return' | 'levelReturn';
  workOrder: { item: string; place: string; spec: string; note: string; seq: string };
  hints: { prep: string; toSite: string; site: string; observe: string; packup: string };
}

/** 縣道東段路肩水準路線 (路面北側路肩 z≈52.4) */
export const LEVEL_ROUTE = {
  bm1: { x: 60, z: 52.6, name: 'BM-1035' },
  bm2: { x: 118, z: 52.6, name: 'BM-1036' },
};

export const JOBS: Record<JobId, JobDef> = {
  gnss: {
    id: 'gnss', day: 1,
    title: '外業一日：CKSV 靜態觀測',
    menuName: '第一天：GNSS 靜態觀測',
    menuDesc: '一等衛星控制點 CKSV。自己備料裝車、開車到現場、定心定平、量天線高、記錄一個時段。',
    tasks: ['讀派工單', '備料裝車：把需要的設備搬上後斗', '開車前往 CKSV 控制點', '卸貨並架設 GNSS（三腳架 → 基座 → 接收儀）', '完成靜態觀測', '收工：設備全部裝回車上', '開回公司交差'],
    required: ['tripod', 'tribrach', 'gnss', 'toolbag'],
    site: { x: 0, z: 0, r: 80 },
    park: { x: -9.5, z: 12 },
    route: 'toSite', back: 'return',
    workOrder: {
      seq: '01',
      item: '一等衛星控制點 CKSV　GNSS 靜態觀測（一時段）',
      place: '出公司右轉沿縣道往東約 140 公尺，產業道路左側農地；路旁有黃色指示箭頭。',
      spec: '定心 ≤ 1 mm、整平氣泡居中、天線高量至 mm',
      note: '昨天航拍組車子沒卸，後斗自己處理。<br>要帶什麼自己判斷，不要再打給我問。<br>腳架不要再忘在田裡了。',
    },
    hints: {
      prep: '貨架上挑設備，拿到車尾按 E 放進後斗。後斗還有昨天的東西，要不要先搬下來自己決定。準備好就上車（看著車頭按 E）。',
      toSite: '出公司右轉沿縣道往東，看到黃色箭頭左轉進產業道路，停在路邊空地，不要停在路中間。',
      site: '把設備從後斗搬到 CKSV 控制點：先拿三腳架對著控制點按 E，再依序裝上基座和接收儀。',
      observe: '依手簿步驟完成定心定平、量天線高、啟動觀測。',
      packup: '觀測完成！儀器已拆收在控制點旁，全部搬回後斗再走。腳架不要再忘了。',
    },
  },
  level: {
    id: 'level', day: 2,
    title: '外業第二天：縣道一等水準',
    menuName: '第二天：一等水準測量',
    menuDesc: '縣道路肩 BM-1035 → BM-1036。帶學弟扶尺，2～3 站加尺墊轉點，讀尺、記手簿、算閉合差。',
    tasks: ['讀派工單', '備料裝車：把需要的設備搬上後斗', '開車到縣道東段，停在路肩', '把標尺、尺墊交給學弟，到 BM-1035 立尺', '水準觀測：架站、定平、讀後視與前視，轉點到 BM-1036', '收工：設備全部裝回車上', '開回公司交差'],
    required: ['tripod', 'level', 'staff', 'plate', 'toolbag', 'cones'],
    site: { x: 89, z: 52.5, r: 70 },
    park: { x: 50, z: 52.4 },
    route: 'toLevel', back: 'levelReturn',
    workOrder: {
      seq: '02',
      item: '縣道路肩一等水準 BM-1035 → BM-1036（單程，含轉點）',
      place: '出公司右轉沿縣道往東，過產業道路口繼續直行約 60 公尺，停在右側路肩。兩個水準點都在路肩上。',
      spec: '前後視距差 ≤ 2 m、讀數估讀至 mm、閉合差 ≤ 3 mm（本公司內規）',
      get note() { return `今天學弟${asstName()}跟你出去，標尺和尺墊交給他扶。<br>路肩作業記得擺交通錐，車很多，警察也常經過。<br>昨天那個阿伯如果又出現……你自己看著辦。`; },
    },
    hints: {
      prep: '今天測水準：貨架上挑設備搬上後斗（學弟會跟著上車）。準備好就上車。',
      toSite: '出公司右轉沿縣道往東，過產業道路口繼續直行，停在右側路肩。',
      site: '把標尺和尺墊從後斗拿出來交給學弟（對著學弟按 E），他就會去 BM-1035 立尺。',
      observe: '扛腳架找一個前後視距差不多的位置架站。',
      packup: '水準測完了！把儀器、腳架收回後斗，標尺和尺墊跟學弟拿回來，一起帶走。',
    },
  },
};

// ------------------------------------------------------------------
// 第二天的學弟：每次隨機一位
// ------------------------------------------------------------------
export const ASST_NAMES = ['敬翔', '李暐', '宏斌', '育維', '品旭'];
let asst = ASST_NAMES[Math.floor(Math.random() * ASST_NAMES.length)];
export function asstName() { return asst; }
export function setAsstName(n: string) { if (n) asst = n; }
export function pickAsstName() { asst = ASST_NAMES[Math.floor(Math.random() * ASST_NAMES.length)]; return asst; }

// ------------------------------------------------------------------
// 進度存檔 (瀏覽器 localStorage；失敗就當沒存)
// ------------------------------------------------------------------
export interface Progress {
  day1Done: boolean;
  day2Done: boolean;
  /** 第一天跟阿伯說了什麼 ('' = 沒遇到) */
  uncle: string;
  /** 第一天阿黃的結果 */
  dog: '' | 'stopped' | 'bumped';
  kids: '' | 'stopped' | 'bumped';
}
const KEY = 'ks-progress-v2';
const EMPTY: Progress = { day1Done: false, day2Done: false, uncle: '', dog: '', kids: '' };

export function loadProgress(): Progress {
  try {
    const s = localStorage.getItem(KEY);
    return s ? { ...EMPTY, ...JSON.parse(s) } : { ...EMPTY };
  } catch { return { ...EMPTY }; }
}

export function saveProgress(p: Partial<Progress>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadProgress(), ...p })); } catch { /* 無痕模式等情況存不了 */ }
}
