
const express = require("express");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

// ============================================
// CONFIGURATION
// ============================================

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;

const APP_NAME = "SAN FITNESS WhatsApp Webhook";

// ============================================
// ENVIRONMENT VALIDATION
// ============================================

if (!VERIFY_TOKEN) {
  console.error("ERROR: VERIFY_TOKEN is missing.");
  process.exit(1);
}

if (!APP_SECRET) {
  console.error("ERROR: META_APP_SECRET is missing.");
  process.exit(1);
}

// ============================================
// HEALTH CHECK
// ============================================

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "SAN FITNESS WhatsApp Webhook is running!",
    service: APP_NAME,
    status: "healthy",
  });
});

// ============================================
// META WEBHOOK VERIFICATION
// GET /api/webhooks/whatsapp
// ============================================

app.get("/api/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("WhatsApp webhook verification request received");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("SAN FITNESS WhatsApp webhook verified successfully");

    return res.status(200).send(challenge);
  }

  console.error("WhatsApp webhook verification failed");

  return res.status(403).send("Webhook verification failed");
});

// ============================================
// META SIGNATURE VALIDATION
// ============================================

function validateMetaSignature(req) {
  const signature = req.headers["x-hub-signature-256"];

  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const receivedSignature = signature.substring(7);

  if (!/^[a-fA-F0-9]{64}$/.test(receivedSignature)) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", APP_SECRET)
    .update(req.body)
    .digest("hex");

  const receivedBuffer = Buffer.from(receivedSignature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

// ============================================
// WHATSAPP MESSAGE HANDLER
// ============================================

async function handleIncomingMessage(message, contact, metadata) {
  console.log("----------------------------------");
  console.log("SAN FITNESS: INCOMING MESSAGE");
  console.log("----------------------------------");

  console.log("Message ID:", message.id);
  console.log("From:", message.from);
  console.log("Message Type:", message.type);
  console.log("Contact:", contact?.profile?.name || "Unknown");
  console.log("Phone Number ID:", metadata?.phone_number_id);

  switch (message.type) {
    case "text":
      console.log("Message:", message.text?.body);
      break;

    case "image":
      console.log("Image received:", message.image?.id);
      break;

    case "video":
      console.log("Video received:", message.video?.id);
      break;

    case "audio":
      console.log("Audio received:", message.audio?.id);
      break;

    case "document":
      console.log("Document received:", message.document?.id);
      break;

    case "interactive":
      console.log(
        "Interactive response:",
        JSON.stringify(message.interactive)
      );
      break;

    case "button":
      console.log("Button response:", message.button?.text);
      break;

    default:
      console.log("Other message type received:", message.type);
  }

  // TODO:
  // 1. Save the incoming message in your database.
  // 2. Connect SAN FITNESS customer management.
  // 3. Implement automated replies if required.
}

// ============================================
// WHATSAPP DELIVERY STATUS HANDLER
// ============================================

function handleMessageStatus(status) {
  console.log("----------------------------------");
  console.log("SAN FITNESS: MESSAGE STATUS");
  console.log("----------------------------------");

  console.log("Message ID:", status.id);
  console.log("Recipient:", status.recipient_id);
  console.log("Status:", status.status);
  console.log("Timestamp:", status.timestamp);

  if (status.errors?.length) {
    console.error("WhatsApp delivery errors:", status.errors);
  }

  // TODO:
  // Update message delivery status in your database.
}

// ============================================
// PROCESS WHATSAPP WEBHOOK PAYLOAD
// ============================================

async function processWebhookPayload(payload) {
  if (payload.object !== "whatsapp_business_account") {
    console.log("Ignoring unsupported webhook object:", payload.object);
    return;
  }

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") {
        console.log("Other webhook field:", change.field);
        continue;
      }

      const value = change.value || {};

      const contacts = value.contacts || [];
      const messages = value.messages || [];
      const statuses = value.statuses || [];

      // Incoming customer messages
      for (const message of messages) {
        const contact = contacts.find(
          (item) => item.wa_id === message.from
        );

        await handleIncomingMessage(
          message,
          contact,
          value.metadata
        );
      }

      // Sent message delivery/read status
      for (const status of statuses) {
        handleMessageStatus(status);
      }
    }
  }
}

// ============================================
// RECEIVE WHATSAPP WEBHOOK EVENTS
// POST /api/webhooks/whatsapp
// ============================================

// IMPORTANT:
// Keep express.raw() on this route.
// Signature validation needs the original request body.

app.post(
  "/api/webhooks/whatsapp",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).send("Invalid request body");
      }

      // Validate Meta request signature
      const isValid = validateMetaSignature(req);

      if (!isValid) {
        console.error("Invalid Meta webhook signature");
        return res.status(401).send("Invalid signature");
      }

      // Parse JSON only after signature validation
      const payload = JSON.parse(req.body.toString("utf8"));

      console.log("Verified WhatsApp webhook event received");

      // Acknowledge the webhook before lengthy processing
      res.sendStatus(200);

      // Process asynchronously
      try {
        await processWebhookPayload(payload);
      } catch (processingError) {
        console.error(
          "Webhook processing error:",
          processingError.message
        );
      }
    } catch (error) {
      console.error("Webhook request error:", error.message);

      if (!res.headersSent) {
        return res.status(400).send("Invalid webhook payload");
      }
    }
  }
);

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log("----------------------------------");
  console.log("SAN FITNESS WHATSAPP WEBHOOK");
  console.log("----------------------------------");
  console.log(`Server running on port ${PORT}`);
  console.log(`Health: /`);
  console.log(`Webhook: /api/webhooks/whatsapp`);
  console.log("----------------------------------");
});
