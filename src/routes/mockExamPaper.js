// routes/mockExamPaper.js
import express from "express";
import MockExam from "../models/mockExam.js";
import MockExamPaper from "../models/mockExamPaper.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import { mockExamUpload } from "../config/mockExamUpload.js";
import xlsx from "xlsx";

const router = express.Router();

// helper parse đáp án "A B C D ..." / "A,B,C,D" (đang dùng cho text)
function parseAnswerKey(answerKeyString) {
  if (!answerKeyString) return [];
  const tokens = answerKeyString
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  return tokens.map((opt, index) => ({
    questionNumber: index + 1,
    correctOption: opt,
  }));
}

/**
 * Helper: đọc Excel -> answerKey [{questionNumber, correctOption}]
 * Hỗ trợ:
 *  - Có header: "questionNumber", "correctOption", "Câu", "Đáp án", ...
 *  - Không header: coi cột 1 = số câu, cột 2 = đáp án
 */
function parseExcelAnswerKey(filePath) {
  const wb = xlsx.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // rows dạng 2D: [ [header...], [row1...], ... ]
  const rows = xlsx.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
  });

  if (!rows || rows.length === 0) {
    throw new Error("File Excel không có dữ liệu");
  }

  const headerRow = rows[0].map((h) => String(h).trim().toLowerCase());
  const dataRows = rows.slice(1);

  // các khả năng tên cột số câu / đáp án
  const questionHeaderCandidates = [
    "questionnumber",
    "question_no",
    "question",
    "câu",
    "so cau",
    "số câu",
    "q",
    "stt",
  ];
  const answerHeaderCandidates = [
    "correctoption",
    "answer",
    "dap an",
    "đáp án",
    "ans",
  ];

  const findColumnIndex = (candidates) => {
    for (const name of candidates) {
      const idx = headerRow.findIndex((h) => h === name);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  let qCol = findColumnIndex(questionHeaderCandidates);
  let aCol = findColumnIndex(answerHeaderCandidates);

  // nếu không tìm được theo header → fallback: cột 0 = số câu, cột 1 = đáp án
  if (qCol === -1 || aCol === -1) {
    qCol = 0;
    aCol = 1;
  }

  const answerKey = [];

  for (const row of dataRows) {
    const qRaw = row[qCol];
    const aRaw = row[aCol];

    if (qRaw === undefined || qRaw === null || aRaw === undefined || aRaw === null) {
      continue;
    }

    const questionNumber = Number(qRaw);
    if (!Number.isFinite(questionNumber)) continue;

    let opt = String(aRaw).trim().toUpperCase();

    // xử lý dạng "A.", "A )", "Đáp án: A" → lấy chữ cái A/B/C/D đầu tiên
    const m = opt.match(/[ABCD]/i);
    if (!m) continue;
    opt = m[0].toUpperCase();

    if (!["A", "B", "C", "D"].includes(opt)) continue;

    answerKey.push({ questionNumber, correctOption: opt });
  }

  if (!answerKey.length) {
    throw new Error(
      "Không tìm thấy dữ liệu đáp án hợp lệ trong Excel. " +
        "Hãy đảm bảo cột 1 là số câu, cột 2 là đáp án A/B/C/D."
    );
  }

  // sort + loại trùng
  answerKey.sort((a, b) => a.questionNumber - b.questionNumber);
  const dedupMap = new Map();
  for (const item of answerKey) {
    if (!dedupMap.has(item.questionNumber)) {
      dedupMap.set(item.questionNumber, item.correctOption);
    }
  }

  return Array.from(dedupMap.entries()).map(([questionNumber, correctOption]) => ({
    questionNumber: Number(questionNumber),
    correctOption,
  }));
}

// =======================
// 1) Upload đề + đáp án từ file Excel
// =======================
// POST /api/mock-exam-papers/upload-excel
router.post(
  "/upload-excel",
  verifyToken,
  verifyRole("admin"),
  mockExamUpload.single("file"), // file .xlsx
  async (req, res) => {
    try {
      const {
        mockExamId,
        year,
        officialName,
        attempt,
        totalQuestions, // optional
        fileType, // optional
      } = req.body;

      if (!req.file) {
        return res.status(400).json({ message: "File Excel là bắt buộc" });
      }
      if (!mockExamId || !year || !officialName) {
        return res.status(400).json({
          message: "mockExamId, year, officialName là bắt buộc",
        });
      }

      const mockExam = await MockExam.findById(mockExamId);
      if (!mockExam) {
        return res.status(404).json({ message: "Không tìm thấy kỳ thi thử" });
      }

      // Đọc đáp án từ Excel (dùng helper mới)
      let finalAnswerKey;
      try {
        finalAnswerKey = parseExcelAnswerKey(req.file.path);
      } catch (e) {
        console.error("Lỗi parse Excel:", e);
        return res.status(400).json({ message: e.message });
      }

      const relativePath = `/uploads/mock-exams/${req.file.filename}`;

      const paper = await MockExamPaper.create({
        mockExam: mockExam._id,
        year: Number(year),
        officialName,
        attempt: attempt ? Number(attempt) : 1,
        filePath: relativePath,
        fileType: fileType || "excel",
        totalQuestions: totalQuestions
          ? Number(totalQuestions)
          : finalAnswerKey.length,
        answerKey: finalAnswerKey,
      });

      res.status(201).json({
        message: "Upload Excel đáp án thành công",
        paper,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server khi upload Excel" });
    }
  }
);

// =======================
// 2) Upload PDF/DOCX (giữ nguyên logic cũ)
// =======================
router.post(
  "/upload",
  verifyToken,
  verifyRole("admin"),
  mockExamUpload.single("file"), // file pdf/docx
  async (req, res) => {
    try {
      const {
        mockExamId,
        year,
        officialName,
        attempt,
        totalQuestions,
        answerKeyString,
        fileType,
      } = req.body;

      if (!req.file) {
        return res.status(400).json({ message: "File đề thi là bắt buộc" });
      }
      if (!mockExamId || !year || !officialName) {
        return res.status(400).json({
          message: "mockExamId, year, officialName là bắt buộc",
        });
      }

      const mockExam = await MockExam.findById(mockExamId);
      if (!mockExam) {
        return res.status(404).json({ message: "Không tìm thấy kỳ thi thử" });
      }

      const relativePath = `/uploads/mock-exams/${req.file.filename}`;
      const parsedAnswerKey = parseAnswerKey(answerKeyString);

      const paper = await MockExamPaper.create({
        mockExam: mockExam._id,
        year: Number(year),
        officialName,
        attempt: attempt ? Number(attempt) : 1,
        filePath: relativePath,
        fileType: fileType || "pdf",
        totalQuestions: totalQuestions
          ? Number(totalQuestions)
          : parsedAnswerKey.length,
        answerKey: parsedAnswerKey,
      });

      res.status(201).json({
        message: "Upload đề + đáp án thành công",
        paper,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server khi upload đề thi" });
    }
  }
);

// =======================
// 3) Chấm bài (submit) – giữ nguyên
// =======================
router.post(
  "/:id/submit",
  verifyToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { answers } = req.body; // [{questionNumber, selectedOption}]

      const paper = await MockExamPaper.findById(id);
      if (!paper) {
        return res.status(404).json({ message: "Không tìm thấy đề thi" });
      }

      const answerMap = new Map();
      paper.answerKey.forEach((a) =>
        answerMap.set(a.questionNumber, a.correctOption)
      );

      let correct = 0;
      const total = paper.totalQuestions || paper.answerKey.length;

      const detail = answers.map((ans) => {
        const correctOpt = answerMap.get(ans.questionNumber);
        const isCorrect = correctOpt === ans.selectedOption;
        if (isCorrect) correct += 1;
        return {
          questionNumber: ans.questionNumber,
          selectedOption: ans.selectedOption,
          correctOption: correctOpt,
          isCorrect,
        };
      });

      const scorePercent = total > 0 ? (correct / total) * 100 : 0;

      res.json({
        correct,
        total,
        scorePercent,
        detail,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi chấm điểm" });
    }
  }
);

export default router;
