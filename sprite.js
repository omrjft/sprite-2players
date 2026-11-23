// Demo de sprite sheet: parado, caminando, corriendo y brincando
// con fondo en parallax y detección de colisiones contra obstáculos.

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// ---------------------------------------------------------------------------
// Sprite sheet (5 columnas x 4 filas). Cada frame es [x, y, ancho, alto]
// medido sobre la imagen. Filas: 0 parado, 1 caminar, 2 correr, 3 brincar.
// ---------------------------------------------------------------------------
const SHEET_SRC = 'corriendo-removebg-preview.png';
const CELL_W = 409 / 5;

const FRAMES = {
    idle: [[18, 22, 52, 104], [98, 22, 51, 104], [179, 22, 52, 104], [260, 22, 52, 104], [341, 22, 52, 104]],
    walk: [[22, 161, 49, 108], [100, 161, 51, 108], [177, 161, 54, 106], [257, 161, 53, 106], [333, 162, 58, 105]],
    run:  [[19, 307, 65, 100], [96, 307, 65, 101], [175, 307, 67, 100], [252, 307, 66, 97], [328, 308, 69, 98]],
    jump: [[19, 474, 57, 109], [98, 456, 57, 111], [177, 430, 57, 112], [251, 459, 61, 110], [326, 493, 62, 101]]
};

// Prepara cada frame: ancla horizontal = centro de su celda; ancla vertical =
// línea de los pies común a la fila (en el salto cada frame usa sus propios pies).
for (const name in FRAMES) {
    const baseline = Math.max(...FRAMES[name].map(f => f[1] + f[3]));
    FRAMES[name] = FRAMES[name].map((f, i) => ({
        sx: f[0], sy: f[1], sw: f[2], sh: f[3],
        ax: CELL_W * i + CELL_W / 2 - f[0],                  // px desde el borde izq. del recorte hasta el centro
        ay: name === 'jump' ? f[3] : baseline - f[1]         // px desde el borde sup. del recorte hasta los pies
    }));
}

const sheet = new Image();
let sheetReady = false;
sheet.onload = () => { sheetReady = true; };
sheet.src = SHEET_SRC;

// ---------------------------------------------------------------------------
// Constantes de física
// ---------------------------------------------------------------------------
const GROUND_Y = 380;        // y del suelo (donde pisan los pies)
const PLAYER_SCREEN_X = 260; // posición fija del personaje en pantalla
const WALK_SPEED = 170;
const RUN_SPEED = 360;
const GRAVITY = 2000;
const JUMP_VELOCITY = -700;  // altura máx. ≈ 122 px (obstáculos miden 30–75)
const SPRITE_SCALE = 1;
const HIT_W = 30;            // hitbox del personaje (más chica que el dibujo)
const HIT_H = 92;

const player = {
    x: 0,                    // posición en el mundo (centro)
    y: GROUND_Y,             // y de los pies
    vx: 0,
    vy: 0,
    grounded: true,
    facing: 1,               // 1 derecha, -1 izquierda
    state: 'idle',
    frame: 0,
    frameTime: 0,
    jumpTime: 0,             // tiempo desde que despegó
    landTimer: 0,            // muestra el frame de aterrizaje un instante
    blocked: false
};

let showHitboxes = false;
let collisions = 0;
let lastCollisionTime = -10;
let time = 0;

// ---------------------------------------------------------------------------
// Multijugador P2P (máximo 2 jugadores)
// ---------------------------------------------------------------------------
const ROOM_ID = 'juego-sprite-uruapan-sala-unica-2026';
const statusEl = document.getElementById('netStatus');

const remotePlayer = {
    connected: false,
    x: 0,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing: 1,
    state: 'idle',
    frame: 0,
    frameTime: 0,
    jumpTime: 0,
    landTimer: 0,
    collisions: 0
};

let role = 'connecting';
let activeConn = null;
let peer = null;

