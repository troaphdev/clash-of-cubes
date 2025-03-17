import * as THREE from 'https://cdn.skypack.dev/three@0.152.2';

/* --------------------------------------------------
   1) BACKGROUND BLOBS (optional decorative effect)
-------------------------------------------------- */
const blobsContainer = document.querySelector('.blobs-container');
const numBlobs = 4; // total of 4 blobs: 2 on the left, 2 on the right

for (let i = 0; i < numBlobs; i++) {
  const blob = document.createElement('div');
  blob.className = 'blob';
  
  // Random size between 200px and 500px
  const size = Math.floor(Math.random() * 300) + 200;
  blob.style.width = size + 'px';
  blob.style.height = size + 'px';
  
  // Position left half or right half
  if (i < 2) {
    blob.style.left = Math.random() * 50 + '%';
  } else {
    blob.style.left = (50 + Math.random() * 50) + '%';
  }
  blob.style.top = Math.random() * 100 + '%';
  
  // Random pastel color w/ alpha
  blob.style.background = `rgba(${Math.floor(Math.random() * 255)}, 
                                ${Math.floor(Math.random() * 255)}, 
                                ${Math.floor(Math.random() * 255)}, 
                                0.6)`;
  
  blobsContainer.appendChild(blob);
  
  // Animate position every 4 seconds
  setInterval(() => {
    if (i < 2) {
      blob.style.left = Math.random() * 50 + '%';
    } else {
      blob.style.left = (50 + Math.random() * 50) + '%';
    }
    blob.style.top = Math.random() * 100 + '%';
  }, 4000);
}

/* --------------------------------------------------
   2) SIDEBAR EXPAND/COLLAPSE
-------------------------------------------------- */
const expandBtn = document.querySelector('.expand-sidebar-btn');
const sidebar = document.querySelector('.sidebar');

expandBtn.addEventListener('click', () => {
  sidebar.classList.toggle('expanded');
});

/* --------------------------------------------------
   3) PEER-TO-PEER CONNECTION USING PEERJS
-------------------------------------------------- */
let myId = Math.random().toString(36).substr(2, 8);
document.getElementById('my-id').textContent = myId;

let peer = null;
let conn = null;
let roomId = null;
let isHost = false;
let teamAssigned = false;
let teamRequestTimeout = null;

/**
 * initializePeer: sets up the Peer object (optionally with a given ID).
 */
function initializePeer(id = null) {
  peer = new Peer(id, {
    // If you have your own PeerJS server, specify it here:
    // host: 'your-peerjs-server.com',
    // port: 9000,
    // path: '/myapp'
  });
  peer.on('open', (id) => {
    console.log('Peer open with ID:', id);
  });
  // Host listens for incoming connections
  peer.on('connection', (incomingConn) => {
    console.log("Host received connection:", incomingConn);
    if (!conn) {
      conn = incomingConn;
      setupConnection();
    }
  });
  peer.on('error', (err) => {
    console.error(err);
    alert("PeerJS error: " + err);
  });
}

/**
 * setupConnection: called once a P2P connection is established (host or client).
 * Hides the UI and starts the game logic.
 */
function setupConnection() {
  // Listen for data from the remote peer
  conn.on('data', (data) => {
    if (data.sender === myId) return; // ignore messages we sent
    handleData(data);
  });
  document.getElementById('connection-status').textContent = "Connected!";

  // Now that we have a real connection, hide the panel & overview
  document.getElementById('connection-panel').style.display = 'none';
  document.getElementById('overview-screen').style.display = 'none';

  // Immediately send the local username so the remote knows your name
  const unameInput = document.getElementById('username').value.trim();
  if (unameInput !== "") {
    localUsername = unameInput;
  }
  sendMessage({ type: "username", username: localUsername });
  
  // If we are a client, request a team assignment from the host
  if (!isHost) {
    sendMessage({ type: "requestTeam" });
    teamRequestTimeout = setTimeout(() => {
      if (!teamAssigned) {
        console.log("No team assignment received, re-requesting...");
        sendMessage({ type: "requestTeam" });
      }
    }, 2000);
  }
}

/**
 * sendMessage: sends a JSON message to the remote peer
 */
function sendMessage(message) {
  message.sender = myId;
  if (conn && conn.open) {
    conn.send(message);
  } else {
    console.warn("No connection available to send message:", message);
  }
}

/* Create Room button */
document.getElementById('create-room').addEventListener('click', () => {
  roomId = document.getElementById('room-id').value.trim();
  if (!roomId) {
    // If no ID is provided, use our own ID as the "room"
    roomId = myId;
    document.getElementById('room-id').value = roomId;
  }
  isHost = true;
  initializePeer(roomId);
  document.getElementById('connection-status').textContent =
    "Room created: " + roomId + ". Waiting for connection...";
});

/* Join Room button */
document.getElementById('join-room').addEventListener('click', () => {
  roomId = document.getElementById('room-id').value.trim();
  if (!roomId) {
    alert("Please enter a Room ID to join");
    return;
  }
  isHost = false;
  initializePeer();
  if (peer && peer.id) {
    // If peer is already open, connect immediately
    connectToRoom();
  } else {
    // Otherwise wait for 'open' event
    peer.on('open', () => {
      connectToRoom();
    });
  }
});

/**
 * connectToRoom: client attempts to connect to a host's room
 */
