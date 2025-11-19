import express from "express";
import Result from "../models/result.js";
import Question from "../models/question.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();
const normalize = (val) =>
  typeof val === "string" ? val.trim().toLowerCase() : "";

// ============================
// POST /api/results/
// Lưu kết quả bài làm, tính score theo skill + emit socket cho admin/teacher
// ============================
router.post("/", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const { testId, mockExamId, answers, timeSpent } = req.body;

    if (!testId && !mockExamId) {
      return res
        .status(400)
        .json({ message: "Thiếu testId hoặc mockExamId" });
    }

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ message: "Thiếu dữ liệu answers" });
    }

    if (answers.length === 0) {
      return res.status(400).json({ message: "Bài thi chưa có câu hỏi" });
    }

    let totalItems = 0;
    let totalCorrectItems = 0;

    const evaluatedAnswers = [];
    const skillStats = {};

    for (const ans of answers) {
      try {
        if (!ans?.questionId) continue;

        const question = await Question.findById(ans.questionId);
        if (!question) continue;

        const skillKey = question.skill || "unknown";
        const baseInfo = {
          question: question._id,
          skill: skillKey,
          grade: question.grade || "",
          type: question.type || "",
        };

        // CASE 1: reading_cloze nhiều subQuestions
        if (
          question.type === "reading_cloze" &&
          Array.isArray(question.subQuestions) &&
          question.subQuestions.length > 0
        ) {
          let userSubAnswers = [];
          try {
            if (typeof ans.answer === "string" && ans.answer.trim()) {
              userSubAnswers = JSON.parse(ans.answer);
            }
          } catch (e) {
            console.warn("Không parse được JSON answer cho reading_cloze:", e);
          }

          const subQs = question.subQuestions;
          const subCount = subQs.length;
          totalItems += subCount;

          if (!skillStats[skillKey]) {
            skillStats[skillKey] = { total: 0, correct: 0 };
          }

          subQs.forEach((subQ, subIdx) => {
            const opts = Array.isArray(subQ.options) ? subQ.options : [];
            const idxCorrect =
              typeof subQ.correctIndex === "number" ? subQ.correctIndex : 0;
            const correctText = opts[idxCorrect] ?? "";
            const correctNorm = normalize(correctText);

            const userAns = Array.isArray(userSubAnswers)
              ? userSubAnswers[subIdx] ?? ""
              : "";
            const userNorm = normalize(userAns);

            const isCorrect =
              correctNorm && userNorm && correctNorm === userNorm;

            if (isCorrect) {
              totalCorrectItems += 1;
              skillStats[skillKey].correct += 1;
            }
            skillStats[skillKey].total += 1;

            evaluatedAnswers.push({
              ...baseInfo,
              questionText:
                question.content +
                "\n(" +
                (subQ.label || `Question ${subIdx + 1}`) +
                ")",
              answer: userAns ?? "",
              correct: correctText,
              isCorrect,
              subIndex: subIdx,
            });
          });
        }
        // CASE 2: câu thường
        else {
          totalItems += 1;

          if (!skillStats[skillKey]) {
            skillStats[skillKey] = { total: 0, correct: 0 };
          }

          const userNorm = normalize(ans.answer);
          let isCorrect = false;
          let correctText = "";

          if (Array.isArray(question.answer)) {
            const correctArr = question.answer
              .map((v) => normalize(v))
              .filter(Boolean);
            if (userNorm && correctArr.includes(userNorm)) {
              isCorrect = true;
            }
            correctText = question.answer.join(" / ");
          } else {
            const correctNorm = normalize(question.answer);
            if (correctNorm && userNorm && correctNorm === userNorm) {
              isCorrect = true;
            }
            correctText = question.answer ?? "";
          }

          if (isCorrect) {
            totalCorrectItems += 1;
            skillStats[skillKey].correct += 1;
          }
          skillStats[skillKey].total += 1;

          evaluatedAnswers.push({
            ...baseInfo,
            questionText: question.content,
            answer: ans.answer ?? "",
            correct: correctText,
            isCorrect,
            subIndex: null,
          });
        }
      } catch (e) {
        console.warn("Lỗi đánh giá câu hỏi:", e);
        continue;
      }
    }

    // Tính điểm thang 10
    let totalScore = 0;
    if (totalItems > 0) {
      totalScore = (totalCorrectItems * 10) / totalItems;
      totalScore = Math.round(totalScore * 100) / 100;
    }

    const details = Object.entries(skillStats).map(([skill, stat]) => {
      const accuracy =
        stat.total > 0 ? stat.correct / stat.total : 0;
      return {
        skill: skill || "unknown",
        score: Number((accuracy * 10).toFixed(2)),
        total: stat.total,
        accuracy,
      };
    });

    // Lưu kết quả
    const result = await Result.create({
      user: req.user._id,
      test: testId || null,
      mockExam: mockExamId || null,
      answers: evaluatedAnswers,
      score: totalScore,
      timeSpent: timeSpent || 0,
      details,
    });

    // Populate để lấy tên đề
    const populated = await result.populate([
      { path: "test", select: "title duration" },
      {
        path: "mockExam",
        select: "name officialName examType grade year duration",
      },
    ]);
    const r = populated || result;

    const examTitle =
      r.test?.title ||
      r.mockExam?.officialName ||
      r.mockExam?.name ||
      "Bài thi";

    // 🔔 Emit thông báo cho giáo viên / admin
    // 🔔 Emit thông báo cho giáo viên / admin
    const io = req.app.get("io");
    if (io) {
      const payload = {
        userId: req.user._id,
        userName: req.user.name,
        examId: testId || mockExamId,
        examTitle,
        score: totalScore,
        maxScore: 10,
        finishedAt: result.createdAt,
        resultId: result._id,
      };

      console.log(">>> EMIT admin_exam_finished:", payload);

      // Gửi cho room teachers (nếu join đúng)
      io.to("teachers").emit("admin_exam_finished", payload);

      // Đồng thời broadcast cho tất cả socket (đảm bảo FE nhận được kể cả khi chưa join room)
      io.emit("admin_exam_finished", payload);
    }


    res.status(201).json({
      _id: result._id,
      user: req.user._id,
      test: result.test,
      mockExam: result.mockExam,
      answers: evaluatedAnswers,
      score: totalScore,
      timeSpent: result.timeSpent,
      finishedAt: result.createdAt,
      details: result.details,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server khi lưu kết quả" });
  }
});

