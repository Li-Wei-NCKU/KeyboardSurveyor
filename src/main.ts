// 進入點：依序載入相容墊片、樣式、舊版模組，最後是新系統
import './globals';
import './styles/style.css';

import './legacy/audio.js';
import './legacy/models.js';
import './legacy/scene.js';
import './legacy/player.js';
import './legacy/levels/level_gnss.js';
import './legacy/levels/level_leveling.js';
import './legacy/levels/level_gcp.js';
import './legacy/levels/level_uav.js';
import './legacy/levels/level_select.js';
import './legacy/main.js';

// 新系統 (TypeScript)
import './styles/field.css';
import './field/index';
