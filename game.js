const LANE_SCALE = 30.0;
const GRID_SIZE = 90.0;
const CURSOR_SIZE = 15.0;
const CLAMP_VAL = (GRID_SIZE / 2) - (CURSOR_SIZE / 2);

let HIT_Z = 0, NOTE_SPEED = 150.0, OFFSET = -0.250, SENSITIVITY = 1.2, SPAWN_DIST = 800.0;
const HIT_START = 0.015, MISS_GRACE = -0.015;

let scene, camera, renderer, cursor, chart = null, activeNotes = [], audio;
let lastFrame = 0, accumulator = 0, mouseX = 0, mouseY = 0, virtualX = 0, virtualY = 0;
let gameTime = 0, isCountingDown = false, countdownValue = 0;
let noteIdx = 0;

function notify(m) {
    const s = document.getElementById('msg-stack');
    if (!s) return;
    const d = document.createElement('div');
    d.className = 'msg'; d.innerText = m;
    s.prepend(d);
    setTimeout(() => d.remove(), 4000);
}

class Note {
    constructor(data) {
        this.time = data.time;
        this.tx = (data.x - 1) * LANE_SCALE;
        this.ty = (data.y - 1) * LANE_SCALE;
        this.hit = false;

        this.mesh = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide });
        const thickness = 2.0;
        const hG = new THREE.PlaneGeometry(25, thickness), vG = new THREE.PlaneGeometry(thickness, 25);

        const t = new THREE.Mesh(hG, mat), b = new THREE.Mesh(hG, mat);
        const l = new THREE.Mesh(vG, mat), r = new THREE.Mesh(vG, mat);

        t.position.y = 12.5; b.position.y = -12.5;
        l.position.x = -12.5; r.position.x = 12.5;

        this.mesh.add(t, b, l, r);
        scene.add(this.mesh);
    }
    update(t) {
        const err = this.time - t;
        let zPos = (err * NOTE_SPEED) + HIT_Z;
        if (zPos < HIT_Z) zPos = HIT_Z;
        this.mesh.position.set(this.tx, this.ty, zPos);
        this.mesh.visible = zPos < SPAWN_DIST && err > MISS_GRACE;
    }
    remove() { scene.remove(this.mesh); }
}

class Engine {
    init() {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
        camera.position.set(0, 0, -100);
        camera.lookAt(0, 0, 500);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);

