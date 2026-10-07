import express from "express";
import Message, { saveAndTrimMessage } from "../models/Message.js";
import ChatGroup from "../models/ChatGroup.js";
import User from "../models/User.js";
import { authenticateUser } from "../middleware/auth.js";
import {
  verifyTeamMembership,
  verifyGroupMembership,
  getUserFormedTeams,
} from "../utils/teamAuth.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// 👤 Chat Username Handle Management
// ---------------------------------------------------------------------------

// PUT /api/chat/username - Allows team member to create or update their unique chat username
router.put("/username", authenticateUser, async (req, res) => {
  try {
    let { username } = req.body;
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Username is required." });
    }

    username = username.trim().replace(/^@+/, ""); // strip leading @

    // Validate format: 3-25 alphanumeric and underscore characters
    const usernameRegex = /^[a-zA-Z0-9_]{3,25}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        error: "Username must be 3-25 characters long and contain only letters, numbers, and underscores.",
      });
    }

    // Check if another user already has this chat username
    const existing = await User.findOne({
      chatUsername: { $regex: new RegExp(`^${username}$`, "i") },
      _id: { $ne: req.user._id },
    });

    if (existing) {
      return res.status(409).json({ error: "Username is already taken by another builder." });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { chatUsername: username },
      { new: true }
    ).select("-password");

    return res.json({
      success: true,
      message: "Chat username updated successfully.",
      user: updatedUser,
      chatUsername: username,
    });
  } catch (err) {
    console.error("Update chat username error:", err);
    return res.status(500).json({ error: "Could not update chat username.", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// 👥 Formed Teams Discovery for Group Creation
// ---------------------------------------------------------------------------

// GET /api/chat/user-teams - Returns all teams formed by or joined by the user for group creation
router.get("/user-teams", authenticateUser, async (req, res) => {
  try {
    const teams = await getUserFormedTeams(req.user._id);
    return res.json({
      success: true,
      teams,
    });
  } catch (err) {
    console.error("Fetch user teams for chat error:", err);
    return res.status(500).json({ error: "Could not fetch user teams.", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// 💬 WhatsApp-style Team Chat Groups
// ---------------------------------------------------------------------------

// GET /api/chat/groups - Returns all groups the current user belongs to or created
router.get("/groups", authenticateUser, async (req, res) => {
  try {
    const userId = req.user._id;

    const groups = await ChatGroup.find({
      $or: [{ members: userId }, { admin: userId }],
    })
      .populate("admin", "name email avatar profileImage chatUsername role roleTitle college university")
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({
      success: true,
      groups,
    });
  } catch (err) {
    console.error("Fetch chat groups error:", err);
    return res.status(500).json({ error: "Could not load chat groups.", details: err.message });
  }
});

// POST /api/chat/groups - Team admin/lead creates a new group for their formed team
router.post("/groups", authenticateUser, async (req, res) => {
  try {
    const { name, description, groupProfilePic, teamId, memberIds = [] } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Group name is required." });
    }

    if (name.trim().length > 60) {
      return res.status(400).json({ error: "Group name cannot exceed 60 characters." });
    }

    let teamName = "Team Squad";
    let teamType = "Custom";
    let allowedMemberIds = new Set([String(req.user._id)]);

    // If linked to a team, verify membership & authorize member selection
    if (teamId) {
      const authCheck = await verifyTeamMembership(req.user._id, teamId, req.user.role);
      if (!authCheck.valid) {
        return res.status(403).json({ error: "You can only create groups for teams you are a part of." });
      }

      teamName = authCheck.teamName || "Team Squad";
      teamType = authCheck.entityType || "Project";

      // Populate valid members from that team
      (authCheck.members || []).forEach((m) => {
        allowedMemberIds.add(String(m._id || m));
      });
    }

    // Filter requested memberIds so only valid team members are added
    const initialMembers = new Set([String(req.user._id)]);
    if (Array.isArray(memberIds)) {
      for (const mId of memberIds) {
        const idStr = String(mId);
        if (allowedMemberIds.has(idStr)) {
          initialMembers.add(idStr);
        }
      }
    }

    const newGroup = await ChatGroup.create({
      name: name.trim(),
      description: (description || "").trim().slice(0, 200),
      // Group Profile Picture is the only media permitted
      groupProfilePic: groupProfilePic || "",
      teamId: teamId || undefined,
      teamName,
      teamType,
      admin: req.user._id,
      members: Array.from(initialMembers),
      lastMessage: {
        text: `Group created by ${req.user.name}`,
        senderName: "System",
        senderUsername: "system",
        createdAt: new Date(),
      },
    });

    const populatedGroup = await ChatGroup.findById(newGroup._id)
      .populate("admin", "name email avatar profileImage chatUsername role roleTitle college university")
      .populate("members", "name email avatar profileImage chatUsername role roleTitle college university")
      .lean();

    // Broadcast new group creation to all group members via Socket.IO
    const io = req.app.get("io");
    if (io) {
      for (const member of populatedGroup.members || []) {
        io.to(`user:${member._id}`).emit("group_created", populatedGroup);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Group created successfully.",
      group: populatedGroup,
    });
  } catch (err) {
    console.error("Create chat group error:", err);
    return res.status(500).json({ error: "Failed to create group.", details: err.message });
  }
});

// GET /api/chat/groups/:groupId/messages - Load messages for a group
router.get("/groups/:groupId/messages", authenticateUser, async (req, res) => {
  try {
    const { groupId } = req.params;
    const authCheck = await verifyGroupMembership(req.user._id, groupId, req.user.role);

    if (!authCheck.valid) {
      return res.status(403).json({ error: authCheck.error });
    }

    // Fetch messages for this group (max 500 messages, 30-day TTL index applied)
    const messages = await Message.find({ groupId, ...(req.query.after && !isNaN(Date.parse(req.query.after)) ? { createdAt: { $gte: new Date(req.query.after) } } : {}) })
      .populate("senderId", "name email avatar profileImage chatUsername role roleTitle college university")
      .sort({ createdAt: -1, _id: -1 })
      .limit(500)
      .lean();

    return res.json({
      success: true,
      groupId,
      group: authCheck.group,
      messages: messages.reverse(),
      isGroupAdmin: authCheck.isGroupAdmin,
    });
  } catch (err) {
    console.error("Fetch group messages error:", err);
    return res.status(500).json({ error: "Could not retrieve group messages.", details: err.message });
  }
});

// POST /api/chat/groups/:groupId/messages - Send text message to group (REST fallback / direct)
router.post("/groups/:groupId/messages", authenticateUser, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { text, clientMessageId } = req.body;

    const authCheck = await verifyGroupMembership(req.user._id, groupId, req.user.role, false);
    if (!authCheck.valid) {
      return res.status(403).json({ error: authCheck.error });
    }

    // Strictly plain text only: no files, no photos, no videos, no pdfs, no stickers, no gifs
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Message text cannot be empty." });
    }

    if (text.length > 1000) {
      return res.status(400).json({ error: "Message cannot exceed 1000 characters." });
    }

    // Save with 500-message retention & 30-day TTL storage protection
    const savedMessage = await saveAndTrimMessage({
      groupId,
      senderId: req.user._id,
      text,
      clientMessageId,
    });

    // Update lastMessage on ChatGroup
    await ChatGroup.findByIdAndUpdate(groupId, {
      lastMessage: {
        text: text.trim().slice(0, 100),
        senderName: req.user.name,
        senderUsername: req.user.chatUsername || "",
        createdAt: savedMessage.createdAt || new Date(),
      },
    });

    // Broadcast to group room in Socket.IO
    const io = req.app.get("io");
    if (io) {
      io.to(`group:${groupId}`).emit("new_group_message", {
        groupId,
        message: savedMessage,
      });
    }

    return res.status(201).json({
      success: true,
      message: savedMessage,
    });
  } catch (err) {
    console.error("Send group message error:", err);
    return res.status(500).json({ error: "Message could not be sent.", details: err.message });
  }
});

// POST /api/chat/groups/:groupId/members - Group admin adds teammates to group
router.post("/groups/:groupId/members", authenticateUser, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberIds } = req.body;

    const authCheck = await verifyGroupMembership(req.user._id, groupId, req.user.role);
    if (!authCheck.valid) {
      return res.status(403).json({ error: authCheck.error });
    }

    if (!authCheck.isGroupAdmin) {
      return res.status(403).json({ error: "Only the group admin can add members to this group." });
    }

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: "memberIds must be a non-empty array." });
    }

    const group = authCheck.group;

    // If group has teamId, verify that the added members belong to that team
    let validMemberIdsToAdd = [];
    if (!group.teamId) return res.status(400).json({ error: "This group is not linked to a team." });
    if (group.teamId) {
      const teamCheck = await verifyTeamMembership(req.user._id, group.teamId, req.user.role);
      if (!teamCheck.valid) return res.status(403).json({ error: teamCheck.error });
      if (teamCheck.valid) {
        const allowed = new Set((teamCheck.members || []).map((m) => String(m._id || m)));
        validMemberIdsToAdd = memberIds.filter((id) => allowed.has(String(id)));
      }
    }

    if (validMemberIdsToAdd.length !== memberIds.length) {
      return res.status(400).json({ error: "Only current team members can be added." });
    }

    const updatedGroup = await ChatGroup.findByIdAndUpdate(
      groupId,
      {
        $addToSet: { members: { $each: validMemberIdsToAdd } },
      },
      { new: true }
    )
      .populate("admin", "name email avatar profileImage chatUsername role roleTitle college university")
      .populate("members", "name email avatar profileImage chatUsername role roleTitle college university")
      .lean();

    // Broadcast update via Socket.IO
    const io = req.app.get("io");
    if (io) {
      for (const member of updatedGroup.members) {
        io.to(`user:${member._id}`).emit("group_members_updated", updatedGroup);
      }
    }

    return res.json({
      success: true,
      message: "Members added successfully.",
      group: updatedGroup,
    });
  } catch (err) {
    console.error("Add group members error:", err);
    return res.status(500).json({ error: "Could not add group members.", details: err.message });
  }
});