function connectToRoom() {
  console.log("Joiner attempting to connect to room:", roomId);
  conn = peer.connect(roomId, { reliable: true });
  conn.on('open', () => {
    console.log("Joiner connection open");
    setupConnection();
  });
  conn.on('error', (err) => {
    console.error("Connection error:", err);
    alert("Connection error: " + err);
  });
  document.getElementById('connection-status').textContent =
    "Joined room: " + roomId + ". Connecting...";
}

/* --------------------------------------------------
   4) GAME CODE (Movement, Scoring, etc.)
-------------------------------------------------- */
let localPlayerScore = 0;
let remotePlayerScore = 0;

let gameStarted = false;
let gameEnded = false;
let countdownTime = 3;
const gravity = -30;
const jumpForce = 15;
const accelerationVal = 30;
const turnSpeed = 3;
const frictionVal = 10;
const maxSpeed = 20;
let playerSpeed = 0;

let runnerBonusTimer = 0;
let localReplay = false;
let remoteReplay = false;

let localTeam = null;   // "red" or "blue"
let remoteTeam = null;
let localUsername = "Player";
let remoteUsername = "Player";  // fallback if none provided

let localPlayer, remotePlayer;
let localNameTag, remoteNameTag; // attached after team assignment

// --------------------------------------------------
// COLLISION BOX ARRAYS
// --------------------------------------------------
const treeBoxes = [];
const buildingBoxes = [];
const platformBoxes = [];
const roofBoxes = [];
const borderBoxes = [];

// Helper: returns the player's AABB (assuming cube of size 2)
function getPlayerBox(player) {
  const size = 2;
  return new THREE.Box3(
    new THREE.Vector3(player.position.x - size/2, player.position.y - size/2, player.position.z - size/2),
    new THREE.Vector3(player.position.x + size/2, player.position.y + size/2, player.position.z + size/2)
  );
}

// --------------------------------------------------
// SCENE SETUP (THREE.JS)
// --------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  75, window.innerWidth / window.innerHeight, 0.1, 1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Insert the renderer's canvas into the body
document.body.appendChild(renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(20, 50, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.left = -100;
directionalLight.shadow.camera.right = 100;
directionalLight.shadow.camera.top = 100;
directionalLight.shadow.camera.bottom = -100;
scene.add(directionalLight);

// Terrain function
function getGroundHeightAt(x, z) {
  const frequency = 0.1, amplitude = 3;
  return Math.sin(x * frequency) * Math.cos(z * frequency) * amplitude;
}

// Ground mesh
const segments = 100;
const groundGeometry = new THREE.PlaneGeometry(200, 200, segments, segments);
groundGeometry.rotateX(-Math.PI / 2);
for (let i = 0; i < groundGeometry.attributes.position.count; i++) {
  let x = groundGeometry.attributes.position.getX(i);
  let z = groundGeometry.attributes.position.getZ(i);
  let y = getGroundHeightAt(x, z);
  groundGeometry.attributes.position.setY(i, y);
}
groundGeometry.computeVertexNormals();
const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.receiveShadow = true;
ground.castShadow = true;
scene.add(ground);

// --------------------------------------------------
// STATIC OBJECTS: TREES, PLATFORMS, & BUILDINGS
// (Parkour course, city roads, houses, etc.)
// --------------------------------------------------
function createTree(x, z) {
  const tree = new THREE.Group();
  const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.3, 3, 6);
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.position.y = 1.5;
  trunk.castShadow = true;
  tree.add(trunk);

  const leavesGeometry = new THREE.ConeGeometry(1.5, 4, 6);
  const leavesMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
  const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
  leaves.position.y = 4.5;
  leaves.castShadow = true;
  tree.add(leaves);

  tree.position.set(x, getGroundHeightAt(x, z), z);
  tree.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(tree);
  treeBoxes.push(box);
  return tree;
}

// Scatter some trees
for (let i = 0; i < 50; i++) {
  const rx = Math.random() * 180 - 90;
  const rz = Math.random() * 180 - 90;
  // Keep the central area clear
  if (Math.abs(rx) < 20 && Math.abs(rz) < 20) {
    i--;
    continue;
  }
  const t = createTree(rx, rz);
  scene.add(t);
}

function createPlatform(x, y, z, width, height, depth, color = 0x888888) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshLambertMaterial({ color });
  const platform = new THREE.Mesh(geometry, material);
  platform.castShadow = true;
  platform.receiveShadow = true;
  platform.position.set(x, y - height/2, z);
  scene.add(platform);
  platformBoxes.push(new THREE.Box3().setFromObject(platform));
  return platform;
}

// Example single platform
createPlatform(20, getGroundHeightAt(20, 0) + 2, 0, 4, 1, 4, 0xaaaaaa);

// Spiral Parkour
function createSpiralParkourCourse() {
  const numPlatforms = 30;
  const baseX = 20, baseZ = 0, baseY = getGroundHeightAt(20, 0) + 3;
  const spiralRadius = 10;
  const angleIncrement = Math.PI / 6;
  const heightIncrement = 2;
  for (let i = 0; i < numPlatforms; i++) {
    const angle = i * angleIncrement;
    const x = baseX + spiralRadius * Math.cos(angle);
    const z = baseZ + spiralRadius * Math.sin(angle);
    const y = baseY + i * heightIncrement;
    createPlatform(x, y, z, 2.5, 0.8, 2.5, 0xcccccc);
  }
  const finalAngle = numPlatforms * angleIncrement;
  const finalX = baseX + spiralRadius * Math.cos(finalAngle);
  const finalZ = baseZ + spiralRadius * Math.sin(finalAngle);
  const finalY = baseY + numPlatforms * heightIncrement;
  createPlatform(finalX, finalY, finalZ, 4, 1, 4, 0xffd700);
}
createSpiralParkourCourse();

