// ============================================================
//  スイッチングアクション プロトタイプ
//  移動(歩き) ＋ ジャンプ ＋ 銃で撃つ ＋ グール突進＋当たり判定
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const VW = 480, VH = 270;
const GROUND_Y = VH - 24;
const GRAVITY = 950;        // 重力(px/秒^2)
const JUMP_V = -355;        // ジャンプ初速(上向き)

let scale = 1, offX = 0, offY = 0;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w; canvas.height = h;
  scale = Math.min(w / VW, h / VH);
  offX = (w - VW * scale) / 2;
  offY = (h - VH * scale) / 2;
}
window.addEventListener('resize', resize);
resize();

// ---- スプライト読み込み ----------------------------------
const sprites = {};
function loadImage(name, src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { sprites[name] = img; resolve(); };
    img.onerror = () => reject(new Error('読み込み失敗: ' + src));
    img.src = src;
  });
}

const ANIM = {
  m_idle:  { img: 'm_idle',  fw: 77,  fh: 140, frames: 5, fps: 7 },
  m_walk:  { img: 'm_walk',  fw: 106, fh: 130, frames: 5, fps: 10 },
  m_jump:  { img: 'm_jump',  fw: 115, fh: 134, frames: 2, fps: 1 },
  m_shoot: { img: 'm_shoot', fw: 194, fh: 123, frames: 4, fps: 14 },
  g_walk:  { img: 'g_walk',  fw: 113, fh: 153, frames: 5, fps: 8 },
  g_down:  { img: 'g_down',  fw: 128, fh: 126, frames: 1, fps: 1 },
};

// ---- 状態 -------------------------------------------------
const player = {
  x: 80, y: GROUND_Y, vy: 0, onGround: true,
  facing: 1, speed: 95, moving: false,
  hp: 5, maxHp: 5,
  state: 'idle', stateTime: 0,
  shootCooldown: 0, invuln: 0,
};
const bullets = [];
const ghouls = [];
let crates = [];      // 壊せる木箱 {x, hp, alive}
let items = [];       // ドロップ品(おにぎり=HP回復) {x, y, vy, alive}
let holes = [];       // 落とし穴 {x, w}
let spawnTimer = 1.0;
let gameOver = false;

function setupStage() {
  crates.length = 0; crates.push({ x: 200, hp: 2, alive: true });
  items.length = 0;
  holes.length = 0; holes.push({ x: 330, w: 54 });   // ジャンプで越える穴
}

function reset() {
  player.hp = player.maxHp; player.x = 80; player.y = GROUND_Y;
  player.vy = 0; player.onGround = true; player.facing = 1;
  player.state = 'idle'; player.invuln = 0; player.shootCooldown = 0;
  bullets.length = 0; ghouls.length = 0;
  setupStage();
  spawnTimer = 1.0; gameOver = false;
}

// ---- 入力 -------------------------------------------------
const keys = {};
addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.key === ' ' || e.key === 'z' || e.key === 'Z' || e.key === 'ArrowUp') e.preventDefault();
  if (gameOver) reset();
});
addEventListener('keyup', e => { keys[e.key] = false; });

const btn = { left: false, right: false, jump: false, shoot: false };
function bindButton(id, name) {
  const el = document.getElementById(id);
  if (!el) return;
  const set = v => e => { e.preventDefault(); btn[name] = v; if (v && gameOver) reset(); };
  el.addEventListener('touchstart', set(true),  { passive: false });
  el.addEventListener('touchend',   set(false), { passive: false });
  el.addEventListener('touchcancel',set(false), { passive: false });
  el.addEventListener('mousedown',  set(true));
  el.addEventListener('mouseup',    set(false));
  el.addEventListener('mouseleave', set(false));
}
bindButton('bLeft', 'left');
bindButton('bRight', 'right');
bindButton('bJump', 'jump');
bindButton('bShoot', 'shoot');

// ---- 攻撃 -------------------------------------------------
function tryShoot() {
  if (player.shootCooldown > 0) return;
  player.state = 'shoot'; player.stateTime = 0;
  player.shootCooldown = 0.38;
  bullets.push({
    x: player.x + player.facing * 38,
    y: player.y - (player.onGround ? 96 : 70),  // 空中は少し低い位置から
    vx: player.facing * 330,
    alive: true,
  });
}

