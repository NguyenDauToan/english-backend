import express from "express";
import Test from "../models/test.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import Question from "../models/question.js";

const router = express.Router();

// --- Tạo bài thi thủ công (teacher/admin) ---
router.post("/", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { title, description, duration, level, grade, questions } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0)
      return res.status(400).json({ message: "Cần cung cấp danh sách câu hỏi" });

    if (!duration || typeof duration !== "number" || duration <= 0)
      return res.status(400).json({ message: "Cần cung cấp thời gian làm bài hợp lệ (phút)" });

    const exam = await Test.create({
      title,
      description,
      duration,
      level: level || "N/A",
      grade: grade || "N/A",
      questions,
      createdBy: req.user._id,
    });

    const populatedExam = await exam.populate({
      path: "questions",
      select: "content type options answer skill grade level",
    });

    res.status(201).json(populatedExam);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Lấy tất cả bài thi ---
router.get("/", verifyToken, async (req, res) => {
  try {
    const exams = await Test.find().populate({
      path: "questions",
      select: "content type options skill grade level",
    });
    res.json(exams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Lấy 1 bài thi theo id ---
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const exam = await Test.findById(req.params.id).populate({
      path: "questions",
      select: "content type options skill grade level",
    });
    
    if (!exam) return res.status(404).json({ message: "Bài thi không tồn tại" });
    res.json(exam);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Cập nhật bài thi ---
router.put("/:id", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const exam = await Test.findByIdAndUpdate(req.params.id, { ...req.body }, { new: true });
    if (!exam) return res.status(404).json({ message: "Bài thi không tồn tại" });

    const populatedExam = await exam.populate({
      path: "questions",
      select: "content type options answer skill grade level",
    });

    res.json(populatedExam);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Xóa bài thi ---
router.delete("/:id", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const exam = await Test.findByIdAndDelete(req.params.id);
    if (!exam) return res.status(404).json({ message: "Bài thi không tồn tại" });
    res.json({ message: "Xóa bài thi thành công" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Tạo bài thi tự động dựa trên rule ---
router.post("/generate", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { title, description, duration, rules, level, grade } = req.body;

    if (!rules || !Array.isArray(rules) || rules.length === 0)
      return res.status(400).json({ message: "Cần cung cấp quy tắc chọn câu hỏi" });

    if (!duration || typeof duration !== "number" || duration <= 0)
      return res.status(400).json({ message: "Cần cung cấp thời gian làm bài hợp lệ (phút)" });

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
      questions: selectedQuestions.map(q => q._id),
      createdBy: req.user._id,
    });

    const populatedExam = await exam.populate({
      path: "questions",
      select: "content type options answer skill grade level",
    });

    res.status(201).json(populatedExam);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
