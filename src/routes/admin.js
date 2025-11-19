// src/routes/admin.js
import express from "express";
import Test from "../models/test.js";
import User from "../models/user.js";
import Result from "../models/result.js";
import Question from "../models/question.js";
import Feedback from "../models/feedback.js";

const router = express.Router();

// GET /api/admin/dashboard
router.get("/dashboard", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: "student" });
    const totalTests = await Test.countDocuments();
    const totalQuestions = await Question.countDocuments();
    const totalResults = await Result.countDocuments();

    const avgScoreAgg = await Result.aggregate([
      { $match: { score: { $ne: null } } },
      { $group: { _id: null, avgScore: { $avg: "$score" } } },
    ]);
    const avgScore =
      avgScoreAgg.length > 0 ? avgScoreAgg[0].avgScore.toFixed(1) : 0;

    const completedExams = await Result.countDocuments({
      "answers.0": { $exists: true },
    });
    const completionRate =
      totalResults > 0
        ? ((completedExams / totalResults) * 100).toFixed(1) + "%"
        : "0%";

    const activities = await Result.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("user", "name")
      .populate("test", "title")
      .lean();

    const recentActivities = activities.map((r) => ({
      action: `Hoàn thành bài thi ${r.test?.title || "N/A"}`,
      user: r.user?.name || "Unknown",
      time: r.createdAt,
    }));

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const examsToday = await Result.countDocuments({
      createdAt: { $gte: todayStart },
    });

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const newUsersThisWeek = await User.countDocuments({
      role: "student",
      createdAt: { $gte: last7Days },
    });

    const newTestsThisWeek = await Test.countDocuments({
      createdAt: { $gte: last7Days },
    });

    const pendingFeedbacks = await Feedback.countDocuments({
      status: "pending",
    });

    let onlineUserList = [];
    let onlineUsers = 0;
    if (User.schema.paths.lastActive) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const onlineStudents = await User.find({
        role: "student",
        lastActive: { $gte: fiveMinutesAgo },
      }).select("_id name email role lastActive");

      onlineUserList = Array.from(
        new Map(onlineStudents.map((u) => [u._id.toString(), u])).values()
      );
      onlineUsers = onlineUserList.length;
    }

    const quickStats = {
      examsToday,
      onlineUsers,
      onlineUserList,
      newUsersThisWeek,
      newTestsThisWeek,
      pendingFeedbacks,

      // thêm 4 field để FE dùng cho StatTile
      totalUsers,
      totalTests,
      totalResults,
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