// CITY: roads, houses, street lamps
function createRoad(x, z, width, length, rotation) {
  const roadGeometry = new THREE.PlaneGeometry(width, length);
  const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = rotation;
  const cityHeight = 0.9;
  road.position.set(x, cityHeight + 0.01, z);
  road.receiveShadow = true;
  road.updateMatrixWorld();
  let roadBox = new THREE.Box3().setFromObject(road);
  roadBox.min.y -= 0.1;
  roadBox.max.y += 0.1;
  platformBoxes.push(roadBox);
  return road;
}

function createHouse(x, z) {
  const cityHeight = 0.1;
  const houseGroup = new THREE.Group();
  const houseWidth = 10;
  const houseDepth = 10;
  const houseHeight = 8 + Math.random() * 12; // between 8 and 20
  
  // Base
  const baseGeometry = new THREE.BoxGeometry(houseWidth, houseHeight, houseDepth);
  const baseMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(Math.random(), Math.random(), Math.random()) });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = houseHeight / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  houseGroup.add(base);
  
  // Roof
  const roofHeight = houseHeight / 2;
  const roofGeometry = new THREE.ConeGeometry(houseWidth * 0.75, roofHeight, 4);
  const roofMaterial = new THREE.MeshLambertMaterial({ color: 0x8B0000 });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  const roofOffset = 0.05;
  roof.position.y = houseHeight + roofOffset + roofHeight / 2;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.receiveShadow = true;
  houseGroup.add(roof);
  
  houseGroup.position.set(x, cityHeight, z);
  
  // House collisions
  const thickness = 0.5;
  // Left wall
  const leftWall = new THREE.Box3(
    new THREE.Vector3(x - houseWidth/2, cityHeight, z - houseDepth/2),
    new THREE.Vector3(x - houseWidth/2 + thickness, cityHeight + houseHeight, z + houseDepth/2)
  );
  buildingBoxes.push(leftWall);
  // Right wall
  const rightWall = new THREE.Box3(
    new THREE.Vector3(x + houseWidth/2 - thickness, cityHeight, z - houseDepth/2),
    new THREE.Vector3(x + houseWidth/2, cityHeight + houseHeight, z + houseDepth/2)
  );
  buildingBoxes.push(rightWall);
  // Front wall
  const frontWall = new THREE.Box3(
    new THREE.Vector3(x - houseWidth/2, cityHeight, z + houseDepth/2 - thickness),
    new THREE.Vector3(x + houseWidth/2, cityHeight + houseHeight, z + houseDepth/2)
  );
  buildingBoxes.push(frontWall);
  // Back wall
  const backWall = new THREE.Box3(
    new THREE.Vector3(x - houseWidth/2, cityHeight, z - houseDepth/2),
    new THREE.Vector3(x + houseWidth/2, cityHeight + houseHeight, z - houseDepth/2 + thickness)
  );
  buildingBoxes.push(backWall);
  
  // Roof hitbox
  const roofFootprint = houseWidth * 0.8;
  const roofHitboxThickness = 0.2;
  const roofBottom = cityHeight + houseHeight + roofOffset;
  const roofTop = roofBottom + roofHitboxThickness;
  const roofHitbox = new THREE.Box3(
    new THREE.Vector3(x - roofFootprint/2, roofBottom, z - roofFootprint/2),
    new THREE.Vector3(x + roofFootprint/2, roofTop, z + roofFootprint/2)
  );
  roofBoxes.push(roofHitbox);
  
  return houseGroup;
}

function createStreetLamp(x, z) {
  const cityHeight = 0.1;
  const lampGroup = new THREE.Group();
  const poleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
  const poleMaterial = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const pole = new THREE.Mesh(poleGeometry, poleMaterial);
  pole.position.y = 2.5;
  pole.castShadow = true;
  lampGroup.add(pole);
  
  const lampGeometry = new THREE.BoxGeometry(0.8, 0.4, 0.8);
  const lampMaterial = new THREE.MeshLambertMaterial({ color: 0xffffe0 });
  const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
  lamp.position.y = 5.3;
  lamp.castShadow = true;
  lampGroup.add(lamp);
  
  lampGroup.position.set(x, cityHeight, z);
  return lampGroup;
}

function createCity() {
  const horizontalRoad = createRoad(0, 0, 20, 200, 0);
  scene.add(horizontalRoad);
  
  const verticalRoad = createRoad(0, 0, 20, 200, Math.PI / 2);
  scene.add(verticalRoad);
  
  const diagonalRoad = createRoad(0, 0, 15, 283, Math.PI / 4);
  scene.add(diagonalRoad);
  
  let housePositions = [];
  for (let i = 0; i < 15; i++) {
    let valid = false;
    let attempts = 0;
    let pos;
    while (!valid && attempts < 100) {
      pos = new THREE.Vector2(Math.random() * 150 - 75, Math.random() * 150 - 75);
      valid = true;
      for (let p of housePositions) {
        if (pos.distanceTo(p) < 15) {
          valid = false;
          break;
        }
      }
      attempts++;
    }
    if (valid) {
      housePositions.push(pos);
      let house = createHouse(pos.x, pos.y);
      scene.add(house);
    }
  }
  
  for (let i = -90; i <= 90; i += 20) {
    scene.add(createStreetLamp(i, 12));
    scene.add(createStreetLamp(i, -12));
    scene.add(createStreetLamp(12, i));
    scene.add(createStreetLamp(-12, i));
  }
}
createCity();

