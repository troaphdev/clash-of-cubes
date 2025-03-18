import * as THREE from 'https://cdn.skypack.dev/three@0.152.2';

/*****************************************************
 * PEER-TO-PEER CONNECTION USING PEERJS
 *****************************************************/
let myId = Math.random().toString(36).substr(2, 8);
document.getElementById('my-id').textContent = myId;

let peer = null;
let conn = null;
let roomId = null;
let isHost = false;
let teamAssigned = false;
let teamRequestTimeout = null;
let heartbeatInterval = null;
let messageQueue = [];  // Queue messages until connection is available
let isConnecting = false; // Prevent overlapping reconnection attempts

function initializePeer(id = null) {
  if (isConnecting) return;
  isConnecting = true;
  // Use the official PeerJS cloud server which sends the proper CORS headers.
  peer = new Peer(id, {
    host: '0.peerjs.com',
    secure: true,
    port: 443,
    debug: 3
  });
  peer.on('open', (id) => {
    console.log('Peer open with ID:', id);
    isConnecting = false;
  });
  // When acting as host, listen for incoming connections.
  if (isHost) {
    peer.on('connection', (incomingConn) => {
      console.log("Host received connection from:", incomingConn.peer);
      conn = incomingConn;
      conn.on('open', setupConnection);
      conn.on('error', (err) => {
        console.error("Connection error (host):", err);
        alert("Connection error: " + err);
      });
    });
  }
  peer.on('disconnected', () => {
    console.warn("Peer disconnected. Reinitializing new connection in 1 second...");
    setTimeout(() => {
      initializePeer(id);
    }, 1000);
  });
  peer.on('error', (err) => {
    console.error(err);
    if (err.message && err.message.includes("Lost connection to server")) {
      console.warn("Lost connection to server. Reinitializing new connection in 1 second...");
      setTimeout(() => {
        initializePeer(id);
      }, 1000);
      return;
    }
    alert("PeerJS error: " + err);
  });
  peer.on('close', () => {
    console.warn("Peer connection closed. Reinitializing connection...");
    if (!isHost) {
      setTimeout(connectToRoom, 1000);
    }
  });
}

function flushMessageQueue() {
  while (messageQueue.length > 0 && conn && conn.open) {
    const msg = messageQueue.shift();
    conn.send(msg);
  }
}

function setupConnection() {
  conn.on('data', (data) => {
    if (data.sender === myId) return;
    handleData(data);
  });
  document.getElementById('connection-status').textContent = "Connected!";
  document.getElementById('connection-panel').style.display = 'none';

  // Remove the cover image immediately by overriding the background.
  document.body.style.background = "#87ceeb";

  const unameInput = document.getElementById('username').value.trim();
  if (unameInput !== "") {
    localUsername = unameInput;
  }
  sendMessage({ type: "username", username: localUsername });
  
  if (!isHost) {
    sendMessage({ type: "requestTeam" });
    teamRequestTimeout = setTimeout(() => {
      if (!teamAssigned) {
        console.log("No team assignment received, re-requesting...");
        sendMessage({ type: "requestTeam" });
      }
    }, 2000);
  }
  
  flushMessageQueue();
  
  // Send heartbeat every 15 seconds to keep the connection alive.
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      if (conn && conn.open) {
        conn.send({ type: "heartbeat" });
      }
    }, 15000);
  }
}

function sendMessage(message) {
  message.sender = myId;
  if (conn && conn.open) {
    conn.send(message);
  } else {
    console.warn("No connection available, queueing message:", message);
    messageQueue.push(message);
  }
}

document.getElementById('create-room').addEventListener('click', () => {
  roomId = document.getElementById('room-id').value.trim();
  if (!roomId) {
    roomId = Math.random().toString(36).substr(2, 8);
    document.getElementById('room-id').value = roomId;
  }
  isHost = true;
  initializePeer(roomId);
  document.getElementById('connection-status').textContent =
    "Room created: " + roomId + ". Waiting for connection...";
});

document.getElementById('join-room').addEventListener('click', () => {
  roomId = document.getElementById('room-id').value.trim();
  if (!roomId) {
    alert("Please enter a Room ID to join");
    return;
  }
  isHost = false;
  initializePeer();
  if (peer && peer.id) {
    console.log("Joiner peer open with ID:", peer.id);
    connectToRoom();
  } else {
    peer.on('open', () => {
      console.log("Joiner peer open with ID:", peer.id);
      connectToRoom();
    });
  }
});

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

/*****************************************************
 * GAME CODE (Movement, Scoring, etc.)
 *****************************************************/
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

let localTeam = null;   // "red" = tagger; "blue" = runner
let remoteTeam = null;
let localUsername = "Player";
let remoteUsername = "Player";

