# Football Fixer

A modular Node.js/Express application for managing college football matches, teams, chat, notifications, and admin operations.

---

## 🚀 Features
- Team registration, login, and profile management
- Admin CRUD operations
- Match creation and management
- Invite system for matches
- Real-time chat per match (Socket.IO)
- Notification system (read/unread, mark all as read)
- JWT-based authentication and role-based access
- Modular, controller-driven codebase for maintainability

---

## 📦 Project Structure

```
Football_Fixer/
├── src/
│   ├── controllers/      # Business logic for each resource
│   ├── models/           # Mongoose models
│   ├── routes/           # Express route definitions
│   ├── middleware/       # Auth and utility middleware
│   ├── utils/            # Utility functions (e.g., email)
│   ├── socket/           # Socket.IO logic
│   ├── config/           # Passport and other configs
│   ├── app.js            # Express app setup
│   └── index.js          # App entry point
├── public/               # Static files
├── docs/                 # Documentation
├── .prettierrc           # Prettier config
├── eslint.config.js      # ESLint v9+ config
├── package.json          # Project metadata
└── README.md             # This file
```

---

## 🛠️ Setup & Installation

1. **Clone the repo:**
   ```sh
   git clone <repo-url>
   cd Football_Fixer
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Environment variables:**
   - Create a `.env` file in the root with:
     ```env
     MONGODB_URI=<your-mongodb-uri>
     JWT_SECRET=<your-jwt-secret>
     JWT_EXPIRES_IN=7d
     PORT=3000
     ```
4. **Run the app:**
   ```sh
   npm start
   ```
   or for development with auto-reload:
   ```sh
   npm run dev
   ```

---

## 🧑‍💻 Linting & Formatting
- **Lint:**
  ```sh
  npx eslint .
  ```
- **Auto-fix:**
  ```sh
  npx eslint --fix .
  ```
- **Format:**
  ```sh
  npx prettier --write .
  ```

---

## 🔒 Security
- All sensitive routes require JWT authentication.
- Passwords are hashed using bcrypt.
- Environment variables are used for secrets and DB URIs.

---

## 📚 API Endpoints (Summary)

- `/api/auth` - Team registration & login
- `/api/team` - Team profile, update, change password
- `/api/admin` - Admin CRUD
- `/api/match` - Match management
- `/api/invite` - Match invites
- `/api/chat` - Match chat
- `/api/notification` - Notifications

See `docs/` for detailed API documentation.

---

## 🧪 Testing
- Add your tests in the `tests/` folder.
- Recommended: [Jest](https://jestjs.io/) or [Mocha](https://mochajs.org/).

---

## 👨‍🔧 Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

---

## 📄 License
[MIT](LICENSE)