// --------------------------------------------------
// INVISIBLE MAP BORDERS
// --------------------------------------------------
function createInvisibleBorders() {
  const borderThickness = 1;
  const borderHeight = 50;
  const mapExtent = 100;
  const halfMap = mapExtent;
  
  const leftWallGeometry = new THREE.BoxGeometry(borderThickness, borderHeight, 200);
  const leftWallMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const leftWall = new THREE.Mesh(leftWallGeometry, leftWallMaterial);
  leftWall.position.set(-halfMap - borderThickness/2, borderHeight/2, 0);
  scene.add(leftWall);
  borderBoxes.push(new THREE.Box3().setFromObject(leftWall));
  
  const rightWallGeometry = new THREE.BoxGeometry(borderThickness, borderHeight, 200);
  const rightWallMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const rightWall = new THREE.Mesh(rightWallGeometry, rightWallMaterial);
  rightWall.position.set(halfMap + borderThickness/2, borderHeight/2, 0);
  scene.add(rightWall);
  borderBoxes.push(new THREE.Box3().setFromObject(rightWall));
  
  const frontWallGeometry = new THREE.BoxGeometry(200 + 2*borderThickness, borderHeight, borderThickness);
  const frontWallMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const frontWall = new THREE.Mesh(frontWallGeometry, frontWallMaterial);
  frontWall.position.set(0, borderHeight/2, -halfMap - borderThickness/2);
  scene.add(frontWall);
  borderBoxes.push(new THREE.Box3().setFromObject(frontWall));
  
  const backWallGeometry = new THREE.BoxGeometry(200 + 2*borderThickness, borderHeight, borderThickness);
  const backWallMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const backWall = new THREE.Mesh(backWallGeometry, backWallMaterial);
  backWall.position.set(0, borderHeight/2, halfMap + borderThickness/2);
  scene.add(backWall);
  borderBoxes.push(new THREE.Box3().setFromObject(backWall));
}
createInvisibleBorders();

// --------------------------------------------------
// FOLIAGE: BUSHES, FLOWERS, SHRUBS
// --------------------------------------------------
function createBush(x, z) {
  const bushGroup = new THREE.Group();
  const numSpheres = 4 + Math.floor(Math.random() * 3);
  let minY = Infinity;
  for (let i = 0; i < numSpheres; i++) {
    const radius = Math.random() * 0.3 + 0.7;
    const sphereGeometry = new THREE.SphereGeometry(radius, 12, 12);
    sphereGeometry.scale(1, 0.6, 1);
    const material = new THREE.MeshLambertMaterial({ 
      color: new THREE.Color(`hsl(${Math.random() * 20 + 100}, 50%, ${Math.random() * 20 + 40}%)`)
    });
    const sphere = new THREE.Mesh(sphereGeometry, material);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    const offsetX = Math.random() * 0.8 - 0.4;
    const offsetZ = Math.random() * 0.8 - 0.4;
    const sphereBottom = -radius * 0.6;
    const offsetY = sphereBottom + Math.random() * 0.2;
    sphere.position.set(offsetX, offsetY, offsetZ);
    bushGroup.add(sphere);
    if (sphere.position.y < minY) {
      minY = sphere.position.y;
    }
  }
  bushGroup.position.set(x, getGroundHeightAt(x, z) - minY, z);
  return bushGroup;
}

function createFlower(x, z) {
  const group = new THREE.Group();
  const stemHeight = Math.random() * 0.5 + 1;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 8),
    new THREE.MeshLambertMaterial({ color: 0x228B22 })
  );
  stem.position.y = stemHeight / 2;
  group.add(stem);
  
  const numPetals = 5;
  const petalLength = 0.3;
  const petalWidth = 0.15;
  const petalGeometry = new THREE.BoxGeometry(petalWidth, petalLength, 0.01);
  const flowerColors = [0xFF69B4, 0xFF1493, 0xFFFF00, 0xFF4500, 0xFFA500];
  const petalMaterial = new THREE.MeshLambertMaterial({ color: flowerColors[Math.floor(Math.random() * flowerColors.length)] });
  for (let i = 0; i < numPetals; i++) {
    let petal = new THREE.Mesh(petalGeometry, petalMaterial);
    const angle = i * (2 * Math.PI / numPetals);
    petal.position.x = Math.cos(angle) * petalWidth;
    petal.position.z = Math.sin(angle) * petalWidth;
    petal.position.y = stemHeight;
    petal.rotation.z = angle;
    group.add(petal);
  }
  group.position.set(x, getGroundHeightAt(x, z), z);
  return group;
}

function createShrub(x, z) {
  const shrubGroup = new THREE.Group();
  const numSpheres = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < numSpheres; i++) {
    const radius = Math.random() * 0.3 + 0.4;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 10),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(`hsl(${Math.random() * 20 + 80}, 60%, ${Math.random() * 20 + 30}%)`) })
    );
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    let angle = Math.random() * 2 * Math.PI;
    let distance = Math.random() * 0.5;
    sphere.position.set(Math.cos(angle) * distance, -radius * 0.5, Math.sin(angle) * distance);
    shrubGroup.add(sphere);
  }
  shrubGroup.position.set(x, getGroundHeightAt(x, z) + 0.5, z);
  return shrubGroup;
}

