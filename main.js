import * as THREE from 'three';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import * as Tone from 'tone';

// DOM Elements
const introOverlay = document.getElementById('intro-overlay');
const startBtn = document.getElementById('start-btn');
const uiOverlay = document.getElementById('ui-overlay');
const webcamElement = document.getElementById('webcam');
const canvasContainer = document.getElementById('canvas-container');

// Status UI Elements
const camStatus = document.getElementById('cam-status');
const camStatusDot = document.getElementById('cam-status-dot');
const handStatus = document.getElementById('hand-status');
const handStatusDot = document.getElementById('hand-status-dot');
const gestureNameEl = document.getElementById('gesture-name');

// App state
let isExperienceStarted = false;
let currentGesture = "None";
let lastGestureTime = 0;
let activeHands = []; // Array to store { joints: THREE.Vector3[], gesture: string }
let handMeshes = []; // Array of groups containing spheres for joints

// THREE.js
let scene, camera, renderer, particlesGeometry, particlesMaterial, particlesMesh;
const PARTICLE_COUNT = 5000;
const particlesData = [];

// MediaPipe
let gestureRecognizer;
let runningMode = "VIDEO";
let lastVideoTime = -1;

// Tone.js
let synth, filter, reverb;
let kickSynth, snareSynth, hihatSynth;
let pianoSynths = [];

// Instruments
let instrumentMeshes = [];
let lastHitTimes = {};

// Initialize when Start is clicked
startBtn.addEventListener('click', async () => {
    introOverlay.classList.add('hidden');
    uiOverlay.classList.remove('hidden');
    isExperienceStarted = true;

    await initAudio();
    initThree();
    await initWebcam();
    await initMediaPipe();

    animate();
});

// --- AUDIO SETUP (Tone.js) ---
async function initAudio() {
    await Tone.start();
    console.log('Tone.js audio context started');

    // Create a beautiful, spacey synthesizer for background chords
    filter = new Tone.Filter(200, "lowpass").toDestination();
    reverb = new Tone.Reverb({
        decay: 4,
        wet: 0.6
    }).connect(filter);

    synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: {
            attack: 0.1,
            decay: 0.2,
            sustain: 0.5,
            release: 2,
        }
    }).connect(reverb);

    // --- Drum Synths ---
    kickSynth = new Tone.MembraneSynth().toDestination();
    snareSynth = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0 }
    }).toDestination();
    hihatSynth = new Tone.MetalSynth({
        frequency: 200, envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5
    }).toDestination();

    // --- Piano Synths (one per key for polyphony without cutoffs) ---
    for (let i = 0; i < 8; i++) {
        pianoSynths.push(new Tone.Synth({
            oscillator: { type: "triangle" },
            envelope: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 1 }
        }).toDestination());
    }
}

const GESTURE_CHORDS = {
    "Closed_Fist": ["C4", "Eb4", "G4"], // C minor - tense/closed
    "Open_Palm": ["C4", "E4", "G4", "B4"], // C maj7 - open/bright
    "Pointing_Up": ["G4", "D5"], // High sharp notes
    "Thumb_Up": ["C4", "F4", "A4"], // F major - positive
    "Thumb_Down": ["C3", "Eb3", "Gb3"], // C diminished - negative/dark
    "Victory": ["G4", "B4", "D5"], // G major - victory
    "ILoveYou": ["Eb4", "G4", "Bb4", "D5"], // Eb maj7 - sweet
};

function playGestureSound(gesture) {
    // Disabled old gesture chord sounds to focus on virtual instruments
    // If you want them back, you can uncomment this
    /*
    const now = Tone.now();
    if (now - lastGestureTime < 0.5) return;
    if (GESTURE_CHORDS[gesture]) {
        synth.triggerAttackRelease(GESTURE_CHORDS[gesture], "4n", now);
        lastGestureTime = now;
    }
    */
}

// --- THREE.JS SETUP ---
function initThree() {
    scene = new THREE.Scene();
    // Add some subtle fog
    scene.fog = new THREE.FogExp2(0x050510, 0.05);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 10;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvasContainer.appendChild(renderer.domElement);

    // Particles
    particlesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);

    const color1 = new THREE.Color(0xff00cc);
    const color2 = new THREE.Color(0x3333ff);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const x = (Math.random() - 0.5) * 40;
        const y = (Math.random() - 0.5) * 40;
        const z = (Math.random() - 0.5) * 40;

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // Mixed colors
        const mixedColor = color1.clone().lerp(color2, Math.random());
        colors[i * 3] = mixedColor.r;
        colors[i * 3 + 1] = mixedColor.g;
        colors[i * 3 + 2] = mixedColor.b;

        particlesData.push({
            velocity: new THREE.Vector3((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02),
            originalPos: new THREE.Vector3(x, y, z),
            phase: Math.random() * Math.PI * 2
        });
    }

    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Custom circular particle material
    particlesMaterial = new THREE.PointsMaterial({
        size: 0.15,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.8,
    });

    particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particlesMesh);

    createInstruments();

    window.addEventListener('resize', onWindowResize);
}