// ============================
// (Nếu cần) GET /api/results/me
// Lấy các kết quả của chính học sinh
// ============================
// router.get("/me", verifyToken, verifyRole(["student"]), async (req, res) => {
//   try {
//     const results = await Result.find({ user: req.user._id })
//       .populate("test", "title duration")
//       .populate("mockExam", "name officialName examType grade year duration")
//       .sort({ createdAt: -1 });
//     res.json(results);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Lỗi server khi lấy kết quả cá nhân" });
//   }
// });

// ============================
// GET /api/results/user/:userId
// Teacher/Admin xem kết quả học sinh khác
// ============================
router.get(
  "/user/:userId",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const results = await Result.find({ user: req.params.userId })
        .populate("test", "title duration")
        .sort({ createdAt: -1 });
      res.json(results);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Lỗi server khi lấy kết quả học sinh" });
    }
  }
);

// ============================
// GET /api/results/test/:testId
// Lấy kết quả 1 bài test (teacher/admin)
// ============================
router.get(
  "/test/:testId",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const results = await Result.find({ test: req.params.testId })
        .populate("user", "name email")
        .sort({ createdAt: -1 });
      res.json(results);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Lỗi server khi lấy kết quả bài test" });
    }
  }
);

// ============================
// GET /api/results/me/skill-stats
// Skill stats học sinh hiện tại
// ============================
router.get(
  "/me/skill-stats",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const results = await Result.find({ user: req.user._id });
      if (!results.length) return res.json({});

      const skillStats = {};

      results.forEach((r) => {
        if (Array.isArray(r.details)) {
          r.details.forEach((d) => {
            if (!skillStats[d.skill])
              skillStats[d.skill] = { total: 0, correct: 0 };
            skillStats[d.skill].total += d.total;
            skillStats[d.skill].correct += d.score;
          });
        }
      });

      Object.keys(skillStats).forEach((skill) => {
        skillStats[skill].accuracy =
          skillStats[skill].total > 0
            ? Math.round(
              (skillStats[skill].correct /
                (skillStats[skill].total * 10)) *
              100
            ) / 100
            : 0;
      });

      res.json(skillStats);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Lỗi khi thống kê skill của học sinh" });
    }
  }
);

// ============================
// GET /api/results/system/skill-stats
// Thống kê kỹ năng toàn hệ thống (admin / teacher)
// ============================
router.get(
  "/system/skill-stats",
  verifyToken,
  verifyRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const results = await Result.find({}, "answers");

      if (!results.length) {
        return res.json({});
      }

      const skillStats = {};

      results.forEach((r) => {
        if (!Array.isArray(r.answers)) return;

        r.answers.forEach((a) => {
          const skill = a.skill || "unknown";

          if (!skillStats[skill]) {
            skillStats[skill] = {
              totalQuestions: 0,
              correctQuestions: 0,
            };
          }

          skillStats[skill].totalQuestions += 1;
          if (a.isCorrect) {
            skillStats[skill].correctQuestions += 1;
          }
        });
      });

      const response = {};

      Object.entries(skillStats).forEach(([skill, stat]) => {
        const { totalQuestions, correctQuestions } = stat;
        const accuracy =
          totalQuestions > 0 ? correctQuestions / totalQuestions : 0;

        response[skill] = {
          totalQuestions,
          correctQuestions,
          accuracy: Number((accuracy * 100).toFixed(1)),
          avgScore: Number((accuracy * 10).toFixed(2)),
        };
      });

      res.json(response);
    } catch (err) {
      console.error("Lỗi thống kê skill toàn hệ thống:", err);
      res.status(500).json({
        message: "Lỗi server khi thống kê kỹ năng toàn hệ thống",
      });
    }
  }
);

export default router;
