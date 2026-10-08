/**
 * 現場事件導演：路人阿伯 (含後續分支)、小孩/土狗碰腳架、地主/里長 (出示公文)、阿姨問地界、組長來電
 *
 * 時機設計 (避免玩家一路按完儀器步驟而錯過事件)：
 *  - 腳架架好後 → 阿伯走過來
 *  - 定心定平完成 (GNSS step 2) → 小孩或土狗衝向腳架 (阿伯選「不理」時改由阿伯靠到腳架)
 *  - 量完天線高 (GNSS step 3) → 地主 (或里長，若對阿伯亂講要開路) 來問
 *  - 收工階段 → 騎車阿姨停下來問地界
 *  - 回程 (若跟阿伯說「國家機密」) → 組長來電
 * 事件 NPC 走過來或對話中，儀器操作會暫停。
 */
import { bench } from './bench';
import { playBossIntro, setThreat } from './cine';
import { dust, phonePhoto, GroundRing } from './fx';
import { runQTE, qteActive } from './qte';
import { PoliceCar } from './police';
import * as THREE from 'three';
import type { GameApp, AnyObj } from './legacy';
import { buildPerson, buildDog, animateWalk, animateDog, ROAD_Z } from './npc';
import * as ui from './ui';
import * as sfx from './sfx';

export interface EventHost {
  app: GameApp;
  phase(): string;
  inTruck(): boolean;
  playerPos(): THREE.Vector3;
  toolbagNear(): boolean;
  addPR(score: number, tag: string): void;
  hydrate(amount: number, label: string): void;
  truckSpeed(): number;
  radioPause(): void;
  radioResume(): void;
  truckPos(): { x: number; z: number };
}

type Kind = 'uncle' | 'kid' | 'dog' | 'owner' | 'chief' | 'auntie' | 'police';
interface Actor { kind: Kind; g: THREE.Group; state: string; t: number; target?: THREE.Vector3; cd?: number }

type UncleChoice = '' | 'explain' | 'lie' | 'secret' | 'ignore' | 'order';

const CKSV = new THREE.Vector3(0, 0, 0);

export class SiteEvents {
  actors: Actor[] = [];
  private time = 0;
  private uncleChoice: UncleChoice = '';
  private uncleTimer = -1;
  private teaTimer = -1;
  private bumpDone = false;
  private ownerDone = false;
  private auntieDone = false;
  private callTimer = -1;
  private callDone = false;
  private blockedUntil = 0;
  private blockedWhy = '';
  private policeTimer = -1;
  private policeDone = false;
  private policeArgued = false;
  private policeCar: PoliceCar | null = null;
  private guard: GroundRing | null = null;
  bumps: string[] = [];
  private tiltTarget = 0;
  /** 給第二天用：阿黃 / 小朋友的結果 */
  dogOutcome: '' | 'stopped' | 'bumped' = '';
  kidsOutcome: '' | 'stopped' | 'bumped' = '';
  get uncleSaid() { return this.uncleChoice; }

  // ---------------------------------------------------------------- 測試工具用
  forceBump: '' | 'dog' | 'kid' = '';
  /** 下一個碰腳架事件指定為狗或小孩 (腳架架好且定平完成後觸發) */
  debugBump(kind: 'dog' | 'kid') { this.forceBump = kind; this.bumpDone = false; this.actors.filter(a => a.kind === 'dog' || a.kind === 'kid').forEach(a => this.remove(a)); }
  /** 阿伯馬上出現 */
  debugUncle() { if (!this.actors.some(a => a.kind === 'uncle')) this.uncleTimer = 0.1; }
  /** 地主 / 里長馬上出現 (量完天線高後) */
  debugOwner() { this.ownerDone = false; }
  /** 地主報警：警車馬上出發 */
  debugPolice() {
    if (this.policeCar) return;
    this.ownerDone = true; this.policeDone = false; this.policeArgued = false;
    let o = this.actors.find(a => a.kind === 'owner' || a.kind === 'chief');
    if (!o) { const p = this.h.playerPos(); o = this.spawn(this.uncleChoice === 'lie' ? 'chief' : 'owner', p.x - 1.4, p.z + 1.4); }
    o.state = 'stay';
    this.callPolice(o.kind === 'chief' ? '里長' : '地主', 0.5);
  }

  constructor(private h: EventHost) {}

  reset() {
    const sc = this.h.app.sceneManager.scene;
    this.actors.forEach(a => sc.remove(a.g));
    this.actors = [];
    this.uncleChoice = '';
    this.uncleTimer = this.teaTimer = this.callTimer = -1;
    this.bumpDone = this.ownerDone = this.auntieDone = this.callDone = false;
    this.blockedUntil = 0;
    this.policeTimer = -1;
    this.policeDone = this.policeArgued = false;
    this.policeCar?.dispose();
    this.policeCar = null;
    this.guard?.hide();
    this.bumps = [];
    this.tiltTarget = 0;
    this.dogOutcome = this.kidsOutcome = '';
    setThreat(this.h.app, []);
  }

