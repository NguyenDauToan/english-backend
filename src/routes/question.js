import express from "express";
import Question from "../models/question.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import XLSX from "xlsx";
import multer from "multer";
import Test from "../models/test.js";
import fs from "fs";
import path from "path";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const EXAM_GRADES = ["thptqg", "ielts", "toeic", "vstep"];

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/audio";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Đổi tên tránh trùng
    const ext = path.extname(file.originalname); // .mp3, .wav
    const base = path.basename(file.originalname, ext);
    const safeBase = base.replace(/\s+/g, "_");
    cb(null, `${safeBase}-${Date.now()}${ext}`);
  },
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // max 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Chỉ chấp nhận file audio mp3 / wav"));
    }
    cb(null, true);
  },
});

// ============================
// POST /api/questions/upload-audio
// Upload file audio cho câu listening -> trả về audioUrl
// ============================
router.post(
  "/upload-audio",
  verifyToken,
  verifyRole(["teacher", "admin","school_manager"]),
  audioUpload.single("audio"),
  (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "Vui lòng chọn file audio (mp3 / wav)" });
      }

      // app.use("/uploads", express.static("uploads")) ở server chính
      const audioUrl = `/uploads/audio/${req.file.filename}`;

      res.status(201).json({
        message: "Upload audio thành công",
        audioUrl,
        fileName: req.file.originalname,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server khi upload audio" });
    }
  }
);
// ========== BULK (giữ nguyên) ==========
router.post(
  "/bulk",
  verifyToken,
  verifyRole(["teacher", "admin","school_manager"]),
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
  verifyRole(["teacher", "admin","school_manager"]),
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
        subQuestions,
        audioUrl,
      } = req.body;

      if (!content || !type || !skill || !grade) {
        return res.status(400).json({ message: "Thiếu dữ liệu bắt buộc" });
      }

      // các type thường (có thể tự chấm)
      const SIMPLE_TYPES_REQUIRE_ANSWER = [
        "multiple_choice",
        "fill_blank",
        "true_false",
        "writing_sentence_order",
        "writing_add_words",
      ];

      // ----- XỬ LÝ RIÊNG SPEAKING Luyện Đọc -----
      // Nếu skill = speaking => ép type = "speaking" và
      // nếu không gửi answer thì dùng luôn content làm đáp án chuẩn (đoạn văn HS phải đọc)
      let finalType = type;
      let finalAnswer = answer;

      if (skill === "speaking") {
        finalType = "speaking";
        if (!finalAnswer) {
          finalAnswer = content; // đoạn văn chuẩn để AI dùng làm mẫu so sánh
        }
      }

      if (SIMPLE_TYPES_REQUIRE_ANSWER.includes(finalType) && !finalAnswer) {
        return res
          .status(400)
          .json({ message: "Câu hỏi dạng thường phải có đáp án answer" });
      }

      // 🔹 type đặc biệt: reading_cloze (xài chung cho Reading & Listening)
      if (finalType === "reading_cloze") {
        // Reading cloze vẫn chỉ cho các kỳ thi lớn
        if (skill === "reading" && !EXAM_GRADES.includes(grade)) {
          return res.status(400).json({
            message:
              "Reading cloze chỉ áp dụng cho các kỳ thi: thptqg / ielts / toeic / vstep",
          });
        }

        // Listening cloze: cho phép mọi grade, nhưng phải có audio
        if (skill === "listening" && !audioUrl) {
          return res
            .status(400)
            .json({ message: "Listening cloze phải có audioUrl" });
        }

        if (!Array.isArray(subQuestions) || subQuestions.length === 0) {
          return res.status(400).json({
            message:
              "Reading/Listening cloze phải có ít nhất 1 câu con (subQuestions)",
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
        content,             // với speaking: nội dung hiển thị (có thể là chính đoạn văn hoặc 1 prompt + đoạn văn)
        type: finalType,
        skill,
        level,
        grade,
        explanation,
        tags,
        createdBy: req.user._id,

        // chỉ câu đơn mới có options/answer
        options: finalType === "reading_cloze" ? undefined : options,
        answer: finalType === "reading_cloze" ? undefined : finalAnswer,

        // group question
        subQuestions: finalType === "reading_cloze" ? subQuestions : undefined,
        audioUrl: finalType === "reading_cloze" ? audioUrl : undefined,
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
  verifyRole(["teacher", "admin","school_manager"]),
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
  verifyRole(["teacher", "admin","school_manager"]),
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
  verifyRole(["teacher", "admin","school_manager"]),
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

// ========== IMPORT EXCEL (chỉ Reading / Writing / Speaking) ==========
router.post(
  "/import",
  verifyToken,
  verifyRole(["teacher", "admin","school_manager"]),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "Vui lòng tải lên file Excel" });
      }

      const {
        skill: overrideSkill,
        level: overrideLevel,
        grade: overrideGrade,
      } = req.body;

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      if (!rows.length) {
        return res
          .status(400)
          .json({ message: "File Excel không có dữ liệu" });
      }

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

      const ALLOWED_SKILLS = ["reading", "writing", "speaking"];

      const questions = rows.map((row, idx) => {
        const index = idx + 1;

        const rawSkill = (overrideSkill || row.Skill || row.skill || "")
          .toString()
          .trim()
          .toLowerCase();

        if (!rawSkill) {
          throw new Error(`Dòng ${index}: thiếu Skill`);
        }
        if (!ALLOWED_SKILLS.includes(rawSkill)) {
          throw new Error(
            `Dòng ${index}: Skill không hợp lệ hoặc không được phép import: ${rawSkill}`
          );
        }
        if (rawSkill === "listening") {
          // chỉ để chắc chắn, dù ALLOWED_SKILLS đã loại
          throw new Error(
            `Dòng ${index}: Listening cần audio, vui lòng tạo thủ công ở form Thêm câu hỏi`
          );
        }

        const rawGrade = overrideGrade || row.Grade || row.grade;
        const grade = rawGrade ? String(rawGrade).trim().toLowerCase() : "";
        if (!grade) {
          throw new Error(`Dòng ${index}: thiếu Grade`);
        }
        if (!validGrades.includes(grade)) {
          throw new Error(`Dòng ${index}: Grade không hợp lệ: ${grade}`);
        }

        const rawLevel = overrideLevel || row.Level || row.level || "easy";
        const level = String(rawLevel).trim().toLowerCase();

        const content = (row.Content || row.content || "").toString().trim();
        if (!content) {
          throw new Error(`Dòng ${index}: thiếu Content`);
        }

        const rawType = (row.Type || row.type || "").toString().trim();

        // mapping type theo skill
        let type = rawType || "multiple_choice";

        const READING_TYPES = [
          "multiple_choice",
          "fill_blank",
          "true_false",
        ];
        const WRITING_TYPES = [
          "writing_sentence_order",
          "writing_add_words",
          "writing_paragraph",
        ];
        const SPEAKING_TYPES = ["speaking"];

        if (rawSkill === "reading") {
          if (!READING_TYPES.includes(type)) {
            // nếu người dùng gõ bừa, fallback multiple_choice
            type = "multiple_choice";
          }
        } else if (rawSkill === "writing") {
          if (!WRITING_TYPES.includes(type)) {
            throw new Error(
              `Dòng ${index}: Type không hợp lệ cho Writing. Hỗ trợ: ${WRITING_TYPES.join(
                ", "
              )}`
            );
          }
        } else if (rawSkill === "speaking") {
          // luôn ép về speaking
          type = "speaking";
        }

        const optionsStr = row.Options || row.options || "";
        const options =
          optionsStr && typeof optionsStr === "string"
            ? optionsStr.split("|").map((s) => s.trim())
            : [];

        const answerRaw = row.Answer || row.answer || "";
        let answer = answerRaw
          ? answerRaw.toString().trim()
          : undefined;

        const explanation = row.Explanation || row.explanation || "";
        const tagsStr = row.Tags || row.tags || "";
        const tags =
          tagsStr && typeof tagsStr === "string"
            ? tagsStr.split("|").map((s) => s.trim())
            : [];

        // ===== VALIDATE / CHUẨN HÓA THEO TYPE =====

        if (rawSkill === "reading") {
          if (type === "multiple_choice") {
            if (!options.length) {
              throw new Error(
                `Dòng ${index}: Reading multiple_choice phải có Options (A|B|C|D)`
              );
            }
            if (!answer) {
              throw new Error(
                `Dòng ${index}: Reading multiple_choice phải có Answer`
              );
            }
          } else if (type === "fill_blank") {
            if (!answer) {
              throw new Error(
                `Dòng ${index}: Reading fill_blank phải có Answer`
              );
            }
          } else if (type === "true_false") {
            if (!answer) {
              throw new Error(
                `Dòng ${index}: Reading true_false phải có Answer (true/false)`
              );
            }
            const ansLower = answer.toLowerCase();
            if (["t", "true", "đ", "đúng"].includes(ansLower)) {
              answer = "true";
            } else if (["f", "false", "sai"].includes(ansLower)) {
              answer = "false";
            } else {
              throw new Error(
                `Dòng ${index}: Answer cho true_false phải là true/false`
              );
            }
          }
        }

        if (rawSkill === "writing") {
          if (type === "writing_paragraph") {
            // không bắt buộc Answer
            answer = undefined;
          } else {
            if (!answer) {
              throw new Error(
                `Dòng ${index}: Writing (${type}) phải có Answer (đáp án chuẩn)`
              );
            }
          }
        }

        if (rawSkill === "speaking") {
          // giống route POST: nếu không có answer -> dùng content
          if (!answer) {
            answer = content;
          }
        }

        return {
          content,
          type,
          options:
            type === "multiple_choice" ? options : undefined,
          answer,
          skill: rawSkill,
          level,
          grade,
          explanation,
          tags,
          createdBy: req.user._id,
        };
      });

      const inserted = await Question.insertMany(questions);
      res.status(201).json({
        message: `Đã thêm ${inserted.length} câu hỏi`,
        insertedCount: inserted.length,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ========== EXPORT FILE MẪU IMPORT ==========
router.get(
  "/import/template",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const skill = (req.query.skill || "").toString().toLowerCase();
      const type = (req.query.type || "").toString().toLowerCase();
      console.log("TEMPLATE_QUERY:", req.query, "skill=", skill, "type=", type);
      const header = [
        "Skill",
        "Type",
        "Grade",
        "Level",
        "Content",
        "Options",
        "Answer",
        "Explanation",
        "Tags",
      ];

      const rows = [];

      // === Reading ===
      if (skill === "reading" || !skill) {
        if (!type || type === "multiple_choice") {
          rows.push({
            Skill: "reading",
            Type: "multiple_choice",
            Grade: "9",
            Level: "easy",
            Content: "What is the capital of France?",
            Options: "Paris|London|Berlin|Tokyo",
            Answer: "Paris",
            Explanation: "Paris is the capital city of France.",
            Tags: "reading,basic",
          });
        }

        if (!type || type === "true_false") {
          rows.push({
            Skill: "reading",
            Type: "true_false",
            Grade: "9",
            Level: "easy",
            Content: "The sun rises in the west.",
            Options: "",
            Answer: "false",
            Explanation: "The sun rises in the east.",
            Tags: "reading,true_false",
          });
        }

        if (!type || type === "fill_blank") {
          rows.push({
            Skill: "reading",
            Type: "fill_blank",
            Grade: "9",
            Level: "easy",
            Content: "I usually go to school ____ bus.",
            Options: "",
            Answer: "by",
            Explanation: "",
            Tags: "reading,fill_blank",
          });
        }
      }

      // === Writing ===
      if (skill === "writing" || !skill) {
        if (!type || type === "writing_sentence_order") {
          rows.push({
            Skill: "writing",
            Type: "writing_sentence_order",
            Grade: "10",
            Level: "medium",
            Content:
              "Sắp xếp các từ sau thành câu hoàn chỉnh: / like / I / playing / football",
            Options: "",
            Answer: "I like playing football.",
            Explanation: "",
            Tags: "writing,sentence_order",
          });
        }

        if (!type || type === "writing_add_words") {
          rows.push({
            Skill: "writing",
            Type: "writing_add_words",
            Grade: "10",
            Level: "medium",
            Content:
              "Hoàn thành câu bằng cách thêm từ còn thiếu: I ___ going to the park on Sunday.",
            Options: "",
            Answer: "am",
            Explanation: "",
            Tags: "writing,add_words",
          });
        }

        if (!type || type === "writing_paragraph") {
          rows.push({
            Skill: "writing",
            Type: "writing_paragraph",
            Grade: "10",
            Level: "medium",
            Content:
              "Write a short paragraph (50–70 words) about your favorite hobby.",
            Options: "",
            Answer: "",
            Explanation: "",
            Tags: "writing,paragraph",
          });
        }
      }

      // === Speaking ===
      if (skill === "speaking" || !skill) {
        if (!type || type === "speaking") {
          rows.push({
            Skill: "speaking",
            Type: "speaking",
            Grade: "9",
            Level: "easy",
            Content:
              "My favorite hobby is reading books. I read every evening before I go to bed.",
            Options: "",
            Answer: "",
            Explanation:
              "Đoạn văn chuẩn, học sinh sẽ đọc lại. Nếu bỏ trống Answer, hệ thống sẽ dùng Content làm đáp án chuẩn.",
            Tags: "speaking,reading_aloud",
          });
        }
      }

      if (!rows.length) {
        return res
          .status(400)
          .json({ message: "Skill/type không hợp lệ để tạo file mẫu" });
      }

      const worksheet = XLSX.utils.json_to_sheet(rows, { header });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "QuestionsTemplate");

      const buffer = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "buffer",
      });

      // Đặt tên file theo skill + type
      let filename = "questions_template.xlsx";
      if (skill) {
        filename = `questions_template_${skill}${
          type ? "_" + type : ""
        }.xlsx`;
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      console.log("TEMPLATE_ROWS:", rows.length);
      return res.send(buffer);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Lỗi server khi tạo file mẫu import" });
    }
  }
);

export default router;
