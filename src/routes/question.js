import express from "express";
import Question from "../models/question.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import XLSX from "xlsx";
import multer from "multer";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// 🌟 Tạo câu hỏi (chỉ teacher/admin)
router.post("/", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { content, type, options, answer, skill, level, grade, explanation, tags } = req.body;

    if (!content || !type || !answer || !skill || !grade) {
      return res.status(400).json({ message: "Thiếu dữ liệu bắt buộc" });
    }

    const question = await Question.create({
      content,
      type,
      options,
      answer,
      skill,
      level,
      grade,
      explanation,
      tags,
      createdBy: req.user._id,
    });

    res.status(201).json(question);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

router.get("/", verifyToken, async (req, res) => {
  try {
    const { skill, level, grade, all } = req.query;
    const query = {};
    if (skill) query.skill = skill;
    if (level) query.level = level;
    if (grade) query.grade = grade;

    // Sắp xếp theo createdAt tăng dần (cũ → mới)
    let questionsQuery = Question.find(query)
      .populate("createdBy", "name email")
      .sort({ createdAt: 1 });

    if (!all) {
      questionsQuery = questionsQuery.limit(10); // mặc định 10 câu
    }

    const questions = await questionsQuery;
    const total = await Question.countDocuments(query);

    // Thêm 'order' dựa trên thứ tự câu hỏi
    const questionsWithOrder = questions.map((q, index) => ({
      ...q.toObject(),
      order: index + 1,
    }));

    res.json({
      total,
      questions: questionsWithOrder,
      limit: all ? total : 10,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// 🌟 Lấy câu hỏi theo skill, level, grade (không giới hạn)
router.get("/filter", verifyToken, async (req, res) => {
  try {
    const { skill, level, grade } = req.query;
    const query = {};

    if (skill) query.skill = skill;
    if (level) query.level = level;
    if (grade) query.grade = grade;

    const questions = await Question.find(query).populate("createdBy", "name email");
    res.json(questions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// 🌟 Lấy tất cả câu hỏi theo skill/level/grade (bỏ ngẫu nhiên)
router.get("/random", verifyToken, async (req, res) => {
  try {
    const { skill, level, grade } = req.query;
    const match = {};

    if (skill) match.skill = skill;
    if (level) match.level = level;
    if (grade) match.grade = grade;

    const questions = await Question.find(match).populate("createdBy", "name email");
    res.json(questions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
// 🌟 Xóa tất cả câu hỏi (chỉ teacher/admin)
router.delete(
  "/",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const result = await Question.deleteMany({});
      res.json({ message: `Đã xóa ${result.deletedCount} câu hỏi` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);
// 🌟 Cập nhật câu hỏi (chỉ teacher/admin)
router.put("/:id", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!question) return res.status(404).json({ message: "Câu hỏi không tồn tại" });
    res.json(question);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// 🌟 Xóa câu hỏi (chỉ teacher/admin)
router.delete("/:id", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) return res.status(404).json({ message: "Câu hỏi không tồn tại" });
    res.json({ message: "Xóa câu hỏi thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
// 🌟 Import câu hỏi từ Excel
router.post(
  "/import",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "Vui lòng tải lên file Excel" });

      const { skill: overrideSkill, level: overrideLevel, grade: overrideGrade } = req.body;

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      const validGrades = ["6","7","8","9","10","11","12"];

      const questions = data.map((q, idx) => {
        const skill = overrideSkill || q.Skill;
        const grade = overrideGrade || String(q.Grade);
        const level = overrideLevel || q.Level || "easy";

        if (!skill) throw new Error(`Câu hỏi thứ ${idx+1} thiếu skill`);
        if (!grade) throw new Error(`Câu hỏi thứ ${idx+1} thiếu grade`);
        if (!validGrades.includes(grade)) throw new Error(`Câu hỏi thứ ${idx+1} grade không hợp lệ: ${grade}`);

        return {
          content: q.Content,
          type: q.Type || "multiple_choice",
          options: q.Options ? q.Options.split("|") : [],
          answer: q.Answer,
          skill,
          level,
          grade,
          explanation: q.Explanation,
          tags: q.Tags ? q.Tags.split("|") : [],
          createdBy: req.user._id,
        };
      });

      const inserted = await Question.insertMany(questions);
      res.status(201).json({ message: `Đã thêm ${inserted.length} câu hỏi`, inserted });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);


export default router;
