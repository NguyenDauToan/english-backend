// server.js
import dotenv from "dotenv";
dotenv.config(); // Phải nằm trên cùng, trước khi import routes

import express from "express";
import cors from "cors";
import connectDB from "./src/config/db.js";

import session from "express-session";
import passport from "passport";

// Routes
import authRoutes from "./src/routes/auth.js";
import questionRoutes from "./src/routes/question.js";
import examRoutes from "./src/routes/exam.js";
import resultRoutes from "./src/routes/result.js";
import createAuthGoogleRoutes from "./src/routes/authGoogle.js";
import adminRoutes from "./src/routes/admin.js";   // 👈 Thêm route admin
import adminUsersRoutes from "./src/routes/adminUsers.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Kết nối DB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Middleware cho session + passport
app.use(
  session({
    secret: "secretkey",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/auth/google", createAuthGoogleRoutes());
app.use("/api/admin", adminRoutes); // 👈 Thêm dòng này để dùng /api/admin/dashboard
app.use("/api/admin/users", adminUsersRoutes);

// Test
app.get("/", (req, res) => {
  res.send("Hello, English Exam System!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