// Scatter them
for (let i = 0; i < 60; i++) {
  let x = Math.random() * 180 - 90;
  let z = Math.random() * 180 - 90;
  if (Math.abs(x) < 20 && Math.abs(z) < 20) { i--; continue; }
  scene.add(createBush(x, z));
}
for (let i = 0; i < 40; i++) {
  let x = Math.random() * 180 - 90;
  let z = Math.random() * 180 - 90;
  if (Math.abs(x) < 20 && Math.abs(z) < 20) { i--; continue; }
  scene.add(createFlower(x, z));
}
for (let i = 0; i < 30; i++) {
  let x = Math.random() * 180 - 90;
  let z = Math.random() * 180 - 90;
  if (Math.abs(x) < 20 && Math.abs(z) < 20) { i--; continue; }
  scene.add(createShrub(x, z));
}

// --------------------------------------------------
// PLAYER CUBES & SPAWN
// --------------------------------------------------
function createCharacterCube(baseColor, options = {}) {
  const size = 2;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  // Fill base
  ctx.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Basic face
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(40, 50, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(88, 50, 12, 0, Math.PI * 2);
  ctx.fill();
  // Pupils
  const leftPupilOffsetX = options.leftEye?.pupilOffsetX || 0;
  const leftPupilOffsetY = options.leftEye?.pupilOffsetY || 0;
  const rightPupilOffsetX = options.rightEye?.pupilOffsetX || 0;
  const rightPupilOffsetY = options.rightEye?.pupilOffsetY || 0;
  ctx.fillStyle = "black";
  ctx.beginPath();
  ctx.arc(40 + leftPupilOffsetX, 50 + leftPupilOffsetY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(88 + rightPupilOffsetX, 50 + rightPupilOffsetY, 5, 0, Math.PI * 2);
  ctx.fill();
  // Mouth
  ctx.strokeStyle = "black";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(64, 85, 20, 0, Math.PI);
  ctx.stroke();

  const faceTexture = new THREE.CanvasTexture(canvas);
  faceTexture.needsUpdate = true;
  const materials = [
    new THREE.MeshLambertMaterial({ color: baseColor }),
    new THREE.MeshLambertMaterial({ color: baseColor }),
    new THREE.MeshLambertMaterial({ color: baseColor }),
    new THREE.MeshLambertMaterial({ color: baseColor }),
    new THREE.MeshLambertMaterial({ map: faceTexture }),
    new THREE.MeshLambertMaterial({ color: baseColor })
  ];
  const geometry = new THREE.BoxGeometry(size, size, size);
  const cube = new THREE.Mesh(geometry, materials);
  cube.castShadow = true;
  cube.receiveShadow = true;
  cube.velocity = new THREE.Vector3(0, 0, 0);
  cube.canDoubleJump = false;
  return cube;
}

function checkCollision(pos) {
  const playerSize = 2;
  const playerBox = new THREE.Box3(
    new THREE.Vector3(pos.x - playerSize / 2, pos.y - playerSize / 2, pos.z - playerSize / 2),
    new THREE.Vector3(pos.x + playerSize / 2, pos.y + playerSize / 2, pos.z + playerSize / 2)
  );
  for (let box of treeBoxes) {
    if (playerBox.intersectsBox(box)) return true;
  }
  for (let box of buildingBoxes) {
    if (playerBox.intersectsBox(box)) return true;
  }
  for (let box of borderBoxes) {
    if (playerBox.intersectsBox(box)) return true;
  }
  return false;
}

const blueCube = createCharacterCube(0x0000ff, {
  leftEye: { pupilOffsetX: 2, pupilOffsetY: 2 },
  rightEye: { pupilOffsetX: -2, pupilOffsetY: 2 }
});
const redCube = createCharacterCube(0xff0000, {
  leftEye: { pupilOffsetX: -2, pupilOffsetY: 2 },
  rightEye: { pupilOffsetX: 2, pupilOffsetY: 2 }
});
scene.add(blueCube);
scene.add(redCube);

function randomSpawn() {
  let attempts = 0;
  let validSpawn = false;
  const safeMin = -94;
  const safeMax = 94;
  const safeRange = safeMax - safeMin;
  while (!validSpawn && attempts < 100) {
    let centerX = Math.random() * safeRange + safeMin;
    let centerZ = Math.random() * safeRange + safeMin;
    const separation = 10;
    const angle = Math.random() * 2 * Math.PI;
    const dx = Math.cos(angle) * separation / 2;
    const dz = Math.sin(angle) * separation / 2;
    
    let bluePos = new THREE.Vector3(
      centerX + dx,
      getGroundHeightAt(centerX + dx, centerZ + dz) + 1,
      centerZ + dz
    );
    let redPos = new THREE.Vector3(
      centerX - dx,
      getGroundHeightAt(centerX - dx, centerZ - dz) + 1,
      centerZ - dz
    );
    
    if (!checkCollision(bluePos) && !checkCollision(redPos)) {
      blueCube.position.copy(bluePos);
      redCube.position.copy(redPos);
      validSpawn = true;
    }
    attempts++;
  }
  if (!validSpawn) {
    console.warn("Could not find a valid spawn location after 100 attempts. Using last computed positions.");
  }
  const spawnAngle = Math.atan2(redCube.position.z - blueCube.position.z, redCube.position.x - blueCube.position.x);
  blueCube.rotation.y = spawnAngle + Math.PI;
  redCube.rotation.y = spawnAngle;
  blueCube.velocity.set(0, 0, 0);
  redCube.velocity.set(0, 0, 0);
}
randomSpawn();

// --------------------------------------------------
// NAME TAGS
// --------------------------------------------------
function createNameTag(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "28px Arial";
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 10);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4, 1, 1);
  return sprite;
}
function updateNameTag(sprite, text) {
  if (!sprite) return;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "28px Arial";
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 10);
  sprite.material.map.image = canvas;
  sprite.material.map.needsUpdate = true;
}