// PUT /api/chat/groups/:groupId - Group admin updates group profile picture or name
router.put("/groups/:groupId", authenticateUser, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, description, groupProfilePic } = req.body;

    const authCheck = await verifyGroupMembership(req.user._id, groupId, req.user.role);
    if (!authCheck.valid) {
      return res.status(403).json({ error: authCheck.error });
    }

    if (!authCheck.isGroupAdmin) {
      return res.status(403).json({ error: "Only the group admin can update group details." });
    }

    const updates = {};
    if (name && typeof name === "string") updates.name = name.trim().slice(0, 60);
    if (description !== undefined) updates.description = String(description).trim().slice(0, 200);
    if (groupProfilePic !== undefined) updates.groupProfilePic = String(groupProfilePic);

    const updatedGroup = await ChatGroup.findByIdAndUpdate(groupId, updates, { new: true })
      .populate("admin", "name email avatar profileImage chatUsername role roleTitle college university")
      .populate("members", "name email avatar profileImage chatUsername role roleTitle college university")
      .lean();

    // Broadcast update via Socket.IO
    const io = req.app.get("io");
    if (io) {
      io.to(`group:${groupId}`).emit("group_updated", updatedGroup);
    }

    return res.json({
      success: true,
      message: "Group updated successfully.",
      group: updatedGroup,
    });
  } catch (err) {
    console.error("Update group error:", err);
    return res.status(500).json({ error: "Could not update group.", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// 📦 Team Chat (Preserved from Previous Version)
// ---------------------------------------------------------------------------

// GET /api/chat/:teamId/messages - Load existing chat history from MongoDB
router.get("/:teamId/messages", authenticateUser, async (req, res) => {
  try {
    const { teamId } = req.params;
    const authCheck = await verifyTeamMembership(req.user._id, teamId, req.user.role);

    if (!authCheck.valid) {
      return res.status(403).json({ error: authCheck.error || "Access denied: You are not a member of this team." });
    }

    const messages = await Message.find({ teamId, ...(req.query.after && !isNaN(Date.parse(req.query.after)) ? { createdAt: { $gte: new Date(req.query.after) } } : {}) })
      .populate("senderId", "name email avatar profileImage chatUsername role roleTitle college university")
      .sort({ createdAt: -1, _id: -1 })
      .limit(500)
      .lean();

    return res.json({
      success: true,
      teamId,
      teamName: authCheck.teamName,
      members: authCheck.members,
      messages: messages.reverse(),
    });
  } catch (err) {
    console.error("Fetch team chat messages error:", err);
    return res.status(500).json({ error: "Could not retrieve chat messages.", details: err.message });
  }
});

// POST /api/chat/:teamId/messages - Send text message to team (REST fallback / direct)
router.post("/:teamId/messages", authenticateUser, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { text, clientMessageId } = req.body;

    const authCheck = await verifyTeamMembership(req.user._id, teamId, req.user.role);
    if (!authCheck.valid) {
      return res.status(403).json({ error: authCheck.error || "Access denied: You are not a member of this team." });
    }

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Message text cannot be empty." });
    }

    if (text.length > 1000) {
      return res.status(400).json({ error: "Message cannot exceed 1000 characters." });
    }

    // Persist to MongoDB with 500-message retention & 30-day TTL protection
    const savedMessage = await saveAndTrimMessage({
      teamId,
      senderId: req.user._id,
      text,
      clientMessageId,
    });

    // Broadcast saved message to other team members via Socket.IO
    const io = req.app.get("io");
    if (io) {
      io.to(`team:${teamId}`).emit("new_message", savedMessage);
    }

    return res.status(201).json({
      success: true,
      message: savedMessage,
    });
  } catch (err) {
    console.error("Send team chat message error:", err);
    return res.status(500).json({ error: "Message could not be sent. Please try again.", details: err.message });
  }
});

// GET /api/chat/:teamId/details - Retrieve team details and member list for chat header
router.get("/:teamId/details", authenticateUser, async (req, res) => {
  try {
    const { teamId } = req.params;
    const authCheck = await verifyTeamMembership(req.user._id, teamId, req.user.role);

    if (!authCheck.valid) {
      return res.status(403).json({ error: authCheck.error || "Access denied: You are not a member of this team." });
    }

    return res.json({
      success: true,
      teamId: authCheck.teamId,
      teamName: authCheck.teamName,
      members: authCheck.members,
    });
  } catch (err) {
    console.error("Get team chat details error:", err);
    return res.status(500).json({ error: "Could not retrieve team details.", details: err.message });
  }
});

export default router;
