import mongoose from "mongoose";
import Team from "../models/Team.js";
import Project from "../models/Project.js";
import HackathonTeam from "../models/HackathonTeam.js";
import User from "../models/User.js";
import ChatGroup from "../models/ChatGroup.js";

/**
 * Securely verifies whether a given user is an authorized member or owner of a team.
 * Checks existing Team, Project, and HackathonTeam collections.
 *
 * @param {string|mongoose.Types.ObjectId} userId - The authenticated user's ID
 * @param {string|mongoose.Types.ObjectId} teamId - The team/project ID
 * @param {string} [userRole] - The user's role (admin bypass)
 * @returns {Promise<{ valid: boolean, error?: string, teamId?: any, teamName?: string, members?: Array, entityType?: string, isOwner?: boolean }>}
 */
export async function verifyTeamMembership(userId, teamId, userRole = "student") {
  if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) {
    return { valid: false, error: "Invalid team identifier." };
  }

  const userObjectIdStr = String(userId);
  const isAdmin = userRole === "admin";

  // 1. Check Team model
  const [teamDoc, projectDoc, hackTeamDoc] = await Promise.all([
    Team.findById(teamId).select("owner members teamName").lean(),
    Project.findById(teamId).select("createdBy members title").lean(),
    HackathonTeam.findById(teamId).select("createdBy members teamName title").lean(),
  ]);
  if (teamDoc) {
    const isOwner = teamDoc.owner && String(teamDoc.owner) === userObjectIdStr;
    const isMember = Array.isArray(teamDoc.members) && teamDoc.members.some((m) => String(m) === userObjectIdStr);

    if (isOwner || isMember || isAdmin) {
      const allMemberIds = Array.from(
        new Set([
          teamDoc.owner ? String(teamDoc.owner) : null,
          ...(teamDoc.members || []).map((m) => String(m)),
        ].filter(Boolean))
      );

      const populatedMembers = await User.find({ _id: { $in: allMemberIds } })
        .select("name email avatar profileImage chatUsername role roleTitle college university")
        .lean();

      return {
        valid: true,
        teamId: teamDoc._id,
        teamName: teamDoc.teamName || "Team",
        members: populatedMembers,
        entityType: "Team",
        isOwner: isOwner || isAdmin,
      };
    }

    return { valid: false, error: "Access denied: You are not a member of this team." };
  }

  // 2. Check Project model (projects represent collaboration squads)

  if (projectDoc) {
    const isOwner = projectDoc.createdBy && String(projectDoc.createdBy) === userObjectIdStr;
    const isMember = Array.isArray(projectDoc.members) && projectDoc.members.some((m) => String(m) === userObjectIdStr);

    if (isOwner || isMember || isAdmin) {
      const allMemberIds = Array.from(
        new Set([
          projectDoc.createdBy ? String(projectDoc.createdBy) : null,
          ...(projectDoc.members || []).map((m) => String(m)),
        ].filter(Boolean))
      );

      const populatedMembers = await User.find({ _id: { $in: allMemberIds } })
        .select("name email avatar profileImage chatUsername role roleTitle college university")
        .lean();

      return {
        valid: true,
        teamId: projectDoc._id,
        teamName: projectDoc.title || "Project Team",
        members: populatedMembers,
        entityType: "Project",
        isOwner: isOwner || isAdmin,
      };
    }

    return { valid: false, error: "Access denied: You are not a member of this team." };
  }

  // 3. Check HackathonTeam model (hackathon squads)

  if (hackTeamDoc) {
    const isOwner = hackTeamDoc.createdBy && String(hackTeamDoc.createdBy) === userObjectIdStr;
    const isMember = Array.isArray(hackTeamDoc.members) && hackTeamDoc.members.some((m) => String(m) === userObjectIdStr);

    if (isOwner || isMember || isAdmin) {
      const allMemberIds = Array.from(
        new Set([
          hackTeamDoc.createdBy ? String(hackTeamDoc.createdBy) : null,
          ...(hackTeamDoc.members || []).map((m) => String(m)),
        ].filter(Boolean))
      );

      const populatedMembers = await User.find({ _id: { $in: allMemberIds } })
        .select("name email avatar profileImage chatUsername role roleTitle college university")
        .lean();

      return {
        valid: true,
        teamId: hackTeamDoc._id,
        teamName: hackTeamDoc.teamName || hackTeamDoc.title || "Hackathon Squad",
        members: populatedMembers,
        entityType: "HackathonTeam",
        isOwner: isOwner || isAdmin,
      };
    }

    return { valid: false, error: "Access denied: You are not a member of this team." };
  }

  return { valid: false, error: "Team not found." };
}

/**
 * Verifies whether a given user is an authorized member or admin of a WhatsApp-style ChatGroup.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} groupId
 * @param {string} [userRole]
 * @returns {Promise<{ valid: boolean, error?: string, group?: any, isGroupAdmin?: boolean }>}
 */