function setNetworkStatus(text, color) {
    statusEl.textContent = text;
    statusEl.style.color = color;
}

function setupConnection(conn) {
    activeConn = conn;

    conn.on('open', () => {
        remotePlayer.connected = true;
        setNetworkStatus(
            role === 'host'
                ? '🟢 Eres Jugador 1 (Host) — Jugador 2 conectado'
                : '🟢 Eres Jugador 2 — Conectado con Jugador 1',
            '#4ade80'
        );
    });

    conn.on('data', data => {
        if (!data || typeof data !== 'object') return;

        if (data.type === 'FULL') {
            role = 'full';
            remotePlayer.connected = false;
            setNetworkStatus('🔴 Sala llena: ya hay 2 jugadores activos.', '#f87171');
            conn.close();
            return;
        }

        if (data.type === 'STATE' && data.state) {
            Object.assign(remotePlayer, data.state);
            remotePlayer.connected = true;
        }
    });

    conn.on('close', () => {
        remotePlayer.connected = false;
        activeConn = null;

        if (role === 'host') {
            setNetworkStatus('🟡 Eres Jugador 1 (Host) — Esperando Jugador 2...', '#facc15');
        } else if (role === 'guest') {
            setNetworkStatus('🔴 El Jugador 1 cerró la partida. Recarga para volver a jugar.', '#f87171');
        }
    });
}

function initMultiplayer() {
    if (typeof Peer === 'undefined') {
        setNetworkStatus('🔴 No se pudo cargar PeerJS. Revisa tu conexión.', '#f87171');
        return;
    }

    peer = new Peer(ROOM_ID);

    peer.on('open', () => {
        role = 'host';
        setNetworkStatus('🟡 Eres Jugador 1 (Host) — Esperando Jugador 2...', '#facc15');
    });

    peer.on('connection', conn => {
        if (activeConn && activeConn.open) {
            conn.on('open', () => {
                conn.send({ type: 'FULL' });
                setTimeout(() => conn.close(), 150);
            });
            return;
        }
        setupConnection(conn);
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            peer.destroy();
            role = 'guest';
            peer = new Peer();

            peer.on('open', () => {
                const conn = peer.connect(ROOM_ID, { reliable: true });
                setupConnection(conn);
            });

            peer.on('error', guestErr => {
                setNetworkStatus('🔴 Error de red: ' + guestErr.type, '#f87171');
            });
        } else {
            setNetworkStatus('🔴 Error de red: ' + err.type, '#f87171');
        }
    });
}

initMultiplayer();

setInterval(() => {
    if (activeConn && activeConn.open && role !== 'full') {
        activeConn.send({
            type: 'STATE',
            state: {
                x: player.x,
                y: player.y,
                vx: player.vx,
                vy: player.vy,
                facing: player.facing,
                state: player.state,
                frame: player.frame,
                jumpTime: player.jumpTime,
                landTimer: player.landTimer,
                collisions
            }
        });
    }
}, 1000 / 30);

// ---------------------------------------------------------------------------
// Teclado
// ---------------------------------------------------------------------------
const keys = {};
const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
                   'KeyA', 'KeyD', 'KeyW', 'ShiftLeft', 'ShiftRight'];