// Persistent scores per user.
let localScore = 0;
let remoteScore = 0;

let localPlayer, remotePlayer;
let localNameTag, remoteNameTag;

// Helper: returns a player's AABB (cube of size 2)
function getPlayerBox(player) {
  const size = 2;
  return new THREE.Box3(
    new THREE.Vector3(player.position.x - size/2, player.position.y - size/2, player.position.z - size/2),
    new THREE.Vector3(player.position.x + size/2, player.position.y + size/2, player.position.z + size/2)
  );
}

/* =============== SCENE SETUP =============== */
// Create renderer with transparency so the background shows through.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

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

function getGroundHeightAt(x, z) {
  const frequency = 0.1, amplitude = 3;
  return Math.sin(x * frequency) * Math.cos(z * frequency) * amplitude;
}
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

/* --- Invisible Walls --- */
const wallBoxes = [];
function createWall(position, rotation, width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
  const wall = new THREE.Mesh(geometry, material);
  wall.position.copy(position);
  wall.rotation.copy(rotation);
  scene.add(wall);
  const box = new THREE.Box3().setFromObject(wall);
  wallBoxes.push(box);
}
createWall(new THREE.Vector3(-100.5, 25, 0), new THREE.Euler(0, 0, 0), 1, 50, 200);
createWall(new THREE.Vector3(100.5, 25, 0), new THREE.Euler(0, 0, 0), 1, 50, 200);
createWall(new THREE.Vector3(0, 25, -100.5), new THREE.Euler(0, 0, 0), 200, 50, 1);
createWall(new THREE.Vector3(0, 25, 100.5), new THREE.Euler(0, 0, 0), 200, 50, 1);

function createCharacterCube(baseColor, options = {}) {
  const size = 2;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(40, 50, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(88, 50, 12, 0, Math.PI * 2);
  ctx.fill();
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

// Create the player cubes and spawn them at random positions.
const blueCube = createCharacterCube(0x0000ff, {
  leftEye: { pupilOffsetX: 2, pupilOffsetY: 2 },
  rightEye: { pupilOffsetX: -2, pupilOffsetY: 2 }
});
const redCube = createCharacterCube(0xff0000, {
  leftEye: { pupilOffsetX: -2, pupilOffsetY: 2 },
  rightEye: { pupilOffsetX: 2, pupilOffsetY: 2 }
});
function randomSpawn() {
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
}
randomSpawn();
scene.add(blueCube);
scene.add(redCube);

/* =============== TREE SPAWN (Seeded for consistency) =============== */
const trees = [];
const treeBoxes = [];

// Seeded random generator to ensure the same tree positions for every player.
let treeSeed = 12345;
function seededRandom() {
  treeSeed = (treeSeed * 9301 + 49297) % 233280;
  return treeSeed / 233280;
}

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
  box.expandByScalar(-0.5);
  trees.push(tree);
  treeBoxes.push(box);
  return tree;
}

for (let i = 0; i < 50; i++) {
  const x = seededRandom() * 180 - 90;
  const z = seededRandom() * 180 - 90;
  if (Math.abs(x) < 20 && Math.abs(z) < 20) { i--; continue; }
  const tree = createTree(x, z);
  scene.add(tree);
}

/* =============== NAME TAGS =============== */
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

/* =============== PARKOUR PLATFORMS =============== */
const parkourPlatforms = [];
const platformBoxes = [];
function createPlatform(x, y, z, width, height, depth, color = 0x888888) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshLambertMaterial({ color });
  const platform = new THREE.Mesh(geometry, material);
  platform.castShadow = true;
  platform.receiveShadow = true;
  platform.position.set(x, y - height/2, z);
  scene.add(platform);
  parkourPlatforms.push(platform);
  platform.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(platform);
  platformBoxes.push(box);
  return platform;
}

createPlatform(20, getGroundHeightAt(20, 0) + 2, 0, 4, 1, 4, 0xaaaaaa);

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

function updateScoreboard() {
  document.getElementById('scoreboard').innerHTML =
    `<strong>${localUsername}:</strong> ${localScore} &nbsp;&nbsp; ` +
    `<strong>${remoteUsername}:</strong> ${remoteScore}`;
}
updateScoreboard();

function showBonusMessage() {
  const bonusDiv = document.getElementById('bonusMessage');
  bonusDiv.style.display = 'block';
  setTimeout(() => { bonusDiv.style.display = 'none'; }, 1000);
}

