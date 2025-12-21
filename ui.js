/* =========================================================
   ui.js
   - Rendering
   - User interaction
   - Animations
   - NO game rules
========================================================= */

import { connect, mySeat, gameState } from "./app.js";

const lobbyView = document.getElementById("lobbyView");
const gameView = document.getElementById("gameView");

document.getElementById("enterBtn").onclick = () => {
  const name = document.getElementById("nameInput").value || "Player";
  connect(name, handleMessage);
  lobbyView.style.display = "none";
  gameView.style.display = "block";
};

function handleMessage(msg){
  if (msg.type === "state") render();
}

function render(){
  if (!gameState || mySeat === null) return;
  // Rendering logic will expand massively here
}