export async function verifyGroupMembership(userId, groupId, userRole = "student", populate = true) {
  if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
    return { valid: false, error: "Invalid group identifier." };
  }

  const userObjectIdStr = String(userId);
  const isAdmin = userRole === "admin";

  const query = ChatGroup.findById(groupId);
  if (populate) {
    query.populate("admin", "name email avatar profileImage chatUsername role roleTitle college university")
      .populate("members", "name email avatar profileImage chatUsername role roleTitle college university");
  }
  const group = await query.lean();

  if (!group) {
    return { valid: false, error: "Group not found." };
  }

  const isGroupAdmin = group.admin && String(group.admin._id || group.admin) === userObjectIdStr;
  const isMember = Array.isArray(group.members) && group.members.some((m) => String(m._id || m) === userObjectIdStr);

  if (isGroupAdmin || isMember || isAdmin) {
    return {
      valid: true,
      group,
      isGroupAdmin: isGroupAdmin || isAdmin,
    };
  }

  return { valid: false, error: "Access denied: You are not a member of this chat group." };
}

/**
 * Returns all formed teams (Projects, Hackathon Teams, Teams) where the user is a creator or member,
 * along with their teammate rosters, for creating WhatsApp-style team groups.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Array>}
 */
export async function getUserFormedTeams(userId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const userStr = String(userId);

  const [projects, hackTeams, customTeams] = await Promise.all([
    Project.find({
      $or: [{ createdBy: userObjectId }, { members: userObjectId }],
    })
      .select("createdBy members title teamName categoryBadge track")
      .populate("createdBy", "name email avatar profileImage chatUsername role roleTitle college university")
      .populate("members", "name email avatar profileImage chatUsername role roleTitle college university")
      .lean(),

    HackathonTeam.find({
      $or: [{ createdBy: userObjectId }, { members: userObjectId }],
    })
      .select("createdBy members title teamName categoryBadge track")
      .populate("createdBy", "name email avatar profileImage chatUsername role roleTitle college university")
      .populate("members", "name email avatar profileImage chatUsername role roleTitle college university")
      .lean(),

    Team.find({
      $or: [{ owner: userObjectId }, { members: userObjectId }],
    })
      .select("owner members teamName")
      .populate("owner", "name email avatar profileImage chatUsername role roleTitle college university")
      .populate("members", "name email avatar profileImage chatUsername role roleTitle college university")
      .lean(),
  ]);

  const result = [];

  // 1. Projects
  for (const p of projects || []) {
    const isLead = p.createdBy && String(p.createdBy._id || p.createdBy) === userStr;
    const allMembers = [
      p.createdBy,
      ...(p.members || []),
    ].filter((m) => m && m._id);

    // Deduplicate members
    const seen = new Set();
    const uniqueMembers = [];
    for (const m of allMembers) {
      const id = String(m._id);
      if (!seen.has(id)) {
        seen.add(id);
        uniqueMembers.push(m);
      }
    }

    result.push({
      id: String(p._id),
      teamId: String(p._id),
      name: p.title || "Project Squad",
      teamName: p.title || "Project Squad",
      type: "Project",
      category: p.categoryBadge || "Project",
      isLead,
      members: uniqueMembers,
    });
  }

  // 2. Hackathon Squads
  for (const h of hackTeams || []) {
    const isLead = h.createdBy && String(h.createdBy._id || h.createdBy) === userStr;
    const allMembers = [
      h.createdBy,
      ...(h.members || []),
    ].filter((m) => m && m._id);

    const seen = new Set();
    const uniqueMembers = [];
    for (const m of allMembers) {
      const id = String(m._id);
      if (!seen.has(id)) {
        seen.add(id);
        uniqueMembers.push(m);
      }
    }

    result.push({
      id: String(h._id),
      teamId: String(h._id),
      name: h.teamName || h.title || "Hackathon Squad",
      teamName: h.teamName || h.title || "Hackathon Squad",
      type: "HackathonTeam",
      category: h.track || "Hackathon Squad",
      isLead,
      members: uniqueMembers,
    });
  }

  // 3. Teams
  for (const t of customTeams || []) {
    const isLead = t.owner && String(t.owner._id || t.owner) === userStr;
    const allMembers = [
      t.owner,
      ...(t.members || []),
    ].filter((m) => m && m._id);

    const seen = new Set();
    const uniqueMembers = [];
    for (const m of allMembers) {
      const id = String(m._id);
      if (!seen.has(id)) {
        seen.add(id);
        uniqueMembers.push(m);
      }
    }

    result.push({
      id: String(t._id),
      teamId: String(t._id),
      name: t.teamName || "Team",
      teamName: t.teamName || "Team",
      type: "Team",
      category: "Collegiate Team",
      isLead,
      members: uniqueMembers,
    });
  }

  return result;
}
