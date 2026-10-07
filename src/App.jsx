import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import CommandPalette from './components/CommandPalette';
import PostProjectModal from './components/PostProjectModal';
import QuickApplyModal from './components/QuickApplyModal';
import TeamChatModal from './components/TeamChatModal';

import DiscoverProjects from './views/DiscoverProjects';
import ProjectDetails from './views/ProjectDetails';
import Hackathons from './views/Hackathons';
import FindBuilders from './views/FindBuilders';
import MyApplications from './views/MyApplications';
import MyProjects from './views/MyProjects';
import Invitations from './views/Invitations';
import Profile from './views/Profile';
import Auth from './views/Auth';
import AdminDashboard from './views/AdminDashboard';
import AccessDenied from './views/AccessDenied';
import GroupChatView from './views/GroupChatView';

import authApi from './api/auth';
import projectsApi from './api/projects';
import hackathonsApi from './api/hackathons';
import usersApi from './api/users';
import applicationsApi from './api/applications';
import invitationsApi from './api/invitations';
import notificationsApi from './api/notifications';
import { API_BASE_URL } from './api/client';

// =========================================================================
// ROUTE WRAPPERS FOR DIRECT URL ACCESS & BROWSER REFRESH SUPPORT
// =========================================================================

function ProjectDetailsRoute({ projects, currentUser, onApplySuccess, onViewProfile, showToast, onOpenTeamChat }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(() => {
    return projects.find(p => String(p._id || p.id) === String(id)) || null;
  });
  const [loading, setLoading] = useState(!project);

  useEffect(() => {
    const found = projects.find(p => String(p._id || p.id) === String(id));
    if (found) {
      setProject(found);
      setLoading(false);
    } else {
      setLoading(true);
      projectsApi.getProjectById(id)
        .then(res => {
          const loaded = res.project || res;
          if (loaded) setProject(loaded);
        })
        .catch(err => {
          console.warn('Could not load project:', err);
          showToast?.('Project could not be found.');
          navigate('/projects', { replace: true });
        })
        .finally(() => setLoading(false));
    }
  }, [id, projects, navigate, showToast]);

  if (loading && !project) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-on-surface-variant min-h-[50vh]">
        <span className="material-symbols-outlined animate-spin text-4xl text-secondary mb-3">progress_activity</span>
        <p className="font-body-md text-body-md">Loading project specifications...</p>
      </div>
    );
  }

  if (!project) return null;

  return (
    <ProjectDetails
      project={project}
      onBack={() => navigate('/projects')}
      onApplySuccess={onApplySuccess}
      onViewProfile={onViewProfile}
      currentUser={currentUser}
      onOpenTeamChat={onOpenTeamChat}
    />
  );
}

function TeamChatDirectRoute({ projects, hackathonSquads, currentUser, onOpenTeamChat, onSelectProject }) {
  const { id } = useParams();

  useEffect(() => {
    if (!id) return;
    const foundProject = projects.find((p) => String(p._id || p.id) === String(id));
    const foundHack = hackathonSquads.find((h) => String(h._id || h.id) === String(id));
    const targetTeam = foundProject || foundHack;

    if (targetTeam) {
      onOpenTeamChat(targetTeam);
    } else {
      projectsApi.getProjectById(id)
        .then((res) => {
          const loaded = res?.project || res;
          if (loaded) onOpenTeamChat(loaded);
        })
        .catch(() => {});
    }
  }, [id, projects, hackathonSquads, onOpenTeamChat]);

  return (
    <MyTeamsView
      currentUser={currentUser}
      projects={projects}
      hackathonSquads={hackathonSquads}
      onSelectProject={onSelectProject}
      onOpenTeamChat={onOpenTeamChat}
    />
  );
}

function HackathonDetailsRoute({ hackathons, ...props }) {
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <Hackathons
      {...props}
      hackathons={hackathons.filter(h => h.isPublished !== false)}
      selectedHackathonId={id}
      onSelectHackathon={(h) => navigate(`/hackathons/${h._id || h.id}`)}
      onCloseDetails={() => navigate('/hackathons')}
    />
  );
}

function ProfileRoute({ currentUser, sentInvitations, onInviteBuilder, onUpdateUser, showToast }) {
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <Profile
      currentUser={currentUser}
      targetUserId={id || null}
      sentInvitations={sentInvitations}
      onBack={() => navigate(-1)}
      onInviteBuilder={onInviteBuilder}
      onUpdateUser={onUpdateUser}
      showToast={showToast}
    />
  );
}

function AdminHackathonEditRoute(props) {
  const { id } = useParams();
  const navigate = useNavigate();

  if (props.currentUser?.role !== 'admin') {
    return <AccessDenied onBack={() => navigate('/dashboard')} />;
  }

  return (
    <AdminDashboard
      {...props}
      initialTab="hackathons"
      initialView="form"
      initialEditingId={id}
      onNavigateRoute={navigate}
    />
  );
}

