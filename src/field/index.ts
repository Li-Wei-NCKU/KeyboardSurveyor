/**
 * 新系統掛載點：舊版 SurveyorGameApp 建好後呼叫 window.onGameAppReady(app)
 */
import type * as THREE from 'three';
import type { GameApp, AnyObj } from './legacy';
import { FieldDay } from './fieldDay';
import { showMainMenu, setFaceHook } from './ui';
import { faceObject } from './look';
import { bench } from './bench';
import { JOBS, loadProgress, type JobId } from './jobs';
import { installDebug } from './debug';
import { installSaveLoad } from './saveload';
import { openAudioPanel, closeAudioPanel } from './sound';

(window as AnyObj).onGameAppReady = (app: GameApp) => {
  bench.install(app);
  const field = new FieldDay(app);
  app.levelsMap.field = field;

  // 聲音設定：M 鍵或右上角按鈕
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) {
      if (document.querySelector('.qte, .rodhold, .scope')) return;
      e.preventDefault(); e.stopPropagation(); openAudioPanel();
    } else if (e.code === 'Escape' && document.getElementById('audio-panel')) { e.stopPropagation(); closeAudioPanel(); }
  }, true);
  document.getElementById('btn-audio-settings')?.addEventListener('click', (e) => { e.stopPropagation(); openAudioPanel(); });
  window.addEventListener('ks-audio', () => openAudioPanel());

  app.onExtraKey = (e: KeyboardEvent) => {
    if (app.currentLevelObj === field) return field.onKey(e);
    return false;
  };

  const menu = () => {
    app.closeAllModals();
    const pr = loadProgress();
    showMainMenu([
      { id: 'gnss', name: JOBS.gnss.menuName, desc: JOBS.gnss.menuDesc, done: pr.day1Done },
      { id: 'level', name: JOBS.level.menuName, desc: JOBS.level.menuDesc, done: pr.day2Done, locked: pr.day1Done ? undefined : '完成第一天後解鎖' },
    ], (id) => { field.job = id as JobId; app.loadLevel('field'); });
  };
  (window as AnyObj).__showMainMenu = menu;
  installDebug(app, field, menu);
  installSaveLoad(app, field);
  setFaceHook((o) => faceObject(app, o as THREE.Object3D));

  // 背景先載入 CKSV 場景當主選單背景 (練習模式已移除)
  app.loadLevel('gnss');
  menu();
};
