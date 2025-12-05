// src/routes/leaderboard.js
import express from "express";
import Result from "../models/result.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET /api/leaderboard
 * query:
 *  - type=score|attempts|speed
 *  - limit=10
 *  - schoolId=...   (optional)
 *  - classroomId=... (optional)
 *
 * Frontend:
 *  - scope = system  → không gửi schoolId/classroomId
 *  - scope = school  → gửi schoolId (user.school)
 *  - scope = class   → gửi classroomId (user.classroom)
 */
router.get(
  "/",
  verifyToken,
  verifyRole(["student", "teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const type = (req.query.type || "score").toString();
      const limit = parseInt(req.query.limit) || 10;
      const { schoolId, classroomId } = req.query;

      const query = {};

      /* =========================
         1. RÀNG BUỘC THEO ROLE
         ========================= */

      // STUDENT: theo lớp/trường chỉ được là lớp/trường của chính mình
      if (req.user.role === "student") {
        // nếu client gửi classroomId → bỏ, dùng classroom của user
        if (classroomId) {
          if (!req.user.classroom) {
            return res
              .status(400)
              .json({ message: "Tài khoản chưa được gán lớp" });
          }
          query.classroom = req.user.classroom; // lớp mình
        }
        // nếu chỉ gửi schoolId → dùng school của user
        else if (schoolId) {
          if (!req.user.school) {
            return res
              .status(400)
              .json({ message: "Tài khoản chưa được gán trường" });
          }
          query.school = req.user.school; // trường mình
        }
        // nếu không gửi gì → system: cho xem toàn hệ thống (query rỗng)
      }

      // TEACHER / SCHOOL_MANAGER: luôn bị khóa trong trường mình
      else if (
        req.user.role === "teacher" ||
        req.user.role === "school_manager"
      ) {
        if (!req.user.school) {
          return res
            .status(400)
            .json({ message: "Tài khoản chưa được gán trường" });
        }

        // nếu có classroomId → lọc theo lớp đó (trong trường mình)
        if (classroomId) {
          query.classroom = classroomId;
          query.school = req.user.school; // đảm bảo cùng trường
        }
        // nếu chỉ có schoolId → phải đúng trường mình, còn không thì chặn
        else if (schoolId) {
          if (schoolId.toString() !== req.user.school.toString()) {
            return res
              .status(403)
              .json({ message: "Không có quyền xem bảng xếp hạng trường này" });
          }
          query.school = req.user.school;
        }
        // nếu không truyền gì → mặc định trường của user
        else {
          query.school = req.user.school;
        }
      }

      // ADMIN: có thể dùng schoolId/classroomId để lọc, hoặc bỏ trống = toàn hệ thống
      else if (req.user.role === "admin") {
        if (classroomId) {
          query.classroom = classroomId;
        } else if (schoolId) {
          query.school = schoolId;
        }
      }

      /* =========================
         2. LẤY KẾT QUẢ & GỘP USER
         ========================= */

      const rawResults = await Result.find(query)
        .populate("user", "name avatar school classroom")
        .sort({ createdAt: -1 });

      const results = rawResults.filter((r) => r.user); // bỏ kết quả mồ côi

      const leaderboardMap = {};

      results.forEach((r) => {
        const userId = r.user._id.toString();

        if (!leaderboardMap[userId]) {
          leaderboardMap[userId] = {
            user: r.user,
            totalScore: 0,
            attempts: 0,
            totalTime: 0,
          };
        }

        leaderboardMap[userId].totalScore += Number(r.score || 0);
        leaderboardMap[userId].attempts += 1;
        leaderboardMap[userId].totalTime += Number(r.timeSpent || 0);
      });

      const leaderboardArray = Object.values(leaderboardMap).map((u) => ({
        user: u.user,
        totalScore: u.totalScore,
        attempts: u.attempts,
        averageTime: u.attempts ? u.totalTime / u.attempts : 0,
      }));

      if (type === "score") {
        leaderboardArray.sort((a, b) => b.totalScore - a.totalScore);
      } else if (type === "attempts") {
        leaderboardArray.sort((a, b) => b.attempts - a.attempts);
      } else if (type === "speed") {
        leaderboardArray.sort((a, b) => a.averageTime - b.averageTime);
      }

      res.json(leaderboardArray.slice(0, limit));
    } catch (err) {
      console.error("❌ Lỗi leaderboard:", err);
      res
        .status(500)
        .json({ message: "Lỗi server khi lấy bảng xếp hạng" });
    }
  }
);

export default router;
