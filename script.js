
(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const $ = (id) => document.getElementById(id);

  const scoreEl = $("score");
  const distanceEl = $("distance");
  const bestEl = $("best");

  const startOverlay = $("startOverlay");
  const pauseOverlay = $("pauseOverlay");
  const gameOverOverlay = $("gameOverOverlay");

  const pauseBtn = $("pauseBtn");
  const soundBtn = $("soundBtn");
  const hint = $("hint");

  const LANES = 7, CAMERA = 3.2, FOCAL = 0.72;

  let width = innerWidth;
  let height = innerHeight;
  let dpr = 1;

  let state = "ready";
  let lastTime = 0;
  let elapsed = 0;
  let score = 0;
  let distance = 0;

  let x = 0, y = 0, vy = 0;
  let worldZ = 0, speed = 0.20, topSpeed = 1;

  let trackRows = [];
  let segmentStart = 0, segmentEnd = 0;
  let trackLeft = 2, trackWidth = 3;

  let gapRemaining = 0, nextSegmentAt = 0;
  let shake = 0, stars = [];

  let soundOn = true;
  let audioCtx = null;
  let soundReady = false;

  let keys = Object.create(null);
  let touch = { left: false, right: false };

  let best = 0;

  try {
    best = Number(localStorage.getItem("skyrace-best") || 0) || 0;
  } catch (_) {}

  bestEl.textContent = String(best).padStart(5, "0");

  function resize() {
    width = innerWidth;
    height = innerHeight;

    dpr = Math.min(window.devicePixelRatio || 1, 1.7);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    stars = Array.from({
      length: Math.min(100, Math.floor(width * height / 9000))
    }, () => ({
      x: Math.random() * width,
      y: Math.random() * height * .72,
      r: Math.random() * 1.5 + .25,
      a: Math.random() * .65 + .2
    }));
  }

  addEventListener("resize", resize, { passive: true });
  resize();

  function ensureAudio() {
    if (!soundOn) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();

    soundReady = true;
  }

  function beep(freq = 440, duration = .09,
                type = "sine", volume = .035, endFreq = null) {
    if (!soundOn || !soundReady || !audioCtx) return;

    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(
          endFreq, audioCtx.currentTime + duration
        );
      }

      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        .001, audioCtx.currentTime + duration
      );

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }

  function resetWorld() {
    x = 0;
    y = 0;
    vy = 0;
    worldZ = 0;
    speed = .20;
    topSpeed = 1;

    score = 0;
    distance = 0;
    elapsed = 0;
    shake = 0;

    trackRows = [];
    trackLeft = 2;
    trackWidth = 3;
    gapRemaining = 0;
    nextSegmentAt = 0;

    for (let r = 0; r < 55; r++) {
      trackRows[r] = makeRow(r, true);
    }

    updateHud();
  }

  function makeRow(r, safe = false) {
    const row = Array(LANES).fill(false);

    if (safe || r < 45) {
      for (let lane = 1; lane < 6; lane++) row[lane] = true;
      return row;
    }

    if (r >= nextSegmentAt) {
      if (Math.random() < Math.min(.24, .08 + r / 7000)) {
        gapRemaining = 1 + (Math.random() < .4 ? 1 : 0);
      }

      if (Math.random() < .24 || r === 45) {
        trackWidth = 2 + Math.floor(Math.random() * 3);
        trackLeft = Math.max(
          0,
          Math.min(
            LANES - trackWidth,
            trackLeft + Math.floor(Math.random() * 5) - 2
          )
        );
      }

      nextSegmentAt = r + 5 + Math.floor(Math.random() * 8);
    }

    if (gapRemaining > 0) {
      gapRemaining--;
      return row;
    }

    for (
      let lane = trackLeft;
      lane < trackLeft + trackWidth;
      lane++
    ) {
      row[lane] = true;
    }

    if (r > 70 && Math.random() < .045) {
      const hole = trackLeft +
        Math.floor(Math.random() * trackWidth);
      row[hole] = false;
    }

    return row;
  }

  function getRow(r) {
    r = Math.max(0, Math.floor(r));

    while (trackRows.length <= r) {
      trackRows.push(makeRow(trackRows.length));
    }

    return trackRows[r];
  }

  function project(px, py, dz) {
    const safeDz = Math.max(.15, dz);
    const curve = Math.pow(safeDz - CAMERA, 2) / 50 *
      Math.cos((worldZ + safeDz) / 49);

    const sx = width / 2 +
      (px - x + curve) * height * FOCAL / safeDz;

    const sy = height / 2 -
      (py - 2 + safeDz * safeDz / 50) * height * FOCAL / safeDz;

    return [sx, sy, height * FOCAL / safeDz];
  }

  function poly(points, fill) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }

    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawBackground(now) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);

    sky.addColorStop(0, "#071027");
    sky.addColorStop(.48, "#101e42");
    sky.addColorStop(1, "#11152c");

    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      width * .5, height * .48, 1,
      width * .5, height * .48, height * .56
    );

    glow.addColorStop(0, "rgba(38,155,255,.18)");
    glow.addColorStop(1, "rgba(38,155,255,0)");

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (const s of stars) {
      ctx.globalAlpha =
        s.a * (.72 + .28 * Math.sin(now * .001 + s.x));

      ctx.fillStyle = "#d8fbff";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(79,170,255,.12)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, height * .53);
    ctx.lineTo(width, height * .53);

    for (let k = -10; k <= 10; k++) {
      ctx.moveTo(width / 2, height * .53);
      ctx.lineTo(width / 2 + k * width * .12, height);
    }

    for (let n = 1; n <= 8; n++) {
      const yy = height * .53 + Math.pow(n / 8, 2) * height * .48;
      ctx.moveTo(0, yy);
      ctx.lineTo(width, yy);
    }

    ctx.stroke();
  }

  function drawTrack() {
    const far = Math.floor(worldZ + 39);
    const near = Math.floor(worldZ);

    for (let r = far; r >= near; r--) {
      const row = getRow(r);
      const dz = r - worldZ;

      if (dz < .1) continue;

      for (let lane = 0; lane < LANES; lane++) {
        if (!row[lane]) continue;

        const [ax, ay] = project(lane - 3.5, 0, dz);
        const [bx, by] = project(lane - 2.5, 0, dz);
        const [ex, ey] = project(lane - 3.5, 0, dz + 1);
        const [fx, fy] = project(lane - 2.5, 0, dz + 1);

        const shade = ((r + lane) & 1) ? 1 : 0;

        const top =
          `hsl(${190 + ((r >> 5) % 2) * 10}, 88%, ${22 + shade * 5}%)`;

        const side = `hsl(205, 90%, ${12 + shade * 3}%)`;

        poly([[ax, ay], [bx, by], [fx, fy], [ex, ey]], top);

        const sideHeight = Math.max(1, (40 - dz) / 30 * height * .025);

        poly([
          [ex, ey], [fx, fy],
          [fx, fy + sideHeight], [ex, ey + sideHeight]
        ], side);

        ctx.strokeStyle = "rgba(89,238,255,.20)";
        ctx.lineWidth = Math.max(.4, 1.2 / dz);

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.lineTo(fx, fy);
        ctx.stroke();
      }
    }
  }

  function drawPlayer() {
    const [px, py, s] = project(x, y + .34, CAMERA);
    const shadow = project(x, 0, CAMERA);

    ctx.fillStyle = "rgba(0,0,0,.38)";
    ctx.beginPath();
    ctx.ellipse(
      shadow[0], shadow[1],
      Math.max(5, s * .24), Math.max(2, s * .075),
      0, 0, Math.PI * 2
    );
    ctx.fill();

    const radius = Math.max(3, s * .12);

    ctx.save();
    ctx.shadowBlur = Math.min(32, radius * 2.8);
    ctx.shadowColor = "#62f7ff";

    const orb = ctx.createRadialGradient(
      px - radius * .35, py - radius * .4, 1,
      px, py, radius * 1.6
    );

    orb.addColorStop(0, "#ffffff");
    orb.addColorStop(.28, "#b4ffff");
    orb.addColorStop(.68, "#31d9ff");
    orb.addColorStop(1, "rgba(34,93,255,.05)");

    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(px, py, radius * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(83,232,255,.55)";
    ctx.lineWidth = Math.max(1, radius * .35);

    ctx.beginPath();
    ctx.moveTo(px, py + radius);
    ctx.lineTo(px - x * 3, py + radius * 3);
    ctx.stroke();
  }

  function draw(now) {
    ctx.save();

    if (shake > 0) {
      ctx.translate(
        (Math.random() - .5) * shake,
        (Math.random() - .5) * shake
      );
    }

    drawBackground(now);
    drawTrack();
    drawPlayer();

    ctx.restore();

    if (state === "running" && speed > .32) {
      ctx.strokeStyle =
        `rgba(110,235,255,${Math.min(.18, (speed - .32) * .3)})`;

      ctx.lineWidth = 1;

      for (let i = 0; i < 8; i++) {
        const sx = (i * 137 + now * .18) % width;
        const sy = (i * 83 + now * .5) % (height * .72);

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - 8 * speed, sy + 20 * speed);
        ctx.stroke();
      }
    }
  }

  function updateHud() {
    scoreEl.textContent = String(score).padStart(5, "0");
    distanceEl.textContent = Math.floor(distance).toLocaleString();
    bestEl.textContent = String(best).padStart(5, "0");
  }

  function startGame() {
    ensureAudio();
    resetWorld();

    state = "running";

    startOverlay.classList.add("hidden");
    pauseOverlay.classList.add("hidden");
    gameOverOverlay.classList.add("hidden");

    pauseBtn.textContent = "Ⅱ";
    pauseBtn.setAttribute("aria-label", "Pause game");

    hint.textContent = "Keep moving · jump the gaps";
    hint.style.opacity = ".82";

    lastTime = performance.now();
    beep(520, .12, "triangle", .045, 880);
  }

  function pauseGame() {
    if (state !== "running") return;

    state = "paused";
    pauseOverlay.classList.remove("hidden");
    pauseBtn.textContent = "▶";
  }

  function resumeGame() {
    if (state !== "paused") return;

    ensureAudio();
    state = "running";
    pauseOverlay.classList.add("hidden");
    pauseBtn.textContent = "Ⅱ";
    lastTime = performance.now();
  }

  function endGame() {
    if (state !== "running") return;

    state = "over";
    shake = 0;

    best = Math.max(best, score);

    try {
      localStorage.setItem("skyrace-best", String(best));
    } catch (_) {}

    $("finalScore").textContent = score.toLocaleString();
    $("finalDistance").textContent =
      Math.floor(distance).toLocaleString() + " m";
    $("finalBest").textContent = best.toLocaleString();
    $("finalSpeed").textContent = (speed / .20).toFixed(1) + "x";

    updateHud();

    gameOverOverlay.classList.remove("hidden");
    hint.textContent = "Run complete";

    beep(180, .4, "sawtooth", .06, 55);
  }

  function jump() {
    if (state === "ready" || state === "over") {
      startGame();
      return;
    }

    if (state !== "running") return;

    if (y <= .015) {
      vy = .145;
      beep(320, .08, "triangle", .025, 620);
    }
  }

  function moveInput(dt) {
    let direction = 0;

    if (keys.ArrowLeft || keys.a || keys.A || touch.left) {
      direction -= 1;
    }

    if (keys.ArrowRight || keys.d || keys.D || touch.right) {
      direction += 1;
    }

    x += direction * Math.min(.105, dt * .0064);
    x = Math.max(-3.25, Math.min(3.25, x));
  }

  function update(dt) {
    if (state !== "running") return;

    dt = Math.min(dt, 34);
    elapsed += dt;

    const step = dt / (1000 / 60);

    moveInput(dt);

    vy -= .0065 * step;
    y += vy * step;

    if (y < 0) {
      y = 0;
      vy = 0;
    }

    const oldZ = worldZ;

    speed = Math.min(.49, .20 + worldZ / 5200);
    topSpeed = Math.max(topSpeed, speed / .20);

    worldZ += speed * step;
    distance = worldZ * 1.8;
    score = Math.floor(distance * 10);

    const rowIndex = Math.floor(worldZ + CAMERA);
    const lane = Math.max(0, Math.min(LANES - 1, Math.round(x + 3)));
    const row = getRow(rowIndex);

    if (y <= .02 && !row[lane]) {
      endGame();
      return;
    }

    if (
      y === 0 &&
      oldZ !== worldZ &&
      !getRow(Math.floor(worldZ + CAMERA + 1))[lane] &&
      speed > .3
    ) {
      // The next support check handles the gap.
    }

    shake = Math.max(0, shake - step * .7);
    updateHud();
  }

  $("startBtn").addEventListener("click", startGame);

  $("howBtn").addEventListener("click", () => {
    hint.textContent = "Move: A/D or arrows · Jump: Space / W / ↑";
    hint.style.opacity = "1";
  });

  $("restartBtn").addEventListener("click", startGame);
  $("restartPauseBtn").addEventListener("click", startGame);
  $("resumeBtn").addEventListener("click", resumeGame);

  pauseBtn.addEventListener("click", () => {
    ensureAudio();

    if (state === "running") pauseGame();
    else if (state === "paused") resumeGame();
  });

  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? "♫" : "♪̸";

    soundBtn.setAttribute(
      "aria-label", soundOn ? "Mute sound" : "Enable sound"
    );

    if (soundOn) {
      ensureAudio();
      beep(600, .08, "sine", .03, 800);
    }
  });

  $("jumpBtn").addEventListener("pointerdown", e => {
    e.preventDefault();
    ensureAudio();
    jump();
  });

  document.querySelectorAll("[data-hold]").forEach(btn => {
    const dir = btn.dataset.hold;

    const down = e => {
      e.preventDefault();
      ensureAudio();
      touch[dir] = true;
      btn.classList.add("pressed");
    };

    const up = e => {
      e.preventDefault();
      touch[dir] = false;
      btn.classList.remove("pressed");
    };

    btn.addEventListener("pointerdown", down);

    ["pointerup", "pointercancel", "pointerleave"].forEach(ev => {
      btn.addEventListener(ev, up);
    });
  });

  addEventListener("keydown", e => {
    const k = e.key;

    if ([
      "ArrowLeft", "ArrowRight", "ArrowUp", " ",
      "a", "A", "d", "D", "w", "W"
    ].includes(k)) {
      e.preventDefault();
    }

    keys[k] = true;

    if (
      (k === " " || k === "ArrowUp" || k === "w" || k === "W") &&
      !e.repeat
    ) {
      ensureAudio();
      jump();
    }

    if (k === "p" || k === "P") {
      if (state === "running") pauseGame();
      else if (state === "paused") resumeGame();
    }

    if (k === "r" || k === "R") startGame();

    if (k === "Escape" && state === "running") pauseGame();
  });

  addEventListener("keyup", e => {
    keys[e.key] = false;
  });

  addEventListener("blur", () => {
    keys = Object.create(null);
    touch.left = false;
    touch.right = false;

    if (state === "running") pauseGame();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "running") pauseGame();
  });

  resetWorld();

  function frame(now) {
    const dt = lastTime ? now - lastTime : 16.67;

    lastTime = now;
    update(dt);
    draw(now);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
