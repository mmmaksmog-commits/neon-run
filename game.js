// Неон-ран: бесконечный раннер на Canvas 2D.
// Мир считается в «игровых» единицах высотой 400, затем масштабируется под экран.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (s) => document.getElementById(s);

const H = 400;              // высота мира
const GROUND = 330;         // уровень земли
const GRAVITY = 2600;
const JUMP_V = -880;
const START_SPEED = 380;
const MAX_SPEED = 900;
const COLORS = { pink: '#ff2bd6', cyan: '#00f0ff', lime: '#b6ff3b', violet: '#8b5cf6' };

const MIN_W = 500;          // минимум видимой дороги — на вертикальном телефоне камера отдаляется
let W = 800;                // ширина мира (зависит от пропорций экрана)
let scale = 1;
let topPad = 0;             // лишнее место сверху на высоких экранах
let bottom = H;             // нижняя граница видимой области в мировых координатах
let state = 'menu';         // menu | play | paused | over
let last = 0;
let t = 0;

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(`nr_${k}`)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`nr_${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
};
let best = store.get('best', 0);
let soundOn = store.get('sound', true);

// ---------- Звук ----------
let actx;
function beep(f, d, type = 'square', v = 0.05, slide = 0) {
  if (!soundOn) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, actx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, actx.currentTime + d);
    g.gain.setValueAtTime(v, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + d);
  } catch { /* без звука */ }
}
const sfx = {
  jump: () => beep(420, 0.15, 'square', 0.04, 1.8),
  double: () => beep(620, 0.15, 'square', 0.04, 1.8),
  gem: () => { beep(1200, 0.08, 'sine', 0.05); setTimeout(() => beep(1600, 0.1, 'sine', 0.05), 60); },
  hit: () => beep(160, 0.5, 'sawtooth', 0.08, 0.3),
};

// ---------- Мир ----------
const player = { x: 120, y: GROUND, vy: 0, w: 34, h: 44, jumps: 0, onGround: true, trail: [] };
let obstacles = [];
let gems = [];
let particles = [];
let speed = START_SPEED;
let distance = 0;
let gemCount = 0;
let spawnIn = 0;
let shake = 0;

// Силуэты зданий для параллакса (генерируются один раз)
const skyline = [0, 1].map((layer) => Array.from({ length: 40 }, (_, i) => ({
  x: i * (layer ? 70 : 110),
  w: (layer ? 50 : 80) + Math.random() * 40,
  h: (layer ? 80 : 140) + Math.random() * (layer ? 90 : 120),
  win: Math.random(),
})));
const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.6, r: Math.random() * 1.4 + 0.3 }));

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  scale = Math.min(canvas.height / H, canvas.width / MIN_W);
  W = canvas.width / scale;
  const viewH = canvas.height / scale;
  // На высоком экране земля стоит примерно на 3/4 высоты, остальное — небо и «пол»
  topPad = Math.max(0, viewH * 0.74 - GROUND);
  bottom = viewH - topPad;
  ctx.setTransform(scale, 0, 0, scale, 0, topPad * scale);
  player.x = Math.min(160, W * 0.15);
  if (state !== 'play') draw();
}

function reset() {
  Object.assign(player, { y: GROUND, vy: 0, jumps: 0, onGround: true, trail: [] });
  obstacles = [];
  gems = [];
  particles = [];
  speed = START_SPEED;
  distance = 0;
  gemCount = 0;
  spawnIn = 1.2;
}

// ---------- Генерация препятствий ----------
function spawn() {
  const level = Math.min(1, (speed - START_SPEED) / (MAX_SPEED - START_SPEED));
  const r = Math.random();
  const x = W + 40;
  if (r < 0.45) {
    // шипы: 1–3 подряд
    const n = 1 + Math.floor(Math.random() * (level > 0.3 ? 3 : 2));
    obstacles.push({ type: 'spike', x, y: GROUND, w: 26 * n, h: 30, n });
  } else if (r < 0.75) {
    // блок разной высоты
    const h = 40 + Math.random() * (40 + level * 40);
    obstacles.push({ type: 'block', x, y: GROUND, w: 34 + Math.random() * 20, h });
  } else {
    // дрон в воздухе: под ним можно пробежать, если не прыгать
    obstacles.push({ type: 'drone', x, y: GROUND - 78 - Math.random() * 24, w: 46, h: 22, phase: Math.random() * 6 });
  }
  // кристаллы дугой над препятствием
  if (Math.random() < 0.6) {
    for (let i = 0; i < 3; i++) gems.push({ x: x + 10 + i * 34, y: GROUND - 120 - Math.sin((i / 2) * Math.PI) * 40, taken: false });
  }
  const gap = 0.55 + Math.random() * 0.75 - level * 0.25;
  spawnIn = Math.max(0.42, gap) * (START_SPEED / speed) * 1.6;
}

// ---------- Управление ----------
function jump() {
  if (state !== 'play') return;
  if (player.onGround || player.jumps < 2) {
    player.vy = player.jumps === 0 ? JUMP_V : JUMP_V * 0.85;
    player.jumps++;
    player.onGround = false;
    (player.jumps === 1 ? sfx.jump : sfx.double)();
    burst(player.x + player.w / 2, player.y, player.jumps === 1 ? COLORS.cyan : COLORS.pink, 10);
  }
}

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
    e.preventDefault();
    if (state === 'play') jump();
    else if (state === 'menu' || state === 'over') start();
  }
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') togglePause(); });

// ---------- Частицы ----------
function burst(x, y, color, n = 14, power = 260) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = power * (0.3 + Math.random() * 0.7);
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.6 + Math.random() * 0.4, max: 1, color });
  }
  if (particles.length > 300) particles.splice(0, particles.length - 300);
}

// ---------- Обновление ----------
function hits(o) {
  const p = { x: player.x + 5, y: player.y - player.h + 4, w: player.w - 10, h: player.h - 6 };
  if (o.type === 'spike') {
    // шипы — треугольники: проверяем по «сжатому» прямоугольнику
    return p.x < o.x + o.w - 6 && p.x + p.w > o.x + 6 && p.y + p.h > o.y - o.h + 10;
  }
  const top = o.type === 'drone' ? o.y : o.y - o.h;
  return p.x < o.x + o.w && p.x + p.w > o.x && p.y < top + (o.type === 'drone' ? o.h : o.h) && p.y + p.h > top;
}

function update(dt) {
  t += dt;
  speed = Math.min(MAX_SPEED, speed + dt * 9);
  distance += speed * dt;

  // игрок
  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;
  if (player.y >= GROUND) {
    if (!player.onGround && player.vy > 400) burst(player.x + player.w / 2, GROUND, COLORS.violet, 6, 120);
    player.y = GROUND;
    player.vy = 0;
    player.onGround = true;
    player.jumps = 0;
  }
  player.trail.push({ x: player.x, y: player.y });
  if (player.trail.length > 8) player.trail.shift();

  // препятствия
  spawnIn -= dt;
  if (spawnIn <= 0) spawn();
  for (const o of obstacles) {
    o.x -= speed * dt;
    if (o.type === 'drone') o.y += Math.sin(t * 4 + o.phase) * 20 * dt;
    if (hits(o)) return gameOver();
  }
  obstacles = obstacles.filter((o) => o.x + o.w > -50);

  // кристаллы
  for (const g of gems) {
    g.x -= speed * dt;
    if (!g.taken && Math.abs(g.x - (player.x + player.w / 2)) < 26 && Math.abs(g.y - (player.y - player.h / 2)) < 32) {
      g.taken = true;
      gemCount++;
      sfx.gem();
      burst(g.x, g.y, COLORS.lime, 10, 180);
    }
  }
  gems = gems.filter((g) => g.x > -30 && !g.taken);

  // частицы
  for (const p of particles) {
    p.x += (p.vx - speed * 0.3) * dt;
    p.y += p.vy * dt;
    p.vy += 600 * dt;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);
  shake = Math.max(0, shake - dt * 30);

  $('score').textContent = scoreNow();
  $('gems').textContent = gemCount;
}

const scoreNow = () => Math.floor(distance / 10) + gemCount * 25;

// ---------- Отрисовка ----------
function draw() {
  ctx.save();
  if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // небо
  const sky = ctx.createLinearGradient(0, -topPad, 0, H);
  sky.addColorStop(0, '#0b0418');
  sky.addColorStop(0.6, '#2a0b45');
  sky.addColorStop(1, '#5b1a6e');
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -topPad - 20, W + 40, bottom + topPad + 40);

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (const s of stars) { ctx.beginPath(); ctx.arc(s.x * W, s.y * (H + topPad) - topPad, s.r, 0, Math.PI * 2); ctx.fill(); }

  // солнце с полосами
  const sunX = W * 0.72;
  const sunY = GROUND - 70;
  const sun = ctx.createLinearGradient(0, sunY - 110, 0, sunY + 60);
  sun.addColorStop(0, '#ffe066');
  sun.addColorStop(1, COLORS.pink);
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 110, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#2a0b45';
  for (let i = 0; i < 6; i++) ctx.fillRect(sunX - 115, sunY - 50 + i * 10, 230, 2 + i * 0.8);

  // параллакс-город
  skyline.forEach((layer, li) => {
    const k = li ? 0.35 : 0.15;
    const span = layer.length * (li ? 70 : 110);
    ctx.fillStyle = li ? '#1a0630' : '#24093d';
    for (const b of layer) {
      const x = ((b.x - distance * k) % span + span) % span - 120;
      ctx.fillRect(x, GROUND - b.h, b.w, b.h);
      if (li) {
        ctx.fillStyle = b.win > 0.5 ? 'rgba(0,240,255,0.35)' : 'rgba(255,43,214,0.3)';
        for (let wy = GROUND - b.h + 10; wy < GROUND - 10; wy += 16) ctx.fillRect(x + 8, wy, b.w - 16, 3);
        ctx.fillStyle = '#1a0630';
      }
    }
  });

  // земля с сеткой
  ctx.fillStyle = '#0b0418';
  ctx.fillRect(-20, GROUND, W + 40, bottom - GROUND + 20);
  ctx.strokeStyle = 'rgba(255,43,214,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 9; i++) { const y = GROUND + 6 + i * i * 4; if (y > bottom) break; ctx.moveTo(0, y); ctx.lineTo(W, y); }
  const off = (distance % 60);
  for (let x = -off; x < W + 60; x += 60) {
    ctx.moveTo(x, GROUND);
    ctx.lineTo(x + (x - W / 2) * 0.8 * ((bottom - GROUND) / (H - GROUND)), bottom);
  }
  ctx.stroke();
  ctx.shadowBlur = 12;
  ctx.shadowColor = COLORS.cyan;
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  ctx.lineTo(W, GROUND);
  ctx.stroke();

  // кристаллы
  ctx.shadowColor = COLORS.lime;
  ctx.fillStyle = COLORS.lime;
  for (const g of gems) {
    const bob = Math.sin(t * 6 + g.x * 0.05) * 4;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y - 11 + bob);
    ctx.lineTo(g.x + 8, g.y + bob);
    ctx.lineTo(g.x, g.y + 11 + bob);
    ctx.lineTo(g.x - 8, g.y + bob);
    ctx.closePath();
    ctx.fill();
  }

  // препятствия
  for (const o of obstacles) {
    if (o.type === 'spike') {
      ctx.shadowColor = COLORS.pink;
      ctx.fillStyle = COLORS.pink;
      for (let i = 0; i < o.n; i++) {
        ctx.beginPath();
        ctx.moveTo(o.x + i * 26, o.y);
        ctx.lineTo(o.x + i * 26 + 13, o.y - o.h);
        ctx.lineTo(o.x + i * 26 + 26, o.y);
        ctx.fill();
      }
    } else if (o.type === 'block') {
      ctx.shadowColor = COLORS.violet;
      ctx.fillStyle = '#1b0a33';
      ctx.strokeStyle = COLORS.violet;
      ctx.lineWidth = 3;
      ctx.fillRect(o.x, o.y - o.h, o.w, o.h);
      ctx.strokeRect(o.x, o.y - o.h, o.w, o.h);
    } else {
      ctx.shadowColor = '#ff6b2b';
      ctx.fillStyle = '#ff6b2b';
      ctx.fillRect(o.x, o.y + 6, o.w, o.h - 12);
      ctx.fillRect(o.x - 6, o.y, 14, 4);
      ctx.fillRect(o.x + o.w - 8, o.y, 14, 4);
      ctx.fillStyle = Math.sin(t * 20) > 0 ? '#fff' : '#ff2b2b';
      ctx.fillRect(o.x + o.w / 2 - 3, o.y + o.h - 8, 6, 4);
    }
  }

  // игрок: след + тело
  player.trail.forEach((p, i) => {
    ctx.globalAlpha = (i / player.trail.length) * 0.25;
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(p.x - (player.trail.length - i) * 6, p.y - player.h, player.w, player.h);
  });
  ctx.globalAlpha = 1;
  const squash = player.onGround ? 1 : 1 + Math.min(0.15, Math.abs(player.vy) / 6000);
  const pw = player.w / squash;
  const ph = player.h * squash;
  const px = player.x + (player.w - pw) / 2;
  ctx.shadowColor = COLORS.cyan;
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(px, player.y - ph, pw, ph);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0b0418';
  ctx.fillRect(px + pw - 14, player.y - ph + 10, 9, 7); // визор
  ctx.fillStyle = COLORS.pink;
  if (player.onGround && state === 'play') {
    const step = Math.sin(t * 30) > 0;
    ctx.fillRect(px + 4, player.y - 4, 10, step ? 4 : 2);
    ctx.fillRect(px + pw - 14, player.y - 4, 10, step ? 2 : 4);
  }

  // частицы
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 4, 4);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------- Цикл ----------
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000 || 0);
  last = now;
  if (state === 'play') update(dt);
  else t += dt;
  draw();
  requestAnimationFrame(loop);
}

// ---------- Экраны ----------
function show(id) {
  ['menu', 'over', 'paused'].forEach((s) => { $(s).hidden = s !== id; });
  $('hud').hidden = !(id === null || id === 'paused');
}

function start() {
  reset();
  state = 'play';
  show(null);
}

function gameOver() {
  state = 'over';
  shake = 10;
  sfx.hit();
  burst(player.x + player.w / 2, player.y - player.h / 2, COLORS.cyan, 30, 400);
  const score = scoreNow();
  const isBest = score > best;
  if (isBest) { best = score; store.set('best', best); }
  $('finalScore').textContent = score;
  $('finalGems').textContent = gemCount;
  $('newBest').hidden = !isBest;
  $('best').textContent = best;
  setTimeout(() => show('over'), 500);
}

function togglePause() {
  if (state === 'play') { state = 'paused'; show('paused'); }
  else if (state === 'paused') { state = 'play'; show(null); }
}

function updateSound() { $('soundBtn').textContent = `Звук: ${soundOn ? 'вкл' : 'выкл'}`; }

$('playBtn').onclick = start;
$('againBtn').onclick = start;
$('menuBtn').onclick = () => { state = 'menu'; reset(); show('menu'); };
$('pauseBtn').onclick = togglePause;
$('resumeBtn').onclick = togglePause;
$('soundBtn').onclick = () => { soundOn = !soundOn; store.set('sound', soundOn); updateSound(); };

$('best').textContent = best;
updateSound();
window.addEventListener('resize', resize);
resize();
reset();
requestAnimationFrame(loop);
