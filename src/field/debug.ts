/**
 * 測試工具 (F9 開關)：用遊玩的方式除錯，不用每次從頭玩。
 *  - 設定「第一天的結果」(阿伯的回答、阿黃、小朋友) 並解鎖第二天
 *  - 直接開始某一天、或直接到現場 (設備自動裝好)
 *  - 立刻觸發現場事件、一鍵整平、望遠鏡顯示正確讀數、學弟瞬移
 */
import type { GameApp, AnyObj } from './legacy';
import type { FieldDay } from './fieldDay';
import { JOBS, loadProgress, saveProgress, type JobId } from './jobs';
import type { ItemId } from './items';
import * as ui from './ui';

const dbg: AnyObj = ((window as AnyObj).__ksDebug = (window as AnyObj).__ksDebug || { truth: false });

let panel: HTMLDivElement | null = null;

export function installDebug(app: GameApp, field: FieldDay, showMenu: () => void) {
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F9') return;
    e.preventDefault();
    e.stopPropagation();
    if (panel) close(); else open(app, field, showMenu);
  }, true);
}

function close() {
  panel?.remove();
  panel = null;
}

function open(app: GameApp, field: FieldDay, showMenu: () => void) {
  if (document.exitPointerLock) document.exitPointerLock();
  const pr = loadProgress();
  const fd = field as AnyObj;
  const inField = app.currentLevelObj === field;
  const job: JobId = field.job;
  const lv = fd.lv as AnyObj;

  panel = document.createElement('div');
  panel.className = 'ks-debug';
  const sel = (id: string, opts: [string, string][], cur: string) =>
    `<select data-k="${id}">${opts.map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  panel.innerHTML = `
    <div class="kd-head"><strong>測試工具</strong><span>F9 關閉</span></div>
    <section>
      <h4>第一天的結果（影響第二天）</h4>
      <label>阿伯　${sel('uncle', [['', '沒遇到阿伯'], ['explain', '好好解釋'], ['order', '出示派工單'], ['lie', '說要開路（騙他）'], ['secret', '說是國家機密'], ['ignore', '不理他']], pr.uncle)}</label>
      <label>阿黃　${sel('dog', [['', '沒遇到'], ['stopped', '被攔住'], ['bumped', '撞到腳架']], pr.dog)}</label>
      <label>小朋友 ${sel('kids', [['', '沒遇到'], ['stopped', '被攔住'], ['bumped', '摸了腳架']], pr.kids)}</label>
      <div class="kd-row">
        <button data-a="save">存檔並解鎖第二天</button>
        <button data-a="reset" class="kd-ghost">清除進度</button>
      </div>
    </section>
    <section>
      <h4>直接開始</h4>
      <div class="kd-row">
        <button data-a="go-gnss">第一天：從頭</button>
        <button data-a="site-gnss">第一天：直接到現場</button>
      </div>
      <div class="kd-row">
        <button data-a="go-level">第二天：從頭</button>
        <button data-a="site-level">第二天：直接到現場</button>
      </div>
      <p class="kd-note">「直接到現場」會把當天需要的設備自動裝上後斗、車停好；路上的東西都跳過。</p>
    </section>
    ${inField && job === 'level' ? `
    <section>
      <h4>第二天現場</h4>
      <div class="kd-row">
        <button data-a="lv-uncle">阿伯馬上出現</button>
        <button data-a="lv-scooter">機車停到視線上</button>
        <button data-a="lv-dog">阿黃馬上來</button>
      </div>
      <div class="kd-row">
        <button data-a="lv-tilt">下一次讀數：尺沒扶直</button>
        <button data-a="lv-level">一鍵整平</button>
        <button data-a="lv-warp">學弟立刻走到</button>
      </div>
      <div class="kd-row">
        <button data-a="lv-police">警察馬上經過（照現況）</button>
        <button data-a="lv-truck">大貨車馬上經過</button>
        <button data-a="lv-kids">小朋友馬上來（交換後）</button>
        <button data-a="lv-wrong">學弟尺立錯（BM-1035）</button>
      </div>
      <div class="kd-row">
        <button data-a="lv-cop-none">警察來：有帶但沒擺</button>
        <button data-a="lv-cop-nohave">警察來：沒帶也沒擺</button>
        <button data-a="lv-cop-wrong">警察來：交通錐擺錯</button>
        <button data-a="lv-cop-ok">警察來：交通錐擺對</button>
      </div>
      <label class="kd-check"><input type="checkbox" data-k="truth"${dbg.truth ? ' checked' : ''}> 望遠鏡裡顯示正確讀數</label>
      <p class="kd-note">阿伯和阿黃的台詞依上面「第一天的結果」決定；改完按「存檔」再觸發。機車、阿黃需要先架好儀器、學弟在立尺。小朋友依「第一天的結果」：被攔住→來幫忙顧尺墊，其他→來踢尺墊。</p>
    </section>` : ''}
    ${inField && job === 'gnss' ? `
    <section>
      <h4>第一天現場</h4>
      <div class="kd-row">
        <button data-a="g-setup">一鍵架好儀器（定心定平完成）</button>
        <button data-a="g-uncle">阿伯馬上出現</button>
        <button data-a="g-dog">下一個碰腳架：阿黃</button>
        <button data-a="g-kid">下一個碰腳架：小朋友</button>
      </div>
      <div class="kd-row">
        <button data-a="g-owner">地主／里長再來一次</button>
        <button data-a="g-police">地主報警，警車馬上來</button>
        <button data-a="g-auntie">阿姨馬上騎車來（收工）</button>
      </div>
      <p class="kd-note">碰腳架事件會在定心定平完成後發生（先選阿黃或小朋友，再按一鍵架好）；地主在量完天線高後出現。</p>
    </section>` : ''}
    <p class="kd-msg" aria-live="polite"></p>`;
  document.body.appendChild(panel);
  const msg = (t: string) => { const m = panel?.querySelector('.kd-msg'); if (m) m.textContent = t; };
  const val = (k: string) => (panel!.querySelector(`[data-k="${k}"]`) as HTMLSelectElement).value;

  panel.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a!;
    switch (a) {
      case 'save':
        saveProgress({ day1Done: true, uncle: val('uncle'), dog: val('dog') as AnyObj, kids: val('kids') as AnyObj });
        if (lv) lv.pr = loadProgress();
        msg('已存檔，第二天已解鎖。');
        if (!inField) { close(); showMenu(); }
        return;
      case 'reset':
        saveProgress({ day1Done: false, day2Done: false, uncle: '', dog: '', kids: '' });
        msg('進度已清除。');
        return;
      case 'go-gnss': case 'go-level':
        close(); start(app, field, a === 'go-gnss' ? 'gnss' : 'level', false); return;
      case 'site-gnss': case 'site-level':
        close(); start(app, field, a === 'site-gnss' ? 'gnss' : 'level', true); return;
      // ---- 第二天
      case 'lv-uncle':
        lv.pr = loadProgress(); lv.uncleDone = false;
        if (fd.phase !== 'observe') fd.phase = 'observe';
        lv.spawnUncle();
        if (lv.pr.uncle === 'ignore' && !(lv.inst && lv.rodAt)) msg('「不理他」版本要先架好儀器、學弟在立尺，阿伯才會去擋視線。');
        else msg('阿伯出發了。'); return;
      case 'lv-scooter':
        if (!lv.inst || !lv.stations.length || lv.swapped) { msg('先在第一站架好儀器（換學弟操作之後就不會有機車了）。'); return; }
        lv.scooterDone = false; lv.spawnScooter(); msg('機車來了。'); return;
      case 'lv-dog':
        if (!lv.inst) { msg('先架好儀器。'); return; }
        lv.pr = loadProgress();
        if (!lv.pr.dog) { msg('「第一天的結果」裡阿黃是「沒遇到」，牠不會出現。先改成「撞到腳架」或「被攔住」並存檔。'); return; }
        lv.dogDone = false; close(); lv.maybeDog(); return;
      case 'lv-cop-none': case 'lv-cop-nohave': case 'lv-cop-wrong': case 'lv-cop-ok':
        if (!['site', 'observe'].includes(fd.phase)) { msg('要先到第二天的現場（「第二天：直接到現場」）。'); return; }
        lv.debugPolice(a === 'lv-cop-none' ? 'none' : a === 'lv-cop-nohave' ? 'nohave' : a === 'lv-cop-wrong' ? 'wrong' : 'ok'); close(); return;
      case 'lv-police':
        lv.policeStage = 'wait'; lv.policeT = 0.1; msg(lv.cones ? '有擺交通錐：警車會巡邏經過。' : '沒擺交通錐：警車會停下來。'); return;
      case 'lv-truck':
        if (!lv.inst) { msg('先架好儀器。'); return; }
        lv.truckDone = true; lv.spawnLorry(); msg('大貨車來了，打開望遠鏡看看。'); return;
      case 'lv-kids':
        if (!lv.kidTarget()) { msg('要在交換角色後、TP1 上只剩標尺的時候才會來。'); return; }
        lv.pr = loadProgress(); lv.kidsDone = false; close(); lv.spawnKids(); return;
      case 'lv-wrong':
        if (lv.swapped || lv.rodAt !== lv.bm1) { msg('學弟要在 BM-1035 立尺時才能用。'); return; }
        lv.rodWrong = true; lv.placeAsstAtRod(); msg('學弟的尺現在立在標石旁的地上。'); return;
      case 'lv-tilt':
        lv.tiltPlanned = lv.readCount + 1; msg('下一次開望遠鏡時，標尺會是歪的。'); return;
      case 'lv-level':
        if (!lv.inst || lv.instState === 'tripod') { msg('還沒裝上水準儀。'); return; }
        Object.assign(lv.lv, { bx0: 0, by0: 0, screwA: 0, screwB: 0, screwC: 0 });
        lv.lv.recalculateTribrachPhysics();
        lv.instState = 'leveled'; lv.nextHint(); msg('已整平。');
        if (!lv.swapped && lv.stations.length === 1 && !lv.scooterDone) setTimeout(() => lv.spawnScooter(), 1500);
        return;
      case 'lv-warp': {
        const as = lv.asst;
        if (as.state !== 'goto') { msg('學弟現在沒有要去哪裡。'); return; }
        as.g.position.set(as.tx, as.g.position.y, as.tz); msg('學弟到了。'); return;
      }
      // ---- 第一天
      case 'g-uncle': fd.events.debugUncle(); msg('阿伯出發了。'); return;
      case 'g-dog': fd.events.debugBump('dog'); msg('定心定平完成後，阿黃會衝過來。'); return;
      case 'g-kid': fd.events.debugBump('kid'); msg('定心定平完成後，小朋友會跑過來。'); return;
      case 'g-setup': msg(fd.debugSetupGnss()); return;
      case 'g-auntie':
        if (!['site', 'observe', 'packup'].includes(fd.phase)) { msg('要先到第一天的現場（「第一天：直接到現場」）。'); return; }
        // 腳架有架就照正常流程收工 (設備擺回控制點旁)，沒架就直接切到收工階段
        if (fd.phase !== 'packup') { if (fd.tripodSet) fd.onGnssDone({ score: 80 }); else fd.setPhase('packup'); }
        fd.events.debugAuntie(); close(); return;
      case 'g-police': fd.events.debugPolice(); msg('地主報警了，警車出發。'); return;
      case 'g-owner': fd.events.debugOwner(); msg('量完天線高後，地主／里長會出現。'); return;
    }
  });
  panel.querySelector<HTMLInputElement>('[data-k="truth"]')?.addEventListener('change', (e) => {
    dbg.truth = (e.target as HTMLInputElement).checked;
  });
}

/** 開始某一天；toSite = 設備自動裝好、車停在現場 */
function start(app: GameApp, field: FieldDay, job: JobId, toSite: boolean) {
  document.querySelectorAll('.field-modal').forEach(e => e.remove());
  ui.dropMenuKeys();
  field.job = job;
  app.loadLevel('field');
  if (!toSite) return;
  const fd = field as AnyObj;
  // 跳過派工單
  ui.dismissWorkOrder();
  fd.setPhase('prep');
  // 從貨架拿走需要的設備，直接放進後斗
  JOBS[job].required.forEach((it: ItemId) => {
    const g = fd.ground.find((x: AnyObj) => x.item === it);
    if (g) {
      app.sceneManager.scene.remove(g.obj);
      fd.unregister(g.obj);
      fd.ground = fd.ground.filter((x: AnyObj) => x !== g);
      fd.shelfSpots.forEach((s: AnyObj) => { if (s.uid === g.uid) s.uid = null; });
    }
    const spot = fd.grid.findSpot(it);
    if (spot) fd.loadTrunk(it, spot.col, spot.row, spot.layer, spot.rot);
  });
  const park = JOBS[job].park;
  fd.enterTruck();
  fd.truck.setPose(park.x, park.z, job === 'gnss' ? -Math.PI / 2 : 0);
  fd.truck.speed = 0;
  fd.phase = 'toSite';
  fd.exitTruck();
  ui.toast('（測試）已直接到現場，設備在後斗。', 'info', 3000);
}
