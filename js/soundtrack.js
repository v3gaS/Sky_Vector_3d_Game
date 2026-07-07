/**
 * SkyVector generative ambient soundtrack — pure Web Audio synthesis, no assets.
 *
 * Graph:  pad(A/B groups) + arp plucks + sub + shimmer -> duck -> mute -> master(0.14) -> dest
 *         crash drone ------------------------------------------^ (bypasses duck)
 *
 * Oscillator budget: 6 pad + 1 LFO + 1 sub persistent (8); transient plucks/shimmer
 * decay under 2 s at >0.9 s spacing (<=3 live) + 2 crash-drone oscillators
 * (plucks pause while crashed) — worst case 13, always under 14.
 */
(function () {
    'use strict';

    const MASTER_LEVEL = 0.14;
    const GROUP_LEVEL = 0.3;          // per pad voice-group gain at full fade
    const SUB_LEVEL = 0.12;           // ~ -18 dB
    const LOOKAHEAD = 0.4;            // seconds of notes kept scheduled ahead
    const BEAT_DUR = 60 / 66;         // ~66 bpm feel
    const CUTOFF_MIN = 700;
    const CUTOFF_MAX = 1400;

    // 3-note pad voicings as MIDI notes; first note is the chord root.
    const DAY_CHORDS = [
        [60, 64, 71],                 // Cmaj7
        [59, 62, 67],                 // G/B
        [57, 64, 67],                 // Am7
        [53, 64, 71]                  // Fmaj7#11
    ];
    const NIGHT_CHORDS = [
        [45, 52, 59],                 // Am(add9)
        [43, 50, 59],                 // G
        [41, 48, 57],                 // F
        [40, 52, 59]                  // Em
    ];
    const DAY_PENTA = [64, 67, 69, 72, 74, 76, 79, 81];      // C major pentatonic
    const NIGHT_PENTA = [52, 55, 57, 60, 62, 64, 67];        // A minor pentatonic, lower
    const DAY_SPARKLE = [88, 91, 93, 96];
    const NIGHT_SPARKLE = [84, 88, 91];

    function midiToFreq(m) {
        return 440 * Math.pow(2, (m - 69) / 12);
    }

    function clamp01(v) {
        return Math.max(0, Math.min(1, v));
    }

    // Equal-power crossfade curves, shared by every chord change (WebAudio copies them).
    const CROSS_N = 48;
    const fadeInCurve = new Float32Array(CROSS_N);
    const fadeOutCurve = new Float32Array(CROSS_N);
    for (let i = 0; i < CROSS_N; i++) {
        const t = i / (CROSS_N - 1);
        fadeInCurve[i] = Math.sin(t * Math.PI * 0.5) * GROUP_LEVEL;
        fadeOutCurve[i] = Math.cos(t * Math.PI * 0.5) * GROUP_LEVEL;
    }

    // ---- audio state (built lazily once ctx.audio() yields a context) ----
    let ac = null;
    let built = false;
    let master = null;
    let mute = null;
    let duck = null;
    let padFilter = null;
    let pluckBus = null;
    let subOsc = null;
    let padGroups = null;             // [{ gain, oscs: [osc, osc, osc] }, ...]
    let activeGroup = 0;
    let chordIdx = 0;
    let curChord = DAY_CHORDS[0];
    let nextChordTime = 0;
    let nextBeatTime = 0;
    let nextShimmerTime = 0;
    let lastArpNote = -1;
    let cutoff = 900;
    let droneOscs = null;
    let droneGain = null;
    let wasCrashed = false;

    // ---- UI state ----
    let muted = false;
    let muteFlashUntil = 0;

    function buildGraph(audioCtx) {
        ac = audioCtx;
        master = ac.createGain();
        master.gain.value = MASTER_LEVEL;
        master.connect(ac.destination);
        mute = ac.createGain();
        mute.gain.value = muted ? 0 : 1;
        mute.connect(master);
        duck = ac.createGain();
        duck.gain.value = 1;
        duck.connect(mute);

        // PAD: two crossfading voice groups of 3 detuned oscillators through one lowpass
        padFilter = ac.createBiquadFilter();
        padFilter.type = 'lowpass';
        padFilter.frequency.value = cutoff;
        padFilter.Q.value = 0.7;
        padFilter.connect(duck);
        const lfo = ac.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.06;
        const lfoGain = ac.createGain();
        lfoGain.gain.value = 130;
        lfo.connect(lfoGain);
        lfoGain.connect(padFilter.frequency);
        lfo.start();

        const types = ['triangle', 'sine', 'triangle'];
        const detunes = [-7, 4, 9];
        padGroups = [];
        for (let g = 0; g < 2; g++) {
            const gain = ac.createGain();
            gain.gain.value = g === 0 ? GROUP_LEVEL : 0;
            gain.connect(padFilter);
            const oscs = [];
            for (let i = 0; i < 3; i++) {
                const osc = ac.createOscillator();
                osc.type = types[i];
                osc.detune.value = detunes[i];
                osc.frequency.value = midiToFreq(curChord[i]);
                osc.connect(gain);
                osc.start();
                oscs.push(osc);
            }
            padGroups.push({ gain, oscs });
        }

        // SUB: quiet sine root an octave below the pad
        subOsc = ac.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.value = midiToFreq(curChord[0] - 12);
        const subGain = ac.createGain();
        subGain.gain.value = SUB_LEVEL;
        subOsc.connect(subGain);
        subGain.connect(duck);
        subOsc.start();

        // ARP + SHIMMER share one bus; envelopes carry their levels
        pluckBus = ac.createGain();
        pluckBus.gain.value = 1;
        pluckBus.connect(duck);

        const now = ac.currentTime;
        nextChordTime = now + 7 + Math.random() * 3;
        nextBeatTime = now + 1;
        nextShimmerTime = now + 3;
        built = true;
    }

    function scheduleChordChange(when, night) {
        const table = night > 0.5 ? NIGHT_CHORDS : DAY_CHORDS;
        chordIdx = (chordIdx + 1 + Math.floor(Math.random() * (table.length - 1))) % table.length;
        curChord = table[chordIdx];
        const incoming = padGroups[1 - activeGroup];
        const outgoing = padGroups[activeGroup];
        const now = ac.currentTime;
        const setAt = Math.max(now, when - 0.05);
        for (let i = 0; i < 3; i++) {
            // incoming group is silent, so re-pitching it here is clickless
            incoming.oscs[i].frequency.setValueAtTime(midiToFreq(curChord[i]), setAt);
        }
        const fadeDur = 2 + Math.random();
        outgoing.gain.gain.setValueCurveAtTime(fadeOutCurve, when, fadeDur);
        incoming.gain.gain.setValueCurveAtTime(fadeInCurve, when, fadeDur);
        subOsc.frequency.setTargetAtTime(midiToFreq(curChord[0] - 12), when, 0.6);
        activeGroup = 1 - activeGroup;
    }

    function schedulePluck(when, night) {
        const table = night > 0.5 ? NIGHT_PENTA : DAY_PENTA;
        let note = table[Math.floor(Math.random() * table.length)];
        if (note === lastArpNote) {
            note = table[(table.indexOf(note) + 1) % table.length];
        }
        lastArpNote = note;
        const vel = (night > 0.5 ? 0.13 : 0.2) * (0.8 + Math.random() * 0.35);
        const decay = 1.1 + Math.random() * 0.4;
        spawnVoice(when, midiToFreq(note), vel, decay, 0.015);
    }

    function scheduleShimmer(when, night) {
        const table = night > 0.5 ? NIGHT_SPARKLE : DAY_SPARKLE;
        const note = table[Math.floor(Math.random() * table.length)];
        spawnVoice(when, midiToFreq(note), 0.035, 1.8 + Math.random() * 0.5, 0.03);
    }

    // One-shot sine voice: attack -> exponential decay, self-stopping.
    function spawnVoice(when, freq, vel, decay, attack) {
        const osc = ac.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = (Math.random() - 0.5) * 10;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(vel, when + attack);
        g.gain.exponentialRampToValueAtTime(0.0006, when + decay);
        osc.connect(g);
        g.connect(pluckBus);
        osc.start(when);
        osc.stop(when + decay + 0.05);
        osc.onended = function () {
            osc.disconnect();
            g.disconnect();
        };
    }

    function rampParam(param, target, now, dur) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(target, now + dur);
    }

    function startCrashDrone() {
        const now = ac.currentTime;
        rampParam(duck.gain, 0.25, now, 0.4);
        if (droneOscs) return;
        droneGain = ac.createGain();
        droneGain.gain.setValueAtTime(0.0001, now);
        droneGain.gain.linearRampToValueAtTime(0.16, now + 0.5);
        droneGain.connect(mute);                       // bypass duck so the drone stays audible
        droneOscs = [55, 65.41].map(function (f) {     // A1 + C2, low minor color
            const osc = ac.createOscillator();
            osc.type = f < 60 ? 'triangle' : 'sine';
            osc.frequency.value = f;
            osc.connect(droneGain);
            osc.start(now);
            return osc;
        });
    }

    function endCrashDrone() {
        const now = ac.currentTime;
        rampParam(duck.gain, 1, now, 2);
        if (!droneOscs) return;
        rampParam(droneGain.gain, 0.0001, now, 0.8);
        for (let i = 0; i < droneOscs.length; i++) {
            droneOscs[i].stop(now + 0.85);
        }
        droneOscs = null;
        droneGain = null;
    }

    function applyMute() {
        rampParam(mute.gain, muted ? 0 : 1, ac.currentTime, 0.3);
    }

    const mod = {
        name: 'soundtrack',

        init(ctx) {
            // Audio is gesture-gated; the graph is built lazily in update().
        },

        update(dt, ctx) {
            if (!built) {
                const audioCtx = ctx.audio();
                if (!audioCtx) return;
                buildGraph(audioCtx);
            }

            // crash reactivity: duck + low drone on rising edge, restore on clear
            const crashed = ctx.plane.crashed;
            if (crashed && !wasCrashed) startCrashDrone();
            if (!crashed && wasCrashed) endCrashDrone();
            wasCrashed = crashed;

            // speed -> brightness: smooth the lowpass cutoff (LFO wobble sums on top)
            const speedT = clamp01((ctx.plane.speed - 45) / 185);
            const target = CUTOFF_MIN + speedT * (CUTOFF_MAX - CUTOFF_MIN);
            cutoff += (target - cutoff) * Math.min(1, dt * 2.5);
            padFilter.frequency.value = cutoff;

            // lookahead scheduler — keep LOOKAHEAD seconds of events queued
            const now = ac.currentTime;
            const horizon = now + LOOKAHEAD;
            const night = ctx.time.night;

            if (nextChordTime < now - 1) nextChordTime = now + 0.2;   // catch up after pauses
            while (nextChordTime < horizon) {
                scheduleChordChange(nextChordTime, night);
                nextChordTime += 7 + Math.random() * 3;
            }

            if (nextBeatTime < now - 0.5) nextBeatTime = now;
            const restProb = 0.6 - night * 0.18;                      // generative rests, sparser at night
            while (nextBeatTime < horizon) {
                if (!crashed && Math.random() < restProb) {
                    schedulePluck(nextBeatTime, night);
                }
                nextBeatTime += BEAT_DUR;
            }

            if (ctx.time.dusk > 0.4) {
                if (nextShimmerTime < now) nextShimmerTime = now + 0.3;
                if (!crashed && nextShimmerTime < horizon) {
                    scheduleShimmer(nextShimmerTime, night);
                    nextShimmerTime += 2 + Math.random() * 2;
                }
            } else {
                nextShimmerTime = Math.max(nextShimmerTime, now + 2);
            }
        },

        drawHUD(hud, ctx) {
            if (performance.now() > muteFlashUntil) return;
            const c = hud.ctx2d;
            const w = 58;
            const h = 24;
            const x = hud.w - w - 14;
            const y = hud.h - h - 14;
            const remain = (muteFlashUntil - performance.now()) / 1000;
            c.save();
            c.globalAlpha = Math.min(1, remain / 0.4);                // fade out at the end
            hud.panel(x, y, w, h, 8);
            c.font = '11px ' + hud.mono;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillStyle = muted ? hud.colors.warn : hud.colors.accent;
            c.fillText('♪ M', x + w * 0.5, y + h * 0.5 + 0.5);
            if (muted) {
                c.strokeStyle = hud.colors.warn;
                c.lineWidth = 1.5;
                c.beginPath();
                c.moveTo(x + 12, y + h - 6);
                c.lineTo(x + w - 12, y + 6);
                c.stroke();
            }
            c.restore();
        },

        onKey(code, ctx) {
            if (code !== 'KeyM') return false;
            muted = !muted;
            muteFlashUntil = performance.now() + 3000;
            if (built) applyMute();
            return true;
        }
    };

    (window.SkyVectorMods = window.SkyVectorMods || []).push(mod);
})();