  /** Boss 登場運鏡，結束後主角們才開始衝 */
  private intro(lead: Actor, crew: Actor[], name: string, sub: string, tagline: string, go: () => void) {
    crew.forEach(c => { c.state = 'intro'; c.t = 0; });
    const trip = this.tripod();
    const target = trip ? trip.position.clone() : CKSV.clone();
    const p = this.h.app.player;
    if (this.h.inTruck() || document.querySelector('.field-modal') || p.externalControl && !bench.mode) {
      ui.toast(`${name}朝腳架過來了！快回去攔住。`, 'warn', 3500);
      go();
      return;
    }
    if (bench.mode) bench.exit(false);
    const onRoad = Math.abs(lead.g.position.x + 9.2) < 2;
    playBossIntro(this.h.app, { subject: lead.g, target, eye: lead.kind === 'dog' ? 0.45 : lead.kind === 'kid' ? 0.95 : 1.55, name, sub, tagline, camDir: onRoad ? new THREE.Vector3(0, 0, -1) : undefined }, go);
  }

  // ---------------------------------------------------------------- 存檔
  snapshot(): AnyObj {
    return {
      time: this.time, uncleChoice: this.uncleChoice, uncleTimer: this.uncleTimer, teaTimer: this.teaTimer,
      bumpDone: this.bumpDone, ownerDone: this.ownerDone, auntieDone: this.auntieDone, callTimer: this.callTimer, callDone: this.callDone,
      blockedUntil: this.blockedUntil, blockedWhy: this.blockedWhy, bumps: this.bumps, tiltTarget: this.tiltTarget,
      dogOutcome: this.dogOutcome, kidsOutcome: this.kidsOutcome,
      policeTimer: this.policeTimer, policeDone: this.policeDone, policeArgued: this.policeArgued,
      policeCar: this.policeCar && this.policeCar.stage !== 'gone' ? { stage: this.policeCar.stage } : null,
      actors: this.actors.map(a => ({ kind: a.kind, x: a.g.position.x, z: a.g.position.z, state: a.state, t: a.t })),
    };
  }

  restore(s: AnyObj, phase: string) {
    this.reset();
    const keys = ['time', 'uncleChoice', 'uncleTimer', 'teaTimer', 'bumpDone', 'ownerDone', 'auntieDone', 'callTimer', 'callDone', 'blockedUntil', 'blockedWhy', 'bumps', 'tiltTarget', 'dogOutcome', 'kidsOutcome', 'policeTimer', 'policeDone', 'policeArgued'];
    keys.forEach(k => { if (s[k] !== undefined) (this as AnyObj)[k] = s[k]; });
    let firstKid = true;
    (s.actors || []).forEach((o: AnyObj) => {
      if (o.state === 'leave') return;
      const a = this.spawn(o.kind, o.x, o.z);
      a.t = o.t || 0;
      // 對話中、拍照中、登場運鏡中的狀態不能原樣還原：改成「再來一次」
      const map: Record<string, string> = { talk: 'wait', photo: 'leave', qte: 'rush', stopped: 'leave', listen: 'leave' };
      if (o.kind === 'police' && !s.policeCar) return;
      let st = map[o.state] || o.state;
      if (st === 'intro') st = o.kind === 'uncle' ? 'lean' : 'rush';
      if (o.kind === 'kid' && (st === 'rush' || st === 'follow')) { st = firstKid ? 'rush' : 'follow'; firstKid = false; }
      a.state = st;
    });
    // 警車：還在路上或已停好 → 直接停在現場；正在離開 → 當作已經開走
    if (s.policeCar && ['come', 'parked'].includes(s.policeCar.stage)) {
      const sm = this.h.app.sceneManager;
      this.policeCar = new PoliceCar(sm.scene, (x, z) => sm.heightAt(x, z));
      this.policeCar.parkNow();
      const cop = this.actors.find(a => a.kind === 'police');
      if (cop && (cop.state === 'back' || cop.state === 'back2')) { this.remove(cop); this.policeCar.leave(); }
    }
    if (phase === 'packup' && !this.auntieDone && !this.actors.some(a => a.kind === 'auntie')) setTimeout(() => this.spawnAuntie(), 6000);
  }

  /** 腳架剛架好 */
  onTripodSet() { this.uncleTimer = 8; }

  /** 進入收工階段 */
  onPackup() { if (!this.auntieDone) setTimeout(() => this.spawnAuntie(), 6000); }

  /** 進入回程 */
  onReturn() { if (this.uncleChoice === 'secret' && !this.callDone) this.callTimer = 10; }

  /** 儀器操作是否被事件擋住 (回傳原因) */
  blockedReason(): string | null {
    const left = Math.ceil(this.blockedUntil - this.time);
    if (left > 9999) return this.blockedWhy;
    if (left > 0) return `${this.blockedWhy}（還要等 ${left} 秒）`;
    const busy = this.actors.find(a => ['owner', 'chief'].includes(a.kind) && a.state !== 'leave');
    if (busy) return busy.kind === 'chief' ? '里長走過來了，先跟他說明。' : '有人朝你走過來了，先處理一下。';
    return null;
  }

  // ----------------------------------------------------------------
  private spawn(kind: Kind, x: number, z: number): Actor {
    let g: THREE.Group;
    if (kind === 'dog') g = buildDog();
    else if (kind === 'kid') { g = buildPerson({ shirt: 0xfbc02d, pants: 0x1e3a5f, hat: 'cap' }); g.scale.setScalar(0.66); }
    else if (kind === 'owner') g = buildPerson({ shirt: 0x8d6e63, pants: 0x37474f, hat: 'straw', skin: 0xa86f45 });
    else if (kind === 'chief') g = buildPerson({ shirt: 0xeeeeee, pants: 0x263238, hat: null, skin: 0xc28a62 });
    else if (kind === 'police') g = buildPerson({ shirt: 0x9cc3e6, pants: 0x1a2a4a, hat: 'police', skin: 0xc68a5e });
    else if (kind === 'auntie') g = buildPerson({ shirt: 0xe91e63, pants: 0x4a148c, hat: 'helmet', skin: 0xd09a72 });
    else g = buildPerson({ shirt: 0x7cb342, pants: 0x5d4037, hat: 'straw', skin: 0xb07850 });
    const sm = this.h.app.sceneManager;
    g.position.set(x, sm.heightAt(x, z), z);
    g.userData.type = 'npc';
    g.userData.npc = kind;
    sm.scene.add(g);
    const a: Actor = { kind, g, state: 'walkIn', t: 0 };
    this.actors.push(a);
    if (!sm.interactiveObjects.includes(g)) sm.interactiveObjects.push(g);
    return a;
  }