function createInstruments() {
    // Piano Keys (8 keys, one octave C4 to C5)
    const notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
    const keyWidth = 1.6;
    const spacing = 0.4;
    const totalWidth = (8 * keyWidth) + (7 * spacing);
    const startX = -(totalWidth / 2) + (keyWidth / 2);

    const keyGeometry = new THREE.BoxGeometry(keyWidth, 0.5, 4);

    for (let i = 0; i < 8; i++) {
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3,
            wireframe: true
        });
        const keyMesh = new THREE.Mesh(keyGeometry, material);
        // Move to Z=0 so they are on the exact same depth plane as the hand
        keyMesh.position.set(startX + i * (keyWidth + spacing), -5, 0);

        // Custom properties for interaction
        keyMesh.userData = {
            type: 'piano',
            note: notes[i],
            synthIndex: i,
            baseColor: 0xffffff,
            hitColor: 0x00ffcc,
            id: `piano_${i}`
        };

        scene.add(keyMesh);
        instrumentMeshes.push(keyMesh);
        lastHitTimes[keyMesh.userData.id] = 0;
    }

    // Drum Pads (Kick, Snare, Hi-Hat)
    const padGeometry = new THREE.CylinderGeometry(1.6, 1.6, 0.2, 32);
    padGeometry.rotateX(Math.PI / 2); // Face the camera

    const drums = [
        { name: 'Kick', pos: new THREE.Vector3(-8, 2, 0), color: 0xff3366, sound: () => kickSynth.triggerAttackRelease("C1", "8n") },
        { name: 'Snare', pos: new THREE.Vector3(8, 2, 0), color: 0x3333ff, sound: () => snareSynth.triggerAttackRelease("16n") },
        { name: 'HiHat', pos: new THREE.Vector3(0, 5, 0), color: 0xffff00, sound: () => hihatSynth.triggerAttackRelease("32n") }
    ];

    drums.forEach((drum, i) => {
        const material = new THREE.MeshBasicMaterial({
            color: drum.color,
            transparent: true,
            opacity: 0.4,
            wireframe: true
        });
        const padMesh = new THREE.Mesh(padGeometry, material);
        padMesh.position.copy(drum.pos);

        padMesh.userData = {
            type: 'drum',
            name: drum.name,
            baseColor: drum.color,
            hitColor: 0xffffff,
            playSound: drum.sound,
            id: `drum_${drum.name}`
        };

        scene.add(padMesh);
        instrumentMeshes.push(padMesh);
        lastHitTimes[padMesh.userData.id] = 0;
    });
}

function createHandMesh() {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    const geometry = new THREE.SphereGeometry(0.15, 16, 16); // Made joint spheres smaller

    // MediaPipe has 21 landmarks per hand
    for (let i = 0; i < 21; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        group.add(mesh);
    }

    scene.add(group);
    return group;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- WEBCAM & MEDIAPIPE SETUPS ---
async function initMediaPipe() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
                delegate: "GPU"
            },
            runningMode: runningMode,
            numHands: 2
        });
        console.log("Gesture Recognizer loaded");
    } catch (err) {
        console.error("Error loading MediaPipe:", err);
        handStatus.innerText = "Error Loading AI";
        handStatus.style.color = "#ff3366";
    }
}

async function initWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: "user" }
        });
        webcamElement.srcObject = stream;

        return new Promise((resolve) => {
            webcamElement.onloadedmetadata = () => {
                webcamElement.play();
                webcamElement.style.display = "block";
                camStatus.innerText = "Active";
                camStatusDot.classList.add("active");
                resolve();
            };
        });
    } catch (err) {
        console.error("Webcam access denied", err);
        camStatus.innerText = "Denied / Error";
    }
}