function MyTeamsView({ currentUser, projects, hackathonSquads, onSelectProject, onOpenTeamChat }) {
  const currentUserId = String(currentUser?._id || currentUser?.id || '');
  
  const myProjectTeams = useMemo(() => {
    return projects.filter(p => {
      if (!currentUser) return false;
      const ownerId = String(p.createdBy?._id || p.createdBy || '');
      const isOwner = ownerId && ownerId === currentUserId;
      const isMember = Array.isArray(p.members) && p.members.some(m => String(m._id || m || '') === currentUserId);
      return isOwner || isMember;
    });
  }, [projects, currentUser, currentUserId]);

  const myHackTeams = useMemo(() => {
    return hackathonSquads.filter(h => {
      if (!currentUser) return false;
      const ownerId = String(h.createdBy?._id || h.createdBy || '');
      const isOwner = ownerId && ownerId === currentUserId;
      const isMember = Array.isArray(h.members) && h.members.some(m => String(m._id || m || '') === currentUserId);
      return isOwner || isMember;
    });
  }, [hackathonSquads, currentUser, currentUserId]);

  const hasAnyTeams = myProjectTeams.length > 0 || myHackTeams.length > 0;

  return (
    <div className="flex flex-col w-full pb-space-xl space-y-space-lg">
      <div className="flex flex-col max-w-3xl">
        <div className="flex items-center gap-space-xs text-secondary font-label-md text-label-md uppercase tracking-wider mb-1">
          <span className="material-symbols-outlined text-base">diversity_3</span>
          <span>Your Teams</span>
        </div>
        <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface tracking-tight">
          My Teams
        </h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
          Teams and projects you are currently collaborating in.
        </p>
      </div>

      {!hasAnyTeams ? (
        <div className="bg-surface-container-lowest rounded-2xl p-space-xl text-center text-on-surface-variant border border-surface-container-high/40">
          <span className="material-symbols-outlined text-4xl text-outline mb-2">diversity_3</span>
          <p className="font-body-lg text-body-lg text-on-surface font-semibold">You haven't joined any teams yet</p>
          <p className="font-body-sm text-body-sm mt-1">Explore Discover Projects or accept team invitations to join a team.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
          {/* Project Teams */}
          {myProjectTeams.map((p, idx) => {
            const isOwner = currentUser && ((p.createdBy?._id || p.createdBy) === currentUser._id);
            return (
              <div key={p._id || idx} className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-sm space-y-4 border border-surface-container-high/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-surface-container text-secondary font-label-sm text-label-sm font-semibold">
                      {p.categoryBadge || p.category || 'Project'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      isOwner ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-surface-container-high text-on-surface-variant'
                    }`}>
                      {isOwner ? 'Creator' : 'Member'}
                    </span>
                  </div>
                  <span className="font-label-sm text-label-sm text-secondary font-semibold">
                    {Math.min(Array.isArray(p.members) && p.members.length > 0 ? p.members.length : (p.filledCount || 1), p.totalCapacity || 4)}/{p.totalCapacity || 4} Members
                  </span>
                </div>
                <div>
                  <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                    {p.title}
                  </h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 line-clamp-2">
                    {p.tagline || p.whatAreYouBuilding || p.problemBeingSolved || p.fullDescription}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low flex items-center justify-between font-body-sm text-body-sm">
                  <span className="text-on-surface font-medium">Created By</span>
                  <span className="text-secondary font-semibold">{p.lead?.name || p.createdBy?.name || 'Project Creator'}</span>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-container-high/60">
                  {onOpenTeamChat && (
                    <button
                      type="button"
                      onClick={() => onOpenTeamChat(p)}
                      className="py-2 px-3.5 rounded-xl bg-secondary/10 hover:bg-secondary/20 text-secondary font-title-sm text-title-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-lg">chat</span>
                      <span>Team Chat</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectProject(p)}
                    className="py-2 px-4 rounded-xl bg-primary text-on-primary font-title-sm text-title-sm hover:bg-surface-tint transition-all cursor-pointer shadow-xs"
                  >
                    View Project &amp; Team
                  </button>
                </div>
              </div>
            );
          })}

          {/* Hackathon Teams */}
          {myHackTeams.map((h, idx) => {
            const isOwner = currentUser && ((h.createdBy?._id || h.createdBy) === currentUser._id);
            return (
              <div key={h._id || idx} className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-sm space-y-4 border border-surface-container-high/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-900 font-label-sm text-label-sm font-semibold">
                      {h.hackathonTitle || 'Hackathon Team'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      isOwner ? 'bg-secondary-fixed text-on-secondary-fixed' : 'bg-surface-container-high text-on-surface-variant'
                    }`}>
                      {isOwner ? 'Creator' : 'Member'}
                    </span>
                  </div>
                  <span className="font-label-sm text-label-sm text-secondary font-semibold">
                    {Math.min(Array.isArray(h.members) && h.members.length > 0 ? h.members.length : (h.filledCount || 1), h.totalCapacity || 4)}/{h.totalCapacity || 4} Members
                  </span>
                </div>
                <div>
                  <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                    {h.teamName || h.title}
                  </h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 line-clamp-2">
                    {h.tagline || h.description || `Competing in ${h.hackathonTitle || 'Hackathon'}`}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-surface-container-low flex items-center justify-between font-body-sm text-body-sm">
                  <span className="text-on-surface font-medium">Team Lead</span>
                  <span className="text-secondary font-semibold">{h.lead?.name || h.createdBy?.name || 'Team Lead'}</span>
                </div>
                {onOpenTeamChat && (
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-container-high/60">
                    <button
                      type="button"
                      onClick={() => onOpenTeamChat(h)}
                      className="py-2 px-3.5 rounded-xl bg-secondary/10 hover:bg-secondary/20 text-secondary font-title-sm text-title-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-lg">chat</span>
                      <span>Team Chat</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// MAIN BUILDCREW APPLICATION COMPONENT
// =========================================================================

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  // Authentication & Session state - initialized from localStorage if available
  const [currentUser, setCurrentUser] = useState(() => authApi.getStoredUser());
  const [isAuthResolving, setIsAuthResolving] = useState(() => Boolean(authApi.getToken()));
  const [applicationsTab, setApplicationsTab] = useState('received');

  // Mobile drawer state
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Backend Hydrated States from MongoDB Atlas
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [hackathons, setHackathons] = useState([]);
  const [squadWins, setSquadWins] = useState([]);
  const [builders, setBuilders] = useState([]);
  const [applications, setApplications] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [receivedInvitations, setReceivedInvitations] = useState([]);
  const [sentInvitations, setSentInvitations] = useState([]);
  const [hackathonSquads, setHackathonSquads] = useState([]);
  const [backendError, setBackendError] = useState(null);

  // Modals state
  const [quickApplyProject, setQuickApplyProject] = useState(null);
  const [isPostProjectOpen, setIsPostProjectOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [chatTeam, setChatTeam] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Toast notification
  const [toastMessage, setToastMessage] = useState(null);
  const [popupNotification, setPopupNotification] = useState(null);
  const popupTimerRef = useRef(null);
  const knownNotificationIdsRef = useRef(new Set());
  const isFirstNotifLoadRef = useRef(true);

  // Derive active view and admin tab cleanly from the browser URL pathname
  const activeView = useMemo(() => {
    if (pathname.startsWith('/admin')) return 'admin-dashboard';
    if (pathname.startsWith('/hackathons')) return 'hackathons';
    if (pathname.startsWith('/find-teammates')) return 'find-builders';
    if (pathname.startsWith('/my-projects')) return 'my-projects';
    if (pathname.startsWith('/applications')) return 'my-applications';
    if (pathname.startsWith('/invitations')) return 'invitations';
    if (pathname.startsWith('/teams')) return 'my-teams';
    if (pathname.startsWith('/group-chat') || pathname.startsWith('/chats')) return 'group-chat';
    if (pathname.startsWith('/settings')) return 'settings';
    if (pathname.startsWith('/profile')) return 'profile';
    return 'discover-projects';
  }, [pathname]);

  const adminTab = useMemo(() => {
    if (pathname.startsWith('/admin/teams')) return 'teams';
    return 'hackathons';
  }, [pathname]);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const showNotificationToast = useCallback((notif) => {
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    setPopupNotification(notif);
    popupTimerRef.current = setTimeout(() => {
      setPopupNotification(null);
    }, 4500);
  }, []);

  // 🔌 Data fetching from MongoDB API
  const fetchHackathons = useCallback(async () => {
    try {
      const data = await hackathonsApi.getHackathons();
      if (Array.isArray(data)) {
        setHackathons(data);
      }
    } catch (err) {
      console.warn('Could not fetch hackathons from MongoDB:', err);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await projectsApi.getProjects();
      const loaded = Array.isArray(data) ? data : (data.projects || []);
      setProjects(loaded);
      setSelectedProject(prev => {
        if (!prev) return loaded.length > 0 ? loaded[0] : null;
        const updated = loaded.find(p => String(p._id || p.id) === String(prev._id || prev.id));
        return updated || prev;
      });
    } catch (err) {
      console.warn('Could not fetch projects from MongoDB:', err);
    }
  }, []);

  const fetchBuilders = useCallback(async () => {
    try {
      const data = await usersApi.getUsers();
      setBuilders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Could not fetch builders from MongoDB:', err);
    }
  }, []);

  const isFetchingUserDataRef = useRef(false);
  const fetchUserData = useCallback(async () => {
    if (isFetchingUserDataRef.current) return;
    isFetchingUserDataRef.current = true;
    try {
      const [appsRes, notifsRes, invsRes] = await Promise.allSettled([
        applicationsApi.getApplications(),
        notificationsApi.getNotifications(),
        invitationsApi.getMyInvitations()
      ]);

      if (appsRes.status === 'fulfilled' && Array.isArray(appsRes.value)) {
        setApplications(appsRes.value);
      }
      if (notifsRes.status === 'fulfilled' && Array.isArray(notifsRes.value)) {
        const notifs = notifsRes.value;
        setNotifications(notifs);

        if (isFirstNotifLoadRef.current) {
          notifs.forEach(n => {
            if (n._id) knownNotificationIdsRef.current.add(String(n._id));
          });
          isFirstNotifLoadRef.current = false;
        } else {
          const newNotifs = notifs.filter(n => n._id && !knownNotificationIdsRef.current.has(String(n._id)) && !n.read);
          notifs.forEach(n => {
            if (n._id) knownNotificationIdsRef.current.add(String(n._id));
          });

          if (newNotifs.length > 0) {
            const latest = newNotifs[0];
            let toastText = '';
            if (latest.type === 'application_accepted') {
              toastText = 'Your application was accepted.';
            } else if (latest.type === 'application_rejected') {
              toastText = 'Your application was rejected.';
            } else if (latest.type === 'invitation_received') {
              toastText = 'You received a team invitation.';
            } else if (latest.type === 'application_received') {
              toastText = latest.message || 'Someone applied to your project.';
            } else {
              toastText = latest.message || 'New notification received.';
            }

            showNotificationToast({
              title: latest.title,
              message: toastText,
              reason: latest.reason || latest.rejectionReason,
              type: latest.type,
            });
          }
        }
      }
      if (invsRes.status === 'fulfilled' && invsRes.value) {
        const received = Array.isArray(invsRes.value.received) ? invsRes.value.received : [];
        const sent = Array.isArray(invsRes.value.sent) ? invsRes.value.sent : [];
        setReceivedInvitations(received);
        setSentInvitations(sent);
      }
    } catch (err) {
      console.warn('Could not load user data from backend:', err);
    } finally {
      isFetchingUserDataRef.current = false;
    }
  }, [showNotificationToast]);

  // Hydrate session and initial MongoDB platform data on mount
  useEffect(() => {
    let isMounted = true;

    const safetyTimer = setTimeout(() => {
      if (isMounted) {
        setIsAuthResolving(false);
      }
    }, 1500);

    const initializeSessionAndData = async () => {
      try {
        setBackendError(null);

        const storedToken = authApi.getToken();
        const authPromise = storedToken
          ? authApi.getMe().catch(error => {
              if (error.status === 401) {
                authApi.logout();
                return null;
              }
              return { user: authApi.getStoredUser() };
            }).then(result => {
              // Authentication need not wait for every project and builder to load.
              if (isMounted) {
                setCurrentUser(result?.user || null);
                setIsAuthResolving(false);
              }
              return result;
            })
          : Promise.resolve(null);

        const bootstrapPromise = fetch(`${API_BASE_URL}/bootstrap`, { signal: AbortSignal.timeout(15000) })
          .then(res => res.ok ? res.json() : null)
          .catch(() => null);

        const [authResult, bootstrapResult] = await Promise.all([authPromise, bootstrapPromise]);

        if (isMounted) {
          if (authResult?.user) {
            setCurrentUser(authResult.user);
          } else if (storedToken && !authResult) {
            setCurrentUser(null);
          }

          if (bootstrapResult?.data) {
            const data = bootstrapResult.data;
            const loadedProjects = Array.isArray(data.projects) ? data.projects : [];
            setProjects(loadedProjects);
            setSelectedProject(prev => prev || (loadedProjects.length > 0 ? loadedProjects[0] : null));
            const loadedHacks = Array.isArray(data.hackathons) ? data.hackathons : [];
            setHackathons(loadedHacks);
            if (loadedHacks.length === 0) {
              fetchHackathons().catch(() => {});
            }
            setSquadWins(Array.isArray(data.squadWins) ? data.squadWins : []);
            setBuilders(Array.isArray(data.builders) ? data.builders : []);
            setHackathonSquads(Array.isArray(data.hackathonSquads) ? data.hackathonSquads : []);
          } else {
            await Promise.allSettled([
              fetchProjects(),
              fetchHackathons(),
              fetchBuilders()
            ]);
          }
        }

        const effectiveUser = authResult?.user || (storedToken ? authApi.getStoredUser() : null);
        if (effectiveUser && isMounted) {
          fetchUserData().catch(() => {});
        }
      } catch (err) {
        console.error('Platform initialization failed:', err);
      } finally {
        if (isMounted) {
          setIsAuthResolving(false);
        }
      }
    };

    initializeSessionAndData();

    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
    };
  }, [fetchBuilders, fetchHackathons, fetchProjects, fetchUserData]);

  // Always fetch fresh hackathons whenever visiting or viewing hackathon pages
  useEffect(() => {
    if (pathname === '/hackathons' || pathname.startsWith('/hackathon')) {
      fetchHackathons();
    }
  }, [pathname, fetchHackathons]);

  // Auth Handlers with React Router URL redirection
  const handleLoginSuccess = async (user) => {
    setCurrentUser(user);
    if (user.role === 'admin') {
      navigate('/admin/hackathons', { replace: true });
      showToast(`Welcome to BuildCrew Admin Console, ${user.name}!`);
    } else {
      navigate('/dashboard', { replace: true });
      showToast(`Welcome back to campus circuit, ${user.name}!`);
    }
    await Promise.allSettled([fetchUserData(), fetchHackathons(), fetchProjects()]);
  };

  const handleLogout = () => {
    authApi.logout();
    setCurrentUser(null);
    setApplications([]);
    setNotifications([]);
    setReceivedInvitations([]);
    setSentInvitations([]);
    knownNotificationIdsRef.current.clear();
    isFirstNotifLoadRef.current = true;
    setPopupNotification(null);
    navigate('/login', { replace: true });
    showToast('Signed out of BuildCrew session.');
  };

  // Real-time polling for application/invitation events
  useEffect(() => {
    if (!currentUser) return;
    let isPolling = false;

    const poll = async () => {
      if (isPolling) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      isPolling = true;
      try {
        await fetchUserData();
      } finally {
        isPolling = false;
      }
    };

    const intervalId = setInterval(poll, 7000);
    const onFocus = () => { poll(); };
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [currentUser, fetchUserData]);

  // User Profile & Avatar Synchronization
  const handleUpdateUser = (updatedUser) => {
    if (!updatedUser) return;
    setCurrentUser(updatedUser);
    try {
      localStorage.setItem('buildcrew_user', JSON.stringify(updatedUser));
    } catch (e) {
      console.warn('Failed to cache user session:', e);
    }

    const updatedAvatar = updatedUser.avatar || updatedUser.profileImage || '';
    const userIdStr = String(updatedUser._id || updatedUser.id);

    // Synchronize projects state
    setProjects(prevProjects =>
      prevProjects.map(proj => {
        let modified = false;
        const newProj = { ...proj };

        const creatorId = typeof newProj.createdBy === 'object' && newProj.createdBy !== null
          ? String(newProj.createdBy._id || newProj.createdBy.id)
          : String(newProj.createdBy);

        if (creatorId && creatorId === userIdStr) {
          modified = true;
          newProj.createdBy = typeof newProj.createdBy === 'object' && newProj.createdBy !== null
            ? { ...newProj.createdBy, avatar: updatedAvatar, profileImage: updatedAvatar, name: updatedUser.name }
            : { _id: updatedUser._id, avatar: updatedAvatar, profileImage: updatedAvatar, name: updatedUser.name };
          if (newProj.lead) {
            newProj.lead = { ...newProj.lead, avatar: updatedAvatar, leadAvatarFull: updatedAvatar, name: updatedUser.name };
          }
        }

        if (Array.isArray(newProj.members)) {
          const updatedMembers = newProj.members.map(m => {
            const mId = typeof m === 'object' && m !== null ? String(m._id || m.id) : String(m);
            if (mId && mId === userIdStr) {
              modified = true;
              return typeof m === 'object' && m !== null
                ? { ...m, avatar: updatedAvatar, profileImage: updatedAvatar, name: updatedUser.name }
                : { _id: updatedUser._id, avatar: updatedAvatar, profileImage: updatedAvatar, name: updatedUser.name };
            }
            return m;
          });
          if (modified) newProj.members = updatedMembers;
        }

        return modified ? newProj : proj;
      })
    );

    // Synchronize builders state
    setBuilders(prev =>
      prev.map(b => {
        if (String(b._id || b.id) === userIdStr) {
          return { ...b, avatar: updatedAvatar, profileImage: updatedAvatar, name: updatedUser.name };
        }
        return b;
      })
    );

    // Synchronize applications state
    setApplications(prev =>
      prev.map(app => {
        const applicantId = typeof app.applicant === 'object' && app.applicant !== null
          ? String(app.applicant._id || app.applicant.id)
          : String(app.applicant);
        if (applicantId && applicantId === userIdStr) {
          return {
            ...app,
            applicant: typeof app.applicant === 'object' && app.applicant !== null
              ? { ...app.applicant, avatar: updatedAvatar, profileImage: updatedAvatar, name: updatedUser.name }
              : { _id: updatedUser._id, avatar: updatedAvatar, profileImage: updatedAvatar, name: updatedUser.name }
          };
        }
        return app;
      })
    );

    showToast('Profile changes saved successfully.');
  };

  // Hackathons management
  const handleAddHackathon = async (newHack) => {
    try {
      const res = await hackathonsApi.createHackathon(newHack);
      const savedHack = res.hackathon || res;
      setHackathons(prev => [savedHack, ...prev]);
      showToast(`Hackathon "${savedHack.title}" submitted to circuit registry!`);
    } catch (err) {
      console.error('Failed to create hackathon:', err);
      showToast(`Error creating hackathon: ${err.message}`);
    }
  };

  const handleUpdateHackathons = (newHackathons) => {
    const list = typeof newHackathons === 'function' ? newHackathons(hackathons) : newHackathons;
    setHackathons(list);
  };

  // URL-driven navigation actions
  const handleViewProfile = useCallback((userId) => {
    if (userId) {
      navigate(`/profile/${userId}`);
    } else {
      navigate('/profile');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [navigate]);

  const handleNavigateView = useCallback((view) => {
    setIsMobileNavOpen(false);
    switch (view) {
      case 'dashboard':
        navigate('/dashboard');
        break;
      case 'discover-projects':
      case 'projects':
        navigate('/projects');
        break;
      case 'create-project':
      case 'post-project':
        navigate('/create-project');
        break;
      case 'hackathons':
        navigate('/hackathons');
        break;
      case 'find-builders':
      case 'find-teammates':
        navigate('/find-teammates');
        break;
      case 'my-projects':
        navigate('/my-projects');
        break;
      case 'my-applications':
      case 'applications':
        navigate('/applications');
        break;
      case 'invitations':
        navigate('/invitations');
        break;
      case 'my-teams':
      case 'teams':
        navigate('/teams');
        break;
      case 'group-chat':
      case 'chat':
      case 'chats':
        navigate('/group-chat');
        break;
      case 'settings':
        navigate('/settings');
        break;
      case 'profile':
        navigate('/profile');
        break;
      case 'admin-dashboard':
      case 'admin-hackathons':
        navigate('/admin/hackathons');
        break;
      case 'admin-teams':
        navigate('/admin/teams');
        break;
      default:
        navigate('/dashboard');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [navigate]);

  const handleSelectProject = useCallback((proj) => {
    const id = proj?._id || proj?.id;
    if (id) {
      setSelectedProject(proj);
      navigate(`/projects/${id}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [navigate]);

  const handleQuickApply = (proj) => {
    setQuickApplyProject(proj);
  };

  const handleApplySuccess = async (newApp) => {
    try {
      const targetId = newApp.projectId;
      const res = await applicationsApi.applyToProject({
        projectId: targetId,
        requestedRole: newApp.role || 'Core Contributor',
        message: newApp.note || newApp.message || 'Applying to collaborate on project.',
      });
      const savedApp = res.application || res;
      setApplications(prev => [savedApp, ...prev.filter(a => String(a._id || a.id) !== String(savedApp._id || savedApp.id))]);
      showToast('Application sent to the project owner.');
      fetchProjects();
      fetchUserData();
      return savedApp;
    } catch (err) {
      console.error('Apply error:', err);
      showToast(err.message || 'Application could not be submitted');
      throw err;
    }
  };

  const handleUpdateApplicationStatus = async (appId, status, reason = '') => {
    try {
      await applicationsApi.updateStatus(appId, status, reason);
      showToast(status === 'accepted' ? 'Application accepted! Applicant added to squad.' : 'Application rejected.');
      await Promise.allSettled([
        fetchUserData(),
        fetchProjects()
      ]);
    } catch (err) {
      console.error('Update application status error:', err);
      showToast(err.message || 'Failed to update application');
    }
  };

  const handleAddProject = async (newProj) => {
    try {
      const res = await projectsApi.createProject(newProj);
      const savedProj = res.project || res;
      setProjects(prev => [savedProj, ...prev]);
      setSelectedProject(savedProj);
      setIsPostProjectOpen(false);
      navigate(`/projects/${savedProj._id || savedProj.id}`);
      showToast(`Project "${savedProj.title}" launched successfully!`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Failed to create project:', err);
      showToast(`Project creation failed: ${err.message}`);
    }
  };

  const handleUpdateProject = (updatedProj) => {
    if (!updatedProj?._id) return;
    setProjects(prev => prev.map(p => (p._id === updatedProj._id ? updatedProj : p)));
    if (selectedProject?._id === updatedProj._id) {
      setSelectedProject(updatedProj);
    }
  };

  const handleDeleteProject = async (projectId) => {
    try {
      const res = await projectsApi.deleteProject(projectId);
      setProjects(prev => prev.filter(p => (p._id || p.id) !== projectId));
      setSelectedProject(prev => (prev && ((prev._id || prev.id) === projectId) ? null : prev));
      await Promise.allSettled([
        fetchProjects(),
        fetchUserData()
      ]);
      showToast(res?.message || 'Project and associated team data deleted permanently.');
      if (pathname.includes(projectId)) {
        navigate('/projects');
      }
      return res;
    } catch (err) {
      console.error('Delete project failed:', err);
      showToast(err.message || 'Failed to delete project');
      throw err;
    }
  };

  const handleInviteBuilder = async (inviteData) => {
    try {
      let payload;
      if (typeof inviteData === 'object' && inviteData.receiverId) {
        payload = inviteData;
      } else {
        const receiverId = typeof inviteData === 'object' ? (inviteData._id || inviteData.id) : inviteData;
        const role = (typeof inviteData === 'object' ? (inviteData.roleTitle || inviteData.role) : '') || 'Core Contributor';
        payload = {
          receiverId,
          role,
          message: 'Join our squad on BuildCrew!'
        };
      }

      if (!payload.receiverId) {
        showToast('Invalid builder ID for invitation');
        return;
      }

      const res = await invitationsApi.sendInvitation(payload);
      showToast(res.message || 'Invitation sent successfully!');
      await fetchUserData();
    } catch (err) {
      console.error('Invitation error:', err);
      showToast(err.message || 'Invitation error');
    }
  };

  const handleAcceptInvitation = async (invitationId) => {
    try {
      await invitationsApi.respondInvitation(invitationId, 'accepted');
      showToast('Invitation accepted! You have joined the squad.');
      await Promise.allSettled([
        fetchUserData(),
        fetchProjects(),
        fetchHackathons()
      ]);
    } catch (err) {
      console.error('Accept invitation error:', err);
      showToast(err.message || 'Failed to accept invitation');
    }
  };

  const handleRejectInvitation = async (invitationId) => {
    try {
      await invitationsApi.respondInvitation(invitationId, 'rejected');
      showToast('Invitation declined.');
      await fetchUserData();
    } catch (err) {
      console.error('Reject invitation error:', err);
      showToast(err.message || 'Failed to decline invitation');
    }
  };

  const handleCancelInvitation = async (invitationId) => {
    try {
      await invitationsApi.respondInvitation(invitationId, 'cancelled');
      showToast('Invitation cancelled.');
      await fetchUserData();
    } catch (err) {
      console.error('Cancel invitation error:', err);
      showToast(err.message || 'Failed to cancel invitation');
    }
  };

  const handleAddBuilder = async (newBuilder) => {
    try {
      const res = await usersApi.createBuilder(newBuilder);
      const savedBuilder = res.builder || newBuilder;
      setBuilders(prev => [savedBuilder, ...prev]);
      showToast(`Student "${savedBuilder.name}" added successfully!`);
    } catch (err) {
      console.error('Failed to create builder:', err);
      setBuilders(prev => [newBuilder, ...prev]);
      showToast(`Student "${newBuilder.name}" added!`);
    }
  };

  const handleMarkNotificationRead = async (id) => {
    try {
      await notificationsApi.markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n._id === id ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.warn('Could not mark notification as read:', err);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (err) {
      console.warn('Could not mark all notifications as read:', err);
    }
  };

  // While authenticating: render splash loading screen
  if (isAuthResolving) {
    return (
      <div className="fixed inset-0 z-[99999] bg-white flex flex-col items-center justify-center select-none">
        <div className="flex flex-col items-center justify-center p-6 animate-splash">
          <img 
            src="/buildcrew-splash-logo.png"
            style={{ filter: 'brightness(1.04)' }}
            alt="BuildCrew" 
            className="w-72 sm:w-96 max-w-[85vw] max-h-[60vh] object-contain select-none" 
          />
        </div>
      </div>
    );
  }

  // =========================================================================
  // UNAUTHENTICATED ROUTING FLOW (/login, /register, /forgot-password, /reset-password)
  // =========================================================================
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-background font-body-md text-on-surface antialiased relative">
        <Routes>
          <Route path="/login" element={
            <Auth
              onLoginSuccess={handleLoginSuccess}
              initialMode="login"
              onModeChange={(mode) => {
                if (mode === 'register') navigate('/register');
                else if (mode === 'forgot') navigate('/forgot-password');
                else if (mode === 'reset') navigate('/reset-password');
                else navigate('/login');
              }}
            />
          } />
          <Route path="/register" element={
            <Auth
              onLoginSuccess={handleLoginSuccess}
              initialMode="register"
              onModeChange={(mode) => {
                if (mode === 'login') navigate('/login');
                else if (mode === 'forgot') navigate('/forgot-password');
                else if (mode === 'reset') navigate('/reset-password');
                else navigate('/register');
              }}
            />
          } />
          <Route path="/forgot-password" element={
            <Auth
              onLoginSuccess={handleLoginSuccess}
              initialMode="forgot"
              onModeChange={(mode) => {
                if (mode === 'login') navigate('/login');
                else if (mode === 'register') navigate('/register');
                else if (mode === 'reset') navigate('/reset-password');
                else navigate('/forgot-password');
              }}
            />
          } />
          <Route path="/reset-password" element={
            <Auth
              onLoginSuccess={handleLoginSuccess}
              initialMode="reset"
              onModeChange={(mode) => {
                if (mode === 'login') navigate('/login');
                else if (mode === 'register') navigate('/register');
                else if (mode === 'forgot') navigate('/forgot-password');
                else navigate('/reset-password');
              }}
            />
          } />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>

        {backendError && (
          <div className="fixed bottom-6 left-6 z-50 bg-error-container text-on-error-container px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 font-body-sm text-body-sm">
            <span className="material-symbols-outlined text-error text-lg">error</span>
            <span>{backendError}</span>
          </div>
        )}

        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 bg-primary text-on-primary px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 font-body-sm text-body-sm animate-modal">
            <span className="material-symbols-outlined text-secondary text-lg">check_circle</span>
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="ml-2 text-on-surface-variant hover:text-on-primary cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // AUTHENTICATED APPLICATION SHELL & COMPLETE ROUTES
  // =========================================================================
  const unreadCount = notifications.filter(n => !n.read).length;
  const currentUserId = String(currentUser?._id || currentUser?.id || '');
  const pendingReceivedApplicationsCount = applications.filter(a => {
    const applicantId = String(a.applicant?._id || a.applicant || '');
    return applicantId !== currentUserId && (a.status || 'pending').toLowerCase() === 'pending';
  }).length;

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col font-body-md antialiased relative">
      {/* Navigation Sidebar (Desktop fixed sidebar + Mobile slide-over drawer) */}
      <Sidebar
        activeView={activeView}
        setActiveView={handleNavigateView}
        onOpenPostProject={() => navigate('/create-project')}
        currentUser={currentUser}
        onLogout={handleLogout}
        pendingInvitationsCount={receivedInvitations.filter(i => i.status === 'pending').length}
        pendingApplicationsCount={pendingReceivedApplicationsCount}
        adminTab={adminTab}
        onSelectAdminTab={(tab) => navigate(tab === 'teams' ? '/admin/teams' : '/admin/hackathons')}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      {/* Main Content Area (Mobile: pl-0, Desktop: pl-72) */}
      <div className="pl-0 lg:pl-72 flex flex-col flex-1 w-full min-w-0">
        {/* Sticky Top Header */}
        <Header
          activeView={activeView}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearchFocus={() => {
            if (!pathname.startsWith('/projects') && pathname !== '/dashboard') {
              navigate('/projects');
            }
          }}
          notificationCount={unreadCount}
          notifications={notifications}
          onMarkRead={handleMarkNotificationRead}
          onMarkAllRead={handleMarkAllNotificationsRead}
          onNavigateProfile={() => handleNavigateView('profile')}
          onNavigateInvitations={() => handleNavigateView('invitations')}
          onNavigateApplications={(tab = 'received') => {
            setApplicationsTab(tab);
            handleNavigateView('applications');
          }}
          currentUser={currentUser}
          onLogout={handleLogout}
          onOpenAdminDashboard={(tab = 'hackathons') => {
            navigate(tab === 'teams' ? '/admin/teams' : '/admin/hackathons');
          }}
          onNavigateHome={() => navigate(currentUser?.role === 'admin' ? '/admin/hackathons' : '/dashboard')}
        />

        {/* Dynamic View Router */}
        <main className="w-full pt-16 lg:pt-[88px] bg-surface px-3 sm:px-4 lg:px-space-lg py-4 sm:py-space-lg pb-24 lg:pb-space-lg flex-1 desktop-content-container">
          <Routes>
            {/* Student Platform Routes */}
            <Route path="/dashboard" element={
              <DiscoverProjects
                projects={projects}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                onSelectProject={handleSelectProject}
                onQuickApply={handleQuickApply}
                currentUser={currentUser}
                builders={builders}
              />
            } />
            <Route path="/projects" element={
              <DiscoverProjects
                projects={projects}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                onSelectProject={handleSelectProject}
                onQuickApply={handleQuickApply}
                currentUser={currentUser}
                builders={builders}
              />
            } />
            <Route path="/projects/:id" element={
              <ProjectDetailsRoute
                projects={projects}
                currentUser={currentUser}
                onApplySuccess={handleApplySuccess}
                onViewProfile={handleViewProfile}
                showToast={showToast}
                onOpenTeamChat={(team) => setChatTeam(team)}
              />
            } />
            <Route path="/create-project" element={
              <DiscoverProjects
                projects={projects}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                onSelectProject={handleSelectProject}
                onQuickApply={handleQuickApply}
                currentUser={currentUser}
                builders={builders}
              />
            } />
            <Route path="/my-projects" element={
              <MyProjects
                projects={projects}
                currentUser={currentUser}
                onSelectProject={handleSelectProject}
                onOpenPostProject={() => navigate('/create-project')}
              />
            } />
            <Route path="/applications" element={
              <MyApplications
                applications={applications}
                currentUser={currentUser}
                onSelectProjectById={(id) => navigate(`/projects/${id}`)}
                initialTab={applicationsTab}
                onTabChange={setApplicationsTab}
                onUpdateStatus={handleUpdateApplicationStatus}
              />
            } />
            <Route path="/invitations" element={
              <Invitations
                receivedInvitations={receivedInvitations}
                sentInvitations={sentInvitations}
                onAcceptInvitation={handleAcceptInvitation}
                onRejectInvitation={handleRejectInvitation}
                onCancelInvitation={handleCancelInvitation}
                onViewProfile={handleViewProfile}
                onSelectProject={handleSelectProject}
                currentUser={currentUser}
              />
            } />
            <Route path="/teams" element={
              <MyTeamsView
                currentUser={currentUser}
                projects={projects}
                hackathonSquads={hackathonSquads}
                onSelectProject={handleSelectProject}
                onOpenTeamChat={(team) => setChatTeam(team)}
              />
            } />
            <Route path="/teams/:id" element={
              <ProjectDetailsRoute
                projects={projects}
                currentUser={currentUser}
                onApplySuccess={handleApplySuccess}
                onViewProfile={handleViewProfile}
                showToast={showToast}
                onOpenTeamChat={(team) => setChatTeam(team)}
              />
            } />
            <Route path="/teams/:id/chat" element={
              <TeamChatDirectRoute
                projects={projects}
                hackathonSquads={hackathonSquads}
                currentUser={currentUser}
                onOpenTeamChat={(team) => setChatTeam(team)}
                onSelectProject={handleSelectProject}
              />
            } />
            <Route path="/group-chat" element={
              <GroupChatView
                currentUser={currentUser}
                onUpdateUser={handleUpdateUser}
                showToast={showToast}
              />
            } />
            <Route path="/group-chat/:groupId" element={
              <GroupChatView
                currentUser={currentUser}
                onUpdateUser={handleUpdateUser}
                showToast={showToast}
              />
            } />
            <Route path="/find-teammates" element={
              <FindBuilders
                builders={builders}
                projects={projects}
                hackathonSquads={hackathonSquads}
                sentInvitations={sentInvitations}
                onInvite={handleInviteBuilder}
                onViewProfile={handleViewProfile}
                onAddBuilder={handleAddBuilder}
                showToast={showToast}
                currentUser={currentUser}
              />
            } />
            <Route path="/profile" element={
              <Profile
                currentUser={currentUser}
                targetUserId={null}
                sentInvitations={sentInvitations}
                onBack={() => navigate('/find-teammates')}
                onInviteBuilder={handleInviteBuilder}
                onUpdateUser={handleUpdateUser}
                showToast={showToast}
              />
            } />
            <Route path="/profile/:id" element={
              <ProfileRoute
                currentUser={currentUser}
                sentInvitations={sentInvitations}
                onInviteBuilder={handleInviteBuilder}
                onUpdateUser={handleUpdateUser}
                showToast={showToast}
              />
            } />
            <Route path="/settings" element={
              <Profile
                currentUser={currentUser}
                targetUserId={null}
                sentInvitations={sentInvitations}
                onBack={() => navigate('/dashboard')}
                onInviteBuilder={handleInviteBuilder}
                onUpdateUser={handleUpdateUser}
                showToast={showToast}
              />
            } />
            <Route path="/hackathons" element={
              <Hackathons
                hackathons={hackathons.filter(h => h.isPublished !== false)}
                squadWins={squadWins}
                projects={projects}
                builders={builders}
                hackathonSquads={hackathonSquads}
                onApplySquad={handleApplySuccess}
                onInviteBuilder={handleInviteBuilder}
                onCreateSquad={handleAddProject}
                onAddHackathon={handleAddHackathon}
                showToast={showToast}
                currentUser={currentUser}
                onSelectHackathon={(h) => navigate(`/hackathons/${h._id || h.id}`)}
              />
            } />
            <Route path="/hackathons/:id" element={
              <HackathonDetailsRoute
                hackathons={hackathons}
                squadWins={squadWins}
                projects={projects}
                builders={builders}
                hackathonSquads={hackathonSquads}
                onApplySquad={handleApplySuccess}
                onInviteBuilder={handleInviteBuilder}
                onCreateSquad={handleAddProject}
                onAddHackathon={handleAddHackathon}
                showToast={showToast}
                currentUser={currentUser}
              />
            } />

            {/* Admin Management Routes */}
            <Route path="/admin/hackathons" element={
              currentUser?.role === 'admin' ? (
                <AdminDashboard
                  currentUser={currentUser}
                  hackathons={hackathons}
                  projects={projects}
                  onUpdateHackathons={handleUpdateHackathons}
                  onRefreshHackathons={fetchHackathons}
                  onRefreshProjects={fetchProjects}
                  onUpdateProject={handleUpdateProject}
                  onDeleteProject={handleDeleteProject}
                  onSelectProject={handleSelectProject}
                  showToast={showToast}
                  onNavigate={handleNavigateView}
                  onNavigateRoute={navigate}
                  initialTab="hackathons"
                  initialView="list"
                />
              ) : (
                <AccessDenied onBack={() => navigate('/dashboard')} />
              )
            } />
            <Route path="/admin/hackathons/new" element={
              currentUser?.role === 'admin' ? (
                <AdminDashboard
                  currentUser={currentUser}
                  hackathons={hackathons}
                  projects={projects}
                  onUpdateHackathons={handleUpdateHackathons}
                  onRefreshHackathons={fetchHackathons}
                  onRefreshProjects={fetchProjects}
                  onUpdateProject={handleUpdateProject}
                  onDeleteProject={handleDeleteProject}
                  onSelectProject={handleSelectProject}
                  showToast={showToast}
                  onNavigate={handleNavigateView}
                  onNavigateRoute={navigate}
                  initialTab="hackathons"
                  initialView="form"
                />
              ) : (
                <AccessDenied onBack={() => navigate('/dashboard')} />
              )
            } />
            <Route path="/admin/hackathons/:id/edit" element={
              <AdminHackathonEditRoute
                currentUser={currentUser}
                hackathons={hackathons}
                projects={projects}
                onUpdateHackathons={handleUpdateHackathons}
                onRefreshHackathons={fetchHackathons}
                onRefreshProjects={fetchProjects}
                onUpdateProject={handleUpdateProject}
                onDeleteProject={handleDeleteProject}
                onSelectProject={handleSelectProject}
                showToast={showToast}
                onNavigate={handleNavigateView}
              />
            } />
            <Route path="/admin/teams" element={
              currentUser?.role === 'admin' ? (
                <AdminDashboard
                  currentUser={currentUser}
                  hackathons={hackathons}
                  projects={projects}
                  onUpdateHackathons={handleUpdateHackathons}
                  onRefreshHackathons={fetchHackathons}
                  onRefreshProjects={fetchProjects}
                  onUpdateProject={handleUpdateProject}
                  onDeleteProject={handleDeleteProject}
                  onSelectProject={handleSelectProject}
                  showToast={showToast}
                  onNavigate={handleNavigateView}
                  onNavigateRoute={navigate}
                  initialTab="teams"
                  initialView="list"
                />
              ) : (
                <AccessDenied onBack={() => navigate('/dashboard')} />
              )
            } />

            {/* Auth URLs redirect to role-specific dashboard when user is logged in */}
            <Route path="/login" element={<Navigate to={currentUser?.role === 'admin' ? '/admin/hackathons' : '/dashboard'} replace />} />
            <Route path="/register" element={<Navigate to={currentUser?.role === 'admin' ? '/admin/hackathons' : '/dashboard'} replace />} />
            <Route path="/forgot-password" element={<Navigate to={currentUser?.role === 'admin' ? '/admin/hackathons' : '/dashboard'} replace />} />
            <Route path="/reset-password" element={<Navigate to={currentUser?.role === 'admin' ? '/admin/hackathons' : '/dashboard'} replace />} />
            <Route path="/" element={<Navigate to={currentUser?.role === 'admin' ? '/admin/hackathons' : '/dashboard'} replace />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to={currentUser?.role === 'admin' ? '/admin/hackathons' : '/dashboard'} replace />} />
          </Routes>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Screens < 1024px) */}
      <nav 
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface-container-lowest/95 backdrop-blur-md border-t border-surface-container-high/60 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] px-2 py-1.5 flex items-center justify-around select-none"
      >
        {currentUser?.role === 'admin' ? (
          <>
            <button
              type="button"
              onClick={() => handleNavigateView('admin-hackathons')}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-colors cursor-pointer ${
                pathname.startsWith('/admin/hackathons') ? 'text-secondary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-2xl leading-none">tune</span>
              <span className="text-[10px] mt-0.5">Hackathons</span>
            </button>

            <button
              type="button"
              onClick={() => navigate('/admin/hackathons/new')}
              className="flex flex-col items-center justify-center p-2 rounded-2xl bg-primary text-on-primary shadow-md active:scale-95 transition-all cursor-pointer -mt-4 border-2 border-surface"
              title="Add Hackathon"
            >
              <span className="material-symbols-outlined text-2xl leading-none">add</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigateView('admin-teams')}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-colors cursor-pointer ${
                pathname.startsWith('/admin/teams') ? 'text-secondary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-2xl leading-none">diversity_3</span>
              <span className="text-[10px] mt-0.5">Teams</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => handleNavigateView('projects')}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-colors cursor-pointer ${
                pathname === '/dashboard' || pathname.startsWith('/projects') ? 'text-secondary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-2xl leading-none">explore</span>
              <span className="text-[10px] mt-0.5">Projects</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigateView('hackathons')}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-colors cursor-pointer ${
                pathname.startsWith('/hackathons') ? 'text-secondary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-2xl leading-none">terminal</span>
              <span className="text-[10px] mt-0.5">Hackathons</span>
            </button>

            <button
              type="button"
              onClick={() => navigate('/create-project')}
              className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-primary text-on-primary shadow-md active:scale-95 transition-all cursor-pointer -mt-4 border-2 border-surface"
              title="Post Project"
            >
              <span className="material-symbols-outlined text-2xl leading-none">add</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigateView('find-teammates')}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-colors cursor-pointer ${
                pathname.startsWith('/find-teammates') ? 'text-secondary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-2xl leading-none">group_add</span>
              <span className="text-[10px] mt-0.5">Builders</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigateView('profile')}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-colors cursor-pointer ${
                pathname.startsWith('/profile') ? 'text-secondary font-bold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-2xl leading-none">account_circle</span>
              <span className="text-[10px] mt-0.5">Profile</span>
            </button>
          </>
        )}
      </nav>

      {/* Quick Apply Modal */}
      <QuickApplyModal
        project={quickApplyProject}
        isOpen={Boolean(quickApplyProject)}
        onClose={() => setQuickApplyProject(null)}
        onApplySuccess={handleApplySuccess}
      />

      {/* Team Chat Modal */}
      <TeamChatModal
        key={chatTeam?._id || chatTeam?.id || "closed"}
        team={chatTeam}
        currentUser={currentUser}
        isOpen={Boolean(chatTeam)}
        onClose={() => setChatTeam(null)}
      />

      {/* Post Project Modal (available via /create-project route or button click) */}
      <PostProjectModal
        isOpen={isPostProjectOpen || pathname === '/create-project'}
        onClose={() => {
          setIsPostProjectOpen(false);
          if (pathname === '/create-project') {
            navigate('/projects');
          }
        }}
        onAddProject={handleAddProject}
        currentUser={currentUser}
      />

      {/* Command Palette (⌘K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        projects={projects}
        hackathons={hackathons}
        onSelectProject={(proj) => {
          handleSelectProject(proj);
          setIsCommandPaletteOpen(false);
        }}
        onNavigate={(viewId) => {
          handleNavigateView(viewId);
          setIsCommandPaletteOpen(false);
        }}
      />

      {/* Floating Action Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-primary text-on-primary px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 font-body-sm text-body-sm animate-modal">
          <span className="material-symbols-outlined text-secondary text-lg">check_circle</span>
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-2 text-on-surface-variant hover:text-on-primary cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      )}

      {/* Small Non-Blocking Notification Toast/Pop-up */}
      {popupNotification && (
        <div 
          onClick={() => {
            if (popupNotification.type === 'application_rejected' || popupNotification.type === 'application_accepted') {
              setApplicationsTab('sent');
              navigate('/applications');
            } else if (popupNotification.type === 'application_received') {
              setApplicationsTab('received');
              navigate('/applications');
            } else if (popupNotification.type === 'invitation_received') {
              navigate('/invitations');
            }
            setPopupNotification(null);
          }}
          className={`fixed ${toastMessage ? 'bottom-20' : 'bottom-6'} right-6 z-50 max-w-sm bg-slate-900 text-white p-3.5 rounded-2xl shadow-2xl border border-slate-700/60 flex items-start gap-3 cursor-pointer hover:bg-slate-800 transition-all animate-modal`}
          role="alert"
        >
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{
            backgroundColor: popupNotification.type === 'application_accepted' ? 'rgba(16, 185, 129, 0.2)' :
                             popupNotification.type === 'application_rejected' ? 'rgba(244, 63, 94, 0.2)' :
                             'rgba(99, 102, 241, 0.2)',
            color: popupNotification.type === 'application_accepted' ? '#34d399' :
                   popupNotification.type === 'application_rejected' ? '#fb7185' :
                   '#818cf8'
          }}>
            <span className="material-symbols-outlined text-lg">
              {popupNotification.type === 'application_accepted' ? 'check_circle' :
               popupNotification.type === 'application_rejected' ? 'cancel' :
               'notifications'}
            </span>
          </div>

          <div className="flex-1 min-w-0 pr-1">
            <p className="font-semibold text-xs text-white leading-snug">
              {popupNotification.message}
            </p>
            {popupNotification.reason && (
              <p className="text-[11px] text-slate-300 mt-1 line-clamp-2">
                Reason: {popupNotification.reason}
              </p>
            )}
            <span className="text-[10px] text-slate-400 block mt-1">
              Click to view in {popupNotification.type === 'invitation_received' ? 'Invitations' : 'My Applications'}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPopupNotification(null);
            }}
            className="text-slate-400 hover:text-white p-0.5 rounded-md shrink-0 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      )}
    </div>
  );
}