        const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE));
        scene.add(new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({ color: 0x00ff88 })));

        // Fixed the syntax error here
        const curGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(CURSOR_SIZE, CURSOR_SIZE));
        cursor = new THREE.LineSegments(curGeo, new THREE.LineBasicMaterial({ color: 0xff00ff }));
        cursor.position.z = HIT_Z + 0.1;
        scene.add(cursor);

        window.onmousemove = (e) => {
            if (document.pointerLockElement) {
                virtualX -= e.movementX * (SENSITIVITY * 0.15);
                virtualY -= e.movementY * (SENSITIVITY * 0.15);
                mouseX = THREE.MathUtils.clamp(virtualX, -CLAMP_VAL, CLAMP_VAL);
                mouseY = THREE.MathUtils.clamp(virtualY, -CLAMP_VAL, CLAMP_VAL);
                virtualX = mouseX; virtualY = mouseY;
            }
        };

        this.bindEvents();
        requestAnimationFrame((t) => this.loop(t));
    }

    bindEvents() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) {
                el.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fn();
                };
            }
        };

        bind('nav-import', () => this.showMenu('import-menu'));
        bind('nav-settings', () => this.showMenu('settings-menu'));
        bind('confirm-import-button', () => this.doImport());
        bind('start-button', () => this.play());
        bind('save-settings', () => {
            NOTE_SPEED = parseFloat(document.getElementById('set-speed').value) || 150;
            SENSITIVITY = parseFloat(document.getElementById('set-sens').value) || 1.2;
            this.showMenu('start-menu');
            notify("Settings Saved.");
        });
    }

    showMenu(id) {
        document.querySelectorAll('.menu-card').forEach(m => m.style.display = 'none');
        const target = document.getElementById(id);
        if (target) target.style.display = 'block';
    }

    async doImport() {
        let raw = document.getElementById('map-input').value.trim();
        if (!raw) return notify("Input is empty.");

        if (raw.includes("github")) {
            try {
                const url = raw.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
                const res = await fetch(url);
                raw = await res.text();
            } catch(e) { return notify("GitHub Fetch Failed"); }
        }

        const idMatch = raw.match(/^\d+/);
        const idOnly = idMatch ? idMatch[0] : "0";
        const notes = [];
        raw.split(',').forEach(p => {
            const v = p.split('|').map(x => parseFloat(x));
            if (v.length === 3) notes.push({ x: v[0], y: v[1], time: v[2]/1000 });
        });

        if (notes.length === 0) return notify("No notes found.");

        chart = { id: idOnly, notes: notes.sort((a,b) => a.time - b.time) };
        noteIdx = 0;
        document.getElementById('map-name-display').innerText = `ID: ${chart.id}`;
        this.showMenu('start-menu');
        notify(`Imported ${notes.length} notes.`);
    }

    async play() {
        if (!chart) return;
        audio = document.getElementById('audio-track');
        const localPath = `assets/${chart.id}.mp3`;

        try {
            const test = await fetch(localPath, { method: 'HEAD' });
            audio.src = test.ok ? localPath : `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://assetdelivery.roblox.com/v1/asset/?id=${chart.id}`)}`;
        } catch (e) {
            audio.src = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://assetdelivery.roblox.com/v1/asset/?id=${chart.id}`)}`;
        }

        audio.oncanplaythrough = () => {
            noteIdx = 0; this.score = 0; this.combo = 0;
            activeNotes.forEach(n => n.remove()); activeNotes = [];
            isCountingDown = true; countdownValue = 3; gameTime = -3;
            document.querySelectorAll('.menu-card').forEach(m => m.style.display = 'none');
            renderer.domElement.requestPointerLock();
        };
        audio.load();
    }

    updatePhysics(delta) {
        if (isCountingDown) {
            countdownValue -= delta / 1000;
            gameTime += delta / 1000;
            if (countdownValue <= 0) { isCountingDown = false; audio.play(); }
        } else if (audio && !audio.paused) {
            gameTime = audio.currentTime;
        }

        const t = gameTime - OFFSET;
        if (chart) {
            while (noteIdx < chart.notes.length && t >= (chart.notes[noteIdx].time - (SPAWN_DIST / NOTE_SPEED))) {
                activeNotes.push(new Note(chart.notes[noteIdx++]));
            }
        }

        for (let i = activeNotes.length - 1; i >= 0; i--) {
            const n = activeNotes[i];
            n.update(t);
            const err = n.time - t;
            if (!n.hit && Math.abs(err) < HIT_START) {
                if (Math.abs(mouseX - n.tx) < 18 && Math.abs(mouseY - n.ty) < 18) {
                    n.hit = true; this.score += 100; this.combo++;
                    n.remove(); activeNotes.splice(i, 1);
                }
            } else if (err <= MISS_GRACE) {
                this.combo = 0; n.remove(); activeNotes.splice(i, 1);
            }
        }

        const sb = document.getElementById('score-board');
        if (sb) sb.innerText = isCountingDown ? `WAIT: ${Math.ceil(countdownValue)}` : `SCORE: ${this.score} | COMBO: ${this.combo}`;
    }

    loop(now) {
        requestAnimationFrame((t) => this.loop(t));
        accumulator += (now - lastFrame);
        lastFrame = now;
        while (accumulator >= 16.6) { this.updatePhysics(16.6); accumulator -= 16.6; }
        cursor.position.set(mouseX, mouseY, HIT_Z + 0.1);
        renderer.render(scene, camera);
    }
}

new Engine().init();
