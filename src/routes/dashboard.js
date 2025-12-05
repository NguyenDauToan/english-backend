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

    const { school: userSchool, classroom: userClassroom, grade: userGrade } =
      req.user;

    // 🔹 filter chung: luôn theo user, nếu user có lớp hiện tại thì lọc thêm theo lớp
    const matchFilter = { user: userId };
    if (userClassroom) {
      matchFilter.classroom = new mongoose.Types.ObjectId(
        String(userClassroom)
      );
    }

    // 1. Tổng bài + tổng thời gian (chỉ theo lớp hiện tại nếu có)
    const baseAgg = await Result.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalResults: { $sum: 1 },
          totalTime: { $sum: { $ifNull: ["$timeSpent", 0] } },
        },
      },
    ]);
    const totals = baseAgg[0] || { totalResults: 0, totalTime: 0 };

    // 2. Accuracy (chỉ theo lớp hiện tại nếu có)
    const accuracyAgg = await Result.aggregate([
      { $match: matchFilter },
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
    // 2b. Accuracy theo từng kỹ năng (listening/speaking/reading/writing)
    const perSkillAgg = await Result.aggregate([
      { $match: matchFilter },

      // join với Test để lấy skill
      {
        $lookup: {
          from: "tests",
          localField: "test",
          foreignField: "_id",
          as: "test",
        },
      },
      {
        $unwind: {
          path: "$test",
          preserveNullAndEmptyArrays: true,
        },
      },

      // join với MockExam để lấy skill (nếu là mock)
      {
        $lookup: {
          from: "mockexams",
          localField: "mockExam",
          foreignField: "_id",
          as: "mockExam",
        },
      },
      {
        $unwind: {
          path: "$mockExam",
          preserveNullAndEmptyArrays: true,
        },
      },

      // chọn skill: ưu tiên từ test, nếu không có thì lấy từ mockExam
      {
        $addFields: {
          skill: {
            $ifNull: ["$test.skill", "$mockExam.skill"],
          },
        },
      },

      // tách answers để đếm đúng/sai
      { $unwind: "$answers" },

      // chỉ giữ 4 kỹ năng chính
      {
        $match: {
          skill: { $in: ["listening", "speaking", "reading", "writing"] },
        },
      },

      {
        $group: {
          _id: "$skill",
          total: { $sum: 1 },
          correct: {
            $sum: {
              $cond: [{ $eq: ["$answers.isCorrect", true] }, 1, 0],
            },
          },
        },
      },
    ]);

    // build object skillScores
    const skillScores = {
      listening: 0,
      speaking: 0,
      reading: 0,
      writing: 0,
    };

    perSkillAgg.forEach((row) => {
      const key = row._id;
      if (skillScores.hasOwnProperty(key) && row.total > 0) {
        skillScores[key] = Math.round((row.correct / row.total) * 100);
      }
    });
    // 3. Toàn bộ kết quả (test + mockExam) – cũng chỉ lấy theo lớp hiện tại nếu có
    const recent = await Result.find(matchFilter)
      .populate("test", "title")
      .populate("mockExam", "name officialName examType grade year")
      .sort({ createdAt: -1 })
      .lean();

    // 4. ĐỀ THI SẮP DIỄN RA (UPCOMING) – LẤY TỪ MockExam
    const now = new Date();
    const filterUpcoming = {
      startTime: { $gte: now },
      status: "approved",
      isActive: true,
    };

    // nếu user có school thì lọc theo trường
    if (userSchool) {
      filterUpcoming.school = userSchool;
    }

    const orConditions = [];

    if (userClassroom) {
      orConditions.push({ scope: "class", classroom: userClassroom });
    }
    if (userGrade) {
      orConditions.push({ scope: "grade", gradeKey: userGrade });

      // nếu 10–12 -> thêm thptqg
      const gNum = Number(userGrade);
      if (!Number.isNaN(gNum) && gNum >= 10 && gNum <= 12) {
        orConditions.push({ scope: "grade", gradeKey: "thptqg" });
      }
    }
    if (orConditions.length > 0) {
      filterUpcoming.$or = orConditions;
    }

    const upcomingRaw = await MockExam.find(filterUpcoming)
      .sort({ startTime: 1, createdAt: -1 })
      .limit(6)
      .select(
        [
          "name",
          "officialName",
          "examType",
          "skill",
          "duration",
          "grade",
          "gradeKey",
          "school",
          "classroom",
          "startTime",
        ].join(" ")
      )
      .populate("school", "name")
      .populate("classroom", "name grade")
      .lean();

    const upcomingExams = upcomingRaw.map((ex) => ({
      id: ex._id,
      title: ex.officialName || ex.name,
      skill: ex.skill || "mixed",
      schoolName: ex.school?.name || null,
      classroomName: ex.classroom?.name || null,
      grade: ex.gradeKey || ex.grade || null,
      startTime: ex.startTime,
      duration: ex.duration,
      examType: ex.examType,
    }));

    // 5. Hàm tính điểm 10 cho recent
    const getResultScore10 = (r) => {
      if (typeof r.score === "number" && !Number.isNaN(r.score)) {
        return Math.round(r.score * 100) / 100;
      }
      if (Array.isArray(r.details) && r.details.length > 0) {
        const sum = r.details.reduce(
          (acc2, d) => acc2 + (typeof d.score === "number" ? d.score : 0),
          0
        );
        const avg = sum / r.details.length || 0;
        return Math.round(avg * 100) / 100;
      }
      return 0;
    };

    res.json({
      quickStats: {
        completedExams: totals.totalResults || 0,
        accuracyPercent: accuracy,
        studyTimeHours:
          Math.round(((totals.totalTime || 0) / 3600) * 10) / 10,
        skillScores, // 👈 thêm dòng này
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
          score: getResultScore10(r),
          finishedAt: r.createdAt,
          examType: mock.examType || undefined,
        };
      }),
      upcomingExams,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Không thể lấy thống kê dashboard" });
  }
});

export default router;