// ---- 更新 -------------------------------------------------
let lastTime = 0, animTime = 0;
function update(dt) {
  if (gameOver) return;

  let dir = 0;
  if (keys['ArrowLeft'] || btn.left) dir = -1;
  if (keys['ArrowRight'] || btn.right) dir = 1;
  const jumpPressed = keys[' '] || keys['ArrowUp'] || btn.jump;
  const shootPressed = keys['z'] || keys['Z'] || btn.shoot;

  if (dir !== 0) { player.x += dir * player.speed * dt; player.facing = dir; }
  player.x = Math.max(24, Math.min(VW - 24, player.x));
  player.moving = (dir !== 0);

  // ジャンプ＋重力
  if (jumpPressed && player.onGround) { player.vy = JUMP_V; player.onGround = false; }
  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;
  const onHole = holes.some(h => player.x > h.x && player.x < h.x + h.w);
  if (player.y >= GROUND_Y && !onHole) {
    player.y = GROUND_Y; player.vy = 0; player.onGround = true;
  } else {
    if (player.y < GROUND_Y - 1) player.onGround = false;
    if (player.y > VH + 40) {                 // 穴に落ちた
      player.hp -= 1;
      if (player.hp <= 0) { player.hp = 0; gameOver = true; }
      player.x = Math.max(24, player.x - 44); // 穴の手前へ戻す
      player.y = GROUND_Y; player.vy = 0; player.invuln = 1.0;
    }
  }

  if (shootPressed) tryShoot();
  if (player.shootCooldown > 0) player.shootCooldown -= dt;
  if (player.invuln > 0) player.invuln -= dt;
  player.stateTime += dt;
  if (player.state === 'shoot' && player.stateTime > 0.38) player.state = 'idle';

  for (const b of bullets) {
    b.x += b.vx * dt;
    if (b.x < -20 || b.x > VW + 20) b.alive = false;
  }

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = 2.2 + Math.random() * 1.6;
    ghouls.push({ x: VW + 30, y: GROUND_Y, hp: 2, state: 'walk', t: 0, alive: true });
  }

  for (const g of ghouls) {
    g.t += dt;
    if (g.state === 'walk') {
      g.x -= 44 * dt;
      if (g.x < -40) g.alive = false;
      // 接触ダメージ（プレイヤーが地上付近にいるときだけ＝ジャンプで頭上を回避できる）
      if (Math.abs(g.x - player.x) < 26 && player.y > g.y - 34 && player.invuln <= 0) {
        player.hp -= 1; player.invuln = 1.1;
        if (player.hp <= 0) { player.hp = 0; gameOver = true; }
      }
    } else if (g.state === 'down') {
      if (g.t > 0.7) g.alive = false;
    }
  }

  for (const b of bullets) {
    if (!b.alive) continue;
    for (const g of ghouls) {
      if (g.state !== 'walk') continue;
      if (Math.abs(b.x - g.x) < 34 && Math.abs(b.y - (g.y - 62)) < 64) {
        b.alive = false; g.hp -= 1;
        if (g.hp <= 0) { g.state = 'down'; g.t = 0; }
        break;
      }
    }
  }

  // 弾 vs 木箱
  for (const b of bullets) {
    if (!b.alive) continue;
    for (const c of crates) {
      if (!c.alive) continue;
      if (Math.abs(b.x - c.x) < 28 && b.y > GROUND_Y - 110 && b.y < GROUND_Y) {
        b.alive = false; c.hp -= 1;
        if (c.hp <= 0) { c.alive = false; items.push({ x: c.x, y: GROUND_Y - 24, vy: -150, alive: true }); }
        break;
      }
    }
  }
  // おにぎり（落ちて、拾うとHP回復）
  for (const it of items) {
    it.vy += GRAVITY * dt; it.y += it.vy * dt;
    if (it.y > GROUND_Y - 6) { it.y = GROUND_Y - 6; it.vy = 0; }
    if (Math.abs(it.x - player.x) < 24 && player.y > it.y - 50) {
      it.alive = false;
      player.hp = Math.min(player.maxHp, player.hp + 1);
    }
  }

  for (let i = bullets.length - 1; i >= 0; i--) if (!bullets[i].alive) bullets.splice(i, 1);
  for (let i = ghouls.length - 1; i >= 0; i--) if (!ghouls[i].alive) ghouls.splice(i, 1);
  for (let i = items.length - 1; i >= 0; i--) if (!items[i].alive) items.splice(i, 1);
  for (let i = crates.length - 1; i >= 0; i--) if (!crates[i].alive) crates.splice(i, 1);

  animTime += dt;
}

// ---- 描画 -------------------------------------------------
// frameIndex を渡すとそのコマで固定、無ければ時間でコマ送り
function drawSprite(animName, cx, cy, facing, timeOverride, alpha, frameIndex) {
  const a = ANIM[animName];
  const img = sprites[a.img];
  if (!img) return;
  let frame;
  if (frameIndex != null) frame = frameIndex % a.frames;
  else {
    const tt = (timeOverride != null) ? timeOverride : animTime;
    frame = Math.min(a.frames - 1, Math.floor(tt * a.fps)) % a.frames;
  }
  const sx = frame * a.fw;
  ctx.save();
  if (alpha != null) ctx.globalAlpha = alpha;
  ctx.translate(offX + cx * scale, offY + cy * scale);
  ctx.scale(facing * scale, scale);
  ctx.drawImage(img, sx, 0, a.fw, a.fh, -a.fw / 2, -a.fh, a.fw, a.fh);
  ctx.restore();
}

