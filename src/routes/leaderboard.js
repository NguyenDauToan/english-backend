import express from "express";
import Result from "../models/result.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET /api/leaderboard?type=score|attempts|speed&limit=10
 */
router.get("/", verifyToken, verifyRole(["student", "teacher", "admin"]), async (req, res) => {
  try {
    const type = req.query.type || "score";
    const limit = parseInt(req.query.limit) || 10;

    // Lấy tất cả kết quả
    const results = await Result.find({})
      .populate("user", "name avatar")
      .sort({ createdAt: -1 });

    // Tính toán leaderboard
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
      leaderboardMap[userId].totalScore += r.score;
      leaderboardMap[userId].attempts += 1;
      leaderboardMap[userId].totalTime += r.timeSpent;
    });

    // Tạo mảng leaderboard
    const leaderboardArray = Object.values(leaderboardMap).map((u) => ({
      user: u.user,
      totalScore: u.totalScore,
      attempts: u.attempts,
      averageTime: u.attempts ? u.totalTime / u.attempts : 0,
    }));

    // Sắp xếp theo type
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
    res.status(500).json({ message: "Lỗi server khi lấy bảng xếp hạng" });
  }
});

export default router;
