# Music Rehearsal Scheduler

A comprehensive web application designed to streamline and automate the process of scheduling band rehearsals, sending reminders, tracking attendance, and suggesting optimal rehearsal times.

## Features

- **User Management**
  - User registration and authentication
  - Band creation and member management
  - Role-based permissions (band leaders vs. members)
  - Multi-band membership support

- **Scheduling**
  - Create one-time or recurring rehearsals
  - Set venue, date, time, and duration
  - Conflict detection and resolution
  - Member availability tracking

- **Intelligent Scheduling**
  - Automatic suggestions for optimal rehearsal times
  - Alternative time suggestions when conflicts arise
  - Member prioritization for critical rehearsals

- **Notifications**
  - Automated rehearsal reminders
  - Custom notifications for schedule changes
  - Configurable delivery preferences (email, SMS, push)

- **Attendance**
  - RSVP system for band members
  - Attendance tracking and reporting
  - Historical attendance statistics

- **Content Management**
  - Attach setlists to rehearsal events
  - Share music files and other materials
  - Song suggestion system for upcoming rehearsals

- **Social Features**
  - In-app messaging between band members
  - Polls for band decisions
  - Venue ratings and feedback

## Technology Stack

### Frontend
- React.js with TypeScript
- Redux Toolkit for state management
- Material-UI component library
- FullCalendar.js for scheduling interface
- Formik with Yup for form validation
- Axios for API communication

### Backend
- Node.js with Express
- TypeScript
- RESTful API architecture
- JWT authentication

### Database
- PostgreSQL
- Prisma ORM

### Infrastructure
- Docker
- AWS (ECS, S3, CloudWatch)
- GitHub Actions for CI/CD
- Amazon SES (Email)
- Firebase Cloud Messaging (Push notifications)
- Twilio (SMS)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (v8 or higher)
- Docker and Docker Compose
- PostgreSQL (if running locally without Docker)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/dxaginfo/music-rehearsal-scheduler-2025-06.git
   cd music-rehearsal-scheduler-2025-06
   ```

2. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. Install backend dependencies:
   ```bash
   cd ../backend
   npm install
   ```

4. Set up environment variables:
   - Copy `.env.example` to `.env` in both frontend and backend directories
   - Update the values according to your environment

5. Start the development environment:
   ```bash
   # Using Docker
   docker-compose up -d

   # Without Docker
   # Start backend
   cd backend
   npm run dev

   # Start frontend (in another terminal)
   cd frontend
   npm start
   ```

6. Access the application:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/api-docs

### Database Setup

The application uses Prisma ORM to manage database migrations and connections:

```bash
cd backend

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev
```

## Project Structure

```
music-rehearsal-scheduler/
├── frontend/               # React frontend application
│   ├── public/             # Static assets
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── features/       # Feature-specific components and logic
│   │   ├── hooks/          # Custom React hooks
│   │   ├── pages/          # Page components
│   │   ├── services/       # API service integrations
│   │   ├── store/          # Redux store configuration
│   │   ├── types/          # TypeScript type definitions
│   │   ├── utils/          # Utility functions
│   │   ├── App.tsx         # Main application component
│   │   └── index.tsx       # Application entry point
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                # Node.js backend application
│   ├── src/
│   │   ├── controllers/    # Request handlers
│   │   ├── middlewares/    # Express middlewares
│   │   ├── models/         # Data models
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   ├── utils/          # Utility functions
│   │   ├── app.ts          # Express application setup
│   │   └── server.ts       # Server entry point
│   ├── prisma/             # Prisma schema and migrations
│   ├── package.json
│   └── tsconfig.json
│
├── docker-compose.yml      # Docker Compose configuration
├── .github/                # GitHub Actions workflows
└── README.md               # Project documentation
```

## API Documentation

The API documentation is available when running the server at `/api-docs`. It is generated using Swagger/OpenAPI.

Key endpoints include:

- **Authentication**
  - `POST /api/auth/register` - Create a new user account
  - `POST /api/auth/login` - Log in to the application
  - `POST /api/auth/refresh-token` - Refresh an expired access token

- **Users**
  - `GET /api/users/me` - Get current user information
  - `PUT /api/users/me` - Update current user information

- **Bands**
  - `POST /api/bands` - Create a new band
  - `GET /api/bands` - List all bands for the current user
  - `GET /api/bands/:id` - Get detailed band information
  - `PUT /api/bands/:id` - Update band information
  - `POST /api/bands/:id/members` - Add a member to a band

- **Rehearsals**
  - `POST /api/rehearsals` - Create a new rehearsal
  - `GET /api/rehearsals` - List rehearsals
  - `PUT /api/rehearsals/:id` - Update rehearsal details
  - `GET /api/rehearsals/suggested-times` - Get suggested rehearsal times

- **Attendance**
  - `POST /api/rehearsals/:id/attendance` - Update attendance status
  - `GET /api/rehearsals/:id/attendance` - Get attendance for a rehearsal

- **Materials**
  - `POST /api/rehearsals/:id/materials` - Upload rehearsal materials
  - `GET /api/rehearsals/:id/materials` - Get rehearsal materials

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-new-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/my-new-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [React](https://reactjs.org/)
- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [PostgreSQL](https://www.postgresql.org/)
- [Material-UI](https://mui.com/)
- [FullCalendar](https://fullcalendar.io/)