// routes/dashboard.js
import express from "express";
import mongoose from "mongoose";
import Result from "../models/result.js";
import Test from "../models/test.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import MockExam from "../models/mockExam.js";

const router = express.Router();

router.get("/me", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const rawId = String(req.user._id || req.user.id);
    const userId = new mongoose.Types.ObjectId(rawId);

    // Tổng bài + tổng thời gian
    const baseAgg = await Result.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalResults: { $sum: 1 },
          totalTime: { $sum: { $ifNull: ["$timeSpent", 0] } },
        },
      },
    ]);
    const totals = baseAgg[0] || { totalResults: 0, totalTime: 0 };

    // Accuracy
    const accuracyAgg = await Result.aggregate([
      { $match: { user: userId } },
      { $unwind: "$answers" },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          correct: {
            $sum: { $cond: [{ $eq: ["$answers.isCorrect", true] }, 1, 0] },
          },
        },
      },
    ]);
    const acc = accuracyAgg[0];
    const accuracy =
      acc && acc.total > 0 ? Math.round((acc.correct / acc.total) * 100) : 0;

    // 10 kết quả gần nhất: cả test + mockExam
    const recent = await Result.find({ user: userId })
      .populate("test", "title")
      .populate("mockExam", "name officialName examType grade year")
      .sort({ createdAt: -1 })
      .lean();

    // Kỳ thi sắp diễn ra (từ Test)
    let upcoming = [];
    try {
      if (Test) {
        upcoming = await Test.find({ startTime: { $gte: new Date() } })
          .sort({ startTime: 1 })
          .limit(5)
          .select("title startTime duration skill")
          .lean();
      }
    } catch {}

    res.json({
      quickStats: {
        completedExams: totals.totalResults || 0,
        accuracyPercent: accuracy,
        studyTimeHours:
          Math.round(((totals.totalTime || 0) / 3600) * 10) / 10,
      },
      recentActivities: recent.map((r) => {
        const mock = r.mockExam || {};
        const testTitle =
          r.test?.title ||
          mock.officialName ||
          mock.name ||
          "Bài thi";

        return {
          id: r._id,
          testTitle,
          score: Math.round((r.score ?? 0) * 100) / 100,
          finishedAt: r.createdAt,
          examType: mock.examType || undefined,
        };
      }),
      upcomingExams: upcoming,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Không thể lấy thống kê dashboard" });
  }
});

export default router;
