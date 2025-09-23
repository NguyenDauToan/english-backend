import express from "express";
import Result from "../models/result.js";
import Question from "../models/question.js"; // để kiểm tra đáp án
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

// 🌟 Lưu kết quả (học sinh làm bài) và tính score theo skill
router.post("/", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const { testId, answers, timeSpent } = req.body;

    if (!answers || !Array.isArray(answers))
      return res.status(400).json({ message: "Thiếu dữ liệu answers" });

    const evaluatedAnswers = [];
    const skillStats = {};
    let totalScore = 0;

    for (const ans of answers) {
      const question = await Question.findById(ans.questionId);
      if (!question) continue;

      let isCorrect = false;

      // Chấm điểm tự động theo loại câu hỏi
      switch (question.type) {
        case "multiple_choice":
        case "true_false":
        case "fill_blank":
          isCorrect = question.answer.trim().toLowerCase() === ans.answer.trim().toLowerCase();
          break;
      }

      if (isCorrect) totalScore++;

      // Tính theo skill
      if (!skillStats[question.skill]) skillStats[question.skill] = { total: 0, correct: 0 };
      skillStats[question.skill].total++;
      if (isCorrect) skillStats[question.skill].correct++;

      // Push evaluated answer với tất cả thông tin cần thiết
      evaluatedAnswers.push({
        question: question._id,
        questionText: question.question,
        answer: ans.answer,
        correct: question.answer,
        isCorrect,
        skill: question.skill,
        grade: question.grade
      });
    }

    // Lưu kết quả
    const result = await Result.create({
      user: req.user._id,
      exam: testId,
      answers: evaluatedAnswers,
      score: totalScore,
      timeSpent: timeSpent || 0, // thời gian làm bài (giây)
      details: Object.entries(skillStats).map(([skill, stat]) => ({
        skill,
        score: stat.correct,
        total: stat.total,
        accuracy: stat.correct / stat.total,
      })),
    });
    console.log("⏱️ Saved result timeSpent:", timeSpent, "=> Stored in DB:", result.timeSpent);

    res.status(201).json({
      _id: result._id,
      user: req.user._id,
      exam: testId,
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

// Lấy kết quả học sinh hiện tại
router.get("/me", verifyToken, verifyRole(["student"]), async (req, res) => {
  try {
    const results = await Result.find({ user: req.user._id })
      .populate("exam", "title duration")
      .sort({ createdAt: -1 });

      const formattedResults = results.map(r => {
        console.log("⏱️ Fetching result timeSpent:", r.timeSpent); // log ra xem DB có lưu đúng không
        return {
          _id: r._id,
          user: r.user,
          exam: r.exam,
          score: r.score,
          timeSpent: r.timeSpent,
          finishedAt: r.createdAt,
          details: r.details,
          answers: r.answers.map(a => ({
            questionText: a.question?.content || "",
            correct: a.question?.answer || "",
            skill: a.question?.skill || "",
            grade: a.question?.grade || "",
            answer: a.answer,
            isCorrect: a.isCorrect
          }))
        };
      });

    res.json(formattedResults);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server khi lấy kết quả cá nhân" });
  }
});

// 🌟 Lấy kết quả 1 bài thi (teacher/admin)
router.get("/exam/:examId", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const results = await Result.find({ exam: req.params.examId })
      .populate("user", "name email")
      .sort({ createdAt: -1 });
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server khi lấy kết quả bài thi" });
  }
});

// 🌟 Thống kê điểm theo skill 1 bài thi (teacher/admin)
router.get(
  "/exam/:examId/skill-stats",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const results = await Result.find({ exam: req.params.examId });

      if (!results.length) return res.json({ message: "Chưa có kết quả" });

      const skillStats = {};

      results.forEach((r) => {
        r.details.forEach((d) => {
          if (!skillStats[d.skill]) {
            skillStats[d.skill] = { total: 0, correct: 0 };
          }
          skillStats[d.skill].total += d.total;
          skillStats[d.skill].correct += d.score;
        });
      });

      // Tính accuracy
      Object.keys(skillStats).forEach((skill) => {
        skillStats[skill].accuracy = skillStats[skill].correct / skillStats[skill].total;
      });

      res.json(skillStats);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server khi thống kê theo skill" });
    }
  }
);

// 🌐 Thống kê toàn hệ thống theo skill (teacher/admin)
router.get(
  "/system/skill-stats",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const results = await Result.find({});
      if (!results.length) return res.json({ message: "Chưa có kết quả nào" });

      const skillStats = {};

      results.forEach((r) => {
        if (r.details && r.details.length) {
          r.details.forEach((d) => {
            if (!skillStats[d.skill]) {
              skillStats[d.skill] = { total: 0, correct: 0 };
            }
            skillStats[d.skill].total += d.total;
            skillStats[d.skill].correct += d.score;
          });
        }
      });

      Object.keys(skillStats).forEach((skill) => {
        skillStats[skill].accuracy = skillStats[skill].correct / skillStats[skill].total;
      });

      res.json(skillStats);
    } catch (err) {
      console.error("❌ Lỗi thống kê toàn hệ thống theo skill:", err);
      res.status(500).json({ message: "Lỗi server khi thống kê toàn hệ thống" });
    }
  }
);

// 🌐 Thống kê theo skill + lớp (teacher/admin)
router.get(
  "/system/skill-grade-stats",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const results = await Result.find({}).populate("answers.question");
      if (!results.length) return res.json({ message: "Chưa có kết quả nào" });

      const stats = {};

      results.forEach((r) => {
        r.answers.forEach((a) => {
          const question = a.question;
          if (!question) return;

          const grade = question.grade;
          const skill = question.skill;

          if (!stats[grade]) stats[grade] = {};
          if (!stats[grade][skill]) stats[grade][skill] = { total: 0, correct: 0 };

          stats[grade][skill].total += 1;
          if (a.isCorrect) stats[grade][skill].correct += 1;
        });
      });

      Object.keys(stats).forEach((grade) => {
        Object.keys(stats[grade]).forEach((skill) => {
          const item = stats[grade][skill];
          item.accuracy = item.correct / item.total;
        });
      });

      res.json(stats);
    } catch (err) {
      console.error("❌ Lỗi thống kê theo skill + lớp:", err);
      res.status(500).json({ message: "Lỗi server khi thống kê theo skill + lớp" });
    }
  }
);

export default router;
