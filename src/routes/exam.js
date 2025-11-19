import express from "express";
import Test from "../models/test.js";
import Question from "../models/question.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import mongoose from "mongoose";

const router = express.Router();

/* =========================
  🧩 1. Tạo bài thi thủ công
  ========================= */
  router.post(
    "/",
    verifyToken,
    verifyRole(["teacher", "admin"]),
    async (req, res) => {
      try {
        const { title, description, duration, level, grade, questions, skill } =
          req.body;
  
        if (!questions?.length)
          return res
            .status(400)
            .json({ message: "Cần cung cấp danh sách câu hỏi" });
  
        if (!duration || typeof duration !== "number" || duration <= 0)
          return res.status(400).json({
            message: "Cần cung cấp thời gian làm bài hợp lệ (phút)",
          });
  
        const exam = await Test.create({
          title,
          description,
          duration,
          level: level || "mixed",
          grade,
          // 👇 KHÔNG default "mixed" nữa, để nguyên skill FE gửi lên
          skill: skill || undefined,
          questions,
          createdBy: req.user._id,
        });
  
        const populatedExam = await exam.populate({
          path: "questions",
          select:
            "content type options answer skill grade level subQuestions",
        });
  
        res.status(201).json(populatedExam);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    }
  );

/* =========================
  👤 1.5. Các đề thi của giáo viên hiện tại
  ========================= */
// GET /api/exams/mine (đặt TRƯỚC /:id để không bị nuốt)
router.get(
  "/mine",
  verifyToken,
  verifyRole(["teacher"]),
  async (req, res) => {
    try {
      const exams = await Test.find({ createdBy: req.user._id })
        .populate(
          "questions",
          "content skill level grade subQuestions type options answer"
        )
        .sort({ createdAt: -1 });

      res.json(exams);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  📘 2. Lấy danh sách bài thi (có lọc skill, grade, level)
  ========================= */
router.get("/", verifyToken, async (req, res) => {
  try {
    const { skill, grade, level } = req.query;
    const filter = {};

    // Lọc theo grade, level trực tiếp trong bảng Test
    if (grade) filter.grade = grade;
    if (level) filter.level = level;

    // Nếu không có skill thì chỉ cần lọc Test bình thường
    if (!skill) {
      const exams = await Test.find(filter)
        .populate({
          path: "questions",
          select:
            "content type options answer skill grade level subQuestions",
        })
        .sort({ createdAt: -1 });

      return res.json(exams);
    }

    // Nếu có skill thì chỉ lấy bài thi có ít nhất 1 câu hỏi thuộc skill đó
    const exams = await Test.find(filter)
      .populate({
        path: "questions",
        match: { skill }, // lọc trực tiếp trong populate
        select:
          "content type options answer skill grade level subQuestions",
      })
      .sort({ createdAt: -1 });

    // Giữ lại những bài có ít nhất 1 câu hỏi khớp skill
    const filteredExams = exams
      .map((exam) => ({
        ...exam.toObject(),
        questions: exam.questions.filter((q) => q.skill === skill),
      }))
      .filter((exam) => exam.questions.length > 0);

    res.json(filteredExams);
  } catch (err) {
    console.error("❌ Lỗi khi lấy bài thi:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =========================
  📄 3. Lấy chi tiết 1 bài thi
  ========================= */
router.get("/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "ID bài thi không hợp lệ" });
  }

  try {
    const exam = await Test.findById(id).populate({
      path: "questions",
      select:
        "content type options answer skill grade level subQuestions",
    });

    if (!exam) return res.status(404).json({ message: "Bài thi không tồn tại" });

    res.json({
      ...exam.toObject(),
      questions: exam.questions || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

/* =========================
  ✏️ 4. Cập nhật bài thi
  ========================= */
router.put(
  "/:id",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const exam = await Test.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
      });
      if (!exam)
        return res.status(404).json({ message: "Bài thi không tồn tại" });

      const populatedExam = await exam.populate({
        path: "questions",
        select:
          "content type options answer skill grade level subQuestions",
      });

      res.json(populatedExam);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  ❌ 5. Xóa bài thi
  ========================= */
router.delete(
  "/:id",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const exam = await Test.findByIdAndDelete(req.params.id);
      if (!exam)
        return res.status(404).json({ message: "Bài thi không tồn tại" });
      res.json({ message: "Xóa bài thi thành công" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  ⚙️ 6. Sinh bài thi tự động
  ========================= */
router.post(
  "/generate",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const { title, description, duration, rules, level, grade } = req.body;

      if (!rules?.length)
        return res
          .status(400)
          .json({ message: "Cần cung cấp quy tắc chọn câu hỏi" });

      if (!duration || typeof duration !== "number" || duration <= 0)
        return res.status(400).json({
          message: "Cần cung cấp thời gian làm bài hợp lệ (phút)",
        });

      let selectedQuestions = [];

      for (const rule of rules) {
        const match = {};
        if (rule.skill) match.skill = rule.skill;
        if (rule.level) match.level = rule.level;
        if (grade) match.grade = grade;

        const questions = await Question.aggregate([
          { $match: match },
          { $sample: { size: rule.count } },
        ]);

        selectedQuestions.push(...questions);
      }

      const exam = await Test.create({
        title,
        description,
        duration,
        level: level || "N/A",
        grade: grade || "N/A",
        questions: selectedQuestions.map((q) => q._id),
        createdBy: req.user._id,
      });

      const populatedExam = await exam.populate({
        path: "questions",
        select:
          "content type options answer skill grade level subQuestions",
      });

      res.status(201).json(populatedExam);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

/* =========================
  💾 7. Lưu đề thi từ AI / builder
  ========================= */
  router.post(
    "/save",
    verifyToken,
    verifyRole(["teacher", "admin"]),
    async (req, res) => {
      try {
        const { title, questions, skill, level, grade, duration } = req.body;
  
        if (!questions || !questions.length)
          return res.status(400).json({ message: "Chưa có câu hỏi để lưu" });
  
        const exam = await Test.create({
          title: title || "Untitled Exam",
          questions,
          // 👇 để nguyên skill FE gửi, không default "mixed"
          skill: skill || undefined,
          level,
          grade,
          duration,
          createdBy: req.user._id,
        });
  
        res.status(201).json({ message: "Đã lưu đề thi thành công", exam });
      } catch (err) {
        console.error("Lỗi lưu đề thi:", err);
        res.status(500).json({ message: "Lỗi lưu đề thi" });
      }
    }
  );

export default router;
