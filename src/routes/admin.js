// routes/admin.js
import express from "express";
import Test from "../models/test.js";
import User from "../models/User.js";
import Result from "../models/result.js";
import Question from "../models/question.js";

const router = express.Router();

// GET /api/admin/dashboard
router.get("/dashboard", async (req, res) => {
  try {
    // Tổng số học viên (role = student)
    const totalUsers = await User.countDocuments({ role: "student" });

    // Tổng số đề thi
    const totalTests = await Test.countDocuments();

    // Tổng số câu hỏi
    const totalQuestions = await Question.countDocuments();

    // Kết quả thi
    const totalResults = await Result.countDocuments();
    const avgScoreAgg = await Result.aggregate([
      { $match: { score: { $ne: null } } },
      { $group: { _id: null, avgScore: { $avg: "$score" } } }
    ]);
    const avgScore = avgScoreAgg.length > 0 ? avgScoreAgg[0].avgScore.toFixed(1) : 0;

    // Tỷ lệ hoàn thành (nếu 1 result có đủ answers thì coi là hoàn thành)
    const completedExams = await Result.countDocuments({ "answers.0": { $exists: true } });
    const completionRate =
      totalResults > 0 ? ((completedExams / totalResults) * 100).toFixed(1) + "%" : "0%";

    // Hoạt động gần đây (lấy từ Result + User + Test thật)
    const activities = await Result.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("studentId", "name")
      .populate("testId", "title")
      .lean();

    const recentActivities = activities.map((r) => ({
      action: `Hoàn thành bài thi ${r.testId?.title || "N/A"}`,
      user: r.studentId?.name || "Unknown",
      time: r.createdAt,
    }));

    // Thống kê nhanh
    const quickStats = {
      examsToday: await Result.countDocuments({
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
      newUsersThisWeek: await User.countDocuments({
        createdAt: { $gte: new Date(new Date().setDate(new Date().getDate() - 7)) },
      }),
      newTestsThisWeek: await Test.countDocuments({
        createdAt: { $gte: new Date(new Date().setDate(new Date().getDate() - 7)) },
      }),
      totalQuestions,
    };

    res.json({
      stats: [
        {
          title: "Tổng số học viên",
          value: totalUsers,
          description: "Số học viên hiện tại trong hệ thống",
          icon: "Users",
          color: "text-blue-600",
        },
        {
          title: "Tổng số đề thi",
          value: totalTests,
          description: "Tổng số đề thi hiện có",
          icon: "FileText",
          color: "text-green-600",
        },
        {
          title: "Tổng số câu hỏi",
          value: totalQuestions,
          description: "Số câu hỏi trong ngân hàng",
          icon: "HelpCircle",
          color: "text-pink-600",
        },
        {
          title: "Điểm trung bình",
          value: avgScore,
          description: "Điểm trung bình của các bài thi",
          icon: "TrendingUp",
          color: "text-purple-600",
        },
        {
          title: "Tỉ lệ hoàn thành",
          value: completionRate,
          description: "Tỉ lệ bài thi có nộp kết quả",
          icon: "CheckCircle",
          color: "text-orange-600",
        },
      ],
      activities: recentActivities,
      quickStats,
    });
  } catch (err) {
    console.error("Lỗi khi lấy dữ liệu admin dashboard:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
