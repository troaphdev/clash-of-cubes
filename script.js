import * as THREE from 'https://cdn.skypack.dev/three@0.152.2';

/*****************************************************
 * PEER-TO-PEER CONNECTION USING PEERJS
 *****************************************************/
// Generate a random local ID.
let myId = Math.random().toString(36).substr(2, 8);
document.getElementById('my-id').textContent = myId;

// PeerJS objects.
let peer = null;
let conn = null;
let roomId = null;
let isHost = false;

// Flag to mark team assignment so it is set only once.
let teamAssigned = false;

function initializePeer(id = null) {
  peer = new Peer(id, {
    // host: 'your-peerjs-server.com',
    // port: 9000,
    // path: '/myapp'
  });
  peer.on('open', (id) => {
    console.log('Peer connected with ID:', id);
  });
  // For host: accept incoming connection.
  peer.on('connection', (incomingConn) => {
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

function setupConnection() {
  conn.on('data', (data) => {
    // Ignore our own messages.
    if (data.sender === myId) return;
    handleData(data);
  });
  document.getElementById('connection-status').textContent = "Connected!";
  document.getElementById('connection-panel').style.display = 'none';

  if (isHost && !teamAssigned) {
    // Host always becomes red (tagger) and joiner blue (runner)
    localTeam = "red";
    remoteTeam = "blue";
    localPlayer = redCube;
    remotePlayer = blueCube;
    teamAssigned = true;
    document.getElementById('roleInfo').textContent = "You are TAGGER (Red)";
    sendMessage({ type: "teamAssignment", team: "red" });
    // Now send a start signal so both players start the countdown.
    sendMessage({ type: "startCountdown" });
    startCountdown();
  }
  if (!isHost) {
    // Joiner requests a team assignment.
    sendMessage({ type: "requestTeam" });
  }
}

function sendMessage(message) {
  message.sender = myId;
  if (conn && conn.open) {
    conn.send(message);
  } else {
    console.warn("No connection available to send message:", message);
  }
}

// Create Room
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

// Join Room
document.getElementById('join-room').addEventListener('click', () => {
  roomId = document.getElementById('room-id').value.trim();
  if (!roomId) {
    alert("Please enter a Room ID to join");
    return;
  }
  isHost = false;
  initializePeer();
  if (peer && peer.id) {
    connectToRoom();
  } else {
    peer.on('open', connectToRoom);
  }
});

function connectToRoom() {
  conn = peer.connect(roomId);
  conn.on('open', () => {
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

let localTeam = null;   // "red" or "blue"
let remoteTeam = null;
let localUsername = "Player";
let remoteUsername = "Opponent";
let redScore = 0;
let blueScore = 0;

let localPlayer, remotePlayer;
let localNameTag, remoteNameTag;

/* 
 * Helper function to compute a player's collision box based solely on the cube.
 * Assumes the cube size is 2 units.
 */
function getPlayerBox(player) {
  const size = 2;
  return new THREE.Box3(
    new THREE.Vector3(player.position.x - size/2, player.position.y - size/2, player.position.z - size/2),
    new THREE.Vector3(player.position.x + size/2, player.position.y + size/2, player.position.z + size/2)
  );
}

// ================ SCENE SETUP ================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

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

// ================ PLAYER CUBES ================
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
const blueCube = createCharacterCube(0x0000ff, {
  leftEye: { pupilOffsetX: 2, pupilOffsetY: 2 },
  rightEye: { pupilOffsetX: -2, pupilOffsetY: 2 }
});
const redCube = createCharacterCube(0xff0000, {
  leftEye: { pupilOffsetX: -2, pupilOffsetY: 2 },
  rightEye: { pupilOffsetX: 2, pupilOffsetY: 2 }
});
randomSpawn();
scene.add(blueCube);
scene.add(redCube);

// Removed early team assignment for joiners so that team assignment happens via messaging.
// if (!isHost) {
//   localTeam = "blue";
//   remoteTeam = "red";
//   localPlayer = blueCube;
//   remotePlayer = redCube;
// }

// ================ NAME TAGS ================
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
localNameTag = createNameTag(localUsername);
localNameTag.position.set(0, 2.5, 0);
blueCube.add(localNameTag);
remoteNameTag = createNameTag(remoteUsername);
remoteNameTag.position.set(0, 2.5, 0);
redCube.add(remoteNameTag);

// ================ STATIC OBJECTS (TREES & PARKOUR) ================
const trees = [];
const treeBoxes = [];
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
  trees.push(tree);
  treeBoxes.push(box);
  return tree;
}
for (let i = 0; i < 50; i++) {
  const x = Math.random() * 180 - 90;
  const z = Math.random() * 180 - 90;
  if (Math.abs(x) < 20 && Math.abs(z) < 20) { i--; continue; }
  const tree = createTree(x, z);
  scene.add(tree);
}

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

// ================ SCOREBOARD ================
function updateScoreboard() {
  document.getElementById('scoreboard').innerHTML =
    `<strong>Red (TAGGER):</strong> ${localTeam==="red" ? localUsername : remoteUsername} - ${redScore} &nbsp;&nbsp; ` +
    `<strong>Blue (RUNNER):</strong> ${localTeam==="blue" ? localUsername : remoteUsername} - ${blueScore}`;
}
updateScoreboard();

// ================ BONUS MESSAGE ================
function showBonusMessage() {
  const bonusDiv = document.getElementById('bonusMessage');
  bonusDiv.style.display = 'block';
  setTimeout(() => { bonusDiv.style.display = 'none'; }, 1000);
}

// ================ GAME DATA MESSAGING ================
function handleData(data) {
  if (data.type) {
    switch (data.type) {
      case "requestTeam":
        // Always send team assignment to ensure synchronization.
        if (isHost) {
          sendMessage({ type: "teamAssignment", team: "red" });
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
          // Send an initial movement update so both peers are synced.
          sendMessage({
            type: "movement",
            x: localPlayer.position.x,
            y: localPlayer.position.y,
            z: localPlayer.position.z,
            rotation: localPlayer.rotation.y
          });
        }
        break;
      case "startCountdown":
        if (!gameStarted) startCountdown();
        break;
      case "username":
        remoteUsername = data.username || "Opponent";
        updateNameTag(remoteNameTag, remoteUsername);
        updateScoreboard();
        break;
      case "movement":
        if (remotePlayer) {
          // Smoothly interpolate remote player's position.
          remotePlayer.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.2);
          remotePlayer.rotation.y = data.rotation;
        }
        break;
      case "tag":
        triggerTag();
        break;
      case "bonus":
        blueScore++;
        updateScoreboard();
        showBonusMessage();
        break;
      case "restart":
        remoteReplay = true;
        document.getElementById('restartStatus').textContent = "Opponent pressed restart.";
        checkReplay();
        break;
      case "resume":
        restartGame();
        break;
    }
  }
}

// ================ USERNAME SETTING ================
document.getElementById('username').addEventListener('change', () => {
  const uname = document.getElementById('username').value.trim();
  if (uname !== "") {
    localUsername = uname;
    updateNameTag(localNameTag, localUsername);
    updateScoreboard();
    sendMessage({ type: "username", username: localUsername });
  }
});

// ================ INPUT HANDLING ================
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

// Check if player is grounded.
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

// ================ TAG LOGIC ================
function checkForTag() {
  if (localTeam === "red" && !gameEnded) {
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
  redScore++;
  updateScoreboard();
  document.getElementById('endMessage').textContent = "TAG! Press R to restart if you agree.";
  document.getElementById('endMessage').style.display = 'block';
}

// ================ RESTART LOGIC & TEAM SWAP ================
function checkReplay() {
  if (localReplay && remoteReplay) {
    sendMessage({ type: "resume" });
    restartGame();
  }
}
function restartGame() {
  localReplay = false;
  remoteReplay = false;
  gameEnded = false;
  gameStarted = false;
  document.getElementById('endMessage').style.display = 'none';
  document.getElementById('restartStatus').textContent = "";
  
  // Swap teams so both players get a chance.
  if (localTeam === "red") {
    localTeam = "blue";
    remoteTeam = "red";
    localPlayer = blueCube;
    remotePlayer = redCube;
  } else {
    localTeam = "red";
    remoteTeam = "blue";
    localPlayer = redCube;
    remotePlayer = blueCube;
  }
  document.getElementById('roleInfo').textContent =
    "You are " + (localTeam === "red" ? "TAGGER (Red)" : "RUNNER (Blue)");
  
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
  sendMessage({ type: "startCountdown" });
  startCountdown();
}

// ================ COUNTDOWN ================
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

// ================ COLLISION & MOVEMENT ================
const cameraDistance = 15;
const cameraHeight = 10;
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  
  // Render the scene even if localPlayer isn't yet assigned.
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
    localPlayer.velocity.y += gravity * delta;
    localPlayer.position.y += localPlayer.velocity.y * delta;
    const groundY = getGroundHeightAt(localPlayer.position.x, localPlayer.position.z) + 1;
    if (localPlayer.position.y < groundY) {
      localPlayer.position.y = groundY;
      localPlayer.velocity.y = 0;
      localPlayer.canDoubleJump = true;
    }
    for (let i = 0; i < parkourPlatforms.length; i++) {
      platformBoxes[i].setFromObject(parkourPlatforms[i]);
    }
    const playerBox = getPlayerBox(localPlayer);
    for (let i = 0; i < parkourPlatforms.length; i++) {
      const platBox = platformBoxes[i];
      if (playerBox.intersectsBox(platBox) && localPlayer.velocity.y <= 0) {
        if (Math.abs(playerBox.min.y - platBox.max.y) < 0.3) {
          localPlayer.position.y = platBox.max.y + 0.1;
          localPlayer.velocity.y = 0;
          localPlayer.canDoubleJump = true;
        }
      }
    }
    const potentialPos = localPlayer.position.clone();
    potentialPos.x += localPlayer.velocity.x * delta;
    potentialPos.z += localPlayer.velocity.z * delta;
    potentialPos.x = THREE.MathUtils.clamp(potentialPos.x, -150, 150);
    potentialPos.z = THREE.MathUtils.clamp(potentialPos.z, -150, 150);
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
          blueScore++;
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
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Enhanced collision: check against tree boxes.
function checkCollision(pos) {
  const playerSize = 2;
  const playerBox = new THREE.Box3(
    new THREE.Vector3(pos.x - playerSize/2, pos.y - playerSize/2, pos.z - playerSize/2),
    new THREE.Vector3(pos.x + playerSize/2, pos.y + playerSize/2, pos.z + playerSize/2)
  );
  for (let box of treeBoxes) {
    if (playerBox.intersectsBox(box)) return true;
  }
  return false;
}
