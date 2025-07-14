// football-fixer-frontend.context.js
export const FootballFixerContext = {
  projectName: "Football Fixer Frontend",
  description: "A React frontend for managing college football matches with real-time features",
  techStack: ["React", "React Router", "Axios", "Socket.IO Client", "Context API", "Tailwind CSS"],
  
  // Core application structure
  appStructure: {
    src: {
      components: [
        "Auth/LoginForm.jsx",
        "Auth/RegisterForm.jsx",
        "Team/TeamProfile.jsx",
        "Team/EditProfile.jsx",
        "Matches/MatchList.jsx",
        "Matches/MatchCard.jsx",
        "Matches/CreateMatchForm.jsx",
        "Matches/MatchDetail.jsx",
        "Chat/MatchChat.jsx",
        "Notifications/NotificationCenter.jsx",
        "Notifications/NotificationItem.jsx",
        "Admin/AdminDashboard.jsx",
        "UI/Navbar.jsx",
        "UI/Sidebar.jsx",
        "UI/ProtectedRoute.jsx"
      ],
      context: [
        "AuthContext.jsx",
        "SocketContext.jsx",
        "NotificationContext.jsx"
      ],
      services: [
        "api/authService.js",
        "api/teamService.js",
        "api/matchService.js",
        "api/chatService.js",
        "api/notificationService.js",
        "api/adminService.js"
      ],
      pages: [
        "HomePage.jsx",
        "LoginPage.jsx",
        "RegisterPage.jsx",
        "DashboardPage.jsx",
        "ProfilePage.jsx",
        "MatchListPage.jsx",
        "MatchDetailPage.jsx",
        "AdminPage.jsx",
        "NotFoundPage.jsx"
      ],
      utils: [
        "axiosConfig.js",
        "socketClient.js",
        "authUtils.js"
      ]
    }
  },

  // State management
  stateManagement: {
    authState: {
      isAuthenticated: false,
      team: null,
      token: null,
      loading: false,
      error: null
    },
    matchState: {
      matches: [],
      currentMatch: null,
      invites: [],
      loading: false
    },
    chatState: {
      messages: [],
      newMessage: ""
    },
    notificationState: {
      notifications: [],
      unreadCount: 0
    }
  },

  // API integration
  apiConfig: {
    baseURL: "http://localhost:3000/api",
    endpoints: {
      auth: {
        register: "POST /auth/register",
        login: "POST /auth/login",
        logout: "POST /auth/logout"
      },
      team: {
        getProfile: "GET /team",
        updateProfile: "PATCH /team",
        changePassword: "POST /team/change-password"
      },
      match: {
        create: "POST /match",
        getAll: "GET /match",
        getById: "GET /match/:id",
        update: "PATCH /match/:id",
        delete: "DELETE /match/:id"
      },
      invite: {
        send: "POST /invite",
        accept: "PATCH /invite/:id/accept",
        reject: "PATCH /invite/:id/reject"
      },
      chat: {
        getHistory: "GET /chat/:matchId",
        sendMessage: "POST /chat/:matchId"
      },
      notification: {
        getAll: "GET /notification",
        markAsRead: "PATCH /notification/:id",
        markAllRead: "PATCH /notification/mark-all-read"
      },
      admin: {
        manageTeams: "GET /admin/teams",
        manageMatches: "GET /admin/matches"
      }
    },
    axiosSetup: `axios.create({
      baseURL: "http://localhost:3000/api",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${getToken()}\`
      }
    })`
  },

  // Socket.IO integration
  socketConfig: {
    events: {
      connect: "connect",
      disconnect: "disconnect",
      chatMessage: "chatMessage",
      newNotification: "newNotification",
      matchUpdate: "matchUpdate",
      inviteReceived: "inviteReceived"
    },
    connectionSetup: `const socket = io("http://localhost:3000", {
      auth: { token: userToken },
      transports: ["websocket"]
    })`
  },

  // Key components functionality
  componentFunctionality: {
    LoginForm: {
      fields: ["email", "password"],
      actions: ["handleLogin", "validateInputs"],
      apiCall: "authService.login()",
      postLogin: "Store token, update auth context, redirect to dashboard"
    },
    MatchChat: {
      features: [
        "Real-time messaging using Socket.IO",
        "Message history scroll",
        "Typing indicators",
        "Message timestamps",
        "Auto-scroll to new messages"
      ],
      socketEvents: ["chatMessage", "typing", "userJoin", "userLeave"]
    },
    NotificationCenter: {
      features: [
        "Unread count badge",
        "Mark individual as read",
        "Mark all as read",
        "Time-based grouping (Today, This Week, Older)",
        "Live updates via Socket.IO"
      ],
      actions: ["fetchNotifications", "updateReadStatus", "clearAll"]
    },
    CreateMatchForm: {
      fields: [
        "opponent",
        "date",
        "time",
        "location",
        "notes"
      ],
      validations: [
        "Required fields",
        "Future date validation",
        "Location format"
      ],
      postCreation: [
        "Show success notification",
        "Redirect to match detail",
        "Send invites to selected teams"
      ]
    }
  },

  // Routing configuration
  routes: [
    { path: "/", component: "HomePage", public: true },
    { path: "/login", component: "LoginPage", public: true },
    { path: "/register", component: "RegisterPage", public: true },
    { path: "/dashboard", component: "DashboardPage", protected: true },
    { path: "/profile", component: "ProfilePage", protected: true },
    { path: "/matches", component: "MatchListPage", protected: true },
    { path: "/matches/:id", component: "MatchDetailPage", protected: true },
    { path: "/admin", component: "AdminPage", protected: true, adminOnly: true },
    { path: "*", component: "NotFoundPage" }
  ],

  // Security implementation
  security: {
    jwtHandling: {
      storage: "localStorage",
      tokenRefresh: "Implement token refresh mechanism",
      autoLogout: "On 401 responses"
    },
    protectedRoutes: {
      strategy: "ProtectedRoute wrapper component",
      roleChecking: "Admin routes check team.role === 'admin'"
    },
    inputSanitization: [
      "All user inputs sanitized before API calls",
      "XSS protection for chat messages"
    ]
  },

  // UI design guidelines
  uiDesign: {
    theme: {
      primaryColor: "#1d4ed8", // Royal blue
      secondaryColor: "#e11d48", // Vibrant red
      neutralPalette: ["#f3f4f6", "#e5e7eb", "#6b7280"]
    },
    responsive: [
      "Mobile-first design",
      "Desktop sidebar layout",
      "Adaptive match cards"
    ],
    componentLibrary: "Tailwind CSS with custom components",
    icons: "Heroicons",
    notifications: "Toast notifications for actions"
  },

  // Testing requirements
  testing: {
    unitTests: [
      "Form validations",
      "API service functions",
      "Utility functions"
    ],
    integrationTests: [
      "User authentication flow",
      "Match creation workflow",
      "Chat message sending"
    ],
    e2eTests: [
      "Complete match lifecycle",
      "Notification flow",
      "Admin operations"
    ]
  },

  // Deployment setup
  deployment: {
    envVariables: [
      "REACT_APP_API_BASE_URL",
      "REACT_APP_SOCKET_URL"
    ],
    buildCommand: "npm run build",
    outputDir: "build",
    proxySetup: "Add proxy in package.json for API during development"
  }
};