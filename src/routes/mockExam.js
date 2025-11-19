// routes/mockExam.js
import express from "express";
import mongoose from "mongoose";
import MockExam from "../models/mockExam.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * GET /api/mock-exams
 */
router.get("/", async (req, res) => {
  try {
    const { examType, active } = req.query;

    const filter = {};
    if (examType) filter.examType = examType;
    if (active === "true") filter.isActive = true;

    const exams = await MockExam.find(filter)
      .sort({ createdAt: -1 })
      .select(
        "name examType description duration level tags slug grade year officialName totalQuestions isActive"
      )
      .lean();

    res.json({ exams });
  } catch (err) {
    console.error("GET /mock-exams error:", err);
    res
      .status(500)
      .json({ message: "Lỗi server khi lấy danh sách đề thi thử" });
  }
});

/**
 * GET /api/mock-exams/:idOrSlug
 * Trả ra đầy đủ questions (có subQuestions) để FE normalizeQuestions()
 */
router.get("/:idOrSlug", async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    let exam = null;

    // Nếu là ObjectId hợp lệ → ưu tiên tìm theo _id
    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      exam = await MockExam.findById(idOrSlug)
        .populate({
          path: "questions",
          // QUAN TRỌNG: thêm subQuestions để reading_cloze có đáp án
          select:
            "content type options answer skill grade level subQuestions",
        })
        .lean();
    }

    // Nếu không tìm thấy theo _id hoặc không phải ObjectId → thử theo slug
    if (!exam) {
      exam = await MockExam.findOne({ slug: idOrSlug })
        .populate({
          path: "questions",
          select:
            "content type options answer skill grade level subQuestions",
        })
        .lean();
    }

    if (!exam) {
      return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
    }

    // Đảm bảo luôn có mảng questions
    const examWithQuestions = {
      ...exam,
      questions: exam.questions || [],
    };

    // FE đang dùng: const raw = res.data.exam || res.data;
    res.json({ exam: examWithQuestions });
  } catch (err) {
    console.error("GET /mock-exams/:idOrSlug error:", err);
    res
      .status(500)
      .json({ message: "Lỗi server khi lấy chi tiết đề thi thử" });
  }
});

/* =========================================================
 *  POST /api/mock-exams
 *  Tạo đề thi thử mới: CHỈ NHẬN MẢNG ID CÂU HỎI (ObjectId)
 * ======================================================= */
router.post(
  "/",
  verifyToken,
  verifyRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      let {
        name,
        examType,
        description,
        duration,
        level,
        grade,
        skill,
        year,
        officialName,
        questions,
        tags,
        startTime,
        endTime,
        slug,
      } = req.body;

      if (!name || !examType || !duration) {
        return res.status(400).json({
          message: "Thiếu name / examType / duration",
        });
      }

      // --- Chuẩn hóa field questions về mảng id ---
      let questionIdsRaw = questions;

      // nếu FE gửi string JSON: "[\"id1\",\"id2\"]"
      if (typeof questionIdsRaw === "string") {
        try {
          questionIdsRaw = JSON.parse(questionIdsRaw);
        } catch (e) {
          return res.status(400).json({
            message:
              "Field 'questions' đang là string, không parse được JSON. Hãy gửi mảng ID câu hỏi.",
          });
        }
      }

      if (!Array.isArray(questionIdsRaw) || questionIdsRaw.length === 0) {
        return res
          .status(400)
          .json({ message: "Đề thi phải có ít nhất 1 câu hỏi" });
      }

      // hỗ trợ cả dạng ["id1","id2"] hoặc [{ _id: "id1" }, ...]
      const questionIds = questionIdsRaw.map((q) =>
        typeof q === "string" ? q : q?._id
      );

      // validate ObjectId
      const invalidIds = questionIds.filter(
        (id) => !mongoose.Types.ObjectId.isValid(id)
      );
      if (invalidIds.length) {
        return res.status(400).json({
          message: "Một số ID câu hỏi không hợp lệ",
          invalidIds,
        });
      }

      // Nếu không gửi slug thì tự sinh từ name
      let finalSlug = slug;
      if (!finalSlug) {
        finalSlug =
          name
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "") + "-" + Date.now().toString(36);
      }

      const exam = await MockExam.create({
        name,
        examType,
        description,
        duration,
        level: level || "mixed",
        grade,
        skill: skill || "mixed",
        year,
        officialName,
        tags,
        startTime,
        endTime,
        slug: finalSlug,
        questions: questionIds, // mảng ObjectId
        totalQuestions: questionIds.length,
        createdBy: req.user._id,
      });

      res.status(201).json({ exam });
    } catch (err) {
      console.error("POST /mock-exams error:", err);
      if (err.code === 11000 && err.keyPattern?.slug) {
        return res
          .status(400)
          .json({ message: "Slug đã tồn tại, vui lòng đổi slug khác" });
      }
      res.status(500).json({ message: "Lỗi server khi tạo đề thi thử" });
    }
  }
);

/* =========================================================
 *  PUT /api/mock-exams/:id
 *  Cập nhật đề thi: cũng CHỈ NHẬN MẢNG ID CÂU HỎI (ObjectId)
 * ======================================================= */
router.put(
  "/:id",
  verifyToken,
  verifyRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      let {
        name,
        examType,
        description,
        duration,
        level,
        grade,
        skill,
        year,
        officialName,
        tags,
        startTime,
        endTime,
        slug,
        questions,
        isActive,
      } = req.body;

      const update = {
        name,
        examType,
        description,
        duration,
        level,
        grade,
        skill,
        year,
        officialName,
        tags,
        startTime,
        endTime,
        slug,
        isActive,
      };

      // nếu FE gửi lại danh sách câu hỏi mới
      if (typeof questions !== "undefined") {
        let questionIdsRaw = questions;

        if (typeof questionIdsRaw === "string") {
          try {
            questionIdsRaw = JSON.parse(questionIdsRaw);
          } catch (e) {
            return res.status(400).json({
              message:
                "Field 'questions' đang là string, không parse được JSON. Hãy gửi mảng ID câu hỏi.",
            });
          }
        }

        if (!Array.isArray(questionIdsRaw)) {
          return res.status(400).json({
            message: "Field 'questions' phải là mảng ID câu hỏi",
          });
        }

        const questionIds = questionIdsRaw.map((q) =>
          typeof q === "string" ? q : q?._id
        );

        const invalidIds = questionIds.filter(
          (id2) => !mongoose.Types.ObjectId.isValid(id2)
        );
        if (invalidIds.length) {
          return res.status(400).json({
            message: "Một số ID câu hỏi không hợp lệ",
            invalidIds,
          });
        }

        update.questions = questionIds;
        update.totalQuestions = questionIds.length;
      }

      const exam = await MockExam.findByIdAndUpdate(id, update, {
        new: true,
      }).lean();

      if (!exam) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      res.json({ exam });
    } catch (err) {
      console.error("PUT /mock-exams/:id error:", err);
      res.status(500).json({ message: "Lỗi server khi cập nhật đề thi thử" });
    }
  }
);

/**
 * DELETE /api/mock-exams/:id
 */
router.delete(
  "/:id",
  verifyToken,
  verifyRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const exam = await MockExam.findByIdAndDelete(id);

      if (!exam) {
        return res.status(404).json({ message: "Không tìm thấy đề thi thử" });
      }

      res.json({ message: "Đã xoá đề thi thử", exam });
    } catch (err) {
      console.error("DELETE /mock-exams/:id error:", err);
      res.status(500).json({ message: "Lỗi server khi xoá đề thi thử" });
    }
  }
);

export default router;