  private remove(a: Actor) {
    const sm = this.h.app.sceneManager;
    sm.scene.remove(a.g);
    const i = sm.interactiveObjects.indexOf(a.g); if (i > -1) sm.interactiveObjects.splice(i, 1);
    this.actors = this.actors.filter(x => x !== a);
  }

  private walk(a: Actor, tx: number, tz: number, speed: number, dt: number): boolean {
    const g = a.g;
    const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
    const anim = g.userData.dog ? animateDog : animateWalk;
    if (d < 0.25) { anim(g, a.t, 0); return true; }
    const st = Math.min(d, speed * dt);
    g.position.x += dx / d * st; g.position.z += dz / d * st;
    g.position.y = this.h.app.sceneManager.heightAt(g.position.x, g.position.z);
    g.rotation.y = Math.atan2(-dz, dx);
    anim(g, a.t, speed / 1.5);
    return false;
  }
  private face(a: Actor, x: number, z: number) {
    a.g.rotation.y = Math.atan2(-(z - a.g.position.z), x - a.g.position.x);
    (a.g.userData.dog ? animateDog : animateWalk)(a.g, a.t, 0);
  }

  private canTalk(): boolean {
    const p = this.h.app.player;
    return !p.isModalOpen() && !this.h.inTruck();
  }

  private relock() {
    const p = this.h.app.player;
    const canvas = this.h.app.sceneManager.renderer.domElement;
    if (!p.isModalOpen()) canvas.requestPointerLock?.();
  }

  private gnss(): AnyObj { return this.h.app.levelsMap.gnss; }
  private tripod(): THREE.Object3D | null { return this.gnss()?.tripodMesh || null; }

  // ----------------------------------------------------------------
  update(dt: number) {
    this.time += dt;
    const p = this.h.playerPos();
    const ph = this.h.phase();
    const g = this.gnss();

    // 阿伯出場
    if (this.uncleTimer > 0) { this.uncleTimer -= dt; if (this.uncleTimer <= 0) this.spawn('uncle', 9, 24); }
    // 阿伯端茶回來
    if (this.teaTimer > 0) { this.teaTimer -= dt; if (this.teaTimer <= 0) { const a = this.spawn('uncle', 9, 24); a.state = 'tea'; } }
    // 定心定平完成 → 碰腳架事件
    if (ph === 'observe' && g && g.currentStep >= 2 && !this.bumpDone && !this.actors.some(a => ['kid', 'dog'].includes(a.kind))) {
      this.bumpDone = true;
      if (this.uncleChoice === 'ignore' && this.actors.some(a => a.kind === 'uncle')) {
        const u = this.actors.find(a => a.kind === 'uncle')!;
        this.intro(u, [u], '被你無視的阿伯', '想找個地方靠一下', '他看上你的腳架了……', () => { u.state = 'lean'; });
      } else if (this.forceBump ? this.forceBump === 'dog' : Math.random() < 0.5) {
        // 從產業道路上跑過來 (路面沒有高草，鏡頭看得到)
        const d = this.spawn('dog', -9.2, 30);
        this.intro(d, [d], '土狗　阿黃', '腳架衝撞者', '快跑到腳架前的黃圈擋住牠！', () => { d.state = 'rush'; d.t = 0; });
      } else {
        const k1 = this.spawn('kid', -9.4, 29);
        const k2 = this.spawn('kid', -8.6, 30.2);
        this.intro(k1, [k1, k2], '放學小朋友 ×2', '好奇心　MAX', '「那是什麼？可以摸嗎？」', () => { k1.state = 'rush'; k2.state = 'follow'; k1.t = k2.t = 0; });
      }
    }
    // 量完天線高 → 地主 / 里長
    if (ph === 'observe' && g && g.currentStep >= 3 && !this.ownerDone) {
      this.ownerDone = true;
      this.spawn(this.uncleChoice === 'lie' ? 'chief' : 'owner', -7, 9);
    }
    // 腳架被碰後的傾斜，重新定平後回正
    const t = this.tripod();
    if (t) {
      if (g && g.currentStep >= 2) this.tiltTarget = 0;
      t.rotation.z += (this.tiltTarget - t.rotation.z) * Math.min(1, dt * 8);
    }
    // 組長來電
    if (this.callTimer > 0 && this.h.inTruck()) {
      this.callTimer -= dt;
      if (this.callTimer <= 0) this.ring();
    }

    // 警察
    if (this.policeTimer > 0) {
      this.policeTimer -= dt;
      if (this.policeTimer <= 0) {
        const sm = this.h.app.sceneManager;
        this.policeCar = new PoliceCar(sm.scene, (x, z) => sm.heightAt(x, z));
        ui.toast('遠遠傳來警笛聲……警車來了。', 'warn', 3500);
      }
    }
    if (this.policeCar) {
      const c = this.policeCar;
      c.update(dt, Math.hypot(p.x - c.x, p.z - c.z), this.h.truckPos());
      if (c.stage === 'parked' && !this.policeDone && !this.actors.some(a => a.kind === 'police')) {
        const d = c.doorPos();
        const cop = this.spawn('police', d.x, d.z);
        cop.state = 'exit';
        this.blockedWhy = '警察到場了，先跟警察說明';
      }
      if (c.stage === 'gone') this.policeCar = null;
    }

    for (const a of [...this.actors]) {
      a.t += dt;
      this.step(a, dt, p);
    }

    // 危險警示
    const tp = this.tripod();
    const tpos = tp ? tp.position : CKSV;
    const threats = this.actors
      .filter(a => ((a.kind === 'kid' || a.kind === 'dog') && a.state === 'rush') || (a.kind === 'uncle' && a.state === 'lean'))
      .map(a => ({ obj: a.g, h: a.kind === 'dog' ? 0.9 : a.kind === 'kid' ? 1.4 : 2.0, who: a.kind === 'dog' ? '土狗' : a.kind === 'kid' ? '小朋友' : '阿伯', dist: Math.hypot(a.g.position.x - tpos.x, a.g.position.z - tpos.z) }));
    setThreat(this.h.app, threats);
  }

