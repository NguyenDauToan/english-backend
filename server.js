// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import connectDB from "./src/config/db.js";

// Routes
import authRoutes from "./src/routes/auth.js";
import questionRoutes from "./src/routes/question.js";
import examRoutes from "./src/routes/exam.js";
import resultRoutes from "./src/routes/result.js";
import createAuthGoogleRoutes from "./src/routes/authGoogle.js";
import adminRoutes from "./src/routes/admin.js";
import adminUsersRoutes from "./src/routes/adminUsers.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Connect DB
connectDB();

// ✅ CORS configuration
const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:5173",
  "https://nguyendautoan.github.io"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // Postman / server-side
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true, // quan trọng nếu dùng cookie/session
  methods: ["GET", "POST", "PUT", "DELETE"]
}));

// Middleware
app.use(express.json());

// Session + passport
app.use(session({
  secret: "secretkey",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production", // HTTPS mới gửi cookie
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/auth/google", createAuthGoogleRoutes());
app.use("/api/admin", adminRoutes);
app.use("/api/admin/users", adminUsersRoutes);

// Test
app.get("/", (req, res) => {
  res.send("Hello, English Exam System!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
