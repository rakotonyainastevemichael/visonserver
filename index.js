// /home/steve/stage/N8n_mail/server/index.js

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const fetch = require("node-fetch");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// 🔗 Connexion Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const N8N_WEBHOOK = process.env.N8N_WEBHOOK;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 🔥 Serveur HTTP + Websocket
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ========================================================
//  ROUTES : MAILS
// ========================================================

// 📌 Récupérer les mails
app.get("/mails", async (req, res) => {
  const { data, error } = await supabase
    .from("mails")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ error });
  res.json(data);
});

// 📌 Ajouter un mail depuis n8n
app.post("/mails", async (req, res) => {
  const mail = req.body;
  const { data, error } = await supabase.from("mails").insert([mail]).select();
  if (error) return res.status(400).json({ error });

  io.emit("new-mail", data[0]);
  res.json({ status: "ok", received: data[0] });
});

// ========================================================
// 🚀  NOUVEAU : WEBHOOK EMAIL CLOUDMAILIN
// ========================================================

app.post("/webhook/email", async (req, res) => {
  try {
    console.log("📩 Email reçu :", req.body);

    const email = req.body;
    const { headers, envelope, html, text } = email;

    // 📥 Normalisation des champs
    const newMail = {
      sujet: headers?.subject || "Sans sujet",
      message: text || html || "",
      sender: envelope?.from || "Inconnu",
      to: envelope?.to || "",
      raw: email,
    };

    // 💾 Insertion dans Supabase
    const { data, error } = await supabase.from("mails").insert([newMail]).select();

    if (error) {
      console.error("❌ Erreur Supabase :", error);
      return res.status(500).json({ error });
    }

    console.log("✅ Email enregistré dans Supabase :", data[0]);

    // 🔊 Notif en temps réel pour ton app
    io.emit("new-mail", data[0]);

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erreur webhook email :", err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
//  ROUTE : ASSISTANT IA (planning + contacts)
// ========================================================

app.post("/assistant/message", async (req, res) => {
  try {
    const { userId, userName, message } = req.body;
    if (!userId || !message)
      return res.status(400).json({ error: "userId et message requis" });

    const [{ data: planning }, { data: contacts }] = await Promise.all([
      supabase
        .from("planning")
        .select("*")
        .eq("user_id", userId)
        .order("start_at", { ascending: true })
        .limit(10),
      supabase.from("contacts").select("*").eq("user_id", userId).limit(20),
    ]);

    // Contexte IA
    const context = [];
    if (userName) context.push(`Utilisateur : ${userName}`);

    if (planning?.length) {
      context.push("Prochains rendez-vous :");
      planning.forEach((p) => context.push(`- ${p.title} le ${p.start_at}`));
    } else context.push("Aucun rendez-vous trouvé.");

    if (contacts?.length) {
      context.push("Contacts :");
      contacts.slice(0, 5).forEach((c) =>
        context.push(`- ${c.name}${c.phone ? " (" + c.phone + ")" : ""}`)
      );
    } else context.push("Aucun contact trouvé.");

    const payload = {
      userId,
      userName,
      message,
      context: context.join("\n"),
    };

    let reply = "Je n’ai pas de réponse pour le moment.";

    if (N8N_WEBHOOK) {
      // Envoi vers n8n
      const n8nRes = await fetch(N8N_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!n8nRes.ok) {
        const text = await n8nRes.text();
        return res.status(502).json({ error: "Erreur n8n", details: text });
      }

      const json = await n8nRes.json();
      reply = json.reply || reply;

    } else if (OPENAI_API_KEY) {
      // Appel direct à OpenAI
      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Tu es un assistant professionnel qui aide à gérer le planning et les contacts.",
            },
            {
              role: "user",
              content: `Contexte:\n${payload.context}\n\nQuestion: ${message}`,
            },
          ],
        }),
      });

      const aiJson = await aiRes.json();
      reply = aiJson?.choices?.[0]?.message?.content || reply;
    }

    res.json({ reply });
  } catch (err) {
    console.error("Erreur assistant:", err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 🚀 LANCER SERVEUR
// ========================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Serveur en ligne sur le port ${PORT}`));
