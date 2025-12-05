import http from "http";
import { Server as SocketServer } from "socket.io";
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { setupCors, allowedOrigins } from "./src/config/cors.js";
import session from "express-session";
import passport from "passport";
import connectDB from "./src/config/db.js";
import { verifyToken, verifyRole, verifyTokenSocket } from "./src/middleware/auth.js";
import aiRoutes from "./src/routes/ai.js";
import examAIRoutes from "./src/routes/examAI.js";
import skillRoutes from "./src/routes/skillRoutes.js";
import Skill from "./src/models/skillModel.js";
import feedbackRoutes from "./src/routes/feedback.js";
import recommendationRoutes from "./src/routes/recommendation.js";
import leaderboardRouter from "./src/routes/leaderboard.js";
import User from "./src/models/user.js";
import { onlineUsers } from "./src/routes/adminUsers.js";
import dashboardMeRoute from "./src/routes/dashboard.js";
import morgan from "morgan";
import mockExamRoutes from "./src/routes/mockExam.js";
import mockExamPaperRoutes from "./src/routes/mockExamPaper.js";
import examProgressRoutes from "./src/routes/examProgress.js";
import chatSupportRoutes from "./src/routes/chatSupport.js";
import speakingAttemptRoutes from "./src/routes/speakingAttempt.js";
import adminClassroomsRoutes from "./src/routes/adminClassrooms.js";
import adminSchoolYears from "./src/routes/adminSchoolYears.js";
import profileRoutes from "./src/routes/profile.js";
import teacherRequestRoutes from "./src/routes/teacherRequests.js";

const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectDB();

  // Seed skills nếu chưa có
  const existing = await Skill.find();
  if (existing.length === 0) {
    await Skill.insertMany([
      { name: "listening", displayName: "Listening", description: "Rèn luyện kỹ năng nghe hiểu" },
      { name: "reading", displayName: "Reading", description: "Rèn luyện kỹ năng đọc hiểu" },
      { name: "writing", displayName: "Writing", description: "Phát triển kỹ năng viết" },
      { name: "speaking", displayName: "Speaking", description: "Cải thiện kỹ năng nói" },
    ]);
    console.log("✅ Skill data seeded!");
  }

  const app = express();
  const server = http.createServer(app);

  // ✅ Khởi tạo Socket.IO
// Socket.IO
const io = new SocketServer(server, {
  cors: {
    origin: allowedOrigins,   // dùng lại danh sách bên cors.js
    methods: ["GET", "POST"],
  },
});
app.set("io", io);

