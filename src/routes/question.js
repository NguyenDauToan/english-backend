import express from "express";
import Question from "../models/question.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import XLSX from "xlsx";
import multer from "multer";
import Test from "../models/test.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const EXAM_GRADES = ["thptqg", "ielts", "toeic", "vstep"];

// ========== BULK (giữ nguyên) ==========
router.post(
  "/bulk",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const questions = req.body.map((q) => ({ ...q, createdBy: req.user._id }));
      const inserted = await Question.insertMany(questions);
      res
        .status(201)
        .json({ message: `Đã lưu ${inserted.length} câu hỏi`, questions: inserted });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi khi lưu câu hỏi" });
    }
  }
);

// ========== TẠO CÂU HỎI ==========
router.post(
  "/",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const {
        content,
        type,
        options,
        answer,
        skill,
        level,
        grade,
        explanation,
        tags,
        subQuestions, // thêm cho reading_cloze
      } = req.body;

      if (!content || !type || !skill || !grade) {
        return res.status(400).json({ message: "Thiếu dữ liệu bắt buộc" });
      }

      // các type bình thường: bắt buộc có answer
      if (
        ["multiple_choice", "fill_blank", "true_false"].includes(type) &&
        !answer
      ) {
        return res
          .status(400)
          .json({ message: "Câu hỏi dạng thường phải có đáp án answer" });
      }

      // type đặc biệt: reading_cloze – chỉ dùng cho thptqg / ielts / toeic / vstep
      if (type === "reading_cloze") {
        if (!EXAM_GRADES.includes(grade)) {
          return res.status(400).json({
            message:
              "reading_cloze chỉ áp dụng cho các kỳ thi: thptqg / ielts / toeic / vstep",
          });
        }

        if (!Array.isArray(subQuestions) || subQuestions.length === 0) {
          return res.status(400).json({
            message: "Reading cloze phải có ít nhất 1 câu con (subQuestions)",
          });
        }

        for (let i = 0; i < subQuestions.length; i++) {
          const sq = subQuestions[i];
          if (
            !sq ||
            !Array.isArray(sq.options) ||
            sq.options.length < 2 ||
            typeof sq.correctIndex !== "number" ||
            sq.correctIndex < 0 ||
            sq.correctIndex >= sq.options.length
          ) {
            return res.status(400).json({
              message: `Sub-question thứ ${i + 1} không hợp lệ`,
            });
          }
        }
      }

      const question = await Question.create({
        content,
        type,
        skill,
        level,
        grade,
        explanation,
        tags,
        createdBy: req.user._id,

        // chỉ set options/answer cho type thường
        options: type === "reading_cloze" ? undefined : options,
        answer: type === "reading_cloze" ? undefined : answer,

        // chỉ set subQuestions cho reading_cloze
        subQuestions: type === "reading_cloze" ? subQuestions : undefined,
      });

      res.status(201).json(question);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ========== GET /, /filter, /random, PUT, DELETE giữ nguyên ==========

router.get("/", verifyToken, async (req, res) => {
  try {
    const { skill, level, grade, all } = req.query;
    const query = {};
    if (skill) query.skill = skill;
    if (level) query.level = level;
    if (grade) query.grade = grade;

    let questionsQuery = Question.find(query)
      .populate("createdBy", "name email")
      .sort({ createdAt: 1 });

    if (!all) {
      questionsQuery = questionsQuery.limit(10);
    }

    const questions = await questionsQuery;
    const total = await Question.countDocuments(query);

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

router.get("/filter", verifyToken, async (req, res) => {
  try {
    const { skill, level, grade } = req.query;
    const query = {};
    if (skill) query.skill = skill;
    if (level) query.level = level;
    if (grade) query.grade = grade;

    const questions = await Question.find(query).populate(
      "createdBy",
      "name email"
    );
    res.json(questions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

router.get("/random", verifyToken, async (req, res) => {
  try {
    const { skill, level, grade } = req.query;
    const match = {};
    if (skill) match.skill = skill;
    if (level) match.level = level;
    if (grade) match.grade = grade;

    const questions = await Question.find(match).populate(
      "createdBy",
      "name email"
    );
    res.json(questions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

router.delete(
  "/",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      // chỉ xóa các câu hỏi không nằm trong đề thi nào
      const usedIds = await Test.distinct("questions");
      const result = await Question.deleteMany({ _id: { $nin: usedIds } });

      res.json({
        message: `Đã xóa ${result.deletedCount} câu hỏi không nằm trong đề thi nào`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);


router.put(
  "/:id",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const question = await Question.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      );
      if (!question)
        return res.status(404).json({ message: "Câu hỏi không tồn tại" });
      res.json(question);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);

router.delete(
  "/:id",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      // 1. Kiểm tra xem câu hỏi đang nằm trong đề thi nào không
      const existedTest = await Test.findOne({ questions: id }).select("title _id");
      if (existedTest) {
        return res.status(400).json({
          message: `Không thể xóa. Câu hỏi đang được dùng trong đề thi "${existedTest.title}". Hãy xóa hoặc chỉnh sửa đề thi trước.`,
          testId: existedTest._id,
        });
      }

      // 2. Nếu không nằm trong đề nào thì cho phép xóa
      const question = await Question.findByIdAndDelete(id);
      if (!question)
        return res.status(404).json({ message: "Câu hỏi không tồn tại" });

      res.json({ message: "Xóa câu hỏi thành công" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);


// ========== IMPORT EXCEL (chỉ chỉnh validGrades) ==========
router.post(
  "/import",
  verifyToken,
  verifyRole(["teacher", "admin"]),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ message: "Vui lòng tải lên file Excel" });

      const {
        skill: overrideSkill,
        level: overrideLevel,
        grade: overrideGrade,
      } = req.body;

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      const validGrades = [
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "thptqg",
        "ielts",
        "toeic",
        "vstep",
      ];

      const questions = data.map((q, idx) => {
        const skill = overrideSkill || q.Skill;
        const grade = overrideGrade || String(q.Grade);
        const level = overrideLevel || q.Level || "easy";

        if (!skill) throw new Error(`Câu hỏi thứ ${idx + 1} thiếu skill`);
        if (!grade) throw new Error(`Câu hỏi thứ ${idx + 1} thiếu grade`);
        if (!validGrades.includes(grade))
          throw new Error(
            `Câu hỏi thứ ${idx + 1} grade không hợp lệ: ${grade}`
          );

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
      res
        .status(201)
        .json({ message: `Đã thêm ${inserted.length} câu hỏi`, inserted });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;