function processVideoFrame() {
    if (!gestureRecognizer) return;

    const nowInMs = Date.now();
    if (webcamElement.currentTime !== lastVideoTime) {
        lastVideoTime = webcamElement.currentTime;

        // Process hand gestures
        const results = gestureRecognizer.recognizeForVideo(webcamElement, nowInMs);

        if (results.gestures && results.gestures.length > 0) {
            handStatus.innerText = "Detected (" + results.gestures.length + ")";
            handStatusDot.classList.add("active");

            // Sync activeHands array length with detected hands
            while (activeHands.length < results.gestures.length) {
                const joints = Array(21).fill(0).map(() => new THREE.Vector3(0, 0, 50));
                activeHands.push({ joints: joints, gesture: "None" });
                handMeshes.push(createHandMesh());
            }
            while (activeHands.length > results.gestures.length) {
                activeHands.pop();
                const meshGroup = handMeshes.pop();
                scene.remove(meshGroup);
            }

            let gestureNames = [];

            results.gestures.forEach((gestureInfo, index) => {
                const gesture = gestureInfo[0].categoryName;
                gestureNames.push(gesture.replace('_', ' '));

                // Play sound if gesture changed for this hand (Disabled to focus on instruments)
                if (activeHands[index].gesture !== gesture) {
                    activeHands[index].gesture = gesture;
                    // playGestureSound(gesture);
                }

                // Extract 3D position from landmarks
                const landmarks = results.landmarks[index];

                // Track all 21 joints
                landmarks.forEach((landmark, i) => {
                    // MediaPipe X is 0 (left) to 1 (right) from the camera's perspective.
                    // Because we mirrored the video CSS (transform: scaleX(-1)), we must invert X here.
                    // Scale X and Y by larger numbers so the hand moves across the screen faster, 
                    // but make the actual distance between fingers smaller. 
                    const scaleFactor = 30; // Spread movement across entire screen width
                    const cx = -(landmark.x - 0.5) * scaleFactor;
                    const cy = -(landmark.y - 0.5) * (scaleFactor * 0.75); // aspect ratio compensation
                    const cz = (landmark.z || 0) * -10; // Simple depth heuristic

                    activeHands[index].joints[i].lerp(new THREE.Vector3(cx, cy, cz), 0.3);

                    // Update visual mesh
                    const jointMesh = handMeshes[index].children[i];
                    jointMesh.position.copy(activeHands[index].joints[i]);
                    jointMesh.visible = true;

                    // Highlight fingertips (4, 8, 12, 16, 20) with a different color/size if wanted
                    if ([4, 8, 12, 16, 20].includes(i)) {
                        jointMesh.scale.set(1.5, 1.5, 1.5);
                        jointMesh.material.color.setHex(0xff00ff);
                    } else {
                        jointMesh.scale.set(1, 1, 1);
                        jointMesh.material.color.setHex(0x00ffcc);
                    }
                });

                // Adjust Audio Filter based on first hand's palm Y position (landmark 9)
                if (index === 0 && filter) {
                    const palmY = activeHands[index].joints[9].y;
                    const cutoff = Math.max(100, Math.min(5000, 1000 + (palmY * 400)));
                    filter.frequency.rampTo(cutoff, 0.1);
                }
            });

            gestureNameEl.innerText = gestureNames.join(', ');

        } else {
            handStatus.innerText = "Not Detected";
            handStatusDot.classList.remove("active");
            gestureNameEl.innerText = "None";

            // Move all hands to a far distance and hide meshes
            activeHands.forEach((hand, index) => {
                hand.gesture = "None";
                hand.joints.forEach((joint, i) => {
                    joint.lerp(new THREE.Vector3(0, 0, 50), 0.1);
                    if (handMeshes[index] && handMeshes[index].children[i]) {
                        handMeshes[index].children[i].visible = false;
                    }
                });
            });
        }
    }
}