function handleData(data) {
  if (data.type) {
    switch (data.type) {
      case "heartbeat":
        break;
      case "requestTeam":
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
          remotePlayer.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.2);
          remotePlayer.rotation.y = data.rotation;
        }
        break;
      case "tag":
        triggerTag();
        break;
      case "bonus":
        if (localTeam === "blue") {
          localScore++;
        } else {
          remoteScore++;
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

const keys = { w: false, a: false, s: false, d: false, ' ': false };
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key in keys) {
    if (key === ' ' && !keys[' ']) {
      if (isPlayerGrounded()) {
        localPlayer.velocity.y = jumpForce;
        localPlayer.canDoubleJump = true;
      } else if (localPlayer.canDoubleJump) {
        localPlayer.velocity.y = jumpForce * 0.8;
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
  for (let i = 0; i < parkourPlatforms.length; i++) {
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
    localScore++;
  } else {
    remoteScore++;
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
  
  if (localNameTag && localNameTag.parent) { localNameTag.parent.remove(localNameTag); }
  if (remoteNameTag && remoteNameTag.parent) { remoteNameTag.parent.remove(remoteNameTag); }
  
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
      document.body.style.background = "#87ceeb";
    } else {
      countdownDiv.textContent = countdownTime;
    }
  }, 1000);
}

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
    if (keys.a) localPlayer.rotation.y += turnSpeed * delta;
    if (keys.d) localPlayer.rotation.y -= turnSpeed * delta;
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
    
    const substeps = 5;
    const dt = delta / substeps;
    for (let i = 0; i < substeps; i++) {
      updatePhysics(dt);
    }
    
    const potentialPos = localPlayer.position.clone();
    potentialPos.x += localPlayer.velocity.x * delta;
    potentialPos.z += localPlayer.velocity.z * delta;
    potentialPos.x = THREE.MathUtils.clamp(potentialPos.x, -100, 100);
    potentialPos.z = THREE.MathUtils.clamp(potentialPos.z, -100, 100);
    if (!checkCollision(potentialPos)) {
      localPlayer.position.x = potentialPos.x;
      localPlayer.position.z = potentialPos.z;
    } else {
      playerSpeed = 0;
      localPlayer.velocity.x = 0;
      localPlayer.velocity.z = 0;
    }
    
    if (localTeam === "blue") {
      if (Math.abs(playerSpeed) >= 10) {
        runnerBonusTimer += delta;
        if (runnerBonusTimer >= 3) {
          localScore++;
          updateScoreboard();
          showBonusMessage();
          sendMessage({ type: "bonus" });
          runnerBonusTimer = 0;
        }
      } else {
        runnerBonusTimer = 0;
      }
    }
    sendMessage({
      type: "movement",
      x: localPlayer.position.x,
      y: localPlayer.position.y,
      z: localPlayer.position.z,
      rotation: localPlayer.rotation.y
    });
    checkForTag();
  }
  
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
  
  const maxIterations = 5;
  let iterations = 0;
  let playerBox = getPlayerBox(localPlayer);
  while (iterations < maxIterations) {
    let collisionFound = false;
    for (let j = 0; j < parkourPlatforms.length; j++) {
      const platBox = platformBoxes[j];
      if (playerBox.intersectsBox(platBox)) {
        collisionFound = true;
        const platformTop = platBox.max.y;
        const playerBottom = localPlayer.position.y - 1;
        const verticalOverlap = platformTop - playerBottom;
        if (verticalOverlap >= 0 && verticalOverlap < 0.2 && localPlayer.velocity.y <= 0) {
          localPlayer.position.y = platformTop + 1;
          localPlayer.velocity.y = 0;
        } else {
          const overlapX = Math.min(playerBox.max.x, platBox.max.x) - Math.max(playerBox.min.x, platBox.min.x);
          const overlapZ = Math.min(playerBox.max.z, platBox.max.z) - Math.max(playerBox.min.z, platBox.min.z);
          if (overlapX < overlapZ) {
            const platCenterX = (platBox.min.x + platBox.max.x) / 2;
            if (localPlayer.position.x < platCenterX) {
              localPlayer.position.x -= overlapX;
            } else {
              localPlayer.position.x += overlapX;
            }
            localPlayer.velocity.x = 0;
          } else {
            const platCenterZ = (platBox.min.z + platBox.max.z) / 2;
            if (localPlayer.position.z < platCenterZ) {
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
}

function checkCollision(pos) {
  const playerSize = 2;
  const playerBox = new THREE.Box3(
    new THREE.Vector3(pos.x - playerSize/2, pos.y - playerSize/2, pos.z - playerSize/2),
    new THREE.Vector3(pos.x + playerSize/2, pos.y + playerSize/2, pos.z + playerSize/2)
  );
  for (let box of treeBoxes) {
    if (playerBox.intersectsBox(box)) return true;
  }
  for (let box of wallBoxes) {
    if (playerBox.intersectsBox(box)) return true;
  }
  return false;
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
