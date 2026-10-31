
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const pino = require("pino");
const path = require("path");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "htr-secret-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 86400000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

let sock = null;
let botStatus = "Offline";
let botNumber = "";
let pairingCode = "";
let isConnecting = false;
let shouldReconnect = true;
let currentPhone = "";

function auth(req, res, next) {
  if (req.session.loggedIn) return next();
  res.status(401).json({ error: "Silakan login terlebih dahulu." });
}

// LOGIN ADMIN
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }

  res.status(401).json({
    error: "Username atau password salah."
  });
});

// LOGOUT ADMIN
app.post("/api/logout", auth, (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// STATUS BOT
app.get("/api/status", auth, (req, res) => {
  res.json({
    status: botStatus,
    number: botNumber,
    code: pairingCode
  });
});

// GENERATE PAIRING CODE
app.post("/api/connect", auth, async (req, res) => {
  if (isConnecting || sock) {
    return res.status(400).json({
      error: "Bot sedang terhubung atau diproses."
    });
  }

  const phone = String(req.body.phone || "").replace(/\D/g, "");

  if (phone.length < 10 || phone.length > 15) {
    return res.status(400).json({
      error: "Nomor tidak valid. Gunakan kode negara, contoh 628123456789."
    });
  }

  currentPhone = phone;
  isConnecting = true;
  shouldReconnect = true;
  botStatus = "Menghubungkan";

  res.json({ success: true });

  startWhatsApp(phone).catch(err => {
    console.error(err);
    botStatus = "Error";
    isConnecting = false;
  });
});

// PAIRING CODE
app.get("/api/pairing", auth, (req, res) => {
  res.json({ code: pairingCode });
});

// KIRIM PESAN
app.post("/api/send", auth, async (req, res) => {
  try {
    if (!sock || botStatus !== "Online") {
      return res.status(400).json({
        error: "WhatsApp belum terhubung."
      });
    }

    const number = String(req.body.number || "").replace(/\D/g, "");
    const message = String(req.body.message || "").trim();

    if (number.length < 10 || number.length > 15) {
      return res.status(400).json({
        error: "Nomor tujuan tidak valid."
      });
    }

    if (!message || message.length > 4000) {
      return res.status(400).json({
        error: "Pesan kosong atau terlalu panjang."
      });
    }

    await sock.sendMessage(number + "@s.whatsapp.net", {
      text: message
    });

    res.json({ success: true, message: "Pesan terkirim." });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Gagal mengirim pesan."
    });
  }
});

// LOGOUT WHATSAPP
app.post("/api/disconnect", auth, async (req, res) => {
  shouldReconnect = false;
  pairingCode = "";
  botStatus = "Offline";
  isConnecting = false;

  try {
    if (sock) {
      await sock.logout();
      sock = null;
    }

    res.json({ success: true });
  } catch (err) {
    sock = null;
    res.json({ success: true });
  }
});

// MESIN WHATSAPP
async function startWhatsApp(phone) {
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, "session_data")
  );

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["HTR FAMILY BOT", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      botStatus = "Online";
      botNumber = sock.user?.id?.split(":")[0] || phone;
      pairingCode = "";
      isConnecting = false;

      console.log("HTR FAMILY BOT ONLINE:", botNumber);
    }

    if (connection === "close") {
      botStatus = "Offline";
      sock = null;
      isConnecting = false;

      const code = lastDisconnect?.error?.output?.statusCode;

      if (
        shouldReconnect &&
        code !== DisconnectReason.loggedOut
      ) {
        setTimeout(() => {
          startWhatsApp(currentPhone).catch(console.error);
        }, 5000);
      }
    }
  });

  if (!state.creds.registered) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const rawCode = await sock.requestPairingCode(phone);

      pairingCode = rawCode.match(/.{1,4}/g)?.join("-") || rawCode;

      console.log("PAIRING CODE:", pairingCode);
    } catch (err) {
      console.error("Pairing error:", err);
      botStatus = "Error";
      isConnecting = false;
    }
  }
}

// HALAMAN UTAMA
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("HTR FAMILY BOT berjalan pada port " + PORT);
});
      
