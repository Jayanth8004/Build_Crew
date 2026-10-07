import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import dns from "dns";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import teamRoutes from "./routes/teamRoutes.js";
import invitationRoutes from "./routes/invitationRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import hackathonRoutes from "./routes/hackathonRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import { verifyTeamMembership, verifyGroupMembership } from "./utils/teamAuth.js";
import { saveAndTrimMessage } from "./models/Message.js";
import ChatGroup from "./models/ChatGroup.js";

import Project from "./models/Project.js";
import Hackathon from "./models/Hackathon.js";
import HackathonTeam from "./models/HackathonTeam.js";
import User from "./models/User.js";
import { optionalAuth } from "./middleware/auth.js";
import { seedFounderAdmins } from "./seed.js";
import { runHackathonIngestion } from "./services/ingestion/syncService.js";

// Set reliable DNS servers for MongoDB Atlas SRV resolution
try {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
} catch {
  // Ignore if restricted
}

const app = express();
const PORT = process.env.PORT || 5000;

// Dynamic CORS configuration allowing deployed frontend, preview deployments, and localhost
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.APP_URL,
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:5000",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app") ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("https://localhost:")
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// ---------------------------------------------------------------------------
// 🔌 HTTP Server & Socket.IO Real-Time Engine
// ---------------------------------------------------------------------------
const httpServer = createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || "buildcrew_super_secret_jwt_key_2026_secure";

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app") ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("https://localhost:")
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  },
});

app.set("io", io);

// Socket.IO authentication middleware (verifies JWT session)
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return next(new Error("Authentication error: Missing token"));
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.id === "admin-founder-env" || decoded._id === "admin-founder-env") {
      socket.user = {
        _id: "admin-founder-env",
        id: "admin-founder-env",
        email: decoded.email,
        name: decoded.name || "Administrator",
        role: "admin",
      };
      return next();
    }

    if (mongoose.connection.readyState === 1) {
      const user = await User.findById(decoded.id || decoded._id).select("-password");
      if (user) {
        socket.user = user;
        return next();
      }
    }

    if (decoded.role) {
      socket.user = {
        _id: decoded.id || decoded._id,
        id: decoded.id || decoded._id,
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
      };
      return next();
    }

    return next(new Error("Authentication error: User account not found"));
  } catch (err) {
    return next(new Error("Authentication error: Invalid or expired session token"));
  }
});

