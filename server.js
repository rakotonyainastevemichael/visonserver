const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

// Création du serveur HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Stockage temporaire des mails (en mémoire)
const mails = [];

// GET - Récupérer les mails existants
app.get('/mails', (req, res) => res.json(mails));

// POST - Envoyé depuis n8n
app.post('/mails', (req, res) => {
  const mail = req.body;
  mails.push(mail);
  io.emit('new-mail', mail); // Envoi temps réel aux clients connectés
  res.json({ status: 'ok', received: mail });
});

// ✅ Utiliser le port fourni par Render OU 3000 localement
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Serveur en ligne sur le port ${PORT}`));