function drawPlayer() {
  const blink = (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) ? 0.35 : 1;
  if (!player.onGround) {
    drawSprite('m_jump', player.x, player.y, player.facing, null, blink, player.vy < 0 ? 0 : 1);
  } else if (player.state === 'shoot') {
    drawSprite('m_shoot', player.x, player.y, player.facing, player.stateTime, blink);
  } else if (player.moving) {
    drawSprite('m_walk', player.x, player.y, player.facing, null, blink);
  } else {
    drawSprite('m_idle', player.x, player.y, player.facing, null, blink);
  }
}

function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 背景（街並み）。ゲーム領域からはみ出さないよう切り抜く
  ctx.save();
  ctx.beginPath();
  ctx.rect(offX, offY, VW * scale, VH * scale);
  ctx.clip();
  const bg = sprites['bg_day'];
  if (bg) {
    const s = GROUND_Y / bg.height;          // 空の高さに合わせる
    const dw = bg.width * s;
    const dx = (VW - dw) / 2;                 // 横は中央
    ctx.drawImage(bg, offX + dx * scale, offY, dw * scale, GROUND_Y * scale);
  } else {
    const sky = ctx.createLinearGradient(0, offY, 0, offY + GROUND_Y * scale);
    sky.addColorStop(0, '#2b3a66'); sky.addColorStop(1, '#6b7aa6');
    ctx.fillStyle = sky;
    ctx.fillRect(offX, offY, VW * scale, GROUND_Y * scale);
  }
  ctx.restore();
  // 地面
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(offX, offY + GROUND_Y * scale, VW * scale, (VH - GROUND_Y) * scale);
  ctx.fillStyle = '#3c2f20';
  ctx.fillRect(offX, offY + GROUND_Y * scale, VW * scale, 3 * scale);

  // 穴（地面を暗く抜く）
  for (const h of holes) {
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(offX + h.x * scale, offY + GROUND_Y * scale, h.w * scale, (VH - GROUND_Y) * scale);
  }
  // 木箱
  for (const c of crates) {
    const img = sprites['crate']; if (!img) continue;
    const w = 40, ht = 40;
    ctx.drawImage(img, offX + (c.x - w / 2) * scale, offY + (GROUND_Y - ht) * scale, w * scale, ht * scale);
  }
  // おにぎり
  for (const it of items) {
    const img = sprites['onigiri']; if (!img) continue;
    const w = 22, ht = 22;
    ctx.drawImage(img, offX + (it.x - w / 2) * scale, offY + (it.y - ht) * scale, w * scale, ht * scale);
  }

  for (const g of ghouls) {
    if (g.state === 'down') drawSprite('g_down', g.x, g.y, -1);
    else drawSprite('g_walk', g.x, g.y, -1);
  }

  for (const b of bullets) {
    const bx = offX + b.x * scale, by = offY + b.y * scale;
    ctx.save();
    ctx.fillStyle = '#ffd24a';
    ctx.shadowColor = '#ffae00'; ctx.shadowBlur = 8 * scale;
    ctx.beginPath();
    ctx.ellipse(bx, by, 6 * scale, 3 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayer();

  for (let i = 0; i < player.maxHp; i++) {
    ctx.fillStyle = i < player.hp ? '#e8503a' : '#444';
    ctx.fillRect(offX + (8 + i * 15) * scale, offY + 8 * scale, 12 * scale, 12 * scale);
  }

  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(offX, offY, VW * scale, VH * scale);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `${20 * scale}px sans-serif`;
    ctx.fillText('GAME OVER', offX + VW * scale / 2, offY + VH * scale / 2 - 6 * scale);
    ctx.font = `${11 * scale}px sans-serif`;
    ctx.fillText('タップ / キーでリスタート', offX + VW * scale / 2, offY + VH * scale / 2 + 14 * scale);
    ctx.textAlign = 'start';
  }
}

function loop(t) {
  const dt = Math.min((t - lastTime) / 1000, 0.05);
  lastTime = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

Promise.all([
  loadImage('bg_day',  'sprites/background_day.png'),
  loadImage('crate',   'sprites/crate.png'),
  loadImage('onigiri', 'sprites/onigiri.png'),
  loadImage('m_idle',  'sprites/matenrou_idle.png'),
  loadImage('m_walk',  'sprites/matenrou_walk.png'),
  loadImage('m_jump',  'sprites/matenrou_jump.png'),
  loadImage('m_shoot', 'sprites/matenrou_shoot.png'),
  loadImage('g_walk',  'sprites/ghoul_walk.png'),
  loadImage('g_down',  'sprites/ghoul_down.png'),
]).then(() => { setupStage(); requestAnimationFrame(loop); })
  .catch(err => {
    const h = document.getElementById('hint');
    if (h) h.textContent = 'エラー: ' + err.message;
  });