window.addEventListener('keydown', e => {
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    if (e.code === 'KeyH' && !e.repeat) showHitboxes = !showHitboxes;
    keys[e.code] = true;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---------------------------------------------------------------------------
// Mundo: obstáculos generados de forma determinista por "chunks",
// así existen igual si el personaje camina hacia adelante o hacia atrás.
// ---------------------------------------------------------------------------
const CHUNK = 380;
const obstacleCache = new Map();

function hash(n) {
    let h = Math.imul(n | 0, 0x45d9f3b) ^ 0x1b873593;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function obstacleForChunk(i) {
    if (obstacleCache.has(i)) return obstacleCache.get(i);
    let o = null;
    if (i >= 1 && hash(i * 7 + 1) < 0.8) {            // el chunk 0 queda libre (zona de inicio)
        const type = hash(i * 7 + 2) < 0.5 ? 'rock' : 'crate';
        o = {
            type,
            x: i * CHUNK + 120 + hash(i * 7 + 3) * 140,
            w: type === 'crate' ? 48 + Math.floor(hash(i * 7 + 4) * 2) * 24 : 44 + hash(i * 7 + 4) * 30,
            h: 30 + hash(i * 7 + 5) * 45,
            hit: false
        };
        if (type === 'crate') o.h = o.w;                // las cajas son cuadradas
        o.h = Math.min(o.h, 75);
    }
    obstacleCache.set(i, o);
    return o;
}

function visibleObstacles(camX) {
    const list = [];
    const first = Math.floor((camX - 100) / CHUNK);
    const last = Math.floor((camX + W + 100) / CHUNK);
    for (let i = first; i <= last; i++) {
        const o = obstacleForChunk(i);
        if (o) list.push(o);
    }
    return list;
}

// ---------------------------------------------------------------------------
// Colisiones (AABB)
// Hitbox del jugador: centro x, pies y. Obstáculo: x, w, h apoyado en el suelo.
// ---------------------------------------------------------------------------
function overlaps(px, py, o) {
    const top = GROUND_Y - o.h;
    return px + HIT_W / 2 > o.x && px - HIT_W / 2 < o.x + o.w &&
           py > top && py - HIT_H < GROUND_Y;
}

function registerHit(o) {
    player.blocked = true;
    lastCollisionTime = time;
    if (!o.hit) { o.hit = true; collisions++; }
}

// ---------------------------------------------------------------------------
// Actualización
// ---------------------------------------------------------------------------
function update(dt) {
    time += dt;

    const left = keys.ArrowLeft || keys.KeyA;
    const right = keys.ArrowRight || keys.KeyD;
    const run = keys.ShiftLeft || keys.ShiftRight;
    const jumpKey = keys.Space || keys.ArrowUp || keys.KeyW;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    // --- Movimiento horizontal (con una pequeña aceleración) ---
    const targetSpeed = dir * (run ? RUN_SPEED : WALK_SPEED);
    const accel = player.grounded ? 2400 : 1500;
    if (player.vx < targetSpeed) player.vx = Math.min(targetSpeed, player.vx + accel * dt);
    else if (player.vx > targetSpeed) player.vx = Math.max(targetSpeed, player.vx - accel * dt);
    if (dir !== 0) player.facing = dir;

    // --- Salto ---
    if (jumpKey && player.grounded) {
        player.vy = JUMP_VELOCITY;
        player.grounded = false;
        player.jumpTime = 0;
    }
    if (!jumpKey && player.vy < -250 && !player.grounded) player.vy = -250; // soltar = salto corto

    player.blocked = false;
    const obstacles = visibleObstacles(player.x - PLAYER_SCREEN_X);

    // --- Eje X: mover y empujar fuera si choca de lado ---
    player.x += player.vx * dt;
    for (const o of obstacles) {
        if (overlaps(player.x, player.y, o)) {
            if (player.vx > 0 || (player.vx === 0 && player.x < o.x + o.w / 2)) {
                player.x = o.x - HIT_W / 2;
            } else {
                player.x = o.x + o.w + HIT_W / 2;
            }
            player.vx = 0;
            registerHit(o);
        }
    }

    // --- Eje Y: gravedad, aterrizar sobre suelo u obstáculos ---
    const prevY = player.y;
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    if (!player.grounded) player.jumpTime += dt;

    let landedOn = null;
    if (player.vy >= 0) {
        for (const o of obstacles) {
            const top = GROUND_Y - o.h;
            const overX = player.x + HIT_W / 2 > o.x && player.x - HIT_W / 2 < o.x + o.w;
            if (overX && prevY <= top + 0.5 && player.y >= top) landedOn = top;
        }
    }
    let floorY = landedOn !== null ? landedOn : GROUND_Y;
    if (player.y >= floorY) {
        if (!player.grounded && player.vy > 200) player.landTimer = 0.1;
        player.y = floorY;
        player.vy = 0;
        player.grounded = true;
    } else {
        player.grounded = false;
    }

    // Si estaba parado sobre algo y se salió del borde, cae
    if (player.grounded && player.y < GROUND_Y) {
        const supported = obstacles.some(o =>
            Math.abs(player.y - (GROUND_Y - o.h)) < 0.5 &&
            player.x + HIT_W / 2 > o.x && player.x - HIT_W / 2 < o.x + o.w);
        if (!supported) player.grounded = false;
    }

    if (player.landTimer > 0) player.landTimer -= dt;

    // --- Estado y animación ---
    const speed = Math.abs(player.vx);
    const intending = dir !== 0;
    if (!player.grounded) player.state = 'jump';
    else if (intending && run) player.state = 'run';
    else if (intending) player.state = 'walk';
    else if (speed > 20) player.state = player.vx !== 0 && run ? 'run' : 'walk';
    else player.state = 'idle';

    let fps = { idle: 6, walk: 8, run: 13 }[player.state];
    if (player.state !== 'jump') {
        player.frameTime += dt;
        const step = 1 / fps;
        while (player.frameTime >= step) {
            player.frameTime -= step;
            player.frame = (player.frame + 1) % 5;
        }
    }
}

// ---------------------------------------------------------------------------
// Fondo con parallax (todo depende de la posición del mundo, así que se mueve
// al caminar/correr y se detiene si el personaje choca).
// ---------------------------------------------------------------------------
function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, '#5aa9e6');
    g.addColorStop(1, '#cfeaf7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Sol fijo
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(660, 80, 34, 0, Math.PI * 2);
    ctx.fill();
}

function drawClouds(camX) {
    const k = 0.1, spacing = 260;
    const off = camX * k;
    const first = Math.floor(off / spacing) - 1;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = first; i <= first + Math.ceil(W / spacing) + 2; i++) {
        const x = i * spacing - off + hash(i * 3) * 120;
        const y = 40 + hash(i * 3 + 1) * 100;
        const s = 0.7 + hash(i * 3 + 2) * 0.7;
        ctx.beginPath();
        ctx.ellipse(x, y, 42 * s, 16 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(x - 26 * s, y + 4 * s, 26 * s, 12 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 28 * s, y + 5 * s, 28 * s, 11 * s, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawMountains(camX, k, base, amp, color, wavelength) {
    const off = camX * k;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= W; x += 8) {
        const wx = x + off;
        const y = base - amp * (0.55 + 0.3 * Math.sin(wx / wavelength) +
                                0.15 * Math.sin(wx / (wavelength * 0.37) + 1.7));
        ctx.lineTo(x, y);
    }
    ctx.lineTo(W, GROUND_Y);
    ctx.closePath();
    ctx.fill();
}

function drawTrees(camX) {
    const k = 0.6, spacing = 150;
    const off = camX * k;
    const first = Math.floor(off / spacing) - 1;
    for (let i = first; i <= first + Math.ceil(W / spacing) + 2; i++) {
        if (hash(i * 5 + 9) < 0.35) continue;
        const x = i * spacing - off + hash(i * 5 + 1) * 60;
        const h = 60 + hash(i * 5 + 2) * 50;
        ctx.fillStyle = '#5b3f2a';
        ctx.fillRect(x - 5, GROUND_Y - h * 0.45, 10, h * 0.45);
        ctx.fillStyle = '#2e7d4f';
        ctx.beginPath();
        ctx.arc(x, GROUND_Y - h * 0.65, h * 0.38, 0, Math.PI * 2);
        ctx.arc(x - h * 0.22, GROUND_Y - h * 0.5, h * 0.27, 0, Math.PI * 2);
        ctx.arc(x + h * 0.22, GROUND_Y - h * 0.5, h * 0.27, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawGround(camX) {
    ctx.fillStyle = '#6b8e23';
    ctx.fillRect(0, GROUND_Y, W, 12);
    ctx.fillStyle = '#8b6b4a';
    ctx.fillRect(0, GROUND_Y + 12, W, H - GROUND_Y - 12);

    // Franjas / piedritas que se mueven al 100 % con el mundo
    const spacing = 64;
    const first = Math.floor(camX / spacing) - 1;
    for (let i = first; i <= first + Math.ceil(W / spacing) + 2; i++) {
        const x = i * spacing - camX;
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(x, GROUND_Y + 12, 3, H - GROUND_Y);
        ctx.fillStyle = '#7a9a2a';
        ctx.fillRect(x + 20, GROUND_Y + 2, 14, 4);
        ctx.fillStyle = '#6f5338';
        ctx.fillRect(x + 10 + hash(i) * 30, GROUND_Y + 30 + hash(i + 50) * 30, 8, 5);
    }
}

function drawObstacle(o, camX) {
    const x = o.x - camX;
    const y = GROUND_Y - o.h;
    const flash = time - lastCollisionTime < 0.25 && o.hit;
    if (o.type === 'rock') {
        ctx.fillStyle = flash ? '#e74c3c' : '#7f8c8d';
        ctx.beginPath();
        ctx.moveTo(x, GROUND_Y);
        ctx.quadraticCurveTo(x + o.w * 0.05, y + o.h * 0.15, x + o.w * 0.35, y);
        ctx.quadraticCurveTo(x + o.w * 0.8, y - 2, x + o.w, GROUND_Y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + o.w * 0.3, y + 5, o.w * 0.2, 4);
    } else {
        ctx.fillStyle = flash ? '#e74c3c' : '#b8793b';
        ctx.fillRect(x, y, o.w, o.h);
        ctx.strokeStyle = '#6e4519';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, o.w - 3, o.h - 3);
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + o.w - 3, y + o.h - 3);
        ctx.moveTo(x + o.w - 3, y + 3); ctx.lineTo(x + 3, y + o.h - 3);
        ctx.stroke();
    }
    if (showHitboxes) {
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, o.w, o.h);
    }
}

// ---------------------------------------------------------------------------
// Personaje
// ---------------------------------------------------------------------------
function currentFrame() {
    if (player.state === 'jump') {
        let i;
        if (player.jumpTime < 0.06) i = 0;           // agacharse al despegar
        else if (player.vy < -250) i = 1;            // subiendo
        else if (player.vy <= 150) i = 2;            // punto más alto
        else i = 3;                                  // cayendo
        return FRAMES.jump[i];
    }
    if (player.landTimer > 0) return FRAMES.jump[4]; // aterrizaje
    return FRAMES[player.state][player.frame];
}

function drawPlayer() {
    const f = currentFrame();
    const dx = PLAYER_SCREEN_X;
    const dy = player.y;

    if (sheetReady) {
        ctx.save();
        ctx.translate(dx, dy);
        ctx.scale(player.facing * SPRITE_SCALE, SPRITE_SCALE); // el sprite mira a la derecha; se voltea a la izquierda
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sheet, f.sx, f.sy, f.sw, f.sh, -f.ax, -f.ay, f.sw, f.sh);
        ctx.restore();
    } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(dx - HIT_W / 2, dy - HIT_H, HIT_W, HIT_H);
    }

    // Sombra en el suelo (se achica al subir)
    const air = Math.max(0, GROUND_Y - player.y);
    ctx.fillStyle = 'rgba(0,0,0,' + Math.max(0.08, 0.3 - air / 600) + ')';
    ctx.beginPath();
    ctx.ellipse(dx, GROUND_Y + 4, Math.max(8, 26 - air / 8), 5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (showHitboxes) {
        const hitNow = time - lastCollisionTime < 0.25;
        ctx.strokeStyle = hitNow ? '#ff2d2d' : '#00aaff';
        ctx.lineWidth = 2;
        ctx.strokeRect(dx - HIT_W / 2, dy - HIT_H, HIT_W, HIT_H);
    }
}

function drawRemotePlayer(screenX) {
    let f;
    if (remotePlayer.state === 'jump') {
        let i = 2;
        if (remotePlayer.jumpTime < 0.06) i = 0;
        else if (remotePlayer.vy < -250) i = 1;
        else if (remotePlayer.vy <= 150) i = 2;
        else i = 3;
        f = FRAMES.jump[i];
    } else if (remotePlayer.landTimer > 0) {
        f = FRAMES.jump[4];
    } else {
        f = FRAMES[remotePlayer.state][remotePlayer.frame] || FRAMES.idle[0];
    }

    if (sheetReady) {
        ctx.save();
        ctx.translate(screenX, remotePlayer.y);
        ctx.scale(remotePlayer.facing * SPRITE_SCALE, SPRITE_SCALE);
        ctx.filter = 'hue-rotate(150deg) saturate(1.4)';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sheet, f.sx, f.sy, f.sw, f.sh, -f.ax, -f.ay, f.sw, f.sh);
        ctx.restore();
    } else {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(screenX - HIT_W / 2, remotePlayer.y - HIT_H, HIT_W, HIT_H);
    }

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(role === 'host' ? 'J2' : 'J1', screenX, remotePlayer.y - HIT_H - 12);

    const air = Math.max(0, GROUND_Y - remotePlayer.y);
    ctx.fillStyle = 'rgba(0,0,0,' + Math.max(0.08, 0.3 - air / 600) + ')';
    ctx.beginPath();
    ctx.ellipse(screenX, GROUND_Y + 4, Math.max(8, 26 - air / 8), 5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (showHitboxes) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX - HIT_W / 2, remotePlayer.y - HIT_H, HIT_W, HIT_H);
    }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const STATE_LABEL = { idle: 'PARADO', walk: 'CAMINANDO', run: 'CORRIENDO', jump: 'BRINCANDO' };

function drawHUD() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10, 10, 230, 96);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const myTag = role === 'guest' ? 'Jugador 2' : 'Jugador 1';
    ctx.fillText('Tú (' + myTag + '): ' + STATE_LABEL[player.state], 20, 16);
    ctx.font = '13px sans-serif';
    ctx.fillText('Tu distancia: ' + Math.max(0, Math.floor(player.x / 10)) + ' m', 20, 38);
    ctx.fillText('Tus choques: ' + collisions, 20, 56);

    if (remotePlayer.connected) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(
            'Rival: ' + Math.max(0, Math.floor(remotePlayer.x / 10)) +
            ' m (choques: ' + remotePlayer.collisions + ')',
            20,
            78
        );
    }

    if (time - lastCollisionTime < 0.6) {
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e74c3c';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.strokeText('¡COLISIÓN! Brinca el obstáculo', W / 2, 110);
        ctx.fillText('¡COLISIÓN! Brinca el obstáculo', W / 2, 110);
    }
}

// ---------------------------------------------------------------------------
// Bucle principal
// ---------------------------------------------------------------------------
function draw() {
    const camX = player.x - PLAYER_SCREEN_X;
    drawSky();
    drawClouds(camX);
    drawMountains(camX, 0.2, GROUND_Y - 40, 170, '#8fb3c9', 210);
    drawMountains(camX, 0.4, GROUND_Y - 10, 120, '#5f8f7a', 140);
    drawTrees(camX);
    drawGround(camX);
    for (const o of visibleObstacles(camX)) drawObstacle(o, camX);

    if (remotePlayer.connected) {
        drawRemotePlayer(remotePlayer.x - camX);
    }
    drawPlayer();
    drawHUD();
}

let last = performance.now();
function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