// --------------------------------------------------
// GAME DATA MESSAGING & EVENT HANDLERS
// --------------------------------------------------
function handleData(data) {
  if (data.type) {
    switch (data.type) {
      case "requestTeam":
        // Host assigns teams if not assigned yet
        if (isHost && !teamAssigned) {
          localTeam = "red";
          remoteTeam = "blue";
          localPlayer = redCube;
          remotePlayer = blueCube;
          teamAssigned = true;
          document.getElementById('roleInfo').textContent = "You are TAGGER (Red)";
          localNameTag = createNameTag(localUsername);
          localNameTag.position.set(0, 2.5, 0);
          localPlayer.add(localNameTag);
          remoteNameTag = createNameTag(remoteUsername);
          remoteNameTag.position.set(0, 2.5, 0);
          remotePlayer.add(remoteNameTag);
          sendMessage({ type: "teamAssignment", team: "red" });
          sendMessage({ type: "startCountdown" });
          sendMessage({ type: "username", username: localUsername });
          if (!gameStarted) startCountdown();
        }
        break;
      case "teamAssignment":
        // Client receives team from host
        if (!teamAssigned) {
          if (data.team === "red") {
            localTeam = "blue";
            remoteTeam = "red";
            localPlayer = blueCube;
            remotePlayer = redCube;
            document.getElementById('roleInfo').textContent = "You are RUNNER (Blue)";
          } else {
            localTeam = "red";
            remoteTeam = "blue";
            localPlayer = redCube;
            remotePlayer = blueCube;
            document.getElementById('roleInfo').textContent = "You are TAGGER (Red)";
          }
          teamAssigned = true;
          if (teamRequestTimeout) clearTimeout(teamRequestTimeout);
          localNameTag = createNameTag(localUsername);
          localNameTag.position.set(0, 2.5, 0);
          localPlayer.add(localNameTag);
          remoteNameTag = createNameTag(remoteUsername);
          remoteNameTag.position.set(0, 2.5, 0);
          remotePlayer.add(remoteNameTag);
          sendMessage({
            type: "movement",
            x: localPlayer.position.x,
            y: localPlayer.position.y,
            z: localPlayer.position.z,
            rotation: localPlayer.rotation.y
          });
          sendMessage({ type: "username", username: localUsername });
          if (!gameStarted) startCountdown();
        }
        break;
      case "swap":
        // The host told us to swap teams for a restart
        if (!isHost) {
          const newTeam = data.team === "red" ? "blue" : "red";
          performRestart(newTeam);
        }
        break;
      case "startCountdown":
        if (!gameStarted) startCountdown();
        break;
      case "username":
        remoteUsername = data.username || "Player";
        updateNameTag(remoteNameTag, remoteUsername);
        updateScoreboard();
        break;
      case "movement":
        if (remotePlayer) {
          // Smoothly lerp to new position
          remotePlayer.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.2);
          remotePlayer.rotation.y = data.rotation;
        }
        break;
      case "tag":
        triggerTag();
        break;
      case "bonus":
        if (localTeam === "red") {
          remotePlayerScore++;
        } else {
          localPlayerScore++;
        }
        updateScoreboard();
        showBonusMessage();
        break;
      case "restart":
        remoteReplay = true;
        document.getElementById('restartStatus').textContent = "Opponent pressed restart.";
        checkReplay();
        break;
    }
  }
}

document.getElementById('username').addEventListener('change', () => {
  const uname = document.getElementById('username').value.trim();
  if (uname !== "") {
    localUsername = uname;
    if (localNameTag) updateNameTag(localNameTag, localUsername);
    updateScoreboard();
    sendMessage({ type: "username", username: localUsername });
  }
});

/* MOVEMENT KEYS */
const keys = { w: false, a: false, s: false, d: false, ' ': false };
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key in keys) {
    // Jump logic
    if (key === ' ' && !keys[' ']) {
      if (isPlayerGrounded()) {
        localPlayer.velocity.y = jumpForce;
        localPlayer.canDoubleJump = true;
      } else if (localPlayer.canDoubleJump) {
        localPlayer.velocity.y = jumpForce * 0.8;
        // small horizontal boost
        localPlayer.velocity.x += Math.sin(localPlayer.rotation.y) * 5;
        localPlayer.velocity.z += Math.cos(localPlayer.rotation.y) * 5;
        localPlayer.canDoubleJump = false;
      }
    }
    keys[key] = true;
  }
  if (gameEnded && key === 'r') {
    localReplay = true;
    document.getElementById('restartStatus').textContent = "You pressed restart. Waiting for opponent...";
    sendMessage({ type: "restart" });
    checkReplay();
  }
});
document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (key in keys) keys[key] = false;
});

function isPlayerGrounded() {
  const playerBox = getPlayerBox(localPlayer);
  const groundY = getGroundHeightAt(localPlayer.position.x, localPlayer.position.z) + 1;
  if (Math.abs(playerBox.min.y - groundY) < 0.2 && localPlayer.velocity.y <= 0) return true;
  for (let i = 0; i < platformBoxes.length; i++) {
    const platBox = platformBoxes[i];
    if (playerBox.intersectsBox(platBox) && localPlayer.velocity.y <= 0) return true;
  }
  return false;
}

