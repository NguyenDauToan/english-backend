import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import connectDB from "./src/config/db.js";

const PORT = process.env.PORT || 5000;

async function startServer() {
  // ✅ Kết nối DB trước khi import route/model
  await connectDB();

  const app = express();

  // Middleware
  app.use(express.json());
  app.use(cors({ origin: "*", credentials: true }));

  app.use(session({
    secret: "secretkey",
    resave: false,
    saveUninitialized: false,
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  // ✅ Import route sau khi DB đã connect
  const authRoutes = (await import("./src/routes/auth.js")).default;
  const questionRoutes = (await import("./src/routes/question.js")).default;
  const examRoutes = (await import("./src/routes/exam.js")).default;
  const resultRoutes = (await import("./src/routes/result.js")).default;
  const createAuthGoogleRoutes = (await import("./src/routes/authGoogle.js")).default;
  const adminRoutes = (await import("./src/routes/admin.js")).default;
  const adminUsersRoutes = (await import("./src/routes/adminUsers.js")).default;

  app.use("/api/auth", authRoutes);
  app.use("/api/questions", questionRoutes);
  app.use("/api/exams", examRoutes);
  app.use("/api/results", resultRoutes);
  app.use("/api/auth/google", createAuthGoogleRoutes());
  app.use("/api/admin", adminRoutes);
  app.use("/api/admin/users", adminUsersRoutes);

  app.get("/", (req, res) => res.send("Hello, English Exam System!"));

  app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
}

startServer();
