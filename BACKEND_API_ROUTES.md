# Football Fixer Backend API Routes Reference

This document lists all backend API routes, their HTTP methods, required inputs (params, query, body, files), expected outputs, and integration notes. Use this as the single source of truth for frontend-backend integration.

---

## Auth Routes (`/auth`)

### POST `/auth/register`
- **Input:**
  - `multipart/form-data` fields:
    - `teamName` (string, required)
    - `collegeName` (string, required)
    - `email` (string, required)
    - `password` (string, required)
    - `profilePicture` (file, optional, image, max 5MB)
- **Output:**
  - `200 OK` JSON: `{ token, team: { ...profile fields... } }`
- **Notes:**
  - Use `FormData` in frontend. `profilePicture` is optional. Returns JWT token and team profile.

### POST `/auth/login`
- **Input:**
  - `application/json`:
    - `email` (string, required)
    - `password` (string, required)
- **Output:**
  - `200 OK` JSON: `{ token, team: { ...profile fields... } }`
- **Notes:**
  - Returns JWT token and team profile.

---

## Team Routes (`/team`)

### GET `/team/`
- **Input:** None
- **Output:** Array of team objects

### GET `/team/profile`
- **Auth:** JWT required (Authorization: Bearer ...)
- **Output:** Team profile object (see registration output)

### PUT `/team/profile`
- **Auth:** JWT required
- **Input:**
  - `multipart/form-data` fields (any subset):
    - `teamName`, `collegeName`, `email`, `profilePicture` (file)
- **Output:** `{ team: { ...updated profile... } }`

### PUT `/team/change-password`
- **Auth:** JWT required
- **Input:**
  - `application/json`:
    - `oldPassword` (string, required)
    - `newPassword` (string, required)
- **Output:** `{ message: "Password changed successfully" }`

---

## Match Routes (`/matches`)

### GET `/matches`
- **Output:** Array of match objects (public)
- **Query:** (optional) `my=1` to get matches for current team

### POST `/matches`
- **Auth:** JWT required
- **Input:**
  - `application/json`:
    - `title` (string, required)
    - `location` (string, required)
    - `matchDate` (ISO date string, required)
    - `matchTime` (ISO time string or full ISO datetime, required)
    - `description` (string, optional)
- **Output:** Match object
- **Notes:**
  - Ensure `matchDate` and `matchTime` are sent as ISO strings from frontend.

### GET `/matches/my-matches`
- **Auth:** JWT required
- **Output:** Array of matches created by the logged-in team

### GET `/matches/:id`
- **Output:** Match object by ID

### PUT `/matches/:id`
- **Auth:** JWT required
- **Input:** Same as POST `/matches`
- **Output:** Updated match object

### DELETE `/matches/:id`
- **Auth:** JWT required
- **Output:** `{ message: "Match deleted" }`

---

## Invite Routes (`/invites`)

### POST `/invites/:matchId`
- **Auth:** JWT required
- **Input:** None (matchId in URL)
- **Output:** Invite object

### GET `/invites/match/:matchId`
- **Auth:** JWT required
- **Output:** Array of invites for a match

### GET `/invites/sent`
- **Auth:** JWT required
- **Output:** Array of invites sent by current team

### GET `/invites/received`
- **Auth:** JWT required
- **Output:** Array of invites received by current team

### PUT `/invites/:inviteId/accept`
- **Auth:** JWT required
- **Output:** Updated invite object

---

## Notification Routes (`/notifications`)

### GET `/notifications`
- **Auth:** JWT required
- **Output:** Array of notification objects (fields: message, type, relatedMatch, read, etc.)

### PATCH `/notifications/:id/read`
- **Auth:** JWT required
- **Output:** Updated notification object (`read: true`)

### PATCH `/notifications/read-all`
- **Auth:** JWT required
- **Output:** `{ message: "All notifications marked as read" }`

---

## Chat Routes (`/chat`)

### GET `/chat/matches/:matchId`
- **Auth:** JWT required (may be missing in some versions, add if needed)
- **Output:** Array of chat messages for the match

### POST `/chat/matches/:matchId`
- **Auth:** JWT required (may be missing in some versions, add if needed)
- **Input:**
  - `application/json`:
    - `message` (string, required)
- **Output:** Created message object

---

## Admin Routes (`/admin`)

### POST `/admin/`
- **Input:**
  - `application/json`:
    - `username`, `password`, etc.
- **Output:** Admin object

### GET `/admin/`
- **Output:** Array of admin objects

### GET `/admin/:id`
- **Output:** Admin object by ID

### PUT `/admin/:id`
- **Input:**
  - `application/json` fields to update
- **Output:** Updated admin object

### DELETE `/admin/:id`
- **Output:** `{ message: "Admin deleted" }`

---

# General Notes
- All protected routes require JWT in the `Authorization` header: `Bearer <token>`
- File uploads must use `multipart/form-data` (for profile photos)
- All IDs are MongoDB ObjectIDs
- All date/time fields should be sent as ISO strings
- All responses are JSON

---

**Use this file to ensure frontend forms, API calls, and data extraction match backend expectations.**
