import express from "express";
import Test from "../models/test.js";
import Question from "../models/question.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import User from "../models/user.js";                 // ➕ THÊM
import { sendNewExamEmail } from "../utils/mailer.js";
const router = express.Router();

// POST /api/exam-ai/create → chỉ chọn câu hỏi, KHÔNG lưu DB
router.post("/create", verifyToken, verifyRole(["teacher", "admin","school_manager"]), async (req, res) => {
  try {
    const { grade, skill, level, numQuestions = 10 } = req.body;
    if (!grade || !skill || !numQuestions) {
      return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });
    }

    let questions = [];

    if (level && level !== "mixed") {
      const available = await Question.find({ grade, skill, level });
      if (!available.length) return res.status(404).json({ message: "Không có câu hỏi phù hợp" });

      const sampleSize = Math.min(numQuestions, available.length);
      questions = await Question.aggregate([
        { $match: { grade, skill, level } },
        { $sample: { size: sampleSize } },
      ]);
    } else {
      // mixed level
      const allQuestions = await Question.find({ grade, skill });
      if (!allQuestions.length) return res.status(404).json({ message: "Không có câu hỏi phù hợp" });

      // Lấy numQuestions ngẫu nhiên từ allQuestions
      const usedIds = new Set();
      const levels = ["easy", "medium", "hard"];
      const weights = [0.4, 0.4, 0.2];
      while (questions.length < Math.min(numQuestions, allQuestions.length)) {
        const rand = Math.random();
        let cumulative = 0;
        let selectedLevel = "easy";
        for (let i = 0; i < levels.length; i++) {
          cumulative += weights[i];
          if (rand <= cumulative) {
            selectedLevel = levels[i];
            break;
          }
        }

        const candidates = allQuestions.filter(q => q.level === selectedLevel && !usedIds.has(q._id.toString()));
        let q;
        if (candidates.length === 0) {
          const remaining = allQuestions.filter(q => !usedIds.has(q._id.toString()));
          if (!remaining.length) break;
          q = remaining[Math.floor(Math.random() * remaining.length)];
        } else {
          q = candidates[Math.floor(Math.random() * candidates.length)];
        }
        questions.push(q);
        usedIds.add(q._id.toString());
      }
    }

    res.status(200).json({ questions });
  } catch (err) {
    console.error("AI create exam error:", err);
    res.status(500).json({ message: "Lỗi khi tạo đề thi AI" });
  }
});


// POST /api/exam-ai/save → lưu thật vào DB
router.post(
  "/save",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const { title, grade, skill, level, duration, questions } = req.body;
      if (!questions?.length) {
        return res
          .status(400)
          .json({ message: "Chưa có câu hỏi để lưu" });
      }

      const exam = await Test.create({
        title: title || `Đề thi lớp ${grade} - ${skill}`,
        grade,
        skill,
        level,
        duration,
        questions,
        totalQuestions: questions.length,
        createdBy: req.user._id,
      });

      // ➕ GỬI MAIL THÔNG BÁO CHO HỌC SINH
      try {
        // 1) Gửi cho TẤT CẢ học sinh
        const studentFilter =  { role: "student" };

        // Nếu bạn chắc chắn users.grade trùng format với exam.grade
        // thì mới bật filter này, còn không thì để comment:
        // if (grade) studentFilter.grade = grade;

        const students = await User.find(studentFilter).select("email name");

        console.log("Số học sinh sẽ gửi mail:", students.length);

        const examLink = process.env.CLIENT_URL
          ? `${process.env.CLIENT_URL}/student/exams/${exam._id}`
          : "";

        await Promise.all(
          students
            .filter((s) => !!s.email)
            .map((s) =>
              sendNewExamEmail({
                to: s.email,
                studentName: s.name || "bạn",
                examTitle: exam.title,
                duration: exam.duration,
                examLink,
              })
            )
        );
      } catch (mailErr) {
        console.error("Lỗi gửi mail thông báo đề thi AI mới:", mailErr);
        // KHÔNG throw để không làm hỏng API tạo đề thi
      }

      res.status(201).json({ message: "Đề thi đã lưu", exam });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi khi lưu đề thi" });
    }
  }
);


export default router;
