/**
 * SENJU Mode — 3D Scene Pack
 * ==========================
 * 11 canvas visuals that replace the old Fibonacci sphere / solar system.
 * All vanilla 2D-canvas (no libraries), all react to SENJU's voice state:
 *   idle → calm  ·  listening → alert  ·  thinking → fast  ·  speaking → pulses with her voice
 *
 * Loaded by index.html before renderer.js; renderer drives it via window.SenjuScenes.
 * Scene interface: { id, name, init(env), draw(env), click(x, y, env) → text|null }
 * env = { ctx, W, H, t, dt, hue, energy, bands, status, mouse, scale, data, hsl }
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function hsl(h, s, l, a) {
    return 'hsla(' + ((h % 360) + 360) % 360 + ',' + s + '%,' + l + '%,' + (a == null ? 1 : a) + ')';
  }

  // Cheap smooth noise (sum of sines) — enough for organic wobble
  function noise(x, y) {
    return (
      Math.sin(x * 1.7 + y * 0.8) * 0.5 +
      Math.sin(x * 0.7 - y * 1.9 + 1.3) * 0.3 +
      Math.sin(x * 2.9 + y * 2.1 + 4.2) * 0.2
    );
  }

  function rotY(p, a) { var c = Math.cos(a), s = Math.sin(a); return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }; }
  function rotX(p, a) { var c = Math.cos(a), s = Math.sin(a); return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; }

  function project(p, env, persp) {
    persp = persp || 900;
    var f = persp / (persp + p.z);
    return { x: env.W / 2 + p.x * f * env.scale, y: env.H / 2 + p.y * f * env.scale, f: f };
  }

  // status → intensity multipliers
  function mood(env) {
    switch (env.status) {
      case 'thinking': return { speed: 2.4, glow: 1.25, jitter: 0.5 };
      case 'speaking': return { speed: 1.2 + env.energy * 0.8, glow: 1.2 + env.energy * 0.9, jitter: env.energy };
      case 'listening': return { speed: 1.15, glow: 1.05, jitter: 0.12 };
      case 'error': return { speed: 0.6, glow: 0.8, jitter: 0.9 };
      default: return { speed: 1, glow: 1, jitter: 0 };
    }
  }

  function bandAvg(env, from, to) {
    if (!env.bands || !env.bands.length) return 0;
    var a = Math.floor(env.bands.length * from), b = Math.max(a + 1, Math.floor(env.bands.length * to)), s = 0;
    for (var i = a; i < b; i++) s += env.bands[i];
    return s / (b - a) / 255;
  }

  function centerGlow(env, r, strength) {
    var g = env.ctx.createRadialGradient(env.W / 2, env.H / 2, 0, env.W / 2, env.H / 2, r);
    g.addColorStop(0, hsl(env.hue, 100, 65, 0.16 * strength));
    g.addColorStop(0.6, hsl(env.hue + 30, 100, 55, 0.05 * strength));
    g.addColorStop(1, 'transparent');
    env.ctx.fillStyle = g;
    env.ctx.fillRect(0, 0, env.W, env.H);
  }

  var R = function (env) { return Math.min(env.W, env.H) * 0.3; };

  // ════════════════════════════════════════════════════════
  // 1. PLASMA ORB — SENJU's living core
  // ════════════════════════════════════════════════════════
  var orb = {
    id: 'orb', name: 'Plasma Orb',
    init: function () { this.arcs = []; },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env), r = R(env) * 0.85;
      var cx = env.W / 2, cy = env.H / 2, t = env.t * m.speed;
      centerGlow(env, r * 2.2, m.glow);

      // blobby plasma surface: many radial slices displaced by noise + voice
      ctx.save();
      for (var layer = 0; layer < 3; layer++) {
        var lr = r * (0.62 + layer * 0.19);
        ctx.beginPath();
        for (var i = 0; i <= 90; i++) {
          var a = (i / 90) * TAU;
          var n = noise(Math.cos(a) * 1.6 + t * 0.5 + layer * 7, Math.sin(a) * 1.6 - t * 0.4);
          var rr = lr * (1 + n * 0.09 + env.energy * 0.12 * Math.sin(a * 5 + t * 6));
          var x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = hsl(env.hue + layer * 22, 100, 62 + layer * 8, 0.5 - layer * 0.12);
        ctx.lineWidth = 2 - layer * 0.5;
        ctx.shadowBlur = 22 * m.glow;
        ctx.shadowColor = hsl(env.hue, 100, 60, 0.8);
        ctx.stroke();
        if (layer === 0) {
          var fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, lr);
          fill.addColorStop(0, hsl(env.hue, 100, 72, 0.28 * m.glow));
          fill.addColorStop(1, hsl(env.hue + 40, 90, 40, 0.04));
          ctx.fillStyle = fill;
          ctx.fill();
        }
      }
      ctx.restore();

      // lightning arcs while thinking
      if (env.status === 'thinking' && Math.random() < 0.3) {
        this.arcs.push({ a: Math.random() * TAU, life: 1 });
      }
      for (var k = this.arcs.length - 1; k >= 0; k--) {
        var arc = this.arcs[k];
        arc.life -= env.dt * 3;
        if (arc.life <= 0) { this.arcs.splice(k, 1); continue; }
        ctx.beginPath();
        var steps = 7, px = cx, py = cy;
        ctx.moveTo(px, py);
        for (var sIdx = 1; sIdx <= steps; sIdx++) {
          var d = (sIdx / steps) * r * 1.05;
          var wob = (Math.random() - 0.5) * 26;
          px = cx + Math.cos(arc.a + wob / 200) * d + Math.cos(arc.a + Math.PI / 2) * wob;
          py = cy + Math.sin(arc.a + wob / 200) * d + Math.sin(arc.a + Math.PI / 2) * wob;
          ctx.lineTo(px, py);
        }
        ctx.strokeStyle = hsl(env.hue + 60, 100, 80, arc.life * 0.9);
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 12;
        ctx.shadowColor = hsl(env.hue + 60, 100, 70, 0.9);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    },
  };

  // ════════════════════════════════════════════════════════
  // 2. PARTICLE BLOOM — particles form a lotus/silhouette, scatter on speech
  // ════════════════════════════════════════════════════════
  var bloom = {
    id: 'bloom', name: 'Particle Bloom',
    init: function (env) {
      this.pts = [];
      var r = R(env);
      for (var i = 0; i < 700; i++) {
        // rose curve (k=5 lotus) + inner circle → home positions
        var a = Math.random() * TAU;
        var k = 5;
        var rr = i % 3 === 0 ? r * 0.35 * Math.sqrt(Math.random()) : r * Math.abs(Math.cos(k * a)) * (0.55 + Math.random() * 0.45);
        this.pts.push({
          hx: Math.cos(a) * rr, hy: Math.sin(a) * rr,
          x: (Math.random() - 0.5) * env.W, y: (Math.random() - 0.5) * env.H,
          vx: 0, vy: 0, s: 0.6 + Math.random() * 1.6, ph: Math.random() * TAU,
        });
      }
    },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env), cx = env.W / 2, cy = env.H / 2;
      centerGlow(env, R(env) * 1.6, m.glow * 0.7);
      var scatter = env.status === 'speaking' ? env.energy * 90 : env.status === 'thinking' ? 25 : 0;
      var rot = env.t * 0.15 * m.speed;
      for (var i = 0; i < this.pts.length; i++) {
        var p = this.pts[i];
        var hxr = p.hx * Math.cos(rot) - p.hy * Math.sin(rot);
        var hyr = p.hx * Math.sin(rot) + p.hy * Math.cos(rot);
        var tx = hxr + Math.cos(p.ph + env.t * 2) * scatter;
        var ty = hyr + Math.sin(p.ph * 1.3 + env.t * 2) * scatter;
        p.vx += (tx - p.x) * 0.04; p.vy += (ty - p.y) * 0.04;
        p.vx *= 0.86; p.vy *= 0.86;
        p.x += p.vx; p.y += p.vy;
        var d = Math.sqrt(p.x * p.x + p.y * p.y) / R(env);
        ctx.fillStyle = hsl(env.hue + d * 50, 95, 60 + 20 * Math.sin(p.ph + env.t * 3), 0.75);
        ctx.fillRect(cx + p.x * env.scale, cy + p.y * env.scale, p.s, p.s);
      }
    },
  };

  // ════════════════════════════════════════════════════════
  // 3. GALAXY — spiral arms that dance with voice frequencies
  // ════════════════════════════════════════════════════════
  var galaxy = {
    id: 'galaxy', name: 'Galaxy',
    init: function (env) {
      this.stars = [];
      var arms = 4;
      for (var i = 0; i < 900; i++) {
        var arm = i % arms;
        var d = Math.pow(Math.random(), 0.65);            // denser near center
        this.stars.push({
          d: d, arm: arm,
          off: (Math.random() - 0.5) * 0.5 * (1 - d * 0.5),
          s: Math.random() < 0.08 ? 2.2 : 1.1,
          tw: Math.random() * TAU,
        });
      }
    },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env), r = R(env) * 1.35;
      centerGlow(env, r * 0.5, m.glow * 1.3);
      var spin = env.t * 0.12 * m.speed;
      var tilt = 0.45 + (env.mouse.y - 0.5) * 0.5;
      for (var i = 0; i < this.stars.length; i++) {
        var st = this.stars[i];
        var band = bandAvg(env, st.d * 0.8, st.d * 0.8 + 0.2);
        var lift = band * 60 * (env.status === 'speaking' || env.status === 'listening' ? 1 : 0.25);
        var a = st.arm * (TAU / 4) + st.d * 5.2 + st.off + spin / (0.35 + st.d);
        var p3 = { x: Math.cos(a) * st.d * r, y: (noise(st.d * 9, st.arm) * 8 - lift), z: Math.sin(a) * st.d * r };
        p3 = rotX(p3, tilt);
        var pr = project(p3, env);
        var tw = 0.55 + 0.45 * Math.sin(st.tw + env.t * 3);
        ctx.fillStyle = hsl(env.hue + st.d * 70, 90, 55 + band * 35, (0.9 - st.d * 0.4) * tw);
        var sz = st.s * pr.f * (1 + band);
        ctx.fillRect(pr.x, pr.y, sz, sz);
      }
    },
  };

  // ════════════════════════════════════════════════════════
  // 4. GYROSCOPE — nested wireframe rings
  // ════════════════════════════════════════════════════════
  var gyro = {
    id: 'gyro', name: 'Gyroscope',
    init: function () {},
    draw: function (env) {
      var ctx = env.ctx, m = mood(env), r = R(env) * 0.9;
      var cx = env.W / 2, cy = env.H / 2, t = env.t * m.speed;
      centerGlow(env, r * 1.6, m.glow);

      // core
      var pul = 1 + env.energy * 0.5 + (env.status === 'thinking' ? 0.15 * Math.sin(t * 10) : 0);
      var core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.22 * pul);
      core.addColorStop(0, hsl(env.hue, 100, 80, 0.95));
      core.addColorStop(1, 'transparent');
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.22 * pul, 0, TAU); ctx.fill();

      var rings = [
        { rad: r * 0.55, ax: t * 0.9, ay: t * 0.6, w: 2.4, hueOff: 0 },
        { rad: r * 0.78, ax: -t * 0.5, ay: t * 1.1, w: 1.8, hueOff: 25 },
        { rad: r * 1.0, ax: t * 0.35 + 1, ay: -t * 0.8, w: 1.3, hueOff: 50 },
      ];
      for (var k = 0; k < rings.length; k++) {
        var rg = rings[k];
        ctx.beginPath();
        for (var i = 0; i <= 100; i++) {
          var a = (i / 100) * TAU;
          var p3 = { x: Math.cos(a) * rg.rad, y: Math.sin(a) * rg.rad, z: 0 };
          p3 = rotX(rotY(p3, rg.ay), rg.ax);
          var pr = project(p3, env);
          i ? ctx.lineTo(pr.x, pr.y) : ctx.moveTo(pr.x, pr.y);
        }
        ctx.strokeStyle = env.status === 'error'
          ? hsl(0, 90, 55, 0.8)
          : hsl(env.hue + rg.hueOff, 95, 62, 0.8);
        ctx.lineWidth = rg.w;
        ctx.shadowBlur = 14 * m.glow;
        ctx.shadowColor = hsl(env.hue + rg.hueOff, 100, 60, 0.8);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // marker dot running on the ring
        var ma = (t * (1.5 + k * 0.4)) % TAU;
        var mp = rotX(rotY({ x: Math.cos(ma) * rg.rad, y: Math.sin(ma) * rg.rad, z: 0 }, rg.ay), rg.ax);
        var mpr = project(mp, env);
        ctx.fillStyle = hsl(env.hue + rg.hueOff + 30, 100, 82, 0.95);
        ctx.beginPath(); ctx.arc(mpr.x, mpr.y, 3.2 * mpr.f, 0, TAU); ctx.fill();
      }
    },
  };

  // ════════════════════════════════════════════════════════
  // 5. DNA HELIX
  // ════════════════════════════════════════════════════════
  var dna = {
    id: 'dna', name: 'DNA Helix',
    init: function () {},
    draw: function (env) {
      var ctx = env.ctx, m = mood(env);
      var h = Math.min(env.H * 0.72, 640), rad = R(env) * 0.42;
      var t = env.t * m.speed;
      centerGlow(env, R(env) * 1.2, m.glow * 0.6);
      var twist = 3.4 + env.energy * 1.2;
      var N = 46;
      var pts = [];
      for (var i = 0; i <= N; i++) {
        var y = (i / N - 0.5) * h;
        var a = (i / N) * twist * TAU * 0.5 + t;
        var p1 = rotY({ x: Math.cos(a) * rad, y: y, z: Math.sin(a) * rad }, (env.mouse.x - 0.5) * 1.2);
        var p2 = rotY({ x: Math.cos(a + Math.PI) * rad, y: y, z: Math.sin(a + Math.PI) * rad }, (env.mouse.x - 0.5) * 1.2);
        pts.push([project(p1, env), project(p2, env), p1.z]);
      }
      // rungs
      for (var i = 0; i < pts.length; i += 2) {
        var q = pts[i];
        ctx.strokeStyle = hsl(env.hue + 40, 80, 60, 0.35 + 0.3 * (q[2] < 0 ? 1 : 0));
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.stroke();
      }
      // strands
      for (var srd = 0; srd < 2; srd++) {
        ctx.beginPath();
        for (var i = 0; i < pts.length; i++) {
          var pp = pts[i][srd];
          i ? ctx.lineTo(pp.x, pp.y) : ctx.moveTo(pp.x, pp.y);
        }
        ctx.strokeStyle = hsl(env.hue + srd * 45, 95, 63, 0.85);
        ctx.lineWidth = 2.4;
        ctx.shadowBlur = 12 * m.glow;
        ctx.shadowColor = hsl(env.hue + srd * 45, 100, 60, 0.8);
        ctx.stroke();
        ctx.shadowBlur = 0;
        for (var i = 0; i < pts.length; i++) {
          var pp = pts[i][srd];
          ctx.fillStyle = hsl(env.hue + srd * 45 + i * 2, 95, 70, 0.9);
          ctx.beginPath(); ctx.arc(pp.x, pp.y, 2.6 * pp.f, 0, TAU); ctx.fill();
        }
      }
    },
  };

  // ════════════════════════════════════════════════════════
  // 6. VOICE TUNNEL — your voice shapes the rings flying past
  // ════════════════════════════════════════════════════════
  var tunnel = {
    id: 'tunnel', name: 'Voice Tunnel',
    init: function () { this.rings = []; this.acc = 0; },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env);
      this.acc += env.dt;
      if (this.acc > 0.07) {
        this.acc = 0;
        var shape = [];
        for (var b = 0; b < 24; b++) shape.push(env.bands ? (env.bands[Math.floor(b / 24 * env.bands.length * 0.7)] / 255) : 0);
        this.rings.push({ z: 900, e: env.energy, shape: shape, hue: env.hue });
      }
      var speed = 260 * m.speed;
      for (var i = this.rings.length - 1; i >= 0; i--) {
        var rg = this.rings[i];
        rg.z -= speed * env.dt;
        if (rg.z < -700) { this.rings.splice(i, 1); continue; }
        var base = R(env) * 0.85;
        ctx.beginPath();
        for (var sgm = 0; sgm <= 48; sgm++) {
          var a = sgm / 48 * TAU;
          var amp = rg.shape[sgm % 24] * base * 0.3 * (0.3 + rg.e);
          var rr = base + amp * Math.sin(a * 6 + rg.z / 60);
          var pr = project({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, z: rg.z }, env);
          sgm ? ctx.lineTo(pr.x, pr.y) : ctx.moveTo(pr.x, pr.y);
        }
        ctx.closePath();
        var near = 1 - Math.abs(rg.z) / 900;
        ctx.strokeStyle = hsl(rg.hue + rg.z * 0.05, 95, 60, 0.05 + near * 0.5);
        ctx.lineWidth = 1 + near * 1.6;
        ctx.stroke();
      }
      centerGlow(env, R(env) * 0.5, m.glow);
    },
  };

  // ════════════════════════════════════════════════════════
  // 7. TIMETABLE ORRERY — subjects orbit as planets (size = attendance)
  // ════════════════════════════════════════════════════════
  var orrery = {
    id: 'orrery', name: 'Subject Orrery',
    init: function (env) {
      var subs = (env.data.attendance && env.data.attendance.subjects) || [];
      var exams = (env.data.exams && env.data.exams.exams) || [];
      this.planets = subs.slice(0, 10).map(function (s2, i) {
        var exam = exams.find(function (e) { return e.subject === s2.subject && e.daysLeft >= 0; });
        return {
          name: (s2.code || s2.subject).replace(/\s+/g, ' '),
          full: s2.subject, pct: s2.pct, advice: s2.advice, level: s2.level,
          orbit: R(env) * (0.42 + i * 0.16),
          size: 6 + ((s2.pct == null ? 60 : s2.pct) / 100) * 12,
          speed: 0.5 / (1 + i * 0.35),
          phase: (i * 2.4) % TAU,
          examDays: exam ? exam.daysLeft : null,
          sx: 0, sy: 0,
        };
      });
    },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env), cx = env.W / 2, cy = env.H / 2;
      var tilt = 1.05 + (env.mouse.y - 0.5) * 0.6;
      centerGlow(env, R(env) * 0.7, m.glow * 1.4);

      // SENJU sun
      var sunR = R(env) * 0.14 * (1 + env.energy * 0.4);
      var sun = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR * 1.8);
      sun.addColorStop(0, hsl(env.hue, 100, 82, 1));
      sun.addColorStop(0.5, hsl(env.hue, 100, 60, 0.5));
      sun.addColorStop(1, 'transparent');
      ctx.fillStyle = sun;
      ctx.beginPath(); ctx.arc(cx, cy, sunR * 1.8, 0, TAU); ctx.fill();

      if (!this.planets.length) {
        ctx.fillStyle = hsl(env.hue, 60, 75, 0.8);
        ctx.font = '13px Nunito, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Timetable me subjects add karo — har subject ek planet banega', cx, cy + R(env) * 1.2);
        return;
      }

      for (var i = 0; i < this.planets.length; i++) {
        var pl = this.planets[i];
        // orbit line
        ctx.beginPath();
        ctx.ellipse(cx, cy, pl.orbit * env.scale, pl.orbit * Math.cos(tilt) * env.scale, 0, 0, TAU);
        ctx.strokeStyle = hsl(env.hue, 60, 55, 0.14);
        ctx.lineWidth = 1;
        ctx.stroke();

        var a = pl.phase + env.t * pl.speed * m.speed;
        var x = cx + Math.cos(a) * pl.orbit * env.scale;
        var y = cy + Math.sin(a) * pl.orbit * Math.cos(tilt) * env.scale;
        pl.sx = x; pl.sy = y;

        var danger = pl.level === 'danger' || (pl.examDays != null && pl.examDays <= 3);
        var hueP = danger ? 0 : pl.level === 'warning' ? 45 : env.hue + i * 14;
        var g = ctx.createRadialGradient(x, y, 0, x, y, pl.size * 2);
        g.addColorStop(0, hsl(hueP, 95, 70, 0.95));
        g.addColorStop(0.55, hsl(hueP, 95, 55, 0.5));
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, pl.size * 2, 0, TAU); ctx.fill();

        if (pl.examDays != null) {
          var ping = 1 + 0.35 * Math.sin(env.t * (pl.examDays <= 3 ? 8 : 3));
          ctx.strokeStyle = hsl(danger ? 0 : 45, 100, 65, 0.8);
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, pl.size * 1.6 * ping, 0, TAU); ctx.stroke();
        }

        ctx.fillStyle = hsl(0, 0, 92, 0.9);
        ctx.font = '10px Orbitron, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(pl.name + (pl.pct != null ? ' · ' + pl.pct + '%' : ''), x, y + pl.size * 2 + 12);
        if (pl.examDays != null) {
          ctx.fillStyle = hsl(danger ? 0 : 45, 95, 70, 0.95);
          ctx.fillText('EXAM ' + (pl.examDays === 0 ? 'TODAY' : 'IN ' + pl.examDays + 'D'), x, y + pl.size * 2 + 24);
        }
      }
    },
    click: function (x, y, env) {
      for (var i = 0; i < this.planets.length; i++) {
        var pl = this.planets[i];
        if (Math.hypot(x - pl.sx, y - pl.sy) < Math.max(28, pl.size * 2.4)) {
          return pl.full + (pl.pct != null ? ', ' + pl.pct + ' percent. ' : '. ') + (pl.advice || '') +
            (pl.examDays != null ? ' Exam ' + (pl.examDays === 0 ? 'aaj hai!' : pl.examDays + ' din me hai.') : '');
        }
      }
      return null;
    },
  };

  // ════════════════════════════════════════════════════════
  // 8. ATTENDANCE RINGS — Iron-Man style progress rings
  // ════════════════════════════════════════════════════════
  var rings = {
    id: 'rings', name: 'Attendance Rings',
    init: function (env) {
      this.subs = ((env.data.attendance && env.data.attendance.subjects) || [])
        .filter(function (s2) { return s2.pct != null; }).slice(0, 8);
      this.anim = 0;
    },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env), cx = env.W / 2, cy = env.H / 2;
      this.anim = Math.min(1, this.anim + env.dt * 0.7);
      var ease = 1 - Math.pow(1 - this.anim, 3);
      centerGlow(env, R(env) * 1.3, m.glow * 0.8);
      var target = (env.data.attendance && env.data.attendance.target) || 75;

      if (!this.subs.length) {
        ctx.fillStyle = hsl(env.hue, 60, 75, 0.8);
        ctx.font = '13px Nunito, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Attendance data nahi mila abhi', cx, cy);
        return;
      }
      var inner = R(env) * 0.28, step = (R(env) * 0.95 - inner) / this.subs.length;
      for (var i = 0; i < this.subs.length; i++) {
        var s2 = this.subs[i], rr = inner + i * step;
        var frac = Math.min(1, s2.pct / 100) * ease;
        var col = s2.level === 'danger' ? 0 : s2.level === 'warning' ? 45 : 150;
        var wob = env.status === 'speaking' ? env.energy * 4 * Math.sin(env.t * 9 + i) : 0;

        ctx.strokeStyle = hsl(col, 20, 30, 0.35);
        ctx.lineWidth = step * 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();

        ctx.strokeStyle = hsl(col === 150 ? env.hue : col, 95, 60, 0.95);
        ctx.lineCap = 'round';
        ctx.shadowBlur = 10 * m.glow;
        ctx.shadowColor = hsl(col === 150 ? env.hue : col, 100, 60, 0.9);
        ctx.beginPath();
        ctx.arc(cx, cy, rr + wob, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // target tick
        var ta = -Math.PI / 2 + (target / 100) * TAU;
        ctx.strokeStyle = hsl(0, 0, 90, 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ta) * (rr - step * 0.3), cy + Math.sin(ta) * (rr - step * 0.3));
        ctx.lineTo(cx + Math.cos(ta) * (rr + step * 0.3), cy + Math.sin(ta) * (rr + step * 0.3));
        ctx.stroke();

        ctx.fillStyle = hsl(0, 0, 88, 0.9);
        ctx.font = '10px Orbitron, monospace';
        ctx.textAlign = 'left';
        ctx.fillText((s2.code || s2.subject).slice(0, 18) + '  ' + s2.pct + '%', cx + rr * 0.05 + 8, cy - rr - 4);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = hsl(env.hue, 90, 75, 0.9);
      ctx.font = '12px Orbitron, monospace';
      var ov = env.data.attendance && env.data.attendance.overallPct;
      ctx.fillText(ov != null ? 'OVERALL ' + ov + '%' : '', cx, cy + 4);
    },
  };

  // ════════════════════════════════════════════════════════
  // 9. MEMORY CONSTELLATION — SENJU's memories as stars
  // ════════════════════════════════════════════════════════
  var constellation = {
    id: 'stars', name: 'Memory Constellation',
    init: function (env) {
      var mems = env.data.memories || [];
      this.stars = mems.slice(-40).map(function (m2, i) {
        var a = i * 2.399963, d = Math.sqrt(i + 1) / Math.sqrt(41);   // golden spiral spread
        return {
          x: Math.cos(a) * d, y: Math.sin(a) * d * 0.7,
          text: String(m2.text || '').slice(0, 60),
          tw: Math.random() * TAU, born: i / 41,
        };
      });
      this.dust = [];
      for (var i = 0; i < 120; i++) this.dust.push({ x: Math.random(), y: Math.random(), s: Math.random() * 1.4 + 0.4, tw: Math.random() * TAU });
      this.hover = -1;
    },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env);
      var rx = env.W * 0.42, ry = env.H * 0.4, cx = env.W / 2, cy = env.H / 2;
      for (var i = 0; i < this.dust.length; i++) {
        var d2 = this.dust[i];
        ctx.fillStyle = hsl(env.hue, 50, 70, 0.15 + 0.15 * Math.sin(d2.tw + env.t));
        ctx.fillRect(d2.x * env.W, d2.y * env.H, d2.s, d2.s);
      }
      if (!this.stars.length) {
        ctx.fillStyle = hsl(env.hue, 60, 75, 0.8);
        ctx.font = '13px Nunito, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('SENJU ko kuch yaad karwao — har memory ek sitara banegi ✨', cx, cy);
        return;
      }
      this.hover = -1;
      var pos = [];
      for (var i = 0; i < this.stars.length; i++) {
        var st = this.stars[i];
        var wob = noise(i * 3.1, env.t * 0.15) * 6;
        var x = cx + st.x * rx + wob, y = cy + st.y * ry + wob;
        pos.push([x, y]);
        if (Math.hypot(env.mouse.x * env.W - x, env.mouse.y * env.H - y) < 26) this.hover = i;
      }
      // links between neighbouring memories
      ctx.lineWidth = 1;
      for (var i = 1; i < pos.length; i++) {
        var j = i - 1;
        ctx.strokeStyle = hsl(env.hue, 80, 65, 0.12 + (this.hover === i || this.hover === j ? 0.35 : 0));
        ctx.beginPath(); ctx.moveTo(pos[j][0], pos[j][1]); ctx.lineTo(pos[i][0], pos[i][1]); ctx.stroke();
      }
      for (var i = 0; i < pos.length; i++) {
        var st = this.stars[i];
        var tw = 0.6 + 0.4 * Math.sin(st.tw + env.t * (2 + m.jitter * 3));
        var sz = (i === this.stars.length - 1 ? 3.4 : 2.2) * tw * (this.hover === i ? 1.8 : 1);
        ctx.fillStyle = hsl(env.hue + st.born * 60, 95, 78, 0.95);
        ctx.shadowBlur = 8 * m.glow;
        ctx.shadowColor = hsl(env.hue, 100, 70, 0.9);
        ctx.beginPath(); ctx.arc(pos[i][0], pos[i][1], sz, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (this.hover >= 0) {
        ctx.fillStyle = hsl(0, 0, 95, 0.95);
        ctx.font = '12px Nunito, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('“' + this.stars[this.hover].text + '”', cx, env.H - 90);
      }
    },
  };

  // ════════════════════════════════════════════════════════
  // 10. SAKURA STORM — petals that dance with her voice
  // ════════════════════════════════════════════════════════
  var sakura = {
    id: 'sakura', name: 'Sakura Storm',
    init: function (env) {
      this.petals = [];
      for (var i = 0; i < 160; i++) {
        this.petals.push({
          x: Math.random() * env.W, y: Math.random() * env.H,
          z: Math.random(),
          fall: 18 + Math.random() * 30,
          drift: Math.random() * TAU,
          spin: Math.random() * TAU,
          size: 4 + Math.random() * 7,
        });
      }
    },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env), cx = env.W / 2, cy = env.H / 2;
      centerGlow(env, R(env) * 1.4, m.glow * 0.5);
      var vortex = env.status === 'speaking' ? env.energy * 1.6 : env.status === 'thinking' ? 0.6 : 0.08;
      for (var i = 0; i < this.petals.length; i++) {
        var p = this.petals[i];
        var depth = 0.4 + p.z * 0.8;
        // swirl toward/around center when SENJU talks
        var dx = p.x - cx, dy = p.y - cy;
        var dist = Math.max(60, Math.hypot(dx, dy));
        var a = Math.atan2(dy, dx) + (vortex * 60 / dist) * env.dt * 60;
        var pull = vortex * 26 * env.dt * 60 / Math.sqrt(dist);
        p.x = cx + Math.cos(a) * (dist - pull);
        p.y = cy + Math.sin(a) * (dist - pull) + p.fall * depth * env.dt * (1 - vortex * 0.5);
        p.x += Math.sin(env.t * 1.3 + p.drift) * 22 * env.dt * 3;
        p.spin += env.dt * (1.5 + vortex * 5);
        if (p.y > env.H + 20) { p.y = -20; p.x = Math.random() * env.W; }
        if (p.x < -30) p.x = env.W + 20; if (p.x > env.W + 30) p.x = -20;

        var s2 = p.size * depth * (0.8 + 0.2 * Math.sin(p.spin));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.scale(1, 0.6 + 0.4 * Math.sin(p.spin * 1.7));
        ctx.fillStyle = hsl(env.hue + (p.z - 0.5) * 24, 85, 68 + p.z * 14, 0.5 + depth * 0.4);
        ctx.beginPath();
        ctx.moveTo(0, -s2);
        ctx.quadraticCurveTo(s2, -s2 * 0.3, 0, s2);
        ctx.quadraticCurveTo(-s2, -s2 * 0.3, 0, -s2);
        ctx.fill();
        ctx.restore();
      }
    },
  };

  // ════════════════════════════════════════════════════════
  // 11. FLOATING SHRINE — lantern night that follows your clock
  // ════════════════════════════════════════════════════════
  var shrine = {
    id: 'shrine', name: 'Floating Shrine',
    init: function (env) {
      this.lanterns = [];
      for (var i = 0; i < 26; i++) {
        this.lanterns.push({
          x: Math.random(), y: 0.15 + Math.random() * 0.75,
          z: Math.random(), ph: Math.random() * TAU,
          v: 6 + Math.random() * 12,
        });
      }
      this.stars = [];
      for (var i = 0; i < 90; i++) this.stars.push({ x: Math.random(), y: Math.random() * 0.55, tw: Math.random() * TAU });
    },
    draw: function (env) {
      var ctx = env.ctx, m = mood(env);
      var hr = new Date().getHours() + new Date().getMinutes() / 60;
      var night = Math.min(1, Math.max(0, Math.cos((hr - 13) / 12 * Math.PI) * -1 * 0.5 + 0.5)); // 0 day → 1 night
      // sky
      var sky = ctx.createLinearGradient(0, 0, 0, env.H);
      sky.addColorStop(0, 'hsla(' + (250 - night * 20) + ', 60%, ' + (26 - night * 18) + '%, 0.55)');
      sky.addColorStop(1, 'hsla(' + env.hue + ', 55%, ' + (14 - night * 8) + '%, 0.35)');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, env.W, env.H);
      // stars at night
      for (var i = 0; i < this.stars.length; i++) {
        var st = this.stars[i];
        ctx.fillStyle = hsl(50, 40, 90, night * (0.3 + 0.4 * Math.sin(st.tw + env.t * 2)));
        ctx.fillRect(st.x * env.W, st.y * env.H, 1.4, 1.4);
      }
      // moon / sun
      var mx = env.W * 0.78, my = env.H * 0.2;
      var mg = ctx.createRadialGradient(mx, my, 0, mx, my, 70);
      mg.addColorStop(0, night > 0.5 ? 'hsla(48, 60%, 88%, 0.95)' : 'hsla(38, 100%, 70%, 0.9)');
      mg.addColorStop(1, 'transparent');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(mx, my, 70, 0, TAU); ctx.fill();
      // mountain layers (parallax with mouse)
      for (var l = 0; l < 3; l++) {
        var base = env.H * (0.68 + l * 0.1);
        var amp = 60 - l * 14;
        var off = (env.mouse.x - 0.5) * (30 - l * 8);
        ctx.beginPath();
        ctx.moveTo(-50, env.H);
        for (var x = -50; x <= env.W + 50; x += 22) {
          ctx.lineTo(x, base + noise((x + off * 10) / 160, l * 9) * amp);
        }
        ctx.lineTo(env.W + 50, env.H);
        ctx.closePath();
        ctx.fillStyle = 'hsla(' + (env.hue + 20) + ', 40%, ' + (12 - l * 3) + '%, ' + (0.55 + l * 0.15) + ')';
        ctx.fill();
      }
      // torii silhouette on the middle ridge
      var tx = env.W * 0.5 + (env.mouse.x - 0.5) * 22, ty = env.H * 0.66;
      ctx.strokeStyle = 'hsla(350, 70%, ' + (30 + night * 10) + '%, 0.9)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(tx - 34, ty); ctx.lineTo(tx - 30, ty - 52);
      ctx.moveTo(tx + 34, ty); ctx.lineTo(tx + 30, ty - 52);
      ctx.moveTo(tx - 46, ty - 52); ctx.lineTo(tx + 46, ty - 52);
      ctx.moveTo(tx - 40, ty - 64); ctx.quadraticCurveTo(tx, ty - 74, tx + 40, ty - 64);
      ctx.stroke();
      // lanterns rise; they flare when SENJU speaks
      for (var i = 0; i < this.lanterns.length; i++) {
        var L = this.lanterns[i];
        L.y -= (L.v * (1 + env.energy * 2)) * env.dt / env.H;
        if (L.y < -0.05) { L.y = 1.05; L.x = Math.random(); }
        var lx = L.x * env.W + Math.sin(env.t + L.ph) * 16;
        var ly = L.y * env.H;
        var sz = 3 + L.z * 6;
        var glow = 0.5 + 0.5 * Math.sin(env.t * 3 + L.ph) + env.energy;
        var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, sz * 4);
        lg.addColorStop(0, hsl(35, 100, 65, 0.5 * glow * m.glow));
        lg.addColorStop(1, 'transparent');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(lx, ly, sz * 4, 0, TAU); ctx.fill();
        ctx.fillStyle = hsl(28, 95, 62, 0.9);
        ctx.fillRect(lx - sz / 2, ly - sz * 0.7, sz, sz * 1.4);
      }
    },
  };

  window.SenjuScenes = {
    list: [orb, bloom, galaxy, gyro, dna, tunnel, orrery, rings, constellation, sakura, shrine],
    byId: function (id) {
      for (var i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
      return null;
    },
    // voice keywords → scene id
    match: function (text) {
      var t = ' ' + text.toLowerCase() + ' ';
      var map = [
        [/orb|plasma|core/, 'orb'],
        [/bloom|lotus|flower|phool|particle/, 'bloom'],
        [/galaxy|akash ?ganga/, 'galaxy'],
        [/gyro|ring wala sphere|gyroscope/, 'gyro'],
        [/dna|helix/, 'dna'],
        [/tunnel|surang/, 'tunnel'],
        [/orrery|planet|solar|grah/, 'orrery'],
        [/attendance ring|rings mode|ring mode/, 'rings'],
        [/constellation|memory|sitare|taare|yaad/, 'stars'],
        [/sakura|petal|cherry/, 'sakura'],
        [/shrine|lantern|mandir|temple/, 'shrine'],
      ];
      for (var i = 0; i < map.length; i++) if (map[i][0].test(t)) return map[i][1];
      return null;
    },
  };
})();