  private step(a: Actor, dt: number, p: THREE.Vector3) {
    const tp = this.tripod();
    const trip = tp ? tp.position : CKSV;
    switch (a.kind) {
      case 'uncle': return this.stepUncle(a, dt, p, trip);
      case 'kid':
      case 'dog': {
        if (a.state === 'intro') {
          this.face(a, trip.x, trip.z);
        } else if (a.state === 'rush' || a.state === 'follow') {
          const off = a.state === 'follow' ? 0.9 : 0;
          const tx = trip.x + 0.8 + off, tz = trip.z + 0.6;
          if (a.kind === 'kid') {
            // 小朋友跑到玩家身邊 → 自動 QTE
            a.cd = Math.max(0, (a.cd || 0) - dt);
            if (!a.cd && !qteActive() && this.canTalk() && Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 1.8) { this.kidQTE(a); return; }
          }
          if (a.kind === 'dog' && a.state === 'rush') {
            dust.trail(a.g, dt);
            // 腳架前面的站位圈：玩家站進去就擋得住
            const g = this.guardRing();
            if (!g.visible) {
              const d = new THREE.Vector3(a.g.position.x - tx, 0, a.g.position.z - tz).normalize();
              g.show(tx + d.x * 1.8, tz + d.z * 1.8, '站到這裡擋住阿黃！');
            }
            const inRing = !this.h.inTruck() && g.contains(p.x, p.z, 0.15);
            g.update(this.time, inRing);
            if (inRing && Math.hypot(a.g.position.x - g.x, a.g.position.z - g.z) < 2.6) {
              g.hide();
              sfx.thud();
              ui.toast('你擋在腳架前面，阿黃緊急煞車……搖搖尾巴跑走了。', 'good', 3000);
              this.h.addPR(1, '跑到腳架前擋住阿黃');
              if (!this.dogOutcome) this.dogOutcome = 'stopped';
              a.state = 'stopped'; a.t = 0;
              return;
            }
          }
          if (this.walk(a, tx, tz, a.kind === 'dog' ? 5.2 : 1.7, dt)) {
            if (a.kind === 'dog') this.guard?.hide();
            if (a.state === 'rush') {
              if (a.kind === 'dog') this.dogOutcome = 'bumped'; else this.kidsOutcome = 'bumped';
              this.bump(a.kind === 'dog' ? '土狗撞到腳架' : '小朋友摸了腳架'); a.state = 'linger'; a.t = 0;
            }
            else { a.state = 'linger'; a.t = 0; }
          }
        } else if (a.state === 'listen') {
          this.face(a, p.x, p.z);
        } else if (a.state === 'stopped') {
          this.face(a, p.x, p.z);
          if (a.t > 0.8) { a.state = 'leave'; a.t = 0; }
        } else if (a.state === 'linger') {
          this.face(a, trip.x, trip.z);
          if (a.t > (a.kind === 'dog' ? 2 : 4)) { a.state = 'leave'; a.t = 0; }
        } else if (a.state === 'leave') {
          if (this.walk(a, 12, 30, a.kind === 'dog' ? 3.5 : 1.8, dt)) this.remove(a);
        }
        return;
      }
      case 'owner':
      case 'chief': {
        if (a.state === 'walkIn') {
          if (this.walk(a, p.x - 1.4, p.z + 1.4, 1.5, dt) || Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 2.2) a.state = 'wait';
        } else if (a.state === 'wait') {
          this.face(a, p.x, p.z);
          if (this.canTalk()) { a.state = 'talk'; this.talkOwner(a); }
        } else if (a.state === 'stay') {
          this.face(a, p.x, p.z);
          if (this.time > this.blockedUntil) {
            a.state = 'leave';
            const msg = this.policeDone
              ? (a.kind === 'chief' ? '里長：「好啦，有公文早點拿出來嘛。」' : '地主：「有公文早講嘛……好啦，你們做，不要踩到我的菜。」')
              : (a.kind === 'chief' ? '里長確認完了：「好啦，你們繼續。」' : '地主講完電話：「好啦，你們弄一弄快點。」');
            ui.toast(msg, 'info', 3500);
          }
        } else if (a.state === 'leave') {
          if (this.walk(a, -12, 30, 1.4, dt)) this.remove(a);
        }
        return;
      }
      case 'police': return this.stepPolice(a, dt, p);
      case 'auntie': {
        if (a.state === 'walkIn') {
          if (this.walk(a, p.x + 1.5, p.z - 1.2, 1.5, dt) || Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 2.2) a.state = 'wait';
        } else if (a.state === 'wait') {
          this.face(a, p.x, p.z);
          if (this.canTalk()) { a.state = 'talk'; this.talkAuntie(a); }
        } else if (a.state === 'leave') {
          if (this.walk(a, -9, 30, 1.5, dt)) this.remove(a);
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- 阿伯
  private stepUncle(a: Actor, dt: number, p: THREE.Vector3, trip: THREE.Vector3) {
    if (a.state === 'walkIn' || a.state === 'tea') {
      const near = Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 2.2;
      if (this.walk(a, p.x + 1.6, p.z + 1.6, 1.7, dt) || near) a.state = a.state === 'tea' ? 'teaWait' : 'wait';
    } else if (a.state === 'wait' || a.state === 'teaWait') {
      this.face(a, p.x, p.z);
      if (!this.canTalk()) return;
      if (a.state === 'teaWait') { a.state = 'talk'; this.talkTea(a); } else { a.state = 'talk'; this.talkUncle(a); }
    } else if (a.state === 'photo') {
      // 拿手機拍照：一直對著玩家
      a.g.rotation.y = Math.atan2(-(p.z - a.g.position.z), p.x - a.g.position.x);
    } else if (a.state === 'stay') {
      this.face(a, p.x, p.z);
      if (a.t > 45 && this.bumpDone) { a.state = 'leave'; a.t = 0; }
    } else if (a.state === 'lean') {
      // 阿伯慢慢走到腳架旁邊靠上去
      if (this.walk(a, trip.x - 0.7, trip.z + 0.5, 0.9, dt)) { this.bump('阿伯靠到腳架上'); a.state = 'leaned'; a.t = 0; }
    } else if (a.state === 'leaned') {
      this.face(a, trip.x, trip.z);
      if (a.t > 8) { a.state = 'leave'; a.t = 0; }
    } else if (a.state === 'leave') {
      if (this.walk(a, -30, ROAD_Z - 4, a.t < 3 && this.uncleChoice === 'lie' ? 2.6 : 1.3, dt)) this.remove(a);
    }
  }

  private talkUncle(a: Actor) {
    ui.faceSpeaker(a.g);
    const bag = this.h.toolbagNear();
    ui.showDialog('路過的阿伯', '少年欸，恁佇遮測啥？是毋是欲徵收？<br><small>（年輕人，你們在這裡測什麼？是不是要徵收啊？）</small>', [
      { id: 'explain', text: '阿伯，這是控制點檢測，在更新地圖座標，跟徵收沒有關係。', reply: '喔～原來是按呢。少年欸辛苦啦，等一下來喝茶！', score: 4, tag: '說明清楚，阿伯說要請喝茶' },
      { id: 'order', text: '（從工具袋拿出派工單給阿伯看）', reply: '喔，有公文喔！國土測繪……好啦好啦，我就放心了。', score: 5, tag: '拿派工單給阿伯看，阿伯很放心', disabled: bag ? undefined : '工具袋不在身邊' },
      { id: 'lie', text: '對啊，這邊以後要開高速公路。', reply: '蝦米！我來去叫里長！（阿伯急急忙忙地走了）', score: -4, tag: '亂講要開路，阿伯去叫里長' },
      { id: 'secret', text: '這是國家機密，不能說。', reply: '……（阿伯拿出手機開始拍你）', score: -2, tag: '說是國家機密，被阿伯拍照' },
      { id: 'ignore', text: '（假裝沒聽到，繼續操作）', reply: '……（阿伯在旁邊站著，看你看了很久）', score: 0, tag: '假裝沒聽到，阿伯一直站在旁邊' },
    ], (o) => {
      this.uncleChoice = (o.id || '') as UncleChoice;
      this.h.addPR(o.score, o.tag);
      a.state = o.id === 'ignore' ? 'stay' : o.id === 'secret' ? 'photo' : 'leave';
      a.t = 0;
      if (o.id === 'secret') phonePhoto(this.h.app.sceneManager.scene, a.g, 3, () => { a.state = 'leave'; a.t = 0; });
      if (o.id === 'explain') this.teaTimer = 40;
      this.relock();
    });
  }

  private talkTea(a: Actor) {
    ui.faceSpeaker(a.g);
    ui.showDialog('阿伯（端著茶）', '來來來，天氣遮熱，啉一杯茶啦！<br><small>（天氣這麼熱，喝杯茶吧！）</small>', [
      { text: '謝謝阿伯！', reply: '（冰涼的烏龍茶，整個人活過來了。）', score: 1, tag: '阿伯請喝茶' },
      { text: '不好意思，工作中不方便……', reply: '哎唷，客氣啥，啉啦！（阿伯硬把茶塞給你）', score: 1, tag: '阿伯硬塞了一杯茶' },
    ], (o) => {
      this.h.hydrate(100, '阿伯的茶');
      this.h.addPR(o.score, o.tag);
      a.state = 'leave'; a.t = 0;
      this.relock();
    });
  }

  // ---------------------------------------------------------------- 地主 / 里長 (出示公文)
  private talkOwner(a: Actor) {
    ui.faceSpeaker(a.g);
    const bag = this.h.toolbagNear();
    const chief = a.kind === 'chief';
    const speaker = chief ? '里長' : '田的主人';
    const line = chief
      ? '我是這裡的里長。阿伯說你們要在這裡開高速公路？誰准的？'
      : '欸！這我的田，恁是啥人？啥人准恁入來的？<br><small>（這是我的田，你們是誰？誰准你們進來的？）</small>';
    ui.showDialog(speaker, line, [
      { id: 'doc', text: '（從工具袋拿出公文）我們是受託做控制點檢測，這是公文。', disabled: bag ? undefined : '工具袋不在身邊',
        reply: chief ? '……喔，控制點檢測。那剛剛跟阿伯講的是怎樣？下次不要亂講話！' : '公文我看一下……國土測繪的喔。好啦，你們做，不要踩到我的菜。',
        score: chief ? 1 : 4, tag: chief ? '出示公文向里長澄清（被唸了一頓）' : '出示公文，地主同意繼續' },
      { id: 'talk', text: '我們在做控制點檢測，很快就好。',
        reply: chief ? '口說無憑，我打電話問一下區公所。你們先停一下。' : '我不管，我打電話問一下，你們先停著。',
        score: -2, tag: chief ? '口頭說明，里長打電話查證，停工等待' : '口頭說明，地主打電話查證，停工等待' },
      { id: 'sorry', text: '不好意思打擾了，我們盡快弄完。',
        reply: chief ? '……快一點啦。' : '好啦快點，不要踩到我的菜。',
        score: chief ? -1 : 1, tag: chief ? '道歉了事，里長不太高興' : '道歉並加快，地主勉強同意' },
      { id: 'argue', text: '這是國家的控制點，你管不著。',
        reply: chief ? '好，那我叫警察來。' : '好喔，那我叫警察。',
        score: -5, tag: chief ? '頂撞里長，對方叫警察，停工很久' : '頂撞地主，對方叫警察，停工很久' },
    ], (o) => {
      this.h.addPR(o.score, o.tag);
      if (o.id === 'talk') { this.blockedUntil = this.time + 20; this.blockedWhy = `${speaker}在打電話查證`; a.state = 'stay'; }
      else if (o.id === 'argue') { a.state = 'stay'; this.callPolice(chief ? '里長' : '地主', 7); }
      else { a.state = 'leave'; a.t = 0; }
      this.relock();
    });
  }

  // ---------------------------------------------------------------- 警察
  private callPolice(who: string, delay: number) {
    this.policeDone = this.policeArgued = false;
    this.blockedUntil = this.time + 1e6;
    this.blockedWhy = `${who}報警了，等警察到場釐清`;
    this.policeTimer = delay;
    ui.toast(`${who}拿起手機：「喂，110 嗎？這裡有人……」`, 'warn', 3500);
  }

  private stepPolice(a: Actor, dt: number, p: THREE.Vector3) {
    const car = this.policeCar;
    if (a.state === 'exit') {
      // 下車，先繞到車頭前
      if (!car) { a.state = 'walkIn'; return; }
      const f = car.frontPos();
      if (this.walk(a, f.x, f.z, 1.6, dt)) a.state = 'walkIn';
    } else if (a.state === 'walkIn') {
      if (this.walk(a, p.x + 1.3, p.z - 1.3, 1.6, dt) || Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 2.2) a.state = 'wait';
    } else if (a.state === 'wait') {
      this.face(a, p.x, p.z);
      if (this.canTalk()) { a.state = 'talk'; this.talkPolice(a); }
    } else if (a.state === 'waitDoc') {
      this.face(a, p.x, p.z);
    } else if (a.state === 'notes') {
      this.face(a, p.x, p.z);
      if (this.time > this.blockedUntil) { a.state = 'back'; a.t = 0; ui.toast('警察：「好，筆錄做完了。下次講話客氣一點。」', 'info', 3000); }
    } else if (a.state === 'back' || a.state === 'back2') {
      if (!car) { this.remove(a); return; }
      if (a.state === 'back') { const f = car.frontPos(); if (this.walk(a, f.x, f.z, 1.6, dt)) a.state = 'back2'; return; }
      const d = car.doorPos();
      if (this.walk(a, d.x, d.z, 1.6, dt)) { this.remove(a); car.leave(); ui.toast('警察回到車上，開走了。', 'info', 2500); }
    }
  }

  private policeWho(): { name: string; call: string } {
    const chief = this.actors.some(x => x.kind === 'chief') || this.uncleChoice === 'lie';
    return chief ? { name: '里長', call: '里長' } : { name: '地主', call: '阿伯' };
  }

  private talkPolice(a: Actor) {
    ui.faceSpeaker(a.g);
    const w = this.policeWho();
    const bag = this.h.toolbagNear();
    ui.showDialog('派出所警員', `（警察看了看${w.name}，又看了看你）<br>我們接到報案，說有人擅自進來，還跟${w.name}起衝突。你們是做什麼的？`, [
      { id: 'doc', text: '（從工具袋拿出公文）長官，我們受託做控制點檢測，這是公文。', disabled: bag ? undefined : '工具袋不在身邊',
        reply: `（警察仔細看了公文）……國土測繪的委託案，沒問題。<br>${w.call}，他們是合法作業啦。<br>少年欸，有公文一開始就拿出來，好好講就不用叫到我們了。`,
        score: 2, tag: '警察到場，出示公文釐清' },
      { id: 'sorry', text: `不好意思，剛剛是我講話太衝了。我們是做控制點檢測的。`,
        reply: '知道就好。那有公文嗎？拿出來給我跟人家看一下。', score: 1, tag: `向警察和${w.name}道歉` },
      { id: 'talk', text: '我們是公家單位委託的，公文……在工具袋裡。',
        reply: '那去拿來，我在這邊等。', score: 0, tag: '警察到場，公文沒帶在身上' },
      { id: 'argue', text: '我在執行公務，你們警察管不著吧？',
        reply: '……先生，請你配合。證件拿出來，等一下要做筆錄。', score: -4, tag: '頂撞警察，被做筆錄' },
    ], (o) => {
      this.h.addPR(o.score, o.tag);
      if (o.id === 'argue') this.policeArgued = true;
      if (o.id === 'doc') this.policeResolve(a);
      else this.policeNeedDoc(a);
    });
  }

  private policeNeedDoc(a: Actor) {
    if (!this.h.toolbagNear()) {
      a.state = 'waitDoc';
      this.blockedWhy = '警察在等你出示公文';
      ui.toast('公文在工具袋裡。把工具袋拿過來，再對警察按 E。', 'warn', 4000);
      this.relock();
      return;
    }
    a.state = 'talk';
    ui.faceSpeaker(a.g);
    const w = this.policeWho();
    ui.showDialog('派出所警員', '公文給我看一下。', [
      { text: '（從工具袋拿出公文）', reply: `（警察看了公文）……好，國土測繪的委託案，沒問題。<br>${w.call}，他們是合法作業，讓他們做完吧。`, score: 1, tag: '向警察出示公文' },
    ], (o) => { this.h.addPR(o.score, o.tag); this.policeResolve(a); });
  }

  private policeResolve(a: Actor) {
    this.policeDone = true;
    if (this.policeArgued) {
      this.blockedUntil = this.time + 30;
      this.blockedWhy = '警察在幫你做筆錄';
      a.state = 'notes'; a.t = 0;
      ui.toast('警察拿出筆記本：「姓名、身分證字號、服務單位……」', 'warn', 3500);
    } else {
      this.blockedUntil = this.time;
      a.state = 'back'; a.t = 0;
    }
    this.relock();
  }

  /** 警車的碰撞範圍 (玩家、作業車) */
  bodies(): { x: number; z: number; r: number }[] {
    const c = this.policeCar;
    if (!c) return [];
    const fx = Math.cos(c.heading), fz = -Math.sin(c.heading);
    return [-1.3, 0, 1.3].map(k => ({ x: c.x + fx * k, z: c.z + fz * k, r: 1.0 }));
  }

  // ---------------------------------------------------------------- 阿姨 (地界)
  private spawnAuntie() {
    if (this.auntieDone || this.h.phase() !== 'packup') return;
    this.auntieDone = true;
    this.spawn('auntie', -9, 26);
  }

  private talkAuntie(a: Actor) {
    ui.faceSpeaker(a.g);
    ui.showDialog('騎車經過的阿姨', '少年仔，恁會曉測量喔？阮兜彼塊地的地界，你順紲共我看一下好無？<br><small>（你們會測量喔？我家那塊地的界線，順便幫我看一下好不好？）</small>', [
      { text: '阿姨，地界要到地政事務所申請鑑界，我們不能私下看喔。', reply: '喔～要去地政事務所喔，好啦我明天去問。', score: 3, tag: '告訴阿姨要申請鑑界' },
      { text: '好啊，我幫妳看一下。', reply: '（結果跟著阿姨走了半小時，還被留下來吃午餐。）', score: -2, tag: '私下幫阿姨看地界（不該這樣做）' },
      { text: '不行，我們很忙。', reply: '……啊無就好。（阿姨不太高興地騎走了）', score: -1, tag: '直接拒絕阿姨' },
    ], (o) => {
      this.h.addPR(o.score, o.tag);
      a.state = 'leave'; a.t = 0;
      this.relock();
    });
  }

  // ---------------------------------------------------------------- 組長來電
  private ringing = false;
  private ring() {
    if (this.callDone || this.ringing) return;
    this.ringing = true;
    this.h.radioPause();
    sfx.phoneRing();
    const tryAnswer = () => {
      if (Math.abs(this.h.truckSpeed()) > 0.6) {
        ui.toast('電話響了（組長）……先靠邊停車再接（Space 停車）。', 'warn', 2200);
        sfx.phoneRing();
        setTimeout(tryAnswer, 2600);
        return;
      }
      ui.showDialog('組長（來電）', '你知道你被 PO 上地方社團了嗎？「測量員說是國家機密」，下面留言兩百多則……', [
        { text: '對不起，下次會好好跟民眾說明。', reply: '……嗯，回來再說。下次遇到民眾，派工單拿出來給人家看就好。', score: 1, tag: '組長來電：道歉' },
        { text: '那是阿伯自己亂 PO 的。', reply: '……回來寫一份檢討。', score: -2, tag: '組長來電：推給阿伯，要寫檢討' },
        { text: '有沒有很紅？', reply: '…………（組長直接掛電話）', score: -1, tag: '組長來電：問有沒有很紅' },
      ], (o) => {
        this.callDone = true;
        this.ringing = false;
        this.h.addPR(o.score, o.tag);
        this.h.radioResume();
      });
    };
    setTimeout(tryAnswer, 1200);
  }

  // ---------------------------------------------------------------- 碰腳架
  private bump(cause: string) {
    const g = this.gnss();
    if (!g || g.currentStep < 2) return;
    if (bench.mode) bench.exit(false);
    g.currentStep = 1;
    g.isLeveled = false;
    g.isCentered = false;
    const r = () => (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3);
    if (typeof g.screwA === 'number') { g.screwA += r(); g.screwB += r(); g.screwC += r(); }
    if (typeof g.shiftX === 'number') { g.shiftX += r() * 0.6; g.shiftY += r() * 0.6; }
    this.tiltTarget = 0.035;
    this.bumps.push(cause);
    sfx.thud();
    ui.toast(`${cause}！腳架歪了，要重新定心定平。`, 'bad', 4000);
    this.h.app.updateMissionPanel(g.title, g.getTasks(), 1, '腳架被碰歪了。回到儀器按 E 重新定心定平。');
  }

  // ---------------------------------------------------------------- 準心互動
  promptFor(o: THREE.Object3D): string | null {
    const a = this.actors.find(x => x.g === o);
    if (!a) return null;
    if (a.kind === 'uncle' && (a.state === 'stay' || a.state === 'lean')) return '請阿伯往後退一點';
    if (a.kind === 'police' && a.state === 'waitDoc') return this.h.toolbagNear() ? '出示公文' : '出示公文（工具袋不在身邊）';
    return null;
  }

  interact(o: THREE.Object3D) {
    const a = this.actors.find(x => x.g === o);
    if (!a) return;
    if (a.kind === 'dog' || a.kind === 'kid') {
      return; // 狗：跑到圈圈裡擋；小朋友：靠近自動 QTE
    } else if (a.kind === 'police') {
      if (a.state !== 'waitDoc') return;
      if (!this.h.toolbagNear()) { ui.toast('公文在工具袋裡，先去把工具袋拿過來。', 'warn', 2500); return; }
      this.policeNeedDoc(a);
    } else if (a.kind === 'uncle') {
      ui.toast('「阿伯，不好意思，腳架很敏感，請往後退一點。」阿伯：「喔喔，歹勢！」', 'good', 3200);
      a.state = 'leave'; a.t = 0;
      this.h.addPR(1, '請阿伯離腳架遠一點');
    }
  }

  private guardRing(): GroundRing {
    if (!this.guard) { const sm = this.h.app.sceneManager; this.guard = new GroundRing(sm.scene, (x, z) => sm.heightAt(x, z), 0xffc83d, 0.9); }
    return this.guard;
  }

  /** 小朋友跑到身邊：QTE 擋下來 */
  private kidQTE(a: Actor) {
    if (qteActive()) return;
    const kids = this.actors.filter(x => x.kind === 'kid');
    const prev = kids.map(k => k.state);
    kids.forEach(k => { k.state = 'qte'; });
    ui.faceSpeaker(a.g);
    const pool = ['可是我想看嘛！', '一下下就好～拜託～', '那我可以按那個按鈕嗎？', '為什麼不行？為什麼？為什麼？', '我媽說我可以！', '哥哥小氣！'];
    const lines = pool.sort(() => Math.random() - 0.5).slice(0, 4);
    runQTE({
      speaker: '放學的小朋友（很盧）', lines, onDone: (ok) => {
        if (!ok) {
          // 被鑽過去了：繼續往腳架衝，往前多跑一步；一下子內不會再觸發
          const tp = this.tripod();
          kids.forEach((k, i) => {
            k.state = prev[i] === 'follow' ? 'follow' : 'rush';
            k.cd = 2.5;
            if (tp) { const d = new THREE.Vector3(tp.position.x - k.g.position.x, 0, tp.position.z - k.g.position.z); const L = d.length(); if (L > 1.6) k.g.position.addScaledVector(d.normalize(), 1.2); }
          });
          ui.toast('小朋友從你旁邊鑽過去了！快追上去擋住他們！', 'bad', 3000);
          this.relock();
          return;
        }
        this.kidQuiet(a);
      },
    });
  }

  /** QTE 成功：小朋友終於停下來聽你說 */
  private kidQuiet(a: Actor) {
    {
      this.h.addPR(1, '耐心擋下很盧的小朋友');
      // 先站著聽你說，講完才走
      this.actors.filter(x => x.kind === 'kid').forEach(k => { k.state = 'listen'; k.t = 0; });
      if (!this.kidsOutcome) this.kidsOutcome = 'stopped';
      ui.faceSpeaker(a.g);
      ui.showDialog('放學的小朋友', '哥哥你在做什麼？那是相機嗎？可以拍我嗎？', [
        { text: '這是衛星定位的儀器，在量這個點的位置。很貴，不能碰喔！', reply: '哇～好酷！那我不碰。掰掰！', score: 2, tag: '跟小朋友解釋儀器，小朋友沒碰' },
        { text: '走開走開，不要在這裡玩。', reply: '……（小朋友嘟著嘴跑掉了）', score: 0, tag: '把小朋友趕走' },
      ], (opt) => { this.h.addPR(opt.score, opt.tag); this.actors.filter(x => x.kind === 'kid').forEach(k => { k.state = 'leave'; k.t = 0; }); this.relock(); });
    }
  }

  obstacles(): { x: number; z: number; r: number; tag: string }[] {
    return [
      ...this.actors.map(a => ({ x: a.g.position.x, z: a.g.position.z, r: a.kind === 'dog' ? 0.4 : 0.5, tag: a.kind === 'dog' ? '狗' : a.kind === 'kid' ? '小朋友' : a.kind === 'police' ? '警察' : '路人' })),
      ...this.bodies().map(b => ({ ...b, tag: '警車' })),
    ];
  }
}