function checkForTag() {
  if (!gameEnded) {
    const localBox = getPlayerBox(localPlayer);
    const remoteBox = getPlayerBox(remotePlayer);
    if (localBox.intersectsBox(remoteBox)) {
      sendMessage({ type: "tag" });
      triggerTag();
    }
  }
}

function triggerTag() {
  if (gameEnded) return;
  gameEnded = true;
  if (localTeam === "red") {
    localPlayerScore++;
  } else {
    remotePlayerScore++;
  }
  updateScoreboard();
  document.getElementById('endMessage').textContent = "TAG! Press R to restart if you agree.";
  document.getElementById('endMessage').style.display = 'block';
}

function performRestart(newTeam) {
  localReplay = false;
  remoteReplay = false;
  gameEnded = false;
  gameStarted = false;
  document.getElementById('endMessage').style.display = 'none';
  document.getElementById('restartStatus').textContent = "";
  
  if (newTeam === "red") {
    localTeam = "red";
    remoteTeam = "blue";
    localPlayer = redCube;
    remotePlayer = blueCube;
  } else {
    localTeam = "blue";
    remoteTeam = "red";
    localPlayer = blueCube;
    remotePlayer = redCube;
  }
  
  document.getElementById('roleInfo').textContent =
    "You are " + (localTeam === "red" ? "TAGGER (Red)" : "RUNNER (Blue)");
  
  if (localNameTag && localNameTag.parent) {
    localNameTag.parent.remove(localNameTag);
  }
  if (remoteNameTag && remoteNameTag.parent) {
    remoteNameTag.parent.remove(remoteNameTag);
  }
  
  localNameTag = createNameTag(localUsername);
  localNameTag.position.set(0, 2.5, 0);
  localPlayer.add(localNameTag);
  remoteNameTag = createNameTag(remoteUsername);
  remoteNameTag.position.set(0, 2.5, 0);
  remotePlayer.add(remoteNameTag);
  
  const centerX = Math.random() * 180 - 90;
  const centerZ = Math.random() * 180 - 90;
  const separation = 10;
  const angle = Math.random() * 2 * Math.PI;
  const dx = Math.cos(angle) * separation / 2;
  const dz = Math.sin(angle) * separation / 2;
  blueCube.position.set(centerX + dx, getGroundHeightAt(centerX + dx, centerZ + dz) + 1, centerZ + dz);
  redCube.position.set(centerX - dx, getGroundHeightAt(centerX - dx, centerZ - dz) + 1, centerZ - dz);
  const spawnAngle = Math.atan2(redCube.position.z - blueCube.position.z, redCube.position.x - blueCube.position.x);
  blueCube.rotation.y = spawnAngle + Math.PI;
  redCube.rotation.y = spawnAngle;
  blueCube.velocity.set(0, 0, 0);
  redCube.velocity.set(0, 0, 0);
  
  runnerBonusTimer = 0;
  startCountdown();
}

function checkReplay() {
  if (localReplay && remoteReplay) {
    // If we are host, decide new teams and broadcast
    if (isHost) {
      const newTeam = localTeam === "red" ? "blue" : "red";
      performRestart(newTeam);
      sendMessage({ type: "swap", team: newTeam });
    }
  }
}

const countdownDiv = document.getElementById('countdown');
function startCountdown() {
  if (gameStarted) return;
  countdownDiv.style.display = 'block';
  countdownTime = 3;
  countdownDiv.textContent = countdownTime;
  const countdownInterval = setInterval(() => {
    countdownTime--;
    if (countdownTime <= 0) {
      clearInterval(countdownInterval);
      countdownDiv.style.display = 'none';
      gameStarted = true;
    } else {
      countdownDiv.textContent = countdownTime;
    }
  }, 1000);
}