// ===== CORS HTTP =====
setupCors(app);

  // Middleware
  app.use(express.json());
  app.use(session({ secret: "secretkey", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(morgan("dev"));
  app.use("/uploads", express.static("uploads"));
  // Routes
  const authRoutes = (await import("./src/routes/auth.js")).default;
  const questionRoutes = (await import("./src/routes/question.js")).default;
  const examRoutes = (await import("./src/routes/exam.js")).default;
  const resultRoutes = (await import("./src/routes/result.js")).default;
  const createAuthGoogleRoutes = (await import("./src/routes/authGoogle.js")).default;
  const adminRoutes = (await import("./src/routes/admin.js")).default;
  const adminUsersRoutes = (await import("./src/routes/adminUsers.js")).default;
  const statsRoutes = (await import("./src/routes/stats.js")).default;
  const adminClassroomsRoutes = (await import("./src/routes/adminClassrooms.js")).default;

  const updateLastActivity = async (req, res, next) => {
    try {
      if (req.user) {
        await User.findByIdAndUpdate(req.user._id, { lastActivity: new Date() });
      }
    } catch (err) {
      console.error("Lỗi cập nhật lastActivity:", err);
    }
    next();
  };

  app.use("/api/stats", statsRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/questions", verifyToken, updateLastActivity, questionRoutes);
  app.use("/api/exams", verifyToken, updateLastActivity, examRoutes);
  app.use("/api/results", resultRoutes);
  app.use("/api/auth/google", createAuthGoogleRoutes());
  app.use("/api/admin/users", verifyToken, updateLastActivity, adminUsersRoutes);
  app.use("/api/admin" , adminRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/exam-ai", examAIRoutes);
  app.use("/api/skills", skillRoutes);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/recommendation", recommendationRoutes);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/dashboard", dashboardMeRoute);
  app.use("/api/mock-exams", mockExamRoutes);
  app.use("/api/mock-exam-papers", mockExamPaperRoutes);
  app.use("/api/exam-progress", examProgressRoutes);
  app.use("/api/chat", chatSupportRoutes);
  app.use("/api/speaking-attempts", speakingAttemptRoutes);
  app.use("/api/profile", profileRoutes);
  app.use("/api/admin/school-years", adminSchoolYears);
  app.use("/api/teacher-requests", teacherRequestRoutes);

  // quản lý lớp: cho admin và school_manager
  // 👇 quản lý lớp: cho admin và school_manager
  app.use(
    "/api/admin/classrooms",
    adminClassroomsRoutes
  );


  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/", (req, res) => res.send("Hello, English Exam System!"));
  app.use(async (req, res, next) => {
    try {
      if (req.user) { // req.user được set từ middleware verifyToken
        await User.findByIdAndUpdate(req.user._id, { lastActivity: new Date() });
      }
    } catch (err) {
      console.error("Lỗi cập nhật lastActivity:", err);
    }
    next();
  });
  io.on("connection", (socket) => {
    console.log("🟢 Client connected:", socket.id);
  
    // client tự join theo userId (FE đang gọi s.emit("join_user", userId))
    socket.on("join_user", (userId) => {
      if (!userId) return;
      const roomId = String(userId);
      socket.join(roomId);
      console.log("✅ join_user room:", roomId, "socket:", socket.id);
    });
  
    // CHAT HỎI GIÁO VIÊN (nếu chỉ dùng realtime cho admin thì có thể giữ/hoặc bỏ)
    socket.on("send_message", (data) => {
      console.log("📩 New message:", data);
      // nếu không muốn broadcast hết, có thể bỏ io.emit ở đây
      // io.emit("receive_message", data);
    });
  
    const { token } = socket.handshake.query;
  
    if (token && typeof token === "string") {
      const decoded = verifyTokenSocket(token);
  
      if (!decoded) {
        console.log("❌ Token socket không hợp lệ, vẫn cho giữ kết nối nhưng không auto-join room từ token");
        // nếu muốn vẫn disconnect thì giữ nguyên:
        // socket.disconnect();
        // return;
      } else {
        const userId = String(decoded.id || decoded._id || decoded.userId);
        const role = decoded.role;
  
        socket.join(userId);
        console.log("✅ Auto join room from token:", userId, "socket:", socket.id);
  
        if (role === "teacher" || role === "admin") {
          socket.join("teachers");
          console.log(`👨‍🏫 User ${userId} (${role}) joined room "teachers"`);
        }
  
        if (role === "admin" || role === "school_manager") {
          socket.join("exam-moderators");
          console.log(
            `✅ User ${userId} (${role}) joined room "exam-moderators"`
          );
        }
  
        // ONLINE USERS (giữ nguyên)
        onlineUsers.set(userId, socket.id);
  
        const sendOnlineUsers = async () => {
          const allUsers = await User.find();
          const data = allUsers.map((u) => ({
            _id: u._id,
            name: u.name,
            email: u.email,
            role: u.role,
            isOnline: onlineUsers.has(u._id.toString()),
            lastActivity: u.lastActivity,
          }));
          io.emit("update_users", data);
        };
  
        sendOnlineUsers();
  
        socket.on("disconnect", () => {
          console.log("🔴 Client disconnected:", socket.id);
          onlineUsers.delete(userId);
          sendOnlineUsers();
        });
      }
    } else {
      socket.on("disconnect", () => {
        console.log("🔴 Client disconnected (no token):", socket.id);
      });
    }
  });
  
  

  // ✅ Khởi động server
  server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
}

startServer();