// Socket.IO event listeners for Team Chat
io.on("connection", (socket) => {
  // Join Team Room (verifies team membership before allowing access)
  socket.on("join_team", async (data, callback) => {
    try {
      const teamId = typeof data === "object" ? data?.teamId : data;
      if (!teamId) {
        if (typeof callback === "function") callback({ error: "teamId is required." });
        return;
      }

      const authCheck = await verifyTeamMembership(socket.user._id, teamId, socket.user.role);
      if (!authCheck.valid) {
        if (typeof callback === "function") {
          callback({ error: authCheck.error || "Access denied: You are not a member of this team." });
        }
        return;
      }

      socket.join(`team:${teamId}`);
      if (typeof callback === "function") {
        callback({ success: true, teamId, teamName: authCheck.teamName });
      }
    } catch (err) {
      console.error("Socket join_team error:", err);
      if (typeof callback === "function") {
        callback({ error: "Could not join team room." });
      }
    }
  });

  // Leave Team Room
  socket.on("leave_team", (data) => {
    const teamId = typeof data === "object" ? data?.teamId : data;
    if (teamId) {
      socket.leave(`team:${teamId}`);
    }
  });

  // Send Message (verifies membership, validates text, saves to MongoDB with 500-message limit, broadcasts)
  socket.on("send_message", async (data, callback) => {
    try {
      const { teamId, text } = data || {};
      if (!teamId) {
        if (typeof callback === "function") callback({ error: "teamId is required." });
        return;
      }

      // Backend security: verify sender's team membership
      const authCheck = await verifyTeamMembership(socket.user._id, teamId, socket.user.role);
      if (!authCheck.valid) {
        if (typeof callback === "function") {
          callback({ error: authCheck.error || "Access denied: You are not a member of this team." });
        }
        return;
      }

      // Text validation: plain text only, non-empty, max 1000 chars
      if (!text || typeof text !== "string" || !text.trim()) {
        if (typeof callback === "function") callback({ error: "Message text cannot be empty." });
        return;
      }

      if (text.length > 1000) {
        if (typeof callback === "function") callback({ error: "Maximum message length is 1000 characters." });
        return;
      }

      // Save to MongoDB with Atlas Free storage protection (500 message retention)
      const savedMessage = await saveAndTrimMessage({
        teamId,
        senderId: socket.user._id,
        text,
      });

      // Broadcast to all team members in real-time
      io.to(`team:${teamId}`).emit("new_message", savedMessage);

      if (typeof callback === "function") {
        callback({ success: true, message: savedMessage });
      }
    } catch (err) {
      console.error("Socket send_message error:", err);
      if (typeof callback === "function") {
        callback({ error: "Message could not be sent. Please try again." });
      }
    }
  });

  // Join user's personal notification room
  if (socket.user?._id) {
    socket.join(`user:${socket.user._id}`);
  }

  // Join Group Room (verifies group membership)
  socket.on("join_group", async (data, callback) => {
    try {
      const groupId = typeof data === "object" ? data?.groupId : data;
      if (!groupId) {
        if (typeof callback === "function") callback({ error: "groupId is required." });
        return;
      }

      const authCheck = await verifyGroupMembership(socket.user._id, groupId, socket.user.role, false);
      if (!authCheck.valid) {
        if (typeof callback === "function") {
          callback({ error: authCheck.error || "Access denied: You are not a member of this chat group." });
        }
        return;
      }

      socket.join(`group:${groupId}`);
      if (typeof callback === "function") {
        callback({ success: true, groupId, groupName: authCheck.group?.name });
      }
    } catch (err) {
      console.error("Socket join_group error:", err);
      if (typeof callback === "function") callback({ error: "Could not join group room." });
    }
  });

  // Leave Group Room
  socket.on("leave_group", (data) => {
    const groupId = typeof data === "object" ? data?.groupId : data;
    if (groupId) {
      socket.leave(`group:${groupId}`);
    }
  });

  // Send Group Message (verifies membership, validates text, saves with 500-message limit, broadcasts)
  socket.on("send_group_message", async (data, callback) => {
    try {
      const { groupId, text } = data || {};
      if (!groupId) {
        if (typeof callback === "function") callback({ error: "groupId is required." });
        return;
      }

      // Security: verify group membership
      const authCheck = await verifyGroupMembership(socket.user._id, groupId, socket.user.role, false);
      if (!authCheck.valid) {
        if (typeof callback === "function") {
          callback({ error: authCheck.error || "Access denied: You are not a member of this chat group." });
        }
        return;
      }

      // Strictly plain text only: max 1000 chars, no files, no stickers, no gifs
      if (!text || typeof text !== "string" || !text.trim()) {
        if (typeof callback === "function") callback({ error: "Message text cannot be empty." });
        return;
      }

      if (text.length > 1000) {
        if (typeof callback === "function") callback({ error: "Maximum message length is 1000 characters." });
        return;
      }

      // Persist to MongoDB with 500-message retention & 30-day TTL protection
      const savedMessage = await saveAndTrimMessage({
        groupId,
        senderId: socket.user._id,
        text,
      });

      // Update lastMessage on ChatGroup
      await ChatGroup.findByIdAndUpdate(groupId, {
        lastMessage: {
          text: text.trim().slice(0, 100),
          senderName: socket.user.name,
          senderUsername: socket.user.chatUsername || "",
          createdAt: savedMessage.createdAt || new Date(),
        },
      });

      // Broadcast to all group members in real-time
      io.to(`group:${groupId}`).emit("new_group_message", {
        groupId,
        message: savedMessage,
      });

      if (typeof callback === "function") {
        callback({ success: true, message: savedMessage });
      }
    } catch (err) {
      console.error("Socket send_group_message error:", err);
      if (typeof callback === "function") {
        callback({ error: "Message could not be sent. Please try again." });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 🔌 MongoDB Connection Helper (Cached for Serverless & Standalone)
// ---------------------------------------------------------------------------
let isConnecting = null;

export const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (!isConnecting) {
    const mongoURI = (process.env.MONGODB_URI || "").trim();
    if (!mongoURI) {
      console.error("MONGODB_URI is not set in environment variables!");
      throw new Error("MONGODB_URI is not set in environment variables");
    }
    isConnecting = mongoose
      .connect(mongoURI, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 })
      .then(async () => {
        console.log("Connected to MongoDB Atlas");
        try {
          await seedFounderAdmins();
        } catch (seedErr) {
          console.warn("Founder admin seed warning:", seedErr.message);
        }
      })
      .catch((err) => {
        isConnecting = null;
        console.error("MongoDB connection error:", err.message);
        throw err;
      });
  }
  await isConnecting;
};

// Database connection middleware: ensures DB is connected before handling any route
app.use(async (req, res, next) => {
  if (req.path === "/" || req.path === "/health" || req.path === "/api/health") {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch (err) {
    return res.status(503).json({
      error: "Database is unavailable. Please check MONGODB_URI configuration.",
      details: process.env.NODE_ENV === "production" ? undefined : err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// 🩺 Health check endpoint
// ---------------------------------------------------------------------------
const healthHandler = (req, res) => {
  res.json({
    status: "online",
    message: "BuildCrew MERN Backend API is running.",
    database: mongoose.connection.readyState === 1 ? "Connected to MongoDB" : "Disconnected",
  });
};

app.get("/", healthHandler);
app.get("/health", healthHandler);

// ---------------------------------------------------------------------------
// 🚀 REST API Modular Routes
// ---------------------------------------------------------------------------
const apiRouter = express.Router();
apiRouter.get("/health", healthHandler);
apiRouter.get("/", healthHandler);

// 📦 Bootstrap Route - Hydrates initial platform state directly from MongoDB
apiRouter.get("/bootstrap", optionalAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({
        success: true,
        data: {
          projects: [],
          hackathons: [],
          squadWins: [],
          builders: [],
          hackathonSquads: [],
        },
      });
    }

    const isAdmin = req.user && req.user.role === "admin";
    const hackathonQuery = isAdmin ? {} : { isPublished: true };

    const [projects, hackathons, builders, hackathonSquads] = await Promise.all([
      Project.find()
        .populate("createdBy", "name email avatar profileImage college university role roleTitle github linkedin showEmailToTeam")
        .populate("members", "name email avatar profileImage college university role roleTitle github linkedin showEmailToTeam")
        .sort({ createdAt: -1 })
        .lean(),
      Hackathon.find(hackathonQuery).sort({ createdAt: -1 }).lean(),
      User.find().select("-password").sort({ createdAt: -1 }).lean(),
      HackathonTeam.find().populate("createdBy", "name email avatar profileImage").sort({ createdAt: -1 }).lean(),
    ]);

    const cleanBuilders = (builders || []).map((u) => {
      if (u.profileImage && u.profileImage.startsWith("data:") && u.profileImage.length > 2000) {
        return { ...u, profileImage: u.avatar || "" };
      }
      return u;
    });

    const cleanProjects = (projects || []).map((p) => {
      const cleanCreatedBy =
        p.createdBy && p.createdBy.profileImage && p.createdBy.profileImage.startsWith("data:") && p.createdBy.profileImage.length > 2000
          ? { ...p.createdBy, profileImage: p.createdBy.avatar || "" }
          : p.createdBy;
      const cleanMembers = (p.members || []).map((m) =>
        m && m.profileImage && m.profileImage.startsWith("data:") && m.profileImage.length > 2000
          ? { ...m, profileImage: m.avatar || "" }
          : m
      );
      return { ...p, createdBy: cleanCreatedBy, members: cleanMembers };
    });

    return res.json({
      success: true,
      data: {
        projects: cleanProjects,
        hackathons,
        squadWins: [],
        builders: cleanBuilders,
        hackathonSquads,
      },
    });
  } catch (err) {
    console.error("Bootstrap data error:", err);
    return res.status(500).json({ error: "Failed to hydrate platform data from MongoDB.", details: err.message });
  }
});

// Modular sub-routes
apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", userRoutes);
apiRouter.use("/projects", projectRoutes);
apiRouter.use("/applications", applicationRoutes);
apiRouter.use("/teams", teamRoutes);
apiRouter.use("/invitations", invitationRoutes);
apiRouter.use("/notifications", notificationRoutes);
apiRouter.use("/hackathons", hackathonRoutes);
apiRouter.use("/chat", chatRoutes);

// 👥 Builders & Squads Endpoints (Synced with MongoDB)
apiRouter.get("/builders", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    const builders = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(builders);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch builders from MongoDB." });
  }
});

apiRouter.post("/builders", async (req, res) => {
  try {
    const { name, role, university, year, skills, avatar, lookingFor } = req.body;
    const cleanEmail = `builder-${Date.now()}@buildcrew.local`;
    const newBuilder = await User.create({
      name: name || "Anonymous Builder",
      email: cleanEmail,
      password: "auto-generated-not-for-login",
      roleTitle: role || "Software Engineer",
      university: university || "",
      college: university || "",
      year: year || "'26",
      skills: Array.isArray(skills) ? skills : typeof skills === "string" ? skills.split(",").map((s) => s.trim()) : [],
      avatar: avatar || "",
      profileImage: avatar || "",
      lookingFor: lookingFor || "",
      role: "student",
    });
    res.status(201).json({ message: "Builder added successfully", builder: newBuilder });
  } catch (err) {
    res.status(500).json({ error: "Failed to create builder in MongoDB", details: err.message });
  }
});

apiRouter.get("/squad-wins", (req, res) => {
  res.json([]);
});

apiRouter.get("/hackathon-squads", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    const squads = await HackathonTeam.find().populate("createdBy", "name email avatar profileImage").sort({ createdAt: -1 });
    res.json(squads);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch hackathon squads from MongoDB." });
  }
});

// Mount routes at both /api and root (for environments/rewrites with or without /api prefix)
app.use("/api", apiRouter);
app.use(apiRouter);

// 404 Route handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global Server Error:", err);
  res.status(500).json({ error: "Internal server error", details: err.message });
});

// ---------------------------------------------------------------------------
// 🔌 Standalone Server Initialization (Local Development)
// ---------------------------------------------------------------------------
if (!process.env.VERCEL) {
  connectDB()
    .then(() => {
      httpServer.listen(PORT, () => {
        console.log(`server is running on port ${PORT}`);

        // Automated Background Ingestion for Karnataka Hackathons
        setTimeout(() => {
          console.log("[Scheduler] Initiating automatic startup sync for Karnataka hackathons...");
          runHackathonIngestion().catch((err) => {
            console.warn("[Scheduler] Startup Karnataka hackathon sync warning:", err.message);
          });
        }, 10000);

        const SIX_HOURS = 6 * 60 * 60 * 1000;
        setInterval(() => {
          console.log("[Scheduler] Running scheduled recurring sync for Karnataka hackathons...");
          runHackathonIngestion().catch((err) => {
            console.warn("[Scheduler] Recurring Karnataka hackathon sync warning:", err.message);
          });
        }, SIX_HOURS);
      });
    })
    .catch((err) => {
      console.error("MongoDB initial connection error:", err.message);
    });
}

export { httpServer, io };
export default app;