// --------------------------------------------------
// PHYSICS SUB-STEPPING & ANIMATION
// --------------------------------------------------
const cameraDistance = 15;
const cameraHeight = 10;
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  
  if (!localPlayer) {
    renderer.render(scene, camera);
    return;
  }
  
  const currentTime = performance.now();
  const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;
  
  if (gameStarted && !gameEnded) {
    // Turn
    if (keys.a) localPlayer.rotation.y += turnSpeed * delta;
    if (keys.d) localPlayer.rotation.y -= turnSpeed * delta;
    // Forward/back
    let forwardAcceleration = 0;
    if (keys.w) forwardAcceleration = accelerationVal;
    else if (keys.s) forwardAcceleration = -accelerationVal;
    playerSpeed += forwardAcceleration * delta;
    if (!keys.w && !keys.s) {
      if (playerSpeed > 0) playerSpeed = Math.max(playerSpeed - frictionVal * delta, 0);
      else if (playerSpeed < 0) playerSpeed = Math.min(playerSpeed + frictionVal * delta, 0);
    }
    playerSpeed = THREE.MathUtils.clamp(playerSpeed, -maxSpeed, maxSpeed);
    localPlayer.velocity.x = Math.sin(localPlayer.rotation.y) * playerSpeed;
    localPlayer.velocity.z = Math.cos(localPlayer.rotation.y) * playerSpeed;
    
    // Sub-steps for stable physics
    const substeps = 5;
    const dt = delta / substeps;
    for (let i = 0; i < substeps; i++) {
      updatePhysics(dt);
    }
    
    // Attempt horizontal move
    const potentialPos = localPlayer.position.clone();
    potentialPos.x += localPlayer.velocity.x * delta;
    potentialPos.z += localPlayer.velocity.z * delta;
    potentialPos.x = THREE.MathUtils.clamp(potentialPos.x, -100, 100);
    potentialPos.z = THREE.MathUtils.clamp(potentialPos.z, -100, 100);
    if (!checkCollision(potentialPos)) {
      localPlayer.position.x = potentialPos.x;
      localPlayer.position.z = potentialPos.z;
    } else {
      // collision, stop
      playerSpeed = 0;
      localPlayer.velocity.x = 0;
      localPlayer.velocity.z = 0;
    }
    
    // If localTeam == blue, accumulate runner bonus
    if (localTeam === "blue") {
      if (Math.abs(playerSpeed) >= 10) {
        runnerBonusTimer += delta;
        if (runnerBonusTimer >= 3) {
          localPlayerScore++;
          updateScoreboard();
          showBonusMessage();
          sendMessage({ type: "bonus" });
          runnerBonusTimer = 0;
        }
      } else {
        runnerBonusTimer = 0;
      }
    }
    // Sync movement to remote
    sendMessage({
      type: "movement",
      x: localPlayer.position.x,
      y: localPlayer.position.y,
      z: localPlayer.position.z,
      rotation: localPlayer.rotation.y
    });
    checkForTag();
  }
  
  // Move camera behind localPlayer
  const forward = new THREE.Vector3(Math.sin(localPlayer.rotation.y), 0, Math.cos(localPlayer.rotation.y));
  const desiredCamPos = localPlayer.position.clone().sub(forward.multiplyScalar(cameraDistance)).add(new THREE.Vector3(0, cameraHeight, 0));
  camera.position.lerp(desiredCamPos, 0.1);
  camera.lookAt(localPlayer.position);
  
  renderer.render(scene, camera);
}

function updatePhysics(dt) {
  localPlayer.velocity.y += gravity * dt;
  localPlayer.position.y += localPlayer.velocity.y * dt;
  
  const groundY = getGroundHeightAt(localPlayer.position.x, localPlayer.position.z) + 1;
  if (localPlayer.position.y < groundY) {
    localPlayer.position.y = groundY;
    localPlayer.velocity.y = 0;
    localPlayer.canDoubleJump = true;
  }
  
  const collidableBoxes = platformBoxes.concat(buildingBoxes, borderBoxes);
  const maxIterations = 5;
  let iterations = 0;
  let playerBox = getPlayerBox(localPlayer);
  while (iterations < maxIterations) {
    let collisionFound = false;
    for (let j = 0; j < collidableBoxes.length; j++) {
      const box = collidableBoxes[j];
      if (playerBox.intersectsBox(box)) {
        collisionFound = true;
        const boxTop = box.max.y;
        const playerBottom = localPlayer.position.y - 1;
        const verticalOverlap = boxTop - playerBottom;
        if (verticalOverlap >= 0 && verticalOverlap < 0.2 && localPlayer.velocity.y <= 0) {
          // Land on top
          localPlayer.position.y = boxTop + 1;
          localPlayer.velocity.y = 0;
          localPlayer.canDoubleJump = true;
        } else {
          // Side collision
          const overlapX = Math.min(playerBox.max.x, box.max.x) - Math.max(playerBox.min.x, box.min.x);
          const overlapZ = Math.min(playerBox.max.z, box.max.z) - Math.max(playerBox.min.z, box.min.z);
          if (overlapX < overlapZ) {
            const boxCenterX = (box.min.x + box.max.x) / 2;
            if (localPlayer.position.x < boxCenterX) {
              localPlayer.position.x -= overlapX;
            } else {
              localPlayer.position.x += overlapX;
            }
            localPlayer.velocity.x = 0;
          } else {
            const boxCenterZ = (box.min.z + box.max.z) / 2;
            if (localPlayer.position.z < boxCenterZ) {
              localPlayer.position.z -= overlapZ;
            } else {
              localPlayer.position.z += overlapZ;
            }
            localPlayer.velocity.z = 0;
          }
        }
        playerBox.copy(getPlayerBox(localPlayer));
      }
    }
    if (!collisionFound) break;
    iterations++;
  }
  
  // Snap onto roofs if close
  for (let i = 0; i < roofBoxes.length; i++) {
    const roofBox = roofBoxes[i];
    if (localPlayer.position.x + 1 > roofBox.min.x && localPlayer.position.x - 1 < roofBox.max.x &&
        localPlayer.position.z + 1 > roofBox.min.z && localPlayer.position.z - 1 < roofBox.max.z) {
      const playerBottom = localPlayer.position.y - 1;
      if (roofBox.max.y - playerBottom > 0 && roofBox.max.y - playerBottom < 0.3) {
        localPlayer.position.y = roofBox.max.y + 1;
        localPlayer.velocity.y = 0;
        localPlayer.canDoubleJump = true;
      }
    }
  }
}

animate();

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Scoreboard & bonus message
function updateScoreboard() {
  document.getElementById('scoreboard').innerHTML =
    `<strong>${localUsername}:</strong> ${localPlayerScore} &nbsp;&nbsp; ` +
    `<strong>${remoteUsername}:</strong> ${remotePlayerScore}`;
}
updateScoreboard();

function showBonusMessage() {
  const bonusDiv = document.getElementById('bonusMessage');
  bonusDiv.style.display = 'block';
  setTimeout(() => {
    bonusDiv.style.display = 'none';
  }, 1000);
}
