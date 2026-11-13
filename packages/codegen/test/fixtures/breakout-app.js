const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const ROWS = 5;
const COLS = 8;
const BRICK_H = 22;
const GAP = 6;
const BRICK_W = (W - GAP * (COLS + 1)) / COLS;
const COLORS = ['#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8'];

function loadBest() {
  try { return Number(localStorage.getItem('breakout-best')) || 0; } catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('breakout-best', String(v)); } catch (e) { /* storage unavailable */ }
}

const state = { paddleX: W / 2, paddleW: 90, ball: { x: W / 2, y: H - 60, vx: 0, vy: 0, r: 8 }, bricks: [], score: 0, best: loadBest(), lives: 3, phase: 'ready', paused: false };

function buildBricks() {
  state.bricks = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      state.bricks.push({ x: GAP + c * (BRICK_W + GAP), y: 60 + r * (BRICK_H + GAP), hits: r === 0 ? 2 : 1, color: COLORS[r], alive: true });
    }
  }
}
function resetBall() {
  state.ball.x = state.paddleX;
  state.ball.y = H - 60;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.phase = 'ready';
}
function newGame() {
  state.score = 0;
  state.lives = 3;
  state.paddleX = W / 2;
  buildBricks();
  resetBall();
  updateHud();
}
function updateHud() {
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(state.best);
  livesEl.textContent = String(state.lives);
}
function launch() {
  if (state.phase === 'over' || state.phase === 'won') { newGame(); return; }
  if (state.phase !== 'ready') return;
  const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 0.6;
  const speed = 360;
  state.ball.vx = Math.cos(angle) * speed;
  state.ball.vy = Math.sin(angle) * speed;
  state.phase = 'playing';
}
function setPaddle(x) {
  state.paddleX = Math.max(state.paddleW / 2, Math.min(W - state.paddleW / 2, x));
  if (state.phase === 'ready') state.ball.x = state.paddleX;
}
function movePaddleTo(clientX) {
  const rect = canvas.getBoundingClientRect();
  setPaddle(((clientX - rect.left) / rect.width) * W);
}

const keys = { left: false, right: false };
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') keys.left = true;
  else if (e.key === 'ArrowRight') keys.right = true;
  else if (e.key === ' ' || e.key === 'Enter') { launch(); e.preventDefault(); }
  else if (e.key === 'p' || e.key === 'P') state.paused = !state.paused;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') keys.left = false;
  else if (e.key === 'ArrowRight') keys.right = false;
});
canvas.addEventListener('pointermove', (e) => movePaddleTo(e.clientX));
canvas.addEventListener('pointerdown', (e) => { movePaddleTo(e.clientX); launch(); });
document.getElementById('restart').addEventListener('click', newGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) state.paused = true; });

function lose() {
  state.lives -= 1;
  if (state.lives <= 0) { state.phase = 'over'; } else { resetBall(); }
  updateHud();
}
function step(dt) {
  const speed = 460;
  if (keys.left) setPaddle(state.paddleX - speed * dt);
  if (keys.right) setPaddle(state.paddleX + speed * dt);
  if (state.phase !== 'playing') return;
  const b = state.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
  if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
  if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
  const py = H - 36;
  if (b.vy > 0 && b.y + b.r >= py && b.y + b.r <= py + 16 && Math.abs(b.x - state.paddleX) <= state.paddleW / 2 + b.r) {
    const offset = (b.x - state.paddleX) / (state.paddleW / 2);
    const sp = Math.min(640, Math.hypot(b.vx, b.vy) * 1.02);
    const ang = (-Math.PI / 2) + offset * 1.0;
    b.vx = Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
    b.y = py - b.r;
  }
  for (const br of state.bricks) {
    if (!br.alive) continue;
    if (b.x + b.r > br.x && b.x - b.r < br.x + BRICK_W && b.y + b.r > br.y && b.y - b.r < br.y + BRICK_H) {
      const overlapX = Math.min(b.x + b.r - br.x, br.x + BRICK_W - (b.x - b.r));
      const overlapY = Math.min(b.y + b.r - br.y, br.y + BRICK_H - (b.y - b.r));
      if (overlapX < overlapY) b.vx = -b.vx; else b.vy = -b.vy;
      br.hits -= 1;
      state.score += 10;
      if (br.hits <= 0) { br.alive = false; state.score += 10; }
      if (state.score > state.best) { state.best = state.score; saveBest(state.best); }
      updateHud();
      break;
    }
  }
  if (state.bricks.every((x) => !x.alive)) { state.phase = 'won'; }
  if (b.y - b.r > H) lose();
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  for (const br of state.bricks) {
    if (!br.alive) continue;
    ctx.fillStyle = br.color;
    ctx.globalAlpha = br.hits > 1 ? 1 : 0.8;
    ctx.fillRect(br.x, br.y, BRICK_W, BRICK_H);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#e6f1ff';
  ctx.fillRect(state.paddleX - state.paddleW / 2, H - 36, state.paddleW, 12);
  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, state.ball.r, 0, Math.PI * 2);
  ctx.fillStyle = '#5eead4';
  ctx.fill();
  const msg = state.phase === 'over' ? 'Game over - tap or press Space' : state.phase === 'won' ? 'You cleared it! Tap to play again' : state.paused ? 'Paused - press P' : state.phase === 'ready' ? 'Tap or press Space to launch' : '';
  if (msg) {
    ctx.fillStyle = '#e6f1ff';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg, W / 2, H / 2 + 40);
  }
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.paused) step(dt);
  draw();
  requestAnimationFrame(frame);
}
newGame();
requestAnimationFrame(frame);