// --- MAIN LOOP ---
function animate() {
    requestAnimationFrame(animate);

    if (isExperienceStarted) {
        processVideoFrame();
        checkInstrumentCollisions();
    }

    // Animate Instruments (fade colors back to base)
    instrumentMeshes.forEach(mesh => {
        const currentOpct = mesh.material.opacity;
        if (currentOpct > (mesh.userData.type === 'piano' ? 0.3 : 0.4)) {
            mesh.material.opacity -= 0.02;
        }
        if (mesh.scale.x > 1.0) {
            mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
        }
    });

    // Animate Particles
    if (particlesMesh) {
        const time = performance.now() * 0.001;
        const positions = particlesMesh.geometry.attributes.position.array;

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            const pData = particlesData[i];

            // Current pos
            let vx = positions[i3];
            let vy = positions[i3 + 1];
            let vz = positions[i3 + 2];

            // Wavy chaotic movement
            vx += Math.sin(time + pData.phase) * 0.01;
            vy += Math.cos(time + pData.phase * 0.5) * 0.01;

            // Return to original slowly
            vx += (pData.originalPos.x - vx) * 0.001;
            vy += (pData.originalPos.y - vy) * 0.001;
            vz += (pData.originalPos.z - vz) * 0.001;

            // Interaction with Hands (Fingertips specifically)
            const fingertipIndices = [4, 8, 12, 16, 20]; // Thumb, Index, Middle, Ring, Pinky

            activeHands.forEach(hand => {
                if (hand.gesture === "None") return;

                fingertipIndices.forEach(fingerIdx => {
                    const fingerPos = hand.joints[fingerIdx];

                    const distToHand = Math.sqrt(
                        Math.pow(vx - fingerPos.x, 2) +
                        Math.pow(vy - fingerPos.y, 2) +
                        Math.pow(vz - fingerPos.z, 2)
                    );

                    if (distToHand < 4) {
                        // Less force per finger so it doesn't explode instantly
                        let force = (4 - distToHand) * 0.02;

                        if (hand.gesture === "Closed_Fist") {
                            // Attract to knuckles basically
                            vx -= (vx - fingerPos.x) * force * 0.1;
                            vy -= (vy - fingerPos.y) * force * 0.1;
                            vz -= (vz - fingerPos.z) * force * 0.1;
                        } else if (hand.gesture === "Open_Palm") {
                            // Repel strongly from fingertips
                            vx += (vx - fingerPos.x) * force;
                            vy += (vy - fingerPos.y) * force;
                            vz += (vz - fingerPos.z) * force;
                        } else {
                            // Swirl around fingertips
                            const rx = -(vy - fingerPos.y);
                            const ry = (vx - fingerPos.x);
                            vx += rx * force * 0.3;
                            vy += ry * force * 0.3;
                        }
                    }
                });
            });

            positions[i3] = vx;
            positions[i3 + 1] = vy;
            positions[i3 + 2] = vz;
        }

        particlesMesh.geometry.attributes.position.needsUpdate = true;

        // Slowly rotate the whole scene for ambient effect
        particlesMesh.rotation.y = time * 0.1;
        particlesMesh.rotation.z = time * 0.05;
    }

    renderer.render(scene, camera);
}

function checkInstrumentCollisions() {
    const now = Tone.now();
    // Ensure Tone.js is running (sometimes required in Chrome if AudioContext suspends)
    if (Tone.context.state !== 'running') {
        Tone.context.resume();
    }

    const hitDistance = 0.5; // Reduced significantly since fingers are now smaller and spread correctly

    activeHands.forEach(hand => {
        if (hand.gesture === "None") return;

        // Check fingertips against instruments
        const fingertipIndices = [4, 8, 12, 16, 20];

        fingertipIndices.forEach(fingerIdx => {
            const fingerPos = hand.joints[fingerIdx];

            instrumentMeshes.forEach(mesh => {
                let isHit = false;

                if (mesh.userData.type === 'piano') {
                    // Piano keys are rectangular and long. Just check X/Y planar distance to the center.
                    const dx = Math.abs(fingerPos.x - mesh.position.x);
                    const dy = Math.abs(fingerPos.y - mesh.position.y);
                    // keyWidth is 1.6 (from creation logic), height is around 0.5. 
                    // Give a generous hit box height so users don't have to be pixel-perfect.
                    if (dx < 0.8 && dy < 1.0) {
                        isHit = true;
                    }
                } else if (mesh.userData.type === 'drum') {
                    // Drums are circular pads, use 2D planar distance (XY)
                    const distXY = Math.sqrt(
                        Math.pow(fingerPos.x - mesh.position.x, 2) +
                        Math.pow(fingerPos.y - mesh.position.y, 2)
                    );
                    if (distXY < 1.6) { // Cylinder radius is 1.6
                        isHit = true;
                    }
                }

                if (isHit) {
                    triggerInstrument(mesh, now);
                }
            });
        });
    });
}

function triggerInstrument(mesh, time) {
    const id = mesh.userData.id;
    // Faster debounce (150ms) to prevent "sticky" feeling but fast enough for repeated hits
    if (time - lastHitTimes[id] > 0.15) {
        lastHitTimes[id] = time;

        // Visual feedback
        mesh.material.color.setHex(mesh.userData.hitColor);
        mesh.material.opacity = 0.8;
        mesh.scale.set(1.1, 1.1, 1.1); // Reduced from 1.2 to prevent visual overlapping triggering more hits

        // Audio feedback
        if (mesh.userData.type === 'piano') {
            pianoSynths[mesh.userData.synthIndex].triggerAttackRelease(mesh.userData.note, "8n", time);
        } else if (mesh.userData.type === 'drum') {
            mesh.userData.playSound();
        }
    }
}

// Debug manual trigger for testing audio
window.addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '8') {
        const idx = parseInt(e.key) - 1;
        const mesh = instrumentMeshes.find(m => m.userData.id === `piano_${idx}`);
        if (mesh) triggerInstrument(mesh, Tone.now());
    }
});
